"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatEur, formatFloat, formatInt } from "@/lib/format";
import { etichettaMese, type Metrica, type SerieCategoria } from "@/lib/andamento";

// Dieci categorie, dieci tinte distinguibili anche accanto. Non e' la scala
// azzurra delle tabelle: li' il colore dice "quanto", qui dice "chi".
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

export function formattaValore(v: number, m: Metrica): string {
  if (m.formato === "euro") return formatEur(v);
  if (m.formato === "volte") return `${formatFloat(v, 2)}x`;
  return formatInt(v);
}

/**
 * L'andamento mensile delle categorie su una metrica sola.
 *
 * Una linea per categoria, e i mesi fuori dalla banda di normalita' segnati con
 * un pallino pieno piu' grande: il grafico dice l'andamento, i pallini dicono
 * dove guardare, e l'elenco sotto dice cosa e' successo.
 */
export default function CategorieAndamentoChart({
  mesi,
  serie,
  metrica,
  anomalie
}: {
  mesi: string[];
  serie: SerieCategoria[];
  metrica: Metrica;
  /** Chiavi "categoria|mese" dei punti da marcare. */
  anomalie: Set<string>;
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

  const dati = mesi.map((mese, i) => {
    const riga: Record<string, string | number | null> = { mese: etichette[i], iso: mese };
    for (const s of serie) riga[s.categoria] = s.valori[i];
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
          width={70}
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

        {serie.map((s, i) => (
          <Line
            key={s.categoria}
            type="monotone"
            dataKey={s.categoria}
            stroke={COLORI[i % COLORI.length]}
            strokeWidth={2}
            // Senza questo una categoria che salta un mese spezza la linea in
            // due tronconi: cosi' invece la scavalca e resta leggibile.
            connectNulls
            dot={(props) => {
              const { cx, cy, index } = props as { cx?: number; cy?: number; index: number };
              if (cx === undefined || cy === undefined) return <g key={`${s.categoria}-${index}`} />;
              const fuori = anomalie.has(`${s.categoria}|${mesi[index]}`);
              return (
                <circle
                  key={`${s.categoria}-${index}`}
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
