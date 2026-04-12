import React, { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import { Plus, Trash2, X, Check, Loader2, Shield } from 'lucide-react';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  
  // Form states
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState(''); // Mật khẩu chỉ dùng khi thêm mới
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('User');
  const [formDatasets, setFormDatasets] = useState([]);

  // Lấy dữ liệu khi vào trang
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [usersRes, projectsRes] = await Promise.all([
        fetch('/api/users', { headers }),
        fetch('/api/projects', { headers })
      ]);

      if (usersRes.ok) setUsers(await usersRes.json());
      if (projectsRes.ok) setProjects(await projectsRes.json());
    } catch (error) {
      console.error('Lỗi lấy dữ liệu:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- XỬ LÝ MỞ MODAL ---
  const handleOpenAddModal = () => {
    setIsAddingNew(true);
    setEditingUser(null);
    setFormUsername('');
    setFormPassword('');
    setFormEmail('');
    setFormRole('User');
    setFormDatasets([]);
    setShowModal(true);
  };

  const handleOpenEditModal = (user) => {
    setIsAddingNew(false);
    setEditingUser(user);
    setFormUsername(user.username || '');
    setFormEmail(user.email || '');
    setFormRole(user.role || 'User');
    // Rút mảng _id từ danh sách dự án
    setFormDatasets((user.allowedProjects || []).map(p => p._id));
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const toggleDataset = (projectId) => {
    setFormDatasets(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
    );
  };

  // --- API: THÊM / SỬA NGƯỜI DÙNG ---
  const handleSave = async () => {
    if (isAddingNew && (!formUsername.trim() || !formPassword.trim())) {
      alert('Vui lòng nhập tên đăng nhập và mật khẩu!');
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      };

      if (isAddingNew) {
        // GỌI API THÊM MỚI (Trỏ vào auth.js)
        const response = await fetch('/api/register', {
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            username: formUsername, 
            password: formPassword,
            email: formEmail,
            role: formRole,
            allowedProjects: formDatasets
          })
        });

        if (response.ok) {
          alert('Thêm người dùng mới thành công!');
          fetchData();
          handleCloseModal();
        } else {
          const data = await response.json();
          alert(`Lỗi: ${data.message}`);
        }

      } else if (editingUser) {
        // GỌI API CẬP NHẬT (Trỏ vào user.js)
        const response = await fetch(`/api/users/${editingUser._id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ role: formRole, allowedProjects: formDatasets })
        });

        if (response.ok) {
          alert('Cập nhật người dùng thành công!');
          fetchData();
          handleCloseModal();
        } else {
          const data = await response.json();
          alert(`Lỗi: ${data.message}`);
        }
      }
    } catch (error) {
      console.error('Lỗi khi lưu:', error);
      alert('Có lỗi xảy ra!');
    } finally {
      setIsLoading(false);
    }
  };

  // --- API: XÓA NGƯỜI DÙNG ---
  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa người dùng này khỏi hệ thống? Hành động này không thể hoàn tác!')) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        alert('Đã xóa người dùng thành công!');
        fetchData(); // Tải lại danh sách
      } else {
        const data = await response.json();
        alert(`Lỗi: ${data.message}`);
      }
    } catch (error) {
      console.error('Lỗi xóa user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Navigation />

      <main className="flex-1 p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-600" />
              Quản lý phân quyền người dùng
            </h1>
            <p className="text-sm text-gray-600 mt-1">Chỉ Admin mới có quyền thao tác trên trang này.</p>
          </div>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
            Thêm người dùng
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded overflow-hidden shadow-sm">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">Tên đăng nhập / Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Vai trò</th>
                <th className="px-4 py-3 text-left text-sm font-medium w-1/3">Dự án được phép thao tác</th>
                <th className="px-4 py-3 text-left text-sm font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan="4" className="text-center py-10 text-gray-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Đang tải dữ liệu...
                  </td>
                </tr>
              ) : users.map((user) => (
                <tr key={user._id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{user.username}</div>
                    <div className="text-sm text-gray-500">{user.email || 'Không có email'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      user.role === 'Admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'
                    }`}>
                      {user.role || 'User'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {user.allowedProjects && user.allowedProjects.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {user.allowedProjects.map(p => (
                          <span key={p._id} className="bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded text-xs">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400 italic">Chưa được cấp quyền</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleOpenEditModal(user)}
                        className="px-3 py-1 text-blue-600 border border-blue-200 hover:bg-blue-50 rounded text-sm transition-colors"
                      >
                        Sửa
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user._id)}
                        className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Xóa người dùng"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal Thêm / Sửa */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl border border-gray-100">
            <div className="flex justify-between items-center mb-5 pb-3 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-800">
                {isAddingNew ? 'Thêm người dùng mới' : 'Sửa quyền truy cập'}
              </h2>
              <button onClick={handleCloseModal} className="text-gray-400 hover:text-gray-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Username */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Tên đăng nhập {isAddingNew && '*'}</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  disabled={!isAddingNew}
                  className={`w-full px-3 py-2 border rounded focus:border-blue-500 outline-none ${!isAddingNew ? 'bg-gray-100 text-gray-500' : 'bg-white'}`}
                  placeholder="Nhập username"
                />
              </div>

              {/* Password */}
              {isAddingNew && (
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700">Mật khẩu *</label>
                  <input
                    type="password"
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
                    placeholder="Nhập mật khẩu"
                  />
                </div>
              )}

              {/* Role */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">Chức vụ hệ thống</label>
                <select
                  value={formRole}
                  onChange={e => setFormRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-blue-500 outline-none"
                >
                  <option value="User">User (Chỉ thao tác)</option>
                  <option value="Admin">Admin (Quản lý toàn quyền)</option>
                </select>
              </div>

              {/* Datasets Checkbox */}
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700">Dự án được phép thao tác</label>
                <div className="bg-gray-50 border border-gray-200 rounded p-3 max-h-48 overflow-y-auto space-y-2">
                  {projects.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">Chưa có dự án nào trên hệ thống.</p>
                  ) : (
                    projects.map(project => (
                      <label key={project._id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-100 p-1.5 rounded transition-colors">
                        <input
                          type="checkbox"
                          checked={formDatasets.includes(project._id)}
                          onChange={() => toggleDataset(project._id)}
                          className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                        />
                        <span className="text-sm text-gray-800">{project.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-4 mt-2 border-t border-gray-100">
                <button
                  onClick={handleCloseModal}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-medium transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={handleSave}
                  disabled={isLoading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium disabled:opacity-50 transition-colors"
                >
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {isAddingNew ? 'Lưu người dùng mới' : 'Cập nhật'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}