// I periodi preimpostati dei filtri: un tasto che scrive le due date da solo.
//
// Nascono da una richiesta precisa - "tasto fisso per evitare di perdere tempo
// con le date" - e il tempo si perde soprattutto sui periodi ricorrenti, che
// sono sempre gli stessi otto.
//
// L'ORDINE E' QUELLO IN CUI SONO STATI CHIESTI, non quello per durata
// crescente: mese e settimana prima del giorno perche' sono quelli che si
// guardano piu' spesso, e chi li ha chiesti li ha elencati cosi'.

export type Periodo = {
  value: string;
  label: string;
  /** Le due date in formato aaaa-mm-gg, gli estremi inclusi. */
  from: string;
  to: string;
};

/**
 * Oggi secondo il calendario di Roma, non secondo quello del computer.
 *
 * A cavallo della mezzanotte i due possono essere giorni diversi: un browser
 * regolato su un altro fuso - o su UTC, come succede a chi ha il portatile
 * appena tornato da un viaggio - farebbe partire "Oggi" dal giorno sbagliato.
 * I dati sono di un'azienda italiana e le date del database sono romane.
 */
function oggiRoma(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

// I conti si fanno a mezzanotte UTC. Un giorno UTC dura sempre 24 ore, mentre
// due volte l'anno un giorno romano ne dura 23 o 25: sommando giorni sull'ora
// locale, la notte del cambio d'ora si finisce sul giorno prima.
const daIso = (iso: string) => new Date(`${iso}T00:00:00Z`);
const aIso = (d: Date) => d.toISOString().slice(0, 10);

const piuGiorni = (d: Date, n: number) => {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};

/** Il lunedi' della settimana di questa data: in Italia la settimana parte da li'. */
const lunedi = (d: Date) => piuGiorni(d, -((d.getUTCDay() + 6) % 7));

const primoDelMese = (d: Date) => daIso(`${aIso(d).slice(0, 7)}-01`);

/**
 * Gli otto periodi, calcolati sulla data di oggi.
 *
 * I periodi in corso finiscono OGGI, non alla fine del periodo: "Mese corrente"
 * il 10 settembre va dal 1 al 10, non al 30. I numeri sarebbero gli stessi -
 * dati dal futuro non ce ne sono - ma una data finale nel futuro, letta in
 * cima alla pagina, fa dubitare di quello che si sta guardando.
 */
export function periodi(): Periodo[] {
  const oggi = daIso(oggiRoma());
  const ieri = piuGiorni(oggi, -1);

  const lunediQuesta = lunedi(oggi);
  const lunediScorsa = piuGiorni(lunediQuesta, -7);

  const primoQuesto = primoDelMese(oggi);
  const ultimoScorso = piuGiorni(primoQuesto, -1);

  const anno = oggi.getUTCFullYear();

  return [
    { value: "mese_corrente", label: "Mese corrente", from: aIso(primoQuesto), to: aIso(oggi) },
    {
      value: "mese_scorso",
      label: "Scorso mese",
      from: aIso(primoDelMese(ultimoScorso)),
      to: aIso(ultimoScorso)
    },
    {
      value: "settimana_corrente",
      label: "Settimana corrente",
      from: aIso(lunediQuesta),
      to: aIso(oggi)
    },
    {
      value: "settimana_scorsa",
      label: "Scorsa settimana",
      from: aIso(lunediScorsa),
      to: aIso(piuGiorni(lunediQuesta, -1))
    },
    { value: "oggi", label: "Oggi", from: aIso(oggi), to: aIso(oggi) },
    { value: "ieri", label: "Ieri", from: aIso(ieri), to: aIso(ieri) },
    { value: "anno_corrente", label: "Anno corrente", from: `${anno}-01-01`, to: aIso(oggi) },
    { value: "anno_scorso", label: "Anno scorso", from: `${anno - 1}-01-01`, to: `${anno - 1}-12-31` }
  ];
}
