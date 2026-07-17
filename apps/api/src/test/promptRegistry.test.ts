import { test } from "node:test";
import assert from "node:assert";
import { PromptRegistry, DuplicatePromptVersionError, PromptNotFoundError } from "../agents/prompts/PromptRegistry.js";

test("PromptRegistry - registers and renders a v1 prompt, substituting {{vars}}", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "greets someone", tags: ["test"], template: "Hello, {{name}}!" });

  const rendered = registry.render("greet", { name: "World" });
  assert.strictEqual(rendered.prompt, "Hello, World!");
  assert.strictEqual(rendered.meta.id, "greet");
  assert.strictEqual(rendered.meta.version, 1);
});

test("PromptRegistry - leaves an unmatched {{token}} untouched rather than throwing", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], template: "Hello, {{name}}! Today is {{day}}." });
  const rendered = registry.render("greet", { name: "World" });
  assert.strictEqual(rendered.prompt, "Hello, World! Today is {{day}}.");
});

test("PromptRegistry - get() without a version returns the latest registered version", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], template: "v1 {{name}}" });
  registry.register({ id: "greet", version: 2, description: "d", tags: [], changelog: "friendlier tone", template: "v2 {{name}}" });

  assert.strictEqual(registry.get("greet").version, 2);
  assert.strictEqual(registry.get("greet", 1).version, 1);
});

test("PromptRegistry - rejects registering the same id+version twice", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], template: "v1" });
  assert.throws(() => registry.register({ id: "greet", version: 1, description: "d2", tags: [], template: "v1 again" }), DuplicatePromptVersionError);
});

test("PromptRegistry - requires a changelog for any version after v1", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], template: "v1" });
  assert.throws(() => registry.register({ id: "greet", version: 2, description: "d", tags: [], template: "v2" }), /changelog is required/);
});

test("PromptRegistry - get()/render() throw PromptNotFoundError for an unknown id or version", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], template: "v1" });
  assert.throws(() => registry.get("missing"), PromptNotFoundError);
  assert.throws(() => registry.get("greet", 99), PromptNotFoundError);
});

test("PromptRegistry - listVersions/list expose metadata without leaking the template body", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "greets", tags: ["test"], template: "secret template text" });

  const versions = registry.listVersions("greet");
  assert.strictEqual(versions.length, 1);
  assert.strictEqual(versions[0].description, "greets");
  assert.ok(!("template" in versions[0]));

  const all = registry.list();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].id, "greet");
});

test("PromptRegistry - a system prompt is passed through unmodified (no variable substitution)", () => {
  const registry = new PromptRegistry();
  registry.register({ id: "greet", version: 1, description: "d", tags: [], system: "You say {{literal}}.", template: "Hello {{name}}" });
  const rendered = registry.render("greet", { name: "World" });
  assert.strictEqual(rendered.system, "You say {{literal}}.");
});
