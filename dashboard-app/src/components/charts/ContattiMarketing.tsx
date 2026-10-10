"use client";

import { useEffect, useState } from "react";
import SectionTitle from "@/components/ui/SectionTitle";
import SogliaMarketing from "@/components/charts/SogliaMarketing";
import { formatInt } from "@/lib/format";

/**
 * Quante righe dell'elenco esecuzioni si vedono prima che cominci a scorrere.
 *
 * L'elenco cresce di una riga a notte e non si ferma: senza un tetto la
 * sezione diventerebbe per meta' questa tabella, e quello che le sta sotto
 * finirebbe sempre piu' lontano.
 */
const RIGHE_VISIBILI = 20;

/**
 * Le due altezze, misurate a schermo il 10 ottobre 2026: una riga della
 * tabella (text-sm con py-1.5) e l'intestazione (text-xs con py-2).
 *
 * Stanno qui scritte e non dentro un'altezza in pixel scelta a occhio: il
 * tetto si calcola dalle righe, cosi' cambiando RIGHE_VISIBILI si cambia
 * quello che si vede, e se un giorno la riga cambia altezza basta correggere
 * una costante invece di rimisurare tutto.
 */
const ALTEZZA_RIGA = 32.5;
const ALTEZZA_INTESTAZIONE = 32;

/**
 * I contatti di marketing, e quanto manca alla soglia dell'abbonamento.
 *
 * IL NUMERO GRANDE DI HUBSPOT NON E' QUELLO CHE CONTA. HubSpot mostra come "di
 * marketing" anche i contatti gia' declassati, perche' l'uscita diventa
 * effettiva solo al rinnovo. Il 28 settembre diceva 344.249, ma 149.772 erano
 * gia' segnati per uscire e i contatti veri erano 194.477: leggendo il numero
 * grande si sarebbe concluso di essere fuori soglia di centomila, mentre il
 * margine era di quarantamila.
 *
 * Per questo la cifra in grande qui e' quella vera, e il totale di HubSpot sta
 * sotto, spiegato: chi apre questa pagina dopo aver guardato HubSpot deve poter
 * capire da dove nasce la differenza senza chiedere a nessuno.
 */

type Dati = {
  reali: number;
  inAttesa: number;
  totale: number;
  soglia: number;
  /** Le due code: il segmento normale e quello stretto. null quando la lista
   *  non e' leggibile, che e' diverso da zero. */
  coda: number | null;
  codaExtra: number | null;
  storico: Array<{ giorno: string; reali: number; in_attesa: number; marcatiStretto: number | null; declassatiStima: number | null; presoAlle: string }>;
};

