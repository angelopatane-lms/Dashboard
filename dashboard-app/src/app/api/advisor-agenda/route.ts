import { NextRequest, NextResponse } from "next/server";

// L'agenda di una giornata: i meeting di HubSpot, per persona e per orario.
//
// PERCHE' HUBSPOT E NON GOOGLE CALENDAR. Gli appuntamenti che si vedono sui
// calendari degli advisor li crea HubSpot quando il contatto prenota: hanno
// titolo "Contatto and Advisor", orario, proprietario ed esito. Leggerli da qui
// costa una chiamata con il token che gia' abbiamo, invece di
// un'autorizzazione a livello di dominio Google per ogni calendario.
//
// COSA MANCA, ed e' bene saperlo: gli impegni che un advisor si segna da solo -
// pranzi, blocchi, formazione, ferie - non passano da HubSpot e qui non
// compaiono. Per quelli servirebbe l'interrogazione di sola disponibilita' di
// Google Calendar, che dice quando la persona e' occupata senza dire cosa sta
// facendo. Finche' non c'e', l'agenda mostra il lavoro, non la giornata intera.

export const dynamic = "force-dynamic";

const HUBSPOT_API = "https://api.hubapi.com";

/** Il tipo decide il colore, e lo decidono i dati: e' l'esito del meeting. */
export type TipoEvento = "appuntamento" | "svolta" | "annullato" | "interno";

export type EventoAgenda = {
  operatore: string;
  /** Il nome del contatto: dal titolo si toglie " and <advisor>", che ripete
   *  quello che c'e' gia' scritto in cima alla colonna. */
  titolo: string;
  /** Minuti dalla mezzanotte di Roma. */
  inizioMin: number;
  fineMin: number;
  /** "09:30", gia' pronto da scrivere. */
  inizio: string;
  fine: string;
  tipo: TipoEvento;
};

const due = (n: number) => String(n).padStart(2, "0");

/**
 * L'istante UTC che a Roma e' quel giorno a quell'ora.
 *
 * Serve perche' HubSpot filtra e risponde in UTC mentre l'agenda si legge in
 * ora italiana: d'estate sono due ore di differenza, e un meeting delle 09:00
 * chiesto in UTC comincerebbe alle 11:00 sullo schermo. Si parte dall'istante
 * come se Roma fosse UTC, si guarda che ora sarebbe davvero a Roma, e si
 * corregge di quella differenza.
 */
function istanteRoma(giorno: string, ore: number, minuti: number): number {
  const tentativo = Date.parse(`${giorno}T${due(ore)}:${due(minuti)}:00Z`);
  const aRoma = new Date(tentativo).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
  const scarto = Date.parse(`${aRoma.replace(" ", "T")}Z`) - tentativo;
  return tentativo - scarto;
}

/** Ora di Roma di un istante, come "09:30" e come minuti dalla mezzanotte. */
function oraRoma(iso: string): { testo: string; minuti: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const aRoma = new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
  const ora = aRoma.split(" ")[1] ?? "";
  const [h, m] = ora.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { testo: `${due(h)}:${due(m)}`, minuti: h * 60 + m };
}

function tipoDa(esito: string | null | undefined): TipoEvento {
  const e = (esito ?? "").trim().toUpperCase();
  if (e === "COMPLETED") return "svolta";
  if (e === "CANCELED" || e === "NO_SHOW") return "annullato";
  // Senza esito sono le riunioni interne, che nessuno "svolge" con un cliente:
  // misurato sul 2 settembre, l'unica era "Riunione Mattutina".
  if (!e) return "interno";
  return "appuntamento";
}

async function leggiProprietari(token: string): Promise<Record<string, string>> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/owners?limit=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map: Record<string, string> = {};
  for (const o of data.results ?? []) {
    map[String(o.id)] = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
  }
  return map;
}

const DURATA_MEMORIA_MS = 60 * 1000;
let memoria: { chiave: string; scade: number; corpo: unknown } | null = null;

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  const giorno = req.nextUrl.searchParams.get("giorno") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
    return NextResponse.json({ error: "Parametro giorno mancante o malformato" }, { status: 400 });
  }

  // Un minuto di memoria: l'agenda cambia durante la giornata - un
  // appuntamento si sposta, uno si conclude - quindi non si tiene a lungo come
  // i totali mensili, ma basta a non rileggere HubSpot a ogni respiro.
  const chiave = giorno;
  if (memoria && memoria.chiave === chiave && memoria.scade > Date.now()) {
    return NextResponse.json(memoria.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const proprietari = await leggiProprietari(token);

    const dalle = istanteRoma(giorno, 0, 0);
    const alle = dalle + 24 * 60 * 60 * 1000;

    const grezzi: Array<{ properties: Record<string, string | null> }> = [];
    let after: string | undefined;
    do {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/meetings/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
                { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
              ]
            }
          ],
          properties: [
            "hs_meeting_title",
            "hs_meeting_start_time",
            "hs_meeting_end_time",
            "hubspot_owner_id",
            "hs_meeting_outcome"
          ],
          limit: 100,
          ...(after ? { after } : {})
        })
      });
      if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
      const data = await res.json();
      grezzi.push(...(data.results ?? []));
      after = data.paging?.next?.after;
    } while (after);

    let senzaPersona = 0;
    const eventi: EventoAgenda[] = [];

    for (const r of grezzi) {
      const p = r.properties;
      const id = (p.hubspot_owner_id ?? "").trim();
      const operatore = id ? proprietari[id] ?? "" : "";
      if (!operatore) {
        senzaPersona += 1;
        continue;
      }

      const da = oraRoma(p.hs_meeting_start_time ?? "");
      if (!da) continue;
      const a = oraRoma(p.hs_meeting_end_time ?? "");

      // Un meeting senza fine, o che scavalca la mezzanotte, prende mezz'ora:
      // meglio un blocco corto di uno che si allunga fino a fondo giornata.
      const fineMin = a && a.minuti > da.minuti ? a.minuti : Math.min(da.minuti + 30, 24 * 60);

      const titolo = (p.hs_meeting_title ?? "").trim();
      const senzaAdvisor = titolo
        .replace(new RegExp(`\\s+and\\s+${operatore.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$`, "i"), "")
        .trim();

      eventi.push({
        operatore,
        titolo: senzaAdvisor || titolo || "Senza titolo",
        inizioMin: da.minuti,
        fineMin,
        inizio: da.testo,
        fine: a ? a.testo : "",
        tipo: tipoDa(p.hs_meeting_outcome)
      });
    }

    eventi.sort((x, y) => x.inizioMin - y.inizioMin);
    console.log(
      `[advisor-agenda] ${giorno}: ${eventi.length} eventi, ${new Set(eventi.map((e) => e.operatore)).size} persone` +
        (senzaPersona ? `, ${senzaPersona} senza proprietario` : "")
    );

    const corpo = { giorno, eventi };
    memoria = { chiave, scade: Date.now() + DURATA_MEMORIA_MS, corpo };
    return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[advisor-agenda]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "HubSpot non raggiungibile" }, { status: 502 });
  }
}
