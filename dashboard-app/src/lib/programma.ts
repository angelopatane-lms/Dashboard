// IL PROGRAMMA DI CUI SI E' PARLATO IN CALL, letto dalla registrazione.
//
// PERCHE' NON BASTA LA CAMPAGNA. La campagna dice da dove arriva il contatto,
// non che cosa gli e' stato proposto. Misurato su 85 consulenze registrate: i
// Dipendenti Artificiali vengono nominati in 22, e solo 11 di quelle hanno la
// campagna Imprenditoria - le altre arrivano da MBE (7), REM (2), Diventa Coach
// (1) e ICMD (1). Su meta' delle consulenze in cui si vende quel prodotto, la
// campagna direbbe un'altra cosa.
//
// IL SEGNALE PIU' NETTO SONO I NOMI PROPRI. I dipendenti artificiali si
// chiamano Cesare, Oriana e piu' raramente Guglielmo: nominarli e' un indizio
// che nessun'altra linea puo' produrre per caso, mentre parole come
// "imprenditore" o "marketing" ricorrono in qualunque consulenza. La prima
// versione di questo conteggio cercava "imprenditor" e classificava come
// Imprenditoria una call su tre.
//
// QUANDO NON SI CAPISCE SI TACE. In 35 call su 85 - il 41% - nessun programma
// viene nominato in modo riconoscibile: si parla del problema del cliente, dei
// suoi numeri, del metodo, senza mai dire il nome del prodotto. In quei casi
// questa funzione restituisce null e chi la chiama resta con la campagna, che
// e' un'informazione piu' debole ma dichiarata come tale.

/** Basta il testo: chi lo dice non cambia di che programma si sta parlando. */
export type FraseDetta = { testo: string };

/**
 * Le parole che nominano un programma, con quante volte devono comparire.
 *
 * LA SOGLIA NON E' UNA SOLA. Un nome proprio detto tre volte e' una
 * conversazione su quel prodotto; la parola "asta" richiede molte piu'
 * occorrenze perche' compare anche in una consulenza REM che parla d'altro, e
 * perche' un cliente puo' citarla di sfuggita. Le soglie sono state scelte sui
 * dati veri: con queste, le call riconosciute come REM hanno campagna REM nel
 * 96% dei casi (25 su 26).
 */
const SEGNALI: Array<{ programma: string; re: RegExp; soglia: number }> = [
  // I nomi dei dipendenti artificiali e il nome del prodotto.
  //
  // SI CHIAMA COME LO CHIAMANO IN CALL, non come si chiama la categoria.
  // "Imprenditoria" e' l'etichetta della linea di campagne, e qui si dice di
  // che cosa hanno parlato: se l'advisor ha argomentato Cesare e Oriana, ha
  // argomentato i Dipendenti Artificiali.
  { programma: "Dipendenti Artificiali", re: /\bcesare\b|\boriana\b|\bgu?glielmo\b|dipendent[ei] artificial[ei]|agenti artificiali|vendite artificiali|marketing artificiale/gi, soglia: 3 },
  { programma: "REM", re: /\brem\s?2|real estate master|aste immobiliar|\bflipping\b/gi, soglia: 2 },
  { programma: "REM", re: /\basta\b|\baste\b|immobil/gi, soglia: 15 },
  { programma: "ICMD", re: /\bicmd\b|io creo il mio destino/gi, soglia: 3 },
  { programma: "MBE", re: /\bmbe\b|business expert/gi, soglia: 3 },
  { programma: "MEP", re: /\bmep\b|eccellenza personale/gi, soglia: 3 },
  { programma: "DIV COACH", re: /diventa coach|life coach/gi, soglia: 3 },
  { programma: "ADE", re: /arte di educare/gi, soglia: 3 }
];

/**
 * Il programma di cui si e' parlato, o null quando la call non lo nomina.
 *
 * Vince chi supera la propria soglia di piu', in proporzione: cosi' un nome
 * proprio detto sei volte batte "asta" detta venti, che e' la soglia piu' alta
 * proprio perche' quella parola vale meno.
 */
export function programmaDallaConversazione(frasi: FraseDetta[]): string | null {
  const testo = frasi.map((f) => f.testo).join(" ");
  if (testo.trim().length < 200) return null;

  let miglior: { programma: string; forza: number } | null = null;
  for (const s of SEGNALI) {
    const quante = (testo.match(s.re) ?? []).length;
    if (quante < s.soglia) continue;
    const forza = quante / s.soglia;
    if (!miglior || forza > miglior.forza) miglior = { programma: s.programma, forza };
  }
  return miglior?.programma ?? null;
}
