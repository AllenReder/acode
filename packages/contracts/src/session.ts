import * as Schema from "effect/Schema";

/** The stable ACode work units shown below a Workspace in the Sidebar. */
export const SessionKind = Schema.Literals(["agent", "terminal"]);
export type SessionKind = typeof SessionKind.Type;
