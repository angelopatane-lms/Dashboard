import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { leggiFrasi } from "@/lib/fireflies";
import { gettoneTrascrizione } from "@/lib/gettoneTrascrizione";
import { documentoWord } from "@/lib/documentoWord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Il testo di una trascrizione, servito come file.
 *
 * PERCHE' ESISTE. L'applicazione che produce l'analisi delle call legge la
 * trascrizione SCARICANDO un file: il flusso Zapier le scriveva sul contatto un
 * indirizzo di download generato dal connettore Fireflies, firmato e valido sei
 * ore. Da quando quel flusso e' spento scriviamo noi il collegamento, ma nel
 * formato della PAGINA di Fireflies - stabile, che non scade, e adatto a chi la
 * apre per leggerla. Da una pagina pero' quell'applicazione non ricava niente,
 * e dal 14 settembre le analisi si sono fermate.
 *
 * L'indirizzo del file non lo possiamo riprodurre: l'API pubblica di Fireflies
 * non lo espone - trenta campi sul tipo Transcript, nessuno scaricabile - ed e'
 * un dettaglio interno del connettore Zapier.
 *
 * Questo endpoint chiude il buco dalla parte nostra: restituisce lo stesso
 * testo, come testo semplice, a un indirizzo che non scade. Chi lo consuma
 * continua a fare quello che faceva - scaricare un indirizzo e leggerne il
 * contenuto - senza chiave di Fireflies e senza dipendere da una firma che
 * scade dopo sei ore, che e' il motivo per cui alcune analisi non sono mai
 * state prodotte.
 */

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const segreto = process.env.FIREFLIES_WEBHOOK_SECRET;
  const chiave = process.env.FIREFLIES_API_KEY;
  if (!segreto || !chiave) {
    return NextResponse.json({ error: "non configurato" }, { status: 500 });
  }

  const grezzo = String(params.id ?? "");
  // L'estensione decide il formato: .docx per l'applicazione che lo scarica,
  // testo semplice per chi vuole soltanto leggerlo.
  const comeWord = /\.docx$/i.test(grezzo);
  const id = grezzo.replace(/\.(docx|txt)$/i, "");
  // La forma dell'identificativo si controlla prima di usarlo: un percorso
  // qualunque diventerebbe una chiamata a Fireflies fatta per conto di chi
  // bussa.
  if (!/^[0-9A-Z]{20,32}$/.test(id)) {
    return NextResponse.json({ error: "identificativo non valido" }, { status: 400 });
  }

  const atteso = gettoneTrascrizione(id, segreto);

  // CHIEDERE L'INDIRIZZO FIRMATO, invece del testo. Il gettone lo calcola il
  // server, che e' l'unico a conoscere il segreto: senza questo, per ottenere
  // un indirizzo da consegnare a qualcuno bisognerebbe farsi passare il segreto
  // - che e' esattamente la cosa da non fare. Chiede il permesso dei cron,
  // quindi non e' alla portata di chi passa.
  if (req.nextUrl.searchParams.get("firma") === "1") {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
    }
    return NextResponse.json({
      // Quello che finisce sul contatto e' il .docx: e' il formato che
      // l'applicazione dell'analisi sa leggere.
      docx: `${req.nextUrl.origin}/api/trascrizione/${id}.docx?t=${atteso}`,
      testo: `${req.nextUrl.origin}/api/trascrizione/${id}?t=${atteso}`
    });
  }

  const dato = req.nextUrl.searchParams.get("t") ?? "";
  const a = Buffer.from(dato);
  const b = Buffer.from(atteso);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  try {
    const frasi = await leggiFrasi(chiave, id);
    if (!frasi.length) {
      return new NextResponse("", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
      });
    }

    // CHI PARLA DAVANTI A OGNI RIGA. Il documento che scaricava il flusso
    // precedente aveva la stessa forma, ed e' quella su cui l'analisi e' stata
    // tarata: togliere i nomi cambierebbe il testo su cui ragiona.
    const righe = frasi.map((f) => `${(f.voce ?? "").trim() || "?"}: ${f.testo}`);

    // UN .DOCX QUANDO L'INDIRIZZO LO CHIEDE. E' il formato che l'applicazione
    // dell'analisi ha letto per mesi, quando il file glielo forniva il
    // connettore Fireflies: dandogliene uno uguale non deve cambiare niente.
    // Il testo semplice resta per chi vuole solo leggere.
    if (comeWord) {
      const documento = await documentoWord(righe);
      return new NextResponse(new Uint8Array(documento), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${id}.docx"`,
          "Cache-Control": "no-store"
        }
      });
    }

    return new NextResponse(righe.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `inline; filename="${id}.txt"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    console.error("[trascrizione]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "trascrizione non leggibile" }, { status: 502 });
  }
}
