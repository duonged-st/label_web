import { Link, useLocation, useNavigate } from 'react-router-dom'; 
import { LayoutDashboard, Images, Users, Tag, LogOut, BarChart3, Menu, X, Tags, Folders, BrainCircuit } from 'lucide-react';
import { useEffect, useState } from 'react';

const menuItems = [
  { icon: LayoutDashboard, label: 'Upload ảnh', path: '/dashboard', adminOnly: true },
  { icon: Images, label: 'Quản lý ảnh', path: '/image-management' },
  { icon: Tag, label: 'Gán nhãn', path: '/labeling' },
  { icon: Tags, label: 'Quản lý nhãn', path: '/label-management', adminOnly: true },
  { icon: Folders, label: 'Quản lý dự án', path: '/project-management', adminOnly: true },
  { icon: BrainCircuit, label: 'Quản lý model', path: '/model-management', adminOnly: true },
  { icon: Users, label: 'Quản lý người dùng', path: '/user-management', adminOnly: true },
  { icon: BarChart3, label: 'Thống kê', path: '/statistics', adminOnly: true },
];
export default function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const handleLogout = async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        await fetch('/api/auth-activity', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            event: 'LOGOUT_CLICK',
            reason: 'manual_logout'
          })
        });
      } catch (error) {
        console.error('Không gửi được log đăng xuất:', error);
      }
    }

    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    localStorage.removeItem('user'); 
    navigate('/login');
  };

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userInfo] = useState(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr); 
      } catch (error) {
        console.error("Lỗi đọc thông tin user", error);
      }
    }
    return { username: '', role: '' };
  });
  const currentRole = String(userInfo.role || localStorage.getItem('userRole') || '').toLowerCase();

  useEffect(() => {
    const handlePageUnload = () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      const payload = JSON.stringify({
        event: 'BROWSER_CLOSE',
        reason: 'page_unload',
        token
      });

      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/auth-activity', blob);
    };

    window.addEventListener('beforeunload', handlePageUnload);
    return () => {
      window.removeEventListener('beforeunload', handlePageUnload);
    };
  }, []);

  return (
    <>
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-blue-600 text-white rounded"
      >
        {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 z-40 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-4 border-b border-gray-200 text-center">
          <img src ="/logo-icon-transparent.png" alt="Logo" className="mx-auto mb-2 w-12 h-12" />
          <h1 className="text-xs text-gray-800"> Web gán nhãn dữ liệu</h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            if (item.adminOnly && currentRole !== 'admin') return null;
            return (
              <Link
                key={`${item.label}-${index}`}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded mb-1 text-sm font-medium ${
                  isActive
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}>
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between gap-2"> 
            <div className="flex items-center gap-3 overflow-hidden">
              <div className=" text-white rounded-full flex-shrink-0 flex items-center justify-center font-bold">
                {userInfo.username.charAt(0).toUpperCase()}
              </div>
              <div className="text-sm overflow-hidden">
                <div className="font-bold text-gray-800 truncate">{userInfo.username}</div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">{userInfo.role}</div>
              </div>
            </div>        

            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
              title="Đăng xuất"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );
}
