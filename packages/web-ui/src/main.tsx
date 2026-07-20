import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme, THEME_MODE_STORAGE_KEY } from './theme';
import { AppProvider } from './store/AppContext';
import { setAuthToken } from './api';
import { App } from './App';

// Auth-token handoff for child windows (e.g. the Neural Cortex window):
// the opener passes its Bearer token via URL hash, which never reaches the
// server. Must run before AppContext's auth check, since sessionStorage is
// not shared across windows.
if (window.location.hash.startsWith('#tk=')) {
  const token = decodeURIComponent(window.location.hash.slice(4));
  if (token) setAuthToken(token);
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider
        theme={theme}
        defaultMode="dark"
        modeStorageKey={THEME_MODE_STORAGE_KEY}
        disableTransitionOnChange
        noSsr
      >
        <CssBaseline />
        <AppProvider>
          <App />
        </AppProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
