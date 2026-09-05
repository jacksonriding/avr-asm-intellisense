# AVR Assembly IntelliSense

Project-aware language support for GNU AVR assembly in Visual Studio Code.
The extension is build-system agnostic: it can consume PlatformIO metadata, `compile_commands.json`, or manual settings.

## Highlights

- Completions for all 119 AVR instruction mnemonics from the official AVR ISA
- Instruction hover with operands, timing notes, status effects, aliases, and caveats
- Operand-aware signature help with active-parameter tracking
- Local completion, outline symbols, symbol hover, and same-file go-to-definition
- Syntax highlighting for AVR instructions, registers, and assembler directives
- Targeted macro extraction from `<avr/io.h>` via `avr-gcc -E -dM`
- Compilation-context discovery from `compile_commands.json`, PlatformIO metadata, and workspace settings
- Safe process execution model (bounded and non-shell-based) with graceful fallback to static analysis
- Workspace command: **AVR Assembly: Show Active Context**

## Quick start

1. Install dependencies:

```sh
npm install
```

2. Open an AVR file (`.S`, `.s`, or `.asm`) and confirm language mode is **AVR Assembly**.
3. Trigger completion or hover on an instruction such as `LDI`, `LPM`, or `XCH`.
4. Use comma/space after mnemonics for signature help.

```asm
start:
    ldi r16, 0x20
    lpm r17, Z+
    out PORTB, r16
```

## Feature support and behavior

The instruction catalog includes aliases and device-dependent variants from Microchip’s AVR documentation. Device filtering is not exact today; some unsupported mnemonics may still appear for a selected MCU. Each hover includes clear availability caveats where applicable.

Static language features work without a compiler:

- Instruction completions and docs
- Register and directive completion
- Symbol discovery in simple source files
- Hover, signature help, and outline basics

Tool-assisted features may require trusted workspace context and a local toolchain:

- `<avr/io.h>` macro extraction
- Compile context from `compile_commands.json` and PlatformIO
- Preprocessor-derived symbols

## Project settings

Resolution order for per-file context is deterministic:

1. `avrAsmIntellisense.compilerPath` + `avrAsmIntellisense.mcu`
2. Exact file entry in `compile_commands.json`
3. Selected PlatformIO environment metadata
4. `platformio.ini` `board_build.mcu`
5. `avr-gcc` from `PATH` when MCU is known

Data from different MCU contexts is never merged.

Run **AVR Assembly: Show Active Context** from the command palette to inspect the active file context.

## Workspace integration

### Compilation database (`compile_commands.json`)

The extension searches `compile_commands.json` in workspace root and `build/`.

```json
{
  "avrAsmIntellisense.compileCommandsPath": "out/compile_commands.json"
}
```

Both `arguments` and command-string formats are supported. Commands are parsed as data only; they are never executed. Only AVR compiler flags relevant to preprocessing are read.

### PlatformIO

Trusted workspaces may use `pio project metadata --json-output` to discover compiler, MCU, macros, and include paths.

```json
{
  "avrAsmIntellisense.platformioEnvironment": "uno",
  "avrAsmIntellisense.platformioPath": "/absolute/path/to/platformio"
}
```

### Manual mode

For non-PlatformIO projects:

```json
{
  "avrAsmIntellisense.compilerPath": "/usr/local/bin/avr-gcc",
  "avrAsmIntellisense.mcu": "atmega328p"
}
```

## Development workflow

Prerequisite:

- Node.js 22+ (CI uses Node.js 24)

```sh
npm install
npm run check
npm run test
npm run compile
npm run test:extension
npm run test:extension:restricted
npm run test:extension:packaged
```

`test:extension` runs the source checkout in Extension Host.
`test:extension:packaged` builds and installs a packaged VSIX in an isolated profile.
`test:extension:restricted` validates static analysis in an untrusted workspace.

On Linux CI/headless environments, use:

```sh
xvfb-run -a npm run test:extension
```

Press `F5` in VS Code for interactive development host testing.

## Documentation

- [Roadmap](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)

## Community and governance

- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)

## Status

This extension is actively developed and not currently published to the VS Code Marketplace.
