const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const minio = require('minio');
const AiModel = require('../models/AiModel');
const Project = require('../models/Project');
const Image = require('../models/Image');
const { verifyAdmin, verifyToken, normalizeRole, getProjectPermissionEntry } = require('../middleware/authmiddleware');
const { getImagePartMap, getAccessibleProjectIds } = require('../utils/projectAccess');
const { getImageObjectName } = require('../utils/imageFile');

// Loại file được phép upload cho AI model
const ACCEPTED_MODEL_EXTENSIONS = ['.pt', '.pth', '.onnx', '.pb', '.h5', '.keras', '.pkl', '.joblib', '.npy', '.safetensors', '.bin'];

const router = express.Router();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://ai-service:5001';
const AI_SERVICE_TOKEN = String(process.env.AI_SERVICE_TOKEN || '').trim();
const MINIO_BUCKET = String(process.env.AI_MODEL_BUCKET || 'aimodels').trim() || 'aimodels';
const normalizeMinioEndpoint = (value) => {
  const raw = String(value || 'minio').trim();

  try {
    const parsedUrl = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `http://${raw}`);
    const hostname = parsedUrl.hostname || 'minio';
    const port = parsedUrl.port || '9000';
    return {
      endPoint: hostname,
      port: Number(port) || 9000,
      useSSL: parsedUrl.protocol === 'https:'
    };
  } catch (error) {
    return {
      endPoint: raw.split('/')[0].split(':')[0] || 'minio',
      port: 9000,
      useSSL: false
    };
  }
};

const minioConfig = normalizeMinioEndpoint(process.env.MINIO_ENDPOINT || 'minio');
const MINIO_ENDPOINT = minioConfig.endPoint;
const MINIO_PORT = Number(process.env.MINIO_PORT || minioConfig.port || 9000);
const MINIO_ACCESS_KEY = String(process.env.MINIO_ACCESS_KEY || '').trim() || 'admin';
const MINIO_SECRET_KEY = String(process.env.MINIO_SECRET_KEY || '').trim() || 'admin123';
const MINIO_SECURE = String(process.env.MINIO_SECURE || minioConfig.useSSL || false).toLowerCase() === 'true' || Boolean(minioConfig.useSSL);

const minioClient = new minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_SECURE,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

const tempDir = path.join(os.tmpdir(), 'label-web-aimodel-temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => {
    const uniquePrefix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniquePrefix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: Infinity,
    files: 2
  }
});

const unlinkSafe = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Không thể xóa file tạm model:', filePath, error.message);
    }
  }
};

const validateModelFileExtension = (fileName) => {
  const lowerName = String(fileName || '').toLowerCase();
  const isValid = ACCEPTED_MODEL_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  return {
    isValid,
    fileName: String(fileName || ''),
    acceptedExtensions: ACCEPTED_MODEL_EXTENSIONS
  };
};

const ensureBucket = async () => {
  try {
    const exists = await minioClient.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET);
    }
  } catch (error) {
    console.error('Lỗi khởi tạo bucket AI model:', error);
  }
};

const putObjectSafe = async (objectName, filePath, fileSize) => {
  await ensureBucket();
  const fileStream = fs.createReadStream(filePath);
  await minioClient.putObject(MINIO_BUCKET, objectName, fileStream, fileSize);
};

const callAiService = async (endpoint, payload, options = {}) => {
  if (AI_SERVICE_TOKEN.length < 32) {
    return { ok: false, status: 503, data: { message: 'AI service chưa được cấu hình khóa truy cập an toàn.' } };
  }
  const method = String(options.method || 'POST').toUpperCase();
  // Try to use global fetch first, otherwise try dynamic import of node-fetch,
  // and as a last resort try axios (if installed).
  let fetchImpl = typeof global.fetch === 'function' ? global.fetch : null;

  if (!fetchImpl) {
    try {
      const nodeFetch = await import('node-fetch');
      fetchImpl = nodeFetch.default || nodeFetch;
    } catch (err) {
      try {
        // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
        const axios = require('axios');
        const url = `${AI_SERVICE_URL}${endpoint}`;
        const resp = method === 'GET'
          ? await axios.get(url, { headers: { 'X-AI-Service-Token': AI_SERVICE_TOKEN } })
          : await axios.post(url, payload, { headers: { 'Content-Type': 'application/json', 'X-AI-Service-Token': AI_SERVICE_TOKEN } });
        return { ok: true, status: resp.status, data: resp.data };
      } catch (err2) {
        console.error('No HTTP client available to call AI service:', err2 && err2.message ? err2.message : err2);
        return { ok: false, status: 500, data: { message: 'No HTTP client available to call AI service' } };
      }
    }
  }

  try {
    const requestOptions = {
      method,
      headers: { 'Content-Type': 'application/json', 'X-AI-Service-Token': AI_SERVICE_TOKEN },
    };

    if (method !== 'GET') {
      requestOptions.body = JSON.stringify(payload);
    }

    const response = await fetchImpl(`${AI_SERVICE_URL}${endpoint}`, requestOptions);

    let data = null;
    try {
      // node-fetch / global fetch response
      data = await response.json();
    } catch (error) {
      data = { message: 'AI service response is not valid JSON' };
    }

    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    console.error('Lỗi gọi AI service:', error && error.message ? error.message : error);
    return { ok: false, status: 500, data: { message: 'Lỗi khi gọi AI service', error: error ? error.message : String(error) } };
  }
};

