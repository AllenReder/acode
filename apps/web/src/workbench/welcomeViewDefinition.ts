import { WelcomeView } from "./WelcomeView";
import { emptyViewBinding } from "./viewRegistry";
import type { ViewDefinition, ViewTarget } from "./viewRegistry";

export interface WelcomeCapabilities {}

export function createWelcomeViewDefinition(): ViewDefinition<
  Extract<ViewTarget, { kind: "welcome" }>,
  null,
  WelcomeCapabilities
> {
  return {
    id: "welcome",
    label: "Welcome",
    accepts: (target): target is Extract<ViewTarget, { kind: "welcome" }> =>
      target.kind === "welcome",
    bind: emptyViewBinding,
    Component: WelcomeView,
  };
}
