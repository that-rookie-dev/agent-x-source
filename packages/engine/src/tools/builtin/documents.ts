import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

/**
 * Create a CSV file from structured data.
 */
export async function csvCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const headers = args['headers'] as string[] | undefined;
  const rows = args['rows'] as string[][] | undefined;
  const content = args['content'] as string | undefined;

  if (!file) return { success: false, output: 'file is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });

  if (content) {
    // Raw CSV content provided
    writeFileSync(filePath, content, 'utf-8');
    return { success: true, output: `CSV written to ${file}` };
  }

  if (!headers || !rows) {
    return { success: false, output: 'Provide headers+rows or content', error: 'MISSING_INPUT' };
  }

  // Escape CSV values
  const escape = (v: string): string => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const lines = [headers.map(escape).join(',')];
  for (const row of rows) {
    lines.push(row.map(escape).join(','));
  }

  writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
  return { success: true, output: `CSV created: ${file} (${rows.length} rows)` };
}

/**
 * Create a PDF file with text content using a simple PDF generator.
 * Produces valid PDF 1.4 without any external dependencies.
 */
export async function pdfCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = (args['title'] as string) ?? 'Document';
  const content = args['content'] as string;
  const author = (args['author'] as string) ?? 'Agent-X';

  if (!file || !content) return { success: false, output: 'file and content required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });

  const pdf = buildPdf(title, author, content);
  writeFileSync(filePath, pdf);
  return { success: true, output: `PDF created: ${file}` };
}

/**
 * Create a DOCX (Word) file. Produces a valid Office Open XML document.
 */
export async function docxCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = (args['title'] as string) ?? 'Document';
  const content = args['content'] as string;
  const author = (args['author'] as string) ?? 'Agent-X';

  if (!file || !content) return { success: false, output: 'file and content required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });

  const docx = buildDocx(title, author, content);
  writeFileSync(filePath, docx);
  return { success: true, output: `DOCX created: ${file}` };
}

/**
 * Create a PPTX (PowerPoint) file. Produces a valid Office Open XML presentation.
 */
export async function pptxCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = (args['title'] as string) ?? 'Presentation';
  const slides = args['slides'] as Array<{ title: string; content: string }> | undefined;

  if (!file) return { success: false, output: 'file is required', error: 'MISSING_INPUT' };
  if (!slides || slides.length === 0) return { success: false, output: 'slides array required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });

  const pptx = buildPptx(title, slides);
  writeFileSync(filePath, pptx);
  return { success: true, output: `PPTX created: ${file} (${slides.length} slides)` };
}

/**
 * Create an XLSX (Excel) file. Produces a valid Office Open XML spreadsheet.
 */
export async function xlsxCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const sheetName = (args['sheet_name'] as string) ?? 'Sheet1';
  const headers = args['headers'] as string[] | undefined;
  const rows = args['rows'] as (string | number)[][] | undefined;

  if (!file) return { success: false, output: 'file is required', error: 'MISSING_INPUT' };
  if (!headers || !rows) return { success: false, output: 'headers and rows required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });

  const xlsx = buildXlsx(sheetName, headers, rows);
  writeFileSync(filePath, xlsx);
  return { success: true, output: `XLSX created: ${file} (${rows.length} rows)` };
}

// ─── PDF Builder (no dependencies) ──────────────────────────────────────────

