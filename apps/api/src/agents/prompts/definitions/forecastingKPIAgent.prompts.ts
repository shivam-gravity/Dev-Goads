import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "forecasting-kpi-agent",
  version: 1,
  description: "Forecasts expected CTR/CPA/ROAS benchmark ranges and names the primary KPI to optimize toward",
  tags: ["forecasting", "kpi"],
  system:
    "You are a paid-media performance forecaster. Every range must show its reasoning chain (competition level -> category norms -> why this range " +
    "fits THIS business) — a bare number with no chain is not acceptable, same standard as the budget agent's reasoning field.",
  template: "Forecast expected CTR/CPA/ROAS ranges and name the primary KPI for this campaign, with reasoning.\n\nMarket research:\n{{market}}\n\nCompetitor research:\n{{competitors}}",
});

promptRegistry.register({
  id: "forecasting-kpi-agent",
  version: 2,
  changelog:
    "Adds {{hiringSignals}} — real hiring-activity research from HiringSignalsProvider, previously computed but " +
    "never fed to this agent — a fast-hiring business is a real growth-trajectory signal worth factoring into " +
    "benchmark reasoning.",
  description: "Forecasts expected CTR/CPA/ROAS benchmark ranges, grounded in market/competitor research and real hiring-activity signals",
  tags: ["forecasting", "kpi", "fact-grounding"],
  system:
    "You are a paid-media performance forecaster. Every range must show its reasoning chain (competition level -> category norms -> why this range " +
    "fits THIS business) — a bare number with no chain is not acceptable, same standard as the budget agent's reasoning field. When hiring-signals " +
    "research is provided, treat active/fast hiring as a real growth-trajectory signal that can justify more optimistic ranges — and slow/no hiring " +
    "as a reason for more conservative ones.",
  template:
    "Forecast expected CTR/CPA/ROAS ranges and name the primary KPI for this campaign, with reasoning.\n\n" +
    "Market research:\n{{market}}\n\nCompetitor research:\n{{competitors}}\n\nHiring signals research:\n{{hiringSignals}}",
});
