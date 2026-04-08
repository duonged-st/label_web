const jwt = require('jsonwebtoken');
// 1. Chốt chặn cơ bản: Yêu cầu phải đăng nhập (Có Token hợp lệ)
const verifyToken = (req, res, next) => {
  // Frontend sẽ gửi token qua header Authorization dạng: "Bearer <token_chuoi_dai_ngoang>"
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1]; // Tách chữ Bearer ra để lấy cái lõi tok****en
  if (!token) {
    return res.status(401).json({ message: 'Từ chối truy cập! Vui lòng đăng nhập.' });
  }
  try {
    // Giải mã token bằng mã bí mật
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chuoi_bao_mat_cua_ban');  
    // Lưu thông tin user (gồm userId và role) vào request để các API phía sau xài
    req.user = decoded; 
    next(); // Cho phép đi tiếp vào API
  } catch (error) {
    return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn!' });
  }
};
// 2. Chốt chặn cấp cao: Yêu cầu quyền Admin 
const verifyAdmin = (req, res, next) => {
  verifyToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Chỉ Admin mới có quyền thực hiện thao tác này!' });
    }
    next(); // Là admin thì cho qua
  });
};
module.exports = { verifyToken, verifyAdmin };