function buildPdf(title: string, author: string, content: string): Buffer {
  const lines = content.split('\n');
  const objects: string[] = [];
  let objectCount = 0;
  const offsets: number[] = [];

  const addObj = (obj: string): number => {
    objectCount++;
    objects.push(obj);
    return objectCount;
  };

  // 1: Catalog
  addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // 2: Pages (will be updated)
  addObj(''); // placeholder
  // 3: Font
  addObj('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // Create pages with text (60 lines per page)
  const linesPerPage = 50;
  const pageObjIds: number[] = [];

  for (let i = 0; i < lines.length; i += linesPerPage) {
    const pageLines = lines.slice(i, i + linesPerPage);
    const contentStreamText = pageLines
      .map((line, idx) => {
        const y = 750 - idx * 14;
        const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        return `BT /F1 10 Tf 50 ${y} Td (${escaped}) Tj ET`;
      })
      .join('\n');

    const streamObj = addObj(
      `${objectCount + 1} 0 obj\n<< /Length ${contentStreamText.length} >>\nstream\n${contentStreamText}\nendstream\nendobj\n`
    );

    const pageObj = addObj(
      `${objectCount + 1} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`
    );
    pageObjIds.push(pageObj);
  }

  // If no content, add one blank page
  if (pageObjIds.length === 0) {
    const streamObj = addObj(`${objectCount + 1} 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`);
    const pageObj = addObj(
      `${objectCount + 1} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${streamObj} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`
    );
    pageObjIds.push(pageObj);
  }

  // Update Pages object
  const kids = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageObjIds.length} >>\nendobj\n`;

  // Info object
  const infoId = addObj(
    `${objectCount + 1} 0 obj\n<< /Title (${title}) /Author (${author}) /Creator (Agent-X) /Producer (Agent-X PDF Generator) >>\nendobj\n`
  );

  // Build final PDF
  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += objects[i]!;
  }

  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objectCount + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 0; i < objectCount; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += 'trailer\n';
  pdf += `<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoId} 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return Buffer.from(pdf, 'binary');
}

// ─── DOCX Builder (minimal valid OOXML, no dependencies) ────────────────────

