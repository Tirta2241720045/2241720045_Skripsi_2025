import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ─── Auth helper ──────────────────────────────────────────────────────────────
const toBase64WithAuth = async (url: string): Promise<string> => {
  if (!url) return '';
  try {
    const token =
      localStorage.getItem('access_token') ||
      localStorage.getItem('token') ||
      localStorage.getItem('authToken') ||
      '';
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error('toBase64WithAuth failed:', err, 'URL:', url);
    return '';
  }
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const nl2br = (s: string) => escapeHtml(s).replace(/\n/g, '<br/>');

const todayDate = () =>
  new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

const todayFilename = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
};

// ─── Design tokens ────────────────────────────────────────────────────────────
const COLORS = {
  primary:    '#1a3a6b',   // deep navy
  accent:     '#2563eb',   // blue
  headerBg:   '#1a3a6b',
  headerText: '#ffffff',
  subHeader:  '#f0f4fa',
  border:     '#d1d9e6',
  labelBg:    '#f0f4fa',
  labelText:  '#44506a',
  cellBg:     '#ffffff',
  cellText:   '#1e2a3a',
  mutedText:  '#6b7a99',
  divider:    '#e2e8f0',
  badgeBg:    '#dbeafe',
  badgeText:  '#1d4ed8',
};

// ─── Shared HTML blocks ───────────────────────────────────────────────────────

/** Renders a professional document header with logo area, title, patient info */
const headerHtml = (
  title: string,
  patientName: string,
  patientMrn: string,
  recordId?: number,
) => `
  <div style="
    background:${COLORS.headerBg};
    color:${COLORS.headerText};
    padding:20px 32px 16px;
    margin:-32px -36px 0;
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
  ">
    <div>
      <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.65;margin-bottom:4px;">
        MEDICAL DOCUMENT
      </div>
      <div style="font-size:20px;font-weight:700;letter-spacing:-0.01em;">${title}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:9px;opacity:0.65;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px;">Document Date</div>
      <div style="font-size:12px;font-weight:600;">${todayDate()}</div>
    </div>
  </div>

  <div style="
    background:${COLORS.subHeader};
    border-bottom:2px solid ${COLORS.accent};
    padding:10px 32px;
    margin:0 -36px 28px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:16px;
  ">
    <div style="display:flex;align-items:center;gap:24px;">
      <div>
        <div style="font-size:9px;color:${COLORS.mutedText};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">Patient Name</div>
        <div style="font-size:14px;font-weight:700;color:${COLORS.primary};">${escapeHtml(patientName)}</div>
      </div>
      <div style="width:1px;height:32px;background:${COLORS.border};"></div>
      <div>
        <div style="font-size:9px;color:${COLORS.mutedText};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">MR Number</div>
        <div style="font-size:13px;font-weight:600;color:${COLORS.primary};">${escapeHtml(patientMrn)}</div>
      </div>
      ${recordId ? `
        <div style="width:1px;height:32px;background:${COLORS.border};"></div>
        <div>
          <div style="font-size:9px;color:${COLORS.mutedText};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:2px;">Record ID</div>
          <div style="font-size:13px;font-weight:600;color:${COLORS.primary};">#${recordId}</div>
        </div>` : ''}
    </div>
    <div style="
      background:${COLORS.badgeBg};
      color:${COLORS.badgeText};
      font-size:9px;
      font-weight:700;
      text-transform:uppercase;
      letter-spacing:0.08em;
      padding:4px 10px;
      border-radius:4px;
      border:1px solid ${COLORS.accent}33;
    ">CONFIDENTIAL</div>
  </div>`;

/** Renders a professional footer with staff signature and page number placeholder */
const footerHtml = (staffName: string) => `
  <div style="
    margin-top:40px;
    padding-top:16px;
    border-top:1px solid ${COLORS.divider};
    display:flex;
    justify-content:space-between;
    align-items:flex-end;
  ">
    <div>
      <div style="font-size:9px;color:${COLORS.mutedText};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Document prepared by</div>
      <div style="font-size:13px;font-weight:700;color:${COLORS.primary};">${escapeHtml(staffName)}</div>
      <div style="font-size:10px;color:${COLORS.mutedText};margin-top:2px;">${todayDate()}</div>
    </div>
    <div style="text-align:right;">
      <div style="
        font-size:8px;
        color:${COLORS.mutedText};
        border:1px solid ${COLORS.border};
        padding:6px 12px;
        border-radius:4px;
        background:${COLORS.subHeader};
      ">
        This document is generated electronically and is valid without a physical signature.<br/>
        For internal medical use only. Handle as per data privacy regulations.
      </div>
    </div>
  </div>`;

/** Renders a section label — used to separate logical blocks */
const sectionLabel = (label: string) => `
  <div style="
    font-size:9px;
    font-weight:700;
    text-transform:uppercase;
    letter-spacing:0.1em;
    color:${COLORS.accent};
    margin:20px 0 8px;
    padding-bottom:4px;
    border-bottom:1px solid ${COLORS.divider};
  ">${label}</div>`;

