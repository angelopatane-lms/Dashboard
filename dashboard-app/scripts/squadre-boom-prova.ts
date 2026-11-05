/**
 * I Boom di una finestra su file, per provare le pagine delle squadre in
 * locale senza mettere in piedi la Dashboard.
 *
 *   npx tsx scripts/squadre-boom-prova.ts <dove.json> [da] [a]
 *
 * In produzione questo file non esiste: le pagine chiamano /api/squadre/boom.
 */
import "./env";
import fs from "fs";
import { ieriRoma } from "../src/lib/report/giornaliero";
import { calcolaBoom } from "../src/lib/squadre/boom";
import { piuGiorni } from "../src/lib/squadre/finestra";
import { proprietari } from "../src/lib/squadre/proprietari";

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const dove = process.argv[2];
  if (!dove) {
    console.error("serve il file dove scrivere");
    process.exit(1);
  }
  const a = process.argv[4] ?? ieriRoma();
  const da = process.argv[3] ?? piuGiorni(a, -34);

  const nomi = await proprietari(token);
  const uscita = await calcolaBoom(token, da, a, nomi.perId, (r) => console.log("  " + r));
  fs.writeFileSync(dove, JSON.stringify(uscita), "utf8");
  const giorni = Object.keys(uscita.giorni).length;
  console.log(`scritto ${dove}: ${giorni} giorni, ${(fs.statSync(dove).size / 1024).toFixed(0)} KB`);
  process.exit(0);
})();
