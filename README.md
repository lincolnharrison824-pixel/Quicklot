# QuickLot

QuickLot helps car salespeople turn a vehicle on their dealership's website into a Facebook Marketplace listing with almost no typing. This repo holds **stage one**: the Chrome extension and its small backend.

## What's here

| Folder | What it is |
| --- | --- |
| `extension/` | The Chrome extension. Reads a car off a DealerOn vehicle page, writes the listing, and fills Marketplace's vehicle form. |
| `web/` | A Next.js app for Vercel. Its `/api/listing` route writes the description with Claude for signed-in users. |
| `supabase/migrations/` | Database tables: settings, My cars, and a log of written listings. |
| `tests/` | Writer unit tests, plus an end-to-end test of the extension against a mock Marketplace form. |

## Safety rules (built into the code)

- QuickLot never clicks Next or Publish. The form filler refuses to click any button with those words. You review and publish every listing.
- A daily cap (default 5, max 10) and spacing between posts (default 15 minutes).
- It reads only the dealer page you have open and the Marketplace form it opened. No Messenger, no messages sent.
- A plain account-risk warning at setup. It makes no promise that accounts can't be restricted.

## Two ways to run it

- **Local mode** (no setup): load the `extension` folder in Chrome. No sign-in, settings are kept in that browser, and listings come from the free built-in writer.
- **Account mode**: Google sign-in, settings and My cars saved to Supabase, listings written by Claude through the Vercel backend.

See [SETUP.md](SETUP.md) for exact steps.

## Tests

```bash
node --test tests/writer.test.mjs   # listing writer rules
node tests/e2e-extension.mjs        # loads the extension in Chromium and fills a mock Marketplace form
cd web && npm install && npm run build
```
