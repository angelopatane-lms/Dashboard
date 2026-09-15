import JSZip from "jszip";

/**
 * Un documento Word minimo a partire da righe di testo.
 *
 * PERCHE' UN .DOCX E NON TESTO SEMPLICE. L'applicazione che produce l'analisi
 * delle call scaricava dal contatto un indirizzo generato dal connettore
 * Fireflies, e quel file era un .docx: lo ha letto per mesi, quindi quel
 * formato lo sa gestire. Dandogliene uno uguale non deve cambiare niente - ed
 * e' l'unica strada praticabile quando chi lo manterrebbe non e' raggiungibile.
 *
 * Un .docx e' uno ZIP con dentro tre file XML. Non serve una libreria che
 * costruisca documenti: serve un documento che si apra, e questo si apre in
 * Word, in Google Documenti e in qualunque estrattore di testo.
 */

/** I caratteri di controllo che Word rifiuta senza spiegare perche'. In una
 *  trascrizione non significano niente, quindi si tolgono. */
const CONTROLLO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function xml(testo: string): string {
  return testo
    .replace(CONTROLLO, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TIPI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELAZIONI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export async function documentoWord(righe: string[]): Promise<Buffer> {
  // xml:space="preserve" tiene gli spazi a inizio e fine riga: senza, Word li
  // mangia e due battute finiscono attaccate.
  const paragrafi = righe
    .map((r) => `<w:p><w:r><w:t xml:space="preserve">${xml(r)}</w:t></w:r></w:p>`)
    .join("");

  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragrafi}<w:sectPr/></w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", TIPI);
  zip.folder("_rels")!.file(".rels", RELAZIONI);
  zip.folder("word")!.file("document.xml", documento);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
