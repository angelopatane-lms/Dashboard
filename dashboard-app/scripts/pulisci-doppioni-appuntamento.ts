/**
 * TOGLIE I DOPPIONI DI UN APPUNTAMENTO: le riunioni ripetute sulla stessa
 * fascia e la trattativa nata due volte.
 *
 * SENZA --esegui NON TOCCA NIENTE: stampa quello che farebbe. E' una
 * cancellazione, e una cancellazione fatta per sbaglio non si discute, si
 * subisce.
 *
 * L'ORDINE NON E' CASUALE. Prima si sposta il legame con la riunione buona
 * sulla trattativa che resta, poi si cancella l'altra: fatto al contrario, il
 * legame morirebbe con l'oggetto e la trattativa superstite resterebbe senza
 * appuntamento, che e' proprio l'informazione che si vuole tenere.
 *
 *   npx tsx scripts/pulisci-doppioni-appuntamento.ts
 *   npx tsx scripts/pulisci-doppioni-appuntamento.ts --esegui
 */
import "./env";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const esegui = process.argv.includes("--esegui");

/** La trattativa che resta: quella lavorata, con l'esito scritto dall'advisor. */
const TRATTATIVA_BUONA = "541295604943";
/** La trattativa nata due volte dallo stesso workflow, mai lavorata. */
const TRATTATIVA_DA_TOGLIERE = "541454438593";
/** La riunione buona: quella della nostra pagina Prenotazione Advisor. */
const RIUNIONE_BUONA = "544146683086";
/** Le prenotazioni ripetute dal link, tutte sulla stessa fascia. */
const RIUNIONI_DA_TOGLIERE = ["544270803152", "544252958953", "544197736656", "544130354425"];

async function chiama(metodo: string, percorso: string) {
  const res = await fetch(`${API}${percorso}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  });
  if (res.status === 204 || res.ok) return { ok: true, stato: res.status };
  const testo = await res.text();
  return { ok: false, stato: res.status, testo: testo.slice(0, 200) };
}

(async () => {
  console.log(esegui ? "\n== ESECUZIONE ==\n" : "\n== PROVA A VUOTO (serve --esegui per toccare qualcosa) ==\n");

  console.log(`1. attacco la riunione ${RIUNIONE_BUONA} alla trattativa ${TRATTATIVA_BUONA}`);
  if (esegui) {
    const r = await chiama(
      "PUT",
      `/crm/v4/objects/meetings/${RIUNIONE_BUONA}/associations/default/deals/${TRATTATIVA_BUONA}`
    );
    console.log(`   -> ${r.ok ? "fatto" : "FALLITO " + r.stato + " " + r.testo}`);
    if (!r.ok) process.exit(1);
  }

  console.log(`2. cancello la trattativa ${TRATTATIVA_DA_TOGLIERE} (ferma a Da Svolgere)`);
  if (esegui) {
    const r = await chiama("DELETE", `/crm/v3/objects/deals/${TRATTATIVA_DA_TOGLIERE}`);
    console.log(`   -> ${r.ok ? "nel cestino" : "FALLITO " + r.stato + " " + r.testo}`);
    if (!r.ok) process.exit(1);
  }

  console.log(`3. cancello le ${RIUNIONI_DA_TOGLIERE.length} riunioni ripetute`);
  for (const id of RIUNIONI_DA_TOGLIERE) {
    if (!esegui) {
      console.log(`   ${id}`);
      continue;
    }
    const r = await chiama("DELETE", `/crm/v3/objects/meetings/${id}`);
    console.log(`   ${id} -> ${r.ok ? "nel cestino" : "FALLITO " + r.stato + " " + r.testo}`);
  }

  if (!esegui) {
    console.log("\nniente e' stato toccato.");
    process.exit(0);
  }

  // SI VERIFICA SUBITO, non si da' per buono quello che l'API ha risposto.
  console.log("\n== COM'E' RIMASTO ==");
  for (const id of [TRATTATIVA_BUONA, TRATTATIVA_DA_TOGLIERE]) {
    const res = await fetch(`${API}/crm/v3/objects/deals/${id}?properties=dealname,id_fase&associations=meetings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.log(`  trattativa ${id}: non piu' leggibile (${res.status}) - cancellata`);
      continue;
    }
    const d = await res.json();
    const m = (d.associations?.meetings?.results ?? []).map((x: { id: string }) => x.id);
    console.log(`  trattativa ${id}: fase ${d.properties?.id_fase ?? "-"} | riunioni ${m.length ? m.join(", ") : "nessuna"}`);
  }
  for (const id of [RIUNIONE_BUONA, ...RIUNIONI_DA_TOGLIERE]) {
    const res = await fetch(`${API}/crm/v3/objects/meetings/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`  riunione ${id}: ${res.ok ? "c'e' ancora" : "cancellata"}`);
  }
  process.exit(0);
})();
