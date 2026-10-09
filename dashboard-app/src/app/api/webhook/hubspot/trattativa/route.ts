import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { getDb } from "@/lib/db";
import { aggiornaUnaTrattativa } from "@/lib/trattative/sync";

/**
 * NESSUNA RISPOSTA MEMORIZZATA.
 *
 * Next.js conserva le risposte delle chiamate in uscita in .next/cache e le
 * riusa. Su dati di un CRM che cambia in continuazione questo significa
 * mostrare il passato senza dirlo: misurato il 16 settembre, il proprietario di
 * una trattativa cambiato alle 06:24 continuava a risultare quello vecchio
 * venticinque minuti dopo, in locale e in produzione, e la card dell'agenda
 * restava nella colonna della persona sbagliata. La stessa richiesta fatta da
 * uno script fuori da Next dava subito il valore nuovo, e svuotando la cache la
 * rotta si allineava all-istante.
 *
 * Non scade in modo prevedibile e non lascia traccia: l-unico segnale era
 * hs_lastmodifieddate fermo al giorno prima dentro la risposta. Meglio pagare
 * ogni volta la chiamata che servire un dato vecchio senza accorgersene.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Il webhook dei workflow HubSpot: aggiorna una trattativa appena cambia fase,
 * invece di aspettare la ricostruzione notturna di tutte.
 *
 * COSA SBLOCCA. svolta_ts e la tabella no_show sono le ultime due fonti lente
 * rimaste: colorano le card dell'agenda (verde svolta, grigio annullato) e
 * riempiono la colonna Consulenze della pagina Campagne. Finche' arrivano dal
 * giro notturno, nel pomeriggio quella pagina mostra incassi di oggi accanto a
 * consulenze di ieri - due colonne affiancate con eta' diverse, e un rapporto
 * fra le due che sembra migliore del vero.
 *
 * DA DOVE ARRIVA. Il workflow "Performance Tracker - Trattative Svolte" scatta
 * gia' oggi al cambio di fase_precedente, attende un minuto e chiama un
 * webhook. Non c'e' nessun innesco da inventare: e' esattamente l'istante in
 * cui una trattativa diventa svolta o disertata.
 *
 * PERCHE' RICALCOLA E NON SI FIDA DELL'ISTANTE. Il workflow parte a ogni cambio
 * di fase, e solo alcuni valgono come consulenza svolta: la selezione la fanno
 * i criteri applicati alla cronologia. Prendere l'ora della chiamata come data
 * della svolta segnerebbe svolte dove non ce ne sono. Si rilegge quindi la
 * trattativa con la sua cronologia e si riapplica la stessa regola del giro
 * completo - stesse funzioni, stesso SQL, un solo input.
 */

/** Il corpo ammesso. Il payload di un workflow sono poche proprieta'. */
const TETTO_CORPO = 64 * 1024;

async function annota(esito: string, messaggio: string): Promise<void> {
  try {
    const ora = new Date().toISOString();
    await getDb().query(
      `INSERT INTO sync_log (tipo, iniziato_at, finito_at, esito, messaggio)
       VALUES ('webhook-hubspot', $1::timestamptz, $1::timestamptz, $2, $3)`,
      [ora, esito, messaggio.slice(0, 4000)]
    );
  } catch (e) {
    console.error("[webhook/hubspot] non sono riuscito ad annotare", e);
  }
}

/** Confronto a tempo costante fra due stringhe di lunghezza qualsiasi. */
function ugualiInSicurezza(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * L'identificativo della trattativa, cercato in tutte le forme plausibili.
 *
 * PERCHE' NON UNA SOLA. Con Fireflies abbiamo imparato a nostre spese che il
 * payload documentato e quello reale possono non coincidere, e che un campo
 * letto col nome sbagliato non da' errore: da' undefined, e il gestore non fa
 * niente in silenzio. Qui il nome esatto lo vedremo alla prima consegna vera;
 * nel frattempo si accettano le forme che HubSpot usa nei suoi payload, e se
 * non se ne trova nessuna il corpo finisce nel log per intero.
 */
function idTrattativa(p: Record<string, unknown>): string {
  const dentro = (p.properties ?? {}) as Record<string, unknown>;
  for (const v of [p.objectId, p.hs_object_id, p.dealId, p.objectid, dentro.hs_object_id, dentro.objectId]) {
    const s = String(v ?? "").trim();
    if (/^\d+$/.test(s)) return s;
  }
  return "";
}

async function lavora(dealId: string): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    await annota("errore", `${dealId}: HUBSPOT_PRIVATE_APP_TOKEN non impostato`);
    return;
  }
  const t0 = Date.now();
  try {
    const r = await aggiornaUnaTrattativa(token, dealId);
    const riga = r
      ? `trattativa ${r.dealId}: svolta ${r.svolta ? r.svolta.toISOString() : "(nessuna)"}, ` +
        `${r.noShow} no show, ${Date.now() - t0} ms`
      : `trattativa ${dealId}: non leggibile o senza data di creazione, ${Date.now() - t0} ms`;
    console.log(`[webhook/hubspot] ${riga}`);
    await annota(r ? "ok" : "ignorato", riga);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error("[webhook/hubspot]", e);
    await annota("errore", `trattativa ${dealId}: ${m}`);
  }
}

