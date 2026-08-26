# Changelog

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
