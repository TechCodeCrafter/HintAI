import { createFileRoute } from "@tanstack/react-router";
import { ContextHome } from "@/components/context-home";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Your contexts — MeetHint" },
      {
        name: "description",
        content:
          "Create a context from the material you work with. MeetHint cites a line from that material when the room asks.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return <ContextHome />;
}
