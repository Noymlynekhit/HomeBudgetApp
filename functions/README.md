# Functions

`askGemini` (callable, europe-west1): authenticated Gemini proxy.
- Only signed-in users with a verified email who are members of the given house can call it (mirrors `firestore.rules`).
- The Gemini key lives in Secret Manager (`GEMINI_API_KEY`), never in the browser.
- Per-user daily limit (60) tracked in `ai_usage/{uid}_{yyyymmdd}`.

## Deploy
```
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase functions:secrets:set GEMINI_API_KEY
firebase deploy --only functions
```

## Test
`cd functions && npm test`
