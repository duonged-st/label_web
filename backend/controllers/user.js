const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const Image = require('../models/Image');
const { getProjectPartIds } = require('../utils/projectAccess');
const { ensureProjectImageParts } = require('../utils/imageParts');
const { validateAccountCredentials, normalizeManagedRole } = require('../utils/accountSecurity');
const { verifyAdmin, verifyToken } = require('../middleware/authmiddleware');
const router = express.Router();

const normalizeProjectIdList = (projectIds) => Array.from(new Set(
  (Array.isArray(projectIds) ? projectIds : [])
    .map((projectId) => String(projectId || '').trim())
    .filter(Boolean)
));

const validateAllowedProjects = async (projectIds) => {
  const normalizedProjectIds = normalizeProjectIdList(projectIds);
  const invalidId = normalizedProjectIds.find((projectId) => !mongoose.isValidObjectId(projectId));

  if (invalidId) {
    return { error: 'Danh sách dự án chứa mã không hợp lệ.' };
  }

  if (normalizedProjectIds.length === 0) {
    return { projectIds: [], error: null };
  }

  const existingProjectIds = await Project.find({ _id: { $in: normalizedProjectIds } })
    .distinct('_id');

  if (existingProjectIds.length !== normalizedProjectIds.length) {
    return { error: 'Một hoặc nhiều dự án được cấp quyền không tồn tại.' };
  }

  return { projectIds: normalizedProjectIds, error: null };
};

const buildSyncedProjectPermissions = async (allowedProjectIds, existingPermissions = []) => {
  const normalizedAllowedProjectIds = normalizeProjectIdList(allowedProjectIds);
  if (normalizedAllowedProjectIds.length === 0) {
    return [];
  }

  const projects = await Project.find({ _id: { $in: normalizedAllowedProjectIds } })
    .select('_id splitRatios splitPercent imagesPerPart');

  const existingPermissionMap = new Map(
    (Array.isArray(existingPermissions) ? existingPermissions : []).map((entry) => [
      String(entry.projectId),
      Array.from(new Set((Array.isArray(entry.partIds) ? entry.partIds : []).map((partId) => String(partId))))
    ])
  );

  const nextProjectPermissions = [];

  for (const project of projects) {
    await ensureProjectImageParts(project);
    const images = await Image.find({ projectId: project._id }).select('_id partId').lean();
    const validPartIds = getProjectPartIds(images, project.splitRatios, project.splitPercent, project.imagesPerPart);
    if (validPartIds.length === 0) validPartIds.push('1');

    const currentPartIds = existingPermissionMap.get(String(project._id)) || [];
    const filteredCurrentPartIds = currentPartIds.filter((partId) => validPartIds.includes(partId));

    nextProjectPermissions.push({
      projectId: project._id,
      partIds: existingPermissionMap.has(String(project._id)) ? filteredCurrentPartIds : validPartIds
    });
  }

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

router.post('/users', verifyAdmin, async (req, res) => {
  const { username, password, error } = validateAccountCredentials(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }

  const normalizedRole = normalizeManagedRole(req.body?.role);
  if (!normalizedRole) {
    return res.status(400).json({ message: 'Vai trò chỉ có thể là user hoặc admin.' });
  }

  try {
    const projectValidation = await validateAllowedProjects(req.body?.allowedProjects);
    if (projectValidation.error) {
      return res.status(400).json({ message: projectValidation.error });
    }

    const existingUser = await User.findOne({ username }).select('_id');
    if (existingUser) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const projectPermissions = await buildSyncedProjectPermissions(projectValidation.projectIds, []);

    const createdUser = await User.create({
      username,
      password: hashedPassword,
      role: normalizedRole,
      allowedProjects: projectValidation.projectIds,
      projectPermissions
    });

    const user = await User.findById(createdUser._id)
      .select('-password')
      .populate('allowedProjects', 'name')
      .populate('projectPermissions.projectId', 'name splitPercent splitRatios');

    return res.status(201).json({ message: 'Tạo tài khoản thành công!', user });
  } catch (createError) {
    if (createError?.code === 11000) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
    }
    console.error('Lỗi khi admin tạo user:', createError);
    return res.status(500).json({ message: 'Lỗi server khi tạo người dùng' });
  }
});

// FIX #5: Thêm verifyToken middleware guard tường minh cho route này
router.get('/users/me/shuffle-seed', verifyToken, async (req, res) => {
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
    const normalizedRole = normalizeManagedRole(role);
    if (!normalizedRole) {
      return res.status(400).json({ message: 'Vai trò chỉ có thể là user hoặc admin.' });
    }

    const projectValidation = await validateAllowedProjects(allowedProjects);
    if (projectValidation.error) {
      return res.status(400).json({ message: projectValidation.error });
    }

    const existingUser = await User.findById(userId).select('projectPermissions');
    if (!existingUser) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng này!' });
    }

    const syncedProjectPermissions = await buildSyncedProjectPermissions(
      projectValidation.projectIds,
      existingUser.projectPermissions
    );

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        role: normalizedRole,
        allowedProjects: projectValidation.projectIds,
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
