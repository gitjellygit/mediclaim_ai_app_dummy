import { validMoney } from "../utils/money.js";
import { z } from "zod";
import { claimSubmissionSchema, claimUpdateSchema, emptyMutationSchema, parseMutation, serviceLineInputSchema } from "../validation/claimMutations.js";
import {
  drgSchema,
  firstZodMessage,
  icd10CmSchema,
  icd10PcsSchema,
  npiSchema,
  optional,
  taxonomySchema,
  tinSchema,
  typeOfBillSchema
} from "../validation/usClaimValidation.js";
import { assertClaimTransition } from "../services/workflowStateMachine.js";
import { parseClaimDate } from "../utils/claimDate.js";
import { serveStoredDocument } from "../services/documentResponse.js";
import { deleteStoredDocument } from "../services/documentDeletion.js";
import express from "express";
import { requirePermission, requireRoles } from "../middleware/auth.js";
import { PERMISSIONS } from "../security/permissions.js";
import { minimumNecessaryClaim } from "../security/phiView.js";
import { forbiddenClaimMutationFields } from "../security/claimMutationAccess.js";
import { prisma } from "../db.js";
import claimPayerSimulationRouter from "./claimPayerSimulation.js";
import claimJourneyRouter from "./claimJourney.js";
import { removeManuallyEditedFields } from "../services/claimDocumentProvenance.js";
import {
  buildAutomationSummary,
  changedFields,
  manualProvenance,
  mergeProvenance
} from "../services/claimFieldProvenance.js";
import {
  compareReadinessChecks,
  markReadinessChecksStale
} from "../services/readinessHistory.js";
import {
  buildClaimCompleteness,
  completenessReadinessIssues
} from "../services/claimCompleteness.js";
import { analyzeMedicalConsistency } from "../services/medicalConsistency.js";
import { buildApprovalIntelligenceItem } from "../services/approvalIntelligence.js";
import { configuredReadinessIssue } from "../services/configuredReadinessRules.js";
import { evaluateUsReadinessRules } from "../services/usReadinessRules.js";
import { evaluateConfiguredRules } from "../services/configurableRuleEngine.js";
import { rulesetFingerprint, rulesetFreshness } from "../services/ruleLifecycle.js";
import { buildClaimPatch, changedPatchFields, serviceLinesDiffer } from "../services/claimPatch.js";
import { assertClaimEditable, isClaimLocked } from "../services/claimLock.js";
import { updateClaimFromExpectedStatus } from "../services/claimStateCas.js";
import { deletePurgedClaimFiles, resolveClaimDocumentFiles } from "../services/claimPurge.js";
import { writeRequestAudit } from "../services/auditLog.js";
import {
  createPayerConnectorForClaim,
  payerConnectorStatusForClaim
} from "../services/payerGateway.js";
import {
  acquireSubmissionLock,
  completeSubmissionLock,
  isPrimaryClaim,
  releaseSubmissionLock,
  safeSubmissionClaim,
  submissionLockTimeoutMs
} from "../services/submissionSafety.js";

const router = express.Router();

function orgId(req) {
  return req.user.organizationId;
}

function normalizeServiceLines(lines = []) {
  const parsed = z.array(serviceLineInputSchema).max(500).safeParse(lines);
  if (!parsed.success) {
    return { ok: false, response: { error: "Invalid service line input", code: "INVALID_SERVICE_LINE" } };
  }

  const normalized = [];
  for (const line of parsed.data) {
    const charge =
      line.charge == null || line.charge === ""
        ? null
        : validMoney(line.charge);
    if (line.charge != null && line.charge !== "" && charge == null) {
      return {
        ok: false,
        response: {
          error: "Invalid service line charge",
          message: "Service line charge must have at most two decimal places",
          code: "INVALID_SERVICE_LINE_CHARGE"
        }
      };
    }

    const units =
      line.units == null || line.units === ""
        ? null
        : Number(line.units);
    if (units != null && (!Number.isFinite(units) || units <= 0)) {
      return {
        ok: false,
        response: {
          error: "Invalid service line units",
          message: "Service line units must be greater than 0",
          code: "INVALID_SERVICE_LINE_UNITS"
        }
      };
    }

    const serviceDateFrom = line.serviceDateFrom ? parseClaimDate(line.serviceDateFrom) : null;
    const serviceDateTo = line.serviceDateTo ? parseClaimDate(line.serviceDateTo) : null;
    if ((line.serviceDateFrom && !serviceDateFrom) || (line.serviceDateTo && !serviceDateTo)) {
      return {
        ok: false,
        response: {
          error: "Invalid service line date",
          code: "INVALID_SERVICE_LINE_DATE"
        }
      };
    }

    const source = line.source === "DOCUMENT_OCR" ? "DOCUMENT_OCR" : "USER";
    normalized.push({
      cptHcpcsCode: line.cptHcpcsCode,
      modifiers: line.modifiers || [],
      units,
      charge,
      diagnosisPointers: line.diagnosisPointers || [],
      placeOfService: line.placeOfService || null,
      serviceDateFrom,
      serviceDateTo,
      revenueCode: line.revenueCode || null,
      poaIndicator: line.poaIndicator || null,
      verified: source === "DOCUMENT_OCR" ? Boolean(line.verified) : true,
      source,
      sourceDocumentId:
        source === "DOCUMENT_OCR" ? (line.sourceDocumentId || null) : null
    });
  }

  return { ok: true, data: normalized };
}

async function auditClaim(req, { claimId, action, outcome = "SUCCESS", metadata = {} }) {
  return writeRequestAudit(prisma, req, {
    claimId,
    action,
    entityType: "Claim",
    entityId: claimId,
    outcome,
    metadata
  });
}


router.get("/", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  try {
    const requestedPage = Number(req.query.page || 1);
    const requestedPageSize = Number(req.query.pageSize || 50);
    const requestedSort = String(req.query.sort || "createdAt");
    const requestedDirection = String(req.query.direction || "desc").toLowerCase();
    const allowedSorts = new Set(["patientName", "payerName", "amount", "status", "createdAt"]);
    const sort = allowedSorts.has(requestedSort) ? requestedSort : "createdAt";
    const direction = requestedDirection === "asc" ? "asc" : "desc";
    const page = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1);
    const q = String(req.query.q || "").trim().slice(0, 100);
    const qAmount = Number(q);
    const hasQAmount = q !== "" && Number.isFinite(qAmount);
    const pageSize = Math.max(
      1,
      Math.min(Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : 50, 100)
    );
    const where = {
      organizationId: orgId(req),
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { patientName: { contains: q, mode: "insensitive" } },
              { payerName: { contains: q, mode: "insensitive" } },
              { policyNo: { contains: q, mode: "insensitive" } },
              { memberId: { contains: q, mode: "insensitive" } },
              { medicalRecordNumber: { contains: q, mode: "insensitive" } },
              { payerReferenceNo: { contains: q, mode: "insensitive" } },
              { groupNumber: { contains: q, mode: "insensitive" } },
              { subscriberId: { contains: q, mode: "insensitive" } },
              { payerEdiId: { contains: q, mode: "insensitive" } },
              { insurerClaimNo: { contains: q, mode: "insensitive" } },
              ...(hasQAmount ? [{ amount: qAmount }] : [])
            ]
          }
        : {})
    };
    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        select: {
          id: true,
          patientName: true,
          payerName: true,
          policyNo: true,
          memberId: true,
          medicalRecordNumber: true,
          payerReferenceNo: true,
          groupNumber: true,
          subscriberId: true,
          payerEdiId: true,
          status: true,
          amount: true,
          createdAt: true
        },
        orderBy: [{ [sort]: direction }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.claim.count({ where })
    ]);
    const items = claims.map((claim) => minimumNecessaryClaim(claim, req.user));

    await writeRequestAudit(prisma, req, {
      action: "CLAIM_LIST_VIEWED",
      entityType: "Claim",
      metadata: { count: items.length, page, pageSize, total, sort, direction, searched: Boolean(q) }
    });

    res.setHeader("X-Total-Count", String(total));
    res.setHeader("X-Page", String(page));
    res.setHeader("X-Page-Size", String(pageSize));
    if (String(req.query.paginated || "") === "1") {
      return res.json({ items, page, pageSize, total });
    }
    res.json(items);
  } catch (error) {
    console.error("Error fetching claims:", error);
    res.status(500).json({ error: "Unable to load claims", code: "CLAIM_LIST_FAILED" });
  }
});

/**
 * Claim Journey endpoints
 *
 * Eligibility and prior-auth actions are deterministic local pre-checks / recorded
 * workflow decisions. They do not claim to be live payer responses. A payer/clearinghouse
 * connector can replace these calls later without changing the UI workflow.
 */
/**
 * Server-side claim search for production-scale selectors.
 * Empty query returns recent claims; non-empty query searches common operational identifiers.
 * Results are intentionally capped so the browser never needs to load the full claim table.
 */
router.get("/search", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 20);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 20, 50));

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } },
            { medicalRecordNumber: { contains: q, mode: "insensitive" } },
            { payerReferenceNo: { contains: q, mode: "insensitive" } },
            { groupNumber: { contains: q, mode: "insensitive" } },
            { subscriberId: { contains: q, mode: "insensitive" } },
            { payerEdiId: { contains: q, mode: "insensitive" } },
            { insurerClaimNo: { contains: q, mode: "insensitive" } },
            { authorizationNo: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      select: {
        id: true,
        patientName: true,
        payerName: true,
        policyNo: true,
        memberId: true,
        medicalRecordNumber: true,
        payerReferenceNo: true,
        groupNumber: true,
        subscriberId: true,
        payerEdiId: true,
        insurerClaimNo: true,
        authorizationNo: true,
        status: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    await writeRequestAudit(prisma, req, {
      action: q ? "CLAIM_SEARCHED" : "RECENT_CLAIMS_VIEWED",
      entityType: "Claim",
      metadata: { count: claims.length }
    });

    res.json({
      items: claims.map((claim) => minimumNecessaryClaim(claim, req.user)),
      query: q,
      limit,
      recent: !q
    });
  } catch (error) {
    console.error("[claim-search] failed", {
      message: error.message
    });
    res.status(500).json({
      error: "Unable to search claims"
    });
  }
});

