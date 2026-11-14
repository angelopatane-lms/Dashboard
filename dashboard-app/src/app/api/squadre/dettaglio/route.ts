import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { chiaveNome } from "@/lib/nomi";
import { fetchCsv } from "@/lib/csv";
import { fasceOccupate } from "@/lib/google/freebusy";
import { GET as agendaDegliAdvisor } from "@/app/api/advisor-agenda/route";

/**
 * L'AGENDA DI UN GIORNO PER LE PAGINE SQUADRE: chi ha cosa in calendario.
 *
 * A COSA SERVE. Il quadrante Appuntamenti dice quanti; chi guarda una
 * giornata vuole sapere anche QUANDO - a che ora, per quanto, con chi, e
 * soprattutto dove restano i buchi. Finche' il numero era solo un numero, per
 * vederci dentro bisognava aprire HubSpot e rifare a mano il filtro, che e' il
 * momento in cui si smette di fidarsi della pagina.
 *
 * UN GIORNO SOLO, e non e' un limite tecnico: su una giornata sono venti
 * riunioni che stanno in una tabella; su un mese sarebbero mille righe che
 * nessuno scorre.
 *
 * C'ERA ANCHE UN ELENCO DELLE CONSULENZE SVOLTE, aperto dall'altro quadrante,
 * costruito sulle trattative. Tolto su richiesta della direzione, che da
 * questa pagina vuole una cosa sola: quanto e' pieno il calendario degli
 * advisor. Con lui se ne sono andate le letture dei contatti e delle
 * trattative, che servivano solo a quello.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const HUBSPOT_API = "https://api.hubapi.com";

/**
 * L'AGENDA DI UNA GIORNATA: a che ora, con chi, e quanto resta libero.
 *
 * NON E' LO STESSO INSIEME DEI DUE QUADRANTI, e la differenza e' il punto.
 * Il quadrante Appuntamenti conta le trattative NATE in quel giorno - quante
 * ne hanno fissate - mentre un'agenda mostra quelle che SI TENGONO in quel
 * giorno, fissate chissa' quando. Un appuntamento preso venerdi' per lunedi'
 * sta nel quadrante di venerdi' e nell'agenda di lunedi': sono due domande
 * diverse, "quanto hanno procurato" e "quanto e' pieno il calendario".
 *
 * VIENE DALLE RIUNIONI, NON DALLE TRATTATIVE. Le riunioni di HubSpot sono
 * l'unica fonte che ha un'ora di inizio E una di fine, quindi l'unica con cui
 * si puo' dire quanto e' occupata un'agenda: le durate non sono tutte uguali -
 * c'e' chi fa 60 minuti, chi 45, chi 30 - e un'ora dedotta a tavolino
 * mostrerebbe pieno un calendario mezzo libero, o il contrario.
 *
 * SI APPOGGIA A `/api/advisor-agenda`, che questo lavoro lo fa gia' per la
 * pagina Advisor: ricerca delle riunioni, nome del contatto preso dal titolo,
 * esito, riunioni spostate. Rifarlo qui vorrebbe dire mantenere due volte la
 * stessa lettura e vedere le due pagine divergere al primo dettaglio.
 *
 * LA SI CHIAMA COME FUNZIONE, NON COME INDIRIZZO, e non e' un dettaglio.
 * Quella rotta sta dietro la password della Dashboard - il middleware la
 * protegge come tutte le altre - quindi una fetch su HTTP si prendeva un 401
 * e questa rotta rispondeva 502. In locale non si vedeva, perche' in locale
 * la password non c'e'. Le alternative erano due: togliere la protezione a
 * quell'indirizzo, cioe' aprire a chiunque le agende di tutti, oppure saltare
 * la rete. Saltare la rete non toglie niente a nessuno ed e' anche piu'
 * veloce: nessun giro, nessun cookie, nessun segreto in piu' da custodire.
 */
type RigaAgenda = {
  /** Null quando il nome dell'agenda non si ritrova fra i proprietari. */
  advisorId: string | null;
  advisor: string;
  contatto: string;
  /** "09:30", pronti da scrivere. */
  inizio: string;
  fine: string;
  /** Minuti dalla mezzanotte di Roma: con questi si posano le card. */
  inizioMin: number;
  fineMin: number;
  /** appuntamento | svolta | no_show, per il colore della card. */
  tipo: string;
};

