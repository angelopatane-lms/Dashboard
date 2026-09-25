-- ACCESSO IN SOLA LETTURA PER UN AGENTE ESTERNO.
--
-- Non si danno le tabelle: si da' uno schema di viste. Costa dieci righe in
-- piu' e in cambio permette di cambiare una colonna senza rompere il lavoro di
-- chi legge, di lasciare fuori quello che non deve uscire, e di revocare tutto
-- togliendo un GRANT invece di ricostruire i permessi tabella per tabella.
--
-- COSA RESTA FUORI, e perche':
--   - presenza_call.trascrizione: e' l'identificativo Fireflies della
--     registrazione, cioe' un puntatore al contenuto della conversazione con il
--     cliente. Le altre colonne dicono com'e' andata la call, questa la fa
--     ascoltare. Per le analisi richieste - tempi, conteggi, no show - non
--     serve.
--   - consulenza_fuori_crm: contiene il NOME del cliente in chiaro, unica
--     tabella che lo fa, e non e' stata chiesta.
--
-- COSA C'E' DENTRO. Nelle sei tabelle non ci sono ne' nomi ne' email: solo
-- identificativi di HubSpot. Restano tali e quali perche' chi legge ha gia' un
-- token HubSpot suo, quindi sostituirli con un codice non nasconderebbe niente
-- e impedirebbe di incrociare i dati con il CRM - che e' lo scopo.
--
-- IN PIU' RISPETTO ALLE TABELLE: il nome della campagna e l'etichetta della
-- fase, che altrimenti sarebbero numeri da indovinare.
--
-- IL RUOLO VA CREATO DA SQL, NON DALLA CONSOLE DI NEON.
--
-- Un ruolo creato dalla console - o da CLI e API - riceve d'ufficio
-- l'appartenenza a `neon_superuser`, che porta con se' CREATEDB, CREATEROLE e
-- BYPASSRLS: leggerebbe tutto, viste o non viste, e questo file non servirebbe
-- a niente. Creato da SQL riceve invece solo i privilegi di base, cioe' niente
-- finche' non glielo si concede.
--
-- Uso:
--   1. scegli una password e mettila nella riga qui sotto, LANCIANDO IL FILE DA
--      UN TERMINALE TUO (il file non va salvato con la password dentro);
--   2. esegui questo file sul database;
--   3. sostituisci 'agente_lettura' se hai chiamato il ruolo in un altro modo.

-- CREATE ROLE agente_lettura LOGIN PASSWORD 'METTI-QUI-LA-PASSWORD';

CREATE SCHEMA IF NOT EXISTS letture;

-- Le campagne, per dare un nome agli id.
CREATE OR REPLACE VIEW letture.campagna AS
  SELECT id, nome FROM public.campagna;

-- Gli eventi di conversione: un contatto, una campagna, un istante.
CREATE OR REPLACE VIEW letture.eventi_conversione AS
  SELECT e.contact_id, e.ts, e.campagna_id, c.nome AS campagna, e.posizione
    FROM public.eventi_conversione e
    LEFT JOIN public.campagna c ON c.id = e.campagna_id;

-- Le chiamate. `connessa` distingue il tentativo dalla conversazione: e' la
-- colonna che serve per il tempo fra lead e primo contatto vero.
CREATE OR REPLACE VIEW letture.chiamata AS
  SELECT h.call_id, h.contact_id, h.ts, h.connessa, h.campagna_id, c.nome AS campagna
    FROM public.chiamata h
    LEFT JOIN public.campagna c ON c.id = h.campagna_id;

