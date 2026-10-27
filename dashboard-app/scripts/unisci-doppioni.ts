/**
 * Unisce i doppioni che coincidono su nome, cognome e numero di telefono.
 *
 * COME SI LANCIA
 *   npx tsx scripts/unisci-doppioni.ts                      conta e basta
 *   npx tsx scripts/unisci-doppioni.ts nome --unisci        primo giro
 *   npx tsx scripts/unisci-doppioni.ts telefono --unisci    secondo giro
 *
 * DUE GIRI, NON UNO, per decisione del 23 ottobre 2026:
 *   1. "nome"     - stesso nome E stesso cognome, il numero non si guarda
 *   2. "telefono" - fra quelle rimaste, `phone` valorizzato su ENTRAMBE le
 *                   schede e uguale
 * Separarli serve a guardare il risultato del primo prima di fare il secondo:
 * se il primo giro producesse qualcosa di strano, il secondo non parte.
 *
 * Quello che non passa ne' l'uno ne' l'altro resta dov'e'. Le schede dove
 * manca un cognome o manca il numero possono essere la stessa persona, ma
 * "possono" non basta per un'operazione che non si annulla.
 *
 * IL NUMERO SI CONFRONTA A CIFRE. "+39 333 1234567" e "3331234567" sono lo
 * stesso telefono: si tengono solo le cifre e si guardano le ultime nove, che
 * in Italia identificano la linea senza il prefisso internazionale. Senza
 * questo, due terzi delle coppie vere sembrerebbero diverse.
 *
 * NON SI TORNA INDIETRO. L'unione fonde due schede in una e la seconda
 * sparisce. Sopravvive quella con l'email corretta (`id_da_tenere`);
 * l'indirizzo sbagliato non si perde, HubSpot lo sposta fra gli indirizzi
 * secondari del contatto.
 */
import "./env";
import { readFileSync, writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const CSV = "C:/Users/Angelo/Desktop/Windserf/Dashboard/fusioni-da-fare.csv";
const UNISCI = process.argv.includes("--unisci");
const GIRO = process.argv.includes("telefono") ? "telefono" : "nome";
const FATTE = `C:/Users/Angelo/Desktop/Windserf/Dashboard/fusioni-fatte-${GIRO}.csv`;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vir = (v?: string | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const norm = (v?: string | null) =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const cifre = (v?: string | null) => {
  const c = (v || "").replace(/\D/g, "");
  return c.length >= 9 ? c.slice(-9) : "";
};

function celle(r: string): string[] {
  const o: string[] = [];
  let c = "", q = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (ch === '"') { if (q && r[i + 1] === '"') { c += ch; i++; } else q = !q; }
    else if (ch === "," && !q) { o.push(c); c = ""; }
    else c += ch;
  }
  o.push(c);
  return o;
}

(async () => {
  const righe = readFileSync(CSV, "utf8").replace(/^\uFEFF/, "")
    .split(/\r?\n/).filter(Boolean).slice(1).map(celle);
  const coppie = righe.map((c) => ({ unire: c[3], tenere: c[5] }))
    .filter((x) => x.unire && x.tenere && x.unire !== x.tenere);

  // Le proprieta' si rileggono da HubSpot, non dal CSV: il file e' una
  // fotografia di mezz'ora fa e nel frattempo qualcosa puo' essere cambiato.
  const schede = new Map<string, any>();
  const ids = [...new Set(coppie.flatMap((c) => [c.unire, c.tenere]))];
  for (let i = 0; i < ids.length; i += 100) {
    await pausa(400);
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
      method: "POST", headers: H,
      body: JSON.stringify({
        properties: ["email", "firstname", "lastname", "phone"],
        inputs: ids.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    for (const c of (await r.json()).results || []) schede.set(c.id, c.properties);
  }

  // GIA' UNITE: dopo il primo giro la scheda assorbita non esiste piu', e la
  // lettura in blocco non la restituisce. Quelle righe si saltano da sole.
  const perNome: typeof coppie = [], perTelefono: typeof coppie = [], fuori: typeof coppie = [];
  const schedaDi: Record<string, any> = {};
  for (const c of coppie) {
    const a = schede.get(c.unire), b = schede.get(c.tenere);
    if (!a || !b) continue;
    schedaDi[c.unire] = a; schedaDi[c.tenere] = b;
    const nome = norm(a.firstname) && norm(a.firstname) === norm(b.firstname);
    const cognome = norm(a.lastname) && norm(a.lastname) === norm(b.lastname);
    const ta = cifre(a.phone), tb = cifre(b.phone);
    if (nome && cognome) perNome.push(c);
    else if (ta && tb && ta === tb) perTelefono.push(c);
    else fuori.push(c);
  }

  console.log(`\ncoppie ancora aperte nel file   ${perNome.length + perTelefono.length + fuori.length}`);
  console.log(`  1. nome e cognome uguali      ${perNome.length}`);
  console.log(`  2. poi, telefono uguale       ${perTelefono.length}`);
  console.log(`     restano fuori              ${fuori.length}`);
  console.log(`\ngiro scelto: ${GIRO}`);

  const ammesse = (GIRO === "nome" ? perNome : perTelefono)
    .map((c) => ({ ...c, a: schedaDi[c.unire], b: schedaDi[c.tenere] }));

  if (!UNISCI) { console.log("\n(prova: non ho unito niente. Per unire davvero: --unisci)"); process.exit(0); }

  const fatte = ["email_unita,id_unito,email_tenuta,id_tenuto,nome,cognome,telefono,esito"];
  let ok = 0, ko = 0;
  for (const [i, c] of ammesse.entries()) {
    await pausa(350);
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/merge", {
      method: "POST", headers: H,
      body: JSON.stringify({ primaryObjectId: c.tenere, objectIdToMerge: c.unire })
    });
    const esito = r.ok ? "unita" : `ERRORE ${r.status}: ${(await r.text()).replace(/"/g, "'").slice(0, 120)}`;
    if (r.ok) ok++; else ko++;
    fatte.push([vir(c.a.email), c.unire, vir(c.b.email), c.tenere,
      vir(c.b.firstname), vir(c.b.lastname), vir(c.b.phone), vir(esito)].join(","));
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1} / ${ammesse.length}`);
  }
  writeFileSync(FATTE, "\uFEFF" + fatte.join("\r\n"), "utf8");
  console.log(`\nUNITE   ${ok}`);
  if (ko) console.log(`FALLITE ${ko}`);
  console.log(`registro: ${FATTE}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
