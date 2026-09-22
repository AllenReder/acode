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
as native-stage, css-overlay, or opaque. Stage blur uses an abstract strength
that maps to WindowServer radius on macOS and Acrylic/Mica capabilities on
Windows. Surface opacities share one default and remain individually adjustable
in Settings. Overlay backdrops mount only while open, nested backdrop filters
are avoided, and a reduce-transparency or disabled-glass path remains available.
Optional wallpaper becomes Workbench Artwork: one image layer beneath all
Workbench content and above the Workbench Material Surface, rather than a
background owned by Agent or Welcome Views. It uses one opacity across every
Workbench state, including Settings, and stops at the Sidebar material edge.
