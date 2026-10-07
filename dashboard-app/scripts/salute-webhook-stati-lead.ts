/**
 * La salute del webhook degli Stati Lead, in un colpo d'occhio.
 *
 * A COSA SERVE DAVVERO. Serve a decidere se il ritardo di un minuto dentro al
 * flusso HubSpot e' prudenza necessaria o latenza di troppo. L'endpoint non si
 * fida dell'istante ricevuto: rilegge la cronologia del contatto da HubSpot. Se
 * legge troppo presto puo' non vedere ancora il cambio appena fatto, e allora
 * scrive zero righe e annota `ignorato` - uno zero che somiglia in tutto a uno
 * zero legittimo (il contatto di un advisor che non ci interessa). E' il modo
 * di sbagliare che ci e' gia' costato caro: il dato non arriva e nessuno se ne
 * accorge.
 *
 * COME SI LEGGE. Finche' `ignorato` resta sui valori di sempre, togliere il
 * ritardo e' sicuro. Se cresce subito dopo averlo tolto, quel minuto serviva.
 *
 * Non e' una misura esatta - un `ignorato` legittimo e uno prematuro si
 * scrivono uguali - ma il confronto prima/dopo lo distingue, ed e' per questo
 * che stampa le due finestre affiancate.
 */
import "./env";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main(): Promise<void> {
  const { rows: finestre } = await pool.query<{
    finestra: string; ok: number; ignorato: number; errore: number; respinto: number; totale: number;
  }>(
    `SELECT CASE WHEN iniziato_at > now() - interval '24 hours'
                 THEN 'ultime 24 ore' ELSE 'i 7 giorni prima' END AS finestra,
            count(*) FILTER (WHERE esito = 'ok')::int       AS ok,
            count(*) FILTER (WHERE esito = 'ignorato')::int AS ignorato,
            count(*) FILTER (WHERE esito = 'errore')::int   AS errore,
            count(*) FILTER (WHERE esito = 'respinto')::int AS respinto,
            count(*)::int AS totale
       FROM sync_log
      WHERE tipo = 'webhook-stato-lead'
        AND iniziato_at > now() - interval '8 days'
      GROUP BY 1 ORDER BY 1 DESC`
  );

  if (!finestre.length) {
    console.log("nessuna consegna negli ultimi 8 giorni.");
    console.log("Se il flusso e' attivo, e' un problema - non un silenzio.");
    return;
  }

  for (const f of finestre) {
    const quota = f.totale ? Math.round((f.ignorato / f.totale) * 100) : 0;
    console.log(`\n${f.finestra} — ${f.totale} consegne`);
    console.log(`   ok        ${String(f.ok).padStart(4)}`);
    console.log(`   ignorato  ${String(f.ignorato).padStart(4)}   ${quota}% del totale`);
    if (f.errore) console.log(`   errore    ${String(f.errore).padStart(4)}   <- da guardare`);
    if (f.respinto) console.log(`   respinto  ${String(f.respinto).padStart(4)}   <- segreto non combaciante`);
  }

  // Gli `ignorato` recenti per esteso: il messaggio dice quale contatto era, e
  // bastano pochi casi per capire se sono advisor fuori dai quattro (legittimo)
  // oppure contatti dei quattro letti troppo presto (il ritardo serviva).
  const { rows: casi } = await pool.query<{ q: string; m: string }>(
    `SELECT to_char(iniziato_at, 'DD/MM HH24:MI') AS q, coalesce(messaggio, '') AS m
       FROM sync_log
      WHERE tipo = 'webhook-stato-lead' AND esito = 'ignorato'
        AND iniziato_at > now() - interval '24 hours'
      ORDER BY iniziato_at DESC LIMIT 10`
  );
  if (casi.length) {
    console.log(`\ngli 'ignorato' delle ultime 24 ore:`);
    for (const c of casi) console.log(`   ${c.q}  ${c.m.slice(0, 150)}`);
  }

  // IL CRON E' LA RETE, e una rete si controlla. Se l'ultimo giro completo e'
  // vecchio, quello che il webhook ha perso non lo sta recuperando nessuno.
  // IL GIRO A LOTTI SI ANNOTA IN sync_checkpoint, NON IN sync_log: cercarlo
  // nel posto sbagliato restituisce "mai", che somiglia in tutto a un cron
  // fermo. E' successo scrivendo questo script.
  const { rows: cron } = await pool.query<{ q: string | null }>(
    `SELECT to_char(aggiornato_at, 'DD/MM HH24:MI') AS q
       FROM sync_checkpoint WHERE tipo = 'stati-lead'`
  );
  console.log(`
ultimo giro a lotti: ${cron[0]?.q ?? "mai"}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
