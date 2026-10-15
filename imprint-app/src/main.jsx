import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme, initBeauty } from './theme/theme.js';
import App from './App.jsx';
import { ListenProvider } from './lib/listen.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { registerSW, startPresence } from './lib/push.js';
import { installViewportFix } from './lib/viewportFix.js';
import './design/fonts.css';
import './design/tokens.css';
import './design/paper.css';
import './theme/cream.css';

initTheme();
initBeauty();
registerSW();
startPresence();
installViewportFix();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <ListenProvider>
        <App />
      </ListenProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
