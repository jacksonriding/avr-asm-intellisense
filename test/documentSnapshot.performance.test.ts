import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { createDocumentSnapshot } from "../src/core/documentSnapshot";
import { localDefinitionTargets, localSymbolHover } from "../src/core/localSymbols";

const GROUP_COUNT = 5_000;
const EXPECTED_DEFINITION_COUNT = GROUP_COUNT * 6;
const EXPECTED_STATEMENT_COUNT = GROUP_COUNT * 4;
const LARGE_DOCUMENT = Array.from({ length: GROUP_COUNT }, (_, index) => [
  `global_${index}: .Llocal_${index}: nop`,
  `${index % 10}: rjmp ${index % 10}b`,
  `.equ CONST_${index}, (1 << 3)`,
  `.set variable_${index}, CONST_${index}`,
  `message_${index} = "label: ; // still a string" ; ignored_${index}:`,
  `/* malformed-looking .equ hidden_${index}, 1 */`
].join("\n")).join("\n");

describe("document snapshot latency", () => {
  it("parses a deterministic 30,000-line document within the initial CI budget", () => {
    expect(LARGE_DOCUMENT.length).toBeGreaterThan(1_000_000);
    const initial = createDocumentSnapshot(LARGE_DOCUMENT, 0);
    expect(initial.definitions).toHaveLength(EXPECTED_DEFINITION_COUNT);
    expect(initial.statements).toHaveLength(EXPECTED_STATEMENT_COUNT);

    const durations = Array.from({ length: 5 }, (_, version) => {
      const startedAt = performance.now();
      const snapshot = createDocumentSnapshot(LARGE_DOCUMENT, version);
      const duration = performance.now() - startedAt;
      expect(snapshot.definitions).toHaveLength(EXPECTED_DEFINITION_COUNT);
      expect(snapshot.statements).toHaveLength(EXPECTED_STATEMENT_COUNT);
      return duration;
    }).sort((left, right) => left - right);

    expect(durations[2]).toBeLessThan(1_500);
  }, 15_000);

  it("answers local hover and definition queries near the end of a large document", () => {
    const snapshot = createDocumentSnapshot(LARGE_DOCUMENT, 0);
    const finalLabel = `global_${GROUP_COUNT - 1}`;
    const offset = LARGE_DOCUMENT.lastIndexOf(finalLabel) + 1;
    const startedAt = performance.now();

    const hover = localSymbolHover(snapshot, offset);
    const definitions = localDefinitionTargets(snapshot, offset);
    const duration = performance.now() - startedAt;

    expect(hover?.name).toBe(finalLabel);
    expect(definitions).toHaveLength(1);
    expect(duration).toBeLessThan(1_500);
  }, 15_000);

  it("keeps separator-heavy malformed input linear without materializing empty statements", () => {
    const source = "$".repeat(100_000);
    const startedAt = performance.now();

    const snapshot = createDocumentSnapshot(source, 0);
    const duration = performance.now() - startedAt;

    expect(snapshot.statements).toEqual([]);
    expect(snapshot.definitions).toEqual([]);
    expect(duration).toBeLessThan(1_500);
  }, 15_000);
});
