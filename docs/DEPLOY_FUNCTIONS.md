# Deploying Firebase Functions

Functions deploy automatically via `.github/workflows/deploy-functions.yml` on
every push to `main` that touches `functions/**`, `firebase.json`, or
`.firebaserc` (or manually from the Actions tab → "Deploy Firebase Functions"
→ Run workflow).

Authentication uses **Workload Identity Federation** (keyless) because the
organization policy `iam.disableServiceAccountKeyCreation` blocks service
account key downloads. No secret keys are stored anywhere.

## One-time setup

Prerequisite: a service account `github-functions-deploy` in project
`im-rounding-tracker` with roles Cloud Functions Admin, Service Account User,
and Firebase Admin.

1. Open Cloud Shell: https://shell.cloud.google.com/?project=im-rounding-tracker
2. Paste the whole block below and press Enter (authorize if prompted):

```bash
gcloud config set project im-rounding-tracker

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com

gcloud iam workload-identity-pools create github-pool \
  --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github-pool \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='eric1999880401-bit/im-rounding-tracker'"

PROJECT_NUMBER=$(gcloud projects describe im-rounding-tracker --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding \
  github-functions-deploy@im-rounding-tracker.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/eric1999880401-bit/im-rounding-tracker"

echo ""
echo "===== COPY THE LINE BELOW ====="
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
```

3. Copy the final output line (`projects/1234.../providers/github-provider`).
4. In GitHub: repo → Settings → Secrets and variables → Actions →
   **Variables** tab → New repository variable:
   - Name: `WORKLOAD_IDENTITY_PROVIDER`
   - Value: the line you copied
   (This is a Variable, not a Secret — it is an identifier, not a credential.)

## How it works

The workflow's `id-token: write` permission lets GitHub mint an OIDC token for
the workflow run; the Workload Identity Provider only trusts tokens whose
`repository` claim equals `eric1999880401-bit/im-rounding-tracker`, and
exchanges them for short-lived credentials to impersonate
`github-functions-deploy`. Nothing long-lived exists to leak.

## Notes

- `OPENAI_API_KEY` stays in Firebase Functions Secret Manager (set once with
  `firebase functions:secrets:set OPENAI_API_KEY`); deploys reuse it.
- Local manual deploy still works: `npx firebase-tools deploy --only functions`
  after `npx firebase-tools login`.
- The workflow fails fast with a clear error if the variable is missing.
