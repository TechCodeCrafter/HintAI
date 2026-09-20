import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLandingEnterprise } from "@/components/meethint-landing-enterprise";
export const Route = createFileRoute("/")({
  // Client-only: autofill extensions mutate email fields before hydrate -> React #418 / flash reload.
  // SEO / OG tags live in __root__.head (SSR) so crawlers see them without hydrating this route.
  ssr: false,
  component: Landing,
});

function Landing() {
  return <MeetHintLandingEnterprise />;
}
