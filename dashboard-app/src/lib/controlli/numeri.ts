import { getDb } from "@/lib/db";
import { fetchCsv } from "@/lib/csv";

/**
 * Il controllo quotidiano dei numeri: cerca i silenzi, non gli errori.
 *
 * PERCHE' ESISTE. Gli errori che ci costano di piu' non danno errore. Danno un
 * numero piu' basso, o uno zero, e restano li' finche' qualcuno non li guarda
 * per caso. Tre esempi veri di ottobre 2026, tutti scoperti per caso e tutti
 * controllati qui sotto:
 *
 * - il 13 ottobre il foglio Operatori non ha archiviato la giornata: le pagine
 *   Advisor e Setter erano vuote per quel giorno, e ce ne siamo accorti il
 *   giorno dopo perche' qualcuno ha aperto la pagina;
 * - l'archivio delle chiamate era fermo da otto giorni, e ogni giro segnava
 *   "errore" sei volte al giorno in un registro che non apriva nessuno;
 * - Valentina Scardozzi aveva zero lead assegnati nella tabella mentre su
 *   HubSpot ne aveva venti.
 *
 * COSA NON FA. Non giudica se i numeri sono belli: non sa se ieri si e'
 * lavorato poco. Controlla che ci siano, che siano freschi e che due fonti
 * che raccontano la stessa cosa non si contraddicano. Il resto lo guarda una
 * persona.
 *
 * NESSUNA NOTIZIA E' UNA BUONA NOTIZIA: se non trova niente non scrive a
 * nessuno. Un avviso quotidiano che dice sempre "tutto bene" si smette di
 * leggere dopo una settimana, e il giorno che dice altro passa inosservato.
 */

export type Anomalia = {
  /** Un codice corto per ritrovarla nei registri. */
  codice: string;
  /** "grave" = qualcosa manca o e' fermo; "attenzione" = due fonti non tornano. */
  gravita: "grave" | "attenzione";
  testo: string;
};

const FOGLIO_OPERATORI = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_STORICO = "245526930";
const HUBSPOT = "https://api.hubapi.com";

