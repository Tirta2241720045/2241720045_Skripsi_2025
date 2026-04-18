import React, { useState, useEffect, useCallback } from 'react';
import { getAllPatients, PatientResponse } from '../../api/patients';
import { extractMedicalData, getMedicalRecordsByPatient, MedicalRecordItem, ExtractMedicalResponse } from '../../api/medical';
import Navbar from '../../components/shared/Navbar';
import '../../styles/DashboardDoctor.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface QualityLayer { mse: number; psnr: number; ssim: number; }
type PipelineStatus = 'idle' | 'running' | 'done' | 'error';
interface PipelineStep { id: string; label: string; sublabel: string; icon: string; status: 'pending' | 'active' | 'done'; }

const BASE_URL = 'http://localhost:8000';
const toUrl = (p: string) => p ? `${BASE_URL}/${p.replace(/\\/g, '/')}` : '';

const fetchTextContent = async (path: string): Promise<string> => {
  if (!path) return '(no data available)';
  try {
    const response = await fetch(toUrl(path));
    if (!response.ok) throw new Error('Failed to fetch');
    return await response.text();
  } catch {
    return 'Gagal memuat konten file';
  }
};

const formatDate = (iso: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
};
const todayDate = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const todayFilename = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${d.getFullYear()}`;
};
const calcAge = (dob: string) => {
  if (!dob) return '—';
  return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) + ' years old';
};

const urlToBase64WithAuth = async (url: string): Promise<string> => {
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
    console.error('urlToBase64WithAuth failed:', err, 'URL:', url);
    return '';
  }
};

const STEPS: PipelineStep[] = [
  { id: 'read',    label: 'Read Stego Image',   sublabel: 'Extract Least Significant Bit pixels (Red-Green-Blue)', icon: '📷', status: 'pending' },
  { id: 'layer2',  label: 'Reconstruct MRI',    sublabel: 'Rebuild grayscale from Layer 2',                       icon: '🩻', status: 'pending' },
  { id: 'layer1',  label: 'Extract Ciphertext', sublabel: 'Read Least Significant Bit stream from Layer 1',       icon: '🔎', status: 'pending' },
  { id: 'decrypt', label: 'AES-128 Decrypt',    sublabel: 'Cipher Block Chaining mode → plaintext',               icon: '🔓', status: 'pending' },
];

const noImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="250" height="250"%3E%3Crect fill="%23eef0f4" width="250" height="250"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23b0b8c8" font-size="12"%3ENo Image%3C/text%3E%3C/svg%3E';

const PIPELINE_INFO = {
  idle:    { icon: '🔐', title: 'Ready to Decrypt',      body: 'Press Extract Data to run the two-layer LSB steganography decryption pipeline. The system will reconstruct the MRI scan, extract the ciphertext, and decrypt the medical record.' },
  running: { icon: '⚙️', title: 'Processing…',            body: 'Pipeline is running. Each layer is being processed sequentially — LSB extraction, MRI reconstruction, ciphertext extraction, and AES-128 decryption.' },
  done:    { icon: '✅', title: 'Decryption Complete',    body: 'All pipeline stages completed successfully. The medical record has been decrypted and verified. Switch to the Extraction Result tab to review the output.' },
  error:   { icon: '⚠️', title: 'Pipeline Failed',        body: 'An error occurred during extraction. Please verify the stego image integrity and try again.' },
};

const MetricBadge = ({ label, val, type }: { label: string; val: string; type: '' | 'good' | 'ok' | 'bad' }) => (
  <div className={`mbadge ${type}`}><span className="mbadge-l">{label}</span><span className="mbadge-v">{val}</span></div>
);

const FileSizeRow = ({ label, kb }: { label: string; kb: number }) => (
  <div className="pl-filesize-row">
    <span className="pl-filesize-label">{label}</span>
    <span className="pl-filesize-val">{kb > 0 ? `${kb} KB` : '—'}</span>
  </div>
);

const FileSizeDeltaRow = ({ label, originalKb, extractedKb }: { label: string; originalKb: number; extractedKb: number }) => {
  const delta = Math.round((extractedKb - originalKb) * 100) / 100;
  const isPositive = delta >= 0;
  const deltaLabel = isPositive ? `+${delta} KB` : `${delta} KB`;
  return (
    <div className="pl-fsdelta-row">
      <span className="pl-fsdelta-label">{label}</span>
      <div className="pl-fsdelta-values">
        <span className="pl-fsdelta-ori">{originalKb > 0 ? `${originalKb} KB` : '—'}</span>
        <span className={`pl-fsdelta-delta ${isPositive ? 'pos' : 'neg'}`}>{originalKb > 0 && extractedKb > 0 ? deltaLabel : '—'}</span>
        <span className="pl-fsdelta-ext">{extractedKb > 0 ? `${extractedKb} KB` : '—'}</span>
      </div>
    </div>
  );
};

const MetricsPanel = ({
  metrics,
  title,
  stegoKb,
  extractFileSizes,
}: {
  metrics: { layer1_mri_stego: QualityLayer; layer2_photo_stego: QualityLayer };
  title: string;
  stegoKb?: number;
  extractFileSizes?: {
    original_photo_kb: number;
    original_mri_kb: number;
    original_txt_kb: number;
    extracted_photo_kb: number;
    extracted_mri_kb: number;
    extracted_txt_kb: number;
  };
}) => (
  <div className="pl-metrics">
    <div className="pl-metrics-hd">{title}</div>
    {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map(key => {
      const m = metrics[key];
      return (
        <div className="pl-metrics-layer-group" key={key}>
          <div className="pl-metrics-layer-label">{key === 'layer1_mri_stego' ? 'Layer 1 — MRI' : 'Layer 2 — Photo'}</div>
          <div className="pl-metrics-badges-vertical">
            <MetricBadge label="MSE"  val={m.mse.toFixed(3)}          type="" />
            <MetricBadge label="PSNR" val={`${m.psnr.toFixed(1)} dB`} type={m.psnr >= 40 ? 'good' : m.psnr >= 30 ? 'ok' : 'bad'} />
            <MetricBadge label="SSIM" val={m.ssim.toFixed(4)}          type={m.ssim >= 0.95 ? 'good' : m.ssim >= 0.85 ? 'ok' : 'bad'} />
          </div>
        </div>
      );
    })}
    {stegoKb !== undefined && (
      <div className="pl-filesize-block">
        <div className="pl-filesize-block-hd">File Size</div>
        <FileSizeRow label="Stego Image" kb={stegoKb} />
      </div>
    )}
    {extractFileSizes && (
      <div className="pl-filesize-block">
        <div className="pl-filesize-block-hd">File Size Comparison</div>
        <div className="pl-fsdelta-header">
          <span />
          <div className="pl-fsdelta-header-cols">
            <span>Original</span>
            <span>Delta</span>
            <span>Extracted</span>
          </div>
        </div>
        <FileSizeDeltaRow label="Photo"  originalKb={extractFileSizes.original_photo_kb} extractedKb={extractFileSizes.extracted_photo_kb} />
        <FileSizeDeltaRow label="MRI"    originalKb={extractFileSizes.original_mri_kb}   extractedKb={extractFileSizes.extracted_mri_kb} />
        <FileSizeDeltaRow label="TXT"    originalKb={extractFileSizes.original_txt_kb}   extractedKb={extractFileSizes.extracted_txt_kb} />
      </div>
    )}
  </div>
);

const Lightbox = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <div className="lightbox" onClick={onClose}>
    <img src={src} alt="" onClick={e => e.stopPropagation()} />
    <button className="lightbox-close" onClick={onClose}>✕</button>
  </div>
);

const AnnotPanel = ({ originalData, annotation, onAnnotChange, onDownload, showDownloadBtn = true, isLoading }: {
  originalData: string; annotation: string; onAnnotChange: (v: string) => void;
  onDownload: () => void; patientName: string; doctorName: string; showDownloadBtn?: boolean;
  isLoading?: boolean;
}) => (
  <div className="ddc-med-body">
    <div className="ddc-med-pane">
      <div className="ddc-med-pane-label">Original Record</div>
      <div className="ddc-scrollbox">
        {isLoading ? (
          <div className="ddc-loading-text">Memuat konten...</div>
        ) : (
          <pre className="ddc-pre">{originalData || '(no data available)'}</pre>
        )}
      </div>
    </div>
    <div className="ddc-med-divider" />
    <div className="ddc-med-pane">
      <div className="ddc-med-pane-label">
        Doctor's Annotation
        {showDownloadBtn && <button className="btn-download" onClick={onDownload}>⬇ Download</button>}
      </div>
      <textarea className="ddc-annot-area" placeholder="Add clinical notes, observations, or annotations here…" value={annotation} onChange={e => onAnnotChange(e.target.value)} />
    </div>
  </div>
);

const ExtractAnnotPanel = ({ originalData, annotation, onAnnotChange, photoUrl, mriUrl, onPhotoClick, onMriClick }: {
  originalData: string; annotation: string; onAnnotChange: (v: string) => void;
  photoUrl: string; mriUrl: string; onPhotoClick: () => void; onMriClick: () => void;
}) => (
  <div className="ddc-extract-body">
    <div className="ddc-extract-col ddc-extract-col-images">
      <div className="ddc-med-pane-label">Medical Image</div>
      <div className="ddc-extract-images-inner">
        <div className="ddc-extract-img-block">
          <div className="ddc-extract-img-sublabel">Patient Photo</div>
          <div className="ddc-extract-img-frame" onClick={onPhotoClick} title="Click to zoom">
            <img src={photoUrl} alt="" onError={e => { e.currentTarget.src = noImg; }} />
            <span className="ddc-av-zoom">🔍</span>
          </div>
        </div>
        <div className="ddc-extract-img-block ddc-extract-img-block-mri">
          <div className="ddc-extract-img-sublabel">MRI Image</div>
          <div className="ddc-extract-img-frame ddc-extract-img-frame-mri" onClick={onMriClick} title="Click to zoom">
            <img src={mriUrl} alt="" onError={e => { e.currentTarget.src = noImg; }} />
            <span className="ddc-av-zoom">🔍</span>
          </div>
        </div>
      </div>
    </div>
    <div className="ddc-med-divider" />
    <div className="ddc-extract-col ddc-extract-col-text">
      <div className="ddc-med-pane-label">Original Record</div>
      <div className="ddc-scrollbox"><pre className="ddc-pre">{originalData || '(no data available)'}</pre></div>
    </div>
    <div className="ddc-med-divider" />
    <div className="ddc-extract-col ddc-extract-col-text">
      <div className="ddc-med-pane-label">Doctor's Annotation</div>
      <textarea className="ddc-annot-area" placeholder="Add clinical notes, observations, or annotations here…" value={annotation} onChange={e => onAnnotChange(e.target.value)} />
    </div>
  </div>
);

const PipelineContent = ({ steps, pipelineStatus, record, extracted, plInfo }: {
  steps: PipelineStep[]; pipelineStatus: PipelineStatus;
  record: MedicalRecordItem | null; extracted: ExtractMedicalResponse | null;
  plInfo: typeof PIPELINE_INFO[PipelineStatus];
}) => (
  <>
    <div className="ddc-pl-hd">
      <span className="ddc-pl-title">Processing Pipeline</span>
      {pipelineStatus === 'done'  && <span className="chip chip-teal">✓ Done</span>}
      {pipelineStatus === 'error' && <span className="chip chip-red">✕ Failed</span>}
    </div>
    <div className="ddc-pl-steps">
      {steps.map((step, i) => (
        <div key={step.id} className={`ddc-pls ddc-pls-${step.status}`}>
          <div className="ddc-pls-track">
            <div className="ddc-pls-node">
              <span>{step.icon}</span>
              {step.status === 'done'   && <span className="ddc-pls-ok">✓</span>}
              {step.status === 'active' && <span className="ddc-pls-active-ring" />}
            </div>
            {i < steps.length - 1 && <div className={`ddc-pls-line ${step.status === 'done' ? 'done' : ''}`} />}
          </div>
          <div className="ddc-pls-text">
            <span className="ddc-pls-label">{step.label}</span>
            <span className="ddc-pls-sub">{step.sublabel}</span>
          </div>
        </div>
      ))}
    </div>
    {record?.quality_metrics?.embedding && !extracted && (
      <MetricsPanel
        metrics={record.quality_metrics.embedding}
        title="Embedding Quality"
        stegoKb={record.file_sizes?.stego_kb}
      />
    )}
    {extracted?.quality_metrics?.extraction && (
      <MetricsPanel
        metrics={extracted.quality_metrics.extraction}
        title="Extraction Quality"
        extractFileSizes={
          extracted.file_sizes
            ? {
                original_photo_kb:   record?.file_sizes?.original_photo_kb  ?? extracted.file_sizes.original_photo_kb,
                original_mri_kb:     record?.file_sizes?.original_mri_kb    ?? extracted.file_sizes.original_mri_kb,
                original_txt_kb:     record?.file_sizes?.original_txt_kb    ?? 0,
                extracted_photo_kb:  extracted.file_sizes.extracted_photo_kb,
                extracted_mri_kb:    extracted.file_sizes.extracted_mri_kb,
                extracted_txt_kb:    extracted.file_sizes.extracted_txt_kb,
              }
            : undefined
        }
      />
    )}
    <div className={`ddc-pl-info ddc-pl-info-${pipelineStatus}`}>
      <div className="ddc-pl-info-icon">{plInfo.icon}</div>
      <div className="ddc-pl-info-body">
        <span className="ddc-pl-info-title">{plInfo.title}</span>
        <p style={{ textAlign: 'justify' }}>{plInfo.body}</p>
      </div>
    </div>
    {pipelineStatus === 'done' && extracted?.extract_time_seconds !== undefined && (
      <div className="ddc-pl-time">
        <span>Execution Time</span>
        <span className="ddc-pl-time-val">{extracted.extract_time_seconds.toFixed(3)}s</span>
      </div>
    )}
  </>
);

const DashboardDoctor = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [patients,        setPatients]        = useState<PatientResponse[]>([]);
  const [selected,        setSelected]        = useState<PatientResponse | null>(null);
  const [record,          setRecord]          = useState<MedicalRecordItem | null>(null);
  const [patientPhotos,   setPatientPhotos]   = useState<Record<number, string>>({});
  const [extracted,       setExtracted]       = useState<ExtractMedicalResponse | null>(null);
  const [extractLoading,  setExtractLoading]  = useState(false);
  const [pipelineStatus,  setPipelineStatus]  = useState<PipelineStatus>('idle');
  const [steps,           setSteps]           = useState<PipelineStep[]>(STEPS.map(s => ({ ...s })));
  const [notif,           setNotif]           = useState({ show: false, msg: '', type: 'success' });
  const [search,          setSearch]          = useState('');
  const [tab,             setTab]             = useState<'stego' | 'extract'>('stego');
  const [lightbox,        setLightbox]        = useState<string | null>(null);
  const [annotation,      setAnnotation]      = useState('');
  const [annotExtract,    setAnnotExtract]    = useState('');
  const [sidebarOpen,     setSidebarOpen]     = useState(false);
  const [pipelineOpen,    setPipelineOpen]    = useState(false);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loadingContent,  setLoadingContent]  = useState<boolean>(false);

  const showNotif = useCallback((msg: string, type: string) => setNotif({ show: true, msg, type }), []);

  useEffect(() => {
    if (!notif.show) return;
    const t = setTimeout(() => setNotif(n => ({ ...n, show: false })), 3500);
    return () => clearTimeout(t);
  }, [notif.show]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightbox(null); setSidebarOpen(false); setPipelineOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadPatients = useCallback(async () => {
    try {
      const data = await getAllPatients();
      setPatients(data);
      const pm: Record<number, string> = {};
      await Promise.allSettled(data.map(async p => {
        try {
          const r = await getMedicalRecordsByPatient(p.patient_id);
          if (r.records?.length > 0) pm[p.patient_id] = toUrl(r.records[0].stego_photo_path);
        } catch { }
      }));
      setPatientPhotos(pm);
    } catch { showNotif('Failed to load patient data', 'error'); }
  }, [showNotif]);

  const loadRecord = useCallback(async (pid: number) => {
    try {
      const r = await getMedicalRecordsByPatient(pid);
      const rec = r.records?.length > 0 ? r.records[0] : null;
      setRecord(rec);
      setAnnotation('');
      setAnnotExtract('');
      if (rec?.medical_data_path) {
        setLoadingContent(true);
        const content = await fetchTextContent(rec.medical_data_path);
        setOriginalContent(content);
        setLoadingContent(false);
      } else {
        setOriginalContent('');
      }
    } catch {
      setRecord(null);
      setOriginalContent('');
    }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  useEffect(() => {
    setExtracted(null);
    setTab('stego');
    setPipelineStatus('idle');
    setSteps(STEPS.map(s => ({ ...s })));
    setAnnotation('');
    setAnnotExtract('');
    setOriginalContent('');
    if (selected) loadRecord(selected.patient_id);
    else setRecord(null);
  }, [selected, loadRecord]);

  const runPipeline = async () => {
    const delays = [600, 700, 700, 650];
    setSteps(STEPS.map(s => ({ ...s, status: 'pending' })));
    setPipelineStatus('running');
    for (let i = 0; i < STEPS.length; i++) {
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'active' } : s));
      await new Promise(r => setTimeout(r, delays[i]));
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' } : s));
    }
  };

  const handleExtract = async () => {
    if (!record) return;
    setExtractLoading(true);
    setExtracted(null);
    setTab('extract');
    try {
      const [data] = await Promise.all([extractMedicalData(record.record_id), runPipeline()]);
      setExtracted(data);
      setPipelineStatus('done');
      showNotif('Medical data successfully decrypted', 'success');
    } catch (err: any) {
      setPipelineStatus('error');
      showNotif(err?.response?.data?.detail || 'Failed to extract medical data', 'error');
    } finally {
      setExtractLoading(false);
    }
  };

  const generatePDF = async (element: HTMLDivElement, filename: string) => {
    document.body.appendChild(element);
    try {
      const canvas = await html2canvas(element, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const usableWidth = pageWidth - margin * 2;
      const ratio = canvas.height / canvas.width;
      let renderWidth = usableWidth;
      let renderHeight = renderWidth * ratio;
      if (renderHeight > pageHeight - margin * 2) { renderHeight = pageHeight - margin * 2; renderWidth = renderHeight / ratio; }
      pdf.addImage(imgData, 'PNG', (pageWidth - renderWidth) / 2, margin, renderWidth, renderHeight);
      pdf.save(filename);
      showNotif('Report downloaded as PDF', 'success');
    } catch { showNotif('Failed to generate PDF', 'error'); }
    finally { document.body.removeChild(element); }
  };

  const buildReportElement = (html: string, width = 1000): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;background:white;font-family:Segoe UI,Arial,sans-serif;padding:32px 36px;box-sizing:border-box;`;
    el.innerHTML = html;
    return el;
  };

  const esc   = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nl2br = (s: string) => esc(s).replace(/\n/g, '<br/>');

  const headerHtml = (title: string, patientName: string, patientAge: string) => `
    <div style="margin-bottom:24px;">
      <div style="font-size:22px;font-weight:700;color:#0d1117;text-align:center;margin-bottom:6px;">${title}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #e0e4ea;padding-bottom:10px;">
        <div><span style="font-size:13px;color:#667;">Patient:</span><span style="font-size:15px;font-weight:600;color:#0d1117;margin-left:6px;">${esc(patientName)}</span></div>
        <div><span style="font-size:12px;color:#667;">Age: ${esc(patientAge)}</span></div>
      </div>
    </div>`;

  const footerHtml = (doctorName: string) => `
    <div style="margin-top:24px;text-align:right;">
      <div style="font-size:13px;font-weight:600;color:#0d1117;">${esc(doctorName)}</div>
      <div style="font-size:10px;color:#667;">${todayDate()}</div>
    </div>`;

  const thStyle = 'background:#f0f2f6;border:1px solid #ccc;padding:8px 14px;font-size:10px;font-weight:700;text-align:left;letter-spacing:0.05em;text-transform:uppercase;color:#44506a;';
  const tdStyle = 'border:1px solid #ccc;border-top:none;padding:12px 14px;vertical-align:top;font-size:11px;line-height:1.5;color:#2a3245;word-wrap:break-word;white-space:pre-wrap;background:#fff;';

  const handleDownloadStego = async (originalData: string, annotationText: string, patientName: string, patientAge: string) => {
    const doctorName = user.full_name || 'Doctor';
    const html = `
      ${headerHtml('Medical Annotation Report', patientName, patientAge)}
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
        <thead><tr>
          <th style="${thStyle}">Original Record</th>
          <th style="${thStyle.replace('border:1px','border-left:none;border:1px')}">Doctor's Annotation</th>
        </tr></thead>
        <tbody><tr>
          <td style="${tdStyle}">${nl2br(originalData || '(no data available)')}</td>
          <td style="${tdStyle} border-left:none;">${nl2br(annotationText || '(no annotation)')}</td>
        </tr></tbody>
      </table>
      ${footerHtml(doctorName)}`;
    await generatePDF(buildReportElement(html), `Medical_Annotation_Report_${todayFilename()}.pdf`);
  };

  const handleDownloadExtract = async (
    originalData: string, annotationText: string, patientName: string, patientAge: string,
    photoUrl: string, mriUrl: string,
  ) => {
    const doctorName = user.full_name || 'Doctor';

    const [photoB64, mriB64] = await Promise.all([
      urlToBase64WithAuth(photoUrl),
      urlToBase64WithAuth(mriUrl),
    ]);

    const imgTag = (b64: string) => b64
      ? `<img src="${b64}" style="width:100%;height:100%;object-fit:contain;display:block;"/>`
      : `<div style="width:100%;height:100%;background:#eee;display:flex;align-items:center;justify-content:center;font-size:11px;color:#999;">No Image</div>`;

    const html = `
      ${headerHtml('Medical Extraction Report', patientName, patientAge)}
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <colgroup><col style="width:24%"/><col style="width:38%"/><col style="width:38%"/></colgroup>
        <thead><tr>
          <th style="${thStyle}">Medical Image</th>
          <th style="${thStyle} border-left:none;">Original Record</th>
          <th style="${thStyle} border-left:none;">Doctor's Annotation</th>
        </tr></thead>
        <tbody><tr>
          <td style="border:1px solid #ccc;border-top:none;padding:10px;vertical-align:top;">
            <div style="margin-bottom:8px;">
              <div style="font-size:9px;font-weight:700;color:#1a4fa0;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Patient Photo</div>
              <div style="width:200px;height:200px;background:#f5f5f5;border:1px solid #e0e4ea;margin:0 auto;">${imgTag(photoB64)}</div>
            </div>
            <div>
              <div style="font-size:9px;font-weight:700;color:#1a4fa0;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">MRI Image</div>
              <div style="width:200px;height:200px;background:#0d1117;border:1px solid #e0e4ea;margin:0 auto;">${imgTag(mriB64)}</div>
            </div>
          </td>
          <td style="${tdStyle} border-left:none;">${nl2br(originalData || '(no data available)')}</td>
          <td style="${tdStyle} border-left:none;">${nl2br(annotationText || '(no annotation)')}</td>
        </tr></tbody>
      </table>
      ${footerHtml(doctorName)}`;
    await generatePDF(buildReportElement(html, 1100), `Medical_Extraction_Report_${todayFilename()}.pdf`);
  };

  const filtered = patients.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    p.medical_record_no.toLowerCase().includes(search.toLowerCase())
  );
  const getPhoto = (id: number) => patientPhotos[id] || null;
  const plInfo   = PIPELINE_INFO[pipelineStatus];

  const handleSelectPatient = (p: PatientResponse) => {
    setSelected(prev => prev?.patient_id === p.patient_id ? null : p);
    setSidebarOpen(false);
  };

  const showExtractButton = record && pipelineStatus !== 'done';

  return (
    <div className="ddc">
      <Navbar userFullName={user.full_name} userRole={user.role} />
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {notif.show && (
        <div className={`ddc-toast ddc-toast-${notif.type}`}>
          <span>{notif.type === 'success' ? '✓' : notif.type === 'error' ? '✕' : 'ℹ'}</span>
          {notif.msg}
        </div>
      )}

      <div className={`ddc-sb-overlay ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className={`ddc-pipeline-sheet-overlay ${pipelineOpen ? 'visible' : ''}`} onClick={() => setPipelineOpen(false)} />

      <div className={`ddc-pipeline-sheet ${pipelineOpen ? 'open' : ''}`}>
        <div className="ddc-pipeline-sheet-handle" />
        <button className="ddc-pipeline-sheet-close" onClick={() => setPipelineOpen(false)}>✕</button>
        <div className="ddc-pipeline-sheet-inner">
          <PipelineContent steps={steps} pipelineStatus={pipelineStatus} record={record} extracted={extracted} plInfo={plInfo} />
        </div>
      </div>

      <div className="ddc-layout">
        <aside className={`ddc-sb ${sidebarOpen ? 'ddc-sb-open' : ''}`}>
          <div className="ddc-sb-hd">
            <div className="ddc-sb-hd-top">
              <span className="ddc-sb-hd-title">Patient List</span>
              <span className="ddc-sb-hd-count">{patients.length}</span>
            </div>
            <div className="ddc-sb-search">
              <span>⌕</span>
              <input placeholder="Name or Medical Record No." value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button onClick={() => setSearch('')}>✕</button>}
            </div>
          </div>
          <div className="ddc-sb-list">
            {filtered.length === 0 ? (
              <div className="ddc-sb-empty"><span>🔍</span><p>No patients found</p></div>
            ) : filtered.map(p => {
              const photo  = getPhoto(p.patient_id);
              const active = selected?.patient_id === p.patient_id;
              return (
                <button key={p.patient_id} className={`ddc-sb-item ${active ? 'active' : ''}`} onClick={() => handleSelectPatient(p)}>
                  <div className={`ddc-av ddc-av-${p.gender}`}>{photo ? <img src={photo} alt="" /> : p.full_name.charAt(0).toUpperCase()}</div>
                  <div className="ddc-sb-item-info">
                    <span className="ddc-sb-item-name">{p.full_name}</span>
                    <span className="ddc-sb-item-sub">{p.medical_record_no} · {calcAge(p.date_of_birth)}</span>
                  </div>
                  <span className={`ddc-dot ddc-dot-${p.gender}`} />
                </button>
              );
            })}
          </div>
        </aside>

        <div className="ddc-main">
          <div className="ddc-mob-nav">
            <button className="ddc-mob-nav-btn" onClick={() => setSidebarOpen(true)}>
              👥 Patients <span className="ddc-mob-nav-count">{patients.length}</span>
            </button>
            {selected && (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'center', padding: '0 8px' }}>
                {selected.full_name}
              </span>
            )}
            <button className="ddc-mob-nav-btn ddc-mob-nav-btn-pipeline" onClick={() => setPipelineOpen(true)}>
              ⚙️ Pipeline
              {pipelineStatus === 'done' && <span style={{ marginLeft: 4, color: 'var(--teal)', fontSize: 10 }}>✓</span>}
            </button>
          </div>

          {!selected ? (
            <div className="ddc-welcome">
              <div className="ddc-welcome-inner">
                <div className="ddc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Doctor'}</h2>
                <p>Select a patient from the list to view their medical record and perform steganographic data extraction.</p>
                <div className="ddc-stats">
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.length}</span><span className="ddc-stat-l">Total Patients</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.filter(p => p.gender === 'M').length}</span><span className="ddc-stat-l">Male</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.filter(p => p.gender === 'F').length}</span><span className="ddc-stat-l">Female</span></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ddc-detail">
              <div className="ddc-pbar">
                <div
                  className={`ddc-av ddc-av-lg ddc-av-${selected.gender} ddc-av-clickable`}
                  onClick={() => { const ph = getPhoto(selected.patient_id); if (ph) setLightbox(ph); }}
                  title="Click to zoom"
                >
                  {getPhoto(selected.patient_id) ? <img src={getPhoto(selected.patient_id)!} alt="" /> : selected.full_name.charAt(0).toUpperCase()}
                  <span className="ddc-av-zoom">🔍</span>
                </div>
                <div className="ddc-pbar-info">
                  <span className="ddc-pbar-name">{selected.full_name}</span>
                  <div className="ddc-pbar-meta">
                    <span className="ddc-pbar-rm">{selected.medical_record_no}</span>
                    <span className="sep">·</span>
                    <span>{selected.gender === 'M' ? '♂ Male' : '♀ Female'}</span>
                    <span className="sep">·</span>
                    <span>{calcAge(selected.date_of_birth)}</span>
                    <span className="sep">·</span>
                    <span>Date of Birth: {formatDate(selected.date_of_birth)}</span>
                  </div>
                </div>
                {showExtractButton && (
                  <button
                    className={`ddc-btn-ext ${extractLoading ? 'loading' : ''}`}
                    onClick={handleExtract}
                    disabled={extractLoading}
                  >
                    {extractLoading ? <><span className="spin" />Extracting…</> : <>🔓 Extract Data</>}
                  </button>
                )}
              </div>

              <div className="ddc-workspace">
                <div className="ddc-content-panel">
                  {!record ? (
                    <div className="ddc-empty"><span>📁</span><p>No medical record found for this patient.</p></div>
                  ) : (
                    <>
                      <div className="ddc-tabs">
                        <button className={`ddc-tab ${tab === 'stego' ? 'act' : ''}`} onClick={() => setTab('stego')}>🔒 Stego Preview</button>
                        <button className={`ddc-tab ${tab === 'extract' ? 'act' : ''}`} onClick={() => setTab('extract')} disabled={!extracted && pipelineStatus !== 'running'}>
                          🔓 Extraction Result
                          {extracted && <span className="ddc-tab-pip" />}
                        </button>
                        <span className="ddc-tabs-fill" />
                        <span className="ddc-rec-badge">Record #{record.record_id} · {formatDate(record.upload_date ?? '')}</span>
                      </div>

                      {tab === 'stego' && (
                        <div className="ddc-tab-body">
                          <div className="ddc-card ddc-med-card">
                            <div className="card-hd">
                              <span className="card-title">Medical Data Preview</span>
                              <button className="btn-download" onClick={() => handleDownloadStego(originalContent, annotation, selected.full_name, calcAge(selected.date_of_birth))}>
                                ⬇ Download
                              </button>
                            </div>
                            <AnnotPanel
                              originalData={originalContent}
                              annotation={annotation}
                              onAnnotChange={setAnnotation}
                              onDownload={() => {}}
                              patientName={selected.full_name}
                              doctorName={user.full_name || 'Doctor'}
                              showDownloadBtn={false}
                              isLoading={loadingContent}
                            />
                            <div className="card-ft">
                              <span>🔐</span>
                              <span>Press <strong>Extract Data</strong> to decrypt the patient scan, MRI, and full medical record from the stego image.</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {tab === 'extract' && (
                        <div className="ddc-tab-body">
                          {pipelineStatus === 'running' && !extracted ? (
                            <div className="ddc-proc">
                              <div className="ddc-proc-dots"><span /><span /><span /></div>
                              <p>Extracting and decrypting medical data…</p>
                            </div>
                          ) : extracted ? (
                            <div className="ddc-card ddc-extract-card">
                              <div className="card-hd">
                                <span className="card-title">Diagnosis, Clinical Notes &amp; Medical Image</span>
                                <button className="btn-download" onClick={() => handleDownloadExtract(
                                  extracted.medical_data, annotExtract, extracted.patient_name, calcAge(selected.date_of_birth),
                                  toUrl(extracted.photo_path),
                                  toUrl(extracted.mri_path),
                                )}>⬇ Download</button>
                              </div>
                              <ExtractAnnotPanel
                                originalData={extracted.medical_data}
                                annotation={annotExtract}
                                onAnnotChange={setAnnotExtract}
                                photoUrl={toUrl(extracted.photo_path)}
                                mriUrl={toUrl(extracted.mri_path)}
                                onPhotoClick={() => setLightbox(toUrl(extracted.photo_path))}
                                onMriClick={() => setLightbox(toUrl(extracted.mri_path))}
                              />
                              {extracted.extract_time_seconds !== undefined && (
                                <div className="card-ft">
                                  <span>⚡</span>
                                  <span>Extraction completed in <strong>{extracted.extract_time_seconds.toFixed(3)} seconds</strong></span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="ddc-empty"><span>🔐</span><p>Press <strong>Extract Data</strong> to begin decryption.</p></div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="ddc-pipeline">
                  <PipelineContent steps={steps} pipelineStatus={pipelineStatus} record={record} extracted={extracted} plInfo={plInfo} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardDoctor;