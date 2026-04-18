import React, { useState, useEffect, useCallback } from 'react';
import Navbar from '../../components/shared/Navbar';
import { getAllPatients, createPatient, updatePatient, deletePatient, PatientResponse, Gender } from '../../api/patients';
import { getMedicalRecordsByPatient, uploadMedicalData, MedicalRecordItem } from '../../api/medical';
import '../../styles/DashboardStaff.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface ProcessStep {
  id: string; label: string; sublabel: string; icon: string;
  status: 'pending' | 'active' | 'done';
}

interface FileValidation {
  isValid: boolean; errors: string[]; format: string;
  dimensions?: { width: number; height: number };
  size: number; isGrayscale?: boolean; lineCount?: number; charCount?: number;
  croppedSize?: number;
}

const BASE_URL = 'http://localhost:8000';

const DEFAULT_PROCESS_STEPS: ProcessStep[] = [
  { id: 'encrypt', label: 'Encrypt Data', sublabel: 'AES-128 CBC', icon: '🔐', status: 'pending' },
  { id: 'embed1', label: 'Embed to MRI', sublabel: 'LSB Grayscale Layer 1', icon: '🩻', status: 'pending' },
  { id: 'embed2', label: 'Embed to Photo', sublabel: 'LSB RGB Layer 2', icon: '📷', status: 'pending' },
  { id: 'save', label: 'Save Stego Image', sublabel: 'Finalize output', icon: '💾', status: 'pending' },
];

function toUrl(path: string) {
  if (!path) return '';
  return `${BASE_URL}/${path.replace(/\\/g, '/')}`;
}

const noImg = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23f1f5f9" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23cbd5e1" font-size="11"%3ENo Image%3C/text%3E%3C/svg%3E';

async function fetchTextContent(path: string): Promise<string> {
  try {
    const response = await fetch(toUrl(path));
    if (!response.ok) throw new Error('Failed to fetch');
    return await response.text();
  } catch {
    return 'Failed to load file content';
  }
}

function autoCropSquare(imageSrc: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const srcX = (img.width - size) / 2;
      const srcY = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, srcX, srcY, size, size, 0, 0, size, size);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Crop failed')), 'image/png');
    };
    img.onerror = reject;
    img.src = imageSrc;
  });
}

const validateImageFile = async (file: File, expectedType: 'color' | 'grayscale'): Promise<FileValidation> => {
  const errors: string[] = [];
  if (!file.type.match(/image\/(png|jpeg|jpg)/)) errors.push('Format must be PNG or JPEG/JPG');
  if (file.size > 10 * 1024 * 1024) errors.push(`Too large (max 10MB) — ${(file.size / 1024 / 1024).toFixed(2)}MB`);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
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
      if (Math.abs(r - g) > 10 || Math.abs(g - b) > 10 || Math.abs(r - b) > 10) {
        colorCount++;
        if (colorCount > totalPixels * 0.1) { isColorDetected = true; break; }
      }
    }

    isGrayscale = !isColorDetected;
    if (expectedType === 'color' && isGrayscale) errors.push('Patient Photo must be color image');
    if (expectedType === 'grayscale' && !isGrayscale) errors.push('MRI Image must be grayscale');
  }

  const cropSize = Math.min(img.width, img.height);
  return {
    isValid: errors.length === 0, errors, format: file.type,
    dimensions: { width: img.width, height: img.height },
    size: file.size, isGrayscale, croppedSize: cropSize,
  };
};

const validateTextFile = async (file: File): Promise<FileValidation> => {
  const errors: string[] = [];
  if (file.type !== 'text/plain' && !file.name.endsWith('.txt')) errors.push('Format must be TXT');
  if (file.size > 5 * 1024 * 1024) errors.push('Too large (max 5MB)');
  const content = await file.text();
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) errors.push('File cannot be empty');
  if (content.length < 10) errors.push('Minimum 10 characters');
  if (content.length > 50000) errors.push('Too long (max 50000 characters)');
  return {
    isValid: errors.length === 0, errors, format: 'text/plain',
    size: file.size, lineCount: lines.length, charCount: content.length,
  };
};

const formatDate = (iso: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
};

const calcAge = (dob: string) => {
  if (!dob) return '—';
  return Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) + ' years old';
};

const todayFilename = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
};

const Lightbox = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <div className="lightbox" onClick={onClose}>
    <img src={src} alt="" onClick={e => e.stopPropagation()} />
    <button className="lightbox-close" onClick={onClose}>✕</button>
  </div>
);