/**
 * I SEGRETI CHE QUESTO ENDPOINT ACCETTA: uno per chiamante, non uno per tutti.
 *
 * PERCHE' DUE. Il valore di `HUBSPOT_WEBHOOK_SECRET` e' di tipo *Secret* su
 * Vercel - si sostituisce, non si rilegge - e vive dentro la configurazione di
 * un workflow che nessuno ricorda piu' quale sia. Il 9 ottobre 2026 serviva
 * aggiungere un secondo chiamante, il flusso che annuncia le trattative appena
 * create, e le strade erano due: cercare il vecchio valore nei flussi e negli
 * Apps Script, oppure sostituirlo e aggiornare tutti i chiamanti insieme - con
 * una finestra di 401 e il rischio di dimenticarne uno, che poi smette di
 * consegnare in silenzio.
 *
 * Accettarne due toglie il problema: il chiamante che c'e' non si tocca, il
 * nuovo nasce con una credenziale sua. Ed e' anche piu' sano in generale -
 * quando si vuole ritirare la vecchia, la si spegne e si guarda chi smette di
 * consegnare: e' l'unico modo serio per scoprire chi la stava usando.
 *
 * NON E' UN INDEBOLIMENTO: due valori validi non sono piu' indovinabili di
 * uno, e ciascuno copre meno superficie.
 */
const NOMI_SEGRETO = ["HUBSPOT_WEBHOOK_SECRET", "HUBSPOT_TRATTATIVA_SECRET"] as const;

export async function POST(req: NextRequest) {
  const ammessi = NOMI_SEGRETO.map((n) => process.env[n]).filter(
    (v): v is string => Boolean(v && v.length)
  );
  if (!ammessi.length) {
    await annota("errore", `nessuno di ${NOMI_SEGRETO.join(" o ")} e' impostato`);
    return NextResponse.json({ error: "non configurato" }, { status: 500 });
  }

  // L'AUTENTICAZIONE PASSA DALL'INDIRIZZO. I webhook dei workflow HubSpot
  // firmano con il segreto dell'app connessa, e con un'app privata quel
  // meccanismo non e' documentato in modo utilizzabile. Il segreto sta quindi
  // nella query dell'URL, che vive solo dentro la configurazione del workflow e
  // non e' visibile a chi non amministra il portale. Alla prima consegna vera
  // annotiamo quali intestazioni di firma arrivano davvero: se ce n'e' una
  // verificabile, si stringe passando a quella.
  // DUE NOMI PER LO STESSO PARAMETRO. Si chiamava solo `k`, e chi ha
  // configurato il workflow ha scritto `segreto` - il nome con cui questa cosa
  // viene chiamata dappertutto, nei commenti e nella variabile d'ambiente.
  // Rifiutare quella chiamata sarebbe stato pignolo e basta: il valore era
  // giusto, era giusto anche l'indirizzo, e il rifiuto arrivava senza dire
  // quale delle due cose non andava. Si accettano tutti e due.
  const dato = req.nextUrl.searchParams.get("segreto") ?? req.nextUrl.searchParams.get("k") ?? "";
  // SI CONFRONTANO TUTTI, sempre, anche dopo averne trovato uno giusto: uscire
  // al primo che combacia renderebbe il tempo di risposta diverso a seconda di
  // quale segreto si e' indovinato.
  const valido = ammessi.reduce((ok, s) => ugualiInSicurezza(dato, s) || ok, false);
  if (!valido) {
    // COSA NON TORNAVA, senza scrivere il segreto nel log: se il parametro non
    // c'e' il problema e' il nome, se c'e' ma di lunghezza diversa e' un
    // valore sbagliato o uno spazio di troppo, se la lunghezza e' la stessa e'
    // un carattere diverso. Tre guasti diversi che prima davano tutti la
    // stessa riga.
    await annota(
      "respinto",
      dato
        ? `valore diverso da quelli configurati (arrivati ${dato.length} caratteri, ` +
          `attesi ${[...new Set(ammessi.map((s) => s.length))].join(" o ")})`
        : "nessun parametro segreto/k nell'indirizzo"
    );
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const corpo = await req.text();
  if (corpo.length > TETTO_CORPO) {
    return NextResponse.json({ error: "corpo troppo lungo" }, { status: 413 });
  }

  let p: Record<string, unknown> = {};
  try {
    const letto = JSON.parse(corpo);
    // Un workflow puo' mandare un oggetto solo o una lista: si normalizza.
    p = Array.isArray(letto) ? (letto[0] ?? {}) : letto;
  } catch {
    await annota("ignorato", `corpo non leggibile: ${corpo.slice(0, 300)}`);
    return NextResponse.json({ error: "corpo non leggibile" }, { status: 400 });
  }

  const dealId = idTrattativa(p);
  if (!dealId) {
    // Si annota il corpo INTERO e le intestazioni di firma: e' il modo in cui
    // scopriamo la forma vera del payload, invece di dedurla.
    const firme = [...req.headers.entries()]
      .filter(([k]) => k.toLowerCase().includes("signature") || k.toLowerCase().startsWith("x-hubspot"))
      .map(([k, v]) => `${k}=${v.slice(0, 40)}`)
      .join(" ");
    await annota("ignorato", `nessun id trattativa | intestazioni: ${firme} | corpo: ${corpo.slice(0, 1500)}`);
    return NextResponse.json({ ok: true, ignorato: true });
  }

  // Risposta subito, lavoro dopo: qui il lavoro e' breve - una trattativa sola -
  // ma la regola vale lo stesso, perche' un webhook che va in timeout viene
  // considerato fallito anche quando ha funzionato.
  waitUntil(lavora(dealId));

  return NextResponse.json({ ok: true, preso: dealId });
}

/** Per controllare dal browser che l'indirizzo risponda. Non rivela il
 *  segreto: dice solo se e' configurato. */
export async function GET() {
  return NextResponse.json({
    webhook: "hubspot-trattativa",
    // Quanti segreti sono configurati, non quali: serve a capire se il
    // nuovo chiamante puo' gia' passare, senza dire niente sui valori.
    segreti: NOMI_SEGRETO.filter((n) => Boolean(process.env[n])).length
  });
}
