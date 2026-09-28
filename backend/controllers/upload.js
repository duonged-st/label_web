const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const Image = require('../models/Image');
const Project = require('../models/Project');
const { verifyAdmin } = require('../middleware/authmiddleware');
const { minioClient, BUCKET_NAME } = require('../config/minio');
const { assignNewImagePartIds } = require('../utils/projectAccess');
const { ensureProjectImageParts } = require('../utils/imageParts');
const { withProjectWriteLock } = require('../utils/projectWriteLock');
const router = express.Router();

(async () => {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      console.log(`Đã tạo bucket "${BUCKET_NAME}" trên MinIO`);
    }
    const policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BUCKET_NAME}/*`]
      }]
    });
    await minioClient.setBucketPolicy(BUCKET_NAME, policy);
  } catch (err) {
    console.error('Lỗi khởi tạo MinIO bucket:', err);
  }
})();

const uploadTempDir = path.join(os.tmpdir(), 'label-web-upload-temp');
if (!fs.existsSync(uploadTempDir)) {
  fs.mkdirSync(uploadTempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadTempDir),
  filename: (req, file, cb) => {
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: Infinity,
    files: 12000
  }
});

const unlinkSafe = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Không thể xóa file tạm:', filePath, error.message);
    }
  }
};

const uploadFileWithRetry = async (file, projectId, maxRetries = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const minioFileName = uuidv4() + '-' + file.originalname;
      const fileStream = fs.createReadStream(file.path);
      await minioClient.putObject(BUCKET_NAME, minioFileName, fileStream, file.size);
      return {
        filename: file.originalname,
        storageKey: minioFileName,
        path: `/minio-storage/${BUCKET_NAME}/${minioFileName}`,
        projectId,
        status: 'Chưa gán'
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`Upload attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
};

const rollbackMinioUploads = async (filenames) => {
  if (!filenames || filenames.length === 0) return;
  const results = await Promise.allSettled(
    filenames.map((name) => minioClient.removeObject(BUCKET_NAME, name))
  );
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    console.warn(`[Rollback] Không xóa được ${failed.length}/${filenames.length} file trên MinIO.`);
  } else {
    console.log(`[Rollback] Đã xóa ${filenames.length} file khỏi MinIO do lỗi lưu DB.`);
  }
};

const uploadFilesInBatches = async (files, projectId, batchSize = 5) => {
  const results = [];
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(file => uploadFileWithRetry(file, projectId)));
    results.push(...batchResults);
  }
  return results;
};

router.post('/upload', verifyAdmin, upload.array('images'), async (req, res) => {
  const files = req.files || [];
  let uploadedFilenames = [];

  try {
    const { projectId } = req.body;
    if (files.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất 1 ảnh!' });
    }
    if (!projectId) {
      return res.status(400).json({ message: 'Vui lòng chọn danh mục!' });
    }
    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    }

    // Bước 1: Upload tất cả lên MinIO
    const imageDocs = await uploadFilesInBatches(files, projectId, 5);
    uploadedFilenames = imageDocs.map((doc) => doc.storageKey);

    // Bước 2: Lưu vào DB — nếu lỗi ở đây sẽ rollback MinIO
    try {
      await withProjectWriteLock(projectId, async () => {
        const currentProject = await Project.findById(projectId);
        if (!currentProject) throw new Error('Dự án đã bị xóa trong lúc tải ảnh.');
        // Preserve the current assignments of images uploaded before partId existed.
        await ensureProjectImageParts(currentProject);
        const existingImages = await Image.find({ projectId }).select('partId').lean();
        const { partIds, lastPartNumber } = assignNewImagePartIds(currentProject, existingImages, imageDocs.length);
        imageDocs.forEach((doc, index) => { doc.partId = partIds[index]; });
        await Project.updateOne({ _id: projectId }, { $max: { partSequence: lastPartNumber } });
        await Image.insertMany(imageDocs);
      });
    } catch (dbError) {
      console.error('Lỗi lưu DB sau khi upload MinIO, đang rollback...', dbError.message);
      await rollbackMinioUploads(uploadedFilenames);
      throw dbError;
    }

    // Bước 3: Dọn file tạm
    await Promise.all(files.map((file) => unlinkSafe(file.path)));

    res.status(200).json({
      message: `Đã upload và lưu thông tin thành công ${files.length} ảnh lên MinIO!`,
      data: imageDocs
    });
  } catch (error) {
    console.error('Lỗi chi tiết khi upload lên MinIO:', error);
    await Promise.all(files.map((file) => unlinkSafe(file.path)));
    res.status(500).json({ message: 'Lỗi server khi upload ảnh' });
  }
});

module.exports = router;
