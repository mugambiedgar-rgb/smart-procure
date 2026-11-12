import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { Spinner } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import { Login, ForgotPassword, ResetPassword } from './pages/Auth.jsx';
import { SignUp, CreateAccount } from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Procurement from './pages/Procurement.jsx';
import Suppliers from './pages/Suppliers.jsx';
import GoodsReceived from './pages/GoodsReceived.jsx';
import Reconciliation from './pages/Reconciliation.jsx';
import Sales from './pages/Sales.jsx';
import Analytics from './pages/Analytics.jsx';
import Reports from './pages/Reports.jsx';
import Notifications from './pages/Notifications.jsx';
import Users from './pages/Users.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Profile from './pages/Profile.jsx';

function Protected({ perms = [], children }) {
  const { user, loading, can } = useAuth(); const loc = useLocation();
  if (loading) return <div className="page-loading"><Spinner label="Loading your workspace..." /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (perms.length && !can(...perms)) return <div className="card card-body"><h3>Access denied</h3><p className="muted">Your role does not include permission to view this page.</p></div>;
  return children;
}

// Where a signed-in user lands first, based on what their role may see
export function landingPath(can) {
  if (can('dashboard.view')) return '/dashboard';
  if (can('inventory.view', 'products.view')) return '/inventory';
  return '/profile';
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading"><Spinner label="Loading your workspace..." /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/create-account" element={<CreateAccount />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Shell />}>
        <Route path="/dashboard" element={<Protected perms={['dashboard.view']}><Dashboard /></Protected>} />
        <Route path="/inventory" element={<Protected perms={['products.view', 'inventory.view']}><Inventory /></Protected>} />
        <Route path="/procurement" element={<Protected perms={['po.view', 'requisitions.view']}><Procurement /></Protected>} />
        <Route path="/suppliers" element={<Protected perms={['suppliers.view']}><Suppliers /></Protected>} />
        <Route path="/goods-received" element={<Protected perms={['grn.view']}><GoodsReceived /></Protected>} />
        <Route path="/reconciliation" element={<Protected perms={['reconciliation.view']}><Reconciliation /></Protected>} />
        <Route path="/sales" element={<Protected perms={['orders.view', 'customers.view', 'deliveries.view']}><Sales /></Protected>} />
        <Route path="/analytics" element={<Protected perms={['analytics.view']}><Analytics /></Protected>} />
        <Route path="/reports" element={<Protected perms={['reports.view']}><Reports /></Protected>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/users" element={<Protected perms={['users.manage']}><Users /></Protected>} />
        <Route path="/audit" element={<Protected perms={['audit.view']}><AuditLog /></Protected>} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
