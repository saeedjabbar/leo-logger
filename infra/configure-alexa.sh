#!/usr/bin/env bash
set -euo pipefail
: "${ALEXA_SKILL_ID:?Set ALEXA_SKILL_ID after creating the Alexa skill}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-leo-logger}"
APP_NAME="${APP_NAME:-leo-logger}"
az containerapp update --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --set-env-vars "ALEXA_SKILL_ID=${ALEXA_SKILL_ID}" --output none
FQDN="$(az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query properties.configuration.ingress.fqdn -o tsv)"
printf 'Set the Alexa skill endpoint to https://%s/api/alexa\n' "$FQDN"
