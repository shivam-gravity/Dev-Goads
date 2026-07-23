/**
 * Importing this module registers every agent's prompts into the shared promptRegistry
 * singleton as a side effect — the 3 composite super-agents (strategy-agent,
 * creative-offer-agent, reviewer-agent) that make up the active roster. Every agent file
 * imports this (directly or transitively via agents/index.ts) before it ever calls
 * promptRegistry.render/get, so prompts are guaranteed registered regardless of import
 * order elsewhere in the app.
 */
import "./compositeAgents.prompts.js";
