import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, getCurrentUser } from '../api/auth';
import '../styles/Login.css';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const Login = () => {
  // --------------------------------------------------------------------------
  // Hooks
  // --------------------------------------------------------------------------
  const navigate = useNavigate();

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // --------------------------------------------------------------------------
  // Helper Functions
  // --------------------------------------------------------------------------
  const clearError = () => {
    if (error) setError('');
  };

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUsername(e.target.value);
    clearError();
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    clearError();
  };

  const handleTogglePasswordVisibility = () => {
    setShowPassword(prev => !prev);
  };

  const handleBrandClick = () => {
    window.location.reload();
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      const user = getCurrentUser();
      
      // Redirect based on user role
      if (user?.role === 'admin') {
        navigate('/admin');
      } else if (user?.role === 'staff') {
        navigate('/staff');
      } else if (user?.role === 'doctor') {
        navigate('/doctor');
      } else {
        setError('Invalid role. Please contact the administrator.');
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(detail || 'Incorrect username or password');
    } finally {
      setIsLoading(false);
    }
  };

  // --------------------------------------------------------------------------
  // Render Helpers
  // --------------------------------------------------------------------------
  const renderEyeIcon = () => {
    if (showPassword) {
      return (
        <svg 
          className="stegoshield-login-toggle-icon" 
          width="20" 
          height="20" 
          viewBox="0 0 24 24" 
          fill="none"
        >
          <path 
            d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" 
            stroke="#64748B" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
          <path 
            d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" 
            stroke="#64748B" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          />
          <path 
            d="M3 3L21 21" 
            stroke="#64748B" 
            strokeWidth="1.5" 
            strokeLinecap="round"
          />
        </svg>
      );
    }
    
    return (
      <svg 
        className="stegoshield-login-toggle-icon" 
        width="20" 
        height="20" 
        viewBox="0 0 24 24" 
        fill="none"
      >
        <path 
          d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" 
          stroke="#64748B" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
        <path 
          d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" 
          stroke="#64748B" 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  // --------------------------------------------------------------------------
  // Main Render
  // --------------------------------------------------------------------------
  return (
    <div className="stegoshield-login-wrapper">
      {/* Floating Background Shapes */}
      <div className="stegoshield-login-floating-shape stegoshield-login-shape-1" />
      <div className="stegoshield-login-floating-shape stegoshield-login-shape-2" />
      <div className="stegoshield-login-floating-shape stegoshield-login-shape-3" />
      <div className="stegoshield-login-floating-shape stegoshield-login-shape-4" />

      {/* Medical Icons Decoration */}
      <div className="stegoshield-login-medical-icon stegoshield-login-icon-1">⚕</div>
      <div className="stegoshield-login-medical-icon stegoshield-login-icon-2">🏥</div>
      <div className="stegoshield-login-medical-icon stegoshield-login-icon-3">❤</div>

      {/* Login Container */}
      <div className="stegoshield-login-container">
        {/* Logo and Brand Section */}
        <div
          className="stegoshield-login-logo-container"
          onClick={handleBrandClick}
          style={{ cursor: 'pointer' }}
        >
          <div className="stegoshield-login-logo-wrapper">
            <img
              src={`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/static/logo.png`}
              alt="StegoShield Logo"
              className="stegoshield-login-logo-image"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <h1 className="stegoshield-login-system-title">StegoShield</h1>
          <p className="stegoshield-login-system-subtitle">
            Medical Data Protection System
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="stegoshield-login-form">
          {/* Username Field */}
          <div className="stegoshield-login-form-group">
            <label 
              htmlFor="stegoshield-login-username" 
              className="stegoshield-login-form-label"
            >
              Username
            </label>
            <input
              id="stegoshield-login-username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={handleUsernameChange}
              className="stegoshield-login-input"
              autoComplete="username"
              disabled={isLoading}
              required
            />
          </div>

          {/* Password Field */}
          <div className="stegoshield-login-form-group">
            <label 
              htmlFor="stegoshield-login-password" 
              className="stegoshield-login-form-label"
            >
              Password
            </label>
            <div className="stegoshield-login-password-wrapper">
              <input
                id="stegoshield-login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={handlePasswordChange}
                className="stegoshield-login-input stegoshield-login-password-input"
                autoComplete="current-password"
                disabled={isLoading}
                required
              />
              <button
                type="button"
                className="stegoshield-login-password-toggle-btn"
                onClick={handleTogglePasswordVisibility}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
                disabled={isLoading}
              >
                {renderEyeIcon()}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="stegoshield-login-error-message">
              <span className="stegoshield-login-error-icon">⚠</span>
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className={`stegoshield-login-button${isLoading ? ' stegoshield-login-button-loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <span className="stegoshield-login-spinner" />
                Processing...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="stegoshield-login-footer">
          <p className="stegoshield-login-footer-text">
            © 2026 StegoShield. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;