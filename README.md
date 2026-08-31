# AVR Assembly IntelliSense

Project-aware language support for GNU AVR assembly (`.S`, `.s`, and `.asm`) in VS Code.
It is build-system neutral: PlatformIO is supported, but it is only one source of AVR
compilation settings.

The extension provides:

- Completions for all 119 unique mnemonics in Microchip's AVR instruction manual
- Hover documentation with forms, operands, cycle counts, SREG effects, aliases, and availability
- Signature help that follows the active operand and distinguishes pointer-form overloads
- AVR instruction, register, and GNU assembler directive syntax highlighting
- MCU-specific macro completions extracted from `<avr/io.h>` by `avr-gcc -E -dM`
- Per-file compiler, MCU, define, undefine, and include discovery from `compile_commands.json`
- Generic PlatformIO metadata discovery for the compiler, MCU, defines, and include paths
- Lightweight `platformio.ini` MCU discovery from `board_build.mcu` as a fallback
- Safe compiler invocation without a shell
- Graceful fallback to static completions when a toolchain is unavailable
- An `AVR Assembly: Show Active Context` command for inspecting what was discovered

## Try the instruction help

Open an AVR assembly file and make sure the language indicator says **AVR Assembly**. Hover
over an instruction such as `LDI`, `LPM`, or `XCH` to see its documentation. Type a space or
comma after a mnemonic to open operand guidance; use **Trigger Parameter Hints** from the
Command Palette if parameter hints are disabled globally.

```asm
start:
    ldi r16, 0x20
    lpm r17, Z+
    out PORTB, r16
```

The catalogue represents the complete instruction-family union from Microchip's AVR
Instruction Set Manual, including aliases and device-specific instructions. Availability
and timing can vary between AVRe, AVRxm, AVRxt, AVRrc, and individual devices, so the hover
includes explicit caveats and links to the official manual. Target-specific filtering is a
future enhancement; the extension does not currently hide unsupported instructions for the
selected MCU.

## Development

The Extension Host harness requires Node.js 22 or newer. CI uses Node.js 24.

```sh
npm install
npm test
npm run check
npm run compile
npm run test:extension
npm run test:extension:restricted
npm run test:extension:packaged
```

`test:extension` exercises the source checkout in a real Extension Host. The packaged
variant builds, installs, and activates the generated VSIX in an isolated test profile.
The Restricted Mode variant uses a fresh untrusted workspace and verifies that static
language features remain available without granting project tool execution. On headless
Linux, install the Xvfb package and prefix Extension Host commands with `xvfb-run -a`.
Press `F5` in VS Code to start an interactive Extension Development Host.

## How project settings are resolved

Each AVR source file receives an immutable compilation context. Sources are considered in
this order:

1. Explicit `avrAsmIntellisense.compilerPath` and `avrAsmIntellisense.mcu` settings
2. An exact source-file entry in `compile_commands.json`
3. The selected PlatformIO environment's metadata
4. `board_build.mcu` in `platformio.ini`
5. `avr-gcc` on `PATH`, once an MCU is otherwise known

Data from different MCUs is not mixed. For example, changing the explicit MCU discards
defines and includes discovered for a different target.

Run **AVR Assembly: Show Active Context** from the Command Palette to see the source,
dialect, MCU, compiler, environment or working directory, and symbol-input counts used for
the active file.

## Compilation database projects

The extension searches for `compile_commands.json` in the workspace root and `build/`.
CMake can create this file with `CMAKE_EXPORT_COMPILE_COMMANDS`; Make-based projects can
generate one with tools such as Bear. A different file can be selected explicitly:

```json
{
  "avrAsmIntellisense.compileCommandsPath": "out/compile_commands.json"
}
```

Both the standard `arguments` representation and quoted `command` strings are supported.
The command is parsed as data and is never executed. Only the AVR compiler, `-mmcu`, `-D`,
`-U`, `-I`, and `-isystem` values are extracted; arbitrary build flags are not forwarded to
the preprocessing process.

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

## Manual projects

The extension remains usable without PlatformIO. Set the MCU and compiler manually:

```json
{
  "avrAsmIntellisense.mcu": "atmega328p",
  "avrAsmIntellisense.compilerPath": "/absolute/path/to/avr-gcc"
}
```

Static instruction, register, and directive completions do not require any toolchain.

## QUTy compatibility

The metadata integration is tested with a QUTy-shaped PlatformIO environment. It discovers
the ATtiny1626 MCU, PlatformIO-managed AVR compiler, include paths, and the
`__AVR_DEV_LIB_NAME__=tn1626` definition required by the QUTy platform. QUTy identifiers
are fixtures only; production code contains no QUTy-specific branch.

PlatformIO metadata can execute project build scripts, so project discovery and compiler
processes run only for trusted local workspaces. Compilation database commands are parsed
but never executed. Uppercase `.S` remains recommended because the real AVR build must also
preprocess `<avr/io.h>`.

## Roadmap

The project is working toward comprehensive GNU AVR language, device, editor, project,
validation, and reliability coverage. See the [versioned roadmap](docs/ROADMAP.md) for
milestones, measurable release gates, the immediate implementation slice, and explicit
non-goals.

## Status

This repository is under active development and is not yet published to the VS Code Marketplace.
