#!/usr/bin/env bash
set -euo pipefail

: "${BOOTSTRAP_PASSWORD:?Set BOOTSTRAP_PASSWORD to a strong temporary password (12+ characters)}"
: "${SESSION_SECRET:?Set SESSION_SECRET to at least 32 random characters}"
: "${VAPID_PUBLIC_KEY:?Set VAPID_PUBLIC_KEY using npx web-push generate-vapid-keys}"
: "${VAPID_PRIVATE_KEY:?Set VAPID_PRIVATE_KEY using npx web-push generate-vapid-keys}"

LOCATION="${LOCATION:-eastus2}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-leo-logger}"
APP_NAME="${APP_NAME:-leo-logger}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-cae-leo-logger}"
SUBSCRIPTION_COMPACT="$(az account show --query id -o tsv | tr -d '-' | cut -c1-8)"
REGISTRY_NAME="${REGISTRY_NAME:-leologger${SUBSCRIPTION_COMPACT}}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-leologger${SUBSCRIPTION_COMPACT}}"
IMAGE_TAG="${IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
if ! az acr show --name "$REGISTRY_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az acr create --name "$REGISTRY_NAME" --resource-group "$RESOURCE_GROUP" --sku Basic --admin-enabled false --output none
fi
if ! az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az storage account create --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku Standard_GRS --kind StorageV2 --allow-blob-public-access false --output none
fi
if ! az containerapp env show --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az containerapp env create --name "$ENVIRONMENT_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --output none
fi
if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az containerapp create \
    --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --environment "$ENVIRONMENT_NAME" \
    --image mcr.microsoft.com/k8se/quickstart:latest --target-port 80 --ingress external \
    --system-assigned --min-replicas 1 --max-replicas 1 --cpu 0.25 --memory 0.5Gi --output none
fi

PRINCIPAL_ID="$(az containerapp identity show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query principalId -o tsv)"
ACR_ID="$(az acr show --name "$REGISTRY_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
STORAGE_ID="$(az storage account show --name "$STORAGE_ACCOUNT" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role AcrPull --scope "$ACR_ID" --output none
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Storage Table Data Contributor" --scope "$STORAGE_ID" --output none

az acr build --registry "$REGISTRY_NAME" --image "leo-logger:${IMAGE_TAG}" .
FQDN="$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
az containerapp registry set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --server "${REGISTRY_NAME}.azurecr.io" --identity system --output none
az containerapp secret set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --secrets "bootstrap-password=${BOOTSTRAP_PASSWORD}" "session-secret=${SESSION_SECRET}" "vapid-private-key=${VAPID_PRIVATE_KEY}" --output none

ENV_VARS=(
  "NODE_ENV=production" "PORT=3000" "STORE_MODE=azure" "AZURE_STORAGE_ACCOUNT=${STORAGE_ACCOUNT}"
  "AZURE_TABLE_NAME=leologger" "APP_ORIGIN=https://${FQDN}" "RP_ID=${FQDN}"
  "BOOTSTRAP_ADMINS=${BOOTSTRAP_ADMINS:-admin@example.com:Admin}"
  "BOOTSTRAP_PASSWORD=secretref:bootstrap-password" "SESSION_SECRET=secretref:session-secret"
  "VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}" "VAPID_PRIVATE_KEY=secretref:vapid-private-key" "VAPID_SUBJECT=${VAPID_SUBJECT:-mailto:admin@example.com}"
  "ALEXA_USER_EMAIL=${ALEXA_USER_EMAIL:-admin@example.com}"
)
if [[ -n "${ALEXA_SKILL_ID:-}" ]]; then ENV_VARS+=("ALEXA_SKILL_ID=${ALEXA_SKILL_ID}"); fi
if [[ -n "${AZURE_OPENAI_ENDPOINT:-}" && -n "${AZURE_OPENAI_DEPLOYMENT:-}" ]]; then
  ENV_VARS+=("AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}" "AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}")
fi
if [[ -n "${AZURE_SPEECH_ENDPOINT:-}" && -n "${AZURE_SPEECH_RESOURCE_ID:-}" ]]; then
  ENV_VARS+=("AZURE_SPEECH_ENDPOINT=${AZURE_SPEECH_ENDPOINT}" "AZURE_SPEECH_RESOURCE_ID=${AZURE_SPEECH_RESOURCE_ID}")
fi
if [[ -n "${AZURE_OPENAI_RESOURCE_ID:-}" ]]; then
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Cognitive Services OpenAI User" --scope "$AZURE_OPENAI_RESOURCE_ID" --output none
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope "$AZURE_OPENAI_RESOURCE_ID" --output none
fi
if [[ -n "${AZURE_SPEECH_RESOURCE_ID:-}" && "${AZURE_SPEECH_RESOURCE_ID:-}" != "${AZURE_OPENAI_RESOURCE_ID:-}" ]]; then
  az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope "$AZURE_SPEECH_RESOURCE_ID" --output none
fi

az containerapp ingress update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --target-port 3000 --output none
az containerapp update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --image "${REGISTRY_NAME}.azurecr.io/leo-logger:${IMAGE_TAG}" \
  --set-env-vars "${ENV_VARS[@]}" --output none

for attempt in {1..30}; do
  if curl --fail --silent "https://${FQDN}/health" >/dev/null; then break; fi
  sleep 5
done
curl --fail "https://${FQDN}/health"
printf '\nLeo Logger: https://%s\n' "$FQDN"
