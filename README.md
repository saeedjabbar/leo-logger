# Leo Logger

A privacy-minded, mobile-first PWA for logging baby feeds, diapers, and sleep. It includes natural-language text and voice logging, AI-assisted insights, caregiver PIN enrollment, multi-baby support, admin passkeys, push reminders, offline event queuing, Huckleberry CSV import, analytics, and an Alexa custom skill endpoint.

## Highlights

- One-tap logging plus phrases such as “I fed him 2 oz at 2:10am.”
- Feeding intervals, per-device alerts, and the optional 15-minute upright reminder live together under Admin → Schedules.
- Admin → Babies supports adding and safely removing baby profiles while preserving historical activity.
- Admins can tap the baby name on Home to edit the baby’s name, birth date, and timezone.
- Tap a recent activity or its relative time to correct the exact time and details; caregiver edits are limited to entries they logged.
- Caregiver devices live-update through a private event stream, with focus and periodic refresh fallbacks for suspended mobile PWAs.
- Pull down from the top of the home logger for a manual mobile refresh.
- Ask questions about authorized baby data, such as “What patterns do you see this week?”
- An on-demand seven-day AI summary is available directly on the caregiver logger without opening Admin.
- Admin Insights includes on-demand Azure AI analysis for the selected 7, 14, or 30-day chart range.
- Azure Speech transcription and Azure OpenAI interpretation use managed identity—there is no API-key or bring-your-own-provider path.
- A built-in parser keeps common feed and diaper phrases working when Azure AI is not configured.
- Real caregiver exports are deliberately ignored by Git. Use synthetic data in tests and issues.

## Local development

Requirements: Node.js 22+.

```bash
cp .env.example .env
# Set a 12+ character BOOTSTRAP_PASSWORD and 32+ character SESSION_SECRET.
set -a && source .env && set +a
npm install
npm run dev
```

Open `http://localhost:5173`. On first start, the accounts in `BOOTSTRAP_ADMINS` are created with the temporary bootstrap password. Each admin should change it and register a passkey from Admin → Settings.

For AI features, set the Azure OpenAI deployment and the Azure Speech custom-domain endpoint/resource ID shown below. Local development authenticates with `az login`; production uses the Container App managed identity. API keys and third-party model endpoints are intentionally unsupported.

## Production deployment

The deployment uses an ACR remote build, so local Docker is not required.

```bash
VAPID_KEYS="$(npx web-push generate-vapid-keys --json)"
export VAPID_PUBLIC_KEY="$(printf '%s' "$VAPID_KEYS" | jq -r .publicKey)"
export VAPID_PRIVATE_KEY="$(printf '%s' "$VAPID_KEYS" | jq -r .privateKey)"
export BOOTSTRAP_PASSWORD='a-strong-temporary-password'
export BOOTSTRAP_ADMINS='parent@example.com:Parent'
export SESSION_SECRET="$(openssl rand -base64 48)"
export AZURE_OPENAI_ENDPOINT='https://your-resource.cognitiveservices.azure.com'
export AZURE_OPENAI_DEPLOYMENT='your-direct-from-azure-deployment'
export AZURE_OPENAI_RESOURCE_ID='/subscriptions/.../providers/Microsoft.CognitiveServices/accounts/...'
export AZURE_SPEECH_ENDPOINT='https://your-resource.cognitiveservices.azure.com'
export AZURE_SPEECH_RESOURCE_ID='/subscriptions/.../providers/Microsoft.CognitiveServices/accounts/...'
./infra/deploy.sh
```

The script provisions a GRS Storage account, ACR, Container Apps environment, managed identity roles, and one always-warm replica in `eastus2`. Import a Huckleberry export from Admin → History after signing in; CSV exports are excluded from Git and the Docker image.

Only models sold and billed directly by Azure should be configured. Microsoft states those models are eligible for startup credits, while partner, community, and Azure Marketplace models are not. This project does not integrate Anthropic, partner catalogs, Marketplace offers, or user-supplied API keys.

Each baby has a configurable feeding interval under Admin → Schedules. Enable push alerts there on each device. On iPhone, install the PWA with Safari → Share → Add to Home Screen before enabling notifications.

After admins change their temporary password, rotate or remove the bootstrap secret in Azure. Add Alexa using [alexa/README.md](alexa/README.md).

## Commands

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm start`

## License

MIT