// Upload model file lên MinIO và lưu metadata vào MongoDB.
router.post('/ai-models/upload', verifyAdmin, upload.fields([
  { name: 'modelFile', maxCount: 1 },
  { name: 'labelFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, dbVersion, description } = req.body;
    const modelFile = req.files && req.files['modelFile'] ? req.files['modelFile'][0] : null;
    const labelFile = req.files && req.files['labelFile'] ? req.files['labelFile'][0] : null;
    const file = modelFile;

    if (!name || !dbVersion) {
      if (modelFile) await unlinkSafe(modelFile.path);
      if (labelFile) await unlinkSafe(labelFile.path);
      return res.status(400).json({ message: 'Thiếu name hoặc dbVersion.' });
    }

    if (!file) {
      if (labelFile) await unlinkSafe(labelFile.path);
      return res.status(400).json({ message: 'Vui lòng chọn file model.' });
    }

    const { isValid } = validateModelFileExtension(file.originalname);
    if (!isValid) {
      await unlinkSafe(file.path);
      if (labelFile) await unlinkSafe(labelFile.path);
      return res.status(400).json({
        message: `Đuôi file không hợp lệ. Chỉ chấp nhận các đuôi: ${ACCEPTED_MODEL_EXTENSIONS.join(', ')}`
      });
    }

    let labelMap = null;
    if (labelFile) {
      try {
        const labelContent = fs.readFileSync(labelFile.path, 'utf8');
        const parsed = JSON.parse(labelContent);
        if (Array.isArray(parsed)) {
          labelMap = {};
          parsed.forEach((val, idx) => {
            labelMap[String(idx)] = String(val);
          });
        } else if (typeof parsed === 'object' && parsed !== null) {
          labelMap = {};
          for (const [k, v] of Object.entries(parsed)) {
            labelMap[String(k)] = String(v);
          }
        } else {
          throw new Error('File label.json phải là dạng Array hoặc Object.');
        }
      } catch (err) {
        if (modelFile) await unlinkSafe(modelFile.path);
        if (labelFile) await unlinkSafe(labelFile.path);
        return res.status(400).json({ message: 'Lỗi parse file label.json: ' + err.message });
      }
    }

    const minioPath = `${uuidv4()}-${file.originalname}`;

    try {
      await putObjectSafe(minioPath, file.path, file.size);

      if (labelMap) {
        const jsonMinioPath = path.parse(minioPath).name + '.json';
        const tempJsonPath = path.join(tempDir, `${uuidv4()}-normalized-label.json`);
        fs.writeFileSync(tempJsonPath, JSON.stringify(labelMap, null, 2), 'utf8');
        try {
          await putObjectSafe(jsonMinioPath, tempJsonPath, fs.statSync(tempJsonPath).size);
        } finally {
          await unlinkSafe(tempJsonPath);
        }
      }

      const created = await AiModel.create({
        name: String(name).trim(),
        dbVersion: String(dbVersion).trim(),
        minioPath,
        bucketName: MINIO_BUCKET,
        originalFileName: file.originalname,
        fileSize: file.size,
        description: description ? String(description).trim() : '',
        labelMap
      });

      return res.status(201).json({ message: 'Upload AI model thành công!', aiModel: created });
    } finally {
      if (file) await unlinkSafe(file.path);
      if (labelFile) await unlinkSafe(labelFile.path);
    }
  } catch (error) {
    console.error('Lỗi upload ai model:', error);
    return res.status(500).json({ message: 'Lỗi server khi upload ai model', error: error.message });
  }
});

router.get('/ai-models', verifyAdmin, async (req, res) => {
  try {
    const aiModels = await AiModel.find().sort({ createdAt: -1 });
    return res.status(200).json(aiModels);
  } catch (error) {
    console.error('Lỗi lấy danh sách ai model:', error);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

router.get('/ai-models/:id/status', verifyToken, async (req, res) => {
  try {
    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ loaded: false, message: 'Không tìm thấy AI model.' });
    }

    if (normalizeRole(req.user.role) !== 'admin') {
      const accessibleProjects = await Project.find({
        aiModelId: aiModel._id,
        _id: { $in: getAccessibleProjectIds(req.user) }
      }).select('_id');
      const hasAssignedPart = accessibleProjects.some((project) => {
        const permission = getProjectPermissionEntry(req.user, project._id);
        return Array.isArray(permission?.partIds) && permission.partIds.length > 0;
      });
      if (!hasAssignedPart) {
        return res.status(403).json({ loaded: false, message: 'Bạn không có quyền xem model này.' });
      }
    }

    const result = await callAiService('/health', undefined, { method: 'GET' });
    if (!result.ok) {
      return res.status(result.status).json({
        loaded: false,
        message: result.data?.message || 'Không thể kiểm tra trạng thái AI service.'
      });
    }

    return res.status(200).json({
      id: String(aiModel._id),
      loaded: Boolean(result.data?.models?.[aiModel.minioPath]),
      activeSlots: result.data?.active_slots || 0
    });
  } catch (error) {
    console.error('Lỗi kiểm tra trạng thái ai model:', error);
    return res.status(500).json({ loaded: false, message: 'Lỗi server' });
  }
});

router.get('/ai-models/:id', verifyAdmin, async (req, res) => {
  try {
    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }
    return res.status(200).json(aiModel);
  } catch (error) {
    console.error('Lỗi lấy ai model:', error);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

router.put('/ai-models/:id', verifyAdmin, async (req, res) => {
  try {
    const { name, dbVersion, description, labelMap } = req.body;
    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }

    const nextBody = {};

    if (name !== undefined) nextBody.name = String(name).trim();
    if (dbVersion !== undefined) nextBody.dbVersion = String(dbVersion).trim();
    if (description !== undefined) nextBody.description = String(description).trim();

    if (labelMap !== undefined) {
      if (labelMap === null) {
        nextBody.labelMap = null;
        try {
          const jsonMinioPath = path.parse(aiModel.minioPath).name + '.json';
          await minioClient.removeObject(aiModel.bucketName || MINIO_BUCKET, jsonMinioPath);
        } catch (error) {
          if (!(error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404))) {
            console.error('Lỗi xóa companion label trên MinIO:', error);
          }
        }
      } else if (typeof labelMap === 'object') {
        const normalized = {};
        for (const [k, v] of Object.entries(labelMap)) {
          normalized[String(k)] = String(v);
        }
        nextBody.labelMap = normalized;

        const jsonMinioPath = path.parse(aiModel.minioPath).name + '.json';
        const tempJsonPath = path.join(tempDir, `${uuidv4()}-normalized-label.json`);
        fs.writeFileSync(tempJsonPath, JSON.stringify(normalized, null, 2), 'utf8');
        try {
          await putObjectSafe(jsonMinioPath, tempJsonPath, fs.statSync(tempJsonPath).size);
        } finally {
          await unlinkSafe(tempJsonPath);
        }
      } else {
        return res.status(400).json({ message: 'labelMap phải là một JSON Object.' });
      }
    }

    const updated = await AiModel.findByIdAndUpdate(req.params.id, nextBody, { new: true });
    return res.status(200).json({ message: 'Cập nhật AI model thành công!', aiModel: updated });
  } catch (error) {
    console.error('Lỗi cập nhật ai model:', error);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật AI model', error: error.message });
  }
});

router.delete('/ai-models/:id', verifyAdmin, async (req, res) => {
  try {
    const deleted = await AiModel.findById(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }

    try {
      await minioClient.removeObject(deleted.bucketName || MINIO_BUCKET, deleted.minioPath);
    } catch (error) {
      if (!(error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404))) {
        throw error;
      }
    }

    try {
      const jsonMinioPath = path.parse(deleted.minioPath).name + '.json';
      await minioClient.removeObject(deleted.bucketName || MINIO_BUCKET, jsonMinioPath);
    } catch (error) {
      if (!(error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404))) {
        console.error('Lỗi xóa companion label file trên MinIO:', error);
      }
    }

    await Project.updateMany(
      { aiModelId: deleted._id },
      { $set: { aiModelId: null } }
    );

    await AiModel.deleteOne({ _id: deleted._id });
    return res.status(200).json({ message: 'Đã xóa AI model thành công.' });
  } catch (error) {
    console.error('Lỗi xóa ai model:', error);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

// Gọi AI service Flask để load model vào RAM/VRAM.
router.post('/ai-models/:id/load', verifyAdmin, async (req, res) => {
  try {
    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }

    const result = await callAiService('/load-model', { minio_path: aiModel.minioPath });
    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error('Lỗi gọi load model:', error);
    return res.status(500).json({ message: 'Lỗi server khi gọi AI service', error: error.message });
  }
});

// Gọi AI service Flask để unload model khỏi RAM/VRAM.
router.post('/ai-models/:id/unload', verifyAdmin, async (req, res) => {
  try {
    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }

    const result = await callAiService('/unload-model', { minio_path: aiModel.minioPath });
    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error('Lỗi gọi unload model:', error);
    return res.status(500).json({ message: 'Lỗi server khi gọi AI service', error: error.message });
  }
});