router.use(claimPayerSimulationRouter);
router.use(claimJourneyRouter);

router.get("/medical-consistency/summary", requirePermission(PERMISSIONS.CLINICAL_VIEW), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 100)
    );

    const where = q
      ? {
          organizationId: orgId(req),
          deletedAt: null,
          OR: [
            { id: { equals: q } },
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } }
          ]
        }
      : { organizationId: orgId(req), deletedAt: null };

    const claims = await prisma.claim.findMany({
      where,
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit
    });

    const items = claims.map((claim) => ({
      claim: {
        id: claim.id,
        patientName: claim.patientName,
        payerName: claim.payerName,
        policyNo: claim.policyNo,
        status: claim.status,
        diagnosisText: claim.diagnosisText,
        icd10Codes: claim.icd10Codes,
        admissionDate: claim.admissionDate,
        dischargeDate: claim.dischargeDate,
        dateOfService: claim.dateOfService,
        roomCategory: claim.roomCategory,
        icuDays: claim.icuDays
      },
      analysis: analyzeMedicalConsistency(claim)
    }));

    const metrics = {
      total: items.length,
      consistent: items.filter((item) => item.analysis.status === "CONSISTENT").length,
      needsReview: items.filter((item) => item.analysis.status === "NEEDS_REVIEW").length,
      blocked: items.filter((item) => item.analysis.status === "BLOCKED").length,
      averageScore:
        items.length > 0
          ? Math.round(
              items.reduce((sum, item) => sum + item.analysis.score, 0) /
                items.length
            )
          : 0
    };

    await writeRequestAudit(prisma, req, {
      action: "MEDICAL_CONSISTENCY_VIEWED",
      entityType: "Claim",
      metadata: { count: items.length }
    });
    res.json({ items, metrics, query: q, limit });
  } catch (error) {
    console.error("[medical-consistency] summary failed", {
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to load medical consistency analysis"
    });
  }
});

router.get("/:id/medical-consistency", requirePermission(PERMISSIONS.CLINICAL_VIEW), async (req, res) => {
  try {
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    res.json({
      claim: minimumNecessaryClaim(claim, req.user),
      analysis: analyzeMedicalConsistency(claim)
    });
  } catch (error) {
    console.error("[medical-consistency] claim analysis failed", {
      claimId: req.params.id,
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({
      error: "Unable to analyze medical consistency"
    });
  }
});

router.get(
  "/approval-intelligence",
  requirePermission(PERMISSIONS.CLINICAL_VIEW),
  requirePermission(PERMISSIONS.FINANCIAL_VIEW),
  async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
      const pageSize = Math.min(
        100,
        Math.max(10, Number.parseInt(String(req.query.pageSize || "25"), 10) || 25)
      );
      const q = String(req.query.q || "").trim().slice(0, 100);
      const requestedStatus = String(req.query.status || "ALL").toUpperCase();
      const requestedWork = String(req.query.work || "ALL").toUpperCase();
      const requestedFiling = String(req.query.filing || "ALL").toUpperCase();
      const requestedSort = String(req.query.sort || "priority").trim();
      const requestedDirection = String(req.query.direction || "asc").toLowerCase();
      const allowedSorts = new Set([
        "priority",
        "patient",
        "formStatus",
        "timelyFiling",
        "eligibility",
        "priorAuth",
        "coding",
        "readiness",
        "risk",
        "payment"
      ]);
      const sort = allowedSorts.has(requestedSort) ? requestedSort : "priority";
      const direction = requestedDirection === "desc" ? "desc" : "asc";
      const allowedStatuses = new Set([
        "DRAFT",
        "NEEDS_REVIEW",
        "READY",
        "SUBMITTING",
        "SUBMITTED",
        "DENIED",
        "PAID"
      ]);
      const allowedWork = new Set([
        "NEEDS_ACTION",
        "READY",
        "ELIGIBILITY",
        "PRIOR_AUTH"
      ]);
      const allowedFiling = new Set(["EXPIRED", "DUE_7", "DUE_30"]);
      const status = allowedStatuses.has(requestedStatus) ? requestedStatus : null;
      const work = allowedWork.has(requestedWork) ? requestedWork : null;
      const filing = allowedFiling.has(requestedFiling) ? requestedFiling : null;

      const now = new Date();
      const filingRiskCutoff = new Date(now);
      filingRiskCutoff.setUTCDate(filingRiskCutoff.getUTCDate() + 14);
      const filing7 = new Date(now);
      filing7.setUTCDate(filing7.getUTCDate() + 7);
      const filing30 = new Date(now);
      filing30.setUTCDate(filing30.getUTCDate() + 30);
      const staleSubmissionCutoff = new Date(
        now.getTime() - submissionLockTimeoutMs()
      );

      const filters = [];

      if (status) filters.push({ status });

      if (work === "NEEDS_ACTION") {
        filters.push({ status: { in: ["DRAFT", "NEEDS_REVIEW"] } });
      } else if (work === "READY") {
        filters.push({ status: "READY" });
      } else if (work === "ELIGIBILITY") {
        filters.push({
          status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
          NOT: { eligibilityStatus: "VERIFIED" }
        });
      } else if (work === "PRIOR_AUTH") {
        filters.push({
          status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
          OR: [
            { priorAuthStatus: { notIn: ["APPROVED", "NOT_REQUIRED"] } },
            { priorAuthExpiry: { lt: now } }
          ]
        });
      }

      if (filing === "EXPIRED") {
        filters.push({
          status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
          timelyFilingDeadline: { lt: now }
        });
      } else if (filing === "DUE_7") {
        filters.push({
          status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
          timelyFilingDeadline: { gte: now, lte: filing7 }
        });
      } else if (filing === "DUE_30") {
        filters.push({
          status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
          timelyFilingDeadline: { gte: now, lte: filing30 }
        });
      }

      if (q) {
        filters.push({
          OR: [
            { patientName: { contains: q, mode: "insensitive" } },
            { payerName: { contains: q, mode: "insensitive" } },
            { policyNo: { contains: q, mode: "insensitive" } },
            { memberId: { contains: q, mode: "insensitive" } },
            { insurerClaimNo: { contains: q, mode: "insensitive" } },
            { authorizationNo: { contains: q, mode: "insensitive" } }
          ]
        });
      }

      const where = {
        organizationId: orgId(req),
        deletedAt: null,
        ...(filters.length ? { AND: filters } : {})
      };

      const [
        total,
        claims,
        organizationTotal,
        needsReview,
        readyToSubmit,
        submitting,
        submitted,
        staleSubmitting,
        filingRisk,
        totalClaimed,
        readyAmount
      ] = await Promise.all([
        prisma.claim.count({ where }),
        prisma.claim.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          include: {
            documents: { select: { id: true } },
            serviceLines: {
              select: { id: true, verified: true, cptHcpcsCode: true }
            },
            codingSuggestions: {
              where: { status: "PENDING" },
              select: { id: true }
            },
            checks: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                createdAt: true,
                score: true,
                issues: true,
                isStale: true,
                staleReason: true,
                riskScore: true,
                riskLevel: true,
                riskFactors: true
              }
            }
          }
        }),
        prisma.claim.count({
          where: { organizationId: orgId(req), deletedAt: null }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: { in: ["DRAFT", "NEEDS_REVIEW"] }
          }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: "READY"
          }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: "SUBMITTING"
          }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: { in: ["SUBMITTING", "SUBMITTED", "DENIED", "PAID"] }
          }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: "SUBMITTING",
            submissionStartedAt: { lte: staleSubmissionCutoff }
          }
        }),
        prisma.claim.count({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: { in: ["DRAFT", "NEEDS_REVIEW", "READY"] },
            timelyFilingDeadline: { lte: filingRiskCutoff }
          }
        }),
        prisma.claim.aggregate({
          where: { organizationId: orgId(req), deletedAt: null },
          _sum: { amount: true }
        }),
        prisma.claim.aggregate({
          where: {
            organizationId: orgId(req),
            deletedAt: null,
            status: "READY"
          },
          _sum: { amount: true }
        })
      ]);

      const allItems = claims.map((claim) =>
        buildApprovalIntelligenceItem(claim, { now })
      );

      const priorityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      const statusRank = {
        DRAFT: 1,
        NEEDS_REVIEW: 2,
        READY: 3,
        SUBMITTING: 4,
        SUBMITTED: 5,
        DENIED: 6,
        PAID: 7
      };
      const eligibilityRank = {
        FAILED: 4,
        NEEDS_REVIEW: 3,
        NOT_CHECKED: 2,
        VERIFIED: 1
      };
      const priorAuthRank = {
        DENIED: 5,
        REQUIRED: 4,
        NEEDS_REVIEW: 3,
        NOT_CHECKED: 2,
        APPROVED: 1,
        NOT_REQUIRED: 0
      };

      const sortValue = (item) => {
        switch (sort) {
          case "patient":
            return String(item.patientName || "").toLowerCase();
          case "formStatus":
            return `${String(item.claimForm || "")}:${statusRank[item.status] || 0}`;
          case "timelyFiling":
            return item.timelyFiling?.daysRemaining == null
              ? Number.POSITIVE_INFINITY
              : Number(item.timelyFiling.daysRemaining);
          case "eligibility":
            return eligibilityRank[item.eligibility?.status] || 0;
          case "priorAuth":
            return priorAuthRank[item.priorAuthorization?.status] || 0;
          case "coding":
            return Number(item.coding?.pendingSuggestions || 0) * 1000 -
              Number(item.coding?.verifiedServiceLines || 0);
          case "readiness":
            return item.readiness?.score == null ? -1 : Number(item.readiness.score);
          case "risk":
            return item.submissionRisk?.score == null ? -1 : Number(item.submissionRisk.score);
          case "payment":
            return item.paymentOutlook?.amount == null ? -1 : Number(item.paymentOutlook.amount);
          case "priority":
          default:
            return priorityRank[item.priority] || 0;
        }
      };

      const compareValues = (left, right) => {
        const a = sortValue(left);
        const b = sortValue(right);
        let result = 0;
        if (typeof a === "string" || typeof b === "string") {
          result = String(a).localeCompare(String(b));
        } else {
          result = Number(a) - Number(b);
        }
        if (result === 0) {
          result = new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
        }
        return direction === "desc" ? -result : result;
      };

      allItems.sort(compareValues);
      const items = allItems.slice((page - 1) * pageSize, page * pageSize);

      await writeRequestAudit(prisma, req, {
        action: "APPROVAL_INTELLIGENCE_VIEWED",
        entityType: "Claim",
        metadata: {
          page,
          pageSize,
          resultCount: items.length,
          filteredTotal: total,
          status: status || "ALL",
          work: work || "ALL",
          filing: filing || "ALL",
          sort,
          direction
        }
      });

      res.json({
        items,
        page,
        pageSize,
        total,
        sort,
        direction,
        metrics: {
          totalClaims: organizationTotal,
          needsReview,
          readyToSubmit,
          submitting,
          submitted,
          staleSubmitting,
          filingRisk,
          totalClaimed: Number(totalClaimed._sum.amount || 0),
          readyAmount: Number(readyAmount._sum.amount || 0)
        },
        submissionAlert:
          staleSubmitting > 0
            ? {
                severity: "warning",
                count: staleSubmitting,
                message:
                  "One or more claims have been SUBMITTING longer than the submission lock timeout and require admin reconciliation."
              }
            : null,
        methodology: {
          readinessThreshold: 80,
          submissionRisk:
            "Rules-based pre-submission signal from current readiness evidence; not a payer approval probability.",
          filingRiskWindowDays: 14,
          paymentOutlook:
            "Recorded payer-approved amount when available; otherwise an estimate from current claim financials without payer contract modeling."
        }
      });
    } catch (error) {
      console.error("[approval-intelligence] failed", {
        name: error?.name || "Error",
        code: error?.code || null
      });
      res.status(500).json({
        error: "Unable to load approval intelligence"
      });
    }
  }
);

