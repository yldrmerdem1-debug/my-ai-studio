import * as hub from '@huggingface/hub';
import type { RepoDesignation, RepoId, RepoType } from '@huggingface/hub';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class HuggingFaceServiceError extends Error {
  code:
    | 'HF_TOKEN_MISSING'
    | 'INVALID_REPO_ID'
    | 'FILE_NOT_FOUND'
    | 'UPLOAD_FAILED'
    | 'REPO_CREATE_FAILED';

  constructor(
    code: HuggingFaceServiceError['code'],
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = 'HuggingFaceServiceError';
    this.code = code;
    (this as any).cause = cause;
  }
}

type UploadLoRAOptions = {
  /**
   * Upload target repo type.
   * The user request asked specifically for `https://huggingface.co/datasets/...` links,
   * so we default to `dataset`.
   */
  repoType?: RepoType;
  /**
   * Target branch, default `main`.
   */
  branch?: string;
  /**
   * Optional path inside the repo (defaults to filename).
   */
  remotePath?: string;
};

export default class HuggingFaceService {
  private readonly token: string;

  constructor(token = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGINGFACE_TOKEN) {
    const resolved = String(token || '').trim();
    if (!resolved) {
      throw new HuggingFaceServiceError(
        'HF_TOKEN_MISSING',
        'HF_TOKEN is not configured. Please set process.env.HF_TOKEN (or HUGGINGFACEHUB_API_TOKEN) with a Hugging Face access token.'
      );
    }
    this.token = resolved;
  }

  /**
   * Upload a LoRA weights file to a Hugging Face Hub repo and return a public `resolve` link.
   *
   * `repoId` must be in the form: `owner/name` (without `datasets/` prefix).
   *
   * Returns:
   * - `https://huggingface.co/datasets/<owner>/<name>/resolve/main/<file>`
   */
  async uploadLoRA(
    filePath: string,
    repoId: string,
    options: UploadLoRAOptions = {}
  ): Promise<string> {
    const repoIdTrimmed = String(repoId || '').trim();
    if (!/^[^/\s]+\/[^/\s]+$/.test(repoIdTrimmed) || repoIdTrimmed.includes('datasets/')) {
      throw new HuggingFaceServiceError(
        'INVALID_REPO_ID',
        `Invalid repoId "${repoId}". Expected "owner/name" (without "datasets/" prefix).`
      );
    }

    const absolutePath = path.resolve(String(filePath || '').trim());
    let stat: { size: number } | null = null;
    try {
      stat = await fs.stat(absolutePath);
    } catch (err) {
      throw new HuggingFaceServiceError(
        'FILE_NOT_FOUND',
        `File not found: ${absolutePath}`,
        err
      );
    }
    if (!stat || stat.size <= 0) {
      throw new HuggingFaceServiceError(
        'FILE_NOT_FOUND',
        `File is empty or unreadable: ${absolutePath}`
      );
    }

    const branch = (options.branch || 'main').trim() || 'main';
    const repoType: RepoType = (options.repoType || 'dataset') as RepoType;
    const repo: RepoId = { type: repoType, name: repoIdTrimmed };

    const filename = path.basename(absolutePath);
    const remotePath = (options.remotePath || filename).replace(/^\/+/, '');

    // Create repo if missing. If it already exists, ignore the error.
    try {
      await hub.createRepo({
        repo,
        accessToken: this.token,
      });
    } catch (err: any) {
      const message = String(err?.message || err || '');
      const looksAlreadyExists =
        message.toLowerCase().includes('already exists')
        || message.toLowerCase().includes('already created this dataset repo')
        || message.toLowerCase().includes('already created this repo')
        || message.toLowerCase().includes('409')
        || message.toLowerCase().includes('conflict');
      if (!looksAlreadyExists) {
        throw new HuggingFaceServiceError(
          'REPO_CREATE_FAILED',
          `Failed to create/access Hugging Face repo "${repoType}:${repoIdTrimmed}". ${message}`,
          err
        );
      }
    }

    try {
      await hub.uploadFiles({
        repo,
        accessToken: this.token,
        branch,
        files: [
          {
            path: remotePath,
            // Use local file URL to avoid loading large weights fully into memory.
            content: pathToFileURL(absolutePath),
          },
        ],
        // Optional commit metadata (helps debugging in the Hub UI)
        commitTitle: `Upload LoRA: ${remotePath}`,
        commitDescription: `Uploaded from ${absolutePath}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HuggingFaceServiceError(
        'UPLOAD_FAILED',
        `Hugging Face upload failed for "${absolutePath}" → "${repoType}:${repoIdTrimmed}/${remotePath}" (${branch}). ${message}`,
        err
      );
    }

    // Build the public resolve URL.
    // User requested: https://huggingface.co/datasets/RESOLVE/LINK...
    const base =
      repoType === 'dataset'
        ? `https://huggingface.co/datasets/${repoIdTrimmed}`
        : `https://huggingface.co/${repoIdTrimmed}`;
    const encodedPath = remotePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `${base}/resolve/${encodeURIComponent(branch)}/${encodedPath}`;
  }
}

