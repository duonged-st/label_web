const mongoose = require('mongoose');

const aiModelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  dbVersion: { type: String, required: true, trim: true },
  minioPath: { type: String, required: true, trim: true, unique: true },
  bucketName: { type: String, required: true, default: 'aimodels', trim: true },
  originalFileName: { type: String, default: null, trim: true },
  fileSize: { type: Number, default: null },
  description: { type: String, default: '' },
  labelMap: { type: Object, default: null },
}, { timestamps: true });

module.exports = mongoose.model('AiModel', aiModelSchema);