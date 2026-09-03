// Bootstrap una tantum: popola eventi_conversione con TUTTO lo storico
// pregresso (tutti i contatti con id_campagna_refresh popolata, nessun
// filtro aggiuntivo, per non perdere nessuna conversione storica).
//
// Va lanciato come script locale (non tramite Vercel): il volume di
// contatti da processare supera abbondantemente i limiti di timeout delle
// funzioni serverless. Una volta eseguito con successo, non va piu'
// ripetuto - il mantenimento successivo e' a carico dei cron (incrementale
// orario + full settimanale, che usano filtri molto piu' leggeri).
//
// Uso: npm run bootstrap:campaign-conversions
// (richiede DATABASE_URL e HUBSPOT_PRIVATE_APP_TOKEN in dashboard-app/.env.local)

import "dotenv/config";
import { eseguiSync } from "../src/lib/campaignConversions/sync";

async function main() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN non impostato (vedi .env.local)");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non impostato (vedi .env.local)");

  console.log("[bootstrap] avvio... (puo' richiedere 15-60 minuti)");
  const iniziato = Date.now();

  const risultato = await eseguiSync("bootstrap", token);

  const minuti = ((Date.now() - iniziato) / 60_000).toFixed(1);
  console.log(`[bootstrap] completato in ${minuti} minuti:`, risultato);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bootstrap] fallito:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
