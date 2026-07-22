const express = require('express');
const cors = require('cors'); 
const connectDB = require('./config/db'); 
const path = require('path');
const app = express();
const authRoutes = require('./controllers/auth');
const projectRoutes = require('./controllers/project');
const uploadRoutes = require('./controllers/upload');
const aiModelRoutes = require('./controllers/aiModel');
const imageRoutes = require('./controllers/image');
const evaluateRoutes = require('./controllers/evaluate');
const statisticsRoutes = require('./controllers/statistics');
const userRoutes = require('./controllers/user');
const exportRoutes = require('./controllers/export');
const { verifyToken } = require('./middleware/authmiddleware');
connectDB();

// Prevent stale API responses from browser/proxy caches.
app.set('etag', false);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(cors());
app.use('/api', authRoutes);
app.use('/api', verifyToken);
app.use('/api', imageRoutes);
app.use('/api', projectRoutes);
app.use('/api', uploadRoutes);
app.use('/api', aiModelRoutes);
app.use('/api', evaluateRoutes);
app.use('/api', statisticsRoutes);
app.use('/api', userRoutes);
app.use('/api', exportRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server backend đang chạy ở http://localhost:${PORT}`);
});