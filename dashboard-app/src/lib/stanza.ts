/**
 * Il codice della stanza, cioe' la chiave su cui registrazione e appuntamento
 * si riconoscono.
 *
 * PERCHE' UNA FUNZIONE SOLA. La stessa espressione era copiata in tre punti -
 * la lettura di Fireflies, il giro di sincronizzazione e lo script di
 * riabbinamento - e bastava aggiungere un formato in due su tre per avere
 * registrazioni che risultavano in una stanza quando le leggeva un pezzo di
 * codice e in nessuna quando le leggeva l'altro. Divergenze cosi' non danno
 * errore: danno meno abbinamenti, e nessuno se ne accorge.
 *
 * DUE FORMATI DI STANZA.
 *
 * Google Meet: il codice e' nell'indirizzo, "xxx-xxxx-xxx". Ogni advisor ha il
 * suo e lo riusa tutti i giorni.
 *
 * Zoom: la stanza e' il Personal Meeting ID, il numero dopo "/j/". Si comporta
 * allo stesso modo - e' fisso per persona e compare identico su tutti i suoi
 * appuntamenti - per questo puo' entrare nella stessa chiave senza che il resto
 * della logica debba sapere che Zoom esiste. Le chiavi Zoom portano il prefisso
 * "zoom-" perche' un numero nudo e un codice Meet non si confondano mai.
 */

/** Il codice Meet, "xxx-xxxx-xxx". */
const MEET = /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/;

/** Il Personal Meeting ID di Zoom: il numero dopo "/j/". */
const ZOOM = /zoom\.us\/j\/(\d{8,})/;

/**
 * Il marcatore che il ponte Zoom scrive nel titolo della registrazione.
 *
 * ATTENZIONE, E' UNA DEROGA CONSAPEVOLE: il titolo di una registrazione non e'
 * un dato su cui fare affidamento - lo scrive l'estensione di Fireflies e
 * potrebbe cambiare domani. Qui si legge soltanto perche' su quelle
 * registrazioni **il titolo lo scriviamo noi**, in
 * `api/webhook/zoom-recording`, ed e' l'unico canale disponibile: Fireflies non
 * accetta `meeting_link` fra i campi di `AudioUploadInput`, non ha nessuna
 * mutazione che lo modifichi dopo, e `client_reference_id` si puo' scrivere ma
 * non si puo' rileggere (non esiste fra i campi del Transcript). Verificato
 * interrogando lo schema, non dedotto.
 */
const MARCATORE_TITOLO = /zoom-(\d{8,})/;

/** Dal testo di un collegamento - o da piu' campi messi in fila. */
export function stanzaDaCollegamento(testo: string | null | undefined): string | null {
  const t = testo ?? "";
  const meet = t.match(MEET)?.[1];
  if (meet) return meet;
  const zoom = t.match(ZOOM)?.[1];
  return zoom ? `zoom-${zoom}` : null;
}

/** Dalle proprieta' di un appuntamento HubSpot. */
export function stanzaDaProprieta(p: Record<string, string | null>): string | null {
  return stanzaDaCollegamento(`${p.hs_meeting_location ?? ""} ${p.hs_video_conference_url ?? ""}`);
}

/**
 * Dal titolo di una registrazione, e solo per il marcatore che scriviamo noi.
 *
 * Volutamente non riconosce un codice Meet nudo: le registrazioni dell'
 * estensione si chiamano gia' cosi', ma per quelle il collegamento c'e' e va
 * letto da li'. Allargare questa funzione vorrebbe dire dare fiducia a un
 * titolo che non controlliamo.
 */
export function stanzaDaTitolo(titolo: string | null | undefined): string | null {
  const id = (titolo ?? "").match(MARCATORE_TITOLO)?.[1];
  return id ? `zoom-${id}` : null;
}

/** Come il ponte Zoom battezza una registrazione perche' sia poi riconoscibile. */
export function titoloConStanza(idRiunione: string | number, descrizione: string): string {
  return `zoom-${idRiunione} · ${descrizione}`;
}
