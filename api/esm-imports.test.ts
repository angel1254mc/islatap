import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const API_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(API_DIR, '..');

/**
 * Every relative module specifier in a file, whether it is a value import, a
 * type-only import, a re-export or a dynamic `import()`.
 */
function relativeSpecifiers(source: string): string[] {
  const patterns = [
    /\bfrom\s+'(\.\.?\/[^']*)'/g,
    /\bimport\s*\(\s*'(\.\.?\/[^']*)'\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]));
}

/** This file quotes extensionless specifiers on purpose, so it exempts itself. */
const SELF = 'esm-imports.test.ts';

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsFilesUnder(path);
    if (entry === SELF) return [];
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('api/ is resolvable by Node under ESM', () => {
  // package.json sets "type": "module" and Vercel compiles api/*.ts to plain
  // ESM without bundling. Node's ESM resolver does not guess extensions, so
  // `from './_lib/date'` throws ERR_MODULE_NOT_FOUND at invocation — while
  // Vitest and `tsc --noEmit` both resolve it happily, because they use
  // bundler resolution. That gap shipped a 500 to production once already.
  it('has no extensionless relative import anywhere under api/', () => {
    const offenders: string[] = [];

    for (const file of tsFilesUnder(API_DIR)) {
      for (const specifier of relativeSpecifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.endsWith('.js')) {
          offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('extends the same rule to the src/ modules api/ imports at runtime', () => {
    // api/guess.ts imports src/lib/target.ts, which imports src/lib/scoring.ts.
    // Those get compiled into the function bundle too, so they need extensions
    // for exactly the same reason. Type-only imports are erased and cannot
    // fail at runtime, so only this value chain is covered.
    const target = readFileSync(join(REPO_ROOT, 'src/lib/target.ts'), 'utf8');
    for (const specifier of relativeSpecifiers(target)) {
      expect(specifier).toMatch(/\.js$/);
    }
  });

  it('exports named HTTP methods, never a default, from every endpoint', () => {
    // Vercel's Node runtime reads `export default` as the legacy
    // `(req, res) => void` signature and ignores whatever it returns. A
    // default-exported `Request` -> `Response` handler therefore never writes
    // a response: the invocation hangs until maxDuration and the caller gets a
    // 60s timeout. This also passed every local test, because the tests call
    // the handler function directly and never go through Vercel's dispatcher.
    const endpoints = ['daily.ts', 'guess.ts', join('cron', 'top-up.ts')];

    for (const endpoint of endpoints) {
      const source = readFileSync(join(API_DIR, endpoint), 'utf8');
      expect(source, `${endpoint} must not use a default export`).not.toMatch(
        /^export\s+default\b/m,
      );
      expect(source, `${endpoint} must export a named HTTP method`).toMatch(
        /^export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/m,
      );
    }
  });

  it('catches an extensionless specifier if one is reintroduced', () => {
    // Guards the guard: proves the matcher is not vacuously passing.
    expect(relativeSpecifiers("import { x } from './_lib/date';")).toEqual(['./_lib/date']);
    expect(relativeSpecifiers("import { x } from './_lib/date.js';")).toEqual(['./_lib/date.js']);
    expect(relativeSpecifiers("const m = await import('../src/lib/target');")).toEqual([
      '../src/lib/target',
    ]);
  });
});
