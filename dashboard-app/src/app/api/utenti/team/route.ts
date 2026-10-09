import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { osservaTeam } from "@/lib/utenti/osserva";
import { impostaTeam, teamNoti, storiaTeam, SOTTO_PER_PRINCIPALE } from "@/lib/utenti/team";

/**
 * Chi sta in quale team, da quando, e come metterci qualcuno.
 *
 * NON E' IN API_RIDOTTE del middleware, di proposito: la lettura dice chi
 * appartiene a cosa, e la scrittura cambia dei permessi su HubSpot. Vuole la
 * password piena.
 *
 * SI LEGGE DALLA FOTOGRAFIA e non da HubSpot: la fotografia e' la stessa cosa
 * che genera lo storico - vedi src/lib/utenti/osserva.ts - e leggere da due
 * posti diversi vorrebbe dire che la finestra puo' mostrare una composizione
 * che lo storico non ha mai visto passare.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Quanto puo' essere vecchia la fotografia prima di rifarla.
 *
 * I giri notturni la rinfrescano una volta al giorno. Ma i team si cambiano di
 * giorno, mentre qualcuno guarda: mezz'ora tiene la finestra vicina alla
 * realta' senza rileggere l'anagrafica a ogni apertura.
 */
const FRESCHEZZA_MINUTI = 30;

type Riga = {
  user_id: string;
  team_id: string;
  genere: string;
  nome: string | null;
  email: string | null;
  team_nome: string | null;
};

export async function GET(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });
  }

  const db = getDb();

  try {
    const { rows: eta } = await db.query<{ visto_at: Date | null }>(
      `SELECT max(visto_at) AS visto_at FROM utente_team_adesso`
    );
    const ultimo = eta[0]?.visto_at ? new Date(eta[0].visto_at) : null;
    const vecchia = !ultimo || Date.now() - ultimo.getTime() > FRESCHEZZA_MINUTI * 60_000;

    // SI GUARDA PRIMA DI RISPONDERE, se e' passato abbastanza: cosi' aprire la
    // finestra e' anche il momento in cui gli spostamenti fatti sul portale
    // entrano nello storico. Se la lettura va male si risponde comunque con la
    // fotografia che c'e' - una finestra un po' vecchia e' meglio di un errore.
    let osservazione: Awaited<ReturnType<typeof osservaTeam>> | null = null;
    if (vecchia || req.nextUrl.searchParams.get("aggiorna") === "1") {
      try {
        osservazione = await osservaTeam(token, true);
      } catch (e) {
        console.error("[api/utenti/team] osservazione non riuscita:", e);
      }
    }

    const [{ rows: righe }, team, storia] = await Promise.all([
      db.query<Riga>(
        `SELECT user_id, team_id, genere, nome, email, team_nome FROM utente_team_adesso`
      ),
      teamNoti(token),
      storiaTeam(undefined, 200)
    ]);

    const perId = new Map(team.map((t) => [t.id, t]));

    const persone = new Map<
      string,
      {
        userId: string;
        nome: string | null;
        chiave: string | null;
        email: string | null;
        principale: { id: string; nome: string | null } | null;
        sottoTeam: Array<{ id: string; nome: string | null }>;
      }
    >();

    for (const r of righe) {
      let p = persone.get(r.user_id);
      if (!p) {
        p = {
          userId: r.user_id,
          nome: r.nome,
          chiave: r.nome ? chiaveNome(r.nome) : null,
          email: r.email,
          principale: null,
          sottoTeam: []
        };
        persone.set(r.user_id, p);
      }
      const voce = { id: r.team_id, nome: perId.get(r.team_id)?.nome ?? r.team_nome };
      if (r.genere === "principale") p.principale = voce;
      else p.sottoTeam.push(voce);
    }

    for (const p of persone.values()) {
      p.sottoTeam.sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? ""));
    }

    return NextResponse.json({
      // Quali sotto-team spettano a quale principale: la finestra li filtra con
      // questa invece di avere gli id scritti dentro, cosi' la regola sta in un
      // posto solo - vedi SOTTO_PER_PRINCIPALE.
      sottoPerPrincipale: SOTTO_PER_PRINCIPALE,
      osservatoAt: ultimo ? ultimo.toISOString() : null,
      appenaOsservato: osservazione
        ? { ingressi: osservazione.ingressi, uscite: osservazione.uscite, fermo: osservazione.fermo ?? null }
        : null,
      team: team.sort((a, b) => Number(b.principale) - Number(a.principale) || a.nome.localeCompare(b.nome)),
      persone: [...persone.values()].sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "")),
      storia
    });
  } catch (e) {
    console.error("[api/utenti/team]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "errore nella lettura dei team" },
      { status: 500 }
    );
  }
}

/**
 * Mette una persona in un sotto-team, o la toglie.
 *
 * LO SPOSTAMENTO NON HA UN VERBO SUO: la finestra manda un "togli" e un
 * "aggiungi". Sono due eventi anche nello storico - vedi spostarSottoTeam in
 * src/lib/utenti/team.ts - e tenerli separati qui evita una terza strada che
 * puo' divergere dalle altre due.
 */
export async function POST(req: NextRequest) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });
  }

  let corpo: { userId?: unknown; principale?: unknown; sottoTeam?: unknown };
  try {
    corpo = (await req.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const userId = typeof corpo.userId === "string" ? corpo.userId.trim() : "";
  if (!userId) return NextResponse.json({ error: "serve userId" }, { status: 400 });

  // SI DISTINGUE "NON CHIESTO" DA "CHIESTO VUOTO": assente vuol dire lascia
  // com'e', stringa vuota o null vuol dire toglilo. Confonderli farebbe
  // azzerare il team principale a ogni cambio di sotto-team.
  const campo = (v: unknown) => (v === undefined ? undefined : typeof v === "string" && v.trim() ? v.trim() : null);

  const voluto = { principale: campo(corpo.principale), sottoTeam: campo(corpo.sottoTeam) };
  if (voluto.principale === undefined && voluto.sottoTeam === undefined) {
    return NextResponse.json({ error: "serve almeno principale o sottoTeam" }, { status: 400 });
  }

  try {
    const esito = await impostaTeam(token, userId, voluto);
    // Si riguarda subito, cosi' la fotografia e lo storico restano allineati
    // con quello che e' appena cambiato invece di aspettare mezz'ora.
    try {
      await osservaTeam(token, true);
    } catch (e) {
      console.error("[api/utenti/team] osservazione dopo la modifica non riuscita:", e);
    }
    return NextResponse.json({
      ok: true,
      cambiato: esito.cambiato,
      movimenti: esito.movimenti,
      utente: esito.utente
    });
  } catch (e) {
    console.error("[api/utenti/team] POST", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "modifica non riuscita" },
      { status: 400 }
    );
  }
}
