import { createFileRoute } from "@tanstack/react-router";
import { MeetHintLanding } from "@/components/meethint-landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MeetHint — the meeting just became searchable" },
      {
        name: "description",
        content:
          "Live retrieval over the material you bring. Someone asks about a service you last touched fourteen months ago; MeetHint finds the note, the PR, and the line, and cites the file. Nothing generated.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <MeetHintLanding />;
}
