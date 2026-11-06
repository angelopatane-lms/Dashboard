import { NextRequest, NextResponse } from "next/server";
import { messaggio, reportDelGiorno, ieriRoma } from "@/lib/report/giornaliero";
import { operatoriDelTeam } from "@/lib/operatoriTeam";
import { getDb } from "@/lib/db";

/**
 * Il report del giorno prima, su Slack, ogni mattina alle 8 di Roma.
 *
 * PERCHE' QUI E NON SUL COMPUTER, a differenza del controllo delle 7:30: un
 * report deve arrivare a un'ora prevedibile. Sul portatile arriva quando lo si
 * accende, e un rituale che slitta di tre ore smette di essere un rituale.
 *
 * DUE CRON E UNA SOLA MANDATA. Vercel programma in UTC e non sa niente
 * dell'ora legale: le 8 di Roma sono le 6 UTC d'estate e le 7 d'inverno, e si
 * programmano entrambe.
 *
 * NON SI CONTROLLA CHE A ROMA SIANO LE 8, e il primo tentativo lo faceva: il
 * 17 ottobre 2026 il report non e' arrivato, e il motivo e' scritto nella
 * pagina dei cron di Vercel - "Cron jobs on Hobby have a flexible time window
 * of 1-hour". L'ora in cui la chiamata arriva NON e' quella programmata, puo'
 * scivolare di un'ora: il controllo la scartava e il report non partiva mai.
 *
 * AL SUO POSTO, UNA VOLTA SOLA AL GIORNO. Chi arriva per primo si prende la
 * giornata scrivendo una riga, e chi arriva dopo la trova occupata e se ne va.
 * La presa e' la INSERT stessa, non una lettura seguita da una scrittura: due
 * chiamate contemporanee leggerebbero entrambe "non ancora mandato".
 *
 * NON PRIMA DELLE 8, pero'. "Esattamente le 8" era la regola sbagliata, ma
 * nessuna regola e' sbagliata in un altro modo: d'inverno il cron delle 06:00
 * UTC cade alle 7 di Roma e manderebbe il report un'ora in anticipo, ogni
 * giorno da fine ottobre a fine marzo. Con "non prima delle 8" quello delle 6
 * se ne va in silenzio e tocca a quello delle 7 - che d'inverno e' le 8 di
 * Roma - mentre d'estate e' il contrario. L'orario resta stabile tutto l'anno.
 *
 * E' UN LIMITE SOLO IN BASSO, non una finestra: se la partenza scivola alle 9
 * il report parte lo stesso, perche' tardi e' un fastidio e mai e' un guasto.
 *
 * Il prezzo e' che il report arriva fra le 8 e le 9 invece che alle 8 spaccate.
 * Su Hobby non si puo' fare di meglio, e un report che arriva e' meglio di uno
 * puntuale che non arriva.
 *
 * SI PUO' FORZARE con ?forza=si, che ignora la riga del giorno: serve a
 * rimandarlo a mano quando qualcosa e' andato storto.
 */
/**
 * A CHI VA IL REPORT, in ordine.
 *
 * DAL 6 NOVEMBRE 2026 NON VA PIU' SUL CANALE dell'ufficio (`C07K733QWBS`), ma
 * in privato ad Angelo e a Salvatore Scibetta: chiesto da Angelo, che del
 * canale ha bisogno per delle prove. Il canale non riceve piu' niente da
 * questa rotta; l'id resta scritto qui perche' rimetterlo in elenco sia una
 * riga e non una ricerca.
 *
 * I DESTINATARI STANNO NEL CODICE, non fra le variabili d'ambiente. Un id di
 * canale o di utente non e' un segreto, e il 17 e il 18 ottobre 2026 il report
 * non e' arrivato proprio perche' `REPORT_SLACK_A` non era stata salvata in
 * produzione e la rotta rispondeva 503 prima ancora di provarci. Per lo stesso
 * motivo quella variabile adesso NON si guarda piu': se e' rimasta impostata
 * su Vercel non puo' far tornare il report dove non deve andare.
 *
 * IL PRIMO COMANDA, gli altri seguono. Se il primo non parte la giornata si
 * libera e la seconda sveglia riprova; se non parte uno degli altri la
 * giornata resta presa - liberarla rimanderebbe il report a chi l'ha gia'
 * ricevuto - e l'esito finisce nella colonna `copia_privata`.
 */
const DESTINATARI = [
  "U05JM17H5BL", // Angelo Patane'
  "U05GRL80N85" // Salvatore Scibetta
];

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