/** Renders a two-column info row used in structured data tables */
const thStyle = `
  background:${COLORS.headerBg};
  border:1px solid ${COLORS.primary}55;
  padding:10px 16px;
  font-size:10px;
  font-weight:700;
  text-align:left;
  letter-spacing:0.08em;
  text-transform:uppercase;
  color:#ffffff;
`;

const tdStyle = `
  border:1px solid ${COLORS.border};
  border-top:none;
  padding:14px 16px;
  vertical-align:top;
  font-size:12px;
  line-height:1.65;
  color:${COLORS.cellText};
  word-wrap:break-word;
  white-space:pre-wrap;
  background:${COLORS.cellBg};
`;

const tdLabelStyle = `
  border:1px solid ${COLORS.border};
  border-top:none;
  padding:14px 16px;
  vertical-align:top;
  font-size:11px;
  font-weight:700;
  color:${COLORS.primary};
  background:${COLORS.labelBg};
  white-space:nowrap;
  width:160px;
`;

// ─── Core PDF generator (multi-page) ─────────────────────────────────────────

/**
 * Renders an HTML element to a multi-page A4 PDF.
 * The canvas is sliced into A4-height segments and each becomes a page.
 */
const generatePDF = async (element: HTMLDivElement, filename: string): Promise<boolean> => {
  document.body.appendChild(element);
  try {
    // Render at 2× for crisp output
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageWidthMm  = pdf.internal.pageSize.getWidth();   // 210 mm
    const pageHeightMm = pdf.internal.pageSize.getHeight();  // 297 mm
    const marginMm     = 0; // we handle margins inside the HTML itself

    // How many canvas pixels = one A4 page height?
    // canvas width  → pageWidthMm
    // canvas height → (canvas.height / canvas.width) * pageWidthMm mm
    const totalCanvasWidth  = canvas.width;
    const totalCanvasHeight = canvas.height;

    const scaleFactor        = (pageWidthMm - marginMm * 2) / totalCanvasWidth; // mm per px
    const pageHeightPx       = (pageHeightMm - marginMm * 2) / scaleFactor;     // canvas px per A4 page

    const totalPages = Math.ceil(totalCanvasHeight / pageHeightPx);

    for (let page = 0; page < totalPages; page++) {
      if (page > 0) pdf.addPage();

      const srcY      = Math.round(page * pageHeightPx);
      const srcHeight = Math.min(pageHeightPx, totalCanvasHeight - srcY);

      // Slice the canvas for this page
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width  = totalCanvasWidth;
      pageCanvas.height = Math.ceil(srcHeight);

      const ctx = pageCanvas.getContext('2d')!;
      ctx.drawImage(canvas, 0, srcY, totalCanvasWidth, srcHeight, 0, 0, totalCanvasWidth, srcHeight);

      const imgData      = pageCanvas.toDataURL('image/png');
      const renderWidth  = pageWidthMm  - marginMm * 2;
      const renderHeight = srcHeight * scaleFactor;

      pdf.addImage(imgData, 'PNG', marginMm, marginMm, renderWidth, renderHeight);
    }

    pdf.save(filename);
    return true;
  } catch (err) {
    console.error('generatePDF error:', err);
    return false;
  } finally {
    document.body.removeChild(element);
  }
};

/**
 * Creates the off-screen container div with a fixed A4-like width
 * and generous padding for a clean document feel.
 */
const buildReportElement = (html: string, width = 1080): HTMLDivElement => {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    `width:${width}px`,
    'background:white',
    'font-family:"Segoe UI",Inter,Arial,sans-serif',
    'padding:32px 36px',
    'box-sizing:border-box',
    'line-height:1.5',
    '-webkit-font-smoothing:antialiased',
  ].join(';');
  el.innerHTML = html;
  return el;
};

// ─── Export: Medical Annotation Report ───────────────────────────────────────

export const downloadStegoReport = async (params: {
  originalData: string;
  annotation: string;
  patientName: string;
  patientAge: string;
  doctorName: string;
  onSuccess?: () => void;
  onError?: () => void;
}) => {
  const { originalData, annotation, patientName, patientAge, doctorName, onSuccess, onError } = params;

  const html = `
    ${headerHtml('Medical Annotation Report', patientName, patientAge)}

    ${sectionLabel('Original Record vs. Doctor\'s Annotation')}

    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
      <thead>
        <tr>
          <th style="${thStyle}">Original Record</th>
          <th style="${thStyle}border-left:2px solid #ffffff33;">Doctor's Annotation</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${tdStyle}">${nl2br(originalData || '(no data available)')}</td>
          <td style="${tdStyle}border-left:1px solid ${COLORS.divider};">${nl2br(annotation || '(no annotation provided)')}</td>
        </tr>
      </tbody>
    </table>

    ${footerHtml(doctorName)}`;

  const success = await generatePDF(
    buildReportElement(html),
    `Medical_Annotation_Report_${todayFilename()}.pdf`,
  );
  if (success) onSuccess?.(); else onError?.();
};

