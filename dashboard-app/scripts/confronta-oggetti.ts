// SOLA LETTURA: due o piu' oggetti HubSpot messi a confronto proprieta' per
// proprieta', per decidere se sono davvero doppioni o se uno porta lavoro che
// gli altri non hanno.
//
// LEGGE TUTTO LO SCHEMA, non un elenco scelto a mano: un doppione si giudica
// su quello che NON si era pensato di guardare - una nota, un importo, una
// fase spostata - e un elenco deciso prima e' esattamente il modo per non
// vederlo.
//
//   npx tsx scripts/confronta-oggetti.ts deals 541454438593 541295604943
//   npx tsx scripts/confronta-oggetti.ts meetings 544270803152 544252958953
import "./env";

const API = "https://api.hubapi.com";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const tipo = process.argv[2] ?? "deals";
const ids = process.argv.slice(3);

const leggibile = (v: string) => {
  if (/^\d{13}$/.test(v)) return `${v}  (${new Date(Number(v)).toLocaleString("it-IT", { timeZone: "Europe/Rome" })})`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return `${v}  (${new Date(v).toLocaleString("it-IT", { timeZone: "Europe/Rome" })})`;
  return v;
};

(async () => {
  if (ids.length < 2) {
    console.log("servono almeno due id");
    process.exit(1);
  }

  const sch = await fetch(`${API}/crm/v3/properties/${tipo}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const schema = await sch.json();
  const nomi: string[] = (schema.results ?? [])
    .filter((p: { calculated?: boolean; name: string }) => !p.calculated)
    .map((p: { name: string }) => p.name);
  console.log(`proprieta' nello schema di ${tipo}: ${nomi.length}`);

  const valori = new Map<string, Record<string, string>>();
  for (let i = 0; i < nomi.length; i += 100) {
    const res = await fetch(`${API}/crm/v3/objects/${tipo}/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: nomi.slice(i, i + 100), inputs: ids.map((id) => ({ id })) })
    });
    const d = await res.json();
    if (d.status === "error") {
      console.log("  blocco saltato:", d.message);
      continue;
    }
    for (const o of d.results ?? []) {
      const gia = valori.get(String(o.id)) ?? {};
      for (const [k, v] of Object.entries(o.properties ?? {})) {
        if (v !== null && v !== undefined && String(v) !== "") gia[k] = String(v);
      }
      valori.set(String(o.id), gia);
    }
  }

  // Le date di sistema cambiano sempre, anche fra due copie identiche: si
  // mostrano a parte, non come differenze di contenuto.
  const diSistema = new Set([
    "hs_object_id", "hs_createdate", "createdate", "hs_lastmodifieddate",
    "hs_time_in_lead", "notes_last_updated", "hs_object_source_detail_1",
    "hs_object_source_id", "hs_meeting_source_id", "hs_unique_creation_key",
    "hs_user_ids_of_all_owners", "hs_all_owner_ids", "hs_all_team_ids",
    "hs_all_accessible_team_ids", "hubspot_team_id"
  ]);

  const tutte = [...new Set(ids.flatMap((id) => Object.keys(valori.get(id) ?? {})))].sort();
  const diverse = tutte.filter((k) => {
    const v = ids.map((id) => (valori.get(id) ?? {})[k] ?? "");
    return new Set(v).size > 1;
  });

  console.log(`\nUGUALI su ${tutte.length} proprieta' valorizzate: ${tutte.length - diverse.length}`);
  console.log(`DIVERSE: ${diverse.length}\n`);

  for (const k of diverse) {
    console.log(`  ${k}${diSistema.has(k) ? "   [di sistema]" : ""}`);
    for (const id of ids) {
      const v = (valori.get(id) ?? {})[k] ?? "(vuoto)";
      console.log(`      ${id}  ${leggibile(v)}`);
    }
  }

  // Le associazioni dicono se a un oggetto e' stato appeso qualcosa: una nota,
  // una chiamata, una riunione. E' il modo piu' diretto per vedere se qualcuno
  // ci ha lavorato sopra.
  const legami = tipo === "deals"
    ? ["contacts", "meetings", "notes", "calls", "emails", "tasks"]
    : ["contacts", "deals", "notes"];
  console.log("\nASSOCIAZIONI");
  for (const id of ids) {
    const righe: string[] = [];
    for (const l of legami) {
      const r = await fetch(`${API}/crm/v4/objects/${tipo}/${id}/associations/${l}?limit=25`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const d = await r.json();
      const n = (d.results ?? []).length;
      if (n) righe.push(`${l}: ${(d.results ?? []).map((x: { toObjectId: number }) => x.toObjectId).join(", ")}`);
    }
    console.log(`  ${id}  ${righe.length ? righe.join(" | ") : "nessuna"}`);
  }
  process.exit(0);
})();
