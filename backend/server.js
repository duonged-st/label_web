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
const segmentationRoutes = require('./controllers/segmentation');
const statisticsRoutes = require('./controllers/statistics');
const userRoutes = require('./controllers/user');
const exportRoutes = require('./controllers/export');
const { verifyToken } = require('./middleware/authmiddleware');

connectDB();

const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set(
  configuredOrigins.length > 0
    ? configuredOrigins
    : [
        'http://localhost',
        'http://localhost:80',
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:5173',
        'http://127.0.0.1',
        'http://127.0.0.1:80',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:5173'
      ]
);

const isCorsPermissive = configuredOrigins.length === 0 || allowedOrigins.has('*');

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
app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || isCorsPermissive || allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

app.use('/api', authRoutes);
app.use('/api', verifyToken);
app.use('/api', imageRoutes);
app.use('/api', projectRoutes);
app.use('/api', uploadRoutes);
app.use('/api', aiModelRoutes);
app.use('/api', evaluateRoutes);
app.use('/api', segmentationRoutes);
app.use('/api', statisticsRoutes);
app.use('/api', userRoutes);
app.use('/api', exportRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const PORT = Number(process.env.PORT) || 5000;
app.listen(PORT, () => {
  console.log(`Server backend đang chạy ở http://localhost:${PORT}`);
});
