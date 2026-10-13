import { chiaveNome } from "@/lib/nomi";

/**
 * Le persone che Sales Copilot conosce, e come si legano alle nostre.
 *
 * COSA FA QUESTO FILE E COSA NO. Qui c'e' solo l'anagrafica e l'aggancio: chi
 * sono le persone di Copilot e a chi corrispondono da noi. I numeri - assegnati,
 * messaggi, appuntamenti - arrivano da `/setters/daily`, che il 13 ottobre 2026
 * risponde 200 con zero persone per ogni giorno provato, dall'8 al 13. Finche'
 * resta cosi' non c'e' niente da leggere, e scrivere la lettura contro campi
 * che loro stessi dicono che "possono cambiare leggermente" vuol dire
 * riscriverla.
 *
 * L'ANAGRAFICA INVECE FUNZIONA, ed e' per questo che questa meta' esiste gia':
 * si puo' provare sui dati veri oggi, e il giorno in cui i numeri arrivano
 * l'aggancio e' gia' verificato.
 */

const BASE = "https://salescopilot.it/api/v1";

export type PersonaCopilot = {
  /** La chiave stabile nel registro di Copilot: "anna", "bartolo", "chiara". */
  id: string;
  name: string;
  emails: string[];
  /** "human" per le persone, "autopilot" per il setter automatico. */
  kind?: string;
  active?: boolean;
};

/** Una delle nostre persone, come la conosciamo da HubSpot. */
export type Candidato = { nome: string; email?: string | null };

export type Aggancio = {
  copilot: PersonaCopilot;
  /** Il nome nostro, oppure null quando nessuna delle due regole ha preso. */
  nostro: string | null;
  /** Come si e' agganciato: serve a leggere i registri e a fidarsi meno. */
  via: "email" | "nome" | null;
};

/**
 * L'elenco delle persone di Copilot.
 *
 * Non filtra niente: restituisce anche chi e' spento e Autopilot, perche' chi
 * chiama deve poterli vedere per decidere. Il 13 ottobre 2026 erano otto, di
 * cui una spenta (Viviana Iappelli) e uno non umano (Autopilot).
 */
export async function personeCopilot(chiave: string): Promise<PersonaCopilot[]> {
  const r = await fetch(`${BASE}/setters`, {
    headers: { Authorization: `Bearer ${chiave}` },
    cache: "no-store"
  });
  if (!r.ok) throw new Error(`Sales Copilot /setters: HTTP ${r.status}`);
  const d = (await r.json()) as { people?: PersonaCopilot[]; setters?: PersonaCopilot[] };
  // Il documento non fissa il nome della chiave: si accettano le due forme
  // plausibili invece di rompersi se cambia.
  return d.people ?? d.setters ?? [];
}

/**
 * A chi corrisponde, da noi, ciascuna persona di Copilot.
 *
 * PRIMA L'EMAIL, POI NOME E COGNOME. Non il solo nome di battesimo: si
 * confronta il `name` di Copilot - "Bartolo Giordanengo" - con il nome intero
 * della persona da noi.
 *
 * MISURATO SULLE OTTO PERSONE VERE il 13 ottobre 2026: l'email ne aggancia
 * cinque, nome e cognome recuperano Bartolo. Restano fuori Viviana, che su
 * HubSpot non esiste perche' e' spenta, e Autopilot, che non e' una persona -
 * ed e' giusto cosi': se un giorno agganciassero qualcuno sarebbe un errore,
 * non un miglioramento.
 *
 * PERCHE' L'EMAIL FUNZIONA, controintuitivamente: su HubSpot queste persone
 * sono registrate con i loro indirizzi personali, non con quello aziendale, e
 * sono gli stessi che usano su Copilot. L'eccezione e' Bartolo, che ne ha tre
 * diversi fra i due sistemi e nessuno in comune: per lui vale il nome.
 *
 * SI NORMALIZZA SEMPRE, con la stessa `chiaveNome` del resto del progetto. Non
 * e' pignoleria: su HubSpot "annalisa cafora" e' scritta tutta minuscola, e un
 * confronto esatto fra "Di Prisco" e "di Prisco" ha gia' spento in silenzio un
 * controllo incrociato il 10 ottobre.
 */
