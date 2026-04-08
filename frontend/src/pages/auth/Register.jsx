import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Paper, Link } from '@mui/material';
export default function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const handleRegister = async (e) => {
    e.preventDefault();
    // 1. Kiểm tra nhanh tại Frontend
    if (!username || !password || !confirmPassword) {
      return alert('Vui lòng nhập đầy đủ thông tin!');
    }
    if (password !== confirmPassword) {
      return alert('Mật khẩu xác nhận không khớp!');
    }
    try {
      // 2. Gọi API đăng ký 
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        alert('Đăng ký thành công! Giờ bạn có thể đăng nhập.');
        // Chuyển hướng sang trang login (Ví dụ: window.location.href = '/login')
      } else {
        alert(data.message || 'Đăng ký thất bại!');
      }
    } catch (error) {
      console.error('Lỗi kết nối:', error);
      alert('Không thể kết nối đến server!');
    }
  };
  return (
    <Box 
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="#f0f2f5"
    >
      <Paper elevation={3} sx={{ padding: 4, width: 350 }}>
        <Typography variant="h5" align="center" gutterBottom sx={{ fontWeight: 'bold', color: '#1976d2' }}>
          Tạo Tài Khoản
        </Typography>
        <form onSubmit={handleRegister}>
          <TextField
            label="Tên đăng nhập"
            variant="outlined"
            fullWidth
            margin="normal"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            label="Mật khẩu"
            variant="outlined"
            fullWidth
            margin="normal"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="Xác nhận mật khẩu"
            variant="outlined"
            fullWidth
            margin="normal"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          
          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            sx={{ mt: 3, mb: 2, py: 1.2, fontWeight: 'bold' }}
          >
            Đăng Ký Ngay
          </Button>
        </form>
        <Box textAlign="center">
          <Typography variant="body2">
            Đã có tài khoản?{' '}
            <Link href="/login" underline="hover" sx={{ fontWeight: 'bold' }}>
              Đăng nhập tại đây
            </Link>
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}