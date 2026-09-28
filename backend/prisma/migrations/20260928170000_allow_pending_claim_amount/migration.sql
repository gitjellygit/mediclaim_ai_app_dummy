-- Allow document-created claims to keep an unknown amount as NULL instead of a fake placeholder value.
ALTER TABLE "Claim" ALTER COLUMN "amount" DROP NOT NULL;
