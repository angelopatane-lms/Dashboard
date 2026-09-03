// Verifica cosa e' stato realmente scritto su Postgres, da lanciare DOPO la
// prova con --limite.
//
// Non e' un semplice "ci sono righe?": misura il costo REALE per riga
// interrogando Postgres, invece di fidarsi della stima teorica di 135 byte.
// Da li' ricalcola la proiezione a fine bootstrap, che e' l'unico numero che
// dice davvero se il piano gratuito basta.
//
// Uso: npm run db:verifica

import { richiedi } from "./env";
import { Client } from "pg";

// Popolazione totale da processare (contatti con id_campagna_refresh).
const CONTATTI_TOTALI = 345_179;
const LIMITE_PIANO_GRATUITO_MB = 500;

function mb(byte: number): string {
  return `${(byte / 1_000_000).toFixed(1)} MB`;
}

async function main() {
  const connectionString = richiedi("DATABASE_URL");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    console.log("=".repeat(64));
    console.log("  COSA C'E' NEL DATABASE");
    console.log("=".repeat(64));

    const { rows: dimensioni } = await client.query(`
      SELECT relname AS tabella,
             pg_total_relation_size(c.oid) AS byte_totali,
             pg_relation_size(c.oid)       AS byte_dati,
             pg_indexes_size(c.oid)        AS byte_indici,
             (SELECT n_live_tup FROM pg_stat_user_tables s WHERE s.relid = c.oid) AS righe
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);

    for (const r of dimensioni) {
      console.log(
        `  ${String(r.tabella).padEnd(20)} ${String(r.righe ?? 0).padStart(9)} righe~  ` +
          `${mb(Number(r.byte_totali)).padStart(9)}  ` +
          `(dati ${mb(Number(r.byte_dati))}, indici ${mb(Number(r.byte_indici))})`
      );
    }
    // n_live_tup e' la stima delle statistiche interne di Postgres, non un
    // conteggio: puo' discostarsi da count(*) finche' autovacuum non passa.
    // Il conteggio esatto e' quello della sezione CONTENUTO qui sotto.
    console.log("\n  (~ = stima di Postgres; il conteggio esatto e' piu' sotto)");

    const { rows: [conteggi] } = await client.query(`
      SELECT (SELECT count(*) FROM eventi_conversione) AS eventi,
             (SELECT count(DISTINCT contact_id) FROM eventi_conversione) AS contatti,
             (SELECT count(*) FROM campagna) AS campagne,
             (SELECT count(*) FROM alias_contatto) AS alias,
             (SELECT min(ts) FROM eventi_conversione) AS piu_vecchio,
             (SELECT max(ts) FROM eventi_conversione) AS piu_recente
    `);

    const eventi = Number(conteggi.eventi);
    if (eventi === 0) {
      console.log("\n  Nessun evento salvato: la prova non e' ancora stata lanciata.");
      console.log("  Lancia:  npm run bootstrap:campaign-conversions -- --limite 500\n");
      return;
    }

    console.log("\n" + "=".repeat(64));
    console.log("  CONTENUTO");
    console.log("=".repeat(64));
    console.log(`  Eventi salvati.................... ${eventi.toLocaleString("it-IT")}`);
    console.log(`  Contatti distinti................. ${Number(conteggi.contatti).toLocaleString("it-IT")}`);
    console.log(`  Campagne distinte................. ${Number(conteggi.campagne).toLocaleString("it-IT")}`);
    console.log(`  Alias da fusioni.................. ${Number(conteggi.alias).toLocaleString("it-IT")}`);
    console.log(`  Evento piu' vecchio............... ${new Date(conteggi.piu_vecchio).toISOString().slice(0, 10)}`);
    console.log(`  Evento piu' recente............... ${new Date(conteggi.piu_recente).toISOString().slice(0, 10)}`);

    // Il numero che conta: il costo reale per riga, misurato invece che stimato.
    const eventiTab = dimensioni.find((d) => d.tabella === "eventi_conversione");
    const bytePerRiga = Number(eventiTab?.byte_totali ?? 0) / eventi;
    const eventiPerContatto = eventi / Number(conteggi.contatti);
    const righeFinali = CONTATTI_TOTALI * eventiPerContatto;
    const mbFinali = (righeFinali * bytePerRiga) / 1_000_000;

    console.log("\n" + "=".repeat(64));
    console.log("  COSTO REALE PER RIGA (misurato, non stimato)");
    console.log("=".repeat(64));
    console.log(`  Byte per riga effettivi........... ${bytePerRiga.toFixed(1)} byte`);
    console.log(`  (la stima teorica era............. 135 byte)`);
    console.log(`  Conversioni per contatto.......... ${eventiPerContatto.toFixed(2)}`);
    console.log("");
    console.log(`  Righe attese a fine bootstrap..... ~${Math.round(righeFinali).toLocaleString("it-IT")}`);
    console.log(`  Spazio atteso..................... ~${Math.round(mbFinali)} MB`);
    console.log(`  Piano gratuito.................... ${LIMITE_PIANO_GRATUITO_MB} MB (${((mbFinali / LIMITE_PIANO_GRATUITO_MB) * 100).toFixed(0)}% usato)`);

    console.log("\n  NOTA: su poche righe il costo unitario risulta gonfiato, perche' una");
    console.log("  tabella quasi vuota occupa comunque pagine intere. Il valore reale a");
    console.log("  regime sara' piu' basso di quello qui sopra.");

    console.log("\n" + "=".repeat(64));
    console.log("  CONTROLLI DI CORRETTEZZA");
    console.log("=".repeat(64));

    const { rows: [controlli] } = await client.query(`
      SELECT
        (SELECT count(*) FROM eventi_conversione e
          LEFT JOIN campagna c ON c.id = e.campagna_id WHERE c.id IS NULL) AS orfani,
        (SELECT count(*) FROM eventi_conversione WHERE posizione < 1) AS posizione_invalida,
        (SELECT count(*) FROM (
           SELECT contact_id FROM eventi_conversione
           WHERE posizione = 1 GROUP BY contact_id HAVING count(*) > 1) x) AS piu_di_una_prima,
        (SELECT count(*) FROM sync_checkpoint) AS checkpoint_rimasti
    `);

    const esito = (ok: boolean) => (ok ? "OK" : "PROBLEMA");
    console.log(`  Eventi senza campagna collegata... ${controlli.orfani}  ${esito(Number(controlli.orfani) === 0)}`);
    console.log(`  Posizioni non valide.............. ${controlli.posizione_invalida}  ${esito(Number(controlli.posizione_invalida) === 0)}`);
    console.log(`  Contatti con due "prima volta".... ${controlli.piu_di_una_prima}  ${esito(Number(controlli.piu_di_una_prima) === 0)}`);
    console.log(`  Checkpoint rimasti appesi......... ${controlli.checkpoint_rimasti}  ${esito(Number(controlli.checkpoint_rimasti) === 0)}`);

    const { rows: log } = await client.query(
      `SELECT tipo, esito, contatti, eventi, iniziato_at, finito_at FROM sync_log ORDER BY id DESC LIMIT 5`
    );
    console.log("\n  Ultime esecuzioni:");
    for (const r of log) {
      const durata = r.finito_at
        ? `${((new Date(r.finito_at).getTime() - new Date(r.iniziato_at).getTime()) / 1000).toFixed(0)}s`
        : "in corso";
      console.log(`    ${String(r.tipo).padEnd(12)} ${String(r.esito ?? "?").padEnd(8)} ${String(r.contatti).padStart(7)} contatti  ${durata}`);
    }

    console.log("\n" + "=".repeat(64));
    console.log("  LA QUERY CHE USERA' LA DASHBOARD");
    console.log("=".repeat(64));

    const { rows: anteprima } = await client.query(`
      WITH risolti AS (
        SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts, e.posizione
        FROM eventi_conversione e
        LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
      ),
      filtrati AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY persona_id ORDER BY ts) AS rank_nel_periodo
        FROM risolti
      )
      SELECT c.nome AS campagna,
             COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1 AND f.posizione = 1)::int AS convertiti,
             COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1 AND f.posizione > 1)::int AS riconvertiti,
             COUNT(*) FILTER (WHERE f.rank_nel_periodo = 1)::int AS lead_generati
      FROM filtrati f JOIN campagna c ON c.id = f.campagna_id
      GROUP BY c.nome ORDER BY lead_generati DESC LIMIT 8
    `);

    console.log(`  ${"Campagna".padEnd(42)} ${"Conv.".padStart(6)} ${"Ricon.".padStart(7)} ${"Lead".padStart(6)}`);
    for (const r of anteprima) {
      console.log(
        `  ${String(r.campagna).slice(0, 42).padEnd(42)} ${String(r.convertiti).padStart(6)} ` +
          `${String(r.riconvertiti).padStart(7)} ${String(r.lead_generati).padStart(6)}`
      );
    }
    console.log("");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[verifica] fallita:", err instanceof Error ? err.message : err);
  process.exit(1);
});
