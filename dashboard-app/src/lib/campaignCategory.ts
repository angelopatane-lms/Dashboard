// Categorie reali delle campagne, dedotte dal nome tecnico della campagna
// (in attesa di una colonna "Categoria" dedicata in una fonte dati).
// Il match e' per sequenza di token esatti (separati da "_", spazi, "-", ecc.)
// per evitare falsi positivi con i codici brevi (es. "mep", "rem", "ade")
// che potrebbero comparire come sottostringa di altre parole.
// Ogni categoria puo' avere piu' pattern alternativi di token (es. "mbe_sale"
// oppure il solo "sales" quando il prefisso "mbe" non e' presente nel nome).
type CategoryDef = { label: string; patterns: string[][] };

const CATEGORY_DEFS: CategoryDef[] = [
  { label: "DIV COACH", patterns: [["div", "coach"]] },
  { label: "Imprenditoria", patterns: [["imprenditoria"]] },
  { label: "MBE MKTG", patterns: [["mbe", "mktg"]] },
  { label: "MBE MNGT", patterns: [["mbe", "mngt"]] },
  { label: "MBE SALE", patterns: [["mbe", "sale"], ["sale"]] },
  { label: "MEP", patterns: [["mep"]] },
  { label: "REM", patterns: [["rem"]] },
  { label: "ADE", patterns: [["ade"]] },
  { label: "ICMD", patterns: [["icmd"]] }
];

function tokenMatches(token: string, expected: string): boolean {
  if (expected === "imprenditoria") return token.startsWith("imprenditor");
  if (expected === "icmd") return token.startsWith("icmd");
  if (expected === "sale") return token === "sale" || token === "sales";
  return token === expected;
}

export function guessCategoria(campagna: string): string {
  const trimmed = campagna.trim();
  if (!trimmed) return "Nessuna";

  const tokens = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const def of CATEGORY_DEFS) {
    for (const pattern of def.patterns) {
      for (let i = 0; i <= tokens.length - pattern.length; i++) {
        if (pattern.every((expected, j) => tokenMatches(tokens[i + j], expected))) {
          return def.label;
        }
      }
    }
  }
  return "Altro";
}