export default function ContattiMarketing() {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/contatti-marketing")
      .then((r) => r.json())
      .then((d: Dati & { error?: string }) => (d.error ? setErrore(d.error) : setDati(d)))
      .catch((e) => setErrore(String(e)));
  }, []);

  if (errore) {
    return (
      <section>
        <SectionTitle>Stato Contatti di Marketing</SectionTitle>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Dati non disponibili: {errore}
        </div>
      </section>
    );
  }

  if (!dati) {
    return (
      <section>
        <SectionTitle>Stato Contatti di Marketing</SectionTitle>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">Lettura da HubSpot…</div>
      </section>
    );
  }

  // QUANTI NE HA DECLASSATI L'ULTIMA NOTTE, non "da stamattina".
  //
  // I due flussi girano a cavallo della mezzanotte: alle 23:30 quello stretto
  // marca i contatti se siamo fuori soglia, alle 00:00 il principale declassa
  // quelli marcati insieme al segmento Declassabili. La fotografia scatta dopo,
  // quindi quando qualcuno apre la pagina il lavoro della notte e' gia' dentro
  // lo scatto e un conteggio "da mezzanotte a adesso" trova sempre zero. Visto
  // il 29 settembre: 284 declassati nella notte, e la casella diceva 0.
  //
  // La misura giusta e' la differenza fra le ultime due fotografie: e' il
  // risultato di una nottata intera, ed e' il numero che dice se i flussi
  // stanno tenendo il passo delle nuove iscrizioni.
  const ultima = dati.storico[0];
  const precedente = dati.storico[1];
  const declassatiNotte = ultima && precedente ? ultima.in_attesa - precedente.in_attesa : null;
  // Quello che si e' mosso DOPO la fotografia. Di solito poca roba: se un
  // giorno diventasse grande vorrebbe dire che qualcosa declassa fuori orario,
  // ed e' bene accorgersene.
  const daAllora = ultima ? dati.inAttesa - ultima.in_attesa : 0;

  return (
    <section>
      {/* Le carte e la barra delle soglie stanno in un componente a parte, che
          non sa niente di come i numeri sono stati presi: cosi' si e' potuto
          provarlo in anteprima con valori inventati, compresi quelli fuori
          soglia che nella realta' speriamo di non vedere mai. */}
      <SogliaMarketing
        reali={dati.reali}
        inAttesa={dati.inAttesa}
        declassatiNotte={declassatiNotte}
        marcatiStretto={ultima?.marcatiStretto ?? null}
        barraNellaCarta={false}
      />

      <p className="mt-4 text-xs text-slate-500">
        {/* LA RISERVA NON E' UNA CODA. Il segmento Declassabili viene lavorato
            ogni notte; quello Extra lo tocca il flusso stretto soltanto se
            siamo fuori soglia, quindi finche' il margine regge resta fermo - e
            scriverlo come "in coda per stanotte" faceva pensare a un arretrato
            che non esiste. */}
        {dati.coda !== null || dati.codaExtra !== null ? (
          <>
            Stanotte i flussi lavoreranno{" "}
            <span className="font-medium text-slate-700 tabular-nums">{formatInt(dati.coda ?? 0)}</span> contatti del
            segmento Declassabili. Altri{" "}
            <span className="font-medium text-slate-700 tabular-nums">{formatInt(dati.codaExtra ?? 0)}</span> stanno in
            Declassabili Extra: e' la riserva, e il flusso stretto la usa solo se si supera la soglia.{" "}
          </>
        ) : null}
      </p>

      {dati.storico.length > 1 ? (
        /* VENTI RIGHE E POI SI SCORRE. L'elenco cresce di una riga a notte e
           non si ferma: senza un tetto, da qui in poi la pagina sarebbe per
           meta' questa tabella, e tutto quello che le sta sotto sparirebbe
           sempre piu' lontano.
           L'ALTEZZA SI CALCOLA DALLE RIGHE, non e' un numero di pixel scelto a
           occhio: cosi' cambiando RIGHE_VISIBILI si cambia quello che si vede,
           e se un giorno la riga cambia altezza basta correggere una costante
           invece di indovinare di nuovo. */
        <div
          className="mt-4 overflow-auto rounded-lg border border-slate-200 bg-white"
          style={{ maxHeight: ALTEZZA_INTESTAZIONE + RIGHE_VISIBILI * ALTEZZA_RIGA }}
        >
          <table className="w-full text-sm">
            {/* L'INTESTAZIONE RESTA ATTACCATA IN ALTO mentre si scorre: cinque
                colonne di numeri senza i loro nomi non si leggono, e in una
                tabella che scorre i nomi sono i primi a sparire. */}
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="border-b border-slate-200 py-2 pl-4 pr-4 text-left">Esecuzioni</th>
                <th className="border-b border-slate-200 px-3 py-2">Contatti di marketing</th>
                <th className="border-b border-slate-200 px-3 py-2">In attesa di rinnovo</th>
                <th className="border-b border-slate-200 px-3 py-2">Declassati extra</th>
                <th className="border-b border-slate-200 px-3 py-2 pr-4">Declassati totali</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dati.storico.map((r, i) => {
                const prima = dati.storico[i + 1];
                const delta = prima ? r.in_attesa - prima.in_attesa : null;
                return (
                  <tr key={r.giorno} className="text-right tabular-nums">
                    {/* L'ORA ACCANTO ALLA DATA: due righe possono essere dello
                        stesso giorno con fotografie prese a ore diverse, e senza
                        l'ora non si capirebbe quale finestra misurano. */}
                    <td className="py-1.5 pl-4 pr-4 text-left text-slate-700">
                      {r.giorno.split("-").reverse().join("/")} - {r.presoAlle}
                    </td>
                    <td className="px-3 py-1.5">{formatInt(r.reali)}</td>
                    <td className="px-3 py-1.5">{formatInt(r.in_attesa)}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {r.marcatiStretto === null ? "—" : formatInt(r.marcatiStretto)}
                    </td>
                    {/* La prima notte non aveva fotografie: il suo numero e' una
                        stima ricavata dalla serie che HubSpot pubblica su Slack.
                        Si mostra come gli altri, senza segni particolari - resta
                        scritto nel suggerimento da dove viene. */}
                    <td className="px-3 py-1.5 pr-4 text-slate-500">
                      {delta !== null ? (
                        delta > 0 ? `+${formatInt(delta)}` : formatInt(delta)
                      ) : r.declassatiStima !== null ? (
                        <span title="Stima: quella notte non era ancora attiva la fotografia. Ricavata dal conteggio delle 23:30 pubblicato da HubSpot e dal ritmo di ingresso del giorno dopo.">
                          +{formatInt(r.declassatiStima)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
