import { useEffect, useMemo, useState } from 'react';
import Navigation from '../components/Navigation';
import { Plus, Trash2, Edit2, Check, X, Users, SplitSquareHorizontal, ShieldCheck } from 'lucide-react';

const splitOptions = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const isValidRatios = (ratios) => {
  if (!Array.isArray(ratios) || ratios.length === 0) return false;
  const validSteps = ratios.every((ratio) => Number.isInteger(Number(ratio)) && Number(ratio) >= 10 && Number(ratio) <= 100 && Number(ratio) % 10 === 0);
  if (!validSteps) return false;
  return ratios.reduce((sum, ratio) => sum + Number(ratio), 0) === 100;
};

const normalizeRatiosFromProject = (project) => {
  const splitRatios = Array.isArray(project?.splitRatios) ? project.splitRatios.map(Number) : [];
  if (isValidRatios(splitRatios)) {
    return splitRatios;
  }

  const legacyPercent = Number(project?.splitPercent || 100);
  if (legacyPercent >= 100) return [100];
  const remain = 100 - legacyPercent;
  if (remain > 0 && remain % 10 === 0 && legacyPercent % 10 === 0) {
    return [legacyPercent, remain];
  }
  return [100];
};

const buildParts = (project, ratios) => {
  const totalImages = Number(project?.imageCount || 0);
  if (!totalImages) return [];
  
  const validRatios = Array.isArray(ratios) && ratios.length > 0 && 
    ratios.every((r) => Number.isInteger(Number(r)) && Number(r) >= 1 && Number(r) <= 100) &&
    ratios.reduce((s, r) => s + Number(r), 0) === 100;
  
  if (!validRatios) return [];

  const parts = [];
  let start = 1;
  let cumulative = 0;

  ratios.forEach((ratio, index) => {
    cumulative += ratio;
    const end = index === ratios.length - 1
      ? totalImages
      : Math.max(start - 1, Math.min(totalImages, Math.round((totalImages * cumulative) / 100)));

    parts.push({
      partId: String(index + 1),
      label: `Phần ${index + 1}`,
      start,
      end,
      ratio
    });

    start = end + 1;
  });

  return parts.filter((part) => part.start <= part.end);
};

const computeEvenSplit = (n) => {
  const count = Math.max(1, Math.min(10, Number(n) || 1));
  const base = Math.floor((100 / count) / 10) * 10 || 10;
  const arr = Array(count).fill(base);
  let remaining = 100 - arr.reduce((s, v) => s + v, 0);
  let i = 0;
  while (remaining > 0) {
    arr[i % count] += 10;
    remaining -= 10;
    i += 1;
  }
  return arr;
};

const computeSplitByImageCount = (totalImages, imagesPerPart) => {
  const ipp = Math.max(1, Number(imagesPerPart) || 100);
  const numParts = Math.ceil(totalImages / ipp);
  if (numParts > 100) return null; 
  const base = Math.floor(100 / numParts);
  const arr = Array(numParts).fill(base);
  let remaining = 100 - arr.reduce((s, v) => s + v, 0);
  let i = 0;
  while (remaining > 0) {
    arr[i % numParts] += 1;
    remaining -= 1;
    i += 1;
  }
  return arr;
};

const getUserProjectPermission = (user, projectId) => {
  const permissions = Array.isArray(user?.projectPermissions) ? user.projectPermissions : [];
  return permissions.find((entry) => String(entry.projectId?._id || entry.projectId) === String(projectId)) || null;
};

const userHasAllowedProject = (user, projectId) => {
  const allowedProjects = Array.isArray(user?.allowedProjects) ? user.allowedProjects : [];
  return allowedProjects.some((project) => String(project?._id || project) === String(projectId));
};

