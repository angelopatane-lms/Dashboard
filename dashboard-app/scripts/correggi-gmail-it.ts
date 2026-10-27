/**
 * Il dominio gmail.it non esiste: si riscrive in gmail.com.
 *
 * COME SI LANCIA
 *   npx tsx scripts/correggi-gmail-it.ts            guarda e basta
 *   npx tsx scripts/correggi-gmail-it.ts --scrivi   riscrive davvero
 *
 * PERCHE'. gmail.it non e' mai stato di Google: la posta mandata a quegli
 * indirizzi non arriva a nessuno. Il 23 ottobre 2026 erano 1.379 contatti.
 *
 * NON SI RISCRIVONO TUTTI, ED E' IL PUNTO. Su HubSpot l'email e' unica. Per
 * 564 di quei 1.379 il gemello con @gmail.com ESISTE GIA' su un altro
 * contatto: riscrivere fallirebbe, e comunque sarebbe la cosa sbagliata. Non
 * sono errori di battitura, sono la stessa persona due volte - vanno UNITI.
 * Quelli finiscono in un CSV, perche' l'unione cancella un record e non si
 * torna indietro: la decide una persona, non questo script.
 *
 * SI RISCRIVE SOLO LA CODA. Di `mario.rossi@gmail.it` si cambia quello che sta
 * dopo la chiocciola e basta. Su HubSpot non esiste un campo "dominio"
 * scrivibile - `hs_email_domain` c'e' ma e' calcolato e in sola lettura -
 * quindi si rimanda il valore intero.
 *
 * RESTA TRACCIA. HubSpot conserva la cronologia della proprieta' email, quindi
 * ogni cambio e' visibile sulla scheda del contatto e reversibile a mano.
 */
import "./env";
import { writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const USCITA = "C:\\Users\\Angelo\\Desktop\\Windserf\\Dashboard\\fusioni-da-fare.csv";
const SCRIVI = process.argv.includes("--scrivi");
const PROPS = ["email", "firstname", "lastname", "phone", "mobilephone", "createdate", "hs_lead_status"];

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const vir = (v?: string | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function hs(percorso: string, metodo: string, corpo?: any): Promise<any> {
  for (let i = 0; i < 8; i++) {
    await pausa(350);
    const r = await fetch("https://api.hubapi.com" + percorso,
      { method: metodo, headers: H, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
    if (r.status === 429) { await pausa(3000); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : {};
  }
  throw new Error("429 ripetuti");
}

type C = { id: string; email: string; nome: string; cognome: string; tel: string; creato: string; stato: string };
const leggi = (c: any): C => ({
  id: c.id,
  email: (c.properties.email || "").trim().toLowerCase(),
  nome: c.properties.firstname || "", cognome: c.properties.lastname || "",
  tel: c.properties.phone || c.properties.mobilephone || "",
  creato: (c.properties.createdate || "").slice(0, 10),
  stato: c.properties.hs_lead_status || ""
});

(async () => {
  // 1. I contatti con il dominio sbagliato
  const sbagliati: C[] = [];
  let dopo: string | undefined;
  do {
    const d = await hs("/crm/v3/objects/contacts/search", "POST", {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "CONTAINS_TOKEN", value: "*@gmail.it" }] }],
      properties: PROPS, sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      limit: 100, ...(dopo ? { after: dopo } : {})
    });
    sbagliati.push(...(d.results || []).map(leggi));
    dopo = d.paging?.next?.after;
  } while (dopo);
  console.log(`\ncontatti @gmail.it: ${sbagliati.length}`);

  // 2. Chi ha gia' il gemello: si chiede a blocchi di cento, non uno per uno
  const corretta = (e: string) => e.replace(/@gmail\.it$/i, "@gmail.com");
  const gemelli = new Map<string, C>();
  const bersagli = [...new Set(sbagliati.map((c) => corretta(c.email)))];
  for (let i = 0; i < bersagli.length; i += 100) {
    const d = await hs("/crm/v3/objects/contacts/search", "POST", {
      filterGroups: [{ filters: [{ propertyName: "email", operator: "IN", values: bersagli.slice(i, i + 100) }] }],
      properties: PROPS, limit: 100
    });
    for (const r of d.results || []) { const c = leggi(r); gemelli.set(c.email, c); }
  }

  // 3. Si separa chi si puo' riscrivere da chi va unito.
  //    LO SCONTRO INTERNO esiste: due righe @gmail.it che puntano allo stesso
  //    indirizzo corretto. Si riscrive la piu' vecchia, l'altra va unita.
  const daUnire: { vecchio: C; gemello: C }[] = [];
  const daRiscrivere: C[] = [];
  const presi = new Set<string>();
  for (const c of [...sbagliati].sort((a, b) => a.creato.localeCompare(b.creato))) {
    const nuova = corretta(c.email);
    const g = gemelli.get(nuova);
    if (g) { daUnire.push({ vecchio: c, gemello: g }); continue; }
    if (presi.has(nuova)) {
      const primo = daRiscrivere.find((x) => corretta(x.email) === nuova)!;
      daUnire.push({ vecchio: c, gemello: primo });
      continue;
    }
    presi.add(nuova);
    daRiscrivere.push(c);
  }
  console.log(`  da riscrivere ${daRiscrivere.length}`);
  console.log(`  da unire      ${daUnire.length}`);

  // 4. Il CSV delle unioni: due id affiancati, cosi' si decide chi tenere
  const righe = ["email_sbagliata,id_da_unire,email_corretta,id_da_tenere,nome,cognome,telefono,creato_sbagliato,creato_corretto,stato_lead"];
  for (const { vecchio, gemello } of daUnire)
    righe.push([vir(vecchio.email), vecchio.id, vir(gemello.email), gemello.id,
      vir(gemello.nome || vecchio.nome), vir(gemello.cognome || vecchio.cognome),
      vir(gemello.tel || vecchio.tel), vecchio.creato, gemello.creato, vir(vecchio.stato)].join(","));
  writeFileSync(USCITA, "\uFEFF" + righe.join("\r\n"), "utf8");
  console.log(`\nlista unioni: ${USCITA}`);

  if (!SCRIVI) { console.log("\n(prova: non ho scritto niente. Per riscrivere davvero: --scrivi)"); process.exit(0); }

  // 5. La riscrittura, a blocchi di cento. Se un blocco viene rifiutato si
  //    riprova uno per uno, per sapere QUALE ha dato problemi invece di
  //    perdere tutto il blocco.
  let fatti = 0; const falliti: string[] = [];
  for (let i = 0; i < daRiscrivere.length; i += 100) {
    const blocco = daRiscrivere.slice(i, i + 100);
    const inputs = blocco.map((c) => ({ id: c.id, properties: { email: corretta(c.email) } }));
    try {
      await hs("/crm/v3/objects/contacts/batch/update", "POST", { inputs });
      fatti += blocco.length;
    } catch {
      for (const c of blocco) {
        try {
          await hs(`/crm/v3/objects/contacts/${c.id}`, "PATCH", { properties: { email: corretta(c.email) } });
          fatti++;
        } catch (e) { falliti.push(`${c.email} (${c.id}): ${e instanceof Error ? e.message.slice(0, 90) : e}`); }
      }
    }
    console.log(`  ${Math.min(i + 100, daRiscrivere.length)} / ${daRiscrivere.length}`);
  }
  console.log(`\nRISCRITTI ${fatti}`);
  if (falliti.length) {
    console.log(`FALLITI   ${falliti.length}`);
    for (const f of falliti.slice(0, 15)) console.log("   " + f);
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
