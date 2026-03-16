"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CsvRow } from "@/lib/csv";
import { getString, toDateIso } from "@/lib/metrics";
import Card from "@/components/ui/Card";

type TimelineEvent = {
  timestampRaw: string;
  tsKey: string;
  trigger: string;
  value: string;
  countdown: string;
};

function normalizeHeaderKey(value: string): string {
  return value.trim().toLowerCase();
}

function getStringByHeaderLoose(row: CsvRow, header: string): string {
  const direct = getString(row, header);
  if (direct) return direct;

  const wanted = normalizeHeaderKey(header);
  for (const k of Object.keys(row)) {
    if (normalizeHeaderKey(k) === wanted) return getString(row, k);
  }

  return "";
}

function normalizeNameValue(value: string): string {
  return value.trim().toLowerCase();
}

function shouldEnableSearch(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (q.includes(" ")) return true;
  return q.length >= 4;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [delayMs, value]);
  return debounced;
}

function normalizeTsKey(value: string): string {
  const v = value.trim();
  if (!v) return "";

  const isoLike = v.replace(" ", "T");
  const d = new Date(isoLike);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return v;
}

function formatEventLine(e: TimelineEvent): string {
  const trigger = e.trigger.trim();
  const value = e.value.trim();
  if (trigger && value) return `${e.timestampRaw} – ${trigger}: ${value}`;
  if (trigger) return `${e.timestampRaw} – ${trigger}`;
  if (value) return `${e.timestampRaw} – ${value}`;
  return e.timestampRaw;
}

function formatEventTooltip(e: TimelineEvent): string {
  const trigger = e.trigger.trim();
  const value = e.value.trim();

  if (trigger && value) return `${e.timestampRaw} – ${trigger}: ${value}`;
  if (trigger) return `${e.timestampRaw} – ${trigger}`;
  if (value) return `${e.timestampRaw} – ${value}`;
  return `${e.timestampRaw}`;
}

function splitTimestamp(value: string): { date: string; time: string } {
  const v = value.trim();
  if (!v) return { date: "", time: "" };

  const parts = v.split(" ");
  if (parts.length >= 2) return { date: parts[0], time: parts[1] };
  return { date: v, time: "" };
}

function timestampToMs(rawTimestamp: string): number {
  const raw = rawTimestamp.trim();
  if (!raw) return Number.NaN;

  const isoLike = raw.replace(" ", "T");
  const direct = new Date(isoLike);
  if (!Number.isNaN(direct.getTime())) return direct.getTime();

  const { date, time } = splitTimestamp(raw);
  const isoDate = toDateIso(date);
  if (!isoDate) return Number.NaN;

  const normalizedTime = (time || "").trim();
  const hm = normalizedTime.split(":");
  const hh = (hm[0] ?? "").padStart(2, "0");
  const mm = (hm[1] ?? "").padStart(2, "0");
  const composed = `${isoDate}T${hh}:${mm}:00`;
  const composedDate = new Date(composed);
  if (!Number.isNaN(composedDate.getTime())) return composedDate.getTime();

  return Number.NaN;
}

function formatTimestampDiffLines(prevRaw: string, nextRaw: string): string[] {
  const a = timestampToMs(prevRaw);
  const b = timestampToMs(nextRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];

  const diffMs = Math.max(0, b - a);
  const totalMinutes = Math.round(diffMs / 60000);

  const lines: string[] = [];
  const hourLabel = (n: number) => (n === 1 ? "ora" : "ore");
  const minuteLabel = (n: number) => (n === 1 ? "minuto" : "min");
  const dayLabel = (n: number) => (n === 1 ? "giorno" : "giorni");

  if (totalMinutes === 0) return ["0 minuti"];

  if (totalMinutes > 24 * 60) {
    const days = Math.floor(totalMinutes / (24 * 60));
    const remMinutes = totalMinutes - days * 24 * 60;
    const hours = Math.floor(remMinutes / 60);
    const minutes = remMinutes % 60;

    if (days > 0) lines.push(`${days} ${dayLabel(days)}`);
    if (hours > 0) lines.push(`${hours} ${hourLabel(hours)}`);
    if (minutes > 0) lines.push(`${minutes} ${minuteLabel(minutes)}`);
    return lines;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) lines.push(`${hours} ${hourLabel(hours)}`);
  if (minutes > 0) lines.push(`${minutes} ${minuteLabel(minutes)}`);
  return lines;
}

