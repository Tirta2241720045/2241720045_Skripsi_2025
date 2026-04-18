import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import DashboardStaff from './pages/Staff/DashboardStaff';
import DashboardDoctor from './pages/Doctor/DashboardDoctor';
import DashboardAdmin from './pages/Admin/DashboardAdmin';
import PrivateRoute from './components/shared/PrivateRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin" element={<PrivateRoute role="admin"><DashboardAdmin /></PrivateRoute>} />
        <Route path="/staff" element={<PrivateRoute role="staff"><DashboardStaff /></PrivateRoute>} />
        <Route path="/doctor" element={<PrivateRoute role="doctor"><DashboardDoctor /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;