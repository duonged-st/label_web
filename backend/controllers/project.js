const express = require('express');
const minio = require('minio');
const Project = require('../models/Project');
const AiModel = require('../models/AiModel');
const Image = require('../models/Image');
const Evaluation = require('../models/Evaluation');
const User = require('../models/User');
const { verifyAdmin, normalizeRole } = require('../middleware/authmiddleware');
const { getAccessibleProjectIds, buildProjectParts, normalizeSplitRatios } = require('../utils/projectAccess');
const router = express.Router();

const validateSplitRatios = (splitRatios) => {
  if (!Array.isArray(splitRatios) || splitRatios.length === 0) {
    return { valid: false, message: 'Vui lòng cấu hình ít nhất một phần cho dự án.' };
  }

  const normalized = splitRatios.map((ratio) => Number(ratio));
  const invalid = normalized.find((ratio) => !Number.isInteger(ratio) || ratio < 1 || ratio > 100);
  if (invalid !== undefined) {
    return { valid: false, message: 'Mỗi phần phải từ 1% đến 100%.' };
  }

  const sum = normalized.reduce((total, ratio) => total + ratio, 0);
  if (sum !== 100) {
    return { valid: false, message: 'Tổng tỉ lệ các phần phải bằng 100%.' };
  }

  return { valid: true, ratios: normalized };
};

const minioClient = new minio.Client({
  endPoint: 'minio',
  port: 9000,
  useSSL: false,
  accessKey: 'admin',
  secretKey: 'admin123'
});

const BUCKET_NAME = 'originals';

const resolveObjectName = (image) => {
  if (image.filename) return image.filename;
  if (!image.path) return null;
  const parts = String(image.path).split('/');
  return parts[parts.length - 1] || null;
};

const removeObjectSafe = async (objectName) => {
  try {
    await minioClient.removeObject(BUCKET_NAME, objectName);
  } catch (error) {
    if (error && (error.code === 'NotFound' || error.code === 'NoSuchKey' || error.statusCode === 404)) {
      return;
    }
    throw error;
  }
};

const processProjectImageBatch = async (images) => {
  if (images.length === 0) {
    return 0;
  }

  const imageIds = images.map((image) => image._id);
  const objectNames = images.map((image) => resolveObjectName(image)).filter(Boolean);

  const deleteResults = await Promise.allSettled(objectNames.map((objectName) => removeObjectSafe(objectName)));
  const failedDeletes = deleteResults.filter((result) => result.status === 'rejected');
  if (failedDeletes.length > 0) {
    console.warn(`Có ${failedDeletes.length} file trên MinIO không xóa được khi dọn dự án.`);
  }

  await Evaluation.deleteMany({ imageId: { $in: imageIds } });
  await Image.deleteMany({ _id: { $in: imageIds } });

  return imageIds.length;
};

