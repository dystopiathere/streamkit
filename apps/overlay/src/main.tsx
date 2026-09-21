import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
// Шрифты виджетов своими файлами: шрифт, которого нет на машине с OBS, молча
// подменяется системным, и в кадр уходит не то, что настроил стример.
import '@streamkit/ui/fonts.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Не найден корневой элемент');
}

createRoot(container).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>,
);
