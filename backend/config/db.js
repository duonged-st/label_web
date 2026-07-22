const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
async function seedDefaultAdmin() {
  try {
    const adminExists = await User.findOne({ username: 'admin' });    
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin', salt);
      await User.create({
        username: "admin",
        password: hashedPassword, 
        role: "admin",
        allowedProjects: []
      });
      console.log("Đã tạo tài khoản 'admin' / Mật khẩu: 'admin'");
    } else {
      console.log("Tài khoản admin đã có sẵn, bỏ qua.");
    }
  } catch (err) {
    console.error("Lỗi khi tự động tạo admin:", err);
  }
}
const connectDB = async () => {  try {
    const conn = await mongoose.connect(process.env.MONGO_URI || 'mongodb://admin:admin@mongodb:27017/image_annotation?authSource=admin');
    console.log(`MongoDB đã kết nối: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Lỗi kết nối MongoDB: ${error.message}`);
    process.exit(1); 
  }
};
module.exports = connectDB;
seedDefaultAdmin();