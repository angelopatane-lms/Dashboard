// COUNTDOWN SCADUTO -> CHATTER
//
// Codice dell'azione "Codice personalizzato" del flusso HubSpot "Countdown
// scaduto -> Chatter". Questa e' la copia di riferimento: se lo cambi su
// HubSpot, aggiorna anche questo file.
//
// LA REGOLA (decisa da Angelo il 26 ottobre 2026). Dall'ultima conversione del
// contatto, ogni volta che un SETTER perde la proprieta' perche' scade il
// countdown e' un ciclo. Il numero di cicli e' il cluster: 1° Ciclo, 2° Ciclo...
// fino all'8°, che vale anche per 8 e oltre. Restano fuori i contatti passati da
// un ADVISOR dopo l'ultima conversione e i clienti. Al massimo 100 per cluster
// al giorno.
//
// COME SI RICONOSCE LA SCADENZA. Il flusso "Countdown Stati Improduttivi -
// STEP 2", quando il countdown arriva a zero, scrive `dispatched` con l'ora e
// svuota il proprietario. Ogni ciclo lascia quindi una voce datata nella
// cronologia di `dispatched`; chi era proprietario prima si legge da quella di
// `hubspot_owner_id`. Setter o advisor e' il team PRINCIPALE di quella persona.
// Un utente disattivato non ha piu' team: i suoi cicli non si contano.
//
// I CHATTER NON CONTANO (deciso da Angelo il 26 ottobre 2026). Anche loro hanno
// team principale Setter, ma in piu' il team Chatter. Mihai riassegna i
// contatti ai suoi chatter e il countdown riparte: se scade, il contatto NON
// torna a Mihai, va nel serbatoio normale per i setter. E il giro dai chatter
// non e' un ciclo.
//
// MODALITA'. Con ATTIVO = false (prova) scrive solo "Cluster Chatter
// (simulato)" e la data, e il proprietario non si tocca. Con ATTIVO = true
// assegna a Mihai Pislaru e scrive "Cluster Chatter".

const ATTIVO = false;

const MIHAI = "39286816";
const MASSIMO_PER_CLUSTER = 100;
const ULTIMO_CLUSTER = 8;
// Proprieta' tolta e voce di `dispatched` sono la stessa azione del flusso.
const STESSA_AZIONE_MS = 10 * 60 * 1000;
const PROPRIETA_CLUSTER = ATTIVO ? "cluster_chatter" : "cluster_chatter_simulato";

