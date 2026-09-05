import { describe, expect, it } from "vitest";

import { createDocumentSnapshot } from "../src/core/documentSnapshot";
import { buildDocumentDiagnostics } from "../src/core/diagnostics";

describe("document diagnostics", () => {
  it("warns for mismatched instruction arity", () => {
    const snapshot = createDocumentSnapshot("ldi r16", 1);
    const diagnostics = buildDocumentDiagnostics(snapshot);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: "LDI expects 2 operands but got 1.",
      level: "warning"
    });
  });

  it("warns when an operand expression is incomplete", () => {
    const snapshot = createDocumentSnapshot("ldi r16, 0x", 1);
    const diagnostics = buildDocumentDiagnostics(snapshot);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: "Incomplete expression in operand 2 of LDI.",
      level: "information"
    });
  });

  it("flags malformed operand expressions as errors", () => {
    const snapshot = createDocumentSnapshot("ldi r16, 1 + @", 1);
    const diagnostics = buildDocumentDiagnostics(snapshot);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: "Malformed expression in operand 2 of LDI.",
      level: "error"
    });
  });

  it("reports unresolved symbols when a symbol resolver is available", () => {
    const snapshot = createDocumentSnapshot("ldi r16, UNKNOWN", 1);
    const diagnostics = buildDocumentDiagnostics(
      snapshot,
      {
        resolveSymbol: (name) => name === "KNOWN"
      }
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message: "Undefined symbol reference 'UNKNOWN'.",
      level: "warning"
    });
  });

  it("skips symbol checks when no resolver is provided", () => {
    const snapshot = createDocumentSnapshot("ldi r16, UNKNOWN", 1);
    const diagnostics = buildDocumentDiagnostics(snapshot);

    expect(diagnostics).toEqual([]);
  });

  it("ignores diagnostic generation in inactive conditional regions", () => {
    const snapshot = createDocumentSnapshot("ldi r16", 1);
    const diagnostics = buildDocumentDiagnostics(
      snapshot,
      {
        conditionalStateAt: () => "inactive"
      }
    );

    expect(diagnostics).toEqual([]);
  });
});
