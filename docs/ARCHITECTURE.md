# Architecture

## High-level design

AVR Assembly IntelliSense separates data acquisition, parsing, and editor services to keep
analysis reliable and testable.

- **VS Code extension adapter**: activation, language registration, UI surfaces.
- **Project context layer**: resolves per-file compiler/MCU context from settings, compile
  database, and PlatformIO metadata.
- **Parser layer**: produces immutable snapshots of source with source-preserving ranges.
- **Statement and expression model**: represents GNU AVR constructs for local analysis.
- **Analysis providers**: completions, hover, signature help, symbols, and navigation.
- **Security/process layer**: bounded and cancellable process execution, plus trust-aware
  command paths.

## Dataflow

1. File text is tokenized and transformed into immutable source-aware document structures.
2. Analysis providers consume immutable snapshots to avoid stale state across edits.
3. Context discovery augments analysis with project-defined macros/headers when trusted.
4. Features return ranges and symbols derived from deterministic parsing.
5. Cancellation and invalidation paths drop stale work before surfacing stale results.

## Project context precedence

Context is resolved in a strict order:

1. Explicit extension settings.
2. `compile_commands.json`.
3. PlatformIO selected environment metadata.
4. `platformio.ini` fallback MCU discovery.
5. Default compiler/toolchain availability.

Higher-priority sources replace lower-priority context.

## Trust and security model

- Unsafe/untrusted workspaces limit tool execution features.
- Tooling invocations are process-based, bounded, and cancellation-aware.
- Commands are treated as structured inputs, not shell strings.
- Static editor functionality remains available without tooling.

## Reliability model

Core reliability targets are:

- Deterministic parsing under malformed or incomplete input.
- Bounded analysis to avoid hangs on large or pathological files.
- Bounded process execution and workspace-safe invalidation.
- Stale-result rejection for asynchronous operations.

## Release alignment

Changes should map to roadmap milestones in `docs/ROADMAP.md` and update changelog entries
for any user-visible behavior. Roadmap gates should be the acceptance point for milestone
completion.