router.get("/:id/audit", requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
  const claim = await prisma.claim.findFirst({
    where: {
      id: req.params.id,
      organizationId: orgId(req),
      deletedAt: null
    },
    select: { id: true }
  });

  if (!claim) {
    return res.status(404).json({ error: "Claim not found" });
  }

  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId: orgId(req),
      claimId: claim.id
    },
    select: {
      id: true,
      createdAt: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      outcome: true,
      metadata: true
    },
    orderBy: { createdAt: "desc" },
    take: 250
  });

  res.json({ items: events });
});

router.get("/:id", requirePermission(PERMISSIONS.CLAIM_VIEW), async (req, res) => {
  const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
    include: {
      documents: true,
      serviceLines: { orderBy: { createdAt: "asc" } },
      codingSuggestions: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      checks: { orderBy: { createdAt: "desc" } }
    }
  });

  if (!claim) {
    await writeRequestAudit(prisma, req, {
      claimId: req.params.id,
      action: "CLAIM_VIEW_DENIED",
      entityType: "Claim",
      entityId: req.params.id,
      outcome: "DENIED"
    });
    return res.status(404).json({ error: "Claim not found" });
  }

  await auditClaim(req, {
    claimId: claim.id,
    action: "CLAIM_VIEWED"
  });

  const checks = (claim.checks || []).map((check, index, all) => ({
    ...check,
    comparison: compareReadinessChecks(check, all[index + 1] || null)
  }));

  res.json(
    minimumNecessaryClaim(
      {
        ...claim,
        checks,
        automationSummary: buildAutomationSummary(claim),
        completenessSummary: buildClaimCompleteness(claim)
      },
      req.user
    )
  );
});

router.post("/", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  try {
    const forbiddenFields = forbiddenClaimMutationFields(req.user, req.body);
    if (forbiddenFields.length > 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have permission to set one or more clinical or financial claim fields.",
        code: "PHI_FIELD_EDIT_DENIED",
        fields: forbiddenFields
      });
    }
    if (!req.body.patientName || !req.body.payerName) {
      return res.status(400).json({
        error: "patientName and payerName are required"
      });
    }

    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a valid number greater than 0"
      });
    }

    // Explicit input allowlist: never accept caller-supplied lifecycle, payer,
    // monetary-adjudication, provenance, relationship IDs or audit fields.
    const claimCreateSchema = z.object({
      patientName: z.string().trim().min(1).max(250),
      payerName: z.string().trim().min(1).max(250),
      amount: z.coerce.number().positive().finite(),
      totalBilledAmount: z.coerce.number().positive().finite().nullish(),
      policyNo: z.string().trim().max(100).nullish(),
      memberId: z.string().trim().max(100).nullish(),
      medicalRecordNumber: z.string().trim().max(100).nullish(),
      planAdministratorName: z.string().trim().max(250).nullish(),
      groupNumber: z.string().trim().max(100).nullish(),
      subscriberId: z.string().trim().max(100).nullish(),
      subscriberName: z.string().trim().max(250).nullish(),
      subscriberDob: z.string().nullish(),
      subscriberGender: z.enum(["MALE", "FEMALE", "OTHER"]).nullish(),
      subscriberAddress1: z.string().trim().max(100).nullish(),
      subscriberAddress2: z.string().trim().max(100).nullish(),
      subscriberCity: z.string().trim().max(100).nullish(),
      subscriberState: z.string().trim().max(2).nullish(),
      subscriberPostalCode: z.string().trim().max(12).nullish(),
      subscriberRelationship: z.enum(["SELF", "SPOUSE", "CHILD", "OTHER"]).nullish(),
      coordinationOfBenefits: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]).nullish(),
      payerEdiId: z.string().trim().max(100).nullish(),
      coverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      remainingCoverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      payerReferenceNo: z.string().trim().max(100).nullish(),
      patientDob: z.string().nullish(),
      patientGender: z.enum(["MALE", "FEMALE", "OTHER"]).nullish(),
      patientAddress1: z.string().trim().max(100).nullish(),
      patientAddress2: z.string().trim().max(100).nullish(),
      patientCity: z.string().trim().max(100).nullish(),
      patientState: z.string().trim().max(2).nullish(),
      patientPostalCode: z.string().trim().max(12).nullish(),
      hospitalName: z.string().trim().max(250).nullish(),
      doctorName: z.string().trim().max(250).nullish(),
      billingProviderNpi: optional(npiSchema),
      renderingProviderNpi: optional(npiSchema),
      referringProviderNpi: optional(npiSchema),
      providerTin: optional(tinSchema),
      providerTaxonomyCode: optional(taxonomySchema),
      diagnosisText: z.string().max(6000).nullish(),
      icd10Codes: z.array(icd10CmSchema).max(100).optional(),
      inpatientProcedureCodes: z.array(icd10PcsSchema).max(100).optional(),
      procedureText: z.string().max(6000).nullish(),
      dateOfService: z.string().nullish(),
      admissionDate: z.string().nullish(),
      dischargeDate: z.string().nullish(),
      procedureDate: z.string().nullish(),
      admissionType: z.enum(["PLANNED", "EMERGENCY"]).nullish(),
      roomCategory: z.enum(["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU"]).nullish(),
      icuDays: z.coerce.number().int().nonnegative().nullish(),
      typeOfBill: optional(typeOfBillSchema),
      drgCode: optional(drgSchema),
      claimFilingCode: z.string().trim().min(1).max(2).nullish(),
      admissionTypeCode: z.string().trim().min(1).max(1).nullish(),
      admissionSourceCode: z.string().trim().min(1).max(2).nullish(),
      patientStatusCode: z.string().trim().min(1).max(2).nullish(),
      claimFrequencyCode: z.enum([
    "ORIGINAL",
    "INTERIM_FIRST",
    "INTERIM_CONTINUING",
    "INTERIM_LAST",
    "CORRECTED",
    "VOID",
    "FINAL_HOME_HEALTH"
  ]).optional(),
      timelyFilingDeadline: z.string().nullish(),
      serviceLines: z.array(serviceLineInputSchema).max(500).optional(),
      claimType: z.enum(["PROVIDER_BILLED", "MEMBER_REIMBURSEMENT"]).optional(),
      claimForm: z.enum(["PROFESSIONAL", "INSTITUTIONAL"]).nullish()
    }).strict();
    const parsed = claimCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues?.[0];
      return res.status(400).json({
        error: "Invalid claim input",
        message: firstZodMessage(parsed.error, "Some claim information is invalid"),
        field: firstIssue?.path?.length ? firstIssue.path.join(".") : null,
        code: "INVALID_CLAIM_INPUT"
      });
    }
    const { serviceLines: rawServiceLines = [], ...claimInput } = parsed.data;
    const normalizedServiceLines = normalizeServiceLines(rawServiceLines);
    if (!normalizedServiceLines.ok) {
      return res.status(400).json(normalizedServiceLines.response);
    }

    const frequencyDigit = { ORIGINAL: "1", CORRECTED: "7", VOID: "8" };
    if (claimInput.typeOfBill && claimInput.claimFrequencyCode) {
      const expected = frequencyDigit[claimInput.claimFrequencyCode];
      if (expected && claimInput.typeOfBill.slice(-1) !== expected) {
        return res.status(400).json({
          error: "Invalid Type of Bill",
          message: `Type of Bill must end in ${expected} for ${claimInput.claimFrequencyCode.toLowerCase()} claims`,
          code: "INVALID_TYPE_OF_BILL"
        });
      }
    }

    if (claimInput.claimForm === "PROFESSIONAL") {
      if ((claimInput.inpatientProcedureCodes || []).length > 0) {
        return res.status(400).json({
          error: "Invalid professional claim procedure coding",
          message: "ICD-10-PCS is for inpatient institutional claims and cannot be used on an 837P claim",
          code: "INVALID_PROFESSIONAL_CLAIM"
        });
      }
    }

    // Draft claims may be incomplete. Missing NPI/POS/Type-of-Bill/Revenue Code
    // remain readiness blockers; values that are supplied are still format-validated.

    const diagnosisSet = new Set(claimInput.icd10Codes || []);
    const invalidDiagnosisLink = normalizedServiceLines.data.find((line) =>
      (line.diagnosisPointers || []).some((code) => !diagnosisSet.has(code))
    );
    if (invalidDiagnosisLink) {
      return res.status(400).json({
        error: "Invalid service-line diagnosis link",
        message: "Service-line diagnosis codes must match ICD-10-CM diagnoses already entered on the claim",
        code: "INVALID_DIAGNOSIS_LINK"
      });
    }

    const createPayload = {
      ...claimInput,
      status: "DRAFT"
    };
    for (const key of ["amount", "totalBilledAmount", "coverageLimit", "remainingCoverageLimit"]) {
      if (createPayload[key] == null) continue;
      const canonical = validMoney(createPayload[key]);
      if (canonical == null) {
        return res.status(400).json({
          error: "Invalid money",
          message: `${key} must have at most two decimal places`,
          code: "INVALID_MONEY"
        });
      }
      createPayload[key] = canonical;
    }
    for (const field of ["patientDob", "subscriberDob", "dateOfService", "admissionDate", "dischargeDate", "procedureDate", "timelyFilingDeadline"]) {
      if (!createPayload[field]) continue;
      const parsedDate = parseClaimDate(createPayload[field]);
      if (!parsedDate) {
        return res.status(400).json({
          error: "Invalid date",
          message: `Invalid value for ${field}`,
          code: "INVALID_DATE"
        });
      }
      createPayload[field] = parsedDate;
    }

    const manuallyEnteredFields = Object.keys(createPayload).filter(
      (field) => !["status", "createdAt", "id"].includes(field)
    );

    const claim = await prisma.claim.create({
      data: {
        ...createPayload,
        organizationId: orgId(req),
        createdById: req.user.id,
        fieldProvenance: manualProvenance(
          manuallyEnteredFields,
          "Entered at Claim Creation"
        ),
        serviceLines: normalizedServiceLines.data.length
          ? { create: normalizedServiceLines.data }
          : undefined
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_CREATED",
      metadata: { status: claim.status }
    });

    const createdClaim = await prisma.claim.findUnique({
      where: { id: claim.id },
      include: { serviceLines: { orderBy: { createdAt: "asc" } } }
    });

    res.json(minimumNecessaryClaim(createdClaim, req.user));
  } catch (e) {
    console.error("[claim-create] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to create claim", code: "CLAIM_CREATE_FAILED" });
  }
});

