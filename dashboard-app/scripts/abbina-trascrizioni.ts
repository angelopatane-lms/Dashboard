// Prova in SOLA LETTURA dell'abbinamento fra registrazioni Fireflies e
// appuntamenti HubSpot: stampa cosa abbinerebbe e con quale criterio, senza
// scrivere niente da nessuna parte.
//
// PERCHE' PRIMA IN SOLA LETTURA: il flusso Zapier che questo codice sostituira'
// scrive il collegamento sulla scheda del contatto. Un abbinamento sbagliato
// mette la trascrizione di un cliente sulla scheda di un altro, ed e' un errore
// che nessuno noterebbe. Prima si guardano i numeri, poi si collega la
// scrittura.
//
// Uso:  npm run abbina -- --da 2026-08-01 --a 2026-09-13
//       npm run abbina -- --giorni 14

import { richiedi } from "./env";
import {
  abbina,
  giornoRoma,
  proprietariDelleStanze,
  type Registrazione,
  type Riunione
} from "../src/lib/abbinamento";
import { leggiFrasi, leggiNomiCitati, leggiTrascrizioni, linkTrascrizione } from "../src/lib/fireflies";
import { getDb } from "../src/lib/db";

const HUBSPOT = "https://api.hubapi.com";
const MIN = 60_000;
/** La trattativa nasce da un flusso circa sei minuti dopo la riunione: misurata
 *  mediana 378 secondi, novantesimo percentile 399. Quindici minuti di finestra
 *  sono abbondanti e non arrivano a toccare la prenotazione successiva. */
