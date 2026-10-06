// Rilegge le conversioni di UNA campagna, contatto per contatto.
//
// A COSA SERVE. Il giro incrementale cerca i contatti con
// `data_ultima_modifica_campagna_refresh` piu' recente dell'ultima esecuzione.
// Chi viene spostato su una campagna A MANO non aggiorna quella proprieta':
// resta con la data vecchia e l'incrementale non lo incrocera' mai piu'. Non e'
// questione di aspettare il giro dopo - sono invisibili per sempre.
//
// Misurato il 6 ottobre 2026 su "icmd_14_workshop_ottobre": 775 contatti sulla
// campagna, 520 con la data aggiornata, 238 fermi a settembre. In dashboard ne
// risultavano 513, e il costo per lead era sovrastimato del 50%.
//
// Uso:
//   npx tsx scripts/riallinea-campagna.ts icmd_14_workshop_ottobre
//
// E' idempotente: le righe si riscrivono sulla stessa chiave, rilanciarlo non
// duplica niente.

import { richiedi } from "./env";
import { eseguiSync } from "../src/lib/campaignConversions/sync";

async function main() {
  const campagna = process.argv[2];
  if (!campagna) throw new Error('manca il nome della campagna: npx tsx scripts/riallinea-campagna.ts <nome>');

  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  richiedi("DATABASE_URL");

  console.log(`[riallineamento] campagna: ${campagna}\n`);
  const esito = await eseguiSync("riallineamento", token, {
    filtri: [{ propertyName: "id_campagna_refresh", operator: "EQ", value: campagna }],
    onProgresso: ({ contatti, eventi }) =>
      process.stdout.write(`\r  letti ${contatti} contatti, ${eventi} conversioni`)
  });
  console.log(`\n\n[riallineamento] fatto: ${esito.contatti} contatti, ${esito.eventi} conversioni`);
}

main().catch((err) => {
  console.error("[riallineamento] fallito:", err instanceof Error ? err.message : err);
  process.exit(1);
});
