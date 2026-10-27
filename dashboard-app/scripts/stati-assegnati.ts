/**
 * Che Stato Lead avevano i lead NELL'ISTANTE in cui sono stati assegnati.
 *
 * COME SI LANCIA
 *   npx tsx scripts/stati-assegnati.ts         oggi
 *   npx tsx scripts/stati-assegnati.ts 1       da ieri
 *
 * A COSA SERVE. L'app non deve pescare i lead in "No Show", "numero_errato",
 * "Errore" e "BIN" (`STATI_NON_PESCABILI` in lead_assigner.py). Verificarlo
 * guardando lo stato ATTUALE non dice niente: un lead dato come NEW e messo in
 * BIN da chi l'ha chiamato risulterebbe un errore dell'app senza esserlo, e
 * uno dato in BIN e poi corretto sparirebbe dal conto. Qui si ricostruisce lo
 * stato al momento della consegna dalla cronologia della proprieta'
 * (`propertiesWithHistory=hs_lead_status`): la versione piu' recente fra
 * quelle precedenti all'assegnazione.
 *
 * PERCHE' E' SERVITO (26 ottobre 2026). Quattro lead in BIN da mesi erano
 * stati assegnati. La correzione era stata scritta in `lead_assigner.py` il 22
 * ottobre alle 13:03, ma l'immagine Docker in servizio era stata costruita
 * alle 11:04 dello stesso giorno: per quattro giorni il filtro e' esistito
 * solo sul file, e nessuno dei quattro stati veniva scartato. L'ha attivato
 * per caso la ricostruzione del 26 alle 16:56, fatta per un altro motivo.
 *
 * I TEMPI SI CONFRONTANO IN MILLISECONDI: il registro scrive
 * "2026-10-26 07:27:48+00" e HubSpot "2026-10-26T10:48:16.950Z", e come
 * stringhe la "T" viene dopo lo spazio - confrontandole cosi' ogni cambio
 * sembra successivo all'assegnazione, cioe' "va tutto bene" per costruzione.
 */
import "./env";
import { getDb } from "../src/lib/db";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const giorni = Number(process.argv[2] || 0);

/** Gli stati che l'app non deve pescare, copiati da lead_assigner.py riga 64. */
const NON_PESCABILI = new Set(["No Show", "numero_errato", "Errore", "BIN"]);

const ora = (ms: number) => new Date(ms).toLocaleString("it-IT", { timeZone: "Europe/Rome" });

(async () => {
  const db = getDb();
  const r = await db.query<{ ms: string; nome: string; contatti: unknown; motivo: string }>(
    `SELECT (extract(epoch from chiesto_at) * 1000)::bigint::text AS ms, nome, contatti, motivo
       FROM assegnazione_richiesta
      WHERE giorno >= CURRENT_DATE - $1::int AND esito = 'assegnato'
      ORDER BY chiesto_at`, [giorni]);

  const dato = new Map<string, { ms: number; a: string; motivo: string }>();
  for (const riga of r.rows) {
    const lista: string[] = Array.isArray(riga.contatti)
      ? (riga.contatti as string[]) : JSON.parse(String(riga.contatti || "[]"));
    for (const id of lista) if (id) dato.set(String(id), { ms: Number(riga.ms), a: riga.nome, motivo: riga.motivo });
  }
  const ids = [...dato.keys()];
  console.log(`\nRichieste servite: ${r.rows.length}   contatti assegnati: ${ids.length}`);
  if (!ids.length) { console.log("Niente da controllare."); process.exit(0); }

  const alMomento = new Map<string, number>();
  const sbagliati: { id: string; nome: string; stato: string; da: number; q: { ms: number; a: string; motivo: string } }[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const b = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST", headers: H,
      body: JSON.stringify({
        properties: ["firstname", "lastname", "hs_lead_status"],
        propertiesWithHistory: ["hs_lead_status"],
        inputs: ids.slice(i, i + 50).map((id) => ({ id })),
      }),
    });
    const d = await b.json();
    if (d.status === "error") { console.log("HubSpot: " + d.message); break; }

    for (const c of d.results ?? []) {
      const q = dato.get(String(c.id))!;
      const storia = (c.propertiesWithHistory?.hs_lead_status ?? [])
        .map((v: { value: string; timestamp: string; sourceType?: string }) =>
          ({ v: v.value, t: Date.parse(v.timestamp), chi: String(v.sourceType ?? "") }))
        .sort((a: { t: number }, b2: { t: number }) => a.t - b2.t);

      // LO STATO PRIMA CHE CI METTESSE MANO L'APP, che e' l'unica cosa che
      // conta. `assign_leads_to_employee` scrive `hs_lead_status = NEW`
      // quando assegna (lead_assigner.py riga 1423): la versione in vigore
      // "al momento dell'assegnazione" e' quindi sempre quella dell'app, e
      // guardando quella ogni lead risulta NEW per costruzione.
      // Le scritture dell'app si riconoscono dalla paternita': arrivano da un
      // token di app privata, quindi INTEGRATION o API, mentre le persone
      // lasciano CRM_UI o MOBILE_*. Si risale indietro saltando i NEW
      // automatici e si prende il primo valore scritto da qualcun altro.
      const fattaDallApp = (x: { v: string; chi: string }) =>
        x.v === "NEW" && /INTEGRATION|API/i.test(x.chi);
      let prima = storia.filter((x: { t: number }) => x.t <= q.ms);
      while (prima.length && fattaDallApp(prima[prima.length - 1])) prima.pop();
      const stato = prima.length ? prima[prima.length - 1].v : "(mai toccato da una persona)";
      alMomento.set(stato, (alMomento.get(stato) ?? 0) + 1);

      if (NON_PESCABILI.has(stato))
        sbagliati.push({
          id: c.id, stato, da: prima[prima.length - 1].t, q,
          nome: `${c.properties.firstname ?? ""} ${c.properties.lastname ?? ""}`.trim(),
        });
    }
  }

  console.log("\nSTATO LEAD AL MOMENTO DELL'ASSEGNAZIONE:");
  for (const [s, n] of [...alMomento.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${s}${NON_PESCABILI.has(s) ? "   <-- NON DOVEVA ESSERE ASSEGNATO" : ""}`);

  if (!sbagliati.length) { console.log("\n>>> Nessun lead in uno stato escluso: il filtro funziona."); process.exit(0); }

  console.log(`\nI ${sbagliati.length} LEAD CHE NON DOVEVANO USCIRE:\n`);
  const perPersona = new Map<string, number>();
  for (const s of sbagliati.sort((a, b) => a.q.ms - b.q.ms)) {
    perPersona.set(s.q.a, (perPersona.get(s.q.a) ?? 0) + 1);
    console.log(`  ${s.stato.padEnd(14)} ${s.id}  ${s.nome}`);
    console.log(`     in quello stato dal ${ora(s.da)}`);
    console.log(`     assegnato il        ${ora(s.q.ms)}  a ${s.q.a}`);
  }
  console.log("\nQUANTI A TESTA:");
  for (const [chi, n] of [...perPersona.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(4)}  ${chi}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
