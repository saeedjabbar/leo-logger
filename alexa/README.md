# Alexa setup

The Azure endpoint validates Amazon's certificate signature, request timestamp, application ID, and request ID. Voice entries are attributed to the admin configured with `ALEXA_USER_EMAIL` and use that account's default baby.

1. Install and authenticate the ASK CLI: `npm install -g ask-cli`, then `ask configure`.
2. Deploy this folder with `cd alexa && ask smapi create-skill-for-vendor -f skill-package/skill.json` or create a private custom skill in the Amazon Developer Console.
3. Replace `REPLACE_WITH_AZURE_FQDN` in `skill-package/skill.json` with the deployed Container Apps hostname and deploy the interaction model.
4. Copy the resulting skill ID and run `ALEXA_SKILL_ID=amzn1.ask.skill... ../infra/configure-alexa.sh`.
5. Enable the development skill on the Amazon account connected to the Echo and test the sample phrases.

Amazon requires its Developer Console or ASK credentials; Azure CLI cannot create the Amazon-side skill.
