import os
import pytest

# Semua fixtures (client, db_session, staff_token, doctor_token, sample_patient,
# sample_image_files) dan hooks pelaporan sudah ada di conftest.py.
# File ini hanya berisi test case integration.


class TestAuthIntegration:
    """Integration Testing: Autentikasi & Otorisasi"""

    def test_login_admin_success(self, client, db_session):
        from app.models.database import User
        from app.api.auth import hash_password

        admin = User(username="admin_int", full_name="Admin Int", role="admin")
        admin.password_hash = hash_password("pass123")
        db_session.add(admin)
        db_session.commit()

        response = client.post("/auth/login", data={"username": "admin_int", "password": "pass123"})
        assert response.status_code == 200
        assert "access_token" in response.json()

    def test_login_wrong_password(self, client, db_session):
        from app.models.database import User
        from app.api.auth import hash_password

        admin = User(username="admin_wrong", full_name="Admin Wrong", role="admin")
        admin.password_hash = hash_password("pass123")
        db_session.add(admin)
        db_session.commit()

        response = client.post("/auth/login", data={"username": "admin_wrong", "password": "wrong"})
        assert response.status_code == 401

    def test_access_protected_route_without_token(self, client):
        response = client.get("/medical/patient/1001")
        assert response.status_code == 401

    def test_access_protected_route_with_valid_token(self, client, staff_token, sample_patient):
        response = client.get(
            f"/medical/patient/{sample_patient.patient_id}", headers=staff_token
        )
        assert response.status_code == 200


class TestPatientManagementIntegration:
    """Integration Testing: Manajemen Pasien"""

    def test_create_patient_staff(self, client, staff_token):
        data = {
            "medical_record_no": "MR-2001",
            "full_name": "Pasien Baru Test",
            "date_of_birth": "1995-05-15",
            "gender": "M",
        }
        response = client.post("/patients/", json=data, headers=staff_token)
        assert response.status_code == 201
        assert response.json()["medical_record_no"] == "MR-2001"

    def test_create_patient_doctor_forbidden(self, client, doctor_token):
        data = {
            "medical_record_no": "MR-2002",
            "full_name": "Test",
            "date_of_birth": "2000-01-01",
            "gender": "M",
        }
        response = client.post("/patients/", json=data, headers=doctor_token)
        assert response.status_code == 403

    def test_get_patient_list_staff(self, client, staff_token, sample_patient):
        response = client.get("/patients/", headers=staff_token)
        assert response.status_code == 200
        assert len(response.json()) >= 1

    def test_get_patient_list_doctor(self, client, doctor_token, sample_patient):
        response = client.get("/patients/", headers=doctor_token)
        assert response.status_code == 200


class TestMedicalUploadIntegration:
    """Integration Testing: Upload & Embedding Data Medis"""

    def test_upload_medical_staff(self, client, staff_token, sample_patient, sample_image_files):
        with open(sample_image_files["photo"], "rb") as p, \
             open(sample_image_files["mri"],   "rb") as m, \
             open(sample_image_files["txt"],   "rb") as t:
            response = client.post(
                "/medical/upload",
                data={"patient_id": str(sample_patient.patient_id)},
                files={
                    "patient_photo": ("photo.png", p, "image/png"),
                    "mri_image":     ("mri.png",   m, "image/png"),
                    "medical_data":  ("data.txt",  t, "text/plain"),
                },
                headers=staff_token,
            )
        assert response.status_code == 200
        assert "record_id"       in response.json()
        assert "stego_image"     in response.json()
        assert "quality_metrics" in response.json()

    def test_upload_medical_doctor_forbidden(self, client, doctor_token, sample_patient, sample_image_files):
        with open(sample_image_files["photo"], "rb") as p, \
             open(sample_image_files["mri"],   "rb") as m, \
             open(sample_image_files["txt"],   "rb") as t:
            response = client.post(
                "/medical/upload",
                data={"patient_id": str(sample_patient.patient_id)},
                files={
                    "patient_photo": ("photo.png", p, "image/png"),
                    "mri_image":     ("mri.png",   m, "image/png"),
                    "medical_data":  ("data.txt",  t, "text/plain"),
                },
                headers=doctor_token,
            )
        assert response.status_code == 403

    def test_upload_medical_invalid_patient(self, client, staff_token, sample_image_files):
        with open(sample_image_files["photo"], "rb") as p, \
             open(sample_image_files["mri"],   "rb") as m, \
             open(sample_image_files["txt"],   "rb") as t:
            response = client.post(
                "/medical/upload",
                data={"patient_id": "99999"},
                files={
                    "patient_photo": ("photo.png", p, "image/png"),
                    "mri_image":     ("mri.png",   m, "image/png"),
                    "medical_data":  ("data.txt",  t, "text/plain"),
                },
                headers=staff_token,
            )
        assert response.status_code == 404


