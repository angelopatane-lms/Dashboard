import { Pool } from "pg";

let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      keepAlive: true,
      // Il bootstrap dura ore: senza timeout sull'acquisizione, un risveglio
      // lento del database (Neon si sospende dopo 5 minuti di inattivita')
      // bloccherebbe il processo a tempo indeterminato invece di fallire.
      connectionTimeoutMillis: 30_000
    });

    // Senza questo listener un errore su una connessione ferma nel pool (rete
    // che cade, database che chiude la connessione inattiva) diventa una
    // eccezione non gestita che termina il processo: durante un bootstrap di
    // ore significherebbe trovare il terminale morto senza alcun messaggio.
    pool.on("error", (err) => {
      console.error("[db] errore su connessione inattiva:", err.message);
    });
  }
  return pool;
}
