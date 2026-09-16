/**
 * A quale campagna appartiene un incasso o una trattativa.
 *
 * SU HUBSPOT CI SONO DUE CAMPI, e dicono cose diverse: `id_campagna_track`
 * porta la campagna di ORIGINE del contatto, `id_campagna_track_last` l'ULTIMA
 * con cui ha interagito. Finora si leggeva solo il primo, e per i record
 * precedenti al 27 agosto 2026 questo attribuiva le vendite alla campagna che
 * aveva portato il cliente in database - a volte anni prima - invece che a
 * quella che lo ha fatto comprare.
 *
 * Misurato su un caso: il webinar del 3 agosto 2026 risultava valere 28.750 EUR
 * leggendo il solo `track`, e 76.340 EUR leggendo anche `track_last`. I 20.000
 * EUR della vendita piu' grossa finivano a un webinar del luglio 2024, l'unico
 * merito del quale era aver fatto entrare quella persona nel database.
 *
 * DAL 27 AGOSTO 2026 I DUE CAMPI COINCIDONO. E' il giorno in cui il flusso che
 * riempie `track` e' stato sistemato: fino al 26 agosto i due valori
 * divergevano sul 20-45% delle trattative ogni giorno, dal 27 su zero. Quindi
 * da quella data in poi si legge `track`, che e' il campo storico, e la regola
 * non tocca ne' il presente ne' il futuro.
 */

/**
 * Il giorno in cui il flusso che riempie `id_campagna_track` e' tornato a
 * funzionare. Misurato sulle trattative giorno per giorno: 26 agosto 36% di
 * divergenza, 27 agosto 0%, e da li' in poi sempre zero salvo tre casi isolati.
 */
const RIPRISTINO_TRACK = Date.parse("2026-08-27T00:00:00Z");

/**
 * Valori che compaiono in `track_last` ma non sono campagne di marketing.
 *
 * Sono attivita' interne che toccano il contatto e finiscono nel campo
 * dell'ultima interazione. Attribuire loro fatturato farebbe comparire il
 * recupero crediti in cima alla pagina Campagne, davanti a qualunque campagna
 * vera: da solo varrebbe 176.027 EUR sul 2026, l'11% di tutto il riattribuito.
 * Su questi si torna a `track`, cioe' alla campagna che il cliente lo aveva
 * portato davvero.
 */
const NON_SONO_CAMPAGNE = new Set([
  "recupero_crediti",
  "recupero_crediti_telefonica",
  "contatto_personale",
  "sette_email_aperte",
  "leadpersonale_asiacuccu",
  "leadpersonale_asia"
]);

/** Il confronto ignora maiuscole e spazi: gli stessi valori arrivano scritti in
 *  modi diversi a seconda di chi li ha scritti. */
function pulita(valore: string | null | undefined): string {
  return String(valore ?? "").trim();
}

export function eUnaCampagna(valore: string | null | undefined): boolean {
  const v = pulita(valore).toLowerCase();
  return Boolean(v) && !NON_SONO_CAMPAGNE.has(v);
}

/**
 * La campagna da usare per attribuire questo record.
 *
 * `creato` e' la data di creazione del record - dell'incasso o della trattativa
 * - non quella del pagamento: e' quando i due campi sono stati scritti, ed e'
 * quello che decide se il valore di `track` e' attendibile.
 *
 * Quando non si riesce a stabilire la data si preferisce `track`, che e' il
 * comportamento di prima: in caso di dubbio non si cambia niente.
 */
export function campagnaEffettiva(
  track: string | null | undefined,
  trackLast: string | null | undefined,
  creato: number | null | undefined
): string {
  const t = pulita(track);
  const l = pulita(trackLast);

  if (!Number.isFinite(creato as number)) return t || l;
  if ((creato as number) >= RIPRISTINO_TRACK) return t || l;

  // Periodo in cui `track` non era affidabile: vale l'ultima interazione, a
  // patto che sia una campagna vera.
  if (eUnaCampagna(l)) return l;
  return t || l;
}
