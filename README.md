# Nyumbani Concierge — Website App

A full application for the diaspora concierge service: **accounts**, **orders & receipts**,
**per-client reports**, **custom requests**, a **keyword chatbot with WhatsApp fallback**,
and **social links** — plus a Node/Express server for real M-Pesa payments via **Tuma**
and real accounts. The site is **mobile-responsive** (hamburger menu on small screens),
**installable as an app** (PWA: manifest + service worker + icons for phones, PCs,
tablets), and fully **SEO/discovery-ready** (structured data, Open Graph, robots,
sitemap, llms.txt).

## Pages & features

| Page | Route | What it does |
|---|---|---|
| Home | `#/home` | Basic explanation of what the owner does for diaspora clients |
| Services | `#/services` | Full catalog with fixed KES prices (matches `pricing-and-catalog.md`) |
| Custom request | `#/request` | Clients describe anything **not in the catalog**; owner gets it, quote follows |
| Checkout | `#/checkout` | Cart + payment method (**M-Pesa via Tuma STK push** or bank transfer); requires an account |
| Pay | `#/pay/:method/:orderId` | M-Pesa: number → approve STK push → confirmation code · Bank: details + reference |
| Receipt | `#/receipt/:orderId` | Official receipt, printable / save-as-PDF |
| My Reports | `#/reports` | Reports the owner posts for each paid service: photos, video links, documents, receipts |
| Orders | `#/orders` | The logged-in client's orders with status chips |
| Account | `#/account` | Register / login + **owner panel** (passcode: `nyumbani2026` — change it in `CONFIG`) |
| Contact | `#/contact` | WhatsApp button, email, and the seven social buttons |

**Accounts:** free registration with name, email, phone and password. Orders and
reports are tied to the account. Demo mode stores accounts/orders/reports in the
browser (localStorage); live mode uses the server (`/api/register`, `/api/login`,
`/api/orders`, `/api/reports`).

**Reports:** the owner unlocks the owner panel (Account page → passcode), picks a
**paid** order, and posts the report (title, details, evidence link). The client
sees it instantly in **My Reports** — and it's also sent on WhatsApp in real life.

**Chatbot:** floating chat widget. Answers come from the `BOT_QA` list (custom
questions + **keyword matching** — edit the list in `index.html`). If nothing
matches, the bot offers a **WhatsApp button** for personal help (the number is
never shown publicly — it lives only in `CONFIG.whatsappLink`).

**Social buttons:** same links as semacheck.vercel.app plus Facebook —
Facebook, Instagram `bit_coiner.69`, X `story_hero69`, TikTok `bit_coiner.69`,
YouTube `bit_coiner`, LinkedIn, Threads `semacheck254` (edit `SOCIALS` in
`index.html`). The footer also has an **Email us** button
(`semacheck254@gmail.com`) above the WhatsApp button.

**Payments:** M-Pesa via **Tuma** (Safaricom's business STK-push API) + bank
transfer only.

## Mobile & PWA

- **Responsive:** hamburger menu below 880 px (stacked links, closes on tap),
  single-column grids, full-width CTAs, no horizontal overflow — verified at
  555 px and 480 px viewports.
- **Installable app:** `manifest.webmanifest` (standalone display, theme color,
  icons, shortcuts) + `sw.js` service worker (offline app shell). Install via
the  browser's "Install app" prompt on Android, Windows, macOS/iOS (add to home
screen). Icons are derived from the brand images in `assets/` by `make-assets.js`.
- **SEO & discovery:** canonical, robots meta, Open Graph + Twitter cards
  (`og-image.png`), theme-color, geo tags, JSON-LD structured data
  (ProfessionalService, WebSite, FAQPage from the chatbot Q&A), plus
  `robots.txt`, `sitemap.xml`, `llms.txt` (AI-platform readable) and
  `.well-known/security.txt`. Search engines and AI crawlers can index and
  describe the site accurately.

## Two ways to run it

### 1. Demo mode (no server)
Open `index.html` directly. Everything works — accounts, orders, reports, chatbot,
both payment flows — but M-Pesa (Tuma) is simulated (there is no demo banner;
the site presents itself as the real product). The service worker makes the app
work offline once it has been visited online.

