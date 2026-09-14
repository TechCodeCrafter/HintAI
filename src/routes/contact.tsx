import { createFileRoute } from "@tanstack/react-router";
import { TrustPageShell } from "@/components/trust-page";
import {
  MEETHINT_DOMAIN,
  MEETHINT_NAME,
  MEETHINT_REPO,
  MEETHINT_SECURITY_CONTACT,
  MEETHINT_SUPPORT_CONTACT,
} from "@/lib/brand";

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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Security reporting</h2>
        <p>
          Report vulnerabilities via{" "}
          <a href={MEETHINT_SECURITY_CONTACT}>GitHub Security Advisories</a> on{" "}
          <a href={MEETHINT_REPO}>{MEETHINT_REPO.replace("https://", "")}</a>.
        </p>
        <p className="text-[var(--hint-muted)]">
          Dedicated <code>security@meethint.ai</code> mail will be added in Phase B once delivery is
          verified.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Product questions and abuse</h2>
        <p>
          Open a <a href={MEETHINT_SUPPORT_CONTACT}>GitHub issue</a> for product questions or abuse
          reports.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Enterprise allowlisting</h2>
        <p>
          If your organization blocks {MEETHINT_DOMAIN} as a newly observed domain, share our{" "}
          <a href="/security">Security</a> page and the external-domain inventory in{" "}
          <code className="rounded bg-[var(--hint-border)] px-1.5 py-0.5 text-sm">docs/DOMAIN-REPUTATION.md</code>{" "}
          with your IT team.
        </p>
      </section>
    </TrustPageShell>
  );
}
