/** TanStack may pass `{ data: payload }` or the unwrapped payload. Trust either. */
export function unwrapFnInput<T extends { query?: string; prompt?: string }>(
  input: (T & { data?: T }) | null | undefined,
): T {
  if (input && (typeof input.prompt === "string" || typeof input.query === "string")) {
    return input;
  }
  const nested = input?.data;
  if (nested && (typeof nested.prompt === "string" || typeof nested.query === "string")) {
    return nested;
  }
  return {} as T;
}
