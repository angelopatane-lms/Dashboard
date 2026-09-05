// Categorie reali delle campagne, dedotte dal nome tecnico della campagna
// (in attesa di una colonna "Categoria" dedicata in una fonte dati).
// Il match e' per sequenza di token esatti (separati da "_", spazi, "-", ecc.)
// per evitare falsi positivi con i codici brevi (es. "mep", "rem", "ade")
// che potrebbero comparire come sottostringa di altre parole, e vince quello
// che compare prima nel nome: vedi guessCategoria().
// Ogni categoria puo' avere piu' pattern alternativi di token (es. "mbe_sale"
// oppure il solo "sales" quando il prefisso "mbe" non e' presente nel nome).
type CategoryDef = { label: string; patterns: string[][] };

const CATEGORY_DEFS: CategoryDef[] = [
  { label: "DIV COACH", patterns: [["div", "coach"]] },
  { label: "Imprenditoria", patterns: [["imprenditoria"]] },
  { label: "MBE MKTG", patterns: [["mbe", "mktg"]] },
  { label: "MBE MNGT", patterns: [["mbe", "mngt"]] },
  { label: "MBE SALES", patterns: [["mbe", "sale"], ["sale"]] },
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

/**
 * VINCE IL MATCH CHE COMPARE PRIMA NEL NOME, non la prima categoria
 * dell'elenco. Per convenzione il codice della linea sta all'inizio
 * ("lms_mep_...", "icmd_...", "lms_div_coach_..."), mentre piu' avanti
 * compaiono le parole del prodotto, che possono somigliare al codice di
 * un'altra linea.
 *
 * Scorrendo l'elenco invece che il nome, "lms_mep_ew_imprenditore_assente"
 * finiva in Imprenditoria perche' "imprenditore" veniva valutato prima di
 * "mep", pur trovandosi due token piu' in la'. Stessa sorte per
 * "lres_rem_04_02_2024_sales_res_3" (finiva in MBE SALES invece che REM) e per
 * "icmd_mep_persi" (in MEP invece che ICMD).
 *
 * A parita' di posizione vince il pattern piu' lungo, cioe' il piu' specifico
 * ("mbe sale" batte "sale"), e solo a quel punto l'ordine dell'elenco.
 *
 * Misurato sulle 1.870 campagne conformi: cambiano categoria in 14, tutte
 * verso quella giusta.
 */
export function guessCategoria(campagna: string): string {
  const trimmed = campagna.trim();
  if (!trimmed) return "Nessuna";

  const tokens = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let migliore: { posizione: number; lunghezza: number; ordine: number; label: string } | null = null;

  CATEGORY_DEFS.forEach((def, ordine) => {
    for (const pattern of def.patterns) {
      for (let i = 0; i <= tokens.length - pattern.length; i++) {
        if (!pattern.every((expected, j) => tokenMatches(tokens[i + j], expected))) continue;
        const candidato = { posizione: i, lunghezza: pattern.length, ordine, label: def.label };
        const vince =
          !migliore ||
          candidato.posizione < migliore.posizione ||
          (candidato.posizione === migliore.posizione &&
            (candidato.lunghezza > migliore.lunghezza ||
              (candidato.lunghezza === migliore.lunghezza && candidato.ordine < migliore.ordine)));
        if (vince) migliore = candidato;
        break; // di questo pattern interessa solo la prima occorrenza
      }
    }
  });

  return migliore ? (migliore as { label: string }).label : "Altro";
}
