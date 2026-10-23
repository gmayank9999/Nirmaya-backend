# Production deployment

- Account: `gmayank9999`
- Scope: `mayank-guptas-projects-8b90d0e8`
- Project: `nirmaya-backend`
- API base: `https://nirmaya-backend.vercel.app/api`
- Health check: `https://nirmaya-backend.vercel.app/api/health/health`
- Dashboard: `https://vercel.com/mayank-guptas-projects-8b90d0e8/nirmaya-backend`

This project uses the existing Supabase database and storage. Production runtime
variables are stored as sensitive Vercel environment variables. `.env` files are
excluded from deployments and source control. Never put server credentials in
the Flutter app.

## Deploy updates

Run from `backend/Nirmaya-v2`:

```sh
npm test
npm run build
vercel deploy --prod --scope mayank-guptas-projects-8b90d0e8
```

For a fresh checkout, first run `vercel login`, then:

```sh
vercel link --project nirmaya-backend --scope mayank-guptas-projects-8b90d0e8
```

The initial deployment was made with the CLI. Git push does not automatically
deploy until a repository is connected in the project's Git settings.

## Flutter app

The app defaults to the production API. Fully restart/rebuild it after changing
the URL: the API client retains its connection settings through hot reload.

To temporarily use a local backend, run from `Nirmaya`:

```sh
flutter run --dart-define=API_BASE_URL=http://YOUR_LOCAL_IP:3001/api
```

For production, omit that override:

```sh
flutter run
```

Health checks verify database connectivity. Authenticated patient workflows and
document uploads should also be checked on the phone after installing the app.
