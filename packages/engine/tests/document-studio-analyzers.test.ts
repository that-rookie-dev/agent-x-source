/**
 * Document Studio — Phase 1 analyzer tests (honest analysis, spec §6.1).
 * Only the deterministic paths are tested here; LLM paths are covered by the
 * awaiting_model honesty test (no configured model in CI).
 */

import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import Excel from 'exceljs';
import {
  analyzeDataBuffer,
  analyzeLayoutBuffer,
  analyzePriorArtifactBuffer,
  analyzeStructureBuffer,
  parseCsv,
  classifyKind,
  detectMasterFormat,
} from '../src/document-studio/masters/analyzers.js';

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes, and CRLF', () => {
    const rows = parseCsv('name,note\r\n"Doe, John","He said ""hi"""\nplain,row\n');
    expect(rows).toEqual([
      ['name', 'note'],
      ['Doe, John', 'He said "hi"'],
      ['plain', 'row'],
    ]);
  });
});

describe('analyzeDataBuffer', () => {
  it('profiles columns with honest types and preserves numeric streams (I9)', () => {
    const csv = 'employee_id,name,salary,start_date,active\n1001,Alice,85000.50,2023-01-15,true\n1002,Bob,,2024-06-01,false\n';
    const outcome = analyzeDataBuffer(Buffer.from(csv), 'payroll.csv');
    expect(outcome.state).toBe('ready');
    const profile = outcome.analysis?.dataProfile;
    expect(profile?.rowCount).toBe(2);
    const byName = Object.fromEntries((profile?.columns ?? []).map((c) => [c.name, c]));
    expect(byName['employee_id']?.datatype).toBe('number');
    expect(byName['salary']?.datatype).toBe('number');
    expect(byName['salary']?.nullable).toBe(true);
    expect(byName['start_date']?.datatype).toBe('date');
    expect(byName['active']?.datatype).toBe('boolean');
    // Amounts preserved verbatim in samples — never mangled into "cards" (I9)
    expect(profile?.sampleRows?.[0]?.['salary']).toBe('85000.50');
  });

  it('fails on empty input instead of fabricating a profile (I4)', () => {
    const outcome = analyzeDataBuffer(Buffer.from(''), 'empty.csv');
    expect(outcome.state).toBe('failed');
    expect(outcome.analysis).toBeNull();
  });

  it('is partial when headers exist but no rows', () => {
    const outcome = analyzeDataBuffer(Buffer.from('a,b,c\n'), 'headers-only.csv');
    expect(outcome.state).toBe('partial');
    expect(outcome.analysis?.warnings.length).toBeGreaterThan(0);
  });
});

describe('classification helpers', () => {
  it('detects formats from name/mime', () => {
    expect(detectMasterFormat('report.docx', '')).toBe('docx');
    expect(detectMasterFormat('data.csv', '')).toBe('csv');
    expect(detectMasterFormat('x', 'application/pdf')).toBe('pdf');
    expect(detectMasterFormat('unknown.bin', 'application/octet-stream')).toBe('other');
  });

  it('classifies provisional kinds (user-overridable)', () => {
    expect(classifyKind('csv', 'employees.csv')).toBe('data');
    expect(classifyKind('pdf', 'ICH-E3-guideline.pdf')).toBe('standard');
    expect(classifyKind('docx', 'offer-letter.docx')).toBe('layout');
  });
});

function minimalDocxWithLocators(): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:bookmarkStart w:id="0" w:name="client_name"/>
      <w:r><w:t>{{client_name}}</w:t></w:r>
      <w:bookmarkEnd w:id="0"/>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>{{company}}</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
  );
  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

