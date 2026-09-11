import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../client/fonts';
import '../client/styles.css';
import { PreviewApp } from './PreviewApp';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root container.');

createRoot(container).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
