const express = require('express');
const User = require('../models/User');
const router = express.Router();
// [GET] /api/users - Lấy danh sách tất cả người dùng
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')  // Loại bỏ trường password khi trả về danh sách user
      .populate('allowedProjects', 'name');   // Lấy kèm tên dự án mà user được phép truy cập
    res.status(200).json(users);
  } catch (error) {
    console.error("Lỗi lấy danh sách user:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [PUT] /api/users/:id - Cập nhật phân quyền cho 1 người dùng cụ thể
router.put('/users/:id', async (req, res) => {
  const userId = req.params.id; // Lấy ID của user từ trên URL
  const { role, allowedProjects } = req.body; // Hứng dữ liệu từ form sửa
  try {
    // Tìm User theo ID và cập nhật
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        role: role, 
        allowedProjects: allowedProjects // Ghi đè mảng ID dự án mới vào
      },
      { new: true } // Tùy chọn { new: true } để trả về document sau khi đã cập nhật
    ).select('-password');
    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }
    res.status(200).json({ 
      message: 'Cập nhật phân quyền thành công!', 
      user: updatedUser 
    });
  } catch (error) {
    console.error("Lỗi cập nhật user:", error);
    res.status(500).json({ message: 'Lỗi server khi cập nhật quyền' });
  }
});
module.exports = router;