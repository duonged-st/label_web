const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
async function seedDefaultAdmin() {
  const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');

  if (!adminUsername && !adminPassword) {
    console.warn('Bỏ qua tạo admin mặc định: chưa cấu hình ADMIN_USERNAME và ADMIN_PASSWORD.');
    return;
  }

  if (!adminUsername || adminPassword.length < 12) {
    throw new Error('ADMIN_USERNAME và ADMIN_PASSWORD (ít nhất 12 ký tự) phải được cấu hình cùng nhau.');
  }

  try {
    const adminExists = await User.findOne({ username: adminUsername });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);
      await User.create({
        username: adminUsername,
        password: hashedPassword,
        role: 'admin',
        allowedProjects: []
      });
      console.log(`Đã tạo tài khoản quản trị '${adminUsername}'.`);
    } else {
      console.log('Tài khoản quản trị đã có sẵn, bỏ qua.');
    }
  } catch (err) {
    console.error('Lỗi khi tự động tạo admin:', err);
    throw err;
  }
}
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://admin:admin@mongodb:27017/image_annotation?authSource=admin');
    console.log(`MongoDB đã kết nối: ${conn.connection.host}`);
    await seedDefaultAdmin();
  } catch (error) {
    console.error(`Lỗi kết nối MongoDB: ${error.message}`);
    process.exit(1);
  }
};
module.exports = connectDB;