// Gọi AI service Flask để predict nhãn cho ảnh.
router.post('/ai-models/:id/predict', verifyToken, async (req, res) => {
  try {
    const { imageId } = req.body || {};
    if (!imageId) {
      return res.status(400).json({ message: 'Thiếu imageId.' });
    }

    const aiModel = await AiModel.findById(req.params.id);
    if (!aiModel) {
      return res.status(404).json({ message: 'Không tìm thấy AI model.' });
    }

    const image = await Image.findById(imageId);
    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh.' });
    }

    const project = await Project.findOne({ _id: image.projectId, aiModelId: aiModel._id })
      .select('labels splitPercent splitRatios imagesPerPart');
    if (!project) {
      return res.status(403).json({ message: 'Model không được gán cho dự án của ảnh này.' });
    }

    if (normalizeRole(req.user.role) !== 'admin') {
      const permission = getProjectPermissionEntry(req.user, project._id);
      if (!Array.isArray(permission?.partIds) || permission.partIds.length === 0) {
        return res.status(403).json({ message: 'Bạn không có quyền dự đoán cho ảnh này.' });
      }

      let imagePartId = image.partId ? String(image.partId) : '';
      if (!imagePartId) {
        // Older images without a persisted part assignment still use the legacy mapping.
        const projectImages = await Image.find({ projectId: project._id })
          .select('_id uploadDate partId');
        const { map } = getImagePartMap(
          projectImages, project.splitRatios || [], project.splitPercent || 100, project.imagesPerPart || null
        );
        imagePartId = String(map.get(String(image._id))?.partId || '');
      }
      if (!permission.partIds.some((partId) => String(partId) === imagePartId)) {
        return res.status(403).json({ message: 'Bạn không có quyền dự đoán cho ảnh này.' });
      }
    }

    const imageKey = getImageObjectName(image);
    if (!imageKey) {
      return res.status(404).json({ message: 'Không tìm thấy tệp ảnh.' });
    }

    const result = await callAiService('/predict', {
      minio_path: aiModel.minioPath,
      image_key: imageKey,
      // Always use the labels of the image's project, never client-supplied labels.
      class_names: Array.isArray(project.labels) && project.labels.length > 0
        ? project.labels
        : undefined,
    });

    return res.status(result.status).json(result.data);
  } catch (error) {
    console.error('Lỗi gọi predict model:', error);
    if (error?.name === 'CastError') {
      return res.status(400).json({ message: 'imageId hoặc model id không hợp lệ.' });
    }
    return res.status(500).json({ message: 'Lỗi server khi gọi AI service', error: error.message });
  }
});

// Gán AI model cho project.
router.put('/projects/:id/ai-model', verifyAdmin, async (req, res) => {
  try {
    const { aiModelId } = req.body;
    const projectId = req.params.id;

    if (aiModelId) {
      const aiModel = await AiModel.findById(aiModelId);
      if (!aiModel) {
        return res.status(404).json({ message: 'Không tìm thấy AI model.' });
      }
    }

    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      { aiModelId: aiModelId || null },
      { new: true }
    ).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');

    if (!updatedProject) {
      return res.status(404).json({ message: 'Không tìm thấy dự án.' });
    }

    return res.status(200).json({ message: 'Đã gán AI model cho dự án.', project: updatedProject });
  } catch (error) {
    console.error('Lỗi gán ai model cho project:', error);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});

module.exports = router;
