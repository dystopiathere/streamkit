import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './lib/i18n';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден корневой элемент');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