/**
 * Dal titolo della riunione si toglie il nome dell'advisor.
 *
 * HubSpot le intitola "Contatto and Advisor", e qualcuno le rinomina con la
 * "e" italiana: in una colonna che ha gia' il nome dell'advisor in cima,
 * quella coda occupa meta' della card e dice una cosa sola, che si sapeva.
 * La pagina Advisor toglie solo la forma inglese, e qui serviva anche l'altra.
 */
function senzaIlNomeDellAdvisor(titolo: string, advisor: string) {
  if (!titolo || !advisor) return titolo;
  const coda = new RegExp(`\\s+(?:and|e|&|con)\\s+${advisor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const pulito = titolo.replace(coda, "").trim();
  // Se del titolo non resta niente - una riunione intitolata col solo nome
  // dell'advisor - si tiene quello che c'era: meglio ripetuto che vuoto.
  return pulito || titolo;
}

async function agendaDelGiorno(giorno: string) {
  // L'indirizzo serve solo a costruire la richiesta: nessuno lo chiama
  // davvero, la funzione gira qui dentro.
  const finta = new NextRequest(new URL(`https://interno/api/advisor-agenda?giorno=${giorno}`));
  const res = await agendaDegliAdvisor(finta);
  if (!res.ok) throw new Error(`advisor-agenda risponde ${res.status}`);
  const dati = await res.json();
  if (dati?.error) throw new Error(String(dati.error));
  const righe: RigaAgenda[] = [];
  for (const e of dati.eventi ?? []) {
    if (typeof e?.inizioMin !== "number") continue;
    const advisor = String(e.operatore ?? "").trim();
    righe.push({
      advisorId: null,
      advisor,
      contatto: senzaIlNomeDellAdvisor(String(e.titolo ?? "").trim(), advisor),
      inizio: String(e.inizio ?? ""),
      fine: String(e.fine ?? ""),
      inizioMin: e.inizioMin,
      // Una fine mancante o al contrario non deve produrre una card alta zero:
      // meglio il quarto d'ora minimo, che almeno si vede e si clicca.
      fineMin: typeof e.fineMin === "number" && e.fineMin > e.inizioMin ? e.fineMin : e.inizioMin + 15,
      tipo: String(e.tipo ?? "appuntamento")
    });
  }
  return righe;
}

/**
 * LE AGENDE GOOGLE DIETRO LE RIUNIONI DI HUBSPOT.
 *
 * L'agenda nasce dalle riunioni del CRM, cioe' da quello che passa dal link
 * di prenotazione. Ma un advisor che si segna una consulenza a mano sul
 * proprio calendario, su HubSpot non lascia niente: il 13 novembre 2026, a
 * fronte di 28 riunioni, sui calendari c'erano 46 impegni in piu' - 18 col
 * nome di una persona - e Roberta Cettolo, che di consulenze ne aveva sei,
 * sulla pagina risultava "agenda libera" tutto il giorno.
 *
 * ARRIVANO SOLO LE FASCE, senza titolo: vedi lib/google/freebusy. Dicono
 * quando la persona e' occupata, non da cosa.
 *
 * I CALENDARI VENGONO DAL FOGLIO "Hubspot User List", colonna Calendar ID:
 * la stessa fonte che dice chi lavora qui. Le seconde agende sono scritte
 * qui sotto, come in agende-extra.json della pagina di prenotazione.
 */
const FOGLIO_UTENTI = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_UTENTI = "0";

/** Chi tiene impegni anche su un secondo account. Chiave: id proprietario. */
const AGENDE_IN_PIU: Record<string, string[]> = {
  // Nora D'Ascanio, dal 10/11/2026: dei 52 slot che il suo link offriva, 4
  // erano gia' occupati sulla seconda agenda.
  "1325480413": ["nora.dascanio@leonemasterschool.it"]
};

/**
 * UNA FASCIA LUNGA MEZZA GIORNATA NON E' UN'AGENDA PIENA.
 *
 * Ferie, "Casa", i blocchi da nove ore: dicono dov'e' la persona, non che
 * stia facendo consulenze. Disegnate riempirebbero la colonna di grigio e
 * coprirebbero proprio la lettura che si cerca.
 */
const TROPPO_LUNGA_MIN = 6 * 60;

/** La mezzanotte di Roma di un giorno, qualunque fuso abbia il server. */
function mezzanotteRoma(giorno: string): Date {
  const presunto = Date.parse(`${giorno}T00:00:00Z`);
  const letto = Date.parse(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    })
      .format(new Date(presunto))
      .replace(" ", "T") + "Z"
  );
  return new Date(presunto + (presunto - letto));
}

