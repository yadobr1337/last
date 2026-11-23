# 1VPN

Website and customer dashboard for the 1VPN service, built with Next.js 16,
NextAuth, Prisma, and SQLite.

## Local development

Use Node.js 22 for the integration and HTTP tests.

```bash
cp .env.example .env
npm ci
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

Open `http://localhost:3000`.

## Checks

```bash
npm run lint
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm test
npm run build
npm run test:http
```

## Production

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Ubuntu, Nginx, HTTPS, and update
instructions for `the1vpn.ru`.
Use [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for the first migration of
a database previously managed by `db push`, backups and rollback.
