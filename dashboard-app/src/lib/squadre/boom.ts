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
import { campagnaEffettiva } from "@/lib/campagnaEffettiva";
import { guessCategoria } from "@/lib/campaignCategory";
import { categoriaProdotto, eBigliettoEvento, CATEGORIE_PRODOTTO } from "@/lib/squadre/prodotti";
import { estremiRoma, sfoglia } from "@/lib/report/giornaliero";

const HUBSPOT = "https://api.hubapi.com";
const BOOM = "2-130365112";
/** Il valore interno, non l'etichetta "Richiesta rimborso" che si vede a schermo. */
const RIMBORSO = "recessed";

export type Soldi = {
  chiusure: number;
  /** L'incassato del periodo - chiusure, rate e upgrade - che al netto degli
   *  storni e' il "venduto netto" delle pagine. Vedi il commento nel calcolo. */
  venduto: number;
  /** Chiusure piu' rate piu' upgrade: e' la colonna Boom della Dashboard. */
  boom: number;
  storni: number;
  vendutoStornato: number;
  rate: number;
};

/**
 * I SOLDI DI UNA PERSONA IN UN GIORNO, TRE VOLTE.
 *
 * `advisor` e `setter` sono tutto quello che quella persona ha chiuso o
 * procurato, ed e' il numero di sempre: il filtro "Categoria" delle pagine
 * squadre, nel modo *persona*, legge questi e nient'altro.
 *
 * `perProdotto` e `perCampagna` sono gli stessi soldi divisi per categoria -
 * REM, DIV COACH, MBE MKTG, MBE MNGT, MBE SALES - una volta secondo il
 * prodotto venduto e una secondo la campagna da cui l'incasso viene. Chi
 * disegna somma la categoria della propria squadra, che `squadre.json`
 * dichiara una volta sola in `categorie`.
 *
 * SI DIVIDE QUI E NON SI MANDANO I RECORD. Un elenco di incassi sarebbe piu'
 * flessibile, ma su una finestra lunga diventano migliaia di righe con
 * dentro prodotto e campagna di ogni vendita: dati che al browser non
 * servono e che su quelle pagine viaggiano con i nomi delle persone accanto.
 *
 * LE CATEGORIE ASSENTI NON COMPAIONO, e nemmeno i lati: un giorno senza
 * vendite REM non porta una chiave "REM" a zero, e un incasso di cui non si
 * sa il setter non porta un `setter` di zeri. Chi legge somma quello che
 * trova. Misurato su 48 giorni di storico: 129 KB tenendo i lati vuoti.
 */