// ─── Export: Medical Extraction Report ───────────────────────────────────────

export const downloadExtractReport = async (params: {
  originalData: string;
  annotation: string;
  patientName: string;
  patientAge: string;
  doctorName: string;
  photoUrl: string;
  mriUrl: string;
  onSuccess?: () => void;
  onError?: () => void;
}) => {
  const { originalData, annotation, patientName, patientAge, doctorName, photoUrl, mriUrl, onSuccess, onError } = params;

  const [photoB64, mriB64] = await Promise.all([
    toBase64WithAuth(photoUrl),
    toBase64WithAuth(mriUrl),
  ]);

  const imgBox = (b64: string, label: string, dark = false) => `
    <div style="margin-bottom:16px;">
      <div style="
        font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
        color:${COLORS.accent};margin-bottom:6px;
      ">${label}</div>
      <div style="
        width:220px;height:220px;
        background:${dark ? '#0d1117' : '#f5f7fa'};
        border:1px solid ${COLORS.border};
        border-radius:4px;
        overflow:hidden;
        display:flex;align-items:center;justify-content:center;
      ">
        ${b64
          ? `<img src="${b64}" style="width:100%;height:100%;object-fit:contain;display:block;"/>`
          : `<div style="font-size:10px;color:${dark ? '#888' : '#aaa'};text-align:center;">No Image<br/>Available</div>`
        }
      </div>
    </div>`;

  const html = `
    ${headerHtml('Medical Extraction Report', patientName, patientAge)}

    ${sectionLabel('Clinical Images')}
    <div style="display:flex;gap:24px;margin-bottom:8px;">
      ${imgBox(photoB64, 'Patient Photo')}
      ${imgBox(mriB64,   'MRI Scan', true)}
    </div>

    ${sectionLabel('Record & Annotation')}
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
      <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
      <thead>
        <tr>
          <th style="${thStyle}">Original Record</th>
          <th style="${thStyle}border-left:2px solid #ffffff33;">Doctor's Annotation</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${tdStyle}">${nl2br(originalData || '(no data available)')}</td>
          <td style="${tdStyle}border-left:1px solid ${COLORS.divider};">${nl2br(annotation || '(no annotation provided)')}</td>
        </tr>
      </tbody>
    </table>

    ${footerHtml(doctorName)}`;

  const success = await generatePDF(
    buildReportElement(html, 1080),
    `Medical_Extraction_Report_${todayFilename()}.pdf`,
  );
  if (success) onSuccess?.(); else onError?.();
};

// ─── Export: Staff Medical Record Report ─────────────────────────────────────

export const downloadStaffReport = async (params: {
  diagnosis: string;
  annotation: string;
  patientName: string;
  patientMrn: string;
  recordId: number;
  staffName: string;
  stegoPhotoUrl?: string;
  onSuccess?: () => void;
  onError?: () => void;
}) => {
  const { diagnosis, annotation, patientName, patientMrn, recordId, staffName, stegoPhotoUrl, onSuccess, onError } = params;

  let stegoB64 = '';
  if (stegoPhotoUrl) stegoB64 = await toBase64WithAuth(stegoPhotoUrl);

  const stegoHtml = stegoB64
    ? `<img src="${stegoB64}" style="max-width:220px;max-height:220px;border-radius:4px;border:1px solid ${COLORS.border};display:block;"/>`
    : `<div style="
        width:220px;height:220px;background:${COLORS.subHeader};
        border:1px solid ${COLORS.border};border-radius:4px;
        display:flex;align-items:center;justify-content:center;
        font-size:11px;color:${COLORS.mutedText};text-align:center;
      ">No Image<br/>Available</div>`;

  const row = (label: string, content: string, isHtml = false) => `
    <tr>
      <td style="${tdLabelStyle}">${label}</td>
      <td style="${tdStyle}">${isHtml ? content : nl2br(content || `(no ${label.toLowerCase()} available)`)}</td>
    </tr>`;

  const html = `
    ${headerHtml('Medical Record Report', patientName, patientMrn, recordId)}

    ${sectionLabel('Patient Record Summary')}

    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="${thStyle}width:160px;">Field</th>
          <th style="${thStyle}border-left:2px solid #ffffff33;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${row('Stego Image', stegoHtml, true)}
        ${row('Diagnosis & Notes', diagnosis)}
        ${row('Staff Annotation', annotation)}
      </tbody>
    </table>

    ${footerHtml(staffName)}`;

  const success = await generatePDF(
    buildReportElement(html),
    `Medical_Report_${patientMrn}_${todayFilename()}.pdf`,
  );
  if (success) onSuccess?.(); else onError?.();
};