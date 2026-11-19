import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const releases = [
  {
    system: "ICD10_CM",
    version: "E2E-2026",
    source: "SYNTHETIC_E2E_REFERENCE",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
    definitions: [
      "Z00.00",
      "Z00.01",
      "M54.50",
      "J18.9"
    ]
  },
  {
    system: "CPT_HCPCS",
    version: "E2E-2026",
    source: "SYNTHETIC_E2E_REFERENCE",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
    definitions: [
      "99213",
      "99214",
      "99215",
      "97110",
      "93000",
      "80053",
      "36415"
    ]
  }
];

try {
  for (const item of releases) {
    const release = await prisma.codeSetRelease.upsert({
      where: {
        system_version: {
          system: item.system,
          version: item.version
        }
      },
      update: {
        source: item.source,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        authoritative: true
      },
      create: {
        system: item.system,
        version: item.version,
        source: item.source,
        effectiveFrom: item.effectiveFrom,
        effectiveTo: item.effectiveTo,
        authoritative: true
      }
    });

    await prisma.codeDefinition.deleteMany({
      where: { releaseId: release.id }
    });

    await prisma.codeDefinition.createMany({
      data: item.definitions.map((code) => ({
        releaseId: release.id,
        code,
        description: "Synthetic E2E reference code",
        billable: true,
        activeFrom: item.effectiveFrom,
        activeTo: item.effectiveTo
      }))
    });
  }

  console.log("Synthetic E2E authoritative code references seeded.");
} finally {
  await prisma.$disconnect();
}
