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

/** I numeri di una persona in una giornata, come li manda Copilot. */
export type KpiPersona = {
  id: string;
  name?: string;
  emails?: string[];
  kind?: string;
  /** null quando il dato per quel giorno non e' ricostruibile: non e' zero. */
  assigned: number | null;
  qualified: number | null;
  messagesSent: number | null;
  appointmentsSet: number | null;
  hoursWorked: number | null;
};

export type KpiGiorno = { date: string; people: KpiPersona[] };

export type KpiRisposta = {
  days: KpiGiorno[];
  /** Quello che Copilot ha da dire su questa risposta: va guardato. */
  notes: string[];
  timezone?: string;
};

/**
 * I numeri di uno o piu' giorni.
 *
 * NULL E ZERO NON SI CONFONDONO. Copilot dichiara che un campo non
 * ricostruibile torna `null` con una nota; qui si lascia null fino in fondo, e
 * chi disegna mostrera' un trattino. Trasformarlo in zero vorrebbe dire
 * scrivere "nessun messaggio" dove la verita' e' "non lo sappiamo" - lo stesso
 * errore che il 10 ottobre faceva apparire "POOL SERIE B 0" su un serbatoio da
 * trentamila contatti.
 *
 * UNA GIORNATA SENZA PERSONE NON E' UNA GIORNATA VUOTA. Al 13 ottobre 2026
 * questa chiamata risponde 200 con zero persone per ogni giorno provato: non
 * significa che nessuno abbia lavorato, significa che l'endpoint non e' ancora
 * collegato agli eventi. Chi usa questi dati deve distinguere i due casi, ed e'
 * il motivo per cui `notes` arriva fino in cima invece di essere scartato.
 */
export async function kpiGiorni(chiave: string, da: string, a: string): Promise<KpiRisposta> {
  const u = new URL(`${BASE}/setters/daily`);
  u.searchParams.set("from", da);
  u.searchParams.set("to", a);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${chiave}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Sales Copilot /setters/daily: HTTP ${r.status}`);
  const d = (await r.json()) as { days?: KpiGiorno[]; notes?: unknown[]; timezone?: string };
  return {
    days: d.days ?? [],
    notes: (d.notes ?? []).map((n) => (typeof n === "string" ? n : JSON.stringify(n))),
    timezone: d.timezone
  };
}
