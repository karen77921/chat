import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme, initBeauty } from './theme/theme.js';
import App from './App.jsx';
import { ListenProvider } from './lib/listen.jsx';
import './design/tokens.css';
import './design/paper.css';

initTheme();
initBeauty();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ListenProvider>
      <App />
    </ListenProvider>
  </StrictMode>,
);
