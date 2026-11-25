import { describe, expect, it } from 'vitest';
import { changedInLast24hLabel, summaryNote, type NoteSnapshot } from './summary-note';

const base: NoteSnapshot = {
  changed: false,
  summary: null,
  summaryStatus: 'not_applicable',
  pollStatus: 'ok',
  failureReason: null,
};

describe('summaryNote', () => {
  it('shows the Summary itself when there is one', () => {
    const snapshot = { ...base, changed: true, summary: 'Price went up.', summaryStatus: 'ready' };
    expect(summaryNote(snapshot, true)).toBe('Price went up.');
  });

  it('says there is nothing to compare for the first Snapshot', () => {
    expect(summaryNote(base, false)).toBe('Nothing to compare yet: this is the first snapshot');
  });

  it('says no Summary is needed for an unchanged Poll with a Baseline', () => {
    expect(summaryNote(base, true)).toBe('No change');
  });

  it.each([
    ['llm_timeout', 'took too long'],
    ['llm_failed', 'could not be reached'],
    ['llm_unusable', 'could not use'],
    ['budget_exhausted', 'daily limit'],
    ['pending', 'being written'],
  ])('explains a Change whose Summary status is %s', (summaryStatus, fragment) => {
    const note = summaryNote({ ...base, changed: true, summaryStatus }, true);
    expect(note).toContain(fragment);
  });

  it('falls back to the raw status for an unknown one', () => {
    const note = summaryNote({ ...base, changed: true, summaryStatus: 'weird' }, true);
    expect(note).toContain('weird');
  });

  it.each(['failed', 'incomplete'] as const)(
    'shows the stored reason of a %s Poll',
    (pollStatus) => {
      const note = summaryNote({ ...base, pollStatus, failureReason: 'source timed out' }, true);
      expect(note).toContain('source timed out');
    },
  );

  it('explains a failed Poll without a stored reason', () => {
    expect(summaryNote({ ...base, pollStatus: 'failed' }, true)).toContain('the poll failed');
  });

  it('says a delisted competitor that stays delisted needs no Summary', () => {
    expect(summaryNote({ ...base, pollStatus: 'delisted' }, true)).toContain('still delisted');
  });
});

describe('changedInLast24hLabel', () => {
  it('shows the indicator only for a recent Change', () => {
    expect(changedInLast24hLabel(true)).toBe('Changed in the last 24 hours');
    expect(changedInLast24hLabel(false)).toBeNull();
  });
});
