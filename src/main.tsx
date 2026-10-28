import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress known Firebase Auth internal popup assertion bug ("Pending promise was never set")
if (typeof window !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const first = String(args[0] || '');
    if (first.includes('Pending promise was never set') || (first.includes('@firebase/auth') && first.includes('INTERNAL ASSERTION FAILED'))) {
      console.warn('Suppressed Firebase Auth internal popup assertion notice:', ...args);
      return;
    }
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const msg = (typeof reason === 'string' ? reason : reason?.message || String(reason || ''));
    if (msg.includes('Pending promise was never set') || msg.includes('INTERNAL ASSERTION FAILED')) {
      console.warn('Suppressed Firebase Auth internal popup assertion race condition notice:', msg);
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event?.message || String(event?.error?.message || event || '');
    if (msg.includes('Pending promise was never set') || msg.includes('INTERNAL ASSERTION FAILED')) {
      console.warn('Suppressed Firebase Auth internal popup error notice:', msg);
      event.preventDefault();
      event.stopImmediatePropagation?.();
    }
  });
}

// Unregister any lingering service workers in development to prevent caching Vite modules
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

// In production, register the service worker for PWA support
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
