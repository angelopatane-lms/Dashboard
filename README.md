📘 Dashboard Operatori & Dispatch
Specifiche Tecniche Complete (Versione Enterprise)

🎯 Obiettivo del Progetto
Costruire una dashboard analitica avanzata che unifica i dati delle due tabelle Google Sheet (Tabella A e Tabella B) e permette di:

analizzare performance degli operatori (Setter/Advisor)

analizzare qualità del dispatch

individuare pattern comportamentali

confrontare operatori e campagne

monitorare trend e anomalie

misurare continuità e follow-up

valutare qualità dei lead e qualità del lavoro

La dashboard deve essere professionale, leggibile, modulare e scalabile, in stile enterprise (Looker/PowerBI).

📂 Origine dei Dati
Tabella A — Performance Operatori
URL: (inserire URL CSV pubblico)  
Chiave: Data + Operatore + Campagna

Campi principali:

Data

Operatore

Campagna

Assegnati

Reattività (minuti)

Chiamate

Connessioni

Nuovi

Non Risposti

Interesse Futuro

Semina

Da Richiamare

BIN

Appuntamenti

No Show

Tabella B — Performance Dispatch
URL: (inserire URL CSV pubblico)  
Chiave: Data + Operatore + Campagna

Campi principali:

Data

Operatore

Campagna

Dispatch Sì

Dispatch No

Serie A

Serie B

Proprietario

Nuovi

Non Risposti

Interesse Futuro

Semina

Da Richiamare

BIN

🧠 Glossario Operativo
Reattività — tempo tra assegnazione e prima chiamata.

Assegnati — lead ricevuti.

Connessioni — chiamate con risposta.

Appuntamenti — appuntamenti fissati.

No Show — appuntamenti non presentati.

Serie A/B — classificazione qualità lead.

Proprietario — lead già gestiti dallo stesso operatore.

📊 Struttura della Dashboard (Enterprise)
1. KPI Principali (Row 1)
Card con valori aggregati:

Assegnati

Reattività media

Chiamate

Connessioni

Appuntamenti

No Show

Dispatch Sì

Dispatch No

Serie A

Serie B

Proprietario

2. Trend Temporale (Row 2)
Line Chart (Recharts)
Trend giornaliero di:

Assegnati

Chiamate

Connessioni

Appuntamenti

Dispatch

Funnel (Recharts)
Chiamate → Connessioni → Appuntamenti → Show → Dispatch Sì

3. Distribuzioni (Row 3)
Pie Chart
Serie A vs Serie B

Donut Chart
Dispatch Sì vs Dispatch No

Gauge Chart
Reattività media (con soglie colore)

4. Performance Operatori (Row 4)
Bar Chart Orizzontale
KPI combinato operatore

Ordinato per performance

Stacked Bar per Campagna
Conversioni

Dispatch

Serie A/B

5. Analisi Operatore (Tabella A)
Grafici dedicati:

Reattività

Connessioni

Appuntamenti

No Show

Distribuzione stati lead

Efficienza operatore

6. Analisi Dispatch (Tabella B)
Grafici dedicati:

Dispatch Sì/No

Serie A/B

Proprietario

Distribuzione stati lead

Qualità dispatch

7. Analisi Campagna
Distribuzione lead per campagna

Conversioni per campagna

Serie A/B per campagna

Proprietario per campagna

Ciclicità lead

8. Pattern Comportamentali
Correlazioni da calcolare:

Reattività → Connessioni

Connessioni → Appuntamenti

Appuntamenti → Serie A/B

Stato lead → Dispatch

Proprietario → Follow-up → Conversioni

9. Anomalie e Insights
Analisi automatica:

Operatori fuori media

Campagne fuori media

Giorni anomali

Picchi/cali improvvisi

Lead ricorrenti anomali

📐 Metriche da Calcolare
Efficienza
Efficienza contatto = Connessioni / Chiamate

Conversione appuntamenti = Appuntamenti / Connessioni

No Show % = No Show / Appuntamenti

Reattività % = 1 / Reattività media

Qualità
Qualità Dispatch = (Serie A + Serie B) / Dispatch Sì

Tasso Proprietario = Proprietario / (Dispatch Sì + Dispatch No)

Distribuzione stati lead (%)

Comportamento
Indice di Prontezza (reattività)

Indice di Costanza (varianza giornaliera)

Indice di Qualità Operatore (composito)

Indice di Continuità (Proprietario)

Ciclicità lead per campagna

Follow-up efficaci

🛠️ Istruzioni Tecniche per Windsurf
1. Struttura del progetto
Next.js 14

TypeScript

TailwindCSS

Recharts

Alias @/*

App Router

2. Componenti da creare
In /components/charts/:

LineTrend.tsx

Funnel.tsx

SeriesDistribution.tsx

DispatchDonut.tsx

ReactivityGauge.tsx

OperatorPerformance.tsx

CampaignStacked.tsx

3. Logica dati
In /lib/transform.ts:

normalizzazione

parsing date

conversione numeri

merge Tabella A + Tabella B

In /lib/metrics.ts:

tutte le metriche avanzate

In /lib/insights.ts:

anomalie

pattern

operatori fuori media

📌 Risultato Atteso
Una dashboard enterprise completa, con:

KPI avanzati

grafici professionali

analisi operatori

analisi dispatch

analisi campagne

trend temporali

funnel

correlazioni

anomalie

insight automatici