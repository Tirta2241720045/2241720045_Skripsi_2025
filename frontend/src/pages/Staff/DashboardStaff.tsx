import React, { useState, useEffect, useCallback} from 'react';
import Navbar from '../../components/shared/Navbar';
import ToolsPanel from '../../components/shared/ToolsPanel';
import { getAllPatients, createPatient, updatePatient, deletePatient, PatientResponse, Gender } from '../../api/patients';
import { getMedicalRecordsByPatient, uploadMedicalData, deleteMedicalRecord, MedicalRecordItem, LayerMetrics, AccTxtResult, StegoMethod } from '../../api/medical';
import '../../styles/DashboardMedical.css';
import { downloadStaffReport } from '../../components/shared/pdfReport';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface ProcessStep {
  id: string;
  label: string;
  sublabel: string;
  icon: string;
  status: 'pending' | 'active' | 'done';
}

interface FileValidation {
  isValid: boolean;
  errors: string[];
  format: string;
  dimensions?: { width: number; height: number };
  size: number;
  isGrayscale?: boolean;
  lineCount?: number;
  charCount?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const DEFAULT_PROCESS_STEPS: ProcessStep[] = [
  { id: 'encrypt', label: 'Encrypt Data', sublabel: 'AES-128 CBC', icon: '🔐', status: 'pending' },
  { id: 'embed1', label: 'Embed to MRI', sublabel: 'LSB Grayscale Layer 1', icon: '🩻', status: 'pending' },
  { id: 'embed2', label: 'Embed to Photo', sublabel: 'LSB RGB Layer 2', icon: '📷', status: 'pending' },
  { id: 'save', label: 'Save Stego Image', sublabel: 'Finalize output', icon: '💾', status: 'pending' },
];

const noImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="250" height="250"%3E%3Crect fill="%23eef0f4" width="250" height="250"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23b0b8c8" font-size="12"%3ENo Image%3C/text%3E%3C/svg%3E';

// Helper: ambil metode yang dipilih dari localStorage
const getSelectedMethod = (): StegoMethod => {
  try {
    const stored = localStorage.getItem('selectedStegoMethod') as StegoMethod;
    if (stored && ['stegoshield', 'dwt_pso', 'ebs3', 'ebs5', 'ebs9'].includes(stored)) {
      return stored;
    }
  } catch {
    // localStorage error
  }
  return 'stegoshield';
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const toUrl = (path: string): string => {
  if (!path) return '';
  return `${BASE_URL}/${path.replace(/\\/g, '/')}`;
};

const fetchTextContent = async (path: string): Promise<string> => {
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
    year: 'numeric' 
  });
};

