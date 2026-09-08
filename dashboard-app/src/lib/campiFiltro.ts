// I colori dei campi di filtro, in un posto solo.
//
// Stanno qui perche' li usano tre punti lontani fra loro - i menu della barra
// filtri, il menu a piu' scelte, la casella del nome contatto - e finche' erano
// scritti dentro ognuno di loro il tema si e' scollato: due grigi diversi e un
// blu rimasto dal foglio di stile di partenza, che con il resto della dashboard
// non c'entrava niente.
//
// IL GRIGIO E' "NEUTRAL" E NON "SLATE". Slate nella tavolozza tira al blu, e
// accanto al nero dei campi scelti la sfumatura fredda si vede. E' la stessa
// ragione per cui le spunte del menu a piu' scelte sono neutral.

/**
 * Le classi di colore di un campo, secondo che porti una scelta o no.
 *
 * SCELTO E' NERO: fondo pieno, cosi' da lontano si vede subito quali filtri
 * sono attivi e quali no. I menu che una scelta ce l'hanno sempre - Periodo,
 * Campagna - sono neri sempre, anche sul valore predefinito: bianchi
 * sembrerebbero spenti, mentre stanno gia' restringendo quello che si guarda.
 *
 * Passandoci sopra col mouse il bordo si scurisce, e prendendo il fuoco si
 * accende l'alone: due segnali diversi per due cose diverse, entrambi grigi.
 */
export function coloriCampo(scelto: boolean): string {
  return scelto
    ? "border-neutral-700 bg-black text-white hover:border-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-300/20"
    : "border-slate-200 bg-white hover:border-neutral-800 focus:border-neutral-800 focus:ring-2 focus:ring-neutral-800/20";
}
