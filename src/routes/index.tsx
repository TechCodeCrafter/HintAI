import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLanding } from "@/components/meethint-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MeetHint — your knowledge, right when you need it" },
      {
        name: "description",
        content:
          "Meeting copilot that searches your material and cites the file before you speak. Join the private beta, or try it on a local folder.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <MeetHintLanding />;
}
