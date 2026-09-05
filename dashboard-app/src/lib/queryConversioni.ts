import {
  SQL_CAMPAGNA_CONFORME,
  SQL_E_MARCATORE,
  SQL_NOME_CAMPAGNA,
  type Variante
} from "@/lib/campagne";

// Per ogni campagna, nell'intervallo [from, to]:
//
// - Lead Generati: PERSONE DISTINTE che hanno convertito su quella campagna nel
//   periodo. Iscriversi due volte alla stessa campagna vale 1; iscriversi a tre
//   campagne diverse vale 1 per ciascuna, quindi 3 in totale. Ne segue che la
//   somma fra campagne e' maggiore delle persone reali: e' voluto, perche' ogni
//   campagna deve ricevere il merito di chi ha effettivamente coinvolto.
//
// - Lead Unici: le persone la cui PRIMA CONVERSIONE IN ASSOLUTO cade nel
//   periodo, attribuite alla campagna di quella prima conversione. Sono i lead
//   nuovi: prima non esistevano nel database. Ne discende che il valore e'
//   stabile nel tempo (la data della prima conversione non cambia mai) e che
//   somma esattamente fra campagne (ogni persona ha una sola prima conversione).
//
// MARCATORI DI ASSEGNAZIONE: le voci "..._test_instant" NON sono conversioni,
// sono la stessa campagna riscritta da un workflow quando il contatto viene
// assegnato subito (vedi src/lib/campagne.ts). Vengono tolte prima di contare
// qualsiasi cosa: se restassero, una persona verrebbe contata due volte fra la
// campagna e la sua variante, e un marcatore potrebbe passare per "prima
// conversione", datandola al momento dell'assegnazione invece che a quello
// dell'iscrizione.
//
// Restano utili come ETICHETTA: il filtro Variante isola i contatti che su
// quella campagna hanno un marcatore, per confrontarli con gli altri.
export function costruisciQuery(variante: Variante): string {
  // Il segmento si decide sulla coppia (persona, campagna): la stessa persona
  // puo' essere stata assegnata subito su una campagna e in ritardo su un'altra.
  //
  // I marcatori sono indicizzati per ID DELLA CAMPAGNA BASE, non per nome, e si
  // agganciano con una LEFT JOIN. E' l'unico modo per farne una hash join: se
  // le due chiavi vengono da relazioni diverse (la persona dagli eventi, il
  // nome dalla tabella campagne) il pianificatore ripiega su un ciclo annidato,
  // e su questi volumi significava 229 milioni di confronti e 37 secondi.
  // L'etichetta si attacca UNA VOLTA, sull'insieme completo degli eventi, dove
  // il pianificatore sa quante righe aspettarsi e sceglie una hash join. Se
  // invece la si aggancia a valle - su una CTE, di cui non ha statistiche -
  // stima una riga, sceglie un ciclo annidato e rilegge i marcatori per ogni
  // riga: 19.631 scansioni, da 0,9 a 47 secondi.
  const conEtichetta = variante !== "tutte";
  const sorgente = conEtichetta ? "etichettati" : "risolti";
  const filtroSegmento = !conEtichetta ? "" : variante === "instant" ? "AND e.instant" : "AND NOT e.instant";

  return `
  -- La classificazione dei nomi si fa UNA VOLTA sulle ~5.000 campagne, non
  -- sulle 740.000 righe di eventi.
  WITH campagne AS (
    SELECT c.id,
           ${SQL_NOME_CAMPAGNA}       AS nome,
           ${SQL_E_MARCATORE}         AS marcatore,
           (${SQL_CAMPAGNA_CONFORME}) AS conforme
    FROM campagna c
  ),
  marcatori AS (SELECT id FROM campagne WHERE marcatore),
  -- Da quale campagna vera arriva ogni marcatore.
  basi AS (
    SELECT m.id AS id_marcatore, b.id AS id_base
    FROM campagne m
    JOIN campagne b ON b.nome = m.nome AND NOT b.marcatore
    WHERE m.marcatore
  ),
  -- Le conversioni vere. I marcatori si tolgono QUI, dentro la scansione, e non
  -- in una CTE a valle: separarle significava materializzare due volte 740.000
  -- righe su disco temporaneo, e la query passava da 0,8 a 9 secondi.
  risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    WHERE e.campagna_id NOT IN (SELECT id FROM marcatori)
  ),
  -- Chi e' stato assegnato subito, sotto l'id della campagna vera. Non si legge
  -- da risolti proprio perche' li' i marcatori non ci sono piu'.
  -- Con variante "tutte" questa CTE non viene referenziata e non viene eseguita.
  marcati AS (
    SELECT DISTINCT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, b.id_base AS campagna_id
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    JOIN basi b ON b.id_marcatore = e.campagna_id
  ),
${conEtichetta ? `  -- Ogni evento sa se quella persona, su quella campagna, era stata assegnata
  -- subito.
  etichettati AS (
    SELECT r.persona_id, r.campagna_id, r.ts, (m.persona_id IS NOT NULL) AS instant
    FROM risolti r
    LEFT JOIN marcati m ON m.persona_id = r.persona_id AND m.campagna_id = r.campagna_id
  ),
` : ""}  -- Prima conversione in assoluto di ogni persona, su TUTTA la storia e dopo la
  -- risoluzione delle fusioni, cosi' due schede unite sono una persona sola.
  -- Si calcola su tutti gli eventi e NON solo su quelli del segmento: la prima
  -- conversione di una persona e' un fatto suo, non del gruppo che si guarda.
  -- Include di proposito anche le campagne non conformi: se la prima
  -- conversione e' avvenuta li', quella persona non e' un lead nuovo per
  -- nessun'altra campagna, e va esclusa invece che spostata piu' avanti.
  prima_conversione AS (
    SELECT DISTINCT ON (persona_id) *
    FROM ${sorgente}
    ORDER BY persona_id, ts, campagna_id
  ),
  -- Qui si aggancia la TABELLA campagna, non la CTE qui sopra: una CTE non ha
  -- indici, e il pianificatore finiva per rileggerla per intero una volta per
  -- riga (19.631 scansioni da 5.169 righe, 11 secondi). Sulla tabella vera usa
  -- la chiave primaria.
  generati AS (
    SELECT ${SQL_NOME_CAMPAGNA} AS nome, COUNT(DISTINCT e.persona_id)::int AS n
    FROM ${sorgente} e
    JOIN campagna c ON c.id = e.campagna_id
    WHERE ${SQL_CAMPAGNA_CONFORME}
      AND e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
      ${filtroSegmento}
    GROUP BY 1
  ),
  unici AS (
    SELECT ${SQL_NOME_CAMPAGNA} AS nome, COUNT(*)::int AS n
    FROM prima_conversione e
    JOIN campagna c ON c.id = e.campagna_id
    WHERE ${SQL_CAMPAGNA_CONFORME}
      AND e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
      ${filtroSegmento}
    GROUP BY 1
  )
  SELECT COALESCE(g.nome, u.nome) AS campagna,
         COALESCE(g.n, 0) AS lead_generati,
         COALESCE(u.n, 0) AS lead_unici
  FROM generati g
  FULL OUTER JOIN unici u ON u.nome = g.nome
  ORDER BY lead_generati DESC
`;
}
