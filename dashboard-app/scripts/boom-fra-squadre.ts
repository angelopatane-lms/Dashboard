/**
 * I Boom in cui il setter e l'advisor stanno in DUE SQUADRE DIVERSE, e cosa
 * succede ai totali delle due tabelle. Legge e stampa.
 *
 *   npx tsx scripts/boom-fra-squadre.ts [da] [a]
 */
import "./env";
import fs from "fs";
import path from "path";
import { calcolaBoom } from "../src/lib/squadre/boom";
import { proprietari } from "../src/lib/squadre/proprietari";
import { ieriRoma } from "../src/lib/report/giornaliero";
import { piuGiorni } from "../src/lib/squadre/finestra";

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const a = process.argv[3] ?? ieriRoma();
  const da = process.argv[2] ?? piuGiorni(a, -29);

  const squadre = JSON.parse(
    fs.readFileSync(
      path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Squadre", "squadre.json"),
      "utf8"
    )
  );
  // id -> squadra, e id -> ruolo (come li legge la pagina).
  const squadraDi = new Map<string, string>();
  const ruoloDi = new Map<string, string>();
  for (const s of squadre.squadre) {
    for (const [gruppo, ruolo] of [
      ["teamLeader", "Team Leader"],
      ["closer", "Closer"],
      ["setter", "Setter"]
    ] as const) {
      for (const p of s[gruppo] ?? []) {
        if (!p.id) continue;
        for (const id of [String(p.id), ...(p.ancheId ?? []).map(String)]) {
          squadraDi.set(id, s.nome);
          if (!ruoloDi.has(id) || ruolo !== "Setter") ruoloDi.set(id, ruolo);
        }
      }
    }
  }

  const nomi = await proprietari(token);
  const b = await calcolaBoom(token, da, a, nomi.perId);

  console.log(`FINESTRA ${da} -> ${a}\n`);
  console.log("BOOM IN CUI SETTER E ADVISOR STANNO IN SQUADRE DIVERSE:\n");

  // Per ogni giorno, le persone con lato setter e quelle con lato advisor: si
  // ricostruiscono le coppie confrontando gli importi dello stesso giorno.
  let trovati = 0;
  const totali = new Map<string, { advisor: number; setterNominale: number }>();
  for (const [giorno, persone] of Object.entries(b.giorni)) {
    const adv: Array<[string, number, number]> = [];
    const set: Array<[string, number, number]> = [];
    for (const [id, lati] of Object.entries(persone as any)) {
      const l = lati as any;
      if (l.advisor.chiusure) adv.push([id, l.advisor.chiusure, l.advisor.venduto]);
      if (l.setter.chiusure) set.push([id, l.setter.chiusure, l.setter.venduto]);
    }
    for (const [idA, , euroA] of adv) {
      for (const [idS, , euroS] of set) {
        if (idA === idS) continue;
        if (Math.round(euroA) !== Math.round(euroS)) continue;
        const sqA = squadraDi.get(idA);
        const sqS = squadraDi.get(idS);
        if (!sqA || !sqS || sqA === sqS) continue;
        trovati++;
        console.log(`  ${giorno}  ${Math.round(euroA).toLocaleString("it-IT")} EUR`);
        console.log(`     chiuso da  ${nomi.perId.get(idA)}  (${ruoloDi.get(idA)}, ${sqA})`);
        console.log(`     fissato da ${nomi.perId.get(idS)}  (${ruoloDi.get(idS)}, ${sqS})`);
      }
    }
  }
  if (!trovati) console.log("  nessuno in questa finestra");

  // Come la pagina fa i conti: riga = lato del ruolo, totale = lato advisor.
  console.log("\nCOME FINISCONO NELLE DUE TABELLE:\n");
  for (const [, persone] of Object.entries(b.giorni)) {
    for (const [id, lati] of Object.entries(persone as any)) {
      const sq = squadraDi.get(id);
      if (!sq) continue;
      const l = lati as any;
      const t = totali.get(sq) ?? { advisor: 0, setterNominale: 0 };
      t.advisor += l.advisor.venduto - l.advisor.vendutoStornato;
      if (ruoloDi.get(id) === "Setter") t.setterNominale += l.setter.venduto - l.setter.vendutoStornato;
      totali.set(sq, t);
    }
  }
  console.log("squadra                  totale (solo advisor)   mostrato sulle righe dei setter");
  let somma = 0;
  for (const [sq, t] of totali) {
    somma += t.advisor;
    console.log(
      `${sq.padEnd(24)} ${Math.round(t.advisor).toLocaleString("it-IT").padStart(12)} EUR   ${Math.round(t.setterNominale).toLocaleString("it-IT").padStart(12)} EUR`
    );
  }
  console.log(`${"".padEnd(24)} ${Math.round(somma).toLocaleString("it-IT").padStart(12)} EUR   <- somma dei totali, ogni vendita una volta sola`);
  process.exit(0);
})();
