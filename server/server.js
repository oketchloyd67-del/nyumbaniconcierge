const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const allowed = (process.env.CORS_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (req.headers.origin && allowed.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 3000;

const TUMA_BASE_URL = process.env.TUMA_BASE_URL || "https://api.tuma.co.ke";
const TUMA_EMAIL = process.env.TUMA_EMAIL || "";
const TUMA_API_KEY = process.env.TUMA_API_KEY || "";
const TUMA_CALLBACK_URL = process.env.TUMA_CALLBACK_URL || "";

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");

function loadFile(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function saveFile(file, data) { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
const loadOrders = () => loadFile(ORDERS_FILE, []);
const saveOrders = o => saveFile(ORDERS_FILE, o);
const loadUsers = () => loadFile(USERS_FILE, []);
const saveUsers = u => saveFile(USERS_FILE, u);
const loadReports = () => loadFile(REPORTS_FILE, []);
const saveReports = r => saveFile(REPORTS_FILE, r);
const getOrder = id => loadOrders().find(o => o.id === id);
const patchOrder = (id, patch) => { const o = loadOrders(); const x = o.find(r => r.id === id); if (!x) return null; Object.assign(x, patch); saveOrders(o); return x; };

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function decodeJwtExp(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return payload.exp ? payload.exp * 1000 : Date.now() + 15 * 60 * 1000;
  } catch {
    return Date.now() + 15 * 60 * 1000;
  }
}

async function getTumaToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  if (!TUMA_EMAIL || !TUMA_API_KEY) {
    const err = new Error("Tuma credentials are not configured (see .env: TUMA_EMAIL, TUMA_API_KEY).");
    err.code = "TUMA_NOT_CONFIGURED";
    throw err;
  }
  const res = await fetch(`${TUMA_BASE_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: TUMA_EMAIL, api_key: TUMA_API_KEY })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Tuma authentication failed.");
  cachedToken = data.data.token;
  cachedTokenExpiresAt = decodeJwtExp(cachedToken);
  return cachedToken;
}

async function tumaStkPush({ phone, amount, description }) {
  const token = await getTumaToken();
  const res = await fetch(`${TUMA_BASE_URL}/payment/stk-push`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount, phone, callback_url: TUMA_CALLBACK_URL, description })
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.message || "Tuma STK push failed.");
    err.code = "TUMA_STK_FAILED";
    throw err;
  }
  return data.data;
}

async function tumaPaymentStatus(checkoutRequestId) {
  try {
    const token = await getTumaToken();
    const res = await fetch(`${TUMA_BASE_URL}/payment/status/${checkoutRequestId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return await res.json();
  } catch {
    return null;
  }
}

app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/health", (req, res) => res.json({ ok: true, mode: TUMA_API_KEY ? "configured" : "no-credentials" }));

app.post("/api/register", (req, res) => {
  const { name, email, phone, pass } = req.body || {};
  if (!name || !email || !pass) return res.status(400).json({ error: "Name, email and password required" });
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: "Email already registered — log in" });
  const id = "u" + Date.now();
  const token = crypto.randomBytes(24).toString("hex");
  users.push({ id, name, email, phone: phone || "", pass, token });
  saveUsers(users);
  res.json({ ok: true, token, user: { id, name, email, phone } });
});
app.post("/api/login", (req, res) => {
  const { identifier, pass } = req.body || {};
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === (identifier || "").toLowerCase() || (x.phone && x.phone === identifier));
  if (!u || u.pass !== pass) return res.status(401).json({ error: "Wrong email/phone or password" });
  u.token = crypto.randomBytes(24).toString("hex"); saveUsers(users);
  res.json({ ok: true, token: u.token, user: { id: u.id, name: u.name, email: u.email, phone: u.phone } });
});
function authUser(req) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  return loadUsers().find(u => u.token === token) || null;
}
app.get("/api/me", (req, res) => { const u = authUser(req); u ? res.json({ user: u }) : res.status(401).json({ error: "Not logged in" }); });

app.post("/api/orders", (req, res) => {
  const u = authUser(req); if (!u) return res.status(401).json({ error: "Log in first" });
  const { id, method, items, total } = req.body || {};
  const orders = loadOrders();
  if (orders.find(o => o.id === id)) return res.status(409).json({ error: "Order exists" });
  orders.unshift({ id, date: new Date().toISOString(), method, userId: u.id, items, total, status: "pending", txnId: null, phone: null, bankRef: null, checkoutRequestId: null });
  saveOrders(orders);
  res.json({ ok: true });
});
app.get("/api/orders", (req, res) => { const u = authUser(req); if (!u) return res.status(401).json({ error: "Log in first" }); res.json(loadOrders().filter(o => o.userId === u.id)); });
app.get("/api/orders/:id", (req, res) => { const o = getOrder(req.params.id); o ? res.json({ id: o.id, status: o.status, txnId: o.txnId, method: o.method }) : res.status(404).json({ error: "Not found" }); });
app.get("/api/reports", (req, res) => { const u = authUser(req); if (!u) return res.status(401).json({ error: "Log in first" }); res.json(loadReports().filter(r => r.userId === u.id)); });
app.post("/api/reports", (req, res) => {
  const { orderId, title, body, link } = req.body || {};
  const order = getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const reports = loadReports();
  reports.unshift({ id: "RP-" + Date.now(), userId: order.userId, orderId, title, body, link, date: new Date().toISOString() });
  saveReports(reports);
  res.json({ ok: true });
});

app.post("/api/stkpush", async (req, res) => {
  try {
    const { orderId, phone, amount } = req.body || {};
    const order = getOrder(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!TUMA_API_KEY) return res.status(500).json({ error: "Tuma credentials not configured" });

    const phoneNumber = String(phone).replace(/\D/g, "").replace(/^0/, "254");
    const data = await tumaStkPush({
      phone: phoneNumber,
      amount: Math.round(amount),
      description: `Nyumbani Concierge order ${orderId}`
    });

    patchOrder(orderId, { status: "pending", phone: phoneNumber, checkoutRequestId: data.checkout_request_id || null });
    res.json({ ok: true, checkoutRequestId: data.checkout_request_id, merchantRequestId: data.merchant_request_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/callback", (req, res) => {
  res.json({ received: true });
  try {
    const { status, checkout_request_id, result_code, mpesa_receipt_number, failure_reason } = req.body || {};
    if (!checkout_request_id) { console.warn("Tuma callback: missing checkout_request_id"); return; }

    const orders = loadOrders();
    const order = orders.find(o => o.checkoutRequestId === checkout_request_id);
    if (!order) { console.warn("Tuma callback: no order for checkout_request_id:", checkout_request_id); return; }

    if (status !== "completed" || result_code !== 0) {
      console.log("Tuma callback: payment failed for", order.id, "reason:", failure_reason);
      patchOrder(order.id, { status: "failed" });
      return;
    }
    console.log("Tuma callback: payment succeeded for", order.id, "receipt:", mpesa_receipt_number);
    patchOrder(order.id, { status: "paid", txnId: mpesa_receipt_number || "" });
  } catch (err) {
    console.error("Tuma callback processing error:", err);
  }
});

app.get("/api/orders/:id", (req, res) => {
  const o = getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  res.json({ id: o.id, status: o.status, txnId: o.txnId, method: o.method });
});

app.post("/api/orders/:id/confirm", (req, res) => {
  const o = patchOrder(req.params.id, { status: "paid" });
  o ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

app.listen(PORT, () => console.log(`Nyumbani Concierge server running on http://localhost:${PORT}`));
