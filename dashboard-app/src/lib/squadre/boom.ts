/**
 * I Boom di una finestra, letti DAL VIVO e non fotografati.
 *
 * PERCHE' QUESTI NO. Tutto il resto delle pagine delle squadre e' una
 * fotografia scattata di notte, e va benissimo: una consulenza svolta
 * mercoledi' resta svolta per sempre. Un incasso no. Un Boom si cancella, si
 * corregge, si rimborsa, e il giorno a cui appartiene e' quello del pagamento,
 * non quello della correzione: una fotografia di due giorni prima continuerebbe
 * a mostrare una vendita che non c'e' piu'. Sui soldi non e' accettabile,
 * quindi chiusure, venduto e storni si rileggono ogni volta che qualcuno apre
 * la pagina.
 *
 * COSTA POCO. Sono circa 8 incassi al giorno: su tutto lo storico sono tre
 * pagine di ricerca HubSpot, qualche secondo. E NON SVEGLIA IL DATABASE -
 * nemmeno per il setter mancante, vedi sotto - che e' la ragione per cui le
 * pagine aperte durante il giorno non costano niente su Neon.
 *
 * DUE LATI, COME LE DUE TABELLE. L'incasso va all'advisor che ha venduto
 * (`hubspot_owner_id`, la colonna della tabella Advisor) e al setter che ha
 * procurato l'appuntamento (`setter`, la colonna della tabella Setter). Sono
 * due persone diverse nel 39% dei casi. Chi disegna sceglie il lato secondo il
 * ruolo della riga, e per il totale di squadra ne somma uno solo, cosi' la
 * stessa vendita non si conta due volte.
 */
import { CHIUSURE_TIPOLOGIE, BOOM_TIPOLOGIE } from "@/lib/hubspotRegole";
import { estremiRoma, sfoglia } from "@/lib/report/giornaliero";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
/** Il valore interno, non l'etichetta "Richiesta rimborso" che si vede a schermo. */
const RIMBORSO = "recessed";

export type Soldi = {
  chiusure: number;
  /** L'importo delle sole chiusure: e' il "venduto" delle pagine. */
  venduto: number;
  /** Chiusure piu' rate piu' upgrade: e' la colonna Boom della Dashboard. */
  boom: number;
  storni: number;
  vendutoStornato: number;
  rate: number;
};

export type SoldiDiPersona = { advisor: Soldi; setter: Soldi };

export type BoomFinestra = {
  letto: string;
  finestra: { da: string; a: string };
  nomi: Record<string, string>;
  giorni: Record<string, Record<string, SoldiDiPersona>>;
};

const vuoti = (): Soldi => ({
  chiusure: 0,
  venduto: 0,
  boom: 0,
  storni: 0,
  vendutoStornato: 0,
  rate: 0
});

/** Il giorno di Roma di un istante, comunque sia scritto. */
function giornoRoma(grezzo: string | undefined): string {
  const v = (grezzo ?? "").trim();
  if (!v) return "";
  const ms = /^\d+$/.test(v) ? Number(v) : new Date(v).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date(ms));
}

/**
 * Il setter degli incassi che non lo portano scritto, risalendo alla
 * trattativa da cui nascono.
 *
 * E' lo stesso ripiego di completaSetter() in /api/hubspot-data: `setter` e'
 * compilato sull'87% degli incassi, `id_trattativa` sul 98%. Senza questo
 * passaggio un incasso su otto non arriverebbe a nessun setter.
 *
 * SI CHIEDE A HUBSPOT E NON AL DATABASE, al contrario della Dashboard: questa
 * funzione gira a ogni apertura di pagina, e Neon si paga a ore di accensione.
 * La differenza e' che HubSpot da' il setter di ADESSO mentre il database
 * darebbe quello congelato al giorno dell'appuntamento; sugli incassi di un
 * mese e' la stessa cosa, salvo che qualcuno riscriva il setter a cose fatte.
 */
