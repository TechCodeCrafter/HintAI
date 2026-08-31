/**
 * The live VectorStore, if one has been installed. Search and the store talk
 * to this — never to Dexie. indexContext / tests inject the implementation.
 */
import type { VectorStore } from "./vector-store.ts";

let store: VectorStore | null = null;

export function getVectorStore(): VectorStore | null {
  return store;
}

export function setVectorStore(next: VectorStore | null): void {
  store = next;
}
