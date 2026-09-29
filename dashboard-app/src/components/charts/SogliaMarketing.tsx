import SectionTitle from "@/components/ui/SectionTitle";
import { formatInt } from "@/lib/format";

/**
 * I contatti di marketing con la barra delle due soglie.
 *
 * PERCHE' UNA BARRA E NON UN COLORE DI SFONDO. Il verde sulle carte diceva una
 * cosa sola - "siamo dentro" - e la diceva sempre allo stesso modo, sia al 60%
 * sia al 95%. La barra dice invece QUANTO si e' vicini, che e' la domanda vera:
 * fra quarantamila di margine e quattromila cambia tutto, e sul verde non si
 * vedeva nessuna differenza.
 *
 * LA BARRA FINISCE AL LIMITE HUBSPOT. Il fondo scala e' 250.000: la barra piena
 * vuol dire limite raggiunto, e la lunghezza del nero si legge come "quanto ne
 * abbiamo consumato". Se un giorno lo si supera, la barra non si allunga - non
 * potrebbe - ma la scala si allarga fino al valore vero: le tacche si stringono
 * verso sinistra, e quello scivolamento e' esso stesso il segnale che siamo
 * andati oltre.
 */

const SOGLIA_SICUREZZA = 240_000;
const LIMITE_HUBSPOT = 250_000;

function Carta({
  etichetta,
  valore,
  nota,
  barra
}: {
  etichetta: string;
  valore: number;
  nota: string;
  barra?: { quota: number; colore: string };
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{etichetta}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{formatInt(valore)}</div>
      <div className="mt-0.5 text-xs text-slate-500">{nota}</div>
      {barra ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full" style={{ width: `${barra.quota}%`, background: barra.colore }} />
        </div>
      ) : null}
    </div>
  );
}

