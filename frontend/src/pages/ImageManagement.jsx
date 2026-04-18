import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Search, Loader2 } from 'lucide-react';
export default function ImageManagement() {
  const [images, setImages] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({ total: 0, labeled: 0, unlabeled: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); 
  const [filterCategory, setFilterCategory] = useState('all');
  const [selectedImages, setSelectedImages] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 1. Lấy danh sách Dự án
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/projects', { // Nginx sẽ tự proxy sang http://backend:5000/api/projects
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setProjects(data);
        }
      } catch (error) {
        console.error('Lỗi tải danh sách dự án:', error);
      }
    };
    fetchProjects();
  }, []);

  // 2. Lấy danh sách Ảnh
  const fetchImages = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      let url = `/api/images?page=${page}&limit=20`;
      if (filterCategory !== 'all') url += `&projectId=${filterCategory}`;
      if (filterStatus !== 'all') url += `&status=${filterStatus}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setImages(data.images || []);
        setTotalPages(data.totalPages || 1);
        setStats(prev => ({
          ...prev,
          total: data.totalImages
        }));
      }
    } catch (error) {
      console.error('Lỗi tải danh sách ảnh:', error);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    fetchImages();
    setSelectedImages([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterStatus, filterCategory]);
  const displayedImages = images.filter(img => {
    const fileNameMatches = img.filename?.toLowerCase().includes(searchQuery.toLowerCase());
    const labelMatches = img.finalLabels?.some(label => label.toLowerCase().includes(searchQuery.toLowerCase()));
    return fileNameMatches || labelMatches;
  });
  // 4. Xử lý Checkbox chọn ảnh
  const toggleImageSelection = (id) => {
    setSelectedImages(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  // 5. Tính năng XÓA ẢNH thật trên Backend và MinIO
  const handleDeleteSelected = async () => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${selectedImages.length} ảnh này khỏi hệ thống?`)) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      await Promise.all(selectedImages.map(id => 
        fetch(`/api/images/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ));
      alert('Đã xóa ảnh thành công!');
      setSelectedImages([]);
      fetchImages(); 
    } catch (error) {
      console.error('Lỗi khi xóa ảnh:', error);
      alert('Có lỗi xảy ra khi xóa ảnh.');
    } finally {
      setIsLoading(false);
    }
  };
  const handleDeleteAllByProject = async () => {
    if (filterCategory === 'all') {
      alert('Vui lòng chọn một dự án cụ thể trước khi xóa tất cả ảnh.');
      return;
    }
    const selectedProject = projects.find((p) => p._id === filterCategory);
    const projectName = selectedProject?.name || 'dự án đã chọn';
    if (!window.confirm(`Bạn có chắc chắn muốn xóa TOÀN BỘ ảnh của ${projectName}?`)) return;
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/images/project/${filterCategory}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Không thể xóa toàn bộ ảnh của dự án này.');
        return;
      }
      alert(data.message || 'Đã xóa toàn bộ ảnh của dự án.');
      setSelectedImages([]);
      setPage(1);
      fetchImages();
    } catch (error) {
      console.error('Lỗi khi xóa toàn bộ ảnh theo dự án:', error);
      alert('Có lỗi xảy ra khi xóa toàn bộ ảnh theo dự án.');
    } finally {
      setIsLoading(false);
    }
  };
  // Định dạng ngày tháng
  const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />  
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Quản lý ảnh</h1>
        {/* Stats */}
        <div className="bg-white border border-gray-200 rounded p-4 mb-4 flex gap-6 text-sm">
          <div>Tổng số ảnh trong bộ lọc: <strong className="text-blue-600">{stats.total}</strong></div>
          <div className="text-gray-500 italic">*Chọn bộ lọc bên dưới để xem chi tiết</div>
        </div>
        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded p-4 mb-4">
          <div className="flex flex-col md:flex-row gap-3 mb-3">
            {/* Search */}
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
            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded outline-none"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="Đã gán">Đã gán nhãn</option>
              <option value="Chưa gán">Chưa gán nhãn</option>
            </select>
            {/* Category*/}
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded outline-none max-w-xs"
            >
              <option value="all">Tất cả dự án</option>
              {projects.map(p => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
          </div>
          {/* Actions */}
          <div className="flex gap-2">
            <button 
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm disabled:opacity-50 transition-colors"
              disabled={selectedImages.length === 0 || isLoading}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Xóa ({selectedImages.length})
            </button>
            <button
              onClick={handleDeleteAllByProject}
              className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white rounded text-sm disabled:opacity-50 transition-colors"
              disabled={filterCategory === 'all' || isLoading}
              title={filterCategory === 'all' ? 'Hãy chọn dự án cụ thể để xóa toàn bộ ảnh' : 'Xóa toàn bộ ảnh của dự án đang chọn'}
            >
              Xóa tất cả theo dự án
            </button>
          </div>
        </div>
        {/* Images Grid */}
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {displayedImages.map((image) => (
                <div 
                  key={image._id}
                  className={`bg-white border rounded overflow-hidden transition-all ${
                    selectedImages.includes(image._id) ? 'border-blue-500 border-2 shadow-md' : 'border-gray-200 hover:shadow-sm'
                  }`}
                >
                  {/* Image Container */}
                  <div className="relative aspect-square bg-gray-100 group cursor-pointer" onClick={() => toggleImageSelection(image._id)}>
                    {/* Nhờ Nginx proxy, đường dẫn /minio-storage/... từ DB sẽ load được ngay lập tức */}
                    <img 
                      src={image.path} 
                      alt={image.filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Status Badge */}
                    <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium ${
                      image.status === 'Đã gán' ? 'bg-green-500 text-white shadow-sm' : 'bg-orange-500 text-white shadow-sm'
                    }`}>
                      {image.status}
                    </div>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedImages.includes(image._id)}
                      onChange={() => toggleImageSelection(image._id)}
                      className="absolute top-3 left-3 w-4 h-4 cursor-pointer"
                      onClick={(e) => e.stopPropagation()} // Tránh click đúp event
                    />
                  </div>
                  {/* Info */}
                  <div className="p-3">
                    <h3 className="font-medium text-sm mb-1 truncate" title={image.filename}>
                      {image.filename?.split('-').slice(1).join('-') || image.filename} 
                    </h3>
                    <p className="text-xs text-gray-500 mb-2 truncate">
                      Dự án: <span className="font-medium text-gray-700">{image.projectId?.name || 'Không xác định'}</span>
                    </p>
                    {/* Render Labels nếu có */}
                    {image.finalLabels && image.finalLabels.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {image.finalLabels.map((label, idx) => (
                          <span 
                            key={idx}
                            className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded border border-blue-200"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="h-6 mb-2"></div> // Giữ layout không bị xô lệch
                    )}  
                    <div className="text-xs text-gray-400 mt-2">
                      Upload: {formatDate(image.uploadDate || image.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* Empty State */}
            {!isLoading && displayedImages.length === 0 && (
              <div className="bg-white border border-gray-200 rounded p-12 text-center">
                <Search className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <h3 className="font-medium mb-1 text-gray-800">Không tìm thấy ảnh</h3>
                <p className="text-sm text-gray-500">Thử thay đổi bộ lọc, trang hoặc tải thêm ảnh lên hệ thống.</p>
              </div>
            )}
            {/* Phân trang (Pagination) */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button 
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                >
                  Trang trước
                </button>
                <span className="text-sm font-medium text-gray-700">
                  Trang {page} / {totalPages}
                </span>
                <button 
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-4 py-2 border border-gray-300 rounded disabled:opacity-50 hover:bg-gray-50"
                >
                  Trang sau
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}