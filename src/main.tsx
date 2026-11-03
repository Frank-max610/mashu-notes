import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root container is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell is only available in secure contexts (https or localhost).
// On a plain http LAN address the app still works, it just needs the network.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).href;
    navigator.serviceWorker.register(url).catch(() => {
      /* offline support is a progressive enhancement */
    });
  });
}
