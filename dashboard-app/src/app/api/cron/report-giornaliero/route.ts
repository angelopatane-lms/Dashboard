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
  const a = process.env.REPORT_SLACK_A;
  if (!token || !slack || !a) {
    const manca = [
      !token && "HUBSPOT_PRIVATE_APP_TOKEN",
      !slack && "SLACK_BOT_TOKEN",
      !a && "REPORT_SLACK_A"
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
      edizioneDal: process.env.REPORT_EDIZIONE_DAL || "2026-05-01"
    });
    const esito = await mandaSlack(messaggio(r), slack, a);
    if (!esito.ok) {
      console.error("[report-giornaliero] Slack:", esito.error);
      // SI RESTITUISCE LA GIORNATA: se Slack ha rifiutato, il report non e'
      // arrivato, e la seconda sveglia deve poter riprovare invece di trovare
      // la riga occupata da un tentativo fallito.
      await db.query(`DELETE FROM report_inviato WHERE giorno = $1::date`, [data]);
      return NextResponse.json({ error: `Slack: ${esito.error}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, giorno: data });
  } catch (e) {
    console.error("[report-giornaliero]", e);
    await db.query(`DELETE FROM report_inviato WHERE giorno = $1::date`, [data]).catch(() => {});
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "report non riuscito" },
      { status: 500 }
    );
  }
}
