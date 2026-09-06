import { richiedi } from "./env";
import { Client } from "pg";
async function main() {
  const cl = new Client({ connectionString: richiedi("DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await cl.connect();
  const { rows } = await cl.query(
    `SELECT COUNT(*)::int AS tot, COUNT(contact_id)::int AS con_contatto,
            COUNT(*) FILTER (WHERE creata_ts >= now() - INTERVAL '2 days')::int AS ultimi_2gg,
            COUNT(contact_id) FILTER (WHERE creata_ts >= now() - INTERVAL '2 days')::int AS ultimi_2gg_con_contatto
       FROM trattativa`
  );
  const r = rows[0];
  console.log(`  trattative ${r.tot}, con contatto ${r.con_contatto} (${(r.con_contatto / r.tot * 100).toFixed(1)}%)`);
  console.log(`  nate negli ultimi 2 giorni: ${r.ultimi_2gg}, con contatto ${r.ultimi_2gg_con_contatto}`);
  await cl.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
