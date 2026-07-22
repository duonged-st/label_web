const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Project = require('../models/Project');
const { normalizeSplitRatios } = require('../utils/projectAccess');
const { verifyAdmin } = require('../middleware/authmiddleware');
const router = express.Router();

const normalizeProjectIdList = (projectIds) => Array.from(new Set(
  (Array.isArray(projectIds) ? projectIds : [])
    .map((projectId) => String(projectId || '').trim())
    .filter(Boolean)
));

const buildSyncedProjectPermissions = async (allowedProjectIds, existingPermissions = []) => {
  const normalizedAllowedProjectIds = normalizeProjectIdList(allowedProjectIds);
  if (normalizedAllowedProjectIds.length === 0) {
    return [];
  }

  const projects = await Project.find({ _id: { $in: normalizedAllowedProjectIds } })
    .select('_id splitRatios splitPercent');

  const existingPermissionMap = new Map(
    (Array.isArray(existingPermissions) ? existingPermissions : []).map((entry) => [
      String(entry.projectId),
      Array.from(new Set((Array.isArray(entry.partIds) ? entry.partIds : []).map((partId) => String(partId))))
    ])
  );

  const nextProjectPermissions = [];

  projects.forEach((project) => {
    const ratios = normalizeSplitRatios(project.splitRatios, project.splitPercent || 100);
    if (ratios.length <= 1) {
      return;
    }

    const validPartIds = Array.from({ length: ratios.length }, (_, index) => String(index + 1));
    const currentPartIds = existingPermissionMap.get(String(project._id)) || [];
    const filteredCurrentPartIds = currentPartIds.filter((partId) => validPartIds.includes(partId));

    nextProjectPermissions.push({
      projectId: project._id,
      partIds: filteredCurrentPartIds.length > 0 ? filteredCurrentPartIds : validPartIds
    });
  });

  return nextProjectPermissions;
};

router.get('/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')  
      .populate('allowedProjects', 'name')
      .populate('projectPermissions.projectId', 'name splitPercent splitRatios');   
    res.status(200).json(users);
  } catch (error) {
    console.error("Lỗi lấy danh sách user:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.get('/users/me/shuffle-seed', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('labelingShuffleSeed');

    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }

    if (!user.labelingShuffleSeed) {
      user.labelingShuffleSeed = crypto.randomBytes(16).toString('hex');
      await user.save();
    }

    return res.status(200).json({ shuffleSeed: user.labelingShuffleSeed });
  } catch (error) {
    console.error('Lỗi lấy seed trộn ảnh:', error);
    return res.status(500).json({ message: 'Lỗi server khi lấy seed trộn ảnh' });
  }
});

router.put('/users/:id', verifyAdmin, async (req, res) => {
  const userId = req.params.id; 
  const { role, allowedProjects } = req.body; 
  try {
    const normalizedRole = String(role || 'user').toLowerCase();
    const normalizedAllowedProjects = normalizeProjectIdList(allowedProjects);

    const existingUser = await User.findById(userId).select('projectPermissions');
    if (!existingUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }

    const syncedProjectPermissions = await buildSyncedProjectPermissions(
      normalizedAllowedProjects,
      existingUser.projectPermissions
    );

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        role: normalizedRole,
        allowedProjects: normalizedAllowedProjects,
        projectPermissions: syncedProjectPermissions
      },
      { new: true }
    )
      .select('-password')
      .populate('allowedProjects', 'name')
      .populate('projectPermissions.projectId', 'name splitPercent splitRatios');

    if (!updatedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }
    res.status(200).json({ 
      message: 'Cập nhật phân quyền thành công!', 
      user: updatedUser 
    });
  } catch (error) {
    console.error("Lỗi cập nhật user:", error);
    res.status(500).json({ message: 'Lỗi server khi cập nhật quyền' });
  } 
});

router.delete('/users/:id', verifyAdmin, async (req, res) => {
  const userId = req.params.id;

  try {
    if (String(req.user.userId) === String(userId)) {
      return res.status(400).json({ message: 'Không thể tự xóa tài khoản đang đăng nhập!' });
    }

    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }

    return res.status(200).json({ message: 'Đã xóa người dùng thành công!' });
  } catch (error) {
    console.error('Lỗi xóa user:', error);
    return res.status(500).json({ message: 'Lỗi server khi xóa người dùng' });
  }
});

module.exports = router;