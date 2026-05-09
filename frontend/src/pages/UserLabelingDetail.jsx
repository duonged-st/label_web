import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navigation from '../components/Navigation';
import { ArrowLeft, Download, Loader2, Search } from 'lucide-react';

export default function UserLabelingDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState({
    userName: '',
    evaluations: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleExportUserCSV = async () => {
    try {
      setIsExporting(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/export/user/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert(errorData.message || 'Lỗi khi xuất file CSV!');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = String(data.userName || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `User_${safeName}_Labeling.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Lỗi xuất CSV theo người dùng:', error);
      alert('Không thể tải file lúc này!');
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const fetchUserDetail = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/statistics/user/${userId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const result = await response.json();
          setData({
            userName: result.userName || 'Unknown User',
            evaluations: result.evaluations || []
          });
        } else {
          alert('Không thể tải dữ liệu người dùng.');
        }
      } catch (error) {
        console.error('Lỗi tải chi tiết người dùng:', error);
        alert('Lỗi kết nối đến server.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserDetail();
  }, [userId]);

  const filteredEvaluations = data.evaluations.filter((evaluation) => {
    const fileNameMatches = evaluation.filename?.toLowerCase().includes(searchQuery.toLowerCase());
    const labelsMatch = evaluation.finalLabels?.some(label => label.toLowerCase().includes(searchQuery.toLowerCase()));
    return fileNameMatches || labelsMatch;
  });

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

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6 overflow-y-auto">
      
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/statistics')}
            className="flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
            title="Quay lại trang thống kê"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Quay lại</span>
          </button>
          <h1 className="text-2xl font-bold text-gray-800">Chi tiết gán nhãn: {data.userName}</h1>
          </div>
          <button
            onClick={handleExportUserCSV}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm font-medium transition-colors disabled:opacity-60"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Xuất dữ liệu CSV
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded p-4 mb-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500 mb-2 uppercase tracking-wide">Tổng ảnh đã gán nhãn</p>
          <p className="text-3xl font-extrabold text-blue-600">{data.evaluations.length}</p>
        </div>


        <div className="bg-white border border-gray-200 rounded p-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Tìm theo tên file hoặc nhãn..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
            />
          </div>
        </div>

     
        {filteredEvaluations.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded p-12 text-center">
            {data.evaluations.length === 0 ? (
              <>
                <p className="text-gray-500 text-lg">Người dùng này chưa gán nhãn cho ảnh nào.</p>
              </>
            ) : (
              <>
                <Search className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">Không tìm thấy ảnh phù hợp với tìm kiếm.</p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredEvaluations.map((evaluation, index) => (
              <div key={index} className="bg-white border border-gray-200 rounded overflow-hidden shadow-sm hover:shadow-md transition-shadow">
        
                <div className="relative aspect-square bg-gray-100">
                  <img
                    src={evaluation.path}
                    alt={evaluation.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>

                <div className="p-3">
                  <h3 className="font-medium text-sm mb-2 truncate" title={evaluation.filename}>
                    {evaluation.filename}
                  </h3>

                  <p className="text-xs text-gray-500 mb-2">
                    Dự án: <span className="font-medium text-gray-700">{evaluation.projectName}</span>
                  </p>

                  {evaluation.finalLabels && evaluation.finalLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {evaluation.finalLabels.map((label, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded border border-green-200 font-medium"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Chưa có nhãn</p>
                  )}

                  {evaluation.evaluatedAt && (
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(evaluation.evaluatedAt).toLocaleDateString('vi-VN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
