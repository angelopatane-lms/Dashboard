// Regole di identita' delle campagne: quali nomi sono validi, come si
// raggruppano le varianti dello stesso nome e come si isolano i contatti
// assegnati subito.
//
// Stanno qui e non nelle singole query perche' database e interfaccia devono
// applicarle nello stesso modo: la spesa arriva dal foglio Ads e i lead da
// Postgres, e se le due parti dividessero le righe in modo diverso la tabella
// mostrerebbe spesa senza lead e lead senza spesa.

/**
 * Regola del dipartimento marketing: id_campagna_refresh deve essere tutto
 * minuscolo. Un nome con una maiuscola non e' un id di campagna valido.
 *
 * COSA COMPORTA, misurato il 5 settembre 2026:
 * - Foglio Ads: 19 nomi su 73 hanno maiuscole (7.514 EUR sul trimestre) e
 *   TUTTI hanno zero lead. Sono nomi scritti a mano che non corrispondono a
 *   nessuna campagna HubSpot.
 * - HubSpot: 3.299 campagne su 5.169 hanno maiuscole, ma sono quasi tutte
 *   vecchie (native advertising 2023-24, import da typeform). Sul trimestre
 *   valgono 117 lead su 31.293 (0,37%).
 *
 * La vista "tutte" NON applica questa regola: serve proprio a vedere tutto
 * quello che c'e', ogni voce del foglio della spesa compresa.
 */
export function nomeConforme(nome: string): boolean {
  return nome === nome.toLowerCase();
}

/**
 * SUFFISSI DI VARIANTE. La stessa campagna compare con una coda che ne indica
 * la versione o il pubblico: "_test_instant", "_test_creative", "_2", "_new",
 * "_lal" (lookalike), "_interessi". Nella vista unificata confluiscono tutte
 * nella campagna base.
 *
 * DUE CONDIZIONI, ed entrambe servono.
 *
 * 1. La base deve ESISTERE come campagna. Senza, si romperebbero i nomi in cui
 *    la coda fa parte del prodotto: "ll_ew_test_del_denaro" diventerebbe
 *    "ll_ew", "lms_coworking_smoke_test" diventerebbe "lms_coworking_smoke".
 *    Misurato: dei 77 nomi che contengono "test", 52 hanno una base esistente e
 *    vanno uniti, 25 no, e la condizione li separa esattamente.
 *
 * 2. La base deve avere almeno DUE segmenti. Protegge le edizioni numerate, che
 *    sono programmi diversi e non varianti: senza, "icmd_6" e "icmd_8"
 *    finirebbero dentro "icmd".
 *
 * PERCHE' UN ELENCO E NON UNA REGOLA GENERICA. Tagliare qualsiasi coda finche'
 * non si trova una campagna esistente sembra piu' comodo ma fonde cose diverse:
 * misurato, unirebbe 366 campagne e 164.800 eventi, fra cui
 * "lms_mep_ew_ikigai_vivere_felici" dentro "lms_mep_ew_ikigai" (55.279 eventi,
 * due campagne distinte) e tutte le code di canale - "_tiktok", "_google",
 * "_yt" - che invece vanno tenute separate. Con l'elenco esplicito le fusioni
 * sono 78 per 17.065 eventi.
 */
/**
 * I SUFFISSI CHE UN WORKFLOW AGGIUNGE A UNA CAMPAGNA GIA' ESISTENTE.
 *
 * Una campagna che si chiama come un'altra piu' uno di questi non e' una
 * campagna nuova: e' la stessa persona riscritta quando le succede qualcosa -
 * le viene fissata una consulenza, si presenta a un evento, la prende in carico
 * un advisor. Contarla come conversione significa contare due volte la stessa
 * persona.
 *
 * L'ELENCO E' ESPLICITO PERCHE' LA REGOLA STRUTTURALE NON BASTA. "Nome di
 * un'altra campagna piu' un suffisso" descrive 534 campagne e 199.124 eventi,
 * il 28% del totale, e dentro ci finiscono campagne vere:
 * "lms_mep_ew_ikigai_vivere_felici" e' una campagna, non una variante di
 * "ikigai", e i test A/B "_a" e "_b" portano 56.514 persone che non stanno da
 * nessun'altra parte.
 *
 * A separare le due famiglie e' una misura, non un'impressione: quanta della
 * gente sulla variante e' GIA' sulla campagna base. Questi suffissi stanno fra
 * il 76% e il 100%; quelli lasciati fuori stanno sotto il 25%, cioe' portano
 * gente nuova e sono campagne a tutti gli effetti.
 *
 * NON C'E' "_rilancio", che sta a meta' strada: il 60% della sua gente e' gia'
 * sulla base, ma il restante 40% - circa 4.000 persone - non sta da nessun'altra
 * parte. Escluderlo si puo', ed e' una decisione da prendere sapendo che quelle
 * 4.000 spariscono dai lead.
 *
 * Quando ne compare uno nuovo si aggiunge qui: e' l'unico posto.
 */