async function mandaSlack(testo: string, token: string, a: string) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: a, text: testo })
  });
  const d = (await r.json()) as { ok?: boolean; error?: string };
  return d;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const forzato = req.nextUrl.searchParams.get("forza") === "si";

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const slack = process.env.SLACK_BOT_TOKEN;
  const [primo, ...altri] = DESTINATARI;
  if (!token || !slack) {
    const manca = [
      !token && "HUBSPOT_PRIVATE_APP_TOKEN",
      !slack && "SLACK_BOT_TOKEN"
    ].filter(Boolean);
    // SI DICE QUALE MANCA, mai il valore di quelle che ci sono.
    return NextResponse.json({ error: `variabili mancanti: ${manca.join(", ")}` }, { status: 503 });
  }

  const oraRoma = Number(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      hour12: false
    }).format(new Date())
  );
  if (!forzato && oraRoma < 8) {
    // NON E' UN ERRORE: e' la sveglia che d'inverno cade troppo presto. Si
    // risponde ok, altrimenti Vercel la segna rossa ogni giorno e l'elenco dei
    // fallimenti smette di voler dire qualcosa. E si esce PRIMA di prendersi
    // la giornata, se no l'altra sveglia la troverebbe occupata.
    return NextResponse.json({ ok: true, saltato: `a Roma sono le ${oraRoma}: troppo presto` });
  }

  const data = req.nextUrl.searchParams.get("giorno") ?? ieriRoma();
  const db = getDb();
  if (!forzato) {
    const { rowCount } = await db.query(
      `INSERT INTO report_inviato (giorno) VALUES ($1::date) ON CONFLICT DO NOTHING`,
      [data]
    );
    if (!rowCount) {
      // NON E' UN ERRORE: e' la seconda delle due sveglie, che trova il lavoro
      // gia' fatto. Si risponde ok, altrimenti Vercel la segna rossa ogni
      // giorno e l'elenco dei fallimenti smette di voler dire qualcosa.
      return NextResponse.json({ ok: true, saltato: `il report del ${data} e' gia' stato mandato` });
    }
  }

  try {
    // L'elenco dei Setter serve a dividere chatter e telefonici. Se il foglio
    // non risponde il report esce lo stesso, con tutti i fissati sotto setter.
    const team = await operatoriDelTeam("Setter").catch(() => null);
    const r = await reportDelGiorno({
      token,
      data,
      sottoTeam: team?.sottoTeam,
      // IL VALORE NEL CODICE E' IL PADRONE, le variabili sono una scorciatoia
      // per correggere il conteggio senza ripubblicare. Se mancano, il report
      // esce comunque: una variabile assente non deve fermarlo.
      bigliettiBase: Number(process.env.REPORT_BIGLIETTI_BASE) || undefined,
      bigliettiBaseAl: process.env.REPORT_BIGLIETTI_BASE_AL || undefined
    });
    const testo = messaggio(r);
    const esito = await mandaSlack(testo, slack, primo);
    if (!esito.ok) {
      console.error("[report-giornaliero] Slack:", esito.error);
      // SI RESTITUISCE LA GIORNATA: se Slack ha rifiutato, il report non e'
      // arrivato a nessuno, e la seconda sveglia deve poter riprovare invece
      // di trovare la riga occupata da un tentativo fallito.
      await db.query(`DELETE FROM report_inviato WHERE giorno = $1::date`, [data]);
      return NextResponse.json({ error: `Slack: ${esito.error}` }, { status: 502 });
    }
    const consegne: Record<string, string> = { [primo]: "ok" };
    for (const u of altri) {
      const p = await mandaSlack(testo, slack, u).catch((e) => ({ ok: false, error: String(e) }));
      consegne[u] = p.ok ? "ok" : `non mandato: ${p.error}`;
      if (!p.ok) console.error(`[report-giornaliero] copia a ${u}:`, p.error);
    }

    /**
     * COM'E' ANDATA OGNI CONSEGNA, scritto accanto alla riga del giorno.
     *
     * La riga da sola dice solo che il PRIMO destinatario ha ricevuto: se
     * Slack lo rifiuta, poche righe sopra la riga viene cancellata. Gli altri
     * sono best-effort, e fino a oggi un loro fallimento non lasciava nessuna
     * traccia leggibile - restava nei log di Vercel, dove non guarda nessuno.
     *
     * NON SI SCRIVE SU SLACK: il report e' il report, questo e' un dato di
     * controllo e vive nel database.
     *
     * IN UN SUO try, e non e' un dettaglio: se questa scrittura fallisse
     * dentro il try grande, il catch cancellerebbe la riga del giorno e la
     * seconda sveglia manderebbe il report una SECONDA VOLTA a chi l'ha gia'
     * ricevuto. Un esito non registrato e' un fastidio, un report doppio e' un
     * danno.
     */
    await db
      .query(`UPDATE report_inviato SET copia_privata = $2 WHERE giorno = $1::date`, [
        data,
        Object.entries(consegne)
          .map(([u, esito]) => `${u}: ${esito}`)
          .join(" · ")
      ])
      .catch((e) => console.error("[report-giornaliero] esito delle consegne non scritto:", e));

    return NextResponse.json({ ok: true, giorno: data, consegne });
  } catch (e) {
    console.error("[report-giornaliero]", e);
    await db.query(`DELETE FROM report_inviato WHERE giorno = $1::date`, [data]).catch(() => {});
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "report non riuscito" },
      { status: 500 }
    );
  }
}
