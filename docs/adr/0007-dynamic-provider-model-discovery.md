# Dynamic Provider Model Discovery with Static Catalog Enrichment

**Status: accepted**

Awen requires the target daemon's provider capability catalog to be authoritative,
avoiding hardcoded model assumptions on the desktop client (D1, D3, D5, US08). While
Codex already queries models dynamically via its `app-server` JSON-RPC `model/list`
endpoint, upstream T3 Code hardcoded Claude models to a static `model-manifest.json`
and discarded the dynamic model list reported by the Claude Agent SDK. Awen decouples
all providers from static whitelists, making runtime capability discovery primary.

## Decision

- Dynamic discovery is the primary source of truth: The daemon probes the provider's
  actual runtime environment (for Codex via `app-server` `model/list`, for Claude
  via `@anthropic-ai/claude-agent-sdk` `initializationResult().models`). Any model
  configured by the user on the target environment (e.g., via `~/.claude/settings.json`,
  environment variables, or custom gateways such as DeepSeek or OpenAI-compatible proxies)
  is surfaced directly in the provider capability catalog.
- Static catalog acts as metadata enrichment: `model-manifest.json` is preserved solely
  to enrich known first-party models with offline metadata that the CLI might not
  fully specify (e.g., precise context window token sizes, structured effort mappings,
  and minimum version compatibility rules). Discovered models matching known manifests
  inherit these attributes; unknown or custom models derive their capabilities
  directly from runtime flags (`supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`)
  with sensible fallback context limits.
- Degraded fallback behavior: If runtime capability probing fails (e.g., CLI not
  installed, unauthenticated, or network timeout during initial probe), the provider
  catalog falls back to the static `model-manifest.json` list, accompanied by an explicit
  degradation warning in the UI rather than silently pretending the runtime is fully healthy.
- Direct identifier passthrough: When launching a session or dispatching turns, the model
  identifier (`value`) selected by the user is passed verbatim to the provider runtime
  (`options.model`), allowing the underlying CLI to resolve aliases (`default`, `opus`,
  `sonnet`) or invoke custom model IDs natively. Default model selection for new sessions
  prefers the CLI-reported default model (or the first discovered model) over hardcoded
  first-party recommendations.

## Consequences

Claude Provider in Awen gains parity with Codex and OpenCode: users running Claude Code
backed by third-party models, Bedrock/Vertex, or local gateway proxies can select their
actual configured models directly in the Awen Workbench without needing manual custom
model entries in settings.

Existing test fixtures and unit tests for `ClaudeProvider` and `ClaudeAdapter` must be
updated to verify that `init.models` is consumed and transformed into `ServerProviderModel`
records. The desktop UI model picker seamlessly presents both native and configured
models as reported by the target daemon.