function buildDocx(title: string, author: string, content: string): Buffer {
  const paragraphs = content.split('\n').map((line) => {
    const escaped = escapeXml(line);
    return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
  }).join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs}</w:body></w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author)}</dc:creator></cp:coreProperties>`;

  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': relsXml,
    'word/document.xml': documentXml,
    'word/_rels/document.xml.rels': wordRelsXml,
    'docProps/core.xml': coreXml,
  };

  return createZipBuffer(files);
}

// ─── PPTX Builder (minimal valid OOXML) ─────────────────────────────────────

function buildPptx(title: string, slides: Array<{ title: string; content: string }>): Buffer {
  const slideXmls: string[] = [];
  const slideRels: string[] = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]!;
    slideXmls.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="3200" b="1"/><a:t>${escapeXml(slide.title)}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${escapeXml(slide.content)}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`);

    slideRels.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  }

  const slideOverrides = slides.map((_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
  ).join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${slideOverrides}
</Types>`;

  const slideRelEntries = slides.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
  ).join('');

  const presRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${slideRelEntries}
</Relationships>`;

  const sldIdLst = slides.map((_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`
  ).join('');

  const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldMasterIdLst/><p:sldIdLst>${sldIdLst}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': relsXml,
    'ppt/presentation.xml': presentationXml,
    'ppt/_rels/presentation.xml.rels': presRelsXml,
  };

  for (let i = 0; i < slideXmls.length; i++) {
    files[`ppt/slides/slide${i + 1}.xml`] = slideXmls[i]!;
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = slideRels[i]!;
  }

  // title used in presentation properties
  void title;
  return createZipBuffer(files);
}

// ─── XLSX Builder (minimal valid OOXML) ─────────────────────────────────────

function buildXlsx(sheetName: string, headers: string[], rows: (string | number)[][]): Buffer {
  // Build shared strings
  const allStrings: string[] = [...headers];
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === 'string') allStrings.push(cell);
    }
  }
  const uniqueStrings = [...new Set(allStrings)];
  const stringIndex = new Map(uniqueStrings.map((s, i) => [s, i]));

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${uniqueStrings.length}">
${uniqueStrings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('')}
</sst>`;

  // Build sheet data
  const colLetter = (idx: number): string => {
    let result = '';
    let n = idx;
    while (n >= 0) {
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26) - 1;
    }
    return result;
  };

  let sheetData = '<sheetData>';
  // Header row
  sheetData += '<row r="1">';
  for (let c = 0; c < headers.length; c++) {
    const ref = `${colLetter(c)}1`;
    sheetData += `<c r="${ref}" t="s"><v>${stringIndex.get(headers[c]!)}</v></c>`;
  }
  sheetData += '</row>';

  // Data rows
  for (let r = 0; r < rows.length; r++) {
    const rowNum = r + 2;
    sheetData += `<row r="${rowNum}">`;
    for (let c = 0; c < rows[r]!.length; c++) {
      const ref = `${colLetter(c)}${rowNum}`;
      const val = rows[r]![c];
      if (typeof val === 'number') {
        sheetData += `<c r="${ref}"><v>${val}</v></c>`;
      } else {
        sheetData += `<c r="${ref}" t="s"><v>${stringIndex.get(val as string) ?? 0}</v></c>`;
      }
    }
    sheetData += '</row>';
  }
  sheetData += '</sheetData>';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${sheetData}
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  return createZipBuffer({
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': relsXml,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': wbRelsXml,
    'xl/worksheets/sheet1.xml': sheetXml,
    'xl/sharedStrings.xml': sharedStringsXml,
  });
}

// ─── Minimal ZIP builder (PK format, no compression, no deps) ───────────────

function createZipBuffer(files: Record<string, string>): Buffer {
  const entries = Object.entries(files);
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf-8');
    const contentBuffer = Buffer.from(content, 'utf-8');
    const crc = crc32(contentBuffer);

    // Local file header
    const local = Buffer.alloc(30 + nameBuffer.length + contentBuffer.length);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // compression: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14); // crc32
    local.writeUInt32LE(contentBuffer.length, 18); // compressed size
    local.writeUInt32LE(contentBuffer.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26); // name length
    local.writeUInt16LE(0, 28); // extra length
    nameBuffer.copy(local, 30);
    contentBuffer.copy(local, 30 + nameBuffer.length);
    localHeaders.push(local);

    // Central directory header
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // compression
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16); // crc32
    central.writeUInt32LE(contentBuffer.length, 20); // compressed
    central.writeUInt32LE(contentBuffer.length, 24); // uncompressed
    central.writeUInt16LE(nameBuffer.length, 28); // name length
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuffer.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirStart = offset;
  const centralDirSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirStart, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

// ─── CRC32 implementation ───────────────────────────────────────────────────

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Utility ────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── PDF Reader (zero-dependency text extraction) ───────────────────────────

/**
 * Extract text content from a PDF file.
 * Handles FlateDecode compressed streams and standard text operators (Tj, TJ, ', ").
 */
export async function pdfRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['path'] as string ?? args['file'] as string;
  if (!file) return { success: false, output: 'path is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${file}`, error: 'FILE_NOT_FOUND' };
  }

  try {
    const buffer = readFileSync(filePath);
    const text = extractPdfText(buffer);
    if (!text.trim()) {
      return { success: true, output: '(PDF contains no extractable text — it may be image-based/scanned)' };
    }
    return { success: true, output: truncateOutput(text) };
  } catch (err) {
    return { success: false, output: `Failed to read PDF: ${err instanceof Error ? err.message : String(err)}`, error: 'PDF_READ_ERROR' };
  }
}

/** Extract plain text from a PDF buffer (shared with integration bridges). */
export function extractPdfTextFromBuffer(buffer: Buffer): string {
  return extractPdfText(buffer);
}

