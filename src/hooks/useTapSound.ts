import { useCallback, useEffect, useRef, useState } from 'react';
import { scheduleTap } from '../lib/sound';
import { loadMuted, saveMuted } from '../lib/sound-prefs';

/**
 * Owns the AudioContext behind the tap sounds, and ties its life to the
 * component's.
 *
 * A module-level singleton would be simpler and wrong: browsers cap how many
 * AudioContexts a page may hold (Chrome at six), and every one is a live audio
 * thread. Under StrictMode's double-mount and Vite's Fast Refresh, a singleton
 * that is never closed leaks one per reload until the seventh construction
 * throws and the game goes silent for the rest of the dev session. The context
 * lives in a ref here and is closed on unmount.
 *
 * There is no automated test: the repo runs Vitest under `environment: 'node'`,
 * where there is neither React DOM nor Web Audio. The schedulable part is
 * therefore pushed down into src/lib/sound.ts, which is pure and covered; what
 * is left here is lifecycle, and it is verified by ear.
 */

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

export interface TapSound {
  /** Ding now, sonar ping 300ms behind it. A no-op while muted. */
  playTapSounds: () => void;
  muted: boolean;
  toggleMuted: () => void;
}

export function useTapSound(): TapSound {
  const [muted, setMuted] = useState(readMuted);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      void contextRef.current?.close();
      contextRef.current = null;
    },
    [],
  );

  const playTapSounds = useCallback(() => {
    if (muted) return;

    let context = contextRef.current;
    if (!context) {
      const Ctor = audioContextCtor();
      if (!Ctor) return;
      try {
        // Constructed inside the tap handler on purpose. A context created
        // before any user gesture starts life 'suspended' and stays mute until
        // one arrives; created here, the tap that wants the sound is itself the
        // gesture that unlocks it.
        context = new Ctor();
      } catch {
        return;
      }
      contextRef.current = context;
    }

    // A context can be suspended out from under us — a backgrounded tab, or
    // iOS reclaiming audio for another app — and resume() is the way back.
    if (context.state === 'suspended') void context.resume();

    scheduleTap(context, context.currentTime);
  }, [muted]);

  const toggleMuted = useCallback(() => {
    setMuted((previous) => {
      const next = !previous;
      writeMuted(next);
      return next;
    });
  }, []);

  return { playTapSounds, muted, toggleMuted };
}
