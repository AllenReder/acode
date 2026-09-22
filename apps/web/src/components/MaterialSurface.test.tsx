import { describe, expect, it } from "vite-plus/test";

import { MaterialSurface } from "./MaterialSurface";

describe("MaterialSurface", () => {
  it("renders the requested material surface kind", () => {
    const surface = MaterialSurface({
      kind: "workbench",
      "data-testid": "workbench",
      children: "Content",
    });

    expect(surface).toMatchObject({
      props: {
        "data-material-surface": "workbench",
        "data-testid": "workbench",
        className: expect.stringContaining("material-surface-workbench"),
      },
    });
  });

  it("preserves caller classes and DOM props without replacing content", () => {
    const toggle = <button type="button">Toggle</button>;
    const surface = MaterialSurface({
      kind: "topbar",
      className: "drag-region custom-topbar",
      role: "banner",
      children: toggle,
    });

    expect(surface).toMatchObject({
      props: {
        className: expect.stringContaining("drag-region custom-topbar"),
        "data-material-surface": "topbar",
        role: "banner",
      },
    });
    expect(surface.props.className).toContain("material-surface-topbar");
    expect(surface.props.children).toBe(toggle);
  });
});
