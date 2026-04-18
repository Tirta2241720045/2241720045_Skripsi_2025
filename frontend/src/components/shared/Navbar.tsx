import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../../api/auth';
import '../../styles/Navbar.css';

interface NavbarProps {
  userFullName?: string;
  userRole?: string;
}

const Navbar: React.FC<NavbarProps> = ({ userFullName = '', userRole = '' }) => {
  const navigate = useNavigate();
  const [currentDateTime, setCurrentDateTime] = useState({ date: '', time: '' });

  const handleLogout = () => {
    logout(); 
    navigate('/');
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':   return 'Administrator';
      case 'doctor':  return 'Doctor';
      case 'staff':   return 'Medical Staff';
      default:        return 'User';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':  return 'http://localhost:8000/static/admin.png';
      case 'doctor': return 'http://localhost:8000/static/dokter.png';
      case 'staff':  return 'http://localhost:8000/static/staff.png';
      default:       return '';
    }
  };

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentDateTime({
        date: now.toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }),
        time: now.toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        }),
      });
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <nav className="stegoshield-navbar">
      <div className="stegoshield-navbar-left">
        <div className="stegoshield-navbar-brand">
          <div className="stegoshield-navbar-brand-icon">
            <img
              src="http://localhost:8000/static/logo.png"
              alt="StegoShield Logo"
              className="stegoshield-navbar-brand-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.textContent = '🛡️';
                  parent.style.fontSize = '28px';
                  parent.style.display = 'flex';
                  parent.style.alignItems = 'center';
                  parent.style.justifyContent = 'center';
                }
              }}
            />
          </div>
          <div className="stegoshield-navbar-brand-text">
            <h1>StegoShield</h1>
            <p>Medical Data Protection System</p>
          </div>
        </div>
      </div>

      <div className="stegoshield-navbar-right">
        <div className="stegoshield-navbar-datetime-wrapper">
          <div className="stegoshield-navbar-flag-wrapper">
            <img
              src="http://localhost:8000/static/flag.png"
              alt="Indonesian Flag"
              className="stegoshield-navbar-flag-image"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>
          <div className="stegoshield-navbar-datetime-content">
            <span className="stegoshield-navbar-datetime-date">{currentDateTime.date}</span>
            <span className="stegoshield-navbar-datetime-separator">•</span>
            <span className="stegoshield-navbar-datetime-time">{currentDateTime.time} WIB</span>
          </div>
        </div>

        <div className="stegoshield-navbar-divider" />

        <div className="stegoshield-navbar-admin-info">
          <div className="stegoshield-navbar-admin-avatar-wrapper">
            <img
              src={getRoleIcon(userRole)}
              alt={getRoleLabel(userRole)}
              className="stegoshield-navbar-admin-avatar-img"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const parent = e.currentTarget.parentElement;
                if (parent) {
                  parent.textContent = userFullName?.charAt(0).toUpperCase() || 'U';
                  parent.style.background = 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)';
                  parent.style.display = 'flex';
                  parent.style.alignItems = 'center';
                  parent.style.justifyContent = 'center';
                  parent.style.color = 'white';
                  parent.style.fontWeight = '700';
                  parent.style.fontSize = '18px';
                }
              }}
            />
          </div>
          <div className="stegoshield-navbar-admin-details">
            <p className="stegoshield-navbar-admin-name">{userFullName}</p>
            <p className="stegoshield-navbar-admin-role">{getRoleLabel(userRole)}</p>
          </div>
        </div>

        <button onClick={handleLogout} className="stegoshield-navbar-btn-logout">
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;