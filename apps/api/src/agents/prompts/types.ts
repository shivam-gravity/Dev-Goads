/** Metadata every registered prompt carries — the "store prompt metadata" requirement.
 * Kept separate from the template body itself so callers can list/audit what prompts
 * exist (id, version, description, tags, changelog) without pulling in the actual text. */
export interface PromptMetadata {
  id: string;
  version: number;
  description: string;
  tags: string[];
  createdAt: string;
  /** What changed vs. the previous version of this same id — required from v2 onward so
   * a version bump always documents why, not just what the new text says. */
  changelog?: string;
}

export interface PromptTemplate extends PromptMetadata {
  /** Optional system-role instruction, rendered as-is (no variable substitution — system
   * prompts describe the agent's role/rules, which don't vary per invocation). */
  system?: string;
  /** The user-role template body. `{{variableName}}` tokens are substituted by
   * PromptRegistry.render() — see PromptRegistry.ts. */
  template: string;
}

export type PromptDefinition = Omit<PromptTemplate, "createdAt"> & { createdAt?: string };
