import { useEffect, useMemo, useState } from 'react';
import Navigation from '../components/Navigation';
import { UploadCloud, BrainCircuit, Link2, Loader2, Save, CheckCircle2, Download, Power, Zap, Edit2, Trash2, Check, X } from 'lucide-react';

// Loại file được phép upload
const ACCEPTED_FILE_EXTENSIONS = ['.pt', '.pth', '.onnx', '.pb', '.h5', '.keras', '.pkl', '.joblib', '.npy', '.safetensors', '.bin'];
const ACCEPTED_FILE_TYPES = 'application/octet-stream,.pt,.pth,.onnx,.pb,.h5,.keras,.pkl,.joblib,.npy,.safetensors,.bin';

const emptyUploadForm = {
  name: '',
  dbVersion: '',
  description: ''
};

export default function ModelManagement() {
  const [models, setModels] = useState([]);
  const [projects, setProjects] = useState([]);
  const [uploadForm, setUploadForm] = useState(emptyUploadForm);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedLabelFile, setSelectedLabelFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState({});
  const [loadingModelId, setLoadingModelId] = useState(null);
  const [loadedModels, setLoadedModels] = useState(new Set());
  const [fileError, setFileError] = useState('');
  const [editingModelId, setEditingModelId] = useState(null);
  const [editModelForm, setEditModelForm] = useState({ name: '', dbVersion: '', description: '', labelMapStr: '' });
  const [isSavingModelEdit, setIsSavingModelEdit] = useState(false);

  const modelUsage = useMemo(() => {
    const usage = {};
    models.forEach((model) => {
      usage[String(model._id)] = [];
    });

    projects.forEach((project) => {
      const modelId = String(project?.aiModelId?._id || project?.aiModelId || '');
      if (!modelId) return;
      if (!usage[modelId]) usage[modelId] = [];
      usage[modelId].push(project.name);
    });

    return usage;
  }, [models, projects]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      const [modelRes, projectRes] = await Promise.all([
        fetch('/api/ai-models', { headers }),
        fetch('/api/projects', { headers })
      ]);

      const modelData = modelRes.ok ? await modelRes.json() : [];
      const projectData = projectRes.ok ? await projectRes.json() : [];

      setModels(Array.isArray(modelData) ? modelData : []);
      setProjects(Array.isArray(projectData) ? projectData : []);

      const nextDraft = {};
      (Array.isArray(projectData) ? projectData : []).forEach((project) => {
        const modelId = String(project?.aiModelId?._id || project?.aiModelId || '');
        nextDraft[String(project._id)] = modelId;
      });
      setAssignmentDraft(nextDraft);
    } catch (error) {
      console.error('Lỗi tải dữ liệu model management:', error);
      alert('Không thể tải dữ liệu model và dự án.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUploadInputChange = (key, value) => {
    setUploadForm((prev) => ({ ...prev, [key]: value }));
  };

  const validateFileExtension = (file) => {
    if (!file) return true;
    const fileName = file.name.toLowerCase();
    const isValid = ACCEPTED_FILE_EXTENSIONS.some(ext => fileName.endsWith(ext));
    if (!isValid) {
      setFileError(`Chỉ chấp nhận file: ${ACCEPTED_FILE_EXTENSIONS.join(', ')}. Bạn chọn: ${file.name}`);
    } else {
      setFileError('');
    }
    return isValid;
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && !validateFileExtension(file)) {
      setSelectedFile(null);
      e.target.value = '';
      return;
    }
    setSelectedFile(file);
  };

  const handleLabelFileSelect = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && !file.name.toLowerCase().endsWith('.json')) {
      alert('Chỉ chấp nhận file nhãn định dạng .json');
      e.target.value = '';
      setSelectedLabelFile(null);
      return;
    }
    setSelectedLabelFile(file);
  };

  const loadModel = async (modelId, minioPath) => {
    setLoadingModelId(modelId);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/ai-models/${modelId}/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ minio_path: minioPath })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(`Lỗi load model: ${data.message || 'Không biết lý do'}`);
        return;
      }

      setLoadedModels(prev => new Set([...prev, String(modelId)]));
      alert(`Model đã load thành công!`);
    } catch (error) {
      console.error('Lỗi load model:', error);
      alert('Không thể load model. Kiểm tra AI service có chạy không.');
    } finally {
      setLoadingModelId(null);
    }
  };

  const unloadModel = async (modelId, minioPath) => {
    setLoadingModelId(modelId);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/ai-models/${modelId}/unload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ minio_path: minioPath })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(`Lỗi unload model: ${data.message || 'Không biết lý do'}`);
        return;
      }

      setLoadedModels(prev => {
        const newSet = new Set(prev);
        newSet.delete(String(modelId));
        return newSet;
      });
      alert(`Model đã unload thành công!`);
    } catch (error) {
      console.error('Lỗi unload model:', error);
      alert('Không thể unload model.');
    } finally {
      setLoadingModelId(null);
    }
  };

  const handleUploadModel = async (event) => {
    event.preventDefault();

    if (!uploadForm.name.trim() || !uploadForm.dbVersion.trim()) {
      alert('Vui lòng nhập tên model và phiên bản dbVersion.');
      return;
    }

    if (!selectedFile) {
      alert('Vui lòng chọn file model để upload.');
      return;
    }

    if (!validateFileExtension(selectedFile)) {
      alert('Loại file không được phép. ' + fileError);
      return;
    }

    setIsUploading(true);
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('name', uploadForm.name.trim());
      formData.append('dbVersion', uploadForm.dbVersion.trim());
      formData.append('description', uploadForm.description.trim());
      formData.append('modelFile', selectedFile);
      if (selectedLabelFile) {
        formData.append('labelFile', selectedLabelFile);
      }

      const response = await fetch('/api/ai-models/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Upload model thất bại.');
        return;
      }

      alert('Upload model thành công!');
      setUploadForm(emptyUploadForm);
      setSelectedFile(null);
      setSelectedLabelFile(null);
      document.querySelectorAll('input[type="file"]').forEach(el => el.value = '');
      await fetchData();
    } catch (error) {
      console.error('Lỗi upload model:', error);
      alert('Không thể upload model. Vui lòng thử lại.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartEditModel = (model) => {
    setEditingModelId(model._id);
    setEditModelForm({
      name: model.name,
      dbVersion: model.dbVersion,
      description: model.description || '',
      labelMapStr: model.labelMap ? JSON.stringify(model.labelMap, null, 2) : ''
    });
  };

  const handleSaveModelEdit = async (modelId) => {
    if (!editModelForm.name.trim() || !editModelForm.dbVersion.trim()) {
      alert('Tên model và dbVersion không được để trống.');
      return;
    }

    let labelMap = null;
    if (editModelForm.labelMapStr.trim()) {
      try {
        labelMap = JSON.parse(editModelForm.labelMapStr);
        if (typeof labelMap !== 'object' || labelMap === null) {
          throw new Error('Cấu hình nhãn phải là một JSON Object.');
        }
      } catch (err) {
        alert('Cú pháp JSON cấu hình nhãn không hợp lệ: ' + err.message);
        return;
      }
    }

    setIsSavingModelEdit(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/ai-models/${modelId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: editModelForm.name.trim(),
          dbVersion: editModelForm.dbVersion.trim(),
          description: editModelForm.description.trim(),
          labelMap
        })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Cập nhật model thất bại.');
        return;
      }

      alert('Cập nhật model thành công!');
      setEditingModelId(null);
      await fetchData();
    } catch (error) {
      console.error('Lỗi cập nhật model:', error);
      alert('Không thể kết nối đến server.');
    } finally {
      setIsSavingModelEdit(false);
    }
  };

  const handleDeleteModel = async (modelId, modelName) => {
    if (!window.confirm(`Bạn có chắc muốn xóa model "${modelName}"? Thao tác này sẽ gỡ gán model khỏi tất cả dự án đang liên kết.`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/ai-models/${modelId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Xóa model thất bại.');
        return;
      }

      alert('Đã xóa model thành công!');
      setLoadedModels(prev => {
        const next = new Set(prev);
        next.delete(String(modelId));
        return next;
      });
      await fetchData();
    } catch (error) {
      console.error('Lỗi xóa model:', error);
      alert('Không thể kết nối đến server.');
    }
  };

  const handleChangeProjectModel = (projectId, modelId) => {
    setAssignmentDraft((prev) => ({ ...prev, [projectId]: modelId }));
  };

  const hasAssignmentChanges = useMemo(() => {
    return projects.some((project) => {
      const projectId = String(project._id);
      const current = String(project?.aiModelId?._id || project?.aiModelId || '');
      const draft = String(assignmentDraft[projectId] || '');
      return current !== draft;
    });
  }, [projects, assignmentDraft]);

  const saveAssignments = async () => {
    if (!hasAssignmentChanges) {
      alert('Chưa có thay đổi để lưu.');
      return;
    }

    setIsSavingAssignments(true);
    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      };

      const changedProjects = projects.filter((project) => {
        const projectId = String(project._id);
        const current = String(project?.aiModelId?._id || project?.aiModelId || '');
        const draft = String(assignmentDraft[projectId] || '');
        return current !== draft;
      });

      for (const project of changedProjects) {
        const projectId = String(project._id);
        const aiModelId = assignmentDraft[projectId] || null;
        const response = await fetch(`/api/projects/${projectId}/ai-model`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ aiModelId })
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || `Lưu gán model thất bại cho dự án ${project.name}`);
        }
      }

      alert('Đã cập nhật gán model cho dự án thành công!');
      await fetchData();
    } catch (error) {
      console.error('Lỗi lưu gán model:', error);
      alert(error.message || 'Lỗi khi lưu gán model cho dự án.');
    } finally {
      setIsSavingAssignments(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainCircuit className="w-6 h-6 text-blue-600" />
            Quản lý AI Model
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Trang dành cho Admin: upload model và gán model cho từng dự án. Một model có thể dùng chung nhiều dự án, và mỗi dự án vẫn có thể chọn model riêng.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <section className="xl:col-span-1 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-blue-600" />
              Upload model mới
            </h2>

            <form onSubmit={handleUploadModel} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên model *</label>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(e) => handleUploadInputChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  placeholder="VD: YOLOv8-seg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">dbVersion *</label>
                <input
                  type="text"
                  value={uploadForm.dbVersion}
                  onChange={(e) => handleUploadInputChange('dbVersion', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  placeholder="VD: 1.0.0"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
                <textarea
                  value={uploadForm.description}
                  onChange={(e) => handleUploadInputChange('description', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  rows={3}
                  placeholder="Mô tả ngắn về model"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File model *</label>
                <input
                  type="file"
                  onChange={handleFileSelect}
                  accept={ACCEPTED_FILE_TYPES}
                  className="w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
                {selectedFile && !fileError && (
                  <p className="text-xs text-green-600 mt-1 truncate">✓ Đã chọn: {selectedFile.name}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File nhãn (label.json - Tùy chọn)</label>
                <input
                  type="file"
                  onChange={handleLabelFileSelect}
                  accept=".json"
                  className="w-full text-sm text-gray-700 file:mr-3 file:px-3 file:py-2 file:rounded file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {selectedLabelFile && (
                  <p className="text-xs text-green-600 mt-1 truncate">✓ Đã chọn file nhãn: {selectedLabelFile.name}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isUploading}
                className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-60"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {isUploading ? 'Đang upload...' : 'Upload model'}
              </button>
            </form>
          </section>

          <section className="xl:col-span-2 bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-blue-600" />
                Gán model cho dự án
              </h2>
              <button
                onClick={saveAssignments}
                disabled={isSavingAssignments || !hasAssignmentChanges}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 transition-colors"
              >
                {isSavingAssignments ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu thay đổi
              </button>
            </div>

            {isLoading ? (
              <div className="py-14 text-center text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                Đang tải dữ liệu...
              </div>
            ) : (
              <>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full min-w-[680px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium">Dự án</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Model đang dùng</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Gán model</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                            Chưa có dự án nào để gán model.
                          </td>
                        </tr>
                      ) : (
                        projects.map((project) => {
                          const projectId = String(project._id);
                          const currentModelName = project?.aiModelId?.name || 'Chưa gán';
                          const currentModelId = String(project?.aiModelId?._id || project?.aiModelId || '');
                          const draftModelId = String(assignmentDraft[projectId] || '');
                          const changed = currentModelId !== draftModelId;

                          return (
                            <tr key={projectId} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-3">
                                <div className="font-medium text-gray-800">{project.name}</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{currentModelName}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={draftModelId}
                                    onChange={(e) => handleChangeProjectModel(projectId, e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  >
                                    <option value="">Không dùng model</option>
                                    {models.map((model) => (
                                      <option key={model._id} value={model._id}>
                                        {model.name} (dbVersion: {model.dbVersion})
                                      </option>
                                    ))}
                                  </select>
                                  {changed && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" title="Đã thay đổi" />}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5">
                  <h3 className="font-semibold text-gray-800 mb-3">Danh sách model hiện có</h3>
                  {models.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">Chưa có model nào trong hệ thống.</p>
                  ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {models.map((model) => {
                        const usedBy = modelUsage[String(model._id)] || [];
                        const isLoaded = loadedModels.has(String(model._id));
                        const isLoading = loadingModelId === String(model._id);
                        const isEditing = editingModelId === String(model._id);

                        return (
                          <div key={model._id} className={`border rounded-lg p-3 transition-colors ${
                            isLoaded ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'
                          }`}>
                            {isEditing ? (
                              <div className="space-y-3">
                                <div>
                                  <label className="block text-xs font-semibold text-gray-600 mb-1">Tên model *</label>
                                  <input
                                    type="text"
                                    value={editModelForm.name}
                                    onChange={(e) => setEditModelForm({ ...editModelForm, name: e.target.value })}
                                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-gray-600 mb-1">dbVersion *</label>
                                  <input
                                    type="text"
                                    value={editModelForm.dbVersion}
                                    onChange={(e) => setEditModelForm({ ...editModelForm, dbVersion: e.target.value })}
                                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-gray-600 mb-1">Mô tả</label>
                                  <textarea
                                    value={editModelForm.description}
                                    onChange={(e) => setEditModelForm({ ...editModelForm, description: e.target.value })}
                                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                    rows={2}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-gray-600 mb-1 flex items-center justify-between">
                                    <span>Cấu hình nhãn (JSON Object)</span>
                                    <span className="text-[10px] text-gray-500 font-normal">Ví dụ: {"{"}"0": "vui"{"}"}</span>
                                  </label>
                                  <textarea
                                    value={editModelForm.labelMapStr}
                                    onChange={(e) => setEditModelForm({ ...editModelForm, labelMapStr: e.target.value })}
                                    className="w-full px-2 py-1 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                                    rows={4}
                                    placeholder='VD: {"0": "angry", "1": "happy"}'
                                  />
                                  <div className="mt-1 flex items-center gap-1">
                                    <span className="text-[10px] text-gray-500">Hoặc chọn file:</span>
                                    <input
                                      type="file"
                                      accept=".json"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onload = (event) => {
                                            try {
                                              const parsed = JSON.parse(event.target.result);
                                              let mapObj = {};
                                              if (Array.isArray(parsed)) {
                                                parsed.forEach((val, idx) => {
                                                  mapObj[String(idx)] = String(val);
                                                });
                                              } else if (typeof parsed === 'object' && parsed !== null) {
                                                mapObj = parsed;
                                              } else {
                                                throw new Error('JSON phải là Array hoặc Object.');
                                              }
                                              setEditModelForm(prev => ({
                                                ...prev,
                                                labelMapStr: JSON.stringify(mapObj, null, 2)
                                              }));
                                            } catch (err) {
                                              alert('File JSON không hợp lệ: ' + err.message);
                                            }
                                          };
                                          reader.readAsText(file);
                                        }
                                        e.target.value = ''; // Reset file input
                                      }}
                                      className="text-[10px] text-gray-500 file:mr-2 file:px-2 file:py-0.5 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                                    />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button
                                    onClick={() => handleSaveModelEdit(model._id)}
                                    disabled={isSavingModelEdit}
                                    className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white text-xs rounded hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    {isSavingModelEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                    Lưu
                                  </button>
                                  <button
                                    onClick={() => setEditingModelId(null)}
                                    disabled={isSavingModelEdit}
                                    className="flex items-center gap-1 px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                                  >
                                    <X className="w-3 h-3" />
                                    Hủy
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex-1">
                                    <div className="font-semibold text-gray-800 flex items-center gap-2">
                                      {model.name}
                                      {isLoaded && <span className="inline-flex items-center gap-1 text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded">✓ Loaded</span>}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">dbVersion: {model.dbVersion}</div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => handleStartEditModel(model)}
                                      className="p-1 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                      title="Sửa thông tin model"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteModel(model._id, model.name)}
                                      className="p-1 text-red-600 hover:bg-red-100 rounded transition-colors"
                                      title="Xóa model"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {model.description && (
                                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{model.description}</p>
                                )}
                                {model.labelMap && Object.keys(model.labelMap).length > 0 && (
                                  <div className="mt-2 text-xs text-gray-700 bg-gray-100 p-2 rounded max-h-24 overflow-y-auto">
                                    <span className="font-semibold block mb-1">Cấu hình nhãn (label.json):</span>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
                                      {Object.entries(model.labelMap)
                                        .sort((a, b) => Number(a[0]) - Number(b[0]))
                                        .map(([key, val]) => (
                                          <span key={key} className="truncate" title={`${key}: ${val}`}>
                                            {key}: {val}
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                )}
                                <div className="text-xs text-gray-600 mt-2">
                                  Đang dùng bởi: <span className="font-medium">{usedBy.length}</span> dự án
                                </div>
                                <div className="flex gap-2 mt-3 flex-wrap">
                                  {!isLoaded ? (
                                    <button
                                      onClick={() => loadModel(model._id, model.minioPath)}
                                      disabled={isLoading}
                                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                    >
                                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                                      {isLoading ? 'Loading...' : 'Load'}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => unloadModel(model._id, model.minioPath)}
                                      disabled={isLoading}
                                      className="flex-1 flex items-center justify-center gap-1 text-xs px-2 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 transition-colors"
                                    >
                                      {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                                      {isLoading ? 'Unloading...' : 'Unload'}
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