async function minimalXlsxWithLocator(): Promise<Buffer> {
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = '{{client_name}}';
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe('analyzeLayoutBuffer locators', () => {
  it('detects DOCX bookmark locators', async () => {
    const outcome = await analyzeLayoutBuffer(minimalDocxWithLocators(), 'docx', 'offer.docx');
    expect(outcome.analysis).not.toBeNull();
    const client = outcome.analysis!.variables?.find((v) => v.key === 'client_name');
    expect(client?.locator?.type).toBe('bookmark');
    if (client?.locator?.type === 'bookmark') expect(client.locator.name).toBe('client_name');
  });

  it('detects DOCX table_cell locators', async () => {
    const outcome = await analyzeLayoutBuffer(minimalDocxWithLocators(), 'docx', 'offer.docx');
    const company = outcome.analysis!.variables?.find((v) => v.key === 'company');
    expect(company?.locator?.type).toBe('table_cell');
    if (company?.locator?.type === 'table_cell') {
      expect(company.locator.tableId).toBe('1');
      expect(company.locator.row).toBe(1);
      expect(company.locator.col).toBe(1);
    }
  });

  it('detects XLSX sheet_cell locators', async () => {
    const outcome = await analyzeLayoutBuffer(await minimalXlsxWithLocator(), 'xlsx', 'data.xlsx');
    const client = outcome.analysis!.variables?.find((v) => v.key === 'client_name');
    expect(client?.locator?.type).toBe('sheet_cell');
    if (client?.locator?.type === 'sheet_cell') {
      expect(client.locator.sheet).toBe('Sheet1');
      expect(client.locator.cell).toBe('A1');
    }
  });
});

describe('classifyKind', () => {
  it('infers structure masters by filename', () => {
    expect(classifyKind('md', 'proposal-outline.md')).toBe('structure');
    expect(classifyKind('docx', 'report-skeleton.docx')).toBe('structure');
  });

  it('infers prior artifact masters by filename', () => {
    expect(classifyKind('pdf', 'signed-contract.pdf')).toBe('prior_artifact');
    expect(classifyKind('docx', 'prior-offer-letter.docx')).toBe('prior_artifact');
  });
});

describe('analyzeStructureBuffer', () => {
  it('extracts markdown sections and placeholder variables', async () => {
    const text = '# Executive Summary\n\nIntro {{client_name}}.\n\n## Scope\n\nStart {{start_date}}.\n';
    const outcome = await analyzeStructureBuffer(Buffer.from(text), 'md', 'proposal-outline.md');
    expect(outcome.state).toBe('ready');
    expect(outcome.analysis?.kind).toBe('structure');
    expect(outcome.analysis?.sections).toHaveLength(2);
    expect(outcome.analysis?.sections?.[0]).toEqual({ id: 's1', title: 'Executive Summary', level: 1, required: true });
    expect(outcome.analysis?.sections?.[1]).toEqual({ id: 's2', title: 'Scope', level: 2, required: true });
    const keys = (outcome.analysis?.variables ?? []).map((v) => v.key).sort();
    expect(keys).toEqual(['client_name', 'start_date']);
    const client = outcome.analysis?.variables?.find((v) => v.key === 'client_name');
    expect(client?.locator).toEqual({ type: 'placeholder', token: '{{client_name}}' });
  });
});

describe('analyzePriorArtifactBuffer', () => {
  it('extracts inline key-value pairs and placeholders', async () => {
    const text = 'Client: Acme Corp\nDate: 2024-01-15\nSalary: 90000\n{{client_name}}\n';
    const outcome = await analyzePriorArtifactBuffer(Buffer.from(text), 'md', 'prior-offer.md');
    expect(outcome.state).toBe('ready');
    expect(outcome.analysis?.kind).toBe('prior_artifact');
    const vars = Object.fromEntries((outcome.analysis?.variables ?? []).map((v) => [v.key, v]));
    expect(vars['client']?.sampleValue).toBe('Acme Corp');
    expect(vars['client']?.datatype).toBe('string');
    expect(vars['client']?.locator).toEqual({ type: 'sample_text', text: 'Acme Corp', context: 'Client' });
    expect(vars['date']?.datatype).toBe('date');
    expect(vars['salary']?.datatype).toBe('number');
    expect(vars['salary']?.sensitivity).toBe('financial');
    expect(vars['client_name']?.locator).toEqual({ type: 'placeholder', token: '{{client_name}}' });
    expect(vars['client_name']?.sampleValue).toBe('');
  });
});
