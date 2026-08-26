import { describe, expect, it } from "vitest";

import { parseObjectMacros } from "../src/core/macroParser";

describe("parseObjectMacros", () => {
  it("parses object-like AVR macros and preserves their expansions", () => {
    const output = [
      "#define PORTB _SFR_IO8(0x05)",
      "#define TIMER0_OVF_vect _VECTOR(16)",
      "#define FEATURE_FLAG",
      "#define _SFR_IO8(io_addr) _MMIO_BYTE((io_addr) + 0x20)"
    ].join("\n");

    expect(parseObjectMacros(output)).toEqual([
      { name: "FEATURE_FLAG", expansion: "" },
      { name: "PORTB", expansion: "_SFR_IO8(0x05)" },
      { name: "TIMER0_OVF_vect", expansion: "_VECTOR(16)" }
    ]);
  });

  it("ignores malformed input and keeps the final duplicate definition", () => {
    const output = [
      "compiler diagnostic",
      "#define PORTB old",
      "#define 123BAD value",
      "#define PORTB new value"
    ].join("\n");

    expect(parseObjectMacros(output)).toEqual([
      { name: "PORTB", expansion: "new value" }
    ]);
  });

  it("returns fresh immutable records", () => {
    const first = parseObjectMacros("#define PORTB 5");
    const second = parseObjectMacros("#define PORTB 5");

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
  });
});
