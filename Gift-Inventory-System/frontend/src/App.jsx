/* Routes of the whole app: sign-in, admin dashboard (/admin/...) and promoter app (/app/...). */
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { LoadingBlock } from './components/ui';
import { AuthProvider, ProtectedRoute } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { LookupsProvider } from './context/LookupsContext';
import { PageMetaProvider } from './context/PageMetaContext';
import { ModalHost } from './components/Modal';
import { ToastHost } from './components/Toasts';
import LoginPage from './pages/LoginPage';
import NotFound from './pages/NotFound';
// Pages are loaded on demand: promoters' phones download only the promoter app.
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const shops = () => import('./pages/admin/Shops');
const ShopList = named(shops, 'ShopList'); const ShopQrSheet = named(shops, 'ShopQrSheet'); const ShopDetail = named(shops, 'ShopDetail');
const sales = () => import('./pages/admin/Sales');
const SalesList = named(sales, 'SalesList'); const SalesGrouped = named(sales, 'SalesGrouped');
const Brands = lazy(() => import('./pages/admin/Brands'));
const Models = lazy(() => import('./pages/admin/Models'));
const gifts = () => import('./pages/admin/Gifts');
const GiftList = named(gifts, 'GiftList'); const GiftDetail = named(gifts, 'GiftDetail');
const inventory = () => import('./pages/admin/Inventory');
const InventoryList = named(inventory, 'InventoryList'); const Allocate = named(inventory, 'Allocate'); const Adjustments = named(inventory, 'Adjustments');
const GiftDos = lazy(() => import('./pages/admin/Dos'));
const TransactionsRedirect = lazy(() => import('./pages/admin/Transactions'));
const promoters = () => import('./pages/admin/Promoters');
const PromoterList = named(promoters, 'PromoterList'); const AssignShops = named(promoters, 'AssignShops'); const Performance = named(promoters, 'Performance');
const PromoterPerformance = named(promoters, 'PromoterPerformance'); const PromoterDetail = named(promoters, 'PromoterDetail');
const ImportPage = lazy(() => import('./pages/admin/Import'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const PromoterApp = lazy(() => import('./pages/promoter/PromoterApp'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));

/** Remount a page when its URL parameter changes (fresh state per record). */
function Keyed({ children }) { const p = useParams(); return <div key={JSON.stringify(p)} style={{ display: 'contents' }}>{children}</div>; }

export default function App() {
  return (
    <AuthProvider>
      <SyncProvider>
        <LookupsProvider>
          <PageMetaProvider>
            <Suspense fallback={<LoadingBlock />}>
            <Routes>
              <Route path="/" element={<LoginPage />} />
              <Route path="/admin" element={<ProtectedRoute role="admin"><AdminLayout /></ProtectedRoute>}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="shops" element={<ShopList />} />
                <Route path="shops/new" element={<ShopList openNew />} />
                <Route path="shops/qr" element={<ShopQrSheet />} />
                <Route path="shops/:id" element={<Keyed><ShopDetail /></Keyed>} />
                <Route path="sales" element={<SalesList />} />
                <Route path="sales/brands" element={<SalesGrouped kind="brands" />} />
                <Route path="sales/models" element={<SalesGrouped kind="models" />} />
                <Route path="sales/shops" element={<SalesGrouped kind="shops" />} />
                <Route path="brands" element={<Brands />} />
                <Route path="models" element={<Models />} />
                <Route path="gifts" element={<GiftList />} />
                <Route path="gifts/new" element={<GiftList openNew />} />
                <Route path="gifts/:id" element={<Keyed><GiftDetail /></Keyed>} />
                <Route path="inventory" element={<InventoryList />} />
                <Route path="inventory/allocate" element={<Allocate />} />
                <Route path="inventory/dos" element={<GiftDos />} />
                <Route path="inventory/adjustments" element={<Adjustments />} />
                <Route path="transactions" element={<TransactionsRedirect />} />
                <Route path="transactions/:status" element={<TransactionsRedirect />} />
                <Route path="promoters" element={<PromoterList />} />
                <Route path="promoters/assign" element={<AssignShops />} />
                <Route path="promoters/performance" element={<Performance />} />
                <Route path="promoters/:id/performance" element={<Keyed><PromoterPerformance /></Keyed>} />
                <Route path="promoters/:id" element={<Keyed><PromoterDetail /></Keyed>} />
                <Route path="import" element={<Navigate to="shops" replace />} />
                <Route path="import/:type" element={<Keyed><ImportPage /></Keyed>} />
                <Route path="reports/:type" element={<Keyed><Reports /></Keyed>} />
                <Route path="settings" element={<Settings />} />
                <Route path="*" element={<NotFound home="/admin/dashboard" />} />
              </Route>
              <Route path="/app/*" element={<ProtectedRoute role="promoter"><PromoterApp /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <ModalHost />
            <ToastHost />
          </PageMetaProvider>
        </LookupsProvider>
      </SyncProvider>
    </AuthProvider>
  );
}
