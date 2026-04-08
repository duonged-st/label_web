import React from 'react';
import { Navigate } from 'react-router-dom';
export default function ProtectedRoute({ children }) {
  // 1. Lục ví xem có thẻ Token không
  const token = localStorage.getItem('token');
  // 2. Nếu không có token -> Lập tức đá văng về trang login
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  // 3. Có token -> Cho phép truy cập vào trang con
  return children;
}