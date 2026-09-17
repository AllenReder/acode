# Third-party notices

This checkout includes source adapted from T3 Code and its runtime
dependencies. The imported source remains under its original package names and
directory relationships so the typed Web/server boundary stays intact.

## T3 Code

- Source: [`pingdotgg/t3code`](https://github.com/pingdotgg/t3code)
- Imported commit:
  `ccf220be205f0e509021dbc8cbda90daa638e20d`
- Project license: [`LICENSE`](./LICENSE)

## Monocode Tauri shell

- Source: [`hardbeat920/monocode`](https://github.com/hardbeat920/monocode)
- Adopted reference commit:
  `25dd57e599e33a1878ce7e45a3187f7863b8d74f`
- ACode adopts the Tauri window/configuration and native-host boundary from this
  reference. It does not include Monocode's React application, provider
  adapters, PTY implementation, or persistence layer.
- Project license: MIT (the license notice is retained in the source reference).

## Vendored runtime components

- Ghostty virtual-terminal ABI license:
  [`native/libghostty-vt/LICENSE`](./native/libghostty-vt/LICENSE)
- Symbols Nerd Font Mono license:
  [`apps/web/src/terminal/ghostty/fonts/LICENSE`](./apps/web/src/terminal/ghostty/fonts/LICENSE)
- The complete bundle inventory and source URLs are maintained in
  [`third-party-licenses.config.json`](./third-party-licenses.config.json).
  The Web build emits the resolved manifest at
  `apps/web/dist/third-party-licenses.json`.

The ACode repository's own guidance and domain documentation are separate from
these imported notices and remain at the repository root.
