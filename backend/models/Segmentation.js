const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  imageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Image', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  // Geometry is strictly validated and whitelisted by segmentationValidation.
  regions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  revision: { type: Number, default: 1 }
}, { timestamps: true });
schema.index({ imageId: 1, userId: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1 });
module.exports = mongoose.model('Segmentation', schema);
