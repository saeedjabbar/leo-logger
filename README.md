# Leo Logger

A family-only, mobile-first PWA for logging baby feeds, diapers, and sleep. It includes caregiver PIN enrollment, multi-baby support, admin passkeys, offline event queuing, Huckleberry CSV import, analytics, and an Alexa custom skill endpoint.

## Local development

Requirements: Node.js 22+.

```bash
cp .env.example .env
# Set a 12+ character BOOTSTRAP_PASSWORD and 32+ character SESSION_SECRET.
set -a && source .env && set +a
npm install
npm run dev
```

Open `http://localhost:5173`. On first start, the configured admins are created with the temporary bootstrap password. Each should change it and register a passkey from Admin → Settings.

## Production deployment

The deployment uses an ACR remote build, so local Docker is not required.

```bash
VAPID_KEYS="$(npx web-push generate-vapid-keys --json)"
export VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_KEYS" | jq -r .publicKey)"
export VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_KEYS" | jq -r .privateKey)"
export BOOTSTRAP_PASSWORD='a-strong-temporary-password'
export SESSION_SECRET="$(openssl rand -base64 48)"
./infra/deploy.sh
```

The script provisions a GRS Storage account, ACR, Container Apps environment, managed identity roles, and one always-warm replica in `eastus2`. Import `data.csv` from Admin → History after signing in; the file is intentionally excluded from the Docker image.

Each baby has a configurable feeding interval. Family members enable push reminders per device by tapping the bell on the logger. On iPhone, install the PWA with Safari → Share → Add to Home Screen before enabling notifications.

After both admins change their temporary password, rotate or remove the bootstrap secret in Azure. Add Alexa using [alexa/README.md](alexa/README.md).

## Commands

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm start`

# leo-logger
