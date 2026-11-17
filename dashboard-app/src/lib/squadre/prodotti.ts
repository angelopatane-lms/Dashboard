/**
 * A quale squadra appartiene il PRODOTTO di un incasso.
 *
 * Serve al filtro "Categoria" delle pagine squadre, nel modo *prodotto*: non
 * tutto quello che una squadra chiude e' roba sua. Misurato il 17 novembre
 * 2026 sugli ultimi 30 giorni: Sales Skills ha chiuso 30 vendite per 50.603
 * EUR, di cui 3 di prodotto proprio; MBE Management 4 per 25.070 EUR, di cui
 * 2. Senza questa distinzione le due cose si leggono come una.
 *
 * LE ETICHETTE SONO LE STESSE DELLE CAMPAGNE, di proposito: `squadre.json`
 * dichiara una volta sola `categorie: ["REM"]`, e quella riga vale sia per il
 * nome delle campagne (src/lib/campaignCategory.ts) sia per il nome dei
 * prodotti qui. Due elenchi separati sarebbero divergiuti al primo prodotto
 * nuovo, e nessuno se ne accorgerebbe finche' un venduto non sparisce.
 *
 * SOLO I NOMI ESPLICITI. "MBE Sales PRO" e' MBE SALES; "Sales" e "Sales Coach
 * PRO", senza il prefisso, restano fuori. Nel 2026 sono 20 incassi in tutto
 * ("Marketing" 10, "Management Coach PRO" 4, "Marketing Coach PRO" 3, e uno
 * ciascuno per "Sales", "Sales Coach PRO", "Management"): pochi, e attribuirli
 * vorrebbe dire decidere che sono la stessa linea di prodotto senza che il
 * nome lo dica. Il giorno che si vuole il contrario, si aggiunge il frammento
 * qui e vale subito in tutte e due le pagine.
 *
 * I BIGLIETTI ICMD NON SONO IL PRODOTTO DI NESSUNA SQUADRA. Deciso da Angelo
 * il 17 novembre 2026: nel modo prodotto si guardano solo gli high ticket.
 * Sono dichiarati qui sopra in un elenco a parte - e non semplicemente
 * omessi - perche' un prodotto che resta fuori per scelta e uno che resta
 * fuori perche' nessuno l'ha mai classificato si leggono uguali, e fra sei
 * mesi nessuno saprebbe piu' quale dei due era.
 *
 * IL FILTRO E' SOLO DELLE CINQUE SQUADRE COMMERCIALI. Deciso da Angelo lo
 * stesso giorno: sulla pagina ICMD, che vende biglietti e non percorsi, il
 * filtro non compare - non c'e' un "prodotto della squadra" da confrontare, e
 * un filtro che sulla sua pagina puo' solo azzerare i numeri non serve a
 * nessuno. Quella pagina resta come e' oggi.
 */

/** I prodotti che restano fuori per scelta, non per dimenticanza. */
const ESCLUSI = ["icmd"];

type DefProdotto = { etichetta: string; contiene: string[] };

/**
 * Vince la prima riga che trova corrispondenza, come per le campagne.
 *
 * "REM 2.0 Real Estate PRO" corrisponde a due frammenti della stessa riga e
 * non e' un problema; se un domani un prodotto corrispondesse a due righe
 * diverse, l'ordine di questo elenco e' la risposta.
 */
const DEFS: DefProdotto[] = [
  { etichetta: "REM", contiene: ["rem 2.0", "real estate"] },
  { etichetta: "DIV COACH", contiene: ["diventa coach", "div coach"] },
  { etichetta: "MBE MKTG", contiene: ["mbe marketing"] },
  { etichetta: "MBE MNGT", contiene: ["mbe management"] },
  { etichetta: "MBE SALES", contiene: ["mbe sales"] }
];

/**
 * La categoria di questo prodotto, o null se non e' di nessuna squadra.
 *
 * Il confronto e' sul nome in minuscolo e con gli spazi normalizzati: gli
 * stessi prodotti arrivano scritti in modi diversi a seconda di chi ha
 * compilato il Boom.
 */
export function categoriaProdotto(prodotto: string | null | undefined): string | null {
  const nome = String(prodotto ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!nome) return null;
  if (ESCLUSI.some((f) => nome.includes(f))) return null;
  for (const def of DEFS) {
    if (def.contiene.some((f) => nome.includes(f))) return def.etichetta;
  }
  return null;
}

/** Le categorie e i loro frammenti, per chi deve mostrarle o provarle. */
export const CATEGORIE_PRODOTTO: ReadonlyArray<{ etichetta: string; frammenti: readonly string[] }> =
  DEFS.map((d) => ({ etichetta: d.etichetta, frammenti: d.contiene }));
