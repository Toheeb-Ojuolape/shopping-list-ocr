# Shopping List OCR

A mobile-first receipt capture app that extracts item names and prices with OCR, optionally refines the result with Gemini, and saves rows to Google Sheets or an Excel-compatible workbook.

## Run

```bash
npm install
npm run dev
```

Camera access requires `localhost` or HTTPS.

## Gemini

Add a Gemini API key in the app, or set `VITE_GEMINI_API_KEY` before starting Vite. Client-side API keys are convenient for local use; move this behind a backend before production use.

## Google Sheets

The app posts receipt rows to a Google Apps Script web app URL. Create a Google Sheet, open Extensions > Apps Script, paste the script from the app's "Apps Script" panel, deploy it as a Web App, then paste the deployment URL into the app.

The payload includes one row per extracted item, receipt metadata, raw OCR text, and the captured image data URL.

## Tests

```bash
npm test
```
