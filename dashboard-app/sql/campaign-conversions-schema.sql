-- Schema per il tracciamento Lead Generati/Convertiti/Riconvertiti da HubSpot
-- (proprieta' id_campagna_refresh). Da eseguire una volta sul database Postgres
-- (es. console SQL di Neon) prima di attivare i cron.
--
-- NOTA DIMENSIONAMENTO: eventi_conversione arriva a 1-3 milioni di righe
-- (~570k contatti x numero medio di conversioni). Lo schema e' quindi tarato
-- per stare dentro i 500 MB del piano gratuito con margine:
--   - il nome campagna e' normalizzato in una tabella di lookup (un INT sulla
--     riga invece di ~40 byte di testo, ripetuti anche negli indici);
--   - non c'e' una colonna id surrogata: la chiave primaria e' la chiave
--     naturale (contact_id, campagna_id, ts), il che elimina sia la colonna
--     sia il suo indice;
--   - non c'e' un indice dedicato su contact_id: la PK lo copre gia', essendo
--     contact_id la sua prima colonna.
-- Costo risultante: ~135 byte/riga contro i ~330 di uno schema denormalizzato.

-- SALVAGENTE: "CREATE TABLE IF NOT EXISTS" non modifica una tabella che esiste
-- gia'. Se su questo database fosse gia' stata creata la PRIMA versione di
-- eventi_conversione (colonna "campagna" testuale, id BIGSERIAL), questo file
-- non darebbe alcun errore ma il bootstrap fallirebbe alla prima scrittura.
-- Meglio fermarsi qui con un messaggio chiaro che scoprirlo dopo ore.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'eventi_conversione' AND column_name = 'campagna'
  ) THEN
    RAISE EXCEPTION 'Esiste gia una tabella eventi_conversione con lo schema VECCHIO (colonna testuale "campagna"). Questo file crea lo schema NUOVO e non puo convertirla da solo. Se non contiene dati da conservare (il bootstrap li ricostruisce da HubSpot), esegui prima: DROP TABLE eventi_conversione;';
  END IF;
END $$;

-- Anagrafica campagne: poche centinaia di righe, referenziata dagli eventi.
CREATE TABLE IF NOT EXISTS campagna (
  id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE
);

-- L'ordine delle colonne non e' estetico: Postgres allinea TIMESTAMPTZ a 8
-- byte, quindi mettere l'INT prima del timestamp costerebbe 4 byte di
-- riempimento piu' 4 di coda (8 byte a riga, ~24 MB su 3 milioni di righe).
-- Va deciso ORA: cambiarlo dopo il bootstrap richiederebbe di riscrivere
-- l'intera tabella, con le due copie compresenti - piu' dei 500 MB
-- disponibili sul piano gratuito.
CREATE TABLE IF NOT EXISTS eventi_conversione (
  contact_id  BIGINT      NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  campagna_id INT         NOT NULL REFERENCES campagna (id),
  posizione   INT         NOT NULL, -- 1 = prima conversione assoluta del contatto
  PRIMARY KEY (contact_id, campagna_id, ts)
);

-- Serve alla query dell'API, che filtra per intervallo di date.
-- (Un indice su (campagna_id, ts) non e' presente di proposito: la query
-- aggrega per campagna ma non filtra per campagna, quindi non lo userebbe.)
CREATE INDEX IF NOT EXISTS idx_eventi_ts ON eventi_conversione (ts);

