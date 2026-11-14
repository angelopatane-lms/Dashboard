import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PIPELINE_HT } from "@/lib/report/giornaliero";

/**
 * GLI APPUNTAMENTI E LE CONSULENZE DI UN GIORNO, UNO PER UNO.
 *
 * A COSA SERVE. Sulle pagine squadre i due quadranti dicono quanti; chi guarda
 * una giornata vuole sapere anche QUALI - a che ora, con chi, procurato da chi
 * e tenuto da chi. Finche' il numero era solo un numero, per vederci dentro
 * bisognava aprire HubSpot e rifare a mano il filtro, che e' il momento in cui
 * si smette di fidarsi della pagina.
 *
 * UN GIORNO SOLO, per adesso. Non e' un limite tecnico ma una scelta: su una
 * giornata sono trenta appuntamenti e dieci consulenze, che si leggono in due
 * chiamate e stanno in una finestra; su un mese sarebbero mille righe, nessuno
 * le scorre e le letture su HubSpot diventerebbero venti.
 *
 * LE DUE DEFINIZIONI SONO LE STESSE DEI QUADRANTI, e questo e' il punto:
 *
 *   appuntamento  una trattativa NATA in quel giorno, attribuita a chi l'ha
 *                 fissata - il setter se c'e', altrimenti il proprietario.
 *                 E' la regola di calcolaFinestra(), quindi l'elenco e il
 *                 numero sopra non possono divergere.
 *
 *   consulenza    una trattativa SVOLTA in quel giorno, al proprietario che
 *                 l'ha tenuta. E' svolteComeProprietario, la stessa colonna
 *                 che il quadrante somma.
 *
 * DUE ORARI DIVERSI, e si distinguono. Per un appuntamento conta QUANDO SI
 * TERRA' - la data e ora sulla trattativa - che non e' l'ora in cui e' stato
 * preso: uno fissato alle 10:26 puo' essere per giovedi' alle 15. Si mandano
 * entrambi, perche' uno dice la giornata del cliente e l'altro quella del
 * setter. Per una consulenza l'orario e' quello in cui risulta svolta.
 *
 * ICMD RESTA FUORI, e non per dimenticanza: gli advisor eventi vendono al
 * telefono e non aprono trattative in pipeline Appuntamenti - i loro numeri li
 * ricostruiamo dai movimenti dello Stato Lead - quindi su quella squadra
 * l'elenco sarebbe vuoto mentre il quadrante mostra decine di appuntamenti. La
 * pagina lo dice invece di far sembrare un guasto.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const HUBSPOT_API = "https://api.hubapi.com";

type Riga = {
  dealId: string;
  contattoId: string | null;
  /** Il nome e cognome del contatto, quando HubSpot lo ha. */
  contatto: string;
  setterId: string | null;
  proprietarioId: string | null;
  /** L'ora italiana in cui la trattativa e' nata: quando e' stato fissato. */
  oraFissata: string | null;
  /** L'istante dell'appuntamento, o quello in cui la consulenza risulta svolta. */
  quando: string | null;
  prodotto: string | null;
};

/**
 * L'orario dell'appuntamento e la sua pipeline, a blocchi di cento trattative.
 *
 * LA PIPELINE SERVE A TOGLIERE QUELLO CHE IL QUADRANTE NON CONTA: il numero
 * sopra l'elenco viene da una ricerca su HubSpot limitata ad Appuntamenti High
 * Ticket, mentre il nostro archivio tiene anche trattative di altre pipeline.
 * Sul 13 novembre 2026 erano 29 su 30 - una sola riga di scarto, che pero' e'
 * esattamente il genere di scarto che fa perdere fiducia in un elenco.
 */
async function datiDegliAppuntamenti(token: string, dealId: string[]) {
  const fuori = new Map<string, { quando: string | null; pipeline: string | null }>();
  for (let i = 0; i < dealId.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // DUE CAMPI PER LA DATA, NON UNO: sono sfasati di due ore e nessuno dei
        // due da solo copre tutte le trattative. Stessa coppia del report
        // giornaliero e della fotografia delle squadre.
        properties: ["data_e_ora_appuntamento", "data_appuntamento", "pipeline"],
        inputs: dealId.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    if (!res.ok) continue;
    const dati = await res.json();
    for (const d of dati.results ?? []) {
      const p = d.properties ?? {};
      const grezzo = (p.data_e_ora_appuntamento ?? "").trim() || (p.data_appuntamento ?? "").trim();
      fuori.set(String(d.id), {
        quando: grezzo || null,
        pipeline: (p.pipeline ?? "").trim() || null
      });
    }
  }
  return fuori;
}

