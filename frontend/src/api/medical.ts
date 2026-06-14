import API from './axios';

export type StegoMethod = 'stegoshield' | 'dwt_pso' | 'ebs3' | 'ebs5' | 'ebs9';

export const STEGO_METHODS: { value: StegoMethod; label: string }[] = [
  { value: 'stegoshield', label: 'StegoShield (LSB RONI + AES)' },
  { value: 'dwt_pso',     label: 'DWT-PSO (DWT + LDPC)' },
  { value: 'ebs3',        label: 'EBS-3 (Edge Based + S-Box)' },
  { value: 'ebs5',        label: 'EBS-5 (Edge Based + 5-Layer)' },
  { value: 'ebs9',        label: 'EBS-9 (Edge Based + 9-Layer)' },
];

export interface QualityMetrics {
  mse: number;
  psnr: number;
  ssim: number;
  brisque: number | null;
  niqe: number | null;
  piqe: number | null;
}

export interface AccTxtResult {
  acc_txt: number | null;
  D: number | null;
  T: number | null;
  bit_errors: number | null;
}

export interface LayerMetrics {
  layer1_mri_stego: QualityMetrics;
  layer2_photo_stego: QualityMetrics;
  acc_txt?: AccTxtResult | null;
}

export interface MedicalQualityMetrics {
  embedding?: LayerMetrics | null;
  extraction?: LayerMetrics | null;
}

export interface VisualizationPaths {
  mri_lsb_map: string | null;
  photo_lsb_map: string | null;
}

export interface LayerTiming {
  layer1_seconds: number;
  layer2_seconds: number;
  total_seconds: number;
}

export interface UploadFileSizes {
  original_txt_kb: number;
  original_mri_kb: number;
  original_photo_kb: number;
  stego_kb: number;
}

export interface ExtractFileSizes {
  stego_kb: number;
  extracted_mri_kb: number;
  extracted_photo_kb: number;
  extracted_txt_kb: number;
}

export interface RecordFileSizes {
  original_txt_kb: number;
  original_mri_kb: number;
  original_photo_kb: number;
  stego_kb: number;
  vis_mri_kb?: number;
  vis_photo_kb?: number;
}

export interface UploadMedicalResponse {
  message: string;
  record_id: number;
  method: StegoMethod;
  stego_image: string;
  mbed_time: LayerTiming;
  quality_metrics: {
    layer1_mri_stego: QualityMetrics;
    layer2_photo_stego: QualityMetrics;
  };
  file_sizes: UploadFileSizes;
}

export interface ExtractMedicalResponse {
  record_id: number;
  patient_id: number;
  patient_name: string;
  method: StegoMethod;
  medical_data: string;
  extract_time_seconds: number;
  extract_time_per_layer: LayerTiming;
  stego_image: string;
  photo_path: string;
  mri_path: string;
  txt_path: string;
  lsb_extraction_success: boolean;
  acc_txt: AccTxtResult;
  quality_metrics: {
    extraction: LayerMetrics;
  };
  file_sizes: ExtractFileSizes;
}

export interface MedicalRecordItem {
  record_id: number;
  method: StegoMethod;
  medical_data_path: string;
  photo_path: string;
  mri_path: string;
  stego_photo_path: string;
  visualization?: VisualizationPaths | null;
  upload_date: string | null;
  quality_metrics: MedicalQualityMetrics;
  file_sizes: RecordFileSizes;
}

export interface PatientMedicalRecordsResponse {
  patient_id: number;
  patient_name: string;
  total_records: number;
  records: MedicalRecordItem[];
}

export interface DeleteMedicalRecordResponse {
  message: string;
  record_id: number;
  files_deleted: {
    deleted: string[];
    count: number;
  };
}

export interface SupportedMethodsResponse {
  methods: StegoMethod[];
  default: StegoMethod;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export const getSupportedMethods = async (): Promise<SupportedMethodsResponse> => {
  const response = await API.get('/medical/methods');
  return response.data;
};

export const uploadMedicalData = async (
  formData: FormData
): Promise<UploadMedicalResponse> => {
  const response = await API.post('/medical/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const getMedicalRecordsByPatient = async (
  patient_id: number
): Promise<PatientMedicalRecordsResponse> => {
  const response = await API.get(`/medical/patient/${patient_id}`);
  return response.data;
};

export const extractMedicalData = async (
  record_id: number
): Promise<ExtractMedicalResponse> => {
  const response = await API.get(`/medical/extract/${record_id}`);
  return response.data;
};

export const deleteMedicalRecord = async (
  record_id: number
): Promise<DeleteMedicalRecordResponse> => {
  const response = await API.delete(`/medical/record/${record_id}`);
  return response.data;
};