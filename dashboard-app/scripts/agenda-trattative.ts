// SOLA LETTURA: le trattative che hanno l'appuntamento in un giorno, messe a
// confronto con le riunioni dello stesso giorno. Serve a decidere su quale dei
// due oggetti disegnare l'agenda delle squadre.
//
//   npx tsx scripts/agenda-trattative.ts 2026-11-14
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

const ora = (v: string) => {
  const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return new Date(ms).toLocaleString("it-IT", {
    timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit"
  });
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

(async () => {
  const dalle = istanteRoma(giorno);
  const alle = dalle + 86400000;

  // LE DUE DATE, come sempre: sono sfasate e nessuna delle due da sola copre
  // tutte le trattative. Due gruppi di filtri in OR.
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
    properties: [
      "dealname", "dealstage", "id_fase", "hubspot_owner_id", "setter",
      "data_e_ora_appuntamento", "data_appuntamento", "createdate"
    ]
  });

  const riunioni = await cerca("meetings", {
    filterGroups: [
      {
        filters: [
          { propertyName: "hs_meeting_start_time", operator: "GTE", value: String(dalle) },
          { propertyName: "hs_meeting_start_time", operator: "LT", value: String(alle) }
        ]
      }
    ],
    properties: ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hubspot_owner_id"]
  });

  console.log(`\nIL ${giorno}`);
  console.log(`  riunioni in calendario : ${riunioni.length}`);
  console.log(`  trattative con appuntamento (pipeline High Ticket): ${trattative.length}\n`);

  const nomi = new Map<string, string>();
  const res = await fetch(`${API}/crm/v3/owners?limit=500`, { headers: { Authorization: `Bearer ${token}` } });
  const o = await res.json();
  for (const x of o.results ?? []) {
    nomi.set(String(x.id), `${x.firstName ?? ""} ${x.lastName ?? ""}`.trim() || x.email);
  }

  const righe = trattative
    .map((t) => {
      const p = t.properties;
      const quando = (p.data_e_ora_appuntamento ?? "").trim() || (p.data_appuntamento ?? "").trim();
      return {
        id: t.id,
        quando,
        advisor: nomi.get(String(p.hubspot_owner_id ?? "")) ?? `(${p.hubspot_owner_id})`,
        fase: p.id_fase ?? p.dealstage ?? "-",
        nome: p.dealname ?? ""
      };
    })
    .sort((a, b) => a.quando.localeCompare(b.quando));

  for (const r of righe) {
    console.log(`  ${ora(r.quando)}  ${r.advisor.padEnd(22)} ${String(r.fase).padEnd(14)} ${r.nome.slice(0, 40)}`);
  }

  console.log(`\n  advisor con almeno una trattativa: ${new Set(righe.map((r) => r.advisor)).size}`);
  console.log(`  advisor con almeno una riunione  : ${new Set(riunioni.map((r) => r.properties.hubspot_owner_id)).size}`);
  process.exit(0);
})();