export function agganciaPersone(
  copilot: PersonaCopilot[],
  candidati: Candidato[]
): Aggancio[] {
  const perEmail = new Map<string, string>();
  const perNome = new Map<string, string>();
  for (const c of candidati) {
    if (c.email) perEmail.set(c.email.trim().toLowerCase(), c.nome);
    perNome.set(chiaveNome(c.nome), c.nome);
  }

  return copilot.map((p) => {
    // AUTOPILOT HA UN'EMAIL MA NON E' UNA PERSONA: scrive da un utente Revio,
    // e se quell'indirizzo combaciasse con uno dei nostri gli attribuiremmo il
    // lavoro della macchina. Si agganciano solo le righe `human`; quelle senza
    // `kind` si agganciano come prima, per non perdere nessuno se un giorno il
    // campo mancasse.
    if (p.kind && p.kind !== "human") return { copilot: p, nostro: null, via: null };
    for (const e of p.emails ?? []) {
      const trovato = perEmail.get(e.trim().toLowerCase());
      if (trovato) return { copilot: p, nostro: trovato, via: "email" as const };
    }
    const perN = perNome.get(chiaveNome(p.name ?? ""));
    if (perN) return { copilot: p, nostro: perN, via: "nome" as const };
    return { copilot: p, nostro: null, via: null };
  });
}

/**
 * Le persone di Copilot che non si agganciano a nessuno dei nostri.
 *
 * SERVE A FAR RUMORE, non a nascondere: il giorno in cui i numeri arrivano,
 * una persona non agganciata e' attivita' che non comparirebbe in nessuna
 * riga della Dashboard. Oggi le due attese sono Viviana e Autopilot; una
 * terza vorrebbe dire che qualcosa e' cambiato da loro e nessuno ce l'ha
 * detto.
 */
export function senzaAggancio(agganci: Aggancio[]): Aggancio[] {
  return agganci.filter((a) => !a.nostro);
}

/**
 * Una nota di Copilot: perche' un numero e' quello che e'.
 *
 * ARRIVANO IN DUE POSTI: dentro ogni giorno (`days[].notes`, quelle che
 * riguardano quel giorno) e in cima alla risposta (`notes`, l'unione per
 * codice con l'elenco dei giorni a cui si applicano). Si guardano entrambe:
 * quelle in cima si mostrano, quelle del giorno decidono quali numeri di quel
 * giorno non sono misure.
 */
export type NotaCopilot = { code?: string; message?: string; dates?: string[] };

/** I numeri di una persona in una giornata, come li manda Copilot. */
export type KpiPersona = {
  id: string;
  name?: string;
  emails?: string[];
  /** "human" per le persone, "autopilot" per il setter automatico. */
  kind?: string;
  active?: boolean;
  /** null quando il dato per quel giorno non e' ricostruibile: non e' zero. */
  assegnati: number | null;
  qualificati: number | null;
  messaggi: number | null;
  /** Di quei messaggi, quanti scritti dentro Revio. Gia' compresi in `messaggi`. */
  messaggiInRevio: number | null;
  appuntamenti: number | null;
  /** Di quelli, quanti hanno gia' giorno e ora. Gia' compresi in `appuntamenti`. */
  appuntamentiConData: number | null;
  ore: number | null;
  oreMetodo: string | null;
};

