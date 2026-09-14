import { createFileRoute } from "@tanstack/react-router";
import { TrustPageShell } from "@/components/trust-page";
import { MEETHINT_DOMAIN, MEETHINT_NAME } from "@/lib/brand";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: `Terms of Use — ${MEETHINT_NAME}` },
      {
        name: "description",
        content: `Terms for using ${MEETHINT_NAME} at ${MEETHINT_DOMAIN}.`,
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <TrustPageShell
      title="Terms of Use"
      description={`By using ${MEETHINT_DOMAIN}, you agree to these terms.`}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Service</h2>
        <p>
          {MEETHINT_NAME} provides a browser-based meeting copilot that searches material you load and
          surfaces cited answers or intentional silence. Features and availability may change during
          beta.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your responsibilities</h2>
        <p>
          You are responsible for the material you load and for complying with your organization&apos;s
          policies. Do not use the service to process data you are not authorized to handle.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Disclaimer</h2>
        <p>
          The service is provided &quot;as is&quot; without warranties of any kind. Answers are derived
          from your loaded material and may be incomplete or incorrect. Verify citations before relying
          on them in high-stakes situations.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p>
          Questions about these terms: <a href="/contact">Contact</a>.
        </p>
        <p className="text-[var(--hint-muted)]">Last updated: September 14, 2026.</p>
      </section>
    </TrustPageShell>
  );
}
