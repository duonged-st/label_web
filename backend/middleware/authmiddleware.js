const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { normalizeRole, hasProjectAccess, hasProjectPartAccess, getProjectPermissionEntry } = require('../utils/projectAccess');
const { jwtSecret } = require('../config/security');

const verifyToken = (req, res, next) => {
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Từ chối truy cập! Vui lòng đăng nhập.' });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret);

    User.findById(decoded.userId)
      .select('username role allowedProjects projectPermissions labelingShuffleSeed')
      .then((user) => {
        if (!user) {
          return res.status(403).json({ message: 'Người dùng không còn tồn tại!' });
        }

        req.user = {
          userId: user._id,
          username: user.username,
          role: normalizeRole(user.role),
          allowedProjects: user.allowedProjects || [],
          projectPermissions: user.projectPermissions || [],
          labelingShuffleSeed: user.labelingShuffleSeed || null
        };

        return next();
      })
      .catch((error) => {
        console.error('Lỗi tải thông tin user từ token:', error);
        return res.status(500).json({ message: 'Lỗi server khi xác thực người dùng' });
      });
  } catch (error) {
    return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn!' });
  }
};

const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    const role = normalizeRole(req.user.role);
    if (role !== 'admin') {
      return res.status(403).json({ message: 'Chỉ Admin mới có quyền thực hiện thao tác này!' });
    }
    next();
  });
};

// FIX #1: verifyProjectAccess tự gọi verifyToken bên trong để đảm bảo
// req.user luôn được xác thực, tránh crash khi dùng middleware độc lập.
const verifyProjectAccess = (req, res, next) => {
  verifyToken(req, res, () => {
    const projectId = req.body?.projectId || req.query?.projectId || req.params?.projectId || req.params?.id;

    if (!projectId) {
      return res.status(400).json({ message: 'Thiếu projectId để kiểm tra quyền truy cập!' });
    }

    if (normalizeRole(req.user?.role) === 'admin') {
      return next();
    }

    if (!hasProjectAccess(req.user, projectId)) {
      return res.status(403).json({ message: 'Bạn không có quyền thao tác trên dự án này!' });
    }

    return next();
  });
};

module.exports = { verifyToken, verifyAdmin, verifyProjectAccess, hasProjectAccess, hasProjectPartAccess, getProjectPermissionEntry, normalizeRole };
