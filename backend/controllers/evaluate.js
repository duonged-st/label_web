const express = require('express');
const Evaluation = require('../models/Evaluation');
const Image = require('../models/Image');
const Project = require('../models/Project');
const { hasProjectAccess, normalizeRole } = require('../middleware/authmiddleware');
const { canUserAccessImage } = require('../utils/imageParts');
const { withProjectWriteLock } = require('../utils/projectWriteLock');
const router = express.Router();

router.post('/evaluate', async (req, res) => {
  const { imageId, projectId, finalLabels } = req.body;
  const userId = req.user?.userId;
  const userRole = normalizeRole(req.user?.role);

  try {
    if (!req.user || (userRole !== 'admin' && !hasProjectAccess(req.user, projectId))) {
      return res.status(403).json({ message: 'Bạn không có quyền gán nhãn cho dự án này!' });
    }

    if (!Array.isArray(finalLabels) || finalLabels.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn nhãn!' });
    }

    const result = await withProjectWriteLock(projectId, async () => {
      const image = await Image.findById(imageId).select('projectId partId deletionPending');
      if (!image) return { status: 404, message: 'Không tìm thấy ảnh!' };
      if (image.deletionPending) return { status: 409, message: 'Ảnh đang được xóa, không thể gán nhãn.' };
      if (String(image.projectId) !== String(projectId)) {
        return { status: 400, message: 'Ảnh không thuộc dự án đã chọn!' };
      }

      const project = await Project.findById(projectId).select('labels splitPercent splitRatios imagesPerPart');
      if (!project) return { status: 404, message: 'Không tìm thấy dự án!' };
      if (userRole !== 'admin' && !(await canUserAccessImage(req.user, project, image))) {
        return { status: 403, message: 'Bạn không có quyền gán nhãn cho phần này của dự án!' };
      }

      const allowedLabels = new Set(project.labels || []);
      if (finalLabels.some((label) => typeof label !== 'string' || !allowedLabels.has(label)) ||
          new Set(finalLabels).size !== finalLabels.length) {
        return { status: 400, message: 'Nhãn không hợp lệ hoặc trùng lặp trong dự án này!' };
      }

      await Evaluation.findOneAndUpdate(
        { imageId, userId },
        { projectId, finalLabels, evaluatedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return { status: 200, message: 'Lưu các nhãn thành công!' };
    });

    res.status(result.status).json({ message: result.message });
  } catch (error) {
    console.error("Lỗi khi gán nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi gán nhãn' });
  }
});

router.delete('/evaluate/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const userRole = normalizeRole(req.user?.role);
    const currentImage = await Image.findById(imageId).select('projectId');
    if (!currentImage) return res.status(404).json({ message: 'Không tìm thấy ảnh!' });

    const result = await withProjectWriteLock(currentImage.projectId, async () => {
      const image = await Image.findById(imageId).select('projectId partId deletionPending');
      if (!image) return { status: 404, message: 'Không tìm thấy ảnh!' };
      if (image.deletionPending) return { status: 409, message: 'Ảnh đang được xóa, không thể reset nhãn.' };

      if (!req.user || (userRole !== 'admin' && !hasProjectAccess(req.user, image.projectId))) {
        return { status: 403, message: 'Bạn không có quyền thao tác trên dự án này!' };
      }

      if (userRole !== 'admin') {
        const project = await Project.findById(image.projectId).select('splitPercent splitRatios imagesPerPart');
        if (!project || !(await canUserAccessImage(req.user, project, image))) {
          return { status: 403, message: 'Bạn không có quyền reset nhãn của phần này!' };
        }
      }

      const deletedEvaluation = await Evaluation.findOneAndDelete({ imageId, userId: req.user.userId });
      if (!deletedEvaluation) return { status: 404, message: 'Ảnh này chưa được gán nhãn!' };
      return { status: 200, message: 'Reset thành công' };
    });
    res.status(result.status).json({ message: result.message });
  } catch (error) {
    console.error("Lỗi khi reset nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi reset nhãn' });
  }
});

module.exports = router;
