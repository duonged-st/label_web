import { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
export default function ProjectManagement () {
  const [datasets, setDatasets] = useState([]);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const startEditing = (dataset) => {
    setEditingId(dataset._id);
    setEditName(dataset.name);
  };

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');

      const response = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const projectsData = await response.json();
      
      if (response.ok) {
        const projectsWithCounts = await Promise.all(projectsData.map(async (project) => {
          try {
            const imgRes = await fetch(`/api/images?projectId=${project._id}&limit=1`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const imgData = await imgRes.json();

            return { ...project, imageCount: imgData.totalImages || 0 };
          } catch (err) {
            console.error(`Lỗi đếm ảnh cho dự án ${project._id}:`, err);
            return { ...project, imageCount: 0 };
          }
        }));

        setDatasets(projectsWithCounts);
      }
    } catch (error) {
      console.error('Lỗi tải dữ liệu:', error);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleAddDataset = async () => {
    if (!newDatasetName.trim()) {
      alert('Vui lòng nhập tên dự án');
      return;
    }
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newDatasetName.trim(),
          description: '',
          labels: []
        })
      });
      const data = await response.json();
      if (response.ok) {
        setNewDatasetName('');
        fetchProjects();
      } else {
        alert(data.message || 'Lỗi khi tạo bộ dữ liệu!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
      alert('Không thể kết nối đến server!');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteDataset = async (datasetId) => {
    if (!window.confirm('Bạn có chắc muốn xóa bộ dữ liệu này? Tất cả ảnh và nhãn sẽ bị xóa!')) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${datasetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchProjects();
      } else {
        alert('Lỗi khi xóa dự án!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    }
  };

  const handleEditDataset = async (datasetId) => {
    if (!editName.trim()) {
      alert('Tên dự án không được để trống!');
      return;
    }
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${datasetId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ name: editName.trim() }) // Gửi tên mới lên Backend
      });
      if (response.ok) {
        setEditingId(null);
        fetchProjects();
      } else {
        const data = await response.json();
        alert(data.message || 'Lỗi khi cập nhật dự án!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    }
  };
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Quản lý dự án (Admin)</h1>

        {/* Add Project */}
        <div className="bg-white border border-gray-200 rounded p-4 mb-6">
          <h2 className="font-bold mb-3">Thêm dự án mới</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newDatasetName}
              onChange={e => setNewDatasetName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddDataset()}
              placeholder="Nhập tên dự án mới..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              disabled={isLoading}
            />
            <button
              onClick={handleAddDataset}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300"
            >
              <Plus className="w-4 h-4" />
              {isLoading ? 'Đang thêm...' : 'Thêm'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded p-4">
          <h2 className="font-bold mb-4">Danh sách dự án</h2>
          {datasets.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              Chưa có dự án nào. Thêm dự án mới ở trên.
            </p>
          ) : (
            <div className="space-y-3">
              {datasets.map(dataset => (
                <div
                  key={dataset._id}
                  className="flex justify-between items-center p-4 border border-gray-200 rounded hover:bg-gray-50"
                >
                  {editingId === dataset._id ? (
                    <div className="flex-1 flex items-center gap-2 mr-4">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleEditDataset(dataset._id)}
                        className="flex-1 px-2 py-1 border border-blue-500 rounded focus:outline-none"
                        autoFocus
                      />
                      <button 
                        onClick={() => handleEditDataset(dataset._id)}
                        className="p-1 text-green-600 hover:bg-green-100 rounded"
                        title="Lưu"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setEditingId(null)}
                        className="p-1 text-gray-500 hover:bg-gray-200 rounded"
                        title="Hủy"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1">
                      <div className="font-bold mb-1 text-gray-800">{dataset.name}</div>
                      <div className="text-sm text-gray-500">
                        {dataset.imageCount} ảnh • {dataset.labels ? dataset.labels.length : 0} nhãn
                      </div>
                    </div>
                  )}

                   {editingId !== dataset._id && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEditing(dataset)}
                      className="p-2 text-blue-500 hover:bg-blue-50 hover:text-blue-700 rounded transition-colors"
                      title="Sửa tên"
                      >
                      <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteDataset(dataset._id)}
                    className="p-2 text-red-500 hover:bg-red-50 hover:text-red-700 rounded transition-colors"
                    title="Xóa dự án"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  </div>
  );
}