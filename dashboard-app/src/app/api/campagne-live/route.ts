import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { formatoCampagna } from "@/lib/campagne";

/**
 * Le campagne Live, per il menu a tendina della sezione Assegnazione Contatti.
 *
 * NOMI INTERI, MAI ACCORCIATI. Altrove nella Dashboard le varianti vengono
 * unificate sulla campagna base - e' la vista giusta per leggere le
 * prestazioni - ma qui il nome serve a confrontarsi con `id_campagna_refresh`
 * sul contatto: tolto un suffisso il confronto non torna piu', e il filtro
 * escluderebbe le persone sbagliate. Si restituisce `campagna.nome` com'e',
 * suffissi compresi.
 *
 * SOLO LE LIVE perche' sono quelle che hanno un flusso che lavora gli iscritti:
 * workshop e webinar. Su 5.199 campagne in archivio sono 116, un elenco che si
 * scorre. La classificazione e' la stessa della pagina Campagne, cioe'
 * `formatoCampagna`, cosi' le due pagine non possono dire cose diverse.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const { rows } = await getDb().query<{ nome: string }>(
      `SELECT DISTINCT nome FROM campagna WHERE nome IS NOT NULL ORDER BY nome`
    );
    const live = rows.map((r) => r.nome).filter((n) => formatoCampagna(n) === "live");

    // RAGGRUPPATE PER FAMIGLIA, ma senza accorciare niente.
    //
    // Nel menu una campagna e le sue varianti sono una voce sola: sceglierla
    // le aggiunge tutte, con i nomi interi. E' la stessa regola che il resto
    // della Dashboard usa per il solo suffisso "_test_instant" - un nome e'
    // una variante se la sua base esiste DAVVERO fra le campagne - qui estesa
    // a qualunque suffisso. Senza quel controllo
    // "lms_rem_workshop_liberi_col_mattone_16_20_marzo_2026" diventerebbe una
    // variante di una base che non esiste.
    const insieme = new Set(live.map((n) => n.toLowerCase()));
    const baseDi = (nome: string) => {
      const k = nome.toLowerCase();
      let migliore = nome;
      for (const altro of live) {
        const a = altro.toLowerCase();
        // Prefisso seguito da "_": "..._aste" e' base di "..._aste_consulenza",
        // ma non di "..._asterisco".
        if (a.length < k.length && k.startsWith(a + "_") && insieme.has(a)) {
          if (a.length < migliore.length || migliore === nome) migliore = altro;
        }
      }
      return migliore;
    };

    const famiglie = new Map<string, string[]>();
    for (const nome of live) {
      const base = baseDi(nome);
      famiglie.set(base, [...(famiglie.get(base) ?? []), nome]);
    }
    const campagne = [...famiglie.entries()]
      .map(([base, nomi]) => ({ base, nomi: nomi.sort() }))
      .sort((a, b) => a.base.localeCompare(b.base));

    return NextResponse.json({ campagne }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[campagne-live]", e);
    return NextResponse.json(
      { campagne: [], error: "elenco campagne non disponibile" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