type Occupato = { advisorId: string; inizioMin: number; fineMin: number };

async function occupatoDelGiorno(giorno: string): Promise<Occupato[]> {
  const righe = await fetchCsv(
    `https://docs.google.com/spreadsheets/d/${FOGLIO_UTENTI}/export?format=csv&gid=${GID_UTENTI}`,
    { next: { revalidate: 0 } }
  );

  const agendeDi = new Map<string, string[]>();
  for (const r of righe) {
    const id = (r["Hubspot ID"] ?? "").toString().trim();
    if (!id) continue;
    const sue = [(r["Calendar ID"] ?? "").toString().trim(), ...(AGENDE_IN_PIU[id] ?? [])].filter(Boolean);
    if (sue.length) agendeDi.set(id, sue);
  }

  const da = mezzanotteRoma(giorno);
  const a = new Date(da.getTime() + 86_400_000);
  const { impegni } = await fasceOccupate([...new Set([...agendeDi.values()].flat())], da, a);

  const fuori: Occupato[] = [];
  for (const [advisorId, sue] of agendeDi) {
    for (const calendario of sue) {
      for (const f of impegni.get(calendario) ?? []) {
        const inizioMin = Math.round((f.inizio - da.getTime()) / 60_000);
        const fineMin = Math.round((f.fine - da.getTime()) / 60_000);
        if (fineMin - inizioMin >= TROPPO_LUNGA_MIN) continue;
        fuori.push({
          advisorId,
          inizioMin: Math.max(0, inizioMin),
          fineMin: Math.min(24 * 60, fineMin)
        });
      }
    }
  }
  return fuori;
}

export async function GET(req: NextRequest) {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) {
    return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }

  const giorno = req.nextUrl.searchParams.get("giorno") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) {
    return NextResponse.json({ errore: "serve giorno=YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const db = getDb();
    const righe = await agendaDelGiorno(giorno);

    /*
     * DAL NOME ALL'ID, perche' l'agenda parla per nomi e le squadre per id.
     *
     * Le riunioni portano il nome del proprietario, mentre le pagine squadre
     * riconoscono le persone dai loro id HubSpot - alias compresi, per chi
     * ne ha due. L'aggancio passa da chiaveNome(), la stessa normalizzazione
     * usata in tutto il resto: senza di quella un apostrofo tipografico
     * basta a far sparire una colonna.
     */
    if (righe.length) {
      const { rows } = await db.query<{ id: string; nome: string }>(
        `SELECT id::text AS id, nome FROM proprietario WHERE nome IS NOT NULL`
      );
      const perNome = new Map<string, string>();
      for (const r of rows) perNome.set(chiaveNome(r.nome), r.id);
      for (const r of righe) r.advisorId = perNome.get(chiaveNome(r.advisor)) ?? null;
    }

    /*
     * LE AGENDE GOOGLE NON FERMANO L'AGENDA SE NON SI LEGGONO.
     *
     * Sono un di piu': senza credenziali, o se Google non risponde, restano
     * le riunioni del CRM - che e' quello che la pagina mostrava prima. Un
     * errore qui non deve far sparire tutto il resto, ma si annota, perche'
     * un'agenda che sembra libera per un guasto e' peggio di una incompleta
     * che lo dichiara.
     */
    let occupato: Occupato[] = [];
    let occupatoLetto = true;
    try {
      occupato = await occupatoDelGiorno(giorno);
    } catch (e) {
      occupatoLetto = false;
      console.error("[squadre/dettaglio] agende google", e instanceof Error ? e.message : e);
    }

    // UNA GIORNATA VUOTA E' UNA RISPOSTA, non un errore: un sabato senza
    // appuntamenti deve arrivare come elenco vuoto, non come niente.
    return NextResponse.json(
      { generato: new Date().toISOString(), giorno, righe, occupato, occupatoLetto },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    console.error("[squadre/dettaglio]", perche);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
