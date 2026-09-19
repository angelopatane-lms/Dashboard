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
  svolta_ts   TIMESTAMPTZ,
  -- Il contatto dietro la trattativa, letto dalle associazioni HubSpot.
  --
  -- Serve a sapere se quella persona era stata assegnata subito: il marcatore
  -- "_test_instant" vive sulla cronologia del CONTATTO, mentre la trattativa
  -- conserva il nome campagna com'era quando e' nata - spesso senza marcatore,
  -- perche' un workflow scrive id_campagna_track prima che la riscrittura
  -- avvenga. Misurato sul trimestre: classificando per contatto le consulenze
  -- del gruppo instant passano da 166 a 192, e le 166 sono tutte dentro le 192.
  --
  -- Ogni trattativa ha esattamente un contatto: verificato su 300 campioni,
  -- zero casi con piu' di uno.
  contact_id  BIGINT
);

-- Colonna aggiunta dopo il primo bootstrap: senza questo un database gia'
-- creato resterebbe indietro, perche' CREATE TABLE IF NOT EXISTS non tocca
-- una tabella che esiste.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS contact_id BIGINT;

-- CHI HA FISSATO L'APPUNTAMENTO, congelato alla data di CREAZIONE della
-- trattativa: e' il setter di quel momento, non quello di oggi. Stesso motivo
-- della colonna gemella su `no_show` - vedi il commento piu' sotto - e stessa
-- regola: il setter, e in mancanza il proprietario.
--
-- Qui la data di riferimento e' `creata_ts` e non `svolta_ts`: il merito di
-- aver fissato l'appuntamento e' di chi lo ha fissato, anche se la consulenza
-- si svolge settimane dopo e nel frattempo il lead e' passato ad altri.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS setter_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_trattativa_setter ON trattativa (setter_id) WHERE setter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trattativa_creata ON trattativa (creata_ts);
CREATE INDEX IF NOT EXISTS idx_trattativa_svolta ON trattativa (svolta_ts) WHERE svolta_ts IS NOT NULL;

-- QUANDO LA TRATTATIVA E' STATA VINTA la prima volta.
--
-- Serve all'agenda, che cosi' distingue una consulenza che ha chiuso da una che
-- si e' solo tenuta: sono due cose diverse e finora avevano lo stesso colore.
--
-- Il primo ingresso nella fase, letto dalla cronologia e non dalla fase
-- attuale: una vinta viene spesso spostata dopo - archiviata a fine pratica, o
-- riaperta e richiusa - e guardando dove si trova adesso la vendita non si
-- vedrebbe piu'. Stessa ragione per cui i no show stanno in una tabella a
-- parte, ricavati allo stesso modo.
--
-- Una colonna e non una tabella perche' qui la domanda e' "questa consulenza ha
-- portato a casa qualcosa?", che ha una risposta sola: le vinte successive
-- della stessa pratica non sono altre vendite.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS vinta_ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trattativa_vinta ON trattativa (vinta_ts) WHERE vinta_ts IS NOT NULL;

-- QUANDO E' STATA RIPIANIFICATA LA CONSULENZA, con l'ora.
--
-- E' la "Data di chiusura" della trattativa, che su questa pipeline non indica
-- una chiusura ma l'appuntamento: l'orario finche' e' da svolgere, il momento
-- della consulenza nuova quando viene ripianificata. Dal 18 settembre 2026 gli
-- advisor sono obbligati a scrivere anche l'ora, e senza l'ora questo dato non
-- servirebbe a niente qui - una card in agenda ha bisogno di una fascia.
--
-- COSA COPRE: la consulenza rimandata sulla trattativa ma non spostata in
-- calendario. Per il CRM l'appuntamento esiste, per Google non esiste, e
-- l'agenda - che legge le riunioni - non lo mostrava. Misurato il 17 settembre
-- su un caso: ripianificata al giorno dopo, nessuna riunione creata, e la
-- consulenza persa da tutti e due i sistemi.
--
-- Si riempie solo per le trattative che stanno in fase Ripianificata: sulle
-- altre quella data significa altro.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS ripianificata_al TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trattativa_ripianificata ON trattativa (ripianificata_al)
  WHERE ripianificata_al IS NOT NULL;

-- L'ADVISOR DELLA TRATTATIVA: serve a sapere in quale colonna dell'agenda va la
-- card di una consulenza che esiste solo sul CRM. Il setter, che teniamo gia',
-- risponde a un'altra domanda - chi l'ha fissato - e le due persone non
-- coincidono.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS proprietario_id BIGINT;

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

-- CHI AVEVA FISSATO L'APPUNTAMENTO DISERTATO.
--
-- Sta qui e non su `trattativa` perche' e' un dato CONGELATO ALLA DATA: e' il
-- setter di quel momento, non quello di oggi. Le due cose divergono - misurato
-- su luglio: il 3% delle trattative ha cambiato setter dopo il no-show, e per
-- chi ha lasciato l'azienda i record passano a qualcun altro, cosi' la storia
-- si riscriverebbe da sola a ogni riassegnazione. Leggendo la cronologia della
-- proprieta' invece che il valore attuale lo scarto dal vecchio foglio scende
-- da 139 a 125 su 716 eventi.
--
-- Vale la regola del foglio Operatori, che e' quella giusta: il setter, e in
-- mancanza il proprietario. Un Advisor che si prende l'appuntamento da solo
-- spesso non compila il campo setter, ma in quel momento il setter e' lui.
ALTER TABLE no_show ADD COLUMN IF NOT EXISTS setter_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_no_show_setter ON no_show (setter_id) WHERE setter_id IS NOT NULL;

