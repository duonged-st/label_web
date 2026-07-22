const express = require('express');
const Evaluation = require('../models/Evaluation');
const User = require('../models/User');
const { verifyAdmin } = require('../middleware/authmiddleware');
const router = express.Router();

const toCsvField = (value) => {
  const normalized = value === null || value === undefined ? '' : String(value);
  return `"${normalized.replace(/"/g, '""')}"`;
};

router.get('/export/:projectId', verifyAdmin, async (req, res) => {
  try {
    const { projectId } = req.params;
    const data = await Evaluation.find({ projectId })
      .populate('imageId', 'filename path') 
      .populate('userId', 'username') 
      .select('finalLabels evaluatedAt');

    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'Bộ dữ liệu này chưa có ảnh nào được gán nhãn!' });
    }

    const annotators = Array.from(
      new Set(
        data
          .map((item) => item.userId && item.userId.username)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));

    const imageLabelRowsMap = new Map();

    data.forEach((item) => {
      if (!item.imageId) return;

      const imageId = String(item.imageId._id || item.imageId);
      const imageName = item.imageId.filename || 'unknown';
      const annotator = item.userId && item.userId.username;
      const labels = Array.isArray(item.finalLabels) ? item.finalLabels : [];
      const uniqueLabels = Array.from(new Set(labels.map((label) => String(label).trim()).filter(Boolean)));

      uniqueLabels.forEach((label) => {
        const rowKey = `${imageId}::${label}`;

        if (!imageLabelRowsMap.has(rowKey)) {
          imageLabelRowsMap.set(rowKey, {
            image: imageName,
            label,
            byAnnotator: {}
          });
        }

        if (annotator) {
          imageLabelRowsMap.get(rowKey).byAnnotator[annotator] = 'x';
        }
      });
    });

    const imageLabelRows = Array.from(imageLabelRowsMap.values()).sort((a, b) => {
      const imageCompare = a.image.localeCompare(b.image, 'vi', { sensitivity: 'base' });
      if (imageCompare !== 0) return imageCompare;
      return a.label.localeCompare(b.label, 'vi', { sensitivity: 'base' });
    });

    if (imageLabelRows.length === 0) {
      return res.status(404).json({ message: 'Không có dữ liệu ảnh hợp lệ để xuất file!' });
    }

    const header = ['image', 'label', ...annotators];
    const rows = imageLabelRows.map((row) => [
      row.image,
      row.label,
      ...annotators.map((annotator) => row.byAnnotator[annotator] || '')
    ]);

    const csvContent = [
      header.map(toCsvField).join(','),
      ...rows.map((row) => row.map(toCsvField).join(','))
    ].join('\n');

    res.setHeader('Content-disposition', `attachment; filename=dataset_${projectId}.csv`);
    res.setHeader('Content-type', 'text/csv; charset=utf-8');
    res.status(200).send(csvContent);
  } catch (error) {
    console.error("Lỗi khi xuất dữ liệu:", error);
    res.status(500).json({ message: 'Lỗi server khi xuất file' });
  }
});

router.get('/export/user/:userId', verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('username');

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng!' });
    }

    const evaluations = await Evaluation.find({ userId })
      .populate('imageId', 'filename path')
      .populate('userId', 'username')
      .select('finalLabels evaluatedAt')
      .sort({ evaluatedAt: -1 });

    if (!evaluations || evaluations.length === 0) {
      return res.status(404).json({ message: 'Người dùng này chưa có dữ liệu gán nhãn để xuất!' });
    }

    const annotators = [user.username || 'unknown'];
    const imageLabelRowsMap = new Map();

    evaluations.forEach((item) => {
      if (!item.imageId) return;

      const imageId = String(item.imageId._id || item.imageId);
      const imageName = item.imageId.filename || 'unknown';
      const annotator = item.userId && item.userId.username;
      const labels = Array.isArray(item.finalLabels) ? item.finalLabels : [];
      const uniqueLabels = Array.from(new Set(labels.map((label) => String(label).trim()).filter(Boolean)));

      uniqueLabels.forEach((label) => {
        const rowKey = `${imageId}::${label}`;

        if (!imageLabelRowsMap.has(rowKey)) {
          imageLabelRowsMap.set(rowKey, {
            image: imageName,
            label,
            byAnnotator: {}
          });
        }

        if (annotator) {
          imageLabelRowsMap.get(rowKey).byAnnotator[annotator] = 'x';
        }
      });
    });

    const imageLabelRows = Array.from(imageLabelRowsMap.values()).sort((a, b) => {
      const imageCompare = a.image.localeCompare(b.image, 'vi', { sensitivity: 'base' });
      if (imageCompare !== 0) return imageCompare;
      return a.label.localeCompare(b.label, 'vi', { sensitivity: 'base' });
    });

    if (imageLabelRows.length === 0) {
      return res.status(404).json({ message: 'Không có dữ liệu ảnh hợp lệ để xuất file!' });
    }

    const header = ['image', 'label', ...annotators];
    const rows = imageLabelRows.map((row) => [
      row.image,
      row.label,
      ...annotators.map((annotator) => row.byAnnotator[annotator] || '')
    ]);

    const csvContent = [
      header.map(toCsvField).join(','),
      ...rows.map((row) => row.map(toCsvField).join(','))
    ].join('\n');

    const safeUsername = String(user.username || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-disposition', `attachment; filename=user_${safeUsername}_labels.csv`);
    res.setHeader('Content-type', 'text/csv; charset=utf-8');
    res.status(200).send(csvContent);
  } catch (error) {
    console.error('Lỗi khi xuất CSV theo user:', error);
    res.status(500).json({ message: 'Lỗi server khi xuất file CSV theo người dùng' });
  }
});
module.exports = router;