export default function SogliaMarketing({
  reali,
  inAttesa,
  declassatiNotte,
  marcatiStretto,
  barraNellaCarta = true,
  barraLunga = true
}: {
  reali: number;
  inAttesa: number;
  declassatiNotte: number | null;
  marcatiStretto: number | null;
  /** La barretta sotto il primo numero. */
  barraNellaCarta?: boolean;
  /** La barra grande sotto le carte. */
  barraLunga?: boolean;
}) {
  const totale = reali + inAttesa;
  // Il fondo scala e' il limite, finche' non lo si supera: da li' in poi e' il
  // valore stesso, cosi' la barra resta lunga uguale e a muoversi sono le
  // tacche.
  const fondoScala = Math.max(LIMITE_HUBSPOT, reali);
  const quota = (n: number) => Math.max(0, Math.min(100, (n / fondoScala) * 100));

  // Le fasce dopo i contatti veri, fino al numero che HubSpot conta: quanto
  // manca alla sicurezza, la zona fra le due soglie, e tutto quello che sta
  // oltre il limite - che oggi sono i gia' declassati in attesa del rinnovo.
  const finoASicurezza = Math.max(0, Math.min(SOGLIA_SICUREZZA, fondoScala) - reali);
  const fasciaAttenzione = Math.max(0, Math.min(LIMITE_HUBSPOT, fondoScala) - Math.max(reali, SOGLIA_SICUREZZA));
  const oltreLimite = Math.max(0, fondoScala - Math.max(reali, LIMITE_HUBSPOT));

  const dentroSicurezza = reali < SOGLIA_SICUREZZA;
  const dentroLimite = reali < LIMITE_HUBSPOT;
  // PALETTE DI UNA FAMIGLIA SOLA. Il giallo e il rosso pieni accanto al nero e
  // al grigio strillavano: qui restano due pastelli tenui, che si distinguono
  // senza sembrare un allarme quando allarme non c'e'. Il segnale forte arriva
  // dal testo e dalle tacche, non dalla superficie colorata.
  const coloreStato = dentroSicurezza ? "#475569" : dentroLimite ? "#ef8f1c" : "#9f1239";

  return (
    <section>
      <SectionTitle>Stato Contatti di Marketing</SectionTitle>


      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Carta
          etichetta="Contatti di marketing"
          valore={reali}
          nota={
            dentroSicurezza
              ? `${Math.round((reali / SOGLIA_SICUREZZA) * 100)}% della soglia di sicurezza`
              : dentroLimite
                ? `oltre la soglia di sicurezza di ${formatInt(reali - SOGLIA_SICUREZZA)}`
                : `oltre il limite HubSpot di ${formatInt(reali - LIMITE_HUBSPOT)}`
          }
          barra={barraNellaCarta ? { quota: Math.min(100, (reali / SOGLIA_SICUREZZA) * 100), colore: coloreStato } : undefined}
        />
        <Carta
          etichetta={dentroSicurezza ? "Margine sulla soglia" : "Da declassare per rientrare"}
          valore={dentroSicurezza ? finoASicurezza : reali - SOGLIA_SICUREZZA}
          nota={dentroSicurezza ? "fino a 240.000" : "per tornare sotto 240.000"}
        />
        <Carta
          etichetta="Declassati in attesa di rinnovo"
          valore={inAttesa}
          nota="usciranno al prossimo aggiornamento"
        />
        <Carta
          etichetta="Declassati dell'ultima esecuzione"
          valore={declassatiNotte ?? 0}
          nota={marcatiStretto ? `di cui ${formatInt(marcatiStretto)} extra` : "ultima esecuzione dei flussi"}
        />
      </div>

      {barraLunga ? (
      <>
      {/* LA BARRA STA SOTTO LE CARTE: i numeri si leggono per primi, la barra
          e' il commento che dice dove stanno rispetto ai limiti. Le larghezze
          sono quote della scala, non percentuali del valore. */}
      {/* Lo stesso passo fra tutti i blocchi della sezione - carte, barra, nota,
          tabella - cosi' non sembra che qualcosa sia appiccicato e altro
          lontano. */}
      <div className="mt-4">
        {/* GLI ULTIMI DIECIMILA HANNO UN COLORE LORO.
            Il grigio del margine si ferma a 240.000, e la fascia fra soglia e
            limite resta rosa chiaro in ogni stato: e' lo spazio che non
            andrebbe usato, e tenerlo dello stesso grigio del margine lo faceva
            sembrare disponibile come il resto. Rosa e non giallo perche' e' la
            stessa famiglia del rosso dello sforamento e della riga della
            soglia: la stessa cosa detta piano.

            Sotto soglia il pieno e' nero; fra soglia e limite diventa arancione
            e si ferma sul numero, con la sabbia a dire quanto manca al limite;
            oltre il limite la barra e' tutta rossa, perche' li' non c'e' piu'
            niente da scomporre. */}
        {/* LA SOGLIA E' UNA RIGA, non un cambio di tinta.
            Il passaggio fra grigio e sabbia si nota solo se lo si cerca: una
            riga rossa sottile, sopra la barra, dice esattamente dove sta il
            confine da non passare. Sta in posizione assoluta cosi' resta
            ferma anche quando le fasce cambiano larghezza. */}
        <div className="relative flex h-10 overflow-hidden rounded-lg border border-slate-200">
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-[2px]"
            style={{ left: `${quota(SOGLIA_SICUREZZA)}%`, background: "#e11d48" }}
          />
          {!dentroLimite ? (
            <div
              className="flex items-center justify-center text-[13px] font-semibold uppercase tracking-wide tabular-nums text-white"
              style={{ width: "100%", background: "#9f1239" }}
            >
              {formatInt(reali)} - limite superato di {formatInt(reali - LIMITE_HUBSPOT)}
            </div>
          ) : (
            <>
              <div
                className="flex items-center justify-center text-[13px] font-semibold uppercase tracking-wide tabular-nums text-white"
                style={{ width: `${quota(reali)}%`, background: dentroSicurezza ? "#0f172a" : "#ef8f1c" }}
              >
                {dentroSicurezza
                  ? `${formatInt(reali)} - contatti di marketing`
                  : `${formatInt(reali)} - soglia superata di ${formatInt(reali - SOGLIA_SICUREZZA)}`}
              </div>
              {finoASicurezza > 0 ? (
                <div
                  className="flex items-center justify-center bg-slate-200 text-[13px] font-semibold uppercase tracking-wide tabular-nums text-slate-600"
                  style={{ width: `${quota(finoASicurezza)}%` }}
                >
                  {finoASicurezza > 25_000 ? `${formatInt(finoASicurezza)} - margine` : ""}
                </div>
              ) : null}
              {/* NESSUNA SCRITTA QUI DENTRO: la fascia e' stretta e il testo ci
                  stava a fatica, e quando il pieno diventa arancione una
                  seconda scritta accanto alla prima le indeboliva entrambe. */}
              <div
                className="text-[11px]"
                style={{ width: `${quota(Math.min(LIMITE_HUBSPOT, fondoScala) - Math.max(reali, SOGLIA_SICUREZZA))}%`, background: "#fbdde1" }}
              />
            </>
          )}
        </div>

        {/* Le tacche stanno dove cadono sulla scala: quando il valore supera il
            limite si stringono verso sinistra, ed e' quello il segnale. */}
        <div className="relative mt-1 h-5">
          <div className="absolute -translate-x-1/2 text-center" style={{ left: `${quota(SOGLIA_SICUREZZA)}%` }}>
            <div className="mx-auto h-1.5 w-px bg-slate-300" />
            <div className="text-[11px] font-semibold tabular-nums text-slate-600">240K</div>
          </div>
          <div className="absolute -translate-x-1/2 text-center" style={{ left: `${quota(LIMITE_HUBSPOT)}%` }}>
            <div className="mx-auto h-1.5 w-px bg-slate-300" />
            <div className="text-[11px] font-semibold tabular-nums text-slate-700">250K</div>
          </div>
        </div>
      </div>
      </>
      ) : null}

    </section>
  );
}
