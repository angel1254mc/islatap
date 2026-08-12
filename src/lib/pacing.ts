/**
 * Pacing for the guess round trip.
 *
 * The map has no feedback state between a tap and a reveal, so a sonar ping
 * fills it (see MapView). A ping cut off a quarter of the way through reads as
 * a glitch rather than as an animation, which is what the floor below prevents.
 */

/**
 * One full sonar cycle, and the minimum time a reveal may take.
 *
 * This can only reduce how much the wait varies between rounds — it never
 * lengthens the worst case. When the server takes 900 ms the floor has already
 * elapsed and the reveal is immediate; it is only the fast tail that gets held
 * back, and only so far as one ring of the ping (see the `sonar-ping` keyframes
 * in index.css, which emit a ring every 600 ms).
 */
export const MIN_PING_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Settle no sooner than `floorMs`, whatever `work` does.
 *
 * The reflection into a tagged object is load-bearing. A plain
 * `Promise.all([work, sleep(floorMs)])` short-circuits the instant `work`
 * rejects, so a fast failure would skip the floor entirely and flash the error
 * panel onto the screen. Reflecting first means the all() can never settle
 * early, and the original error is rethrown unwrapped afterwards so
 * userMessage() still classifies it by `kind`.
 */
export async function notBefore<T>(work: Promise<T>, floorMs: number): Promise<T> {
  const [outcome] = await Promise.all([
    work.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    sleep(floorMs),
  ]);
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
