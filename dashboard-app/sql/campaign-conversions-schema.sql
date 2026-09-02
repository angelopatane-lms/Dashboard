-- Schema per il tracciamento Lead Generati/Convertiti/Riconvertiti da HubSpot
-- (proprieta' id_campagna_refresh). Da eseguire una volta sul database Postgres
-- (es. console SQL di Neon) prima di attivare i cron.

CREATE TABLE IF NOT EXISTS eventi_conversione (
  id          BIGSERIAL PRIMARY KEY,
  contact_id  BIGINT      NOT NULL,
  campagna    TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  posizione   INT         NOT NULL, -- 1 = prima conversione assoluta del contatto
  UNIQUE (contact_id, campagna, ts)
);

CREATE INDEX IF NOT EXISTS idx_eventi_ts       ON eventi_conversione (ts);
CREATE INDEX IF NOT EXISTS idx_eventi_camp_ts  ON eventi_conversione (campagna, ts);
CREATE INDEX IF NOT EXISTS idx_eventi_contact  ON eventi_conversione (contact_id);

-- Mappa "vecchio ID HubSpot" -> "ID attuale" per i contatti fusi
-- (da hs_merged_object_ids). Non si cancella mai nulla da eventi_conversione:
-- si risolve solo l'identita' in lettura tramite questa tabella.
CREATE TABLE IF NOT EXISTS alias_contatto (
  vecchio_id BIGINT PRIMARY KEY,
  nuovo_id   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alias_nuovo_id ON alias_contatto (nuovo_id);

-- Log delle esecuzioni del sync (full e incrementale), per monitoraggio.
CREATE TABLE IF NOT EXISTS sync_log (
  id           BIGSERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,          -- 'full' | 'incrementale'
  iniziato_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finito_at    TIMESTAMPTZ,
  contatti     INT DEFAULT 0,
  eventi       INT DEFAULT 0,
  esito        TEXT,                   -- 'ok' | 'errore'
  messaggio    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_log_esito ON sync_log (esito, finito_at DESC);
