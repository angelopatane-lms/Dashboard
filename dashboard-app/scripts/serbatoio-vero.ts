/**
 * Quanti lead del serbatoio sopravvivono DAVVERO alle regole dell'app, e
 * quale regola ne butta via quanti.
 *
 * COME SI LANCIA
 *   npx tsx scripts/serbatoio-vero.ts            serie A e B
 *   npx tsx scripts/serbatoio-vero.ts serie_a    una sola
 *
 * PERCHE'. La pagina dichiara gli "assegnabili" contando chi passa i cinque
 * filtri della RICERCA (dispatch_outcome, proprietario assente, countdown
 * assente, campagna presente, telefono presente, piu' la data). Ma l'app,
 * dopo la ricerca, scarta in Python: campagne sospese, stati non pescabili,
 * lifecycle, provenienza, webinar in corso. Il numero in pagina e' quindi un
 * tetto, non la disponibilita', e nessuno sapeva di quanto.
 *
 * SI PAGINA CON PAZIENZA. Il 27 ottobre 2026 una prova fatta chiamando l'app
 * ha dato 3, 3, 13, 13 lead per la stessa serie: erano i punti in cui la
 * scansione sbatteva sul 429 e si fermava, perche' `_cerca_lead` fa `break` su
 * qualunque risposta diversa da 200. Qui si aspetta e si riprova, altrimenti
 * si misura il limite di HubSpot invece del serbatoio.
 *
 * QUELLO CHE NON SI PUO' APPLICARE: la regola "solo i partecipanti" e le
 * eccezioni webinar vivono in `app_settings`, nel database dell'app, che da
 * qui non si raggiunge. Quindi il numero finale e' un TETTO SUPERIORE: il
 * vero e' uguale o piu' basso. Lo dice anche in fondo, per non far credere
 * che sia esatto.
 */
import "./env";

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const GIORNI_MAX = 30;
const SERIE = process.argv[2] ? [process.argv[2]] : ["serie_a", "serie_b"];

/** Gli stati che l'app non pesca, e le etichette del campo "precedente". */
const STATI_NO = new Set(["No Show", "numero_errato", "Errore", "BIN"]);
const PRECEDENTI_NO = new Set(["bin", "numero errato", "numero_errato", "no show", "errore"]);
const LIFECYCLE_NO = new Set(["customer", "evangelist"]);

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Le campagne sospese le dichiara l'app nella sua pagina di stato. */
async function campagneSospese(): Promise<Set<string>> {
  const r = await fetch("https://lms.217.154.117.118.nip.io/dispatch-api/assegnazione-stato",
    { headers: { Authorization: `Bearer ${process.env.LMS_ASSEGNAZIONI_TOKEN}` } });
  const d = await r.json();
  if (!d.campagne_sospese_attivo) return new Set();
  return new Set(String(d.campagne_sospese || "").split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean));
}

async function cerca(corpo: unknown): Promise<{ results: Array<{ id: string; properties: Record<string, string> }>; after?: string }> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search",
      { method: "POST", headers: H, body: JSON.stringify(corpo) });
    if (r.status === 429) { await pausa(5000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return { results: d.results ?? [], after: d.paging?.next?.after };
  }
  throw new Error("429 ripetuti");
}

(async () => {
  const sospese = await campagneSospese();
  console.log(`\ncampagne sospese in vigore: ${sospese.size}`);
  const da = String(Date.now() - GIORNI_MAX * 864e5);

  for (const serie of SERIE) {
    const comuni = [
      { propertyName: "dispatch_outcome", operator: "EQ", value: serie },
      { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
      { propertyName: "countdown", operator: "NOT_HAS_PROPERTY" },
      { propertyName: "id_campagna_refresh", operator: "HAS_PROPERTY" },
      { propertyName: "phone", operator: "HAS_PROPERTY" },
    ];
    const scarti = new Map<string, number>();
    const butta = (perche: string) => scarti.set(perche, (scarti.get(perche) ?? 0) + 1);

    let letti = 0, buoni = 0, after: string | undefined;
    const visti = new Set<string>();
    do {
      const { results, after: prossimo } = await cerca({
        filterGroups: [{ filters: [...comuni, { propertyName: "recent_conversion_date", operator: "GTE", value: da }] }],
        properties: ["id_campagna_refresh", "storico_campagna_refresh", "hs_lead_status",
          "stato_lead_precedente", "lifecyclestage", "provenienza_contatto", "data_fine_webinar"],
        sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
        limit: 100, ...(after ? { after } : {}),
      });
      for (const c of results) {
        if (visti.has(c.id)) continue;
        visti.add(c.id);
        letti++;
        const p = c.properties;
        const campagna = (p.id_campagna_refresh || "").toLowerCase();
        if (sospese.has(campagna)) { butta("campagna sospesa"); continue; }
        if (STATI_NO.has((p.hs_lead_status || "").trim())) { butta("stato non pescabile"); continue; }
        if (PRECEDENTI_NO.has((p.stato_lead_precedente || "").trim().toLowerCase())) { butta("era BIN prima dello svuotamento"); continue; }
        if (LIFECYCLE_NO.has((p.lifecyclestage || "").trim().toLowerCase())) { butta("e' gia' cliente"); continue; }
        if ((p.provenienza_contatto || "") === "NR +11 Volte") { butta("NR +11 volte"); continue; }
        // Webinar non ancora finito: l'app lo lascia stare.
        const fine = Number(p.data_fine_webinar || 0);
        if (fine && fine > Date.now()) { butta("webinar ancora in corso"); continue; }
        buoni++;
      }
      after = prossimo;
      await pausa(400);
    } while (after && letti < 20000);

    console.log(`\n${serie.toUpperCase()}: letti ${letti} dalla ricerca`);
    for (const [perche, n] of [...scarti.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`   -${String(n).padStart(6)}  ${perche}`);
    console.log(`   =${String(buoni).padStart(6)}  RESTANO ASSEGNABILI  (${(buoni / Math.max(letti, 1) * 100).toFixed(1)}%)`);
  }

  console.log("\nE' un TETTO SUPERIORE: la regola \"solo i partecipanti\" e le eccezioni");
  console.log("webinar vivono nel database dell'app e da qui non si applicano.");
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
