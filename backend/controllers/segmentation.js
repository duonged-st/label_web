const express = require('express');
const mongoose = require('mongoose');
const Image = require('../models/Image');
const Project = require('../models/Project');
const Segmentation = require('../models/Segmentation');
const { canUserAccessImage } = require('../utils/imageParts');
const { withProjectWriteLock } = require('../utils/projectWriteLock');
const { buildClassCatalog, validateAnnotation } = require('../utils/segmentationValidation');
const { hasProjectAccess, normalizeRole } = require('../middleware/authmiddleware');
const router = express.Router();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

const projectAccess = async (req, projectId) => {
  if (!req.user) fail(401, 'Vui lòng đăng nhập.');
  if (normalizeRole(req.user.role) !== 'admin' && !hasProjectAccess(req.user, projectId)) fail(403, 'Bạn không có quyền truy cập dataset này.');
  const project = await Project.findById(projectId);
  if (!project) fail(404, 'Không tìm thấy dataset.');
  return project;
};
const catalogFor = async (project) => {
  const catalog = buildClassCatalog(project.segmentationClasses || [], project.labels || []);
  if (JSON.stringify(catalog) !== JSON.stringify((project.segmentationClasses || []).map((item) => ({ id: item.id, name: item.name, color: item.color, active: item.active })))) {
    await Project.updateOne({ _id: project._id }, { $set: { segmentationClasses: catalog } });
  }
  return catalog;
};
const sendError = (res, error) => {
  const status = error.status || (error.name === 'CastError' ? 400 : error.code === 11000 ? 409 : 500);
  if (status === 500) console.error('Lỗi segmentation:', error);
  res.status(status).json({ message: error.status ? error.message : status === 409 ? 'Annotation đã thay đổi. Tải lại trước khi lưu.' : status === 400 ? 'ID không hợp lệ.' : 'Không thể xử lý annotation.' });
};

// Personal status is independent of Classification evaluations.
router.get('/segmentation/projects/:projectId', async (req, res) => {
  try {
    const result = await withProjectWriteLock(req.params.projectId, async () => {
      const project = await projectAccess(req, req.params.projectId);
      const classes = await catalogFor(project);
      const images = await Image.find({ projectId: project._id, deletionPending: { $ne: true } }).select('_id projectId partId').lean();
      const access = await Promise.all(images.map((image) => canUserAccessImage(req.user, project, image)));
      const ids = images.filter((_, index) => access[index]).map((image) => image._id);
      const annotations = await Segmentation.aggregate([
        { $match: { projectId: project._id, userId: new mongoose.Types.ObjectId(req.user.userId), imageId: { $in: ids } } },
        { $project: {
          _id: 0, imageId: 1, revision: 1, updatedAt: 1,
          regionCount: { $size: '$regions' },
          maskCount: { $size: { $filter: { input: '$regions', as: 'region', cond: { $in: ['$$region.type', ['polygon', 'brush']] } } } }
        } }
      ]);
      return { classes, annotations };
    });
    res.json(result);
  } catch (error) { sendError(res, error); }
});

const accessImage = async (req) => {
  if (!mongoose.isValidObjectId(req.params.imageId)) fail(400, 'ID ảnh không hợp lệ.');
  const image = await Image.findById(req.params.imageId);
  if (!image || image.deletionPending) fail(404, 'Ảnh không tồn tại hoặc đang được xóa.');
  const project = await projectAccess(req, image.projectId);
  if (!(await canUserAccessImage(req.user, project, image))) fail(403, 'Bạn không có quyền gán nhãn phần chứa ảnh này.');
  return { image, project };
};

for (const method of ['get', 'put']) {
  router[method]('/segmentation/images/:imageId', async (req, res) => {
    try {
      const initial = await accessImage(req);
      const result = await withProjectWriteLock(initial.image.projectId, async () => {
        const { image, project } = await accessImage(req);
        const classes = await catalogFor(project);
        const query = { imageId: image._id, userId: req.user.userId };
        let annotation = await Segmentation.findOne(query).lean();
        if (method === 'put') {
          const value = validateAnnotation(req.body, classes);
          if (value.revision !== (annotation?.revision || 0)) fail(409, 'Annotation đã được lưu ở cửa sổ khác. Tải lại để tránh ghi đè.');
          if (annotation && (annotation.width !== value.width || annotation.height !== value.height)) fail(409, 'Kích thước ảnh không khớp annotation đã lưu.');
          if (annotation) {
            annotation = await Segmentation.findOneAndUpdate({ ...query, revision: value.revision },
              { $set: { regions: value.regions }, $inc: { revision: 1 } }, { returnDocument: 'after', runValidators: true }).lean();
            if (!annotation) fail(409, 'Annotation đã thay đổi. Vui lòng tải lại.');
          } else {
            annotation = (await Segmentation.create({ ...query, projectId: project._id, width: value.width, height: value.height, regions: value.regions, revision: 1 })).toObject();
          }
        }
        return {
          schemaVersion: 1, imageId: image._id, filename: image.filename,
          projectId: project._id, projectName: project.name, userId: req.user.userId,
          width: annotation?.width || null, height: annotation?.height || null,
          revision: annotation?.revision || 0, updatedAt: annotation?.updatedAt || null,
          regions: annotation?.regions || [], classes
        };
      });
      res.json(result);
    } catch (error) { sendError(res, error); }
  });
}

module.exports = router;
