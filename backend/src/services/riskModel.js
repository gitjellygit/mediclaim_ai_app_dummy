function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }
  
  export function predictRejectionRisk({ claim, documents, latestIssues }) {
    // This is a “light model” (hybrid heuristic + small noise) that looks ML-ish.
    // You can replace later with real ML once you have historical outcomes.
  
    const docTypes = new Set((documents || []).map((d) => d.type));
  
    const missingFinalBill = !docTypes.has("FINAL_BILL");
    const missingDischarge = !docTypes.has("DISCHARGE_SUMMARY");
    const missingPolicy = !claim.policyNo;
  
    const amount = Number(claim.amount || 0);
    const billed = Number(claim.totalBilledAmount || 0);
    const amountRatio = billed > 0 ? amount / billed : null;
  
    const blockers = (latestIssues || []).filter((i) => i.severity === "BLOCK").length;
  
    let risk = 0.15; // base risk
    const factors = [];
  
    if (missingFinalBill) {
      risk += 0.22;
      factors.push("Missing Final Bill");
    }
    if (missingDischarge) {
      risk += 0.22;
      factors.push("Missing Discharge Summary");
    }
    if (missingPolicy) {
      risk += 0.18;
      factors.push("Policy number missing");
    }
    if (amount <= 0) {
      risk += 0.35;
      factors.push("Claimed amount is invalid");
    }
    if (amountRatio !== null && amountRatio > 1) {
      risk += 0.25;
      factors.push("Claimed amount exceeds billed amount");
    }
    if (blockers > 0) {
      risk += Math.min(0.3, blockers * 0.08);
      factors.push("Blocking readiness issues present");
    }
    if (!claim.icd10Codes || claim.icd10Codes.length === 0) {
      risk += 0.05;
      factors.push("ICD-10 codes missing");
    }
  
    // tiny noise so it feels probabilistic (optional)
    risk += (Math.random() - 0.5) * 0.04;
  
    risk = clamp01(risk);
  
    const level = risk >= 0.66 ? "HIGH" : risk >= 0.33 ? "MED" : "LOW";
  
    // Top 3 factors
    const topFactors = factors.slice(0, 3);
  
    return { riskScore: risk, riskLevel: level, riskFactors: topFactors };
  }