async function setterDalleTrattative(token: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unici = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unici.length; i += 100) {
    const r = await fetch(`${HUBSPOT}/crm/v3/objects/deals/batch/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: ["setter"],
        inputs: unici.slice(i, i + 100).map((id) => ({ id }))
      })
    });
    // UNA TRATTATIVA CANCELLATA fa fallire tutto il blocco con 207/404: si
    // lascia perdere quel blocco invece di fermare tutto.
    if (!r.ok) continue;
    const d = (await r.json()) as {
      results?: Array<{ id: string; properties: Record<string, string> }>;
    };
    for (const t of d.results ?? []) {
      const s = (t.properties.setter ?? "").trim();
      if (s) out.set(t.id, s);
    }
  }
  return out;
}

export async function calcolaBoom(
  token: string,
  da: string,
  a: string,
  nomi: Map<string, string>,
  racconta: (riga: string) => void = () => {}
): Promise<BoomFinestra> {
  const estremi = { da: estremiRoma(da).da, a: estremiRoma(a).a };

  const incassi = await sfoglia(
    token,
    BOOM,
    [
      { propertyName: "data_di_pagamento", operator: "GTE", value: String(estremi.da) },
      { propertyName: "data_di_pagamento", operator: "LT", value: String(estremi.a) }
    ],
    [
      "data_di_pagamento",
      "importo",
      "tipologia_di_incasso",
      "boom_stage",
      "hubspot_owner_id",
      "setter",
      "id_trattativa"
    ],
    400
  );

  const senzaSetter = incassi
    .filter((b) => !(b.properties.setter ?? "").trim())
    .map((b) => (b.properties.id_trattativa ?? "").trim())
    .filter(Boolean);
  const dedotti = senzaSetter.length ? await setterDalleTrattative(token, senzaSetter) : new Map();
  racconta(`incassi: ${incassi.length}, senza setter ${senzaSetter.length}, dedotti ${dedotti.size}`);

  const giorni: Record<string, Record<string, SoldiDiPersona>> = {};
  const lato = (giorno: string, chi: string, quale: "advisor" | "setter"): Soldi | null => {
    const id = (chi ?? "").trim();
    if (!id) return null;
    giorni[giorno] ??= {};
    giorni[giorno][id] ??= { advisor: vuoti(), setter: vuoti() };
    return giorni[giorno][id][quale];
  };

  for (const b of incassi) {
    const g = giornoRoma(b.properties.data_di_pagamento);
    if (!g || g < da || g > a) continue;
    const importo = Number(b.properties.importo) || 0;
    const tipologia = (b.properties.tipologia_di_incasso ?? "").trim();
    const stornato = (b.properties.boom_stage ?? "").trim() === RIMBORSO;

    // SENZA PROPRIETARIO L'INCASSO SI SALTA, come fa /api/hubspot-data: un
    // incasso che non si sa di chi sia non appartiene a nessuna riga.
    const proprietario = (b.properties.hubspot_owner_id ?? "").trim();
    if (!proprietario) continue;
    const setter =
      (b.properties.setter ?? "").trim() ||
      dedotti.get((b.properties.id_trattativa ?? "").trim()) ||
      "";

    for (const [chi, quale] of [
      [proprietario, "advisor"],
      [setter, "setter"]
    ] as const) {
      const v = lato(g, chi, quale);
      if (!v) continue;
      if (CHIUSURE_TIPOLOGIE.has(tipologia)) {
        v.chiusure += 1;
        v.venduto += importo;
        if (stornato) {
          v.storni += 1;
          v.vendutoStornato += importo;
        }
      } else if (tipologia === "Rata") {
        v.rate += importo;
      }
      if (BOOM_TIPOLOGIE.has(tipologia)) v.boom += importo;
    }
  }

  const usati = new Set(Object.values(giorni).flatMap((p) => Object.keys(p)));
  return {
    letto: new Date().toISOString(),
    finestra: { da, a },
    nomi: Object.fromEntries([...usati].map((id) => [id, nomi.get(id) ?? `(proprietario ${id})`])),
    giorni
  };
}
