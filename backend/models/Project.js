const mongoose = require('mongoose');
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, 
  description: { type: String },
  labels: [{ type: String }], 
  aiModelId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiModel', default: null },
  splitPercent: { type: Number, default: 100, min: 10, max: 100 },
  splitRatios: [{ type: Number }],
  imagesPerPart: { type: Number, default: null },
  partSequence: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Project', projectSchema);
