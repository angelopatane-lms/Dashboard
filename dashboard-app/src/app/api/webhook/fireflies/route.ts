import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * SONDA del webhook di Fireflies: riceve, verifica la firma e ANNOTA. Basta.
 *
 * PERCHE' UNA SONDA E NON SUBITO LA COSA VERA. La documentazione di Fireflies
 * dice che il webhook scatta per "le riunioni di cui sei proprietario" e
 * conferma esplicitamente solo i caricamenti via API e da dashboard. Le nostre
 * registrazioni non arrivano da li': arrivano dall'estensione Chrome, che la
 * documentazione non nomina. La proprieta' c'e' - misurato sulle 856
 * registrazioni con un codice stanza degli ultimi 90 giorni, tutte con
 * organizer_email advisorleonegroup@gmail.com - ma che l'estensione faccia
 * scattare il webhook non e' scritto da nessuna parte, e non si deduce
 * ragionandoci: si vede solo facendo una call e guardando se arriva qualcosa.
 *
 * Finche' siamo in prova questo endpoint NON SCRIVE NIENTE su HubSpot e non
 * abbina niente. Lascia una riga in sync_log e risponde 200. Se l'esito e'
 * positivo, l'abbinamento glielo attacchiamo dopo.
 */

/** Quanto puo' essere lungo il corpo che accettiamo.
 *
 *  Il payload vero sono tre campi - meetingId, eventType, clientReferenceId -
 *  quindi poche centinaia di byte. Il tetto serve solo a non lasciare che un
 *  estraneo ci riempia sync_log mandando megabyte a un indirizzo pubblico. */
const TETTO_CORPO = 16 * 1024;

/**
 * La firma corrisponde? E secondo quale schema?
 *
 * PERCHE' PROVIAMO PIU' FORME. La documentazione dice che l'header
 * x-hub-signature contiene "una firma HMAC SHA-256 del payload" e rimanda a un
 * esempio su Replit per i dettagli - esempio che oggi risponde 404. Non e'
 * quindi documentato se il valore sia esadecimale o base64, ne' se porti il
 * prefisso "sha256=" come usa GitHub. Invece di indovinare una forma sola e
 * scoprire a cose fatte di aver scartato consegne buone, le calcoliamo tutte e
 * QUATTRO e annotiamo quale ha funzionato. La prima consegna vera ci dice lo
 * schema, e da li' in poi si tiene solo quello.
 */
function verificaFirma(corpo: string, header: string | null, segreto: string): string {
  if (!header) return "assente";

  const hmac = createHmac("sha256", segreto).update(corpo, "utf8");
  const esa = hmac.digest("hex");
  const b64 = createHmac("sha256", segreto).update(corpo, "utf8").digest("base64");

  const forme: Array<[string, string]> = [
    ["esadecimale", esa],
    ["esadecimale con prefisso", `sha256=${esa}`],
    ["base64", b64],
    ["base64 con prefisso", `sha256=${b64}`]
  ];

  for (const [nome, atteso] of forme) {
    // Confronto a tempo costante: su una firma la differenza fra "sbagliata
    // subito" e "sbagliata alla fine" e' un'informazione che non regaliamo.
    const a = Buffer.from(atteso);
    const b = Buffer.from(header);
    if (a.length === b.length && timingSafeEqual(a, b)) return nome;
  }
  return "non corrisponde";
}

/** Annota la consegna, senza mai far fallire la risposta per colpa del log. */
async function annota(esito: string, messaggio: string): Promise<void> {
  try {
    const ora = new Date().toISOString();
    await getDb().query(
      `INSERT INTO sync_log (tipo, iniziato_at, finito_at, esito, messaggio)
       VALUES ('webhook-fireflies', $1::timestamptz, $1::timestamptz, $2, $3)`,
      [ora, esito, messaggio.slice(0, 4000)]
    );
  } catch (e) {
    console.error("[webhook/fireflies] non sono riuscito ad annotare", e);
  }
}

export async function POST(req: NextRequest) {
  const corpo = await req.text();
  const firmaHeader = req.headers.get("x-hub-signature");
  const segreto = process.env.FIREFLIES_WEBHOOK_SECRET;

  if (corpo.length > TETTO_CORPO) {
    await annota("ignorato", `corpo troppo lungo: ${corpo.length} byte`);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const firma = segreto
    ? verificaFirma(corpo, firmaHeader, segreto)
    : "segreto non impostato";

  // Del payload ci interessano tre campi soli; il resto lo teniamo grezzo per
  // vedere se Fireflies ne manda altri che la documentazione non elenca.
  let meetingId = "";
  let eventType = "";
  try {
    const j = JSON.parse(corpo) as { meetingId?: string; eventType?: string };
    meetingId = j.meetingId ?? "";
    eventType = j.eventType ?? "";
  } catch {
    // Un corpo non JSON e' gia' un'informazione: la annotiamo e basta.
  }

  const messaggio = [
    `firma: ${firma}`,
    `meetingId: ${meetingId || "(assente)"}`,
    `eventType: ${eventType || "(assente)"}`,
    `user-agent: ${req.headers.get("user-agent") ?? "(assente)"}`,
    `corpo: ${corpo.slice(0, 2000)}`
  ].join(" | ");

  console.log(`[webhook/fireflies] ${messaggio}`);
  await annota(firma === "assente" || firma === "non corrisponde" ? "sospetto" : "ok", messaggio);

  // SEMPRE 200, anche quando la firma non torna. In prova un 4xx non ci
  // proteggerebbe da niente - non stiamo facendo niente con il contenuto - e
  // rischierebbe di far considerare a Fireflies l'indirizzo come rotto,
  // togliendoci proprio la risposta che stiamo cercando. Quando attaccheremo
  // l'abbinamento, li' la firma diventera' obbligatoria.
  return NextResponse.json({ ok: true }, { status: 200 });
}

/** Serve solo a controllare dal browser che l'indirizzo risponda, prima di
 *  incollarlo in Developer Settings. Non dice niente di riservato. */
export async function GET() {
  return NextResponse.json({
    sonda: "webhook fireflies",
    segreto: Boolean(process.env.FIREFLIES_WEBHOOK_SECRET),
    scrive: false
  });
}
