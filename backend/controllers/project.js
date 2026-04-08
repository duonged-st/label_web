const express = require('express');
const Project = require('../models/Project');
const router = express.Router();
// [POST] /api/projects - Tạo dự án mới
router.post('/projects', async (req, res) => {
  const { name, description, labels } = req.body;
  try {
    // Kiểm tra xem tên dự án đã tồn tại chưa
    const existingProject = await Project.findOne({ name });
    if (existingProject) {
      return res.status(400).json({ message: 'Tên bộ dữ liệu này đã tồn tại!' });
    }
    // Tạo dự án mới
    const newProject = new Project({
      name,
      description,
      labels: labels || [] // Nếu không truyền labels thì mặc định là mảng rỗng
    });
    await newProject.save();
    res.status(201).json({ 
      message: 'Tạo bộ dữ liệu thành công!', 
      project: newProject 
    });
  } catch (error) {
    console.error("Lỗi khi tạo project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [GET] /api/projects - Lấy danh sách tất cả dự án
router.get('/projects', async (req, res) => {
  try {
    // Lấy toàn bộ project từ DB, sắp xếp theo ngày tạo mới nhất
    const projects = await Project.find().sort({ createdAt: -1 });
    res.status(200).json(projects);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [PUT] /api/projects/:id - Sửa thông tin dự án
router.put('/projects/:id', async (req, res) => {
  try {
    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id, 
      req.body, // Lấy cục data mới gửi lên đè vào
      { new: true } // Trả về data sau khi đã sửa
    );
    if (!updatedProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    res.status(200).json({ message: 'Cập nhật dự án thành công!', project: updatedProject });
  } catch (error) {
    console.error("Lỗi sửa project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [DELETE] /api/projects/:id - Xóa dự án
router.delete('/projects/:id', async (req, res) => {
  try {
    const deletedProject = await Project.findByIdAndDelete(req.params.id);
    if (!deletedProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    res.status(200).json({ message: 'Đã xóa dự án thành công!' });
  } catch (error) {
    console.error("Lỗi xóa project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
module.exports = router;