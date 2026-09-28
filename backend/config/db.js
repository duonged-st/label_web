const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
async function seedDefaultAdmin() {
  const customUsername = String(process.env.ADMIN_USERNAME || '').trim();
  const customPassword = String(process.env.ADMIN_PASSWORD || '').trim();

  // Xác định username và password admin (ưu tiên env, nếu không có thì dùng mặc định)
  const adminUsername = customUsername || 'admin';
  const adminPassword = customPassword || 'admin12345678';

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
      console.log(`✅ Đã khởi tạo tài khoản quản trị mặc định: '${adminUsername}'`);
    } else {
      console.log(`ℹ️ Tài khoản quản trị '${adminUsername}' đã có sẵn trong cơ sở dữ liệu.`);
    }
  } catch (err) {
    console.error('⚠️ Lỗi khi khởi tạo tài khoản admin mặc định:', err.message);
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
