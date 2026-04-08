const express = require('express');
const Evaluation = require('../models/Evaluation');
const Image = require('../models/Image');
const router = express.Router();
router.post('/evaluate', async (req, res) => {
  const { imageId, projectId, finalLabels } = req.body;
  const userId = req.user.userId; // Lấy userId từ token đã giải mã trong middleware xác thực 
  try {
    if (!Array.isArray(finalLabels) || finalLabels.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn nhãn!' });
    }
    // Lưu vào CSDL
    const newEvaluation = new Evaluation({
      imageId,
      userId,
      projectId,
      finalLabels
    });
    await newEvaluation.save();
    await Image.findByIdAndUpdate(imageId, { status: 'Đã gán' });
    res.status(200).json({ message: 'Lưu các nhãn thành công!' });
  } catch (error) {
    console.error("Lỗi khi gán nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi gán nhãn' });
  }
});
// [DELETE] /api/evaluate/:imageId - Reset (Xóa) nhãn đã gán của một ảnh
router.delete('/evaluate/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params; // Lấy ID ảnh từ trên URL
    // 1. Tìm và xóa toàn bộ lịch sử gán nhãn của bức ảnh này trong bảng Evaluation
    const deletedEvaluation = await Evaluation.deleteMany({ imageId: imageId });
    if (deletedEvaluation.deletedCount === 0) {
      return res.status(404).json({ message: 'Ảnh này chưa được gán nhãn!' });
    }
    // 2. Cập nhật trạng thái ảnh về lại "Chưa gán"
    await Image.findByIdAndUpdate(imageId, { status: 'Chưa gán' });
    res.status(200).json({ message: 'Reset thành công' });
  } catch (error) {
    console.error("Lỗi khi reset nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi reset nhãn' });
  }
});
module.exports = router;