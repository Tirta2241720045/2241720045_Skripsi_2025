/**
 * generate-report.js
 * 
 * Dijalankan setelah: npm run test:json
 * Menghasilkan:
 *   - integration-test-report.json  (ringkasan JSON)
 *   - integration-test-report.docx  (laporan Word lengkap)
 * 
 * Cara pakai:
 *   npm run test:report
 */

const fs   = require('fs');
const path = require('path');

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, LevelFormat, Header, Footer
} = require('docx');

// 1. Load test-results.json
if (!fs.existsSync('test-results.json')) {
  console.error('test-results.json tidak ditemukan. Jalankan: npm run test:json');
  process.exit(1);
}

const raw          = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));
const totalTests   = raw.numTotalTests;
const passedTests  = raw.numPassedTests;
const failedTests  = raw.numFailedTests;
const skippedTests = raw.numPendingTests || 0;
const successRate  = ((passedTests / totalTests) * 100).toFixed(1);
const generatedAt  = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

const allTests = [];
raw.testResults.forEach(suite => {
  const suiteName = path.basename(suite.testFilePath || suite.name || '');
  (suite.assertionResults || []).forEach(t => {
    allTests.push({ suite: suiteName, title: t.title, status: t.status,
      duration: t.duration || 0, ancestorTitles: t.ancestorTitles || [] });
  });
});

// 2. Tulis JSON summary
const jsonReport = {
  timestamp: new Date().toISOString(), total: totalTests, passed: passedTests,
  failed: failedTests, skipped: skippedTests, successRate: `${successRate}%`,
  verdict: parseFloat(successRate) === 100 ? 'LULUS' : parseFloat(successRate) >= 80 ? 'LULUS BERSYARAT' : 'TIDAK LULUS',
  testSuites: raw.testResults.map(suite => ({
    name: path.basename(suite.testFilePath || suite.name || ''), status: suite.status,
    tests: (suite.assertionResults || []).map(t => ({ name: t.title, status: t.status, duration: t.duration }))
  }))
};
fs.writeFileSync('integration-test-report.json', JSON.stringify(jsonReport, null, 2));
console.log('JSON report: integration-test-report.json');

// 3. DOCX helpers
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

const makeCell = (text, opts = {}) => new TableCell({
  borders, width: { size: opts.width || 2340, type: WidthType.DXA },
  shading: opts.shading, verticalAlign: VerticalAlign.CENTER,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT,
    children: [new TextRun({ text: String(text), bold: opts.bold || false,
      color: opts.color || '000000', size: opts.size || 20, font: 'Arial' })] })]
});

const headerCell = (text, width) => makeCell(text, { width, bold: true, color: 'FFFFFF', size: 20,
  align: AlignmentType.CENTER, shading: { fill: '1F4E79', type: ShadingType.CLEAR } });

const statusColor = s => s === 'passed' ? '1A7C3E' : s === 'failed' ? 'C00000' : '7F7F7F';
const statusLabel = s => s === 'passed' ? 'LULUS' : s === 'failed' ? 'GAGAL' : 'DILEWATI';

const para = (text, opts = {}) => new Paragraph({
  heading: opts.heading, alignment: opts.align || AlignmentType.LEFT,
  spacing: { before: opts.spaceBefore || 120, after: opts.spaceAfter || 120 },
  children: [new TextRun({ text, bold: opts.bold || false, size: opts.size || 22,
    color: opts.color || '000000', font: 'Arial', italics: opts.italic || false })]
});

const blank = () => new Paragraph({ children: [new TextRun({ text: '' })] });
const verdictText = parseFloat(successRate) === 100
  ? 'LULUS — Seluruh test case berhasil dieksekusi tanpa kegagalan.'
  : parseFloat(successRate) >= 80
  ? 'LULUS BERSYARAT — Sebagian besar test berhasil, namun terdapat kegagalan.'
  : 'TIDAK LULUS — Terdapat kegagalan signifikan yang harus diperbaiki sebelum deployment.';
const verdictColor = parseFloat(successRate) === 100 ? '1A7C3E' : parseFloat(successRate) >= 80 ? 'E36C09' : 'C00000';

