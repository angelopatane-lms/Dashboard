"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CHATTER_DATI_ATTESI, eChatter, INTESTAZIONI_CHATTER } from "@/lib/chatter";
import { eAdvisorTelefonico } from "@/lib/statiLead";
import type { OperatorSummary } from "@/lib/analytics";
import { formatInt, formatPct, formatEur } from "@/lib/format";
import {
  BLOCCATA,
  INTESTAZIONE_ANGOLO,
  INTESTAZIONE_FERMA,
  larghezzaColonnaNumeri,
  larghezzaColonnaTesto,
  LINEA_DESTRA,
  LINEA_SOTTO
} from "@/lib/tabelle";

function heatBg(value: number, max: number): string {
  if (max === 0 || value === 0) return "";
  const pct = Math.min(value / max, 1);
  return `rgba(14, 165, 233, ${(0.08 + pct * 0.35).toFixed(2)})`;
}

function rateBg(rate: number | null): string {
  if (rate === null || rate === 0) return "";
  const pct = Math.min(rate, 1);
  return `rgba(245, 158, 11, ${(0.1 + pct * 0.45).toFixed(2)})`;
}

/**
 * UNA PERCENTUALE NON PASSA IL 100%, nemmeno quando i numeri lo direbbero.
 *
 * Visto il 28 settembre: 400% di appuntamenti per un advisor con 4 appuntamenti
 * e una sola connessione registrata. Il numeratore e il denominatore vengono da
 * due posti diversi - gli appuntamenti da HubSpot, le connessioni dal foglio -
 * e quando le chiamate non vengono segnate il rapporto esplode. Mostrarlo com'e'
 * fa sembrare rotta la dashboard invece del dato che manca.
 *
 * Si taglia a 100, e la cella lo dice passandoci sopra col mouse: il valore
 * vero resta leggibile a chi va a cercarlo, senza sporcare la colonna per
 * tutti gli altri.
 */
function taglia(x: number | null): number | null {
  return x === null ? null : Math.min(x, 1);
}

function tassoPresa(appt: number, conn: number): number | null {
  return conn > 0 ? appt / conn : null;
}

/**
 * La cella dell'obiettivo, che si scrive dentro.
 *
 * UN COMPONENTE A PARTE, non un <input> dentro la riga, perche' mentre si
 * digita il valore vive qui: se lo tenesse la tabella, ogni tasto premuto
 * ridisegnerebbe tutte le righe e il cursore salterebbe. Cosi' la tabella
 * riceve la cifra una volta sola, quando si esce dalla cella o si preme Invio.
 *
 * SI SALVA USCENDO, non a ogni tasto: un obiettivo si digita in una volta, e
 * salvare a ogni carattere manderebbe otto richieste per scrivere "15000" -
 * l'ultima delle quali e' l'unica giusta.
 *
 * Invio conferma, Esc rimette il valore di prima. Niente pulsante: la colonna
 * ha la larghezza delle altre e un pulsante non ci starebbe senza stringere
 * tutto il resto.
 */
function CellaObiettivo({
  valore,
  mese,
  persona,
  salva,
  formatta
}: {
  valore: number | null;
  mese: string | null;
  persona: string;
  salva: (persona: string, mese: string, valore: number | null) => Promise<void> | void;
  formatta: (n: number) => string;
}) {
  const [testo, setTesto] = useState("");
  const [inModifica, setInModifica] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  // Se il valore cambia da fuori - un altro periodo, un ricaricamento - e non
  // si sta scrivendo, la cella si allinea. Mentre si scrive no: sovrascrivere
  // quello che si sta digitando e' il modo piu' rapido di far perdere un numero.
  useEffect(() => {
    if (!inModifica) setTesto(valore === null ? "" : String(valore));
  }, [valore, inModifica]);

  useEffect(() => {
    if (inModifica) campo.current?.select();
  }, [inModifica]);

  const conferma = async () => {
    setInModifica(false);
    const pulito = testo.trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
    const n = pulito === "" ? null : Number(pulito);
    // Niente da salvare se il numero e' lo stesso, o se non e' un numero.
    if (n !== null && !Number.isFinite(n)) {
      setTesto(valore === null ? "" : String(valore));
      return;
    }
    if (n === valore || (n === null && valore === null)) return;
    if (!mese) return;
    setSalvataggio(true);
    try {
      await salva(persona, mese, n);
    } finally {
      setSalvataggio(false);
    }
  };

  // Periodo su piu' mesi: si legge la somma e non si scrive.
  if (!mese) {
    return (
      <td
        className="border-r border-white px-2 py-1.5 text-right tabular-nums text-slate-500"
        title="Il periodo copre piu' mesi: scegli un mese solo per modificare l'obiettivo"
      >
        {valore !== null ? formatta(valore) : <span className="text-slate-400">–</span>}
      </td>
    );
  }

  return (
    <td className="border-r border-white p-0 text-right tabular-nums">
      {inModifica ? (
        <input
          ref={campo}
          value={testo}
          inputMode="decimal"
          onChange={(e) => setTesto(e.target.value)}
          onBlur={conferma}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void conferma();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setTesto(valore === null ? "" : String(valore));
              setInModifica(false);
            }
          }}
          className="w-full bg-sky-50 px-2 py-1.5 text-right tabular-nums outline-none ring-1 ring-inset ring-sky-400"
          placeholder="0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setInModifica(true)}
          // Sembra una cella, non un pulsante: e' una cella, si puo' solo anche
          // scrivere. Il tratteggio si vede passandoci sopra e dice che si tocca.
          className="w-full px-2 py-1.5 text-right tabular-nums hover:bg-sky-50 hover:underline hover:decoration-dotted"
          title={`Clicca per scrivere l'obiettivo di ${mese}`}
        >
          {salvataggio ? (
            <span className="text-slate-400">...</span>
          ) : valore !== null ? (
            formatta(valore)
          ) : (
            <span className="text-slate-300">–</span>
          )}
        </button>
      )}
    </td>
  );
}