/** Ieri, in ora di Roma: e' la giornata che il controllo guarda. */
export function ieriRoma(): string {
  const d = new Date(Date.now() - 24 * 3600_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(d);
}

const giorni = (d: Date | string | null): number =>
  d === null ? Infinity : (Date.now() - new Date(d).getTime()) / 86_400_000;

export async function controllaNumeri(tokenHubspot?: string): Promise<Anomalia[]> {
  const ieri = ieriRoma();
  const db = getDb();
  const trovate: Anomalia[] = [];
  const aggiungi = (codice: string, gravita: Anomalia["gravita"], testo: string) =>
    trovate.push({ codice, gravita, testo });

  // 1. IL FOGLIO HA ARCHIVIATO IERI?
  //
  // E' il controllo piu' importante perche' e' quello che ci e' mancato: le
  // righe di una giornata vivono nella scheda del giorno e vengono spostate
  // nello storico la mattina dopo. Se il travaso non parte, quelle righe
  // vengono sovrascritte e il giorno non esiste piu' per nessuno.
  try {
    const righe = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${FOGLIO_OPERATORI}/export?format=csv&gid=${GID_STORICO}`,
      { next: { revalidate: 0 } }
    );
    const diIeri = righe.filter((r) => String(r["Data"] ?? "").startsWith(ieri)).length;
    if (!diIeri) {
      const ultime = [...new Set(righe.map((r) => String(r["Data"] ?? "")))].sort();
      aggiungi(
        "foglio-operatori",
        "grave",
        `Il foglio Operatori non ha nessuna riga per ieri (${ieri}): le tabelle ` +
          `Advisor e Setter saranno vuote per quel giorno. L'ultima data archiviata ` +
          `e' ${ultime[ultime.length - 1] || "nessuna"}.`
      );
    }
  } catch (e) {
    aggiungi(
      "foglio-operatori",
      "grave",
      `Il foglio Operatori non si e' potuto leggere: ${e instanceof Error ? e.message : e}`
    );
  }

  // 2. LE CHIAMATE SONO FRESCHE?
  const { rows: ch } = await db.query<{ ultima: Date | null; ieri: string }>(
    `SELECT max(ts) AS ultima,
            count(*) FILTER (WHERE (ts AT TIME ZONE 'Europe/Rome')::date = $1::date) AS ieri
       FROM chiamata WHERE ts <= now()`,
    [ieri]
  );
  if (Number(ch[0]?.ieri ?? 0) === 0) {
    aggiungi(
      "chiamate",
      "grave",
      `Nessuna chiamata registrata per ieri (${ieri}). L'ultima che abbiamo e' del ` +
        `${ch[0]?.ultima ? new Date(ch[0].ultima).toISOString().slice(0, 10) : "mai"}: ` +
        `la pagina Campagne sta mostrando numeri vecchi.`
    );
  }

  // 3. LE TRATTATIVE SI MUOVONO?
  //
  // Le riceviamo da un webhook in tempo reale: mezza giornata senza nemmeno un
  // cambio di fase, in un giorno lavorativo, vuol dire che il webhook e' caduto.
  const { rows: tr } = await db.query<{ ultimo: Date | null; ieri: string }>(
    `SELECT max(fase_ts) AS ultimo,
            count(*) FILTER (WHERE (creata_ts AT TIME ZONE 'Europe/Rome')::date = $1::date) AS ieri
       FROM trattativa`,
    [ieri]
  );
  if (giorni(tr[0]?.ultimo ?? null) > 1) {
    aggiungi(
      "trattative",
      "grave",
      `Nessun cambio di fase sulle trattative da piu' di 24 ore (l'ultimo e' del ` +
        `${tr[0]?.ultimo ? new Date(tr[0].ultimo).toISOString().slice(0, 16).replace("T", " ") : "mai"}): ` +
        `probabilmente il webhook di HubSpot non arriva piu'.`
    );
  }

  // 4. LE DUE FONTI DEGLI ASSEGNATI DICONO LA STESSA COSA?
  //
  // Il foglio e HubSpot contano gli stessi lead in due modi diversi. Vicini si
  // confermano a vicenda; lontani, uno dei due sta sbagliando - ed e' cosi' che
  // si e' vista una persona con zero assegnati che ne aveva venti.
  if (tokenHubspot) {
    try {
      const dalFoglio = await assegnatiDalFoglio(ieri);
      const daHubspot = await assegnatiDaHubspot(ieri, tokenHubspot);
      if (dalFoglio !== null && daHubspot > 0) {
        const scarto = Math.abs(dalFoglio - daHubspot) / daHubspot;
        if (scarto > 0.2) {
          aggiungi(
            "assegnati-due-fonti",
            "attenzione",
            `Gli assegnati di ieri non tornano fra le due fonti: il foglio ne conta ` +
              `${dalFoglio}, HubSpot ${daHubspot} (${Math.round(scarto * 100)}% di scarto).`
          );
        }
      }
    } catch {
      /* il confronto e' un di piu': se non riesce non si avvisa nessuno */
    }
  }

  // 5. QUALCHE GIRO DI SINCRONIZZAZIONE STA FALLENDO?
  const { rows: giri } = await db.query<{ tipo: string; quanti: string; ultimo: string }>(
    `SELECT tipo, count(*) AS quanti, max(left(messaggio, 120)) AS ultimo
       FROM sync_log
      WHERE iniziato_at > now() - interval '24 hours' AND esito = 'errore'
      GROUP BY tipo ORDER BY count(*) DESC`
  );
  for (const g of giri) {
    aggiungi(
      `sync-${g.tipo}`,
      "attenzione",
      `Il giro "${g.tipo}" e' fallito ${g.quanti} volte nelle ultime 24 ore. ` +
        `Ultimo messaggio: ${g.ultimo ?? "(nessuno)"}`
    );
  }

  // 6. LE CONVERSIONI DELLA PAGINA CAMPAGNE SONO ARRIVATE?
  const { rows: ev } = await db.query<{ ieri: string; ultimo: Date | null }>(
    `SELECT count(*) FILTER (WHERE (ts AT TIME ZONE 'Europe/Rome')::date = $1::date) AS ieri,
            max(ts) AS ultimo
       FROM eventi_conversione WHERE ts <= now()`,
    [ieri]
  );
  if (Number(ev[0]?.ieri ?? 0) === 0) {
    aggiungi(
      "conversioni",
      "grave",
      `Nessuna conversione registrata per ieri (${ieri}): la pagina Campagne mostra ` +
        `zero lead su tutte le campagne di quel giorno. L'ultima e' del ` +
        `${ev[0]?.ultimo ? new Date(ev[0].ultimo).toISOString().slice(0, 10) : "mai"}.`
    );
  }

  // 7. I RILANCI A COPILOT PASSANO?
  //
  // SI CONTANO LE TRATTATIVE RIMASTE FUORI, non i tentativi andati male: i
  // rinvii esistono apposta, e un tentativo fallito seguito da uno riuscito non
  // e' un problema. Contando i tentativi, il giorno dello storico questo
  // controllo avrebbe segnalato duecentotre guasti che erano gia' rientrati.
  const { rows: cop } = await db.query<{ falliti: string }>(
    `SELECT count(DISTINCT deal_id) AS falliti
       FROM copilot_trattativa_invio i
      WHERE inviato_at > now() - interval '24 hours' AND esito <> 'ok'
        AND NOT EXISTS (
          SELECT 1 FROM copilot_trattativa_invio ok
           WHERE ok.deal_id = i.deal_id AND ok.esito = 'ok' AND ok.inviato_at > i.inviato_at
        )`
  );
  if (Number(cop[0]?.falliti ?? 0) > 0) {
    aggiungi(
      "copilot",
      "attenzione",
      `${cop[0].falliti} trattative non sono arrivate a Sales Copilot nelle ultime ` +
        `24 ore, e nessun rinvio successivo le ha recuperate.`
    );
  }

  return trovate;
}

