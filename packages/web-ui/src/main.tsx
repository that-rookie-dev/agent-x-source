import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme, THEME_MODE_STORAGE_KEY } from './theme';
import { AppProvider } from './store/AppContext';
import { App } from './App';

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
