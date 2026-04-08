const express = require('express');
const cors = require('cors'); 
const connectDB = require('./config/db'); 
const path = require('path');
const app = express();
const authRoutes = require('./controllers/auth'); // Import routes cho auth
const projectRoutes = require('./controllers/project'); // Import routes cho Project
const uploadRoutes = require('./controllers/upload'); // Import routes cho Upload
const imageRoutes = require('./controllers/image'); // Import routes cho Image
const evaluateRoutes = require('./controllers/evaluate'); // Import routes cho Evaluate
const statisticsRoutes = require('./controllers/statistics'); // Import routes cho Statistics
const userRoutes = require('./controllers/user'); // Import routes cho User
const exportRoutes = require('./controllers/export'); // Import routes cho Export
const { verifyToken } = require('./middleware/authmiddleware'); // Import middleware xác thực
// Kết nối database
connectDB();
// Middleware để đọc JSON
app.use(express.json());
// Gắn cái authRoutes vào tiền tố /api
app.use(cors()); // 2. Sử dụng cors middleware
app.use('/api', authRoutes);  // Gắn routes cho auth
app.use('/api', uploadRoutes); // Gắn routes cho Upload (để không cần auth vẫn có thể upload ảnh) - Lưu ý: Nếu muốn bảo vệ route upload, hãy gắn middleware verifyToken vào trước nó như app.use('/api/upload', verifyToken, uploadRoutes);
app.use('/api', verifyToken); // 3. Gắn middleware xác thực cho tất cả các routes phía sau (trừ auth)
app.use('/api', imageRoutes); // Gắn routes cho Image
app.use('/api', projectRoutes); // Gắn routes cho Project
// app.use('/api', uploadRoutes); // Gắn routes cho Upload
app.use('/api', evaluateRoutes); // Gắn routes cho Evaluate
app.use('/api', statisticsRoutes); // Gắn routes cho Statistics
app.use('/api', userRoutes); // Gắn routes cho User
app.use('/api', exportRoutes); // Gắn routes cho Export
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Cho phép truy cập trực tiếp vào thư mục uploads để lấy ảnh
// Khởi động server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server backend đang chạy ở http://backend:${PORT}`);
});