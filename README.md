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

The app writes receipt rows directly to the user's Google Sheet through the Google Sheets API.

Setup:

1. Create or open a Google Cloud project.
2. Enable the Google Sheets API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Client ID for a Web application.
5. Add your local/dev origins, for example `http://localhost:5173` and `http://127.0.0.1:4173`.
6. Set `VITE_GOOGLE_CLIENT_ID` in `.env`.

Users can then connect Google, paste a normal Google Sheet link, choose a tab name, and save. If the tab does not exist, the app creates it. Captured receipt images are not saved.

## Tests

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run check
```
