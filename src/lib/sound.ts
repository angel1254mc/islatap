/**
 * The two notes a tap makes: a ding on contact, a sonar ping just behind it.
 *
 * Synthesized rather than sampled. These are pure tones with envelopes — the
 * one thing an oscillator does perfectly — so two files in public/ would buy
 * nothing but bytes and a fetch that has to win a race against the tap.
 *
 * Everything here is a pure scheduler: it takes the context and the time to
 * play at, writes automation onto the audio clock, and returns. Nothing here
 * creates a context, reads a preference, or touches React — that is
 * useTapSound's job, and keeping it out is what lets these run under Vitest's
 * 'node' environment against a fake, the same way history.ts takes StorageLike.
 */

/**
 * The subset of Web Audio these schedulers use. Declared structurally rather
 * than importing lib.dom types so a fake can satisfy it in a Node test run; a
 * real AudioContext satisfies it too.
 */
export interface AudioParamLike {
  setValueAtTime(value: number, at: number): void;
  linearRampToValueAtTime(value: number, at: number): void;
  exponentialRampToValueAtTime(value: number, at: number): void;
}

export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(destination: unknown): void;
  start(at: number): void;
  stop(at: number): void;
}

export interface GainLike {
  gain: AudioParamLike;
  connect(destination: unknown): void;
}

export interface AudioContextLike {
  currentTime: number;
  destination: unknown;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}

/**
 * How long after the ding the ping sounds.
 *
 * Comfortably inside MIN_PING_MS (600ms, src/lib/pacing.ts), so the ping always
 * lands while the visual rings are still expanding and no reveal can ever cut
 * it off. Two notes 300ms apart read as one gesture — call and response — where
 * a longer gap would read as two unrelated sounds.
 */
export const PING_OFFSET_S = 0.3;

/**
 * Near-silence for an exponential ramp.
 *
 * exponentialRampToValueAtTime cannot reach or cross zero — the real Web Audio
 * implementation throws on a zero target — so decays end here instead. At -80dB
 * it is inaudible.
 */
const SILENCE = 0.0001;

const DING_PEAK = 0.18;
const DING_LENGTH_S = 0.16;

const PING_PEAK = 0.09;
const PING_LENGTH_S = 0.55;

/** Bright, short, struck: the sound of the pin landing. */
export function scheduleDing(ctx: AudioContextLike, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, at);
  // A slight downward bend over the decay keeps it from sounding like a test
  // tone; struck metal never holds a perfectly flat pitch.
  osc.frequency.exponentialRampToValueAtTime(784, at + DING_LENGTH_S);

  // A 6ms attack rather than an instant one. Starting a gain at full volume
  // steps the waveform discontinuously, which is audible as a click in front of
  // the note on every device.
  gain.gain.setValueAtTime(SILENCE, at);
  gain.gain.linearRampToValueAtTime(DING_PEAK, at + 0.006);
  gain.gain.exponentialRampToValueAtTime(SILENCE, at + DING_LENGTH_S);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + DING_LENGTH_S);
}

/** The answering sweep: quieter, longer, falling away. */
export function schedulePing(ctx: AudioContextLike, at: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(700, at);
  osc.frequency.exponentialRampToValueAtTime(500, at + PING_LENGTH_S);

  gain.gain.setValueAtTime(SILENCE, at);
  gain.gain.linearRampToValueAtTime(PING_PEAK, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(SILENCE, at + PING_LENGTH_S);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(at);
  osc.stop(at + PING_LENGTH_S);
}

/**
 * Both notes of a tap, scheduled together.
 *
 * The offset rides the audio clock, not a setTimeout: it is sample-accurate,
 * it survives a busy main thread, and there is no pending timer to cancel if
 * the component unmounts mid-gesture.
 */
export function scheduleTap(ctx: AudioContextLike, at: number): void {
  scheduleDing(ctx, at);
  schedulePing(ctx, at + PING_OFFSET_S);
}
