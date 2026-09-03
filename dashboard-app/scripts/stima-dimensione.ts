// Stima rigorosa di quante righe produrra' il bootstrap, e quindi di quanto
// spazio serve su Postgres.
//
// PERCHE' SERVE: campionare i primi N contatti da' un risultato falsato. Gli
// id HubSpot crescono nel tempo, quindi i primi id sono i contatti piu'
// vecchi, che avendo avuto anni per convertire hanno molti piu' eventi della
// media. Nel nostro portale il campione dai primi id dava 7,72 conversioni per
// contatto, quello a meta' 2,00: una differenza che sposta la stima da "serve
// un piano a pagamento" a "il piano gratuito basta".
//
// COME FUNZIONA
// 1. Ricostruisce la distribuzione reale dei contatti nello spazio degli id,
//    chiedendo a HubSpot quanti contatti stanno sotto una serie di soglie
//    (il campo "total" della ricerca costa una sola richiesta).
// 2. Da quella distribuzione ricava N fasce di uguale POPOLAZIONE (non di
//    uguale ampiezza di id).
// 3. Campiona lo stesso numero di contatti in ogni fascia.
// 4. La media delle medie di fascia e' una stima corretta per la popolazione.
//
// Uso: npm run stima:dimensione

import { richiedi } from "./env";
import { leggiCronologiaContatti } from "../src/lib/campaignConversions/hubspotSync";

const HUBSPOT_API = "https://api.hubapi.com";
const PROPRIETA = "id_campagna_refresh";

const FASCE = 8;
const CONTATTI_PER_FASCIA = 250;
const BYTE_PER_RIGA = 135;
const LIMITE_PIANO_GRATUITO_MB = 500;

const token = richiedi("HUBSPOT_PRIVATE_APP_TOKEN");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function cerca(corpo: Record<string, unknown>): Promise<any> {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });
    if (res.ok) return res.json();
    if (res.status === 429 && tentativo < 3) {
      await sleep(1000 * (tentativo + 1));
      continue;
    }
    throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
  }
  throw new Error("Troppi tentativi");
}

/** Quanti contatti con la proprieta' valorizzata hanno id < soglia. */
async function quantiSotto(soglia: number): Promise<number> {
  const d = await cerca({
    limit: 1,
    properties: ["hs_object_id"],
    filterGroups: [
      {
        filters: [
          { propertyName: PROPRIETA, operator: "HAS_PROPERTY" },
          { propertyName: "hs_object_id", operator: "LT", value: String(soglia) }
        ]
      }
    ]
  });
  await sleep(150);
  return Number(d.total ?? 0);
}

/** I primi `quanti` contatti con id > daId. */
async function contattiDa(daId: number, quanti: number): Promise<string[]> {
  const ids: string[] = [];
  let cursore = daId;
  while (ids.length < quanti) {
    const d = await cerca({
      limit: 100,
      properties: ["hs_object_id"],
      sorts: [{ propertyName: "hs_object_id", direction: "ASCENDING" }],
      filterGroups: [
        {
          filters: [
            { propertyName: PROPRIETA, operator: "HAS_PROPERTY" },
            { propertyName: "hs_object_id", operator: "GT", value: String(cursore) }
          ]
        }
      ]
    });
    const risultati: Array<{ id: string }> = d.results ?? [];
    if (!risultati.length) break;
    for (const r of risultati) if (ids.length < quanti) ids.push(r.id);
    cursore = Number(risultati[risultati.length - 1].id);
    await sleep(150);
  }
  return ids;
}

