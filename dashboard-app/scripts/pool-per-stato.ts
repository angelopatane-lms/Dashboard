import "./env";
const T = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const da = new Date(Date.now() - 30 * 864e5).toISOString();
const STATI = ["NEW", "NOT_ANSWERED", "Semina Follow up", "Appuntamento fissato", "in Trattative",
  "Cliente", "numero_errato", "BIN", "Già contattato", "Interesse futuro", "Da Richiamare",
  "No Show", "Errore", "Da Definire", "Chatter", "Semina Follow Up (Post Consulenza)",
  "Interazione Rilevata", "Persa in Chamata", "Riconvertito", "Webinar",
  "Proc. Persa (Eventi)", "Proc. Chiusa (Eventi)"];

async function quanti(filtri: any[]): Promise<number> {
  for (let i = 0; i < 6; i++) {
    await pausa(700);
    const r = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST", headers: { Authorization: `Bearer ${T}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filterGroups: [{ filters: filtri }], limit: 1 }),
    });
    if (r.status === 429) { await pausa(3000); continue; }
    if (!r.ok) throw new Error(`HubSpot ${r.status}`);
    return (await r.json()).total as number;
  }
  throw new Error("429 ripetuti");
}
const base = [
  { propertyName: "hubspot_owner_id", operator: "NOT_HAS_PROPERTY" },
  { propertyName: "phone", operator: "HAS_PROPERTY" },
  { propertyName: "recent_conversion_date", operator: "GTE", value: da },
];
(async () => {
  const righe: [string, number][] = [];
  for (const s of STATI) righe.push([s, await quanti([...base, { propertyName: "hs_lead_status", operator: "EQ", value: s }])]);
  console.log("\nPESCABILI PER CONVERSIONE RECENTE (30 giorni), per Stato Lead\n");
  for (const [s, n] of righe.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(6)}   ${s}`);
  console.log(`  ${String(righe.reduce((t, [, n]) => t + n, 0)).padStart(6)}   TOTALE con uno stato`);
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e.message); process.exit(1); });
