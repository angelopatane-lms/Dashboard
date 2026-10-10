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
  -- SOLO NELLO SCHEMA public: senza questo filtro il controllo guarda anche le
  -- viste di `letture`, che espongono la campagna per nome proprio perche' chi
  -- legge da fuori non deve ricostruirsela dall'id. Quella colonna e' voluta, e
  -- faceva scattare il salvagente su un database perfettamente sano.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'eventi_conversione'
      AND column_name = 'campagna'
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

-- DOVE STA ADESSO LA TRATTATIVA, e da quando.
--
-- Serve alle card che restano azzurre su un giorno passato. Oggi una fascia
-- senza esito e una fascia il cui esito e' stato messo poco prima si
-- assomigliano: il 17 settembre, su sette card azzurre, cinque avevano la
-- trattativa gia' andata avanti - No Show, Persa, Semina - e una sola era
-- davvero da esitare.
--
-- La regola e' il giorno: se la fase e' cambiata NELLO STESSO GIORNO della
-- fascia, quell'esito e' il suo e la card prende il colore che gli spetta. Se e'
-- cambiata prima, riguarda un appuntamento precedente e la card resta com'e' -
-- non si puo' sapere se quel "no show" di due giorni fa volesse dire "annullato",
-- e in quel caso l'advisor avrebbe dovuto cancellare riunione e trattativa.
--
-- Il motivo serve a leggere la fase Ripianificata, che da sola non dice niente:
-- vale consulenza svolta con "Trattativa" e diserzione con "Mancata Presenza".
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS fase TEXT;
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS fase_ts TIMESTAMPTZ;
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS motivo TEXT;

CREATE INDEX IF NOT EXISTS idx_trattativa_fase_ts ON trattativa (fase_ts) WHERE fase_ts IS NOT NULL;

-- IL PRODOTTO VENDUTO, quando la trattativa e' stata vinta.
--
-- HubSpot compila "Prodotto_" solo a vendita fatta: verificato, tutte le 444
-- trattative con un prodotto REM e tutte le 104 con un prodotto D.A. stanno in
-- fase Vinta, nessuna altrove. Quindi questa colonna e' vuota sulla grande
-- maggioranza delle righe, e dove c'e' e' la parola definitiva su che cosa e'
-- stato venduto: batte la campagna, che dice solo da dove arriva il contatto, e
-- batte il programma dedotto dalla registrazione.
ALTER TABLE trattativa ADD COLUMN IF NOT EXISTS prodotto TEXT;

