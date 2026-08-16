import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notBefore } from './pacing';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Report whether a promise has settled, without awaiting it.
 *
 * Awaiting a promise that is deliberately still pending would hang the test
 * rather than fail it, so the assertions below read this flag instead. The
 * handler is attached immediately, which also means a rejecting `work` is
 * never an unhandled rejection.
 */
function settled(promise: Promise<unknown>): () => boolean {
  let done = false;
  const mark = () => {
    done = true;
  };
  void promise.then(mark, mark);
  return () => done;
}

describe('notBefore', () => {
  it('holds a fast resolve until the floor has elapsed', async () => {
    const promise = notBefore(Promise.resolve('answer'), 600);
    const isSettled = settled(promise);

    // advanceTimersByTimeAsync also flushes microtasks, so every continuation
    // the already-resolved work could queue has run by now. Only the floor's
    // own timer is still outstanding.
    await vi.advanceTimersByTimeAsync(599);
    expect(isSettled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(isSettled()).toBe(true);
    await expect(promise).resolves.toBe('answer');
  });

  it('adds nothing to work that already outlasts the floor', async () => {
    let finishWork: (value: string) => void = () => {};
    const work = new Promise<string>((resolve) => {
      finishWork = resolve;
    });
    const promise = notBefore(work, 600);
    const isSettled = settled(promise);

    await vi.advanceTimersByTimeAsync(900);
    expect(isSettled()).toBe(false); // floor long gone, work still pending

    finishWork('answer');
    await vi.advanceTimersByTimeAsync(0); // no second wait
    expect(isSettled()).toBe(true);
    await expect(promise).resolves.toBe('answer');
  });

  it('holds a fast rejection for the floor too', async () => {
    // Without this, a request that fails instantly would flash GuessError onto
    // the screen in under 100 ms — the exact jarring transition the floor
    // exists to prevent.
    const promise = notBefore(Promise.reject(new Error('connection refused')), 600);
    const isSettled = settled(promise);

    await vi.advanceTimersByTimeAsync(599);
    expect(isSettled()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(isSettled()).toBe(true);
    await expect(promise).rejects.toThrow('connection refused');
  });

  it('rethrows the original error object, not a copy', async () => {
    // App hands this straight to userMessage(), which branches on
    // `instanceof ApiError` and on `error.kind`. Anything that re-wraps the
    // error would silently downgrade every message to "Something went wrong."
    const failure = new Error('connection refused');
    const promise = notBefore(Promise.reject(failure), 600);
    const isSettled = settled(promise);

    await vi.advanceTimersByTimeAsync(600);
    expect(isSettled()).toBe(true);
    await expect(promise).rejects.toBe(failure);
  });
});
