import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadMediaWithValidation } from './replicate-media';

type MockRoute = {
  status: number;
  headers?: Record<string, string>;
  body: string | Uint8Array;
};

const createFetchMock = (
  routes: Record<string, MockRoute>,
  onCall?: (url: string, init?: RequestInit) => void
) => {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    onCall?.(url, init);
    const route = routes[url];
    if (!route) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(route.body, {
      status: route.status,
      headers: route.headers,
    });
  }) as typeof fetch;
};

test('replicate file json -> /download -> image/jpeg success', async () => {
  const calls: Array<{ url: string; auth: string | null; accept: string | null }> = [];
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/img-file': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'img-file',
        name: 'persona.jpg',
        content_type: 'image/jpeg',
      }),
    },
    'https://api.replicate.com/v1/files/img-file/download': {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255, 217]),
    },
  }, (url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    const auth = headers?.Authorization || headers?.authorization || null;
    const accept = headers?.Accept || headers?.accept || null;
    calls.push({ url, auth, accept });
  });
  const media = await downloadMediaWithValidation('https://api.replicate.com/v1/files/img-file', {
    expectedKind: 'image',
    strictExpectedKind: true,
    token: 'test-token',
    fetchFn: fetchMock,
  });
  assert.equal(media.kind, 'image');
  assert.equal(media.contentType, 'image/jpeg');
  assert.equal(media.buffer.length > 0, true);
  assert.equal(
    calls.some((c) => c.url.startsWith('https://api.replicate.com/v1/files/') && c.auth === 'Bearer test-token'),
    true
  );
  assert.equal(
    calls.some((c) => c.url.startsWith('https://api.replicate.com/v1/files/') && (c.accept || '').includes('application/octet-stream')),
    true
  );
});

test('replicate file json without download URL falls back to /download?download=1', async () => {
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/no-download': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'no-download',
        name: 'persona.jpg',
        content_type: 'image/jpeg',
      }),
    },
    'https://api.replicate.com/v1/files/no-download/download': {
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'Missing query parameters' }),
    },
    'https://api.replicate.com/v1/files/no-download/download?download=1': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        urls: {
          get: 'https://cdn.example.com/from-probe.jpg',
        },
      }),
    },
    'https://cdn.example.com/from-probe.jpg': {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255, 217]),
    },
  });
  const media = await downloadMediaWithValidation('https://api.replicate.com/v1/files/no-download', {
    expectedKind: 'image',
    strictExpectedKind: true,
    token: 'test-token',
    fetchFn: fetchMock,
  });
  assert.equal(media.kind, 'image');
  assert.equal(media.contentType, 'image/jpeg');
});

test('replicate metadata relative download URL is resolved to absolute', async () => {
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/relative-download': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'relative-download',
        content_type: 'image/jpeg',
        urls: {
          download: '/v1/files/relative-download/download?owner=test&expiry=1700000000&signature=signed',
        },
      }),
    },
    'https://api.replicate.com/v1/files/relative-download/download?owner=test&expiry=1700000000&signature=signed': {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: new Uint8Array([255, 216, 255, 217]),
    },
  });
  const media = await downloadMediaWithValidation('https://api.replicate.com/v1/files/relative-download', {
    expectedKind: 'image',
    strictExpectedKind: true,
    token: 'test-token',
    fetchFn: fetchMock,
  });
  assert.equal(media.kind, 'image');
  assert.equal(media.contentType, 'image/jpeg');
});

test('replicate file json without download URL and /download 404 fails clearly', async () => {
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/no-download': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'no-download',
        name: 'persona.jpg',
        content_type: 'image/jpeg',
      }),
    },
    'https://api.replicate.com/v1/files/no-download/download': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
    'https://api.replicate.com/v1/files/no-download/download?download=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
    'https://api.replicate.com/v1/files/no-download?download=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
    'https://api.replicate.com/v1/files/no-download?raw=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
  });
  await assert.rejects(
    () =>
      downloadMediaWithValidation('https://api.replicate.com/v1/files/no-download', {
        expectedKind: 'image',
        strictExpectedKind: true,
        token: 'test-token',
        fetchFn: fetchMock,
      }),
    /no usable download URL|no download URL|\/download endpoint is missing/
  );
});

test('replicate metadata can switch to binary via Accept hint on same URL', async () => {
  let seenCount = 0;
  const fetchMock = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = init?.headers as Record<string, string> | undefined;
    const accept = headers?.Accept || headers?.accept || '';
    seenCount += 1;
    if (seenCount === 1) {
      return new Response(
        JSON.stringify({
          id: 'meta-only',
          name: 'persona.jpg',
          content_type: 'image/jpeg',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (accept.includes('image/jpeg')) {
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    return new Response(JSON.stringify({ detail: 'unexpected' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const media = await downloadMediaWithValidation('https://api.replicate.com/v1/files/meta-only', {
    expectedKind: 'image',
    strictExpectedKind: true,
    token: 'test-token',
    fetchFn: fetchMock,
  });
  assert.equal(media.kind, 'image');
  assert.equal(media.contentType, 'image/jpeg');
});

test('resolved url with video/mp4 is handled as video', async () => {
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/video-file': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'video-file',
        urls: { download: 'https://cdn.example.com/output.mp4' },
      }),
    },
    'https://cdn.example.com/output.mp4': {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]),
    },
  });
  const media = await downloadMediaWithValidation('https://api.replicate.com/v1/files/video-file', {
    expectedKind: 'video',
    strictExpectedKind: true,
    token: 'test-token',
    fetchFn: fetchMock,
  });
  assert.equal(media.kind, 'video');
  assert.equal(media.contentType, 'video/mp4');
});

test('invalid source url fails fast with clear error', async () => {
  await assert.rejects(
    () =>
      downloadMediaWithValidation('undefined' as unknown as string, {
        expectedKind: 'image',
        strictExpectedKind: true,
        token: 'test-token',
        fetchFn: createFetchMock({}),
      }),
    /invalid source URL/
  );
});

test('malformed metadata link does not recurse into undefined url', async () => {
  const fetchMock = createFetchMock({
    'https://api.replicate.com/v1/files/bad-link': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'bad-link',
        name: 'persona.jpg',
        content_type: 'image/jpeg',
      }),
    },
    'https://api.replicate.com/v1/files/bad-link/download': {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: { get: 'undefined' } }),
    },
    'https://api.replicate.com/v1/files/bad-link/download?download=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
    'https://api.replicate.com/v1/files/bad-link?download=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
    'https://api.replicate.com/v1/files/bad-link?raw=1': {
      status: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ detail: 'not found' }),
    },
  });
  await assert.rejects(
    () =>
      downloadMediaWithValidation('https://api.replicate.com/v1/files/bad-link', {
        expectedKind: 'image',
        strictExpectedKind: true,
        token: 'test-token',
        fetchFn: fetchMock,
      }),
    /no usable download URL/
  );
});
