import { fetchCsv } from "@/lib/csv";
import Container from "@/components/ui/Container";
import ContactEventsTimeline from "@/components/charts/ContactEventsTimeline";

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_TRACKING_EVENTI = "2095098073";

function sheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
}

export default async function Page() {
  const trackingEventiRows = await fetchCsv(sheetCsvUrl(GID_TRACKING_EVENTI));

  return (
    <Container>
      <div id="timeline-eventi" className="scroll-mt-6">
        <ContactEventsTimeline rows={trackingEventiRows} />
      </div>
    </Container>
  );
}
