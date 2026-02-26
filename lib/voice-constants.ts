// ElevenLabs Voice ID'leri (Bunlar en iyi modellerdir)
export const VOICE_CAST: Record<string, string> = {
  // ERKEKLER
  male_heroic: 'ErXwobaYiN019PkySvjV', // (Cesur, Genç, Film Yıldızı)
  male_villain: 'TxGEqnHWrfWFTfGW9XjX', // (Kötü, Derin, Tehditkar)
  male_soft_calm: 'N2lVS1w4EjpYWWo36d9t', // (Terapist, Sakin, Güvenilir)
  male_aggressive: 'TxGEqnHWrfWFTfGW9XjX', // (Bağıran, Asker, Agresif)

  // KADINLAR
  female_seductive: 'EXAVITQu4vr4xnSDxMaL', // (Çekici, Yumuşak)
  female_news_anchor: '21m00Tcm4TlvDq8ikWAM', // (Otoriter, Net)
  female_scared: 'EXAVITQu4vr4xnSDxMaL', // (Titrek, Nefes nefese)
};

// SFX Kalite Anahtarları (Bunu her promptun sonuna ekleyeceğiz)
export const SFX_QUALITY_SUFFIX =
  ', high fidelity, stereo, cinematic mixing, crystal clear audio, no background noise';
