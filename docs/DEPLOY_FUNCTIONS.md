# Deploying Firebase Functions

Functions deploy automatically via `.github/workflows/deploy-functions.yml` on
every push to `main` that touches `functions/**`, `firebase.json`, or
`.firebaserc` (or manually from the Actions tab → "Deploy Firebase Functions"
→ Run workflow).

## One-time setup: FIREBASE_SERVICE_ACCOUNT secret

1. Open Google Cloud Console → IAM & Admin → Service Accounts for project
   `im-rounding-tracker`
   (https://console.cloud.google.com/iam-admin/serviceaccounts?project=im-rounding-tracker).
2. Create a service account (e.g. `github-functions-deploy`) and grant it these
   roles:
   - Cloud Functions Admin (`roles/cloudfunctions.admin`)
   - Service Account User (`roles/iam.serviceAccountUser`)
   - Firebase Admin (`roles/firebase.admin`) — simplest way to cover
     Firestore rules and other Firebase resources the CLI checks.
   - Secret Manager Admin or at least Secret Manager Secret Accessor if the
     deploy needs to bind the existing `OPENAI_API_KEY` secret.
3. Create a JSON key for that service account (Keys → Add key → JSON) and
   download it.
4. In GitHub: repo → Settings → Secrets and variables → Actions → New
   repository secret, name `FIREBASE_SERVICE_ACCOUNT`, value = the entire JSON
   file content.

## Notes

- `OPENAI_API_KEY` stays in Firebase Functions Secret Manager (set once with
  `firebase functions:secrets:set OPENAI_API_KEY`); deploys reuse it.
- Local manual deploy still works: `npx firebase-tools deploy --only functions`
  after `firebase login`.
- The workflow fails fast with a clear error if the secret is missing.
