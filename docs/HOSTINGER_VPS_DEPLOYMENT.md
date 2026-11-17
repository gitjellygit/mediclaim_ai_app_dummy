# PRISM on the JellyGit Hostinger VPS

This deployment is designed to coexist with HRMS on the same VPS.

## Isolation

- Install path: `/opt/jellygit/prism`
- Compose project: `prism-demo`
- Frontend listens only on host loopback: `127.0.0.1:5174`
- API listens only on host loopback: `127.0.0.1:4001`
- PostgreSQL is private to the PRISM Docker network and is not exposed on the host.
- Persistent volumes are separate from HRMS.
- Caddy remains the only public listener on ports 80/443.

## Intended environment

This VPS configuration is a **demo/UAT deployment for synthetic data only**.

It deliberately runs `NODE_ENV=demo` so local document storage is allowed for synthetic demo files. A real PHI production deployment must use the production security/HIPAA checklist and S3 document storage.

## DNS

Create A records pointing to the existing Hostinger VPS:

- `prism.jellygit.com`
- `api-prism.jellygit.com`

Do not expose Docker database or application ports publicly.

## First deployment

On the VPS:

```bash
sudo mkdir -p /opt/jellygit/prism
sudo chown deploy:deploy /opt/jellygit/prism

cd /opt/jellygit/prism
git clone https://github.com/gitjellygit/mediclaim_ai_app_dummy.git .
git checkout main

cp .env.vps.example .env.vps
nano .env.vps
```

Set long random values for:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- demo user passwords if demo users will be seeded

Then start PRISM:

```bash
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml build
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml up -d
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml ps
```

The API starts with `npm run start:prepared`, which generates the Prisma client and applies committed database migrations before Node starts.

## Caddy

Merge the contents of `deploy/Caddyfile.prism.example` into `/etc/caddy/Caddyfile`, keeping the existing HRMS entries intact.

Then:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will manage HTTPS certificates automatically once DNS resolves to the VPS.

## Verify

From the VPS:

```bash
curl -I http://127.0.0.1:5174
curl http://127.0.0.1:4001/health/ready
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml ps
```

From a browser:

- `https://prism.jellygit.com`
- `https://api-prism.jellygit.com/health/ready`

## Seed synthetic demo users

Only after the application is healthy:

```bash
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml exec api node prisma/seed.js
```

Do not use real patient data.

## Updates

```bash
cd /opt/jellygit/prism
git checkout main
git pull --ff-only

docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml build
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml up -d
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml ps
```

## Logs

```bash
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml logs -f --tail=200 api
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml logs -f --tail=200 web
```

## Stop without deleting data

```bash
docker compose -p prism-demo --env-file .env.vps -f docker-compose.vps.yml down
```

Never use `down -v` unless you intentionally want to delete the PRISM database and uploaded demo documents.
