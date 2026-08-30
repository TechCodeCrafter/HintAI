const encoder = new TextEncoder();

export function byteLengthOf(content: string): number {
  return encoder.encode(content).byteLength;
}

export async function hashContent(content: string): Promise<string> {
  return hashBytes(encoder.encode(content));
}

export async function hashBytes(data: BufferSource): Promise<string> {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return hex(new Uint8Array(digest));
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export async function hashBlob(blob: Blob): Promise<string> {
  return hashBytes(await blob.arrayBuffer());
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