export const SUFFISSI_TECNICI = [
  "test_instant",
  "presenti",
  "in_db",
  "consulenza",
  "colloquio",
  "survey",
  "candidature_postevento",
  "richiesta_informazioni",
  "richieste_info",
  "richiesta_info",
  // Cognomi di chi prende in carico il contatto: marcatori di assegnazione,
  // esattamente come "_test_instant". Tutti fra il 96% e il 100%.
  "santori",
  "asiacuccu",
  "dascanio",
  "patane",
  "hassan"
];

/**
 * I suffissi che la piattaforma pubblicitaria aggiunge spezzando una campagna:
 * creativita' diverse, lotti di annunci, pubblici, versioni, rilanci.
 *
 * NON SONO CAMPAGNE, sono pezzi della stessa. I lead tornano indietro col nome
 * base - per questo le loro righe mostrano spesa e zero lead - mentre il budget
 * resta scritto sul nome spezzato: misurato sul foglio spesa da maggio a
 * settembre, 112.460 EUR stanno su una variante invece che sulla sua base, e
 * quei soldi mancanti fanno leggere alle campagne base un costo per lead meta'
 * di quello vero.
 *
 * "test(_.+)?" copre da solo tutta la famiglia delle creativita'
 * ("_test_creative", "_test_creative_20mag") e il marcatore "_test_instant".
 */
const SUFFISSI_SPEZZONI = [
  "test(_.+)?",
  "[0-9]+",
  "new",
  "lal",
  "int",
  "interessi",
  "batch(_.+)?",
  "best_creative(_.+)?",
  "scale",
  "warm",
  "retargeting",
  "ll",
  "v[0-9]+",
  "refresh(_.+)?"
];

/**
 * TUTTO QUELLO CHE, IN UNIFICATE, SI SCRIVE COL NOME DELLA BASE.
 *
 * Due famiglie che arrivano da mondi diversi ma vanno trattate uguale: gli
 * spezzoni pubblicitari qui sopra, e le varianti tecniche di SUFFISSI_TECNICI -
 * quelle che un workflow scrive quando alla persona succede qualcosa.
 *
 * Delle seconde i lead non si contano nemmeno, perche' sono la stessa persona
 * gia' contata sulla base; ma telefonate, appuntamenti, consulenze, chiusure e
 * incassi sono fatti veri, avvenuti su quella campagna, e vanno sulla riga
 * base. Prima restavano su righe a se' con zero lead: la riga
 * "coaching_part_time_webinar_richiesta_informazioni" teneva 21 appuntamenti
 * che sono di "coaching_part_time_webinar".
 */
const PATTERN_VARIANTE = `(${[...SUFFISSI_SPEZZONI, ...SUFFISSI_TECNICI].join("|")})`;

export const RE_SUFFISSO_VARIANTE = new RegExp(`_${PATTERN_VARIANTE}$`);

/** La base e' accettabile solo se le resta almeno un secondo segmento. */
export function baseAccettabile(base: string): boolean {
  return base.includes("_");
}

/**
 * MARCATORE DI ASSEGNAZIONE IMMEDIATA, non una campagna a se'.
 *
 * Un workflow HubSpot riscrive id_campagna_refresh aggiungendo "_test_instant"
 * al nome della campagna quando il contatto viene assegnato subito, invece che
 * dopo alcune ore. La riscrittura lascia una voce nella cronologia della
 * proprieta', ed e' quella che il bootstrap aveva letto come una conversione.
 *
 * NON LO E': e' lo stesso contatto, sulla stessa campagna, che cambia stato di
 * assegnazione. Misurato: degli 8.382 marcatori del trimestre nessuno e' privo
 * di una conversione vera che lo precede, e la distanza fra i due ha mediana 12
 * secondi.
 *
 * E' un caso particolare di RE_SUFFISSO_VARIANTE, ma va tenuto distinto: solo
 * questo suffisso identifica un gruppo di contatti, gli altri sono solo nomi.
 */
