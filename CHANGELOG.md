# Changelog

All notable changes for AVR Assembly IntelliSense.

## Unreleased

### Added
- Add a versioned roadmap and public delivery criteria in `docs/ROADMAP.md`.
- Add bounded shell-free execution via a shared process runner for `avr-gcc` and PlatformIO.
- Add workspace-context extraction to an editor-neutral layer with deterministic caching.
- Add immutable, source-preserving parsing and local definition modeling for GNU AVR assembly:
  labels, GNU symbol directives, assignments, comments, and incomplete input.
- Add local symbol completion, document symbols, hover, and same-file go-to-definition.
- Add instruction/directive/macro statement modeling with continuations and same-line separators.
- Add structural, immutable GNU AVR expression trees with assembler semantics and bounded malformed-input recovery.
- Add deterministic large-file parser-latency fixture and parser-critical coverage gates.
- Add Extension Host coverage for activation, language features, static-only workspace modes, and packaged activation.
- Strengthen trust-bound behaviors for Restricted Mode and untrusted workspace execution paths.

### Changed
- Standardize process and discovery behavior so cancellation and workspace shutdown propagate safely.
- Centralize compiler/platform metadata extraction and stale-result handling across discovery paths.
- Harden command/input handling in preparation for stricter release gates.

### Security
- Ensure command execution never uses shell interpolation.
- Restrict executable command surfaces through validated process invocation.
- Keep static analysis functional when compiler/tooling is missing.

## 0.3.0 — 2026-08-29

### Added
- Immutable catalogue of 119 AVR instruction mnemonics.
- Instruction hover docs with operands, timing notes, SREG effects, aliases, and availability.
- Overload-aware signature help with active-operand resolution.
- Static completions and TextMate-driven highlighting.
- Platform and compile context foundations:
  - `compile_commands.json` ingestion
  - Safe handling of `arguments` and `command` forms
  - Manual, PlatformIO, and default compiler-path settings
  - `AVR Assembly: Show Active Context` command
- Workspace-context discovery pipeline with trust-aware handling.

### Changed
- Add `usePlatformioMetadata` and stronger boundaries on settings-driven metadata flow.
- Tighten extraction and forwarding of compiler inputs for preprocessing and symbol discovery.

### Security
- Reject unsafe build flags outside supported preprocessing inputs.

## 0.2.0 — 2026-08-20

### Added
- Add editor-neutral compilation context extraction.
- Resolve AVR settings from `compile_commands.json`.
- Add manual + PlatformIO + INI-based MCU and include discovery.
- Add `AVR Assembly: Show Active Context` command.

### Changed
- Keep instruction docs and completion behavior available without toolchain execution.

## 0.1.0 — 2026-08-15

### Added
- Add editor-neutral AVR context extraction.
- Add PlatformIO metadata discovery and automatic compiler/execution path resolution.
- Add automatic PlatformIO executable discovery.

### Changed
- Modernize compatibility paths for PlatformIO compilers and metadata.

## 0.0.1 — Initial development

### Added
- Initial syntax highlighting, static completion, and assembler language entry points.
- Configurable `<avr/io.h>` macro extraction via `avr-gcc`.