-- L'ETICHETTA DELLA FASE, non il suo numero.
--
-- Su HubSpot la fase e' un id senza significato. Le etichette qui sono copiate
-- dalla pipeline "Appuntamenti (High Ticket)" il 24 settembre 2026: se qualcuno
-- rinomina una fase sul CRM, questa lista resta indietro e va aggiornata a mano.
-- La dashboard invece le rilegge a ogni richiesta, quindi li' il problema non
-- si pone.
CREATE OR REPLACE FUNCTION letture.etichetta_fase(id text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE id
    WHEN '665590998'  THEN 'Da Svolgere'
    WHEN '762372819'  THEN 'Semina'
    WHEN '665590999'  THEN 'Ripianificata'
    WHEN '666989041'  THEN 'No Show'
    WHEN '762180829'  THEN 'Semivinta'
    WHEN '665591003'  THEN 'Vinta'
    WHEN '762180830'  THEN 'Richiesta Rimborso'
    WHEN '762180831'  THEN 'Cliente'
    WHEN '665591004'  THEN 'Persa'
    WHEN '1449655500' THEN 'Archiviata'
    ELSE id
  END
$$;

-- Una riga per pratica, con le sue date.
CREATE OR REPLACE VIEW letture.trattativa AS
  SELECT t.deal_id, t.contact_id, t.campagna_id, c.nome AS campagna,
         t.creata_ts, t.svolta_ts, t.vinta_ts, t.ripianificata_al,
         t.setter_id, t.proprietario_id,
         letture.etichetta_fase(t.fase) AS fase, t.fase_ts, t.motivo
    FROM public.trattativa t
    LEFT JOIN public.campagna c ON c.id = t.campagna_id;

-- Ogni passaggio di fase, datato: e' la tabella per i tempi fra una fase e
-- l'altra. Il motivo e' quello letto al momento del passaggio, non quello di
-- oggi.
CREATE OR REPLACE VIEW letture.fase_storia AS
  SELECT s.deal_id, s.ts, letture.etichetta_fase(s.fase) AS fase, s.motivo
    FROM public.fase_storia s;

-- Gli appuntamenti disertati. Una pratica puo' comparire piu' volte: viene
-- ripianificata e il cliente diserta di nuovo.
CREATE OR REPLACE VIEW letture.no_show AS
  SELECT n.deal_id, n.ts, n.setter_id, n.campagna_id, c.nome AS campagna
    FROM public.no_show n
    LEFT JOIN public.campagna c ON c.id = n.campagna_id;

-- Le call registrate, senza l'identificativo della registrazione. `voci` e' il
-- numero di persone che hanno parlato, `quota_secondo` quanto ha parlato la
-- seconda: insieme dicono se il cliente c'era e quanto e' intervenuto.
CREATE OR REPLACE VIEW letture.presenza_call AS
  SELECT p.riunione_id, p.contatto_id, p.esito, p.motivo, p.voci,
         p.quota_secondo, p.inizio_ts, p.call_ts, p.durata_min
    FROM public.presenza_call p;

-- I PERMESSI: lettura sulle viste e basta.
--
-- Sulle tabelle di `public` non si concede niente, quindi restano illeggibili
-- anche se domani ne aggiungessimo una con dentro i nomi dei clienti: un ruolo
-- nuovo non ha SELECT su nulla finche' non glielo si da'. Le viste invece
-- funzionano lo stesso, perche' girano con i diritti di chi le ha create.
GRANT CONNECT ON DATABASE neondb TO agente_lettura;
GRANT USAGE ON SCHEMA letture TO agente_lettura;
GRANT SELECT ON ALL TABLES IN SCHEMA letture TO agente_lettura;
GRANT EXECUTE ON FUNCTION letture.etichetta_fase(text) TO agente_lettura;

-- Le viste aggiunte in futuro a questo schema sono leggibili senza rifare il
-- GRANT: una cosa in meno da ricordare il giorno che se ne aggiunge una.
ALTER DEFAULT PRIVILEGES IN SCHEMA letture GRANT SELECT ON TABLES TO agente_lettura;

-- PER REVOCARE TUTTO:
--   REVOKE ALL ON SCHEMA letture FROM agente_lettura;
--   DROP ROLE agente_lettura;
