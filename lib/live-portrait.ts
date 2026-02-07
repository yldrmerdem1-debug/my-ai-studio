import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

const extractVideoUrl = (output: any): string => {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const found = extractVideoUrl(item);
      if (found) return found;
    }
    return '';
  }
  if (typeof output === 'object') {
    const candidates = [output.url, output.video, output.output, output.mp4];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') return candidate;
    }
    for (const value of Object.values(output)) {
      const found = extractVideoUrl(value);
      if (found) return found;
    }
  }
  return '';
};

export async function generateLivePortraitVideo(
  imageUrl: string,
  audioUrl: string
): Promise<string> {
  console.log('🗣️ LIVE PORTRAIT STARTING...');
  console.log('   - Image:', imageUrl);
  console.log('   - Audio:', audioUrl);

  const model = 'fofr/live-portrait:9f74766999015ad97b97c00624d7858c8942095f979857d4a572c6591295256e';
  try {
    const output = await replicate.run(model, {
      input: {
        driving_audio: audioUrl,
        source_image: imageUrl,
        take_best_frame: true,
        relative_motion: true,
        driving_multiplier: 1.0,
        flag_do_crop: true,
        flag_stitching: true,
      },
    });

    console.log('🗣️ LIVE PORTRAIT OUTPUT:', output);
    const videoUrl = extractVideoUrl(output);
    if (!videoUrl) {
      console.error('❌ LIVE PORTRAIT OUTPUT MISSING URL:', output);
      return '';
    }
    return videoUrl;
  } catch (error) {
    console.error('❌ LIVE PORTRAIT ERROR:', error);
    return '';
  }
}
