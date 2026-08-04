/**
 * Computes a 0-100 risk score for a tourist from known factors.
 * This is a transparent, rule-based formula — not a trained ML
 * model. That's a deliberate, honest choice for an MVP: explainable
 * scoring you can justify in a demo, upgradeable to a trained model
 * later once there's real incident data to learn from.
 */
export function computeRiskScore({ openAlerts, currentHour }) {
  // An open SOS alert means "in danger right now" — this should
  // dominate the score, not just nudge it.
  const hasSos = openAlerts.some((a) => a.alert_type === "sos");
  if (hasSos) {
    return { score: 100, level: "critical", reasons: ["Active SOS alert"] };
  }

  let score = 0;
  const reasons = [];

  // Zone risk contributes points per open geofence breach, weighted
  // by how risky that specific zone is.
  const zoneWeights = { high: 30, medium: 15, low: 5 };
  const breaches = openAlerts.filter((a) => a.alert_type === "geofence_breach");
  for (const breach of breaches) {
    const weight = zoneWeights[breach.risk_level] ?? 10;
    score += weight;
    reasons.push(`In ${breach.risk_level}-risk zone`);
  }

  // Time-of-day risk: late night / pre-dawn hours add points.
  // currentHour is 0-23, in the tourist's local time.
  if (currentHour >= 0 && currentHour < 5) {
    score += 20;
    reasons.push("Late-night hours (12am-5am)");
  } else if (currentHour >= 22) {
    score += 10;
    reasons.push("Night hours (10pm-12am)");
  }

  // Multiple simultaneous open alerts (of any type) compound risk —
  // one issue is concerning, several at once is more so.
  if (openAlerts.length > 1) {
    score += 10;
    reasons.push(`${openAlerts.length} simultaneous open alerts`);
  }

  score = Math.min(score, 100); // cap at 100

  let level = "low";
  if (score >= 70) level = "critical";
  else if (score >= 40) level = "high";
  else if (score >= 15) level = "medium";

  return { score, level, reasons: reasons.length ? reasons : ["No active risk factors"] };
}