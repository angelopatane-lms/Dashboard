import { NextRequest, NextResponse } from "next/server";
import { MAX_CATEGORIE } from "@/lib/assegnazioni/categorie";
import { CATEGORIE } from "@/lib/campaignCategory";

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
 * SOLO LE PERSONE, NON I NUMERI DELLE CATEGORIE. Quelli costano una ventina
 * di chiamate a HubSpot - sette secondi e mezzo misurati - e stanno in una
 * rotta a parte, /api/campagne-persona/categorie. Finche' viaggiavano insieme,
 * aprire la scheda voleva dire guardare un rettangolo bianco per dieci
 * secondi: le persone erano pronte da un pezzo e aspettavano i riquadri.
 */
async function rispondi(stato: number, dati: Record<string, unknown>) {
  if (stato !== 200) {
    return NextResponse.json(dati, { status: stato, headers: { "Cache-Control": "no-store" } });
  }
  const persone = (Array.isArray(dati.persone) ? dati.persone : []) as Persona[];
  return NextResponse.json(
    { persone, massimo: MAX_CATEGORIE },
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

  // SI MANDA SOLO QUELLO CHE SI RICONOSCE. I frammenti arrivano come elenco e
  // si uniscono qui: all'app serve una stringa, ma farli viaggiare gia' uniti
  // vorrebbe dire fidarsi della pagina su come sono separati.
  const scelte: unknown[] = Array.isArray(corpo.campagne) ? corpo.campagne : [];
  const pulite = [
    ...new Set(
      scelte
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean)
    )
  ];

  // IL TETTO SI FA RISPETTARE ANCHE QUI, non solo nella pagina: oltre tre
  // categorie la ricerca di HubSpot sfora i diciotto filtri totali e risponde
  // 400, che dentro l'app fa `break` in silenzio - zero lead per tutti. Una
  // regola che vive solo nell'interfaccia non e' una regola.
  const categorieScelte = new Set(
    pulite.map((f) => CATEGORIE.find((c) => c.frammenti.includes(f))?.etichetta ?? f)
  );
  if (categorieScelte.size > MAX_CATEGORIE) {
    return NextResponse.json(
      { error: `al massimo ${MAX_CATEGORIE} categorie per persona` },
      { status: 400 }
    );
  }

  const { stato, dati } = await chiama("POST", {
    employee_id: id,
    campagne: pulite.join(",")
  });
  return rispondi(stato, dati);
}
