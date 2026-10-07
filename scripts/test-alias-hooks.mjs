/**
 * Module customization hooks for the plain `node --test` runner.
 *
 * The app resolves `@/*` to `./src/*` via tsconfig paths (Vite handles this
 * in dev/build), but the test runner is bare Node with no bundler — so any
 * `@/...` import dies with ERR_MODULE_NOT_FOUND. This hook rewrites those
 * specifiers to file URLs under src/. Scoped npm packages like
 * `@huggingface/transformers` are untouched: only a bare `@` or `@/...`
 * prefix is rewritten.
 *
 * Node ESM also refuses extensionless imports, but the codebase imports TS
 * sources without extensions (Vite + `allowImportingTsExtensions` resolve
 * them). The hook therefore probes for `.ts` / `/index.ts` when the rewritten
 * path has no extension and doesn't exist as-is.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(new URL(import.meta.url).pathname, "..", "..");
const srcUrl = `${pathToFileURL(join(root, "src")).href}/`;

function probeTs(url) {
  const path = fileURLToPath(url);
  // A sibling .ts file wins over a same-named directory (matches Vite/TS
  // resolution: `@/lib/store` is src/lib/store.ts, not src/lib/store/).
  if (existsSync(`${path}.ts`)) return `${url}.ts`;
  if (existsSync(path)) {
    if (statSync(path).isDirectory() && existsSync(join(path, "index.ts"))) {
      return `${url}/index.ts`;
    }
    return url;
  }
  if (existsSync(join(path, "index.ts"))) return `${url}/index.ts`;
  return url;
}

export async function resolve(specifier, context, next) {
  if (specifier === "@" || specifier.startsWith("@/")) {
    const rewritten = srcUrl + specifier.slice(specifier === "@" ? 1 : 2);
    return next(probeTs(rewritten), context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.[a-z0-9]+$/i.test(specifier)
  ) {
    return next(probeTs(new URL(specifier, context.parentURL).href), context);
  }
  return next(specifier, context);
}