export const SUFFISSO_INSTANT = "_test_instant";

/**
 * FORMATO DI EROGAZIONE: evento dal vivo oppure funnel sempre attivo.
 *
 * Serve a non mescolare le due cose quando si legge il ROAS: la spesa di un
 * LIVE entra subito mentre i suoi risultati arrivano dopo, e messa insieme a
 * quella dell'evergreen fa sembrare disastrosa una categoria che non lo e'.
 *
 * COME SI RICONOSCE. Il segno affidabile e' "ew" (Evergreen Webinar), applicato
 * per procedura; i live si riconoscono da "live", "webinar" o "workshop" nel
 * nome. Il confronto e' per SEGMENTO e non per sottostringa, altrimenti "ew"
 * comparirebbe dentro parole qualsiasi.
 *
 * QUANDO CI SONO ENTRAMBI vince evergreen: sono tre campagne in tutto, del tipo
 * "lms_mep_ew_indipendenza_femminile_webinar", dove "webinar" descrive il
 * contenuto e "ew" dice come viene erogato.
 *
 * LA TERZA OPZIONE NON E' UN RIPIEGO. Misurato sulle 1.872 campagne conformi:
 * evergreen 448 campagne e il 60,0% degli eventi, live 63 e il 4,3%, ma 1.361
 * campagne e il 35,7% degli eventi non portano nessun segno.
 *
 * E in buona parte non e' un difetto di etichettatura: fra le piu' grosse senza
 * segno ci sono "chatter_mep", "sette_email_aperte",
 * "quiz_scopri_che_donna_sei", "carrello_abbandonato". Non sono eventi ne'
 * funnel evergreen, sono altre sorgenti di acquisizione, e una terza voce e'
 * l'unico posto onesto dove metterle.
 */
export type Formato = "evergreen" | "live" | "non_marcate";

export const FORMATI: Array<{ label: string; value: Formato }> = [
  { label: "Evergreen", value: "evergreen" },
  { label: "Live", value: "live" },
  { label: "Altre", value: "non_marcate" }
];

/** Le parole che identificano un evento dal vivo. */
const MARCATORI_LIVE = ["live", "webinar", "workshop"];

export function formatoCampagna(nome: string): Formato {
  const segmenti = nome.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // "ew" vince su "webinar" quando ci sono entrambi: sono tre campagne del tipo
  // "lms_mep_ew_indipendenza_femminile_webinar", dove "webinar" descrive il
  // contenuto e "ew", che sta nella posizione strutturale del nome, dice come
  // viene erogato.
  if (segmenti.includes("ew")) return "evergreen";
  if (segmenti.some((t) => MARCATORI_LIVE.includes(t))) return "live";
  return "non_marcate";
}

/**
 * Come trattare le varianti nella tabella.
 *
 * - "unificate" (preimpostata): ogni variante confluisce nella campagna base e
 *   i marcatori non contano come conversioni, quindi ogni persona vale uno. E'
 *   la vista giusta per leggere le prestazioni di una campagna.
 * - "tutte": tutto quello che c'e', senza alcun filtro. Nomi non conformi
 *   compresi e ogni voce del foglio della spesa. Vista diagnostica, dove la
 *   somma dei Lead Generati e' per costruzione piu' alta, perche' la stessa
 *   persona compare sulla campagna e sulle sue varianti.
 * - "instant": i contatti assegnati subito.
 * - "non_instant": gli altri, cioe' "unificate" meno "instant".
 */
export type Variante = "tutte" | "unificate" | "instant" | "non_instant";

export const VARIANTE_DEFAULT: Variante = "unificate";

export const VARIANTI: Array<{ label: string; value: Variante }> = [
  // "Separate" e non "Tutte": la voce non aggiunge campagne, le divide. Mostra
  // ogni variante per conto suo invece di sommarla alla base, ed e' l'unica
  // vista dove il nome porta ancora il suffisso che la distingue. Il valore
  // resta "tutte", che e' quello che viaggia nelle query.
  { label: "Separate", value: "tutte" },
  { label: "Unificate", value: "unificate" },
  { label: "Instant", value: "instant" },
  { label: "Non Instant", value: "non_instant" }
];

