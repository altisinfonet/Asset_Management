/**
 * Short audible confirmation of a scan (design system checklist item 11: sound always has a visual
 * equivalent, and is optional). Silent where the Web Audio API is missing (tests, old browsers).
 */
let context: AudioContext | undefined;

export function beep(kind: 'ok' | 'error'): void {
  try {
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
        : undefined;
    if (!Ctor) return;
    context ??= new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = kind === 'ok' ? 880 : 220;
    gain.gain.value = 0.08;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (kind === 'ok' ? 0.08 : 0.25));
  } catch {
    // audio blocked or unavailable: the visual feedback is enough
  }
}
