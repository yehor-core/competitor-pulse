import { useCallback, useEffect, useState, type SubmitEvent } from 'react';

interface Competitor {
  id: string;
  awaitingFirstPollReason: string | null;
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

export function CompetitorList() {
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

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const response = await fetch('/api/competitors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: newId.trim() }),
    });
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    setNewId('');
    await load();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/competitors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      setError(await errorMessage(response));
      return;
    }
    await load();
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
              {competitor.id}
              {competitor.awaitingFirstPollReason !== null && (
                <span> (waiting for first poll: {competitor.awaitingFirstPollReason})</span>
              )}{' '}
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
