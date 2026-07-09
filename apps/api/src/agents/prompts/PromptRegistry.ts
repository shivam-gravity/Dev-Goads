import type { PromptDefinition, PromptMetadata, PromptTemplate } from "./types.js";

export class DuplicatePromptVersionError extends Error {
  constructor(id: string, version: number) {
    super(`Prompt "${id}" version ${version} is already registered — bump the version instead of overwriting it`);
    this.name = "DuplicatePromptVersionError";
  }
}

export class PromptNotFoundError extends Error {
  constructor(id: string, version?: number) {
    super(version ? `Prompt "${id}" version ${version} not found` : `Prompt "${id}" not found`);
    this.name = "PromptNotFoundError";
  }
}

export interface RenderedPrompt {
  system?: string;
  prompt: string;
  meta: PromptMetadata;
}

/**
 * The Prompt Registry — the single source of truth every agent looks its prompt up
 * through, rather than embedding prompt text inline in agent code ("do not use hardcoded
 * prompts"). Every prompt is versioned: registering the same id twice with the same
 * version is rejected (DuplicatePromptVersionError), and an agent can request either the
 * latest version or pin to a specific one, so a prompt change is always an additive,
 * auditable new version rather than a silent in-place edit.
 */
export class PromptRegistry {
  private readonly versionsById = new Map<string, Map<number, PromptTemplate>>();

  register(definition: PromptDefinition): PromptTemplate {
    const versions = this.versionsById.get(definition.id) ?? new Map<number, PromptTemplate>();
    if (versions.has(definition.version)) {
      throw new DuplicatePromptVersionError(definition.id, definition.version);
    }
    if (definition.version > 1 && !definition.changelog) {
      throw new Error(`Prompt "${definition.id}" v${definition.version}: changelog is required for any version after v1`);
    }
    const template: PromptTemplate = { createdAt: new Date(0).toISOString(), ...definition };
    versions.set(definition.version, template);
    this.versionsById.set(definition.id, versions);
    return template;
  }

  /** Registers with the real current timestamp — split from `register` only so tests can
   * deterministically register fixtures without depending on wall-clock time. */
  registerNow(definition: PromptDefinition): PromptTemplate {
    return this.register({ ...definition, createdAt: definition.createdAt ?? new Date().toISOString() });
  }

  get(id: string, version?: number): PromptTemplate {
    const versions = this.versionsById.get(id);
    if (!versions || versions.size === 0) throw new PromptNotFoundError(id, version);
    if (version !== undefined) {
      const template = versions.get(version);
      if (!template) throw new PromptNotFoundError(id, version);
      return template;
    }
    const latestVersion = Math.max(...versions.keys());
    return versions.get(latestVersion)!;
  }

  /** Substitutes `{{name}}` tokens in the template body against `vars` — an unmatched
   * token is left as-is rather than throwing, so a caller passing a partial vars object
   * (e.g. a context field that's null) degrades visibly instead of crashing the agent. */
  render(id: string, vars: Record<string, string>, version?: number): RenderedPrompt {
    const template = this.get(id, version);
    const prompt = template.template.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
    const { system, template: _t, ...meta } = template;
    return { system, prompt, meta };
  }

  listVersions(id: string): PromptMetadata[] {
    const versions = this.versionsById.get(id);
    if (!versions) return [];
    return [...versions.values()]
      .sort((a, b) => a.version - b.version)
      .map((t): PromptMetadata => {
        const { system: _system, template: _template, ...meta } = t;
        return meta;
      });
  }

  list(): PromptMetadata[] {
    return [...this.versionsById.keys()].flatMap((id) => this.listVersions(id));
  }
}

/** Process-wide singleton — every agent (and every prompt definition file, at import
 * time) registers against / reads from this one instance. */
export const promptRegistry = new PromptRegistry();
