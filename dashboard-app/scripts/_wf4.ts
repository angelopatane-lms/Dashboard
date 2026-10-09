import "./env";
const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
const h = { Authorization: `Bearer ${token}` };
(async () => {
  const r = await fetch("https://api.hubapi.com/automation/v3/workflows", { headers: h });
  const flussi = ((await r.json()) as any).workflows ?? [];
  console.log(`scansione di ${flussi.length} workflow...`);
  let visti = 0, conWebhook = 0;
  const destinazioni = new Map<string, number>();
  for (const w of flussi) {
    try {
      const d = await fetch(`https://api.hubapi.com/automation/v3/workflows/${w.id}`, { headers: h });
      if (d.status === 429) { await new Promise((x) => setTimeout(x, 2000)); continue; }
      const t = await d.text();
      visti++;
      for (const m of t.matchAll(/https?:\/\/([^"'\/]+)/g)) {
        const host = m[1];
        destinazioni.set(host, (destinazioni.get(host) ?? 0) + 1);
        conWebhook++;
        if (/vercel\.app/i.test(host)) console.log(`   VERCEL in "${w.name}" (id=${w.id}, attivo=${w.enabled})`);
      }
    } catch {}
    await new Promise((x) => setTimeout(x, 110));
  }
  console.log(`\nletti ${visti} workflow. Destinazioni dei webhook trovate:`);
  for (const [k, v] of [...destinazioni].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${String(v).padStart(4)}  ${k}`);
  }
})();