export function leggiVariante(valore: string | null | undefined): Variante {
  return valore === "tutte" || valore === "instant" || valore === "non_instant" || valore === "unificate"
    ? valore
    : VARIANTE_DEFAULT;
}

/** Le viste che guardano un sottoinsieme dei contatti di una campagna. */
export function varianteEsegmento(variante: Variante): boolean {
  return variante === "instant" || variante === "non_instant";
}

/**
 * Il nome senza il marcatore finale, se ce l'ha.
 *
 * Serve a scriverlo in tabella nella vista Instant, dove il suffisso ce
 * l'hanno TUTTE le righe: ripeterlo quaranta volte occupa spazio per dire una
 * cosa che sta gia' scritta nel filtro in alto. Il nome intero resta
 * nell'etichetta che compare col mouse sopra.
 *
 * Non va fatto nella vista Separate, dove il suffisso e' l'unica cosa che
 * distingue la variante dalla sua campagna base: li' due righe diverse
 * diventerebbero due righe con lo stesso nome.
 */
export function nomeSenzaMarcatore(nome: string): string {
  const pulito = nome.trim();
  return haMarcatoreInstant(pulito) ? pulito.slice(0, -SUFFISSO_INSTANT.length) : pulito;
}

export function haMarcatoreInstant(nome: string): boolean {
  const k = nome.trim().toLowerCase();
  return k.endsWith(SUFFISSO_INSTANT) && k.length > SUFFISSO_INSTANT.length;
}

