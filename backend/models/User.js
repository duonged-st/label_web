const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  allowedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }] 
});
module.exports = mongoose.model('User', userSchema);