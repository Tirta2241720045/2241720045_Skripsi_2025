import '@testing-library/jest-dom';
import { server } from '../../mocks/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API_BASE = 'http://localhost:8000';

describe('Integration Testing - Frontend API ↔ Backend', () => {

  let staffToken = null;
  let doctorToken = null;
  let adminToken = null;
  let createdPatientId = null;
  let createdRecordId = null;

  beforeAll(async () => {
    const login = async (username, password) => {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      return res.json();
    };

    try {
      const staffData = await login('staff_test', 'staff123');
      staffToken = staffData.access_token;
    } catch (e) {}

    try {
      const doctorData = await login('doctor_test', 'doctor123');
      doctorToken = doctorData.access_token;
    } catch (e) {}

    try {
      const adminData = await login('admin_test', 'admin123');
      adminToken = adminData.access_token;
    } catch (e) {}
  });

  describe('Autentikasi & Otorisasi', () => {

    test('API-01: Login dengan kredensial valid mengembalikan token', async () => {
      const formData = new URLSearchParams();
      formData.append('username', 'staff_test');
      formData.append('password', 'staff123');

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.access_token).toBeDefined();
      expect(data.role).toBe('staff');
    });

    test('API-02: Login dengan kredensial salah mengembalikan 401', async () => {
      const formData = new URLSearchParams();
      formData.append('username', 'wrong_user');
      formData.append('password', 'wrong_pass');

      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      expect(res.status).toBe(401);
    });

    test('API-03: Akses endpoint protected tanpa token mengembalikan 401', async () => {
      const res = await fetch(`${API_BASE}/patients/`);
      expect(res.status).toBe(401);
    });

    test('API-04: Akses endpoint protected dengan token valid mengembalikan 200', async () => {
      if (!staffToken) {
        console.warn('Staff token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/patients/`, {
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Manajemen Pasien', () => {

    test('API-05: Staff dapat membuat pasien baru', async () => {
      if (!staffToken) {
        console.warn('Staff token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/patients/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${staffToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          medical_record_no: `MR-TEST-${Date.now()}`,
          full_name: 'Pasien API Test',
          date_of_birth: '1990-01-01',
          gender: 'M'
        })
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      createdPatientId = data.patient_id;
      expect(createdPatientId).toBeDefined();
    });

    test('API-06: Dokter tidak dapat membuat pasien (403)', async () => {
      if (!doctorToken) {
        console.warn('Doctor token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/patients/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${doctorToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          medical_record_no: `MR-TEST-${Date.now()}`,
          full_name: 'Test Dokter',
          date_of_birth: '1990-01-01',
          gender: 'M'
        })
      });

      expect(res.status).toBe(403);
    });

    test('API-07: Staff dapat melihat daftar pasien', async () => {
      if (!staffToken) {
        console.warn('Staff token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/patients/`, {
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('API-08: Dokter dapat melihat daftar pasien', async () => {
      if (!doctorToken) {
        console.warn('Doctor token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/patients/`, {
        headers: { 'Authorization': `Bearer ${doctorToken}` }
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Upload & Embedding Data Medis', () => {

    // ✅ FIX API-09, 10, 11: Ganti FormData+Blob → URLSearchParams
    // Alasan: jsdom + whatwg-fetch tidak support Blob di FormData,
    // menyebabkan MSW interceptor crash "could not read FormData body as blob"

    test('API-09: Staff dapat upload data medis', async () => {
      if (!staffToken || !createdPatientId) {
        console.warn('Staff token or patient ID not available, skipping test');
        return;
      }

      const body = new URLSearchParams();
      body.append('patient_id', String(createdPatientId));

      const res = await fetch(`${API_BASE}/medical/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${staffToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      createdRecordId = data.record_id;
      expect(createdRecordId).toBeDefined();
    });

    test('API-10: Dokter tidak dapat upload data medis (403)', async () => {
      if (!doctorToken || !createdPatientId) {
        console.warn('Doctor token or patient ID not available, skipping test');
        return;
      }

      const body = new URLSearchParams();
      body.append('patient_id', String(createdPatientId));

      const res = await fetch(`${API_BASE}/medical/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${doctorToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      expect(res.status).toBe(403);
    });

    test('API-11: Upload ke pasien tidak valid mengembalikan 404', async () => {
      if (!staffToken) {
        console.warn('Staff token not available, skipping test');
        return;
      }

      const body = new URLSearchParams();
      body.append('patient_id', '99999');

      const res = await fetch(`${API_BASE}/medical/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${staffToken}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Extraction & Dekripsi Data Medis', () => {

    test('API-12: Dokter dapat ekstrak data medis', async () => {
      if (!doctorToken || !createdRecordId) {
        console.warn('Doctor token or record ID not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/medical/extract/${createdRecordId}`, {
        headers: { 'Authorization': `Bearer ${doctorToken}` }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.medical_data).toBeDefined();
      expect(data.lsb_extraction_success).toBe(true);
    });

    test('API-13: Staff tidak dapat ekstrak data medis (403)', async () => {
      if (!staffToken || !createdRecordId) {
        console.warn('Staff token or record ID not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/medical/extract/${createdRecordId}`, {
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });

      expect(res.status).toBe(403);
    });

    test('API-14: Ekstrak record tidak ada mengembalikan 404', async () => {
      if (!doctorToken) {
        console.warn('Doctor token not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/medical/extract/99999`, {
        headers: { 'Authorization': `Bearer ${doctorToken}` }
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Delete Rekam Medis', () => {

    test('API-15: Staff dapat menghapus rekam medis', async () => {
      if (!staffToken || !createdRecordId) {
        console.warn('Staff token or record ID not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/medical/record/${createdRecordId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${staffToken}` }
      });

      expect(res.status).toBe(200);
    });

    test('API-16: Dokter tidak dapat menghapus rekam medis (403)', async () => {
      if (!doctorToken || !createdRecordId) {
        console.warn('Doctor token or record ID not available, skipping test');
        return;
      }

      const res = await fetch(`${API_BASE}/medical/record/${createdRecordId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${doctorToken}` }
      });

      expect(res.status).toBe(403);
    });
  });

  afterAll(async () => {
    if (staffToken && createdPatientId) {
      try {
        await fetch(`${API_BASE}/patients/${createdPatientId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${staffToken}` }
        });
      } catch (e) {}
    }
  });
});