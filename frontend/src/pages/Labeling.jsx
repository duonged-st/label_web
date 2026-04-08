import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
export default function Labeling() {
  // State quản lý dữ liệu từ API
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [images, setImages] = useState([]);
  // State quản lý UI
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  // Xử lý URL ảnh từ DB
  const getImageUrl = (path) => {
    if (!path) return '';
    // Chuyển đổi URL cũ (http://minio:9000/...) sang proxy path
    if (path.includes('minio:9000')) {
      return path.replace(/http:\/\/minio:9000/, '/minio-storage');
    }
    return path;
  };
  // Lấy tên file từ đường dẫn (vd: image_001.jpg)
  const getFileName = (path) => {
    if (!path) return 'Unknown';
    return path.split(/[/\\]/).pop();
  };
  // 1. Tải danh sách dự án
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/projects', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
          setProjects(data);
          if (data.length > 0) setSelectedProjectId(data[0]._id);
        }
      } catch (error) {
        console.error('Lỗi tải danh sách dự án:', error);
      }
    };
    fetchProjects();
  }, []);

  // 2. Tải danh sách ảnh khi chọn Dự án
  useEffect(() => {
    if (!selectedProjectId) {
      setImages([]);
      return;
    }
    const fetchImages = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/images?projectId=${selectedProjectId}&limit=100`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
          const fetchedImages = data.images || [];
          setImages(fetchedImages);
          if (fetchedImages.length > 0) {
            setSelectedImageId(fetchedImages[0]._id);
          } else {
            setSelectedImageId(null);
          }
          setSelectedLabels([]);
        }
      } catch (error) {
        console.error('Lỗi tải danh sách ảnh:', error);
      }
    }; 
    fetchImages();
  }, [selectedProjectId]);

  const selectedProject = projects.find(p => p._id === selectedProjectId);
  const currentImage = images.find(img => img._id === selectedImageId);

  // Tự động load nhãn cũ nếu ảnh đã được gán
  useEffect(() => {
    if (currentImage) {
      setSelectedLabels(
        currentImage.finalLabels && currentImage.finalLabels.length > 0 
          ? currentImage.finalLabels 
          : []
      );
    }
  }, [selectedImageId, currentImage]);

  // 3. Xử lý Lưu Nhãn
  const handleSaveLabel = async () => {
    if (!selectedLabels.length) {
      alert('Vui lòng chọn ít nhất một nhãn để lưu');
      return;
    }
    if (!currentImage) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({
          imageId: currentImage._id,
          projectId: selectedProjectId,
          finalLabels: selectedLabels
        })
      });

      if (response.ok) {
        // Cập nhật state để thẻ ảnh bên trái biến thành màu xanh lá
        const newImages = images.map(img => 
          img._id === currentImage._id 
            ? { ...img, status: 'Đã gán', finalLabels: selectedLabels } 
            : img
        );
        setImages(newImages);
        alert(`Đã lưu nhãn "${selectedLabels.join(', ')}" cho ảnh ${getFileName(currentImage.path)}`);
      } else {
        alert('Lỗi khi lưu nhãn!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Xử lý Nút Reset
  const handleReset = async () => {
    if (!currentImage) return;

    // Nếu ảnh đã lưu vào CSDL, gọi API xóa để gỡ màu xanh
    if (currentImage.status === 'Đã gán') {
      if (!window.confirm('Ảnh này đã lưu nhãn. Bạn có chắc muốn xóa nhãn trên hệ thống?')) return;
      
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/evaluate/${currentImage._id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const newImages = images.map(img => 
            img._id === currentImage._id 
              ? { ...img, status: 'Chưa gán', finalLabels: [] } 
              : img
          );
          setImages(newImages);
          setSelectedLabels([]);
        }
      } catch (error) {
        console.error('Lỗi reset nhãn:', error);
      }
    } else {
      // Nếu chưa lưu, chỉ xóa lựa chọn nhãn đang bấm nháp trên màn hình
      setSelectedLabels([]);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="flex flex-1 overflow-hidden h-screen">
        
        {/* SIDEBAR TRÁI: Chọn dự án & Danh sách ảnh */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
          {/* Khu vực chọn Dự án ngay bên trong */}
          <div className="p-3 border-b border-gray-200">
            <div className="text-xs text-gray-500 mb-1">Bộ dữ liệu:</div>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full border border-gray-300 rounded p-1.5 text-sm font-bold focus:outline-none focus:border-blue-500 text-gray-800 bg-white"
            >
              {projects.length === 0 ? (
                <option value="">Chưa có dữ liệu</option>
              ) : (
                projects.map(p => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))
              )}
            </select>
          </div>
          
          <div className="p-3 border-b border-gray-200">
            <h2 className="font-bold text-sm">Image list</h2>
          </div>
          
          {/* Danh sách ảnh */}
          <div className="p-2 overflow-y-auto flex-1">
            {images.map((image) => {
              const fileName = getFileName(image.path);
              return (
                <button
                  key={image._id}
                  onClick={() => setSelectedImageId(image._id)}
                  className={`w-full text-left px-3 py-2 text-sm rounded mb-1 truncate transition-colors ${
                    image.status === 'Đã gán'
                      ? 'bg-green-100 text-green-700 border border-green-300' // Bôi xanh lá
                      : selectedImageId === image._id
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                  title={fileName}
                >
                  {fileName}
                </button>
              );
            })}
          </div>
        </aside>

        {/* NỘI DUNG CHÍNH (MAIN CONTENT) */}
        <main className="flex-1 p-6 overflow-y-auto">
          {currentImage ? (
            <div className="max-w-4xl mx-auto">
              
              {/* Header */}
              <h1 className="text-xl font-bold mb-4 text-gray-800">
                Classification of {getFileName(currentImage.path)}
              </h1>

              {/* Selected Image */}
              <div className="bg-white border border-gray-200 rounded p-6 mb-6 shadow-sm">
                <div className="flex justify-center">
                  <img
                    src={getImageUrl(currentImage.path)}
                    alt={getFileName(currentImage.path)}
                    className="max-w-full max-h-[50vh] object-contain border border-gray-200"
                  />
                </div>
              </div>

              {/* Control Buttons - Đúng 2 nút con yêu cầu đặt dưới ảnh */}
              <div className="flex gap-3 mb-6">
                <button
                  onClick={handleSaveLabel}
                  disabled={!selectedLabels.length || isLoading}
                  className="px-6 py-2 bg-green-400 hover:bg-green-500 text-white rounded font-medium disabled:opacity-50 transition-colors"
                >
                  {isLoading ? 'Đang lưu...' : 'Lưu nhãn'}
                </button>
                <button
                  onClick={handleReset}
                  className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-medium transition-colors"
                >
                  Reset
                </button>
              </div>

              {/* Manual Labels */}
              <div className="bg-white border border-gray-200 rounded p-5 shadow-sm">
                <h2 className="font-bold mb-4 text-gray-800 text-lg">Gán nhãn thủ công</h2>
                {!selectedProject || !selectedProject.labels || selectedProject.labels.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Bộ dữ liệu này chưa có nhãn.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {selectedProject.labels.map((label) => (
                      <button
                        key={label}
                        onClick={() => {
                          if (selectedLabels.includes(label)) {
                            setSelectedLabels(selectedLabels.filter((l) => l !== label));
                          } else {
                            setSelectedLabels([...selectedLabels, label]);
                          }
                        }}
                        className={`px-6 py-2.5 border rounded font-medium transition-colors ${
                          selectedLabels.includes(label)
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                            : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded p-12 text-center shadow-sm mt-10">
              <p className="text-gray-500">Hãy chọn một bộ dữ liệu và click vào ảnh để bắt đầu gán nhãn.</p>
            </div>
          )}
        </main>
        
      </div>
    </div>
  );
}