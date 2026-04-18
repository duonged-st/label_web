import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Download, Loader2 } from 'lucide-react';

export default function Statistics() {
  const [data, setData] = useState({
    totalLabeledImages: 0,
    userStatistics: [],
    projectStatistics: []
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStatistics = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/statistics/dashboard', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const result = await response.json();
          setData({
            totalLabeledImages: result.totalLabeledImages || 0,
            userStatistics: result.userStatistics || [],
            projectStatistics: result.projectStatistics || result.projectStats || []
          });
        }
      } catch (error) {
        console.error('Lỗi tải thống kê:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStatistics();
  }, []);

  const handleExportCSV = async (projectId, projectName) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/export/${projectId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(errorData.message || 'Lỗi khi xuất file!');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `DuAn_${projectName}_Export.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Lỗi tải CSV:', error);
      alert('Không thể tải file lúc này!');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Navigation />
        <main className="flex-1 p-6 flex justify-center items-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </main>
      </div>
    );
  }

  const projectStats = data.projectStatistics || data.projectStats || [];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="flex-1 p-6 overflow-y-auto">
        <h1 className="text-2xl font-bold mb-6 text-gray-800">Báo cáo Thống kê</h1>

        <div className="bg-white border border-gray-200 rounded p-6 mb-6 shadow-sm max-w-sm">
          <p className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">Tổng ảnh đã gán nhãn toàn hệ thống</p>
          <p className="text-4xl font-extrabold text-blue-600">{data.totalLabeledImages}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <h2 className="font-bold text-gray-800">Người gán nhãn năng suất</h2>
              </div>
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Người dùng</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Đã gán</th>
                  </tr>
                </thead>
                <tbody>
                  {data.userStatistics.length === 0 ? (
                    <tr><td colSpan="2" className="text-center py-4 text-gray-500">Chưa có dữ liệu</td></tr>
                  ) : (
                    data.userStatistics.map((user, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{user.userName}</td>
                        <td className="px-4 py-3 text-right font-bold text-blue-600">{user.totalLabeled}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <h2 className="font-bold text-xl text-gray-800 mb-2">Tiến độ theo Dự án</h2> 
            {projectStats.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded p-8 text-center text-gray-500">
                Chưa có dự án nào trên hệ thống
              </div>
            ) : (
              projectStats.map((project) => (
                <div key={project._id} className="bg-white border border-gray-200 rounded p-5 shadow-sm">
                  
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-lg text-blue-700">{project.name}</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div className="bg-gray-50 p-3 rounded border border-gray-100">
                      <p className="text-xs text-gray-500 uppercase mb-1">Tổng ảnh</p>
                      <p className="text-xl font-bold">{project.totalImages}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded border border-green-100">
                      <p className="text-xs text-green-600 uppercase mb-1">Đã gán nhãn</p>
                      <p className="text-xl font-bold text-green-700">{project.labeledImages}</p>
                    </div>
                    <div className="bg-orange-50 p-3 rounded border border-orange-100">
                      <p className="text-xs text-orange-600 uppercase mb-1">Chưa gán</p>
                      <p className="text-xl font-bold text-orange-700">{project.unlabeledImages}</p>
                    </div>
                  </div>

                  <div className="w-full bg-gray-200 rounded-full h-2 mb-5 overflow-hidden">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-500" 
                      style={{ width: `${project.totalImages > 0 ? (project.labeledImages / project.totalImages) * 100 : 0}%` }}
                    />
                  </div>

                  <div className="mb-5">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Tỉ lệ phân bổ nhãn đã gán:</p>
                    {project.labelDistribution.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Dự án này chưa được gán nhãn nào.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {project.labelDistribution.map((item, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 border border-gray-200 rounded-full text-sm">
                            <span className="font-medium text-gray-800">{item.label}</span>
                            <span className="text-gray-500">|</span>
                            <span className="font-bold text-blue-600">{item.percentage}%</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex justify-end">
                    <button 
                      onClick={() => handleExportCSV(project._id, project.name)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm font-medium transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Xuất dữ liệu CSV
                    </button>
                  </div>

                </div>
              ))
            )}
          </div>
          
        </div>
      </main>
    </div>
  );
}