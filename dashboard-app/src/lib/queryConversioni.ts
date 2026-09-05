import {
  SQL_E_MARCATORE,
  sqlEMarcatore,
  sqlNomeBase,
  sqlNomeCampagna,
  SUFFISSO_INSTANT,
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
// MARCATORI DI ASSEGNAZIONE: le voci "..._test_instant" non sono conversioni ma
// la stessa campagna riscritta da un workflow quando il contatto viene assegnato
// subito (vedi src/lib/campagne.ts). Le tre viste li trattano cosi':
//
// - "unificate": tolti prima di contare, altrimenti la stessa persona verrebbe
//   sommata due volte. E' la differenza fra 47.051 e 39.095 Lead Generati sul
//   trimestre.
// - "tutte": lasciati dove sono, perche' quella vista mostra il dato grezzo come
//   sta in HubSpot e fa vedere da dove nasce la differenza.
// - "instant": le righe sono quelle col marcatore, ma i numeri sono le
//   CONVERSIONI VERE dei contatti che quel marcatore ce l'hanno. Contare invece
//   i marcatori stessi dava Lead Unici a zero su ogni riga - un marcatore non e'
//   mai la prima conversione di nessuno - facendo leggere "nessun lead nuovo"
//   dove i lead nuovi del trimestre sono 5.163.
export function costruisciQuery(variante: Variante): string {
  const instant = variante === "instant";

  // Nella vista unificata e in quella instant i marcatori si tolgono dentro la
  // scansione, non in una CTE a valle: separarli significava materializzare due
  // volte 740.000 righe su disco temporaneo (da 0,8 a 9 secondi).
  const senzaMarcatori =
    variante === "tutte"
      ? ""
      : `WHERE e.campagna_id NOT IN (SELECT id FROM campagna c WHERE ${SQL_E_MARCATORE})`;

  // Solo per la vista instant: chi porta il marcatore, e su quale campagna vera.
  // L'etichetta si attacca UNA VOLTA sull'insieme completo degli eventi, dove il
  // pianificatore sa quante righe aspettarsi e sceglie una hash join. Agganciarla
  // a valle, su una CTE di cui non ha statistiche, gli faceva stimare una riga,
  // scegliere un ciclo annidato e rileggere i marcatori per ognuna: 47 secondi.
  const cteInstant = !instant
    ? ""
    : `  basi AS (
    SELECT m.id AS id_marcatore, b.id AS id_base
    FROM campagna m
    JOIN campagna b ON lower(trim(b.nome)) = ${sqlNomeBase("m")} AND NOT (${sqlEMarcatore("b")})
    WHERE ${sqlEMarcatore("m")} AND m.nome = lower(m.nome) AND b.nome = lower(b.nome)
  ),
  marcati AS (
    SELECT DISTINCT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, b.id_base AS campagna_id
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    JOIN basi b ON b.id_marcatore = e.campagna_id
  ),
  etichettati AS (
    SELECT r.persona_id, r.campagna_id, r.ts, (m.persona_id IS NOT NULL) AS instant
    FROM risolti r
    LEFT JOIN marcati m ON m.persona_id = r.persona_id AND m.campagna_id = r.campagna_id
  ),
`;
  const sorgente = instant ? "etichettati" : "risolti";
  const filtroRiga = instant ? "AND e.instant" : "";

  // Con "instant" gli eventi contati stanno sulla campagna BASE, ma la riga deve
  // continuare a chiamarsi come la variante: e' quella che l'utente ha chiesto
  // di vedere.
  const nome = instant ? `lower(trim(c.nome)) || '${SUFFISSO_INSTANT}'` : sqlNomeCampagna(variante);
  // La conformita' del nome vale per tutte e tre le viste; con "instant" non si
  // filtra piu' per suffisso, perche' ora si guardano le campagne base.
  const filtro = "c.nome = lower(c.nome)";

  return `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    ${senzaMarcatori}
  ),
${cteInstant}  -- Prima conversione in assoluto di ogni persona: una riga per persona,
  -- calcolata su TUTTA la storia (nessun filtro di data qui dentro) e dopo la
  -- risoluzione delle fusioni, cosi' due schede unite sono una persona sola.
  -- Si calcola su tutti gli eventi della persona e NON solo su quelli della
  -- vista: la prima conversione e' un fatto suo, non del gruppo che si guarda.
  prima_conversione AS (
    SELECT DISTINCT ON (persona_id) *
    FROM ${sorgente}
    ORDER BY persona_id, ts, campagna_id
  ),
  -- Qui si aggancia la TABELLA campagna e non una CTE: una CTE non ha indici e
  -- il pianificatore, che non sa stimarne le righe, finiva per rileggerla per
  -- intero una volta per riga (19.631 scansioni, 11 secondi).
  generati AS (
    SELECT ${nome} AS nome, COUNT(DISTINCT e.persona_id)::int AS n
    FROM ${sorgente} e JOIN campagna c ON c.id = e.campagna_id
    WHERE e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
      ${filtroRiga}
    GROUP BY 1
  ),
  unici AS (
    SELECT ${nome} AS nome, COUNT(*)::int AS n
    FROM prima_conversione e JOIN campagna c ON c.id = e.campagna_id
    WHERE e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
      ${filtroRiga}
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
