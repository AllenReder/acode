# Third-party notices

Awen includes and adapts work from the projects listed here. Product and
runtime identifiers in this repository use Awen's own naming. Upstream names
appear below only to identify sources and preserve their license notices.

## T3 Code-derived source

- Source: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code)
- Imported revision: `ccf220be205f0e509021dbc8cbda90daa638e20d`
- License: MIT. Its copyright notice remains in the root [`LICENSE`](./LICENSE).
- Awen-specific code and changes are copyright AllenReder, under the same MIT
  license. The upstream product's branding and hosted-connect feature are not
  part of Awen.

## Monocode Tauri shell and layout

- Source: [`hardbeat920/monocode`](https://github.com/hardbeat920/monocode)
- Adopted revision: `25dd57e599e33a1878ce7e45a3187f7863b8d74f`
- Awen adapts the Tauri window/native-host boundary and pure BSP layout
  primitives. Monocode's React application, provider adapters, PTY, and
  persistence layer are not included.
- License: MIT; copyright © 2026 Nick. The license text is included at
  [`licenses/MONOCODE-MIT.txt`](./licenses/MONOCODE-MIT.txt).

## Paseo terminal reference

- Reference: [`getpaseo/paseo`](https://github.com/getpaseo/paseo)
- Reviewed revision: `0eac75be7dd11a6623abb763b3a44d23e711c550`
- Awen's web terminal uses the separately licensed `@xterm/*` packages and
  adapts terminal palette and rendering decisions informed by this reference.
  No Paseo application code is included.
- Paseo's Apache-2.0 license text is included at
  [`licenses/PASEO-APACHE-2.0.txt`](./licenses/PASEO-APACHE-2.0.txt) for
  source-reference clarity. Dependencies retain their own licenses, recorded
  in [`third-party-licenses.config.json`](./third-party-licenses.config.json).

## Vendored runtime components

- Ghostty virtual-terminal ABI license:
  [`native/libghostty-vt/LICENSE`](./native/libghostty-vt/LICENSE)
- The vendored Ghostty WASM artifact retains its upstream `t3_write_pty`
  import. Awen supplies this ABI symbol and routes active terminal writes
  through Awen's table-backed callback.
- Symbols Nerd Font Mono license:
  [`apps/web/src/terminal/ghostty/fonts/LICENSE`](./apps/web/src/terminal/ghostty/fonts/LICENSE)
- The complete dependency inventory and source URLs are maintained in
  [`third-party-licenses.config.json`](./third-party-licenses.config.json).
  The Web build emits the resolved manifest at
  `apps/web/dist/third-party-licenses.json`.
