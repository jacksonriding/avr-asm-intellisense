# Changelog

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
- Add QUTy-shaped compatibility tests without board-specific production logic.

## 0.0.1

- Initial development scaffold.
- Add AVR syntax highlighting and static completions.
- Add configurable `<avr/io.h>` macro extraction through `avr-gcc`.
- Add basic `platformio.ini` MCU discovery from `board_build.mcu`.
