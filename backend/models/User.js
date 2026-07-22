const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user' , enum: ['user', 'admin']},
  labelingShuffleSeed: { type: String, default: null },
  allowedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
  projectPermissions: [{
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    partIds: [{ type: String, required: true }]
  }]
});
module.exports = mongoose.model('User', userSchema);