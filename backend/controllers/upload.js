const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const mongoose = require('mongoose');
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

const uploadFileWithRetry = async (file, projectId, storageKey, maxRetries = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const fileStream = fs.createReadStream(file.path);
    try {
      await minioClient.putObject(BUCKET_NAME, storageKey, fileStream, file.size);
      return {
        filename: file.originalname,
        storageKey,
        path: `/minio-storage/${BUCKET_NAME}/${storageKey}`,
        projectId,
        status: 'Chưa gán'
      };
    } catch (error) {
      fileStream.destroy();
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

const removeObjectWithRetry = async (objectName, maxRetries = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await minioClient.removeObject(BUCKET_NAME, objectName);
      return;
    } catch (error) {
      if (error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404)) return;
      lastError = error;
      if (attempt < maxRetries) await new Promise(resolve => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError;
};

const rollbackMinioUploads = async (filenames) => {
  if (!filenames || filenames.length === 0) return;
  let failedCount = 0;
  for (let index = 0; index < filenames.length; index += 25) {
    const batch = filenames.slice(index, index + 25);
    const results = await Promise.allSettled(batch.map((name) => removeObjectWithRetry(name)));
    failedCount += results.filter((result) => result.status === 'rejected').length;
  }
  if (failedCount > 0) {
    console.warn(`[Rollback] Không xóa được ${failedCount}/${filenames.length} file trên MinIO.`);
  } else {
    console.log(`[Rollback] Đã xóa ${filenames.length} file khỏi MinIO do lỗi lưu DB.`);
  }
};

const uploadFilesInBatches = async (uploadAttempts, projectId, startedKeys, batchSize = 5) => {
  const results = [];
  for (let i = 0; i < uploadAttempts.length; i += batchSize) {
    const batch = uploadAttempts.slice(i, i + batchSize);
    // Wait for every started upload before rolling back any object in this batch.
    const batchResults = await Promise.allSettled(
      batch.map(({ file, storageKey }) => {
        startedKeys.push(storageKey);
        return uploadFileWithRetry(file, projectId, storageKey);
      })
    );
    const failed = batchResults.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
    results.push(...batchResults.map((result) => result.value));
  }
  return results;
};

const rollbackDatabaseInsert = async (imageDocs) => {
  const ids = imageDocs.map((doc) => doc._id);
  try {
    // insertMany can write some documents before throwing. Remove those documents
    // before removing their objects, so no visible DB record points at a deleted file.
    try {
      await Image.deleteMany({ _id: { $in: ids } });
    } catch (deleteError) {
      console.error('[Rollback] Không xóa hết bản ghi ảnh đã lưu:', deleteError);
    }
    const remaining = await Image.find({ _id: { $in: ids } }).select('storageKey').lean();
    const referencedKeys = new Set(remaining.map((image) => image.storageKey));
    const unreferencedKeys = imageDocs
      .filter((doc) => !referencedKeys.has(doc.storageKey))
      .map((doc) => doc.storageKey);
    await rollbackMinioUploads(unreferencedKeys);
  } catch (cleanupError) {
    // When MongoDB cannot confirm what was written, keep objects for recovery.
    // Removing them here could leave a persisted image with no file.
    console.error('[Rollback] Không xác nhận được bản ghi ảnh đã lưu:', cleanupError);
  }
};

router.post('/upload', verifyAdmin, upload.array('images'), async (req, res) => {
  const files = req.files || [];

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
    const uploadAttempts = files.map((file) => ({
      file,
      storageKey: `${uuidv4()}-${file.originalname}`
    }));
    const startedKeys = [];
    let imageDocs;
    try {
      imageDocs = await uploadFilesInBatches(uploadAttempts, projectId, startedKeys, 5);
    } catch (uploadError) {
      // Includes keys whose putObject failed after MinIO had already stored them.
      await rollbackMinioUploads(startedKeys);
      throw uploadError;
    }
    imageDocs.forEach((doc) => { doc._id = new mongoose.Types.ObjectId(); });

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
      await rollbackDatabaseInsert(imageDocs);
      throw dbError;
    }

    res.status(200).json({
      message: `Đã upload và lưu thông tin thành công ${files.length} ảnh lên MinIO!`,
      data: imageDocs
    });
  } catch (error) {
    console.error('Lỗi chi tiết khi upload lên MinIO:', error);
    res.status(500).json({ message: 'Lỗi server khi upload ảnh' });
  } finally {
    await Promise.all(files.map((file) => unlinkSafe(file.path)));
  }
});

module.exports = router;
