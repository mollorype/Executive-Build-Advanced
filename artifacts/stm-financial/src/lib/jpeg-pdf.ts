// A minimal PDF writer: one JPEG image filling each A4 page.
//
// Used for the customer debt statement. The statement is drawn by the browser
// (which shapes Burmese text correctly — PDF text libraries don't), so each
// page arrives here as a finished picture and only needs wrapping in a PDF.

export type PdfPage = { jpeg: Uint8Array; width: number; height: number };

/** A4 in PDF points. */
export const A4_PT = { width: 595.28, height: 841.89 };

const enc = new TextEncoder();

/** A PDF text string that keeps any script: UTF-16BE with a byte-order mark, as hex. */
function pdfText(s: string): string {
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function jpegPagesToPdf(pages: PdfPage[], title: string, now = new Date()): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (c: Uint8Array | string) => {
    const b = typeof c === "string" ? enc.encode(c) : c;
    chunks.push(b);
    length += b.length;
  };
  const object = (n: number, write: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    write();
    push("\nendobj\n");
  };

  // Header; the second line's high bytes mark the file as binary.
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 catalog, 2 page tree, 3 info, then per page: page, image, contents.
  const pageObj = (i: number) => 4 + i * 3;
  const { width: W, height: H } = A4_PT;

  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>`));
  object(3, () => push(`<< /Title ${pdfText(title)} /Producer (STM Financial) /CreationDate (${pdfDate(now)}) >>`));

  pages.forEach((pg, i) => {
    const n = pageObj(i);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    object(n, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`));
    object(n + 1, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
      push(pg.jpeg);
      push("\nendstream");
    });
    object(n + 2, () => push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`));
  });

  const count = 4 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
