import fs from "fs";
import crypto from "crypto";
import path from "path";
import { createRequire } from "module";
import {
  TextractClient,
  DetectDocumentTextCommand,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand
} from "@aws-sdk/client-textract";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

const REGION = process.env.AWS_REGION || "ap-south-1";
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
  const t = norm(text);
  return keywords.some((keyword) => t.includes(keyword));
}

export function getFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function extractPdfText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    return data.text || "";
  } catch (error) {
    console.error("pdf-parse failed:", error.message);
    return "";
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

  for (let i = 0; i < 30; i += 1) {
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

  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function extractFields(text) {
  const t = text || "";

  const patientName = firstMatch(t, [
    /Patient\s*Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Name\s*of\s*Patient\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Patient\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i
  ]);

  const hospitalName = firstMatch(t, [
    /Hospital\s*Name\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i,
    /Name\s*of\s*Hospital\s*[:\-]?\s*([A-Za-z0-9 .,&-]{3,120})/i
  ]);

  const policyNo = firstMatch(t, [
    /Policy\s*(No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Policy\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const claimNo = firstMatch(t, [
    /Claim\s*(No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /Claim\s*ID\s*[:\-]?\s*([A-Z0-9\-\/]+)/i
  ]);

  const diagnosisText = firstMatch(t, [
    /Diagnosis\s*[:\-]?\s*([^\n\r]{3,160})/i,
    /Final\s*Diagnosis\s*[:\-]?\s*([^\n\r]{3,160})/i
  ]);

  const doctorName = firstMatch(t, [
    /Doctor\s*Name\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Consultant\s*[:\-]?\s*([A-Za-z .]{3,80})/i,
    /Dr\.?\s*([A-Za-z .]{3,80})/i
  ]);

  const amountText = firstMatch(t, [
    /Grand\s*Total\s*[:\-]?\s*(₹|Rs\.?|INR)?\s*([0-9,]+\.?[0-9]*)/i,
    /Net\s*Amount\s*[:\-]?\s*(₹|Rs\.?|INR)?\s*([0-9,]+\.?[0-9]*)/i,
    /Total\s*Amount\s*[:\-]?\s*(₹|Rs\.?|INR)?\s*([0-9,]+\.?[0-9]*)/i,
    /Total\s*[:\-]?\s*(₹|Rs\.?|INR)?\s*([0-9,]+\.?[0-9]*)/i,
    /₹\s*([0-9,]+\.?[0-9]*)/i
  ]);

  const amount = parseAmount(amountText);

  return {
    patientName,
    hospitalName,
    policyNo,
    claimNo,
    diagnosisText,
    doctorName,
    amount
  };
}

function classifyDocument({ fileName, text }) {
  const name = norm(fileName);

  if (hasAny(name, ["discharge"]) || hasAny(text, ["discharge summary"])) {
    return { suggestedType: "DISCHARGE_SUMMARY", confidence: 88 };
  }

  if (
    hasAny(name, ["final bill", "invoice", "bill"]) ||
    hasAny(text, ["final bill", "grand total", "net amount", "total amount"])
  ) {
    return { suggestedType: "FINAL_BILL", confidence: 84 };
  }

  if (
    hasAny(name, ["breakup", "itemized", "itemised"]) ||
    hasAny(text, ["particulars", "itemized", "itemised"])
  ) {
    return { suggestedType: "BREAKUP_BILL", confidence: 78 };
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
    hasAny(name, ["aadhaar", "aadhar", "pan", "passport"]) ||
    hasAny(text, ["aadhaar", "aadhar", "permanent account number"])
  ) {
    return { suggestedType: "ID_PROOF", confidence: 80 };
  }

  return { suggestedType: "OTHER", confidence: 55 };
}

export async function analyzeDocument({ fileName, mimeType, path: filePath }) {
  let rawText = "";
  let ocrProvider = "none";

  try {
    rawText = await extractTextWithTextract({
      filePath,
      fileName,
      mimeType
    });

    if (rawText?.trim()) {
      ocrProvider = "AWS_TEXTRACT";
    }
  } catch (error) {
    console.error("Textract failed:", error.message);
  }

  if (!rawText || rawText.length < 40) {
    const pdfText = await extractPdfText(filePath);
    if (pdfText?.trim()) {
      rawText = pdfText;
      ocrProvider = "PDF_PARSE";
    }
  }

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
    ocrProvider
  };
}