const DashboardStaff = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const [patients, setPatients] = useState<PatientResponse[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResponse | null>(null);
  const [patientPhotos, setPatientPhotos] = useState<Record<number, string>>({});
  const [medicalRecord, setMedicalRecord] = useState<MedicalRecordItem | null>(null);
  const [diagnosisContent, setDiagnosisContent] = useState<string>('');
  const [staffAnnotation, setStaffAnnotation] = useState<string>('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: string }>({ show: false, message: '', type: 'success' });
  const [search, setSearch] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [newPatientId, setNewPatientId] = useState<number | null>(null);

  const [registerForm, setRegisterForm] = useState({ full_name: '', date_of_birth: '', gender: 'M' as Gender });
  const [editForm, setEditForm] = useState({ medical_record_no: '', full_name: '', date_of_birth: '', gender: 'M' as Gender });

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

  const [processSteps, setProcessSteps] = useState<ProcessStep[]>(DEFAULT_PROCESS_STEPS.map(s => ({ ...s })));
  const [isProcessing, setIsProcessing] = useState(false);
  const [processComplete, setProcessComplete] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);

  const showNotification = useCallback((message: string, type: string) => {
    setNotification({ show: true, message, type });
  }, []);

  useEffect(() => {
    if (!notification.show) return;
    const t = setTimeout(() => setNotification(p => ({ ...p, show: false })), 3500);
    return () => clearTimeout(t);
  }, [notification.show]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLightboxSrc(null); setSidebarOpen(false); setPipelineOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const loadPatients = useCallback(async () => {
    try {
      const data = await getAllPatients();
      setPatients(data);
      const photoMap: Record<number, string> = {};
      await Promise.allSettled(data.map(async p => {
        try {
          const result = await getMedicalRecordsByPatient(p.patient_id);
          if (result.records?.length > 0) photoMap[p.patient_id] = toUrl(result.records[0].stego_photo_path);
        } catch { }
      }));
      setPatientPhotos(photoMap);
    } catch { showNotification('Failed to load patient data', 'error'); }
  }, [showNotification]);

  const loadMedicalRecord = useCallback(async (patientId: number) => {
    try {
      const result = await getMedicalRecordsByPatient(patientId);
      if (result.records?.length > 0) {
        const record = result.records[0];
        setMedicalRecord(record);
        if (record.medical_data_path) {
          const content = await fetchTextContent(record.medical_data_path);
          setDiagnosisContent(content);
        } else {
          setDiagnosisContent('');
        }
      } else {
        setMedicalRecord(null);
        setDiagnosisContent('');
      }
      setStaffAnnotation('');
    } catch {
      setMedicalRecord(null);
      setDiagnosisContent('');
    }
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  useEffect(() => {
    if (selectedPatient) {
      loadMedicalRecord(selectedPatient.patient_id);
      setEditForm({
        medical_record_no: selectedPatient.medical_record_no,
        full_name: selectedPatient.full_name,
        date_of_birth: selectedPatient.date_of_birth,
        gender: selectedPatient.gender,
      });
    } else {
      setMedicalRecord(null);
      setDiagnosisContent('');
    }
    setIsProcessing(false);
    setProcessComplete(false);
    setShowEditForm(false);
    setProcessSteps(DEFAULT_PROCESS_STEPS.map(s => ({ ...s })));
  }, [selectedPatient, loadMedicalRecord]);

  const generateMedicalRecordNo = useCallback((): string => {
    const nums = patients
      .map(p => p.medical_record_no)
      .filter(m => m.startsWith('MR-'))
      .map(m => parseInt(m.replace('MR-', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => b - a);
    const nextNum = ((nums[0] || 0) + 1).toString().padStart(5, '0');
    return `MR-${nextNum}`;
  }, [patients]);

  const getPatientPhoto = (patientId: number): string | null => {
    if (patientPhotos[patientId]) return patientPhotos[patientId];
    if (selectedPatient?.patient_id === patientId && medicalRecord) return toUrl(medicalRecord.stego_photo_path);
    return null;
  };

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

  const runProcessSteps = async () => {
    setProcessSteps(DEFAULT_PROCESS_STEPS.map(s => ({ ...s, status: 'pending' })));
    setIsProcessing(true);
    setProcessComplete(false);
    const delays = [800, 900, 900, 600];
    for (let i = 0; i < DEFAULT_PROCESS_STEPS.length; i++) {
      setProcessSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'active' } : s));
      await new Promise(r => setTimeout(r, delays[i]));
      setProcessSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done' } : s));
    }
    setProcessComplete(true);
    setIsProcessing(false);
  };

  const isFullNameDuplicate = (fullName: string, excludePatientId?: number): boolean => {
    return patients.some(p =>
      p.full_name.toLowerCase() === fullName.toLowerCase() && p.patient_id !== excludePatientId
    );
  };

  const handlePatientClick = (patient: PatientResponse) => {
    if (selectedPatient?.patient_id === patient.patient_id) {
      setSelectedPatient(null);
      setIsRegisterMode(false);
      setShowEditForm(false);
      setRegisterSuccess(false);
    } else {
      setSelectedPatient(patient);
      setIsRegisterMode(false);
      setShowEditForm(false);
      setRegisterSuccess(false);
    }
    setSidebarOpen(false);
  };

  const handleRegisterClick = () => {
    setSelectedPatient(null);
    setIsRegisterMode(true);
    setShowEditForm(false);
    setRegisterSuccess(false);
    setNewPatientId(null);
    setRegisterForm({ full_name: '', date_of_birth: '', gender: 'M' });
    setPatientPhotoFile(null);
    setMriImageFile(null);
    setDiagnosisFile(null);
    setPatientPhotoPreview(null);
    setMriImagePreview(null);
    setDiagnosisPreview(null);
    setPatientPhotoValidation(null);
    setMriImageValidation(null);
    setDiagnosisValidation(null);
    setSidebarOpen(false);
  };

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
    try {
      const newPatient = await createPatient({
        medical_record_no: mrNo,
        full_name: registerForm.full_name,
        date_of_birth: registerForm.date_of_birth,
        gender: registerForm.gender,
      });
      showNotification(`Patient registered — ${mrNo}`, 'success');
      setRegisterSuccess(true);
      setNewPatientId(newPatient.patient_id);
      await loadPatients();
    } catch (err: any) {
      showNotification(err?.response?.data?.detail || 'Failed to register patient', 'error');
    }
  };

  const handleUploadFromRegistration = async () => {
    if (!newPatientId) return;
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
      const photoBlob = await autoCropSquare(patientPhotoPreview!);
      const mriBlob = await autoCropSquare(mriImagePreview!);
      const fd = new FormData();
      fd.append('patient_id', newPatientId.toString());
      fd.append('medical_data', diagnosisFile, diagnosisFile.name);
      fd.append('mri_image', new File([mriBlob], 'mri.png', { type: 'image/png' }));
      fd.append('patient_photo', new File([photoBlob], 'photo.png', { type: 'image/png' }));
      const [result] = await Promise.all([uploadMedicalData(fd), runProcessSteps()]);
      showNotification(`Record #${result.record_id} saved successfully`, 'success');
      setSelectedPatient(patients.find(p => p.patient_id === newPatientId) || null);
      setIsRegisterMode(false);
      setRegisterSuccess(false);
      setNewPatientId(null);
      await loadMedicalRecord(newPatientId);
      const updated = await getMedicalRecordsByPatient(newPatientId);
      if (updated.records?.length > 0) {
        setPatientPhotos(prev => ({ ...prev, [newPatientId]: toUrl(updated.records[0].stego_photo_path) }));
      }
    } catch {
      showNotification('Upload failed — please try again', 'error');
      setIsProcessing(false);
      setProcessSteps(DEFAULT_PROCESS_STEPS.map(s => ({ ...s })));
    } finally {
      setIsUploading(false);
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
        gender: editForm.gender,
      });
      showNotification('Patient data updated successfully', 'success');
      setShowEditForm(false);
      await loadPatients();
      setSelectedPatient(prev => prev ? {
        ...prev,
        full_name: editForm.full_name,
        date_of_birth: editForm.date_of_birth,
        gender: editForm.gender,
      } : null);
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

  const handleUploadMedical = async () => {
    if (!selectedPatient || !patientPhotoFile || !mriImageFile || !diagnosisFile) {
      showNotification('All files are required', 'warning');
      return;
    }
    if (!patientPhotoValidation?.isValid || !mriImageValidation?.isValid || !diagnosisValidation?.isValid) {
      showNotification('Validation failed', 'error');
      return;
    }
    setIsUploading(true);
    try {
      const photoBlob = await autoCropSquare(patientPhotoPreview!);
      const mriBlob = await autoCropSquare(mriImagePreview!);
      const fd = new FormData();
      fd.append('patient_id', selectedPatient.patient_id.toString());
      fd.append('medical_data', diagnosisFile, diagnosisFile.name);
      fd.append('mri_image', new File([mriBlob], 'mri.png', { type: 'image/png' }));
      fd.append('patient_photo', new File([photoBlob], 'photo.png', { type: 'image/png' }));
      const [result] = await Promise.all([uploadMedicalData(fd), runProcessSteps()]);
      showNotification(`Record #${result.record_id} saved successfully`, 'success');
      await loadMedicalRecord(selectedPatient.patient_id);
      const updated = await getMedicalRecordsByPatient(selectedPatient.patient_id);
      if (updated.records?.length > 0) {
        setPatientPhotos(prev => ({ ...prev, [selectedPatient.patient_id]: toUrl(updated.records[0].stego_photo_path) }));
      }
      setPatientPhotoFile(null);
      setMriImageFile(null);
      setDiagnosisFile(null);
      setPatientPhotoPreview(null);
      setMriImagePreview(null);
      setDiagnosisPreview(null);
      setPatientPhotoValidation(null);
      setMriImageValidation(null);
      setDiagnosisValidation(null);
    } catch {
      showNotification('Upload failed — please try again', 'error');
      setIsProcessing(false);
      setProcessSteps(DEFAULT_PROCESS_STEPS.map(s => ({ ...s })));
    } finally {
      setIsUploading(false);
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
      if (renderHeight > pageHeight - margin * 2) {
        renderHeight = pageHeight - margin * 2;
        renderWidth = renderHeight / ratio;
      }
      pdf.addImage(imgData, 'PNG', (pageWidth - renderWidth) / 2, margin, renderWidth, renderHeight);
      pdf.save(filename);
      showNotification('Report downloaded as PDF', 'success');
    } catch {
      showNotification('Failed to generate PDF', 'error');
    } finally {
      document.body.removeChild(element);
    }
  };

  const buildReportElement = (html: string, width = 1000): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;background:white;font-family:Segoe UI,Arial,sans-serif;padding:32px 36px;box-sizing:border-box;`;
    el.innerHTML = html;
    return el;
  };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const nl2br = (s: string) => esc(s).replace(/\n/g, '<br/>');

  const handleDownloadReport = async () => {
    if (!selectedPatient) return;
    const doctorName = user.full_name || 'Staff';
    const html = `
      <div style="margin-bottom:24px;">
        <div style="font-size:22px;font-weight:700;color:#0d1117;text-align:center;margin-bottom:6px;">Medical Record Report</div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #e0e4ea;padding-bottom:10px;">
          <div><span style="font-size:13px;color:#667;">Patient:</span><span style="font-size:15px;font-weight:600;color:#0d1117;margin-left:6px;">${esc(selectedPatient.full_name)}</span></div>
          <div><span style="font-size:12px;color:#667;">MR: ${esc(selectedPatient.medical_record_no)}</span></div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th style="background:#f0f2f6;border:1px solid #ccc;padding:8px 14px;font-size:10px;font-weight:700;text-align:left;">Section</th>
          <th style="background:#f0f2f6;border:1px solid #ccc;padding:8px 14px;font-size:10px;font-weight:700;text-align:left;">Content</th>
        </tr></thead>
        <tbody>
          <tr><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;font-weight:600;">Stego Image</td><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;">Embedded image available in system</td></tr>
          <tr><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;font-weight:600;">Diagnosis & Notes</td><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;">${nl2br(diagnosisContent || '(no data available)')}</td></tr>
          <tr><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;font-weight:600;">Staff's Annotation</td><td style="border:1px solid #ccc;padding:12px 14px;vertical-align:top;">${nl2br(staffAnnotation || '(no annotation)')}</td></tr>
        </tbody>
      </table>
      <div style="margin-top:24px;text-align:right;">
        <div style="font-size:13px;font-weight:600;color:#0d1117;">${esc(doctorName)}</div>
        <div style="font-size:10px;color:#667;">${formatDate(new Date().toISOString())}</div>
      </div>`;
    await generatePDF(buildReportElement(html), `Medical_Report_${selectedPatient.medical_record_no}_${todayFilename()}.pdf`);
  };

  const embedMetrics = medicalRecord?.quality_metrics?.embedding;
  const latestMetrics = embedMetrics ?? null;
  const filteredPatients = patients.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    p.medical_record_no.toLowerCase().includes(search.toLowerCase())
  );
  const hasPatients = patients.length > 0;

  const canUpload = !!patientPhotoFile && !!mriImageFile && !!diagnosisFile &&
    !!patientPhotoValidation?.isValid && !!mriImageValidation?.isValid && !!diagnosisValidation?.isValid;

  const renderUploadGrid = (photoInputId: string, mriInputId: string, diagInputId: string) => (
    <div className="upload-grid-container">
      <div className="upload-row">
        <div className="upload-card">
          <div className="upload-card-header">
            <span className="upload-card-icon">📷</span>
            <span className="upload-card-title">Patient Photo</span>
            <span className="upload-card-badge">COLOR</span>
          </div>
          <div className="upload-card-body">
            <div
              className={`upload-dropzone ${patientPhotoPreview ? 'has-file' : ''} ${patientPhotoValidation?.isValid === false ? 'error' : ''}`}
              onClick={() => document.getElementById(photoInputId)?.click()}
            >
              {patientPhotoPreview ? (
                <img src={patientPhotoPreview} alt="Preview" />
              ) : (
                <div className="upload-placeholder">
                  <span>Click or drag to upload</span>
                  <small>PNG, JPG (max 10MB)</small>
                </div>
              )}
            </div>
            <input
              id={photoInputId}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={e => { const f = e.target.files?.[0]; if (f) processPatientPhoto(f); }}
              style={{ display: 'none' }}
            />
            {patientPhotoValidation && (
              <div className={`upload-feedback ${patientPhotoValidation.isValid ? 'success' : 'error'}`}>
                <span>{patientPhotoValidation.isValid ? '✓ Valid' : '✕ Invalid'}</span>
                <span>{(patientPhotoValidation.size / 1024).toFixed(0)} KB</span>
                {patientPhotoValidation.errors.map((err, i) => <span key={i}>{err}</span>)}
              </div>
            )}
          </div>
        </div>

        <div className="upload-card">
          <div className="upload-card-header">
            <span className="upload-card-icon">🩻</span>
            <span className="upload-card-title">MRI Image</span>
            <span className="upload-card-badge">GRAYSCALE</span>
          </div>
          <div className="upload-card-body">
            <div
              className={`upload-dropzone ${mriImagePreview ? 'has-file' : ''} ${mriImageValidation?.isValid === false ? 'error' : ''}`}
              onClick={() => document.getElementById(mriInputId)?.click()}
            >
              {mriImagePreview ? (
                <img src={mriImagePreview} alt="Preview" />
              ) : (
                <div className="upload-placeholder">
                  <span>Click or drag to upload</span>
                  <small>PNG, JPG (max 10MB)</small>
                </div>
              )}
            </div>
            <input
              id={mriInputId}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={e => { const f = e.target.files?.[0]; if (f) processMriImage(f); }}
              style={{ display: 'none' }}
            />
            {mriImageValidation && (
              <div className={`upload-feedback ${mriImageValidation.isValid ? 'success' : 'error'}`}>
                <span>{mriImageValidation.isValid ? '✓ Valid' : '✕ Invalid'}</span>
                <span>{(mriImageValidation.size / 1024).toFixed(0)} KB</span>
                {mriImageValidation.errors.map((err, i) => <span key={i}>{err}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="upload-card upload-card-full">
        <div className="upload-card-header">
          <span className="upload-card-icon">📄</span>
          <span className="upload-card-title">Diagnosis & Medical Notes</span>
          <span className="upload-card-badge">TXT</span>
        </div>
        <div className="upload-card-body">
          <div
            className={`upload-dropzone upload-dropzone-text ${diagnosisPreview ? 'has-file' : ''} ${diagnosisValidation?.isValid === false ? 'error' : ''}`}
            onClick={() => document.getElementById(diagInputId)?.click()}
          >
            {diagnosisPreview ? (
              <pre className="upload-text-preview">{diagnosisPreview}</pre>
            ) : (
              <div className="upload-placeholder">
                <span>Click or drag to upload</span>
                <small>TXT file (max 5MB)</small>
              </div>
            )}
          </div>
          <input
            id={diagInputId}
            type="file"
            accept=".txt,text/plain"
            onChange={e => { const f = e.target.files?.[0]; if (f) processDiagnosisFile(f); }}
            style={{ display: 'none' }}
          />
          {diagnosisValidation && (
            <div className={`upload-feedback ${diagnosisValidation.isValid ? 'success' : 'error'}`}>
              <span>{diagnosisValidation.isValid ? '✓ Valid' : '✕ Invalid'}</span>
              <span>{(diagnosisValidation.size / 1024).toFixed(0)} KB</span>
              <span>{diagnosisValidation.lineCount} lines</span>
              <span>{diagnosisValidation.charCount} chars</span>
              {diagnosisValidation.errors.map((err, i) => <span key={i}>{err}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderPipeline = () => (
    <>
      <div className="ddc-pl-hd">
        <span className="ddc-pl-title">Processing Pipeline</span>
        {processComplete && <span className="chip chip-teal">Done</span>}
      </div>
      <div className="ddc-pl-steps">
        {processSteps.map((step, i) => (
          <div key={step.id} className={`ddc-pls ddc-pls-${step.status}`}>
            <div className="ddc-pls-track">
              <div className="ddc-pls-node">
                <span>{step.icon}</span>
                {step.status === 'done' && <span className="ddc-pls-ok">✓</span>}
                {step.status === 'active' && <span className="ddc-pls-active-ring" />}
              </div>
              {i < processSteps.length - 1 && (
                <div className={`ddc-pls-line ${step.status === 'done' ? 'done' : ''}`} />
              )}
            </div>
            <div className="ddc-pls-text">
              <span className="ddc-pls-label">{step.label}</span>
              <span className="ddc-pls-sub">{step.sublabel}</span>
            </div>
          </div>
        ))}
      </div>

      {isProcessing && (
        <div className="ddc-pl-info ddc-pl-info-running">
          <div className="ddc-pl-info-icon">⚙️</div>
          <div className="ddc-pl-info-body">
            <span className="ddc-pl-info-title">Processing...</span>
            <p>Pipeline is running. Each layer is being processed sequentially — encryption, embedding into MRI, embedding into photo, and finalization.</p>
          </div>
        </div>
      )}

      {processComplete && latestMetrics && (
        <>
          <div className="pl-metrics">
            <div className="pl-metrics-hd">Quality Metrics</div>
            {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map(key => {
              const m = latestMetrics[key];
              return (
                <div className="pl-metrics-layer-group" key={key}>
                  <div className="pl-metrics-layer-label">
                    {key === 'layer1_mri_stego' ? 'Layer 1 — MRI' : 'Layer 2 — Photo'}
                  </div>
                  <div className="pl-metrics-badges-vertical">
                    <div className="mbadge">
                      <span className="mbadge-l">MSE</span>
                      <span className="mbadge-v">{m.mse.toFixed(3)}</span>
                    </div>
                    <div className={`mbadge ${m.psnr >= 40 ? 'good' : m.psnr >= 30 ? 'ok' : 'bad'}`}>
                      <span className="mbadge-l">PSNR</span>
                      <span className="mbadge-v">{m.psnr.toFixed(1)} dB</span>
                    </div>
                    <div className={`mbadge ${m.ssim >= 0.95 ? 'good' : m.ssim >= 0.85 ? 'ok' : 'bad'}`}>
                      <span className="mbadge-l">SSIM</span>
                      <span className="mbadge-v">{m.ssim.toFixed(4)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {medicalRecord?.file_sizes && (
            <div className="pl-metrics" style={{ marginTop: '8px' }}>
              <div className="pl-metrics-hd">File Size</div>
              <div className="pl-filesize-block">
                <div className="pl-filesize-row">
                  <span className="pl-filesize-label">Stego Image</span>
                  <span className="pl-filesize-val">
                    {medicalRecord.file_sizes.stego_kb ? `${medicalRecord.file_sizes.stego_kb} KB` : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="ddc-pl-info ddc-pl-info-done">
            <div className="ddc-pl-info-icon">✅</div>
            <div className="ddc-pl-info-body">
              <span className="ddc-pl-info-title">Embedding Complete</span>
              <p>All pipeline stages completed successfully. The medical record has been encrypted and embedded into the stego image.</p>
            </div>
          </div>
        </>
      )}

      {!isProcessing && !processComplete && !latestMetrics && (
        <div className="ddc-pl-info ddc-pl-info-idle">
          <div className="ddc-pl-info-icon">🔐</div>
          <div className="ddc-pl-info-body">
            <span className="ddc-pl-info-title">Ready to Process</span>
            <p>Upload patient photo, MRI scan, and medical diagnosis. The system will encrypt and embed data using 2-layer LSB steganography.</p>
          </div>
        </div>
      )}

      {!isProcessing && !processComplete && latestMetrics && (
        <>
          <div className="pl-metrics">
            <div className="pl-metrics-hd">Quality Metrics</div>
            {(['layer1_mri_stego', 'layer2_photo_stego'] as const).map(key => {
              const m = latestMetrics[key];
              return (
                <div className="pl-metrics-layer-group" key={key}>
                  <div className="pl-metrics-layer-label">
                    {key === 'layer1_mri_stego' ? 'Layer 1 — MRI' : 'Layer 2 — Photo'}
                  </div>
                  <div className="pl-metrics-badges-vertical">
                    <div className="mbadge">
                      <span className="mbadge-l">MSE</span>
                      <span className="mbadge-v">{m.mse.toFixed(3)}</span>
                    </div>
                    <div className={`mbadge ${m.psnr >= 40 ? 'good' : m.psnr >= 30 ? 'ok' : 'bad'}`}>
                      <span className="mbadge-l">PSNR</span>
                      <span className="mbadge-v">{m.psnr.toFixed(1)} dB</span>
                    </div>
                    <div className={`mbadge ${m.ssim >= 0.95 ? 'good' : m.ssim >= 0.85 ? 'ok' : 'bad'}`}>
                      <span className="mbadge-l">SSIM</span>
                      <span className="mbadge-v">{m.ssim.toFixed(4)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {medicalRecord?.file_sizes && (
            <div className="pl-metrics" style={{ marginTop: '8px' }}>
              <div className="pl-metrics-hd">File Size</div>
              <div className="pl-filesize-block">
                <div className="pl-filesize-row">
                  <span className="pl-filesize-label">Stego Image</span>
                  <span className="pl-filesize-val">
                    {medicalRecord.file_sizes.stego_kb ? `${medicalRecord.file_sizes.stego_kb} KB` : '—'}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="ddc-pl-info ddc-pl-info-done">
            <div className="ddc-pl-info-icon">✅</div>
            <div className="ddc-pl-info-body">
              <span className="ddc-pl-info-title">Embedding Complete</span>
              <p>All pipeline stages completed successfully. The medical record has been encrypted and embedded into the stego image.</p>
            </div>
          </div>
        </>
      )}
    </>
  );

  return (
    <div className="ddc">
      <Navbar userFullName={user.full_name} userRole={user.role} />

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      {notification.show && (
        <div className={`global-notification global-notification-${notification.type}`}>
          <span className="notification-icon">{notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}</span>
          <span className="notification-message">{notification.message}</span>
        </div>
      )}

      <div className={`ddc-sb-overlay ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className={`ddc-pipeline-sheet-overlay ${pipelineOpen ? 'visible' : ''}`} onClick={() => setPipelineOpen(false)} />

      <div className={`ddc-pipeline-sheet ${pipelineOpen ? 'open' : ''}`}>
        <div className="ddc-pipeline-sheet-handle" />
        <button className="ddc-pipeline-sheet-close" onClick={() => setPipelineOpen(false)}>✕</button>
        <div className="ddc-pipeline-sheet-inner">
          {renderPipeline()}
        </div>
      </div>

      <div className="ddc-layout">
        {hasPatients && (
          <aside className={`ddc-sb ${sidebarOpen ? 'ddc-sb-open' : ''}`}>
            <div className="ddc-sb-hd">
              <div className="ddc-sb-hd-top">
                <span className="ddc-sb-hd-title">Patient Directory</span>
                <span className="ddc-sb-hd-count">{patients.length}</span>
              </div>
              <div className="ddc-sb-search">
                <span>⌕</span>
                <input
                  placeholder="Name or Medical Record No."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && <button onClick={() => setSearch('')}>✕</button>}
              </div>
            </div>
            <div className="ddc-sb-list">
              {filteredPatients.length === 0 ? (
                <div className="ddc-sb-empty"><span>🔍</span><p>No patients found</p></div>
              ) : (
                filteredPatients.map(p => {
                  const photo = getPatientPhoto(p.patient_id);
                  const active = selectedPatient?.patient_id === p.patient_id;
                  return (
                    <button
                      key={p.patient_id}
                      className={`ddc-sb-item ${active ? 'active' : ''}`}
                      onClick={() => handlePatientClick(p)}
                    >
                      <div className={`ddc-av ddc-av-${p.gender}`}>
                        {photo ? <img src={photo} alt="" /> : p.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="ddc-sb-item-info">
                        <span className="ddc-sb-item-name">{p.full_name}</span>
                        <span className="ddc-sb-item-sub">{p.medical_record_no} · {calcAge(p.date_of_birth)}</span>
                      </div>
                      <span className={`ddc-dot ddc-dot-${p.gender}`} />
                    </button>
                  );
                })
              )}
              <button
                className={`ddc-sb-item ddc-sb-item-register ${isRegisterMode ? 'active' : ''}`}
                onClick={handleRegisterClick}
              >
                <div className="ddc-av ddc-av-register">+</div>
                <div className="ddc-sb-item-info">
                  <span className="ddc-sb-item-name">Register New Patient</span>
                  <span className="ddc-sb-item-sub">Add to directory</span>
                </div>
              </button>
            </div>
          </aside>
        )}

        <div className="ddc-main">
          {hasPatients && (
            <div className="ddc-mob-nav">
              <button className="ddc-mob-nav-btn" onClick={() => setSidebarOpen(true)}>
                👥 Patients <span className="ddc-mob-nav-count">{patients.length}</span>
              </button>
              {(selectedPatient || isRegisterMode) && (
                <span className="ddc-mob-nav-label">
                  {isRegisterMode ? 'Register Patient' : selectedPatient?.full_name}
                </span>
              )}
              <button className="ddc-mob-nav-btn ddc-mob-nav-btn-pipeline" onClick={() => setPipelineOpen(true)}>
                ⚙️ Pipeline
                {processComplete && <span className="ddc-mob-nav-done">✓</span>}
              </button>
            </div>
          )}

          {!hasPatients && !isRegisterMode && !selectedPatient && (
            <div className="ddc-welcome">
              <div className="ddc-welcome-inner">
                <div className="ddc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Staff'}</h2>
                <p>Get started by registering your first patient.</p>
                <div className="ddc-stats">
                  <div className="ddc-stat"><span className="ddc-stat-n">0</span><span className="ddc-stat-l">Total Patients</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">0</span><span className="ddc-stat-l">Male</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">0</span><span className="ddc-stat-l">Female</span></div>
                </div>
                <button className="ddc-btn-primary" onClick={handleRegisterClick}>
                  + Register New Patient
                </button>
              </div>
            </div>
          )}

          {hasPatients && !selectedPatient && !isRegisterMode && (
            <div className="ddc-welcome">
              <div className="ddc-welcome-inner">
                <div className="ddc-welcome-ico">🏥</div>
                <h2>Welcome, {user.full_name || 'Staff'}</h2>
                <p>Select a patient from the list to view or manage their medical records.</p>
                <div className="ddc-stats">
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.length}</span><span className="ddc-stat-l">Total Patients</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.filter(p => p.gender === 'M').length}</span><span className="ddc-stat-l">Male</span></div>
                  <div className="ddc-stat-sep" />
                  <div className="ddc-stat"><span className="ddc-stat-n">{patients.filter(p => p.gender === 'F').length}</span><span className="ddc-stat-l">Female</span></div>
                </div>
              </div>
            </div>
          )}

          {isRegisterMode && (
            <div className="ddc-detail">
              <div className="ddc-pbar">
                <div className="ddc-pbar-info">
                  <span className="ddc-pbar-name">Register New Patient</span>
                  <div className="ddc-pbar-meta">Fill in the patient information below</div>
                </div>
              </div>
              <div className="ddc-workspace">
                <div className="ddc-content-panel">
                  <div className="ddc-tab-body">
                    <div className="ddc-card">
                      <div className="card-hd">
                        <span className="card-title">Patient Registration</span>
                        {registerSuccess && newPatientId && (
                          <button
                            className="ddc-btn-ext"
                            onClick={handleUploadFromRegistration}
                            disabled={isUploading || !canUpload}
                            style={{ padding: '6px 14px', fontSize: '11px' }}
                          >
                            {isUploading ? <><span className="spin" />Uploading...</> : <>Upload & Encrypt</>}
                          </button>
                        )}
                      </div>
                      <div className="ds-register-form">
                        <div className="ds-form-group">
                          <label>Medical Record No.</label>
                          <input type="text" value={generateMedicalRecordNo()} disabled className="ds-input ds-input-mono ds-auto" />
                          <span className="ds-field-note">Auto-generated on save</span>
                        </div>
                        <div className="ds-form-group">
                          <label>Full Name *</label>
                          <input
                            type="text"
                            className="ds-input"
                            value={registerForm.full_name}
                            onChange={e => setRegisterForm({ ...registerForm, full_name: e.target.value })}
                            placeholder="Patient full name"
                            required
                          />
                        </div>
                        <div className="ds-form-row">
                          <div className="ds-form-group">
                            <label>Date of Birth *</label>
                            <input
                              type="date"
                              className="ds-input"
                              value={registerForm.date_of_birth}
                              onChange={e => setRegisterForm({ ...registerForm, date_of_birth: e.target.value })}
                              max={new Date().toISOString().split('T')[0]}
                              required
                            />
                          </div>
                          <div className="ds-form-group">
                            <label>Gender *</label>
                            <select
                              className="ds-input ds-select"
                              value={registerForm.gender}
                              onChange={e => setRegisterForm({ ...registerForm, gender: e.target.value as Gender })}
                            >
                              <option value="M">♂ Male</option>
                              <option value="F">♀ Female</option>
                            </select>
                          </div>
                        </div>

                        {registerSuccess ? (
                          <div className="ds-success-message-full">
                            Patient registered successfully! Please upload medical data below.
                          </div>
                        ) : (
                          <div className="ds-form-actions">
                            <button className="ddc-btn-secondary" onClick={() => setIsRegisterMode(false)}>Cancel</button>
                            <button className="ddc-btn-primary" onClick={handleCreatePatient}>Register Patient</button>
                          </div>
                        )}

                        {registerSuccess && (
                          <div className="ds-upload-after-register">
                            {renderUploadGrid('regPatientPhotoInput', 'regMriImageInput', 'regDiagnosisInput')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="ddc-pipeline">
                  {renderPipeline()}
                </div>
              </div>
            </div>
          )}

          {hasPatients && selectedPatient && !isRegisterMode && (
            <div className="ddc-detail">
              <div className="ddc-pbar">
                <div
                  className={`ddc-av ddc-av-lg ddc-av-${selectedPatient.gender} ddc-av-clickable`}
                  onClick={() => {
                    const photo = getPatientPhoto(selectedPatient.patient_id);
                    if (photo) setLightboxSrc(photo);
                  }}
                  title="Click to zoom"
                >
                  {getPatientPhoto(selectedPatient.patient_id)
                    ? <img src={getPatientPhoto(selectedPatient.patient_id)!} alt="" />
                    : selectedPatient.full_name.charAt(0).toUpperCase()
                  }
                  <span className="ddc-av-zoom">🔍</span>
                </div>
                <div className="ddc-pbar-info">
                  <div className="ddc-pbar-name">{selectedPatient.full_name}</div>
                  <div className="ddc-pbar-meta">
                    <span className="ddc-pbar-rm">{selectedPatient.medical_record_no}</span>
                    <span className="sep">·</span>
                    <span>{selectedPatient.gender === 'M' ? '♂ Male' : '♀ Female'}</span>
                    <span className="sep">·</span>
                    <span>{calcAge(selectedPatient.date_of_birth)}</span>
                    <span className="sep ddc-pbar-meta-hide-sm">·</span>
                    <span className="ddc-pbar-meta-hide-sm">DOB: {formatDate(selectedPatient.date_of_birth)}</span>
                  </div>
                </div>
                <div className="ddc-pbar-actions">
                  <button className="ddc-btn-secondary ddc-btn-sm" onClick={() => setShowEditForm(!showEditForm)}>EDIT</button>
                  <button className="ddc-btn-danger ddc-btn-sm" onClick={() => setShowDeleteConfirm(true)}>DELETE</button>
                </div>
              </div>

              <div className="ddc-workspace">
                <div className="ddc-content-panel">
                  <div
                    className={`ds-edit-panel-wrapper ${showEditForm ? 'ds-edit-panel-open' : ''}`}
                    style={{ maxHeight: showEditForm ? '400px' : '0px' }}
                  >
                    <div className="ds-edit-panel">
                      <div className="ds-edit-header">
                        <span className="ds-edit-title">✎ Edit Patient Information</span>
                      </div>
                      <div className="ds-edit-body">
                        <div className="ds-edit-field">
                          <label>Full Name</label>
                          <input
                            type="text"
                            className="ds-input"
                            value={editForm.full_name}
                            onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                          />
                        </div>
                        <div className="ds-edit-row">
                          <div className="ds-edit-field">
                            <label>Date of Birth</label>
                            <input
                              type="date"
                              className="ds-input"
                              value={editForm.date_of_birth}
                              onChange={e => setEditForm({ ...editForm, date_of_birth: e.target.value })}
                              max={new Date().toISOString().split('T')[0]}
                            />
                          </div>
                          <div className="ds-edit-field">
                            <label>Gender</label>
                            <select
                              className="ds-input ds-select"
                              value={editForm.gender}
                              onChange={e => setEditForm({ ...editForm, gender: e.target.value as Gender })}
                            >
                              <option value="M">♂ Male</option>
                              <option value="F">♀ Female</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="ds-edit-actions">
                        <button className="ddc-btn-secondary" onClick={() => setShowEditForm(false)}>Cancel</button>
                        <button className="ddc-btn-primary" onClick={handleSaveEdit}>Save Changes</button>
                      </div>
                    </div>
                  </div>

                  <div className="ddc-tab-body">
                    {medicalRecord ? (
                      <div className="ddc-card ddc-med-card">
                        <div className="card-hd">
                          <span className="card-title">Medical Record Overview</span>
                          <div className="card-hd-right">
                            <span className="ddc-rec-badge">Record #{medicalRecord.record_id} · {formatDate(medicalRecord.upload_date ?? '')}</span>
                            <button className="btn-download" onClick={handleDownloadReport}>⬇ Download</button>
                          </div>
                        </div>
                        <div className="ddc-med-body">
                          <div className="ddc-med-pane ddc-med-pane-stego">
                            <div className="ddc-med-pane-label">Stego Image</div>
                            <div className="ds-record-img-area">
                              <div
                                className="ds-record-img-sq ds-record-img-clickable"
                                onClick={() => {
                                  const stegoUrl = toUrl(medicalRecord.stego_photo_path);
                                  if (stegoUrl) setLightboxSrc(stegoUrl);
                                }}
                                title="Click to zoom"
                              >
                                <img
                                  src={toUrl(medicalRecord.stego_photo_path)}
                                  alt="Stego"
                                  onError={e => { (e.target as HTMLImageElement).src = noImg; }}
                                />
                                <span className="ds-img-zoom-overlay">🔍</span>
                              </div>
                            </div>
                          </div>
                          <div className="ddc-med-divider" />
                          <div className="ddc-med-pane">
                            <div className="ddc-med-pane-label">Diagnosis & Notes</div>
                            <div className="ddc-scrollbox">
                              <pre className="ddc-pre">{diagnosisContent || '(no data available)'}</pre>
                            </div>
                          </div>
                          <div className="ddc-med-divider" />
                          <div className="ddc-med-pane">
                            <div className="ddc-med-pane-label">Staff's Annotation</div>
                            <textarea
                              className="ddc-annot-area"
                              placeholder="Add clinical notes, observations, or annotations here…"
                              value={staffAnnotation}
                              onChange={e => setStaffAnnotation(e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="ddc-card ddc-upload-full-height">
                        <div className="card-hd">
                          <span className="card-title">Upload Medical Record</span>
                          <button
                            className="ddc-btn-ext"
                            onClick={handleUploadMedical}
                            disabled={isUploading || !canUpload}
                            style={{ padding: '6px 14px', fontSize: '11px' }}
                          >
                            {isUploading ? <><span className="spin" />Processing...</> : <>🚀 Upload & Encrypt</>}
                          </button>
                        </div>
                        <div className="ds-upload-section">
                          {renderUploadGrid('patientPhotoInput', 'mriImageInput', 'diagnosisInput')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="ddc-pipeline">
                  {renderPipeline()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && selectedPatient && (
        <div className="lightbox" onClick={() => setShowDeleteConfirm(false)}>
          <div className="ds-modal" onClick={e => e.stopPropagation()}>
            <div className="ds-modal-head ds-modal-head-danger">
              <span>⚠️</span>
              <h3>Delete Patient Data</h3>
            </div>
            <div className="ds-modal-body">
              <p>You are about to permanently delete this patient and all medical records.</p>
              <div className="ds-modal-patient">
                <div className={`ds-modal-avatar ds-avatar-${selectedPatient.gender}`}>
                  {getPatientPhoto(selectedPatient.patient_id)
                    ? <img src={getPatientPhoto(selectedPatient.patient_id)!} alt="" />
                    : selectedPatient.full_name.charAt(0).toUpperCase()
                  }
                </div>
                <div>
                  <p className="ds-modal-name">{selectedPatient.full_name}</p>
                  <p className="ds-modal-mr">{selectedPatient.medical_record_no}</p>
                </div>
              </div>
              <p className="ds-modal-warn">This action cannot be undone.</p>
            </div>
            <div className="ds-modal-actions">
              <button className="ddc-btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="ddc-btn-danger" onClick={handleDeletePatient}>DELETE</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardStaff;