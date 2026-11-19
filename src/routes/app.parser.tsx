import { brandText } from "@/lib/brand";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/app/parser")({
  head: () => ({
    meta: [
      { title: brandText("AI Workspace | {{brand}}") },
      {
        name: "description",
        content:
          brandText("Chat with the {{brand}} agent to parse broker documents, reconcile trades and update your ledger."),
      },
      { property: "og:title", content: brandText("AI Workspace | {{brand}}") },
      {
        property: "og:description",
        content: "Agentic trade reconciliation with approval-gated ledger writes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Outlet />,
});
