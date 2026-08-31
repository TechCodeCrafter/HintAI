import { createFileRoute } from "@tanstack/react-router";
import { ContextHome } from "@/components/context-home";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MeetHint — your knowledge, right when you need it" },
      {
        name: "description",
        content:
          "Create a context from the material you work with. MeetHint cites a line from that material when the room asks.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <ContextHome />;
}
