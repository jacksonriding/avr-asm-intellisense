# AVR Assembly IntelliSense

An early VS Code extension for GNU AVR assembly (`.S`, `.s`, and `.asm`) in PlatformIO-style projects.

The current scaffold provides:

- AVR instruction, register, and GNU assembler directive completions
- Basic AVR assembly syntax highlighting
- MCU-specific macro completions extracted from `<avr/io.h>` by `avr-gcc -E -dM`
- Generic PlatformIO metadata discovery for the compiler, MCU, defines, and include paths
- Lightweight `platformio.ini` MCU discovery from `board_build.mcu` as a fallback
- Safe compiler invocation without a shell
- Graceful fallback to static completions when a toolchain is unavailable

## Development

```sh
npm install
npm test
npm run check
npm run compile
```

Press `F5` in VS Code to start an Extension Development Host.

## PlatformIO projects

In a trusted local workspace, the extension runs `pio project metadata --json-output`
and uses PlatformIO's selected AVR compiler, MCU flags, preprocessor definitions, and
include paths. This supports custom boards and platforms without hard-coded board names.

For projects with multiple environments, select one explicitly when necessary:

```json
{
  "avrAsmIntellisense.platformioEnvironment": "uno"
}
```

The PlatformIO executable is discovered from the PlatformIO IDE custom path, its standard
installation under `.platformio/penv`, or `PATH`. It can also be configured explicitly:

```json
{
  "avrAsmIntellisense.platformioPath": "/absolute/path/to/platformio"
}
```

## Manual and non-PlatformIO projects

The extension remains usable without PlatformIO. Set the MCU and compiler manually:

```json
{
  "avrAsmIntellisense.mcu": "atmega328p",
  "avrAsmIntellisense.compilerPath": "/absolute/path/to/avr-gcc"
}
```

If metadata is disabled or unavailable, `board_build.mcu` from `platformio.ini` and
`avr-gcc` on `PATH` remain available as fallbacks. Static instruction, register, and
directive completions do not require any toolchain.

## QUTy compatibility

The metadata integration is tested with a QUTy-shaped PlatformIO environment. It discovers
the ATtiny1626 MCU, PlatformIO-managed AVR compiler, include paths, and the
`__AVR_DEV_LIB_NAME__=tn1626` definition required by the QUTy platform. QUTy identifiers
are fixtures only; production code contains no QUTy-specific branch.

PlatformIO metadata can execute project build scripts, so metadata and compiler processes
run only for trusted local workspaces. Uppercase `.S` remains recommended because the real
AVR build must also preprocess `<avr/io.h>`.

## Roadmap

- Parse local labels, `.equ`, `.set`, and assembler macros
- Add instruction hover documentation and operand guidance
- Add Extension Host integration tests and process cancellation
- Add optional real-toolchain integration tests

## Status

This repository is an MVP scaffold and is not yet published to the VS Code Marketplace.
