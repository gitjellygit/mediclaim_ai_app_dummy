import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse"); // Add PDF parsing library

const DOC_TYPES = [
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

function norm(s) {
  return (s || "").toLowerCase();
}

function hasAny(text, keywords) {
  const t = norm(text);
  return keywords.some((k) => t.includes(k));
}

// Enhanced field extraction patterns for medical reports
const extractPatterns = {
  patientName: [
    /Patient\s*Name\s*[:\-]\s*([^\n\r]+)/i,
    /Customer\s*Name\s*[:\-]\s*([^\n\r]+)/i,
    /Name\s*of\s*Patient\s*[:\-]\s*([^\n\r]+)/i,
    /Patient\s*[:\-]\s*([^\n\r]+)/i,
    /Name\s*[:\-]\s*([^\n\r]+)/i,
  ],
  ageGender: [
    /Age\/Gender\s*[:\-]\s*([^\n\r]+)/i,
    /Age\s*[:\-]\s*([^\n\r]+)/i,
    /Gender\s*[:\-]\s*([^\n\r]+)/i,
  ],
  reportDate: [
    /Report\s*Date\s*[:\-]\s*([^\n\r]+)/i,
    /Date\s*[:\-]\s*([^\n\r]+)/i,
    /Collected\s*Date\s*[:\-]\s*([^\n\r]+)/i,
  ],
  orderId: [
    /Barcode\s*ID\/Order\s*ID\s*[:\-]\s*([^\n\r]+)/i,
    /Order\s*ID\s*[:\-]\s*([^\n\r]+)/i,
    /Sample\s*ID\s*[:\-]\s*([^\n\r]+)/i,
  ],
  sampleType: [
    /Sample\s*Type\s*[:\-]\s*([^\n\r]+)/i,
    /Test\s*Name\s*[:\-]\s*([^\n\r]+)/i,
  ],
  amount: [
    /Total\s*Amount\s*[:\-]\s*([^\n\r]+)/i,
    /Amount\s*[:\-]\s*([^\n\r]+)/i,
    /Total\s*[:\-]\s*([^\n\r]+)/i,
    /₹\s?([0-9,]{3,})/i,
    /\brs\.?\s?([0-9,]{3,})/i,
    /\binr\s?([0-9,]{3,})/i,
  ]
};

// Enhanced field extraction function
function extractFields(text) {
  const t = text || "";
  const extracted = {};

  Object.keys(extractPatterns).forEach(field => {
    const patterns = extractPatterns[field];
    for (const pattern of patterns) {
      const match = t.match(pattern);
      if (match && match[1]) {
        extracted[field] = match[1].trim();
        break; // Use first match found
      }
    }
  });

  return extracted;
}

// PDF text extraction with OCR fallback
async function extractPdfText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } catch (error) {
    console.error("PDF parsing failed:", error);
    return "";
  }
}

// OCR fallback (placeholder - would need Tesseract or similar)
async function runOcr(filePath) {
  // TODO: Implement OCR using Tesseract.js or similar
  console.log("OCR fallback needed for:", filePath);
  return "OCR extraction not implemented yet";
}

export async function analyzeDocument({ fileName, mimeType, path }) {
  const name = norm(fileName);
  const mt = norm(mimeType);

  let finalText = "";
  let extractionSource = "unknown";

  // Handle PDF files with proper text extraction
  if (mt.includes("pdf") || name.endsWith(".pdf")) {
    const pdfText = await extractPdfText(path);
    
    if (pdfText && pdfText.length > 80) {
      finalText = pdfText;
      extractionSource = "pdf-text";
    } else {
      // OCR fallback for scanned/image-based PDFs
      const ocrText = await runOcr(path);
      finalText = ocrText;
      extractionSource = "ocr";
    }
  }
  // Handle text files (only actual text files, not PDFs)
  else if (mt.includes("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    try {
      const raw = fs.readFileSync(path, "utf8");
      finalText = raw.slice(0, 20000);
      extractionSource = "text-file";
    } catch (error) {
      console.error("Text file reading failed:", error);
    }
  }

  // Classification rules (enhanced)
  let suggestedType = "OTHER";
  let confidence = 55;

  if (hasAny(name, ["discharge", "summary"]) || hasAny(finalText, ["discharge summary"])) {
    suggestedType = "DISCHARGE_SUMMARY";
    confidence = 85;
  } else if (hasAny(name, ["final bill", "finalbill", "invoice", "bill"]) || hasAny(finalText, ["final bill", "total payable"])) {
    suggestedType = "FINAL_BILL";
    confidence = 80;
  } else if (hasAny(name, ["breakup", "itemized", "itemised"]) || hasAny(finalText, ["itemized", "itemised", "particulars"])) {
    suggestedType = "BREAKUP_BILL";
    confidence = 75;
  } else if (hasAny(name, ["lab", "pathology", "report"]) || hasAny(finalText, ["laboratory", "pathology", "report date", "sample type"])) {
    suggestedType = "LAB_REPORT";
    confidence = 72;
  } else if (hasAny(name, ["xray", "ct", "mri", "radiology"]) || hasAny(finalText, ["radiology", "impression"])) {
    suggestedType = "RADIOLOGY";
    confidence = 70;
  } else if (hasAny(name, ["prescription", "rx"]) || hasAny(finalText, ["prescription", "rx"])) {
    suggestedType = "PRESCRIPTION";
    confidence = 70;
  } else if (hasAny(name, ["aadhar", "aadhaar", "pan", "passport", "voter"]) || hasAny(finalText, ["aadhaar", "aadhar", "pan"])) {
    suggestedType = "ID_PROOF";
    confidence = 78;
  } else if (hasAny(name, ["insurance card", "e-card", "ecard"]) || hasAny(finalText, ["insurance card", "e-card"])) {
    suggestedType = "INSURANCE_CARD";
    confidence = 76;
  }

  // Enhanced field extraction
  const extracted = extractFields(finalText);

  // Calculate extraction confidence based on fields found
  const fieldsFound = Object.keys(extracted).length;
  const extractionConfidence = Math.min(95, 50 + (fieldsFound * 10));

  return { 
    suggestedType, 
    confidence, 
    extracted,
    rawExtractedText: finalText,
    extractionConfidence,
    extractionSource
  };
}

export { DOC_TYPES };