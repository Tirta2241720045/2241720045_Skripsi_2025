import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getAllPatients, PatientResponse } from '../../api/patients';
import {
  extractMedicalData,
  getMedicalRecordsByPatient,
  MedicalRecordItem,
  ExtractMedicalResponse,
  LayerMetrics,
  AccTxtResult,
} from '../../api/medical';
import Navbar from '../../components/shared/Navbar';
import '../../styles/DashboardMedical.css';
import { downloadStegoReport, downloadExtractReport } from '../../components/shared/pdfReport';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type PipelineStatus = 'idle' | 'running' | 'done' | 'error';

interface PipelineStep {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  status: 'pending' | 'active' | 'done';
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const STEPS: PipelineStep[] = [
  { id: 'read', label: 'Read Stego Image', sublabel: 'Extract LSB pixels (RGB)', icon: '📷', status: 'pending' },
  { id: 'layer2', label: 'Reconstruct MRI', sublabel: 'Rebuild grayscale from Layer 2', icon: '🩻', status: 'pending' },
  { id: 'layer1', label: 'Extract Ciphertext', sublabel: 'Read LSB stream from Layer 1', icon: '🔎', status: 'pending' },
  { id: 'decrypt', label: 'AES-128 Decrypt', sublabel: 'CBC mode → plaintext', icon: '🔓', status: 'pending' },
];

const PIPELINE_INFO = {
  idle: { 
    icon: '🔐', 
    title: 'Ready to Decrypt', 
    body: 'Press Extract Data to run the two-layer LSB steganography decryption pipeline.' 
  },
  running: { 
    icon: '⚙️', 
    title: 'Processing…', 
    body: 'Pipeline is running. Each layer is processed sequentially.' 
  },
  done: { 
    icon: '✅', 
    title: 'Decryption Complete', 
    body: 'All pipeline stages completed successfully.' 
  },
  error: { 
    icon: '⚠️', 
    title: 'Pipeline Failed', 
    body: 'An error occurred during extraction. Please try again.' 
  },
};

const noImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="250" height="250"%3E%3Crect fill="%23eef0f4" width="250" height="250"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23b0b8c8" font-size="12"%3ENo Image%3C/text%3E%3C/svg%3E';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const toUrl = (p: string): string => {
  return p ? `${BASE_URL}/${p.replace(/\\/g, '/')}` : '';
};

const fetchTextContent = async (path: string): Promise<string> => {
  if (!path) return '(no data available)';
  try {
    const response = await fetch(toUrl(path));
    if (!response.ok) throw new Error('Failed to fetch');
    return await response.text();
  } catch {
    return 'Failed to load file content';
  }
};

const formatDate = (iso: string): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
};