export type KpiGiorno = {
  date: string;
  /**
   * false quando il giorno puo' ancora crescere: oggi, e ieri prima delle
   * 03:00 di Roma. E' LORO E NON NOSTRO, ed e' il motivo per cui si conserva:
   * la regola delle 03:00 la decidono loro e puo' cambiare.
   */
  final: boolean | null;
  /** "complete", "provisional" o "incomplete". */
  status: string | null;
  computedAt: string | null;
  persone: KpiPersona[];
  /** Le note di questo giorno: dicono quali numeri non sono misure. */
  note: NotaCopilot[];
};

export type KpiRisposta = {
  days: KpiGiorno[];
  /** Le note in cima, pronte da mostrare. */
  notes: string[];
  timezone?: string;
  /**
   * Non null quando la risposta ha una forma che non ci aspettavamo.
   *
   * SERVE PERCHE' UN CAMPO RINOMINATO NON FA RUMORE: diventa `undefined`, che
   * diventa null, che diventa un trattino - e una tabella di trattini si
   * confonde con "nessuno ha lavorato". E' esattamente quello che e' successo
   * il 13 ottobre 2026: leggevamo `people` e `assigned` dalla loro bozza del
   * 12, mentre la versione pubblicata manda `setters`, `leadsAssigned` e
   * `leadsQualified`. Abbiamo passato mezza giornata a chiedere quando
   * sarebbero arrivati i numeri, e i numeri c'erano da subito.
   */
  formaSospetta: string | null;
};

const numero = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * I nomi vecchi si leggono ancora, ma solo come ripiego.
 *
 * Loro garantiscono che dentro `v1` un campo non si rinomina piu'. Questo
 * ripiego costa una riga e copre il caso in cui la garanzia non tenga; se
 * dovesse servire, `formaSospetta` lo dice invece di lasciarci con dei
 * trattini da interpretare.
 */
function personaDa(p: Record<string, unknown>): KpiPersona {
  return {
    id: String(p.id ?? ""),
    name: typeof p.name === "string" ? p.name : undefined,
    emails: Array.isArray(p.emails) ? (p.emails as string[]) : [],
    kind: typeof p.kind === "string" ? p.kind : undefined,
    active: typeof p.active === "boolean" ? p.active : undefined,
    assegnati: numero(p.leadsAssigned ?? p.assigned),
    qualificati: numero(p.leadsQualified ?? p.qualified),
    messaggi: numero(p.messagesSent),
    messaggiInRevio: numero(p.messagesSentInRevio),
    appuntamenti: numero(p.appointmentsSet),
    appuntamentiConData: numero(p.appointmentsWithDate),
    ore: numero(p.hoursWorked),
    oreMetodo: typeof p.hoursWorkedMethod === "string" ? p.hoursWorkedMethod : null
  };
}

const note = (v: unknown): NotaCopilot[] =>
  Array.isArray(v) ? (v.filter((n) => n && typeof n === "object") as NotaCopilot[]) : [];

/** Quante volte ritentare un 503 "warming", e quanto aspettare. */
const TENTATIVI = 3;
const RESPIRO_MS = 1500;

/**
 * I numeri di uno o piu' giorni.
 *
 * NULL E ZERO NON SI CONFONDONO. Copilot dichiara che un campo non
 * ricostruibile torna `null` con una nota; qui si lascia null fino in fondo, e
 * chi disegna mostrera' un trattino. Trasformarlo in zero vorrebbe dire
 * scrivere "nessun messaggio" dove la verita' e' "non lo sappiamo".
 *
 * 503 "WARMING" NON E' UN ERRORE, e' un "richiama": succede alla prima lettura
 * di molti giorni vecchi, perche' li stanno calcolando. Si ritenta la stessa
 * richiesta.
 */
export async function kpiGiorni(chiave: string, da: string, a: string): Promise<KpiRisposta> {
  const u = new URL(`${BASE}/setters/daily`);
  u.searchParams.set("from", da);
  u.searchParams.set("to", a);

  let d: Record<string, unknown> | null = null;
  for (let tentativo = 1; tentativo <= TENTATIVI; tentativo++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${chiave}` }, cache: "no-store" });
    if (r.status === 503 && tentativo < TENTATIVI) {
      await new Promise((ok) => setTimeout(ok, RESPIRO_MS));
      continue;
    }
    if (!r.ok) throw new Error(`Sales Copilot /setters/daily: HTTP ${r.status}`);
    d = (await r.json()) as Record<string, unknown>;
    break;
  }
  if (!d) throw new Error("Sales Copilot /setters/daily: 503 warming anche dopo i tentativi");

  const giorniGrezzi = Array.isArray(d.days) ? (d.days as Record<string, unknown>[]) : [];
  const days: KpiGiorno[] = giorniGrezzi.map((g) => {
    const righe = (g.setters ?? g.people) as unknown;
    return {
      date: String(g.date ?? ""),
      final: typeof g.final === "boolean" ? g.final : null,
      status: typeof g.status === "string" ? g.status : null,
      computedAt: typeof g.computedAt === "string" ? g.computedAt : null,
      persone: Array.isArray(righe) ? (righe as Record<string, unknown>[]).map(personaDa) : [],
      note: note(g.notes)
    };
  });

  // LA FORMA SI CONTROLLA, non si spera. Se ci sono giorni ma nessuna riga, o
  // righe in cui nessuno dei due nomi del campo esiste, e' cambiato qualcosa:
  // lo si dice adesso, invece di mostrare trattini e aspettare che qualcuno
  // chieda.
  let formaSospetta: string | null = null;
  if (giorniGrezzi.length && days.every((g) => !g.persone.length)) {
    const chiavi = Object.keys(giorniGrezzi[0] ?? {}).join(", ");
    formaSospetta = `nessuna riga persona nei giorni: cerco "setters" (o "people"), il giorno contiene ${chiavi}`;
  } else {
    const tutte = days.flatMap((g) => g.persone);
    if (tutte.length && tutte.every((p) => p.assegnati === null && p.messaggi === null)) {
      formaSospetta = 'righe presenti ma vuote: cerco "leadsAssigned" e "messagesSent"';
    }
  }

  return {
    days,
    notes: note(d.notes)
      .map((n) => n.message ?? n.code ?? "")
      .filter(Boolean),
    timezone: typeof d.timezone === "string" ? d.timezone : undefined,
    formaSospetta
  };
}

/**
 * Quali numeri di un giorno NON sono misure, per via delle sue note.
 *
 * LA REGOLA E' LORO: con `status: "incomplete"` i campi nominati dalle note di
 * quel giorno non sono misure complete "anche se valgono 0". Qui si traducono
 * i codici nei nostri campi e si riportano a null, cosi' la tabella mostra un
 * trattino invece di uno zero che sembra una misura.
 *
 * `autopilot_hours` NON entra in questa tabella: non dice che un numero manca,
 * spiega un null che c'e' gia' - e azzerare le ore di tutti per una nota che
 * parla del setter automatico sarebbe il contrario di quello che serve.
 */
const CAMPI_NON_MISURATI: Record<string, Array<keyof KpiPersona>> = {
  no_dm_log: ["messaggi", "messaggiInRevio"],
  dm_revio_missing: ["messaggi", "messaggiInRevio"],
  no_appointment_log: ["appuntamenti", "appuntamentiConData"],
  no_event_log: ["assegnati", "qualificati"],
  hours_unavailable: ["ore"]
};

export function senzaMisura(giorno: KpiGiorno, p: KpiPersona): KpiPersona {
  if (giorno.status !== "incomplete") return p;
  const fuori = new Set<keyof KpiPersona>();
  for (const n of giorno.note) {
    for (const campo of CAMPI_NON_MISURATI[n.code ?? ""] ?? []) fuori.add(campo);
  }
  if (!fuori.size) return p;
  const copia = { ...p };
  for (const campo of fuori) (copia as Record<string, unknown>)[campo] = null;
  return copia;
}