export type SoldiDiPersona = {
  advisor: Soldi;
  setter: Soldi;
  perProdotto?: Record<string, { advisor?: Soldi; setter?: Soldi }>;
  perCampagna?: Record<string, { advisor?: Soldi; setter?: Soldi }>;
  /**
   * I SOLI BIGLIETTI DELL'EVENTO, da togliere.
   *
   * Il filtro non li vuole in nessuno dei tre modi - deciso da Angelo il 17
   * novembre 2026 - e anche il modo *persona*, che mostra tutto il resto, li
   * lascia fuori. Si mandano come insieme a parte invece di spedire un terzo
   * totale gia' ripulito: cosi' chi legge sottrae quando serve, e chi non
   * sottrae - la pagina della squadra ICMD, che di biglietti vive - continua
   * a vedere i numeri interi senza sapere che questa chiave esiste.
   */
  biglietti?: { advisor?: Soldi; setter?: Soldi };
};

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
      "id_trattativa",
      // IL PRODOTTO E LA CAMPAGNA, per il filtro "Categoria". Sono proprieta'
      // dello stesso oggetto: non costano una chiamata in piu'. La campagna
      // sono tre campi e non uno, perche' per gli incassi nati prima del 27
      // agosto 2026 quello buono e' `track_last` - vedi campagnaEffettiva().
      "prodotto",
      "id_campagna_track",
      "id_campagna_track_last",
      "hs_createdate"
    ],
    400
  );

  const senzaSetter = incassi
    .filter((b) => !(b.properties.setter ?? "").trim())
    .map((b) => (b.properties.id_trattativa ?? "").trim())
    .filter(Boolean);
  const dedotti = senzaSetter.length ? await setterDalleTrattative(token, senzaSetter) : new Map();
  racconta(`incassi: ${incassi.length}, senza setter ${senzaSetter.length}, dedotti ${dedotti.size}`);

  /** Il vocabolario del filtro: le categorie che una squadra ha davvero. */
  const sueCategorie = new Set(CATEGORIE_PRODOTTO.map((c) => c.etichetta));

  const giorni: Record<string, Record<string, SoldiDiPersona>> = {};
  const lato = (giorno: string, chi: string, quale: "advisor" | "setter"): Soldi | null => {
    const id = (chi ?? "").trim();
    if (!id) return null;
    giorni[giorno] ??= {};
    giorni[giorno][id] ??= { advisor: vuoti(), setter: vuoti() };
    return giorni[giorno][id][quale];
  };

  /** I biglietti dell'evento di quella persona, in quel giorno, da quel lato. */
  const latoBiglietti = (giorno: string, chi: string, quale: "advisor" | "setter"): Soldi | null => {
    const id = (chi ?? "").trim();
    if (!id) return null;
    const cella = giorni[giorno]?.[id];
    if (!cella) return null;
    const voce = (cella.biglietti ??= {});
    voce[quale] ??= vuoti();
    return voce[quale]!;
  };

  /**
   * La stessa cella, ma dentro una categoria.
   *
   * Si crea solo quando quell'incasso ha davvero una categoria: le vendite di
   * prodotti che non sono di nessuna squadra - MEP, LIFE, Academy, i biglietti
   * ICMD - non entrano in nessuna chiave, e nel modo prodotto non si vedono.
   * E' il senso del filtro.
   */
  const latoDi = (
    dove: "perProdotto" | "perCampagna",
    categoria: string | null,
    giorno: string,
    chi: string,
    quale: "advisor" | "setter"
  ): Soldi | null => {
    const id = (chi ?? "").trim();
    if (!id || !categoria) return null;
    // La cella principale esiste sempre prima: la crea `lato` qui sopra, che
    // viene chiamata per lo stesso incasso.
    const cella = giorni[giorno]?.[id];
    if (!cella) return null;
    const per = (cella[dove] ??= {});
    const voce = (per[categoria] ??= {});
    // SOLO IL LATO CHE RICEVE: per ogni incasso si tocca un lato alla volta,
    // e creare anche l'altro vorrebbe dire spedire meta' risposta di zeri.
    voce[quale] ??= vuoti();
    return voce[quale]!;
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

    // LE DUE CATEGORIE DI QUESTO INCASSO, per il filtro delle pagine squadre.
    // `null` vuol dire "di nessuna squadra", e in quel caso l'incasso resta
    // soltanto nel totale della persona: e' quello che il filtro deve fare.
    const catProdotto = categoriaProdotto(b.properties.prodotto);
    // SOLO LE CATEGORIE CHE UNA SQUADRA HA. guessCategoria risponde sempre
    // qualcosa - MEP, ICMD, Imprenditoria, "Altro", "Nessuna" - e nessuna di
    // quelle e' la categoria di una delle cinque squadre commerciali: tenerle
    // vorrebbe dire spedire a ogni pagina mezza dozzina di chiavi che nessuno
    // legge, con i nomi delle persone accanto. Il vocabolario e' quello dei
    // prodotti, cosi' le due dimensioni del filtro parlano la stessa lingua.
    const trovata = guessCategoria(
      campagnaEffettiva(
        b.properties.id_campagna_track,
        b.properties.id_campagna_track_last,
        Date.parse(b.properties.hs_createdate ?? "")
      )
    );
    // ANCHE QUI SOLO HIGH TICKET. Il modo campagna guarda da dove viene il
    // lead, quindi un biglietto ICMD comprato da un lead arrivato con una
    // campagna REM finirebbe nella riga di REM: dal 1 ottobre sono 17
    // biglietti, una chiusura su cinque di quelle che il filtro mostrerebbe.
    // Deciso da Angelo il 17 novembre 2026, per la stessa ragione per cui i
    // biglietti sono gia' fuori dal modo prodotto.
    const catCampagna =
      sueCategorie.has(trovata) && !eBigliettoEvento(b.properties.prodotto) ? trovata : null;

    for (const [chi, quale] of [
      [proprietario, "advisor"],
      [setter, "setter"]
    ] as const) {
      const principale = lato(g, chi, quale);
      if (!principale) continue;
      // LO STESSO INCASSO IN TRE POSTI: il totale della persona, la sua
      // categoria di prodotto e la sua categoria di campagna. Non sono tre
      // somme diverse - sono la stessa somma scritta tre volte - quindi la
      // regola sta in una funzione sola: scriverla tre volte vorrebbe dire
      // che fra sei mesi due copie dicono una cosa e la terza un'altra.
      const celle = [
        principale,
        latoDi("perProdotto", catProdotto, g, chi, quale),
        latoDi("perCampagna", catCampagna, g, chi, quale),
        eBigliettoEvento(b.properties.prodotto) ? latoBiglietti(g, chi, quale) : null
      ];
      for (const v of celle) {
      if (!v) continue;
      /**
       * IL VENDUTO E' L'INCASSATO, MENO GLI STORNI. Deciso l'11 novembre 2026.
       *
       * Prima erano soltanto Acconto e Quota unica: rate e upgrade restavano
       * fuori. Due conseguenze, tutte e due sbagliate. La prima: un contratto
       * da 5.000 euro con 1.000 di acconto entrava per 1.000, e gli altri
       * 4.000 non comparivano in nessun mese, perche' arrivavano come rate.
       * La seconda: la colonna Boom della Dashboard quelle rate le conta, e
       * la stessa persona nello stesso periodo aveva due cifre diverse sulle
       * due pagine, senza che nulla lo dicesse.
       *
       * Adesso il venduto netto delle squadre e' la colonna Boom della
       * Dashboard meno i recessi: una parola, un numero, in tutte e due le
       * pagine.
       *
       * LE CHIUSURE RESTANO IL CONTEGGIO DELLE VENDITE NUOVE - Acconto e
       * Quota unica - perche' quello e' il numero di trattative chiuse, e una
       * rata non e' una vendita in piu'. E' la ragione per cui il rapporto
       * "conversione" continua a tornare.
       */
      if (CHIUSURE_TIPOLOGIE.has(tipologia)) {
        v.chiusure += 1;
        if (stornato) v.storni += 1;
      } else if (tipologia === "Rata") {
        v.rate += importo;
      }
      if (BOOM_TIPOLOGIE.has(tipologia)) {
        v.boom += importo;
        v.venduto += importo;
        // Lo storno toglie quello che aveva aggiunto, qualunque tipologia sia:
        // un rimborso su una rata e' denaro uscito come gli altri.
        if (stornato) v.vendutoStornato += importo;
      }
      }
    }
  }

  const usati = new Set(Object.values(giorni).flatMap((p) => Object.keys(p)));
  return {
    letto: new Date().toISOString(),
    finestra: { da, a },
    // SENZA L'ANAGRAFICA SI LASCIA VUOTO invece di riempire di
    // "(proprietario 12345)": chi chiama senza passarla non vuole i nomi, e
    // un dizionario di segnaposto si legge come un guasto.
    nomi: nomi.size
      ? Object.fromEntries([...usati].map((id) => [id, nomi.get(id) ?? `(proprietario ${id})`]))
      : {},
    giorni
  };
}
