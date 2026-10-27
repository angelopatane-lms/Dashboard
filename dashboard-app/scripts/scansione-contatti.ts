/**
 * Una lettura sola del portale, tre risposte.
 *
 * COME SI LANCIA
 *   npx tsx scripts/scansione-contatti.ts
 *
 * COSA PRODUCE
 *   duplicati-contatti.csv   doppioni per nome + cognome + numero
 *   email-da-correggere.csv  i domini scritti male, con il gemello giusto se esiste
 *   e a schermo il conteggio dei domini
 *
 * PERCHE' SI LEGGE TUTTO. HubSpot non sa raggruppare: non esiste un modo di
 * chiedergli "quali valori si ripetono". E la ricerca per dominio con il
 * carattere jolly non e' affidabile - il 23 ottobre 2026 `*@gmail.com` ha
 * risposto UN contatto su mezzo milione, mentre `*@gmail.it` ne dava 1.379.
 * Un meccanismo che sbaglia cosi' sul dominio piu' comune non si puo' usare
 * per decidere cosa riscrivere. Le 5.700 pagine da cento invece sono dati
 * grezzi, senza interpretazioni di mezzo.
 *
 * COSA CONTA COME STESSO NUMERO. I numeri sono scritti in dieci modi diversi:
 * "+39 333 1234567", "3331234567", "0039333.1234567". Si tengono solo le cifre
 * e si guardano le ultime nove, che in Italia identificano la linea senza il
 * prefisso. Si guardano sia `phone` sia `mobilephone`, perche' lo stesso
 * cellulare a volte sta nell'uno e a volte nell'altro.
 *
 * NON SCRIVE NIENTE. Produce file e basta: la correzione delle email e'
 * un'altra cosa, e si decide guardando questi elenchi.
 */
import "./env";
import { writeFileSync } from "fs";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const CARTELLA = "C:\\Users\\Angelo\\Desktop\\Windserf\\Dashboard\\";
const CAMPI = ["firstname", "lastname", "phone", "mobilephone", "email", "createdate"];

/**
 * I DOMINI SBAGLIATI E LA LORO FORMA GIUSTA.
 * gmail.it non esiste: il dominio italiano non e' mai stato di Google. Gli
 * altri sono errori di battitura visti nei duplicati di HubSpot.
 */
const SBAGLIATI: Record<string, string> = {
  "gmail.it": "gmail.com",
  "gmsil.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.con": "gmail.com",
  "hotnail.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "libero.ir": "libero.it",
  "libero.ti": "libero.it",
  "virgilo.it": "virgilio.it",
  "virgilio.ti": "virgilio.it",
  "yaho.it": "yahoo.it",
  "icloud.con": "icloud.com"
};

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

const numero = (v?: string | null) => {
  const c = (v || "").replace(/\D/g, "");
  return c.length >= 9 ? c.slice(-9) : "";
};

