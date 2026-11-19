import { moneyCents, moneyFromCents } from "../utils/money.js";

function eventDate(result, fallback = new Date()) {
  const raw = String(result?.paymentDate || "").trim();
  if (/^\d{8}$/.test(raw)) {
    const date = new Date(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T00:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback;
}

export function classifyRemittanceFinancialEvent(result = {}) {
  const explicit = String(result.financialEventType || "").toUpperCase();
  if (["PAYMENT", "REVERSAL", "REPLACEMENT"].includes(explicit)) return explicit;

  const paid = Number(result.paidAmount);
  if (Number.isFinite(paid) && paid < 0) return "REVERSAL";
  if (result.replacesTransactionId) return "REPLACEMENT";
  return "PAYMENT";
}

function signedClaimAmount(result, eventType) {
  const cents = moneyCents(result?.paidAmount || 0, { allowNegative: true });
  if (eventType === "REVERSAL") {
    return cents > 0n ? -cents : cents;
  }
  return cents < 0n ? -cents : cents;
}

async function createEventOnce(tx, data) {
  const existing = await tx.financialEvent.findFirst({
    where: {
      organizationId: data.organizationId,
      sourceEventKey: data.sourceEventKey
    }
  });
  if (existing) return { event: existing, created: false };

  const event = await tx.financialEvent.create({ data });
  return { event, created: true };
}

export async function postEraFinancialEvents(
  tx,
  {
    organizationId,
    claimId,
    result,
    now = new Date()
  }
) {
  const sourceTransactionId = String(result?.transactionId || "").trim();
  if (!sourceTransactionId) {
    const error = new Error("ERA transaction ID is required for financial ledger posting");
    error.code = "FINANCIAL_LEDGER_SOURCE_REQUIRED";
    throw error;
  }

  const batch = await tx.paymentBatch.upsert({
    where: {
      organizationId_sourceTransactionId: {
        organizationId,
        sourceTransactionId
      }
    },
    update: {},
    create: {
      organizationId,
      sourceTransactionId,
      controlNumber: result.controlNumber || null,
      paymentReference: result.paymentReference || null,
      paymentMethod: result.paymentMethod || null,
      paymentDate: result.paymentDate || null,
      payerName: result.payerName || null,
      payeeNpi: result.payeeNpi || null,
      sourcePayload: {
        transactionType: result.transactionType || "835",
        testMode: result.testMode === true
      }
    }
  });

  const eventType = classifyRemittanceFinancialEvent(result);
  const claimAmountCents = signedClaimAmount(result, eventType);
  const claimPosting = await createEventOnce(tx, {
    organizationId,
    claimId,
    paymentBatchId: batch.id,
    eventType,
    amount: moneyFromCents(claimAmountCents),
    sourceTransactionId,
    sourceEventKey: `${sourceTransactionId}:CLAIM:${claimId}:${eventType}`,
    occurredAt: eventDate(result, now),
    metadata: {
      paymentReference: result.paymentReference || null,
      replacesTransactionId: result.replacesTransactionId || null,
      claimStatusCode: result.claimStatusCode || null
    }
  });

  const providerEvents = [];
  for (const [index, adjustment] of (result.providerAdjustments || []).entries()) {
    const amount = moneyCents(adjustment?.amount || 0, { allowNegative: true });
    const key = [
      sourceTransactionId,
      "PLB",
      index,
      adjustment?.reasonCode || "UNKNOWN",
      adjustment?.reference || "NOREF"
    ].join(":");

    const posted = await createEventOnce(tx, {
      organizationId,
      claimId: null,
      paymentBatchId: batch.id,
      eventType: "PROVIDER_ADJUSTMENT",
      amount: moneyFromCents(amount),
      sourceTransactionId,
      sourceEventKey: key,
      occurredAt: eventDate(result, now),
      metadata: {
        reasonCode: adjustment?.reasonCode || null,
        reference: adjustment?.reference || null,
        description: adjustment?.description || null,
        payerStated: true
      }
    });
    providerEvents.push(posted.event);
  }

  const aggregate = await tx.financialEvent.aggregate({
    where: {
      organizationId,
      claimId,
      eventType: { in: ["PAYMENT", "REVERSAL", "REPLACEMENT"] }
    },
    _sum: { amount: true }
  });

  return {
    paymentBatch: batch,
    claimEvent: claimPosting.event,
    claimEventCreated: claimPosting.created,
    providerEvents,
    cumulativeClaimPaidAmount: Number(aggregate._sum.amount || 0)
  };
}