router.patch("/:id", requirePermission(PERMISSIONS.CLAIM_EDIT), async (req, res) => {
  try {
    const forbiddenFields = forbiddenClaimMutationFields(req.user, req.body);
    if (forbiddenFields.length > 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have permission to change one or more clinical or financial claim fields.",
        code: "PHI_FIELD_EDIT_DENIED",
        fields: forbiddenFields
      });
    }
    const parsedInput = parseMutation(claimUpdateSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const input = parsedInput.data;

    const existing = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        serviceLines: { orderBy: { createdAt: "asc" } }
      }
    });

    if (!existing) {
      return res.status(404).json({ error: "Claim not found" });
    }

    assertClaimEditable(
      existing,
      "Submitted or finalized claims are locked. Reopen or amend the claim before editing."
    );

    const payload = buildClaimPatch(input);

    const effectivePatientName =
      Object.prototype.hasOwnProperty.call(payload, "patientName")
        ? payload.patientName
        : existing.patientName;
    const effectivePayerName =
      Object.prototype.hasOwnProperty.call(payload, "payerName")
        ? payload.payerName
        : existing.payerName;

    if (!effectivePatientName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!effectivePayerName) {
      return res.status(400).json({ error: "Insurance company is required" });
    }

    if (
      Object.prototype.hasOwnProperty.call(input, "patientDob") &&
      input.patientDob &&
      !payload.patientDob
    ) {
      return res.status(400).json({ error: "Patient date of birth is invalid" });
    }
    if (
      Object.prototype.hasOwnProperty.call(input, "subscriberDob") &&
      input.subscriberDob &&
      !payload.subscriberDob
    ) {
      return res.status(400).json({ error: "Subscriber date of birth is invalid" });
    }

    for (const [label, field] of [
      ["Timely filing deadline", "timelyFilingDeadline"],
      ["Date of service", "dateOfService"],
      ["Admission date", "admissionDate"],
      ["Discharge date", "dischargeDate"],
      ["Procedure date", "procedureDate"]
    ]) {
      if (
        Object.prototype.hasOwnProperty.call(input, field) &&
        input[field] &&
        !payload[field]
      ) {
        return res.status(400).json({ error: `${label} is invalid` });
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "icuDays") &&
      payload.icuDays != null &&
      (!Number.isFinite(payload.icuDays) || payload.icuDays < 0)
    ) {
      return res.status(400).json({
        error: "ICU days must be zero or a positive number"
      });
    }

    if (
      Object.prototype.hasOwnProperty.call(payload, "amount") &&
      payload.amount != null &&
      (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0)
    ) {
      return res.status(400).json({
        error: "Claimed amount must be a valid number greater than 0"
      });
    }

    for (const name of ["amount", "totalBilledAmount", "coverageLimit", "remainingCoverageLimit"]) {
      if (!Object.prototype.hasOwnProperty.call(input, name)) continue;
      const supplied = input[name];
      if (supplied != null && supplied !== "" && validMoney(supplied) == null) {
        return res.status(400).json({
          error: "Invalid money",
          message: `${name} must have at most two decimal places`,
          code: "INVALID_MONEY"
        });
      }
    }

    const normalizedServiceLines =
      input.serviceLines === undefined ? null : normalizeServiceLines(input.serviceLines);
    if (normalizedServiceLines && !normalizedServiceLines.ok) {
      return res.status(400).json(normalizedServiceLines.response);
    }

    const effectiveClaimForm =
      Object.prototype.hasOwnProperty.call(input, "claimForm") ? input.claimForm : existing.claimForm;
    const effectiveDiagnosisCodes =
      Object.prototype.hasOwnProperty.call(input, "icd10Codes") ? (input.icd10Codes || []) : (existing.icd10Codes || []);
    const effectivePcsCodes =
      Object.prototype.hasOwnProperty.call(input, "inpatientProcedureCodes")
        ? (input.inpatientProcedureCodes || [])
        : (existing.inpatientProcedureCodes || []);
    const effectiveTypeOfBill =
      Object.prototype.hasOwnProperty.call(input, "typeOfBill") ? input.typeOfBill : existing.typeOfBill;
    const effectiveFrequency =
      Object.prototype.hasOwnProperty.call(input, "claimFrequencyCode")
        ? input.claimFrequencyCode
        : existing.claimFrequencyCode;

    if (effectiveClaimForm === "PROFESSIONAL" && effectivePcsCodes.length > 0) {
      return res.status(400).json({
        error: "Invalid professional claim procedure coding",
        message: "ICD-10-PCS is for inpatient institutional claims and cannot be used on an 837P claim",
        code: "INVALID_PROFESSIONAL_CLAIM"
      });
    }

    if (effectiveTypeOfBill && effectiveFrequency) {
      const expected = { ORIGINAL: "1", CORRECTED: "7", VOID: "8" }[effectiveFrequency];
      if (expected && effectiveTypeOfBill.slice(-1) !== expected) {
        return res.status(400).json({
          error: "Invalid Type of Bill",
          message: `Type of Bill must end in ${expected} for ${String(effectiveFrequency).toLowerCase()} claims`,
          code: "INVALID_TYPE_OF_BILL"
        });
      }
    }

    const effectiveServiceLines = normalizedServiceLines
      ? normalizedServiceLines.data
      : (existing.serviceLines || []);
    const diagnosisSet = new Set(effectiveDiagnosisCodes);
    if (
      effectiveServiceLines.some((line) =>
        (line.diagnosisPointers || []).some((code) => !diagnosisSet.has(code))
      )
    ) {
      return res.status(400).json({
        error: "Invalid service-line diagnosis link",
        message: "Service-line diagnosis codes must match ICD-10-CM diagnoses already entered on the claim",
        code: "INVALID_DIAGNOSIS_LINK"
      });
    }
    // Missing submission-required fields are handled by readiness so drafts
    // can be saved and corrected incrementally.

    const patchChangedFields = changedPatchFields(existing, payload);
    const serviceLinesChanged = normalizedServiceLines
      ? serviceLinesDiffer(existing.serviceLines || [], normalizedServiceLines.data)
      : false;
    const anyClaimDataChanged =
      patchChangedFields.length > 0 || serviceLinesChanged;

    const payerIdentityFields = new Set([
      "payerName",
      "payerEdiId",
      "memberId",
      "patientDob",
      "policyNo",
      "groupNumber",
      "subscriberId",
      "subscriberName",
      "subscriberDob",
      "subscriberRelationship",
      "coordinationOfBenefits"
    ]);
    const payerIdentityChanged = patchChangedFields.some((field) =>
      payerIdentityFields.has(field)
    );

    const manuallyChangedFields = changedFields(existing, payload);
    const documentDerivedFields = removeManuallyEditedFields(
      existing.documentDerivedFields,
      Object.fromEntries(
        manuallyChangedFields.map((field) => [field, payload[field]])
      )
    );
    const fieldProvenance = mergeProvenance(
      existing.fieldProvenance,
      manualProvenance(manuallyChangedFields)
    );

    const nextStatus = anyClaimDataChanged
      ? assertClaimTransition(existing.status, "DRAFT")
      : existing.status;

    if (anyClaimDataChanged) {
      await prisma.$transaction(async (tx) => {
        if (patchChangedFields.length > 0) {
          await updateClaimFromExpectedStatus(
            tx,
            req.params.id,
            existing.status,
            {
              ...payload,
              ...(payerIdentityChanged
                ? {
                    eligibilityStatus: "NOT_CHECKED",
                    eligibilityCheckedAt: null,
                    coverageStatus: null,
                    networkStatus: null,
                    deductibleRemaining: null,
                    coinsurancePct: null,
                    priorAuthRequired: null,
                    priorAuthStatus: "NOT_CHECKED",
                    priorAuthCheckedAt: null,
                    authorizationNo: null,
                    priorAuthExpiry: null
                  }
                : {}),
              documentDerivedFields,
              fieldProvenance,
              status: nextStatus
            },
            {
              organizationId: orgId(req),
              message: "Claim entered submission while this edit was being saved. Refresh before editing."
            }
          );
        } else if (serviceLinesChanged && existing.status !== nextStatus) {
          await updateClaimFromExpectedStatus(
            tx,
            req.params.id,
            existing.status,
            { status: nextStatus },
            {
              organizationId: orgId(req),
              message: "Claim entered submission while service-line changes were being saved. Refresh before editing."
            }
          );
        }

        if (serviceLinesChanged) {
          await tx.serviceLine.deleteMany({ where: { claimId: req.params.id } });
          if (normalizedServiceLines.data.length > 0) {
            await tx.serviceLine.createMany({
              data: normalizedServiceLines.data.map((line) => ({
                ...line,
                claimId: req.params.id
              }))
            });
          }
        }
      });

      await markReadinessChecksStale(
        prisma,
        req.params.id,
        payerIdentityChanged
          ? "Payer/member information changed; eligibility and prior authorization must be rechecked"
          : serviceLinesChanged && patchChangedFields.length === 0
          ? "Claim service lines changed"
          : "Claim details changed"
      );
    }

    const updated = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: true,
        serviceLines: { orderBy: { createdAt: "asc" } },
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    if (anyClaimDataChanged) {
      await auditClaim(req, {
        claimId: updated.id,
        action: "CLAIM_UPDATED",
        metadata: {
          changedFields: patchChangedFields,
          serviceLinesChanged
        }
      });
    }

    res.json(
      minimumNecessaryClaim(
        {
          ...updated,
          unchanged: !anyClaimDataChanged,
          automationSummary: buildAutomationSummary(updated),
          completenessSummary: buildClaimCompleteness(updated)
        },
        req.user
      )
    );
  } catch (e) {
    if (e?.status) throw e;
    console.error("[claim-edit] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to update claim", code: "CLAIM_UPDATE_FAILED" });
  }
});

