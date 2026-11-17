/**
 * Il filtro "Categoria" misurato, prima che esista sulla pagina.
 *
 *   npx tsx scripts/squadre-filtro-prova.ts [da] [a]
 *
 * Per ogni squadra commerciale stampa chiusure e venduto nei tre modi, cosi'
 * si vede subito se le somme per categoria tornano col totale della persona.
 */
import "./env";
import fs from "fs";
import { ieriRoma } from "../src/lib/report/giornaliero";
import { calcolaBoom } from "../src/lib/squadre/boom";
import { piuGiorni } from "../src/lib/squadre/finestra";
import { proprietari } from "../src/lib/squadre/proprietari";

type Persona = { nome: string; id?: string; ancheId?: string[] };
type Squadra = { chiave: string; nome: string; categorie: string[]; separata?: boolean;
  teamLeader?: Persona[]; closer?: Persona[]; setter?: Persona[] };

(async () => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN!;
  const a = process.argv[3] ?? ieriRoma();
  const da = process.argv[2] ?? piuGiorni(a, -29);
  const squadre: Squadra[] = JSON.parse(
    fs.readFileSync("C:/Users/Angelo/Desktop/Windserf/Squadre/squadre.json", "utf8")
  ).squadre;

  const nomi = await proprietari(token);
  const u = await calcolaBoom(token, da, a, nomi.perId, (r) => console.log("  " + r));

  console.log(`\nfinestra ${da} -> ${a}\n`);
  for (const s of squadre) {
    if (s.separata) continue;
    const ids = new Set<string>();
    for (const g of [s.teamLeader, s.closer, s.setter]) {
      for (const p of g ?? []) {
        if (p.id) ids.add(String(p.id));
        for (const x of p.ancheId ?? []) ids.add(String(x));
      }
    }
    let cP = 0, vP = 0, cD = 0, vD = 0, cC = 0, vC = 0;
    for (const persone of Object.values(u.giorni)) {
      for (const [id, cella] of Object.entries(persone)) {
        if (!ids.has(id)) continue;
        // Il lato advisor: e' quello che conta le vendite chiuse una volta sola.
        cP += cella.advisor.chiusure; vP += cella.advisor.venduto;
        // IL LATO PUO' MANCARE: le celle per categoria portano solo il lato
        // che ha ricevuto l'incasso, non due lati di cui uno di zeri.
        for (const cat of s.categorie) {
          const d = cella.perProdotto?.[cat]?.advisor;
          if (d) { cD += d.chiusure; vD += d.venduto; }
          const k = cella.perCampagna?.[cat]?.advisor;
          if (k) { cC += k.chiusure; vC += k.venduto; }
        }
      }
    }
    const e = (n: number) => Math.round(n).toLocaleString("it-IT") + " EUR";
    console.log(
      `${s.nome.padEnd(16)} persona ${String(cP).padStart(3)} / ${e(vP).padStart(12)}` +
      ` | prodotto ${String(cD).padStart(3)} / ${e(vD).padStart(12)}` +
      ` | campagna ${String(cC).padStart(3)} / ${e(vC).padStart(12)}`
    );
  }
})();
