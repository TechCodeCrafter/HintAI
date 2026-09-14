import { createFileRoute } from "@tanstack/react-router";
import { TrustPageShell } from "@/components/trust-page";
import { MEETHINT_DOMAIN, MEETHINT_NAME, MEETHINT_SUPPORT_CONTACT } from "@/lib/brand";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy — ${MEETHINT_NAME}` },
      {
        name: "description",
        content: `How ${MEETHINT_NAME} handles information on ${MEETHINT_DOMAIN}.`,
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <TrustPageShell
      title="Privacy Policy"
      description={`This policy describes how ${MEETHINT_NAME} handles information when you use ${MEETHINT_DOMAIN}.`}
    >
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Overview</h2>
        <p>
          {MEETHINT_NAME} is designed to search material you load locally in your browser. The product
          does not upload your folders, documents, or meeting audio to our servers for indexing.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Information you provide</h2>
        <p>
          If you join the waitlist, we collect the email address you submit so we can contact you about
          access. When a database is configured for the deployment, that address is stored server-side.
          Otherwise the form may acknowledge your signup without persistent storage.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Local storage</h2>
        <p>
          Contexts, indexed chunks, embeddings, session preferences, and answer history are stored in
          your browser (IndexedDB and local storage) unless you sign in and we bind data to an account
          workspace. Clearing site data in your browser removes this information from the device.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Optional model providers</h2>
        <p>
          If you choose to add API keys for OpenAI, Anthropic, or xAI, those keys are kept in your
          browser and requests go directly from your device to the provider you selected. We do not
          operate a general-knowledge fallback when your material cannot support an answer.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p>
          Privacy questions: <a href={MEETHINT_SUPPORT_CONTACT}>open a GitHub issue</a> or see our{" "}
          <a href="/contact">Contact</a> page.
        </p>
        <p className="text-[var(--hint-muted)]">Last updated: September 14, 2026.</p>
      </section>
    </TrustPageShell>
  );
}