router.delete("/:id/purge", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    const id = req.params.id;
    const claim = await prisma.claim.findFirst({
      where: {
        id,
        organizationId: orgId(req),
        deletedAt: { not: null }
      },
      include: {
        documents: {
          select: { id: true, path: true }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({
        error: "Deleted claim not found",
        message: "Only an already soft-deleted claim can be permanently purged."
      });
    }

    const files = resolveClaimDocumentFiles(claim.documents);

    await prisma.$transaction(async (tx) => {
      await tx.auditEvent.create({
        data: {
          organizationId: orgId(req),
          claimId: claim.id,
          actorUserId: req.user?.id || null,
          action: "CLAIM_PERMANENTLY_PURGED",
          entityType: "Claim",
          entityId: claim.id,
          outcome: "SUCCESS",
          metadata: {
            previousStatus: claim.status,
            softDeleted: true,
            documentCount: claim.documents.length
          }
        }
      });

      await tx.claim.delete({ where: { id: claim.id } });
    });

    const fileCleanup = await deletePurgedClaimFiles(files);
    if (fileCleanup.failures.length > 0) {
      console.error("[claim-purge] file cleanup incomplete", {
        claimId: id,
        failures: fileCleanup.failures
      });
    }

    res.json({
      success: true,
      permanentlyPurged: true,
      deletedFiles: fileCleanup.deleted,
      fileCleanupWarnings: fileCleanup.failures.length
    });
  } catch (error) {
    console.error("[claim-purge] failed", {
      claimId: req.params.id,
      name: error?.name || "Error",
      code: error?.code || null
    });
    res.status(500).json({ error: "Unable to permanently purge claim" });
  }
});

router.delete("/:id", requirePermission(PERMISSIONS.CLAIM_DELETE), async (req, res) => {
  try {
    const id = req.params.id;

    const claim = await prisma.claim.findFirst({ where: { id, organizationId: orgId(req), deletedAt: null } });
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (isClaimLocked(claim)) {
      return res.status(409).json({
        error: "Submitted or finalized claims are locked and cannot be deleted."
      });
    }

    await updateClaimFromExpectedStatus(
      prisma,
      id,
      claim.status,
      { deletedAt: new Date() },
      {
        organizationId: orgId(req),
        message: "Claim entered submission while deletion was being requested. Refresh before retrying."
      }
    );

    await auditClaim(req, {
      claimId: id,
      action: "CLAIM_SOFT_DELETED",
      metadata: { previousStatus: claim.status }
    });

    res.json({ success: true, softDeleted: true });
  } catch (error) {
    if (error?.status) throw error;
    console.error("Delete claim error:", error);
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

// Legacy URLs delegate to the same implementation as /api/documents.
router.get("/:id/preview", requirePermission(PERMISSIONS.DOCUMENT_VIEW), (req, res) => serveStoredDocument(prisma, req, res));
router.get("/:id/download", requirePermission(PERMISSIONS.DOCUMENT_DOWNLOAD), (req, res) => serveStoredDocument(prisma, req, res, { download: true }));



router.delete("/documents/:id", requirePermission(PERMISSIONS.CLAIM_DELETE), (req, res) =>
  deleteStoredDocument(prisma, req, res, { legacy: true })
);

router.post("/:id/check", requirePermission(PERMISSIONS.CLINICAL_VIEW), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        documents: true,
        serviceLines: { orderBy: { createdAt: "asc" } },
        organization: { select: { rulesetRevision: true } }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    assertClaimEditable(
      claim,
      "Submitted or finalized claims are locked. Reopen or amend the claim before running a new AI check."
    );

    // Load all active organization rules. System rules are evaluated by
    // deterministic code; custom rules are interpreted by the controlled rule engine.
    const rules = await prisma.rule.findMany({
      where: {
        organizationId: orgId(req),
        deletedAt: null
      }
    });
    const issues = [];

    if (!claim.policyNo && !claim.memberId && !claim.subscriberId) {
      issues.push(configuredReadinessIssue(rules, {
        code: "REQ_POLICY_NO",
        severity: "BLOCK",
        message: "Policy or member identifier missing",
        mandatory: true
      }));
    }

    if (!claim.icd10Codes?.length) {
      const icdIssue = configuredReadinessIssue(rules, {
        code: "RECOMMENDED_ICD",
        severity: "WARN",
        message: "ICD-10 codes missing"
      });
      if (icdIssue) issues.push(icdIssue);
    }

    if (!claim.documents?.length) {
      issues.push({
        severity: "BLOCK",
        message: "No supporting documents uploaded",
        fixTarget: "documents"
      });
    }

    if (!claim.amount || Number(claim.amount) <= 0) {
      issues.push({
        severity: "BLOCK",
        message: "Claimed amount missing or invalid",
        field: "amount",
        fixTarget: "claim"
      });
    }

    const verifiedServiceLines = (claim.serviceLines || []).filter(
      (line) => line.verified !== false
    );

    if (claim.claimForm === "PROFESSIONAL") {
      if (!claim.renderingProviderNpi) {
        issues.push({
          severity: "BLOCK",
          message: "837P professional claim requires rendering provider NPI",
          source: "CLAIM_FORM",
          field: "renderingProviderNpi",
          fixTarget: "claim"
        });
      }
      if (verifiedServiceLines.length && verifiedServiceLines.some((line) => !line.placeOfService)) {
        issues.push({
          severity: "BLOCK",
          message: "837P professional service lines require Place of Service",
          source: "CLAIM_FORM",
          field: "placeOfService",
          fixTarget: "serviceLines"
        });
      }
    }

    if (claim.claimForm === "INSTITUTIONAL") {
      if (!claim.typeOfBill) {
        issues.push({
          severity: "BLOCK",
          message: "837I institutional claim requires Type of Bill",
          source: "CLAIM_FORM",
          field: "typeOfBill",
          fixTarget: "claim"
        });
      }
      if (verifiedServiceLines.length && verifiedServiceLines.some((line) => !line.revenueCode)) {
        issues.push({
          severity: "BLOCK",
          message: "837I institutional service lines require revenue code",
          source: "CLAIM_FORM",
          field: "revenueCode",
          fixTarget: "serviceLines"
        });
      }
    }

    if (claim.eligibilityStatus !== "VERIFIED") {
      issues.push({
        severity: "BLOCK",
        message: "Eligibility has not been verified",
        fixTarget: "eligibility"
      });
    }

    if (
      claim.priorAuthRequired == null ||
      (claim.priorAuthRequired === false && claim.priorAuthStatus !== "NOT_REQUIRED")
    ) {
      issues.push({
        severity: "BLOCK",
        message: "Prior authorization requirement is unresolved",
        fixTarget: "prior-auth"
      });
    }

    issues.push(...evaluateUsReadinessRules(claim, rules));
    issues.push(...evaluateConfiguredRules(claim, rules));
    const evaluatedRulesetFingerprint = rulesetFingerprint(rules, claim, new Date());

    const completeness = completenessReadinessIssues(claim);
    issues.push(...completeness.issues);

    // Medical-consistency findings feed the same pre-submission readiness gate.
    // Keep the module deterministic and evidence-based; no diagnosis or payer
    // policy is inferred here.
    const medicalConsistency = analyzeMedicalConsistency(claim);
    for (const finding of medicalConsistency.issues) {
      const message = `${finding.title}: ${finding.message}`;
      if (!issues.some((existing) => existing.message === message)) {
        issues.push({
          severity: finding.severity,
          message,
          source: "MEDICAL_CONSISTENCY",
          category: finding.category,
          fields: finding.fields,
          fixTarget: finding.fixTarget
        });
      }
    }

    let riskScore = 0;
    const riskFactors = [];

    if (!claim.policyNo && !claim.memberId && !claim.subscriberId) {
      riskScore += 0.25;
      riskFactors.push(
        "Claims without a policy or member identifier show elevated rejection risk"
      );
    }

    if (issues.some((issue) => issue.rule === "RECOMMENDED_ICD")) {
      riskScore += 0.15;
      riskFactors.push(
        "Unstructured diagnosis increases manual review probability"
      );
    }

    if (
      claim.totalBilledAmount &&
      claim.amount &&
      Number(claim.amount) > Number(claim.totalBilledAmount)
    ) {
      riskScore += 0.3;
      riskFactors.push(
        "Claimed amount exceeds billed amount, increasing audit likelihood"
      );
    }

    if (issues.some((i) => i.severity === "BLOCK")) {
      riskScore += 0.1;
      riskFactors.push("Blocking compliance failures present");
    }

    let readinessScore = 100;

    issues.forEach((issue) => {
      if (issue.severity === "BLOCK") readinessScore -= 30;
      if (issue.severity === "WARN") readinessScore -= 10;
    });

    readinessScore = Math.max(readinessScore, 0);

    // A claim that already contains meaningful entered/uploaded evidence should
    // show visible progress even when multiple blockers drive the penalty model
    // to zero. This 1% floor is progress-only; blockers still prevent submission.
    const hasMeaningfulClaimProgress =
      Boolean(claim.patientName || claim.payerName || claim.policyNo) ||
      Number(claim.amount || 0) > 0 ||
      (claim.documents?.length || 0) > 0 ||
      verifiedServiceLines.length > 0;
    if (readinessScore === 0 && hasMeaningfulClaimProgress) {
      readinessScore = 1;
    }

    // Keep readiness and rejection-risk signals directionally consistent.
    // This remains a rules-based estimate, not a payer probability.
    const readinessRiskFloor = (100 - readinessScore) / 100;
    if (readinessRiskFloor > riskScore) {
      riskScore = readinessRiskFloor;
      if (readinessRiskFloor >= 0.3) {
        riskFactors.push("Readiness gaps indicate elevated submission risk");
      }
    }

    riskScore = Math.min(riskScore, 0.95);

    const riskLevel =
      riskScore >= 0.6 ? "HIGH" : riskScore >= 0.3 ? "MED" : "LOW";

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    const previousCheck = await prisma.check.findFirst({
      where: { claimId: claim.id },
      orderBy: { createdAt: "desc" }
    });

    const readinessStatus = assertClaimTransition(
      claim.status,
      !hasBlock && readinessScore >= 80 ? "READY" : "DRAFT"
    );

    const check = await prisma.$transaction(async (tx) => {
      await updateClaimFromExpectedStatus(
        tx,
        claim.id,
        claim.status,
        { status: readinessStatus },
        {
          organizationId: orgId(req),
          message: "Claim entered submission while readiness was being calculated. Refresh before running AI Check again."
        }
      );

      return tx.check.create({
        data: {
          claimId: claim.id,
          score: readinessScore,
          riskScore,
          riskLevel,
          riskFactors,
          issues,
          isStale: false,
          staleAt: null,
          staleReason: null,
          rulesetRevision: claim.organization?.rulesetRevision || 1,
          rulesetFingerprint: evaluatedRulesetFingerprint
        }
      });
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_READINESS_CHECKED",
      metadata: {
        score: readinessScore,
        riskLevel,
        hasBlockingIssues: hasBlock
      }
    });

    res.json({
      ...check,
      comparison: compareReadinessChecks(check, previousCheck),
      completenessSummary: completeness.summary,
      medicalConsistency: {
        score: medicalConsistency.score,
        status: medicalConsistency.status,
        blockingIssues: medicalConsistency.blockingIssues,
        warnings: medicalConsistency.warnings
      }
    });
  } catch (e) {
    if (e?.status) throw e;
    console.error("[claim-readiness] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to check claim readiness", code: "CLAIM_READINESS_FAILED" });
  }
});



router.post("/:id/submission/reconcile", requireRoles(["ADMIN"]), async (req, res) => {
  try {
    const parsed = z.object({
      releaseIfNotFound: z.boolean().optional()
    }).strict().safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid reconciliation request",
        code: "INVALID_SUBMISSION_RECONCILIATION"
      });
    }

    const claim = await prisma.claim.findFirst({
      where: {
        id: req.params.id,
        organizationId: orgId(req),
        deletedAt: null
      },
      include: {
        organization: {
          select: { stediBillingProviderName: true }
        },
        payerTransactions: {
          where: {
            transactionType: { in: ["CLAIM_SUBMISSION", "CLAIM_STATUS"] }
          },
          orderBy: { createdAt: "desc" },
          take: 25
        }
      }
    });

    if (!claim) return res.status(404).json({ error: "Claim not found" });

    if (claim.status !== "SUBMITTING") {
      return res.status(409).json({
        error: "Claim is not awaiting submission reconciliation",
        code: "CLAIM_NOT_SUBMITTING"
      });
    }

    const now = new Date();
    const staleBefore = new Date(now.getTime() - submissionLockTimeoutMs());
    const stale =
      !claim.submissionStartedAt ||
      new Date(claim.submissionStartedAt).getTime() <= staleBefore.getTime();

    const acceptedSubmission = claim.payerTransactions.find((transaction) =>
      transaction.transactionType === "CLAIM_SUBMISSION" &&
      ["ACKNOWLEDGED", "SUBMITTED", "ACCEPTED", "RECEIVED"].includes(
        String(transaction.status || "").toUpperCase()
      )
    );

    const finalize = async ({ payerStatus = "SUBMITTED", payerReferenceNo = null, sourceTransactionId = null } = {}) => {
      const completed = await completeSubmissionLock(
        prisma,
        claim.id,
        claim.submissionAttemptId,
        {
          claimSubmissionDate: claim.claimSubmissionDate || now,
          patientControlNumber: claim.patientControlNumber,
          payerClaimStatus: payerStatus,
          payerReferenceNo: payerReferenceNo || claim.payerReferenceNo || null,
          claimStatusCheckedAt: now,
          remittanceStatus: claim.remittanceStatus === "NOT_AVAILABLE"
            ? "AWAITING"
            : claim.remittanceStatus
        }
      );

      if (!completed) {
        return null;
      }

      if (payerStatus === "DENIED") {
        await prisma.$transaction(async (tx) => {
          await tx.claim.update({
            where: { id: claim.id },
            data: { status: assertClaimTransition("SUBMITTED", "DENIED") }
          });

          const existingDenial = await tx.denialCase.findFirst({
            where: {
              claimId: claim.id,
              status: {
                in: [
                  "OPEN",
                  "ANALYZED",
                  "CORRECTION_REQUIRED",
                  "APPEAL_PREPARED",
                  "APPEAL_SUBMITTED",
                  "RESUBMITTED"
                ]
              }
            }
          });

          if (!existingDenial) {
            await tx.denialCase.create({
              data: {
                claimId: claim.id,
                source: "PAYER_STATUS",
                status: "OPEN",
                denialDate: now,
                revenueAtRisk: Number(claim.amount || 0),
                sourceTransactionId: sourceTransactionId || null,
                reasonText: "Payer reconciliation confirmed a denied claim"
              }
            });
          }
        });
      }

      return prisma.claim.findUnique({
        where: { id: claim.id },
        select: {
          id: true,
          status: true,
          patientControlNumber: true,
          claimSubmissionDate: true,
          payerClaimStatus: true,
          payerReferenceNo: true,
          remittanceStatus: true,
          claimForm: true,
          claimFrequencyCode: true,
          payerName: true,
          payerEdiId: true
        }
      });
    };

    if (acceptedSubmission) {
      const reconciled = await finalize({
        payerStatus: String(acceptedSubmission.status || "SUBMITTED").toUpperCase(),
        payerReferenceNo:
          acceptedSubmission.responsePayload?.payerClaimNo ||
          claim.payerReferenceNo ||
          null,
        sourceTransactionId: acceptedSubmission.transactionId
      });

      if (!reconciled) {
        return res.status(409).json({
          error: "Submission ownership changed during reconciliation",
          code: "CLAIM_SUBMISSION_OWNERSHIP_LOST"
        });
      }

      await auditClaim(req, {
        claimId: claim.id,
        action: "CLAIM_SUBMISSION_RECONCILED",
        metadata: {
          source: "PAYER_TRANSACTION",
          staleSubmissionRecovered: stale
        }
      });

      return res.json({
        reconciled: true,
        source: "PAYER_TRANSACTION",
        claim: safeSubmissionClaim(reconciled)
      });
    }

    if (claim.payerConnectionMode !== "LIVE") {
      if (stale && parsed.data.releaseIfNotFound === true) {
        const released = await releaseSubmissionLock(
          prisma,
          claim.id,
          claim.submissionAttemptId
        );
        if (!released) {
          return res.status(409).json({
            error: "Submission ownership changed during reconciliation",
            code: "CLAIM_SUBMISSION_OWNERSHIP_LOST"
          });
        }

        await auditClaim(req, {
          claimId: claim.id,
          action: "CLAIM_SUBMISSION_RECONCILED",
          metadata: {
            source: "LOCAL_NO_EXTERNAL_TRANSMISSION",
            releasedToReady: true
          }
        });

        return res.json({
          reconciled: true,
          released: true,
          status: "READY"
        });
      }

      return res.status(409).json({
        error: "No external payer transmission evidence is available",
        message: stale
          ? "This local-only submission is stale. Re-run reconciliation with releaseIfNotFound=true to release it."
          : "The submission lock is still within its active timeout window.",
        code: "SUBMISSION_RECONCILIATION_PENDING",
        stale
      });
    }

    const descriptor = payerConnectorStatusForClaim(claim);
    if (
      !descriptor.configured ||
      !descriptor.capabilities?.includes("getStatus")
    ) {
      return res.status(409).json({
        error: "Payer status reconciliation is not configured",
        code: "SUBMISSION_RECONCILIATION_CONNECTOR_UNAVAILABLE",
        stale
      });
    }

    const connector = createPayerConnectorForClaim(claim);
    const result = await connector.getStatus(claim, {
      providerName: claim.organization?.stediBillingProviderName || null
    });

    const transaction = await prisma.payerTransaction.create({
      data: {
        claimId: claim.id,
        transactionId:
          result.transactionId ||
          `${connector.connectorId}-RECONCILE-${claim.id}-${Date.now()}`,
        mode: result.livePayerVerification === true
          ? "PRODUCTION"
          : connector.connectorEnvironment,
        payerCode:
          claim.connectedPayerCode ||
          claim.payerEdiId ||
          claim.payerName ||
          connector.connectorProvider,
        transactionType: "CLAIM_STATUS",
        status: result.status || "NEEDS_REVIEW",
        latencyMs: result.latencyMs || null,
        requestPayload: {
          transaction: "276",
          responseTransaction: "277",
          reconciliation: true,
          patientControlNumber: claim.patientControlNumber || null
        },
        responsePayload: result
      }
    });

    const finalStatuses = new Set([
      "ACKNOWLEDGED",
      "IN_REVIEW",
      "APPROVED",
      "PARTIALLY_APPROVED",
      "DENIED",
      "PAID"
    ]);
    const payerStatus = String(result.status || "").toUpperCase();

    if (finalStatuses.has(payerStatus)) {
      const reconciled = await finalize({
        payerStatus,
        payerReferenceNo: result.payerClaimNo || null,
        sourceTransactionId: transaction.transactionId
      });

      if (!reconciled) {
        return res.status(409).json({
          error: "Submission ownership changed during reconciliation",
          code: "CLAIM_SUBMISSION_OWNERSHIP_LOST"
        });
      }

      await auditClaim(req, {
        claimId: claim.id,
        action: "CLAIM_SUBMISSION_RECONCILED",
        metadata: {
          source: "PAYER_277",
          payerClaimStatus: payerStatus,
          staleSubmissionRecovered: stale
        }
      });

      return res.json({
        reconciled: true,
        source: "PAYER_277",
        payerStatus,
        claim: safeSubmissionClaim(reconciled)
      });
    }

    if (
      payerStatus === "NOT_FOUND" &&
      stale &&
      parsed.data.releaseIfNotFound === true
    ) {
      const released = await releaseSubmissionLock(
        prisma,
        claim.id,
        claim.submissionAttemptId
      );

      if (!released) {
        return res.status(409).json({
          error: "Submission ownership changed during reconciliation",
          code: "CLAIM_SUBMISSION_OWNERSHIP_LOST"
        });
      }

      await auditClaim(req, {
        claimId: claim.id,
        action: "CLAIM_SUBMISSION_RECONCILED",
        metadata: {
          source: "PAYER_277",
          releasedToReady: true,
          payerStatus: "NOT_FOUND"
        }
      });

      return res.json({
        reconciled: true,
        released: true,
        payerStatus: "NOT_FOUND",
        status: "READY"
      });
    }

    return res.status(202).json({
      reconciled: false,
      stale,
      payerStatus: payerStatus || "UNAVAILABLE",
      message:
        payerStatus === "NOT_FOUND"
          ? "Payer did not find the claim. If the lock is stale, an administrator may explicitly release it after review."
          : "Payer status is not conclusive yet. Keep the claim locked and reconcile again later.",
      code: "SUBMISSION_RECONCILIATION_PENDING"
    });
  } catch (error) {
    if (error?.status) throw error;
    console.error("[submission-reconcile] failed", {
      claimId: req.params.id,
      code: error?.code || null
    });
    return res.status(500).json({
      error: "Unable to reconcile claim submission",
      code: "SUBMISSION_RECONCILIATION_FAILED"
    });
  }
});

