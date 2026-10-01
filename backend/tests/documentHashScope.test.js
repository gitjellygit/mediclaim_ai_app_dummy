import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db.js";

const TEST_ORG_ID = "org_test_f8_document_hash";
const createdClaimIds = [];

after(async () => {
  if (createdClaimIds.length) {
    await prisma.document.deleteMany({ where: { claimId: { in: createdClaimIds } } });
    await prisma.claim.deleteMany({ where: { id: { in: createdClaimIds } } });
  }
  await prisma.organization.deleteMany({ where: { id: TEST_ORG_ID } });
});

test("F8 - document file hashes are unique per claim, not globally", async () => {
  await prisma.organization.upsert({
    where: { id: TEST_ORG_ID },
    update: {},
    create: {
      id: TEST_ORG_ID,
      name: "F8 Document Hash Test",
      slug: "f8-document-hash-test"
    }
  });

  const [claimA, claimB] = await Promise.all([
    prisma.claim.create({
      data: {
        organizationId: TEST_ORG_ID,
        patientName: "F8 Patient A",
        payerName: "F8 Payer"
      }
    }),
    prisma.claim.create({
      data: {
        organizationId: TEST_ORG_ID,
        patientName: "F8 Patient B",
        payerName: "F8 Payer"
      }
    })
  ]);
  createdClaimIds.push(claimA.id, claimB.id);

  const sharedHash = "f8-shared-hash";

  await prisma.document.create({
    data: {
      claimId: claimA.id,
      type: "OTHER",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      path: "a.pdf",
      fileHash: sharedHash
    }
  });

  await assert.rejects(
    prisma.document.create({
      data: {
        claimId: claimA.id,
        type: "OTHER",
        fileName: "a-copy.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1,
        path: "a-copy.pdf",
        fileHash: sharedHash
      }
    }),
    (error) => error?.code === "P2002"
  );

  const crossClaim = await prisma.document.create({
    data: {
      claimId: claimB.id,
      type: "OTHER",
      fileName: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      path: "b.pdf",
      fileHash: sharedHash
    }
  });

  assert.equal(crossClaim.fileHash, sharedHash);
});

test("F8 - schema and upload routes enforce claim-scoped duplicate detection without cross-claim identifiers", () => {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const schema = fs.readFileSync(path.join(base, "prisma/schema.prisma"), "utf8");
  const documentsRoute = fs.readFileSync(path.join(base, "src/routes/documents.js"), "utf8");

  assert.ok(schema.includes("@@unique([claimId, fileHash])"));
  assert.equal(schema.includes("fileHash    String? @unique"), false);

  assert.ok(documentsRoute.includes("where: { claimId, fileHash }"));
  assert.ok(documentsRoute.includes("where: { claimId: claim.id, fileHash }"));
  assert.ok(documentsRoute.includes("fileHash,"));
  assert.equal(documentsRoute.includes("existingClaimId"), false);
  assert.equal(documentsRoute.includes("existingDocumentId"), false);
});
