# Shopping List OCR

A mobile-first receipt capture app that extracts item names and prices with OCR, optionally refines the result with Gemini, and saves extracted rows to Google Sheets or a CSV file.

## Run

```bash
npm install
npm run dev
```

Camera access requires `localhost` or HTTPS.

## Gemini

Set `VITE_GEMINI_API_KEY` before starting Vite to enable optional cleanup of OCR results. Client-side API keys are convenient for local use; move this behind a backend before production use.

## Google Sheets

The app posts receipt rows to a Google Apps Script web app URL. Create a Google Sheet, open Extensions > Apps Script, add a `doPost` handler that accepts the app payload, deploy it as a Web App, then paste the deployment URL into the app.

The payload includes one row per extracted item and receipt metadata. Captured receipt images are not saved.

## Tests

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check
```
