import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLanding } from "@/components/meethint-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hint — live answers from your own material" },
      {
        name: "description",
        content:
          "Hint listens to a live conversation, searches your files, and surfaces a cited answer in seconds. Try it on a local folder, or join the private beta.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <MeetHintLanding />;
}