export default function ProjectManagement() {
  const [datasets, setDatasets] = useState([]);
  const [users, setUsers] = useState([]);
  const [newDatasetName, setNewDatasetName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [splitRatiosDraft, setSplitRatiosDraft] = useState([100]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPartIds, setSelectedPartIds] = useState([]);
  const [isSavingSplit, setIsSavingSplit] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [splitMode, setSplitMode] = useState('percentage'); // 'percentage' | 'imageCount'
  const [imagesPerPart, setImagesPerPart] = useState(100);

  const selectedProject = datasets.find((dataset) => dataset._id === selectedProjectId) || null;
  const selectedUser = users.find((user) => user._id === selectedUserId) || null;
  const splitSum = splitRatiosDraft.reduce((sum, ratio) => sum + Number(ratio || 0), 0);
  const ratiosAreValid = splitMode === 'percentage' 
    ? isValidRatios(splitRatiosDraft) 
    : Array.isArray(splitRatiosDraft) && splitRatiosDraft.length > 0 && splitRatiosDraft.reduce((s, r) => s + Number(r), 0) === 100;

  const projectParts = useMemo(
    () => buildParts(selectedProject, splitRatiosDraft),
    [selectedProject, splitRatiosDraft]
  );

  const splitHasEmptyParts = useMemo(() => {
    if (!selectedProject) return false;
    if (!Array.isArray(splitRatiosDraft) || splitRatiosDraft.length === 0) return false;
    return projectParts.length < splitRatiosDraft.length;
  }, [selectedProject, splitRatiosDraft, projectParts]);

  const selectedUserPermission = selectedUser && selectedProject
    ? getUserProjectPermission(selectedUser, selectedProject._id)
    : null;

  const fetchProjects = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const projectsData = await response.json();

      if (response.ok) {
        const projectsWithCounts = await Promise.all(projectsData.map(async (project) => {
          try {
            const imgRes = await fetch(`/api/images?projectId=${project._id}&limit=1`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            const imgData = await imgRes.json();
            return { ...project, imageCount: imgData.totalImages || 0 };
          } catch (error) {
            console.error(`Lỗi đếm ảnh cho dự án ${project._id}:`, error);
            return { ...project, imageCount: 0 };
          }
        }));

        setDatasets(projectsWithCounts);

        const nextProjectId = selectedProjectId && projectsWithCounts.some((project) => project._id === selectedProjectId)
          ? selectedProjectId
          : (projectsWithCounts[0]?._id || null);

        setSelectedProjectId(nextProjectId);
      }
    } catch (error) {
      console.error('Lỗi tải dữ liệu dự án:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const usersData = await response.json();
        setUsers(usersData);

        const nextUserId = selectedUserId && usersData.some((user) => user._id === selectedUserId)
          ? selectedUserId
          : (usersData[0]?._id || '');

        setSelectedUserId(nextUserId);
      }
    } catch (error) {
      console.error('Lỗi tải danh sách người dùng:', error);
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setSplitRatiosDraft([100]);
      return;
    }
    if (splitMode === 'imageCount') {
      const computed = computeSplitByImageCount(selectedProject.imageCount, imagesPerPart);
      if (computed) {
        setSplitRatiosDraft(computed);
      }
    } else {
      setSplitRatiosDraft(normalizeRatiosFromProject(selectedProject));
    }
  }, [selectedProject, splitMode, imagesPerPart]);

  useEffect(() => {
    if (!selectedProject || !selectedUser) {
      setSelectedPartIds([]);
      return;
    }

    const currentPermission = getUserProjectPermission(selectedUser, selectedProject._id);
    const currentPartIds = Array.isArray(currentPermission?.partIds) ? currentPermission.partIds.map(String) : [];

    if (currentPartIds.length > 0) {
      setSelectedPartIds(currentPartIds);
      return;
    }

    if (userHasAllowedProject(selectedUser, selectedProject._id) && normalizeRatiosFromProject(selectedProject).length <= 1) {
      setSelectedPartIds(projectParts.map((part) => part.partId));
      return;
    }

    setSelectedPartIds([]);
  }, [selectedProject, selectedUser, users, projectParts]);

  const startEditing = (dataset) => {
    setEditingId(dataset._id);
    setEditName(dataset.name);
  };

  const handleSelectProject = (project) => {
    setSelectedProjectId(project._id);
  };

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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newDatasetName.trim(),
          description: '',
          labels: [],
          splitRatios: [100]
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
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.ok) {
        await fetchProjects();
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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: editName.trim() })
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

  const handleAddRatioPart = () => {
    if (splitRatiosDraft.length >= 10) {
      alert('Số phần quá nhiều, vui lòng gộp lại để dễ quản lý.');
      return;
    }
    setSplitRatiosDraft((prev) => [...prev, 10]);
  };

  const handleEvenSplit = () => {
    const n = splitRatiosDraft.length || 1;
    setSplitRatiosDraft(computeEvenSplit(n));
  };

  const handleRemoveRatioPart = (index) => {
    if (splitRatiosDraft.length <= 1) {
      alert('Phải có ít nhất một phần.');
      return;
    }
    setSplitRatiosDraft((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleChangeRatio = (index, value) => {
    const nextValue = Number(value);
    setSplitRatiosDraft((prev) => prev.map((ratio, itemIndex) => (itemIndex === index ? nextValue : Number(ratio))));
  };

  const handleChangeImageCountMode = (e) => {
    const newIpp = Math.max(1, Number(e.target.value) || 100);
    setImagesPerPart(newIpp);
  };

  const handleSaveSplit = async () => {
    if (!selectedProject) return;

    if (!ratiosAreValid) {
      const msg = splitMode === 'percentage'
        ? 'Tỉ lệ chưa hợp lệ. Mỗi phần phải là bội số 10 và tổng phải bằng 100%.'
        : 'Không đủ ảnh để chia theo số lượng yêu cầu.';
      alert(msg);
      return;
    }

    if (splitHasEmptyParts) {
      alert('Không đủ ảnh để chia theo cấu hình phần hiện tại. Vui lòng giảm số phần hoặc chọn "Chia đều".');
      return;
    }

    setIsSavingSplit(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedProject._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ splitRatios: splitRatiosDraft })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Không thể cập nhật tỉ lệ chia dự án.');
        return;
      }

      alert('Đã cập nhật cấu hình chia phần.');
      await fetchProjects();
      await fetchUsers();
      setSelectedPartIds([]);
    } catch (error) {
      console.error('Lỗi cập nhật chia dự án:', error);
      alert('Không thể kết nối đến server!');
    } finally {
      setIsSavingSplit(false);
    }
  };

  const handleTogglePart = (partId) => {
    setSelectedPartIds((prev) => (
      prev.includes(partId)
        ? prev.filter((id) => id !== partId)
        : [...prev, partId]
    ));
  };

  const handleSaveAccess = async () => {
    if (!selectedProject || !selectedUser) {
      alert('Vui lòng chọn dự án và người dùng.');
      return;
    }

    if (projectParts.length === 0) {
      alert('Dự án này chưa có ảnh để chia phần.');
      return;
    }

    if (selectedPartIds.length === 0) {
      alert('Vui lòng chọn ít nhất một phần của dự án.');
      return;
    }

    setIsSavingAccess(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/projects/${selectedProject._id}/access`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: selectedUser._id,
          partIds: selectedPartIds
        })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.message || 'Không thể cập nhật quyền theo phần.');
        return;
      }

      alert('Đã cập nhật quyền theo phần cho người dùng.');
      await fetchUsers();
      await fetchProjects();
    } catch (error) {
      console.error('Lỗi cập nhật quyền theo phần:', error);
      alert('Không thể kết nối đến server!');
    } finally {
      setIsSavingAccess(false);
    }
  };

  const renderProjectPartSummary = (project) => {
    const ratios = normalizeRatiosFromProject(project);
    if (!project || project.imageCount === 0) {
      return <span className="text-xs text-gray-400">Chưa có ảnh</span>;
    }

    return (
      <span className="text-xs text-gray-500">
        {ratios.length} phần · {ratios.join(' / ')}
      </span>
    );
  };

  const renderPermissionSummary = (user, project) => {
    if (!user || !project) return 'Chưa chọn';
    const permission = getUserProjectPermission(user, project._id);
    const parts = buildParts(project, normalizeRatiosFromProject(project));
    const hasAllowedProject = userHasAllowedProject(user, project._id);

    if (normalizeRatiosFromProject(project).length <= 1) {
      return hasAllowedProject ? 'Toàn bộ dự án' : 'Chưa được cấp phần';
    }

    if (!permission || !Array.isArray(permission.partIds) || permission.partIds.length === 0) {
      return 'Chưa được cấp phần';
    }

    const labels = permission.partIds
      .map((partId) => parts.find((part) => part.partId === String(partId)))
      .filter(Boolean)
      .map((part) => `${part.label} (${part.start}-${part.end})`);

    return labels.length > 0 ? labels.join(', ') : 'Chưa được cấp phần';
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6">
        <div className="flex justify-between items-start gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-blue-600" />
              Quản lý dự án và phân quyền theo phần
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Admin tự cấu hình tỉ lệ từng phần (ví dụ 20/80) rồi cấp user vào từng phần tương ứng.
            </p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded p-4 mb-6">
          <h2 className="font-bold mb-3">Thêm dự án mới</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newDatasetName}
              onChange={(e) => setNewDatasetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDataset()}
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

        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr] gap-6">
          <div className="bg-white border border-gray-200 rounded p-4">
            <h2 className="font-bold mb-4">Danh sách dự án</h2>
            {datasets.length === 0 ? (
              <p className="text-gray-500 text-center py-8">Chưa có dự án nào. Thêm dự án mới ở trên.</p>
            ) : (
              <div className="space-y-3">
                {datasets.map((dataset) => (
                  <div
                    key={dataset._id}
                    onClick={() => handleSelectProject(dataset)}
                    className={`flex justify-between items-center p-4 border rounded cursor-pointer transition-colors ${
                      selectedProjectId === dataset._id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {editingId === dataset._id ? (
                      <div className="flex-1 flex items-center gap-2 mr-4" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          onKeyDown={(event) => event.key === 'Enter' && handleEditDataset(dataset._id)}
                          className="flex-1 px-2 py-1 border border-blue-500 rounded focus:outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleEditDataset(dataset._id)} className="p-1 text-green-600 hover:bg-green-100 rounded" title="Lưu">
                          <Check className="w-5 h-5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:bg-gray-200 rounded" title="Hủy">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1">
                        <div className="font-bold mb-1 text-gray-800">{dataset.name}</div>
                        <div className="text-sm text-gray-500">{dataset.imageCount} ảnh • {dataset.labels ? dataset.labels.length : 0} nhãn</div>
                        <div className="mt-1 text-xs text-gray-500 flex items-center gap-2">
                          <SplitSquareHorizontal className="w-3.5 h-3.5" />
                          {renderProjectPartSummary(dataset)}
                        </div>
                      </div>
                    )}

                    {editingId !== dataset._id && (
                      <div className="flex gap-1" onClick={(event) => event.stopPropagation()}>
                        <button
                          onClick={() => {
                            startEditing(dataset);
                            setSelectedProjectId(dataset._id);
                          }}
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

          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <SplitSquareHorizontal className="w-5 h-5 text-blue-600" />
                  <h2 className="font-bold">Cấu hình tỉ lệ theo phần</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSplitMode('percentage')}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      splitMode === 'percentage'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Theo %
                  </button>
                  <button
                    onClick={() => setSplitMode('imageCount')}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      splitMode === 'imageCount'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Theo số ảnh
                  </button>
                </div>
              </div>

              {!selectedProject ? (
                <p className="text-sm text-gray-500 italic">Chọn một dự án ở bên trái để cấu hình chia phần.</p>
              ) : (
                <div className="space-y-4">
                  {splitMode === 'imageCount' && (
                    <div className="bg-blue-50 border border-blue-200 rounded p-3">
                      <label className="block text-sm font-medium text-blue-900 mb-2">Số ảnh trên mỗi phần</label>
                      <input
                        type="number"
                        value={imagesPerPart}
                        onChange={handleChangeImageCountMode}
                        min="1"
                        className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:border-blue-500"
                        placeholder="Nhập số ảnh mỗi phần (vd: 100)"
                      />
                      <p className="text-xs text-blue-700 mt-2">
                        Sẽ tạo {splitRatiosDraft.length} phần với khoảng {Math.ceil((selectedProject.imageCount || 0) / imagesPerPart)} ảnh/phần
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="text-gray-500 text-xs uppercase mb-1">Tổng ảnh</div>
                      <div className="font-bold text-lg">{selectedProject.imageCount || 0}</div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded p-3">
                      <div className="text-gray-500 text-xs uppercase mb-1">Số phần</div>
                      <div className="font-bold text-lg">{splitRatiosDraft.length}</div>
                    </div>
                    <div className={`border rounded p-3 ${ratiosAreValid ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
                      <div className="text-gray-500 text-xs uppercase mb-1">Tổng tỉ lệ</div>
                      <div className={`font-bold text-lg ${ratiosAreValid ? 'text-green-700' : 'text-orange-700'}`}>{splitSum}%</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {splitMode === 'percentage' && splitRatiosDraft.map((ratio, index) => (
                      <div key={`ratio-${index}`} className="flex items-center gap-2">
                        <span className="text-sm text-gray-700 w-20">Phần {index + 1}</span>
                        <select
                          value={ratio}
                          onChange={(event) => handleChangeRatio(index, event.target.value)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                        >
                          {splitOptions.map((option) => (
                            <option key={option} value={option}>{option}%</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRemoveRatioPart(index)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded"
                          title="Xóa phần"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {splitMode === 'percentage' && (
                    <div className="flex justify-between items-center">
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddRatioPart}
                          className="inline-flex items-center gap-2 px-3 py-2 border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                        >
                          <Plus className="w-4 h-4" />
                          Thêm phần
                        </button>
                        <button
                          onClick={handleEvenSplit}
                          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
                          title="Chia đều các phần hiện tại"
                        >
                          Chia đều
                        </button>
                      </div>
                      {!ratiosAreValid && (
                        <span className="text-xs text-orange-700">Tổng tỉ lệ phải bằng 100% (mỗi phần bước 10%).</span>
                      )}
                    </div>
                  )}

                  <div className="bg-gray-50 border border-gray-200 rounded p-3">
                    <div className="text-sm font-medium mb-2 text-gray-700">Xem trước phần ảnh từ trên xuống</div>
                    {projectParts.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">{selectedProject.imageCount > 0 ? 'Cấu hình tỉ lệ chưa hợp lệ để tạo phần.' : 'Dự án này chưa có ảnh để chia phần.'}</p>
                    ) : splitHasEmptyParts ? (
                      <p className="text-sm text-red-600 italic">Không đủ ảnh để chia theo cấu hình phần hiện tại — một số phần sẽ rỗng.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {projectParts.map((part) => (
                          <span key={part.partId} className="px-3 py-1 rounded-full bg-white border border-gray-200 text-sm text-gray-700">
                            {part.label} ({part.ratio}%): {part.start}-{part.end}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveSplit}
                      disabled={isSavingSplit || !ratiosAreValid}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSavingSplit ? 'Đang lưu...' : 'Lưu cấu hình chia'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded p-4">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-blue-600" />
                <h2 className="font-bold">Phân quyền user theo phần</h2>
              </div>

              {!selectedProject ? (
                <p className="text-sm text-gray-500 italic">Chọn một dự án trước.</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Chưa có user nào.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-gray-700">Chọn user</label>
                    <select
                      value={selectedUserId}
                      onChange={(event) => setSelectedUserId(event.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                    >
                      {users.map((user) => (
                        <option key={user._id} value={user._id}>
                          {user.username} - {String(user.role || 'user').toLowerCase() === 'admin' ? 'Admin' : 'User'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded p-3">
                    <div className="text-sm font-medium mb-2 text-gray-700">Các phần có thể cấp</div>
                    {projectParts.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">Dự án này chưa có phần hợp lệ để cấp quyền.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {projectParts.map((part) => (
                          <label
                            key={part.partId}
                            className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                              selectedPartIds.includes(part.partId)
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 bg-white hover:bg-gray-100'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPartIds.includes(part.partId)}
                              onChange={() => handleTogglePart(part.partId)}
                              className="w-4 h-4"
                            />
                            <span className="text-sm text-gray-700">
                              {part.label} ({part.ratio}%): <span className="text-gray-500">{part.start}-{part.end}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm">
                    <div className="font-medium text-gray-700 mb-1">Quyền hiện tại</div>
                    <div className="text-gray-600">{selectedUserPermission ? renderPermissionSummary(selectedUser, selectedProject) : 'Chưa được cấp phần'}</div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveAccess}
                      disabled={isSavingAccess}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                    >
                      {isSavingAccess ? 'Đang lưu...' : 'Lưu quyền user'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded p-4">
              <h2 className="font-bold mb-3">Tổng hợp quyền user theo dự án hiện tại</h2>
              {!selectedProject ? (
                <p className="text-sm text-gray-500 italic">Chọn một dự án để xem.</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Chưa có user nào.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {users.map((user) => (
                    <div key={user._id} className="flex justify-between items-center p-3 border border-gray-200 rounded">
                      <div>
                        <div className="font-medium text-gray-800">{user.username}</div>
                        <div className="text-xs text-gray-500">{user.email || 'Không có email'}</div>
                      </div>
                      <div className="text-right text-sm text-gray-600 max-w-xs">{renderPermissionSummary(user, selectedProject)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
