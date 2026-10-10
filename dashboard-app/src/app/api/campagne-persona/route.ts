import { NextRequest, NextResponse } from "next/server";
import { lineeCampagne } from "@/lib/assegnazioni/linee";

/**
 * Le campagne che ciascuna persona riceve per prime.
 *
 * COME GLI ALTRI COMANDI DELLA SEZIONE, a doppio senso e senza copie locali:
 * il GET chiede all'app com'e' messa adesso, il POST manda la modifica e
 * l'app risponde con l'elenco aggiornato. La riga vive una volta sola, nel
 * database di quell'app, nella stessa tabella dove gia' stanno la percentuale
 * serie A e l'interruttore dell'assegnazione. Se qualcuno la cambia dalla
 * pagina dell'app, al giro dopo qui si vede cambiata - perche' qui si sta
 * leggendo quella riga, non una sua fotografia.
 *
 * PERCHE' PASSA DA QUI E NON DAL BROWSER: come per /api/assegnazione-lead, il
 * segreto condiviso con quell'app sta in una variabile d'ambiente e non deve
 * mai arrivare alla pagina.
 *
 * CHI PUO' CHIAMARLA: ci pensa il middleware, che lascia passare solo la
 * password piena su quello che non e' elencato come ridotto. Non aggiungere
 * questo indirizzo a `API_RIDOTTE` in src/middleware.ts: da qui si decide chi
 * riceve quali lead.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const INDIRIZZO =
  process.env.LMS_CAMPAGNE_PERSONA_URL ||
  "https://lms.217.154.117.118.nip.io/dispatch-api/lead-campagne-persona";

type Persona = {
  employee_id: number;
  first_name: string;
  last_name: string;
  role: string;
  campagne_preferite: string;
};

async function chiama(metodo: "GET" | "POST", corpo?: unknown) {
  const token = process.env.LMS_ASSEGNAZIONI_TOKEN;
  if (!token) {
    return {
      stato: 503,
      dati: { error: "LMS_ASSEGNAZIONI_TOKEN non impostato: la sezione resta in sola lettura" }
    };
  }

  try {
    const r = await fetch(INDIRIZZO, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { "Content-Type": "application/json" } : {})
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000)
    });
    const dati = await r.json().catch(() => ({ error: `risposta non leggibile (${r.status})` }));
    return { stato: r.status, dati: dati as Record<string, unknown> };
  } catch (e) {
    console.error("[campagne-persona]", e);
    return { stato: 502, dati: { error: "L'app Assegnazione Lead non risponde" } };
  }
}

/**
 * Le linee accanto alle persone, in una risposta sola.
 *
 * LE DUE COSE ARRIVANO DA POSTI DIVERSI - le persone dall'app, le linee
 * dall'archivio campagne di qui - ma separarle in due chiamate vorrebbe dire
 * una pagina che puo' disegnare le caselle prima di sapere cosa c'e' dentro.
 *
 * SE LE LINEE NON SI LEGGONO non si fa cadere la sezione: si risponde con
 * l'elenco vuoto, la tendina lo dice, e le preferenze gia' impostate restano
 * visibili. Il contrario - mostrare le caselle senza sapere quali esistono -
 * farebbe sembrare che le linee siano finite.
 */
async function rispondi(stato: number, dati: Record<string, unknown>) {
  if (stato !== 200) {
    return NextResponse.json(dati, { status: stato, headers: { "Cache-Control": "no-store" } });
  }
  let linee: Awaited<ReturnType<typeof lineeCampagne>> = [];
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (token) {
    try {
      linee = await lineeCampagne(token);
    } catch (e) {
      console.error("[campagne-persona] linee:", e);
    }
  }
  const persone = (Array.isArray(dati.persone) ? dati.persone : []) as Persona[];
  return NextResponse.json(
    { persone, linee },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  const { stato, dati } = await chiama("GET");
  return rispondi(stato, dati);
}

export async function POST(req: NextRequest) {
  const corpo = await req.json().catch(() => ({}));

  const id = Number(corpo.employee_id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "employee_id mancante o non valido" }, { status: 400 });
  }

  // SI MANDA SOLO QUELLO CHE SI RICONOSCE. Le linee arrivano come elenco e si
  // uniscono qui: all'app serve una stringa, ma farle viaggiare gia' unite
  // vorrebbe dire fidarsi della pagina su come sono separate.
  const scelte = Array.isArray(corpo.campagne) ? corpo.campagne : [];
  const pulite = scelte
    .filter((c: unknown): c is string => typeof c === "string")
    .map((c: string) => c.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);

  const { stato, dati } = await chiama("POST", {
    employee_id: id,
    campagne: [...new Set(pulite)].join(",")
  });
  return rispondi(stato, dati);
}
