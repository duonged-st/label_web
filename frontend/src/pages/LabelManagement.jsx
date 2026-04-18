import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
export default function LabelManagement() {
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState(null);
  const [newLabelName, setNewLabelName] = useState('');
  const [editingLabelIndex, setEditingLabelIndex] = useState(null);
  const [editingLabelName, setEditingLabelName] = useState('');

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      if (response.ok) {
        setDatasets(data);
        if (data.length > 0 && !selectedDatasetId) {
          setSelectedDatasetId(data[0]._id);
        }
      }
    } catch (error) {
      console.error('Lỗi tải dữ liệu:', error);
    }
  };
  useEffect(() => {
    fetchProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDataset = datasets.find(d => d._id === selectedDatasetId);

  const handleAddLabel = async () => {
    if (!newLabelName.trim()) {
      alert('Vui lòng nhập tên nhãn');
      return;
    }
    if (selectedDataset.labels.includes(newLabelName.trim())) {
      alert('Nhãn này đã tồn tại trong dự án!');
      return;
    }

    try {
      const updatedLabels = [...selectedDataset.labels, newLabelName.trim()];

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedDatasetId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ labels: updatedLabels })
      });

      if (response.ok) {
        setNewLabelName('');
        fetchProjects();
      } else {
        alert('Lỗi khi thêm nhãn!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    }
  };

  const handleDeleteLabel = async (indexToRemove) => {
    if (!window.confirm('Bạn có chắc muốn xóa nhãn này?')) return;

    try {
      const updatedLabels = selectedDataset.labels.filter((_, index) => index !== indexToRemove);

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedDatasetId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ labels: updatedLabels })
      });

      if (response.ok) {
        fetchProjects();
      } else {
        alert('Lỗi khi xóa nhãn!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    }
  };

  const startEditing = (index, currentName) => {
    setEditingLabelIndex(index);
    setEditingLabelName(currentName);
  };

  const handleSaveLabel = async () => {
    if (!editingLabelName.trim()) {
      alert('Vui lòng nhập tên nhãn');
      return;
    }

    try {
      const updatedLabels = selectedDataset.labels.map((label, index) => 
        index === editingLabelIndex ? editingLabelName.trim() : label
      );

      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedDatasetId}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ labels: updatedLabels })
      });

      if (response.ok) {
        setEditingLabelIndex(null);
        setEditingLabelName('');
        fetchProjects();
      } else {
        alert('Lỗi khi cập nhật nhãn!');
      }
    } catch (error) {
      console.error('Lỗi:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingLabelIndex(null);
    setEditingLabelName('');
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-6">Quản lý nhãn</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          <div className="bg-white border border-gray-200 rounded p-4">
            <h2 className="font-bold mb-3 text-gray-800">Dự án của bạn</h2>
            <div className="space-y-2">
              {datasets.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Chưa có dự án nào.</p>
              ) : (
                datasets.map(dataset => (
                  <button
                    key={dataset._id}
                    onClick={() => setSelectedDatasetId(dataset._id)}
                    className={`w-full flex justify-between items-center p-3 rounded cursor-pointer transition-colors ${
                      selectedDatasetId === dataset._id
                        ? 'bg-blue-50 border-l-4 border-blue-600 text-blue-700'
                        : 'hover:bg-gray-100 border-l-4 border-transparent text-gray-700'
                    }`}
                  >
                    <div className="text-left">
                      <div className="font-medium text-sm">{dataset.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {dataset.labels ? dataset.labels.length : 0} nhãn
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="md:col-span-2 bg-white border border-gray-200 rounded p-4">
            {selectedDataset ? (
              <>
                <h2 className="font-bold mb-4 text-gray-800">
                  Bộ nhãn của dự án: <span className="text-blue-600">{selectedDataset.name}</span>
                </h2>

                {/* Form thêm nhãn */}
                <div className="flex gap-2 mb-6">
                  <input
                    type="text"
                    value={newLabelName}
                    onChange={e => setNewLabelName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddLabel()}
                    placeholder="Nhập tên nhãn mới (VD: Chó, Mèo...)"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddLabel}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Thêm
                  </button>
                </div>

                {/* Danh sách các nhãn hiện có */}
                <div className="space-y-2">
                  {!selectedDataset.labels || selectedDataset.labels.length === 0 ? (
                    <div />
                  ) : (
                    selectedDataset.labels.map((label, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-3 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        {editingLabelIndex === index ? (
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={editingLabelName}
                              onChange={e => setEditingLabelName(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleSaveLabel()}
                              className="flex-1 px-3 py-1.5 border border-blue-500 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                              autoFocus
                            />
                            <button
                              onClick={handleSaveLabel}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded"
                            >
                              <Check className="w-4 h-4" /> Lưu
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded"
                            >
                              <X className="w-4 h-4" /> Hủy
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="font-medium text-gray-700 flex-1">{label}</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => startEditing(index, label)}
                                className="p-2 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                title="Sửa tên nhãn"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteLabel(index)}
                                className="p-2 text-red-600 hover:bg-red-100 rounded transition-colors"
                                title="Xóa nhãn"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 py-20">
                <p>Hãy chọn một dự án ở danh sách bên trái để quản lý nhãn.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}