const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { jwtSecret } = require('../config/security');
const { validateAccountCredentials } = require('../utils/accountSecurity');
const router = express.Router();

const AUTH_LOG_DIR = path.join(__dirname, '..', 'logs');
const AUTH_LOG_FILE = path.join(AUTH_LOG_DIR, 'auth.log');

const appendAuthLogToFile = async (line) => {
  try {
    await fs.promises.mkdir(AUTH_LOG_DIR, { recursive: true });
    await fs.promises.appendFile(AUTH_LOG_FILE, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Lỗi ghi auth log ra file:', error);
  }
};

const formatHcmTimestamp = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    fractionalSecondDigits: 3
  });

  return formatter.format(date).replace(' ', 'T');
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

const logAuthEvent = ({ type, username = 'unknown', role = 'unknown', reason = '', req }) => {
  const at = formatHcmTimestamp();
  const ip = getClientIp(req);
  const reasonPart = reason ? ` reason=${reason}` : '';
  const logLine = `[AUTH][${type}] user=${username} role=${role}${reasonPart} ip=${ip} at=${at}`;
  console.log(logLine);
  appendAuthLogToFile(logLine);
};

router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
  }

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu!' });
    }
    const normalizeRole = String(user.role).toLowerCase(); 
    const token = jwt.sign(
      { userId: user._id, role: normalizeRole },
      jwtSecret,
      { expiresIn: '1h' }
    );
    logAuthEvent({ type: 'LOGIN_SUCCESS', username: user.username, role: normalizeRole, req });
    res.json({ message: 'Đăng nhập thành công', token, role: normalizeRole, username: user.username });
  } catch (error) {
    console.error("Chi tiết lỗi:", error);
    res.status(500).json({ message: 'Lỗi server' });
  }
});

router.post('/auth-activity', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const tokenFromHeader = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const tokenFromBody = String(req.body?.token || '').trim();
  const token = tokenFromHeader || tokenFromBody;
  const event = String(req.body?.event || 'UNKNOWN').toUpperCase();
  const reason = String(req.body?.reason || '').trim();

  if (!token) {
    logAuthEvent({ type: event || 'UNKNOWN', reason: reason || 'missing_token', req });
    return res.status(200).json({ message: 'Đã ghi nhận activity (không có token).' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.userId).select('username role');

    if (!user) {
      logAuthEvent({ type: event || 'UNKNOWN', reason: reason || 'user_not_found', req });
      return res.status(200).json({ message: 'Đã ghi nhận activity (không tìm thấy user).' });
    }

    logAuthEvent({
      type: event || 'UNKNOWN',
      username: user.username,
      role: String(user.role || 'user').toLowerCase(),
      reason,
      req
    });

    return res.status(200).json({ message: 'Đã ghi nhận activity.' });
  } catch (error) {
    logAuthEvent({ type: event || 'UNKNOWN', reason: reason || 'invalid_or_expired_token', req });
    return res.status(200).json({ message: 'Đã ghi nhận activity (token không hợp lệ/hết hạn).' });
  }
});

router.post('/register', async (req, res) => {
  const hasPrivilegedFields = ['role', 'allowedProjects', 'projectPermissions']
    .some((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));

  if (hasPrivilegedFields) {
    return res.status(400).json({
      message: 'Đăng ký công khai không được phép tự cấp vai trò hoặc quyền dự án.'
    });
  }

  const { username, password, error } = validateAccountCredentials(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const existingUser = await User.findOne({ username }).select('_id');
    if (existingUser) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      username,
      password: hashedPassword,
      role: 'user',
      allowedProjects: [],
      projectPermissions: []
    });

    await user.save();
    return res.status(201).json({ message: 'Tạo tài khoản thành công!', role: 'user' });
  } catch (registerError) {
    if (registerError?.code === 11000) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại!' });
    }
    console.error('Chi tiết lỗi đăng ký:', registerError);
    return res.status(500).json({ message: 'Lỗi server' });
  }
});
module.exports = router;
