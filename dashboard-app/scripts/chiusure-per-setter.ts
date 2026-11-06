/**
 * Le chiusure di una finestra raggruppate per chi aveva FISSATO
 * l'appuntamento, dicendo per ciascuno se ha una riga nelle squadre.
 *
 *   npx tsx scripts/chiusure-per-setter.ts 2026-11-01 2026-11-05
 */
import "./env";
import fs from "fs";
import path from "path";
import { proprietari } from "../src/lib/squadre/proprietari";
import { estremiRoma, sfoglia } from "../src/lib/report/giornaliero";
import { CHIUSURE_TIPOLOGIE } from "../src/lib/hubspotRegole";

const BOOM = "2-130365112";

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const da = process.argv[2] ?? "2026-11-01";
  const a = process.argv[3] ?? "2026-11-05";
  const nomi = await proprietari(token);

  const squadre = JSON.parse(
    fs.readFileSync(
      path.join("C:", "Users", "Angelo", "Desktop", "Windserf", "Squadre", "squadre.json"),
      "utf8"
    )
  );
  const inSquadra = new Map<string, string>();
  for (const s of squadre.squadre)
    for (const g of ["teamLeader", "closer", "setter"] as const)
      for (const p of s[g] ?? []) {
        if (!p.id) continue;
        for (const id of [String(p.id), ...(p.ancheId ?? []).map(String)]) {
          inSquadra.set(id, `${s.nome} / ${g === "setter" ? "Setter" : g === "closer" ? "Closer" : "Team Leader"}`);
        }
      }

  const incassi = await sfoglia(
    token,
    BOOM,
    [
      { propertyName: "data_di_pagamento", operator: "GTE", value: String(estremiRoma(da).da) },
      { propertyName: "data_di_pagamento", operator: "LT", value: String(estremiRoma(a).a) }
    ],
    ["importo", "tipologia_di_incasso", "hubspot_owner_id", "setter", "prodotto"],
    400
  );

  type Conto = { n: number; euro: number; seStesso: number; prodotti: Set<string> };
  const per = new Map<string, Conto>();
  for (const b of incassi) {
    const p = b.properties;
    if (!CHIUSURE_TIPOLOGIE.has((p.tipologia_di_incasso ?? "").trim())) continue;
    const setter = (p.setter ?? "").trim();
    const owner = (p.hubspot_owner_id ?? "").trim();
    const k = setter || "(nessun setter)";
    const c = per.get(k) ?? { n: 0, euro: 0, seStesso: 0, prodotti: new Set<string>() };
    c.n++;
    c.euro += Number(p.importo) || 0;
    if (setter && setter === owner) c.seStesso++;
    c.prodotti.add((p.prodotto ?? "").trim() || "—");
    per.set(k, c);
  }

  console.log(`CHIUSURE DAL ${da} AL ${a}, per chi aveva fissato l'appuntamento\n`);
  console.log("chi ha fissato            chiusure   venduto   di cui chiuse da se stesso   dove compare");
  const righe = [...per.entries()].sort((x, y) => y[1].euro - x[1].euro);
  let fuori = { n: 0, euro: 0 };
  for (const [id, c] of righe) {
    const nome = id === "(nessun setter)" ? id : nomi.perId.get(id) ?? `(${id})`;
    const dove = inSquadra.get(id) ?? "NESSUNA SQUADRA";
    if (!inSquadra.has(id)) {
      fuori.n += c.n - c.seStesso;
      fuori.euro += c.seStesso === c.n ? 0 : c.euro;
    }
    console.log(
      `${nome.slice(0, 24).padEnd(24)} ${String(c.n).padStart(8)} ${Math.round(c.euro).toLocaleString("it-IT").padStart(9)} ${String(c.seStesso).padStart(27)}   ${dove}`
    );
  }
  console.log(
    `\nChiusure il cui appuntamento e' stato fissato da qualcun altro e che NON compaiono su nessuna riga di setter: ${fuori.n}`
  );
  process.exit(0);
})();
