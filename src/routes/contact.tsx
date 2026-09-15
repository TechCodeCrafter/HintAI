import { createFileRoute } from "@tanstack/react-router";
import {
  TrustAbuseContacts,
  TrustProductContacts,
  TrustSecurityContacts,
} from "@/components/trust-mail-contacts";
import { TrustPageShell } from "@/components/trust-page";
import { MEETHINT_DOMAIN, MEETHINT_NAME } from "@/lib/brand";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: `Contact — ${MEETHINT_NAME}` },
      {
        name: "description",
        content: `Contact and security reporting for ${MEETHINT_NAME}.`,
      },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <TrustPageShell
      title="Contact"
      description={`Reach ${MEETHINT_NAME} for security reporting, abuse, and product questions.`}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Official domain</h2>
        <p>
          Production app and marketing site:{" "}
          <a href={`https://${MEETHINT_DOMAIN}`}>https://{MEETHINT_DOMAIN}</a> (redirects to www).
        </p>
      </section>

      <TrustSecurityContacts />
      <TrustAbuseContacts />
      <TrustProductContacts />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Enterprise allowlisting</h2>
        <p>
          If your organization blocks {MEETHINT_DOMAIN} as a newly observed domain, share{" "}
          <a href="/security">Security</a>,{" "}
          <code className="rounded bg-[var(--hint-border)] px-1.5 py-0.5 text-sm">docs/ENTERPRISE-ALLOWLIST.md</code>
          , and{" "}
          <code className="rounded bg-[var(--hint-border)] px-1.5 py-0.5 text-sm">docs/DOMAIN-REPUTATION.md</code>{" "}
          with your IT team.
        </p>
      </section>
    </TrustPageShell>
  );
}
