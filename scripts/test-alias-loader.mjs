/**
 * Preload entry for the plain `node --test` runner (see run-tests.mjs).
 * Registers the `@/*` → `./src/*` resolve hook so tests and sources can use
 * the tsconfig path alias without a bundler.
 */
import { register } from "node:module";

register("./test-alias-hooks.mjs", import.meta.url);
