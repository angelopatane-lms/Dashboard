// SOLA LETTURA: delle trattative nate ieri, quante stanno nella pipeline
// Appuntamenti High Ticket? E' la pipeline che il quadrante conta.
import "./env";
import { getDb } from "../src/lib/db";
import { PIPELINE_HT } from "../src/lib/report/giornaliero";

(async () => {
  const db = getDb();
  const { rows } = await db.query<{ deal_id: string }>(
    `SELECT deal_id::text FROM trattativa
      WHERE creata_ts >= ('2026-11-13'::date::timestamp AT TIME ZONE 'Europe/Rome')
        AND creata_ts <  ('2026-11-14'::date::timestamp AT TIME ZONE 'Europe/Rome')`
  );
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/deals/batch/read", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: ["pipeline", "dealname"],
      inputs: rows.map((r) => ({ id: r.deal_id }))
    })
  });
  const d = await res.json();
  const conta = new Map<string, number>();
  for (const x of d.results ?? []) {
    const p = x.properties?.pipeline ?? "(vuota)";
    conta.set(p, (conta.get(p) ?? 0) + 1);
  }
  console.log("pipeline High Ticket:", PIPELINE_HT);
  console.log("trattative nate il 13:", rows.length);
  for (const [p, n] of conta) console.log("  pipeline", p, "->", n, p === PIPELINE_HT ? "(High Ticket)" : "");
  process.exit(0);
})();
