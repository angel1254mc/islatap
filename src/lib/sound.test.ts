import { describe, expect, it } from 'vitest';
import {
  PING_OFFSET_S,
  scheduleDing,
  schedulePing,
  scheduleTap,
  type AudioContextLike,
} from './sound';

interface ParamEvent {
  kind: 'set' | 'linear' | 'exponential';
  value: number;
  at: number;
}

interface FakeVoice {
  type: string;
  frequency: ParamEvent[];
  gain: ParamEvent[];
  startedAt: number | null;
  stoppedAt: number | null;
}

/**
 * Records everything the schedulers do to a context, so the tests can assert on
 * the note that would be heard rather than on a mock's call log. Structurally a
 * subset of the real AudioContext — the same subset AudioContextLike names.
 */
function fakeContext(currentTime = 0): AudioContextLike & { voices: FakeVoice[] } {
  const voices: FakeVoice[] = [];

  const param = (log: ParamEvent[]) => ({
    setValueAtTime: (value: number, at: number) => void log.push({ kind: 'set', value, at }),
    linearRampToValueAtTime: (value: number, at: number) =>
      void log.push({ kind: 'linear', value, at }),
    exponentialRampToValueAtTime: (value: number, at: number) =>
      void log.push({ kind: 'exponential', value, at }),
  });

  // One voice per oscillator. createGain() is called immediately after its
  // oscillator by both schedulers, so the gain log attaches to the last voice.
  return {
    voices,
    currentTime,
    destination: {},
    createOscillator() {
      const voice: FakeVoice = {
        type: '',
        frequency: [],
        gain: [],
        startedAt: null,
        stoppedAt: null,
      };
      voices.push(voice);
      return {
        get type() {
          return voice.type;
        },
        set type(value: string) {
          voice.type = value;
        },
        frequency: param(voice.frequency),
        connect: () => {},
        start: (at: number) => {
          voice.startedAt = at;
        },
        stop: (at: number) => {
          voice.stoppedAt = at;
        },
      };
    },
    createGain() {
      const voice = voices[voices.length - 1];
      return { gain: param(voice.gain), connect: () => {} };
    },
  };
}

const peak = (events: ParamEvent[]): number => Math.max(...events.map((e) => e.value));

describe('scheduleDing', () => {
  it('starts exactly when asked and stops after itself', () => {
    const ctx = fakeContext();
    scheduleDing(ctx, 2);
    const [voice] = ctx.voices;
    expect(voice.startedAt).toBe(2);
    expect(voice.stoppedAt).toBeGreaterThan(2);
  });

  it('decays to silence by the time it stops', () => {
    const ctx = fakeContext();
    scheduleDing(ctx, 0);
    const [voice] = ctx.voices;
    const last = voice.gain[voice.gain.length - 1];
    expect(last.value).toBeLessThan(0.001);
    expect(last.at).toBeLessThanOrEqual(voice.stoppedAt!);
  });

  it('is short — a tap acknowledgement, not a note', () => {
    const ctx = fakeContext();
    scheduleDing(ctx, 0);
    expect(ctx.voices[0].stoppedAt!).toBeLessThan(0.3);
  });
});

describe('schedulePing', () => {
  it('sweeps downward, the way a sonar return falls away', () => {
    const ctx = fakeContext();
    schedulePing(ctx, 0);
    const { frequency } = ctx.voices[0];
    expect(frequency.length).toBeGreaterThan(1);
    expect(frequency[frequency.length - 1].value).toBeLessThan(frequency[0].value);
  });

  it('rings longer than the ding', () => {
    const ding = fakeContext();
    scheduleDing(ding, 0);
    const ping = fakeContext();
    schedulePing(ping, 0);
    expect(ping.voices[0].stoppedAt!).toBeGreaterThan(ding.voices[0].stoppedAt!);
  });

  it('sits quieter than the ding, so it reads as distant', () => {
    const ding = fakeContext();
    scheduleDing(ding, 0);
    const ping = fakeContext();
    schedulePing(ping, 0);
    expect(peak(ping.voices[0].gain)).toBeLessThan(peak(ding.voices[0].gain));
  });
});

describe('scheduleTap', () => {
  it('dings on the tap and pings 300ms later', () => {
    const ctx = fakeContext(5);
    scheduleTap(ctx, 5);
    const [ding, ping] = ctx.voices;
    expect(ding.startedAt).toBe(5);
    expect(ping.startedAt).toBe(5 + PING_OFFSET_S);
    expect(PING_OFFSET_S).toBe(0.3);
  });

  it('schedules both notes up front, so neither depends on a later timer', () => {
    const ctx = fakeContext(0);
    scheduleTap(ctx, 0);
    expect(ctx.voices).toHaveLength(2);
  });

  it('lands the ping well inside the 600ms reveal floor', () => {
    const ctx = fakeContext(0);
    scheduleTap(ctx, 0);
    const ping = ctx.voices[1];
    expect(ping.startedAt!).toBeLessThan(0.6);
  });
});
