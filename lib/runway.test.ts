import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractFirstOutputUrl, normalizeRunwayTaskStatus } from '@/lib/runway';

describe('runway helpers', () => {
  it('normalizes statuses', () => {
    assert.equal(normalizeRunwayTaskStatus('CREATED'), 'PENDING');
    assert.equal(normalizeRunwayTaskStatus('PENDING'), 'PENDING');
    assert.equal(normalizeRunwayTaskStatus('RUNNING'), 'RUNNING');
    assert.equal(normalizeRunwayTaskStatus('processing'), 'RUNNING');
    assert.equal(normalizeRunwayTaskStatus('SUCCEEDED'), 'SUCCEEDED');
    assert.equal(normalizeRunwayTaskStatus('FAILED'), 'FAILED');
    assert.equal(normalizeRunwayTaskStatus('CANCELED'), 'FAILED');
  });

  it('extracts first output url', () => {
    assert.equal(extractFirstOutputUrl(['https://a.com/out.mp4']), 'https://a.com/out.mp4');
    assert.equal(extractFirstOutputUrl({ output: ['https://a.com/x.mp4'] }), 'https://a.com/x.mp4');
    assert.equal(extractFirstOutputUrl({ nested: { url: 'https://a.com/y.mp4' } }), 'https://a.com/y.mp4');
    assert.equal(extractFirstOutputUrl(null), null);
  });
});

