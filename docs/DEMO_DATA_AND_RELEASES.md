# PRISM demo data, backup, and release operations

## Demo dataset

PRISM has a deterministic synthetic UAT dataset for client demos. It creates **60 synthetic claims** across 12 workflow scenarios, five claims per scenario:

1. complete / ready
2. incomplete
3. eligibility issue
4. prior authorization issue
5. submitted
6. rejected
7. open denial
8. appeal prepared
9. appeal submitted
10. paid / posted
11. open underpayment
12. recovered

The records include synthetic patients, payer details, service lines, claim amounts, claim statuses, denials/appeals where applicable, payments/underpayments where applicable, and synthetic PDF documents.

The seed replaces only claims whose MRN begins with `DEMO-UAT-`. Other claims are preserved.

### Seed on the Hostinger demo VPS

The VPS seed is fail-closed. It runs only when all of these are true:

- `NODE_ENV=demo`
- database host is the internal Compose service `db`
- database name is `prism`
- the one-shot environment flag `DEMO_UAT_SEED_ALLOWED=true` is supplied

Run:

```bash
cd /opt/jellygit/prism

docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml exec -T   -e DEMO_UAT_SEED_ALLOWED=true   api npm run seed:demo-uat
```

This is synthetic demo/UAT data only. Do not use real PHI.

## Backup policy for hosted releases

One-time VPS setup:\n\n```bash\nsudo mkdir -p /opt/jellygit/backups/prism\nsudo chown -R deploy:deploy /opt/jellygit/backups\n```\n\nBefore every manual hosted release, create a backup containing:

- PostgreSQL custom-format dump
- synthetic uploaded documents
- current Git SHA
- current Compose service status

Run:

```bash
cd /opt/jellygit/prism
bash deploy/backup-prism-demo.sh
```

Backups are stored under:

```text
/opt/jellygit/backups/prism/YYYYMMDDTHHMMSSZ/
```

Do not store `.env.vps` inside release backups.

## Standard manual release

Use:

```bash
cd /opt/jellygit/prism
bash deploy/release-prism-demo.sh
```

The release script:

1. backs up current database + synthetic uploads
2. pulls `main`
3. rebuilds images
4. starts the updated stack
5. waits for API readiness
6. prints final container status

## Restore

List backups:

```bash
ls -lah /opt/jellygit/backups/prism
```

Restore a specific snapshot:

```bash
cd /opt/jellygit/prism
bash deploy/restore-prism-demo.sh /opt/jellygit/backups/prism/<timestamp>
```

The restore script requires typing `RESTORE` before it replaces the current demo database and synthetic uploads.

## Pre-demo verification

Before a client demo:

```bash
curl --fail https://api-prism.jellygit.com/health/ready
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml ps
```

Then verify in the browser:

- login
- Claims list has synthetic records
- claim search/filter works
- open a professional claim
- open an institutional claim
- upload a synthetic PDF
- create/update a claim from synthetic data
- denial workspace
- appeal/recovery history
- revenue recovery list

Keep the demo environment synthetic-only.
