import { useEffect, useState } from 'react';

interface Snapshot {
  fetchedAt: string;
  title: string | null;
  tagline: string | null;
  price: string | null;
  description: string | null;
  changed: boolean;
  summary: string | null;
  summaryStatus: string;
  pollStatus: 'ok' | 'failed' | 'incomplete' | 'delisted';
  failureReason: string | null;
}

const POLL_STATUS_TEXT: Record<Snapshot['pollStatus'], string> = {
  ok: 'ok',
  failed: 'failed',
  incomplete: 'incomplete (the source returned partial data)',
  delisted: 'delisted (the source no longer lists this competitor)',
};

export function CompetitorTimeline({ id, onBack }: { id: string; onBack: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/competitors/${encodeURIComponent(id)}/snapshots`);
        if (!response.ok) throw new Error(`Request failed with HTTP ${String(response.status)}`);
        const body = (await response.json()) as Snapshot[];
        if (!cancelled) {
          setSnapshots(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the timeline');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <section>
      <button type="button" onClick={onBack}>
        Back to competitors
      </button>
      <h2>{id}</h2>
      {error !== null && <p role="alert">{error}</p>}
      {snapshots?.length === 0 && <p>No polls yet.</p>}
      <ol reversed>
        {snapshots?.map((snapshot) => (
          <li key={snapshot.fetchedAt}>
            <p>
              <time dateTime={snapshot.fetchedAt}>
                {new Date(snapshot.fetchedAt).toLocaleString()}
              </time>{' '}
              - poll status: {POLL_STATUS_TEXT[snapshot.pollStatus]}
              {snapshot.failureReason !== null && <span> ({snapshot.failureReason})</span>}
            </p>
            {snapshot.pollStatus === 'ok' && (
              <dl>
                <dt>Title</dt>
                <dd>{snapshot.title}</dd>
                <dt>Tagline</dt>
                <dd>{snapshot.tagline}</dd>
                <dt>Price</dt>
                <dd>{snapshot.price}</dd>
                <dt>Description</dt>
                <dd>{snapshot.description}</dd>
              </dl>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
