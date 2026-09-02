import { createFileRoute } from "@tanstack/react-router";
import { ContextHome } from "@/components/context-home";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "MeetHint" },
      {
        name: "description",
        content: "Ask a question. The card is a cited line from a file, or empty.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return <ContextHome />;
}
