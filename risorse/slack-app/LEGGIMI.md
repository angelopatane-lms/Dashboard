# Icona per l'app Slack dell'Assegnazione lead

`icona-app-slack-512.png` — 512x512, pronta da caricare.

## Dove si carica

Slack → **Your apps** → l'app del bot dei lead → **Basic Information** →
*Display Information* → **App icon**.

Slack chiede almeno 512x512 e ridimensiona lui: non usare la 128 del sito, che
ingrandita viene sgranata.

## Cosa cambia dopo averla caricata

L'avatar dell'app vale per **tutti** i suoi messaggi, anche quelli dove nessuno
ha pensato a passare un'icona, e vale per il profilo che si apre cliccando sul
nome. E' il posto giusto dove metterla.

Fino a quel momento l'icona viaggia messaggio per messaggio, con `icon_url`,
preso dalla variabile `SLACK_ICONA_RIFIUTO` nel `docker-compose.yml` dell'app
di assegnazione (`~/lms_webapp` sul 217.154.117.118). Quella variabile punta a
`https://dashboard-smoky-eight-94.vercel.app/icone/avviso-lead.png`.

**`icon_url` ha la precedenza sull'avatar dell'app.** Quindi, una volta caricata
l'icona su Slack, per far vincere quella basta **svuotare la variabile**: il
codice manda `icon_url` solo se c'e' qualcosa dentro, quindi vuota significa
"usa l'avatar dell'app". Nessuna riga di codice da toccare.

## Perche' due copie della stessa immagine

Quella servita ai messaggi sta in `dashboard-app/public/icone/`, che e' l'unica
cartella esclusa dal middleware di login: Slack deve poterla scaricare senza
autenticarsi. Spostarla da li' la fa sparire dai messaggi senza nessun errore.

Questa copia invece non viene servita a nessuno: e' solo il file da caricare a
mano, tenuto dove si ritrova.
