const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Image = require('../models/Image');
const router = express.Router();
const minio = require('minio');
const minioClient = new minio.Client({
  endPoint: 'minio',
  port: 9000,
  useSSL: false,
  accessKey: 'admin',
  secretKey: 'admin123'
});

// Đảm bảo bucket 'originals' tồn tại và cho phép public read
(async () => {
  try {
    const exists = await minioClient.bucketExists('originals');
    if (!exists) {
      await minioClient.makeBucket('originals');
      console.log('Đã tạo bucket "originals" trên MinIO');
    }
    // Set policy cho phép đọc public (để nginx proxy có thể truy cập ảnh)
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: ['arn:aws:s3:::originals/*']
      }]
    });
    await minioClient.setBucketPolicy('originals', policy);
  } catch (err) {
    console.error('Lỗi khởi tạo MinIO bucket:', err);
  }
})();
// 1. Cấu hình Multer để xác định nơi lưu và cách đặt tên file
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
router.post('/upload', upload.array('images', 1000), async (req, res) => {
  try {
    const files = req.files;
    const { projectId } = req.body; // Nhận ID của danh mục từ request
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất 1 ảnh!' });
    }
    if (!projectId) {
      return res.status(400).json({ message: 'Vui lòng chọn danh mục!' });
    }
    // 3. Xử lý mảng dữ liệu để chuẩn bị lưu vào MongoDB
    const imageDocs = await Promise.all(files.map(async (file) => {
      // Đặt tên file chống trùng lặp
      const minioFileName = uuidv4() + '-' + file.originalname;
      // Đẩy luồng dữ liệu lên MinIO
      await minioClient.putObject('originals', minioFileName, file.buffer, file.size);
      // Trả về object để lưu vào MongoDB
      return {
        filename: minioFileName,
        // Frontend truy cập ảnh qua nginx reverse proxy
        path: `/minio-storage/originals/${minioFileName}`,
        projectId: projectId,
        status: 'Chưa gán'
      };
    }));
    // 5. Lưu hàng loạt thông tin vào MongoDB
    await Image.insertMany(imageDocs);
    res.status(200).json({ 
      message: `Đã upload và lưu thông tin thành công ${files.length} ảnh lên MinIO!`,
      data: imageDocs 
    });
  } catch (error) {
    console.error("Lỗi chi tiết khi upload lên MinIO:", error);
    res.status(500).json({ message: 'Lỗi server khi upload ảnh' });
  }
});
module.exports = router;