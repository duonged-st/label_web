const mongoose = require('mongoose');
const evaluationSchema = new mongoose.Schema({
  imageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Image', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  finalLabels: [{ type: String, required: true }], 
  evaluatedAt: { type: Date, default: Date.now }
});

evaluationSchema.index({ imageId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Evaluation', evaluationSchema);