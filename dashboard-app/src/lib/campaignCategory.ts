// Categorie reali delle campagne, dedotte dal nome tecnico della campagna
// (in attesa di una colonna "Categoria" dedicata in una fonte dati).
// Il match e' per sequenza di token esatti (separati da "_", spazi, "-", ecc.)
// per evitare falsi positivi con i codici brevi (es. "mep", "rem", "ade")
// che potrebbero comparire come sottostringa di altre parole.
type CategoryDef = { label: string; tokens: string[] };

const CATEGORY_DEFS: CategoryDef[] = [
  { label: "DIV COACH", tokens: ["div", "coach"] },
  { label: "Imprenditoria", tokens: ["imprenditoria"] },
  { label: "MBE MKTG", tokens: ["mbe", "mktg"] },
  { label: "MBE MNGT", tokens: ["mbe", "mngt"] },
  { label: "MBE SALE", tokens: ["mbe", "sale"] },
  { label: "MEP", tokens: ["mep"] },
  { label: "REM", tokens: ["rem"] },
  { label: "ADE", tokens: ["ade"] },
  { label: "ICMD", tokens: ["icmd"] }
];

function tokenMatches(token: string, expected: string): boolean {
  if (expected === "imprenditoria") return token.startsWith("imprenditor");
  if (expected === "icmd") return token.startsWith("icmd");
  return token === expected;
}

export function guessCategoria(campagna: string): string {
  const trimmed = campagna.trim();
  if (!trimmed) return "Nessuna";

  const tokens = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const def of CATEGORY_DEFS) {
    for (let i = 0; i <= tokens.length - def.tokens.length; i++) {
      if (def.tokens.every((expected, j) => tokenMatches(tokens[i + j], expected))) {
        return def.label;
      }
    }
  }
  return "Altro";
}
