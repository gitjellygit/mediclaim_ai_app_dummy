import { validMoney } from "../utils/money.js";
import { z } from "zod";
import { claimUpdateSchema, emptyMutationSchema, parseMutation, serviceLineInputSchema } from "../validation/claimMutations.js";
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
import { requireRoles } from "../middleware/auth.js";
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
import { configuredReadinessIssue } from "../services/configuredReadinessRules.js";
import { evaluateUsReadinessRules, usReadinessRuleCodes } from "../services/usReadinessRules.js";
import { buildClaimPatch, changedPatchFields, serviceLinesDiffer } from "../services/claimPatch.js";
import { assertClaimEditable, isClaimLocked } from "../services/claimLock.js";
import { deletePurgedClaimFiles, resolveClaimDocumentFiles } from "../services/claimPurge.js";
import { writeRequestAudit } from "../services/auditLog.js";
import {
  candidateClaimPatch,
  summarizeExtractionQuality
} from "../services/extractionEngineV2.js";

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


router.get("/", async (req, res) => {
  try {
    const claims = await prisma.claim.findMany({
      where: {
        organizationId: orgId(req),
        deletedAt: null
      },
      include: {
        documents: {
          orderBy: { createdAt: "desc" }
        },
        serviceLines: {
          orderBy: { createdAt: "asc" }
        },
        codingSuggestions: {
          select: {
            documentId: true,
            system: true,
            suggestedCode: true,
            status: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    await writeRequestAudit(prisma, req, {
      action: "CLAIM_LIST_VIEWED",
      entityType: "Claim",
      metadata: { count: claims.length }
    });

    res.json(claims);
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
router.get("/search", async (req, res) => {
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
      items: claims,
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

router.get("/medical-consistency/summary", async (req, res) => {
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

router.get("/:id/medical-consistency", async (req, res) => {
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
      claim,
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

router.get("/:id/audit", async (req, res) => {
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

router.get("/:id", async (req, res) => {
  const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
    include: {
      documents: true,
      serviceLines: { orderBy: { createdAt: "asc" } },
      codingSuggestions: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      fieldCandidates: {
        where: {
          decision: { in: ["CONFIRM", "ABSTAINED"] }
        },
        include: {
          document: {
            select: {
              id: true,
              fileName: true,
              type: true
            }
          }
        },
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

  res.json({
    ...claim,
    checks,
    extractionSummary: summarizeExtractionQuality(claim.fieldCandidates || []),
    automationSummary: buildAutomationSummary(claim),
    completenessSummary: buildClaimCompleteness(claim)
  });
});

router.patch(
  "/:id/field-candidates/:candidateId",
  requireRoles(["ADMIN", "CASHIER"]),
  async (req, res) => {
    try {
      const action = String(req.body?.action || "").trim().toUpperCase();
      if (!["ACCEPT", "REJECT"].includes(action)) {
        return res.status(400).json({
          error: "Action must be ACCEPT or REJECT",
          code: "INVALID_FIELD_CANDIDATE_ACTION"
        });
      }

      const candidate = await prisma.fieldCandidate.findFirst({
        where: {
          id: req.params.candidateId,
          claimId: req.params.id,
          claim: {
            organizationId: orgId(req),
            deletedAt: null
          }
        },
        include: {
          claim: true,
          document: {
            select: { id: true, fileName: true, type: true }
          }
        }
      });

      if (!candidate) {
        return res.status(404).json({ error: "Field candidate not found" });
      }

      assertClaimEditable(
        candidate.claim,
        "Submitted or finalized claims are locked. Extraction review cannot be changed."
      );

      if (!["CONFIRM", "ABSTAINED", "PENDING"].includes(candidate.decision)) {
        return res.status(409).json({
          error: "This field candidate has already been resolved",
          code: "FIELD_CANDIDATE_ALREADY_RESOLVED"
        });
      }

      const now = new Date();
      if (action === "REJECT") {
        const rejected = await prisma.fieldCandidate.update({
          where: { id: candidate.id },
          data: {
            decision: "REJECTED",
            decisionReason: "HUMAN_REJECTED",
            reviewedAt: now,
            reviewedById: req.user.id
          }
        });

        await writeRequestAudit(prisma, req, {
          claimId: candidate.claimId,
          action: "EXTRACTION_FIELD_REJECTED",
          entityType: "FieldCandidate",
          entityId: candidate.id,
          metadata: {
            fieldName: candidate.fieldName,
            documentId: candidate.documentId
          }
        });

        return res.json({ candidate: rejected, applied: false });
      }

      if (candidate.validationStatus !== "VALID") {
        return res.status(409).json({
          error: "This candidate failed validation and cannot be accepted automatically",
          code: "FIELD_CANDIDATE_INVALID"
        });
      }

      const patch = candidateClaimPatch(candidate);
      if (!Object.keys(patch).length) {
        return res.status(409).json({
          error: "This extracted field cannot be applied to the claim",
          code: "FIELD_CANDIDATE_UNSUPPORTED"
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const current = await tx.claim.findUnique({
          where: { id: candidate.claimId }
        });
        const nextProvenance = mergeProvenance(current?.fieldProvenance, {
          [candidate.fieldName]: {
            source: "DOCUMENT_REVIEW",
            label: "Human-confirmed document extraction",
            sourceDetail: candidate.document?.fileName || "Supporting document",
            confidence: candidate.semanticConfidence || candidate.sourceConfidence || null,
            verified: true,
            documentId: candidate.documentId,
            updatedAt: now.toISOString()
          }
        });

        const updatedClaim = await tx.claim.update({
          where: { id: candidate.claimId },
          data: {
            ...patch,
            documentDerivedFields: [
              ...new Set([
                ...(current?.documentDerivedFields || []),
                candidate.fieldName
              ])
            ],
            fieldProvenance: nextProvenance
          }
        });

        const accepted = await tx.fieldCandidate.update({
          where: { id: candidate.id },
          data: {
            decision: "ACCEPTED",
            decisionReason: "HUMAN_ACCEPTED",
            reviewedAt: now,
            reviewedById: req.user.id
          }
        });

        await tx.fieldCandidate.updateMany({
          where: {
            claimId: candidate.claimId,
            fieldName: candidate.fieldName,
            normalizedKey: candidate.normalizedKey,
            id: { not: candidate.id },
            decision: "CONFIRM"
          },
          data: {
            decision: "SUPPORTED",
            decisionReason: "MATCHES_HUMAN_ACCEPTED_VALUE"
          }
        });

        await markReadinessChecksStale(
          tx,
          candidate.claimId,
          `Human confirmed extracted ${candidate.fieldName}`
        );

        return { updatedClaim, accepted };
      });

      await writeRequestAudit(prisma, req, {
        claimId: candidate.claimId,
        action: "EXTRACTION_FIELD_ACCEPTED",
        entityType: "FieldCandidate",
        entityId: candidate.id,
        metadata: {
          fieldName: candidate.fieldName,
          documentId: candidate.documentId
        }
      });

      return res.json({
        candidate: result.accepted,
        claim: result.updatedClaim,
        applied: true
      });
    } catch (error) {
      if (error?.status) throw error;
      console.error("[field-candidate] review failed", {
        claimId: req.params.id,
        candidateId: req.params.candidateId,
        code: error?.code || null
      });
      return res.status(500).json({
        error: "Unable to review extracted field",
        code: "FIELD_CANDIDATE_REVIEW_FAILED"
      });
    }
  }
);

router.post("/", async (req, res) => {
  try {
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
      subscriberRelationship: z.enum(["SELF", "SPOUSE", "CHILD", "OTHER"]).nullish(),
      coordinationOfBenefits: z.enum(["PRIMARY", "SECONDARY", "TERTIARY"]).nullish(),
      payerEdiId: z.string().trim().max(100).nullish(),
      coverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      remainingCoverageLimit: z.coerce.number().nonnegative().finite().nullish(),
      payerReferenceNo: z.string().trim().max(100).nullish(),
      patientDob: z.string().nullish(),
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
      claimFrequencyCode: z.enum(["ORIGINAL", "CORRECTED", "VOID"]).optional(),
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
    for (const field of ["patientDob", "dateOfService", "admissionDate", "dischargeDate", "procedureDate", "timelyFilingDeadline"]) {
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

    res.json(createdClaim);
  } catch (e) {
    console.error("[claim-create] failed", { name: e.name, code: e.code || null });
    res.status(500).json({ error: "Unable to create claim", code: "CLAIM_CREATE_FAILED" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
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
          await tx.claim.update({
            where: { id: req.params.id },
            data: {
              ...payload,
              documentDerivedFields,
              fieldProvenance,
              status: nextStatus
            }
          });
        } else if (serviceLinesChanged && existing.status !== nextStatus) {
          await tx.claim.update({
            where: { id: req.params.id },
            data: { status: nextStatus }
          });
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
        serviceLinesChanged && patchChangedFields.length === 0
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

    res.json({
      ...updated,
      unchanged: !anyClaimDataChanged,
      automationSummary: buildAutomationSummary(updated),
      completenessSummary: buildClaimCompleteness(updated)
    });
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

router.delete("/:id", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
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

    await prisma.claim.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await auditClaim(req, {
      claimId: id,
      action: "CLAIM_SOFT_DELETED",
      metadata: { previousStatus: claim.status }
    });

    res.json({ success: true, softDeleted: true });
  } catch (error) {
    console.error("Delete claim error:", error);
    res.status(400).json({ error: "Unable to delete claim" });
  }
});

// Legacy URLs delegate to the same implementation as /api/documents.
router.get("/:id/preview", (req, res) => serveStoredDocument(prisma, req, res));
router.get("/:id/download", (req, res) => serveStoredDocument(prisma, req, res, { download: true }));



router.delete("/documents/:id", requireRoles(["ADMIN", "CASHIER"]), (req, res) =>
  deleteStoredDocument(prisma, req, res, { legacy: true })
);

router.post("/:id/check", async (req, res) => {
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
        fieldCandidates: {
          where: {
            criticality: "CRITICAL",
            decision: "CONFIRM"
          }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    assertClaimEditable(
      claim,
      "Submitted or finalized claims are locked. Reopen or amend the claim before running a new AI check."
    );

    // Only recognized rule codes alter live readiness. Mandatory gates remain mandatory.
    const rules = await prisma.rule.findMany({
      where: {
        organizationId: orgId(req),
        code: {
          in: ["REQ_POLICY_NO", "RECOMMENDED_ICD", ...usReadinessRuleCodes()]
        }
      }
    });
    const issues = [];

    if (!claim.policyNo) {
      issues.push(configuredReadinessIssue(rules, {
        code: "REQ_POLICY_NO",
        severity: "BLOCK",
        message: "Policy number missing",
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

    const unresolvedCriticalExtractionFields = [
      ...new Set((claim.fieldCandidates || []).map((item) => item.fieldName))
    ];
    if (unresolvedCriticalExtractionFields.length > 0) {
      issues.push({
        severity: "BLOCK",
        message:
          unresolvedCriticalExtractionFields.length === 1
            ? `Confirm the extracted ${unresolvedCriticalExtractionFields[0]} before submission`
            : `Confirm ${unresolvedCriticalExtractionFields.length} submission-critical extracted fields before submission`,
        source: "EXTRACTION_V2",
        fields: unresolvedCriticalExtractionFields,
        fixTarget: "extraction-review"
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

    if (!claim.policyNo) {
      riskScore += 0.25;
      riskFactors.push(
        "Claims without policy number historically show elevated rejection trends"
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
      const created = await tx.check.create({
        data: {
          claimId: claim.id,
          score: readinessScore,
          riskScore,
          riskLevel,
          riskFactors,
          issues,
          isStale: false,
          staleAt: null,
          staleReason: null
        }
      });

      await tx.claim.update({
        where: { id: claim.id },
        data: { status: readinessStatus }
      });

      return created;
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



router.post("/:id/submit", requireRoles(["ADMIN", "CASHIER"]), async (req, res) => {
  try {
    const parsedInput = parseMutation(emptyMutationSchema, req.body);
    if (!parsedInput.ok) {
      return res.status(400).json(parsedInput.response);
    }
    const claim = await prisma.claim.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), deletedAt: null },
      include: {
        checks: { orderBy: { createdAt: "desc" }, take: 1 },
        fieldCandidates: {
          where: {
            criticality: "CRITICAL",
            decision: "CONFIRM"
          },
          select: { id: true, fieldName: true }
        }
      }
    });

    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const latestCheck = claim.checks?.[0];

    if ((claim.fieldCandidates || []).length > 0) {
      return res.status(400).json({
        error: "Confirm submission-critical extracted fields before submitting the claim",
        code: "EXTRACTION_REVIEW_REQUIRED",
        fields: [...new Set(claim.fieldCandidates.map((item) => item.fieldName))]
      });
    }

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

    const issues = Array.isArray(latestCheck.issues)
      ? latestCheck.issues
      : [];

    const hasBlock = issues.some((i) => i.severity === "BLOCK");

    if (hasBlock) {
      return res.status(400).json({
        error: "Claim has blocking issues. Fix them before submission"
      });
    }

    if (latestCheck.score < 80) {
      return res.status(400).json({
        error: "Claim readiness score must be at least 80 to submit"
      });
    }

    if (isClaimLocked(claim)) {
      assertClaimEditable(
        claim,
        "Submitted or finalized claims cannot be submitted again."
      );
    }

    const submittedStatus = assertClaimTransition(claim.status, "SUBMITTED");
    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: submittedStatus,
        claimSubmissionDate: new Date(),
        patientControlNumber: claim.patientControlNumber || claim.id,
        payerClaimStatus: "SUBMITTED",
        claimStatusCheckedAt: new Date(),
        remittanceStatus: "AWAITING"
      },
      include: {
        documents: true,
        checks: { orderBy: { createdAt: "desc" } }
      }
    });

    await auditClaim(req, {
      claimId: claim.id,
      action: "CLAIM_SUBMITTED",
      metadata: { payerClaimStatus: updated.payerClaimStatus }
    });

    res.json({
      success: true,
      message: "Claim submitted successfully",
      claim: updated
    });
  } catch (e) {
    if (e?.status) throw e;
    console.error("[claim-submit] failed", { name: e?.name, code: e?.code || null });
    res.status(500).json({ error: "Unable to submit claim", code: "CLAIM_SUBMISSION_FAILED" });
  }
});

export default router;