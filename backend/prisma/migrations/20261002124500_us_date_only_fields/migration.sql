-- U5: persist claim calendar values as PostgreSQL DATE to prevent timezone day shifts.

ALTER TABLE "Claim"
  ALTER COLUMN "patientDob" TYPE DATE USING "patientDob"::date,
  ALTER COLUMN "admissionDate" TYPE DATE USING "admissionDate"::date,
  ALTER COLUMN "dischargeDate" TYPE DATE USING "dischargeDate"::date,
  ALTER COLUMN "procedureDate" TYPE DATE USING "procedureDate"::date,
  ALTER COLUMN "dateOfService" TYPE DATE USING "dateOfService"::date,
  ALTER COLUMN "policyStartDate" TYPE DATE USING "policyStartDate"::date,
  ALTER COLUMN "policyEndDate" TYPE DATE USING "policyEndDate"::date,
  ALTER COLUMN "timelyFilingDeadline" TYPE DATE USING "timelyFilingDeadline"::date;

ALTER TABLE "ServiceLine"
  ALTER COLUMN "serviceDateFrom" TYPE DATE USING "serviceDateFrom"::date,
  ALTER COLUMN "serviceDateTo" TYPE DATE USING "serviceDateTo"::date;
