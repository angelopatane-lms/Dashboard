import { NextRequest, NextResponse } from "next/server";
import { fetchCsv } from "@/lib/csv";
import { chiaveNome } from "@/lib/nomi";
import { operatoriDelTeam } from "@/lib/operatoriTeam";
import { getDb } from "@/lib/db";

/**
 * Lo storico di TUTTI, anche di chi non lavora piu' con noi, in un CSV.
 *
 * IL PROBLEMA CHE RISOLVE. Le pagine Advisor e Setter costruiscono l'elenco
 * delle persone dal team di OGGI e poi ci filtrano sopra lo storico: chi e'
 * uscito sparisce anche dai mesi in cui lavorava tutti i giorni, e il totale
 * di quel mese risulta piu' basso di quanto fu. Misurato il 16 ottobre 2026:
 * nel foglio ci sono 118 persone, nei team di oggi 35. Le altre 87 sono
 * invisibili, e 72 di loro hanno lavorato dopo aprile - Edoardo Favaro con 435
 * righe, Silvia Schiavinato con 394, Antonio Mastrandrea con 209.
 *
 * PERCHE' UN'ESPORTAZIONE E NON UNA RIGA IN TABELLA. Le tabelle rispondono a
 * "come stiamo andando", e li' dentro chi se n'e' andato e' rumore. Questa
 * risponde a "cosa e' successo", che e' una domanda rara e di chi la fa
 * apposta. Due domande diverse, due strumenti: cosi' nessuno deve scegliere
 * fra una tabella leggibile e uno storico intero.
 *
 * I DATI NON SI RICALCOLANO, si trascrivono. Il foglio Operatori e' una
 * fotografia presa a fine giornata e non cambia piu': e' esattamente cio' che
 * serve a uno storico, mentre rileggere HubSpot darebbe i proprietari di oggi
 * su un lavoro di mesi fa.
 *
 * COME SI CHIAMA
 *   /api/esporta/operatori?from=2026-06-01&to=2026-06-30
 *   &dettaglio=campagna   una riga per persona E campagna, invece che per persona
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 120;

const SHEET = "1wHpVsYwB_5PKGSYYfD0W2pYa7U_3yWI1Re10T3jGgnM";
const GID = "245526930";

/** Le colonne da sommare, nell'ordine in cui stanno nel foglio. */
const SOMMA = [
  "Assegnati", "Chiamate", "Connessioni", "Nuovi", "Non Risposti",
  "Interesse Futuro", "Semina", "Da Richiamare", "BIN",
  "Appuntamenti", "No Show", "Consulenze", "Chiusure", "Boom"
] as const;

/**
 * La data del foglio, normalizzata.
 *
 * SI ACCETTANO DUE SCRITTURE perche' nel foglio ci sono entrambe e non e'
 * detto che resti cosi': indovinarne una sola vuol dire un'esportazione vuota
 * il giorno in cui cambia, senza nessun errore.
 */
