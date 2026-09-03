// Caricamento delle variabili d'ambiente per gli script locali.
//
// ATTENZIONE: `import "dotenv/config"` carica SOLO il file ".env" e ignora
// ".env.local". Siccome il progetto e' Next.js, il file usato per i segreti
// locali si chiama ".env.local" (convenzione Next), quindi con dotenv nudo le
// variabili non venivano lette e lo script falliva dicendo di controllare
// proprio il file che non stava leggendo.
//
// Qui si caricano entrambi, con ".env.local" prioritario (dotenv non
// sovrascrive una variabile gia' definita), e con percorsi risolti a partire
// dalla cartella del progetto invece che dalla directory corrente, cosi' lo
// script funziona da qualunque punto lo si lanci.

import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cartellaScript = path.dirname(fileURLToPath(import.meta.url));
const radiceProgetto = path.resolve(cartellaScript, "..");

config({ path: path.join(radiceProgetto, ".env.local") });
config({ path: path.join(radiceProgetto, ".env") });

/** Legge una variabile obbligatoria, con un errore che dice dove metterla. */
export function richiedi(nome: string): string {
  const valore = process.env[nome];
  if (!valore || !valore.trim()) {
    throw new Error(
      `${nome} non impostato. Aggiungilo in ${path.join(radiceProgetto, ".env.local")}`
    );
  }
  if (valore.includes("INCOLLA")) {
    throw new Error(
      `${nome} contiene ancora il segnaposto: sostituiscilo con il valore vero in ${path.join(radiceProgetto, ".env.local")}`
    );
  }
  return valore.trim();
}
