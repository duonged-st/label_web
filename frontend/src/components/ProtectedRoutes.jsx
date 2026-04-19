import React from 'react';
import { Navigate } from 'react-router-dom';
function parseJwt(token) {
  try {
    const base64 = token.split('.')[1];
    if(!base64) return null;
    const payload = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch (e) {
    console.error('Lỗi khi phân tích token:', e);
    return null;
  }
}

function isTokenExpired(payload) {
  if (!payload || !payload.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp;
}

export default function ProtectedRoute({ children, adminOnly = false }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  const payload = parseJwt(token);
  
  if (!payload || isTokenExpired(payload)) {
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    localStorage.removeItem('user');
    return <Navigate to="/login" replace />;
  }
  
  if (adminOnly) {
    const roleFromStorage = String(localStorage.getItem('userRole') || '').toLowerCase();
    const roleFromToken = String(payload.role || 'user').toLowerCase();
    const finalRole = roleFromStorage || roleFromToken;
    if (finalRole !== 'admin') {
      return <Navigate to="/dashboard" replace />;
    }
  }
  return children;
}