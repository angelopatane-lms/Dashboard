/**
 * La serie A converte davvero meglio della B? E il pool esteso quanto vale?
 *
 * COME SI LANCIA
 *   npx tsx scripts/qualita-serie.ts        ultimi 30 giorni
 *   npx tsx scripts/qualita-serie.ts 14     ultimi 14
 *
 * PERCHE'. Il 27 ottobre 2026 si decide di tornare al mix 90% serie A / 10%
 * serie B "per alzare la qualita' dei lead". Tutto quel ragionamento poggia su
 * un presupposto che nessuno ha mai verificato: che la serie A converta meglio.
 * Qui si guarda l'esito vero dei lead assegnati.
 *
 * COME SI ATTRIBUISCE LA SERIE. Non dal registro delle richieste: il suo campo
 * `serie` dice "serie_a 12 + serie_b 8" per l'intera richiesta, non per singolo
 * contatto. La serie sta sul contatto, in `dispatch_outcome`, che e' anche il
 * filtro con cui l'app lo ha pescato.
 *
 * ATTENZIONE A UN LIMITE: `dispatch_outcome` puo' essere stato ricalcolato dopo
 * l'assegnazione, quindi l'attribuzione e' quella di ADESSO e non
 * necessariamente quella del giorno in cui il lead e' stato dato. E' il dato
 * migliore disponibile, non un dato perfetto.
 *
 * COSA CONTA COME BUON ESITO: "Appuntamento fissato", "in Trattative",
 * "Cliente". Come cattivo: BIN, numero_errato, No Show, Errore. Il resto -
 * NEW, NOT_ANSWERED, semine - e' lavoro ancora in corso e si conta a parte,
 * perche' mescolarlo con i no gonfierebbe il fallimento.
 */
import "./env";
import { getDb } from "../src/lib/db";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const giorni = Number(process.argv[2] || 30);

const BUONI = new Set(["Appuntamento fissato", "in Trattative", "Cliente"]);
const CATTIVI = new Set(["BIN", "numero_errato", "No Show", "Errore"]);
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = getDb();
  const r = await db.query<{ contatti: unknown; motivo: string }>(
    `SELECT contatti, coalesce(motivo, '') AS motivo
       FROM assegnazione_richiesta
      WHERE giorno >= CURRENT_DATE - $1::int AND esito = 'assegnato' AND contatti IS NOT NULL`,
    [giorni]);

  // Chi e' stato dato da una richiesta che ha dovuto allargare la finestra: il
  // motivo lo dice ("+N da pool esteso"). Non si sa QUALI dei venti, quindi si
  // marca l'intera richiesta: serve a confrontare le richieste piene di pool
  // esteso con le altre, non i singoli contatti.
  const esteso = new Set<string>();
  const tutti = new Set<string>();
  for (const riga of r.rows) {
    const lista: string[] = Array.isArray(riga.contatti)
      ? (riga.contatti as string[]).map(String)
      : JSON.parse(String(riga.contatti || "[]")).map(String);
    for (const id of lista) {
      if (!id) continue;
      tutti.add(id);
      if (/pool esteso/i.test(riga.motivo)) esteso.add(id);
    }
  }
  const ids = [...tutti];
  console.log(`\nLead assegnati negli ultimi ${giorni} giorni: ${ids.length}`);
  console.log(`  di cui da richieste che hanno attinto al pool esteso: ${esteso.size}`);

  type Conta = { tot: number; buoni: number; cattivi: number; corso: number };
  const vuota = (): Conta => ({ tot: 0, buoni: 0, cattivi: 0, corso: 0 });
  const perSerie = new Map<string, Conta>();
  const perEsteso = new Map<string, Conta>();
  const stati = new Map<string, number>();

  for (let i = 0; i < ids.length; i += 100) {
    for (let t = 0; t < 6; t++) {
      const b = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
        method: "POST", headers: H,
        body: JSON.stringify({
          properties: ["hs_lead_status", "dispatch_outcome"],
          inputs: ids.slice(i, i + 100).map((id) => ({ id })),
        }),
      });
      if (b.status === 429) { await pausa(4000); continue; }
      const d = await b.json();
      for (const c of d.results ?? []) {
        const serie = c.properties.dispatch_outcome || "(senza serie)";
        const stato = (c.properties.hs_lead_status || "(vuoto)").trim();
        stati.set(stato, (stati.get(stato) ?? 0) + 1);
        for (const [mappa, chiave] of [[perSerie, serie], [perEsteso, esteso.has(String(c.id)) ? "con pool esteso" : "solo finestra 30gg"]] as const) {
          if (!mappa.has(chiave)) mappa.set(chiave, vuota());
          const x = mappa.get(chiave)!;
          x.tot++;
          if (BUONI.has(stato)) x.buoni++;
          else if (CATTIVI.has(stato)) x.cattivi++;
          else x.corso++;
        }
      }
      break;
    }
    await pausa(150);
  }

  const tabella = (titolo: string, m: Map<string, Conta>) => {
    console.log(`\n${titolo}`);
    console.log("            totale   buon esito          scartati         in corso");
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1].tot - a[1].tot)) {
      const p = (n: number) => `${String(n).padStart(5)} (${(n / Math.max(v.tot, 1) * 100).toFixed(1)}%)`;
      console.log(`  ${k.padEnd(20)} ${String(v.tot).padStart(6)}   ${p(v.buoni)}   ${p(v.cattivi)}   ${p(v.corso)}`);
    }
  };
  tabella("PER SERIE (buon esito = appuntamento, trattativa o cliente)", perSerie);
  tabella("FINESTRA 30 GIORNI CONTRO POOL ESTESO", perEsteso);

  console.log("\nGLI STATI, per capire cosa c'e' dentro \"in corso\":");
  for (const [s, n] of [...stati.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`  ${String(n).padStart(6)}  ${s}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