const calcAge = (dob: string): string => {
  if (!dob) return '—';
  const age = Math.floor(
    (Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  );
  return `${age} years old`;
};

const getQualityType = (
  psnr: number, 
  ssim: number, 
  mse: number,
  brisque: number, 
  niqe: number, 
  piqe: number,
  acctxt: number | null
): 'good' | 'ok' | 'bad' => {
  if (psnr >= 40 && ssim >= 0.95 && mse >= 0 && brisque < 45 && niqe <= 8 && piqe < 35 && (acctxt === null || acctxt === 100)) {
    return 'good';
  }
  if (psnr >= 30 && ssim >= 0.85 && brisque < 50 && niqe <= 12 && piqe < 45 && (acctxt === null || acctxt >= 90)) {
    return 'ok';
  }
  return 'bad';
};

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

const MetricBadge = ({ label, val, type }: { label: string; val: string; type: 'good' | 'ok' | 'bad' }) => (
  <div className={`dmc-mbadge ${type}`}>
    <span className="dmc-mbadge-l">{label}</span>
    <span className="dmc-mbadge-v">{val}</span>
  </div>
);

const AccTxtSlideContent = ({ acctxt }: { acctxt: AccTxtResult | null | undefined }) => {
  if (!acctxt || acctxt.acc_txt === null || acctxt.T === null) {
    return (
      <div className="dmc-metrics-layer-group" style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 11, padding: '16px 10px' }}>
        No AccTxt data available
      </div>
    );
  }
  
  const pct = acctxt.acc_txt;
  const type: 'good' | 'ok' | 'bad' = pct === 100 ? 'good' : pct >= 90 ? 'ok' : 'bad';
  
  return (
    <div className="dmc-metrics-layer-group">
      <div className="dmc-acctxt-inline-header">
        <span className="dmc-metrics-layer-label">Text Recovery Accuracy</span>
        <span className={`dmc-acctxt-badge dmc-acctxt-badge-${type}`}>{pct.toFixed(4)}%</span>
      </div>
      <div className="dmc-acctxt-bar-wrap" style={{ padding: '0 0 8px 0' }}>
        <div className="dmc-acctxt-bar-track">
          <div className={`dmc-acctxt-bar-fill dmc-acctxt-bar-${type}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      </div>
      <div className="dmc-metrics-badges-vertical">
        <div className="dmc-mbadge">
          <span className="dmc-mbadge-l">D (bits correct)</span>
          <span className="dmc-mbadge-v">{acctxt.D?.toLocaleString() ?? '—'}</span>
        </div>
        <div className="dmc-mbadge">
          <span className="dmc-mbadge-l">T (bits total)</span>
          <span className="dmc-mbadge-v">{acctxt.T.toLocaleString()}</span>
        </div>
        <div className={`dmc-mbadge ${(acctxt.bit_errors ?? 0) > 0 ? 'bad' : 'good'}`}>
          <span className="dmc-mbadge-l">Bit Errors</span>
          <span className="dmc-mbadge-v">{acctxt.bit_errors ?? 0}</span>
        </div>
      </div>
    </div>
  );
};

const FileSizeSlideContent = ({
  stegoKb,
  extractFileSizes,
}: {
  stegoKb?: number;
  extractFileSizes?: {
    original_photo_kb: number;
    original_mri_kb: number;
    original_txt_kb: number;
    extracted_photo_kb: number;
    extracted_mri_kb: number;
    extracted_txt_kb: number;
  } | null;
}) => {
  if (extractFileSizes) {
    const rows = [
      { label: 'Photo', orig: extractFileSizes.original_photo_kb, ext: extractFileSizes.extracted_photo_kb },
      { label: 'MRI', orig: extractFileSizes.original_mri_kb, ext: extractFileSizes.extracted_mri_kb },
      { label: 'TXT', orig: extractFileSizes.original_txt_kb, ext: extractFileSizes.extracted_txt_kb },
    ];
    
    return (
      <div className="dmc-metrics-layer-group">
        <div className="dmc-metrics-layer-label">File Size Comparison</div>
        <div className="dmc-fsdelta-header-inline">
          <span />
          <div className="dmc-fsdelta-header-cols">
            <span>Original</span>
            <span>Delta</span>
            <span>Extracted</span>
          </div>
        </div>
        {rows.map(({ label, orig, ext }) => {
          const delta = Math.round((ext - orig) * 100) / 100;
          const isPos = delta >= 0;
          return (
            <div className="dmc-fsdelta-row-inline" key={label}>
              <span className="dmc-fsdelta-label">{label}</span>
              <div className="dmc-fsdelta-values">
                <span className="dmc-fsdelta-ori">{orig > 0 ? `${orig} KB` : '—'}</span>
                <span className={`dmc-fsdelta-delta ${isPos ? 'pos' : 'neg'}`}>
                  {orig > 0 && ext > 0 ? (isPos ? `+${delta}` : `${delta}`) + ' KB' : '—'}
                </span>
                <span className="dmc-fsdelta-ext">{ext > 0 ? `${ext} KB` : '—'}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  
  return (
    <div className="dmc-metrics-layer-group">
      <div className="dmc-metrics-layer-label">File Size</div>
      <div className="dmc-fsdelta-row-inline" style={{ justifyContent: 'space-between' }}>
        <span className="dmc-fsdelta-label" style={{ width: 'auto' }}>Stego Image</span>
        <span className="dmc-mbadge-v" style={{ color: 'var(--brand)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {stegoKb && stegoKb > 0 ? `${stegoKb} KB` : '—'}
        </span>
      </div>
    </div>
  );
};

const MetricsSlider = ({ 
  metrics, 
  stegoKb, 
  acctxt, 
  extractFileSizes 
}: {
  metrics: LayerMetrics;
  stegoKb?: number;
  acctxt?: AccTxtResult | null;
  extractFileSizes?: {
    original_photo_kb: number;
    original_mri_kb: number;
    original_txt_kb: number;
    extracted_photo_kb: number;
    extracted_mri_kb: number;
    extracted_txt_kb: number;
  } | null;
}) => {
  const [slide, setSlide] = useState(0);
  
  const slides = [
    {
      label: 'FR-IQA',
      sublabel: 'Full-Reference Quality',
      render: () => (
        <>
          {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map(key => {
            const m = metrics[key];
            const type = getQualityType(m.psnr, m.ssim, m.mse, 0, 0, 0, null);
            return (
              <div className="dmc-metrics-layer-group" key={key}>
                <div className="dmc-metrics-layer-label">
                  {key === 'layer1_mri_stego' ? 'Layer 1 — MRI' : 'Layer 2 — Photo'}
                </div>
                <div className="dmc-metrics-badges-vertical">
                  <MetricBadge label="MSE" val={m.mse.toFixed(3)} type={type} />
                  <MetricBadge label="PSNR" val={`${m.psnr.toFixed(1)} dB`} type={type} />
                  <MetricBadge label="SSIM" val={m.ssim.toFixed(4)} type={type} />
                </div>
              </div>
            );
          })}
        </>
      )
    },
    {
      label: 'NR-IQA',
      sublabel: 'No-Reference Quality',
      render: () => (
        <>
          {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map(key => {
            const m = metrics[key];
            const type = getQualityType(0, 0, 0, m.brisque || 0, m.niqe || 0, m.piqe || 0, null);
            return (
              <div className="dmc-metrics-layer-group" key={key}>
                <div className="dmc-metrics-layer-label">
                  {key === 'layer1_mri_stego' ? 'Layer 1 — MRI' : 'Layer 2 — Photo'}
                </div>
                <div className="dmc-metrics-badges-vertical">
                  <MetricBadge label="BRISQUE" val={m.brisque?.toFixed(3) || 'N/A'} type={type} />
                  <MetricBadge label="NIQE" val={m.niqe?.toFixed(3) || 'N/A'} type={type} />
                  <MetricBadge label="PIQE" val={m.piqe?.toFixed(3) || 'N/A'} type={type} />
                </div>
              </div>
            );
          })}
        </>
      )
    },
    {
      label: 'AccTxt',
      sublabel: 'Text Recovery Accuracy',
      render: () => <AccTxtSlideContent acctxt={acctxt} />
    },
    {
      label: 'File Size',
      sublabel: extractFileSizes ? 'Original vs Extracted' : 'Stego Image Size',
      render: () => <FileSizeSlideContent stegoKb={stegoKb} extractFileSizes={extractFileSizes} />
    },
  ];

  return (
    <div className="dmc-quality-card">
      <div className="dmc-metrics-hd">
        <span>Metric Quality</span>
        <div className="dmc-metrics-slider-nav">
          <button 
            className="dmc-metrics-nav-btn" 
            onClick={() => setSlide(s => Math.max(0, s - 1))} 
            disabled={slide === 0}
          >
            ‹
          </button>
          <span className="dmc-metrics-slide-label">{slides[slide].label}</span>
          <button 
            className="dmc-metrics-nav-btn" 
            onClick={() => setSlide(s => Math.min(slides.length - 1, s + 1))} 
            disabled={slide === slides.length - 1}
          >
            ›
          </button>
        </div>
      </div>
      <div className="dmc-metrics-slide-sublabel">{slides[slide].sublabel}</div>
      <div className="dmc-metrics-body">{slides[slide].render()}</div>
      <div className="dmc-metrics-dots">
        {slides.map((_, i) => (
          <span 
            key={i} 
            className={`dmc-metrics-dot ${i === slide ? 'active' : ''}`} 
            onClick={() => setSlide(i)} 
          />
        ))}
      </div>
    </div>
  );
};

const Lightbox = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <div className="dmc-lightbox" onClick={onClose}>
    <img src={src} alt="" onClick={e => e.stopPropagation()} />
    <button className="dmc-lightbox-close" onClick={onClose}>✕</button>
  </div>
);

const AnnotPanel = ({ 
  originalData, 
  annotation, 
  onAnnotChange, 
  isLoading 
}: {
  originalData: string;
  annotation: string;
  onAnnotChange: (v: string) => void;
  isLoading?: boolean;
}) => (
  <div className="dmc-med-body">
    <div className="dmc-med-pane">
      <div className="dmc-med-pane-label">Original Record</div>
      <div className="dmc-scrollbox">
        {isLoading ? (
          <div className="dmc-loading-text">Loading content...</div>
        ) : (
          <pre className="dmc-pre">{originalData || '(no data available)'}</pre>
        )}
      </div>
    </div>
    <div className="dmc-med-divider" />
    <div className="dmc-med-pane">
      <div className="dmc-med-pane-label">Doctor's Annotation</div>
      <textarea 
        className="dmc-annot-area" 
        placeholder="Add clinical notes, observations, or annotations here…" 
        value={annotation} 
        onChange={e => onAnnotChange(e.target.value)} 
      />
    </div>
  </div>
);

const ExtractAnnotPanel = ({ 
  originalData, 
  annotation, 
  onAnnotChange, 
  photoUrl, 
  mriUrl, 
  onPhotoClick, 
  onMriClick 
}: {
  originalData: string;
  annotation: string;
  onAnnotChange: (v: string) => void;
  photoUrl: string;
  mriUrl: string;
  onPhotoClick: () => void;
  onMriClick: () => void;
}) => (
  <div className="dmc-extract-body">
    <div className="dmc-extract-col dmc-extract-col-images">
      <div className="dmc-med-pane-label">Medical Image</div>
      <div className="dmc-extract-images-inner">
        <div className="dmc-extract-img-block">
          <div className="dmc-extract-img-sublabel">Patient Photo</div>
          <div className="dmc-extract-img-frame" onClick={onPhotoClick} title="Click to zoom">
            <img src={photoUrl} alt="" onError={e => { e.currentTarget.src = noImg; }} />
            <span className="dmc-av-zoom">🔍</span>
          </div>
        </div>
        <div className="dmc-extract-img-block dmc-extract-img-block-mri">
          <div className="dmc-extract-img-sublabel">MRI Image</div>
          <div className="dmc-extract-img-frame dmc-extract-img-frame-mri" onClick={onMriClick} title="Click to zoom">
            <img src={mriUrl} alt="" onError={e => { e.currentTarget.src = noImg; }} />
            <span className="dmc-av-zoom">🔍</span>
          </div>
        </div>
      </div>
    </div>
    <div className="dmc-med-divider" />
    <div className="dmc-extract-col dmc-extract-col-text">
      <div className="dmc-med-pane-label">Original Record</div>
      <div className="dmc-scrollbox">
        <pre className="dmc-pre">{originalData || '(no data available)'}</pre>
      </div>
    </div>
    <div className="dmc-med-divider" />
    <div className="dmc-extract-col dmc-extract-col-text">
      <div className="dmc-med-pane-label">Doctor's Annotation</div>
      <textarea 
        className="dmc-annot-area" 
        placeholder="Add clinical notes, observations, or annotations here…" 
        value={annotation} 
        onChange={e => onAnnotChange(e.target.value)} 
      />
    </div>
  </div>
);

const PipelineContent = ({ 
  steps, 
  pipelineStatus, 
  record, 
  extracted, 
  plInfo 
}: {
  steps: PipelineStep[];
  pipelineStatus: PipelineStatus;
  record: MedicalRecordItem | null;
  extracted: ExtractMedicalResponse | null;
  plInfo: typeof PIPELINE_INFO[PipelineStatus];
}) => {
  const extractionAccTxt = extracted?.quality_metrics?.extraction?.acc_txt ?? null;
  const embeddingAccTxt = record?.quality_metrics?.extraction?.acc_txt ?? null;
  const extractFileSizes = (extracted?.file_sizes && record?.file_sizes) ? {
    original_photo_kb: record.file_sizes.original_photo_kb,
    original_mri_kb: record.file_sizes.original_mri_kb,
    original_txt_kb: record.file_sizes.original_txt_kb,
    extracted_photo_kb: extracted.file_sizes.extracted_photo_kb,
    extracted_mri_kb: extracted.file_sizes.extracted_mri_kb,
    extracted_txt_kb: extracted.file_sizes.extracted_txt_kb
  } : null;
  
  return (
    <>
      <div className="dmc-pl-hd">
        <span className="dmc-pl-title">Processing Pipeline</span>
        {pipelineStatus === 'done' && <span className="dmc-chip dmc-chip-teal">✓ Done</span>}
        {pipelineStatus === 'error' && <span className="dmc-chip dmc-chip-red">✕ Failed</span>}
      </div>
      
      <div className="dmc-pl-steps">
        {steps.map((step, i) => (
          <div key={step.id} className={`dmc-pls dmc-pls-${step.status}`}>
            <div className="dmc-pls-track">
              <div className="dmc-pls-node">
                <span>{step.icon}</span>
                {step.status === 'done' && <span className="dmc-pls-ok">✓</span>}
                {step.status === 'active' && <span className="dmc-pls-active-ring" />}
              </div>
              {i < steps.length - 1 && <div className={`dmc-pls-line ${step.status === 'done' ? 'done' : ''}`} />}
            </div>
            <div className="dmc-pls-text">
              <span className="dmc-pls-label">{step.label}</span>
              <span className="dmc-pls-sub">{step.sublabel}</span>
            </div>
          </div>
        ))}
      </div>
      
      {record?.quality_metrics?.embedding && !extracted && (
        <MetricsSlider 
          metrics={record.quality_metrics.embedding} 
          stegoKb={record.file_sizes?.stego_kb} 
          acctxt={embeddingAccTxt} 
          extractFileSizes={null} 
        />
      )}
      
      {extracted?.quality_metrics?.extraction && (
        <MetricsSlider 
          metrics={extracted.quality_metrics.extraction} 
          acctxt={extractionAccTxt} 
          extractFileSizes={extractFileSizes} 
        />
      )}
      
      {extracted && pipelineStatus === 'done' && extracted.extract_time_seconds !== undefined && (
        <div className="dmc-exec-time-card">
          <div className="dmc-exec-time-icon">⏱</div>
          <div className="dmc-exec-time-body">
            <span className="dmc-exec-time-label">Execution Time</span>
            <span className="dmc-exec-time-val">
              {extracted.extract_time_seconds.toFixed(3)} second{extracted.extract_time_seconds !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
      
      <div className={`dmc-pl-info dmc-pl-info-${pipelineStatus}`}>
        <div className="dmc-pl-info-icon">{plInfo.icon}</div>
        <div className="dmc-pl-info-body">
          <span className="dmc-pl-info-title">{plInfo.title}</span>
          <p style={{ textAlign: 'justify' }}>{plInfo.body}</p>
        </div>
      </div>
    </>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const DashboardDoctor = () => {
  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  
  // Patient related states
  const [patients, setPatients] = useState<PatientResponse[]>([]);
  const [selected, setSelected] = useState<PatientResponse | null>(null);
  const [patientPhotos, setPatientPhotos] = useState<Record<number, string>>({});
  
  // Medical record states
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecordItem[]>([]);
  const [activeRecordIndex, setActiveRecordIndex] = useState(0);
  const [originalContents, setOriginalContents] = useState<Record<number, string>>({});
  const [loadingContent, setLoadingContent] = useState<Record<number, boolean>>({});
  
  // Extraction states
  const [extracted, setExtracted] = useState<ExtractMedicalResponse | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle');
  const [steps, setSteps] = useState<PipelineStep[]>(STEPS.map(s => ({ ...s })));
  
  // UI states
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: string }>({ 
    show: false, message: '', type: 'success' 
  });
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'stego' | 'extract'>('stego');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [patientSwipeIndex, setPatientSwipeIndex] = useState(0);
  
  // Annotation states
  const [annotation, setAnnotation] = useState('');
  const [annotExtract, setAnnotExtract] = useState('');
  const [savedAnnotation, setSavedAnnotation] = useState(false);
  
  // Refs
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  // Derived states
  const filteredPatients = patients.filter(p => 
    p.full_name.toLowerCase().includes(search.toLowerCase()) || 
    p.medical_record_no.toLowerCase().includes(search.toLowerCase())
  );
  const activeRecord = medicalRecords[activeRecordIndex] ?? null;
  const activeOriginalContent = activeRecord ? originalContents[activeRecord.record_id] || '' : '';
  const activeLoadingContent = activeRecord ? loadingContent[activeRecord.record_id] || false : false;
  const plInfo = PIPELINE_INFO[pipelineStatus];
  const showExtractButton = activeRecord && pipelineStatus !== 'done';

  // --------------------------------------------------------------------------
  // Helper Functions
  // --------------------------------------------------------------------------
  const getPhoto = (id: number): string | null => {
    return patientPhotos[id] || null;
  };

  const showNotification = useCallback((message: string, type: string) => {
    setNotification({ show: true, message, type });
  }, []);

  const runPipeline = async () => {
    const delays = [600, 700, 700, 650];
    setSteps(STEPS.map(s => ({ ...s, status: 'pending' })));
    setPipelineStatus('running');
    
    for (let i = 0; i < STEPS.length; i++) {
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'active' as const } : s));
      await new Promise(r => setTimeout(r, delays[i]));
      setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' as const } : s));
    }
  };

  const handleAnnotationChange = (value: string) => {
    setAnnotation(value);
    setSavedAnnotation(false);
    
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    
    saveTimerRef.current = setTimeout(() => {
      setSavedAnnotation(true);
      setTimeout(() => setSavedAnnotation(false), 2000);
    }, 1500);
  };

  const handleSwipeTab = (dir: 'left' | 'right') => {
    if (dir === 'left' && tab === 'stego') {
      setTab('extract');
    } else if (dir === 'right' && tab === 'extract') {
      setTab('stego');
    }
  };

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------
  const handleSelectPatient = (p: PatientResponse) => {
    setSelected(prev => prev?.patient_id === p.patient_id ? null : p);
    setSidebarOpen(false);
  };

  const handleRecordClick = (index: number) => {
    setActiveRecordIndex(index);
    setExtracted(null);
    setPipelineStatus('idle');
    setSteps(STEPS.map(s => ({ ...s, status: 'pending' })));
    setAnnotation('');
    setAnnotExtract('');
    setTab('stego');
  };

  const handleExtract = async () => {
    const activeRecordData = medicalRecords[activeRecordIndex];
    if (!activeRecordData) return;
    
    setExtractLoading(true);
    setExtracted(null);
    setTab('extract');
    
    try {
      const [data] = await Promise.all([
        extractMedicalData(activeRecordData.record_id), 
        runPipeline()
      ]);
      setExtracted(data);
      setPipelineStatus('done');
      showNotification('Medical data successfully decrypted', 'success');
    } catch (err: any) {
      setPipelineStatus('error');
      showNotification(err?.response?.data?.detail || 'Failed to extract medical data', 'error');
    } finally {
      setExtractLoading(false);
    }
  };

  const handleDownloadStego = () => {
    if (!selected || !activeRecord) return;
    
    downloadStegoReport({
      originalData: activeOriginalContent,
      annotation,
      patientName: selected.full_name,
      patientAge: calcAge(selected.date_of_birth),
      doctorName: user.full_name || 'Doctor',
      onSuccess: () => showNotification('Report downloaded as PDF', 'success'),
      onError: () => showNotification('Failed to generate PDF', 'error')
    });
  };

  const handleDownloadExtract = () => {
    if (!selected || !extracted) return;
    
    downloadExtractReport({
      originalData: extracted.medical_data,
      annotation: annotExtract,
      patientName: extracted.patient_name,
      patientAge: calcAge(selected.date_of_birth),
      doctorName: user.full_name || 'Doctor',
      photoUrl: toUrl(extracted.photo_path),
      mriUrl: toUrl(extracted.mri_path),
      onSuccess: () => showNotification('Report downloaded as PDF', 'success'),
      onError: () => showNotification('Failed to generate PDF', 'error')
    });
  };

  // --------------------------------------------------------------------------
  // API Calls
  // --------------------------------------------------------------------------
  const loadPatients = useCallback(async () => {
    try {
      const data = await getAllPatients();
      setPatients(data);
      
      const photoMap: Record<number, string> = {};
      await Promise.allSettled(
        data.map(async p => {
          try {
            const r = await getMedicalRecordsByPatient(p.patient_id);
            if (r.records?.length > 0) {
              photoMap[p.patient_id] = toUrl(r.records[0].stego_photo_path);
            }
          } catch { }
        })
      );
      setPatientPhotos(photoMap);
    } catch {
      showNotification('Failed to load patient data', 'error');
    }
  }, [showNotification]);

  const loadMedicalRecords = useCallback(async (patientId: number) => {
    try {
      const r = await getMedicalRecordsByPatient(patientId);
      const records = r.records ?? [];
      setMedicalRecords(records);
      setActiveRecordIndex(0);
      setExtracted(null);
      setPipelineStatus('idle');
      setSteps(STEPS.map(s => ({ ...s, status: 'pending' })));
      setAnnotation('');
      setAnnotExtract('');
      setTab('stego');
      
      const contents: Record<number, string> = {};
      const loading: Record<number, boolean> = {};
      
      for (const rec of records) {
        loading[rec.record_id] = true;
        if (rec.medical_data_path) {
          contents[rec.record_id] = await fetchTextContent(rec.medical_data_path);
        } else {
          contents[rec.record_id] = '';
        }
        loading[rec.record_id] = false;
      }
      
      setOriginalContents(contents);
      setLoadingContent(loading);
    } catch {
      setMedicalRecords([]);
      setOriginalContents({});
    }
  }, []);

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!notification.show) return;
    const t = setTimeout(() => setNotification(p => ({ ...p, show: false })), 3500);
    return () => clearTimeout(t);
  }, [notification.show]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightbox(null);
        setSidebarOpen(false);
        setPipelineOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    if (selected) {
      loadMedicalRecords(selected.patient_id);
      setPatientSwipeIndex(patients.findIndex(p => p.patient_id === selected.patient_id));
    } else {
      setMedicalRecords([]);
      setOriginalContents({});
    }
  }, [selected, loadMedicalRecords, patients]);

  // --------------------------------------------------------------------------
  // Render Components
  // --------------------------------------------------------------------------
  const renderSkeleton = () => (
    <div className="dmc-skeleton-card">
      <div className="dmc-skeleton-line dmc-skeleton-line-long" />
      <div className="dmc-skeleton-line" />
      <div className="dmc-skeleton-line" />
      <div className="dmc-skeleton-line dmc-skeleton-line-short" />
    </div>
  );

  const renderMobilePatientCard = () => (
    <div className="dmc-mobile-patient-card">
      <div className="dmc-mobile-patient-peek">
        <button 
          className="dmc-mobile-patient-arrow" 
          onClick={() => {
            if (patientSwipeIndex > 0) {
              const prev = filteredPatients[patientSwipeIndex - 1];
              setSelected(prev);
            }
          }} 
          disabled={patientSwipeIndex === 0}
        >
          ‹
        </button>
        
        <div className="dmc-mobile-patient-card-inner" onClick={() => setSidebarOpen(true)}>
          <div className={`dmc-av dmc-av-lg dmc-av-${selected!.gender}`}>
            {getPhoto(selected!.patient_id) ? (
              <img src={getPhoto(selected!.patient_id)!} alt="" />
            ) : (
              selected!.full_name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="dmc-mobile-patient-info">
            <span className="dmc-mobile-patient-name">{selected!.full_name}</span>
            <span className="dmc-mobile-patient-meta">
              {selected!.medical_record_no} · {selected!.gender === 'M' ? '♂' : '♀'} · {calcAge(selected!.date_of_birth)}
            </span>
            <div className="dmc-mobile-patient-records">
              {medicalRecords.length} record{medicalRecords.length !== 1 ? 's' : ''}
            </div>
          </div>
          <span className="dmc-mobile-patient-chevron">›</span>
        </div>
        
        <button 
          className="dmc-mobile-patient-arrow" 
          onClick={() => {
            if (patientSwipeIndex < filteredPatients.length - 1) {
              const next = filteredPatients[patientSwipeIndex + 1];
              setSelected(next);
            }
          }} 
          disabled={patientSwipeIndex >= filteredPatients.length - 1}
        >
          ›
        </button>
      </div>
      <div className="dmc-mobile-patient-nav-label">
        {patientSwipeIndex + 1} of {filteredPatients.length} patients
      </div>
    </div>
  );

  const renderMobileRecordNav = () => (
    <div className="dmc-mobile-record-nav">
      <button 
        className="dmc-mobile-record-nav-btn" 
        onClick={() => setActiveRecordIndex(i => Math.max(0, i - 1))} 
        disabled={activeRecordIndex === 0}
      >
        ‹
      </button>
      <span className="dmc-mobile-record-nav-label">
        Record {activeRecordIndex + 1} of {medicalRecords.length}
      </span>
      <button 
        className="dmc-mobile-record-nav-btn" 
        onClick={() => setActiveRecordIndex(i => Math.min(medicalRecords.length - 1, i + 1))} 
        disabled={activeRecordIndex === medicalRecords.length - 1}
      >
        ›
      </button>
    </div>
  );

  // --------------------------------------------------------------------------
  // Main Render
  // --------------------------------------------------------------------------
  return (
    <div className="dmc-root">
      <Navbar userFullName={user.full_name} userRole={user.role} />
      
      {/* Lightbox */}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      
      {/* Notification */}
      {notification.show && (
        <div className={`dmc-notification dmc-notification-${notification.type}`}>
          <span className="dmc-notification-icon">
            {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="dmc-notification-message">{notification.message}</span>
        </div>
      )}
      
      {/* Overlays */}
      <div className={`dmc-sb-overlay ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className={`dmc-pipeline-sheet-overlay ${pipelineOpen ? 'visible' : ''}`} onClick={() => setPipelineOpen(false)} />
      
      {/* Pipeline Sheet */}
      <div className={`dmc-pipeline-sheet ${pipelineOpen ? 'open' : ''}`}>
        <div className="dmc-pipeline-sheet-handle" />
        <button className="dmc-pipeline-sheet-close" onClick={() => setPipelineOpen(false)}>✕</button>
        <div className="dmc-pipeline-sheet-inner">
          <PipelineContent 
            steps={steps} 
            pipelineStatus={pipelineStatus} 
            record={activeRecord} 
            extracted={extracted} 
            plInfo={plInfo} 
          />
        </div>
      </div>

      {/* Main Layout */}
      <div className="dmc-layout">
        {/* Sidebar */}
        <aside className={`dmc-sb ${sidebarOpen ? 'dmc-sb-open' : ''}`}>
          <div className="dmc-sb-hd">
            <div className="dmc-sb-hd-top">
              <span className="dmc-sb-hd-title">Patient List</span>
              <span className="dmc-sb-hd-count">{patients.length}</span>
            </div>
            <div className="dmc-sb-search">
              <span>⌕</span>
              <input 
                placeholder="Name or Medical Record No." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
              />
              {search && <button onClick={() => setSearch('')}>✕</button>}
            </div>
          </div>
          
          <div className="dmc-sb-list">
            {filteredPatients.length === 0 ? (
              <div className="dmc-sb-empty">
                <span>🔍</span>
                <p>No patients found</p>
              </div>
            ) : (
              filteredPatients.map(p => {
                const photo = getPhoto(p.patient_id);
                const active = selected?.patient_id === p.patient_id;
                return (
                  <button 
                    key={p.patient_id} 
                    className={`dmc-sb-item ${active ? 'active' : ''}`} 
                    onClick={() => handleSelectPatient(p)}
                  >
                    <div className={`dmc-av dmc-av-${p.gender}`}>
                      {photo ? <img src={photo} alt="" /> : p.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="dmc-sb-item-info">
                      <span className="dmc-sb-item-name">{p.full_name}</span>
                      <span className="dmc-sb-item-sub">
                        {p.medical_record_no} · {calcAge(p.date_of_birth)}
                      </span>
                    </div>
                    <span className={`dmc-dot dmc-dot-${p.gender}`} />
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Main Content */}
        <div className="dmc-main">
          {/* Mobile Navigation */}
          <div className="dmc-mob-nav">
            <button className="dmc-mob-nav-btn" onClick={() => setSidebarOpen(true)}>
              👥 Patients <span className="dmc-mob-nav-count">{patients.length}</span>
            </button>
            
            {selected && (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'center', padding: '0 8px' }}>
                {selected.full_name}
              </span>
            )}
            
            <button className="dmc-mob-nav-btn dmc-mob-nav-btn-pipeline" onClick={() => setPipelineOpen(true)}>
              ⚙️ Pipeline {pipelineStatus === 'done' && <span className="dmc-mob-nav-done">✓</span>}
            </button>
          </div>

          {/* Welcome Screen - No Patient Selected */}
          {!selected ? (
            <div className="dmc-welcome">
              <div className="dmc-welcome-inner">
                <div className="dmc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Doctor'}</h2>
                <p>Select a patient from the list to view their medical record and perform steganographic data extraction.</p>
                <div className="dmc-stats">
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.length}</span>
                    <span className="dmc-stat-l">Total Patients</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.filter(p => p.gender === 'M').length}</span>
                    <span className="dmc-stat-l">Male</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.filter(p => p.gender === 'F').length}</span>
                    <span className="dmc-stat-l">Female</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Mobile Patient Card */}
              {renderMobilePatientCard()}
              
              {/* Mobile Record Navigation */}
              {medicalRecords.length > 1 && renderMobileRecordNav()}
              
              {/* Patient Detail */}
              <div className="dmc-detail">
                <div className="dmc-pbar">
                  <div 
                    className={`dmc-av dmc-av-lg dmc-av-${selected.gender} dmc-av-clickable`} 
                    onClick={() => { const ph = getPhoto(selected.patient_id); if (ph) setLightbox(ph); }} 
                    title="Click to zoom"
                  >
                    {getPhoto(selected.patient_id) ? (
                      <img src={getPhoto(selected.patient_id)!} alt="" />
                    ) : (
                      selected.full_name.charAt(0).toUpperCase()
                    )}
                    <span className="dmc-av-zoom">🔍</span>
                  </div>
                  
                  <div className="dmc-pbar-info">
                    <span className="dmc-pbar-name">{selected.full_name}</span>
                    <div className="dmc-pbar-meta">
                      <span className="dmc-pbar-rm">{selected.medical_record_no}</span>
                      <span className="dmc-sep">·</span>
                      <span>{selected.gender === 'M' ? '♂ Male' : '♀ Female'}</span>
                      <span className="dmc-sep">·</span>
                      <span>{calcAge(selected.date_of_birth)}</span>
                      <span className="dmc-sep">·</span>
                      <span>DOB: {formatDate(selected.date_of_birth)}</span>
                      {medicalRecords.length > 0 && (
                        <>
                          <span className="dmc-sep">·</span>
                          <span className="dmc-records-count">
                            {medicalRecords.length} record{medicalRecords.length > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {showExtractButton && (
                    <button 
                      className={`dmc-btn-ext ${extractLoading ? 'loading' : ''}`} 
                      onClick={handleExtract} 
                      disabled={extractLoading}
                    >
                      {extractLoading ? (
                        <><span className="dmc-spin" />Extracting…</>
                      ) : (
                        <>🔓 Extract Data</>
                      )}
                    </button>
                  )}
                </div>

                <div className="dmc-workspace">
                  <div className="dmc-content-panel">
                    {/* No Records State */}
                    {medicalRecords.length === 0 ? (
                      <div className="dmc-empty">
                        <span>📁</span>
                        <p>No medical records found for this patient.</p>
                      </div>
                    ) : (
                      <>
                        {/* Records Tabs */}
                        <div className="dmc-records-tabs">
                          <div className="dmc-records-tab-list">
                            {medicalRecords.map((rec, idx) => (
                              <button 
                                key={rec.record_id} 
                                className={`dmc-records-tab ${idx === activeRecordIndex ? 'active' : ''}`} 
                                onClick={() => handleRecordClick(idx)}
                              >
                                <span className="dmc-records-tab-num">#{rec.record_id}</span>
                                <span className="dmc-records-tab-date">{formatDate(rec.upload_date ?? '')}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Main Tabs (Stego / Extract) */}
                        <div className="dmc-tabs">
                          <button 
                            className={`dmc-tab ${tab === 'stego' ? 'act' : ''}`} 
                            onClick={() => setTab('stego')}
                          >
                            🔒 Stego Preview
                          </button>
                          <button 
                            className={`dmc-tab ${tab === 'extract' ? 'act' : ''}`} 
                            onClick={() => setTab('extract')} 
                            disabled={!extracted && pipelineStatus !== 'running'}
                          >
                            🔓 Extraction Result
                            {extracted && <span className="dmc-tab-pip" />}
                          </button>
                          <span className="dmc-tabs-fill" />
                          <span className="dmc-rec-badge">
                            Record #{activeRecord?.record_id} · {formatDate(activeRecord?.upload_date ?? '')}
                          </span>
                        </div>

                        {/* Tab Content with Swipe */}
                        <div 
                          className="dmc-tab-body dmc-tab-body-swipe"
                          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
                          onTouchEnd={e => { 
                            touchEndX.current = e.changedTouches[0].clientX; 
                            const diff = touchStartX.current - touchEndX.current; 
                            if (Math.abs(diff) > 50) handleSwipeTab(diff > 0 ? 'left' : 'right'); 
                          }}
                        >
                          <div 
                            className="dmc-tab-swipe-track" 
                            style={{ transform: `translateX(-${tab === 'stego' ? 0 : 100}%)` }}
                          >
                            {/* Stego Tab */}
                            <div className="dmc-tab-swipe-slide">
                              {activeLoadingContent ? (
                                renderSkeleton()
                              ) : (
                                <div className="dmc-card dmc-med-card dmc-med-card-sharp">
                                  <div className="dmc-card-hd">
                                    <span className="dmc-card-title">Medical Data Preview</span>
                                    <button className="dmc-btn-download" onClick={handleDownloadStego}>
                                      ⬇ Download
                                    </button>
                                  </div>
                                  <AnnotPanel 
                                    originalData={activeOriginalContent} 
                                    annotation={annotation} 
                                    onAnnotChange={handleAnnotationChange} 
                                    isLoading={activeLoadingContent} 
                                  />
                                  {savedAnnotation && (
                                    <div className="dmc-auto-save-indicator">✓ Auto-saved</div>
                                  )}
                                  <div className="dmc-card-ft">
                                    <span>🔐</span>
                                    <span>Press <strong>Extract Data</strong> to decrypt.</span>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            {/* Extract Tab */}
                            <div className="dmc-tab-swipe-slide">
                              {pipelineStatus === 'running' && !extracted ? (
                                <div className="dmc-proc">
                                  <div className="dmc-proc-dots"><span /><span /><span /></div>
                                  <p>Extracting and decrypting medical data…</p>
                                </div>
                              ) : extracted ? (
                                <div className="dmc-card dmc-extract-card dmc-extract-card-sharp">
                                  <div className="dmc-card-hd">
                                    <span className="dmc-card-title">Diagnosis &amp; Medical Image</span>
                                    <button className="dmc-btn-download" onClick={handleDownloadExtract}>
                                      ⬇ Download
                                    </button>
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
                                </div>
                              ) : (
                                <div className="dmc-empty">
                                  <span>🔐</span>
                                  <p>Press <strong>Extract Data</strong> to begin.</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Mobile Swipe Indicator */}
                        <div className="dmc-mobile-swipe-indicator">
                          <span 
                            className={`dmc-swipe-dot ${tab === 'stego' ? 'active' : ''}`} 
                            onClick={() => setTab('stego')} 
                          />
                          <span 
                            className={`dmc-swipe-dot ${tab === 'extract' ? 'active' : ''}`} 
                            onClick={() => setTab('extract')} 
                          />
                        </div>
                      </>
                    )}
                  </div>
                  
                  {/* Pipeline Panel */}
                  <div className="dmc-pipeline">
                    <PipelineContent 
                      steps={steps} 
                      pipelineStatus={pipelineStatus} 
                      record={activeRecord} 
                      extracted={extracted} 
                      plInfo={plInfo} 
                    />
                  </div>
                </div>
              </div>
              
              {/* Mobile Extract FAB */}
              {showExtractButton && (
                <div className="dmc-mobile-extract-fab">
                  <button 
                    className={`dmc-btn-ext ${extractLoading ? 'loading' : ''}`} 
                    onClick={handleExtract} 
                    disabled={extractLoading}
                  >
                    {extractLoading ? (
                      <><span className="dmc-spin" />Extracting…</>
                    ) : (
                      <>🔓 Extract Data</>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardDoctor;