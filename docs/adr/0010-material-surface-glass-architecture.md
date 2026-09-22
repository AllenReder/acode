# Material Surface Glass Architecture

Accepted; supersedes the web visual-layer parts of ADR-0009 while retaining its
native macOS and Windows glass foundation. ACode separates Theme's opaque
semantic colors from a Material system: a native Glass Stage supplies the
window-wide desktop blur, explicit Sidebar, Topbar, Workbench, and Overlay
Material Surfaces own tint, blur, saturation, and edge treatment, and View or
Pane content layers render transparent base backgrounds. Overlay surfaces use
web backdrop filtering because the native stage cannot blur content beneath a
dialog or menu inside the web view. This replaces the t3code-derived practice
of opaque component backgrounds and selector-specific transparency overrides;
custom and imported themes continue to provide colors only, not Material
parameters. The legacy glass settings migrate once into a Material settings
group; unknown values use the new defaults. Platform capability is represented
as native-stage, css-overlay, or opaque. The blur control specifies the WindowServer radius in pixels on macOS;
Windows maps glass to its Acrylic/Mica capabilities. Sidebar and Topbar default
to 85% opacity, Workbench to 88%, and Overlay to 90%; each remains individually
adjustable in Settings. Overlay backdrops mount only while open, nested backdrop filters
are avoided, and a reduce-transparency or disabled-glass path remains available.
Optional wallpaper becomes Workbench Artwork: one image layer beneath all
Workbench content and above the Workbench Material Surface, rather than a
background owned by Agent or Welcome Views. It uses one opacity across every
Workbench state, including Settings, and stops at the Sidebar material edge.

## Visual redesign boundary

The material and control appearance redesign preserves ACode's navigation and
layout. Monocode is the reference for native blur, material continuity, edge
treatment, and control finish; adopting those qualities does not replace
ACode's Sidebar, Tab, Pane, or View organization with Monocode's layout.

Sidebar, Topbar, and Workbench share one continuous Glass Stage while retaining
independently adjustable tint opacity. Each region paints its material once;
Topbar opacity must not compound with a Workbench material beneath it. View
headers and content inherit their containing region's material rather than
introducing another region-wide background.
Code blocks and inputs may use a subtle translucent local backing for
readability. Menus and dialogs use a denser frosted Overlay material to
separate their content from the content underneath.

The redesign preserves native application interaction boundaries: text
selection is available in prose, code, terminal output, and editable inputs;
navigation, titles, toolbars, buttons, and Settings explanatory text do not
participate in drag selection. Non-interactive empty areas of the Topbar and
Sidebar drag the desktop window, while controls and navigation items retain
their own click and drag-and-drop behavior.

macOS is the primary visual acceptance platform. The Linux development server
can validate code and browser behavior, but native blur, desktop window
dragging, and final material appearance require verification in the macOS
desktop application. Existing fallback behavior on other platforms remains.

Implementation reference: Monocode `bb3924b61f4d48ba12327ee1eb70a8b83d95e51d`
confirms the existing macOS WindowServer and 1%-alpha AppKit backing approach.
Window dragging uses Tauri's existing deep drag regions, including its native
interactive-element exclusions, rather than a parallel JavaScript drag system.