function tassoChiusura(chius: number, cons: number): number | null {
  return cons > 0 ? chius / cons : null;
}

/**
 * Quanto dura una consulenza, in minuti.
 *
 * MISURATO, NON DECISO: 76 call registrate negli ultimi 21 giorni danno media
 * 45 minuti e mediana 46. La distribuzione e' larga - deviazione standard 26
 * minuti, il 26% sotto i venti e il 17% sopra i settanta - quindi questo numero
 * descrive bene il totale di un periodo e male la singola consulenza. Per una
 * colonna che confronta persone su decine di consulenze e' il totale che conta.
 *
 * PERCHE' NON LA DURATA DELLO SLOT PRENOTATO, che sembra il dato ovvio ed e'
 * quello che questa colonna usava fino a stamattina: gli slot non dicono quanto
 * e' durata la call. Uno slot da 30 minuti produce call di 48 minuti in media,
 * uno da 60 ne produce di 44 - cioe' la consulenza dura tre quarti d'ora
 * qualunque cosa dica il calendario. Contare gli slot sottostimava del 59% le
 * ore di chi prenota mezz'ora e le sovrastimava del 27% per chi prenota un'ora,
 * e quella distorsione cadeva esattamente lungo il confronto fra advisor che la
 * colonna esiste per fare.
 *
 * QUANDO LE REGISTRAZIONI COPRIRANNO TUTTI GLI ADVISOR questa costante va
 * sostituita dalla durata vera, che nel frattempo viene gia' salvata in
 * presenza_call.durata_min: sara' un cambio di denominatore, non di colonna.
 */
const MINUTI_PER_CONSULENZA = 45;

/**
 * Quanto incassa un advisor per ogni ora di consulenza.
 *
 * Le ore sono stimate dal numero di consulenze, non misurate una per una: vedi
 * MINUTI_PER_CONSULENZA per il perche' e per la misura che lo giustifica.
 */
function resaOraria(incasso: number, consulenze: number): number | null {
  const ore = (consulenze * MINUTI_PER_CONSULENZA) / 60;
  return ore > 0 ? incasso / ore : null;
}

/** Come si legge in cella: "1.240 €/h". L'unita' sta qui e non
 *  nell'intestazione, cosi' il titolo resta una parola sola. */
const formatResa = (v: number): string => `${Math.round(v).toLocaleString("it-IT")} €/h`;

// Serve solo a dare la larghezza alle colonne, che e' quella dell'intestazione
// piu' lunga. I titoli veri, con il campo su cui ordinano, si costruiscono
// dentro il componente: due di loro cambiano fra Advisor e Setter.
const INTESTAZIONI_NUMERI = [
  "Assegnati",
  "Chiamate",
  "Connessioni",
  // I titoli che prendono il loro posto con il filtro Team su "Chatter":
  // "Conversazioni" e' piu' lungo di "Connessioni", e senza metterlo qui la
  // colonna si stringerebbe mandandolo a capo.
  ...Object.values(INTESTAZIONI_CHATTER),
  "Appuntamenti",
  "% Appuntamento",
  // Queste due compaiono solo sulla pagina Setter, ma la larghezza si calcola
  // una volta sola per tutte e due le tabelle: lasciarle fuori faceva andare a
  // capo l'intestazione piu' lunga.
  "No Show",
  "% Consulenza",
  "Consulenze",
  "Chiusure",
  "% Chiusura",
  "Boom",
  "Obiettivo",
  "Resa"
];
const LARGHEZZA_NUMERI = larghezzaColonnaNumeri(INTESTAZIONI_NUMERI);