const calcAge = (dob: string): string => {
  if (!dob) return '—';
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
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

const FileSizeSlideContent = ({ stegoKb }: { stegoKb?: number }) => (
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

const MetricsSlider = ({ 
  metrics, 
  stegoKb, 
  acctxt 
}: { 
  metrics: LayerMetrics; 
  stegoKb?: number; 
  acctxt?: AccTxtResult | null 
}) => {
  const [slide, setSlide] = useState(0);
  
  const slides = [
    {
      label: 'FR-IQA',
      sublabel: 'Full-Reference Quality',
      render: () => (
        <>
          {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map((key) => {
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
          {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map((key) => {
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
      sublabel: 'Stego Image Size',
      render: () => <FileSizeSlideContent stegoKb={stegoKb} />
    },
  ];

  return (
    <div className="dmc-quality-card">
      <div className="dmc-metrics-hd">
        <span>Quality Metrics</span>
        <div className="dmc-metrics-slider-nav">
          <button 
            className="dmc-metrics-nav-btn" 
            onClick={() => setSlide((s) => Math.max(0, s - 1))} 
            disabled={slide === 0}
          >
            ‹
          </button>
          <span className="dmc-metrics-slide-label">{slides[slide].label}</span>
          <button 
            className="dmc-metrics-nav-btn" 
            onClick={() => setSlide((s) => Math.min(slides.length - 1, s + 1))} 
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
    <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
    <button className="dmc-lightbox-close" onClick={onClose}>✕</button>
  </div>
);

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

const validateImageFile = async (file: File, expectedType: 'color' | 'grayscale'): Promise<FileValidation> => {
  const errors: string[] = [];
  
  if (!file.type.match(/image\/(png|jpeg|jpg)/)) {
    errors.push('Format must be PNG or JPEG/JPG');
  }
  
  if (file.size > 10 * 1024 * 1024) {
    errors.push(`Too large (max 10MB) — ${(file.size / 1024 / 1024).toFixed(2)}MB`);
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  let isGrayscale = false;
  let isColorDetected = false;

  if (ctx) {
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    const data = imageData.data;
    let colorCount = 0;
    const totalPixels = Math.min(data.length / 4, 10000);
    
    for (let i = 0; i < totalPixels * 4; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5 || Math.abs(r - b) > 5) {
        colorCount++;
        if (colorCount > totalPixels * 0.1) {
          isColorDetected = true;
          break;
        }
      }
    }
    
    isGrayscale = !isColorDetected;
    
    if (expectedType === 'color' && isGrayscale) {
      errors.push('Patient Photo must be color image');
    }
    if (expectedType === 'grayscale' && !isGrayscale) {
      errors.push('MRI Image must be grayscale');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    format: file.type,
    dimensions: { width: img.width, height: img.height },
    size: file.size,
    isGrayscale,
  };
};

const validateTextFile = async (file: File): Promise<FileValidation> => {
  const errors: string[] = [];
  
  if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
    errors.push('Format must be TXT');
  }
  if (file.size > 5 * 1024 * 1024) {
    errors.push('Too large (max 5MB)');
  }
  
  const content = await file.text();
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  
  if (lines.length === 0) errors.push('File cannot be empty');
  if (content.length < 10) errors.push('Minimum 10 characters');
  if (content.length > 50000) errors.push('Too long (max 50000 characters)');
  
  return { 
    isValid: errors.length === 0, 
    errors, 
    format: 'text/plain', 
    size: file.size, 
    lineCount: lines.length, 
    charCount: content.length 
  };
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const DashboardStaff = () => {
  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  
  // Patient related states
  const [patients, setPatients] = useState<PatientResponse[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResponse | null>(null);
  const [patientPhotos, setPatientPhotos] = useState<Record<number, string>>({});
  
  // Medical record states
  const [medicalRecords, setMedicalRecords] = useState<MedicalRecordItem[]>([]);
  const [activeRecordIndex, setActiveRecordIndex] = useState(0);
  const [diagnosisContents, setDiagnosisContents] = useState<Record<number, string>>({});
  const [staffAnnotations, setStaffAnnotations] = useState<Record<number, string>>({});
  
  // UI states
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteRecordConfirm, setShowDeleteRecordConfirm] = useState<number | null>(null);
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: string }>({ 
    show: false, message: '', type: 'success' 
  });
  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [patientSwipeIndex, setPatientSwipeIndex] = useState(0);
  
  // Registration states
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [newPatientId, setNewPatientId] = useState<number | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerForm, setRegisterForm] = useState({ 
    full_name: '', 
    date_of_birth: '', 
    gender: 'M' as Gender 
  });
  const [editForm, setEditForm] = useState({ 
    medical_record_no: '', 
    full_name: '', 
    date_of_birth: '', 
    gender: 'M' as Gender 
  });
  
  // File upload states
  const [patientPhotoFile, setPatientPhotoFile] = useState<File | null>(null);
  const [mriImageFile, setMriImageFile] = useState<File | null>(null);
  const [diagnosisFile, setDiagnosisFile] = useState<File | null>(null);
  const [patientPhotoPreview, setPatientPhotoPreview] = useState<string | null>(null);
  const [mriImagePreview, setMriImagePreview] = useState<string | null>(null);
  const [diagnosisPreview, setDiagnosisPreview] = useState<string | null>(null);
  const [patientPhotoValidation, setPatientPhotoValidation] = useState<FileValidation | null>(null);
  const [mriImageValidation, setMriImageValidation] = useState<FileValidation | null>(null);
  const [diagnosisValidation, setDiagnosisValidation] = useState<FileValidation | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // Processing states
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>(DEFAULT_PROCESS_STEPS.map((s) => ({ ...s })));
  const [isProcessing, setIsProcessing] = useState(false);
  const [processComplete, setProcessComplete] = useState(false);

  // Derived states
  const activeRecord = medicalRecords[activeRecordIndex] ?? null;
  const activeAccTxt: AccTxtResult | null = activeRecord?.quality_metrics?.extraction?.acc_txt ?? null;
  const latestMetrics = activeRecord?.quality_metrics?.embedding ?? null;
  const filteredPatients = patients.filter((p) => 
    p.full_name.toLowerCase().includes(search.toLowerCase()) || 
    p.medical_record_no.toLowerCase().includes(search.toLowerCase())
  );
  const hasPatients = patients.length > 0;
  const canUpload = !!patientPhotoFile && !!mriImageFile && !!diagnosisFile && 
                    !!patientPhotoValidation?.isValid && 
                    !!mriImageValidation?.isValid && 
                    !!diagnosisValidation?.isValid;

  // --------------------------------------------------------------------------
  // Helper Functions
  // --------------------------------------------------------------------------
  const showNotification = useCallback((message: string, type: string) => {
    setNotification({ show: true, message, type });
  }, []);

  const generateMedicalRecordNo = useCallback((): string => {
    const nums = patients
      .map((p) => p.medical_record_no)
      .filter((m) => m.startsWith('MR-'))
      .map((m) => parseInt(m.replace('MR-', ''), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a);
    const nextNum = ((nums[0] || 0) + 1).toString().padStart(5, '0');
    return `MR-${nextNum}`;
  }, [patients]);

  const getPatientPhoto = (patientId: number): string | null => {
    if (patientPhotos[patientId]) return patientPhotos[patientId];
    if (selectedPatient?.patient_id === patientId && medicalRecords.length > 0) {
      return toUrl(medicalRecords[0].stego_photo_path);
    }
    return null;
  };

  const isFullNameDuplicate = (fullName: string, excludePatientId?: number): boolean => {
    return patients.some((p) => 
      p.full_name.toLowerCase() === fullName.toLowerCase() && 
      p.patient_id !== excludePatientId
    );
  };

  const resetUploadForm = () => {
    setPatientPhotoFile(null);
    setMriImageFile(null);
    setDiagnosisFile(null);
    setPatientPhotoPreview(null);
    setMriImagePreview(null);
    setDiagnosisPreview(null);
    setPatientPhotoValidation(null);
    setMriImageValidation(null);
    setDiagnosisValidation(null);
    setProcessSteps(DEFAULT_PROCESS_STEPS.map((s) => ({ ...s })));
    setIsProcessing(false);
    setProcessComplete(false);
  };

  const runProcessSteps = async () => {
    setProcessSteps(DEFAULT_PROCESS_STEPS.map((s) => ({ ...s, status: 'pending' })));
    setIsProcessing(true);
    setProcessComplete(false);
    
    const delays = [800, 900, 900, 600];
    
    for (let i = 0; i < DEFAULT_PROCESS_STEPS.length; i++) {
      setProcessSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: 'active' } : s)));
      await new Promise((r) => setTimeout(r, delays[i]));
      setProcessSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: 'done' } : s)));
    }
    
    setProcessComplete(true);
    setIsProcessing(false);
  };

  // --------------------------------------------------------------------------
  // File Handlers
  // --------------------------------------------------------------------------
  const processPatientPhoto = async (file: File) => {
    setPatientPhotoFile(file);
    setPatientPhotoPreview(URL.createObjectURL(file));
    const v = await validateImageFile(file, 'color');
    setPatientPhotoValidation(v);
    if (!v.isValid) showNotification(`Photo: ${v.errors[0]}`, 'error');
  };

  const processMriImage = async (file: File) => {
    setMriImageFile(file);
    setMriImagePreview(URL.createObjectURL(file));
    const v = await validateImageFile(file, 'grayscale');
    setMriImageValidation(v);
    if (!v.isValid) showNotification(`MRI: ${v.errors[0]}`, 'error');
  };

  const processDiagnosisFile = async (file: File) => {
    setDiagnosisFile(file);
    const content = await file.text();
    setDiagnosisPreview(content);
    const v = await validateTextFile(file);
    setDiagnosisValidation(v);
    if (!v.isValid) showNotification(`Diagnosis: ${v.errors[0]}`, 'error');
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
        data.map(async (p) => {
          try {
            const result = await getMedicalRecordsByPatient(p.patient_id);
            if (result.records?.length > 0) {
              photoMap[p.patient_id] = toUrl(result.records[0].stego_photo_path);
            }
          } catch {}
        })
      );
      setPatientPhotos(photoMap);
    } catch {
      showNotification('Failed to load patient data', 'error');
    }
  }, [showNotification]);

  const loadMedicalRecords = useCallback(async (patientId: number) => {
    try {
      const result = await getMedicalRecordsByPatient(patientId);
      const records = result.records ?? [];
      setMedicalRecords(records);
      setActiveRecordIndex(0);
      
      const contents: Record<number, string> = {};
      await Promise.allSettled(
        records.map(async (rec) => {
          if (rec.medical_data_path) {
            contents[rec.record_id] = await fetchTextContent(rec.medical_data_path);
          } else {
            contents[rec.record_id] = '';
          }
        })
      );
      setDiagnosisContents(contents);
      setStaffAnnotations({});
    } catch {
      setMedicalRecords([]);
      setDiagnosisContents({});
    }
  }, []);

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!registerForm.full_name || !registerForm.date_of_birth) {
      showNotification('Please complete all required fields', 'warning');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (registerForm.date_of_birth > today) {
      showNotification('Date of birth cannot be in the future', 'error');
      return;
    }
    
    if (isFullNameDuplicate(registerForm.full_name)) {
      showNotification('Patient with this name already exists', 'error');
      return;
    }
    
    const mrNo = generateMedicalRecordNo();
    setIsRegistering(true);
    
    try {
      const newPatient = await createPatient({
        medical_record_no: mrNo,
        full_name: registerForm.full_name,
        date_of_birth: registerForm.date_of_birth,
        gender: registerForm.gender
      });
      
      showNotification(`Patient registered — ${mrNo}`, 'success');
      
      setTimeout(() => {
        setRegisterSuccess(true);
        setNewPatientId(newPatient.patient_id);
        loadPatients();
        setIsRegistering(false);
      }, 500);
    } catch (err: any) {
      showNotification(err?.response?.data?.detail || 'Failed to register patient', 'error');
      setIsRegistering(false);
    }
  };

  const handleUploadMedical = async (targetPatientId: number) => {
    if (!patientPhotoFile || !mriImageFile || !diagnosisFile) {
      showNotification('All files are required', 'warning');
      return;
    }
    
    if (!patientPhotoValidation?.isValid || !mriImageValidation?.isValid || !diagnosisValidation?.isValid) {
      showNotification('Validation failed', 'error');
      return;
    }
    
    setIsUploading(true);
    
    try {
      const fd = new FormData();
      fd.append('patient_id', targetPatientId.toString());
      // 🔥 AMBIL METODE DARI LOCALSTORAGE (ToolsPanel)
      fd.append('method', getSelectedMethod());
      fd.append('medical_data', diagnosisFile, diagnosisFile.name);
      fd.append('mri_image', mriImageFile);
      fd.append('patient_photo', patientPhotoFile);
      
      const [result] = await Promise.all([uploadMedicalData(fd), runProcessSteps()]);
      showNotification(`Record #${result.record_id} saved successfully with method ${result.method.toUpperCase()}`, 'success');
      
      await loadMedicalRecords(targetPatientId);
      const updated = await getMedicalRecordsByPatient(targetPatientId);
      
      if (updated.records?.length > 0) {
        setPatientPhotos((prev) => ({ 
          ...prev, 
          [targetPatientId]: toUrl(updated.records[0].stego_photo_path) 
        }));
      }
      
      if (isRegisterMode && newPatientId) {
        const newPat = patients.find((p) => p.patient_id === newPatientId);
        if (newPat) setSelectedPatient(newPat);
        setIsRegisterMode(false);
        setRegisterSuccess(false);
        setNewPatientId(null);
      }
      
      setShowUploadPanel(false);
      resetUploadForm();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || '';
      showNotification(detail || 'Upload failed — please try again', 'error');
      setIsProcessing(false);
      setProcessSteps(DEFAULT_PROCESS_STEPS.map((s) => ({ ...s })));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteRecord = async (recordId: number) => {
    try {
      await deleteMedicalRecord(recordId);
      showNotification(`Record #${recordId} deleted`, 'success');
      setShowDeleteRecordConfirm(null);
      
      if (selectedPatient) {
        await loadMedicalRecords(selectedPatient.patient_id);
        const updated = await getMedicalRecordsByPatient(selectedPatient.patient_id);
        
        if (updated.records?.length > 0) {
          setPatientPhotos((prev) => ({ 
            ...prev, 
            [selectedPatient.patient_id]: toUrl(updated.records[0].stego_photo_path) 
          }));
        } else {
          setPatientPhotos((prev) => {
            const n = { ...prev };
            delete n[selectedPatient.patient_id];
            return n;
          });
        }
      }
    } catch (err: any) {
      showNotification(err?.response?.data?.detail || 'Failed to delete record', 'error');
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedPatient) return;
    
    if (!editForm.full_name || !editForm.date_of_birth) {
      showNotification('Please complete all fields', 'warning');
      return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    if (editForm.date_of_birth > today) {
      showNotification('Date of birth cannot be in the future', 'error');
      return;
    }
    
    if (isFullNameDuplicate(editForm.full_name, selectedPatient.patient_id)) {
      showNotification('Patient with this name already exists', 'error');
      return;
    }
    
    try {
      await updatePatient(selectedPatient.patient_id, {
        full_name: editForm.full_name,
        date_of_birth: editForm.date_of_birth,
        gender: editForm.gender
      });
      
      showNotification('Patient data updated successfully', 'success');
      setShowEditForm(false);
      await loadPatients();
      setSelectedPatient((prev) => (prev ? { 
        ...prev, 
        full_name: editForm.full_name, 
        date_of_birth: editForm.date_of_birth, 
        gender: editForm.gender 
      } : null));
    } catch (err: any) {
      showNotification(err?.response?.data?.detail || 'Failed to update patient data', 'error');
    }
  };

  const handleDeletePatient = async () => {
    if (!selectedPatient) return;
    
    try {
      await deletePatient(selectedPatient.patient_id);
      showNotification('Patient deleted successfully', 'success');
      setShowDeleteConfirm(false);
      setSelectedPatient(null);
      await loadPatients();
    } catch (err: any) {
      showNotification(err?.response?.data?.detail || 'Failed to delete patient', 'error');
    }
  };

  const handleDownloadReport = async () => {
    if (!selectedPatient || !activeRecord) return;
    
    downloadStaffReport({
      diagnosis: diagnosisContents[activeRecord.record_id] || '',
      annotation: staffAnnotations[activeRecord.record_id] || '',
      patientName: selectedPatient.full_name,
      patientMrn: selectedPatient.medical_record_no,
      recordId: activeRecord.record_id,
      staffName: user.full_name || 'Staff',
      stegoPhotoUrl: toUrl(activeRecord.stego_photo_path),
      onSuccess: () => showNotification('Report downloaded as PDF', 'success'),
      onError: () => showNotification('Failed to generate PDF', 'error')
    });
  };

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------
  const handlePatientClick = (patient: PatientResponse) => {
    if (selectedPatient?.patient_id === patient.patient_id) {
      setSelectedPatient(null);
      setIsRegisterMode(false);
    } else {
      setSelectedPatient(patient);
      setIsRegisterMode(false);
      setShowUploadPanel(false);
    }
    setSidebarOpen(false);
    setRegisterSuccess(false);
    setPatientSwipeIndex(patients.findIndex((p) => p.patient_id === patient.patient_id));
  };

  const handleRegisterClick = () => {
    setSelectedPatient(null);
    setIsRegisterMode(true);
    setShowEditForm(false);
    setRegisterSuccess(false);
    setNewPatientId(null);
    setRegisterForm({ full_name: '', date_of_birth: '', gender: 'M' });
    resetUploadForm();
    setSidebarOpen(false);
  };

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!notification.show) return;
    const t = setTimeout(() => setNotification((p) => ({ ...p, show: false })), 3500);
    return () => clearTimeout(t);
  }, [notification.show]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxSrc(null);
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
    if (selectedPatient) {
      loadMedicalRecords(selectedPatient.patient_id);
      setEditForm({
        medical_record_no: selectedPatient.medical_record_no,
        full_name: selectedPatient.full_name,
        date_of_birth: selectedPatient.date_of_birth,
        gender: selectedPatient.gender
      });
    } else {
      setMedicalRecords([]);
      setDiagnosisContents({});
    }
    setIsProcessing(false);
    setProcessComplete(false);
    setShowEditForm(false);
    setShowUploadPanel(false);
    setProcessSteps(DEFAULT_PROCESS_STEPS.map((s) => ({ ...s })));
  }, [selectedPatient, loadMedicalRecords]);

  // --------------------------------------------------------------------------
  // Render Components
  // --------------------------------------------------------------------------
  const renderUploadGrid = (photoInputId: string, mriInputId: string, diagInputId: string) => (
    <div className="dmc-upload-grid-3col">
      {/* Patient Photo Upload */}
      <div className="dmc-upload-card">
        <div className="dmc-upload-card-header">
          <span className="dmc-upload-card-icon">📷</span>
          <div className="dmc-upload-card-title-group">
            <span className="dmc-upload-card-title">Patient Photo</span>
            <span className="dmc-upload-card-badge color">COLOR</span>
          </div>
        </div>
        <div className="dmc-upload-card-body">
          <div 
            className={`dmc-upload-square ${patientPhotoPreview ? 'has-file' : ''} ${patientPhotoValidation?.isValid === false ? 'error' : ''}`} 
            onClick={() => document.getElementById(photoInputId)?.click()}
          >
            {patientPhotoPreview ? (
              <img src={patientPhotoPreview} alt="Preview" />
            ) : (
              <div className="dmc-upload-placeholder">
                <span className="dmc-placeholder-icon">🖼️</span>
                <span>Click to upload</span>
                <small>PNG, JPG (max 10MB)</small>
              </div>
            )}
          </div>
          <input 
            id={photoInputId} 
            type="file" 
            accept="image/png,image/jpeg,image/jpg" 
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processPatientPhoto(f); }} 
            style={{ display: 'none' }} 
          />
          {patientPhotoValidation && (
            <div className={`dmc-upload-status ${patientPhotoValidation.isValid ? 'success' : 'error'}`}>
              {patientPhotoValidation.isValid ? '✓ Valid' : '✕ Invalid'}
            </div>
          )}
        </div>
      </div>

      {/* MRI Image Upload */}
      <div className="dmc-upload-card">
        <div className="dmc-upload-card-header">
          <span className="dmc-upload-card-icon">🩻</span>
          <div className="dmc-upload-card-title-group">
            <span className="dmc-upload-card-title">MRI Image</span>
            <span className="dmc-upload-card-badge grayscale">B&W</span>
          </div>
        </div>
        <div className="dmc-upload-card-body">
          <div 
            className={`dmc-upload-square ${mriImagePreview ? 'has-file' : ''} ${mriImageValidation?.isValid === false ? 'error' : ''}`} 
            onClick={() => document.getElementById(mriInputId)?.click()}
          >
            {mriImagePreview ? (
              <img src={mriImagePreview} alt="Preview" />
            ) : (
              <div className="dmc-upload-placeholder">
                <span className="dmc-placeholder-icon">🩻</span>
                <span>Click to upload</span>
                <small>PNG, JPG (max 10MB)</small>
              </div>
            )}
          </div>
          <input 
            id={mriInputId} 
            type="file" 
            accept="image/png,image/jpeg,image/jpg" 
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processMriImage(f); }} 
            style={{ display: 'none' }} 
          />
          {mriImageValidation && (
            <div className={`dmc-upload-status ${mriImageValidation.isValid ? 'success' : 'error'}`}>
              {mriImageValidation.isValid ? '✓ Valid' : '✕ Invalid'}
            </div>
          )}
        </div>
      </div>

      {/* Medical Notes Upload */}
      <div className="dmc-upload-card">
        <div className="dmc-upload-card-header">
          <span className="dmc-upload-card-icon">📄</span>
          <div className="dmc-upload-card-title-group">
            <span className="dmc-upload-card-title">Medical Notes</span>
            <span className="dmc-upload-card-badge text">TXT</span>
          </div>
        </div>
        <div className="dmc-upload-card-body">
          <div 
            className={`dmc-upload-square-text ${diagnosisPreview ? 'has-file' : ''} ${diagnosisValidation?.isValid === false ? 'error' : ''}`} 
            onClick={() => document.getElementById(diagInputId)?.click()}
          >
            {diagnosisPreview ? (
              <pre className="dmc-text-preview">{diagnosisPreview.slice(0, 500)}</pre>
            ) : (
              <div className="dmc-upload-placeholder">
                <span className="dmc-placeholder-icon">📝</span>
                <span>Click to upload</span>
                <small>TXT (max 5MB)</small>
              </div>
            )}
          </div>
          <input 
            id={diagInputId} 
            type="file" 
            accept=".txt,text/plain" 
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processDiagnosisFile(f); }} 
            style={{ display: 'none' }} 
          />
          {diagnosisValidation && (
            <div className={`dmc-upload-status ${diagnosisValidation.isValid ? 'success' : 'error'}`}>
              {diagnosisValidation.isValid ? '✓ Valid' : '✕ Invalid'}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderModernAddRecordPanel = () => (
    <div className="dmc-add-record-panel">
      <div className="dmc-add-record-header">
        <div className="dmc-add-record-title">
          <span>Add New Medical Record</span>
          <span style={{ fontSize: 11, fontWeight: 'normal', marginLeft: 8, color: '#667eea' }}>
            (Method: {getSelectedMethod().toUpperCase()})
          </span>
        </div>
      </div>
      <div className="dmc-add-record-body">
        {renderUploadGrid('addPatientPhotoInput', 'addMriImageInput', 'addDiagnosisInput')}
        <div className="dmc-upload-actions">
          <button className="dmc-btn-secondary" onClick={() => { setShowUploadPanel(false); resetUploadForm(); }}>
            Cancel
          </button>
          <button 
            className={`dmc-btn-upload ${!canUpload || isUploading ? 'disabled' : ''}`} 
            onClick={() => selectedPatient && handleUploadMedical(selectedPatient.patient_id)} 
            disabled={!canUpload || isUploading}
          >
            {isUploading ? (
              <><span className="dmc-spin" />Processing...</>
            ) : (
              <>🚀 Upload & Encrypt ({getSelectedMethod().toUpperCase()})</>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const renderPipeline = () => (
    <>
      <div className="dmc-pl-hd">
        <span className="dmc-pl-title">Processing Pipeline</span>
        {processComplete && <span className="dmc-chip dmc-chip-teal">✓ Done</span>}
      </div>
      
      <div className="dmc-pl-steps">
        {processSteps.map((step, i) => (
          <div key={step.id} className={`dmc-pls dmc-pls-${step.status}`}>
            <div className="dmc-pls-track">
              <div className="dmc-pls-node">
                <span>{step.icon}</span>
                {step.status === 'done' && <span className="dmc-pls-ok">✓</span>}
                {step.status === 'active' && <span className="dmc-pls-active-ring" />}
              </div>
              {i < processSteps.length - 1 && <div className={`dmc-pls-line ${step.status === 'done' ? 'done' : ''}`} />}
            </div>
            <div className="dmc-pls-text">
              <span className="dmc-pls-label">{step.label}</span>
              <span className="dmc-pls-sub">{step.sublabel}</span>
            </div>
          </div>
        ))}
      </div>
      
      {latestMetrics && (
        <MetricsSlider metrics={latestMetrics as LayerMetrics} stegoKb={activeRecord?.file_sizes?.stego_kb} acctxt={activeAccTxt} />
      )}
      
      {processComplete && latestMetrics && (
        <div className="dmc-exec-time-card">
          <div className="dmc-exec-time-icon">⏱</div>
          <div className="dmc-exec-time-body">
            <span className="dmc-exec-time-label">Processing Complete</span>
            <span className="dmc-exec-time-val">✓ Ready</span>
          </div>
        </div>
      )}
      
      {isProcessing && (
        <div className="dmc-pl-info dmc-pl-info-running">
          <div className="dmc-pl-info-icon">⚙️</div>
          <div className="dmc-pl-info-body">
            <span className="dmc-pl-info-title">Processing...</span>
            <p>Pipeline is running.</p>
          </div>
        </div>
      )}
      
      {processComplete && latestMetrics && (
        <div className="dmc-pl-info dmc-pl-info-done">
          <div className="dmc-pl-info-icon">✅</div>
          <div className="dmc-pl-info-body">
            <span className="dmc-pl-info-title">Embedding Complete</span>
            <p>All pipeline stages completed.</p>
          </div>
        </div>
      )}
      
      {!isProcessing && !processComplete && !latestMetrics && (
        <div className="dmc-pl-info dmc-pl-info-idle">
          <div className="dmc-pl-info-icon">🔐</div>
          <div className="dmc-pl-info-body">
            <span className="dmc-pl-info-title">Ready to Process</span>
            <p>Upload patient photo, MRI scan, and diagnosis.</p>
          </div>
        </div>
      )}
    </>
  );

  const renderMobilePatientCard = () => (
    <div className="dmc-mobile-patient-card">
      <div className="dmc-mobile-patient-peek">
        <button 
          className="dmc-mobile-patient-arrow" 
          onClick={() => {
            if (patientSwipeIndex > 0) {
              const prev = filteredPatients[patientSwipeIndex - 1];
              setSelectedPatient(prev);
              setPatientSwipeIndex(patientSwipeIndex - 1);
            }
          }} 
          disabled={patientSwipeIndex === 0}
        >
          ‹
        </button>
        
        <div className="dmc-mobile-patient-card-inner" onClick={() => setSidebarOpen(true)}>
          <div className={`dmc-av dmc-av-lg dmc-av-${selectedPatient!.gender}`}>
            {getPatientPhoto(selectedPatient!.patient_id) ? (
              <img src={getPatientPhoto(selectedPatient!.patient_id)!} alt="" />
            ) : (
              selectedPatient!.full_name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="dmc-mobile-patient-info">
            <span className="dmc-mobile-patient-name">{selectedPatient!.full_name}</span>
            <span className="dmc-mobile-patient-meta">
              {selectedPatient!.medical_record_no} · {selectedPatient!.gender === 'M' ? '♂' : '♀'} · {calcAge(selectedPatient!.date_of_birth)}
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
              setSelectedPatient(next);
              setPatientSwipeIndex(patientSwipeIndex + 1);
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
        onClick={() => setActiveRecordIndex((i) => Math.max(0, i - 1))} 
        disabled={activeRecordIndex === 0}
      >
        ‹
      </button>
      <span className="dmc-mobile-record-nav-label">
        Record {activeRecordIndex + 1} of {medicalRecords.length}
      </span>
      <button 
        className="dmc-mobile-record-nav-btn" 
        onClick={() => setActiveRecordIndex((i) => Math.min(medicalRecords.length - 1, i + 1))} 
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
      <ToolsPanel />
      
      {/* Lightbox */}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      
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
        <div className="dmc-pipeline-sheet-inner">{renderPipeline()}</div>
      </div>

      {/* Main Layout */}
      <div className="dmc-layout">
        {/* Sidebar */}
        {hasPatients && (
          <aside className={`dmc-sb ${sidebarOpen ? 'dmc-sb-open' : ''}`}>
            <div className="dmc-sb-hd">
              <div className="dmc-sb-hd-top">
                <span className="dmc-sb-hd-title">Patient Directory</span>
                <span className="dmc-sb-hd-count">{patients.length}</span>
              </div>
              <div className="dmc-sb-search">
                <span>⌕</span>
                <input 
                  placeholder="Name or Medical Record No." 
                  value={search} 
                  onChange={(e) => setSearch(e.target.value)} 
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
                filteredPatients.map((p) => {
                  const photo = getPatientPhoto(p.patient_id);
                  const active = selectedPatient?.patient_id === p.patient_id;
                  return (
                    <button 
                      key={p.patient_id} 
                      className={`dmc-sb-item ${active ? 'active' : ''}`} 
                      onClick={() => handlePatientClick(p)}
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
              
              <button 
                className={`dmc-sb-item dmc-sb-item-register ${isRegisterMode ? 'active' : ''}`} 
                onClick={handleRegisterClick}
              >
                <div className="dmc-av dmc-av-register">+</div>
                <div className="dmc-sb-item-info">
                  <span className="dmc-sb-item-name">Register New Patient</span>
                  <span className="dmc-sb-item-sub">Add to directory</span>
                </div>
              </button>
            </div>
          </aside>
        )}

        {/* Main Content */}
        <div className="dmc-main">
          {/* Mobile Navigation */}
          {hasPatients && (
            <div className="dmc-mob-nav">
              <button className="dmc-mob-nav-btn" onClick={() => setSidebarOpen(true)}>
                👥 Patients <span className="dmc-mob-nav-count">{patients.length}</span>
              </button>
              
              {(selectedPatient || isRegisterMode) && (
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'center', padding: '0 8px' }}>
                  {isRegisterMode ? 'Register Patient' : selectedPatient?.full_name}
                </span>
              )}
              
              <button className="dmc-mob-nav-btn dmc-mob-nav-btn-pipeline" onClick={() => setPipelineOpen(true)}>
                ⚙️ Pipeline {processComplete && <span className="dmc-mob-nav-done">✓</span>}
              </button>
            </div>
          )}

          {/* Welcome Screen - No Patients */}
          {!hasPatients && !isRegisterMode && (
            <div className="dmc-welcome">
              <div className="dmc-welcome-inner">
                <div className="dmc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Staff'}</h2>
                <p>Get started by registering your first patient.</p>
                <div className="dmc-stats">
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">0</span>
                    <span className="dmc-stat-l">Total Patients</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">0</span>
                    <span className="dmc-stat-l">Male</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">0</span>
                    <span className="dmc-stat-l">Female</span>
                  </div>
                </div>
                <button className="dmc-btn-primary" onClick={handleRegisterClick}>
                  + Register New Patient
                </button>
              </div>
            </div>
          )}

          {/* Welcome Screen - Has Patients but None Selected */}
          {hasPatients && !selectedPatient && !isRegisterMode && (
            <div className="dmc-welcome">
              <div className="dmc-welcome-inner">
                <div className="dmc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Staff'}</h2>
                <p>Select a patient from the list to view or manage their medical records.</p>
                <div className="dmc-stats">
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.length}</span>
                    <span className="dmc-stat-l">Total Patients</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.filter((p) => p.gender === 'M').length}</span>
                    <span className="dmc-stat-l">Male</span>
                  </div>
                  <div className="dmc-stat-sep" />
                  <div className="dmc-stat">
                    <span className="dmc-stat-n">{patients.filter((p) => p.gender === 'F').length}</span>
                    <span className="dmc-stat-l">Female</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Register Mode */}
          {isRegisterMode && (
            <div className="dmc-detail">
              <div className="dmc-pbar">
                <div className="dmc-pbar-info">
                  <span className="dmc-pbar-name">Register New Patient</span>
                  <div className="dmc-pbar-meta">Fill in the patient information below</div>
                </div>
              </div>
              
              <div className="dmc-workspace">
                <div className="dmc-content-panel">
                  <div className="dmc-tab-body">
                    <div className="dmc-card dmc-med-card-sharp">
                      <div className="dmc-card-hd">
                        <span className="dmc-card-title">Patient Registration</span>
                      </div>
                      
                      <div className="dmc-register-form">
                        <div className="dmc-form-group">
                          <label>Medical Record No.</label>
                          <input type="text" value={generateMedicalRecordNo()} disabled className="dmc-input dmc-input-mono dmc-input-auto" />
                          <span className="dmc-field-note">Auto-generated on save</span>
                        </div>
                        
                        <div className="dmc-form-group">
                          <label>Full Name *</label>
                          <input 
                            type="text" 
                            className="dmc-input" 
                            value={registerForm.full_name} 
                            onChange={(e) => setRegisterForm({ ...registerForm, full_name: e.target.value })} 
                            placeholder="Patient full name" 
                            required 
                          />
                        </div>
                        
                        <div className="dmc-form-row">
                          <div className="dmc-form-group">
                            <label>Date of Birth *</label>
                            <input 
                              type="date" 
                              className="dmc-input" 
                              value={registerForm.date_of_birth} 
                              onChange={(e) => setRegisterForm({ ...registerForm, date_of_birth: e.target.value })} 
                              max={new Date().toISOString().split('T')[0]} 
                              required 
                            />
                          </div>
                          
                          <div className="dmc-form-group">
                            <label>Gender *</label>
                            <select 
                              className="dmc-input dmc-select" 
                              value={registerForm.gender} 
                              onChange={(e) => setRegisterForm({ ...registerForm, gender: e.target.value as Gender })}
                            >
                              <option value="M">♂ Male</option>
                              <option value="F">♀ Female</option>
                            </select>
                          </div>
                        </div>
                        
                        {!isRegistering && !registerSuccess && (
                          <div className="dmc-form-actions">
                            <button className="dmc-btn-secondary" onClick={() => setIsRegisterMode(false)}>Cancel</button>
                            <button className="dmc-btn-primary" onClick={handleCreatePatient}>Register Patient</button>
                          </div>
                        )}
                        
                        {isRegistering && (
                          <div className="dmc-register-loading">
                            <span className="dmc-spin" /> Registering patient...
                          </div>
                        )}
                        
                        {!isRegistering && registerSuccess && (
                          <>
                            <div className="dmc-success-message">
                              <span>✅</span> Patient registered successfully! Please upload medical data below.
                            </div>
                            <div className="dmc-upload-after-register">
                              {renderUploadGrid('regPatientPhotoInput', 'regMriImageInput', 'regDiagnosisInput')}
                              <div className="dmc-upload-actions" style={{ marginTop: 12 }}>
                                <button 
                                  className={`dmc-btn-upload ${!canUpload || isUploading ? 'disabled' : ''}`} 
                                  onClick={() => handleUploadMedical(newPatientId!)} 
                                  disabled={!canUpload || isUploading}
                                >
                                  {isUploading ? (
                                    <><span className="dmc-spin" />Processing...</>
                                  ) : (
                                    <>🚀 Upload & Encrypt ({getSelectedMethod().toUpperCase()})</>
                                  )}
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="dmc-pipeline">{renderPipeline()}</div>
              </div>
            </div>
          )}

          {/* Patient Detail View */}
          {hasPatients && selectedPatient && !isRegisterMode && (
            <>
              {renderMobilePatientCard()}
              {medicalRecords.length > 1 && renderMobileRecordNav()}
              
              <div className="dmc-detail">
                <div className="dmc-pbar">
                  <div 
                    className={`dmc-av dmc-av-lg dmc-av-${selectedPatient.gender} dmc-av-clickable`} 
                    onClick={() => { const p = getPatientPhoto(selectedPatient.patient_id); if (p) setLightboxSrc(p); }} 
                    title="Click to zoom"
                  >
                    {getPatientPhoto(selectedPatient.patient_id) ? (
                      <img src={getPatientPhoto(selectedPatient.patient_id)!} alt="" />
                    ) : (
                      selectedPatient.full_name.charAt(0).toUpperCase()
                    )}
                    <span className="dmc-av-zoom">🔍</span>
                  </div>
                  
                  <div className="dmc-pbar-info">
                    <div className="dmc-pbar-name">{selectedPatient.full_name}</div>
                    <div className="dmc-pbar-meta">
                      <span className="dmc-pbar-rm">{selectedPatient.medical_record_no}</span>
                      <span className="dmc-sep">·</span>
                      <span>{selectedPatient.gender === 'M' ? '♂ Male' : '♀ Female'}</span>
                      <span className="dmc-sep">·</span>
                      <span>{calcAge(selectedPatient.date_of_birth)}</span>
                      <span className="dmc-sep dmc-pbar-meta-hide-sm">·</span>
                      <span className="dmc-pbar-meta-hide-sm">DOB: {formatDate(selectedPatient.date_of_birth)}</span>
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
                  
                  <div className="dmc-pbar-actions">
                    <button className="dmc-btn-secondary dmc-btn-sm" onClick={() => setShowEditForm(!showEditForm)}>EDIT</button>
                    <button className="dmc-btn-danger dmc-btn-sm" onClick={() => setShowDeleteConfirm(true)}>DELETE</button>
                  </div>
                </div>
                
                <div className="dmc-workspace">
                  <div className="dmc-content-panel">
                    {/* Edit Panel */}
                    <div className={`dmc-edit-panel-wrapper ${showEditForm ? 'open' : ''}`} style={{ maxHeight: showEditForm ? '260px' : '0px' }}>
                      <div className="dmc-edit-panel">
                        <div className="dmc-edit-header">
                          <span className="dmc-edit-title">✎ Edit Patient Information</span>
                        </div>
                        <div className="dmc-edit-body">
                          <div className="dmc-edit-field">
                            <label>Full Name</label>
                            <input 
                              type="text" 
                              className="dmc-input" 
                              value={editForm.full_name} 
                              onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} 
                            />
                          </div>
                          <div className="dmc-edit-row">
                            <div className="dmc-edit-field">
                              <label>Date of Birth</label>
                              <input 
                                type="date" 
                                className="dmc-input" 
                                value={editForm.date_of_birth} 
                                onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })} 
                                max={new Date().toISOString().split('T')[0]} 
                              />
                            </div>
                            <div className="dmc-edit-field">
                              <label>Gender</label>
                              <select 
                                className="dmc-input dmc-select" 
                                value={editForm.gender} 
                                onChange={(e) => setEditForm({ ...editForm, gender: e.target.value as Gender })}
                              >
                                <option value="M">♂ Male</option>
                                <option value="F">♀ Female</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <div className="dmc-edit-actions">
                          <button className="dmc-btn-secondary" onClick={() => setShowEditForm(false)}>Cancel</button>
                          <button className="dmc-btn-primary" onClick={handleSaveEdit}>Save Changes</button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="dmc-tab-body">
                      {/* Records Tabs */}
                      {medicalRecords.length > 0 && (
                        <div className="dmc-records-tabs">
                          <div className="dmc-records-tab-list">
                            {medicalRecords.map((rec, idx) => (
                              <button 
                                key={rec.record_id} 
                                className={`dmc-records-tab ${idx === activeRecordIndex ? 'active' : ''}`} 
                                onClick={() => setActiveRecordIndex(idx)}
                              >
                                <span className="dmc-records-tab-num">#{rec.record_id}</span>
                                <span className="dmc-records-tab-date">{formatDate(rec.upload_date ?? '')}</span>
                              </button>
                            ))}
                          </div>
                          <button 
                            className="dmc-btn-add-record" 
                            onClick={() => { setShowUploadPanel(!showUploadPanel); resetUploadForm(); }} 
                            disabled={medicalRecords.length >= 10} 
                            title={medicalRecords.length >= 10 ? 'Maximum 10 records reached' : 'Add new record'}
                          >
                            {showUploadPanel ? '✕ Cancel' : '+ Add Record'}
                          </button>
                        </div>
                      )}
                      
                      {/* Upload Panel */}
                      {showUploadPanel && renderModernAddRecordPanel()}
                      
                      {/* Empty State */}
                      {medicalRecords.length === 0 && !showUploadPanel && (
                        <div className="dmc-empty">
                          <span>📁</span>
                          <p>No medical records yet</p>
                          <button className="dmc-btn-primary" onClick={() => { setShowUploadPanel(true); resetUploadForm(); }}>
                            + Upload First Record
                          </button>
                        </div>
                      )}
                      
                      {/* Medical Record Display */}
                      {activeRecord && !showUploadPanel && (
                        <div className="dmc-card dmc-med-card dmc-med-card-sharp">
                          <div className="dmc-card-hd">
                            <span className="dmc-card-title">Medical Record Overview</span>
                            <div className="dmc-card-hd-right">
                              <span className="dmc-rec-badge">
                                Record #{activeRecord.record_id} · {formatDate(activeRecord.upload_date ?? '')}
                              </span>
                              <button className="dmc-btn-download" onClick={handleDownloadReport}>⬇ Download</button>
                              <button 
                                className="dmc-btn-del-record" 
                                onClick={() => setShowDeleteRecordConfirm(activeRecord.record_id)} 
                                title="Delete this record"
                              >
                                🗑
                              </button>
                            </div>
                          </div>
                          
                          <div className="dmc-med-body">
                            <div className="dmc-med-pane dmc-med-pane-stego">
                              <div className="dmc-med-pane-label">Stego Image</div>
                              <div className="dmc-record-img-area">
                                <div 
                                  className="dmc-record-img-sq dmc-record-img-clickable" 
                                  onClick={() => { const u = toUrl(activeRecord.stego_photo_path); if (u) setLightboxSrc(u); }} 
                                  title="Click to zoom"
                                >
                                  <img 
                                    src={toUrl(activeRecord.stego_photo_path)} 
                                    alt="Stego" 
                                    onError={(e) => { (e.target as HTMLImageElement).src = noImg; }} 
                                  />
                                  <span className="dmc-img-zoom-overlay">🔍</span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="dmc-med-divider" />
                            
                            <div className="dmc-med-pane">
                              <div className="dmc-med-pane-label">Diagnosis & Notes</div>
                              <div className="dmc-scrollbox">
                                <pre className="dmc-pre">{diagnosisContents[activeRecord.record_id] || '(no data available)'}</pre>
                              </div>
                            </div>
                            
                            <div className="dmc-med-divider" />
                            
                            <div className="dmc-med-pane">
                              <div className="dmc-med-pane-label">Staff's Annotation</div>
                              <textarea 
                                className="dmc-annot-area" 
                                placeholder="Add clinical notes here…" 
                                value={staffAnnotations[activeRecord.record_id] || ''} 
                                onChange={(e) => setStaffAnnotations((prev) => ({ ...prev, [activeRecord.record_id]: e.target.value }))} 
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="dmc-pipeline">{renderPipeline()}</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Patient Confirmation Modal */}
      {showDeleteConfirm && selectedPatient && (
        <div className="dmc-lightbox" onClick={() => setShowDeleteConfirm(false)}>
          <div className="dmc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dmc-modal-head dmc-modal-head-danger">
              <span>⚠️</span>
              <h3>Delete Patient Data</h3>
            </div>
            <div className="dmc-modal-body">
              <p>You are about to permanently delete this patient and all medical records.</p>
              <div className="dmc-modal-patient">
                <div className={`dmc-modal-avatar dmc-modal-avatar-${selectedPatient.gender}`}>
                  {getPatientPhoto(selectedPatient.patient_id) ? (
                    <img src={getPatientPhoto(selectedPatient.patient_id)!} alt="" />
                  ) : (
                    selectedPatient.full_name.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="dmc-modal-name">{selectedPatient.full_name}</p>
                  <p className="dmc-modal-mr">{selectedPatient.medical_record_no}</p>
                </div>
              </div>
              <p className="dmc-modal-warn">This action cannot be undone.</p>
            </div>
            <div className="dmc-modal-actions">
              <button className="dmc-btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="dmc-btn-danger" onClick={handleDeletePatient}>DELETE</button>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Record Confirmation Modal */}
      {showDeleteRecordConfirm !== null && (
        <div className="dmc-lightbox" onClick={() => setShowDeleteRecordConfirm(null)}>
          <div className="dmc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dmc-modal-head dmc-modal-head-danger">
              <span>⚠️</span>
              <h3>Delete Medical Record</h3>
            </div>
            <div className="dmc-modal-body">
              <p>Delete Record <strong>#{showDeleteRecordConfirm}</strong>? All associated files will be permanently removed.</p>
              <p className="dmc-modal-warn">This action cannot be undone.</p>
            </div>
            <div className="dmc-modal-actions">
              <button className="dmc-btn-secondary" onClick={() => setShowDeleteRecordConfirm(null)}>Cancel</button>
              <button className="dmc-btn-danger" onClick={() => handleDeleteRecord(showDeleteRecordConfirm!)}>DELETE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardStaff;