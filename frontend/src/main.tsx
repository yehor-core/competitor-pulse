import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CompetitorList } from './CompetitorList';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <h1>CompetitorPulse</h1>
    <CompetitorList />
  </StrictMode>,
);
