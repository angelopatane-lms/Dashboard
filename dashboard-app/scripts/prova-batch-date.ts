import "./env";
const T = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
const H = { Authorization: `Bearer ${T}`, "Content-Type": "application/json" };
const ID = process.argv[2] || "901971876052";

(async () => {
  for (const tipo of ["deals", "meetings"]) {
    const a = await fetch(`https://api.hubapi.com/crm/v4/objects/contacts/${ID}/associations/${tipo}?limit=100`, { headers: H });
    const aj = await a.json();
    const ids = (aj.results ?? []).map((x: { toObjectId: string }) => String(x.toObjectId));
    console.log(`\n${tipo}: associazioni ${ids.length}  ${ids.slice(0, 5).join(", ")}`);
    if (!ids.length) continue;

    for (const props of [["createdate", "hs_createdate"], ["createdate"], ["hs_createdate"]]) {
      const b = await fetch(`https://api.hubapi.com/crm/v3/objects/${tipo}/batch/read`, {
        method: "POST", headers: H,
        body: JSON.stringify({ properties: props, inputs: ids.slice(0, 100).map((i: string) => ({ id: i })) }),
      });
      const t = await b.text();
      let riga = `   properties=[${props.join(",")}] -> HTTP ${b.status}`;
      if (b.status === 200) {
        const j = JSON.parse(t);
        const date = (j.results ?? []).map((x: { properties: Record<string, string> }) =>
          x.properties.createdate || x.properties.hs_createdate).filter(Boolean);
        riga += `  date lette ${date.length}  max ${date.length ? date.sort().at(-1) : "NESSUNA"}`;
      } else riga += `  ${t.replace(/\s+/g, " ").slice(0, 160)}`;
      console.log(riga);
    }
  }
})();
