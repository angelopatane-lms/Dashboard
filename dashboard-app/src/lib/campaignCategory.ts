// Categoria di una campagna, dedotta dal nome (id_campagna_refresh).
//
// LA REGOLA E' QUELLA DEL DIPARTIMENTO MARKETING, riportata qui sotto alla
// lettera: si guarda se il nome CONTIENE una certa sottostringa, e vince la
// prima riga dell'elenco che trova corrispondenza.
//
// Il trattino basso finale non e' un dettaglio: e' quello che impedisce a
// "lms_mep_ew_imprenditore_assente" di finire in Imprenditoria, visto che
// contiene "imprenditore_" ma non "imprenditoria_". Prima di questa versione il
// confronto era per token con qualche match per prefisso, e quella campagna
// finiva davvero nella categoria sbagliata.
//
// DUE CONSEGUENZE DA CONOSCERE, misurate sulle 1.870 campagne conformi:
//
// 1. Un nome che FINISCE col codice non ha il trattino basso dopo, quindi non
//    corrisponde e resta in "Altro": 28 campagne e 22.862 eventi, fra cui
//    "chatter_mep" (14.774) e "chatter_rem" (5.519). E' cosi' anche nel foglio
//    di partenza; se un giorno si volesse recuperarle basta accettare il codice
//    anche a fine stringa.
//
// 2. Quando un nome contiene due codici vince quello piu' in alto nell'elenco,
//    non quello che compare prima nel nome. Riguarda 4 campagne e 920 eventi:
//    "icmd_mep_persi" e "icmd_mep_calendario_dell_avvento" vanno in MEP, non in
//    ICMD.
type CategoryDef = { label: string; contiene: string[] };

const CATEGORY_DEFS: CategoryDef[] = [
  { label: "DIV COACH", contiene: ["div_coach_"] },
  { label: "Imprenditoria", contiene: ["imprenditoria_"] },
  { label: "MBE MKTG", contiene: ["mbe_mktg_"] },
  { label: "MBE MNGT", contiene: ["mbe_mngt_"] },
  // Le due eccezioni sono campagne MBE che non portano "mbe" nel nome. Si
  // tirano dietro le varianti con i suffissi soliti, quindi coprono 8 campagne
  // e 2.793 eventi: le tre famiglie "le_7_frasi", "vendite_artificiali_webinar"
  // e "sales_skills". Nessuna di queste era gia' classificata altrove.
  { label: "MBE SALES", contiene: ["mbe_sales_", "lms_sales_", "lms_ew_sales_"] },
  { label: "MEP", contiene: ["mep_"] },
  { label: "REM", contiene: ["rem_"] },
  { label: "ADE", contiene: ["ade_"] },
  // Unico codice che vale anche senza trattino basso: copre "icmd13_...",
  // "icmd7_..." e simili.
  { label: "ICMD", contiene: ["icmd_", "icmd"] }
];

export function guessCategoria(campagna: string): string {
  const nome = campagna.trim().toLowerCase();
  if (!nome) return "Nessuna";

  for (const def of CATEGORY_DEFS) {
    if (def.contiene.some((frammento) => nome.includes(frammento))) return def.label;
  }
  return "Altro";
}