function extractPdfText(buffer: Buffer): string {
  const bytes = buffer;
  const textParts: string[] = [];

  // Find all stream...endstream blocks
  let pos = 0;
  while (pos < bytes.length) {
    // Find "stream" keyword (preceded by \r\n or \n after the dictionary >>)
    const streamIdx = indexOfBytes(bytes, Buffer.from('stream'), pos);
    if (streamIdx === -1) break;

    // Find the corresponding "endstream"
    const endstreamIdx = indexOfBytes(bytes, Buffer.from('endstream'), streamIdx + 6);
    if (endstreamIdx === -1) break;

    // Stream data starts after "stream\r\n" or "stream\n"
    let dataStart = streamIdx + 6;
    if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
    else if (bytes[dataStart] === 0x0a) dataStart += 1;
    else if (bytes[dataStart] === 0x0d) dataStart += 1;

    // Stream data ends before "endstream" (may have trailing \r\n)
    let dataEnd = endstreamIdx;
    if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0a) dataEnd--;
    if (dataEnd > dataStart && bytes[dataEnd - 1] === 0x0d) dataEnd--;

    const streamData = bytes.subarray(dataStart, dataEnd);

    // Check if this stream's dictionary has /FlateDecode
    const dictStart = Math.max(0, streamIdx - 500);
    const dictRegion = bytes.subarray(dictStart, streamIdx).toString('latin1');

    let decoded: Buffer | null = null;
    if (dictRegion.includes('/FlateDecode')) {
      try {
        decoded = inflateSync(streamData) as Buffer;
      } catch {
        // Not valid zlib — skip
      }
    } else {
      // Try as-is (uncompressed stream)
      decoded = streamData as Buffer;
    }

    if (decoded) {
      const streamText = extractTextFromContentStream(decoded.toString('latin1'));
      if (streamText.trim()) {
        textParts.push(streamText);
      }
    }

    pos = endstreamIdx + 9;
  }

  return textParts.join('\n');
}

/**
 * Parse PDF content stream operators to extract text.
 * Handles Tj, TJ, ', " operators.
 */
function extractTextFromContentStream(content: string): string {
  const lines: string[] = [];
  let currentLine = '';

  // Match text showing operators:
  // (text) Tj — show string
  // [(text)(text)] TJ — show array of strings
  // (text) ' — move to next line and show
  // (text) " — set spacing, move to next line, show

  // Handle TJ arrays: [(string)num(string)...]TJ
  const tjArrayRegex = /\[((?:[^[\]]*?))\]\s*TJ/g;
  let match: RegExpExecArray | null;

  // Replace TJ arrays with extracted text
  const processedContent = content;

  // First pass: extract TJ array text
  match = tjArrayRegex.exec(content);
  while (match !== null) {
    const arrayContent = match[1]!;
    let text = '';
    const strRegex = /\(([^)]*)\)/g;
    let strMatch: RegExpExecArray | null;
    strMatch = strRegex.exec(arrayContent);
    while (strMatch !== null) {
      text += decodePdfString(strMatch[1]!);
      strMatch = strRegex.exec(arrayContent);
    }
    if (text) currentLine += text;
    match = tjArrayRegex.exec(content);
  }

  // Second pass: handle single Tj operators (not inside TJ arrays)
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  match = tjRegex.exec(processedContent);
  while (match !== null) {
    currentLine += decodePdfString(match[1]!);
    match = tjRegex.exec(processedContent);
  }

  // Handle ' and " operators
  const tickRegex = /\(([^)]*)\)\s*['"]/g;
  match = tickRegex.exec(processedContent);
  while (match !== null) {
    if (currentLine) { lines.push(currentLine); currentLine = ''; }
    currentLine += decodePdfString(match[1]!);
    match = tickRegex.exec(processedContent);
  }

  // Handle text position operators for line breaks
  // Td, TD, T* indicate new text positioning (often new lines)
  if (currentLine) lines.push(currentLine);

  // If we got nothing from operator parsing, try a more aggressive approach
  if (lines.join('').trim().length === 0) {
    // Fallback: extract all parenthesized strings
    const fallbackRegex = /\(([^)]+)\)/g;
    const fallbackLines: string[] = [];
    match = fallbackRegex.exec(content);
    while (match !== null) {
      const decoded = decodePdfString(match[1]!);
      if (decoded.trim() && !/^[0-9.]+$/.test(decoded.trim())) {
        fallbackLines.push(decoded);
      }
      match = fallbackRegex.exec(content);
    }
    return fallbackLines.join(' ');
  }

  return lines.join('\n');
}

