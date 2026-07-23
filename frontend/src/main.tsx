import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';

// Normalize legacy hashes from the old JavaScript SPA (#dashboard) to the
// HashRouter format (#/dashboard), including VNPay return URLs.
if (window.location.hash && !window.location.hash.startsWith('#/')) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${window.location.hash.slice(1)}`);
}

// StrictMode intentionally is not enabled in the demo build. React invokes
// effects twice in development under StrictMode, which duplicated expensive
// market requests and chart preparation whenever the page was refreshed.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ToastProvider>,
);
