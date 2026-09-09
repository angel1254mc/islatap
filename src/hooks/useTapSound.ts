import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_VOLUME, scheduleDing, scheduleTap } from '../lib/sound';
import { loadMuted, loadVolume, saveMuted, saveVolume } from '../lib/sound-prefs';

type AudioContextCtor = new () => AudioContext;

/**
 * Safari shipped only the prefixed constructor for years and still answers to
 * it, so both names are tried before giving up. Returning null rather than
 * throwing keeps a browser with no Web Audio at all playing the game silently.
 */
function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as typeof window & { webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Reading window.localStorage can throw outright — not return null — when a
 * browser blocks site data, so even the property access is guarded.
 */
function readMuted(): boolean {
  try {
    return loadMuted(window.localStorage);
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    saveMuted(window.localStorage, muted);
  } catch {
    // A preference that cannot be stored is not worth a crash.
  }
}

function readVolume(): number {
  try {
    return loadVolume(window.localStorage);
  } catch {
    return DEFAULT_VOLUME;
  }
}

function writeVolume(volume: number): void {
  try {
    saveVolume(window.localStorage, volume);
  } catch {
    // As above.
  }
}

export interface TapSound {
  /** Ding now, sonar ping 300ms behind it. A no-op while muted. */
  playTapSounds: () => void;
  muted: boolean;
  toggleMuted: () => void;
  /** 0..1, the slider's position rather than a gain — see volumeScale. */
  volume: number;
  setVolume: (volume: number) => void;
  /**
   * Just the ding, at the current volume. The slider needs this: without it the
   * only way to audition a change is to spend a real guess.
   */
  previewVolume: () => void;
}

export function useTapSound(): TapSound {
  const [muted, setMuted] = useState(readMuted);
  const [volume, setVolumeState] = useState(readVolume);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  /**
   * Get the context, creating it on first use, or null if this browser cannot.
   *
   * Only ever called from inside a click or key handler, which is what keeps
   * the lazy construction legal — see the note on the constructor below.
   */
  const openContext = useCallback((): AudioContext | null => {
    let context = contextRef.current;
    if (!context) {
      const Ctor = audioContextCtor();
      if (!Ctor) return null;
      try {
        // Constructed inside the tap handler on purpose. A context created
        // before any user gesture starts life 'suspended' and stays mute until
        // one arrives; created here, the tap that wants the sound is itself the
        // gesture that unlocks it.
        context = new Ctor();
      } catch (error) {
        // Not expected: the gesture requirement is already satisfied here. If it
        // ever does happen the game goes silent, so say why in the console.
        console.warn('Tap sounds off: the AudioContext failed to open.', error);
        return null;
      }
      contextRef.current = context;
    }

    // A context can be suspended out from under us — a backgrounded tab, or
    // iOS reclaiming audio for another app — and resume() is the way back.
    if (context.state === 'suspended') void context.resume();

    return context;
  }, []);

  const playTapSounds = useCallback(() => {
    if (muted) return;
    const context = openContext();
    if (!context) return;
    scheduleTap(context, context.currentTime, volume);
  }, [muted, volume, openContext]);

  /** Plays the ding. */
  const previewVolume = useCallback(() => {
    if (muted) return;
    const context = openContext();
    if (!context) return;
    scheduleDing(context, context.currentTime, volume);
  }, [muted, volume, openContext]);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    writeVolume(next);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((previous) => {
      const next = !previous;
      writeMuted(next);
      return next;
    });
  }, []);

  return { playTapSounds, muted, toggleMuted, volume, setVolume, previewVolume };
}
