# IM Rounding Tracker

A React, TypeScript, Vite, Firebase Auth, and Firestore app for tracking internal medicine rounding information.

Use de-identified test data only. Do not commit real patient data, exports, screenshots, printouts, or any `.env` file with real Firebase configuration.

## Local Setup

1. Install Node.js 22 or newer.
2. Install dependencies:

```bash
npm install
```

3. Create a local environment file:

```bash
cp .env.example .env
```

4. Fill in `.env` with your Firebase web app config:

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

5. Start the app:

```bash
npm run dev
```

## GitHub Pages Deployment

This project is configured for GitHub Pages with:

- `HashRouter`, so app routes work at URLs like `https://YOUR-USER.github.io/YOUR-REPO/#/patients`.
- A Vite `base` path that automatically matches the GitHub repository name during GitHub Actions builds.
- A GitHub Actions workflow at `.github/workflows/deploy.yml` that builds the app and deploys `dist` to GitHub Pages.

## Add Firebase Environment Variables to GitHub

GitHub Actions needs the same Firebase web config values that you use locally.

1. Open your GitHub repository.
2. Go to `Settings` > `Secrets and variables` > `Actions`.
3. Click the `Variables` tab.
4. Add these repository variables:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Firebase web app config is included in the browser bundle by design. Do not put Firebase service account keys or other private backend secrets in this app.

## AI Intake Setup

AI Intake adds a Patient Detail tab that organizes de-identified clinical text into a structured SOAP draft. The browser never calls OpenAI directly. The frontend calls the Firebase callable function `analyzeClinicalText`, and that backend function calls the OpenAI Responses API.

Privacy requirements:

- Use de-identified text only.
- Do not send patient name, full MRN, ID number, birthday, phone, address, or identifiable image.
- AI output is draft-only. The clinician must review and explicitly accept items before anything is saved to Firestore.
- By default, the app stores only `rawTextPreview` under `users/{uid}/patients/{patientId}/aiDrafts/{draftId}`. The full raw text is stored only if the user checks the explicit raw-text storage option.

Install Firebase Functions dependencies:

```bash
npm --prefix functions install
npm --prefix functions run build
```

Set the OpenAI API key as a Firebase Functions secret:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

The default model is `gpt-5.4-mini`. To override it, create `functions/.env` locally or set the deployed Functions environment with:

```bash
OPENAI_MODEL=gpt-5.4-mini
```

Deploy backend functions and rules:

```bash
firebase deploy --only functions,firestore:rules
```

Disable AI Intake by leaving `OPENAI_API_KEY` unset. In that state, the AI Intake UI remains visible, but analysis fails with a configuration message and no OpenAI request is made.

Cost control:

- AI calls are never automatic.
- The Analyze button is disabled until the user confirms the pasted text is de-identified.
- Input is limited to 12,000 characters.
- The UI shows an approximate input-token estimate. Actual cost depends on the deployed model and OpenAI pricing.

### Local AI Testing

To test the callable function locally:

1. Install Firebase CLI and sign in.
2. Set a local Functions environment variable or secret for testing.
3. Start emulators:

```bash
firebase emulators:start --only functions,firestore
```

4. In the frontend `.env`, add:

```bash
VITE_USE_FIREBASE_EMULATORS=true
```

5. Start the frontend:

```bash
npm run dev
```

6. Open a de-identified test patient, go to `AI Intake`, paste de-identified sample text, confirm de-identification, then click `Analyze and organize`.

Example de-identified sample:

```text
Progress note 2026/05/10. 73F with HTN and DM admitted for suspected ischemic stroke.
Overnight: no fever, still reports left weakness.
VS: BP 150/82, HR 88, T 36.8, SpO2 96% RA.
PE: Neuro left arm weakness 4/5, speech clear.
Lab 2026/05/10: WBC 12200, Hb 10.1 g/dL (prev 10.8), Cr 1.1 mg/dL, Na 134.
CT brain: right pontine hypodensity, no hemorrhage.
Plan: continue antiplatelet, follow MRI brain, PT evaluation, control BP.
Discharge issue: rehab placement pending.
```

After review, use `Accept`, `Edit`, or `Ignore` on each draft card. Only accepted cards are written when you click `Apply accepted items`.

## Push the Code to GitHub

If this folder is not already connected to GitHub, run:

```bash
git init
git add .
git commit -m "Prepare app for GitHub Pages deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

If the repository already exists locally, use:

```bash
git add .
git commit -m "Prepare app for GitHub Pages deployment"
git push
```

Before committing, check that `.env`, real patient data, exported reports, screenshots, and print files are not staged:

```bash
git status
```

## Enable GitHub Pages

1. Open the GitHub repository.
2. Go to `Settings` > `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Save the setting if GitHub asks you to.
5. Push to the `main` branch, or open `Actions` and manually run `Deploy to GitHub Pages`.

## Check GitHub Actions

1. Open the repository on GitHub.
2. Click the `Actions` tab.
3. Select `Deploy to GitHub Pages`.
4. Open the latest run.
5. Confirm the `Build` and `Deploy` jobs are green.

If the build fails, first check that every `VITE_FIREBASE_*` repository variable exists and has the expected value.

## Open the Deployed Site

After the deploy job finishes, the site will usually be available at:

```text
https://YOUR-USER.github.io/YOUR-REPO/
```

The app routes use hash URLs. Common pages look like:

```text
https://YOUR-USER.github.io/YOUR-REPO/#/patients
https://YOUR-USER.github.io/YOUR-REPO/#/tasks
https://YOUR-USER.github.io/YOUR-REPO/#/archive
https://YOUR-USER.github.io/YOUR-REPO/#/print
```

In Firebase Authentication, add your GitHub Pages domain to the authorized domains list:

```text
YOUR-USER.github.io
```

## Test Printing From the Deployed Site

1. Open the deployed site.
2. Sign in.
3. Use de-identified test patients only.
4. Go to `#/print`.
5. Confirm the print controls appear on screen.
6. Click `Print`.
7. In print preview, confirm the controls and navigation are hidden and the rounding list is visible in landscape layout.
8. Cancel the print dialog unless you need a test printout. Do not print real patient data from this app.

## Update the Site Later

1. Make code changes locally.
2. Test locally:

```bash
npm run build
npm run preview
```

3. Check that no private data or `.env` file is staged:

```bash
git status
```

4. Commit and push:

```bash
git add .
git commit -m "Describe your update"
git push
```

5. GitHub Actions will rebuild and redeploy the site automatically.

## Notes for User or Organization Pages

If the repository is named `YOUR-USER.github.io`, GitHub Pages serves it from the domain root instead of a project folder. In that case, update `.github/workflows/deploy.yml` and set:

```yaml
VITE_BASE_PATH: /
```
