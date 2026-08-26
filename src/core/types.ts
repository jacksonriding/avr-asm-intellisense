export interface AvrMacro {
  readonly name: string;
  readonly expansion: string;
}

export type CompletionKind = "instruction" | "register" | "directive" | "device";

export interface CompletionCandidate {
  readonly label: string;
  readonly detail: string;
  readonly kind: CompletionKind;
}
