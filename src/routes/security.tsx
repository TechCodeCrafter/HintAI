import { createFileRoute } from "@tanstack/react-router";
import { TrustPageShell } from "@/components/trust-page";
import { TrustSecurityContacts } from "@/components/trust-mail-contacts";
import { MEETHINT_DOMAIN, MEETHINT_NAME } from "@/lib/brand";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: `Security — ${MEETHINT_NAME}` },
      {
        name: "description",
        content: `Verified security practices for ${MEETHINT_NAME} at ${MEETHINT_DOMAIN}.`,
      },
    ],
  }),
  component: SecurityPage,
});

function SecurityPage() {
  return (
    <TrustPageShell
      title="Security"
      description={`Verified protections shipped today for ${MEETHINT_DOMAIN}. We do not claim certifications we have not earned.`}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Transport</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>HTTPS is required for production traffic on {MEETHINT_DOMAIN}.</li>
          <li>HTTP Strict Transport Security (HSTS) is enabled on deployed environments.</li>
          <li>Baseline response headers include Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and frame protection.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Data handling</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Your loaded repos and documents are indexed locally in the browser unless you explicitly use server-backed features that store data.</li>
          <li>The product follows a cite-or-silence contract: it does not speak general knowledge when your material cannot support an answer.</li>
          <li>Workspace-scoped storage separates authenticated and anonymous tiers when sign-in is enabled.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">What we do not claim</h2>
        <p>
          {MEETHINT_NAME} is not SOC 2 certified, does not claim end-to-end encryption of your indexed
          material, and does not guarantee that enterprise web filters will never block a newly
          registered domain.
        </p>
      </section>

      <TrustSecurityContacts />
      <section className="space-y-3">
        <p>
          Machine-readable contacts: <a href="/.well-known/security.txt">/.well-known/security.txt</a>
        </p>
        <p className="text-[var(--hint-muted)]">Last updated: September 14, 2026.</p>
      </section>
    </TrustPageShell>
  );
}