// 4. Summary table
const summaryTable = new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
  rows: [
    new TableRow({ children: [headerCell('Metrik', 4680), headerCell('Nilai', 4680)] }),
    ...[ ['Total Test Cases', totalTests, '000000'], ['Test Lulus', passedTests, '1A7C3E'],
         ['Test Gagal', failedTests, failedTests > 0 ? 'C00000' : '000000'],
         ['Test Dilewati', skippedTests, '000000'],
         ['Success Rate', `${successRate}%`, verdictColor],
         ['Tanggal Pengujian', generatedAt, '000000'],
    ].map(([label, val, color]) => new TableRow({ children: [
      makeCell(label, { width: 4680, bold: true }),
      makeCell(val, { width: 4680, align: AlignmentType.CENTER, color, bold: label === 'Success Rate' })
    ]}))
  ]
});

// 5. Per-suite sections
const suiteNames = [...new Set(allTests.map(t => t.suite))];
const suiteSections = [];
suiteNames.forEach(sname => {
  const tests = allTests.filter(t => t.suite === sname);
  const suitePass = tests.filter(t => t.status === 'passed').length;
  suiteSections.push(blank());
  suiteSections.push(para(`Suite: ${sname}`, { heading: HeadingLevel.HEADING_2 }));
  suiteSections.push(para(`${suitePass} dari ${tests.length} test lulus pada suite ini.`, { italic: true, size: 20, color: '595959' }));
  suiteSections.push(blank());
  const groups = {};
  tests.forEach(t => { const g = t.ancestorTitles.slice(1).join(' > ') || 'Umum'; if (!groups[g]) groups[g] = []; groups[g].push(t); });
  Object.entries(groups).forEach(([groupName, groupTests]) => {
    suiteSections.push(para(groupName, { bold: true, size: 20, color: '1F4E79', spaceBefore: 160 }));
    const rows = [new TableRow({ children: [headerCell('No', 800), headerCell('ID / Nama Test', 5360), headerCell('Status', 1400), headerCell('Durasi (ms)', 1800)] })];
    groupTests.forEach((t, idx) => {
      const shade = { fill: idx % 2 === 0 ? 'F5F9FF' : 'FFFFFF', type: ShadingType.CLEAR };
      rows.push(new TableRow({ children: [
        makeCell(idx + 1, { width: 800, align: AlignmentType.CENTER, shading: shade }),
        makeCell(t.title, { width: 5360, shading: shade }),
        makeCell(statusLabel(t.status), { width: 1400, align: AlignmentType.CENTER, bold: true, color: statusColor(t.status), shading: shade }),
        makeCell(t.duration ? `${t.duration} ms` : '-', { width: 1800, align: AlignmentType.CENTER, shading: shade }),
      ]}));
    });
    suiteSections.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [800, 5360, 1400, 1800], rows }));
    suiteSections.push(blank());
  });
});