const FINESTRA_TRATTATIVA = 15 * MIN;

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hubspot<T>(percorso: string, corpo?: unknown, tentativi = 6): Promise<T> {
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  for (let i = 0; i < tentativi; i++) {
    const res = await fetch(`${HUBSPOT}${percorso}`, {
      method: corpo ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(corpo ? { body: JSON.stringify(corpo) } : {})
    });
    if (res.status === 429) {
      await attesa(1200 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} su ${percorso}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }
  throw new Error(`HubSpot continua a rispondere 429 su ${percorso}`);
}

type Pagina<T> = { results?: T[]; paging?: { next?: { after?: string } } };

/** Nome e cognome di ogni proprietario, archiviati compresi.
 *  Gli archiviati servono: Cristian Testa non lavora piu' qui ma le sue 4.656
 *  riunioni esistono ancora, e senza il suo nome risulterebbero senza titolare. */
async function leggiProprietari(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const archiviati of [false, true]) {
    let dopo: string | undefined;
    do {
      const q = new URLSearchParams({ limit: "100", archived: String(archiviati) });
      if (dopo) q.set("after", dopo);
      const d = await hubspot<Pagina<{ id: string; firstName?: string; lastName?: string }>>(
        `/crm/v3/owners?${q}`
      );
      for (const o of d.results ?? []) out[String(o.id)] = `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim();
      dopo = d.paging?.next?.after;
    } while (dopo);
  }
  return out;
}

type RiunioneGrezza = {
  id: string;
  properties: Record<string, string | null>;
};

const stanzaDa = (p: Record<string, string | null>): string | null =>
  `${p.hs_meeting_location ?? ""} ${p.hs_video_conference_url ?? ""}`.match(
    /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/
  )?.[1] ?? null;

async function leggiRiunioni(da: Date, a: Date): Promise<RiunioneGrezza[]> {
  const out: RiunioneGrezza[] = [];
  let dopo: string | undefined;
  do {
    const d = await hubspot<Pagina<RiunioneGrezza>>("/crm/v3/objects/meetings/search", {
      filterGroups: [
        {
          filters: [
            { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(da.getTime()) },
            { propertyName: "hs_meeting_start_time", operator: "LT", value: String(a.getTime()) }
          ]
        }
      ],
      properties: [
        "hs_meeting_location",
        "hs_video_conference_url",
        "hs_meeting_start_time",
        "hs_meeting_end_time",
        "hs_createdate",
        "hubspot_owner_id"
      ],
      limit: 100,
      ...(dopo ? { after: dopo } : {})
    });
    out.push(...(d.results ?? []));
    dopo = d.paging?.next?.after;
    await attesa(160);
  } while (dopo);
  return out;
}

/** Associazioni a blocchi: una chiamata ogni cento invece di una per oggetto. */
async function associazioni(da: string, verso: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await hubspot<{
      results?: Array<{ from: { id: string }; to: Array<{ toObjectId: string | number }> }>;
    }>(`/crm/v4/associations/${da}/${verso}/batch/read`, {
      inputs: ids.slice(i, i + 100).map((id) => ({ id }))
    });
    for (const r of d.results ?? []) {
      const lista = (r.to ?? []).map((t) => String(t.toObjectId));
      if (lista.length) out.set(String(r.from.id), lista);
    }
    await attesa(150);
  }
  return out;
}

async function leggiOggetti(
  tipo: string,
  ids: string[],
  proprieta: string[]
): Promise<Map<string, Record<string, string | null>>> {
  const out = new Map<string, Record<string, string | null>>();
  for (let i = 0; i < ids.length; i += 100) {
    const d = await hubspot<{ results?: Array<{ id: string; properties: Record<string, string | null> }> }>(
      `/crm/v3/objects/${tipo}/batch/read`,
      { properties: proprieta, inputs: ids.slice(i, i + 100).map((id) => ({ id })) }
    );
    for (const r of d.results ?? []) out.set(String(r.id), r.properties);
    await attesa(150);
  }
  return out;
}

function argomento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

/**
 * Un istante scritto in ora di Roma con il suo offset vero, es.
 * "2026-09-12T14:30:00+02:00" d'estate e "+01:00" d'inverno.
 *
 * L'offset si CALCOLA, non si scrive: il flusso Zapier aveva "+02:00" fisso nel
 * codice, e dal 25 ottobre - quando l'Italia torna all'ora solare - avrebbe
 * dichiarato un'ora sbagliata su ogni singolo appuntamento.
 */
function isoRoma(ms: number): string {
  const locale = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
    .format(new Date(ms))
    .replace(" ", "T");
  const scarto = Math.round((Date.parse(`${locale}Z`) - ms) / MIN);
  const segno = scarto >= 0 ? "+" : "-";
  const ore = String(Math.floor(Math.abs(scarto) / 60)).padStart(2, "0");
  const minuti = String(Math.abs(scarto) % 60).padStart(2, "0");
  return `${locale}${segno}${ore}:${minuti}`;
}

/** Aggiorna le proprieta' di un contatto. */
async function aggiornaContatto(id: string, proprieta: Record<string, string>): Promise<void> {
  const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${HUBSPOT}/crm/v3/objects/contacts/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: proprieta })
    });
    if (res.status === 429) {
      await attesa(1200 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`HubSpot ${res.status} sul contatto ${id}: ${(await res.text()).slice(0, 160)}`);
    return;
  }
  throw new Error(`HubSpot continua a rispondere 429 sul contatto ${id}`);
}

async function main() {
  const chiaveFF = richiedi("FIREFLIES_API_KEY");
  const giorni = Number(argomento("giorni") ?? 0);
  const a = argomento("a") ? new Date(`${argomento("a")}T00:00:00Z`) : new Date();
  const da = argomento("da")
    ? new Date(`${argomento("da")}T00:00:00Z`)
    : new Date(a.getTime() - (giorni || 30) * 24 * 60 * MIN);

  console.log(`periodo: ${giornoRoma(da.getTime())} -> ${giornoRoma(a.getTime())}\n`);

  const [proprietari, grezze, trascrizioni] = await Promise.all([
    leggiProprietari(),
    leggiRiunioni(da, a),
    leggiTrascrizioni(chiaveFF, da, a)
  ]);
  const nome = (id: string | null | undefined) => proprietari[String(id ?? "").trim()] ?? "";
  console.log(`riunioni HubSpot: ${grezze.length} | registrazioni Fireflies: ${trascrizioni.length}`);

  // contatto e trattativa di ogni riunione, per ricavare l'advisor effettivo
  const contattiDi = await associazioni("meetings", "contacts", grezze.map((r) => r.id));
  const idContatti = [...new Set([...contattiDi.values()].flat())];
  const [anagrafica, trattativeDi] = await Promise.all([
    leggiOggetti("contacts", idContatti, ["firstname", "lastname"]),
    associazioni("contacts", "deals", idContatti)
  ]);
  const idTrattative = [...new Set([...trattativeDi.values()].flat())];
  const trattative = await leggiOggetti("deals", idTrattative, ["hubspot_owner_id", "createdate", "dealname"]);

  const riunioni: Riunione[] = [];
  let conTrattativa = 0;
  let riassegnate = 0;
  for (const g of grezze) {
    const stanza = stanzaDa(g.properties);
    const inizio = Date.parse(g.properties.hs_meeting_start_time ?? "");
    if (!stanza || !Number.isFinite(inizio)) continue;
    const fineDichiarata = Date.parse(g.properties.hs_meeting_end_time ?? "");
    const creata = Date.parse(g.properties.hs_createdate ?? "");
    const prenotato = String(g.properties.hubspot_owner_id ?? "").trim();

    // La trattativa giusta e' quella nata insieme a questa riunione: si aggancia
    // per data di creazione e non di chiusura, perche' quando una trattativa
    // viene vinta la si rinomina e le si sposta la data di chiusura, mentre
    // l'istante in cui il flusso l'ha creata non cambia mai. Copertura misurata:
    // 85% per creazione contro 66% per chiusura.
    const contatto = (contattiDi.get(g.id) ?? [])[0];
    let effettivo = prenotato;
    if (contatto && Number.isFinite(creata)) {
      let migliore: { scarto: number; owner: string } | null = null;
      for (const idT of trattativeDi.get(contatto) ?? []) {
        const t = trattative.get(idT);
        const nata = Date.parse(t?.createdate ?? "");
        if (!t || !Number.isFinite(nata)) continue;
        const scarto = Math.abs(nata - creata);
        if (scarto <= FINESTRA_TRATTATIVA && (!migliore || scarto < migliore.scarto)) {
          migliore = { scarto, owner: String(t.hubspot_owner_id ?? "").trim() };
        }
      }
      if (migliore?.owner) {
        conTrattativa++;
        effettivo = migliore.owner;
        if (effettivo !== prenotato) riassegnate++;
      }
    }

    const p = contatto ? anagrafica.get(contatto) : undefined;
    riunioni.push({
      id: g.id,
      stanza,
      inizio,
      fine: Number.isFinite(fineDichiarata) && fineDichiarata > inizio ? fineDichiarata : inizio + 30 * MIN,
      advisorPrenotato: prenotato,
      advisorEffettivo: effettivo,
      contattoId: contatto,
      contattoNome: p ? `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim() : undefined
    });
  }
  console.log(
    `riunioni con stanza: ${riunioni.length} | con trattativa agganciata: ${conTrattativa}` +
      ` | riassegnate a un altro advisor: ${riassegnate}`
  );

  // Quali consulenze si sono davvero svolte: serve a non attribuire una
  // registrazione lunga anche allo slot successivo quando quel cliente non si
  // e' presentato. E' lo stesso dato che alimenta la colonna Consulenze della
  // dashboard, quindi i due numeri non possono divergere.
  const db = getDb();
  const svolte = await db.query<{ id: string }>(
    `SELECT DISTINCT COALESCE(a.nuovo_id, t.contact_id)::text AS id
       FROM trattativa t
       LEFT JOIN alias_contatto a ON a.vecchio_id = t.contact_id
      WHERE t.contact_id IS NOT NULL
        AND t.svolta_ts >= $1::timestamptz AND t.svolta_ts < $2::timestamptz`,
    [da.toISOString(), a.toISOString()]
  );
  const alias = await db.query<{ vecchio: string; nuovo: string }>(
    "SELECT vecchio_id::text AS vecchio, nuovo_id::text AS nuovo FROM alias_contatto"
  );
  const canonico = new Map(alias.rows.map((r) => [r.vecchio, r.nuovo]));
  const risolvi = (id: string) => {
    let v = id;
    for (let i = 0; i < 5 && canonico.has(v); i++) v = canonico.get(v)!;
    return v;
  };
  const insiemeSvolte = new Set(svolte.rows.map((r) => r.id));
  for (const m of riunioni) {
    if (m.contattoId) m.svolta = insiemeSvolte.has(risolvi(m.contattoId));
  }
  console.log(`consulenze svolte nel periodo: ${insiemeSvolte.size}\n`);

  const registrazioni: Registrazione[] = trascrizioni
    .filter((t) => t.stanza)
    .map((t) => ({ id: t.id, stanza: t.stanza!, inizio: t.inizio, durataMin: t.durataMin }));

  // Prima passata senza i nomi: gli action items costano una chiamata ciascuno,
  // quindi si chiedono solo per le registrazioni che restano fuori.
  const primo = abbina(registrazioni, riunioni);
  const daChiedere = primo.registrazioniSenzaRiunione.filter((r) => r.durataMin >= 10);
  if (daChiedere.length) {
    console.log(`chiedo gli action items per ${daChiedere.length} registrazioni rimaste fuori...`);
    for (const r of daChiedere) {
      try {
        r.nomi = await leggiNomiCitati(chiaveFF, r.id);
      } catch {
        r.nomi = [];
      }
      await attesa(250);
    }
  }
  // Le frasi servono solo dove una registrazione copre piu' di un appuntamento:
  // li' decidono dove tagliare e se il secondo cliente e' davvero entrato.
  // Chiederle per tutte sarebbe una chiamata a registrazione per centinaia di
  // frasi ciascuna, quindi si guarda prima chi ne ha bisogno.
  const perStanzaGiorno = new Map<string, Riunione[]>();
  for (const m of riunioni) {
    const k = `${m.stanza}|${giornoRoma(m.inizio)}`;
    if (!perStanzaGiorno.has(k)) perStanzaGiorno.set(k, []);
    perStanzaGiorno.get(k)!.push(m);
  }
  const conPiuSlot = registrazioni.filter((r) => {
    const fine = r.inizio + r.durataMin * MIN;
    const coperte = (perStanzaGiorno.get(`${r.stanza}|${giornoRoma(r.inizio)}`) ?? []).filter(
      (m) => Math.min(fine, m.fine) - Math.max(r.inizio, m.inizio) >= 10 * MIN
    );
    return new Set(coperte.map((m) => m.inizio)).size >= 2;
  });
  if (conPiuSlot.length) {
    console.log(`chiedo le frasi per ${conPiuSlot.length} registrazioni che coprono piu' appuntamenti...`);
    for (const r of conPiuSlot) {
      try {
        r.frasi = await leggiFrasi(chiaveFF, r.id);
      } catch {
        r.frasi = [];
      }
      await attesa(280);
    }
  }

  const { abbinamenti, registrazioniSenzaRiunione } = abbina(registrazioni, riunioni);

  const perCriterio = new Map<string, number>();
  for (const x of abbinamenti) perCriterio.set(x.criterio, (perCriterio.get(x.criterio) ?? 0) + 1);
  console.log("\n=== ABBINAMENTI ===");
  for (const [c, n] of [...perCriterio.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(18)} ${String(n).padStart(5)}`);
  }
  console.log(`  ${"TOTALE".padEnd(18)} ${String(abbinamenti.length).padStart(5)} su ${registrazioni.length} registrazioni`);

  const lunghe = registrazioni.filter((r) => r.durataMin > 15);
  const lungheAbbinate = abbinamenti.filter((x) => x.registrazione.durataMin > 15).length;
  console.log(
    `  registrazioni oltre i 15 minuti: ${lungheAbbinate} su ${lunghe.length}` +
      ` = ${Math.round((100 * lungheAbbinate) / Math.max(1, lunghe.length))}%`
  );

  const scarti = abbinamenti.map((x) => x.scartoMin).sort((a, b) => a - b);
  if (scarti.length) {
    console.log(
      `  scarto fra registrazione e appuntamento: 10% ${scarti[Math.floor(scarti.length * 0.1)]}` +
        ` | mediana ${scarti[Math.floor(scarti.length * 0.5)]}` +
        ` | 90% ${scarti[Math.floor(scarti.length * 0.9)]} minuti`
    );
  }

  console.log("\n=== CONFRONTO CON QUELLO CHE HA FATTO IL FLUSSO ZAPIER ===");
  const contattiAbbinati = [...new Set(abbinamenti.map((x) => x.riunione.contattoId).filter(Boolean))] as string[];
  const conLink = await leggiOggetti("contacts", contattiAbbinati, ["link_trascrizione_fireflies"]);
  let gia = 0;
  for (const id of contattiAbbinati) {
    if ((conLink.get(id)?.link_trascrizione_fireflies ?? "").trim()) gia++;
  }
  console.log(`  contatti che abbineremmo: ${contattiAbbinati.length}`);
  console.log(`  di questi, gia' con un collegamento: ${gia}`);
  console.log(`  nuovi, che oggi non hanno niente: ${contattiAbbinati.length - gia}`);

  // Quanti verrebbero lasciati stare perche' il collegamento presente si
  // riferisce gia' a quella consulenza: sono i record che NON creeremmo
  // nell'oggetto Appuntamento.
  let stessaConsulenza = 0;
  for (const x of abbinamenti) {
    if (!x.riunione.contattoId) continue;
    const dentro = (conLink.get(x.riunione.contattoId)?.link_trascrizione_fireflies ?? "").match(/\[([^\]]+)\]/)?.[1];
    const t = dentro ? Date.parse(dentro.trim()) : NaN;
    if (Number.isFinite(t) && Math.abs(t - x.riunione.inizio) < 30 * MIN) stessaConsulenza++;
  }
  console.log(`  gia' riferiti alla STESSA consulenza, quindi da non toccare: ${stessaConsulenza}`);
  console.log(`  scritture effettive che farebbe: ${abbinamenti.length - stessaConsulenza}`);

  console.log("\n=== PRIMI VENTI ABBINAMENTI ===");
  for (const x of abbinamenti.slice(0, 20)) {
    const quando = new Date(x.registrazione.inizio).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
    console.log(
      `  ${quando.slice(5, 16)} ${x.registrazione.stanza} ${String(Math.round(x.registrazione.durataMin)).padStart(3)}min` +
        ` -> ${(x.riunione.contattoNome ?? "(senza nome)").slice(0, 24).padEnd(26)}` +
        ` ${nome(x.riunione.advisorEffettivo).slice(0, 20).padEnd(22)}` +
        ` [${x.criterio}, scarto ${x.scartoMin}min${x.criterio === "piu-slot" || x.aSec < x.registrazione.durataMin * 60 ? `, parte ${Math.round(x.daSec / 60)}-${Math.round(x.aSec / 60)}min` : ""}]`
    );
  }

  // La scrittura avviene solo se richiesta esplicitamente: senza --scrivi
  // questo script guarda e basta.
  if (process.argv.includes("--scrivi")) {
    const audioDi = new Map(trascrizioni.map((t) => [t.id, t.audio]));
    const limite = Number(argomento("max") ?? 0) || abbinamenti.length;
    let scritti = 0;
    let falliti = 0;
    let invariati = 0;

    // SI SCRIVE SOLO SE IL VALORE CAMBIA DAVVERO.
    //
    // Su HubSpot c'e' un'applicazione che crea un record nell'oggetto
    // Appuntamento a ogni aggiornamento del collegamento sul contatto. Siccome
    // la passata notturna rilegge qualche giorno all'indietro per recuperare le
    // registrazioni arrivate in ritardo, riscrivere lo stesso valore
    // produrrebbe un record nuovo a ogni notte: doppioni da cancellare a mano
    // che crescono da soli. Confrontare prima costa una lettura a blocchi ed e'
    // l'unica difesa che non dipende da come e' fatta quell'applicazione.
    const valoriAttuali = await leggiOggetti(
      "contacts",
      [...new Set(abbinamenti.slice(0, limite).map((x) => x.riunione.contattoId).filter(Boolean))] as string[],
      ["link_trascrizione_fireflies", "link_audio_fireflies"]
    );

    console.log(`\n=== SCRITTURA su HubSpot (${Math.min(limite, abbinamenti.length)} contatti) ===`);
    for (const x of abbinamenti.slice(0, limite)) {
      const contatto = x.riunione.contattoId;
      if (!contatto) continue;
      const quando = isoRoma(x.riunione.inizio);
      const proprieta: Record<string, string> = {
        // Si scrive l'indirizzo dell'applicazione e non quello del file su S3:
        // il secondo e' firmato e vale sei ore, quindi arriva gia' scaduto.
        link_trascrizione_fireflies: `${linkTrascrizione(x.registrazione.id)} [${quando}]`
      };
      const audio = audioDi.get(x.registrazione.id);
      if (audio) proprieta.link_audio_fireflies = `${audio} [${quando}]`;

      const attuale = valoriAttuali.get(contatto) ?? {};

      // SI CONFRONTANO LE CONSULENZE, NON LE STRINGHE.
      //
      // Non basta chiedersi se il valore e' cambiato: il flusso Zapier scriveva
      // lo stesso appuntamento con l'indirizzo S3, e noi scriviamo quello
      // stabile. La stringa risulterebbe diversa, l'applicazione che sorveglia
      // il contatto vedrebbe un aggiornamento e creerebbe un record nuovo per
      // una consulenza che ne ha gia' uno. Sui contatti gia' toccati dal Zap
      // sarebbero decine di doppioni da cancellare a mano.
      //
      // La data fra parentesi quadre identifica l'appuntamento, ed e' l'unica
      // parte che non dipende da chi ha scritto ne' da come. Se coincide, quella
      // consulenza e' gia' registrata e si lascia stare.
      // La tolleranza serve perche' il flusso Zapier non scriveva l'orario
      // dell'appuntamento ma quello della registrazione arrotondato alla
      // mezz'ora: sullo stesso appuntamento i due valori possono differire di
      // qualche decina di minuti senza che sia una consulenza diversa. Mezz'ora
      // e' l'intervallo fra due appuntamenti, quindi non puo' confondere due
      // consulenze davvero distinte dello stesso contatto.
      const appuntamentoDi = (valore: string | null | undefined): number => {
        const dentro = (valore ?? "").match(/\[([^\]]+)\]/)?.[1]?.trim();
        const t = dentro ? Date.parse(dentro) : NaN;
        return Number.isFinite(t) ? t : NaN;
      };
      const gia = appuntamentoDi(attuale.link_trascrizione_fireflies);
      if (Number.isFinite(gia) && Math.abs(gia - x.riunione.inizio) < 30 * MIN) {
        invariati++;
        continue;
      }

      const daScrivere = Object.fromEntries(
        Object.entries(proprieta).filter(([campo, valore]) => (attuale[campo] ?? "") !== valore)
      );
      if (!Object.keys(daScrivere).length) {
        invariati++;
        continue;
      }
      try {
        await aggiornaContatto(contatto, daScrivere);
        scritti++;
        console.log(
          `  ${(x.riunione.contattoNome ?? contatto).slice(0, 28).padEnd(30)} ${contatto}` +
            `  ${proprieta.link_trascrizione_fireflies}`
        );
      } catch (e) {
        falliti++;
        console.log(`  errore su ${x.riunione.contattoNome ?? contatto}: ${e instanceof Error ? e.message : e}`);
      }
      await attesa(120);
    }
    console.log(`  scritti: ${scritti} | gia' aggiornati, saltati: ${invariati} | falliti: ${falliti}`);
  } else {
    console.log("\n(nessuna scrittura: aggiungi --scrivi per aggiornare i contatti)");
  }

  const orfaneLunghe = registrazioniSenzaRiunione.filter((r) => r.durataMin > 15);
  console.log(`\n=== RESTANO FUORI: ${orfaneLunghe.length} registrazioni oltre i 15 minuti ===`);
  const padroni = proprietariDelleStanze(riunioni);
  for (const r of orfaneLunghe.slice(0, 15)) {
    const quando = new Date(r.inizio).toLocaleString("sv-SE", { timeZone: "Europe/Rome" });
    console.log(
      `  ${quando.slice(5, 16)} ${r.stanza} ${String(Math.round(r.durataMin)).padStart(3)}min` +
        ` (stanza di ${nome(padroni.get(r.stanza)) || "sconosciuto"})`
    );
  }
}

main().catch((e) => {
  console.error("errore:", e instanceof Error ? e.message : e);
  process.exit(1);
});
