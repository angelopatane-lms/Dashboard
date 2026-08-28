import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import AdvisorSetterDashboardClient from "@/components/client/AdvisorSetterDashboardClient";
import Container from "@/components/ui/Container";

export const dynamic = "force-dynamic";

function romeOffsetMinutes(at: Date): number {
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    timeZoneName: "shortOffset"
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;

  const m = (tzPart ?? "").match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  return sign * (hh * 60 + mm);
}

function secondsUntilNextRome1930(nowUtc: Date = new Date()): number {
  const nowUtcMs = nowUtc.getTime();
  const offsetNowMin = romeOffsetMinutes(nowUtc);
  const nowRome = new Date(nowUtcMs + offsetNowMin * 60_000);

  const targetRome = new Date(
    nowRome.getFullYear(),
    nowRome.getMonth(),
    nowRome.getDate(),
    19,
    30,
    0,
    0
  );

  if (nowRome.getTime() >= targetRome.getTime()) targetRome.setDate(targetRome.getDate() + 1);

  const targetUtcGuessMs = targetRome.getTime() - offsetNowMin * 60_000;
  const offsetTargetMin = romeOffsetMinutes(new Date(targetUtcGuessMs));
  const targetUtcMs = targetRome.getTime() - offsetTargetMin * 60_000;

  const seconds = Math.floor((targetUtcMs - nowUtcMs) / 1000);
  return Math.max(60, seconds);
}

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const HUBSPOT_USERS_SHEET_ID = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_OPERATORI = "245526930";
const GID_OPERATORI_OGGI = "2032731939";
const GID_TRACKING_EVENTI = "2095098073";
const GID_HUBSPOT_USERS = "0";

function sheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("'", "'")
    .replaceAll("’", "'")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export default async function Page() {
  const [operatoriRows, operatoriRowsOggi, trackingEventiRows] =
    await Promise.all([
      fetchCsv(sheetCsvUrl(GID_OPERATORI)),
      fetchCsv(sheetCsvUrl(GID_OPERATORI_OGGI)),
      fetchCsv(sheetCsvUrl(GID_TRACKING_EVENTI))
    ]);

  let allowedOperatorSet: Set<string> | null = null;
  let hubspotIdToName: Record<string, string> = {};
  try {
    const hubspotUsersRows = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${HUBSPOT_USERS_SHEET_ID}/export?format=csv&gid=${GID_HUBSPOT_USERS}`,
      { next: { revalidate: secondsUntilNextRome1930() } }
    );

    const allowedTeams = new Set(["advisor"]);
    allowedOperatorSet = new Set(
      hubspotUsersRows
        .filter((r) => allowedTeams.has(normalizeName((r["Team Principale"] ?? "").toString())))
        .map((r) => normalizeName((r["User"] ?? "").toString()))
        .filter((name) => name)
    );

    for (const r of hubspotUsersRows) {
      const id = (r["ID Hubspot"] ?? "").trim();
      const name = (r["User"] ?? "").trim();
      if (id && name) hubspotIdToName[id] = name;
    }
  } catch {
    allowedOperatorSet = null;
  }

  const operatoriRowsFiltered = allowedOperatorSet
    ? operatoriRows.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : operatoriRows;
  const operatoriRowsOggiFiltered = allowedOperatorSet
    ? operatoriRowsOggi.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : operatoriRowsOggi;

  const operators = uniqueValues(operatoriRowsFiltered, "Operatore");
  const campaigns = uniqueValues(operatoriRowsFiltered, "Campagna");

  return (
    <Container>
      <AdvisorSetterDashboardClient
        operatoriRows={operatoriRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        trackingEventiRows={trackingEventiRows}
        operators={operators}
        campaigns={campaigns}
        operatorLabel="Advisor"
        hubspotIdToName={hubspotIdToName}
      />
    </Container>
  );
}
