import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Upload, X, Folder } from 'lucide-react';
export default function Dashboard() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
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
          // Nếu có dự án, tự động chọn dự án đầu tiên làm mặc định
          if (data.length > 0) {
            setSelectedProjectId(data[0]._id);
          }
        }
      } catch (error) {
        console.error('Lỗi tải danh sách dự án:', error);
      }
    };
    fetchProjects();
  }, []);
  const handleFileSelect = (e) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };
  const handleFolderSelect = (e) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).filter(file => 
        file.type.startsWith('image/')
      );
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
  };
  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };
  // Hàm này đã được "bố" nâng cấp để bắn API lên Backend thật
  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      alert('Vui lòng chọn ảnh để upload');
      return;
    }
    if (!selectedProjectId) {
      alert('Vui lòng chọn dự án');
      return;
    }
    try {
      // Đóng gói ảnh vào FormData
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('images', file);
      });
      formData.append('projectId', selectedProjectId);
      // Lấy thẻ Token từ localStorage
      const token = localStorage.getItem('token');
      // Bắn lên server
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}` // Trình thẻ cho bảo vệ
        },
        body: formData,
      });
      const data = await response.json();
      if (response.ok) {
        alert(`Đã upload thành công ${selectedFiles.length} ảnh vào dự án ${projects.find(p => p._id === selectedProjectId)?.name}`);
        setSelectedFiles([]); // Upload xong thì xóa trắng danh sách đã chọn
      } else {
        alert(data.message || 'Lỗi khi tải ảnh lên!');
      }
    } catch (error) {
      console.error('Lỗi kết nối:', error);
      alert('Không thể kết nối đến server!');
    }
  };
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Navigation Sidebar */}
      <Navigation />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Upload ảnh</h1>
        {/* Upload Area */}
        <div className="bg-white border border-gray-200 rounded p-6 mb-6">
          <label className="block mb-4">
            <span className="text-sm font-medium mb-2 block">Chọn dự án</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded"
            >
              <option value="">-- Chọn dự án --</option>
              {projects.map(project => (
                <option key={project._id} value={project._id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded p-12 text-center mb-4">
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 mb-4">Click để chọn</p>
            <div className="flex gap-3 justify-center">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="inline-block px-4 py-2 bg-blue-600 text-white rounded cursor-pointer"
              >
                Chọn ảnh
              </label>
              {}
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFolderSelect}
                className="hidden"
                id="folder-upload"
                webkitdirectory=""
                directory=""
              />
              <label
                htmlFor="folder-upload"
                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded cursor-pointer"
              >
                <Folder className="w-4 h-4" />
                Chọn thư mục
              </label>
            </div>
          </div>
        </div>
        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <div className="bg-white border border-gray-200 rounded p-6 mb-6">
            <h2 className="font-bold mb-3">Đã chọn {selectedFiles.length} ảnh</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {selectedFiles.map((file, index) => (
                <div key={index} className="relative border border-gray-200 rounded p-2">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="w-full h-32 object-cover rounded mb-2"
                  />
                  <p className="text-xs truncate">{file.name}</p>
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={handleUpload}
              className="px-6 py-2 bg-green-600 text-white rounded"
            >
              Upload {selectedFiles.length} ảnh
            </button>
          </div>
        )}
      </main>
    </div>
  );
}