// 6. Build DOCX
const doc = new Document({
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•',
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '1F4E79' },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 } } },
    headers: { default: new Header({ children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 } }, spacing: { after: 120 },
      children: [
        new TextRun({ text: 'Laporan Hasil Pengujian Integrasi — Sistem Rekam Medis', bold: true, size: 18, color: '1F4E79', font: 'Arial' }),
        new TextRun({ text: '    Halaman ', size: 18, font: 'Arial' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 18, font: 'Arial' }),
      ] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: '2E75B6', space: 1 } },
      spacing: { before: 120 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Dokumen dibuat otomatis ${generatedAt} | Rahasia & Terbatas`, size: 16, color: '7F7F7F', font: 'Arial' })]
    })] }) },
    children: [
      blank(), blank(),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 480, after: 120 },
        children: [new TextRun({ text: 'LAPORAN HASIL', bold: true, size: 64, color: '1F4E79', font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 },
        children: [new TextRun({ text: 'PENGUJIAN INTEGRASI', bold: true, size: 64, color: '1F4E79', font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 },
        children: [new TextRun({ text: 'Frontend API  \u2194  Backend', size: 28, color: '2E75B6', font: 'Arial' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 480 },
        children: [new TextRun({ text: `Dihasilkan: ${generatedAt}`, size: 20, color: '595959', italics: true, font: 'Arial' })] }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
        rows: [new TableRow({ children: [new TableCell({
          borders, width: { size: 9360, type: WidthType.DXA },
          shading: { fill: parseFloat(successRate) === 100 ? 'E2EFDA' : 'FCE4D6', type: ShadingType.CLEAR },
          margins: { top: 200, bottom: 200, left: 240, right: 240 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `VERDIK: ${verdictText}`, bold: true, size: 26, color: verdictColor, font: 'Arial' })] })]
        })]})],
      }),
      blank(),
      para('1. Ringkasan Eksekutif', { heading: HeadingLevel.HEADING_1 }),
      para('Dokumen ini merupakan laporan resmi hasil pengujian integrasi antara frontend React dan backend FastAPI pada Sistem Rekam Medis Digital. Pengujian dilaksanakan menggunakan Jest dan Mock Service Worker (MSW) untuk mensimulasikan seluruh endpoint API secara terisolasi.'),
      blank(), summaryTable, blank(),
      para('2. Ruang Lingkup Pengujian', { heading: HeadingLevel.HEADING_1 }),
      para('Pengujian mencakup skenario-skenario berikut:'),
      ...['Autentikasi & Otorisasi (login valid/invalid, akses dengan/tanpa token)',
          'Manajemen Pasien (create, read — dengan validasi role staff vs dokter)',
          'Upload & Embedding Data Medis (staff dapat upload, dokter ditolak, pasien tidak valid)',
          'Ekstraksi & Dekripsi Data Medis (dokter dapat ekstrak, staff ditolak, record tidak ada)',
          'Penghapusan Rekam Medis (staff dapat hapus, dokter ditolak)'
      ].map(txt => new Paragraph({ numbering: { reference: 'bullets', level: 0 },
        spacing: { before: 60, after: 60 }, children: [new TextRun({ text: txt, size: 22, font: 'Arial' })] })),
      blank(),
      para('3. Metodologi Pengujian', { heading: HeadingLevel.HEADING_1 }),
      para('Framework & Tools:', { bold: true }),
      ...['Jest 27 — test runner utama',
          'Mock Service Worker (MSW) v1 — intercept HTTP request di environment Node/jsdom',
          'React Testing Library — untuk test komponen UI',
          '@testing-library/jest-dom — custom matchers DOM'
      ].map(txt => new Paragraph({ numbering: { reference: 'bullets', level: 0 },
        spacing: { before: 60, after: 60 }, children: [new TextRun({ text: txt, size: 22, font: 'Arial' })] })),
      blank(),
      para('Pendekatan yang digunakan adalah Integration Testing berbasis mock, di mana seluruh HTTP request diintersep oleh MSW sehingga test dapat berjalan tanpa membutuhkan backend yang aktif. Setiap test case memvalidasi status HTTP response dan struktur data yang dikembalikan.'),
      blank(),
      para('4. Detail Hasil Per Suite', { heading: HeadingLevel.HEADING_1 }),
      ...suiteSections,
      para('5. Kesimpulan & Rekomendasi', { heading: HeadingLevel.HEADING_1 }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800, 6560],
        rows: [
          new TableRow({ children: [headerCell('Item', 2800), headerCell('Keterangan', 6560)] }),
          new TableRow({ children: [makeCell('Status Sistem', { width: 2800, bold: true }), makeCell(parseFloat(successRate) === 100 ? 'SIAP PRODUKSI' : 'PERLU PERBAIKAN', { width: 6560, bold: true, color: verdictColor })] }),
          new TableRow({ children: [makeCell('Success Rate', { width: 2800, bold: true }), makeCell(`${successRate}% (${passedTests}/${totalTests} test lulus)`, { width: 6560 })] }),
          new TableRow({ children: [makeCell('Rekomendasi', { width: 2800, bold: true }), makeCell(
            parseFloat(successRate) === 100
              ? 'Seluruh skenario pengujian telah terpenuhi. Sistem dapat dilanjutkan ke tahap deployment.'
              : 'Terdapat kegagalan yang harus diperbaiki sebelum deployment.', { width: 6560 })] }),
          new TableRow({ children: [makeCell('Penandatangan', { width: 2800, bold: true }), makeCell('Tim Pengembang Sistem Rekam Medis Digital', { width: 6560 })] }),
          new TableRow({ children: [makeCell('Tanggal', { width: 2800, bold: true }), makeCell(generatedAt, { width: 6560 })] }),
        ]
      }),
      blank(), blank(),
      para('Dokumen ini dihasilkan secara otomatis dari output Jest test runner. Seluruh data bersumber dari eksekusi test yang sebenarnya.', {
        size: 18, italic: true, color: '7F7F7F', align: AlignmentType.CENTER }),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('integration-test-report.docx', buf);
  console.log('DOCX report:  integration-test-report.docx');
  console.log('');
  console.log(`Ringkasan: ${passedTests}/${totalTests} lulus (${successRate}%) - ${jsonReport.verdict}`);
});