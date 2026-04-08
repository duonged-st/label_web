const fs = require('fs');
const path = require('path');
const express = require('express');
const Image = require('../models/Image');
const Evaluation = require('../models/Evaluation');
const router = express.Router();
// [GET] /api/images - Lấy danh sách ảnh 
router.get('/images', async (req, res) => {
  try {
    const { projectId, status, page = 1, limit = 20 } = req.query;
    let query = {};
    // 1. Lọc theo Dự án 
    if (projectId) query.projectId = projectId;
    // 2. Lọc theo Trạng thái 
    if (status) query.status = status;
    // 3. Thực hiện truy vấn với phân trang
    const images = await Image.find(query)
      .populate('projectId', 'name') // Lấy kèm tên dự án để hiển thị lên thẻ ảnh
      .limit(limit * 1) // Giới hạn số ảnh trên 1 trang
      .skip((page - 1) * limit) // Bỏ qua ảnh của các trang trước
      .sort({ uploadDate: -1 });
    // Đếm tổng số ảnh để tính toán số trang
    const total = await Image.countDocuments(query);
    res.status(200).json({
      totalImages: total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      images
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách ảnh:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [DELETE] /api/images/:id - Xóa 1 bức ảnh
router.delete('/images/:id', async (req, res) => {
  try {
    const imageId = req.params.id;
    // 1. Tìm xem ảnh có tồn tại không
    const image = await Image.findById(imageId);
    if (!image) return res.status(404).json({ message: 'Không tìm thấy ảnh!' });
    // 2. Xóa file vật lý trong thư mục uploads
    const filePath = path.join(__dirname, '..', image.path); 
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Lệnh chém bay file khỏi ổ cứng
    }
    // 3. Xóa thông tin ảnh trong Database (bảng Images)
    await Image.findByIdAndDelete(imageId);
    // 4. Dọn rác: Xóa luôn tất cả các kết quả gán nhãn liên quan đến ảnh này (nếu có)
    await Evaluation.deleteMany({ imageId: imageId });
    res.status(200).json({ message: 'Đã xóa ảnh và dọn dẹp dữ liệu thành công!' });
  } catch (error) {
    console.error("Lỗi xóa ảnh:", error);
    res.status(500).json({ message: 'Lỗi server khi xóa ảnh' });
  }
});
module.exports = router;