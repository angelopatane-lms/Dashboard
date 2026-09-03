// Applica sql/campaign-conversions-schema.sql al database indicato da
// DATABASE_URL, senza dover incollare niente nella console web di Neon.
//
// E' sicuro rilanciarlo: tutte le istruzioni sono "IF NOT EXISTS", quindi su
// un database gia' configurato non fa nulla. L'unica cosa che puo' fermarlo e'
// il blocco di guardia dello schema, che si accorge se esiste gia' una tabella
// eventi_conversione con la struttura VECCHIA e chiede di eliminarla a mano
// invece di rovinare i dati in silenzio.
//
// Uso: npm run db:schema

import { richiedi } from "./env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const percorsoSql = path.join(radice, "sql", "campaign-conversions-schema.sql");

async function main() {
  const connectionString = richiedi("DATABASE_URL");
  const sql = readFileSync(percorsoSql, "utf8");

  console.log(`[schema] file : ${percorsoSql}`);
  // Mostra a quale database ci si sta collegando senza rivelare la password.
  console.log(`[schema] host : ${new URL(connectionString).host}\n`);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(sql);
    console.log("[schema] applicato senza errori.\n");

    const { rows } = await client.query(`
      SELECT table_name,
             (SELECT count(*) FROM information_schema.columns c
               WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS colonne
      FROM information_schema.tables t
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log("  Tabelle presenti:");
    for (const r of rows) {
      console.log(`    ${String(r.table_name).padEnd(22)} ${r.colonne} colonne`);
    }

    const attese = ["alias_contatto", "campagna", "eventi_conversione", "sync_checkpoint", "sync_log"];
    const presenti = new Set(rows.map((r) => r.table_name));
    const mancanti = attese.filter((t) => !presenti.has(t));

    console.log("");
    if (mancanti.length) {
      console.log(`  ATTENZIONE: mancano le tabelle: ${mancanti.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("  Tutte le tabelle attese sono presenti: si puo' procedere con la prova.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[schema] fallito:", err instanceof Error ? err.message : err);
  process.exit(1);
});
