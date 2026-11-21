import { createFileRoute } from "@tanstack/react-router";
import { DemoSearch } from "@/components/demo-search";
import { MEETHINT_NAME } from "@/lib/brand";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: `Try ${MEETHINT_NAME}` },
      {
        name: "description",
        content: "Ask a question about the sample payments repository and get a cited line, or silence.",
      },
    ],
  }),
  component: DemoPage,
});

function DemoPage() {
  return <DemoSearch />;
}
