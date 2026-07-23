import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AIChat from './components/AIChat';
import Footer from './components/Footer';
import AdminLayout from './components/AdminLayout';
import { PageLoader } from './components/Feedback';
import { useAuth } from './context/AuthContext';
import { MarketProvider } from './context/MarketContext';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ChartTerminal = lazy(() => import('./pages/ChartTerminal'));
const P2P = lazy(() => import('./pages/P2P'));
const TaxEstimator = lazy(() => import('./pages/TaxEstimator'));
const NetSettlement = lazy(() => import('./pages/NetSettlement'));
const DecisionHub = lazy(() => import('./pages/DecisionHub'));
const VirtualExchange = lazy(() => import('./pages/VirtualExchange'));
const DemoWallet = lazy(() => import('./pages/DemoWallet'));
const Premium = lazy(() => import('./pages/Premium'));
const Alerts = lazy(() => import('./pages/Alerts'));
const News = lazy(() => import('./pages/News'));
const DataReliability = lazy(() => import('./pages/DataReliability'));
const Account = lazy(() => import('./pages/Account'));
const History = lazy(() => import('./pages/History'));
const PaymentResult = lazy(() => import('./pages/PaymentResult'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminTransactions = lazy(() => import('./pages/admin/AdminTransactions'));
const AdminSystem = lazy(() => import('./pages/admin/AdminSystem'));
const LegalPage = lazy(() => import('./pages/legal/LegalPage'));
const CourseContent = lazy(() => import('./pages/content/CourseContent'));

function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.ready) return <PageLoader />;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth.ready) return <PageLoader />;
  if (!auth.isAuthenticated) return <Navigate to="/login" replace />;
  if (!auth.isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

function UserShell() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('btc_sidebar_collapsed') === '1');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('btc_theme') === 'light' ? 'light' : 'dark');
  const location = useLocation();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('btc_theme', theme);
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  const sidebarWidth = collapsed ? 64 : 224;
  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-main)]">
      <Header
        theme={theme}
        onThemeToggle={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}
        sidebarCollapsed={collapsed}
        onSidebarToggle={() => setCollapsed(value => {
          localStorage.setItem('btc_sidebar_collapsed', value ? '0' : '1');
          return !value;
        })}
      />
      <Sidebar collapsed={collapsed} />
      <div
        className="user-main-shell flex min-h-screen flex-col pt-[79px] transition-[margin] duration-200"
        style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      >
        <main id="main-content" className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 sm:px-5">
          <Suspense fallback={<PageLoader />}><Outlet /></Suspense>
        </main>
        <Footer />
      </div>
      <AIChat />
    </div>
  );
}

function PublicShell() {
  return <Suspense fallback={<PageLoader />}><Outlet /></Suspense>;
}

function AdminShell() {
  return (
    <AdminLayout>
      <Suspense fallback={<PageLoader />}><Outlet /></Suspense>
    </AdminLayout>
  );
}

export default function App() {
  const publicRoutes = useMemo(() => [
    <Route key="login" path="/login" element={<Login />} />,
  ], []);

  return (
    <HashRouter>
      <Routes>
        <Route element={<PublicShell />}>{publicRoutes}</Route>

        <Route element={<RequireAuth><MarketProvider><UserShell /></MarketProvider></RequireAuth>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/chart" element={<ChartTerminal />} />
          <Route path="/p2p" element={<P2P />} />
          <Route path="/tax" element={<TaxEstimator />} />
          <Route path="/settlement" element={<NetSettlement />} />
          <Route path="/decision" element={<DecisionHub />} />
          <Route path="/exchange" element={<VirtualExchange />} />
          <Route path="/trade" element={<Navigate to="/exchange" replace />} />
          <Route path="/wallet" element={<DemoWallet />} />
          <Route path="/premium" element={<Premium />} />
          <Route path="/billing" element={<Navigate to="/premium" replace />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/news" element={<News />} />
          <Route path="/data" element={<DataReliability />} />
          <Route path="/reliability" element={<Navigate to="/data" replace />} />
          <Route path="/account" element={<Account />} />
          <Route path="/history" element={<History />} />
          <Route path="/payment-result" element={<PaymentResult />} />
          <Route path="/theory" element={<CourseContent section="theory" />} />
          <Route path="/business" element={<CourseContent section="business" />} />
          <Route path="/experiment" element={<CourseContent section="experiment" />} />
          <Route path="/guide" element={<CourseContent section="guide" />} />
          <Route path="/about" element={<CourseContent section="about" />} />
          <Route path="/legal/:slug" element={<LegalPage />} />
        </Route>

        <Route path="/admin" element={<RequireAdmin><AdminShell /></RequireAdmin>}>
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="transactions" element={<AdminTransactions />} />
          <Route path="system" element={<AdminSystem />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </HashRouter>
  );
}
