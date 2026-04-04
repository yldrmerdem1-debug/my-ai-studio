type NormalizedLoraWeightsKind = 'safetensors' | 'archive' | 'unknown';

export type NormalizedLoraWeights = {
  buffer: Buffer;
  extension: 'safetensors' | 'tar' | 'bin';
  kind: NormalizedLoraWeightsKind;
  extractedFromArchive: boolean;
};

const stripNull = (value: string) => value.replace(/\0.*$/, '').trim();

const isZeroBlock = (buffer: Buffer) => {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) return false;
  }
  return true;
};

const readTarName = (header: Buffer) => {
  const name = stripNull(header.subarray(0, 100).toString('utf8'));
  const prefix = stripNull(header.subarray(345, 500).toString('utf8'));
  return prefix ? `${prefix}/${name}` : name;
};

const readTarSize = (header: Buffer) => {
  const raw = stripNull(header.subarray(124, 136).toString('utf8')).replace(/\s+/g, '');
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export const isSafetensorsBuffer = (buffer: Buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return false;
  try {
    const headerLength = Number(buffer.readBigUInt64LE(0));
    if (!Number.isFinite(headerLength) || headerLength <= 1 || headerLength > buffer.length - 8) {
      return false;
    }
    const headerStart = 8;
    const headerEnd = headerStart + headerLength;
    const headerText = buffer.subarray(headerStart, headerEnd).toString('utf8').trim();
    if (!headerText.startsWith('{')) return false;
    const parsed = JSON.parse(headerText);
    return Boolean(parsed && typeof parsed === 'object');
  } catch {
    return false;
  }
};

export const isTarArchiveBuffer = (buffer: Buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 512) return false;
  const header = buffer.subarray(0, 512);
  const magic = header.subarray(257, 262).toString('utf8');
  const name = stripNull(header.subarray(0, 100).toString('utf8'));
  return magic === 'ustar' || name === '././@PaxHeader';
};

export const extractSafetensorsFromTar = (buffer: Buffer): Buffer | null => {
  if (!isTarArchiveBuffer(buffer)) return null;

  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (isZeroBlock(header)) break;

    const name = readTarName(header).toLowerCase();
    const size = readTarSize(header);
    const typeFlag = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) break;

    const isRegularFile = typeFlag === 0 || typeFlag === 48 || typeFlag === 55;
    if (isRegularFile && name.endsWith('.safetensors')) {
      return Buffer.from(buffer.subarray(dataStart, dataEnd));
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return null;
};

export const isArchiveLoraUrl = (value: string) => {
  const lower = String(value || '').trim().toLowerCase();
  return /\.tar(\?|#|$)/i.test(lower) || /\.zip(\?|#|$)/i.test(lower) || lower.includes('flux-lora.tar');
};

export const normalizeLoraWeightsBuffer = (
  buffer: Buffer,
  hintedName = ''
): NormalizedLoraWeights => {
  if (isSafetensorsBuffer(buffer)) {
    return {
      buffer,
      extension: 'safetensors',
      kind: 'safetensors',
      extractedFromArchive: false,
    };
  }

  const extracted = extractSafetensorsFromTar(buffer);
  if (extracted && isSafetensorsBuffer(extracted)) {
    return {
      buffer: extracted,
      extension: 'safetensors',
      kind: 'safetensors',
      extractedFromArchive: true,
    };
  }

  if (isTarArchiveBuffer(buffer) || isArchiveLoraUrl(hintedName)) {
    return {
      buffer,
      extension: 'tar',
      kind: 'archive',
      extractedFromArchive: false,
    };
  }

  return {
    buffer,
    extension: /\.safetensors(\?|#|$)/i.test(hintedName) ? 'safetensors' : 'bin',
    kind: 'unknown',
    extractedFromArchive: false,
  };
};
