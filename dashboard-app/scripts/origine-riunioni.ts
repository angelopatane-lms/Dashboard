// SOLA LETTURA: da quale canale nascono le riunioni, e chi ha procurato un
// contatto. Serve a distinguere una prenotazione vera da una copia che rientra
// da Google Calendar.
//
//   npx tsx scripts/origine-riunioni.ts 2026-11-01 2026-11-14 914937468118
import "./env";
import { getDb } from "../src/lib/db";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const da = process.argv[2] ?? "2026-11-01";
const a = process.argv[3] ?? "2026-11-14";
const contatto = process.argv[4] ?? "";

const istanteRoma = (g: string) => {
  const presunto = Date.parse(`${g}T00:00:00Z`);
  const letto = Date.parse(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date(presunto)).replace(" ", "T") + "Z"
  );
  return presunto + (presunto - letto);
};

(async () => {
  const dalle = istanteRoma(da);
  const alle = istanteRoma(a) + 86400000;

  const conta = new Map<string, number>();
  let after: string | undefined;
  let totale = 0;
  do {
    const res = await fetch(`${API}/crm/v3/objects/meetings/search`, {
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
        properties: ["hs_object_source", "hs_object_source_label", "hs_meeting_source", "hs_meeting_source_id"],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    const d = await res.json();
    for (const m of d.results ?? []) {
      const p = m.properties ?? {};
      const k = `${p.hs_object_source_label ?? p.hs_object_source ?? "?"} | ${p.hs_meeting_source ?? "-"} ${p.hs_meeting_source_id ?? ""}`;
      conta.set(k, (conta.get(k) ?? 0) + 1);
      totale += 1;
    }
    after = d.paging?.next?.after;
  } while (after);

  console.log(`\nORIGINI delle ${totale} riunioni dal ${da} al ${a}:`);
  for (const [k, n] of [...conta.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  if (!contatto) process.exit(0);

  // CHI HA PROCURATO IL CONTATTO: il setter sta sulla trattativa, non sul
  // contatto, e il nome si legge dalla tabella dei proprietari.
  const db = getDb();
  const { rows } = await db.query<{
    deal_id: string; creata: Date | null; svolta: Date | null; fase: string | null;
    setter: string | null; advisor: string | null; campagna: string | null; prodotto: string | null;
  }>(
    `SELECT t.deal_id::text AS deal_id, t.creata_ts AS creata, t.svolta_ts AS svolta, t.fase,
            s.nome AS setter, p.nome AS advisor, t.campagna, t.prodotto
       FROM trattativa t
       LEFT JOIN proprietario s ON s.id = t.setter_id
       LEFT JOIN proprietario p ON p.id = t.proprietario_id
      WHERE t.contact_id = $1::bigint
      ORDER BY t.creata_ts DESC
      LIMIT 20`,
    [contatto]
  );
  console.log(`\nTRATTATIVE del contatto ${contatto}: ${rows.length}`);
  for (const r of rows) {
    const q = (d: Date | null) => (d ? d.toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : "-");
    console.log(`  deal ${r.deal_id} | creata ${q(r.creata)} | svolta ${q(r.svolta)}`);
    console.log(`       setter: ${r.setter ?? "(nessuno)"} | advisor: ${r.advisor ?? "(nessuno)"}`);
    console.log(`       fase: ${r.fase ?? "-"} | campagna: ${r.campagna ?? "-"} | prodotto: ${r.prodotto ?? "-"}`);
  }

  const res = await fetch(
    `${API}/crm/v3/objects/contacts/${contatto}?properties=firstname,lastname,email,createdate,hubspot_owner_id,hs_lead_status,data_e_ora_appuntamento`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const c = await res.json();
  const cp = c.properties ?? {};
  console.log(`\nCONTATTO ${cp.firstname ?? ""} ${cp.lastname ?? ""} <${cp.email ?? "-"}>`);
  console.log(`  creato ${cp.createdate} | proprietario ${cp.hubspot_owner_id ?? "-"} | stato ${cp.hs_lead_status ?? "-"}`);
  console.log(`  appuntamento sul contatto: ${cp.data_e_ora_appuntamento ?? "-"}`);
  process.exit(0);
})();