function decodePdfString(str: string): string {
  // Decode PDF escape sequences
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function indexOfBytes(buf: Buffer, search: Buffer, from: number): number {
  for (let i = from; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

// ─── Office Document Readers (DOCX, XLSX, PPTX) ────────────────────────────

/**
 * Extract text from a DOCX (Word) file.
 */
export async function docxRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['path'] as string ?? args['file'] as string;
  if (!file) return { success: false, output: 'path is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${file}`, error: 'FILE_NOT_FOUND' };
  }

  try {
    const buffer = readFileSync(filePath);
    const entries = readZipEntries(buffer);
    const docEntry = entries.find((e) => e.name === 'word/document.xml');
    if (!docEntry) {
      return { success: false, output: 'Not a valid DOCX file (missing word/document.xml)', error: 'INVALID_FORMAT' };
    }
    const xml = docEntry.data.toString('utf-8');
    // Extract text from <w:t> tags
    const text = xml.replace(/<[^>]+>/g, (tag) => {
      if (tag === '</w:p>') return '\n';
      if (tag === '</w:r>') return '';
      return '';
    });
    // More precise: get content between <w:t> tags
    const textContent = extractXmlText(xml, 'w:t');
    const output = textContent || text.replace(/<[^>]+>/g, '');
    return { success: true, output: truncateOutput(output) };
  } catch (err) {
    return { success: false, output: `Failed to read DOCX: ${err instanceof Error ? err.message : String(err)}`, error: 'READ_ERROR' };
  }
}

/**
 * Extract text/data from an XLSX (Excel) file.
 */
export async function xlsxRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['path'] as string ?? args['file'] as string;
  if (!file) return { success: false, output: 'path is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${file}`, error: 'FILE_NOT_FOUND' };
  }

  try {
    const buffer = readFileSync(filePath);
    const entries = readZipEntries(buffer);

    // Get shared strings
    const ssEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
    const sharedStrings: string[] = [];
    if (ssEntry) {
      const ssXml = ssEntry.data.toString('utf-8');
      const siRegex = /<si[^>]*>([\s\S]*?)<\/si>/g;
      let siMatch: RegExpExecArray | null;
      siMatch = siRegex.exec(ssXml);
      while (siMatch !== null) {
        // Extract all <t> content within <si>
        const tContent = extractXmlText(siMatch[1]!, 't');
        sharedStrings.push(tContent);
        siMatch = siRegex.exec(ssXml);
      }
    }

    // Find all sheet files
    const sheetEntries = entries
      .filter((e) => e.name.match(/^xl\/worksheets\/sheet\d+\.xml$/))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (sheetEntries.length === 0) {
      return { success: false, output: 'Not a valid XLSX file (no worksheets found)', error: 'INVALID_FORMAT' };
    }

    const output: string[] = [];
    for (const sheet of sheetEntries) {
      const sheetXml = sheet.data.toString('utf-8');
      const rows: string[] = [];
      const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch: RegExpExecArray | null;
      rowMatch = rowRegex.exec(sheetXml);
      while (rowMatch !== null) {
        const cells: string[] = [];
        const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch: RegExpExecArray | null;
        cellMatch = cellRegex.exec(rowMatch[1]!);
        while (cellMatch !== null) {
          const attrs = cellMatch[1]!;
          const inner = cellMatch[2]!;
          const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (valueMatch) {
            const val = valueMatch[1]!;
            if (attrs.includes('t="s"')) {
              // Shared string reference
              cells.push(sharedStrings[parseInt(val, 10)] ?? val);
            } else {
              cells.push(val);
            }
          } else {
            cells.push('');
          }
          cellMatch = cellRegex.exec(rowMatch[1]!);
        }
        rows.push(cells.join('\t'));
        rowMatch = rowRegex.exec(sheetXml);
      }
      if (rows.length > 0) {
        const sheetName = sheet.name.replace('xl/worksheets/', '').replace('.xml', '');
        output.push(`--- ${sheetName} ---\n${rows.join('\n')}`);
      }
    }

    const result = output.join('\n\n');
    if (!result.trim()) {
      return { success: true, output: '(Spreadsheet is empty)' };
    }
    return { success: true, output: truncateOutput(result) };
  } catch (err) {
    return { success: false, output: `Failed to read XLSX: ${err instanceof Error ? err.message : String(err)}`, error: 'READ_ERROR' };
  }
}

/**
 * Extract text from a PPTX (PowerPoint) file.
 */
export async function pptxRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['path'] as string ?? args['file'] as string;
  if (!file) return { success: false, output: 'path is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${file}`, error: 'FILE_NOT_FOUND' };
  }

  try {
    const buffer = readFileSync(filePath);
    const entries = readZipEntries(buffer);

    // Find all slide files
    const slideEntries = entries
      .filter((e) => e.name.match(/^ppt\/slides\/slide\d+\.xml$/))
      .sort((a, b) => {
        const numA = parseInt(a.name.match(/slide(\d+)/)?.[1] ?? '0', 10);
        const numB = parseInt(b.name.match(/slide(\d+)/)?.[1] ?? '0', 10);
        return numA - numB;
      });

    if (slideEntries.length === 0) {
      return { success: false, output: 'Not a valid PPTX file (no slides found)', error: 'INVALID_FORMAT' };
    }

    const output: string[] = [];
    for (let i = 0; i < slideEntries.length; i++) {
      const slideXml = slideEntries[i]!.data.toString('utf-8');
      // Extract text from <a:t> tags (DrawingML text)
      const slideText = extractXmlText(slideXml, 'a:t');
      if (slideText.trim()) {
        output.push(`--- Slide ${i + 1} ---\n${slideText}`);
      }
    }

    const result = output.join('\n\n');
    if (!result.trim()) {
      return { success: true, output: '(Presentation contains no extractable text)' };
    }
    return { success: true, output: truncateOutput(result) };
  } catch (err) {
    return { success: false, output: `Failed to read PPTX: ${err instanceof Error ? err.message : String(err)}`, error: 'READ_ERROR' };
  }
}

