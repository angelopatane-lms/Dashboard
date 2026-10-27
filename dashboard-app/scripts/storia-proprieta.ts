/**
 * La cronologia delle modifiche di un contatto, con chi le ha scritte.
 *
 * COME SI LANCIA
 *   npx tsx scripts/storia-proprieta.ts 818515670241
 *   npx tsx scripts/storia-proprieta.ts 818515670241 2606122 --da 2026-10-26
 *   npx tsx scripts/storia-proprieta.ts --unioni          i contatti fusi dal codice nuovo
 *
 * A COSA SERVE. Quando un workflow tocca un contatto, le proprieta' cambiano a
 * raffica e dal CRM si vede solo il valore finale: non si vede se e' stato il
 * modulo, un'azione di codice, una proprieta' calcolata o la fusione. Qui si
 * vede, perche' ogni versione porta la sua paternita'.
 *
 * PERCHE' L'API VECCHIA. `/crm/v3/objects/contacts/{id}?propertiesWithHistory=`
 * vuole l'elenco delle proprieta' una per una, e qui non si sa in anticipo
 * quali il flusso abbia scritto - e' proprio la domanda. La v1
 * `contact/vid/{id}/profile?propertyMode=value_and_history` le restituisce
 * TUTTE con lo storico, e in piu' dice `source-type` e `source-id`, dove per i
 * workflow c'e' l'enrollmentId. HubSpot la tiene in vita e risponde 200 col
 * token dell'app privata.
 *
 * COME SI LEGGE LA PATERNITA'
 *   AUTOMATION_PLATFORM  un'azione di workflow (l'enrollmentId dice quale giro)
 *   API                  una chiamata esterna: le azioni di codice personalizzato
 *                        compaiono cosi', non come AUTOMATION_PLATFORM
 *   MERGE_OBJECTS        il valore arriva dalla scheda assorbita in una fusione
 *   FORM / CALCULATED / ANALYTICS / EMAIL / INTEGRATION   HubSpot da se'
 *
 * UN AVVERTIMENTO. Un'azione che non scrive niente non lascia traccia qui: se
 * il codice di unione decide "nessun doppione", sul contatto non si vede
 * nulla, e l'unico posto dove guardare e' la cronologia dell'azione nel
 * workflow. L'assenza di righe non vuol dire che l'azione non e' girata.
 */
import "./env";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const argomenti = process.argv.slice(2);
const ids = argomenti.filter((a) => /^\d+$/.test(a));

/** Da quando guardare. Senza `--da`, da mezzanotte di oggi, ora italiana. */
const daQuando = (() => {
  const i = argomenti.indexOf("--da");
  if (i >= 0 && argomenti[i + 1]) return new Date(`${argomenti[i + 1]}T00:00:00+01:00`).getTime();
  const oggi = new Date();
  return new Date(`${oggi.toISOString().slice(0, 10)}T00:00:00+01:00`).getTime();
})();

const ora = (t: number) => new Date(t).toISOString().slice(11, 19);

/**
 * I contatti passati dal codice nuovo di unione: quelli con la fotografia
 * delle iscrizioni scritta al momento della fusione. Prima del 26 ottobre 2026
 * non ne esiste nessuno, quindi questo elenco e' esattamente l'elenco delle
 * fusioni fatte dal codice nuovo.
 */
async function contattiFusi(): Promise<string[]> {
  const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST", headers: H,
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "unione_flussi_prima", operator: "HAS_PROPERTY" }] }],
      properties: ["firstname", "lastname", "unione_flussi_prima", "unione_data"],
      // Sui contatti la proprieta' per ordinare e' `lastmodifieddate`:
      // `hs_lastmodifieddate` viene ignorata in silenzio e si ottiene una
      // fetta casuale dei risultati invece dei piu' recenti.
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
    }),
  });
  const d = await r.json();
  console.log(`\nFUSIONI PASSATE DAL CODICE NUOVO: ${d.total ?? 0}`);
  for (const c of d.results ?? []) {
    const q = c.properties;
    console.log(`\n=== ${c.id}  ${q.firstname ?? ""} ${q.lastname ?? ""} ===`);
    console.log(`Data ultima unione: ${q.unione_data || "(vuota: giusto, il flusso 1423923152 la cancella al primo passo)"}`);
    for (const riga of String(q.unione_flussi_prima).split("\n")) console.log(`  ${riga}`);
  }
  return (d.results ?? []).map((c: { id: string }) => String(c.id));
}

async function storia(id: string) {
  const r = await fetch(
    `https://api.hubapi.com/contacts/v1/contact/vid/${id}/profile?propertyMode=value_and_history`,
    { headers: H });
  if (r.status !== 200) {
    console.log(`\n${id}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return;
  }
  const j = await r.json();
  const nome = `${j.properties?.firstname?.value ?? ""} ${j.properties?.lastname?.value ?? ""}`.trim();

  type Riga = { t: number; nome: string; val: string; tipo: string; fonte: string };
  const righe: Riga[] = [];
  for (const [prop, p] of Object.entries<{ versions?: Record<string, unknown>[] }>(j.properties ?? {})) {
    for (const v of p.versions ?? []) {
      const t = Number(v.timestamp);
      if (t < daQuando) continue;
      righe.push({
        t, nome: prop,
        val: String(v.value ?? "").slice(0, 46),
        tipo: String(v["source-type"] ?? ""),
        fonte: String(v["source-id"] ?? "").slice(0, 52),
      });
    }
  }
  righe.sort((a, b) => a.t - b.t);

  console.log(`\n--- ${id}  ${nome}: ${righe.length} modifiche dal ${new Date(daQuando).toISOString().slice(0, 10)} ---`);
  for (const x of righe) {
    // `lastmodifieddate` cambia a ogni scrittura e raddoppia ogni riga senza
    // aggiungere niente: si tiene fuori per poter leggere il resto.
    if (x.nome === "lastmodifieddate") continue;
    console.log(`  ${ora(x.t)}  ${x.nome.padEnd(36)} = ${x.val.padEnd(46)}  [${x.tipo}${x.fonte ? " " + x.fonte : ""}]`);
  }
  const interessanti = righe.filter((x) => x.tipo === "MERGE_OBJECTS");
  if (interessanti.length)
    console.log(`  >>> ${interessanti.length} valori arrivati dalla scheda assorbita (MERGE_OBJECTS)`);
}

(async () => {
  const daGuardare = argomenti.includes("--unioni") ? [...(await contattiFusi()), ...ids] : ids;
  if (!daGuardare.length) {
    console.log("Nessun id. Uso: npx tsx scripts/storia-proprieta.ts <id> [...] [--da 2026-10-26] [--unioni]");
    process.exit(0);
  }
  for (const id of daGuardare) await storia(id);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
