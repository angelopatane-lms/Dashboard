import { SQL_E_MARCATORE, sqlFiltroCampagna, sqlNomeCampagna, type Variante } from "@/lib/campagne";

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
// subito (vedi src/lib/campagne.ts). Con la vista "unificate" vengono tolte
// prima di contare, altrimenti la stessa persona verrebbe sommata due volte:
// e' la differenza fra 47.051 e 39.095 Lead Generati sul trimestre.
//
// Con "tutte" restano invece dove sono, perche' quella vista serve proprio a
// mostrare il dato grezzo come sta in HubSpot; con "instant" sono le uniche
// righe mostrate.
export function costruisciQuery(variante: Variante): string {
  const nome = sqlNomeCampagna(variante);
  const filtro = sqlFiltroCampagna(variante);

  // Nella vista unificata i marcatori si tolgono QUI, dentro la scansione, non
  // in una CTE a valle: separarli significava materializzare due volte 740.000
  // righe su disco temporaneo, e la query passava da 0,8 a 9 secondi.
  const senzaMarcatori =
    variante === "unificate"
      ? "WHERE e.campagna_id NOT IN (SELECT id FROM campagna c WHERE " + SQL_E_MARCATORE + ")"
      : "";

  return `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    ${senzaMarcatori}
  ),
  -- Prima conversione in assoluto di ogni persona: una riga per persona,
  -- calcolata su TUTTA la storia (nessun filtro di data qui dentro) e dopo la
  -- risoluzione delle fusioni, cosi' due schede unite sono una persona sola.
  --
  -- Un marcatore non puo' finire qui per primo nemmeno nelle viste che lo
  -- conservano: il contatto nasce con la campagna base e il workflow riscrive
  -- dopo, quindi il marcatore ha per forza un timestamp successivo. Misurato:
  -- su 345.844 persone una sola fa eccezione, ed e' agganciata alla campagna
  -- chiamata letteralmente "_test_instant", senza nome base davanti.
  prima_conversione AS (
    SELECT DISTINCT ON (persona_id) persona_id, campagna_id, ts
    FROM risolti
    ORDER BY persona_id, ts, campagna_id
  ),
  -- Qui si aggancia la TABELLA campagna e non una CTE: una CTE non ha indici e
  -- il pianificatore, che non sa stimarne le righe, finiva per rileggerla per
  -- intero una volta per riga (19.631 scansioni, 11 secondi).
  generati AS (
    SELECT ${nome} AS nome, COUNT(DISTINCT r.persona_id)::int AS n
    FROM risolti r JOIN campagna c ON c.id = r.campagna_id
    WHERE r.ts >= $1::date AND r.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
    GROUP BY 1
  ),
  unici AS (
    SELECT ${nome} AS nome, COUNT(*)::int AS n
    FROM prima_conversione p JOIN campagna c ON c.id = p.campagna_id
    WHERE p.ts >= $1::date AND p.ts < ($2::date + INTERVAL '1 day')
      AND ${filtro}
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
