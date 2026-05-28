import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'; 
import { getLabelStyleByPosition } from '../utils/labelStyle';
import { shuffleWithSeed } from '../utils/seededShuffle';
export default function Labeling() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [images, setImages] = useState([]);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(2);
  const [shuffleSeed, setShuffleSeed] = useState('');

  const getImageUrl = (path) => {
    if (!path) return '';
    if (path.includes('minio:9000')) {
      return path.replace(/http:\/\/minio:9000/, '/minio-storage');
    }
    return path;
  };

  const getFileName = (path) => {
    if (!path) return 'Unknown';
    return path.split(/[/\\]/).pop();
  };

  useEffect(() => {
    const fetchShuffleSeed = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/users/me/shuffle-seed', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const data = await response.json();
          setShuffleSeed(data.shuffleSeed || '');
        } else {
          setShuffleSeed('fallback-seed');
        }
      } catch (error) {
        console.error('Lỗi lấy seed trộn ảnh:', error);
        setShuffleSeed('fallback-seed');
      }
    };

    fetchShuffleSeed();

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

  useEffect(() => {
    if (!selectedProjectId || !shuffleSeed) {
      setImages([]);
      return;
    }
    const fetchImages = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/images?projectId=${selectedProjectId}&limit=all&personal=true`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (response.ok) {
          const fetchedImages = shuffleWithSeed(data.images || [], shuffleSeed);
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
  }, [selectedProjectId, shuffleSeed]);

  const selectedProject = projects.find(p => p._id === selectedProjectId);
  const currentImage = images.find(img => img._id === selectedImageId);
  const currentIndex = currentImage ? images.findIndex(img => img._id === selectedImageId) + 1 : 0;
  const totalImages = images.length;
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

  const handleReset = async () => {
    if (!currentImage) return;
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
      setSelectedLabels([]);
    }
  };

  const getSelectedLabelStyle = (label) => {
    const index = selectedLabels.indexOf(label);
    return getLabelStyleByPosition(index, selectedLabels.length);
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="flex flex-1 overflow-hidden h-screen">

        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
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
          <div className="p-3 border-b border-gray-200 flex justify-between items-center">
            <h2 className="font-bold text-sm text-gray-800">Image list</h2>
            {totalImages > 0 && (
              <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                {currentIndex} / {totalImages}
              </span>
            )}
          </div>

          <div className="p-2 overflow-y-auto flex-1">
            {images.map((image) => {
              const fileName = getFileName(image.path);
              return (
                <button
                  key={image._id}
                  onClick={() => setSelectedImageId(image._id)}
                  className={`w-full text-left px-3 py-2 text-sm rounded mb-1 truncate transition-colors ${
                    image.status === 'Đã gán'
                      ? 'bg-green-100 text-green-700 border border-green-300'
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

        <main className="flex-1 p-6 overflow-y-auto">
          {currentImage ? (
            <div className="max-w-4xl mx-auto">

              <h className="text-xl font-bold mb-4 text-gray-800">
                Classification of {getFileName(currentImage.path)}
              </h>

              <div className="bg-white border border-gray-200 rounded p-6 mb-6 shadow-sm flex flex-col items-center">
                <div className="relative w-full h-[50vh] flex justify-center items-center bg-gray-100 rounded border border-gray-200 overflow-hidden">
                  <img
                    src={getImageUrl(currentImage.path)}
                    alt={getFileName(currentImage.path)}
                    style={{ transform: `scale(${zoomLevel})`, transition: 'transform 0.2s ease-in-out' }}
                    className="max-w-full max-h-full object-contain origin-center"
                  />
                </div>

                <div className="mt-4 flex items-center gap-4 w-full max-w-md bg-gray-50 px-4 py-2 rounded border border-gray-200">
                  <ZoomOut className="w-4 h-4 text-gray-500" />
                  <input
                    type="range" min="0.5" max="4" step="0.1"
                    value={zoomLevel}
                    onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
                    className="flex-1 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <ZoomIn className="w-4 h-4 text-gray-500" />
                  <div className="w-12 text-right text-sm font-medium text-gray-700">
                    {Math.round(zoomLevel * 100)}%
                  </div>
                  <button 
                    onClick={() => setZoomLevel(2)} 
                    className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

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
                            ? 'shadow-sm'
                            : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                        }`}
                        style={selectedLabels.includes(label) ? getSelectedLabelStyle(label) : undefined}
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