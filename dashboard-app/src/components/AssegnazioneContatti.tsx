import SectionTitle from "@/components/ui/SectionTitle";

/**
 * Il collegamento all'app che assegna i contatti agli Advisor e ai Setter.
 *
 * PERCHE' UN PULSANTE E NON L'APP DENTRO UN RIQUADRO, che era la richiesta di
 * partenza: provato il 5 ottobre 2026, il riquadro si carica ma dentro compare
 * il login. Il cookie di sessione di quell'app non e' marcato `SameSite=None`,
 * quindi il browser non lo manda - ne' lo accetta - quando la pagina sta dentro
 * un riquadro servito da un altro indirizzo. Non si aggira facendo l'accesso
 * li' dentro: il cookie viene scartato lo stesso e si torna al login.
 *
 * Si sistemerebbe marcando quel cookie `SameSite=None; Secure`, ma quell'app
 * non ha protezione CSRF - fra le sue dipendenze non c'e' Flask-WTF ne' altro -
 * e oggi il `SameSite` e' l'unica difesa che ha. Toglierlo per incorniciare una
 * pagina esporrebbe a richieste di terzi le rotte che assegnano i lead e
 * accendono il sistema. Il prezzo non vale la comodita'.
 *
 * I NUMERI E I COMANDI ARRIVANO DOPO, e non da qui: serve una rotta sull'app di
 * Alessio protetta da un segreto condiviso, che la Dashboard interroga dal lato
 * server. Non si passa dal suo database, che va chiuso e non aperto: oggi il
 * Postgres di quella macchina ascolta su tutte le interfacce, ed e' una cosa da
 * sistemare, non su cui appoggiarsi.
 */

/**
 * L'indirizzo dell'app. Ha questa forma perche' il contenitore espone la porta
 * 5000 senza pubblicarla e davanti c'e' traefik: `nip.io` risolve qualsiasi
 * sottodominio che contenga un IP verso quell'IP, quindi e' una scorciatoia per
 * non comprare un dominio. Se la macchina cambia indirizzo, cambia anche questo.
 */
const APP_ASSEGNAZIONI = "https://lms.217.154.117.118.nip.io/admin/lead-assignment";

export default function AssegnazioneContatti() {
  return (
    <section>
      <SectionTitle>Assegnazione Contatti</SectionTitle>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            <p className="font-medium text-slate-800">Employee Manager — Assegnazione Lead</p>
            <p className="mt-1">
              I contatti vengono assegnati su richiesta dal bot Slack. Da qui si aprono i
              comandi: acceso e spento del sistema, giorni della finestra automatica, quote
              per ruolo e ripartizione fra serie A e B.
            </p>
          </div>
          {/* rel="noopener noreferrer": la pagina che si apre non deve poter
              toccare questa, ed e' su un dominio che non controlliamo. */}
          <a
            href={APP_ASSEGNAZIONI}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Apri Assegnazione Lead
            {/* La freccetta dice che si esce dalla Dashboard: senza, un
                pulsante scuro sembra una cosa che succede qui dentro. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-4 w-4"
            >
              <path d="M7 4h9v9M16 4L7 13" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 11v5H4V7h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          Si apre in una scheda nuova e chiede un accesso suo, separato da quello della
          Dashboard.
        </p>
      </div>
    </section>
  );
}
