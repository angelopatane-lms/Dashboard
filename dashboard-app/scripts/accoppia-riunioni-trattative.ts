// SOLA LETTURA: in un giorno, quante riunioni hanno una trattativa e quante
// trattative hanno una riunione. Serve a sapere se il legame e' davvero uno a
// uno - cioe' se l'automazione crea una trattativa per ogni riunione - o se i
// due insiemi si sovrappongono solo in parte.
//
//   npx tsx scripts/accoppia-riunioni-trattative.ts 2026-11-14
import "./env";
import { PIPELINE_HT } from "../src/lib/report/giornaliero";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const giorno = process.argv[2] ?? new Date().toISOString().slice(0, 10);

const istanteRoma = (g: string) => {
  const presunto = Date.parse(`${g}T00:00:00Z`);
  const letto = Date.parse(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Rome",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date(presunto)).replace(" ", "T") + "Z"
  );
  return presunto + (presunto - letto);
};
const oraDi = (v: string) => {
  if (!v) return "--:--";
  const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return new Date(ms).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
};

async function cerca(oggetto: string, corpo: Record<string, unknown>) {
  const fuori: Array<{ id: string; properties: Record<string, string> }> = [];
  let after: string | undefined;
  do {
    const res = await fetch(`${API}/crm/v3/objects/${oggetto}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpo, limit: 100, ...(after ? { after } : {}) })
    });
    const d = await res.json();
    if (d.status === "error") throw new Error(d.message);
    for (const r of d.results ?? []) fuori.push({ id: String(r.id), properties: r.properties ?? {} });
    after = d.paging?.next?.after;
  } while (after);
  return fuori;
}

/** Le associazioni di tanti oggetti in una volta sola. */
async function legami(da: string, a: string, ids: string[]) {
  const fuori = new Map<string, string[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const res = await fetch(`${API}/crm/v4/associations/${da}/${a}/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: ids.slice(i, i + 100).map((id) => ({ id })) })
    });
    const d = await res.json();
    for (const r of d.results ?? []) {
      fuori.set(String(r.from?.id), (r.to ?? []).map((x: { toObjectId: number }) => String(x.toObjectId)));
    }
  }
  return fuori;
}

(async () => {
  const dalle = istanteRoma(giorno);
  const alle = dalle + 86400000;

  const riunioni = await cerca("meetings", {
    filterGroups: [{
      filters: [
        { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
        { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
      ]
    }],
    properties: ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hubspot_owner_id"]
  });

  const trattative = await cerca("deals", {
    filterGroups: [
      {
        filters: [
          { propertyName: "data_e_ora_appuntamento", operator: "GTE", value: String(dalle) },
          { propertyName: "data_e_ora_appuntamento", operator: "LT", value: String(alle) },
          { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT }
        ]
      },
      {
        filters: [
          { propertyName: "data_appuntamento", operator: "GTE", value: String(dalle) },
          { propertyName: "data_appuntamento", operator: "LT", value: String(alle) },
          { propertyName: "pipeline", operator: "EQ", value: PIPELINE_HT }
        ]
      }
    ],
    properties: ["dealname", "id_fase", "hubspot_owner_id", "data_e_ora_appuntamento", "data_appuntamento"]
  });

  const daRiunione = await legami("meetings", "deals", riunioni.map((r) => r.id));
  const daTrattativa = await legami("deals", "meetings", trattative.map((t) => t.id));

  const riunioniSenza = riunioni.filter((r) => !(daRiunione.get(r.id) ?? []).length);
  const trattativeSenza = trattative.filter((t) => !(daTrattativa.get(t.id) ?? []).length);

  console.log(`\nIL ${giorno}`);
  console.log(`  riunioni ........................ ${riunioni.length}`);
  console.log(`     di cui senza trattativa ...... ${riunioniSenza.length}`);
  console.log(`  trattative con appuntamento ..... ${trattative.length}`);
  console.log(`     di cui senza riunione ........ ${trattativeSenza.length}`);

  // Quante trattative porta una riunione, e viceversa: se fosse uno a uno,
  // qui si leggerebbe solo "1".
  const perRiunione = new Map<number, number>();
  for (const r of riunioni) {
    const n = (daRiunione.get(r.id) ?? []).length;
    perRiunione.set(n, (perRiunione.get(n) ?? 0) + 1);
  }
  const perTrattativa = new Map<number, number>();
  for (const t of trattative) {
    const n = (daTrattativa.get(t.id) ?? []).length;
    perTrattativa.set(n, (perTrattativa.get(n) ?? 0) + 1);
  }
  console.log(`\n  trattative per riunione: ${[...perRiunione.entries()].sort().map(([n, q]) => `${q} riunioni con ${n}`).join(", ")}`);
  console.log(`  riunioni per trattativa: ${[...perTrattativa.entries()].sort().map(([n, q]) => `${q} trattative con ${n}`).join(", ")}`);

  if (riunioniSenza.length) {
    console.log("\n  RIUNIONI SENZA TRATTATIVA:");
    for (const r of riunioniSenza) {
      console.log(`    ${oraDi(r.properties.hs_meeting_start_time)}  ${(r.properties.hs_meeting_title ?? "").slice(0, 52)}`);
    }
  }
  if (trattativeSenza.length) {
    console.log("\n  TRATTATIVE SENZA RIUNIONE:");
    for (const t of trattativeSenza) {
      const q = (t.properties.data_e_ora_appuntamento ?? "").trim() || (t.properties.data_appuntamento ?? "").trim();
      console.log(`    ${oraDi(q)}  ${String(t.properties.id_fase ?? "-").padEnd(13)} ${(t.properties.dealname ?? "").slice(0, 46)}`);
    }
  }
  process.exit(0);
})();