### 2. Live mode (real accounts + real Tuma STK push)
```bash
cd server
npm install
cp .env.example .env      # fill in your Tuma credentials
npm start
```
The frontend auto-detects the server and switches to live mode. The server:
- registers/logs in clients (`/api/register`, `/api/login`) with session tokens
- triggers the **Tuma STK push** (`POST /api/stkpush`) and marks orders **paid**
  via the callback (`POST /api/callback`)
- stores orders and reports as JSON files in `server/data/`
- serves the app from `public/` (copy `index.html` there, or serve the folder directly)

**Going live with M-Pesa (Tuma):**
1. The Tuma integration in `server.js` is copied **directly from the semacheck
   project** (`services/tuma.js` + `routes/payments.js`): auth via
   `POST /auth/token` with `TUMA_EMAIL` + `TUMA_API_KEY`, then
   `POST /payment/stk-push`, status via `GET /payment/status/:id`, and the
   callback fields `status / checkout_request_id / result_code /
   mpesa_receipt_number / failure_reason`.
2. `.env` already contains the working Tuma credentials (copied from semacheck's
   `backend/.env`). Only `TUMA_CALLBACK_URL` still needs your public URL:
   - Deployed: set it to your app's URL (e.g. `https://yourapp.onrender.com/api/callback`).
   - Development: `ngrok http 3000` → `https://xxxx.ngrok.io/api/callback`.
3. The frontend triggers `POST /api/stkpush`; the order stores the
   `checkout_request_id`; Tuma calls back `POST /api/callback` and the order is
   marked **paid** with the M-Pesa receipt number.
4. **Bank transfers** stay manual: client transfers → you check the account →
   mark the order paid (`POST /api/orders/:id/confirm`).

## Before going live — replace these placeholders

Search `index.html` for:
1. **Brand** — "Nyumbani Concierge" (header, receipt, footer).
2. **Tuma Till/Paybill** — `CONFIG.tumaTill` (`000000`) and `TUMA_SHORTCODE` in `.env`.
3. **Bank details** — `[Equity / I&M / KCB]`, account number, SWIFT in the Pay page.
4. **WhatsApp** — the number is hidden from visitors by design (only in
   `CONFIG.whatsappLink`); no action needed unless it changes.
5. **Email** — already `semacheck254@gmail.com`; double-check in `CONFIG.email`.
6. **Owner passcode** — `CONFIG.adminPasscode` (`nyumbani2026`).
7. **Registration numbers** — business No. and KRA PIN in the Contact page.
8. **Socials** — `SOCIALS` array has the 7 links (Facebook added); swap if needed.
9. **Domain** — `https://nyumbaniconcierge.vercel.app/` is used in `index.html`
   (canonical, OG, JSON-LD), `robots.txt`, `sitemap.xml`, `.well-known/security.txt`;
   search-and-replace with your real domain after deploy.

## Customization

- Services & prices: `SERVICES` array at the top of the `<script>`.
- Chatbot answers: `BOT_QA` array — each entry has the answer plus `keywords`;
  the bot matches the user's message against keywords and picks the best match.

## Files

```
index.html              the app (all 10 pages, chatbot, inlined CSS/JS)
assets/                 the owner's brand images (logo banner, circular badge,
                        horizontal logo) — used as the source for all icons
make-assets.js          builds the icons/OG image from assets/ (node make-assets.js)
favicon-32.png          browser tab icon (from the badge)
icon-192.png / icon-512.png / icon-512-maskable.png / apple-touch-icon-180.png
og-image.png            Open Graph share image 1200x630 (from the logo banner)
manifest.webmanifest    PWA manifest (installable app)
sw.js                   service worker (offline app shell)
serve.js                zero-dependency static server for local preview (node serve.js)
robots.txt              crawler rules incl. AI bots, sitemap pointer
sitemap.xml             sitemap for search engines
llms.txt                machine-readable summary for AI platforms
.well-known/security.txt  responsible-disclosure contact
server/
  server.js       Express: accounts, Tuma STK push, callback, orders/reports store
  package.json    dependencies (express, dotenv)
  .env.example    copy to .env and fill in Tuma credentials
  data/           created at runtime (orders.json, users.json, reports.json)
```

**Regenerating the icons after you swap the brand images in `assets/`:** run
`node make-assets.js` — it derives `favicon-32.png`, `icon-192.png`,
`icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png` and
`og-image.png` from your assets (area-average resize, premultiplied alpha,
proper PNG filter decoding — no external dependencies).