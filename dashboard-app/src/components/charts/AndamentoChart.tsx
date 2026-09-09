"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatEur, formatFloat, formatInt, formatPct } from "@/lib/format";
import { etichettaMese, type Formato, type SerieAndamento } from "@/lib/andamento";

// Dieci tinte distinguibili anche accanto. Non e' la scala azzurra delle
// tabelle: li' il colore dice "quanto", qui dice "chi".
const COLORI = [
  "#0f172a",
  "#0ea5e9",
  "#e11d48",
  "#059669",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#65a30d",
  "#c2410c"
];

/** Gli stessi formati delle celle della tabella Campagne, decimali compresi. */
/** Serve solo il formato: il grafico non calcola niente, disegna e basta. */
export type MetricaDisegnabile = { label: string; formato: Formato };

function totale(valori: Array<number | null>): number {
  return valori.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

export function formattaValore(v: number, m: MetricaDisegnabile): string {
  if (m.formato === "euro_centesimi") return formatEur(v, 2);
  if (m.formato === "euro") return formatEur(v);
  if (m.formato === "percento") return formatPct(v, 1);
  if (m.formato === "volte") return `${formatFloat(v, 2)}x`;
  return formatInt(v);
}

/**
 * L'andamento mensile su una metrica sola, una linea per gruppo.
 *
 * Lo usano due pagine con due gruppi diversi - le campagne per categoria, gli
 * advisor per persona - e i mesi fuori dalla banda di normalita' sono segnati
 * con un pallino pieno piu' grande: il grafico dice l'andamento, i pallini
 * dicono dove guardare, e l'elenco sotto dice cosa e' successo.
 */
export default function AndamentoChart({
  mesi,
  serie,
  metrica,
  anomalie,
  quante = 12
}: {
  mesi: string[];
  serie: SerieAndamento[];
  metrica: MetricaDisegnabile;
  /** Chiavi "gruppo|mese" dei punti da marcare. */
  anomalie: Set<string>;
  /** Quante linee disegnare al massimo: oltre una dozzina non si distinguono
   *  piu' ne' fra loro ne' nella legenda. Restano tutte nell'elenco sotto. */
  quante?: number;
}) {
  if (serie.length === 0 || mesi.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Nessun dato per le categorie scelte.
      </div>
    );
  }

  // L'ultimo mese porta un asterisco nell'etichetta perche' e' in corso.
  //
  // Una fascia colorata sarebbe stata piu' evidente, ma su un asse di categorie
  // - non di date - una banda che comincia e finisce sullo stesso mese ha
  // larghezza zero e non si vede. L'asterisco funziona sempre, e la nota sotto
  // al grafico lo spiega.
  const etichette = mesi.map((mese, i) => etichettaMese(mese) + (i === mesi.length - 1 ? " *" : ""));

  // Si tengono le linee piu' alte sulla metrica scelta: con venti advisor il
  // grafico diventa illeggibile, e chi sta in fondo lo si trova col filtro
  // Operatore o nell'elenco delle segnalazioni.
  const disegnate =
    serie.length <= quante
      ? serie
      : [...serie]
          .sort((a, b) => totale(b.valori) - totale(a.valori))
          .slice(0, quante);

  const dati = mesi.map((mese, i) => {
    const riga: Record<string, string | number | null> = { mese: etichette[i], iso: mese };
    for (const s of disegnate) riga[s.gruppo] = s.valori[i];
    return riga;
  });

  const ultimo = etichette[etichette.length - 1];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dati} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="mese" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
          // Larga abbastanza per "1.241.586 EUR" e per la spesa a due
          // decimali: piu' stretta, i valori piu' grandi verrebbero tagliati.
          width={95}
          tickFormatter={(v: number) => formattaValore(v, metrica)}
        />

        <Tooltip
          formatter={(v: number, nome: string) => [formattaValore(v, metrica), nome]}
          labelFormatter={(l: string) => (l === ultimo ? l.replace(" *", " (mese in corso)") : l)}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e2e8f0" }}
          itemSorter={(x) => -(x.value as number)}
        />

        {/* Con dieci categorie la legenda non e' un di piu': senza, ogni linea
            si identifica solo passandoci sopra col mouse, una alla volta. */}
        <Legend
          verticalAlign="bottom"
          height={36}
          iconType="plainline"
          iconSize={14}
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />

        {disegnate.map((s, i) => (
          <Line
            key={s.gruppo}
            type="monotone"
            dataKey={s.gruppo}
            stroke={COLORI[i % COLORI.length]}
            strokeWidth={2}
            // Senza questo una categoria che salta un mese spezza la linea in
            // due tronconi: cosi' invece la scavalca e resta leggibile.
            connectNulls
            dot={(props) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index: number };
              if (cx === undefined || cy === undefined) return <g key={`${s.gruppo}-${index}`} />;
              const fuori = anomalie.has(`${s.gruppo}|${mesi[index]}`);
              return (
                <circle
                  key={`${s.gruppo}-${index}`}
                  cx={cx}
                  cy={cy}
                  r={fuori ? 5 : 2.5}
                  fill={fuori ? COLORI[i % COLORI.length] : "#fff"}
                  stroke={COLORI[i % COLORI.length]}
                  strokeWidth={fuori ? 2 : 1.5}
                />
              );
            }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