router.post("/:id/submit", requirePermission(PERMISSIONS.CLAIM_SUBMIT), async (req, res) => {
  let submissionLock = null;
  let payerResponseReceived = false;

  try {
    const parsedInput = parseMutation(claimSubmissionSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }

    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        checks: { orderBy: { createdAt: "desc" }, take: 1 },
        serviceLines: { orderBy: { createdAt: "asc" } },
        organization: {
          select: {
            rulesetRevision: true,
            stediSubmitterName: true,
            stediSubmitterId: true,
            stediSubmitterPhone: true,
            stediBillingProviderName: true,
            stediBillingAddress1: true,
            stediBillingAddress2: true,
            stediBillingCity: true,
            stediBillingState: true,
            stediBillingPostalCode: true,
            stediProfessionalSignatureIndicator: true,
            stediProfessionalPlanParticipationCode: true,
            stediInstitutionalPlanParticipationCode: true,
            stediBenefitsAssignmentIndicator: true,
            stediReleaseInformationCode: true,
            stediDefaultProfessionalPlaceOfService: true,
            stediDefaultInstitutionalPlaceOfService: true
          }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (!isPrimaryClaim(claim)) {
      return res.status(409).json({
        error: "Secondary and tertiary claim submission is not enabled",
        message:
          "This release does not yet build the other-payer adjudication/COB loops required for secondary or tertiary 837 claims.",
        code: "SECONDARY_TERTIARY_SUBMISSION_NOT_SUPPORTED"
      });
    }

    const latestCheck = claim.checks?.[0];

    if (claim.eligibilityStatus !== "VERIFIED") {
      return res.status(400).json({
        error: "Verify eligibility before submitting the claim"
      });
    }

    if (
      claim.priorAuthStatus !== "APPROVED" &&
      claim.priorAuthStatus !== "NOT_REQUIRED"
    ) {
      return res.status(400).json({
        error: "Resolve prior authorization before submitting the claim"
      });
    }

    if (claim.priorAuthRequired === true && !String(claim.authorizationNo || "").trim()) {
      return res.status(400).json({
        error: "Authorization number is required before submission",
        message: "The payer-approved prior authorization number must be present on the outbound 837.",
        code: "PRIOR_AUTHORIZATION_NUMBER_REQUIRED"
      });
    }

    if (!latestCheck) {
      return res.status(400).json({
        error: "Run AI Check before submitting the claim"
      });
    }

    if (latestCheck.isStale) {
      return res.status(400).json({
        error:
          "Claim changed after the last AI Check. Refresh AI readiness before submitting."
      });
    }

    const rulesFreshness = await rulesetFreshness(
      prisma,
      orgId(req),
      latestCheck,
      claim,
      new Date()
    );
    if (!rulesFreshness.fresh) {
      return res.status(400).json({
        error:
          rulesFreshness.reason ||
          "Readiness rules changed after the last AI Check. Refresh AI readiness before submitting.",
        code: "READINESS_RULESET_STALE"
      });
    }

    const issues = Array.isArray(latestCheck.issues) ? latestCheck.issues : [];
    if (issues.some((issue) => issue.severity === "BLOCK")) {
      return res.status(400).json({
        error: "Claim has blocking issues. Fix them before submission"
      });
    }

    if (latestCheck.score < 80) {
      return res.status(400).json({
        error: "Claim readiness score must be at least 80 to submit"
      });
    }

    if (
      claim.claimSubmissionDate ||
      ["SUBMITTED", "DENIED", "PAID"].includes(claim.status)
    ) {
      assertClaimEditable(
        claim,
        "Submitted or finalized claims cannot be submitted again."
      );
    }

    if (!["READY", "SUBMITTING"].includes(claim.status)) {
      return res.status(409).json({
        error: "Claim is not ready for submission",
        message: "Run readiness and resolve blockers before submitting.",
        code: "CLAIM_NOT_READY_FOR_SUBMISSION"
      });
    }

    if (claim.status === "READY") {
      assertClaimTransition("READY", "SUBMITTING");
    }
    const submittedStatus = assertClaimTransition("SUBMITTING", "SUBMITTED");

    let payerSubmission = null;
    let connectorDescriptor = null;

    if (claim.payerConnectionMode === "LIVE") {
      connectorDescriptor = payerConnectorStatusForClaim(claim);
      if (!connectorDescriptor.configured) {
        return res.status(503).json({
          error: "Payer claim submission is not configured",
          message: "The selected payer connector is not configured for this environment.",
          code: "PAYER_SUBMISSION_NOT_CONFIGURED"
        });
      }
      if (
        connectorDescriptor.id === "STEDI_PRODUCTION" &&
        process.env.STEDI_PRODUCTION_SUBMISSION_ENABLED !== "true"
      ) {
        return res.status(503).json({
          error: "Production claim submission is disabled",
          message: "Real 837 transmission is disabled for this deployment.",
          code: "PRODUCTION_SUBMISSION_DISABLED"
        });
      }

      if (
        connectorDescriptor.id === "STEDI_PRODUCTION" &&
        claim.claimForm === "INSTITUTIONAL" &&
        process.env.STEDI_PRODUCTION_837I_ENABLED !== "true"
      ) {
        return res.status(503).json({
          error: "Production institutional claim submission is disabled",
          message:
            "Real 837I transmission remains disabled until the institutional payload mapping is production-approved.",
          code: "PRODUCTION_837I_DISABLED"
        });
      }

      if (
        connectorDescriptor.id === "STEDI_PRODUCTION" &&
        parsedInput.data.confirmProductionSubmission !== true
      ) {
        return res.status(409).json({
          error: "Production submission confirmation required",
          message: "Confirm the real 837 transmission before submitting this claim.",
          code: "PRODUCTION_SUBMISSION_CONFIRMATION_REQUIRED"
        });
      }

      if (!connectorDescriptor.capabilities?.includes("submitClaim")) {
        return res.status(409).json({
          error: "Payer claim submission is not supported",
          message: `${connectorDescriptor.provider} does not support claim submission through the configured connector.`,
          code: "PAYER_SUBMISSION_NOT_SUPPORTED"
        });
      }
    }

    submissionLock = await acquireSubmissionLock(prisma, claim, {
      organizationId: orgId(req)
    });

    if (!submissionLock) {
      return res.status(409).json({
        error: "Claim submission is already in progress",
        message:
          "Another request owns this claim submission. Do not resend the claim; refresh status instead.",
        code: "CLAIM_SUBMISSION_IN_PROGRESS"
      });
    }

    if (submissionLock.reclaimed) {
      await auditClaim(req, {
        claimId: claim.id,
        action: "CLAIM_SUBMISSION_LOCK_RECLAIMED",
        metadata: {
          staleSubmissionRecovered: true
        }
      });
    }

    const patientControlNumber = submissionLock.patientControlNumber;
    const submissionClaim = {
      ...claim,
      status: "SUBMITTING",
      patientControlNumber
    };

    let safeResult = null;

    if (claim.payerConnectionMode === "LIVE") {
      const connector = createPayerConnectorForClaim(
        submissionClaim,
        claim.connectedPayerCode || claim.payerEdiId
      );

      payerSubmission = await connector.submitClaim(submissionClaim, {
        submissionProfile: claim.organization
      });
      payerResponseReceived = true;

      safeResult = {
        ...payerSubmission,
        raw: undefined,
        x12: undefined
      };
      delete safeResult.raw;
      delete safeResult.x12;

      const transactionId =
        payerSubmission.transactionId ||
        `837-${patientControlNumber}-${claim.claimFrequencyCode || "ORIGINAL"}`;

      await prisma.payerTransaction.upsert({
        where: {
          transactionId_claimId: {
            transactionId,
            claimId: claim.id
          }
        },
        create: {
          claimId: claim.id,
          transactionId,
          mode: connectorDescriptor.environment,
          payerCode:
            claim.connectedPayerCode ||
            claim.payerEdiId ||
            connectorDescriptor.provider,
          transactionType: "CLAIM_SUBMISSION",
          status: payerSubmission.status,
          latencyMs: payerSubmission.latencyMs || null,
          requestHash: payerSubmission.payloadHash || null,
          requestPayload: {
            transaction:
              claim.claimForm === "INSTITUTIONAL" ? "837I" : "837P",
            patientControlNumber,
            payerCode: claim.connectedPayerCode || claim.payerEdiId || null,
            claimForm: claim.claimForm || null,
            claimFrequencyCode: claim.claimFrequencyCode || "ORIGINAL",
            idempotencyKey: payerSubmission.idempotencyKey || null,
            payloadHash: payerSubmission.payloadHash || null
          },
          responsePayload: safeResult
        },
        update: {
          status: payerSubmission.status,
          latencyMs: payerSubmission.latencyMs || null,
          requestPayload: {
            transaction:
              claim.claimForm === "INSTITUTIONAL" ? "837I" : "837P",
            patientControlNumber,
            payerCode: claim.connectedPayerCode || claim.payerEdiId || null,
            claimForm: claim.claimForm || null,
            claimFrequencyCode: claim.claimFrequencyCode || "ORIGINAL",
            idempotencyKey: payerSubmission.idempotencyKey || null,
            payloadHash: payerSubmission.payloadHash || null
          },
          responsePayload: safeResult
        }
      });

      if (payerSubmission.status === "REJECTED") {
        await releaseSubmissionLock(
          prisma,
          claim.id,
          submissionLock.attemptId
        );
        submissionLock = null;
        payerResponseReceived = false;

        await auditClaim(req, {
          claimId: claim.id,
          action: "CLAIM_SUBMISSION_REJECTED",
          outcome: "DENIED",
          metadata: {
            connectorId: connectorDescriptor.id,
            payerCode: claim.connectedPayerCode || claim.payerEdiId || null
          }
        });

        return res.status(422).json({
          success: false,
          error: "Payer rejected the claim submission",
          message:
            payerSubmission.errors?.[0]?.description ||
            "Stedi claim edits rejected the 837. Correct the claim and resubmit.",
          code: "PAYER_SUBMISSION_REJECTED",
          submission: safeResult
        });
      }
    }

    const completed = await completeSubmissionLock(
      prisma,
      claim.id,
      submissionLock.attemptId,
      {
        status: submittedStatus,
        claimSubmissionDate: new Date(),
        patientControlNumber,
        payerClaimStatus:
          payerSubmission?.status === "ACKNOWLEDGED"
            ? "ACKNOWLEDGED"
            : "SUBMITTED",
        payerReferenceNo:
          payerSubmission?.payerClaimNo || claim.payerReferenceNo || null,
        claimStatusCheckedAt: payerSubmission ? new Date() : null,
        remittanceStatus: "AWAITING"
      }
    );

    if (!completed) {
      submissionLock = null;
      return res.status(409).json({
        success: false,
        error: "Submission ownership changed before completion",
        message:
          "The claim submission was not finalized by this request. Refresh the claim and payer status before taking further action.",
        code: "CLAIM_SUBMISSION_OWNERSHIP_LOST"
      });
    }

    submissionLock = null;

    const updated = await prisma.claim.findUnique({
      where: { id: claim.id },
      select: {
        id: true,
        status: true,
        patientControlNumber: true,
        claimSubmissionDate: true,
        payerClaimStatus: true,
        payerReferenceNo: true,
        remittanceStatus: true,
        claimForm: true,
        claimFrequencyCode: true,
        payerName: true,
        payerEdiId: true
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_SUBMITTED",
      metadata: {
        payerClaimStatus: updated?.payerClaimStatus || null,
        connectorId: connectorDescriptor?.id || null,
        transmittedToPayer: Boolean(payerSubmission)
      }
    });

    return res.json({
      success: true,
      message: payerSubmission
        ? "Claim submitted and transmitted to payer"
        : "Claim submitted successfully",
      submission: safeResult,
      claim: safeSubmissionClaim(updated)
    });
  } catch (e) {
    if (
      submissionLock &&
      !payerResponseReceived &&
      e?.code !== "STEDI_SUBMISSION_OUTCOME_UNKNOWN"
    ) {
      try {
        await releaseSubmissionLock(
          prisma,
          req.params.id,
          submissionLock.attemptId
        );
      } catch (releaseError) {
        console.error("[claim-submit] failed to release submission lock", {
          claimId: req.params.id,
          code: releaseError?.code || null
        });
      }
      submissionLock = null;
    }

    if (submissionLock && payerResponseReceived) {
      console.error("[claim-submit] payer responded but local finalization failed", {
        claimId: req.params.id,
        code: e?.code || null
      });
      await auditClaim(req, {
        claimId: req.params.id,
        action: "CLAIM_SUBMISSION_RECONCILIATION_REQUIRED",
        outcome: "DENIED",
        metadata: {
          payerResponded: true,
          submissionLocked: true
        }
      });
      return res.status(202).json({
        success: false,
        reconciliationRequired: true,
        error: "Payer responded but local submission finalization is incomplete",
        message:
          "The claim remains locked in SUBMITTING. Do not resend or edit it; an administrator must reconcile payer status.",
        code: "PAYER_SUBMISSION_RECONCILIATION_REQUIRED"
      });
    }

    if (e?.status && e?.code !== "STEDI_API_ERROR") throw e;

    if (e?.code === "STEDI_SUBMISSION_OUTCOME_UNKNOWN") {
      const existing = await prisma.claim.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId(req),
          deletedAt: null
        }
      });

      if (existing) {
        const unknownTransactionId =
          `837-unknown-${String(e.payloadHash || "unknown").slice(0, 32)}`;
        await prisma.payerTransaction.upsert({
          where: {
            transactionId_claimId: {
              transactionId: unknownTransactionId,
              claimId: existing.id
            }
          },
          create: {
            claimId: existing.id,
            transactionId: unknownTransactionId,
            mode: "PRODUCTION",
            payerCode:
              existing.connectedPayerCode ||
              existing.payerEdiId ||
              "STEDI",
            transactionType: "CLAIM_SUBMISSION",
            status: "OUTCOME_UNKNOWN",
            latencyMs: e.latencyMs || null,
            requestHash: e.payloadHash || null,
            requestPayload: {
              patientControlNumber: existing.patientControlNumber || null,
              idempotencyKey: e.idempotencyKey || null,
              payloadHash: e.payloadHash || null,
              retrySafe: true
            },
            responsePayload: {
              outcomeUnknown: true,
              retrySafe: true
            }
          },
          update: {
            status: "OUTCOME_UNKNOWN",
            latencyMs: e.latencyMs || null,
            requestHash: e.payloadHash || null,
            responsePayload: {
              outcomeUnknown: true,
              retrySafe: true
            }
          }
        });
      }

      return res.status(202).json({
        success: false,
        outcomeUnknown: true,
        retrySafe: true,
        error: "Submission outcome unknown",
        message: e.message,
        code: "PAYER_SUBMISSION_OUTCOME_UNKNOWN"
      });
    }

    if (
      e?.code === "STEDI_REQUEST_INVALID" ||
      e?.code === "STEDI_CLAIM_REQUEST_INVALID"
    ) {
      return res.status(400).json({
        error: "Claim is missing information required for payer submission",
        message: e.message,
        code: "PAYER_SUBMISSION_PREFLIGHT_FAILED"
      });
    }

    if (e?.code === "PAYER_CONNECTOR_UNAVAILABLE") {
      return res.status(503).json({
        error: "Payer connector is unavailable",
        message:
          "The selected payer service is not available for claim submission.",
        code: "PAYER_CONNECTOR_UNAVAILABLE"
      });
    }

    if (e?.code === "STEDI_API_ERROR") {
      console.error("[claim-submit] Stedi request failed", {
        claimId: req.params.id,
        status: e.status || null
      });
      return res.status(502).json({
        error: "Payer service could not complete claim submission",
        message:
          e.status === 429
            ? "The payer service is temporarily rate limited. Retry later."
            : "The payer service rejected or could not process the request.",
        code: "PAYER_SERVICE_ERROR"
      });
    }

    console.error("[claim-submit] failed", {
      name: e?.name,
      code: e?.code || null
    });
    return res.status(500).json({
      error: "Unable to submit claim",
      code: "CLAIM_SUBMISSION_FAILED"
    });
  }
});

export default router;