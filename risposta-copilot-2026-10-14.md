# Dove siamo — 14 ottobre 2026

## Fatto oggi

**1. Link Fireflies nel webhook.** Da adesso ogni trattativa porta `fireflies_id`
e `fireflies_url` (`https://app.fireflies.ai/view/<id>`). Il link sta sul
**contatto**, non sulla trattativa, e da noi non è un indirizzo Fireflies ma uno
della nostra dashboard con l'id dentro: mandiamo l'id, che è la parte stabile.
Presente dove la consulenza è stata registrata — circa un contatto su tre.

**2. Storico dal 1° giugno: mandato.** 277 trattative dei chatter (giugno 89,
luglio 80, agosto 37, settembre 43, ottobre 28), con email, telefono e link
Fireflies. **198 agganciate** su 277.

**3. Le richieste a raffica sull'API KPI erano nostre.** Un giorno senza dati lo
richiedevamo ogni cinque minuti su mesi interi: adesso un giorno passato tornato
vuoto si riprova dopo un'ora. Non dovrebbe più succedere.

## Una cosa dalla vostra parte

I lotti da **100 trattative rispondono `502`**: i primi due sono falliti, gli
stessi dati a lotti da 25 sono passati tutti (12 lotti, nessun errore). Se il
limite vero è più basso di 100, conviene scriverlo nella guida.

## Cosa manca ancora, e cosa ci serve da voi

**Advisor della consulenza.** Su HubSpot non esiste una proprietà con *chi ha
tenuto la call*: c'è solo il proprietario della trattativa, che è il caso che a
voi non basta. Noi lo sappiamo da altre fonti (presenze alle call, agenda) e
possiamo mandarvelo, ma è un dato ricostruito da noi: ditecelo se vi va bene
così.

**Incontri.** Non abbiamo un webhook sugli incontri: va costruito. È il pezzo
più lungo dei quattro, lo affrontiamo dopo gli altri.

**Overbooking e passaggi fra advisor.** Ve li scriviamo, ma prima dobbiamo
verificare internamente come vengono registrati oggi.