async function main() {
  console.log("[stima] ricostruzione della distribuzione dei contatti...\n");

  const totale = await quantiSotto(Number.MAX_SAFE_INTEGER);
  console.log(`  Contatti con ${PROPRIETA} valorizzata: ${totale.toLocaleString("it-IT")}\n`);

  const estremo = await cerca({
    limit: 1,
    properties: ["hs_object_id"],
    sorts: [{ propertyName: "hs_object_id", direction: "DESCENDING" }],
    filterGroups: [{ filters: [{ propertyName: PROPRIETA, operator: "HAS_PROPERTY" }] }]
  });
  const maxId = Number(estremo.results?.[0]?.id ?? 0);

  // Sonde a spaziatura logaritmica: gli id vanno da poche decine a centinaia
  // di miliardi, quindi una spaziatura lineare sprecherebbe quasi tutte le
  // sonde nella coda alta.
  const sonde: Array<{ id: number; sotto: number }> = [];
  for (let e = 2; e <= 12; e += 0.5) {
    const id = Math.round(Math.pow(10, e));
    sonde.push({ id, sotto: await quantiSotto(id) });
  }

  console.log("  Distribuzione (quanti contatti sotto una certa soglia di id):");
  for (const s of sonde) {
    const pct = (s.sotto / totale) * 100;
    if (s.sotto > 0 && s.sotto < totale) {
      console.log(`    id < ${s.id.toExponential(1).padStart(9)}  ${String(s.sotto).padStart(7)}  ${pct.toFixed(1).padStart(5)}%`);
    }
  }

  // Confini di fascia: gli id che tagliano la popolazione in FASCE parti uguali.
  //
  // Le sonde logaritmiche da sole non bastano: sono troppo distanti fra loro e
  // piu' fasce finirebbero sullo stesso id, campionando tre volte gli stessi
  // contatti e falsando la media. Si usano quindi solo per restringere
  // l'intervallo, e dentro quell'intervallo si cerca il confine per bisezione.
  const cercaConfine = async (bersaglio: number): Promise<number> => {
    let basso = 0;
    let alto = Number(maxId);
    for (const s of sonde) {
      if (s.sotto <= bersaglio && s.id > basso) basso = s.id;
      if (s.sotto >= bersaglio && s.id < alto) alto = s.id;
    }
    // ~25 bisezioni bastano a inchiodare il confine anche su 12 ordini di
    // grandezza; ci si ferma prima se l'intervallo e' gia' stretto.
    for (let i = 0; i < 25 && alto - basso > 1000; i++) {
      const mezzo = Math.floor(basso + (alto - basso) / 2);
      const sotto = await quantiSotto(mezzo);
      if (sotto < bersaglio) basso = mezzo;
      else alto = mezzo;
    }
    return basso;
  };

  const confini: number[] = [0];
  for (let k = 1; k < FASCE; k++) {
    confini.push(await cercaConfine((totale * k) / FASCE));
  }

  // Se due confini coincidono le fasce si sovrapporrebbero: meglio saperlo.
  const distinti = new Set(confini);
  if (distinti.size !== confini.length) {
    console.log("\n  ATTENZIONE: alcuni confini di fascia coincidono, la stima e' meno affidabile.");
  }

  console.log(`\n[stima] campionamento di ${CONTATTI_PER_FASCIA} contatti in ognuna delle ${FASCE} fasce...\n`);

  const medieFascia: number[] = [];
  let eventiTotali = 0;
  let contattiTotali = 0;
  let alTetto = 0;

  for (let k = 0; k < FASCE; k++) {
    const ids = await contattiDa(confini[k], CONTATTI_PER_FASCIA);
    if (!ids.length) continue;

    let eventiFascia = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const gruppo = ids.slice(i, i + 50);
      const dettagli = await leggiCronologiaContatti(token, gruppo);
      for (const id of gruppo) {
        const info = dettagli.get(id);
        if (!info) continue;
        const validi = info.history.filter(
          (v) => (v.value ?? "").trim() && !Number.isNaN(new Date(v.timestamp).getTime())
        );
        eventiFascia += validi.length;
        if (validi.length >= 45) alTetto += 1;
      }
      await sleep(100);
    }

    const media = eventiFascia / ids.length;
    medieFascia.push(media);
    eventiTotali += eventiFascia;
    contattiTotali += ids.length;
    console.log(
      `  Fascia ${k + 1}/${FASCE}  (id > ${confini[k].toExponential(1)})  ` +
        `${ids.length} contatti, ${eventiFascia} eventi, media ${media.toFixed(2)}`
    );
  }

  // Ogni fascia pesa uguale perche' contiene la stessa quota di popolazione.
  const mediaPesata = medieFascia.reduce((a, b) => a + b, 0) / medieFascia.length;
  const mediaGrezza = eventiTotali / contattiTotali;

  const righe = totale * mediaPesata;
  const mb = (righe * BYTE_PER_RIGA) / 1_000_000;

  console.log("\n" + "=".repeat(64));
  console.log("  STIMA FINALE");
  console.log("=".repeat(64));
  console.log(`  Contatti da processare............ ${totale.toLocaleString("it-IT")}`);
  console.log(`  Campione totale................... ${contattiTotali.toLocaleString("it-IT")} contatti`);
  console.log(`  Conversioni per contatto (pesata). ${mediaPesata.toFixed(2)}`);
  console.log(`  Conversioni per contatto (grezza). ${mediaGrezza.toFixed(2)}`);
  console.log(`  Contatti al tetto delle 45........ ${alTetto} (${((alTetto / contattiTotali) * 100).toFixed(2)}%)`);
  console.log("");
  console.log(`  Righe attese...................... ~${Math.round(righe).toLocaleString("it-IT")}`);
  console.log(`  Spazio su Postgres................ ~${Math.round(mb)} MB`);
  console.log(`  Piano gratuito Neon............... ${LIMITE_PIANO_GRATUITO_MB} MB`);
  console.log(`  Margine........................... ${(LIMITE_PIANO_GRATUITO_MB - mb).toFixed(0)} MB (${((mb / LIMITE_PIANO_GRATUITO_MB) * 100).toFixed(0)}% usato)`);
  console.log("");

  if (mb > LIMITE_PIANO_GRATUITO_MB) {
    console.log("  ESITO: il piano gratuito NON basta. Serve il piano a consumo.");
  } else if (mb > LIMITE_PIANO_GRATUITO_MB * 0.8) {
    console.log("  ESITO: ci si sta, ma senza margine. Crescendo si sfora entro pochi mesi.");
  } else {
    console.log("  ESITO: il piano gratuito basta con margine.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("[stima] fallita:", err instanceof Error ? err.message : err);
  process.exit(1);
});
