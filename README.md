# 🛡️ StegoShield — Medical Data Protection System

> Sistem steganografi untuk melindungi data medis menggunakan metode **LSB (Least Significant Bit)** dengan enkripsi **AES**.

---

## 📌 Deskripsi

StegoShield adalah sistem perlindungan data medis berbasis steganografi. Data sensitif disembunyikan di dalam gambar menggunakan teknik LSB dan diamankan dengan enkripsi AES, sehingga aman dari akses tidak sah.

---

## 🧰 Tech Stack

| Layer | Teknologi |
|-------|-----------|
| **Backend** | FastAPI, SQLAlchemy, PostgreSQL, OpenCV |
| **Frontend** | React, TypeScript, Chart.js |
| **Deployment** | Railway (backend), Vercel (frontend) |

---

## 🚀 Menjalankan Secara Lokal

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
uvicorn main:app --reload
```

Akses dokumentasi API di: `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm install
npm start
```

Akses aplikasi di: `http://localhost:3000`

---

## ☁️ Deployment

### Backend — Railway

1. Push repository ke GitHub
2. Buat project baru di [railway.app](https://railway.app) → **Deploy from GitHub**
3. Set **Root Directory** = `backend`
4. Tambahkan plugin **PostgreSQL**
5. Set environment variable:

```env
SECRET_KEY=your_secret_key_here
```

### Frontend — Vercel

1. Push repository ke GitHub
2. Import project di [vercel.com](https://vercel.com)
3. Set **Root Directory** = `frontend`
4. Set environment variable:

```env
REACT_APP_API_URL=https://your-backend.railway.app
```

---

## 👤 Akun Default

> ⚠️ **Catatan:** Akun berikut hanya untuk keperluan pengujian. Ganti password sebelum deployment ke production.

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin_test` | `admin123` |
| Staff | `staff_test` | `staff123` |
| Doctor | `doctor_test` | `doctor123` |

---

## 📁 Struktur Proyek

```
stegoshield/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── ...
├── frontend/
│   ├── src/
│   ├── package.json
│   └── ...
└── README.md
```

---

## 📄 Lisensi

Proyek ini dibuat sebagai tugas akhir (skripsi). Seluruh hak cipta dilindungi.