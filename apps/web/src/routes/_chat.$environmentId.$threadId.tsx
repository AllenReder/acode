import { createFileRoute } from "@tanstack/react-router";

// The pathless chat layout resolves this legacy Thread route through the
// Workbench compatibility adapter and redirects to the canonical Session URL.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: () => null,
});
