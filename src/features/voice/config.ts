/**
 * Atlas has one recognisable voice identity across sessions and devices.
 *
 * Charon is Google's "informative" prebuilt voice and best matches the calm,
 * warm, concise private-chief-of-staff profile. Orus is the single deliberate
 * fallback; Atlas never rotates through random voices.
 */
export const ATLAS_VOICE = 'Charon';
export const ATLAS_VOICE_FALLBACK = 'Orus';

export function atlasSpeechConfig(voice = ATLAS_VOICE) {
  return {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: voice },
    },
  } as const;
}
