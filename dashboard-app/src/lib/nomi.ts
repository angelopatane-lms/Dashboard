/**
 * La chiave con cui si accostano i nomi delle persone fra fonti diverse.
 *
 * Lo stesso advisor arriva scritto in tre modi: dal foglio Operatori, dal
 * foglio degli utenti HubSpot e dall'anagrafica dei proprietari su HubSpot.
 * Cambiano le maiuscole, gli spazi doppi e il tipo di apostrofo - quello
 * tipografico che Word e Google Sheets inseriscono da soli al posto di quello
 * dritto. Confrontare i nomi cosi' come sono fa fallire l'aggancio proprio
 * sulle persone che hanno un apostrofo nel cognome.
 */
export function chiaveNome(nome: string): string {
  return nome
    .toLowerCase()
    .replaceAll("\u2019", "'")
    .replace(/\s+/g, " ")
    .trim();
}