exports.main = async (event, callback) => {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const id = String(event.object.objectId);

  const api = async (percorso, opzioni = {}) => {
    for (let i = 0; i < 4; i++) {
      const r = await fetch("https://api.hubapi.com" + percorso, {
        ...opzioni,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      });
      if (r.status === 429 || r.status >= 500) {
        await new Promise((ok) => setTimeout(ok, 1000 * (i + 1)));
        continue;
      }
      if (!r.ok) throw new Error(`HubSpot ${r.status} su ${percorso.split("?")[0]}: ${(await r.text()).slice(0, 200)}`);
      return r.status === 204 ? null : r.json();
    }
    throw new Error(`HubSpot non risponde su ${percorso.split("?")[0]}`);
  };

  const fine = (esito, ciclo, motivo) => {
    console.log(`${id}: ${esito}${ciclo ? ` (${ciclo}° Ciclo)` : ""} - ${motivo}`);
    callback({ outputFields: { esito, ciclo: ciclo || 0, motivo } });
  };

  try {
    const c = await api(
      `/crm/v3/objects/contacts/${id}?properties=hubspot_owner_id,hs_lead_status,lifecyclestage,recent_conversion_date,dispatch_outcome` +
        `&propertiesWithHistory=hubspot_owner_id,dispatched`
    );
    const p = c.properties || {};
    // Arrivato tardi: l'app di Alessio l'ha gia' dato a un altro setter.
    if (p.hubspot_owner_id) return fine("scartato", 0, "ha gia' un nuovo proprietario");
    if (p.hs_lead_status === "Cliente" || p.lifecyclestage === "customer") return fine("scartato", 0, "cliente");
    if (p.dispatch_outcome !== "serie_a" && p.dispatch_outcome !== "serie_b") {
      return fine("scartato", 0, `esito del countdown ${p.dispatch_outcome || "vuoto"}`);
    }

    // Setter o advisor, dal team principale di ogni owner.
    const ruolo = new Map();
    for (const archiviati of [false, true]) {
      let dopo;
      do {
        const d = await api(`/crm/v3/owners?limit=100&archived=${archiviati}${dopo ? `&after=${dopo}` : ""}`);
        for (const o of d.results || []) {
          const t = (o.teams || []).find((x) => x.primary);
          const chatter = (o.teams || []).some((x) => x.name === "Chatter");
          if (t && t.name === "Setter") ruolo.set(String(o.id), chatter ? "chatter" : "setter");
          if (t && t.name === "Advisor") ruolo.set(String(o.id), "advisor");
        }
        dopo = d.paging && d.paging.next && d.paging.next.after;
      } while (dopo);
    }

    const conversione = Date.parse(p.recent_conversion_date || "") || 0;
    const storia = (nome) =>
      ((c.propertiesWithHistory || {})[nome] || [])
        .map((h) => ({ t: Date.parse(h.timestamp), v: h.value || "" }))
        .sort((a, b) => a.t - b.t);
    const proprietari = storia("hubspot_owner_id");
    const scadenze = storia("dispatched").filter((h) => h.t >= conversione);

    if (proprietari.some((h) => h.t >= conversione && h.v && ruolo.get(h.v) === "advisor")) {
      return fine("scartato", 0, "passato da un advisor dopo l'ultima conversione");
    }

    let cicli = 0;
    let ultimo = "";
    for (const s of scadenze) {
      const tolto = proprietari.find((h) => !h.v && Math.abs(h.t - s.t) <= STESSA_AZIONE_MS);
      if (!tolto) continue;
      // Il proprietario che c'era appena prima che il flusso lo togliesse.
      const prima = proprietari.filter((h) => h.t < tolto.t && h.v).pop();
      ultimo = prima ? ruolo.get(prima.v) || "" : "";
      if (ultimo === "setter") cicli++;
    }
    // L'ha appena perso un chatter: torna al serbatoio dei setter, non a Mihai.
    if (ultimo === "chatter") return fine("scartato", 0, "perso da un chatter: resta ai setter");
    if (!cicli) return fine("scartato", 0, "nessun ciclo da setter dall'ultima conversione");
    const ciclo = Math.min(cicli, ULTIMO_CLUSTER);

    // Quanti ne sono gia' passati oggi per questo cluster (giorno di Roma).
    const oggi = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
    const [a, m, g] = oggi.split("-").map(Number);
    const utc = Date.UTC(a, m - 1, g);
    const oraRoma = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date(utc))
    );
    const mezzanotte = utc - oraRoma * 3600 * 1000;
    const conteggio = await api("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: PROPRIETA_CLUSTER, operator: "EQ", value: `ciclo_${ciclo}` },
              { propertyName: "data_cluster_chatter", operator: "GTE", value: String(mezzanotte) }
            ]
          }
        ],
        limit: 1
      })
    });
    if ((conteggio.total || 0) >= MASSIMO_PER_CLUSTER) {
      return fine("oltre_quota", ciclo, `gia' ${MASSIMO_PER_CLUSTER} oggi per il ${ciclo}° Ciclo`);
    }

    const proprieta = { [PROPRIETA_CLUSTER]: `ciclo_${ciclo}`, data_cluster_chatter: new Date().toISOString() };
    if (ATTIVO) proprieta.hubspot_owner_id = MIHAI;
    await api(`/crm/v3/objects/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ properties: proprieta }) });
    return fine(ATTIVO ? "assegnato" : "simulato", ciclo, ATTIVO ? "assegnato a Mihai Pislaru" : "prova: sarebbe andato a Mihai");
  } catch (e) {
    return fine("errore", 0, e instanceof Error ? e.message : String(e));
  }
};
