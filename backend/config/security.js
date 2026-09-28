const rawSecret = String(process.env.JWT_SECRET || '').trim();
const DEFAULT_JWT_SECRET = 'default_jwt_secret_image_annotation_dev_key_32chars_min';

// Nếu có cấu hình JWT_SECRET và >= 32 ký tự thì ưu tiên dùng
// Nếu chưa cấu hình hoặc quá ngắn thì tự động dùng secret mặc định để không bị crash
let jwtSecret = rawSecret;
if (jwtSecret.length < 32) {
  jwtSecret = DEFAULT_JWT_SECRET;
  console.warn('⚠️ [BẢO MẬT] JWT_SECRET chưa được cấu hình hoặc dưới 32 ký tự trong .env. Đang tự động sử dụng khóa mặc định.');
}

module.exports = { jwtSecret };

