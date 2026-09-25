// Riempie `presenza_call.programma` sulle registrazioni gia' abbinate.
//
// Serve una volta sola, per il passato: da qui in avanti ci pensa il
// riconoscimento delle presenze, che legge le stesse frasi per capire chi era
// in call e ne ricava anche il programma senza chiamate in piu'.
//
// E' sicuro rilanciarlo: riscrive il valore di ogni riga che processa. Di
// default tocca solo le righe senza programma; con --tutte le rifa' tutte,
// utile quando cambiano le parole riconosciute in src/lib/programma.ts.
//
// Uso: npx tsx scripts/riempi-programma.ts
//      npx tsx scripts/riempi-programma.ts --tutte

import { richiedi } from "./env";
import { getDb } from "../src/lib/db";
import { leggiFrasi } from "../src/lib/fireflies";
import { programmaDallaConversazione } from "../src/lib/programma";

const PAUSA_MS = 280;

async function main() {
  const tutte = process.argv.includes("--tutte");
  const chiave = richiedi("FIREFLIES_API_KEY");
  richiedi("DATABASE_URL");
  const db = getDb();

  const { rows } = await db.query<{ riunione_id: string; trascrizione: string }>(
    `SELECT riunione_id, trascrizione
       FROM presenza_call
      WHERE trascrizione IS NOT NULL ${tutte ? "" : "AND programma IS NULL"}
      ORDER BY call_ts DESC NULLS LAST`
  );
  console.log(`[programma] ${rows.length} registrazioni da leggere.\n`);

  const conteggi = new Map<string, number>();
  let muti = 0;
  let falliti = 0;

  for (const [i, r] of rows.entries()) {
    try {
      const frasi = await leggiFrasi(chiave, r.trascrizione);
      const programma = programmaDallaConversazione(frasi);
      await db.query(`UPDATE presenza_call SET programma = $2 WHERE riunione_id = $1`, [
        r.riunione_id,
        programma
      ]);
      if (programma) conteggi.set(programma, (conteggi.get(programma) ?? 0) + 1);
      else muti++;
    } catch (e) {
      falliti++;
      console.error(`[programma] ${r.trascrizione}:`, e instanceof Error ? e.message : e);
    }
    if ((i + 1) % 20 === 0) console.log(`[programma] ${i + 1}/${rows.length}`);
    await new Promise((s) => setTimeout(s, PAUSA_MS));
  }

  console.log("\n[programma] riconosciuti:");
  for (const [p, n] of [...conteggi].sort((a, b) => b[1] - a[1])) console.log(`  ${p.padEnd(16)} ${n}`);
  console.log(`  ${"(nessuno)".padEnd(16)} ${muti}`);
  if (falliti) console.log(`  falliti: ${falliti}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
