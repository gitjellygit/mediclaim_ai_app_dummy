import { toDateOnlyString } from "../utils/claimDate.js";
import fs from "fs";
import { validMoney } from "../utils/money.js";
import crypto from "crypto";
import path from "path";
import {
  TextractClient,
  DetectDocumentTextCommand,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand
} from "@aws-sdk/client-textract";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

import { PDFParse } from "pdf-parse";

const REGION = process.env.AWS_REGION || "us-east-1";
const TEXTRACT_BUCKET = process.env.AWS_TEXTRACT_S3_BUCKET;

const textract = new TextractClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

export const DOC_TYPES = [
  "DISCHARGE_SUMMARY",
  "FINAL_BILL",
  "BREAKUP_BILL",
  "LAB_REPORT",
  "RADIOLOGY",
  "PRESCRIPTION",
  "ID_PROOF",
  "INSURANCE_CARD",
  "PRIOR_AUTHORIZATION",
  "OPERATIVE_NOTE",
  "PROGRESS_NOTE",
  "EOB",
  "OTHER"
];

function norm(value) {
  return String(value || "").toLowerCase();
}

function clean(value) {
  if (!value) return null;
  return String(value).replace(/\s+/g, " ").trim();
}

function hasAny(text, keywords) {
  // Whole word/phrase boundaries prevent short clinical terms from matching
  // unrelated words. Treat filename hyphens/underscores as spaces.
  const tokens = norm(text).replace(/[_-]/g, " ");
  return keywords.some((keyword) => {
    const phrase = norm(keyword).replace(/[_-]/g, " ");
    return new RegExp("(^|[^a-z0-9])" + phrase + "($|[^a-z0-9])", "i").test(tokens);
  });
}

export function getFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function extractPdfText(filePath) {
  let parser;

  try {
    const buffer = fs.readFileSync(filePath);
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result?.text || "";
  } catch (error) {
    console.error("[doc-intel] PDF parse failed", { name: error?.name || "Error" });
    return "";
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (cleanupError) {
        console.error("[doc-intel] PDF parser cleanup failed", { name: cleanupError?.name || "Error" });
      }
    }
  }
}

async function textractImageBytes(filePath) {
  const bytes = fs.readFileSync(filePath);

  const result = await textract.send(
    new DetectDocumentTextCommand({
      Document: {
        Bytes: bytes
      }
    })
  );

  return (result.Blocks || [])
    .filter((block) => block.BlockType === "LINE")
    .map((block) => block.Text)
    .filter(Boolean)
    .join("\n");
}

