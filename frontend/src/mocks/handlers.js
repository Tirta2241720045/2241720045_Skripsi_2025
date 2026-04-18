import { rest } from 'msw';

const API_BASE = 'http://localhost:8000';

export const handlers = [
  // ✅ Auth - sudah benar (URLSearchParams)
  rest.post(`${API_BASE}/auth/login`, async (req, res, ctx) => {
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);
    const username = params.get('username');
    const password = params.get('password');

    if (username === 'staff_test' && password === 'staff123') {
      return res(ctx.status(200), ctx.json({
        access_token: 'mock-staff-token',
        token_type: 'bearer',
        user_id: 1,
        username: 'staff_test',
        role: 'staff',
        full_name: 'Staff Test'
      }));
    }

    if (username === 'doctor_test' && password === 'doctor123') {
      return res(ctx.status(200), ctx.json({
        access_token: 'mock-doctor-token',
        token_type: 'bearer',
        user_id: 2,
        username: 'doctor_test',
        role: 'doctor',
        full_name: 'Doctor Test'
      }));
    }

    if (username === 'admin_test' && password === 'admin123') {
      return res(ctx.status(200), ctx.json({
        access_token: 'mock-admin-token',
        token_type: 'bearer',
        user_id: 3,
        username: 'admin_test',
        role: 'admin',
        full_name: 'Admin Test'
      }));
    }

    return res(ctx.status(401));
  }),

  // ✅ GET patients - sudah benar
  rest.get(`${API_BASE}/patients/`, (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader || !authHeader.includes('Bearer')) {
      return res(ctx.status(401));
    }

    return res(ctx.status(200), ctx.json([
      { patient_id: 1001, full_name: 'Pasien Satu', date_of_birth: '1990-01-01', gender: 'M' },
      { patient_id: 1002, full_name: 'Pasien Dua', date_of_birth: '1992-05-15', gender: 'F' },
    ]));
  }),

  // ✅ POST patients - sudah benar (cek doctor token → 403)
  rest.post(`${API_BASE}/patients/`, async (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    if (authHeader && authHeader.includes('mock-doctor-token')) {
      return res(ctx.status(403));
    }

    const data = await req.json();
    return res(ctx.status(201), ctx.json({
      patient_id: 2001,
      medical_record_no: data.medical_record_no,
      full_name: data.full_name,
      date_of_birth: data.date_of_birth,
      gender: data.gender,
      message: 'Pasien berhasil didaftarkan'
    }));
  }),

  // ✅ DELETE patients - FIX: tambah handler untuk cleanup afterAll
  rest.delete(`${API_BASE}/patients/:patientId`, (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader || !authHeader.includes('Bearer')) {
      return res(ctx.status(401));
    }

    return res(ctx.status(200), ctx.json({
      message: `Pasien #${req.params.patientId} berhasil dihapus`
    }));
  }),

  // ✅ GET medical patient records
  rest.get(`${API_BASE}/medical/patient/:patientId`, (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return res(ctx.status(401));
    }

    return res(ctx.status(200), ctx.json({
      patient_id: req.params.patientId,
      patient_name: 'Pasien Test',
      total_records: 2,
      records: [
        {
          record_id: 1,
          upload_date: '2026-01-15T10:00:00',
          stego_photo_path: '/files/embedding/stego_1001_123.png',
          quality_metrics: {
            embedding: {
              layer1_mri_stego: { psnr: 65.2, ssim: 0.999, mse: 0.0001 },
              layer2_photo_stego: { psnr: 58.4, ssim: 0.998, mse: 0.0002 }
            }
          }
        }
      ]
    }));
  }),

  // ✅ FIX: POST medical/upload
  // Masalah: req.formData() crash di jsdom karena Blob tidak didukung whatwg-fetch
  // Solusi: baca sebagai text (URLSearchParams), test juga diubah ikut skema ini
  rest.post(`${API_BASE}/medical/upload`, async (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    // Cek role dokter → 403 (API-10)
    if (authHeader && authHeader.includes('mock-doctor-token')) {
      return res(ctx.status(403));
    }

    // Baca body sebagai text, parse URLSearchParams
    const bodyText = await req.text();
    const params = new URLSearchParams(bodyText);
    const patientId = params.get('patient_id');

    // patient_id tidak valid → 404 (API-11)
    if (patientId === '99999') {
      return res(ctx.status(404), ctx.json({ detail: 'Patient not found' }));
    }

    // Upload sukses → 200 + record_id (API-09)
    return res(ctx.status(200), ctx.json({
      message: 'Data berhasil diproses',
      record_id: 12345,
      stego_image: `/files/embedding/stego_${patientId}_timestamp.png`,
      embed_time: { total_seconds: 0.25 },
      quality_metrics: {
        layer1_mri_stego: { psnr: 64.8, ssim: 0.998, mse: 0.0002 },
        layer2_photo_stego: { psnr: 57.9, ssim: 0.997, mse: 0.0003 }
      }
    }));
  }),

  // ✅ FIX: GET medical/extract/:recordId
  // Tambahkan pengecekan recordId === '99999' → 404 (API-14)
  rest.get(`${API_BASE}/medical/extract/:recordId`, (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');
    const { recordId } = req.params;

    if (!authHeader || !authHeader.includes('Bearer')) {
      return res(ctx.status(401));
    }

    // Staff tidak boleh ekstrak → 403 (API-13)
    if (authHeader.includes('mock-staff-token')) {
      return res(ctx.status(403));
    }

    // Record tidak ditemukan → 404 (API-14)
    if (recordId === '99999') {
      return res(ctx.status(404), ctx.json({ detail: 'Record not found' }));
    }

    return res(ctx.status(200), ctx.json({
      record_id: recordId,
      patient_id: 1001,
      patient_name: 'Pasien Test',
      medical_data: 'Diagnosis: Tumor otak Grade II\nDokter: Dr. Spesialis\nTanggal: 2026-01-15',
      extract_time_seconds: 0.18,
      lsb_extraction_success: true,
      quality_metrics: {
        extraction: {
          layer1_mri_stego: { psnr: 64.5, ssim: 0.997, mse: 0.0003 },
          layer2_photo_stego: { psnr: 57.2, ssim: 0.996, mse: 0.0004 }
        }
      }
    }));
  }),

  // ✅ DELETE medical/record - sudah benar
  rest.delete(`${API_BASE}/medical/record/:recordId`, (req, res, ctx) => {
    const authHeader = req.headers.get('Authorization');

    if (!authHeader || authHeader.includes('mock-doctor-token')) {
      return res(ctx.status(403));
    }

    return res(ctx.status(200), ctx.json({
      message: `Rekam medis #${req.params.recordId} berhasil dihapus`,
      record_id: req.params.recordId
    }));
  }),
];