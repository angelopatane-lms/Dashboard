"use client";

import { useEffect, useState } from "react";
import SectionTitle from "@/components/ui/SectionTitle";
import { formatInt } from "@/lib/format";

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
  storico: Array<{ giorno: string; reali: number; in_attesa: number; presoAlle: string }>;
};

function Riquadro({
  etichetta,
  valore,
  nota,
  tono = "neutro"
}: {
  etichetta: string;
  valore: string;
  nota?: string;
  tono?: "neutro" | "buono" | "allarme";
}) {
  const fondo =
    tono === "allarme" ? "bg-rose-50 border-rose-200" : tono === "buono" ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200";
  const testo = tono === "allarme" ? "text-rose-900" : tono === "buono" ? "text-emerald-900" : "text-slate-900";
  return (
    <div className={`rounded-lg border px-4 py-3 ${fondo}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{etichetta}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${testo}`}>{valore}</div>
      {nota ? <div className="mt-0.5 text-xs text-slate-500">{nota}</div> : null}
    </div>
  );
}

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
        <SectionTitle>Contatti di Marketing</SectionTitle>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Dati non disponibili: {errore}
        </div>
      </section>
    );
  }

  if (!dati) {
    return (
      <section>
        <SectionTitle>Contatti di Marketing</SectionTitle>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-400">Lettura da HubSpot…</div>
      </section>
    );
  }

  const margine = dati.soglia - dati.reali;
  const fuoriSoglia = margine < 0;

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
      <SectionTitle>Contatti di Marketing</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Riquadro
          etichetta="Contatti di marketing veri"
          valore={formatInt(dati.reali)}
          nota={`Soglia ${formatInt(dati.soglia)}`}
          tono={fuoriSoglia ? "allarme" : "buono"}
        />
        <Riquadro
          etichetta={fuoriSoglia ? "Oltre la soglia di" : "Margine sulla soglia"}
          valore={formatInt(Math.abs(margine))}
          nota={fuoriSoglia ? "servono altri declassamenti" : "spazio ancora disponibile"}
          tono={fuoriSoglia ? "allarme" : "buono"}
        />
        <Riquadro
          etichetta="Declassati, in attesa del rinnovo"
          valore={formatInt(dati.inAttesa)}
          nota="usciranno al prossimo aggiornamento"
        />
        <Riquadro
          etichetta="Declassati nell'ultima notte"
          valore={declassatiNotte === null ? "—" : formatInt(declassatiNotte)}
          nota={
            declassatiNotte === null
              ? "serve una seconda fotografia"
              : `notte del ${ultima.giorno.split("-").reverse().slice(0, 2).join("/")}` +
                (daAllora !== 0 ? `, ${daAllora > 0 ? "+" : ""}${formatInt(daAllora)} da allora` : "")
          }
        />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Su HubSpot il totale dei contatti di marketing risulta{" "}
        <span className="font-medium text-slate-700 tabular-nums">{formatInt(dati.totale)}</span>: quel numero comprende
        anche i {formatInt(dati.inAttesa)} gia' declassati, che escono soltanto al rinnovo. Per la soglia conta la prima
        cifra.
      </p>

      {dati.storico.length > 1 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 text-left">Notte</th>
                <th className="px-3 py-2">Marketing veri</th>
                <th className="px-3 py-2">In attesa</th>
                <th className="px-3 py-2">Declassati</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dati.storico.map((r, i) => {
                const prima = dati.storico[i + 1];
                const delta = prima ? r.in_attesa - prima.in_attesa : null;
                return (
                  <tr key={r.giorno} className="text-right tabular-nums">
                    <td className="py-1.5 pr-4 text-left text-slate-700">
                      {r.giorno.split("-").reverse().join("/")}
                    </td>
                    <td className="px-3 py-1.5">{formatInt(r.reali)}</td>
                    <td className="px-3 py-1.5">{formatInt(r.in_attesa)}</td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {delta === null ? "—" : delta > 0 ? `+${formatInt(delta)}` : formatInt(delta)}
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
