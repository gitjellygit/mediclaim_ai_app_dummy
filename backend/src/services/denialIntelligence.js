/**
 * Denial & Appeal Intelligence
 *
 * Design goals:
 * 1. Ground recommendations in payer/remittance + claim facts.
 * 2. Never invent denial reasons.
 * 3. Keep external LLM use OFF unless the deployment explicitly confirms
 *    the required HIPAA/BAA configuration.
 * 4. Do not send direct identifiers (patient name, DOB, member ID, policy,
 *    phone, addresses, authorization number) to the LLM prompt.
 * 5. Fall back to deterministic rules if the LLM is unavailable.
 */

const OPENAI_URL = "https://api.openai.com/v1/responses";

function moneyGap(claim) {
  const claimed = Number(claim.amount || 0);
  const paid = Number(claim.paidAmount || 0);
  const allowed = Number(claim.allowedAmount || 0);

  if (claimed <= 0) return 0;
  if (paid > 0) return Math.max(0, claimed - paid);
  if (allowed > 0) return Math.max(0, claimed - allowed);
  return claimed;
}

function inferCategory(claim, denial) {
  if (denial.denialCategory) return denial.denialCategory;

  if (
    claim.priorAuthRequired === true &&
    !["APPROVED", "NOT_REQUIRED"].includes(claim.priorAuthStatus)
  ) {
    return "AUTHORIZATION";
  }

  if (claim.eligibilityStatus !== "VERIFIED") {
    return "ELIGIBILITY";
  }

  if (!Array.isArray(claim.icd10Codes) || claim.icd10Codes.length === 0) {
    return "CODING";
  }

  if (!claim.documents?.length) {
    return "DOCUMENTATION";
  }

  return "OTHER";
}

function ruleBasedAnalysis(claim, denial) {
  const category = inferCategory(claim, denial);
  const documentTypes = new Set((claim.documents || []).map((d) => d.type));

  let correctable = true;
  let appealEligible = true;
  let recommendedAction = "Review payer reason and supporting documentation before appeal or resubmission.";
  let requiredDocuments = [];
  let explanation =
    "The claim requires manual review because the available structured data does not identify a single dominant denial cause.";
  let confidence = 62;

  if (category === "AUTHORIZATION") {
    recommendedAction =
      "Validate prior authorization requirements and dates. Correct authorization data or attach payer authorization evidence before resubmission/appeal.";
    requiredDocuments = ["PRIOR_AUTHORIZATION", "CLINICAL_SUPPORT"];
    explanation =
      "Authorization is the strongest detected denial driver based on the claim's prior-authorization state.";
    confidence = 88;
  } else if (category === "ELIGIBILITY") {
    recommendedAction =
      "Re-verify member eligibility and coverage for the date of service before correcting or appealing the claim.";
    requiredDocuments = ["ELIGIBILITY_RESPONSE", "INSURANCE_CARD"];
    explanation =
      "Eligibility is not verified for this claim, which is a strong administrative denial signal.";
    confidence = 86;
  } else if (category === "CODING") {
    recommendedAction =
      "Review diagnosis/procedure coding, modifiers, and documentation support before corrected claim submission.";
    requiredDocuments = ["CODING_REVIEW", "CLINICAL_NOTE"];
    explanation =
      "Structured coding support is incomplete, increasing the likelihood of a coding-related rejection or denial.";
    confidence = 78;
  } else if (category === "DOCUMENTATION") {
    recommendedAction =
      "Collect the missing clinical/billing support and submit the requested documentation or corrected claim.";
    requiredDocuments = ["SUPPORTING_DOCUMENTS"];
    explanation =
      "The claim lacks sufficient supporting documents in the application record.";
    confidence = 80;
  }

  if (!documentTypes.has("FINAL_BILL")) {
    requiredDocuments.push("FINAL_BILL");
  }

  if (
    claim.claimType === "REIMBURSEMENT" &&
    !documentTypes.has("DISCHARGE_SUMMARY")
  ) {
    requiredDocuments.push("DISCHARGE_SUMMARY");
  }

  requiredDocuments = [...new Set(requiredDocuments)];

  return {
    category,
    correctable,
    appealEligible,
    revenueAtRisk: moneyGap(claim),
    recommendedAction,
    requiredDocuments,
    explanation,
    confidence,
    provider: "RULE_ENGINE",
    model: "denial-rules-v1"
  };
}

