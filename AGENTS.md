# IM Rounding Tracker Agent Rules

This project is a clinical internal medicine rounding tool. Ship reliable, clinically useful behavior before visual novelty.

## Product Priorities

- Clinical safety is higher priority than cosmetic polish.
- Print usefulness is critical. The rounding list must preserve important red flags, tasks, labs, imaging, antibiotics, procedures, consults, discharge needs, and disposition signals.
- Keep interfaces dense but calm: clear section headers, consistent spacing, restrained colors, and red only for urgent or high-risk clinical signals.
- Prefer small targeted improvements over redesigns or broad refactors.

## Data Safety

- Preserve existing patient data behavior and field names unless there is a documented migration plan.
- Do not destructively change Firebase schema, collection paths, or patient document shape.
- Firestore is the source of truth for patient data. Do not add patient-data persistence through `localStorage`.
- Keep patient editing explicit-save based. Do not add passive save on blur, tab change, unmount, or IME composition events.
- Preserve Chinese Zhuyin/Bopomofo-safe input behavior.
- Do not commit real patient data.
- Do not commit `.env` or secrets.

## Engineering Rules

- Run `npm run build` after meaningful frontend changes.
- Run `npm --prefix functions run build` after Firebase Functions changes.
- Inspect print output paths when changing print data, print CSS, or rounding digest logic.
- If a feature is risky or too large for an MVP stability pass, defer it in `TODO_PRODUCT.md`.
- Do not push to `main` unless build, smoke checks, git diff review, and safety checks pass.
