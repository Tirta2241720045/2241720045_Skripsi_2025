import API from './axios';

export interface QualityMetrics {
  mse: number;
  psnr: number;
  ssim: number;
}

export interface LayerMetrics {
  layer1_mri_stego: QualityMetrics;
  layer2_photo_stego: QualityMetrics;
}

export interface MedicalQualityMetrics {
  embedding?: LayerMetrics | null;
  extraction?: LayerMetrics | null;
}

export interface CapacityInfo {
  data_size_bytes: number;
  mri_capacity_bytes: number;
  mri_stego_size_bytes: number;
  photo_capacity_bytes: number;
}

export interface UploadFileSizes {
  original_txt_kb: number;
  original_mri_kb: number;
  original_photo_kb: number;
  stego_kb: number;
}

export interface ExtractFileSizes {
  original_mri_kb: number;
  original_photo_kb: number;
  stego_kb: number;
  original_txt_kb: number;
  extracted_mri_kb: number;
  extracted_photo_kb: number;
  extracted_txt_kb: number;
}

export interface RecordFileSizes {
  original_txt_kb: number;
  original_mri_kb: number;
  original_photo_kb: number;
  stego_kb: number;
}

export interface UploadMedicalResponse {
  message: string;
  record_id: number;
  stego_image: string;
  embed_time: {
    layer1_seconds: number;
    layer2_seconds: number;
    total_seconds: number;
  };
  quality_metrics: {
    layer1_mri_stego: QualityMetrics;
    layer2_photo_stego: QualityMetrics;
  };
  capacity_info?: CapacityInfo;
  file_sizes: UploadFileSizes;
}

export interface ExtractMedicalResponse {
  record_id: number;
  patient_id: number;
  patient_name: string;
  medical_data: string;
  extract_time_seconds: number;
  stego_image: string;
  photo_path: string;
  mri_path: string;
  txt_path: string;
  lsb_extraction_success: boolean;
  quality_metrics: {
    extraction: {
      layer1_mri_stego: QualityMetrics;
      layer2_photo_stego: QualityMetrics;
    };
  } | null;
  file_sizes: ExtractFileSizes;
}

export interface MedicalRecordItem {
  record_id: number;
  medical_data_path: string;
  photo_path: string;
  mri_path: string;
  stego_photo_path: string;
  upload_date: string | null;
  quality_metrics: MedicalQualityMetrics | null;
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