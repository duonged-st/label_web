import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Search, Loader2 } from 'lucide-react';
export default function ImageManagement() {
  const [images, setImages] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentRole] = useState(() => {
    try {
      const userRaw = localStorage.getItem('user');
      if (userRaw) {
        const parsed = JSON.parse(userRaw);
        if (parsed?.role) return String(parsed.role).toLowerCase();
      }
    } catch (error) {
      console.error('Lỗi đọc quyền người dùng:', error);
    }

    return String(localStorage.getItem('userRole') || '').toLowerCase();
  });
  const [stats, setStats] = useState({ total: 0, labeled: 0, unlabeled: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); 
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterLabel, setFilterLabel] = useState('all');
  const [selectedImages, setSelectedImages] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const isAdmin = currentRole === 'admin';

  const labelOptions = (() => {
    const sourceProjects = filterCategory !== 'all'
      ? projects.filter((project) => String(project._id) === String(filterCategory))
      : projects;

    const labels = sourceProjects.flatMap((project) => Array.isArray(project.labels) ? project.labels : []);
    return Array.from(new Set(labels.map((label) => String(label).trim()).filter(Boolean)));
  })();

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/projects', {
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

  const fetchImages = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      let url = `/api/images?page=${page}&limit=20&personal=true${isAdmin ? '&includePending=true' : ''}`;
      if (filterCategory !== 'all') url += `&projectId=${filterCategory}`;
      if (filterStatus !== 'all') url += `&status=${filterStatus}`;
      if (filterLabel !== 'all') url += `&label=${encodeURIComponent(filterLabel)}`;
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
  }, [page, filterStatus, filterCategory, filterLabel]);

  const displayedImages = images.filter(img => {
    const fileNameMatches = img.filename?.toLowerCase().includes(searchQuery.toLowerCase());
    const labelMatches = img.finalLabels?.some(label => label.toLowerCase().includes(searchQuery.toLowerCase()));
    return fileNameMatches || labelMatches;
  });

  const toggleImageSelection = (id) => {
    setSelectedImages(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn ${selectedImages.length} ảnh này khỏi hệ thống?`)) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const results = await Promise.allSettled(selectedImages.map(id =>
        fetch(`/api/images/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ));
      const failedCount = results.filter((result) => result.status === 'rejected' || !result.value.ok).length;
      if (failedCount > 0) {
        alert(`${failedCount} ảnh chưa xóa được. Vui lòng thử lại.`);
      } else {
        alert('Đã xóa ảnh thành công!');
      }
      setSelectedImages([]);
      await fetchImages();
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
        await fetchImages();
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

        <div className="bg-white border border-gray-200 rounded p-4 mb-4 flex gap-6 text-sm">
          <div>Tổng số ảnh trong bộ lọc: <strong className="text-blue-600">{stats.total}</strong></div>
          <div className="text-gray-500 italic">*Chọn bộ lọc bên dưới để xem chi tiết</div>
        </div>

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

            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded outline-none"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="Đã gán">Đã gán nhãn</option>
              <option value="Chưa gán">Chưa gán nhãn</option>
              {isAdmin && <option value="Chờ xóa">Chờ xóa</option>}
            </select>

            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setFilterLabel('all'); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded outline-none max-w-xs"
            >
              <option value="all">Tất cả dự án</option>
              {projects.map(p => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>

            <select
              value={filterLabel}
              onChange={(e) => { setFilterLabel(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded outline-none max-w-xs"
            >
              <option value="all">Tất cả nhãn</option>
              {labelOptions.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
          </div>

          {isAdmin && (
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
          )}
        </div>

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
                  <div className="relative aspect-square bg-gray-100 group cursor-pointer" onClick={() => toggleImageSelection(image._id)}>
                    {image.deletionPending ? (
                      <div className="w-full h-full flex items-center justify-center px-5 text-center text-sm text-gray-600">
                        Ảnh đang chờ dọn dữ liệu. Chọn ảnh và nhấn Xóa để thử lại.
                      </div>
                    ) : (
                      <img
                        src={image.path}
                        alt={image.filename}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )}

                    <div className={`absolute top-2 right-2 px-2 py-1 rounded text-xs font-medium ${
                      image.deletionPending ? 'bg-gray-700 text-white shadow-sm' :
                        image.status === 'Đã gán' ? 'bg-green-500 text-white shadow-sm' : 'bg-orange-500 text-white shadow-sm'
                    }`}>
                      {image.status}
                    </div>

                    <input
                      type="checkbox"
                      checked={selectedImages.includes(image._id)}
                      onChange={() => toggleImageSelection(image._id)}
                      className="absolute top-3 left-3 w-4 h-4 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  <div className="p-3">
                    <h3 className="font-medium text-sm mb-1 truncate" title={image.filename}>
                      {image.filename}
                    </h3>
                    <p className="text-xs text-gray-500 mb-2 truncate">
                      Dự án: <span className="font-medium text-gray-700">{image.projectId?.name || 'Không xác định'}</span>
                    </p>

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
                      <div className="h-6 mb-2" />
                    )}  
                    <div className="text-xs text-gray-400 mt-2">
                      Upload: {formatDate(image.uploadDate || image.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!isLoading && displayedImages.length === 0 && (
              <div className="bg-white border border-gray-200 rounded p-12 text-center">
                <Search className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <h3 className="font-medium mb-1 text-gray-800">Không tìm thấy ảnh</h3>
                <p className="text-sm text-gray-500">Thử thay đổi bộ lọc, trang hoặc tải thêm ảnh lên hệ thống.</p>
              </div>
            )}

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
