# Deploy backend to Azure App Service

One-time setup (Azure CLI — `brew install azure-cli`, then `az login`):

```bash
# 1. Resource group (reuse your existing one if you have it)
az group create -n bisleri-rg -l centralindia

# 2. App Service plan (Linux, Basic B1 ≈ ₹1k/month; F1 free tier also works for demo)
az appservice plan create -n bisleri-plan -g bisleri-rg --sku B1 --is-linux

# 3. The web app (pick a globally-unique name — this becomes your URL)
az webapp create -n bisleri-vansales-api -g bisleri-rg -p bisleri-plan --runtime "NODE:20-lts"

# 4. Environment variables (secrets live HERE, not in a deployed .env file)
az webapp config appsettings set -n bisleri-vansales-api -g bisleri-rg --settings \
  DATABASE_URL="postgres://vansales:Zoxima%402026@bislerivansales.postgres.database.azure.com:5432/bisleri_vansales?sslmode=require" \
  JWT_SECRET="change-me-to-a-long-random-string" \
  INVOICE_BLOCK_SIZE="70" \
  OPENAI_API_KEY="<your azure openai key>" \
  OPENAI_MODEL="gpt-5.6-terra" \
  AZURE_OPENAI_ENDPOINT="https://bislerivansales.cognitiveservices.azure.com" \
  SCM_DO_BUILD_DURING_DEPLOYMENT="true"

# 5. Startup command
az webapp config set -n bisleri-vansales-api -g bisleri-rg --startup-file "node dist/main.js"
```

Every deploy (from this `backend/` folder):

```bash
zip -r deploy.zip . -x "node_modules/*" -x "dist/*" -x ".env"
az webapp deploy -n bisleri-vansales-api -g bisleri-rg --type zip --src-path deploy.zip
```

Azure (Oryx) runs `npm install` + `npm run build` on the server automatically.

Verify:

```bash
curl -s -X POST https://bisleri-vansales-api.azurewebsites.net/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"kamlesh@bisleri.demo","password":"bisleri@123","deviceId":"check"}'
```

Then point the app at it: in `../frontend/src/lib/config.ts` set

```ts
export const SERVER_URL = 'https://bisleri-vansales-api.azurewebsites.net';
```

and build the APK: `cd ../frontend && npm run apk`.

Notes
- The database firewall: Azure Portal → your PostgreSQL server → Networking →
  enable "Allow public access from any Azure service" so App Service can reach it.
- One bonus of deploying: the "ETIMEDOUT" worker warnings disappear — App Service
  and the database are inside Azure together.