function llmEnabled() {
  return (
    process.env.HIPAA_BAA_CONFIRMED === "true" &&
    process.env.OPENAI_API_KEY &&
    process.env.OPENAI_DENIAL_MODEL
  );
}

function buildMinimumNecessaryContext(claim, denial, rules) {
  // No direct identifiers are included here.
  return {
    denial: {
      category: denial.denialCategory || rules.category,
      groupCode: denial.groupCode || null,
      carcCode: denial.carcCode || null,
      rarcCode: denial.rarcCode || null,
      // Free-text payer reason is excluded by default because it may contain PHI.
      reasonTextIncluded: false
    },
    claim: {
      claimType: claim.claimType,
      payerClaimStatus: claim.payerClaimStatus,
      eligibilityStatus: claim.eligibilityStatus,
      priorAuthRequired: claim.priorAuthRequired,
      priorAuthStatus: claim.priorAuthStatus,
      claimedAmount: claim.amount,
      billedAmount: claim.totalBilledAmount,
      allowedAmount: claim.allowedAmount,
      paidAmount: claim.paidAmount,
      patientResponsibility: claim.patientResponsibility,
      hasIcd10Codes:
        Array.isArray(claim.icd10Codes) && claim.icd10Codes.length > 0,
      documentTypes: (claim.documents || []).map((d) => d.type)
    },
    deterministicAnalysis: {
      category: rules.category,
      revenueAtRisk: rules.revenueAtRisk,
      recommendedAction: rules.recommendedAction,
      requiredDocuments: rules.requiredDocuments
    }
  };
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

async function callOpenAI(context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  const body = {
    model: process.env.OPENAI_DENIAL_MODEL,
    input: [
      {
        role: "system",
        content:
          "You are a US healthcare revenue-cycle denial analyst. Use only the supplied facts. Do not invent payer policy, diagnosis, medical necessity, codes, deadlines, or coverage. Return strict JSON with keys explanation, recommendedAction, requiredDocuments, confidence. confidence must be an integer 0-100. requiredDocuments must be an array of short strings."
      },
      {
        role: "user",
        content: JSON.stringify(context)
      }
    ]
  };

  let lastError;

  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(OPENAI_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(
            `LLM request failed with status ${response.status}`
          );
          error.status = response.status;
          error.detail = text.slice(0, 300);
          throw error;
        }

        const payload = await response.json();
        const raw = extractResponseText(payload).trim();
        const parsed = JSON.parse(raw);

        return {
          explanation: String(parsed.explanation || "").trim(),
          recommendedAction: String(parsed.recommendedAction || "").trim(),
          requiredDocuments: Array.isArray(parsed.requiredDocuments)
            ? parsed.requiredDocuments.map((x) => String(x))
            : [],
          confidence: Math.max(
            0,
            Math.min(100, Number(parsed.confidence) || 0)
          )
        };
      } catch (error) {
        lastError = error;
        const retryable =
          error?.name === "AbortError" ||
          error?.status === 429 ||
          Number(error?.status || 0) >= 500;

        if (!retryable || attempt === 2) throw error;

        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  throw lastError;
}

export async function analyzeDenial(claim, denial) {
  const rules = ruleBasedAnalysis(claim, denial);

  if (!llmEnabled()) {
    return {
      ...rules,
      llmUsed: false,
      llmReason:
        "LLM disabled until HIPAA_BAA_CONFIRMED=true and an approved API model/key are configured."
    };
  }

  try {
    const context = buildMinimumNecessaryContext(claim, denial, rules);
    const llm = await callOpenAI(context);

    return {
      ...rules,
      explanation: llm.explanation || rules.explanation,
      recommendedAction:
        llm.recommendedAction || rules.recommendedAction,
      requiredDocuments:
        llm.requiredDocuments.length > 0
          ? llm.requiredDocuments
          : rules.requiredDocuments,
      confidence:
        llm.confidence > 0
          ? Math.min(llm.confidence, 95)
          : rules.confidence,
      provider: "OPENAI",
      model: process.env.OPENAI_DENIAL_MODEL,
      llmUsed: true
    };
  } catch (error) {
    // No PHI/context is logged. The rule engine keeps the workflow usable.
    console.error("[denial-ai] LLM analysis failed; using rules fallback", {
      status: error?.status || null,
      name: error?.name || "Error"
    });

    return {
      ...rules,
      llmUsed: false,
      llmReason: "LLM unavailable; deterministic denial rules were used."
    };
  }
}