const testo = (v?: string | null) =>
  (v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const vir = (v?: string | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;

type Riga = { nome: string; cognome: string; tel: string; cell: string; email: string; creato: string; id: string };

(async () => {
  const gruppi = new Map<string, Riga[]>();
  const perDominio = new Map<string, number>();
  const tutteLeEmail = new Set<string>();
  const daCorreggere: Riga[] = [];
  let dopo: string | undefined;
  let letti = 0, pagine = 0, senzaChiave = 0;
  const inizio = Date.now();

  for (;;) {
    const u = new URL("https://api.hubapi.com/crm/v3/objects/contacts");
    u.searchParams.set("limit", "100");
    u.searchParams.set("properties", CAMPI.join(","));
    if (dopo) u.searchParams.set("after", dopo);

    let d: any;
    for (let t = 0; ; t++) {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (r.status === 429) { await pausa(2000 + t * 1000); continue; }
      if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`);
      d = await r.json();
      break;
    }

    for (const c of d.results || []) {
      const p = c.properties || {};
      const riga: Riga = {
        nome: p.firstname || "", cognome: p.lastname || "",
        tel: p.phone || "", cell: p.mobilephone || "",
        email: (p.email || "").trim().toLowerCase(),
        creato: (p.createdate || "").slice(0, 10), id: c.id
      };

      if (riga.email) {
        tutteLeEmail.add(riga.email);
        const dom = riga.email.split("@")[1] || "";
        perDominio.set(dom, (perDominio.get(dom) || 0) + 1);
        if (SBAGLIATI[dom]) daCorreggere.push(riga);
      }

      const nome = testo(riga.nome), cognome = testo(riga.cognome);
      const numeri = [...new Set([numero(riga.tel), numero(riga.cell)])].filter(Boolean);
      if (!nome || !cognome || !numeri.length) { senzaChiave++; }
      else for (const n of numeri) {
        const k = `${nome}|${cognome}|${n}`;
        const g = gruppi.get(k);
        if (g) g.push(riga); else gruppi.set(k, [riga]);
      }
    }

    letti += (d.results || []).length;
    if (++pagine % 200 === 0)
      console.log(`  ${letti} contatti in ${((Date.now() - inizio) / 60000).toFixed(1)} minuti`);

    dopo = d.paging?.next?.after;
    if (!dopo) break;
    await pausa(110);
  }

  // --- doppioni per nome + numero ---------------------------------------
  // Chi ha due numeri entra in due gruppi: dentro il gruppo si tiene una riga
  // sola per contatto, altrimenti sembrerebbe doppio da solo.
  const doppi = [...gruppi.values()]
    .map((r) => r.filter((x, i) => r.findIndex((y) => y.id === x.id) === i))
    .filter((r) => r.length > 1)
    .sort((a, b) => b.length - a.length);

  const f1 = ["gruppo,nel_gruppo,nome,cognome,telefono,cellulare,email,data_creazione,id_hubspot"];
  doppi.forEach((persone, i) => {
    persone.sort((a, b) => a.creato.localeCompare(b.creato));
    for (const p of persone)
      f1.push([i + 1, persone.length, vir(p.nome), vir(p.cognome), vir(p.tel), vir(p.cell),
        vir(p.email), p.creato, p.id].join(","));
  });
  writeFileSync(CARTELLA + "duplicati-contatti.csv", "\uFEFF" + f1.join("\r\n"), "utf8");

  // --- email con dominio sbagliato --------------------------------------
  // IL GEMELLO GIA' ESISTENTE e' il caso che conta: su HubSpot l'email e'
  // unica, quindi riscrivere fallirebbe. Quelli non si correggono, si uniscono.
  const f2 = ["email_attuale,email_corretta,gemello_esiste,nome,cognome,telefono,data_creazione,id_hubspot"];
  let liberi = 0, scontri = 0;
  for (const r of daCorreggere) {
    const dom = r.email.split("@")[1];
    const nuova = r.email.slice(0, -dom.length) + SBAGLIATI[dom];
    const esiste = tutteLeEmail.has(nuova);
    if (esiste) scontri++; else liberi++;
    f2.push([vir(r.email), vir(nuova), esiste ? "SI" : "no", vir(r.nome), vir(r.cognome),
      vir(r.tel), r.creato, r.id].join(","));
  }
  writeFileSync(CARTELLA + "email-da-correggere.csv", "\uFEFF" + f2.join("\r\n"), "utf8");

  // --- a schermo --------------------------------------------------------
  console.log(`\nLETTI ${letti} contatti in ${((Date.now() - inizio) / 60000).toFixed(1)} minuti`);
  console.log(`senza nome o numero: ${senzaChiave} (fuori dal confronto sui doppioni)`);

  console.log(`\nDOPPIONI per nome + cognome + numero`);
  const coinvolti = doppi.reduce((s, r) => s + r.length, 0);
  console.log(`  gruppi             ${doppi.length}`);
  console.log(`  contatti coinvolti ${coinvolti}`);
  console.log(`  da unire           ${coinvolti - doppi.length} (uno per gruppo resta)`);

  console.log(`\nEMAIL CON DOMINIO SBAGLIATO`);
  const perDom = new Map<string, number>();
  for (const r of daCorreggere) {
    const d2 = r.email.split("@")[1];
    perDom.set(d2, (perDom.get(d2) || 0) + 1);
  }
  for (const [d2, n] of [...perDom].sort((a, b) => b[1] - a[1]))
    console.log(`  ${d2.padEnd(16)} ${String(n).padStart(6)}  ->  ${SBAGLIATI[d2]}`);
  console.log(`  ${"".padEnd(16)} ${"".padStart(6)}`);
  console.log(`  si possono riscrivere   ${liberi}`);
  console.log(`  hanno gia' il gemello   ${scontri}  <- da unire, non da riscrivere`);

  console.log(`\nI DOMINI PIU' USATI (i primi 12, per riferimento)`);
  for (const [d2, n] of [...perDominio].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`  ${d2.padEnd(24)} ${String(n).padStart(7)}`);

  console.log(`\nfile scritti in ${CARTELLA}`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
