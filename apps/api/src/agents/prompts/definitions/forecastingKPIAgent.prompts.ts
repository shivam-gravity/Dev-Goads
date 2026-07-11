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
