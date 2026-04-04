import { fetchCsv } from "@/lib/csv";
import { uniqueValues } from "@/lib/metrics";
import CampaignsDashboard from "@/components/client/CampaignsDashboard";
import Container from "@/components/ui/Container";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const HUBSPOT_USERS_SHEET_ID = "1XKvzK20x9DkIyJVHBNTYUHxV21kmrdWH0AshNkkgLHQ";
const GID_OPERATORI = "245526930";
const GID_DISPATCH = "169448955";
const GID_OPERATORI_OGGI = "2032731939";
const GID_DISPATCH_OGGI = "1181380498";
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
  const [operatoriRows, dispatchRows, operatoriRowsOggi, dispatchRowsOggi] = await Promise.all([
    fetchCsv(sheetCsvUrl(GID_OPERATORI)),
    fetchCsv(sheetCsvUrl(GID_DISPATCH)),
    fetchCsv(sheetCsvUrl(GID_OPERATORI_OGGI)),
    fetchCsv(sheetCsvUrl(GID_DISPATCH_OGGI))
  ]);

  let allowedOperatorSet: Set<string> | null = null;
  try {
    const hubspotUsersRows = await fetchCsv(
      `https://docs.google.com/spreadsheets/d/${HUBSPOT_USERS_SHEET_ID}/export?format=csv&gid=${GID_HUBSPOT_USERS}`
    );

    const allowedTeams = new Set(["advisor", "setter"]);
    allowedOperatorSet = new Set(
      hubspotUsersRows
        .filter((r) => allowedTeams.has(normalizeName((r["Team Principale"] ?? "").toString())))
        .map((r) => normalizeName((r["User"] ?? "").toString()))
        .filter((name) => name)
    );
  } catch {
    allowedOperatorSet = null;
  }

  const operatoriRowsFiltered = allowedOperatorSet
    ? operatoriRows.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : operatoriRows;
  const dispatchRowsFiltered = allowedOperatorSet
    ? dispatchRows.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : dispatchRows;

  const operatoriRowsOggiFiltered = allowedOperatorSet
    ? operatoriRowsOggi.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : operatoriRowsOggi;
  const dispatchRowsOggiFiltered = allowedOperatorSet
    ? dispatchRowsOggi.filter((r) => allowedOperatorSet!.has(normalizeName((r["Operatore"] ?? "").toString())))
    : dispatchRowsOggi;

  const operators = uniqueValues(operatoriRowsFiltered, "Operatore");
  const campaigns = uniqueValues(operatoriRowsFiltered, "Campagna");

  return (
    <Container>
      <CampaignsDashboard
        operatoriRows={operatoriRowsFiltered}
        dispatchRows={dispatchRowsFiltered}
        operatoriRowsOggi={operatoriRowsOggiFiltered}
        dispatchRowsOggi={dispatchRowsOggiFiltered}
        operators={operators}
        campaigns={campaigns}
      />
    </Container>
  );
}
