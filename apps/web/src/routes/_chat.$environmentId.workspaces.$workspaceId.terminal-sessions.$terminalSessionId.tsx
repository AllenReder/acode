import { createFileRoute } from "@tanstack/react-router";

// The pathless chat layout owns Workbench rendering. This leaf only registers
// the canonical Terminal Session deep-link route.
export const Route = createFileRoute(
  "/_chat/$environmentId/workspaces/$workspaceId/terminal-sessions/$terminalSessionId",
)({
  component: () => null,
});
