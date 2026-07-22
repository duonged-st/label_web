const express = require('express');
const Evaluation = require('../models/Evaluation');
const Image = require('../models/Image');
const Project = require('../models/Project');
const { hasProjectAccess, getProjectPermissionEntry } = require('../middleware/authmiddleware');
const { getImagePartMap } = require('../utils/projectAccess');
const router = express.Router();
router.post('/evaluate', async (req, res) => {
  const { imageId, projectId, finalLabels } = req.body;
  const userId = req.user.userId; 
  try {
    if (!req.user || (String(req.user.role).toLowerCase() !== 'admin' && !hasProjectAccess(req.user, projectId))) {
      return res.status(403).json({ message: 'Bạn không có quyền gán nhãn cho dự án này!' });
    }

    if (!Array.isArray(finalLabels) || finalLabels.length === 0) {
      return res.status(400).json({ message: 'Vui lòng chọn nhãn!' });
    }

    const image = await Image.findById(imageId).select('projectId');
    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh!' });
    }

    if (String(image.projectId) !== String(projectId)) {
      return res.status(400).json({ message: 'Ảnh không thuộc dự án đã chọn!' });
    }

    const permissionEntry = getProjectPermissionEntry(req.user, projectId);
    const project = await Project.findById(projectId).select('splitPercent splitRatios');
    const isSplitProject = Array.isArray(project?.splitRatios) ? project.splitRatios.length > 1 : (project?.splitPercent || 100) < 100;
    if (isSplitProject) {
      if (!permissionEntry || !Array.isArray(permissionEntry.partIds) || permissionEntry.partIds.length === 0) {
        return res.status(403).json({ message: 'Dự án này đã được chia phần. Bạn chưa được cấp phần nào.' });
      }

      const imagesInProject = await Image.find({ projectId }).select('_id uploadDate createdAt');
      const { map } = getImagePartMap(imagesInProject, project?.splitRatios || [], project?.splitPercent || 100);
      const partInfo = map.get(String(image._id));
      if (!partInfo || !permissionEntry.partIds.includes(String(partInfo.partId))) {
        return res.status(403).json({ message: 'Bạn không có quyền gán nhãn cho phần này của dự án!' });
      }
    }

    await Evaluation.findOneAndUpdate(
      { imageId, userId },
      {
        projectId,
        finalLabels,
        evaluatedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ message: 'Lưu các nhãn thành công!' });
  } catch (error) {
    console.error("Lỗi khi gán nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi gán nhãn' });
  }
});
router.delete('/evaluate/:imageId', async (req, res) => {
  try {
    const { imageId } = req.params;
    const image = await Image.findById(imageId).select('projectId');
    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy ảnh!' });
    }

    if (!req.user || (String(req.user.role).toLowerCase() !== 'admin' && !hasProjectAccess(req.user, image.projectId))) {
      return res.status(403).json({ message: 'Bạn không có quyền thao tác trên dự án này!' });
    }

    const permissionEntry = getProjectPermissionEntry(req.user, image.projectId);
    const project = await Project.findById(image.projectId).select('splitPercent splitRatios');
    const isSplitProject = Array.isArray(project?.splitRatios) ? project.splitRatios.length > 1 : (project?.splitPercent || 100) < 100;
    if (isSplitProject) {
      if (!permissionEntry || !Array.isArray(permissionEntry.partIds) || permissionEntry.partIds.length === 0) {
        return res.status(403).json({ message: 'Dự án này đã được chia phần. Bạn chưa được cấp phần nào.' });
      }

      const imagesInProject = await Image.find({ projectId: image.projectId }).select('_id uploadDate createdAt');
      const { map } = getImagePartMap(imagesInProject, project?.splitRatios || [], project?.splitPercent || 100);
      const partInfo = map.get(String(image._id));
      if (!partInfo || !permissionEntry.partIds.includes(String(partInfo.partId))) {
        return res.status(403).json({ message: 'Bạn không có quyền reset nhãn của phần này!' });
      }
    }

    const deletedEvaluation = await Evaluation.findOneAndDelete({ imageId: imageId, userId: req.user.userId });
    if (!deletedEvaluation) {
      return res.status(404).json({ message: 'Ảnh này chưa được gán nhãn!' });
    }

    res.status(200).json({ message: 'Reset thành công' });
  } catch (error) {
    console.error("Lỗi khi reset nhãn:", error);
    res.status(500).json({ message: 'Lỗi server khi reset nhãn' });
  }
});
module.exports = router;