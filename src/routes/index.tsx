import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLanding } from "@/components/meethint-landing";
import { MEETHINT_DESCRIPTION, MEETHINT_TITLE } from "@/lib/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: MEETHINT_TITLE },
      { name: "description", content: MEETHINT_DESCRIPTION },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <MeetHintLanding />;
}
