import { NextRequest, NextResponse } from "next/server";
import { sincronizzaStatiLead, daDoveRipartire } from "@/lib/statiLead/sync";
import { osservaTeam } from "@/lib/utenti/osserva";

/**
 * Il giro notturno che tiene aggiornata la cronologia degli Stati Lead dei
 * quattro advisor che lavorano solo al telefono.
 *
 * Senza di lui le loro colonne Appuntamenti e Consulenze restano ferme al
 * giorno dell'ultimo caricamento a mano, e si vedrebbe solo guardando i numeri
 * di oggi e trovandoli uguali a ieri - cioe' tardi.
 *
 * ORARIO: 03:50 UTC, dopo il giro delle trascrizioni (03:30) e prima di quello
 * di mezzogiorno. Nessuno dei due tocca le stesse tabelle, ma distanziarli
 * tiene separati i tetti al secondo di HubSpot.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return NextResponse.json({ error: "HUBSPOT_PRIVATE_APP_TOKEN non impostato" }, { status: 500 });

  // Una prova senza scrivere si chiede con ?prova=1. Con ?da=AAAA-MM-GG si
  // rilegge da una data precisa: serve a recuperare un buco senza aprire un
  // terminale, per esempio dopo una notte in cui il giro e' saltato.
  const scrivi = req.nextUrl.searchParams.get("prova") !== "1";
  const daArg = req.nextUrl.searchParams.get("da");

  try {
    let da: Date;
    if (daArg) {
      da = new Date(`${daArg}T00:00:00.000Z`);
      if (Number.isNaN(da.getTime())) {
        return NextResponse.json({ error: `da non e' una data: ${daArg}` }, { status: 400 });
      }
    } else {
      da = await daDoveRipartire();
    }

    const esito = await sincronizzaStatiLead({ token, da, scrivi });
    console.log(
      `[cron/stati-lead] dal ${esito.da.slice(0, 10)}: ${esito.ingressi} ingressi | ` +
        esito.advisor.map((a) => `${a.nome} ${a.ingressi}/${a.contatti}`).join(", ")
    );
    // LA COMPOSIZIONE DEI TEAM SI GUARDA QUI, agganciata a questo giro perche'
    // e' lo stesso che legge i team per sapere chi sono gli advisor telefonici:
    // due letture della stessa cosa a orari diversi sarebbero libere di
    // divergere. Gli ingressi e le uscite rispetto a ieri finiscono in
    // utente_team_storia, che e' l'unica copia di quell'informazione - HubSpot
    // non la conserva.
    let team: Awaited<ReturnType<typeof osservaTeam>> | null = null;
    try {
      team = await osservaTeam(token, scrivi);
      if (team.fermo) {
        console.warn(`[cron/stati-lead] team non osservati: ${team.fermo}`);
      } else if (team.primaVolta) {
        console.log(`[cron/stati-lead] prima fotografia dei team: ${team.adesso} appartenenze`);
      } else if (team.ingressi.length || team.uscite.length) {
        console.log(
          `[cron/stati-lead] team: ${team.ingressi.length} ingressi, ${team.uscite.length} uscite | ` +
            [...team.ingressi.map((i) => `+${i.nome} ${i.team}`), ...team.uscite.map((u) => `-${u.nome} ${u.team}`)].join(", ")
        );
      }
    } catch (e) {
      // NON FA FALLIRE IL GIRO: gli Stati Lead sono il motivo per cui questo
      // cron esiste, e l'osservazione dei team e' un passeggero.
      console.error("[cron/stati-lead] osservazione dei team non riuscita:", e);
    }

    return NextResponse.json({ ...esito, scrittura: scrivi, team });
  } catch (e) {
    console.error("[cron/stati-lead]", e);
    return NextResponse.json({ errore: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