class TestMedicalExtractIntegration:
    """Integration Testing: Extraction & Dekripsi Data Medis"""

    def _do_upload(self, client, staff_token, sample_patient, sample_image_files):
        with open(sample_image_files["photo"], "rb") as p, \
             open(sample_image_files["mri"],   "rb") as m, \
             open(sample_image_files["txt"],   "rb") as t:
            resp = client.post(
                "/medical/upload",
                data={"patient_id": str(sample_patient.patient_id)},
                files={
                    "patient_photo": ("photo.png", p, "image/png"),
                    "mri_image":     ("mri.png",   m, "image/png"),
                    "medical_data":  ("data.txt",  t, "text/plain"),
                },
                headers=staff_token,
            )
        return resp.json()["record_id"]

    def test_extract_medical_doctor(self, client, staff_token, doctor_token,
                                    sample_patient, sample_image_files):
        record_id = self._do_upload(client, staff_token, sample_patient, sample_image_files)
        response  = client.get(f"/medical/extract/{record_id}", headers=doctor_token)
        assert response.status_code == 200
        assert "medical_data" in response.json()
        assert "Test" in response.json()["medical_data"]

    def test_extract_medical_staff_forbidden(self, client, staff_token,
                                              sample_patient, sample_image_files):
        record_id = self._do_upload(client, staff_token, sample_patient, sample_image_files)
        response  = client.get(f"/medical/extract/{record_id}", headers=staff_token)
        assert response.status_code == 403

    def test_extract_nonexistent_record(self, client, doctor_token):
        response = client.get("/medical/extract/99999", headers=doctor_token)
        assert response.status_code == 404


class TestMedicalDeleteIntegration:
    """Integration Testing: Delete Rekam Medis"""

    def _do_upload(self, client, staff_token, sample_patient, sample_image_files):
        with open(sample_image_files["photo"], "rb") as p, \
             open(sample_image_files["mri"],   "rb") as m, \
             open(sample_image_files["txt"],   "rb") as t:
            resp = client.post(
                "/medical/upload",
                data={"patient_id": str(sample_patient.patient_id)},
                files={
                    "patient_photo": ("photo.png", p, "image/png"),
                    "mri_image":     ("mri.png",   m, "image/png"),
                    "medical_data":  ("data.txt",  t, "text/plain"),
                },
                headers=staff_token,
            )
        return resp.json()["record_id"]

    def test_delete_medical_staff(self, client, staff_token, sample_patient, sample_image_files):
        record_id = self._do_upload(client, staff_token, sample_patient, sample_image_files)
        response  = client.delete(f"/medical/record/{record_id}", headers=staff_token)
        assert response.status_code == 200

    def test_delete_medical_doctor_forbidden(self, client, staff_token, doctor_token,
                                              sample_patient, sample_image_files):
        record_id = self._do_upload(client, staff_token, sample_patient, sample_image_files)
        response  = client.delete(f"/medical/record/{record_id}", headers=doctor_token)
        assert response.status_code == 403