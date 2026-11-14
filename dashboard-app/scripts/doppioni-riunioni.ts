// SOLA LETTURA: quante volte lo stesso contatto risulta prenotato piu' volte
// sulla stessa fascia, e con che distanza fra una prenotazione e l'altra.
//
//   npx tsx scripts/doppioni-riunioni.ts 2026-11-01 2026-11-14
import "./env";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const da = process.argv[2] ?? "2026-11-01";
const a = process.argv[3] ?? new Date().toISOString().slice(0, 10);

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

const quando = (v: string) => {
  const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return new Date(ms);
};
const scritto = (d: Date) => d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });

(async () => {
  const dalle = istanteRoma(da);
  const alle = istanteRoma(a) + 86400000;

  const righe: Array<{ id: string; p: Record<string, string> }> = [];
  let after: string | undefined;
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
        properties: [
          "hs_meeting_title", "hs_meeting_start_time", "hubspot_owner_id",
          "hs_createdate", "hs_object_source", "hs_object_source_label"
        ],
        limit: 100,
        ...(after ? { after } : {})
      })
    });
    const d = await res.json();
    for (const m of d.results ?? []) righe.push({ id: String(m.id), p: m.properties ?? {} });
    after = d.paging?.next?.after;
  } while (after);

  console.log(`riunioni dal ${da} al ${a}: ${righe.length}`);

  // Stesso titolo e stessa ora di inizio: e' la firma di una prenotazione
  // ripetuta, perche' il titolo porta il nome del contatto e dell'advisor.
  const gruppi = new Map<string, typeof righe>();
  for (const r of righe) {
    const chiave = `${(r.p.hs_meeting_title ?? "").trim().toLowerCase().replace(/ (and|e) /g, " + ")}#${r.p.hs_meeting_start_time}`;
    if (!gruppi.has(chiave)) gruppi.set(chiave, []);
    gruppi.get(chiave)!.push(r);
  }

  const doppi = [...gruppi.entries()].filter(([, v]) => v.length > 1);
  console.log(`fasce con piu' di una riunione: ${doppi.length}\n`);

  for (const [chiave, v] of doppi.sort((x, y) => y[1].length - x[1].length).slice(0, 15)) {
    const creazioni = v
      .map((r) => quando(r.p.hs_createdate))
      .sort((x, y) => x.getTime() - y.getTime());
    const arco = (creazioni[creazioni.length - 1].getTime() - creazioni[0].getTime()) / 60000;
    const fonti = new Set(v.map((r) => r.p.hs_object_source_label ?? r.p.hs_object_source ?? "?"));
    console.log(`${v.length}x  ${chiave.split("#")[0].slice(0, 58)}`);
    console.log(`     inizio ${scritto(quando(v[0].p.hs_meeting_start_time))}`);
    console.log(`     create ${scritto(creazioni[0])} -> ${scritto(creazioni[creazioni.length - 1])} (arco ${arco.toFixed(0)} min)`);
    console.log(`     fonti  ${[...fonti].join(", ")}`);
  }
  process.exit(0);
})();