function dataNormale(v: string): string {
  const s = (v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}

const numero = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Una cella CSV: le virgolette si raddoppiano, il resto si lascia stare. */
const cella = (v: string | number) => {
  const s = String(v ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Appuntamenti, consulenze, no show e chiusure dalle FONTI BUONE.
 *
 * NON DAL FOGLIO. Le colonne del foglio su questi numeri sono ferme o
 * incomplete - la sua colonna No Show e' a zero dal 19 agosto 2026 - mentre il
 * database li registra con la loro data vera: `creata_ts` quando
 * l'appuntamento viene fissato, `svolta_ts` quando la consulenza si tiene, la
 * tabella `no_show` quando viene disertata.
 *
 * SI DA' OGNI NUMERO DUE VOLTE, come setter e come proprietario, e non si
 * sceglie: per un appuntamento le due persone sono diverse nel 39% dei casi -
 * chi l'ha procurato e chi l'ha tenuto - e un'esportazione che ne mostra una
 * sola costringe chi la legge a fidarsi di una scelta che non ha fatto lui.
 */
async function dalDatabase(da: string, a: string) {
  const db = getDb();
  const vuoto = () => ({
    appFissati: 0, svolteSetter: 0, svolteProprietario: 0, noShow: 0
  });
  const per = new Map<string, ReturnType<typeof vuoto>>();
  const tocca = (nome: string) => {
    const k = chiaveNome(nome ?? "");
    if (!k) return null;
    if (!per.has(k)) per.set(k, vuoto());
    return per.get(k)!;
  };
  const finestra = [da, a];
  const [fissati, svolteS, svolteP, disertati] = await Promise.all([
    db.query<{ nome: string; n: string }>(
      `SELECT p.nome, COUNT(*)::text AS n FROM trattativa t
         JOIN proprietario p ON p.id = t.setter_id
        WHERE t.creata_ts >= $1::date AND t.creata_ts < ($2::date + INTERVAL '1 day')
        GROUP BY 1`, finestra),
    db.query<{ nome: string; n: string }>(
      `SELECT p.nome, COUNT(*)::text AS n FROM trattativa t
         JOIN proprietario p ON p.id = t.setter_id
        WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
        GROUP BY 1`, finestra),
    db.query<{ nome: string; n: string }>(
      `SELECT p.nome, COUNT(*)::text AS n FROM trattativa t
         JOIN proprietario p ON p.id = t.proprietario_id
        WHERE t.svolta_ts >= $1::date AND t.svolta_ts < ($2::date + INTERVAL '1 day')
        GROUP BY 1`, finestra),
    db.query<{ nome: string; n: string }>(
      `SELECT p.nome, COUNT(*)::text AS n FROM no_show n
         JOIN proprietario p ON p.id = n.setter_id
        WHERE n.ts >= $1::date AND n.ts < ($2::date + INTERVAL '1 day')
        GROUP BY 1`, finestra)
  ]);
  for (const r of fissati.rows) { const v = tocca(r.nome); if (v) v.appFissati = Number(r.n); }
  for (const r of svolteS.rows) { const v = tocca(r.nome); if (v) v.svolteSetter = Number(r.n); }
  for (const r of svolteP.rows) { const v = tocca(r.nome); if (v) v.svolteProprietario = Number(r.n); }
  for (const r of disertati.rows) { const v = tocca(r.nome); if (v) v.noShow = Number(r.n); }
  return per;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const da = p.get("from") ?? "";
  const a = p.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(da) || !/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    return NextResponse.json(
      { error: "servono from e to in formato 2026-06-01" },
      { status: 400 }
    );
  }
  const perCampagna = p.get("dettaglio") === "campagna";
  // IL RUOLO DELLA PAGINA DA CUI SI SCARICA: la tabella Advisor da' il file
  // degli Advisor, quella Setter dei Setter. Senza, in un file solo
  // finiscono due mestieri con due significati per le stesse colonne.
  const ruoloChiesto = p.get("ruolo") === "Setter" ? "Setter" : p.get("ruolo") === "Advisor" ? "Advisor" : null;

  try {
    const [righe, setter, advisor, db] = await Promise.all([
      fetchCsv(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=${GID}`, {
        next: { revalidate: 0 }
      }),
      operatoriDelTeam("Setter").catch(() => null),
      operatoriDelTeam("Advisor").catch(() => null),
      // SE IL DATABASE NON RISPONDE l'esportazione esce lo stesso, con le sole
      // colonne del foglio: un file parziale e' recuperabile, un errore no.
      dalDatabase(da, a).catch((e) => {
        console.error("[esporta/operatori] database:", e);
        return new Map<string, { appFissati: number; svolteSetter: number; svolteProprietario: number; noShow: number }>();
      })
    ]);

    // CHI C'E' ANCORA, per poterlo DIRE - non per filtrare. E' la differenza
    // fra questa esportazione e le tabelle.
    const squadra = new Map<string, string>();
    const ruoloDi = new Map<string, "Setter" | "Advisor">();
    for (const [ruolo, t] of [["Setter", setter], ["Advisor", advisor]] as const) {
      for (const n of t?.nomi ?? []) {
        const k = chiaveNome(n);
        squadra.set(k, t?.sottoTeam[k] ? `${ruolo} / ${t.sottoTeam[k]}` : ruolo);
        ruoloDi.set(k, ruolo);
      }
    }

    /**
     * Il ruolo di chi non e' piu' in squadra, dedotto dal CRM.
     *
     * NON E' SCRITTO DA NESSUNA PARTE. La distinzione fra Advisor e Setter la
     * fanno gli elenchi dei team, che dicono com'e' OGGI: di chi e' uscito non
     * resta traccia del mestiere. Si guarda allora cosa ha fatto - se compare
     * piu' spesso come setter delle trattative o come loro proprietario - e lo
     * si dice chiaramente nella colonna, con "(dedotto)", perche' chi legge
     * sappia che quella riga e' un'ipotesi e non un dato.
     *
     * CHI NON HA NE' L'UNO NE' L'ALTRO resta "sconosciuto" e finisce in
     * entrambi i file: meglio una riga di troppo da ignorare che una persona
     * che sparisce di nuovo, visto che questo file esiste proprio per quello.
     */
    const dedotto = (k: string): "Setter" | "Advisor" | "entrambi" | null => {
      const d = db.get(k);
      if (!d) return null;
      const comeSetter = d.appFissati + d.svolteSetter + d.noShow;
      // CHI HA FATTO ENTRAMBI I MESTIERI NEL PERIODO si dice, non si sceglie.
      // Chi cambia squadra a meta' anno ha lavorato davvero in tutti e due i
      // modi, e metterlo da una parte sola sbaglia per l'altra meta': su una
      // finestra lunga il ruolo non e' una proprieta' della persona, e' una
      // proprieta' del periodo.
      if (comeSetter > 0 && d.svolteProprietario > 0) return "entrambi";
      if (comeSetter === 0 && d.svolteProprietario === 0) return null;
      return comeSetter > 0 ? "Setter" : "Advisor";
    };

    type Riga = { operatore: string; campagna: string; giorni: Set<string>; n: number[] };
    const per = new Map<string, Riga>();
    for (const r of righe) {
      const giorno = dataNormale(String(r["Data"] ?? ""));
      if (giorno < da || giorno > a) continue;
      const operatore = String(r["Operatore"] ?? "").trim();
      if (!operatore) continue;
      const campagna = perCampagna ? String(r["Campagna"] ?? "").trim() : "";
      const k = `${chiaveNome(operatore)}|${campagna.toLowerCase()}`;
      let riga = per.get(k);
      if (!riga) {
        riga = { operatore, campagna, giorni: new Set(), n: SOMMA.map(() => 0) };
        per.set(k, riga);
      }
      riga.giorni.add(giorno);
      SOMMA.forEach((c, i) => {
        riga!.n[i] += numero(r[c]);
      });
    }

    // I NOMI DICONO LA PROVENIENZA, ed e' il punto: in questo file convivono
    // numeri del foglio e numeri del CRM, e due colonne che si chiamano
    // "Appuntamenti" senza dire da dove vengono sono il modo piu' rapido per
    // far litigare due persone su quale sia giusto.
    const DAL_CRM = [
      "Appuntamenti fissati (CRM, come setter)",
      "Consulenze svolte (CRM, come setter)",
      "Consulenze svolte (CRM, come proprietario)",
      "No show (CRM, come setter)"
    ];
    const intestazione = [
      "Operatore",
      ...(perCampagna ? ["Campagna"] : []),
      "Ruolo",
      "In squadra oggi",
      "Giorni con attivita'",
      ...SOMMA.map((c) => `${c} (foglio)`),
      ...(perCampagna ? [] : DAL_CRM)
    ];
    const corpo = [...per.values()]
      // SI TIENE CHI E' DI QUESTO RUOLO, e chi non si e' potuto classificare.
      .filter((r) => {
        if (!ruoloChiesto) return true;
        const k = chiaveNome(r.operatore);
        const vero = ruoloDi.get(k);
        if (vero) return vero === ruoloChiesto;
        const d = dedotto(k);
        // Chi non si e' potuto classificare, e chi ha fatto tutti e due i
        // mestieri, compare in entrambi i file: meglio una riga in piu' da
        // ignorare che una persona che sparisce di nuovo, visto che questo
        // file esiste proprio per non farla sparire.
        return d === null || d === "entrambi" || d === ruoloChiesto;
      })
      // Prima chi ha fatto piu' giorni: in un'esportazione di mesi, l'ordine
      // alfabetico mette in cima chi e' passato di qui una settimana.
      .sort((x, y) => y.giorni.size - x.giorni.size || x.operatore.localeCompare(y.operatore, "it"))
      .map((r) =>
        [
          r.operatore,
          ...(perCampagna ? [r.campagna] : []),
          (() => {
            const k = chiaveNome(r.operatore);
            const vero = ruoloDi.get(k);
            if (vero) return vero;
            const d = dedotto(k);
            if (d === "entrambi") return "Setter e Advisor nel periodo";
            return d ? `${d} (dedotto)` : "sconosciuto";
          })(),
          squadra.get(chiaveNome(r.operatore)) ?? "no",
          r.giorni.size,
          ...r.n,
          // I NUMERI DEL CRM NON SI SPEZZANO PER CAMPAGNA: il database li lega
          // alla persona, non alla campagna della riga del foglio. Spalmarli
          // su ogni riga li conterebbe tante volte quante sono le campagne.
          ...(perCampagna
            ? []
            : (() => {
                const d = db.get(chiaveNome(r.operatore));
                return [
                  d?.appFissati ?? 0,
                  d?.svolteSetter ?? 0,
                  d?.svolteProprietario ?? 0,
                  d?.noShow ?? 0
                ];
              })())
        ]
          .map(cella)
          .join(",")
      );

    const csv = [intestazione.map(cella).join(","), ...corpo].join("\r\n");
    return new NextResponse(`﻿${csv}`, {
      headers: {
        // IL BOM davanti: senza, Excel in italiano legge le accentate come
        // geroglifici, e un'esportazione che si apre male non viene usata.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${(ruoloChiesto ?? "operatori").toLowerCase()}-${da}_${a}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    console.error("[esporta/operatori]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "esportazione non riuscita" },
      { status: 500 }
    );
  }
}