function formatShortDateTimeLabel(date: string, time: string): string {
  const d = (date || "").trim();
  const t = (time || "").trim();

  const months = [
    "Gen",
    "Feb",
    "Mar",
    "Apr",
    "Mag",
    "Giu",
    "Lug",
    "Ago",
    "Set",
    "Ott",
    "Nov",
    "Dic"
  ];

  let day = "";
  let monthIndex: number | null = null;

  if (d.includes("-")) {
    const parts = d.split("-");
    if (parts.length === 3) {
      const mm = parts[1];
      const dd = parts[2];
      if (dd) day = dd;
      const parsed = Number(mm);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) monthIndex = parsed - 1;
    }
  } else if (d.includes("/")) {
    const parts = d.split("/");
    if (parts.length === 3) {
      const dd = parts[0];
      const mm = parts[1];
      if (dd) day = dd;
      const parsed = Number(mm);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) monthIndex = parsed - 1;
    }
  }

  const dd = day ? day.replace(/^0+/, "") : "";
  const mon = monthIndex != null ? months[monthIndex].toUpperCase() : "";
  const shortDate = dd && mon ? `${dd} ${mon}` : d;

  let shortTime = t;
  if (t.includes(":")) {
    const hm = t.split(":");
    if (hm.length >= 2) shortTime = `${hm[0]}:${hm[1]}`;
  }

  if (!shortDate) return shortTime;
  if (!shortTime) return shortDate;
  return `${shortDate} ${shortTime}`;
}

function formatAvailableFromLabel(rawTimestamp: string): string {
  const raw = (rawTimestamp || "").trim();
  if (!raw) return "";

  const { date } = splitTimestamp(raw);
  const iso = toDateIso(date || raw);
  if (!iso) return "";

  const parts = iso.split("-");
  if (parts.length !== 3) return "";

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";

  const months = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre"
  ];

  const mon = months[month - 1];
  if (!mon) return "";
  return `disponibilità dati a partire dal ${day} ${mon} ${year}`;
}

function getEventIconKind(
  trigger: string,
  value: string
): "person" | "phone" | "phoneOff" | "status" | "dispatch" | "target" | "dot" {
  const t = trigger.trim().toLowerCase();
  const v = value.trim().toLowerCase();
  if (!t) return "dot";
  if (t.includes("proprietario")) return "person";
  if (t.includes("chiamata")) return v === "connesso" ? "phone" : "phoneOff";
  if (t.includes("dispatch outcome") || t.includes("dispatch")) return "dispatch";
  if (t.includes("appuntamento")) return "target";
  if (t.includes("stato lead")) return "status";
  return "dot";
}

function EventIcon({
  kind
}: {
  kind: "person" | "phone" | "phoneOff" | "status" | "dispatch" | "target" | "dot";
}) {
  if (kind === "person") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="7" r="3" />
        <path d="M4 22c1.6-4.5 5-7 8-7s6.4 2.5 8 7" />
      </g>
    );
  }

  if (kind === "phone") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4h3l2 6-2 1c1.5 3 3.5 5 6.5 6.5l1-2 6 2v3c0 1-1 2-2 2-9.4 0-17-7.6-17-17 0-1 1-2 2-2Z" />
      </g>
    );
  }

  if (kind === "phoneOff") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4h3l2 6-2 1c1.5 3 3.5 5 6.5 6.5l1-2 6 2v3c0 1-1 2-2 2-9.4 0-17-7.6-17-17 0-1 1-2 2-2Z" />
        <path d="M3 21L21 3" strokeWidth="2.5" />
      </g>
    );
  }

  if (kind === "status") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 21V4" />
        <path d="M6 5L20 9Q16 10 20 11L6 15Z" />
      </g>
    );
  }

  if (kind === "dispatch") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="1.73" strokeLinecap="round" strokeLinejoin="round">
        <g transform="translate(12 12) rotate(90) scale(1.15) translate(-12 -12)">
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="7" r="2" />
          <circle cx="18" cy="17" r="2" />
          <path d="M8 12h4" />
          <path d="M12 12V7" />
          <path d="M12 12V17" />
          <path d="M12 7h4" />
          <path d="M12 17h4" />
        </g>
      </g>
    );
  }

  if (kind === "target") {
    return (
      <g fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.6 12.4l3.4 3.4L17.6 8.2" stroke="#ffffff" strokeWidth="5" />
        <path d="M6.6 12.4l3.4 3.4L17.6 8.2" stroke="#f97316" strokeWidth="2.6" />
      </g>
    );
  }

  return <circle cx="12" cy="12" r="2" fill="#ffffff" />;
}