function normalizza(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mappa "nome con suffisso" -> "nome base", per i soli nomi la cui base esiste
 * davvero. La costruisce il server, che ha l'elenco delle campagne, e la
 * consuma il client: vedi /api/campaign-ads.
 */
export type MappaVarianti = Record<string, string>;

/**
 * Chiave di raggruppamento di un nome campagna, o null se la riga non va
 * mostrata in questa vista. Serve ai dati che arrivano al client gia' pronti:
 * foglio Ads e id_campagna_track di trattative e incassi.
 *
 * Il gemello lato SQL e' sqlNomeCampagna(): le due devono restare d'accordo.
 */
export function chiaveCampagna(nome: string, variante: Variante, basi: MappaVarianti = {}): string | null {
  const pulito = nome.trim();
  if (!pulito) return null;

  // "tutte" non tocca niente, nemmeno le maiuscole: due grafie diverse restano
  // due righe diverse, che e' il senso di una vista grezza.
  if (variante === "tutte") return pulito;

  if (!nomeConforme(pulito)) return null;
  const chiave = normalizza(pulito);
  const instant = haMarcatoreInstant(chiave);

  if (variante === "instant") return instant ? chiave : null;
  if (variante === "non_instant" && instant) return null;
  return basi[chiave] ?? chiave;
}

// --- Lato SQL. L'alias della tabella campagna e' sempre "c", quello della sua
// --- copia usata per risolvere la base e' "b" (vedi SQL_JOIN_BASE).

// In LIKE l'underscore e' un carattere jolly: va protetto, altrimenti
// "_test_instant" accetterebbe anche "xtestyinstant".
export function sqlEMarcatoreInstant(alias = "c"): string {
  return `lower(trim(${alias}.nome)) LIKE '%\\_test\\_instant'`;
}

export const SQL_E_MARCATORE_INSTANT = sqlEMarcatoreInstant();


/** I soli suffissi che, per le campagne ICMD, sono conversioni vere. */
const SUFFISSI_ICMD_VERI = ["richiesta_informazioni", "richieste_info", "richiesta_info"];

const sqlSenzaSuffissoTecnico = (alias: string) =>
  `regexp_replace(lower(trim(${alias}.nome)), '_(${SUFFISSI_TECNICI.join("|")})$', '')`;

/**
 * Vero quando la campagna e' una variante tecnica, cioe' non una conversione.
 *
 * Tre condizioni, e servono tutte e tre:
 *
 * 1. il nome finisce con uno dei suffissi tecnici;
 * 2. LA CAMPAGNA BASE ESISTE DAVVERO. E' questa che tiene fuori le campagne che
 *    il suffisso ce l'hanno nel nome ma non sono varianti di niente: delle 29
 *    campagne che finiscono in "richiesta_informazioni", 16 non hanno una base -
 *    "icmd13_richiesta_informazioni" esiste, "icmd13" no - e restano conversioni
 *    a pieno titolo;
 * 3. non e' una ICMD con la richiesta informazioni, che per quella categoria e'
 *    una conversione vera. Oggi non esiste nessuna ICMD in questo caso, perche'
 *    la condizione 2 le esclude gia' tutte; l'eccezione e' scritta per il giorno
 *    in cui ne nascera' una con la base.
 */
export function sqlEVarianteTecnica(alias = "c"): string {
  const senza = sqlSenzaSuffissoTecnico(alias);
  return `(
    ${senza} <> lower(trim(${alias}.nome))
    AND NOT (
      lower(trim(${alias}.nome)) LIKE '%icmd%'
      AND lower(trim(${alias}.nome)) ~ '_(${SUFFISSI_ICMD_VERI.join("|")})$'
    )
    AND EXISTS (
      SELECT 1 FROM campagna vb
      WHERE vb.nome = ${senza} AND position('_' in vb.nome) > 0
    )
  )`;
}

export const SQL_E_VARIANTE_TECNICA = sqlEVarianteTecnica();

/**
 * Il nome base di una campagna, suffisso di variante rimosso.
 *
 * Usa lo stesso elenco della versione JavaScript: se i due divergessero, la
 * spesa - che si unisce lato client - finirebbe su una riga e i lead, che si
 * uniscono nella query, su un'altra.
 */
export function sqlNomeBase(alias = "c"): string {
  return `regexp_replace(lower(trim(${alias}.nome)), '_${PATTERN_VARIANTE}$', '')`;
}

/**
 * Il nome della riga nella vista Instant: la campagna col marcatore. Normalizza
 * i due casi che si incontrano - il nome ce l'ha gia' oppure no - cosi' lead,
 * telefonate e trattative finiscono tutti sulla stessa riga.
 */
export function sqlNomeInstant(alias = "c"): string {
  return `regexp_replace(lower(trim(${alias}.nome)), '${SUFFISSO_INSTANT}$', '') || '${SUFFISSO_INSTANT}'`;
}

/**
 * Le coppie (persona, campagna) che portano il marcatore di assegnazione
 * immediata. E' la definizione di "gruppo instant", e va letta dalla cronologia
 * del CONTATTO: trattative e incassi conservano il nome campagna com'era quando
 * sono nati, che di solito e' quello senza marcatore.
 */
export const SQL_CTE_MARCATI = `marcati AS (
    SELECT DISTINCT COALESCE(a.nuovo_id, e.contact_id) AS persona,
           ${sqlNomeBase("cm")} AS campagna
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    JOIN campagna cm ON cm.id = e.campagna_id
    WHERE ${sqlEMarcatoreInstant("cm")}
  )`;

/**
 * Aggancia la campagna base, quando esiste. E' una LEFT JOIN sulla tabella vera
 * e non una CTE: la chiave unica su "nome" la rende una ricerca per indice,
 * mentre una CTE - di cui il pianificatore non sa stimare le righe - lo portava
 * a rileggerla per intero a ogni riga.
 */
export const SQL_JOIN_BASE = `LEFT JOIN campagna b
    ON b.nome = ${sqlNomeBase()}
   AND b.nome <> lower(trim(c.nome))
   AND position('_' in b.nome) > 0`;

/** Se la vista ha bisogno di SQL_JOIN_BASE. */
export function varianteUnificaNomi(variante: Variante): boolean {
  return variante === "unificate" || variante === "non_instant";
}

/** Il nome della riga. */
export function sqlNomeCampagna(variante: Variante): string {
  if (variante === "tutte") return "trim(c.nome)";
  if (varianteUnificaNomi(variante)) return "COALESCE(b.nome, lower(trim(c.nome)))";
  return "lower(trim(c.nome))";
}

/** Quali campagne tenere. Da concatenare con AND al resto del filtro. */
export function sqlFiltroCampagna(variante: Variante): string {
  if (variante === "tutte") return "TRUE";
  const conforme = "c.nome = lower(c.nome)";
  if (variante === "instant") return `${conforme} AND ${SQL_E_MARCATORE_INSTANT}`;
  if (variante === "non_instant") return `${conforme} AND NOT (${SQL_E_MARCATORE_INSTANT})`;
  return conforme;
}
