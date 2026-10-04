// Comando a mano per la cronologia degli Stati Lead dei quattro advisor che
// lavorano solo al telefono. La logica sta in src/lib/statiLead/sync.ts, che e'
// la stessa che gira ogni notte dal cron: una copia sola, cosi' i due non
// possono dare risultati diversi sullo stesso periodo.
//
// Uso:
//   npm run sync:stati-lead -- --da 2026-01-01        primo caricamento
//   npm run sync:stati-lead                           giro incrementale
//   npm run sync:stati-lead -- --da 2026-01-01 --prova   non scrive niente
//
// SENZA --da riparte dal checkpoint meno un giorno di margine. E' ripetibile:
// le righe si riscrivono sulla coppia (contatto, istante).

import { richiedi } from "./env";
import { sincronizzaStatiLead, daDoveRipartire } from "../src/lib/statiLead/sync";

async function main() {
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  richiedi("DATABASE_URL"); // la connessione la apre getDb(), qui si verifica solo che ci sia
  const argv = process.argv.slice(2);
  const valore = (nome: string) => {
    const i = argv.indexOf(nome);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const prova = argv.includes("--prova");
  const daArg = valore("--da");

  let da: Date;
  if (daArg) {
    da = new Date(`${daArg}T00:00:00.000Z`);
    if (Number.isNaN(da.getTime())) throw new Error(`--da non e' una data: ${daArg}`);
  } else {
    da = await daDoveRipartire();
  }

  console.log(`[stati-lead] dalla data : ${da.toISOString().slice(0, 10)}${prova ? "   (PROVA: non scrive)" : ""}\n`);

  const esito = await sincronizzaStatiLead({ token, da, scrivi: !prova });
  for (const a of esito.advisor) {
    console.log(`  ${a.nome.padEnd(16)} contatti letti: ${String(a.contatti).padStart(5)}   ingressi salvati: ${a.ingressi}`);
  }
  console.log(`\n[stati-lead] ingressi in tutto: ${esito.ingressi}${prova ? "   (nulla e' stato scritto)" : ""}`);
}

main().catch((err) => {
  console.error("[stati-lead] fallito:", err instanceof Error ? err.message : err);
  process.exit(1);
});
