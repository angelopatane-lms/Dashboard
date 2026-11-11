import crypto from "crypto";

/**
 * LA SCHEDA RECESSI DEL FOGLIO DI MARY, letta con l'account di servizio.
 *
 * E' il registro vero degli storni: 192 righe da dicembre 2024, 767.193 euro.
 * Su HubSpot la fase "Richiesta rimborso" (`boom_stage = recessed`) la deve
 * marcare una persona a mano, e fino all'11 novembre 2026 risultava messa su
 * tre casi in tutta la storia - cioe' la colonna Storni delle pagine squadre
 * diceva sempre zero mentre i recessi c'erano.
 *
 * PERCHE' UN TOKEN FIRMATO E NON UNA FETCH NUDA. Gli altri fogli che la
 * Dashboard legge - Operatori, Hubspot User List - sono aperti a chiunque
 * abbia il link. Questo no: e' di un Gmail fuori dominio e sta "Con
 * limitazioni", condiviso in lettura con l'account di servizio
 * `video-creator@…`. Serve un JWT RS256 scambiato per un access token, ed e'
 * la stessa firma che fanno il Bot Slack e la Prenotazione Advisor.
 *
 * SENZA `sub`, pero': li' l'account impersona info@leonardoleone.it per
 * vedere le agende aziendali (delega di dominio), qui il foglio e' condiviso
 * con l'account in persona e la delega non c'entra. Chiedere la delega su un
 * indirizzo fuori dominio fallisce con `unauthorized_client`.
 */

const FOGLIO = "1QT_fiYdfXLmIn_-JrZTnUSflqyfYJQO3DoTWa4KmEZ8";
const SCHEDA = "Recessi";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

export type RigaRecesso = {
  /** La riga nel foglio, per ritrovarla: 1 e' l'intestazione. */
  riga: number;
  advisor: string;
  nome: string;
  importo: number;
  percorso: string;
  /** Compilata su poche righe, ma quando c'e' aiuta a scegliere il Boom. */
  dataPagamento: string;
};

const base64url = (v: Buffer | string) =>
  Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function credenziali(): { client_email: string; private_key: string } {
  const grezzo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!grezzo) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON non impostata");
  const testo = grezzo.trim().startsWith("{") ? grezzo : Buffer.from(grezzo, "base64").toString("utf8");
  const c = JSON.parse(testo) as { client_email?: string; private_key?: string };
  if (!c.client_email || !c.private_key) throw new Error("account di servizio senza client_email o private_key");
  return { client_email: c.client_email, private_key: c.private_key };
}

/** Il token dura un'ora: si tiene finche' vale, meno un minuto di margine. */
let ricordo: { token: string; scade: number } | null = null;

async function accessToken(): Promise<string> {
  if (ricordo && ricordo.scade > Date.now() + 60_000) return ricordo.token;
  const c = credenziali();
  const ora = Math.floor(Date.now() / 1000);
  const testa = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      iss: c.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: ora,
      exp: ora + 3600
    })
  );
  const firma = crypto
    .createSign("RSA-SHA256")
    .update(`${testa}.${corpo}`)
    .sign(c.private_key.replace(/\\n/g, "\n"));
  const jwt = `${testa}.${corpo}.${base64url(firma)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const d = (await r.json()) as { access_token?: string; error_description?: string };
  if (!d.access_token) throw new Error(`Google non da' il token: ${d.error_description ?? "motivo ignoto"}`);
  ricordo = { token: d.access_token, scade: Date.now() + 3300_000 };
  return d.access_token;
}

const soldi = (v: unknown) => {
  const n = Number(
    String(v ?? "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
  );
  return Number.isFinite(n) ? n : 0;
};

/**
 * Le righe della scheda, gia' pulite.
 *
 * LE PRIME DUE RIGHE SONO INTESTAZIONI - la seconda ripete la prima - e le
 * righe senza nome non sono recessi: sono separatori e appunti.
 */
export async function righeRecessi(): Promise<RigaRecesso[]> {
  const token = await accessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${FOGLIO}/values/${encodeURIComponent(SCHEDA)}?majorDimension=ROWS`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!r.ok) throw new Error(`il foglio non si legge: ${r.status}`);
  const d = (await r.json()) as { values?: string[][] };
  const righe = d.values ?? [];

  const fuori: RigaRecesso[] = [];
  righe.slice(2).forEach((c, i) => {
    const nome = (c[1] ?? "").trim();
    if (!nome) return;
    fuori.push({
      riga: i + 3,
      advisor: (c[0] ?? "").trim(),
      nome,
      importo: soldi(c[4]),
      percorso: (c[5] ?? "").trim(),
      dataPagamento: (c[7] ?? "").trim()
    });
  });
  return fuori;
}
