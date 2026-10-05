-- Add organizationId to Rule model for tenant isolation
-- Existing rules will be assigned to the first organization found

-- First, find or create a default organization for existing rules
DO $$
DECLARE
  default_org_id TEXT;
BEGIN
  -- Try to find an existing organization
  SELECT id INTO default_org_id FROM "Organization" LIMIT 1;
  
  -- If no organization exists, create one
  IF default_org_id IS NULL THEN
    INSERT INTO "Organization" (id, name, slug, "createdAt", "updatedAt")
    VALUES ('org_default_migration', 'Default Organization (Migration)', 'org-default-migration', NOW(), NOW())
    RETURNING id INTO default_org_id;
  END IF;
  
  -- Add the column nullable first
  ALTER TABLE "Rule" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
  
  -- Update existing rules to use the default organization
  UPDATE "Rule" SET "organizationId" = default_org_id WHERE "organizationId" IS NULL;
  
  -- Now make it NOT NULL
  ALTER TABLE "Rule" ALTER COLUMN "organizationId" SET NOT NULL;
END $$;

-- Drop the old unique constraint on code alone
ALTER TABLE "Rule" DROP CONSTRAINT IF EXISTS "Rule_code_key";

-- Add the new composite unique constraint
ALTER TABLE "Rule"
ADD CONSTRAINT "Rule_organizationId_code_key" UNIQUE ("organizationId", "code");

-- Add the foreign key constraint
ALTER TABLE "Rule"
ADD CONSTRAINT "Rule_organizationId_fkey"
FOREIGN KEY ("organizationId")
REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Add index for organizationId
CREATE INDEX IF NOT EXISTS "Rule_organizationId_idx" ON "Rule"("organizationId");

-- NOTE: After migration, existing rules should be reassigned to their actual organizations
-- This may require a data migration script based on your production data
