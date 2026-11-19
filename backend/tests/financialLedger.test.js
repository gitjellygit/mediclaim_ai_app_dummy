import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRemittanceFinancialEvent,
  postEraFinancialEvents
} from "../src/services/financialLedger.js";

function fakeTx() {
  const batches = [];
  const events = [];

  return {
    _events: events,
    paymentBatch: {
      async upsert({ where, create }) {
        const key = where.organizationId_sourceTransactionId;
        let found = batches.find(
          (item) =>
            item.organizationId === key.organizationId &&
            item.sourceTransactionId === key.sourceTransactionId
        );
        if (!found) {
          found = { id: `batch-${batches.length + 1}`, ...create };
          batches.push(found);
        }
        return found;
      }
    },
    financialEvent: {
      async findFirst({ where }) {
        return events.find(
          (item) =>
            item.organizationId === where.organizationId &&
            item.sourceEventKey === where.sourceEventKey
        ) || null;
      },
      async create({ data }) {
        const item = { id: `event-${events.length + 1}`, ...data };
        events.push(item);
        return item;
      },
      async aggregate({ where }) {
        const sum = events
          .filter(
            (item) =>
              item.organizationId === where.organizationId &&
              item.claimId === where.claimId &&
              where.eventType.in.includes(item.eventType)
          )
          .reduce((total, item) => total + Number(item.amount), 0);
        return { _sum: { amount: sum } };
      }
    }
  };
}

test("#044 partial payments append and cumulative payer cash is preserved", async () => {
  const tx = fakeTx();

  const first = await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-1",
      paidAmount: 60,
      paymentReference: "EFT-1"
    }
  });
  const second = await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-2",
      paidAmount: 40,
      paymentReference: "EFT-2"
    }
  });

  assert.equal(first.cumulativeClaimPaidAmount, 60);
  assert.equal(second.cumulativeClaimPaidAmount, 100);
  assert.equal(tx._events.filter((event) => event.claimId === "claim-1").length, 2);
});

test("#044 replay does not duplicate or erase financial events", async () => {
  const tx = fakeTx();
  const input = {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-IDEMPOTENT",
      paidAmount: 80,
      paymentReference: "EFT-IDEMPOTENT"
    }
  };

  const first = await postEraFinancialEvents(tx, input);
  const replay = await postEraFinancialEvents(tx, input);

  assert.equal(first.claimEventCreated, true);
  assert.equal(replay.claimEventCreated, false);
  assert.equal(replay.cumulativeClaimPaidAmount, 80);
  assert.equal(tx._events.length, 1);
});

test("#044 reversal and corrected replacement remain traceable offsetting entries", async () => {
  const tx = fakeTx();

  await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: { transactionId: "ERA-ORIGINAL", paidAmount: 100 }
  });
  const reversal = await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-REVERSAL",
      paidAmount: -100,
      financialEventType: "REVERSAL"
    }
  });
  const replacement = await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-REPLACEMENT",
      paidAmount: 90,
      financialEventType: "REPLACEMENT",
      replacesTransactionId: "ERA-ORIGINAL"
    }
  });

  assert.equal(reversal.cumulativeClaimPaidAmount, 0);
  assert.equal(replacement.cumulativeClaimPaidAmount, 90);
  assert.deepEqual(
    tx._events.map((event) => [event.eventType, Number(event.amount)]),
    [["PAYMENT", 100], ["REVERSAL", -100], ["REPLACEMENT", 90]]
  );
});

test("#043 provider-level PLB adjustments stay batch-level and do not change claim cash", async () => {
  const tx = fakeTx();
  const result = await postEraFinancialEvents(tx, {
    organizationId: "org-1",
    claimId: "claim-1",
    result: {
      transactionId: "ERA-PLB",
      paidAmount: 100,
      providerAdjustments: [
        {
          reasonCode: "L6",
          reference: "PLB-INTEREST",
          amount: 5,
          description: "Interest"
        },
        {
          reasonCode: "WO",
          reference: "PLB-TAKEBACK",
          amount: -10,
          description: "Takeback"
        }
      ]
    }
  });

  assert.equal(result.cumulativeClaimPaidAmount, 100);
  const providerEvents = tx._events.filter(
    (event) => event.eventType === "PROVIDER_ADJUSTMENT"
  );
  assert.equal(providerEvents.length, 2);
  assert.ok(providerEvents.every((event) => event.claimId === null));
  assert.deepEqual(providerEvents.map((event) => Number(event.amount)), [5, -10]);
});

test("#044 financial event classification is explicit for reversal and replacement", () => {
  assert.equal(classifyRemittanceFinancialEvent({ paidAmount: -20 }), "REVERSAL");
  assert.equal(
    classifyRemittanceFinancialEvent({
      paidAmount: 20,
      replacesTransactionId: "ERA-OLD"
    }),
    "REPLACEMENT"
  );
  assert.equal(classifyRemittanceFinancialEvent({ paidAmount: 20 }), "PAYMENT");
});
