import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Dashboard from './pages/Dashboard';
import ProtectedRoutes from './components/ProtectedRoutes';
import ProjectManagement from './pages/ProjectManagement';
import LabelManagement from './pages/LabelManagement';
import ImageManagement from './pages/ImageManagement';
import UserManagement from './pages/UserManagement';
import Labeling from './pages/Labeling';
function App() {
  return (
    <Router>
      <Routes>
        {/* Mặc định vào web là hiện trang Login */}
        <Route path="/"element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={
          <ProtectedRoutes>
            <Dashboard />
          </ProtectedRoutes>
        } />
        <Route path="/project-management" element={
          <ProtectedRoutes adminOnly = {true}>
            <ProjectManagement />
          </ProtectedRoutes>
        } />
        <Route path="/label-management" element={
          <ProtectedRoutes adminOnly = {true}>
            <LabelManagement />
          </ProtectedRoutes>
        } />
        <Route path="/labeling" element={
          <ProtectedRoutes>
            <Labeling />
          </ProtectedRoutes>
        } />
        <Route path="/image-management" element={
          <ProtectedRoutes>
            <ImageManagement />
          </ProtectedRoutes>
        } />
        <Route path="/user-management" element={
          <ProtectedRoutes adminOnly = {true}>
            <UserManagement />
          </ProtectedRoutes>
        } />
      </Routes>
    </Router>
  );
}
export default App;