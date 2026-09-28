const express = require('express');
const Evaluation = require('../models/Evaluation'); 
const Image = require('../models/Image'); 
const Project = require('../models/Project');
const User = require('../models/User');
const { verifyAdmin } = require('../middleware/authmiddleware');
const { getImageDisplayName } = require('../utils/imageFile');
const { getImagePartMap, getProjectPermissionEntry, normalizeRole } = require('../utils/projectAccess');
const router = express.Router();
router.get('/statistics/dashboard', verifyAdmin, async (req, res) => {
  try {
    const totalEvaluated = (await Evaluation.distinct('imageId')).length;
    const userStats = await Evaluation.aggregate([
      { 
        $group: { 
          _id: "$userId", 
          totalLabeled: { $sum: 1 } 
        } 
      },
      {
        $lookup: {
          from: "users", 
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          _id: 0,
          userId: { $toString: '$_id' },
          userName: "$userInfo.username",
          totalLabeled: 1
        }
      },
      { $sort: { totalLabeled: -1 } }
    ]);

    const projects = await Project.find().select('_id name splitRatios splitPercent imagesPerPart').sort({ createdAt: -1 });
    const projectIds = projects.map((project) => project._id);
    const images = projectIds.length > 0
      ? await Image.find({ projectId: { $in: projectIds } }).select('_id projectId partId uploadDate createdAt')
      : [];

    const imagesByProject = images.reduce((accumulator, imageDoc) => {
      const projectId = String(imageDoc.projectId);
      if (!accumulator.has(projectId)) {
        accumulator.set(projectId, []);
      }
      accumulator.get(projectId).push(imageDoc);
      return accumulator;
    }, new Map());

    const projectContexts = new Map();
    projects.forEach((project) => {
      const projectImages = imagesByProject.get(String(project._id)) || [];
      const { map: imagePartMap } = getImagePartMap(projectImages, project.splitRatios || [], project.splitPercent || 100, project.imagesPerPart || null);
      const partCounts = {};

      projectImages.forEach((imageDoc) => {
        const partId = imagePartMap.get(String(imageDoc._id))?.partId;
        if (!partId) return;
        partCounts[partId] = (partCounts[partId] || 0) + 1;
      });

      projectContexts.set(String(project._id), {
        totalImages: projectImages.length,
        partCounts
      });
    });

    const users = await User.find().select('_id username role allowedProjects projectPermissions');
    const assignedCountsByUserId = new Map();

    users.forEach((user) => {
      let totalAssigned = 0;

      projectContexts.forEach((projectContext, projectId) => {
        const permissionEntry = getProjectPermissionEntry(user, projectId);
        const partIds = Array.isArray(permissionEntry?.partIds) ? permissionEntry.partIds.map(String) : [];

        if (partIds.length > 0) {
          totalAssigned += partIds.reduce((sum, partId) => sum + (projectContext.partCounts[partId] || 0), 0);
          return;
        }

        const allowedProjects = Array.isArray(user.allowedProjects) ? user.allowedProjects : [];
        if (allowedProjects.some((allowedProjectId) => String(allowedProjectId) === String(projectId))) {
          totalAssigned += projectContext.totalImages;
        }
      });

      assignedCountsByUserId.set(String(user._id), totalAssigned);
    });

    const enrichedUserStats = userStats
      .map((user) => {
        const totalAssigned = assignedCountsByUserId.get(String(user.userId)) || 0;
        const productivityPercent = totalAssigned > 0
          ? Number(((Number(user.totalLabeled) / totalAssigned) * 100).toFixed(1))
          : 0;

        return {
          ...user,
          totalAssigned,
          productivityPercent
        };
      })
      .sort((left, right) => {
        if (right.productivityPercent !== left.productivityPercent) {
          return right.productivityPercent - left.productivityPercent;
        }
        return right.totalLabeled - left.totalLabeled;
      });

    const projectStats = await Promise.all(projects.map(async (p) => {
      const totalImages = await Image.countDocuments({ projectId: p._id });
      const labeledImageIds = await Evaluation.distinct('imageId', { projectId: p._id });
      const labeledImages = labeledImageIds.length;
      const evals = await Evaluation.find({ projectId: p._id });
      let labelCounts = {};
      let totalLabels = 0;
      evals.forEach(ev => {
        if (ev.finalLabels && Array.isArray(ev.finalLabels)) {
          ev.finalLabels.forEach(label => {
            labelCounts[label] = (labelCounts[label] || 0) + 1;
            totalLabels++;
          });
        }
      });
      let labelDistribution = Object.entries(labelCounts).map(([label, count]) => ({
        label,
        percentage: totalLabels > 0 ? ((count / totalLabels) * 100).toFixed(1) : 0
      })).sort((a, b) => b.percentage - a.percentage);
      return {
        _id: p._id,
        name: p.name,
        totalImages,
        labeledImages,
        unlabeledImages: totalImages - labeledImages,
        labelDistribution
      };
    }));
    res.status(200).json({
      totalLabeledImages: totalEvaluated,
      userStatistics: enrichedUserStats,
      projectStatistics: projectStats
    });
  } catch (error) {
    console.error("Lỗi khi lấy thống kê:", error);
    res.status(500).json({ message: 'Lỗi server khi thống kê dữ liệu' });
  }
});

router.get('/statistics/user/:userId', verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('username');
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }

    const evaluations = await Evaluation.find({ userId })
      .populate('imageId', 'filename storageKey path projectId uploadDate createdAt')
      .populate('projectId', 'name')
      .sort({ evaluatedAt: -1 });

    const enrichedEvaluations = evaluations.map((eval) => ({
      filename: getImageDisplayName(eval.imageId),
      path: eval.imageId?.path || '',
      projectName: eval.projectId?.name || 'Unknown Project',
      finalLabels: eval.finalLabels || [],
      evaluatedAt: eval.evaluatedAt
    }));

    res.status(200).json({
      userName: user.username,
      evaluations: enrichedEvaluations
    });
  } catch (error) {
    console.error('Lỗi khi lấy chi tiết người dùng:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy chi tiết người dùng' });
  }
});

module.exports = router;
