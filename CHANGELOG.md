# Changelog

## Unreleased

- Add the versioned roadmap for comprehensive GNU AVR tooling coverage.
- Centralize shell-free AVR GCC and PlatformIO execution behind a bounded process runner.
- Propagate completion cancellation and extension shutdown into active tool processes.
- Preserve shared PlatformIO metadata discovery while allowing individual waiters to cancel safely.
- Add cross-platform CI for type checks, coverage, audit, packaging, and supported VS Code versions.
- Add real Extension Host smoke coverage for activation, language associations, completions,
  hover, signature help, commands, and an installed production VSIX.
- Add deterministic Restricted Mode Extension Host coverage for static language features.
- Extract project-context discovery into an editor-neutral service with bounded caches,
  shared cancellation, and stale-result rejection.
- Add immutable, source-preserving document snapshots with tolerant local definition
  analysis for labels, GNU symbol directives, assignments, comments, and incomplete input.
- Add toolchain-independent local-symbol completion, document symbols, hover, and
  same-file go-to-definition, including directional numeric labels.
- Add immutable, source-preserving statement and operand analysis for instructions,
  directives, and macro-shaped invocations, including continuations and AVR `$` separators.
- Add immutable structural GNU AVR expression trees with assembler-specific precedence,
  relocatable-address modifiers, absolute source ranges, and bounded malformed-input recovery.
- Add a deterministic 30,000-line parser latency fixture and parser-specific 90% coverage gates.

## 0.3.0

- Add an immutable catalogue of all 119 unique AVR instruction mnemonics.
- Add hover documentation for instruction forms, operands, timing, SREG effects, aliases,
  availability, and the official Microchip manual.
- Add overload-aware signature help and active-operand tracking.
- Derive instruction completions from the catalogue and expand TextMate highlighting to match it.
- Keep instruction help available without a toolchain and in untrusted workspaces.

## 0.2.0

- Introduce an editor-neutral, immutable AVR compilation context.
- Resolve settings per source file from `compile_commands.json`.
- Support safe `arguments` and quoted `command` compilation database entries.
- Add manual, compilation database, PlatformIO metadata, and INI precedence rules.
- Add the `AVR Assembly: Show Active Context` command.
- Stop accepting unrestricted compiler flags and forward only validated preprocessor inputs.

## 0.1.0

- Discover generic AVR compilation context through PlatformIO project metadata.
- Support current array-based and legacy string-based PlatformIO compiler flags.
- Forward validated MCU, macro definitions, and include paths to AVR preprocessing.
- Add automatic PlatformIO executable discovery and bounded metadata caching.
- Add modern AVR compatibility tests without board-specific production logic.

## 0.0.1

- Initial development scaffold.
- Add AVR syntax highlighting and static completions.
- Add configurable `<avr/io.h>` macro extraction through `avr-gcc`.
- Add basic `platformio.ini` MCU discovery from `board_build.mcu`.
