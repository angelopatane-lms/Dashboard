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
 * I BIGLIETTI ICMD SONO UNA CATEGORIA COME LE ALTRE, e la squadra
 * dell'evento e' una squadra come le altre: `squadre.json` le da' gia'
 * `categorie: ["ICMD"]`, quindi "il prodotto della squadra" per lei sono i
 * biglietti, senza che qui serva un caso speciale.
 *
 * Ci si e' arrivati per esclusione, il 17 novembre 2026. Prima i biglietti
 * erano tenuti fuori da tutti i modi del filtro, che era giusto per le cinque
 * squadre commerciali - un biglietto da 300 EUR non e' il loro percorso - ma
 * creava il problema specchiato: la pagina ICMD mostrava gli high ticket
 * venduti dai suoi. Misurato: dal 1 ottobre le sue quattro persone hanno
 * fatto 125 chiusure di biglietti per 38.398 EUR e 3 vendite di altro per
 * 39.318 - cioe' meta' dei loro euro era roba di altre squadre.
 *
 * Con ICMD fra le categorie ogni squadra resta a casa sua, e chi vuole il
 * totale intero di una persona lo guarda sulla Dashboard, dove quei numeri
 * non si filtrano mai.
 */

type DefProdotto = { etichetta: string; contiene: string[] };

/**
 * Vince la prima riga che trova corrispondenza, come per le campagne.
 *
 * "REM 2.0 Real Estate PRO" corrisponde a due frammenti della stessa riga e
 * non e' un problema; se un domani un prodotto corrispondesse a due righe
 * diverse, l'ordine di questo elenco e' la risposta.
 */
const DEFS: DefProdotto[] = [
  // ICMD per primo: "ICMD Gold", "ICMD x 2 + Hotel" e simili non contengono
  // nessuno degli altri frammenti, ma l'ordine dice qual e' la regola.
  { etichetta: "ICMD", contiene: ["icmd"] },
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
  for (const def of DEFS) {
    if (def.contiene.some((f) => nome.includes(f))) return def.etichetta;
  }
  return null;
}

/**
 * E' un biglietto dell'evento, non un percorso.
 *
 * Resta per chi deve distinguerli senza passare dalle categorie.
 *
 * Serve al modo *campagna*, che guarda da dove viene il lead e non cosa e'
 * stato venduto: senza questo, un biglietto ICMD comprato da un lead arrivato
 * con una campagna REM entrerebbe nella riga di REM, e il filtro conterebbe
 * biglietti in una pagina che ha appena finito di escluderli dall'altro modo.
 *
 * Misurato dal 1 ottobre al 17 novembre 2026: sono 17 biglietti per 6.100
 * EUR, contro 65 chiusure e 280.653 EUR di high ticket. In euro e' il 2%, nel
 * conteggio delle chiusure una su cinque - e su MBE Marketing dieci su
 * ventotto, cioe' la differenza fra una squadra che chiude e una che vende
 * biglietti ai propri lead.
 */
export function eBigliettoEvento(prodotto: string | null | undefined): boolean {
  return categoriaProdotto(prodotto) === "ICMD";
}

/** Le categorie e i loro frammenti, per chi deve mostrarle o provarle. */
export const CATEGORIE_PRODOTTO: ReadonlyArray<{ etichetta: string; frammenti: readonly string[] }> =
  DEFS.map((d) => ({ etichetta: d.etichetta, frammenti: d.contiene }));
