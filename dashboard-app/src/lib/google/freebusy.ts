import crypto from "crypto";

/**
 * LE FASCE OCCUPATE SULLE AGENDE GOOGLE, senza sapere cosa c'e' dentro.
 *
 * PERCHE' freeBusy E NON GLI EVENTI. Questa risposta dice solo "occupato
 * dalle 9 alle 10": niente titoli, niente invitati. E' esattamente quello che
 * serve per dire quanto e' piena un'agenda, ed e' anche l'unica forma in cui
 * si puo' mostrare l'agenda di una persona a chi non e' lei. Sui calendari
 * degli advisor ci sono "PALESTRA", "Casa", i nomi dei clienti e i fatti loro:
 * leggerli per metterli su un cruscotto sarebbe un'altra cosa, e non e' quella
 * che ci serve.
 *
 * PERCHE' SERVE. L'agenda delle pagine squadre nasce dalle riunioni di
 * HubSpot, cioe' da quello che passa dal link di prenotazione. Misurato il 13
 * novembre 2026: a fronte di 28 riunioni c'erano 46 impegni in piu' sui
 * calendari, di cui 18 con il nome di una persona. Un advisor che si segna le
 * consulenze a mano - Roberta Cettolo quel giorno ne aveva sei - sulla pagina
 * risultava "agenda libera" per tutto il giorno.
 *
 * L'ACCOUNT DI SERVIZIO E' QUELLO DEL BOT SLACK, lo stesso che la pagina di
 * prenotazione usa per sapere quando un advisor e' libero: ha la delega di
 * dominio e agisce come GOOGLE_CALENDAR_UTENTE, proprietario delle agende
 * aziendali. Le agende personali (gmail, outlook) restano fuori: per quelle
 * Google risponde "notFound".
 *
 * UN'AGENDA ILLEGGIBILE NON E' UN'AGENDA VUOTA, e le due cose restano
 * separate: chi non si legge non deve sembrare libero.
 */

const LETTURA = "https://www.googleapis.com/auth/calendar.readonly";

const base64url = (v: crypto.BinaryLike) =>
  Buffer.from(v as never).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

type Credenziali = { client_email: string; private_key: string };

function credenziali(): Credenziali {
  const grezzo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!grezzo) throw new Error("Manca GOOGLE_SERVICE_ACCOUNT_JSON");
  // Su Vercel la chiave si incolla come JSON o come base64: si accettano
  // tutte e due, perche' la differenza la fa solo chi l'ha incollata.
  const testo = grezzo.trim().startsWith("{") ? grezzo : Buffer.from(grezzo, "base64").toString("utf8");
  const c = JSON.parse(testo) as Credenziali;
  if (!c.client_email || !c.private_key) {
    throw new Error("service account senza client_email o private_key");
  }
  return c;
}

let tenuto: { token: string; scadenza: number } | null = null;

async function accessToken(): Promise<string> {
  const utente = String(process.env.GOOGLE_CALENDAR_UTENTE ?? "").trim().replace(/^["']|["']$/g, "");
  if (!utente) {
    throw new Error(
      "Manca GOOGLE_CALENDAR_UTENTE: senza impersonare nessuno il service account vede solo la propria agenda, che e' vuota"
    );
  }
  // Trenta secondi di margine: un token che scade a meta' chiamata e' un
  // errore che non si riproduce mai.
  if (tenuto && tenuto.scadenza > Date.now() + 30_000) return tenuto.token;

  const c = credenziali();
  const ora = Math.floor(Date.now() / 1000);
  const testa = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      iss: c.client_email,
      scope: LETTURA,
      aud: "https://oauth2.googleapis.com/token",
      iat: ora,
      exp: ora + 3600,
      sub: utente
    })
  );
  const firma = crypto
    .createSign("RSA-SHA256")
    .update(`${testa}.${corpo}`)
    .sign(String(c.private_key).replace(/\\n/g, "\n"));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${testa}.${corpo}.${base64url(firma)}`
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error(`Google non ha rilasciato il token: ${d.error_description || d.error || r.status}`);
  }
  tenuto = { token: d.access_token, scadenza: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}

export type Fascia = { inizio: number; fine: number };

/**
 * Gli impegni di piu' agende in una finestra.
 *
 * freeBusy non fallisce in blocco: per un'agenda che non puo' leggere mette
 * l'errore dentro la sua riga e risponde lo stesso per le altre.
 */
export async function fasceOccupate(
  calendarId: string[],
  da: Date,
  a: Date
): Promise<{ impegni: Map<string, Fascia[]>; illeggibili: Map<string, string> }> {
  const impegni = new Map<string, Fascia[]>();
  const illeggibili = new Map<string, string>();
  const ids = [...new Set(calendarId.filter(Boolean))];
  if (!ids.length) return { impegni, illeggibili };

  const t = await accessToken();
  // freeBusy accetta al massimo 50 agende per chiamata.
  for (let i = 0; i < ids.length; i += 50) {
    const pezzo = ids.slice(i, i + 50);
    const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin: da.toISOString(),
        timeMax: a.toISOString(),
        timeZone: "Europe/Rome",
        items: pezzo.map((id) => ({ id }))
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`freeBusy: HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);

    for (const id of pezzo) {
      const c = (d.calendars || {})[id];
      if (!c) {
        illeggibili.set(id, "nessuna risposta");
        continue;
      }
      if (c.errors && c.errors.length) {
        illeggibili.set(id, c.errors.map((e: { reason: string }) => e.reason).join(", "));
        continue;
      }
      impegni.set(
        id,
        (c.busy || []).map((b: { start: string; end: string }) => ({
          inizio: Date.parse(b.start),
          fine: Date.parse(b.end)
        }))
      );
    }
  }
  return { impegni, illeggibili };
}
