const express = require('express');
const Evaluation = require('../models/Evaluation');
const router = express.Router();
// [GET] /api/export/:projectId - Xuất dữ liệu của một bộ dữ liệu cụ thể
router.get('/export/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    // Lấy toàn bộ lịch sử gán nhãn của Project này, móc nối thêm tên file ảnh
    const data = await Evaluation.find({ projectId })
      .populate('imageId', 'filename path') // Chỉ lấy tên file và đường dẫn
      .populate('userId', 'username') // Lấy tên người đã gán nhãn 
      .select('finalLabels evaluatedAt'); // Lấy nhãn cuối cùng và thời gian gán
    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'Bộ dữ liệu này chưa có ảnh nào được gán nhãn!' });
    }
    // Định dạng lại dữ liệu
    const exportData = data.map(item => ({
      image: item.imageId.filename,
      labels: item.finalLabels,
      annotator: item.userId.username,
      timestamp: item.evaluatedAt
    }));
    // Thiết lập header để trình duyệt hiểu đây là file JSON cần tải về
    res.setHeader('Content-disposition', `attachment; filename=dataset_${projectId}.json`);
    res.setHeader('Content-type', 'application/json');
    res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error("Lỗi khi xuất dữ liệu:", error);
    res.status(500).json({ message: 'Lỗi server khi xuất file' });
  }
});
module.exports = router;