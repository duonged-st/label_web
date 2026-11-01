const mongoose = require('mongoose');
const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  storageKey: { type: String },
  path: { type: String, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  partId: { type: String, default: null },
  deletionPending: { type: Boolean, default: false },
  status: { type: String, default: 'Chưa gán' }, 
  uploadDate: { type: Date, default: Date.now }
});
imageSchema.index({ partId: 1, projectId: 1 });
module.exports = mongoose.model('Image', imageSchema);
