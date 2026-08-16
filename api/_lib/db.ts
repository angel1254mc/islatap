import { neon } from '@neondatabase/serverless';

export type SqlRow = Record<string, unknown>;

/**
 * The only database surface the handlers see: text + positional params in, rows
 * out. Narrowing the driver to this one function keeps every SQL call in the
 * codebase parameterised (no template-literal interpolation to get wrong) and
 * means tests can swap in a plain async function with no mocking framework.
 */
export type SqlExecutor = (text: string, params?: readonly unknown[]) => Promise<SqlRow[]>;

let cached: SqlExecutor | null = null;

/**
 * Lazily built so importing this module never touches the environment — a
 * missing DATABASE_URL should fail a request, not the whole function's cold
 * start, and it must not fail a unit test that never queries anything.
 *
 * The Neon HTTP driver holds no socket, so caching the executor across warm
 * invocations costs nothing and saves re-parsing the connection string.
 */
export function getSql(): SqlExecutor {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set; the serverless functions cannot reach Postgres.');
  }
  const sql = neon(url);
  cached = async (text, params) =>
    (await sql.query(text, params ? [...params] : [])) as unknown as SqlRow[];
  return cached;
}

/**
 * Test seam, mirroring resetShapesForTest() in src/lib/shapes.ts. Pass null to
 * drop back to the real driver.
 */
export function setSqlForTest(executor: SqlExecutor | null): void {
  cached = executor;
}
