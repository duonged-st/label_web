const mongoose = require('mongoose');
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // Tên danh mục (Người dùng, Sản phẩm...)
  description: { type: String },
  labels: [{ type: String }], // Các nhãn gán riêng cho danh mục này
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Project', projectSchema);