ALTER TABLE "AuditEvent"
ADD COLUMN "ipAddress" TEXT,
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "httpMethod" TEXT,
ADD COLUMN "httpPath" TEXT,
ADD COLUMN "requestId" TEXT,
ADD COLUMN "statusCode" INTEGER;

CREATE INDEX "AuditEvent_ipAddress_idx" ON "AuditEvent"("ipAddress");
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");