/** Quanti lead risultano assegnati ieri secondo il foglio Operatori. */
async function assegnatiDalFoglio(giorno: string): Promise<number | null> {
  const righe = await fetchCsv(
    `https://docs.google.com/spreadsheets/d/${FOGLIO_OPERATORI}/export?format=csv&gid=${GID_STORICO}`,
    { next: { revalidate: 0 } }
  );
  const diQuelGiorno = righe.filter((r) => String(r["Data"] ?? "").startsWith(giorno));
  if (!diQuelGiorno.length) return null;
  return diQuelGiorno.reduce((somma, r) => somma + (Number(r["Assegnati"] ?? 0) || 0), 0);
}

/** Quanti contatti hanno cambiato proprietario ieri, secondo HubSpot. */
async function assegnatiDaHubspot(giorno: string, token: string): Promise<number> {
  const da = new Date(`${giorno}T00:00:00Z`).getTime() - 2 * 3600_000;
  const a = da + 24 * 3600_000;
  const r = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: "hubspot_owner_assigneddate", operator: "GTE", value: String(da) },
            { propertyName: "hubspot_owner_assigneddate", operator: "LT", value: String(a) }
          ]
        }
      ],
      limit: 1
    })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { total?: number }).total ?? 0;
}

/**
 * Il messaggio per Slack. Corto di proposito: dice cosa non va e in che
 * giornata, non cosa fare - quello cambia ogni volta.
 */
export function messaggio(anomalie: Anomalia[]): string {
  const gravi = anomalie.filter((a) => a.gravita === "grave");
  const titolo =
    gravi.length > 0
      ? `:rotating_light: *Controllo numeri del ${ieriRoma()}: ${gravi.length} da guardare subito*`
      : `:warning: *Controllo numeri del ${ieriRoma()}*`;
  const righe = anomalie.map(
    (a) => `${a.gravita === "grave" ? ":red_circle:" : ":large_orange_diamond:"} ${a.testo}`
  );
  return [titolo, ...righe].join("\n\n");
}
