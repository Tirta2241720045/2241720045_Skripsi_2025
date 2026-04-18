import API from './axios';

export type Gender = 'M' | 'F';

export interface PatientResponse {
  patient_id: number;
  medical_record_no: string;
  full_name: string;
  date_of_birth: string;
  gender: Gender;
  registration_date: string;
}

export interface CreatePatientRequest {
  medical_record_no: string;
  full_name: string;
  date_of_birth: string;
  gender: Gender;
}

export interface UpdatePatientRequest {
  full_name?: string;
  date_of_birth?: string;
  gender?: Gender;
}

export interface DeletePatientResponse {
  message: string;
  patient_id: number;
  medical_records_deleted: number;
  files_deleted: {
    original: string[];
    embedding: string[];
    extraction: string[];
    total: number;
  };
}

export const createPatient = async (
  data: CreatePatientRequest
): Promise<PatientResponse> => {
  const response = await API.post('/patients/', data);
  return response.data;
};

export const getAllPatients = async (): Promise<PatientResponse[]> => {
  const response = await API.get('/patients/');
  return response.data;
};

export const getPatient = async (patient_id: number): Promise<PatientResponse> => {
  const response = await API.get(`/patients/${patient_id}`);
  return response.data;
};

export const updatePatient = async (
  patient_id: number,
  data: UpdatePatientRequest
): Promise<PatientResponse> => {
  const response = await API.put(`/patients/${patient_id}`, data);
  return response.data;
};

export const deletePatient = async (
  patient_id: number
): Promise<DeletePatientResponse> => {
  const response = await API.delete(`/patients/${patient_id}`);
  return response.data;
};