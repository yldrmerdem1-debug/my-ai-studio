# My AI Studio

Persona-first AI content studio for ads, creators, and branded media.  
The product is built around a simple idea: generate content as a trained identity, not as a generic model. That means scripts, images, and videos can stay visually and stylistically consistent across the full workflow.

## What It Does
- Train visual personas for humans, products, animals, and other subjects
- Generate images with or without a trained persona
- Generate videos from prompts, persona references, and image references
- Build ad scripts and creative directions
- Create voice-driven content and audio-enhanced media workflows
- Support premium persona-based generation alongside generic generation modes

## Core Product Idea
Generic AI creates one-off outputs.  
This app is designed to create repeatable outputs around a persistent subject identity.

That identity can be:
- a person
- a product
- a brand face
- a recurring creative character

The main commercial value of the product is consistency. A trained persona can be reused across image, video, and prompt workflows so content feels like it came from the same source every time.

## Main Workflows

### 1. Persona Training
Users upload a set of training images and create a visual persona.  
The app supports subject-aware training flows, so humans and products can use different recommended pipelines.

### 2. Image Generation
Users can:
- generate from prompt only
- generate with a persona
- generate with a persona plus reference image for tighter control

### 3. Video Generation
Users can:
- generate from prompt only
- generate from image reference
- generate with persona-enhanced reference flow
- use additional post-processing such as face swap or audio merge where enabled

### 4. Ad / Creative Tools
The app also includes helper workflows for:
- ad script generation
- background change
- studio image generation
- video packaging / auto-editor style flows

## Tech Stack
- `Next.js` for the app and API routes
- `React` for the client UI
- `TypeScript` across the project
- `Replicate` for image, video, and LoRA-related provider flows
- `fal.ai` for selected training and generation flows
- `Gemini` for prompt intelligence, creative planning, and analysis
- `Supabase` for metadata and app data
- `Cloudflare R2` for heavy media storage
- `Hugging Face` for model / LoRA hosting where needed
- `fluent-ffmpeg` for video post-processing utilities

## Storage Model
Use the project with this separation in mind:

- `Supabase`: metadata, persona records, job records, app-level structured data
- `R2`: generated images, generated videos, uploaded media, runtime assets
- `Hugging Face` or provider-hosted URLs: LoRA weights / model artifacts
- local temp/runtime files: development only, not source of truth

## Repository Structure
- `app/`: Next.js pages and API routes
- `components/`: reusable UI building blocks
- `hooks/`: shared React hooks
- `lib/`: provider logic, storage helpers, media helpers, business utilities
- `config/`: model and runtime configuration
- `data/`: local data snapshots and development helpers
- `scripts/`: maintenance and migration scripts
- `public/`: static assets and local generated output paths

## Local Development

### Requirements
- Node.js 20+
- npm
- provider keys for the features you want to run

### Install
```bash
npm install
```

### Configure Environment
Copy the example file and fill in only the provider keys you need:
```bash
cp .env.example .env.local
```

Never commit `.env.local` or real provider credentials.

### Start Development Server
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm run start
```

### Lint
```bash
npm run lint
```

### Tests
```bash
npm test
```

## Useful Scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm test`
- `npm run sync:personas:hf`
- `npm run migrate:to:hf`
- `npm run personas:apply-clean`

## Environment Notes
The app depends on provider-specific environment variables. Start from `.env.example`; exact values depend on which flows you want enabled, but common categories are:

- site/base URL config
- Supabase config
- Replicate API token and model config
- fal.ai API key
- Gemini API key
- R2 bucket and S3-compatible credentials
- optional Hugging Face token/repo config

Keep secrets in local environment files or deployment secrets, not in the repository.

## Public Repository Notes
This repository is prepared for public portfolio review:

- real API keys and deployment secrets are excluded from Git
- generated media and runtime persona data are ignored
- local data files are treated as development artifacts
- provider credentials should be configured through `.env.local` or deployment secrets

## Training Notes
Persona training is built around FLUX LoRA workflows.

Important distinction:
- trainer model/version = the provider-side training engine
- destination model = where the trained result is published or referenced

If you use Replicate-based LoRA training, make sure your environment points to the correct destination model and trainer version.

## Commercial / Production Guidance
For production use:
- keep runtime assets out of Git
- keep generated media in object storage
- keep metadata in the database
- keep secrets out of the repo
- treat local JSON snapshots as development artifacts, not production truth

## Current Positioning
This project is best understood as a high-end persona media studio:
- persona training
- controlled image generation
- prompt-to-video and reference-to-video workflows
- ad and content production helpers

It is not just a prompt playground; it is an identity-driven content system.
