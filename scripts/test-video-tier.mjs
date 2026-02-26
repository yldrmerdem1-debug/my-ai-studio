/**
 * Test both Standard (Grok) and Premium (Veo 3.1) branches of /api/generate-video.
 * Uses minimal body; request may fail at Gemini/Replicate but we verify tier routing.
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const minimalBody = (qualityTier) => ({
  prompt: `test ${qualityTier} tier - a person standing in a room`,
  qualityTier,
  dialogue: '',
  isTextOnly: true,
  personaMode: 'generic',
});

async function testTier(qualityTier, timeoutMs = 45000) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalBody(qualityTier)),
      signal: controller.signal,
    });
    clearTimeout(to);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(to);
    return { ok: false, error: err.message || String(err) };
  }
}

async function main() {
  console.log('Testing Standard (Grok) branch...');
  const standard = await testTier('standard');
  console.log('Standard result:', standard.ok ? 'OK' : 'FAIL', standard.status || '', standard.error || JSON.stringify(standard.data).slice(0, 200));

  console.log('\nTesting Premium (Veo 3.1) branch...');
  const premium = await testTier('premium');
  console.log('Premium result:', premium.ok ? 'OK' : 'FAIL', premium.status || '', premium.error || JSON.stringify(premium.data).slice(0, 200));

  const standardOk = standard.ok && (standard.data?.videoUrl || standard.data?.engine?.includes('grok'))
    || (!standard.ok && (standard.data?.error?.includes('Grok') || standard.data?.error?.includes('referans') || standard.data?.engine === 'xai/grok-imagine-video'));
  const premiumOk = premium.ok && (premium.data?.videoUrl || premium.data?.engine?.includes('veo'))
    || (!premium.ok && (premium.data?.error?.includes('Veo') || premium.data?.error?.includes('video generation')) && !premium.data?.error?.includes('Grok icin referans'));

  console.log('\n--- Summary ---');
  console.log('Standard (Grok) branch:', standardOk ? 'OK' : 'FAIL', standard.data?.engine ? `engine=${standard.data.engine}` : '');
  console.log('Premium (Veo) branch:', premiumOk ? 'OK' : 'FAIL', premium.data?.engine ? `engine=${premium.data.engine}` : '');
  process.exit(standardOk && premiumOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