/** Nome e cognome, a blocchi di cento contatti. */
async function nomiDeiContatti(token: string, contattoId: string[]) {
  const fuori = new Map<string, string>();
  for (let i = 0; i < contattoId.length; i += 100) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: ["firstname", "lastname"],
        inputs: contattoId.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    if (!res.ok) continue;
    const dati = await res.json();
    for (const c of dati.results ?? []) {
      const nome = `${c.properties?.firstname ?? ""} ${c.properties?.lastname ?? ""}`.trim();
      if (nome) fuori.set(String(c.id), nome);
    }
  }
  return fuori;
}

export async function GET(req: NextRequest) {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) {
    return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }

  const giorno = req.nextUrl.searchParams.get("giorno") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
    return NextResponse.json({ errore: "serve giorno=YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const db = getDb();
    const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN ?? "";

    /*
     * IL GIORNO E' QUELLO DI ROMA, non quello del database, che e' in GMT:
     * senza questa conversione le trattative nate fra mezzanotte e le due
     * finirebbero nel giorno prima, e sono proprio quelle che un elenco di
     * giornata fa notare.
     */
    const leggi = async (campo: "creata_ts" | "svolta_ts"): Promise<Riga[]> => {
      const { rows } = await db.query<{
        deal_id: string;
        contact_id: string | null;
        setter_id: string | null;
        proprietario_id: string | null;
        ora: string | null;
        quando: Date | null;
        prodotto: string | null;
      }>(
        `SELECT t.deal_id::text AS deal_id,
                t.contact_id::text AS contact_id,
                t.setter_id::text AS setter_id,
                t.proprietario_id::text AS proprietario_id,
                to_char(t.creata_ts AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora,
                t.${campo} AS quando,
                t.prodotto
           FROM trattativa t
          WHERE t.${campo} >= ($1::date::timestamp AT TIME ZONE 'Europe/Rome')
            AND t.${campo} < (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Europe/Rome')
          ORDER BY t.${campo}`,
        [giorno]
      );
      return rows.map((r) => ({
        dealId: r.deal_id,
        contattoId: r.contact_id,
        contatto: "",
        setterId: r.setter_id,
        proprietarioId: r.proprietario_id,
        oraFissata: r.ora,
        quando: r.quando ? r.quando.toISOString() : null,
        prodotto: r.prodotto
      }));
    };

    let appuntamenti = await leggi("creata_ts");
    const consulenze = await leggi("svolta_ts");

    /*
     * GLI ORARI E LA PIPELINE PRIMA DI TUTTO IL RESTO: la pipeline decide
     * quali righe restano, e i nomi dei contatti si leggono dopo, per non
     * chiedere a HubSpot il nome di qualcuno che poi si scarta.
     */
    if (token && appuntamenti.length) {
      const dati = await datiDegliAppuntamenti(token, appuntamenti.map((r) => r.dealId));
      appuntamenti = appuntamenti.filter((r) => {
        const d = dati.get(r.dealId);
        // Quello che HubSpot non ci fa leggere resta nell'elenco: una riga in
        // piu' si vede e si spiega, una riga mancante no.
        if (!d) return true;
        if (d.pipeline && d.pipeline !== PIPELINE_HT) return false;
        // La trattativa e' nata in questo giorno, ma la data dell'appuntamento
        // puo' non esserci: resta vuota invece di mostrare l'ora in cui e'
        // nata, che e' un'altra cosa e sta nel suo campo.
        r.quando = d.quando;
        return true;
      });
    }

    const tutte = [...appuntamenti, ...consulenze];

    // I NOMI DELLE PERSONE DAL DATABASE, non da HubSpot: la tabella li ha gia'
    // tutti, e un setter di un'altra squadra - che capita - altrimenti
    // resterebbe un numero.
    const idPersone = [
      ...new Set(tutte.flatMap((r) => [r.setterId, r.proprietarioId]).filter(Boolean))
    ] as string[];
    const nomiPersone: Record<string, string> = {};
    if (idPersone.length) {
      const { rows } = await db.query<{ id: string; nome: string }>(
        `SELECT id::text AS id, nome FROM proprietario WHERE id = ANY($1::bigint[])`,
        [idPersone]
      );
      for (const r of rows) nomiPersone[r.id] = r.nome;
    }

    /*
     * I NOMI DEI CONTATTI E GLI ORARI VENGONO DA HUBSPOT, e sono la parte che
     * puo' mancare: senza token si manda l'elenco comunque, con gli orari che
     * il database ha. Un elenco senza i nomi e' meno utile; un elenco che non
     * si apre perche' manca una variabile e' peggio.
     */
    if (token) {
      const nomi = await nomiDeiContatti(
        token,
        [...new Set(tutte.map((r) => r.contattoId).filter(Boolean))] as string[]
      );
      for (const r of tutte) if (r.contattoId) r.contatto = nomi.get(r.contattoId) ?? "";
    }

    return NextResponse.json(
      {
        generato: new Date().toISOString(),
        giorno,
        nomiPersone,
        conHubspot: Boolean(token),
        appuntamenti,
        consulenze
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/dettaglio]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
