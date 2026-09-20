import { createFileRoute } from "@tanstack/react-router";

// The pathless chat layout owns Workbench rendering. This leaf only registers
// the canonical Agent Session deep-link route.
export const Route = createFileRoute(
  "/_chat/$environmentId/workspaces/$workspaceId/agent-sessions/$agentSessionId",
)({
  component: () => null,
});
