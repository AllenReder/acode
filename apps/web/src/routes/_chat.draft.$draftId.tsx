import { createFileRoute } from "@tanstack/react-router";

// The pathless chat layout owns Workbench rendering. This leaf registers the
// client-local draft recovery route; it is not an Awen Deep Link.
export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: () => null,
});