export default function OperatorStatsTable({
  data,
  hubspotOverrides,
  noShowOverrides,
  svolteOverrides,
  consulenzeFuoriCrm,
  meseObiettivo,
  onSalvaObiettivo,
  onApriTeam,
  sottoTeamPerPersona,
  telefonici,
  trattativeOverrides,
  precomputedTotals,
  hubspotLoading,
  trattativeLoading,
  operatorLabel = "Advisor",
  obiettivi
}: {
  data: OperatorSummary[];
  hubspotOverrides?: Record<string, { chiusure: number; boom: number; incassoChiusure: number }>;
  /**
   * Gli appuntamenti disertati per setter, dal database.
   *
   * Sostituisce la colonna "No Show" del foglio Operatori, che e' ferma a zero
   * dal 19 agosto 2026: lo script di Apps Script che la riempiva cerca un
   * valore HubSpot rinominato nel frattempo. Il foglio perde anche giorni
   * interi quando il trigger giornaliero non parte, e non li recupera mai.
   *
   * Chiave: nome del setter minuscolo e con gli spazi normalizzati, la stessa
   * di hubspotOverrides.
   */
  noShowOverrides?: Record<string, number>;
  /**
   * Le consulenze svolte nate dagli appuntamenti di quel setter, dal database.
   *
   * Serve al denominatore di "% Chiusura" sulla pagina Setter. La colonna
   * Consulenze del foglio Operatori non va bene: attribuisce la consulenza
   * all'Advisor che la tiene, quindi per chi fa solo il setter vale zero -
   * misurato a settembre, otto persone con appuntamenti e zero consulenze, fra
   * cui chi ne aveva fissati 102 - e la percentuale diventava un trattino.
   */
  svolteOverrides?: Record<string, number>;
  /**
   * Le consulenze che sul CRM non esistono: call registrate senza nessun
   * appuntamento, contate per advisor.
   *
   * Si sommano alla colonna Consulenze, che arriva dal foglio Operatori e per
   * forza di cose non le conosce - senza appuntamento non c'e' niente da
   * contare. Finivano in agenda e non qui, e le due pagine davano numeri
   * diversi sullo stesso giorno.
   */
  consulenzeFuoriCrm?: Record<string, number>;
  /**
   * Appuntamenti e Consulenze di chi lavora solo al telefono, dagli Stati Lead.
   *
   * Quattro advisor seguono il low ticket senza fissare videochiamate: niente
   * appuntamento sul calendario, quindi nessuna trattativa da cui contare, e
   * le due colonne mostravano zero su persone che a settembre hanno chiuso
   * 8, 32, 21 e 13 vendite. Per le LORO righe questi numeri sostituiscono
   * quelli soliti; per tutti gli altri non cambia niente.
   */
  telefonici?: Record<string, { appuntamenti: number; consulenze: number }>;
  trattativeOverrides?: Record<string, number>;
  precomputedTotals?: { chiusure: number; boom: number };
  hubspotLoading?: boolean;
  trattativeLoading?: boolean;
  operatorLabel?: string;
  /** L'obiettivo di Boom del mese, per persona, con la stessa chiave di nome
   *  degli altri valori che arrivano da fuori.
   *
   *  Oggi non lo alimenta nessuno e la colonna mostra trattini: si riempira'
   *  da un modulo, e l'obiettivo si fissa a inizio mese e resta fermo fino al
   *  mese dopo. Il trattino e' voluto: uno zero si leggerebbe come "obiettivo
   *  zero", che e' un'altra cosa da "non ancora fissato". */
  obiettivi?: Record<string, number>;
  /**
   * Il mese su cui si sta scrivendo, "AAAA-MM", oppure null.
   *
   * Null vuol dire che il periodo scelto copre piu' mesi: la colonna mostra la
   * somma e non si lascia scrivere, perche' un numero digitato su "luglio piu'
   * agosto" non si sa a quale dei due appartenga.
   */
  meseObiettivo?: string | null;
  /** Salva la cifra digitata. Senza questa la colonna resta di sola lettura. */
  onSalvaObiettivo?: (persona: string, mese: string, valore: number | null) => Promise<void> | void;
  /** Apre la finestra dei team per una persona. Assente = nome non cliccabile. */
  onApriTeam?: (nome: string) => void;
  /**
   * Il sotto-team di ciascuno, per nome normalizzato.
   *
   * Assente - pagine pubbliche, vista Setter - e la tabella si divide come
   * prima, sui nomi scritti nel codice. Presente, le sezioni seguono
   * l'appartenenza vera su HubSpot.
   */
  sottoTeamPerPersona?: Record<string, string>;
}) {
  const isSetterView = operatorLabel === "Setter";
  /**
   * In tabella ci sono SOLO chatter: e' il filtro Team su "Chatter".
   *
   * Si guarda chi c'e' invece del filtro perche' la tabella il filtro non lo
   * conosce - riceve gia' le righe scremate - e perche' cosi' vale anche se un
   * domani le righe arrivassero da un'altra strada. `data.length` nel conto
   * evita che una tabella vuota passi per una tabella di chatter: `every` su
   * zero elementi e' vero.
   */
  const soloChatter = isSetterView && data.length > 0 && data.every((r) => eChatter(r.operatore));
  const titolo = (nome: string) => (soloChatter ? INTESTAZIONI_CHATTER[nome] ?? nome : nome);
  const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  // Il foglio resta il ripiego: se il database non risponde la colonna mostra
  // il vecchio numero invece di azzerarsi, e per i mesi in cui il foglio era
  // ancora buono i due valori sono confrontabili.
  const effNoShow = (r: OperatorSummary) => noShowOverrides?.[normKey(r.operatore)] ?? r.noShow;
  // Sulla pagina Setter il denominatore sono le consulenze che i SUOI
  // appuntamenti hanno prodotto; su quella Advisor restano le sue, dal foglio.
  // LE CONSULENZE DI UN ADVISOR: quelle del foglio piu' quelle che sul CRM non
  // esistono. Sulla pagina Setter non si sommano: li' la colonna conta un'altra
  // cosa, e una call senza appuntamento non ha un setter a cui attribuirla.
  /**
   * CHI LAVORA AL TELEFONO: IL MAGGIORE FRA LE DUE FONTI, non la sostituzione.
   *
   * PERCHE' NON SI SOMMA. Le due fonti si sovrappongono - misurato fra il 20 e
   * il 55% delle consulenze - ma la sovrapposizione non si puo' togliere: il
   * foglio Operatori e' aggregato per (data, operatore, campagna) e non porta
   * nessun id di contatto, quindi non c'e' niente su cui deduplicare. Sommare
   * conterebbe due volte le stesse consulenze senza che si veda.
   *
   * PERCHE' NON SI SOSTITUISCE PIU'. Fino al 9 ottobre 2026 il numero ricavato
   * dal CRM prendeva il posto dell'altro. Andava bene finche' erano i quattro
   * che trattative non ne hanno; allargando al team, a Roberto Esposito sarebbe
   * rimasta 2 al posto di 11 - cioe' nove consulenze cancellate.
   *
   * IL MAGGIORE NON SBAGLIA IN NESSUNA DELLE DUE DIREZIONI PERICOLOSE: non
   * raddoppia mai e non toglie mai niente. Resta un numero per difetto quando
   * ciascuna fonte vede cose che l'altra non ha, e va bene cosi': fra un
   * conteggio prudente e uno gonfiato, il primo si corregge, il secondo no.
   * Per i quattro di sempre il foglio vale zero, quindi vince il CRM e i loro
   * numeri restano quelli di prima.
   */
  const effConsulenze = (r: OperatorSummary) => {
    const base = r.consulenze + (isSetterView ? 0 : consulenzeFuoriCrm?.[normKey(r.operatore)] ?? 0);
    const tel = telefonici?.[normKey(r.operatore)];
    if (tel && !isSetterView) return Math.max(base, tel.consulenze);
    return base;
  };

  const effConsulenzeChiusura = (r: OperatorSummary) =>
    isSetterView ? svolteOverrides?.[normKey(r.operatore)] ?? 0 : effConsulenze(r);
  const effChiusure = (r: OperatorSummary) => hubspotOverrides?.[normKey(r.operatore)]?.chiusure ?? 0;
  const effBoom = (r: OperatorSummary) => hubspotOverrides?.[normKey(r.operatore)]?.boom ?? 0;
  /**
   * L-incasso delle sole CHIUSURE, che e il numeratore della Resa.
   *
   * Non si usa Boom perche quello comprende rate e upgrade: denaro che arriva
   * su una vendita conclusa mesi prima, spesso da una consulenza tenuta da un
   * altro advisor. Dividerlo per le ore di questo mese accosterebbe un ricavo a
   * un lavoro che non lo ha prodotto. Misurato su settembre: le rate sono il
   * 20% dell-incassato, e su una persona sola valevano 9.250 EUR su 21.750.
   */
  const effIncassoChiusure = (r: OperatorSummary) =>
    hubspotOverrides?.[normKey(r.operatore)]?.incassoChiusure ?? 0;
  /** Stessa regola delle consulenze: il maggiore, mai la somma. Qui l'altra
   *  fonte sono le trattative, una per appuntamento, e chi lavora al telefono
   *  non ne ha - per loro vale il CRM, come prima. */
  const effAppuntamenti = (r: OperatorSummary) => {
    const base = trattativeOverrides?.[normKey(r.operatore)] ?? 0;
    const tel = telefonici?.[normKey(r.operatore)];
    if (tel && !isSetterView) return Math.max(base, tel.appuntamenti);
    return base;
  };
  const effObiettivo = (r: OperatorSummary): number | null =>
    obiettivi?.[normKey(r.operatore)] ?? null;

  const totals = useMemo(() => {
    const base = data.reduce(
      (acc, r) => ({
        assegnati: acc.assegnati + r.assegnati,
        chiamate: acc.chiamate + r.chiamate,
        connessioni: acc.connessioni + r.connessioni,
        appuntamenti: acc.appuntamenti + effAppuntamenti(r),
        consulenze: acc.consulenze + (isSetterView ? effNoShow(r) : effConsulenze(r)),
        svolte: acc.svolte + effConsulenzeChiusura(r),
        chiusure: acc.chiusure + effChiusure(r),
        boom: acc.boom + effBoom(r),
        obiettivo: acc.obiettivo + (effObiettivo(r) ?? 0)
      }),
      { assegnati: 0, chiamate: 0, connessioni: 0, appuntamenti: 0, consulenze: 0, svolte: 0, chiusure: 0, boom: 0, obiettivo: 0 }
    );
    return {
      ...base,
      // Null quando nessuno ha un obiettivo: sommare zeri e scrivere "0 EUR"
      // direbbe che l'obiettivo del mese e' zero.
      obiettivo: data.some((r) => effObiettivo(r) !== null) ? base.obiettivo : null,
      chiusure: precomputedTotals?.chiusure ?? base.chiusure,
      boom: precomputedTotals?.boom ?? base.boom
    };
  }, [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides, consulenzeFuoriCrm, telefonici, precomputedTotals, obiettivi]);

  const maxValues = useMemo(
    () => ({
      assegnati: Math.max(...data.map((r) => r.assegnati), 1),
      chiamate: Math.max(...data.map((r) => r.chiamate), 1),
      connessioni: Math.max(...data.map((r) => r.connessioni), 1),
      appuntamenti: Math.max(...data.map((r) => effAppuntamenti(r)), 1),
      consulenze: Math.max(...data.map((r) => (isSetterView ? effNoShow(r) : effConsulenze(r))), 1),
      svolte: Math.max(...data.map((r) => effConsulenzeChiusura(r)), 1),
      chiusure: Math.max(...data.map((r) => effChiusure(r)), 1),
      boom: Math.max(...data.map((r) => effBoom(r)), 1),
      resa: Math.max(...data.map((r) => resaOraria(effIncassoChiusure(r), effConsulenze(r)) ?? 0), 1)
    }),
    [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides, telefonici]
  );


  const sorted = useMemo(
    () => [...data].sort((a, b) => effBoom(b) - effBoom(a) || effAppuntamenti(b) - effAppuntamenti(a)),
    [data, hubspotOverrides, trattativeOverrides, noShowOverrides, svolteOverrides, telefonici]
  );

  /**
   * Le nove colonne dei numeri: titolo e valore su cui ordina il suo click.
   *
   * Stanno qui e non fuori dal componente perche' i valori dipendono da quello
   * che arriva da HubSpot - appuntamenti e chiusure sostituiti riga per riga -
   * e perche' una colonna cambia nome fra Advisor e Setter.
   */
  const colonne: Array<{ label: string; valore: (r: OperatorSummary) => number | null }> = [
    // I primi tre titoli cambiano quando si guarda il solo gruppo chat: il
    // perche' sta in INTESTAZIONI_CHATTER. L'etichetta e' anche la chiave
    // dell'ordinamento, quindi cambia da sola anche quella e non serve altro.
    { label: titolo("Assegnati"), valore: (r) => r.assegnati },
    { label: titolo("Chiamate"), valore: (r) => r.chiamate },
    { label: titolo("Connessioni"), valore: (r) => r.connessioni },
    { label: "Appuntamenti", valore: (r) => effAppuntamenti(r) },
    { label: "% Appuntamento", valore: (r) => taglia(tassoPresa(effAppuntamenti(r), r.connessioni)) },
    {
      label: isSetterView ? "No Show" : "Consulenze",
      valore: (r) => (isSetterView ? effNoShow(r) : effConsulenze(r))
    },
    // LE CONSULENZE DEL SETTER, e quante ne ha prodotte ogni appuntamento.
    //
    // Solo qui: sulla pagina Advisor la colonna Consulenze c'e' gia' - e' la
    // sesta, quella che cambia nome - e sono le sue, dal foglio. Queste sono le
    // consulenze tenute dagli Advisor sugli appuntamenti che LUI ha procurato,
    // e stanno fra No Show e Chiusure perche' e' l'ordine in cui si legge
    // l'imbuto: fissati, disertati, svolti, chiusi.
    ...(isSetterView
      ? [
          { label: "Consulenze", valore: (r: OperatorSummary) => effConsulenzeChiusura(r) },
          {
            label: "% Consulenza",
            // Degli appuntamenti che ha fissato, quanti si sono tenuti. E' il
            // suo tasso di presentazione, la misura di quanto qualifica bene.
            valore: (r: OperatorSummary) => taglia(tassoPresa(effConsulenzeChiusura(r), effAppuntamenti(r)))
          }
        ]
      : []),
    { label: "Chiusure", valore: (r) => effChiusure(r) },
    { label: "% Chiusura", valore: (r) => taglia(tassoChiusura(effChiusure(r), effConsulenzeChiusura(r))) },
    { label: "Boom", valore: (r) => effBoom(r) }
  ];

  // LA RESA SOLO AGLI ADVISOR. E' incasso diviso ore di consulenza, e le ore in
  // stanza sono le loro: un setter non ne fa nessuna, quindi la colonna
  // dividerebbe per zero.
  if (!isSetterView) {
    colonne.push({ label: "Resa", valore: (r) => resaOraria(effIncassoChiusure(r), effConsulenze(r)) });
  }

  // L'OBIETTIVO STA SU ENTRAMBE LE PAGINE, E ULTIMO. E' il traguardo di Boom
  // del mese - si fissa il primo giorno e resta fermo - e i setter il Boom lo
  // portano quanto gli Advisor lo chiudono. In fondo perche' e' l'unica colonna
  // che si scrive invece di leggersi: in mezzo alle altre si cliccherebbe per
  // sbaglio scorrendo la tabella.
  colonne.push({ label: "Obiettivo", valore: (r) => effObiettivo(r) });

  // La colonna su cui si sta ordinando. Vuota vuol dire ordine di partenza -
  // per Boom, poi per appuntamenti - e non viene ricordata da nessuna parte,
  // quindi ogni ricaricamento riporta la tabella li'.
  const [ordina, setOrdina] = useState<string | null>(null);
  const colonnaOrdinata = colonne.find((c) => c.label === ordina);
  // Le celle vuote - una percentuale senza denominatore - vanno in fondo:
  // trattarle come zero le metterebbe in mezzo ai valori bassi veri.
  const righe = colonnaOrdinata
    ? [...sorted].sort(
        (a, b) => (colonnaOrdinata.valore(b) ?? -Infinity) - (colonnaOrdinata.valore(a) ?? -Infinity)
      )
    : sorted;

  /**
   * DUE GRUPPI, UNA TABELLA SOLA.
   *
   * Quattro advisor seguono il low ticket solo al telefono: i loro Appuntamenti
   * e Consulenze non sono appuntamenti a calendario ma stati lead, e il
   * prodotto che vendono ha un valore per vendita molto piu' basso. Stessa
   * colonna, due mestieri.
   *
   * L'ORDINAMENTO RESTA DENTRO IL GRUPPO, e non e' un dettaglio estetico: e'
   * l'unica cosa che impedisce davvero di comporre la classifica sbagliata.
   * Un'etichetta o un colore avvisano, e gli avvisi si ignorano; qui invece
   * cliccando su una colonna si ordina dentro ciascun blocco e mai attraverso,
   * quindi un advisor telefonico non puo' finire sopra uno con videochiamata
   * nemmeno per sbaglio.
   *
   * LA SEPARAZIONE E' UNA RIGA VUOTA e non un'intestazione: con i filtri
   * attivi un'intestazione puo' ritrovarsi ad annunciare un gruppo rimasto
   * senza righe, e una riga bianca invece sparisce da sola quando non c'e'
   * niente da separare.
   */
  // CHI VA IN FONDO DIPENDE DALLA PAGINA: sulla Advisor il Team Eventi, che
  // lavora il low ticket al telefono; sulla Setter i chatter, che fissano dalla
  // chat invece che chiamando. In entrambi i casi e' un mestiere diverso dagli
  // altri della stessa tabella, non una prestazione diversa.
  const inFondo = isSetterView ? eChatter : eAdvisorTelefonico;

  /**
   * Il sotto-team che va per ultimo: fa un MESTIERE diverso dagli altri della
   * stessa tabella, non una prestazione diversa. Sulla pagina Advisor e' Eventi,
   * che lavora il low ticket al telefono senza fissare videochiamate; sulla
   * Setter sono i chatter, che fissano dalla chat invece che chiamando.
   */
  const ULTIMO_GRUPPO = isSetterView ? "Chatter" : "Eventi";

  /**
   * Le sezioni della tabella, dall'appartenenza vera su HubSpot.
   *
   * PRIMA ERANO DUE E NASCEVANO DA UN ELENCO DI NOMI scritto nel codice. Quei
   * nomi erano quattro, mentre i numeri della stessa tabella ormai arrivavano
   * dagli otto del team: la riga di una persona poteva stare nel gruppo di
   * sopra e avere i numeri di quello di sotto. Adesso la sezione e il numero
   * rispondono alla stessa domanda.
   *
   * SENZA SOTTO-TEAM VENGONO PRIMI, perche' sono il grosso e il caso normale.
   */
  const sottoDi = (nome: string) => sottoTeamPerPersona?.[normKey(nome)] ?? "";
  const gruppi: Array<{ etichetta: string | null; righe: typeof righe }> = (() => {
    if (!sottoTeamPerPersona) {
      return [
        { etichetta: null, righe: righe.filter((r) => !inFondo(r.operatore)) },
        { etichetta: null, righe: righe.filter((r) => inFondo(r.operatore)) }
      ].filter((g) => g.righe.length);
    }
    const nomi = [...new Set(righe.map((r) => sottoDi(r.operatore)).filter(Boolean))].sort((a, b) =>
      a === ULTIMO_GRUPPO ? 1 : b === ULTIMO_GRUPPO ? -1 : a.localeCompare(b)
    );
    return [
      { etichetta: null, righe: righe.filter((r) => !sottoDi(r.operatore)) },
      ...nomi.map((s) => ({ etichetta: s, righe: righe.filter((r) => sottoDi(r.operatore) === s) }))
    ].filter((g) => g.righe.length);
  })();

  const ordinate = gruppi.flatMap((g) => g.righe);
  // Dove comincia ogni sezione, e come si chiama. Il primo gruppo non apre
  // niente: una linea in cima alla tabella separerebbe dall'intestazione.
  // La separazione ha senso solo quando i gruppi sono piu' di uno: con il
  // filtro Team su un gruppo solo sarebbe una linea che non separa niente.
  const apre = new Map<string, string | null>();
  for (const g of gruppi.slice(1)) apre.set(g.righe[0].operatore, g.etichetta);

  const totalTp = tassoPresa(totals.appuntamenti, totals.connessioni);
  // Sulla vista Setter il totale era soppresso perche' il denominatore era
  // zero. Ora c'e': sono le consulenze svolte, la stessa somma che la colonna
  // Consulenze mostra in fondo.
  const totalTc = tassoChiusura(totals.chiusure, isSetterView ? totals.svolte : totals.consulenze);
  // Come le altre percentuali del totale: il rapporto fra le somme, non la
  // media dei rapporti, che darebbe lo stesso peso a chi ha fissato due
  // appuntamenti e a chi ne ha fissati cento.
  const totalPc = tassoPresa(totals.svolte, totals.appuntamenti);
  const resaTotale = resaOraria(
    sorted.reduce((s, r) => s + effIncassoChiusure(r), 0),
    totals.consulenze
  );

  if (!data.length) return null;

  // Stessa griglia della tabella Campagne, e stesse ragioni: le nove colonne dei
  // numeri hanno tutte la stessa larghezza, ricavata dall'intestazione piu'
  // lunga, e la colonna del nome si dimensiona sul nome piu' lungo presente.
  //
  // Le misure sono in pixel e non in percentuale perche' su un telefono una
  // tabella a percentuali schiaccerebbe dieci colonne dentro 375 pixel,
  // rendendole illeggibili. Cosi' invece la tabella scorre - ed e' il motivo per
  // cui la prima colonna e' bloccata: scorrendo verso Boom si continua a vedere
  // di chi sono i numeri che si stanno leggendo.
  const larghezzaNome = larghezzaColonnaTesto(
    [operatorLabel, ...sorted.map((r) => r.operatore)],
    120,
    320,
    14
  );
  const larghezzaTotale = larghezzaNome + colonne.length * LARGHEZZA_NUMERI;

  return (
    // Il tetto d'altezza serve alla riga delle intestazioni per restare ferma:
    // vedi INTESTAZIONE_FERMA. Qui le righe sono poche e quasi sempre ci stanno
    // tutte, quindi il piu' delle volte non si vede nemmeno la barra.
    <div className="max-h-[75vh] overflow-auto">
      {/* width al 100% con un minimo: su schermo largo le colonne crescono in
          proporzione restando uguali fra loro, su schermo stretto si scorre. */}
      <table
        className="table-fixed border-collapse text-sm"
        style={{ width: "100%", minWidth: larghezzaTotale }}
      >
        {/* LARGHEZZE IN PERCENTUALE, non in pixel.
            Le proporzioni sono le stesse di prima - ogni quota e' la sua
            larghezza in pixel divisa per il totale - quindi alla larghezza
            minima le colonne misurano esattamente quanto misuravano: 158px il
            nome, LARGHEZZA_NUMERI le altre. La differenza e' oltre quella
            soglia: in pixel la tabella si fermava li' e avanzava una striscia
            bianca a destra, in percentuale cresce tutta insieme e riempie.
            Il difetto c'era su entrambe le pagine, ma si vedeva solo sulla
            Advisor: dodici colonne fanno 1610px, mentre la Setter con una in
            piu' arriva a 1765 e il contenitore lo riempie quasi tutto. */}
        <colgroup>
          <col style={{ width: `${(larghezzaNome / larghezzaTotale) * 100}%` }} />
          {colonne.map((_, i) => (
            <col key={i} style={{ width: `${(LARGHEZZA_NUMERI / larghezzaTotale) * 100}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th
              className={`${INTESTAZIONE_ANGOLO} ${LINEA_SOTTO} bg-white py-2 pr-4 pl-0 text-left`}
              style={{ left: 0 }}
            >
              {operatorLabel}
            </th>
            {colonne.map((c) => {
              const attiva = ordina === c.label;
              return (
                <th
                  key={c.label}
                  onClick={() => setOrdina((prima) => (prima === c.label ? null : c.label))}
                  title={
                    attiva ? "Torna all'ordine di partenza" : `Ordina per ${c.label}, dal piu' grande`
                  }
                  // La colonna su cui si ordina si riconosce dal fondo grigio e
                  // dal testo nero. Niente frecce: le colonne sono larghe
                  // quanto la loro intestazione, e una freccia in piu' le
                  // avrebbe allargate tutte per servirne una.
                  // whitespace-nowrap: la colonna e' larga quanto la sua
                  // intestazione, quindi andare a capo non serve a niente e
                  // sfalsa l'altezza della riga dei titoli.
                  className={`${INTESTAZIONE_FERMA} ${LINEA_SOTTO} cursor-pointer select-none whitespace-nowrap px-2 py-2 leading-tight transition hover:text-black ${
                    attiva ? "bg-neutral-100 text-black" : "bg-white"
                  }`}
                >
                  {c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ordinate.map((r) => {
            const apreSezione = apre.has(r.operatore);
            const etichettaSezione = apre.get(r.operatore) ?? null;
            const tp = tassoPresa(effAppuntamenti(r), r.connessioni);
            const tc = tassoChiusura(effChiusure(r), effConsulenzeChiusura(r));
            // Quanti dei suoi appuntamenti si sono tenuti. Il denominatore sono
            // gli appuntamenti, quindi dipende dal caricamento delle trattative
            // e non da quello degli incassi.
            const pc = tassoPresa(effConsulenzeChiusura(r), effAppuntamenti(r));
            return (
              <Fragment key={r.operatore}>
              {/* LA SEPARAZIONE E' UNA LINEA, e porta il nome della sezione
                  solo da quando le sezioni possono essere piu' di due: con due
                  gruppi la linea bastava - sopra gli altri, sotto quelli di un
                  altro mestiere - mentre con tre una linea muta diventa un
                  indovinello. Non e' un'intestazione di colonne: non ripete i
                  titoli e non si puo' cliccare. Se un filtro lascia la sezione
                  senza righe, sparisce insieme a loro.

                  Il bordo sta sulle celle e non sul <tr> perche' `divide-y` sul
                  corpo della tabella imposta il bordo dei figli con una
                  specificita' piu' alta. */}
              {apreSezione ? (
                <tr {...(etichettaSezione ? {} : { "aria-hidden": "true" })}>
                  <td
                    className={`${BLOCCATA} ${LINEA_DESTRA} border-t-2 border-slate-300 bg-white pt-2 pr-4 pb-0.5 pl-0 text-[10px] font-semibold tracking-wide text-slate-400 uppercase`}
                    style={{ left: 0 }}
                  >
                    {etichettaSezione}
                  </td>
                  <td colSpan={29} className="border-t-2 border-slate-300 p-0" />
                </tr>
              ) : null}
              <tr className="group hover:bg-slate-50/70 transition-colors">
                <td
                  /* I MARGINI PASSANO AL PULSANTE quando il nome si puo'
                     cliccare: cosi' riempie la cella e il grigio copre tutta
                     la casella, non solo le lettere. Tenendoli qui, il
                     passaggio del mouse avrebbe colorato un rettangolino
                     attorno al testo con dei bordi bianchi intorno. Il p-0
                     serve: una cella di tabella nasce con un pixel di padding
                     per conto suo, e quel pixel restava bianco tutt'intorno. */
                  className={`${BLOCCATA} ${LINEA_DESTRA} bg-white font-medium text-slate-800 whitespace-nowrap group-hover:bg-slate-50${onApriTeam ? " p-0" : " py-1.5 pr-4 pl-0"}`}
                  style={{ left: 0 }}
                >
                  {/* IL NOME SI CLICCA SOLO DOVE SERVE: la finestra dei team
                      arriva come funzione, e dove non viene passata - pagine
                      pubbliche, vista Setter - resta il testo di prima. Cosi'
                      non c'e' un comando visibile a chi non puo' usarlo. */}
                  {onApriTeam ? (
                    /* IL GRIGIO AL PASSAGGIO DEL MOUSE, e nient'altro. Il blu
                       sottolineato prometteva una pagina da aprire, e qui
                       invece si apre una finestra che cambia i team; un bordo
                       disegnato attorno al nome, provato prima, faceva rumore
                       su diciannove righe. */
                    <button
                      type="button"
                      onClick={() => onApriTeam(r.operatore)}
                      className="block h-full w-full cursor-pointer py-1.5 pr-4 pl-0 text-left transition-colors hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-400"
                      title={`Team di ${r.operatore} su HubSpot`}
                    >
                      {r.operatore}
                    </button>
                  ) : (
                    r.operatore
                  )}
                </td>
                {/* Sotto i titoli nuovi un trattino, non il numero di HubSpot:
                    vedi CHATTER_DATI_ATTESI. Nella vista mista i titoli sono
                    ancora quelli del telefono e il numero e' la risposta
                    giusta alla domanda che pongono. */}
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: soloChatter ? undefined : heatBg(r.assegnati, maxValues.assegnati) }}
                  title={soloChatter ? CHATTER_DATI_ATTESI : undefined}
                >
                  {soloChatter ? <span className="text-slate-400">–</span> : formatInt(r.assegnati)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: soloChatter ? undefined : heatBg(r.chiamate, maxValues.chiamate) }}
                  title={soloChatter ? CHATTER_DATI_ATTESI : undefined}
                >
                  {soloChatter ? <span className="text-slate-400">–</span> : formatInt(r.chiamate)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: soloChatter ? undefined : heatBg(r.connessioni, maxValues.connessioni) }}
                  title={soloChatter ? CHATTER_DATI_ATTESI : undefined}
                >
                  {soloChatter ? <span className="text-slate-400">–</span> : formatInt(r.connessioni)}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: trattativeLoading ? undefined : heatBg(effAppuntamenti(r), maxValues.appuntamenti) }}
                >
                  {trattativeLoading ? <span className="text-slate-400">–</span> : formatInt(effAppuntamenti(r))}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: rateBg(taglia(tp)) }}
                  title={
                    tp !== null && tp > 1
                      ? `${formatInt(effAppuntamenti(r))} appuntamenti su ${formatInt(r.connessioni)} connessioni: le chiamate non risultano registrate sul foglio. Valore reale ${formatPct(tp, 2)}.`
                      : undefined
                  }
                >
                  {tp !== null ? formatPct(taglia(tp) as number, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: heatBg(isSetterView ? effNoShow(r) : effConsulenze(r), maxValues.consulenze) }}
                >
                  {formatInt(isSetterView ? effNoShow(r) : effConsulenze(r))}
                </td>
                {isSetterView ? (
                  <>
                    <td
                      className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                      style={{ background: heatBg(effConsulenzeChiusura(r), maxValues.svolte) }}
                    >
                      {formatInt(effConsulenzeChiusura(r))}
                    </td>
                    <td
                      className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                      style={{ background: trattativeLoading ? undefined : rateBg(taglia(pc)) }}
                      title={
                        pc !== null && pc > 1
                          ? `${formatInt(effConsulenzeChiusura(r))} consulenze su ${formatInt(effAppuntamenti(r))} appuntamenti. Valore reale ${formatPct(pc, 2)}.`
                          : undefined
                      }
                    >
                      {trattativeLoading ? (
                        <span className="text-slate-400">–</span>
                      ) : pc !== null ? (
                        formatPct(taglia(pc) as number, 2)
                      ) : (
                        <span className="text-slate-400">–</span>
                      )}
                    </td>
                  </>
                ) : null}
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effChiusure(r), maxValues.chiusure) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatInt(effChiusure(r))}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right font-semibold tabular-nums"
                  style={{ background: hubspotLoading ? undefined : rateBg(taglia(tc)) }}
                  title={
                    tc !== null && tc > 1
                      ? `${formatInt(effChiusure(r))} chiusure su ${formatInt(effConsulenzeChiusura(r))} consulenze. Valore reale ${formatPct(tc, 2)}.`
                      : undefined
                  }
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : tc !== null ? formatPct(taglia(tc) as number, 2) : <span className="text-slate-400">–</span>}
                </td>
                <td
                  className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                  style={{ background: hubspotLoading ? undefined : heatBg(effBoom(r), maxValues.boom) }}
                >
                  {hubspotLoading ? <span className="text-slate-400">–</span> : formatEur(effBoom(r))}
                </td>
                {isSetterView ? null : (
                  <td
                    className="border-r border-white px-2 py-1.5 text-right tabular-nums"
                    style={{
                      background: hubspotLoading
                        ? undefined
                        : heatBg(resaOraria(effIncassoChiusure(r), effConsulenze(r)) ?? 0, maxValues.resa)
                    }}
                  >
                    {hubspotLoading ? (
                      <span className="text-slate-400">–</span>
                    ) : resaOraria(effIncassoChiusure(r), effConsulenze(r)) !== null ? (
                      formatResa(resaOraria(effIncassoChiusure(r), effConsulenze(r)) as number)
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
                {onSalvaObiettivo ? (
                  <CellaObiettivo
                    valore={effObiettivo(r)}
                    mese={meseObiettivo ?? null}
                    persona={r.operatore}
                    salva={onSalvaObiettivo}
                    formatta={formatEur}
                  />
                ) : (
                  // Senza chi la salvi resta una colonna di lettura: meglio di
                  // una cella che accetta un numero e lo butta via.
                  <td className="border-r border-white px-2 py-1.5 text-right tabular-nums">
                    {effObiettivo(r) !== null ? (
                      formatEur(effObiettivo(r) as number)
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                )}
              </tr>
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
            <td
              className={`${BLOCCATA} bg-slate-50 py-2 pr-4 pl-0 text-sm whitespace-nowrap`}
              style={{ left: 0 }}
            >
              Totale complessivo
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {soloChatter ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.assegnati)}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {soloChatter ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.chiamate)}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {soloChatter ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.connessioni)}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{trattativeLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.appuntamenti)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {trattativeLoading ? <span className="font-normal text-slate-400">–</span> : totalTp !== null ? formatPct(taglia(totalTp) as number, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.consulenze)}</td>  {/* consulenze or noShow */}
            {isSetterView ? (
              <>
                <td className="border-r border-white px-2 py-2 text-right tabular-nums">{formatInt(totals.svolte)}</td>
                <td className="border-r border-white px-2 py-2 text-right tabular-nums">
                  {trattativeLoading ? <span className="font-normal text-slate-400">–</span> : totalPc !== null ? formatPct(taglia(totalPc) as number, 2) : <span className="font-normal text-slate-400">–</span>}
                </td>
              </>
            ) : null}
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatInt(totals.chiusure)}</td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {hubspotLoading ? <span className="font-normal text-slate-400">–</span> : totalTc !== null ? formatPct(taglia(totalTc) as number, 2) : <span className="font-normal text-slate-400">–</span>}
            </td>
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">{hubspotLoading ? <span className="font-normal text-slate-400">–</span> : formatEur(totals.boom)}</td>
            {isSetterView ? null : (
              <td className="border-r border-white px-2 py-2 text-right tabular-nums">
                {/* La resa del totale NON e' la media delle rese: e' l'incasso
                    di tutti diviso le ore di tutti. La media delle righe darebbe
                    lo stesso peso a chi ha fatto due consulenze e a chi ne ha
                    fatte quaranta. */}
                {hubspotLoading || resaTotale === null ? (
                  <span className="font-normal text-slate-400">–</span>
                ) : (
                  formatResa(resaTotale)
                )}
              </td>
            )}
            <td className="border-r border-white px-2 py-2 text-right tabular-nums">
              {totals.obiettivo !== null ? (
                formatEur(totals.obiettivo)
              ) : (
                <span className="font-normal text-slate-400">–</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
