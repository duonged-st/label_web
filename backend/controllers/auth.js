const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // 1. Tìm user trong database
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
    // 2. So sánh mật khẩu đã nhập với mật khẩu đã mã hóa trong database
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
    // 3. Tạo JWT Token
    const token = jwt.sign(
      { userId: user._id, role: user.role }, 
      process.env.JWT_SECRET || 'chuoi_bao_mat_cua_ban',
      { expiresIn: '1h' }
    );
    // 4. Trả kết quả về cho Frontend
    res.json({ message: 'Đăng nhập thành công', token });
  } catch (error) {
    console.error("Chi tiết lỗi:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [POST] /api/register - API Đăng ký tài khoản mới
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    // 1. Kiểm tra xem username này đã có ai đăng ký chưa
    let user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
    }
    // 2. Mã hóa mật khẩu (Hashing)
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    // 3. Tạo user mới và lưu vào database
    user = new User({
      username,
      password: hashedPassword
    });
    await user.save();
    res.status(201).json({ message: 'Tạo tài khoản thành công!' });
  } catch (error) { 
    console.error("Chi tiết lỗi:", error); 
    res.status(500).json({ message: 'Lỗi server' });
  }
});
module.exports = router;