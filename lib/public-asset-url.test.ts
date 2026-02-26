import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePublicAssetUrl } from './public-asset-url';
import type { StorageProvider } from './storage';

const createMockProvider = (): StorageProvider => ({
  upload: async (_buffer, _contentType, key) => ({ key }),
  getSignedUrl: async (key) => `https://signed.example/${encodeURIComponent(key)}`,
  getPublicUrl: async (key) => `https://public.example/${encodeURIComponent(key)}`,
});

const withFetchMock = async (
  routes: Record<string, { status: number; contentType: string; body: string | Uint8Array }>,
  run: () => Promise<void>
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const route = routes[url];
    if (!route) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(route.body, {
      status: route.status,
      headers: { 'content-type': route.contentType },
    });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test('https public url is returned unchanged', async () => {
  const url = 'https://cdn.example.com/image.png';
  await withFetchMock(
    {
      [url]: {
        status: 200,
        contentType: 'image/png',
        body: new Uint8Array([137, 80, 78, 71]),
      },
    },
    async () => {
      const out = await ensurePublicAssetUrl(
        { url },
        { provider: createMockProvider(), token: 'x' }
      );
      assert.equal(out, url);
    }
  );
});

test('localhost url + path is reuploaded and signed url is returned', async () => {
  const localUrl = 'http://localhost:3000/generated/ref.jpg';
  await withFetchMock(
    {
      [localUrl]: {
        status: 200,
        contentType: 'image/jpeg',
        body: new Uint8Array([255, 216, 255, 217]),
      },
    },
    async () => {
      const out = await ensurePublicAssetUrl(
        { url: localUrl },
        {
          provider: createMockProvider(),
          token: 'x',
          resolveAbsoluteUrl: (u) => u,
        }
      );
      assert.match(out, /^https:\/\/signed\.example\//);
    }
  );
});

test('localhost url without resolver throws clear error', async () => {
  await assert.rejects(
    () => ensurePublicAssetUrl({ url: 'http://localhost:3000/generated/ref.jpg' }, { provider: createMockProvider() }),
    /resolveAbsoluteUrl gerekli/
  );
});

test('replicate file API url bypasses conversion and returns original', async () => {
  const replicateUrl = 'https://api.replicate.com/v1/files/abc123';
  const out = await ensurePublicAssetUrl(
    { url: replicateUrl },
    { provider: createMockProvider(), token: 'test-token' }
  );
  assert.equal(out, replicateUrl);
});

test('replicate file API url bypass is case-insensitive and trimmed', async () => {
  const replicateUrl = '  https://API.REPLICATE.COM/v1/files/xyz789  ';
  const out = await ensurePublicAssetUrl(
    { url: replicateUrl },
    { provider: createMockProvider(), token: 'test-token' }
  );
  assert.equal(out, 'https://API.REPLICATE.COM/v1/files/xyz789');
});

