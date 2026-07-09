/**
 * Importing this module registers all 10 agents' v1 prompts into the shared
 * promptRegistry singleton as a side effect — every agent file imports this (directly or
 * transitively via agents/index.ts) before it ever calls promptRegistry.render/get, so
 * prompts are guaranteed registered regardless of import order elsewhere in the app.
 */
import "./productAgent.prompts.js";
import "./audienceAgent.prompts.js";
import "./competitorAgent.prompts.js";
import "./marketAgent.prompts.js";
import "./keywordAgent.prompts.js";
import "./creativeAgent.prompts.js";
import "./budgetAgent.prompts.js";
import "./personaAgent.prompts.js";
import "./campaignAgent.prompts.js";
import "./criticAgent.prompts.js";
