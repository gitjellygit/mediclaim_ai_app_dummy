import http from "node:http";

const port = Number(process.env.STEDI_MOCK_PORT || 4199);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("request too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      return json(res, 200, { ok: true });
    }

    const claimStatusPath =
      req.method === "POST" &&
      req.url === "/2024-04-01/change/medicalnetwork/claimstatus/v2";

    const expectedAuthorization = claimStatusPath
      ? "e2e-stedi-status-key"
      : "e2e-stedi-test-key";

    if (req.headers.authorization !== expectedAuthorization) {
      return json(res, 401, { message: "invalid test key" });
    }

    if (req.method === "GET" && req.url?.startsWith("/2024-04-01/payers/search")) {
      return json(res, 200, {
        items: [
          {
            stediId: "E2E-AETNA",
            primaryPayerId: "60054",
            displayName: "Aetna E2E",
            transactionSupport: { eligibilityCheck: "SUPPORTED" }
          },
          {
            stediId: "E2E-UHC",
            primaryPayerId: "87726",
            displayName: "UnitedHealthcare E2E",
            transactionSupport: { eligibilityCheck: "SUPPORTED" }
          }
        ]
      });
    }

    if (req.method === "GET" && req.url?.startsWith("/2024-04-01/payers")) {
      return json(res, 200, {
        items: [
          {
            stediId: "E2E-AETNA",
            primaryPayerId: "60054",
            displayName: "Aetna E2E",
            transactionSupport: { eligibilityCheck: "SUPPORTED" }
          }
        ]
      });
    }

    if (
      req.method === "POST" &&
      req.url === "/2024-04-01/change/medicalnetwork/claimstatus/v2"
    ) {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      if (
        !payload?.tradingPartnerServiceId ||
        !payload?.subscriber?.memberId ||
        !payload?.subscriber?.dateOfBirth ||
        !payload?.providers?.[0]?.npi ||
        !payload?.encounter?.beginningDateOfService
      ) {
        return json(res, 400, { message: "missing required mock 276 fields" });
      }

      return json(res, 200, {
        controlNumber: `status_e2e_${Date.now()}`,
        tradingPartnerServiceId: payload.tradingPartnerServiceId,
        claims: [
          {
            claimStatus: {
              amountPaid: "108.77",
              paidDate: "2026-10-06",
              effectiveDate: "2026-10-06",
              checkNumber: "E2E-CHECK-100",
              patientAccountNumber: "E2E-R3-PCN",
              statusCategoryCode: "F1",
              statusCategoryCodeValue:
                "Finalized/Payment - The claim/line has been paid.",
              statusCode: "65",
              statusCodeValue: "Claim/line has been paid.",
              submittedAmount: "250.00",
              tradingPartnerClaimNumber: "E2E-R3-PAYER-CLAIM"
            }
          }
        ],
        payer: {
          organizationName: "AETNA E2E",
          payerIdentification: payload.tradingPartnerServiceId
        },
        x12: "STC*F1:65*20261006**250.00*108.77~"
      });
    }

    if (req.method === "POST" && req.url === "/2026-06-01/eligibility-check") {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      if (!payload?.payerId || !payload?.subscriber?.memberId || !payload?.provider?.npi) {
        return json(res, 400, { message: "missing required mock eligibility fields" });
      }

      return json(res, 200, {
        id: `ec_e2e_${Date.now()}`,
        result: "ACTIVE",
        plans: [
          {
            benefits: {
              statuses: [
                {
                  status: "ACTIVE_COVERAGE",
                  service: { system: "STC", value: "30" }
                }
              ],
              deductible: [
                {
                  amount: "500",
                  service: { system: "STC", value: "30" }
                }
              ],
              coInsurance: [
                {
                  percent: "0.2",
                  service: { system: "STC", value: "30" }
                }
              ]
            }
          }
        ]
      });
    }

    return json(res, 404, { message: "mock route not found" });
  } catch (error) {
    return json(res, 500, { message: error?.message || "mock server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Stedi E2E mock listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
