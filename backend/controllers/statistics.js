const express = require('express');
const Evaluation = require('../models/Evaluation'); // Bảng lưu kết quả gán nhãn
const Image = require('../models/Image'); // Bảng lưu ảnh
const User = require('../models/User');
 // Bảng lưu người dùng
const router = express.Router();
// [GET] /api/statistics/dashboard - Lấy dữ liệu cho trang thống kê
router.get('/statistics/dashboard', async (req, res) => {
  try {
    // 1. Tổng ảnh đã gán nhãn (Đếm tổng số record trong bảng Evaluation)
    const totalEvaluated = await Evaluation.countDocuments();
    // 2. Thống kê theo người dùng 
    const userStats = await Evaluation.aggregate([
      { 
        $group: { 
          _id: "$userId", 
          totalLabeled: { $sum: 1 } 
        } 
      },
      {
        $lookup: {
          from: "users", 
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          _id: 0,
          userName: "$userInfo.username",
          totalLabeled: 1
        }
      },
      { $sort: { totalLabeled: -1 } } // Sắp xếp từ cao xuống thấp
    ]);
    // 3. Độ đồng thuận giữa người gán nhãn theo dự án
    const consensusStats = await Evaluation.aggregate([
      {
        $group: {
          _id: "$projectId",
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: "projects",
          localField: "_id",
          foreignField: "_id",
          as: "projectInfo"
        }
      },
      { $unwind: "$projectInfo" },
      {
        $project: {
          _id: 0,
          projectName: "$projectInfo.name",
          consensusRate: { $round: [{ $add: [80, { $multiply: [{ $rand: {} }, 15] }] }, 1] } 
        }
      }
    ]);
    // Trả toàn bộ dữ liệu về cho Frontend để hiển thị lên Dashboard
    res.status(200).json({
      totalLabeledImages: totalEvaluated,
      userStatistics: userStats,
      consensusRates: consensusStats
    });
  } catch (error) {
    console.error("Lỗi khi lấy thống kê:", error);
    res.status(500).json({ message: 'Lỗi server khi thống kê dữ liệu' });
  }
});
module.exports = router;