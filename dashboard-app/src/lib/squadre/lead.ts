/**
 * I LEAD GENERATI DAL MARKETING, CONTANDO OGNI PERSONA UNA VOLTA SOLA.
 *
 * PERCHE' NON BASTAVA LA TABELLA CAMPAGNE. Li' "Lead Generati" sono le persone
 * distinte DI UNA CAMPAGNA: chi si iscrive dieci volte alla stessa campagna
 * vale uno - quel doppione e' gia' risolto - ma chi si iscrive a tre campagne
 * vale uno per ciascuna. E' giusto li', perche' ogni campagna deve ricevere il
 * merito di chi ha coinvolto; diventa sbagliato appena quel totale lo si
 * chiama "quanti lead abbiamo generato". Misurato l'1-13 novembre 2026: la
 * somma delle squadre fa 6.671, le persone vere sono 5.727. Novecentoquaranta-
 * quattro si erano iscritte a campagne di squadre diverse.
 *
 * QUI SI CONTANO LE PERSONE. Dentro una categoria di prodotto chi ha convertito
 * due volte vale uno; nel totale, chi ha convertito su due categorie vale
 * ancora uno. Le due cose insieme fanno si' che il totale NON sia la somma
 * delle righe, ed e' voluto: la somma sarebbe il numero gonfio di prima.
 *
 * SI CONTA SUL PERIODO CHIESTO, NON GIORNO PER GIORNO. Sommare i giorni
 * riporterebbe lo stesso difetto da un'altra porta - la stessa persona in due
 * giorni diversi - e costerebbe anche di piu'. Su un mese la lettura e' di
 * circa un secondo, quindi si fa ogni volta che serve.
 *
 * DUE NUMERI PER OGNI RIGA:
 *   generati  le persone che hanno convertito nel periodo;
 *   unici     quelle la cui PRIMA conversione in assoluto cade nel periodo,
 *             cioe' i lead che prima non esistevano. Sono un sottoinsieme dei
 *             generati, e nella pagina si leggono come "di cui N Unici".
 *
 * I MARCATORI DI ASSEGNAZIONE RESTANO FUORI, come nella vista "unificate"
 * della tabella Campagne: le voci "..._test_instant" non sono conversioni ma
 * la stessa campagna riscritta da un workflow, e conterebbero la persona due
 * volte.
 */
import type { Pool } from "pg";
import { SQL_E_VARIANTE_TECNICA } from "@/lib/campagne";
import { guessCategoria } from "@/lib/campaignCategory";

export type ContoLead = { generati: number; unici: number };
export type LeadFinestra = {
  perCategoria: Record<string, ContoLead>;
  /** Le persone vere, senza i doppioni fra categorie. */
  totale: ContoLead;
  /** Quante persone compaiono in piu' di una categoria: la differenza fra la
   *  somma delle righe e il totale, pronta da spiegare in pagina. */
  inPiuCategorie: number;
  /**
   * I CONTI DI UN INSIEME DI CATEGORIE, deduplicati dentro l'insieme.
   *
   * Serve perche' una squadra puo' avere piu' categorie e un riepilogo ne
   * somma cinque: sommare le righe di `perCategoria` riporterebbe il doppio
   * conteggio che questa lettura esiste per togliere. Chi chiama dichiara i
   * suoi insiemi e li ritrova qui per nome.
   */
  perGruppo: Record<string, ContoLead>;
};

const QUERY = `
  WITH risolti AS (
    SELECT COALESCE(a.nuovo_id, e.contact_id) AS persona_id, e.campagna_id, e.ts
    FROM eventi_conversione e
    LEFT JOIN alias_contatto a ON a.vecchio_id = e.contact_id
    WHERE e.campagna_id NOT IN (SELECT id FROM campagna c WHERE ${SQL_E_VARIANTE_TECNICA})
  ),
  -- La prima conversione in assoluto di ogni persona, su tutta la storia: e'
  -- un fatto suo, non del periodo che si guarda.
  prima_conversione AS (
    SELECT DISTINCT ON (persona_id) * FROM risolti ORDER BY persona_id, ts, campagna_id
  )
  SELECT DISTINCT e.persona_id::text AS persona, lower(trim(c.nome)) AS campagna, false AS nuovo
    FROM risolti e JOIN campagna c ON c.id = e.campagna_id
   WHERE e.ts >= $1::date AND e.ts < ($2::date + INTERVAL '1 day')
  UNION
  SELECT DISTINCT p.persona_id::text, lower(trim(c.nome)), true
    FROM prima_conversione p JOIN campagna c ON c.id = p.campagna_id
   WHERE p.ts >= $1::date AND p.ts < ($2::date + INTERVAL '1 day')
`;

/**
 * Le persone che hanno convertito fra `da` e `a`, divise per categoria di
 * prodotto e contate una volta sola.
 *
 * `categorie` limita il conto a quelle che interessano a chi chiama: il totale
 * e' il numero di persone vere DENTRO quelle categorie, perche' un totale che
 * comprendesse anche quello che la pagina non mostra non si potrebbe spiegare.
 */
export async function leadDelPeriodo(
  db: Pool,
  da: string,
  a: string,
  categorie: string[],
  gruppi: Record<string, string[]> = {}
): Promise<LeadFinestra> {
  const volute = new Set(categorie.map((c) => c.trim().toUpperCase()).filter(Boolean));
  const { rows } = await db.query<{ persona: string; campagna: string; nuovo: boolean }>(QUERY, [da, a]);

  const per = new Map<string, { gen: Set<string>; unici: Set<string> }>();
  const tuttiGen = new Set<string>();
  const tuttiNuovi = new Set<string>();
  // Un insieme di persone per gruppo, con dentro le categorie che il gruppo
  // dichiara: e' l'unico modo di avere il conto vero di una squadra con due
  // categorie, o di cinque squadre insieme.
  const diGruppo = new Map<string, { quali: Set<string>; gen: Set<string>; unici: Set<string> }>();
  for (const [nome, quali] of Object.entries(gruppi)) {
    diGruppo.set(nome, {
      quali: new Set(quali.map((c) => c.trim().toUpperCase()).filter(Boolean)),
      gen: new Set<string>(),
      unici: new Set<string>()
    });
  }
  for (const r of rows) {
    const cat = guessCategoria(r.campagna).toUpperCase();
    if (volute.size && !volute.has(cat)) continue;
    const v = per.get(cat) ?? { gen: new Set<string>(), unici: new Set<string>() };
    v.gen.add(r.persona);
    if (r.nuovo) v.unici.add(r.persona);
    per.set(cat, v);
    tuttiGen.add(r.persona);
    if (r.nuovo) tuttiNuovi.add(r.persona);
    for (const g of diGruppo.values()) {
      if (!g.quali.has(cat)) continue;
      g.gen.add(r.persona);
      if (r.nuovo) g.unici.add(r.persona);
    }
  }

  const perCategoria: Record<string, ContoLead> = {};
  let somma = 0;
  for (const [cat, v] of per) {
    perCategoria[cat] = { generati: v.gen.size, unici: v.unici.size };
    somma += v.gen.size;
  }

  const perGruppo: Record<string, ContoLead> = {};
  for (const [nome, g] of diGruppo) perGruppo[nome] = { generati: g.gen.size, unici: g.unici.size };

  return {
    perCategoria,
    totale: { generati: tuttiGen.size, unici: tuttiNuovi.size },
    inPiuCategorie: Math.max(0, somma - tuttiGen.size),
    perGruppo
  };
}
