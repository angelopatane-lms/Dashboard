import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { getDb } from "@/lib/db";
import { aggiornaUnContatto } from "@/lib/statiLead/sync";

/**
 * NESSUNA RISPOSTA MEMORIZZATA, per lo stesso motivo del webhook delle
 * trattative: Next conserva le risposte delle chiamate in uscita e le riusa, e
 * su un CRM che cambia di continuo questo significa mostrare il passato senza
 * dirlo.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Il cambio di Stato Lead, appena succede.
 *
 * COSA SBLOCCA. Appuntamenti e Consulenze dei quattro advisor telefonici si
 * ricostruiscono dalla cronologia degli Stati Lead: loro non fissano
 * videochiamate, quindi non hanno trattative, e quelle due colonne non hanno
 * altra fonte. Fino al 6 ottobre 2026 quella cronologia arrivava con un giro
 * notturno, e per tutta la giornata la tabella mostrava i numeri di ieri:
 * misurato alle 21:00, Asia Cuccu risultava a zero appuntamenti su un giorno
 * di lavoro. Il giro e' passato a orario, ma un'ora di ritardo resta un'ora.
 *
 * DA DOVE ARRIVA. Un workflow HubSpot che scatta al cambio di hs_lead_status.
 * Va iscritto ai soli contatti dei quattro advisor telefonici: lo stato cambia
 * centinaia di volte al giorno su tutto il portale, e di quelle ne servono
 * poche decine.
 *
 * PERCHE' RILEGGE E NON SI FIDA DELL'ISTANTE. Il payload dice che una
 * proprieta' e' cambiata, non se quel cambio vale come appuntamento: la regola
 * e' che conta il PRIMO appuntamento di ogni coppia advisor-contatto, e si
 * decide sulla cronologia intera. Scrivere l'istante ricevuto conterebbe due
 * volte chi viene ripreso un mese dopo. aggiornaUnContatto() usa le stesse
 * funzioni e lo stesso SQL del giro completo, con un contatto solo in ingresso.
 *
 * NON SOSTITUISCE IL GIRO A LOTTI, lo affianca. Un webhook puo' mancare - un
 * rilascio, un minuto di irraggiungibilita', i tentativi di HubSpot che si
 * esauriscono - e quando manca non lascia traccia: il dato semplicemente non
 * arriva, e uno zero in tabella somiglia a una giornata senza appuntamenti. Il
 * cron resta la rete che recupera quello che e' caduto.
 */

/** Il corpo ammesso. Il payload di un workflow sono poche proprieta'. */
const TETTO_CORPO = 64 * 1024;

async function annota(esito: string, messaggio: string): Promise<void> {
  try {
    const ora = new Date().toISOString();
    await getDb().query(
      `INSERT INTO sync_log (tipo, iniziato_at, finito_at, esito, messaggio)
       VALUES ('webhook-stato-lead', $1::timestamptz, $1::timestamptz, $2, $3)`,
      [ora, esito, messaggio.slice(0, 4000)]
    );
  } catch (e) {
    console.error("[webhook/stato-lead] non sono riuscito ad annotare", e);
  }
}

/** Confronto a tempo costante fra due stringhe di lunghezza qualsiasi. */
function ugualiInSicurezza(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * L'identificativo del contatto, cercato in tutte le forme plausibili.
 *
 * PERCHE' NON UNA SOLA. Con Fireflies abbiamo imparato a nostre spese che il
 * payload documentato e quello reale possono non coincidere, e che un campo
 * letto col nome sbagliato non da' errore: da' undefined, e il gestore non fa
 * niente in silenzio. Il nome esatto lo vedremo alla prima consegna vera; nel
 * frattempo si accettano le forme che HubSpot usa nei suoi payload, e se non
 * se ne trova nessuna il corpo finisce nel log per intero.
 */
function idContatto(p: Record<string, unknown>): string {
  const dentro = (p.properties ?? {}) as Record<string, unknown>;
  for (const v of [
    p.objectId,
    p.hs_object_id,
    p.contactId,
    p.vid,
    p.objectid,
    dentro.hs_object_id,
    dentro.objectId
  ]) {
    const s = String(v ?? "").trim();
    if (/^\d+$/.test(s)) return s;
  }
  return "";
}

async function lavora(contattoId: string): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    await annota("errore", `${contattoId}: HUBSPOT_PRIVATE_APP_TOKEN non impostato`);
    return;
  }
  const t0 = Date.now();
  try {
    const r = await aggiornaUnContatto(token, contattoId);
    const riga = `contatto ${r.contattoId}: ${r.righe} voci di cronologia, ${Date.now() - t0} ms`;
    console.log(`[webhook/stato-lead] ${riga}`);
    // Zero voci non e' un errore: il contatto puo' essere passato a uno stato
    // che non ci interessa, oppure appartenere a un advisor che non e' fra i
    // quattro. Si annota come ignorato per distinguerlo da un lavoro vero.
    await annota(r.righe ? "ok" : "ignorato", riga);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[webhook/stato-lead]", e);
    await annota("errore", `contatto ${contattoId}: ${m}`);
  }
}

