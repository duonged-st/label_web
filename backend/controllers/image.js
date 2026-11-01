const express = require('express');
const Image = require('../models/Image');
const Evaluation = require('../models/Evaluation');
const Project = require('../models/Project');
const { verifyAdmin, normalizeRole, hasProjectAccess, getProjectPermissionEntry } = require('../middleware/authmiddleware');
const { getImagePartMap, getAccessibleProjectIds } = require('../utils/projectAccess');
const { getImageDisplayName } = require('../utils/imageFile');
const { ensureProjectImageParts } = require('../utils/imageParts');
const { deleteImageWithStorage, deleteProjectImagesInBatches } = require('../utils/imageDeletion');
const { withProjectWriteLock } = require('../utils/projectWriteLock');
const router = express.Router();
// [GET] /api/images - Lấy danh sách ảnh 
router.get('/images', async (req, res) => {
  try {
    const { projectId, status, label, page = 1, limit = 20, personal = 'false' } = req.query;
    const isAllLimit = String(limit).toLowerCase() === 'all';
    const isPersonalView = String(personal).toLowerCase() === 'true';
    const parsedPage = Number(page) > 0 ? Number(page) : 1;
    const parsedLimit = Number(limit) > 0 ? Number(limit) : 20;
    let query = { deletionPending: { $ne: true } };

    const userRole = normalizeRole(req.user?.role);
    const allowedProjects = getAccessibleProjectIds(req.user);
    if (userRole === 'admin' && String(req.query.includePending).toLowerCase() === 'true') {
      delete query.deletionPending;
    }
    if (userRole === 'admin' && status === 'Chờ xóa') {
      query.deletionPending = true;
    }

    // 1. Lọc theo Dự án
    if (projectId) query.projectId = projectId;

    if (userRole !== 'admin') {
      if (projectId && !hasProjectAccess(req.user, projectId)) {
        return res.status(403).json({ message: 'Bạn không có quyền xem ảnh của dự án này!' });
      }

      if (!projectId) {
        query.projectId = { $in: allowedProjects };
      }
    }
    const legacyProjectIds = await Image.distinct('projectId', { ...query, partId: null });
    if (legacyProjectIds.length > 0) {
      const legacyProjects = await Project.find({ _id: { $in: legacyProjectIds } });
      await Promise.all(legacyProjects.map((project) => ensureProjectImageParts(project)));
    }
    // 2. Lấy danh sách ảnh theo query quyền + dự án (chưa lọc status)
    const skipCount = (parsedPage - 1) * parsedLimit;
    const dbLimit = isAllLimit ? 0 : parsedLimit; 
    let totalCount = 0;
    let images = [];

    if (userRole === 'admin') {
      totalCount = await Image.countDocuments(query);

      images = await Image.find(query)
        .populate('projectId', 'name')
        .sort({ uploadDate: -1 })
        .skip(isAllLimit ? 0 : skipCount)
        .limit(isAllLimit ? 0 : dbLimit);
    } else {
      // Non-admin: load full set to correctly map parts
      images = await Image.find(query)
        .populate('projectId', 'name')
        .sort({ uploadDate: -1 });
    }

    const projectIds = Array.from(new Set(images.map((imageDoc) => String(imageDoc.projectId?._id || imageDoc.projectId)).filter(Boolean)));
    const projectRecords = await Project.find({ _id: { $in: projectIds } }).select('splitPercent splitRatios imagesPerPart');
    const projectMap = new Map(projectRecords.map((project) => [String(project._id), project]));

    // Skip expensive MinIO existence checks during normal listing (improves performance for large datasets)
    const visibleImages = images;

    const imagesByProject = visibleImages.reduce((accumulator, imageDoc) => {
      const projectIdValue = String(imageDoc.projectId?._id || imageDoc.projectId);
      if (!accumulator.has(projectIdValue)) {
        accumulator.set(projectIdValue, []);
      }
      accumulator.get(projectIdValue).push(imageDoc);
      return accumulator;
    }, new Map());

    const filteredBySection = [];
    imagesByProject.forEach((projectImages, projectIdValue) => {
      if (userRole === 'admin') {
        filteredBySection.push(...projectImages);
        return;
      }

      const permissionEntry = getProjectPermissionEntry(req.user, projectIdValue);
      const project = projectMap.get(projectIdValue);

      if (!permissionEntry || !Array.isArray(permissionEntry.partIds) || permissionEntry.partIds.length === 0) {
        return;
      }

      const { map } = getImagePartMap(projectImages, project?.splitRatios || [], project?.splitPercent || 100, project?.imagesPerPart || null);
      projectImages.forEach((imageDoc) => {
        const partInfo = map.get(String(imageDoc._id));
        if (partInfo && permissionEntry.partIds.includes(String(partInfo.partId))) {
          filteredBySection.push(imageDoc);
        }
      });
    });

    // 3. Tính trạng thái từ Evaluation để tránh lệch trạng thái cũ lưu trong Image
    const evaluations = await Evaluation.find({ imageId: { $in: filteredBySection.map((image) => image._id) } })
      .select('imageId userId finalLabels');

    const globalMap = new Map();
    const personalMap = new Map();

    evaluations.forEach((evaluation) => {
      const key = evaluation.imageId.toString();

      const globalEntry = globalMap.get(key) || { labelsSet: new Set(), count: 0 };
      (evaluation.finalLabels || []).forEach((label) => globalEntry.labelsSet.add(label));
      globalEntry.count += 1;
      globalMap.set(key, globalEntry);

      if (String(evaluation.userId) === String(req.user.userId)) {
        personalMap.set(key, evaluation.finalLabels || []);
      }
    });

    let responseImages = filteredBySection;
    if (isPersonalView) {
      responseImages = filteredBySection.map((imageDoc) => {
        const personalLabels = personalMap.get(imageDoc._id.toString()) || [];
        return {
          ...imageDoc.toObject(),
          filename: getImageDisplayName(imageDoc),
          status: imageDoc.deletionPending ? 'Chờ xóa' : (personalLabels.length > 0 ? 'Đã gán' : 'Chưa gán'),
          finalLabels: personalLabels
        };
      });
    } else {
      responseImages = filteredBySection.map((imageDoc) => {
        const globalEntry = globalMap.get(imageDoc._id.toString());
        const labels = globalEntry ? Array.from(globalEntry.labelsSet) : [];
        return {
          ...imageDoc.toObject(),
          filename: getImageDisplayName(imageDoc),
          status: imageDoc.deletionPending ? 'Chờ xóa' : (labels.length > 0 ? 'Đã gán' : 'Chưa gán'),
          finalLabels: labels
        };
      });
    }

    // 4. Lọc trạng thái sau khi đã tính đúng status từ Evaluation
    if (status === 'Đã gán' || status === 'Chưa gán' || status === 'Chờ xóa') {
      responseImages = responseImages.filter((image) => image.status === status);
    }

    const normalizedLabelFilter = String(label || '').trim().toLowerCase();
    if (normalizedLabelFilter) {
      responseImages = responseImages.filter((image) => {
        const labels = Array.isArray(image.finalLabels) ? image.finalLabels : [];
        return labels.some((item) => String(item).trim().toLowerCase() === normalizedLabelFilter);
      });
    }

    if (userRole !== 'admin') {
      totalCount = responseImages.length;
      if (!isAllLimit) {
        const start = (parsedPage - 1) * parsedLimit;
        responseImages = responseImages.slice(start, start + parsedLimit);
      }
    }

    // Đếm tổng số ảnh sau lọc status để tính số trang đúng
    res.status(200).json({
      totalImages: totalCount,
      totalPages: isAllLimit ? 1 : Math.ceil(totalCount / parsedLimit),
      currentPage: isAllLimit ? 1 : parsedPage,
      images: responseImages
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách ảnh:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});
// [DELETE] /api/images/:id - Xóa 1 bức ảnh
router.delete('/images/:id', verifyAdmin, async (req, res) => {
  try {
    const imageId = req.params.id;
    // 1. Tìm xem ảnh có tồn tại không
    const image = await Image.findById(imageId);
    if (!image) return res.status(404).json({ message: 'Không tìm thấy ảnh!' });
    const deleted = await withProjectWriteLock(image.projectId, async () => {
      const currentImage = await Image.findById(imageId);
      if (!currentImage) return false;
      const project = await Project.findById(currentImage.projectId);
      await ensureProjectImageParts(project);
      return deleteImageWithStorage(currentImage);
    });
    if (!deleted) return res.status(404).json({ message: 'Không tìm thấy ảnh!' });
    res.status(200).json({ message: 'Đã xóa ảnh và dọn dẹp dữ liệu thành công!' });
  } catch (error) {
    console.error("Lỗi xóa ảnh:", error);
    res.status(500).json({ message: 'Lỗi server khi xóa ảnh' });
  }
});

// [DELETE] /api/images/project/:projectId - Xóa toàn bộ ảnh của một dự án
router.delete('/images/project/:projectId', verifyAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const result = await withProjectWriteLock(projectId, async () => {
      const project = await Project.findById(projectId);
      await ensureProjectImageParts(project);
      const imageCount = await Image.countDocuments({ projectId });
      if (imageCount === 0) return { empty: true };
      return deleteProjectImagesInBatches(projectId);
    });

    if (result.empty) {
      return res.status(404).json({ message: 'Dự án này không có ảnh để xóa.' });
    }

    const { deletedCount, failedCount } = result;

    if (failedCount > 0) {
      return res.status(500).json({
        message: `Đã xóa ${deletedCount} ảnh, còn ${failedCount} ảnh chưa xóa được. Vui lòng thử lại.`,
        deletedCount,
        failedCount
      });
    }

    return res.status(200).json({
      message: `Đã xóa toàn bộ ${deletedCount} ảnh của dự án.`,
      deletedCount
    });
  } catch (error) {
    console.error('Lỗi xóa toàn bộ ảnh theo dự án:', error);
    return res.status(500).json({ message: 'Lỗi server khi xóa toàn bộ ảnh của dự án' });
  }
});

module.exports = router;