-- I proprietari HubSpot, per dare un nome agli id.
--
-- Serve perche' l'API /crm/v3/owners esclude di default gli utenti
-- DISATTIVATI, e gli ex dipendenti sono una fetta reale dello storico: senza
-- gli archiviati 76 proprietari su 496, e sette persone del solo luglio
-- restavano senza nome. Copiarli qui evita di richiamare HubSpot a ogni
-- caricamento di pagina per tradurre un id in un nome.
-- QUANDO LA CALL E' AVVENUTA DAVVERO, che non sempre e' l'orario
-- dell'appuntamento.
--
-- `inizio_ts` porta l'orario dell'appuntamento, ed e' quello giusto per quasi
-- tutto. Ma una consulenza puo' tenersi in un giorno diverso da quello fissato
-- senza che nessuno sposti l'appuntamento: l'advisor rimanda, si risentono tre
-- giorni dopo nella stessa stanza, e in calendario resta la data vecchia.
-- Misurato su settembre: tre casi, fino a 87 minuti di consulenza.
--
-- Serve all'agenda per mostrare la card anche nel giorno in cui la persona ha
-- lavorato davvero, che e' quello che si guarda per capire com'e' andata la
-- giornata.
ALTER TABLE presenza_call ADD COLUMN IF NOT EXISTS call_ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_presenza_call_ts ON presenza_call (call_ts) WHERE call_ts IS NOT NULL;

-- LE CONSULENZE CHE ESISTONO SOLO COME REGISTRAZIONE.
--
-- L'advisor tiene la call e registra la vendita creando la trattativa gia'
-- vinta, senza che nessuno metta l'appuntamento a calendario: sul CRM non c'e'
-- ne' riunione ne' consulenza svolta, e un'ora di lavoro non compare da nessuna
-- parte - ne' in agenda ne' nei conteggi per advisor.
--
-- PERCHE' UNA TABELLA E NON UN CALCOLO AL VOLO. L'agenda le ricavava
-- interrogando Fireflies a ogni apertura, un giorno alla volta. La tabella
-- Advisor pero' copre settimane, e rifare quel calcolo su un mese vorrebbe dire
-- decine di chiamate a ogni caricamento di pagina. Scritte qui dal sync - che
-- gira a ogni registrazione consegnata - le leggono tutte e due allo stesso
-- modo, e i due numeri non possono piu' divergere.
--
-- La riga sparisce se quella registrazione viene poi agganciata a una riunione:
-- a quel punto la consulenza ha la sua card vera e contarla qui la
-- raddoppierebbe.
CREATE TABLE IF NOT EXISTS consulenza_fuori_crm (
  trascrizione TEXT        PRIMARY KEY,
  advisor_id   BIGINT      NOT NULL,
  stanza       TEXT        NOT NULL,
  inizio_ts    TIMESTAMPTZ NOT NULL,
  durata_min   INT         NOT NULL,
  cliente      TEXT        NOT NULL,
  contatto_id  BIGINT,
  aggiornato_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuori_crm_inizio ON consulenza_fuori_crm (inizio_ts);
CREATE INDEX IF NOT EXISTS idx_fuori_crm_advisor ON consulenza_fuori_crm (advisor_id);

-- LA TRATTATIVA DI QUELLA CONSULENZA, quando si riesce a stabilirla.
--
-- Il cliente si riconosce dal nome della voce nella registrazione, ma un
-- cliente puo' avere piu' trattative aperte e senza appuntamento non c'e' niente
-- che dica a quale appartiene la call. Lo dice la "Data di chiusura": su una
-- trattativa ripianificata un'automazione ci scrive IL GIORNO della consulenza
-- nuova - solo il giorno, senza ora. Messa insieme all'orario della
-- registrazione, la coppia identifica la pratica.
--
-- Serve a far comparire l'arancione sulla card giusta quando la vendita chiude,
-- e a non attribuire una consulenza a una pratica che non c'entra.
ALTER TABLE consulenza_fuori_crm ADD COLUMN IF NOT EXISTS deal_id BIGINT;

CREATE TABLE IF NOT EXISTS proprietario (
  id     BIGINT PRIMARY KEY,
  nome   TEXT NOT NULL,
  attivo BOOLEAN NOT NULL DEFAULT TRUE
);

-- L'obiettivo di Boom del mese, per persona.
--
-- PERCHE' IN BANCA DATI E NON SU UN FOGLIO. E' l'unico numero della dashboard
-- che nessun sistema produce: non sta su HubSpot, non lo calcola nessuno, lo
-- decide una persona il primo del mese. Finora la colonna esisteva ma la sua
-- fonte non esisteva, quindi mostrava un trattino a tutti. Si digita nella
-- cella, e questa tabella e' dove finisce.
--
-- LA CHIAVE E' IL NOME NORMALIZZATO, non l'id del proprietario HubSpot, perche'
-- le righe della tabella nascono dal foglio Operatori e sono identificate dal
-- nome: e' la stessa chiave con cui la pagina accosta foglio e CRM. Se una
-- persona viene rinominata il suo obiettivo va riscritto - accettabile per un
-- numero che si tocca una volta al mese, e preferibile a un id che per le
-- persone del foglio non sempre esiste.
--
-- UNO PER MESE: l'obiettivo si fissa il primo giorno e resta fermo. Su un
-- periodo che copre piu' mesi la pagina ne mostra la somma, e non lascia
-- scrivere - non si saprebbe a quale mese attribuire il numero digitato.
CREATE TABLE IF NOT EXISTS obiettivo (
  persona TEXT        NOT NULL,
  mese    CHAR(7)     NOT NULL,
  valore  NUMERIC(12,2) NOT NULL CHECK (valore >= 0),
  PRIMARY KEY (persona, mese)
);

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
