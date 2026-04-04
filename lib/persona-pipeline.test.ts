import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPersonaImageEngineOptions,
  getPersonaTrainingProfile,
  getTrainingEngineLabel,
  normalizePersonaGenerationMode,
  normalizePersonaImageEngine,
  resolvePersonaImageEngine,
} from './persona-pipeline';

test('human training profile uses portrait trainer and wider identity guidance', () => {
  const profile = getPersonaTrainingProfile('human');
  assert.equal(profile.engineId, 'flux-lora-portrait-trainer');
  assert.equal(profile.provider, 'fal');
  assert.equal(profile.minImages, 10);
  assert.equal(profile.maxImages, 25);
  assert.equal(profile.referenceImagesMax, 4);
});

test('product training profile supports more training and reference images', () => {
  const profile = getPersonaTrainingProfile('product');
  assert.equal(profile.engineId, 'flux-dev-lora-trainer');
  assert.equal(profile.provider, 'replicate');
  assert.equal(profile.minImages, 12);
  assert.equal(profile.maxImages, 40);
  assert.equal(profile.referenceImagesMax, 6);
});

test('image engine normalization accepts user facing aliases', () => {
  assert.equal(normalizePersonaImageEngine('FLUX Kontext LoRA'), 'flux-kontext-lora');
  assert.equal(normalizePersonaImageEngine('flux 2 max'), 'flux-2-max');
  assert.equal(normalizePersonaGenerationMode('Exact'), 'exact');
});

test('auto engine prefers kontext when exact mode has reference', () => {
  const resolved = resolvePersonaImageEngine({
    requestedEngine: 'auto',
    hasPersona: true,
    hasReferenceImage: true,
    generationMode: 'exact',
  });
  assert.equal(resolved, 'flux-kontext-lora');
});

test('non-persona auto engine falls back to prompt-only flux when no reference exists', () => {
  const resolved = resolvePersonaImageEngine({
    requestedEngine: 'auto',
    hasPersona: false,
    hasReferenceImage: false,
    generationMode: 'creative',
  });
  assert.equal(resolved, 'flux-2-max');
});

test('image engine options stay context aware', () => {
  assert.deepEqual(
    getPersonaImageEngineOptions(true).map((engine) => engine.id),
    ['flux-dev-lora', 'flux-kontext-lora']
  );
  assert.deepEqual(
    getPersonaImageEngineOptions(false).map((engine) => engine.id),
    ['flux-2-max', 'flux-kontext-pro']
  );
});

test('training engine label recognizes replicate flux trainer', () => {
  assert.equal(
    getTrainingEngineLabel('ostris/flux-dev-lora-trainer'),
    'Replicate FLUX Dev LoRA Trainer'
  );
});