// ─── ZIP Reader (handles STORED + DEFLATE, no deps) ─────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = 0;

  while (pos < buf.length - 4) {
    // Look for local file header signature: PK\x03\x04
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x03 || buf[pos + 3] !== 0x04) {
      break; // No more local headers
    }

    const compressionMethod = buf.readUInt16LE(pos + 8);
    const compressedSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);

    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf-8');
    const dataStart = pos + 30 + nameLen + extraLen;

    let data: Buffer;
    if (compressionMethod === 0) {
      // STORED
      data = buf.subarray(dataStart, dataStart + compressedSize) as Buffer;
    } else if (compressionMethod === 8) {
      // DEFLATE
      try {
        const compressed = buf.subarray(dataStart, dataStart + compressedSize);
        data = inflateSync(compressed, { finishFlush: 2 }) as Buffer; // Z_SYNC_FLUSH for raw deflate
      } catch {
        try {
          // Try raw inflate (no header)
          const compressed = buf.subarray(dataStart, dataStart + compressedSize);
          data = inflateSync(compressed) as Buffer;
        } catch {
          data = Buffer.alloc(0);
        }
      }
    } else {
      data = Buffer.alloc(0); // Unsupported compression
    }

    if (name && !name.endsWith('/')) {
      entries.push({ name, data });
    }

    pos = dataStart + compressedSize;
  }

  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractXmlText(xml: string, tagName: string): string {
  const parts: string[] = [];
  // Match both <tag>content</tag> and <tag attr="...">content</tag>
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  let match: RegExpExecArray | null;
  match = regex.exec(xml);
  while (match !== null) {
    parts.push(match[1]!);
    match = regex.exec(xml);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function truncateOutput(text: string, maxChars = 100_000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n... [truncated, file too large]';
}

export async function docMarkdown(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = args['title'] as string | undefined;
  const sections = args['sections'] as Array<{ heading?: string; content?: string; code?: string }> | undefined;

  if (!file || !sections) {
    return { success: false, output: 'file and sections are required', error: 'MISSING_INPUT' };
  }

  let md = '';
  if (title) md += `# ${title}\n\n`;
  for (const section of sections) {
    if (section.heading) md += `## ${section.heading}\n\n`;
    if (section.content) md += `${section.content}\n\n`;
    if (section.code) md += '```\n' + section.code + '\n```\n\n';
  }

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, md, 'utf-8');
  return { success: true, output: `Markdown written to ${file}` };
}

export async function docHtml(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = (args['title'] as string) ?? 'Document';
  const body = args['body'] as string;
  const style = args['style'] as string | undefined;

  if (!file || !body) {
    return { success: false, output: 'file and body are required', error: 'MISSING_INPUT' };
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(title)}</title>
${style ? `<style>${style}</style>` : ''}
</head>
<body>
${body}
</body>
</html>`;

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, html, 'utf-8');
  return { success: true, output: `HTML written to ${file}` };
}

export async function docJson(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const data = args['data'];

  if (!file || data === undefined) {
    return { success: false, output: 'file and data are required', error: 'MISSING_INPUT' };
  }

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { success: true, output: `JSON written to ${file}` };
}

export async function docYaml(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const data = args['data'] as Record<string, unknown> | undefined;

  if (!file || !data) {
    return { success: false, output: 'file and data are required', error: 'MISSING_INPUT' };
  }

  const toYaml = (obj: Record<string, unknown>, indent = 0): string => {
    const prefix = '  '.repeat(indent);
    return Object.entries(obj).map(([key, val]) => {
      if (val === null || val === undefined) return `${prefix}${key}: null`;
      if (typeof val === 'string') return `${prefix}${key}: "${val.replace(/"/g, '\\"')}"`;
      if (typeof val === 'number' || typeof val === 'boolean') return `${prefix}${key}: ${val}`;
      if (Array.isArray(val)) {
        if (val.length === 0) return `${prefix}${key}: []`;
        return `${prefix}${key}:\n${val.map((item) => {
          if (typeof item === 'object' && item !== null) {
            return `${prefix}- ${toYaml(item as Record<string, unknown>, indent + 1).trimStart()}`;
          }
          return `${prefix}- ${item}`;
        }).join('\n')}`;
      }
      if (typeof val === 'object') {
        return `${prefix}${key}:\n${toYaml(val as Record<string, unknown>, indent + 1)}`;
      }
      return `${prefix}${key}: ${val}`;
    }).join('\n');
  };

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, toYaml(data) + '\n', 'utf-8');
  return { success: true, output: `YAML written to ${file}` };
}

