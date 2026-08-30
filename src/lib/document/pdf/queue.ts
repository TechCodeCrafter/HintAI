let chain: Promise<void> = Promise.resolve();
let active = 0;

export function enqueuePdfParse<T>(work: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function pdfParseActiveCount(): number {
  return active;
}
