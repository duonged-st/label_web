import React, { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom'; // Import Link của Router
import { Box, Button, TextField, Typography, Paper, Link } from '@mui/material';
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const Navigate = useNavigate();
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!username || !password) return alert('Vui lòng nhập đủ thông tin!');
    try {
      const response = await fetch('http://backend:5000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (response.ok) {
        alert('Đăng nhập thành công!');
        // Lưu token vào localStorage để dùng cho các request gán nhãn sau này
        localStorage.setItem('token', data.token);
        // Chuyển hướng người dùng vào trang dashboard
        Navigate('/dashboard');
      } else {
        alert(data.message); // Hiển thị lỗi từ backend
      }
    } catch (error) {
      console.error('Lỗi kết nối:', error);
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
    <Paper elevation={3} sx={{ padding: 4, width: 300 }}>
      <Typography variant="h5" align="center" gutterBottom>
        Đăng Nhập
      </Typography>
      <form onSubmit={handleLogin}>
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
        <Button
          type="submit"
          variant="contained"
          color="primary"
          fullWidth
          sx={{ mt: 2 }}
        >
          Đăng Nhập
        </Button>
           <Box textAlign="center" sx={{ mt: 2 }}>
            <Typography variant="body2">
              Chưa có tài khoản?{' '}
              <Link component={RouterLink} to="/register" underline="hover" sx={{ fontWeight: 'bold' }}>
              Đăng ký ngay
              </Link>
            </Typography>
            </Box>
      </form>
    </Paper>
  </Box>
);
}