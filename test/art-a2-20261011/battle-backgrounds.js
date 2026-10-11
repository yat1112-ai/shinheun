// Presentation-only stage mapping. Battle data remains authoritative.
export const CH1_BACKGROUNDS = Object.freeze(Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [i + 1, `assets/scene_ch1_stage${String(i + 1).padStart(2, '0')}.webp`])
));
export function battleBackground(stageId) {
  return CH1_BACKGROUNDS[stageId] || CH1_BACKGROUNDS[1];
}