-- TUTTI I PASSAGGI DI FASE, non solo l'ultimo.
--
-- Le colonne qui sopra dicono dove sta la trattativa ADESSO. Basta a colorare
-- una fascia di oggi, non basta a dire che cosa e' stato segnato su una
-- consulenza di sei giorni fa: se quella pratica nel frattempo e' andata
-- avanti, del No Show messo quella mattina non resta traccia. Misurato il 23
-- settembre: su 36.080 trattative solo 4.347 hanno la data della fase attuale,
-- e in ogni caso e' una data sola.
--
-- Serve all'agenda, che a ogni card deve dare la fase della SUA giornata: dalla
-- mezzanotte del giorno dell'appuntamento fino alla vigilia di quello dopo,
-- quando la consulenza e' stata ripianificata. Fuori da quella finestra il
-- movimento appartiene a un altro appuntamento.
--
-- NON COSTA NIENTE IN PIU'. Il sync scarica gia' la cronologia di `dealstage` e
-- di `motivo` per ogni trattativa - le servono per contare no show e consulenze
-- svolte - e poi la scarta tenendo solo l'ultimo valore. Qui la si scrive
-- invece di buttarla.
--
-- Il motivo e' quello LETTO AL MOMENTO DEL PASSAGGIO, non quello di oggi:
-- HubSpot non lo cancella quando la trattativa va avanti, e preso dallo stato
-- attuale produce accostamenti falsi come "No Show (Trattativa)".
CREATE TABLE IF NOT EXISTS fase_storia (
  deal_id BIGINT      NOT NULL,
  ts      TIMESTAMPTZ NOT NULL,
  fase    TEXT        NOT NULL,
  motivo  TEXT,
  PRIMARY KEY (deal_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_fase_storia_ts ON fase_storia (ts);

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

-- DI QUALE PROGRAMMA SI E' PARLATO IN CALL.
--
-- La campagna dice da dove arriva il contatto, non che cosa gli e' stato
-- proposto: misurato su 85 consulenze registrate, i Dipendenti Artificiali
-- vengono nominati in 22 e solo 11 di quelle hanno campagna Imprenditoria - le
-- altre arrivano da MBE, REM, Diventa Coach e ICMD. Su meta' di quelle
-- consulenze la campagna direbbe un programma sbagliato.
--
-- Si ricava contando i nomi dei prodotti dentro la registrazione, che il
-- riconoscimento delle presenze scarica gia': vedi src/lib/programma.ts. Resta
-- NULL quando la call non nomina nessun programma - il 41% dei casi - e li'
-- l'agenda mostra solo la campagna.
ALTER TABLE presenza_call ADD COLUMN IF NOT EXISTS programma TEXT;

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

-- CHI HA FATTO LA CHIAMATA.
--
-- Serve a contare Chiamate e Connessioni per advisor leggendole da HubSpot
-- invece che dal foglio Operatori, che va compilato a mano e non sempre lo e':
-- misurato il 28 settembre, un advisor con 136 lead assegnati e 3 chiamate
-- segnate - con gli appuntamenti che invece arrivano da HubSpot, la percentuale
-- di appuntamento gli usciva al 400%.
--
-- Resta NULL sulle chiamate lette prima che questa colonna esistesse, finche'
-- non si rilancia il bootstrap.
ALTER TABLE chiamata ADD COLUMN IF NOT EXISTS proprietario_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_chiamata_proprietario
  ON chiamata (proprietario_id, ts) WHERE proprietario_id IS NOT NULL;

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

-- LA FOTOGRAFIA NOTTURNA DEI CONTATTI DI MARKETING.
--
-- HubSpot non sa dire quanti contatti un flusso ha declassato: l'API dei flussi
-- risponde se sono attivi e basta, e la proprieta' "Contatti di Marketing fino
-- al prossimo aggiornamento" non porta la data in cui e' cambiata. Contando
-- ogni notte, la differenza fra due righe e' il numero di declassati del
-- giorno - l'unica misura onesta che si possa avere.
--
-- `reali` sono i contatti di marketing veri; `in_attesa` quelli gia' declassati
-- che aspettano il rinnovo per uscire davvero. La somma e' il numero che si
-- legge su HubSpot, e da solo inganna: il 28 settembre diceva 344.249 mentre i
-- contatti veri erano 194.477, sotto la soglia di 240.000.
CREATE TABLE IF NOT EXISTS marketing_snapshot (
  giorno    DATE PRIMARY KEY,
  reali     INT NOT NULL,
  in_attesa INT NOT NULL,
  preso_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LE DUE CODE DEL DECLASSAMENTO, fotografate insieme ai conteggi.
--
-- `coda` e' il segmento DECLASSABILI, `coda_extra` quello DECLASSABILI EXTRA che
-- il flusso stretto usa quando siamo fuori soglia. Sono liste DINAMICHE: dicono
-- quanti sono candidati stanotte, non quanti sono stati lavorati - quello resta
-- la differenza fra due fotografie. Servono a vedere in anticipo se la prossima
-- notte avra' da lavorare molto o niente.
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS coda INT;
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS coda_extra INT;

-- QUANTI NE HA MARCATI IL FLUSSO STRETTO, quella notte.
--
-- Il flusso delle 23:30 segna i contatti sulla proprieta' "Pulizia Stretta
-- Attiva" e alle 00:00 il principale li declassa: fuori da quella mezz'ora la
-- proprieta' e' vuota, quindi l'unico modo di sapere quanti erano e' contarli
-- mentre sono marcati. Ci pensa una seconda fotografia alle 23:45, che scrive
-- sulla riga del GIORNO DOPO - cosi' il marcato e il declassato della stessa
-- nottata stanno sulla stessa riga.
--
-- Resta NULL nelle notti in cui siamo dentro soglia: li' il flusso stretto non
-- interviene, e NULL dice "non ha lavorato" mentre uno zero direbbe "ha
-- lavorato e non ha trovato nessuno".
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS marcati_stretto INT;

-- IL PRIMA DELLA NOTTATA, misurato alle 23:45.
--
-- Con il solo "dopo" il numero dei declassati si ricava dalla differenza fra
-- due notti, e ci finisce dentro anche chi si e' iscritto durante il giorno:
-- per la notte del 28 settembre si e' dovuto stimare, e la stima ballava fra
-- cento e trecento. Misurando anche il prima, il declassamento di ogni notte
-- e' una sottrazione esatta - e la differenza fra il dopo di una notte e il
-- prima della successiva diventa il numero di nuovi contatti della giornata,
-- che finora non avevamo.
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS pre_reali INT;
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS pre_in_attesa INT;

-- UNA STIMA, QUANDO LA MISURA NON C'E'.
--
-- La prima notte non aveva fotografie: il declassamento del 28 settembre si e'
-- ricavato dalla serie che HubSpot pubblica ogni mattina su Slack - il
-- conteggio delle 23:30, prima dei flussi - piu' il ritmo di ingresso misurato
-- il giorno dopo. Vale come ordine di grandezza, non come cifra, e la dashboard
-- lo mostra con la tilde davanti perche' nessuno lo scambi per un dato.
--
-- Da riempire solo a mano e solo sulle notti senza misura: le altre restano
-- NULL e il numero si calcola dalle fotografie.
ALTER TABLE marketing_snapshot ADD COLUMN IF NOT EXISTS declassati_stima INT;

-- ============================================================================
-- LA CRONOLOGIA DEGLI STATI LEAD, per chi lavora solo al telefono.
--
-- PERCHE' SERVE UNA TABELLA. Quattro advisor seguono il low ticket senza
-- fissare videochiamate: niente appuntamento sul calendario, niente trattativa,
-- e le colonne Appuntamenti e Consulenze restano a zero. L'unica traccia del
-- loro lavoro e' lo Stato Lead del contatto.
--
-- PERCHE' LA CRONOLOGIA E NON LO STATO ATTUALE. Un contatto ne attraversa
-- diversi e sopravvive solo l'ultimo: chi passa da "Appuntamento fissato" a
-- "in Trattative" perderebbe l'appuntamento, e chi compra diventa "Cliente" in
-- automatico e perde tutto quello che c'era prima. Qui si tiene ogni INGRESSO
-- in uno stato, con la sua data, e si contano quelli caduti nel periodo.
--
-- PERCHE' NON SI LEGGE DA HUBSPOT A OGNI APERTURA. I quattro insieme hanno
-- 15.777 contatti, 13.292 dei quali toccati da settembre in poi: servirebbero
-- oltre 260 chiamate per disegnare una tabella, su un tetto al secondo gia'
-- condiviso con le altre rotte.
--
-- PERCHE' IL PROPRIETARIO STA SULLA RIGA e non si prende da quello di adesso:
-- i contatti vengono riciclati e cambiano mano negli anni - se ne vedono che
-- passano NEW -> BIN -> NEW -> BIN fra proprietari diversi. Attribuire al
-- proprietario attuale falserebbe i mesi passati. Qui si scrive chi lo aveva
-- NEL MOMENTO di quel cambio, ricavato dalla cronologia di hubspot_owner_id.
-- ============================================================================
CREATE TABLE IF NOT EXISTS stato_lead_storia (
  contatto_id     BIGINT      NOT NULL,
  -- L'istante del cambio, come lo riporta HubSpot.
  ts              TIMESTAMPTZ NOT NULL,
  -- Il valore INTERNO, non l'etichetta: "Persa in Chamata" col refuso,
  -- "Semina Follow up" e "Semina Follow Up (Post Consulenza)" distinti dalla
  -- sola maiuscola. Vedi src/lib/statiLead.ts.
  stato           TEXT        NOT NULL,
  -- Chi aveva il contatto in quell'istante. NULL quando la cronologia del
  -- proprietario non arriva cosi' indietro: la riga resta, ma non si attribuisce.
  proprietario_id BIGINT,
  -- Due cambi nello stesso millisecondo sullo stesso contatto non esistono:
  -- la coppia basta a rendere il giro ripetibile senza duplicare.
  PRIMARY KEY (contatto_id, ts)
);

CREATE INDEX IF NOT EXISTS stato_lead_storia_periodo
  ON stato_lead_storia (proprietario_id, ts);

-- LA CAMPAGNA DEL CONTATTO NELL'ISTANTE DEL CAMBIO DI STATO.
--
-- Senza di lei le righe dei quattro advisor telefonici non rispondono al
-- filtro Campagna: tutti gli altri numeri della tabella si restringono e i
-- loro no, e si leggono fianco a fianco cifre che misurano cose diverse senza
-- che niente lo dica. Un totale che non torna si nota, questo no.
--
-- E' il valore grezzo di id_campagna_refresh, non un id della tabella
-- campagna: il filtro della dashboard confronta l'etichetta normalizzata con
-- la stringa dell'id, e tenerla com'e' permette di usare lo stesso confronto
-- che gia' si applica alle trattative.
--
-- Si legge dalla CRONOLOGIA come il proprietario, perche' cambia nel tempo:
-- esistono apposta id_campagna_refresh_precedente e storico_campagna_refresh.
-- Prendere quella di adesso attribuirebbe i mesi passati alla campagna sbagliata.
ALTER TABLE stato_lead_storia ADD COLUMN IF NOT EXISTS campagna TEXT;

-- ============================================================================
-- CHI HA RICEVUTO LEAD DALL'APP DI ASSEGNAZIONE, GIORNO PER GIORNO.
--
-- A COSA SERVE. L'app Employee Manager dice quanti lead ha distribuito oggi e
-- a quante persone (`assegnati_oggi`, `persone_oggi`), ma non A CHI. Per
-- sapere chi aveva ricevuto cosa bisognava interrogare a mano il suo database,
-- che vive sul suo server e da qui non si raggiunge: host.docker.internal.
--
-- DA DOVE ARRIVA IL DATO. Da HubSpot, non dall'app. Quando il bot assegna
-- scrive il proprietario sul contatto, e HubSpot ne tiene la cronologia con
-- l'ORIGINE del cambio. Si tengono solo le voci con sourceType = INTEGRATION e
-- sourceId uguale all'app di Alessio: il 7 ottobre 2026 i contatti che avevano
-- cambiato proprietario erano 1.071, ma solo 560 veniva dal bot - gli altri
-- erano workflow, azioni in blocco e fusioni di contatti. Senza quel filtro il
-- report non tornerebbe con il numero che l'app mostra di se'.
--
-- PERCHE' SI CONSERVA INVECE DI CALCOLARLO OGNI VOLTA. Il calcolo costa una
-- trentina di chiamate a HubSpot, e il token e' condiviso con decine di flussi
-- Zapier su un tetto di 19 chiamate al secondo. La sezione che mostra questi
-- numeri si rilegge ogni minuto: ricalcolare ad ogni lettura vorrebbe dire
-- spendere il budget di tutti per un riquadro.
-- ============================================================================
CREATE TABLE IF NOT EXISTS assegnazione_giorno (
  giorno          DATE        NOT NULL,
  proprietario_id BIGINT      NOT NULL,
  lead            INT         NOT NULL,
  -- Primo e ultimo istante della giornata per quella persona: due richieste
  -- alle 9 e alle 18 raccontano una giornata diversa da due alle 9 e alle 9:01.
  prima           TIMESTAMPTZ,
  ultima          TIMESTAMPTZ,
  PRIMARY KEY (giorno, proprietario_id)
);

-- LA RIGA CHE DICE "QUESTO GIORNO L'HO CALCOLATO".
--
-- Senza di lei un giorno senza assegnazioni e un giorno mai calcolato si
-- leggono uguali: nessuna riga in assegnazione_giorno. E' la differenza fra
-- "oggi il bot non ha distribuito niente" e "il dato non e' arrivato", che e'
-- esattamente il tipo di zero che ci e' gia' costato caro altrove.
--
-- `totale` e `atteso` servono alla stessa cosa da due lati: `totale` e' quanto
-- abbiamo contato noi da HubSpot, `atteso` quanto dichiara l'app di se'. Se
-- divergono, qualcosa si e' rotto - e va detto, non nascosto dietro un numero
-- che sembra buono.
CREATE TABLE IF NOT EXISTS assegnazione_giorno_calcolo (
  giorno              DATE        PRIMARY KEY,
  aggiornato_at       TIMESTAMPTZ NOT NULL,
  totale              INT         NOT NULL,
  persone             INT         NOT NULL,
  contatti_esaminati  INT         NOT NULL,
  atteso              INT
);

-- L'INIZIO DELLA FINESTRA A CUI APPARTIENE IL SEGNALIBRO.
--
-- `ultimo_id` da solo non basta a riprendere un giro interrotto: dice DOVE ci
-- si era fermati, non QUALE finestra si stava percorrendo. Riprendere da
-- quell'id con una finestra piu' recente salterebbe tutte le righe modificate
-- prima del nuovo inizio e con id maggiore - un buco silenzioso, che e' il
-- motivo per cui il giro delle trattative preferiva fallire del tutto.
--
-- Con questa colonna la ripresa e' esatta: stessa finestra, dall'id dove si era
-- arrivati. La riga viene cancellata quando un giro arriva in fondo.
ALTER TABLE sync_checkpoint ADD COLUMN IF NOT EXISTS finestra_da TIMESTAMPTZ;

-- ============================================================================
-- OGNI RICHIESTA DI LEAD, COM'E' ANDATA E PERCHE'.
--
-- COSA RIEMPIE. La tabella `assegnazione_giorno` dice chi ha RICEVUTO lead, ed
-- e' ricostruita da HubSpot. Di chi ha chiesto e si e' sentito dire di no non
-- restava traccia da nessuna parte: il 6 ottobre 2026, su sedici richieste,
-- nove non sono state servite, e per sapere il perche' e' servito interrogare
-- a mano il database dell'app. Un rifiuto non scrive niente su HubSpot - non
-- c'e' nessun contatto che cambia - quindi quella meta' di giornata era
-- invisibile per costruzione.
--
-- DA DOVE ARRIVA. Dall'app di assegnazione, che la manda appena ha deciso, nello
-- stesso punto in cui gia' scrive su Slack. Non la chiediamo noi: una richiesta
-- rifiutata non lascia righe nella sua tabella, quindi non ci sarebbe modo di
-- andarsela a prendere dopo.
--
-- PERCHE' SI CONSERVANO PENDENTI E APPUNTAMENTI del momento: sono il PERCHE'
-- della decisione, e domani non si possono piu' ricostruire perche' entrambi
-- cambiano di continuo. Senza, resterebbe scritto "rifiutato" senza il numero
-- che lo giustificava.
-- ============================================================================
CREATE TABLE IF NOT EXISTS assegnazione_richiesta (
  -- L'IDENTIFICATIVO LO DA' L'APP, ed e' la chiave: se riprova a consegnare la
  -- stessa richiesta si riscrive la stessa riga invece di aggiungerne una.
  -- Senza, un tentativo ripetuto conterebbe due volte.
  id            TEXT        PRIMARY KEY,
  giorno        DATE        NOT NULL,
  chiesto_at    TIMESTAMPTZ NOT NULL,
  slack_user    TEXT,
  employee_id   BIGINT,
  nome          TEXT,
  ruolo         TEXT,
  -- 'assegnato' oppure 'rifiutato'. Non si usa un booleano: un terzo esito
  -- arrivera' - una consegna parziale, un errore - e un booleano costringe a
  -- riscrivere tutto quando arriva.
  esito         TEXT        NOT NULL,
  motivo        TEXT,
  lead          INT         NOT NULL DEFAULT 0,
  serie         TEXT,
  richiesta_n   INT,
  pendenti      INT,
  appuntamenti  INT,
  -- Gli id dei contatti consegnati: servono a seguirli su HubSpot e vedere
  -- quanti vengono restituiti. L'8 ottobre 2026 una persona si e' tolta di
  -- mano 41 degli 80 lead ricevuti, venti minuti dopo averli ricevuti.
  contatti      BIGINT[],
  ricevuto_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assegnazione_richiesta_giorno
  ON assegnazione_richiesta (giorno, chiesto_at);

-- ============================================================================
-- I NUMERI DEL SERBATOIO NEL TEMPO.
--
-- COSA CONSERVA. I due pool, la riserva, e i totali della giornata, come li
-- dichiara l'app di assegnazione. Oggi si vedono in pagina e basta: il pool
-- cambia di continuo e non ne resta niente, e `assegnati_oggi` e `persone_oggi`
-- si azzerano a mezzanotte. Senza una traccia non si puo' rispondere a domande
-- semplici - il serbatoio si sta svuotando? da quando? - se non guardando la
-- pagina al momento giusto.
--
-- COME SI RIEMPIE. Senza chiamate in piu': la sezione interroga gia' l'app ogni
-- minuto mentre qualcuno la guarda, e si conserva un campione ogni dieci. Di
-- notte non si registra niente, ed e' giusto cosi': di notte non si assegna.
--
-- NON E' UNA FOTOGRAFIA GIORNALIERA come marketing_snapshot, che serve a
-- misurare una differenza fra due giorni. Qui interessa l'andamento dentro la
-- giornata: un pool che si svuota alle 11 racconta una cosa diversa da uno che
-- si svuota alle 18.
-- ============================================================================
CREATE TABLE IF NOT EXISTS assegnazione_pool (
  preso_at        TIMESTAMPTZ PRIMARY KEY DEFAULT now(),
  -- NULL e non zero quando l'app non e' riuscita a contarli: un serbatoio
  -- vuoto e un serbatoio non misurato si leggono diversissimi.
  pool_a          INT,
  pool_b          INT,
  riserva         INT,
  riserva_max     INT,
  assegnati_oggi  INT,
  persone_oggi    INT,
  sistema_acceso  BOOLEAN,
  modalita_live   BOOLEAN
);

CREATE INDEX IF NOT EXISTS assegnazione_pool_quando
  ON assegnazione_pool (preso_at DESC);

-- GLI ASSEGNABILI VERI, accanto al serbatoio grezzo.
--
-- `pool_a` e `pool_b` sono quello che dichiara l'app: tutti i contatti del
-- serbatoio, senza filtri. Misurato l'8 ottobre 2026, fra i due facevano 38.299
-- mentre i contatti davvero assegnabili erano 525 - quasi due ordini di
-- grandezza di differenza, e il motivo per cui una richiesta da 20 lead ne
-- riceveva 4 mentre la pagina diceva migliaia.
--
-- Il taglio lo fa quasi tutto l'eta' massima (20 giorni): da 38.299 a 534. Gli
-- altri filtri, sul serbatoio vero, valgono una manciata di contatti.
--
-- RESTANO FUORI i filtri Sergente, l'esclusione campagne scelta dall'interfaccia
-- e la riserva serie A: vivono nel codice dell'app e da qui non si applicano.
-- Per questo si chiamano "assegnabili" e non "disponibili": e' un massimo, non
-- una promessa.
ALTER TABLE assegnazione_pool ADD COLUMN IF NOT EXISTS assegnabili_a INT;
ALTER TABLE assegnazione_pool ADD COLUMN IF NOT EXISTS assegnabili_b INT;

-- I TETTI DI ETA' SONO DUE, NON UNO.
--
-- `assegnabili_a` e `assegnabili_b` contano a venti giorni, che e'
-- MAX_LEAD_AGE_DAYS: il tetto del serbatoio principale, quello da cui si pesca
-- normalmente. Ma l'app ne ha un secondo - MAX_LEAD_AGE_HOURS_FALLBACK, 45
-- giorni - su cui ripiega quando il principale non copre la richiesta, e fino
-- al 10 ottobre 2026 queste due colonne lo ignoravano: la pagina dichiarava
-- 1.095 e 855 dove l'app, arrivata al ripiego, pesca da 3.352 e 4.141.
--
-- IL NUMERO IN GRANDE RESTA QUELLO A VENTI GIORNI, perche' e' quello che si
-- usa quasi sempre: con mille lead disponibili e richieste da venti, il
-- ripiego non scatta quasi mai. Questi due dicono fin dove si arriva quando
-- scatta.
--
-- NON SONO UNA SOMMA: i contatti entro venti giorni sono gia' dentro questi.
ALTER TABLE assegnazione_pool ADD COLUMN IF NOT EXISTS esteso_a INT;
ALTER TABLE assegnazione_pool ADD COLUMN IF NOT EXISTS esteso_b INT;

-- ============================================================================
-- CHI STAVA IN QUALE SOTTO-TEAM, E DA QUANDO.
--
-- HUBSPOT NON LO CONSERVA. L'API dice chi c'e' adesso e basta: se una persona
-- entra nel team Eventi oggi, i mesi passati si riscrivono come se ci fosse
-- sempre stata, e non esiste modo di sapere com'era a giugno. E' lo stesso
-- limite che rende impossibile attribuire correttamente il lavoro di chi si
-- sposta a meta' anno, o di chi lavora al 50% su due squadre.
--
-- Da qui in poi ogni spostamento fatto dalla Dashboard lascia una riga. Non e'
-- un registro di sicurezza - anche se serve pure a quello - e' la dimensione
-- che mancava: l'appartenenza CON UNA DATA.
--
-- Non registra gli spostamenti fatti direttamente su HubSpot: quelli restano
-- invisibili, ed e' una ragione in piu' per fare queste modifiche da qui.
-- ============================================================================
CREATE TABLE IF NOT EXISTS utente_team_storia (
  id          BIGSERIAL   PRIMARY KEY,
  quando      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     TEXT        NOT NULL,
  nome        TEXT,
  email       TEXT,
  -- 'aggiunto' | 'tolto'. Uno spostamento sono due righe, non una: cosi' la
  -- storia si legge come una sequenza di eventi e non come uno stato, ed e'
  -- quello che serve per ricostruire un mese passato.
  azione      TEXT        NOT NULL,
  team_id     TEXT        NOT NULL,
  team_nome   TEXT,
  -- L'elenco completo prima e dopo: se un giorno una scrittura andasse storta,
  -- e' l'unico modo per rimettere le cose come stavano.
  prima       TEXT[],
  dopo        TEXT[]
);

CREATE INDEX IF NOT EXISTS utente_team_storia_utente
  ON utente_team_storia (user_id, quando DESC);

-- ---------------------------------------------------------------------------
-- La composizione dei team come era al giro precedente.
--
-- SERVE SOLO A FARE LA DIFFERENZA. HubSpot dice chi c'e' adesso e niente di
-- piu': non esiste nessuno storico dell'appartenenza ai team, e quando una
-- persona si sposta i mesi passati si rileggono come se ci fosse sempre stata.
-- Tenendo qui la fotografia del giro prima, il confronto produce gli ingressi e
-- le uscite con la loro data, che e' quello che serve per attribuire il lavoro
-- di chi cambia squadra a meta' mese.
--
-- PERCHE' GUARDANDO E NON SCRIVENDO. Il 9 ottobre 2026 si e' misurato che
-- togliere una persona da un sotto-team via API non si puo' - vedi
-- src/lib/utenti/team.ts - quindi i cambi si fanno dal portale. Osservarli e'
-- l'unico modo di vederli tutti, compresi quelli fatti a mano.
CREATE TABLE IF NOT EXISTS utente_team_adesso (
  user_id   TEXT        NOT NULL,
  team_id   TEXT        NOT NULL,
  -- 'principale' | 'secondario': la stessa persona puo' stare in un team come
  -- primaria e in un altro come secondaria, e sono due appartenenze diverse.
  genere    TEXT        NOT NULL,
  nome      TEXT,
  email     TEXT,
  team_nome TEXT,
  visto_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id, genere)
);

-- Il genere dell'appartenenza che e' cambiata: 'principale' | 'secondario'.
--
-- SENZA, LO STORICO NON BASTA. Serve a rimettere le persone nella riga giusta
-- guardando un mese passato, e le due righe della tabella Advisor sono due cose
-- diverse: il gruppo e' il team PRINCIPALE, la separazione fra chi lavora al
-- telefono e chi no e' un SOTTO-team. Un evento che non dice quale dei due e'
-- cambiato non permette di ricostruire ne' l'uno ne' l'altra.
ALTER TABLE utente_team_storia ADD COLUMN IF NOT EXISTS genere TEXT;

-- Da dove viene la riga: 'modifica' | 'osservato' | 'ricostruito'.
--
-- NON SONO LA STESSA COSA, e confonderle toglierebbe valore a tutte e tre.
-- 'modifica' l'ha scritta chi ha premuto il pulsante, con il prima e il dopo
-- esatti. 'osservato' nasce dal confronto fra due fotografie: il cambiamento
-- e' certo, il momento e' preciso quanto il giro che l'ha visto. 'ricostruito'
-- e' dedotto dalla cronologia di hs_owning_teams sui contatti - vedi
-- scripts/recupera-storico-team.ts - ed e' l'unico che potrebbe sbagliarsi,
-- perche' un contatto che cambia padrone somiglia a una persona che cambia
-- squadra.
ALTER TABLE utente_team_storia ADD COLUMN IF NOT EXISTS fonte TEXT;
UPDATE utente_team_storia SET fonte = 'modifica' WHERE fonte IS NULL;

-- Quanto regge una riga ricostruita: "18/20", cioe' su quanti contatti del
-- campione si e' visto quel cambiamento.
--
-- SERVE A NON FAR SEMBRARE UGUALI DUE DEDUZIONI DIVERSE. Uno spostamento visto
-- su venti contatti su venti e' praticamente certo; lo stesso visto su uno
-- solo - perche' quella persona un contatto solo ne possiede - puo' essere un
-- passaggio di mano sfuggito al controllo. Senza questo numero chi legge non
-- ha modo di distinguerli. Vuoto sulle righe osservate e su quelle scritte da
-- noi, dove non c'e' niente da dedurre.
ALTER TABLE utente_team_storia ADD COLUMN IF NOT EXISTS prove TEXT;
