/** Valid PDFs for 007 e2e tests — same generators as backend/tests/pdf_fixtures.py. */

const enc = (s: string) => Buffer.from(s, "latin1");
const escape = (t: string) => t.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function build(objects: Buffer[], trailerExtra = ""): Buffer {
  const parts: Buffer[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let length = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([enc(`${i + 1} 0 obj\n`), body, enc("\nendobj\n")]);
    parts.push(chunk);
    length += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(enc(xref));
  return Buffer.concat(parts);
}

function pdf(contents: string[], annots: string[][] = [], trailerExtra = "", pagesFirst = false): Buffer {
  const objects: Buffer[] = [enc("<< /Type /Catalog /Pages 2 0 R >>"), enc(""), enc("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")];
  const kids: string[] = [];
  let next = 4;
  const streams: Buffer[] = [];
  contents.forEach((content, i) => {
    const pageAnnots = annots[i] ?? [];
    const pageId = next;
    const contentId = pagesFirst ? 4 + contents.length + i : next + 1;
    next += pagesFirst ? 1 : 2;
    kids.push(`${pageId} 0 R`);
    const annotIds = pageAnnots.map(() => next++);
    const annotRef = annotIds.length ? ` /Annots [${annotIds.map((a) => `${a} 0 R`).join(" ")}]` : "";
    objects.push(enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R${annotRef} >>`));
    const stream = enc(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    if (pagesFirst) streams.push(stream);
    else objects.push(stream);
    for (const a of pageAnnots) objects.push(enc(a));
  });
  objects.push(...streams);
  objects[1] = enc(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${contents.length} >>`);
  return build(objects, trailerExtra);
}

const text = (lines: string[]) => ["BT /F1 18 Tf 72 720 Td 24 TL", ...lines.map((l) => `(${escape(l)}) Tj T*`), "ET"].join("\n");

export function textPdf(pages = 3, label = "Lecture notes", extraLine = "A red-black tree is balanced."): Buffer {
  return pdf(Array.from({ length: pages }, (_, i) => text([`${label} - page ${i + 1}`, extraLine])));
}

/**
 * Many pages, each padded with filler so the file is large (performance and range-loading
 * checks). Page dictionaries come first, as in PDFs from current producers (object streams near
 * the start): pdf.js opens a document only after checking its last page, which in a file with
 * page dictionaries spread between large contents means reading nearly the whole file first.
 */
export function bigTextPdf(pages: number, bytesPerPage = 0): Buffer {
  const filler = bytesPerPage ? `\n% ${"x".repeat(bytesPerPage)}` : "";
  return pdf(
    Array.from({ length: pages }, (_, i) => text([`Paper - page ${i + 1}`, i % 100 === 7 ? "the tree word appears here" : "plain text"]) + filler),
    [],
    "",
    true,
  );
}

export function imageOnlyPdf(pages = 2): Buffer {
  return pdf(Array.from({ length: pages }, () => "0.6 g 72 72 468 648 re f"));
}

export function encryptedPdf(): Buffer {
  return pdf([text(["secret"])], [], "/Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >> ");
}

export function annotatedPdf(): Buffer {
  return pdf(
    [text(["Annotated page"])],
    [[
      "<< /Type /Annot /Subtype /Highlight /Rect [70 710 300 740] /QuadPoints [70 740 300 740 70 710 300 710] /C [1 1 0] /Contents (lecturer) >>",
      "<< /Type /Annot /Subtype /Text /Rect [400 700 420 720] /Contents (Check this) >>",
    ]],
  );
}

/** Page 1 links to page 3 (object 10) and to a web address. */
export function linkedPdf(): Buffer {
  return pdf(
    [text(["Go to page 3", "Course site"]), text(["Page 2"]), text(["Page 3"])],
    [[
      "<< /Type /Annot /Subtype /Link /Rect [72 700 300 730] /Border [0 0 0] /Dest [10 0 R /Fit] >>",
      "<< /Type /Annot /Subtype /Link /Rect [72 650 300 680] /Border [0 0 0] /A << /S /URI /URI (https://example.edu/) >> >>",
    ], [], []],
  );
}
