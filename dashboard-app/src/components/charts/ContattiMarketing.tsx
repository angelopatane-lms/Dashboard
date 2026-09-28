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

  // I DECLASSATI DEL GIORNO SONO UNA DIFFERENZA, non un dato che HubSpot
  // fornisce: quanti contatti in piu' risultano "in attesa del rinnovo" rispetto
  // alla fotografia notturna. Il primo giorno la riga non c'e' ancora e la
  // casella lo dice invece di mostrare uno zero, che sarebbe una bugia.
  //
  // LA FOTOGRAFIA DEVE ESSERE DI NOTTE. Il lavoro automatico scatta alle 00:10,
  // ma la primissima riga e' stata presa a mano nel pomeriggio: confrontarsi con
  // quella dava "1 declassato", che non e' la giornata ma i venti minuti
  // precedenti. Quando lo scatto non e' notturno la casella lo dichiara.
  const base = dati.storico[0];
  const declassatiOggi = base ? dati.inAttesa - base.in_attesa : null;
  const oraBase = base ? Number(base.presoAlle.slice(0, 2)) : 0;
  const baseNotturna = oraBase < 4;

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
          etichetta="Declassati oggi"
          valore={declassatiOggi === null ? "—" : formatInt(Math.max(0, declassatiOggi))}
          nota={
            declassatiOggi === null
              ? "serve la fotografia di stanotte"
              : baseNotturna
                ? `da mezzanotte, fotografia delle ${base.presoAlle}`
                : `solo dalle ${base.presoAlle} di oggi: la misura piena parte domani`
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
