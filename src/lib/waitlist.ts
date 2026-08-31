/**
 * Waitlist signup, server side.
 *
 * Insert-only on purpose. There is no companion function that lists or returns
 * rows, because the moment one exists the addresses are reachable from any
 * browser — the table has no owner to scope a read by. The list is read out of
 * the database directly.
 */
import { createServerFn } from "@tanstack/react-start";

/** Matches the check the form does, repeated here because the client is not trusted. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Long enough for any real address; short enough that the column is not a buffer. */
const MAX_EMAIL = 254;

export type JoinResult = { ok: true } | { ok: false; reason: string };

export const joinWaitlist = createServerFn({ method: "POST" })
  .validator((input: { email: string; source?: string }) => input)
  .handler(async ({ data }): Promise<JoinResult> => {
    const email = data.email.trim().toLowerCase();
    if (!email || email.length > MAX_EMAIL || !EMAIL.test(email)) {
      return { ok: false, reason: "That does not look like an email address." };
    }

    // A built server has no working PGLite fallback: the bundle ships without
    // `pglite.data`, and `@/lib/db` starts its bootstrap on import and rethrows
    // into an unawaited promise, so merely importing it takes the process down.
    // A landing page must not be able to fail that way over a missing env var —
    // deployed, a signup needs a real database or it is honestly refused.
    // Local preview has no DATABASE_URL either; accept the address so the demo
    // form still completes instead of looking broken.
    if (!process.env.DATABASE_URL?.trim()) {
      if (process.env.NODE_ENV === "production") {
        console.error("[waitlist] DATABASE_URL is not set — refusing to confirm a signup");
        return { ok: false, reason: "We could not save that just now." };
      }
      console.warn("[waitlist] DATABASE_URL is not set — accepting signup in demo");
      return { ok: true };
    }

    try {
      // Imported here rather than at module scope for the same reason: the
      // landing page must render even when the database cannot be reached.
      // A dead DATABASE_URL must not leave the demo form spinning.
      await Promise.race([
        (async () => {
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          // Submitting twice is the same signup, not an error the visitor should
          // see, so the unique index absorbs it.
          await sql`
            insert into waitlist (email, source)
            values (${email}, ${data.source ?? null})
            on conflict do nothing
          `;
        })(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("waitlist insert timed out")), 4000);
        }),
      ]);
      return { ok: true };
    } catch (error) {
      // Preview and local demo still complete the signup so the page can be shown.
      // Deployed, a failure is logged and the form is told to say so rather than
      // confirming a signup that did not happen.
      if (process.env.NODE_ENV !== "production") {
        console.warn("[waitlist] insert failed — accepting signup in demo:", error);
        return { ok: true };
      }
      console.error("[waitlist] insert failed:", error);
      return { ok: false, reason: "We could not save that just now." };
    }
  });
