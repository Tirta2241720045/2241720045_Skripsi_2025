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

  const handleBrandClick = () => {
    window.location.reload();
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin':  return 'Administrator';
      case 'doctor': return 'Doctor';
      case 'staff':  return 'Medical Staff';
      default:       return 'User';
    }
  };

  const getRoleIcon = (role: string) => {
    const baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
    switch (role) {
      case 'admin':  return `${baseUrl}/static/admin.png`;
      case 'doctor': return `${baseUrl}/static/dokter.png`;
      case 'staff':  return `${baseUrl}/static/staff.png`;
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
        <div
          className="stegoshield-navbar-brand"
          onClick={handleBrandClick}
          style={{ cursor: 'pointer' }}
        >
          <div className="stegoshield-navbar-brand-icon">
            <img
              src={`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/static/logo.png`}
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
              src={`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/static/flag.png`}
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

        <div className="stegoshield-navbar-admin-wrapper">
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
          <button
            onClick={handleLogout}
            className="stegoshield-navbar-btn-power"
            title="Logout"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;