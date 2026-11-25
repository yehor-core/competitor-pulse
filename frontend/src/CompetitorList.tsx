import { useCallback, useState, type SubmitEvent } from 'react';
import { changedInLast24hLabel } from './summary-note';
import { useAutoRefresh } from './useAutoRefresh';

interface Competitor {
  id: string;
  awaitingFirstPollReason: string | null;
  lastChangedAt: string | null;
  changedInLast24h: boolean;
  lastPolledAt: string | null;
  lastPollStatus: 'ok' | 'failed' | 'incomplete' | 'delisted' | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      return String(body.message);
    }
  } catch {
    // Body was not JSON; fall through to the status line.
  }
  return `Request failed with HTTP ${String(response.status)}`;
}

export function CompetitorList({ onOpen }: { onOpen: (id: string) => void }) {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [newId, setNewId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/competitors');
      if (!response.ok) throw new Error(await errorMessage(response));
      setCompetitors((await response.json()) as Competitor[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load competitors');
    }
  }, []);

  useAutoRefresh(load);

  async function send(url: string, init: RequestInit): Promise<boolean> {
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        setError(await errorMessage(response));
        return false;
      }
      setError(null);
      return true;
    } catch {
      setError('Could not reach the backend');
      return false;
    }
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const ok = await send('/api/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId.trim() }),
    });
    if (!ok) return;
    setNewId('');
    await load();
  }

  async function remove(id: string) {
    const ok = await send(`/api/competitors/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (ok) await load();
  }

  return (
    <section>
      <h2>Competitors</h2>
      <form onSubmit={(event) => void add(event)}>
        <input
          aria-label="Competitor id"
          placeholder="e.g. acme-crm"
          value={newId}
          onChange={(event) => {
            setNewId(event.target.value);
          }}
        />
        <button type="submit" disabled={newId.trim() === ''}>
          Add
        </button>
      </form>
      {error !== null && <p role="alert">{error}</p>}
      {competitors.length === 0 ? (
        <p>No competitors tracked yet.</p>
      ) : (
        <ul>
          {competitors.map((competitor) => (
            <li key={competitor.id}>
              <button
                type="button"
                onClick={() => {
                  onOpen(competitor.id);
                }}
              >
                {competitor.id}
              </button>
              {competitor.awaitingFirstPollReason !== null && (
                <span> (waiting for first poll: {competitor.awaitingFirstPollReason})</span>
              )}
              {changedInLast24hLabel(competitor.changedInLast24h) !== null && (
                <strong> {changedInLast24hLabel(competitor.changedInLast24h)}</strong>
              )}
              <span>
                {' '}
                - last change:{' '}
                {competitor.lastChangedAt === null ? 'none yet' : when(competitor.lastChangedAt)};
                last poll:{' '}
                {competitor.lastPolledAt === null
                  ? 'not polled yet'
                  : `${when(competitor.lastPolledAt)} (${competitor.lastPollStatus ?? 'unknown'})`}
              </span>{' '}
              <button
                type="button"
                onClick={() => {
                  void remove(competitor.id);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
