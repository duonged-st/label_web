const mongoose = require('mongoose');
const imageSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  path: { type: String, required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  status: { type: String, default: 'Chưa gán' }, 
  uploadDate: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Image', imageSchema);