const deleteProjectImagesInBatches = async (projectId, batchSize = 250) => {
  const cursor = Image.find({ projectId }).select('_id filename path').lean().cursor();
  let batch = [];
  let deletedCount = 0;

  for await (const image of cursor) {
    batch.push(image);
    if (batch.length >= batchSize) {
      deletedCount += await processProjectImageBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    deletedCount += await processProjectImageBatch(batch);
  }

  return deletedCount;
};
router.post('/projects', verifyAdmin, async (req, res) => {
  const { name, description, labels, splitRatios, splitPercent, aiModelId } = req.body;
  try {
    const existingProject = await Project.findOne({ name });
    if (existingProject) {
      return res.status(400).json({ message: 'Tên bộ dữ liệu này đã tồn tại!' });
    }

    if (aiModelId) {
      const aiModel = await AiModel.findById(aiModelId);
      if (!aiModel) {
        return res.status(404).json({ message: 'Không tìm thấy AI model được chọn!' });
      }
    }

    const resolvedRatios = normalizeSplitRatios(splitRatios, splitPercent);
    const ratioCheck = validateSplitRatios(resolvedRatios);
    if (!ratioCheck.valid) {
      return res.status(400).json({ message: ratioCheck.message });
    }

    const newProject = new Project({
      name,
      description,
      labels: labels || [],
      aiModelId: aiModelId || null,
      splitPercent: Number(splitPercent) || 100,
      splitRatios: ratioCheck.ratios
    });
    await newProject.save();
    await newProject.populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');
    res.status(201).json({ 
      message: 'Tạo bộ dữ liệu thành công!', 
      project: newProject 
    });
  } catch (error) {
    console.error("Lỗi khi tạo project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
router.get('/projects', async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    const query = role === 'admin'
      ? {}
      : { _id: { $in: getAccessibleProjectIds(req.user) } };

    const projects = await Project.find(query).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap').sort({ createdAt: -1 });
    if (role === 'admin') {
      return res.status(200).json(projects);
    }

    const permissionMap = new Map((req.user?.projectPermissions || []).map((entry) => [String(entry.projectId), entry]));
    const filteredProjects = projects.filter((project) => {
      const ratios = normalizeSplitRatios(project.splitRatios, project.splitPercent || 100);
      if (ratios.length <= 1) return true;
      const permissionEntry = permissionMap.get(String(project._id));
      return Boolean(permissionEntry && Array.isArray(permissionEntry.partIds) && permissionEntry.partIds.length > 0);
    });

    return res.status(200).json(filteredProjects);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
router.put('/projects/:id', verifyAdmin, async (req, res) => {
  try {
    const nextBody = { ...req.body };
    const projectId = req.params.id;
    const existingProject = await Project.findById(projectId);
    if (!existingProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    let splitConfigChanged = false;

    if (nextBody.aiModelId !== undefined) {
      if (nextBody.aiModelId) {
        const aiModel = await AiModel.findById(nextBody.aiModelId);
        if (!aiModel) {
          return res.status(404).json({ message: 'Không tìm thấy AI model được chọn!' });
        }
      }
    }

    if (nextBody.splitPercent !== undefined) {
      const splitPercent = Number(nextBody.splitPercent);
      if (!Number.isInteger(splitPercent) || splitPercent < 10 || splitPercent > 100 || splitPercent % 10 !== 0) {
        return res.status(400).json({ message: 'Tỉ lệ chia phải từ 10 đến 100 và tăng theo bước 10%.' });
      }
      nextBody.splitPercent = splitPercent;
      splitConfigChanged = true;
    }

    if (nextBody.splitRatios !== undefined) {
      // Allow empty array when using imagesPerPart mode
      if (Array.isArray(nextBody.splitRatios) && nextBody.splitRatios.length === 0) {
        nextBody.splitRatios = [];
        splitConfigChanged = true;
      } else {
        const ratioCheck = validateSplitRatios(nextBody.splitRatios);
        if (!ratioCheck.valid) {
          return res.status(400).json({ message: ratioCheck.message });
        }
        nextBody.splitRatios = ratioCheck.ratios;
        splitConfigChanged = true;
      }
    }

    if (nextBody.imagesPerPart !== undefined && nextBody.imagesPerPart !== null) {
      const ipp = Number(nextBody.imagesPerPart);
      if (!Number.isInteger(ipp) || ipp < 1) {
        return res.status(400).json({ message: 'Số ảnh/phần phải là số nguyên dương.' });
      }
      nextBody.imagesPerPart = ipp;
      splitConfigChanged = true;
    } else if (nextBody.imagesPerPart === null) {
      nextBody.imagesPerPart = null;
      splitConfigChanged = true;
    }

    // server-side validation: ensure the configured parts are feasible given current image count
    if (splitConfigChanged) {
      try {
        const imagesCount = await Image.countDocuments({ projectId: req.params.id });
        const useImagesPerPart = nextBody.imagesPerPart !== undefined ? nextBody.imagesPerPart : existingProject.imagesPerPart;
        const useSplitRatios = nextBody.splitRatios || existingProject.splitRatios;
        
        if (useImagesPerPart) {
          const numParts = Math.ceil(imagesCount / useImagesPerPart);
          if (numParts < 1) {
            return res.status(400).json({ message: 'Không đủ ảnh để chia theo cấu hình phần.' });
          }
        } else if (useSplitRatios) {
          const parts = buildProjectParts(imagesCount, useSplitRatios);
          if (Array.isArray(parts) && parts.length < useSplitRatios.length) {
            return res.status(400).json({ message: 'Không đủ ảnh để chia theo cấu hình phần.' });
          }
        }
      } catch (err) {
        console.error('Lỗi kiểm tra phần dự án:', err);
      }
    }

    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id, 
      nextBody, 
      { new: true } 
    ).populate('aiModelId', 'name dbVersion minioPath bucketName labelMap');
    if (!updatedProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });

    if (splitConfigChanged) {
      await User.updateMany(
        { 'projectPermissions.projectId': updatedProject._id },
        { $pull: { projectPermissions: { projectId: updatedProject._id } } }
      );
    }

    res.status(200).json({ message: 'Cập nhật dự án thành công!', project: updatedProject });
  } catch (error) {
    console.error("Lỗi sửa project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.put('/projects/:id/access', verifyAdmin, async (req, res) => {
  try {
    const { userId, partIds } = req.body;
    const projectId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: 'Thiếu userId.' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    }

    const images = await Image.find({ projectId }).select('_id uploadDate createdAt');
    const sectionSpans = buildProjectParts(
      images.length,
      project.splitRatios || [],
      project.splitPercent || 100,
      project.imagesPerPart || null
    );
    const validPartIds = sectionSpans.map((section) => section.partId);
    const normalizedPartIds = Array.isArray(partIds) ? Array.from(new Set(partIds.map((partId) => String(partId)))) : [];

    if (normalizedPartIds.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn ít nhất một phần của dự án.' });
    }

    const invalidPartId = normalizedPartIds.find((partId) => !validPartIds.includes(partId));
    if (invalidPartId) {
      return res.status(400).json({ message: 'Phần được chọn không hợp lệ với cấu hình dự án hiện tại.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $addToSet: { allowedProjects: projectId },
        $pull: { projectPermissions: { projectId } },
      },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng!' });
    }

    await User.updateOne(
      { _id: userId },
      {
        $push: {
          projectPermissions: {
            projectId,
            partIds: normalizedPartIds
          }
        }
      }
    );

    const refreshedUser = await User.findById(userId).select('-password').populate('allowedProjects', 'name');
    return res.status(200).json({ message: 'Đã cập nhật quyền theo phần thành công!', user: refreshedUser });
  } catch (error) {
    console.error('Lỗi cập nhật quyền dự án:', error);
    return res.status(500).json({ message: 'Lỗi server khi cập nhật quyền dự án' });
  }
});
router.delete('/projects/:id', verifyAdmin, async (req, res) => {
  try {
    const projectId = req.params.id;
    const deletedImages = await deleteProjectImagesInBatches(projectId);

    await User.updateMany(
      { allowedProjects: projectId },
      { $pull: { allowedProjects: projectId } }
    );

    await User.updateMany(
      { 'projectPermissions.projectId': projectId },
      { $pull: { projectPermissions: { projectId } } }
    );

    const deletedProject = await Project.findByIdAndDelete(projectId);
    if (!deletedProject) return res.status(404).json({ message: 'Không tìm thấy dự án!' });
    res.status(200).json({
      message: 'Đã xóa dự án, ảnh trên MinIO và dữ liệu liên quan thành công!',
      deletedImages
    });
  } catch (error) {
    console.error("Lỗi xóa project:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
module.exports = router;