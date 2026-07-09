import rateLimit from "express-rate-limit";

// 120/min was tripped by normal navigation alone — the dashboard's widgets each fire their
// own request, so a handful of page loads in quick succession could exceed it without any
// abusive traffic involved. Raised to a ceiling that still catches real abuse/loops.
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded, slow down." },
});
