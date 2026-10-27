/**
 * Chi genera i lead che finiscono in BIN o con il numero sbagliato.
 *
 * COME SI LANCIA
 *   npx tsx scripts/chi-genera-scarti.ts        ultimi 30 giorni
 *   npx tsx scripts/chi-genera-scarti.ts 14
 *
 * PERCHE'. Misurato il 27 ottobre 2026: dei 4.188 lead assegnati in trenta
 * giorni, 678 sono finiti in BIN e 283 in numero errato - 961 schede, il 23%,
 * inchiamabili. E gli appuntamenti fissati sono stati 72 in tutto. Spostare il
 * mix fra serie A e serie B non cambia niente (1,9% contro 1,7% di buon
 * esito): il margine sta in chi produce quel 23%.
 *
 * I DUE SCARTI SI CONTANO SEPARATI, perche' dicono cose diverse:
 *   - `numero_errato` e' un difetto del dato raccolto: modulo, sorgente,
 *     validazione del telefono. Si corregge a monte e non dipende da chi chiama;
 *   - `BIN` e' un giudizio di chi ha chiamato: persona non interessata, fuori
 *     target, o gia' lavorata. Si corregge sul targeting.
 * Sommarli nasconderebbe quale dei due problemi si ha.
 *
 * ATTENZIONE: lo stato si legge ADESSO. Un lead ancora NEW o NOT_ANSWERED non
 * e' ne' buono ne' scarto - e' lavoro in corso, e sta nella colonna a parte.
 * Le percentuali di scarto sono quindi un MINIMO: alcuni in corso diventeranno
 * scarti.
 */
import "./env";
import { getDb } from "../src/lib/db";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const giorni = Number(process.argv[2] || 30);

const BUONI = new Set(["Appuntamento fissato", "in Trattative", "Cliente"]);
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Conta = { tot: number; bin: number; numero: number; altriScarti: number; buoni: number };
const vuota = (): Conta => ({ tot: 0, bin: 0, numero: 0, altriScarti: 0, buoni: 0 });

(async () => {
  const db = getDb();
  const r = await db.query<{ contatti: unknown }>(
    `SELECT contatti FROM assegnazione_richiesta
      WHERE giorno >= CURRENT_DATE - $1::int AND esito = 'assegnato' AND contatti IS NOT NULL`,
    [giorni]);

  const ids = new Set<string>();
  for (const riga of r.rows) {
    const lista: string[] = Array.isArray(riga.contatti)
      ? (riga.contatti as string[]).map(String)
      : JSON.parse(String(riga.contatti || "[]")).map(String);
    for (const id of lista) if (id) ids.add(id);
  }
  console.log(`\nLead assegnati negli ultimi ${giorni} giorni: ${ids.size}`);

  const perCampagna = new Map<string, Conta>();
  const perOrigine = new Map<string, Conta>();
  const elenco = [...ids];

  for (let i = 0; i < elenco.length; i += 100) {
    for (let t = 0; t < 6; t++) {
      const b = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/batch/read", {
        method: "POST", headers: H,
        body: JSON.stringify({
          properties: ["hs_lead_status", "id_campagna_refresh", "referral"],
          inputs: elenco.slice(i, i + 100).map((id) => ({ id })),
        }),
      });
      if (b.status === 429) { await pausa(4000); continue; }
      const d = await b.json();
      for (const c of d.results ?? []) {
        const stato = (c.properties.hs_lead_status || "").trim();
        const campagna = c.properties.id_campagna_refresh || "(senza campagna)";
        const origine = c.properties.referral || "(senza origine)";
        for (const [m, k] of [[perCampagna, campagna], [perOrigine, origine]] as const) {
          if (!m.has(k)) m.set(k, vuota());
          const x = m.get(k)!;
          x.tot++;
          if (stato === "BIN") x.bin++;
          else if (stato === "numero_errato") x.numero++;
          else if (stato === "No Show" || stato === "Errore") x.altriScarti++;
          else if (BUONI.has(stato)) x.buoni++;
        }
      }
      break;
    }
    await pausa(150);
  }

  const tabella = (titolo: string, m: Map<string, Conta>, minimo: number) => {
    console.log(`\n${"=".repeat(96)}\n${titolo}\n${"=".repeat(96)}`);
    console.log("  assegnati     BIN   num.errato   scarto tot.   buoni   nome");
    const righe = [...m.entries()].filter(([, v]) => v.tot >= minimo)
      .sort((a, b) => (b[1].bin + b[1].numero) - (a[1].bin + a[1].numero));
    for (const [k, v] of righe) {
      const scarto = v.bin + v.numero + v.altriScarti;
      const pc = (n: number) => `${(n / v.tot * 100).toFixed(0)}%`.padStart(4);
      console.log(`  ${String(v.tot).padStart(9)}   ${String(v.bin).padStart(5)} ${pc(v.bin)}  ${String(v.numero).padStart(4)} ${pc(v.numero)}   ${String(scarto).padStart(5)} ${pc(scarto)}   ${String(v.buoni).padStart(5)}   ${k}`);
    }
    const esclusi = [...m.values()].filter((v) => v.tot < minimo);
    if (esclusi.length)
      console.log(`  (altre ${esclusi.length} voci sotto ${minimo} lead, ${esclusi.reduce((s, v) => s + v.bin + v.numero, 0)} scarti in tutto)`);
  };

  tabella("PER CAMPAGNA (almeno 20 lead assegnati)", perCampagna, 20);
  tabella("PER ORIGINE (almeno 20 lead assegnati)", perOrigine, 20);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
