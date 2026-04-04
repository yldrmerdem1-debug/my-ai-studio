import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSafetensorsFromTar, isArchiveLoraUrl, isSafetensorsBuffer, normalizeLoraWeightsBuffer } from './lora-weights';

const createFakeSafetensors = () => {
  const header = Buffer.from('{"__metadata__":{"format":"pt"}}', 'utf8');
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64LE(BigInt(header.length), 0);
  return Buffer.concat([prefix, header, Buffer.from([1, 2, 3, 4])]);
};

const createTarEntry = (name: string, data: Buffer, typeFlag = '0') => {
  const header = Buffer.alloc(512, 0);
  Buffer.from(name).copy(header, 0, 0, Math.min(Buffer.byteLength(name), 100));
  Buffer.from('0000777\0').copy(header, 100);
  Buffer.from('0000000\0').copy(header, 108);
  Buffer.from('0000000\0').copy(header, 116);
  Buffer.from(`${data.length.toString(8).padStart(11, '0')}\0`).copy(header, 124);
  Buffer.from('00000000000\0').copy(header, 136);
  header[156] = typeFlag.charCodeAt(0);
  Buffer.from('ustar\0').copy(header, 257);
  Buffer.from('00').copy(header, 263);
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
};

test('recognizes a direct safetensors buffer', () => {
  const buffer = createFakeSafetensors();
  assert.equal(isSafetensorsBuffer(buffer), true);

  const normalized = normalizeLoraWeightsBuffer(buffer, 'weights.safetensors');
  assert.equal(normalized.kind, 'safetensors');
  assert.equal(normalized.extractedFromArchive, false);
  assert.equal(normalized.extension, 'safetensors');
});

test('extracts safetensors from tar archives with pax headers', () => {
  const safetensors = createFakeSafetensors();
  const pax = createTarEntry('././@PaxHeader', Buffer.from('28 path=flux-lora.safetensors\n', 'utf8'), 'x');
  const file = createTarEntry('flux-lora.safetensors', safetensors);
  const tarBuffer = Buffer.concat([pax, file, Buffer.alloc(1024, 0)]);

  const extracted = extractSafetensorsFromTar(tarBuffer);
  assert.ok(extracted);
  assert.equal(isSafetensorsBuffer(extracted!), true);

  const normalized = normalizeLoraWeightsBuffer(tarBuffer, 'weights.safetensors');
  assert.equal(normalized.kind, 'safetensors');
  assert.equal(normalized.extractedFromArchive, true);
  assert.equal(normalized.extension, 'safetensors');
  assert.deepEqual(normalized.buffer, safetensors);
});

test('flags archive-style LoRA URLs', () => {
  assert.equal(isArchiveLoraUrl('https://replicate.delivery/xezq/file/flux-lora.tar'), true);
  assert.equal(isArchiveLoraUrl('https://example.com/model.safetensors'), false);
});