/**
 * UN SEGRETO SUO, non quello condiviso con l'altro webhook.
 *
 * HUBSPOT_WEBHOOK_SECRET e' di tipo Secret su Vercel: si puo' sostituire ma
 * non rileggere, e il suo valore non sta in nessun workflow raggiungibile -
 * cercato il 7 ottobre 2026 fra tutti i flussi del portale. Chi chiama
 * l'endpoint delle trattative passa da un Apps Script, e il valore vive nel
 * codice di quello.
 *
 * Riusarlo avrebbe quindi voluto dire sostituirlo e aggiornare in contemporanea
 * anche l'Apps Script, con una finestra di consegne respinte in mezzo. Due
 * segreti distinti evitano tutto questo e hanno un vantaggio proprio: cambiare
 * l'uno non puo' rompere l'altro.
 */
const NOME_SEGRETO = "HUBSPOT_STATO_LEAD_SECRET";

export async function POST(req: NextRequest) {
  const segreto = process.env.HUBSPOT_STATO_LEAD_SECRET;
  if (!segreto) {
    await annota("errore", `${NOME_SEGRETO} non impostato`);
    return NextResponse.json({ error: "non configurato" }, { status: 500 });
  }

  // L'AUTENTICAZIONE PASSA DALL'INDIRIZZO, come per le trattative: i webhook
  // dei workflow firmano con il segreto dell'app connessa, e con un'app privata
  // quel meccanismo non e' documentato in modo utilizzabile. Il segreto sta
  // nella query dell'URL, che vive solo dentro la configurazione del workflow.
  // Si accettano due nomi perche' chi configura scrive l'uno o l'altro, e
  // rifiutare per il nome del parametro sarebbe pignolo e basta.
  const dato = req.nextUrl.searchParams.get("segreto") ?? req.nextUrl.searchParams.get("k") ?? "";
  if (!ugualiInSicurezza(dato, segreto)) {
    await annota(
      "respinto",
      dato
        ? `valore diverso da quello configurato (arrivati ${dato.length} caratteri, attesi ${segreto.length})`
        : "nessun parametro segreto/k nell'indirizzo"
    );
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const corpo = await req.text();
  if (corpo.length > TETTO_CORPO) {
    return NextResponse.json({ error: "corpo troppo lungo" }, { status: 413 });
  }

  let p: Record<string, unknown> = {};
  try {
    const letto = JSON.parse(corpo);
    // Un workflow puo' mandare un oggetto solo o una lista: si normalizza.
    p = Array.isArray(letto) ? (letto[0] ?? {}) : letto;
  } catch {
    await annota("ignorato", `corpo non leggibile: ${corpo.slice(0, 300)}`);
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const contattoId = idContatto(p);
  if (!contattoId) {
    // Si annota il corpo INTERO e le intestazioni di firma: e' il modo in cui
    // scopriamo la forma vera del payload, invece di dedurla.
    const firme = [...req.headers.entries()]
      .filter(([k]) => k.toLowerCase().includes("signature") || k.toLowerCase().startsWith("x-hubspot"))
      .map(([k, v]) => `${k}=${v.slice(0, 40)}`)
      .join(" ");
    await annota("ignorato", `nessun id contatto | intestazioni: ${firme} | corpo: ${corpo.slice(0, 1500)}`);
    return NextResponse.json({ ok: true, ignorato: true });
  }

  // Risposta subito, lavoro dopo: un webhook che va in timeout viene
  // considerato fallito anche quando ha funzionato, e HubSpot lo ripete.
  waitUntil(lavora(contattoId));

  return NextResponse.json({ ok: true, preso: contattoId });
}

/** Per controllare dal browser che l'indirizzo risponda. Non rivela il
 *  segreto: dice solo se e' configurato. */
export async function GET() {
  return NextResponse.json({
    webhook: "hubspot-stato-lead",
    // Il NOME della variabile, oltre al fatto che sia impostata: senza, chi
    // controlla non sa quale delle due il codice sta leggendo davvero.
    variabile: NOME_SEGRETO,
    segreto: Boolean(process.env.HUBSPOT_STATO_LEAD_SECRET)
  });
}
