import { NextRequest, NextResponse } from "next/server";
import { messaggio, reportDelGiorno, ieriRoma } from "@/lib/report/giornaliero";
import { operatoriDelTeam } from "@/lib/operatoriTeam";

/**
 * Il report del giorno prima, su Slack, ogni mattina alle 8 di Roma.
 *
 * PERCHE' QUI E NON SUL COMPUTER, a differenza del controllo delle 7:30: un
 * report deve arrivare a un'ora prevedibile. Sul portatile arriva quando lo si
 * accende, e un rituale che slitta di tre ore smette di essere un rituale.
 *
 * DUE CRON PER UNA SOLA SVEGLIA. Vercel programma in UTC e non sa niente
 * dell'ora legale: le 8 di Roma sono le 6 UTC d'estate e le 7 d'inverno. Si
 * programmano entrambe e si controlla qui che a Roma siano davvero le 8 -
 * l'altra chiamata se ne va senza fare niente. L'alternativa, un cron solo,
 * vuol dire un report che per meta' anno arriva alle 9.
 *
 * SI PUO' FORZARE con ?ora=no, che salta il controllo: serve a rimandarlo a
 * mano quando qualcosa e' andato storto, senza aspettare domani.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

/** L'ora di Roma adesso, come numero. */
function oraRoma(): number {
  return Number(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      hour12: false
    }).format(new Date())
  );
}

async function mandaSlack(testo: string, token: string, a: string) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: a, text: testo })
  });
  const d = (await r.json()) as { ok?: boolean; error?: string };
  return d;
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "non autorizzato" }, { status: 401 });
  }

  const forzato = req.nextUrl.searchParams.get("ora") === "no";
  if (!forzato && oraRoma() !== 8) {
    // NON E' UN ERRORE: e' l'altra delle due sveglie, quella che d'estate non
    // serve. Si risponde ok, altrimenti Vercel la segna rossa ogni giorno e
    // l'elenco dei fallimenti smette di voler dire qualcosa.
    return NextResponse.json({ ok: true, saltato: `a Roma sono le ${oraRoma()}, non le 8` });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const slack = process.env.SLACK_BOT_TOKEN;
  const a = process.env.REPORT_SLACK_A;
  if (!token || !slack || !a) {
    const manca = [
      !token && "HUBSPOT_PRIVATE_APP_TOKEN",
      !slack && "SLACK_BOT_TOKEN",
      !a && "REPORT_SLACK_A"
    ].filter(Boolean);
    // SI DICE QUALE MANCA, mai il valore di quelle che ci sono.
    return NextResponse.json({ error: `variabili mancanti: ${manca.join(", ")}` }, { status: 503 });
  }

  const data = req.nextUrl.searchParams.get("giorno") ?? ieriRoma();
  try {
    // L'elenco dei Setter serve a dividere chatter e telefonici. Se il foglio
    // non risponde il report esce lo stesso, con tutti i fissati sotto setter.
    const team = await operatoriDelTeam("Setter").catch(() => null);
    const r = await reportDelGiorno({
      token,
      data,
      sottoTeam: team?.sottoTeam,
      edizioneDal: process.env.REPORT_EDIZIONE_DAL || "2026-05-01"
    });
    const esito = await mandaSlack(messaggio(r), slack, a);
    if (!esito.ok) {
      console.error("[report-giornaliero] Slack:", esito.error);
      return NextResponse.json({ error: `Slack: ${esito.error}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, giorno: data });
  } catch (e) {
    console.error("[report-giornaliero]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "report non riuscito" },
      { status: 500 }
    );
  }
}
