import { NextRequest, NextResponse } from "next/server";
import { ieriRoma } from "@/lib/report/giornaliero";
import { piuGiorni } from "@/lib/squadre/finestra";
import { latenzaDalFoglio } from "@/lib/squadre/finestra";

/**
 * IL TEMPO DI RISPOSTA, LETTO ADESSO: solo il foglio Operatori, niente
 * HubSpot e niente database.
 *
 * PERCHE' NON BASTA LA FOTOGRAFIA. Il tempo di risposta vive nella colonna
 * Latenza del foglio, e nella fotografia ci arriva col giro delle due di
 * notte: fino a domattina, un giorno lavorato oggi non ce l'ha, e il
 * quadrante dice "non misurato" su dati che invece esistono gia'. Peggio il
 * giorno in cui la colonna comincia a esistere - l'11 novembre 2026 - quando
 * tutto il mese passato resta vuoto finche' il giro lungo non lo rifa'.
 *
 * E' LA STESSA SCELTA FATTA PER GLI INCASSI, per una ragione diversa: li' una
 * cifra vecchia sarebbe sbagliata perche' un incasso si corregge, qui sarebbe
 * sbagliata perche' arriva tardi. In tutti e due i casi il rimedio e' leggere
 * dalla fonte nel momento in cui qualcuno apre la pagina.
 *
 * COSTA UNA LETTURA DI FOGLIO E UNA DI PROPRIETARI, due secondi, e chi chiama
 * la fa in parallelo con gli incassi: sulla pagina non si sente. Il resto
 * della fotografia - assegnati, chiamate, appuntamenti, consulenze - resta
 * dov'era: quelli non cambiano piu' una volta passata la giornata.
 *
 * STESSA CHIAVE DELL'ALTRA ROTTA, SQUADRE_SECRET: e' lo stesso lettore, il
 * progetto Squadre, che si viene a prendere un pezzo in piu'.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const atteso = process.env.SQUADRE_SECRET;
  if (!atteso) {
    return NextResponse.json({ errore: "SQUADRE_SECRET non impostata" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${atteso}`) {
    return NextResponse.json({ errore: "chiave non valida" }, { status: 403 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ errore: "HUBSPOT_PRIVATE_APP_TOKEN non impostata" }, { status: 500 });
  }

  const q = req.nextUrl.searchParams;
  const a = q.get("a") ?? ieriRoma();
  const quanti = Math.min(Math.max(Number(q.get("giorni") ?? 45), 1), 400);
  const da = q.get("da") ?? piuGiorni(a, -(quanti - 1));

  try {
    const giorni = await latenzaDalFoglio(token, da, a);
    return NextResponse.json(
      { generato: new Date().toISOString(), finestra: { da, a }, giorni },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errore: perche }, { status: 502 });
  }
}
