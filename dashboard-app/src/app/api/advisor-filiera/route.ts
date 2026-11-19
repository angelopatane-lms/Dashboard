import { NextRequest, NextResponse } from "next/server";
import { fetchCsv } from "@/lib/csv";
import { normalizeOperatori } from "@/lib/analytics";
import { operatoriDelTeam } from "@/lib/operatoriTeam";
import { getDb } from "@/lib/db";

/**
 * LE CONNESSIONI DI TUTTA LA FILIERA che porta agli appuntamenti di un advisor.
 *
 * LA DOMANDA. In "advisor + setter" la colonna Appuntamenti conta anche quelli
 * procurati dai setter, mentre al denominatore c'erano solo le telefonate
 * dell'advisor: Roberta Scicchitano veniva 42 su 17, cioe' il 247%. Un rapporto
 * che non esiste. Qui si costruisce il denominatore che gli corrisponde: le sue
 * connessioni PIU' quelle dei setter che gli hanno fissato gli appuntamenti.
 *
 * E' UNA RIPARTIZIONE, e va detto. Le connessioni di un setter sono un blocco
 * solo: Bartolo Giordanengo in un mese fissa a dieci advisor diversi, e non
 * esiste "la telefonata che ha fatto per Asma". Si dividono in proporzione agli
 * appuntamenti fissati a ciascuno - dei suoi 55 appuntamenti, se 11 vanno ad
 * Asma, un quinto delle sue connessioni entra nel denominatore di Asma. Il
 * totale torna e nessuno viene contato due volte, ma resta una convenzione:
 * le chiamate non si convertono allo stesso modo per tutti.
 *
 * COSA MISURA DAVVERO, quindi: quante connessioni della catena sono servite per
 * produrre un appuntamento di quell'advisor. Non e' il suo rendimento
 * personale - quello si legge premendo l'icona e passando a "solo advisor",
 * dove numeratore e denominatore tornano a essere solo suoi.
 *
 * LE CONNESSIONI DEI SETTER NON SONO IN PAGINA: la pagina Advisor legge dal
 * foglio le sole righe degli advisor. Per questo la rotta rilegge il foglio e
 * tiene le righe dei setter, con la stessa regola della storia delle squadre
 * (chi era setter in quel giorno, non chi lo e' oggi).
 *
 * Deciso con Angelo il 19/11/2026.
 */

const SHEET_ID = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID_OPERATORI = "245526930";

/** La stessa normalizzazione delle altre rotte, cosi' le righe si incontrano. */
const chiave = (nome: string) => nome.trim().toLowerCase().replace(/\s+/g, " ");

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!from || !to) {
    return NextResponse.json({ error: "servono from e to" }, { status: 400 });
  }

  try {
    const [righe, setterTeam] = await Promise.all([
      fetchCsv(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID_OPERATORI}`),
      operatoriDelTeam("Setter")
    ]);

    // 1. Le connessioni di ogni setter nel periodo, dal foglio.
    const connessioniSetter = new Map<string, number>();
    for (const r of normalizeOperatori(righe)) {
      if (!r.data || r.data < from || r.data > to) continue;
      if (!r.operatore) continue;
      // CHI ERA SETTER IN QUEL GIORNO, non chi lo e' oggi: e' la stessa regola
      // con cui le pagine dividono il lavoro fra le squadre.
      if (setterTeam && !setterTeam.ammetteRiga(r.operatore, r.data)) continue;
      const k = chiave(r.operatore);
      connessioniSetter.set(k, (connessioniSetter.get(k) ?? 0) + r.connessioni);
    }

    // 2. Chi ha fissato a chi, nel periodo: dalle trattative.
    const db = getDb();
    const { rows } = await db.query<{ setter: string; advisor: string; quanti: string }>(
      `SELECT ps.nome AS setter, pa.nome AS advisor, COUNT(*)::text AS quanti
         FROM trattativa t
         JOIN proprietario ps ON ps.id = t.setter_id
         JOIN proprietario pa ON pa.id = t.proprietario_id
        WHERE t.creata_ts >= $1::timestamp
          AND t.creata_ts <  ($2::timestamp + interval '1 day')
          AND t.setter_id IS NOT NULL
          AND t.proprietario_id IS NOT NULL
          AND t.setter_id <> t.proprietario_id
        GROUP BY ps.nome, pa.nome`,
      [from, to]
    );

    const perSetter = new Map<string, { tot: number; verso: Map<string, number> }>();
    for (const r of rows) {
      const s = chiave(r.setter);
      const a = chiave(r.advisor);
      const n = Number(r.quanti) || 0;
      if (!n) continue;
      const voce = perSetter.get(s) ?? { tot: 0, verso: new Map<string, number>() };
      voce.tot += n;
      voce.verso.set(a, (voce.verso.get(a) ?? 0) + n);
      perSetter.set(s, voce);
    }

    // 3. La quota di ciascun setter, spalmata sugli advisor a cui ha fissato.
    const quota: Record<string, number> = {};
    for (const [s, voce] of perSetter) {
      const conn = connessioniSetter.get(s);
      if (!conn || !voce.tot) continue;
      for (const [a, quanti] of voce.verso) {
        quota[a] = (quota[a] ?? 0) + (conn * quanti) / voce.tot;
      }
    }
    for (const k of Object.keys(quota)) quota[k] = Math.round(quota[k]);

    return NextResponse.json({ daiSetter: quota });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