async function uploadToS3ForTextract(filePath, fileName) {
  if (!TEXTRACT_BUCKET) {
    throw new Error("AWS_TEXTRACT_S3_BUCKET is missing in backend .env");
  }

  const key = `textract/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const body = fs.readFileSync(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: TEXTRACT_BUCKET,
      Key: key,
      Body: body
    })
  );

  return key;
}

async function textractPdfViaS3(filePath, fileName) {
  const key = await uploadToS3ForTextract(filePath, fileName);

  try {
    const start = await textract.send(
      new StartDocumentTextDetectionCommand({
        DocumentLocation: {
          S3Object: {
            Bucket: TEXTRACT_BUCKET,
            Name: key
          }
        }
      })
    );

    const jobId = start.JobId;

    // Synchronous OCR is bounded; long-running OCR needs a durable worker.
    const attempts = Math.max(1, Math.min(30, Math.ceil((Number(process.env.OCR_SYNC_WAIT_MS) || 10000) / 2000)));
    for (let i = 0; i < attempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const result = await textract.send(
        new GetDocumentTextDetectionCommand({
          JobId: jobId
        })
      );

      if (result.JobStatus === "SUCCEEDED") {
        let blocks = result.Blocks || [];
        let nextToken = result.NextToken;

        while (nextToken) {
          const next = await textract.send(
            new GetDocumentTextDetectionCommand({
              JobId: jobId,
              NextToken: nextToken
            })
          );

          blocks = [...blocks, ...(next.Blocks || [])];
          nextToken = next.NextToken;
        }

        return blocks
          .filter((block) => block.BlockType === "LINE")
          .map((block) => block.Text)
          .filter(Boolean)
          .join("\n");
      }

      if (result.JobStatus === "FAILED") {
        throw new Error("Textract PDF OCR failed");
      }
    }

    throw new Error("Textract PDF OCR timed out");
  } finally {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: TEXTRACT_BUCKET,
          Key: key
        })
      );
    } catch (cleanupError) {
      console.error("[doc-intel] OCR temporary object cleanup failed", { name: cleanupError?.name || "Error" });
    }
  }
}

async function extractTextWithTextract({ filePath, fileName, mimeType }) {
  const mt = norm(mimeType);
  const ext = path.extname(fileName || "").toLowerCase();

  if (mt.includes("pdf") || ext === ".pdf") {
    return textractPdfViaS3(filePath, fileName);
  }

  if (
    mt.includes("image") ||
    [".jpg", ".jpeg", ".png", ".tif", ".tiff"].includes(ext)
  ) {
    return textractImageBytes(filePath);
  }

  return "";
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }

  return null;
}

function parseAmount(value) {
  if (!value) return null;

  const number = Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[^0-9.]/g, "")
  );

  const precise = Number.isFinite(number) ? validMoney(number) : null;
  return precise != null && Number(precise) > 0 ? Number(precise) : null;
}

function extractCodes(text, pattern) {
  const match = text.match(pattern);
  if (!match || !match[1]) return [];
  
  const codesStr = match[1];
  return codesStr.split(/[,;\s]+/).filter(code => code.trim().length > 0);
}

export function extractFields(text) {
  const t = text || "";

  const patientName = firstMatch(t, [
    /Patient\s*Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Name\s*of\s*Patient\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Patient\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i
  ]);

  const hospitalName = firstMatch(t, [
    /Hospital\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i,
    /Name\s*of\s*Hospital\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i,
    /Facility\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i,
    /Provider\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i
  ]);

  const policyNo = firstMatch(t, [
    /Policy\s*(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Policy\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const claimNo = firstMatch(t, [
    /Claim\s*(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Claim\s*ID\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Claim\s*Reference\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const diagnosisText = firstMatch(t, [
    /Diagnosis\s*[:\-]?\s*([^\n\r]{3,160})/i,
    /Final\s*Diagnosis\s*[:\-]?\s*([^\n\r]{3,160})/i,
    /Principal\s*Diagnosis\s*[:\-]?\s*([^\n\r]{3,160})/i
  ]);

  const doctorName = firstMatch(t, [
    /Doctor\s*Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Consultant\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Dr\.?\s*([A-Za-z .]{3,80})/i,
    /Attending\s*Physician\s*[:\-]?\s*([A-Za-z .]{3,80})/i
  ]);

  const amountText = firstMatch(t, [
    /Grand\s*Total\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /Net\s*Amount\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /Total\s*Amount\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /Total\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /Balance\s*Due\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /Amount\s*Due\s*[:\-]?\s*(?:USD|\$)?\s*([0-9,]+\.?[0-9]*)/i,
    /\$\s*([0-9,]+\.?[0-9]*)/i
  ]);

  const amount = parseAmount(amountText);

  const memberId = firstMatch(t, [
    /Member\s*ID\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Membership\s*No\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Subscriber\s*ID\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const groupNumber = firstMatch(t, [
    /Group\s*(?:No|Number|ID)?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const subscriberId = firstMatch(t, [
    /Subscriber\s*ID\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Subscriber\s*(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]) || memberId;

  const subscriberName = firstMatch(t, [
    /Subscriber\s*Name\s*[:\-]?\s*([A-Za-z .'-]{3,80})/i,
    /Policy\s*Holder\s*[:\-]?\s*([A-Za-z .'-]{3,80})/i
  ]);

  const payerEdiId = firstMatch(t, [
    /Payer\s*EDI\s*(?:ID)?\s*[:\-]?\s*([A-Z0-9\-]+)/i,
    /EDI\s*Payer\s*(?:ID)?\s*[:\-]?\s*([A-Z0-9\-]+)/i
  ]);

  const medicalRecordNumber = firstMatch(t, [
    /(?:MRN|Medical\s*Record\s*(?:No|Number))\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const patientMobile = firstMatch(t, [
    /(?:Patient\s*)?(?:Phone|Mobile|Telephone)\s*[:\-]?\s*([+0-9()\-\s]{7,24})/i
  ]);

  const payerName = firstMatch(t, [
    /Insurance\s*Company\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,80})/i,
    /Payer\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,80})/i,
    /Carrier\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,80})/i
  ]);

  const authorizationNo = firstMatch(t, [
    /Authorization\s*(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Auth\s*No\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Pre\s*Auth\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const dateOfBirthRaw = firstMatch(t, [
    /Date\s*of\s*Birth\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /DOB\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /Birth\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
  ]);
  const dateOfBirth = toDateOnlyString(dateOfBirthRaw);

  const dateOfServiceRaw = firstMatch(t, [
    /Date\s*of\s*Service\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /Service\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /DOS\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
  ]);
  const dateOfService = toDateOnlyString(dateOfServiceRaw);

  const admissionDateRaw = firstMatch(t, [
    /Admission\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /Date\s*of\s*Admission\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
  ]);
  const admissionDate = toDateOnlyString(admissionDateRaw);

  const dischargeDateRaw = firstMatch(t, [
    /Discharge\s*Date\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i,
    /Date\s*of\s*Discharge\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/i
  ]);
  const dischargeDate = toDateOnlyString(dischargeDateRaw);

  const icd10Codes = extractCodes(t, /ICD[-\s]*10\s*[:\-]?\s*([A-Z]\d{2}(?:\.\d{1,4})?(?:\s*,\s*[A-Z]\d{2}(?:\.\d{1,4})?)*)/i);
  const cptCodes = extractCodes(
    t,
    /(?:CPT|HCPCS)\s*(?:Code|Codes)?\s*[:\-]?\s*((?:\d{5}|[A-Z]\d{4})(?:\s*,\s*(?:\d{5}|[A-Z]\d{4}))*)/i
  );

  return {
    patientName,
    hospitalName,
    policyNo,
    claimNo,
    diagnosisText,
    doctorName,
    amount,
    memberId,
    groupNumber,
    subscriberId,
    subscriberName,
    payerEdiId,
    medicalRecordNumber,
    patientMobile,
    payerName,
    authorizationNo,
    dateOfBirth,
    dateOfService,
    admissionDate,
    dischargeDate,
    icd10Codes,
    cptCodes
  };
}

export function classifyDocument({ fileName, text }) {
  const name = norm(fileName);

  if (hasAny(name, ["discharge"]) || hasAny(text, ["discharge summary"])) {
    return { suggestedType: "DISCHARGE_SUMMARY", confidence: 88 };
  }

  if (
    hasAny(name, ["breakup", "itemized", "itemised"]) ||
    hasAny(text, ["itemized bill", "itemised bill", "bill breakup"])
  ) {
    return { suggestedType: "BREAKUP_BILL", confidence: 78 };
  }

  if (
    hasAny(name, ["final bill", "invoice", "bill"]) ||
    hasAny(text, ["final bill", "grand total", "net amount", "total amount"])
  ) {
    return { suggestedType: "FINAL_BILL", confidence: 84 };
  }

  if (
    hasAny(name, ["lab", "pathology", "report"]) ||
    hasAny(text, ["laboratory", "pathology", "sample type", "report date"])
  ) {
    return { suggestedType: "LAB_REPORT", confidence: 76 };
  }

  if (
    hasAny(name, ["xray", "ct", "mri", "radiology"]) ||
    hasAny(text, ["radiology", "impression"])
  ) {
    return { suggestedType: "RADIOLOGY", confidence: 74 };
  }

  if (hasAny(name, ["prescription", "rx"]) || hasAny(text, ["prescription", "rx"])) {
    return { suggestedType: "PRESCRIPTION", confidence: 72 };
  }

  if (
    hasAny(name, ["drivers license", "driver license", "state id", "passport"]) ||
    hasAny(text, ["driver license", "drivers license", "state identification", "passport number"])
  ) {
    return { suggestedType: "ID_PROOF", confidence: 80 };
  }

  if (
    hasAny(name, ["prior auth", "authorization", "pre-auth"]) ||
    hasAny(text, [
      "prior authorization",
      "pre-authorization",
      "authorization number",
      "authorization status",
      "approved service",
      "authorization determination"
    ])
  ) {
    return { suggestedType: "PRIOR_AUTHORIZATION", confidence: 86 };
  }

  if (
    hasAny(name, ["insurance card", "id card", "member card"]) ||
    hasAny(text, ["insurance card", "member identification", "policy holder", "group number"])
  ) {
    return { suggestedType: "INSURANCE_CARD", confidence: 82 };
  }

  if (
    hasAny(name, ["operative note", "op note", "surgery"]) ||
    hasAny(text, ["operative note", "procedure performed", "surgical procedure"])
  ) {
    return { suggestedType: "OPERATIVE_NOTE", confidence: 78 };
  }

  if (
    hasAny(name, ["progress note", "daily note", "clinical note"]) ||
    hasAny(text, ["progress note", "daily progress", "clinical documentation"])
  ) {
    return { suggestedType: "PROGRESS_NOTE", confidence: 76 };
  }

  if (
    hasAny(name, ["eob", "explanation of benefits"]) ||
    hasAny(text, ["explanation of benefits", "eob", "this is not a bill"])
  ) {
    return { suggestedType: "EOB", confidence: 85 };
  }

  return { suggestedType: "OTHER", confidence: 55 };
}

export async function analyzeDocument({ fileName, mimeType, path: filePath }, { ocrExtractor = extractTextWithTextract, pdfExtractor = extractPdfText } = {}) {
  let rawText = "";
  let ocrProvider = "none";
  let providerFailed = false;

  const deterministicE2eMode =
    process.env.E2E_TEST_MODE === "true" &&
    ocrExtractor === extractTextWithTextract;

  if (deterministicE2eMode) {
    // Browser tests must not depend on live AWS credentials or external OCR.
    // Filename-based classification remains deterministic; production behavior
    // is unchanged because this branch is only enabled by E2E_TEST_MODE.
    ocrProvider = "E2E_FILENAME_ONLY";
  } else {
    try {
      rawText = await ocrExtractor({
        filePath,
        fileName,
        mimeType
      });

      if (rawText?.trim()) {
        ocrProvider = "AWS_TEXTRACT";
      }
    } catch (error) {
      // Never include OCR content or exception text in logs (possible PHI).
      providerFailed = true;
      console.error("[doc-intel] OCR provider failed", { provider: "TEXTRACT", name: error?.name || "Error" });
    }
  }

  const isPdf = norm(mimeType).includes("pdf") || path.extname(fileName || "").toLowerCase() === ".pdf";
  if (isPdf && (!rawText || rawText.length < 40)) {
    const pdfText = await pdfExtractor(filePath);
    if (pdfText?.trim()) {
      rawText = pdfText;
      ocrProvider = "PDF_PARSE";
    }
  }

  const ocrStatus = providerFailed && !rawText?.trim() ? "FAILED" : rawText?.trim() ? "PROCESSED" : "NO_TEXT";
  if (ocrStatus === "FAILED") ocrProvider = "AWS_TEXTRACT_FAILED";
  const extracted = extractFields(rawText || "");
  const classification = classifyDocument({ fileName, text: rawText || "" });

  const fieldsFound = Object.values(extracted).filter(Boolean).length;
  const extractionConfidence = Math.min(95, 50 + fieldsFound * 8);

  return {
    ...classification,
    extracted,
    rawExtractedText: rawText || "",
    extractionConfidence,
    extractionSource: ocrProvider,
    ocrProvider,
    ocrStatus
  };
}