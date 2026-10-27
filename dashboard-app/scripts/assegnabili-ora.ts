/**
 * Quanti lead si possono davvero assegnare, adesso.
 *
 * COME SI LANCIA
 *   npx tsx scripts/assegnabili-ora.ts
 *
 * PERCHE' NON BASTA IL NUMERO DELL'APP. `pool_a` e `pool_b` che dichiara
 * l'app di assegnazione contano i contatti senza proprietario, e sono decine
 * di migliaia; quelli che passano tutti i filtri - eta' massima, stati
 * esclusi, lifecycle, campagne sospese - sono due ordini di grandezza meno.
 * Guardare solo il grezzo fa sembrare pieno un serbatoio che si sta svuotando.
 *
 * Usa la stessa funzione della Dashboard, non una copia: cosi' il numero e'
 * quello che vede la pagina, e la chiamata lascia anche la fotografia in
 * `assegnazione_pool` come farebbe un'apertura della pagina.
 */
import "./env";
import { assegnabili } from "../src/lib/assegnazioni/pool";

(async () => {
  const stato = await (await fetch("https://lms.217.154.117.118.nip.io/dispatch-api/assegnazione-stato",
    { headers: { Authorization: "Bearer " + process.env.LMS_ASSEGNAZIONI_TOKEN } })).json();

  const q = await assegnabili(process.env.HUBSPOT_PRIVATE_APP_TOKEN!, stato);

  const n = (v: unknown) => (v == null ? "non misurato" : Number(v).toLocaleString("it-IT"));
  const pct = (a: unknown, b: unknown) =>
    a == null || !Number(b) ? "" : ` (${(Number(a) / Number(b) * 100).toFixed(1)}% del grezzo)`;

  console.log("\nSERBATOIO ADESSO (" + new Date().toLocaleString("it-IT") + ")\n");
  console.log("  serie A   grezzo " + n(stato.pool_a).padStart(7) + "   assegnabili " + n(q?.serieA).padStart(7) + pct(q?.serieA, stato.pool_a));
  console.log("  serie B   grezzo " + n(stato.pool_b).padStart(7) + "   assegnabili " + n(q?.serieB).padStart(7) + pct(q?.serieB, stato.pool_b));
  console.log("  riserva   " + n(stato.riserva) + " su " + n(stato.riserva_max));
  console.log("\n  sistema acceso: " + stato.sistema_acceso + "   giorni: " + stato.giorni + "   live: " + stato.modalita_live);
  console.log("  assegnati oggi: " + n(stato.assegnati_oggi) + " a " + n(stato.persone_oggi) + " persone");
  console.log("  ultima assegnazione: " + stato.ultima_assegnazione);
  console.log("  fotografia scritta alle: " + (q?.presoAt ?? "-"));

  // QUANTO DURANO. Il mix standard dà 20 lead a richiesta; il rapporto fra i
  // due serbatoi lo decide la Dashboard (60/40 dal 22 ottobre 2026), quindi
  // non si divide il totale per 20: si guarda quale dei due finisce prima.
  const perRichiestaA = 12, perRichiestaB = 8;   // 60/40 su 20
  if (q?.serieA != null && q?.serieB != null) {
    const richiesteA = Math.floor(q.serieA / perRichiestaA);
    const richiesteB = Math.floor(q.serieB / perRichiestaB);
    console.log("\n  con il mix 60/40 (12 da A + 8 da B per richiesta):");
    console.log("    la serie A basta per " + richiesteA + " richieste");
    console.log("    la serie B basta per " + richiesteB + " richieste");
    console.log("    FINISCE PRIMA: serie " + (richiesteA <= richiesteB ? "A" : "B") +
      " -> " + Math.min(richiesteA, richiesteB) + " richieste, cioe' " +
      Math.min(richiesteA, richiesteB) * 20 + " lead");
  }
  process.exit(0);
})().catch((e) => { console.error("ERRORE:", e instanceof Error ? e.message : e); process.exit(1); });
