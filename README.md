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
| Account | `#/account` | Register / login; clients manage their orders and reports here |
| Contact | `#/contact` | WhatsApp button, email, and the seven social buttons |

**Accounts:** free registration with name, email, phone and password. Accounts,
orders, reports and requests are stored on the server (`/api/register`, `/api/login`,
`/api/orders`, `/api/reports`) — never in the browser.

**Reports:** the owner posts the report (title, details, evidence link) for each
**paid** order from the hidden admin dashboard (never linked from the public
site — you reach it by its private URL). The client sees it
instantly in **My Reports** — and it's also sent on WhatsApp in real life.

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
- answers CORS so the separately-hosted frontend can call it

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

## Deploying — frontend on Vercel, backend on Render

The repo is split in two: `frontend/` (static site, zero build) and `server/`
(Node/Express API). Vercel hosts the frontend; Render hosts the API.

### 1. Push the current code
```bash
git add -A
git commit -m "Split frontend and backend for Vercel + Render deployment"
git push origin main
```

### 2. Create the API on Render (do this first — you need its URL)
1. render.com → New → **Blueprint** → pick this repo. `render.yaml` is already
   in the repo, so Render creates the web service automatically
   (root directory `server`, start `npm start`).
2. In the service's **Environment** tab set:
   - `TUMA_EMAIL` — your Tuma account email
   - `TUMA_API_KEY` — your Tuma API key
   - `TUMA_CALLBACK_URL` — `https://<your-service-name>.onrender.com/api/callback`
3. Deploy, then copy your service URL
   (e.g. `https://nyumbani-concierge-api.onrender.com`).

### 3. Point the frontend at the API
In `frontend/index.html` → `CONFIG.apiBase`:
```js
apiBase: "https://nyumbani-concierge-api.onrender.com"
```
Leave it `""` only for local development (same-origin on `http://localhost:3000`).

### 4. Deploy the frontend on Vercel
1. vercel.com → Add New → Project → import this repo.
2. **Root Directory: `frontend`** — this deploys only the frontend.
3. Framework preset: **Other** (static site, no build command) → Deploy.
   `vercel.json` already sets clean URLs, headers and the SW cache rule.

### 5. Verify
- Open the Vercel URL: the site loads; create an account and an order → the
  pay page reaches Render via `CONFIG.apiBase`, so M-Pesa/bank payments work
  for real. The first request can take ~30–60 s while Render's free instance
  spins up.
- `TUMA_CALLBACK_URL` must be your Render URL so Tuma can deliver payment
  callbacks (orders stay "pending" until then).

### 6. Replace the placeholder domain after deploy
`https://nyumbaniconcierge.vercel.app/` is used in `frontend/index.html`
(canonical, OG, JSON-LD), `frontend/robots.txt`, `frontend/sitemap.xml` and
`frontend/.well-known/security.txt` — search-and-replace with your real domain.

## Before going live — replace these placeholders

Search `index.html` for:
1. **Brand** — "Nyumbani Concierge" (header, receipt, footer).
2. **Tuma Till/Paybill** — `CONFIG.tumaTill` (`000000`) and `TUMA_SHORTCODE` in `.env`.
3. **Bank details** — already set to Family Bank (Kenya) · Loyd Akoth ·
   account 028000055803 · Branch: Kisumu Express · SWIFT FABLKENA in the
   Pay page; update only if the account changes.
4. **WhatsApp** — the number is hidden from visitors by design (only in
   `CONFIG.whatsappLink`); no action needed unless it changes.
5. **Email** — already `semacheck254@gmail.com`; double-check in `CONFIG.email`.
6. **Admin passcode** — set `ADMIN_PASSCODE` in the server's `.env` only (no
   default, never in code or docs). It guards the hidden admin page.
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
frontend/             what Vercel deploys (root directory: frontend)
  index.html            the app (all 10 pages, chatbot, inlined CSS/JS)
  assets/               the owner's brand images (logo banner, circular badge,
                        horizontal logo) — source for all icons
  make-assets.js        builds the icons/OG image from assets/ (node make-assets.js)
  favicon-32.png        browser tab icon (from the badge)
  icon-192.png / icon-512.png / icon-512-maskable.png / apple-touch-icon-180.png
  og-image.png          Open Graph share image 1200x630 (from the logo banner)
  manifest.webmanifest  PWA manifest (installable app)
  sw.js                 service worker (offline app shell)
  vercel.json           Vercel config (clean URLs, headers)
  serve.js              zero-dependency static server (node serve.js)
  robots.txt / sitemap.xml / llms.txt / .well-known/security.txt
server/               what Render deploys (root directory: server)
  server.js       Express: accounts, Tuma STK push, callback, orders/reports
                  store — CORS enabled for the Vercel frontend
  package.json    dependencies (express, dotenv)
  .env.example    copy to .env and fill in Tuma credentials
  data/           created at runtime (orders.json, users.json, reports.json)
render.yaml           Render Blueprint — creates the API service automatically
README.md             this file
```

**Regenerating the icons after you swap the brand images in `assets/`:** run
`node make-assets.js` — it derives `favicon-32.png`, `icon-192.png`,
`icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon-180.png` and
`og-image.png` from your assets (area-average resize, premultiplied alpha,
proper PNG filter decoding — no external dependencies).