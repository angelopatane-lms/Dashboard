/**
 * Chi ha un obiettivo scritto, in che mese, e dove sta nelle squadre.
 *   npx tsx scripts/chi-ha-obiettivo.ts
 */
import "./env";
import fs from "fs";
import path from "path";
import { getDb } from "../src/lib/db";

(async () => {
  const { rows } = await getDb().query<{ persona: string; mese: string; valore: string }>(
    `SELECT persona, mese, valore::text AS valore FROM obiettivo ORDER BY mese DESC, valore DESC`
  );

  const squadre = JSON.parse(
    fs.readFileSync(path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Squadre", "squadre.json"), "utf8")
  );
  const dove = new Map<string, string>();
  for (const s of squadre.squadre)
    for (const [g, r] of [["teamLeader", "Team Leader"], ["closer", "Closer"], ["setter", "Setter"]] as const)
      for (const p of s[g] ?? []) {
        const k = String(p.nome ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const prima = dove.get(k);
        dove.set(k, prima && !prima.includes(r) ? `${prima} · ${r}` : `${s.nome} / ${r}`);
      }

  console.log(`${rows.length} obiettivi scritti in tutto\n`);
  console.log("mese     persona                        obiettivo      dove sta nelle squadre");
  for (const r of rows) {
    console.log(
      `${r.mese}  ${r.persona.slice(0, 28).padEnd(28)} ${Number(r.valore).toLocaleString("it-IT").padStart(11)} EUR   ${dove.get(r.persona) ?? "NESSUNA SQUADRA"}`
    );
  }
  const mesi = [...new Set(rows.map((r) => r.mese))];
  console.log(`\nmesi presenti: ${mesi.join(", ")}`);
  process.exit(0);
})();
