import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompetitorList } from './CompetitorList';
import { CompetitorTimeline } from './CompetitorTimeline';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <h1>CompetitorPulse</h1>
      {openId === null ? (
        <CompetitorList onOpen={setOpenId} />
      ) : (
        <CompetitorTimeline
          id={openId}
          onBack={() => {
            setOpenId(null);
          }}
        />
      )}
    </>
  );
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
