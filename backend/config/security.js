const jwtSecret = String(process.env.JWT_SECRET || '').trim();

if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET phải được cấu hình và có ít nhất 32 ký tự.');
}

module.exports = { jwtSecret };