-- Mappa "vecchio ID HubSpot" -> "ID attuale" per i contatti fusi
-- (da hs_merged_object_ids). Non si cancella mai nulla da eventi_conversione:
-- si risolve solo l'identita' in lettura tramite questa tabella.
CREATE TABLE IF NOT EXISTS alias_contatto (
  vecchio_id BIGINT PRIMARY KEY,
  nuovo_id   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alias_nuovo_id ON alias_contatto (nuovo_id);

-- Trattative della pipeline "Appuntamenti (High Ticket)".
--
-- svolta_ts e' la data della PRIMA transizione di fase che soddisfa i criteri
-- del workflow "Performance Tracker - Trattative Svolte", ricostruita dalla
-- cronologia delle fasi. Va salvata qui perche' non e' ricavabile dallo stato
-- attuale della trattativa: le proprieta' su cui il workflow decide cambiano a
-- ogni passaggio successivo, quindi guardandole oggi non si saprebbe piu' se e
-- quando la consulenza e' avvenuta.
--
-- campagna_id puo' essere NULL: circa il 5% delle trattative non ha
-- id_campagna_track valorizzata.
CREATE TABLE IF NOT EXISTS trattativa (
  deal_id     BIGINT PRIMARY KEY,
  campagna_id INT REFERENCES campagna (id),
  creata_ts   TIMESTAMPTZ NOT NULL,
  svolta_ts   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trattativa_creata ON trattativa (creata_ts);
CREATE INDEX IF NOT EXISTS idx_trattativa_svolta ON trattativa (svolta_ts) WHERE svolta_ts IS NOT NULL;

-- Appuntamenti non onorati.
--
-- Tabella a parte e non una colonna di `trattativa` perche' una trattativa puo'
-- fare no-show piu' volte: viene ripianificata e il cliente diserta di nuovo.
-- Ogni ingresso nella fase "No Show" e' un evento con la sua data, e va contato
-- nel mese in cui e' avvenuto.
--
-- Ricavato dalla cronologia delle fasi e non dalla fase attuale: un no-show
-- viene quasi sempre spostato altrove (Persa, Archiviata, Ripianificata), e
-- guardando dove si trova oggi la trattativa non lo si vedrebbe piu'.
CREATE TABLE IF NOT EXISTS no_show (
  deal_id     BIGINT      NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  campagna_id INT REFERENCES campagna (id),
  PRIMARY KEY (deal_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_no_show_ts ON no_show (ts);

-- Chiamate telefoniche, per ricavare Chiamate e Connessioni per campagna.
--
-- campagna_id e' risolta AL MOMENTO DEL SYNC, non in lettura: e' la campagna
-- che il contatto aveva quando ha ricevuto la telefonata, cioe' l'ultima
-- conversione precedente a `ts`. Farlo in lettura significherebbe scandagliare
-- 740.000 eventi a ogni caricamento della pagina.
--
-- Puo' restare NULL per le chiamate a contatti che non avevano ancora una
-- campagna (chiamati da lista e convertiti dopo): misurato 0,3% del campione.
CREATE TABLE IF NOT EXISTS chiamata (
  call_id     BIGINT PRIMARY KEY,
  contact_id  BIGINT NOT NULL,
  campagna_id INT REFERENCES campagna (id),
  ts          TIMESTAMPTZ NOT NULL,
  connessa    BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chiamata_ts ON chiamata (ts);

-- Log delle esecuzioni del sync (bootstrap, full e incrementale), per monitoraggio.
CREATE TABLE IF NOT EXISTS sync_log (
  id           BIGSERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,          -- 'bootstrap' | 'full' | 'incrementale'
  iniziato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finito_at    TIMESTAMPTZ,
  contatti     INT DEFAULT 0,
  eventi       INT DEFAULT 0,
  esito        TEXT,                   -- 'ok' | 'errore'
  messaggio    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_esito ON sync_log (esito, finito_at DESC);

-- Punto di ripresa del bootstrap. La scansione completa dura ore: se si
-- interrompe (rete, riavvio, chiusura del portatile) deve poter riprendere
-- dall'ultimo blocco scritto invece che da capo. Aggiornato nella stessa
-- transazione che scrive gli eventi, quindi non puo' andare fuori sincrono.
-- La riga viene rimossa a fine esecuzione riuscita.
CREATE TABLE IF NOT EXISTS sync_checkpoint (
  tipo          TEXT PRIMARY KEY,      -- 'bootstrap' | 'full' | 'incrementale'
  ultimo_id     BIGINT NOT NULL,       -- ultimo hs_object_id processato
  contatti      INT NOT NULL DEFAULT 0,
  eventi        INT NOT NULL DEFAULT 0,
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