export default function ContactEventsTimeline({
  rows
}: {
  rows: CsvRow[];
}) {
  const [contactName, setContactName] = useState("");
  const [selectedContactName, setSelectedContactName] = useState<string | null>(null);
  const debouncedName = useDebouncedValue(contactName, 280);
  const isNameActive = Boolean(contactName.trim());
  const timelineWrapRef = useRef<HTMLDivElement | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [openDiffKey, setOpenDiffKey] = useState<string | null>(null);

  const indexed = useMemo(() => {
    const byName = new Map<string, TimelineEvent[]>();
    const rawByNorm = new Map<string, string>();

    for (const r of rows) {
      const rawName = getStringByHeaderLoose(r, "Nome Contatto").trim();
      if (!rawName) continue;
      const norm = normalizeNameValue(rawName);

      if (!rawByNorm.has(norm)) rawByNorm.set(norm, rawName);

      const ts = getStringByHeaderLoose(r, "Timestamp");
      const e: TimelineEvent = {
        timestampRaw: ts,
        tsKey: normalizeTsKey(ts),
        trigger: getStringByHeaderLoose(r, "Trigger"),
        value: getStringByHeaderLoose(r, "Valore Attuale"),
        countdown: getStringByHeaderLoose(r, "Countdown")
      };

      const arr = byName.get(norm);
      if (arr) arr.push(e);
      else byName.set(norm, [e]);
    }

    for (const arr of byName.values()) {
      arr.sort((a, b) => a.tsKey.localeCompare(b.tsKey));
    }

    const names = Array.from(rawByNorm.entries())
      .map(([norm, raw]) => ({ norm, raw }))
      .sort((a, b) => a.raw.localeCompare(b.raw));

    return { byName, names };
  }, [rows]);

  const validNameSet = useMemo(() => {
    return new Set(indexed.names.map((n) => n.raw));
  }, [indexed.names]);

  const suggestions = useMemo(() => {
    const q = normalizeNameValue(debouncedName);
    if (!shouldEnableSearch(q)) return [] as string[];
    if (!q) return [] as string[];
    const out: string[] = [];
    for (const n of indexed.names) {
      if (n.norm.includes(q)) out.push(n.raw);
      if (out.length >= 12) break;
    }
    return out;
  }, [debouncedName, indexed.names]);

  const minTimestampRaw = useMemo(() => {
    let minIso = "";
    let minRaw = "";
    for (const r of rows) {
      const raw = getStringByHeaderLoose(r, "Timestamp");
      const iso = toDateIso(raw);
      if (!iso) continue;
      if (!minIso || iso < minIso) {
        minIso = iso;
        minRaw = raw;
      }
    }
    return minRaw;
  }, [rows]);

  const availableFromLabel = useMemo(() => {
    return formatAvailableFromLabel(minTimestampRaw);
  }, [minTimestampRaw]);

  const events = useMemo(() => {
    if (!selectedContactName) return [] as TimelineEvent[];

    const name = normalizeNameValue(selectedContactName);
    if (!name) return [] as TimelineEvent[];

    const matchedNames: string[] = [];
    for (const n of indexed.names) {
      if (n.norm.includes(name)) matchedNames.push(n.norm);
      if (matchedNames.length >= 10) break;
    }

    if (matchedNames.length === 0) return [] as TimelineEvent[];

    const out: TimelineEvent[] = [];
    for (const norm of matchedNames) {
      const arr = indexed.byName.get(norm);
      if (!arr) continue;
      out.push(...arr);
      if (out.length >= 250) break;
    }

    out.sort((a, b) => a.tsKey.localeCompare(b.tsKey));
    return out.slice(0, 250);
  }, [indexed.byName, indexed.names, selectedContactName]);

  const timeline = useMemo(() => {
    const n = events.length;
    if (n === 0) return { points: [] as Array<{ e: TimelineEvent; x: number }> };

    if (n === 1) return { points: [{ e: events[0], x: 0.5 }] };

    return {
      points: events.map((e, i) => ({
        e,
        x: i / (n - 1)
      }))
    };
  }, [events]);

  return (
    <div className="flex flex-col">
      <div className="mt-4 flex flex-col gap-6">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-full sm:w-[264px]">
                <input
                  value={contactName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setContactName(next);
                    setSelectedContactName(validNameSet.has(next) ? next : null);
                  }}
                  placeholder="Nome Contatto"
                  list="contact-names"
                  className={`w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none transition ${
                    isNameActive
                      ? "border-slate-700 bg-black text-white placeholder:text-white/60 focus:border-slate-200 focus:ring-2 focus:ring-slate-200/20"
                      : "border-slate-200 bg-white text-slate-900 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                  }`}
                />
                <datalist id="contact-names">
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
            </div>
            {availableFromLabel ? (
              <div className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
                {availableFromLabel}
              </div>
            ) : null}
          </div>

          <div className="mt-6 min-h-0 overflow-auto">
            {selectedContactName && events.length === 0 ? (
              <div className="p-3 text-sm text-slate-600">Nessun evento per il contatto selezionato.</div>
            ) : !selectedContactName ? (
              <div className="p-3 text-sm text-slate-600">nessun evento da visualizzare</div>
            ) : (
              <div>
                <div className="divide-y divide-slate-100">
                  {events.map((e, idx) => {
                    const rowKey = `${e.tsKey}-${idx}`;
                    const isRowHighlighted = hoveredKey === rowKey;
                    return (
                      <div
                        key={`${e.tsKey}-${idx}`}
                        className={`grid grid-cols-4 gap-x-3 px-3 py-2 text-sm text-slate-800 transition-colors ${
                          isRowHighlighted ? "bg-orange-50" : ""
                        }`}
                      >
                        <div className="whitespace-nowrap text-slate-700">{e.timestampRaw}</div>
                        <div className="truncate" title={e.trigger}>
                          {e.trigger}
                        </div>
                        <div className="truncate" title={e.value}>
                          {e.value}
                        </div>
                        <div className="truncate" title={e.countdown}>
                          {e.countdown ? `Countdown ${e.countdown}` : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div ref={timelineWrapRef} className="relative h-[240px] w-full">
            <svg viewBox="0 0 1000 240" className="h-full w-full overflow-visible">
              <defs>
                <filter id="timelineDotShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="1.6" floodColor="#000000" floodOpacity="0.35" />
                </filter>
                <filter id="timelineDotShadowHover" x="-25%" y="-25%" width="150%" height="150%">
                  <feDropShadow dx="0" dy="6" stdDeviation="2.2" floodColor="#000000" floodOpacity="0.45" />
                </filter>
              </defs>
              {(() => {
                const pad = 60;
                const x1 = pad;
                const x2 = 1000 - pad;
                return (
                  <line
                    x1={x1}
                    y1={120}
                    x2={x2}
                    y2={120}
                    stroke="#cbd5e1"
                    strokeWidth="2"
                    strokeDasharray="6 6"
                  />
                );
              })()}

              {timeline.points.map((p, idx) => {
                const pad = 60;
                const cx = pad + p.x * (1000 - pad * 2);
                const ts = splitTimestamp(p.e.timestampRaw);
                const trigger = p.e.trigger.trim();
                const value = p.e.value.trim();
                const iconKind = getEventIconKind(trigger, value);
                const valueLabel = value;
                const dateTimeLabel = formatShortDateTimeLabel(ts.date, ts.time);
                const pointKey = `${p.e.tsKey}-${idx}`;
                const isHovered = hoveredKey === pointKey;
                const prev = idx > 0 ? timeline.points[idx - 1] : null;
                const prevCx = prev ? pad + prev.x * (1000 - pad * 2) : null;
                const diffLines =
                  prev && prevCx != null ? formatTimestampDiffLines(prev.e.timestampRaw, p.e.timestampRaw) : [];
                const diffX = prevCx != null ? (prevCx + cx) / 2 : cx;
                const diffKey = `${pointKey}-diff`;
                const isDiffOpen = openDiffKey === diffKey;
                return (
                  <g
                    key={pointKey}
                    onMouseEnter={() => setHoveredKey(pointKey)}
                    onMouseLeave={() => setHoveredKey(null)}
                    style={{ cursor: "default" }}
                  >
                    {diffLines.length > 0 ? (
                      <g>
                        <circle
                          cx={diffX}
                          cy={120}
                          r={isDiffOpen ? 7 : 5}
                          fill={isDiffOpen ? "#94a3b8" : "#cbd5e1"}
                          onClick={() => setOpenDiffKey((cur) => (cur === diffKey ? null : diffKey))}
                          style={{ cursor: "pointer", transition: "all 120ms ease" }}
                        />
                        {isDiffOpen
                          ? (() => {
                              const fontSize = 12;
                              const padX = 6;
                              const padY = 4;
                              const approxCharWidth = 6.2;
                              const lineStep = 14;
                              const longest = diffLines.reduce((acc, s) => Math.max(acc, s.length), 0);
                              const textWidth = longest * approxCharWidth;
                              const rectW = textWidth + padX * 2;
                              const rectH =
                                diffLines.length * fontSize + (diffLines.length - 1) * (lineStep - fontSize) + padY * 2;
                              const y = 120;
                              const firstLineY = y - ((diffLines.length - 1) * lineStep) / 2;
                              return (
                                <g style={{ pointerEvents: "none" }}>
                                  <rect
                                    x={diffX - rectW / 2}
                                    y={y - rectH / 2}
                                    width={rectW}
                                    height={rectH}
                                    rx={6}
                                    fill="#ffffff"
                                  />
                                  <text
                                    x={diffX}
                                    y={firstLineY}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fontSize={fontSize}
                                    fill="#0f172a"
                                  >
                                    {diffLines.map((line, lineIdx) => (
                                      <tspan key={lineIdx} x={diffX} y={firstLineY + lineIdx * lineStep}>
                                        {line}
                                      </tspan>
                                    ))}
                                  </text>
                                </g>
                              );
                            })()
                          : null}
                      </g>
                    ) : null}
                    {dateTimeLabel ? (
                      <text
                        x={cx}
                        y={28}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={12}
                        fill="#0f172a"
                        style={{ pointerEvents: "none" }}
                      >
                        {dateTimeLabel}
                      </text>
                    ) : null}
                    <g
                      transform={`translate(${cx}, ${120}) scale(${isHovered ? 1.08 : 1}) translate(${-cx}, ${-120})`}
                      style={{ transition: "transform 140ms ease" }}
                    >
                      <circle
                        cx={cx}
                        cy={120}
                        r={24}
                        fill="#f97316"
                        filter={isHovered ? "url(#timelineDotShadowHover)" : "url(#timelineDotShadow)"}
                      />
                      <g
                        transform={`translate(${cx}, ${120}) scale(${iconKind === "phone" || iconKind === "phoneOff" ? 0.72 : iconKind === "person" ? 0.88 : iconKind === "target" ? 1.25 : iconKind === "dispatch" ? 0.88 : iconKind === "status" ? 0.88 : 0.8}) translate(-12, -12)`}
                      >
                        <EventIcon kind={iconKind} />
                      </g>
                    </g>
                    {value ? (
                      <text
                        x={cx}
                        y={212}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={12}
                        fill="#0f172a"
                        style={{ pointerEvents: "none" }}
                      >
                        {valueLabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        </Card>
      </div>
    </div>
  );
}
