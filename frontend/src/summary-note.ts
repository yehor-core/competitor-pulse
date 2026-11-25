export interface NoteSnapshot {
  changed: boolean;
  summary: string | null;
  summaryStatus: string;
  pollStatus: 'ok' | 'failed' | 'incomplete' | 'delisted';
  failureReason: string | null;
}

// Why a Change has no Summary, per status, so the user is never left guessing.
const NO_SUMMARY_TEXT: Record<string, string> = {
  pending: 'Summary is being written.',
  llm_timeout: 'Summary not available: the language model took too long to answer.',
  llm_failed:
    'Summary not available: the language model could not be reached or returned an error.',
  llm_unusable: 'Summary not available: the language model returned an answer we could not use.',
  budget_exhausted: 'Summary not available: the daily limit of language model calls was reached.',
};

/**
 * The line shown under a Snapshot in place of its Summary. Every Snapshot gets one.
 * `hasBaseline` is whether an earlier `ok` Poll exists to compare against.
 */
export function summaryNote(snapshot: NoteSnapshot, hasBaseline: boolean): string {
  if (snapshot.summary !== null) return snapshot.summary;
  if (snapshot.changed) {
    return (
      NO_SUMMARY_TEXT[snapshot.summaryStatus] ??
      `Summary not available (${snapshot.summaryStatus}).`
    );
  }
  if (snapshot.pollStatus === 'failed' || snapshot.pollStatus === 'incomplete') {
    const what = snapshot.pollStatus === 'failed' ? 'the poll failed' : 'the poll was incomplete';
    const reason = snapshot.failureReason === null ? '' : `: ${snapshot.failureReason}`;
    return `No summary: ${what}, so nothing could be compared${reason}`;
  }
  if (snapshot.pollStatus === 'delisted') {
    return 'No summary needed: the competitor is still delisted';
  }
  return hasBaseline ? 'No change' : 'Nothing to compare yet: this is the first snapshot';
}

export function changedInLast24hLabel(changedInLast24h: boolean): string | null {
  return changedInLast24h ? 'Changed in the last 24 hours' : null;
}
