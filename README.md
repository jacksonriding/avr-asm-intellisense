# AVR Assembly IntelliSense

An early VS Code extension for GNU AVR assembly (`.S` and `.s`) in PlatformIO-style projects.

The current scaffold provides:

- AVR instruction, register, and GNU assembler directive completions
- Basic AVR assembly syntax highlighting
- MCU-specific macro completions extracted from `<avr/io.h>` by `avr-gcc -E -dM`
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

## Initial configuration

Set the MCU and, if necessary, the PlatformIO AVR compiler path in workspace settings:

```json
{
  "avrAsmIntellisense.mcu": "atmega328p",
  "avrAsmIntellisense.compilerPath": "/absolute/path/to/avr-gcc"
}
```

The extension runs preprocessing only in a trusted workspace. Uppercase `.S` remains recommended because the real AVR build must also preprocess `<avr/io.h>`.

## Roadmap

- Discover the active MCU and toolchain automatically from PlatformIO
- Parse local labels, `.equ`, `.set`, and assembler macros
- Add instruction hover documentation and operand guidance
- Add multi-environment selection and cache invalidation
- Add VS Code Extension Host and real-toolchain integration tests

## Status

This repository is an MVP scaffold and is not yet published to the VS Code Marketplace.
