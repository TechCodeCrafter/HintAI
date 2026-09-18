import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLandingEnterprise } from "@/components/meethint-landing-enterprise";
import { MEETHINT_DESCRIPTION, MEETHINT_TITLE } from "@/lib/brand";
import { shareOgHeadMeta } from "@/lib/og/share-meta";

export const Route = createFileRoute("/")({
  // Client-only: autofill extensions mutate email fields before hydrate -> React #418 / flash reload.
  ssr: false,
  head: () => ({
    meta: [
      { title: MEETHINT_TITLE },
      { name: "description", content: MEETHINT_DESCRIPTION },
      ...shareOgHeadMeta(),
    ],
  }),
  component: Landing,
});

function Landing() {
  return <MeetHintLandingEnterprise />;
}
