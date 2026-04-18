import React from 'react';
import { Navigate } from 'react-router-dom';

interface Props {
  children: React.ReactElement;
  role: string;
}

const PrivateRoute = ({ children, role }: Props) => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!user.user_id || user.role !== role) return <Navigate to="/" />;
  return children;
};

export default PrivateRoute;