export async function docDiagram(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const definition = args['definition'] as string;

  if (!file || !definition) {
    return { success: false, output: 'file and definition are required', error: 'MISSING_INPUT' };
  }

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, definition, 'utf-8');
  return { success: true, output: `Mermaid diagram written to ${file}\n\nTip: Use https://mermaid.live to render it.` };
}

export async function docLatex(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string;
  const title = (args['title'] as string) ?? 'Document';
  const author = (args['author'] as string) ?? 'Agent-X';
  const sections = args['sections'] as Array<{ heading: string; content: string }> | undefined;

  if (!file || !sections) {
    return { success: false, output: 'file and sections are required', error: 'MISSING_INPUT' };
  }

  let latex = `\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n`;
  latex += `\\title{${escapeLatex(title)}}\n\\author{${escapeLatex(author)}}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n`;
  for (const section of sections) {
    if (section.heading) latex += `\\section{${escapeLatex(section.heading)}}\n`;
    if (section.content) latex += `${escapeLatex(section.content)}\n\n`;
  }
  latex += '\\end{document}\n';

  const filePath = resolve(context.scopePath, file);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, latex, 'utf-8');
  return { success: true, output: `LaTeX written to ${file}` };
}

function escapeLatex(str: string): string {
  return str.replace(/[&%$#_{}~^\\]/g, (c) => `\\${c}`);
}
