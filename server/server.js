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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-admin-passcode");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 3000;

const TUMA_BASE_URL = process.env.TUMA_BASE_URL || "https://api.tuma.co.ke";
const TUMA_EMAIL = process.env.TUMA_EMAIL || "";
const TUMA_API_KEY = process.env.TUMA_API_KEY || "";
const TUMA_CALLBACK_URL = process.env.TUMA_CALLBACK_URL || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const useDb = !!(SUPABASE_URL && SUPABASE_KEY);

const DATA_DIR = path.join(__dirname, "data");
const JSON_FILES = {
  users: path.join(DATA_DIR, "users.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  reports: path.join(DATA_DIR, "reports.json"),
  requests: path.join(DATA_DIR, "requests.json")
};

const COL_MAP = { user_id: "userId", bank_ref: "bankRef", checkout_request_id: "checkoutRequestId", txn_id: "txnId", order_id: "orderId" };
const REV_MAP = Object.fromEntries(Object.entries(COL_MAP).map(([k, v]) => [v, k]));
const toCamel = row => { if (!row) return row; const out = {}; for (const k in row) out[COL_MAP[k] || k] = row[k]; return out; };
const toSnake = obj => { const out = {}; for (const k in obj) out[REV_MAP[k] || k] = obj[k]; return out; };

function loadJson(table) { try { return JSON.parse(fs.readFileSync(JSON_FILES[table], "utf8")); } catch { return []; } }
function saveJson(table, rows) { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(JSON_FILES[table], JSON.stringify(rows, null, 2)); }

async function supabase(table, method, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query || ""}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: body === undefined ? undefined : JSON.stringify(toSnake(body))
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`DB ${table} ${res.status}: ${t.slice(0, 300)}`); }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function findOne(table, field, value) {
  if (useDb) {
    const rows = await supabase(table, "GET", `?select=*&${field}=eq.${encodeURIComponent(String(value))}&limit=1`);
    return toCamel(rows[0] || null);
  }
  return loadJson(table).find(r => r[field] === value) || null;
}

async function listAll(table, orderField) {
  if (useDb) {
    const rows = await supabase(table, "GET", `?select=*&order=${orderField}.desc`);
    return rows.map(toCamel);
  }
  return loadJson(table).sort((a, b) => new Date(b[orderField]) - new Date(a[orderField]));
}

async function listWhere(table, field, value, orderField) {
  if (useDb) {
    const dbField = REV_MAP[field] || field;
    const rows = await supabase(table, "GET", `?select=*&${dbField}=eq.${encodeURIComponent(String(value))}&order=${orderField}.desc`);
    return rows.map(toCamel);
  }
  return loadJson(table).filter(r => r[field] === value).sort((a, b) => new Date(b[orderField]) - new Date(a[orderField]));
}

async function insertRow(table, obj) {
  if (useDb) {
    const rows = await supabase(table, "POST", "", obj);
    return toCamel(rows[0] || obj);
  }
  const rows = loadJson(table);
  rows.unshift(obj);
  saveJson(table, rows);
  return obj;
}

async function updateRow(table, id, patch) {
  if (useDb) {
    const rows = await supabase(table, "PATCH", `?id=eq.${encodeURIComponent(String(id))}`, patch);
    return toCamel(rows[0] || null);
  }
  const rows = loadJson(table);
  const x = rows.find(r => r.id === id);
  if (!x) return null;
  Object.assign(x, patch);
  saveJson(table, rows);
  return x;
}

async function deleteRow(table, id) {
  if (useDb) {
    await supabase(table, "DELETE", `?id=eq.${encodeURIComponent(String(id))}`);
    return true;
  }
  const rows = loadJson(table);
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return false;
  rows.splice(idx, 1);
  saveJson(table, rows);
  return true;
}

const ah = fn => (req, res) => fn(req, res).catch(e => { console.error("Handler error:", e); res.status(500).json({ error: e.message || "Server error" }); });

function adminOk(req) {
  const got = String(req.headers["x-admin-passcode"] || "");
  const want = process.env.ADMIN_PASSCODE || "";
  if (!want || !got) return false;
  const a = crypto.createHash("sha256").update(got).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  if (!adminOk(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function authUser(req) {
  const token = String((req.headers.authorization || "").replace("Bearer ", ""));
  return token ? findOne("users", "token", token) : Promise.resolve(null);
}

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

app.use(express.static(path.join(__dirname, "..", process.env.STATIC_DIR || "public")));
app.get("/api/health", (req, res) => res.json({ ok: true, mode: TUMA_API_KEY ? "configured" : "no-credentials", db: useDb ? "supabase" : "json-fallback" }));

app.post("/api/register", ah(async (req, res) => {
  const { name, email, phone, pass } = req.body || {};
  if (!name || !email || !pass) return res.status(400).json({ error: "Name, email and password required" });
  const clean = email.trim().toLowerCase();
  if (await findOne("users", "email", clean)) return res.status(409).json({ error: "Email already registered — log in" });
  const id = "u" + Date.now();
  const token = crypto.randomBytes(24).toString("hex");
  const user = { id, name: name.trim(), email: clean, phone: (phone || "").trim(), pass, token };
  await insertRow("users", user);
  res.json({ ok: true, token, user: { id, name: user.name, email: clean, phone: user.phone } });
}));

app.post("/api/login", ah(async (req, res) => {
  const { identifier, pass } = req.body || {};
  const idf = String(identifier || "").trim();
  const users = await Promise.all([findOne("users", "email", idf.toLowerCase()), findOne("users", "phone", idf)]);
  const u = users.find(Boolean);
  if (!u || u.pass !== pass) return res.status(401).json({ error: "Wrong email/phone or password" });
  const token = crypto.randomBytes(24).toString("hex");
  await updateRow("users", u.id, { token });
  res.json({ ok: true, token, user: { id: u.id, name: u.name, email: u.email, phone: u.phone } });
}));

app.get("/api/me", ah(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: "Not logged in" });
  res.json({ user: { id: u.id, name: u.name, email: u.email, phone: u.phone } });
}));

app.post("/api/orders", ah(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: "Log in first" });
  const { id, method, items, total } = req.body || {};
  if (!id || !method || !Array.isArray(items)) return res.status(400).json({ error: "Order details incomplete" });
  if (await findOne("orders", "id", id)) return res.status(409).json({ error: "Order exists" });
  await insertRow("orders", { id, date: new Date().toISOString(), method, userId: u.id, items, total: Number(total) || 0, status: "pending", txnId: null, phone: null, bankRef: null, checkoutRequestId: null });
  res.json({ ok: true });
}));

app.get("/api/orders", ah(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: "Log in first" });
  res.json(await listWhere("orders", "userId", u.id, "date"));
}));

app.get("/api/orders/:id", ah(async (req, res) => {
  const u = await authUser(req);
  if (!u && !adminOk(req)) return res.status(401).json({ error: "Log in first" });
  const o = await findOne("orders", "id", req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  if (!adminOk(req) && o.userId !== u.id) return res.status(403).json({ error: "Not your order" });
  res.json(o);
}));

app.get("/api/reports", ah(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: "Log in first" });
  res.json(await listWhere("reports", "userId", u.id, "date"));
}));

app.post("/api/requests", ah(async (req, res) => {
  const { name, contact, text, userId } = req.body || {};
  if (!name || !contact || !text) return res.status(400).json({ error: "Name, contact and request are required" });
  await insertRow("requests", { id: "RQ-" + Date.now().toString().slice(-8), userId: userId || null, name: name.trim(), contact: contact.trim(), text: text.trim(), date: new Date().toISOString(), status: "new" });
  res.json({ ok: true });
}));

app.post("/api/stkpush", ah(async (req, res) => {
  const { orderId, phone, amount } = req.body || {};
  const order = await findOne("orders", "id", orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!TUMA_API_KEY) return res.status(500).json({ error: "Tuma credentials not configured" });

  const phoneNumber = String(phone).replace(/\D/g, "").replace(/^0/, "254");
  const data = await tumaStkPush({
    phone: phoneNumber,
    amount: Math.round(amount),
    description: `Nyumbani Concierge order ${orderId}`
  });

  await updateRow("orders", orderId, { status: "pending", phone: phoneNumber, checkoutRequestId: data.checkout_request_id || null });
  res.json({ ok: true, checkoutRequestId: data.checkout_request_id, merchantRequestId: data.merchant_request_id });
}));

app.post("/api/callback", ah(async (req, res) => {
  res.json({ received: true });
  const { status, checkout_request_id, result_code, mpesa_receipt_number, failure_reason } = req.body || {};
  if (!checkout_request_id) { console.warn("Tuma callback: missing checkout_request_id"); return; }
  const orders = await listAll("orders", "date");
  const order = orders.find(o => o.checkoutRequestId === checkout_request_id);
  if (!order) { console.warn("Tuma callback: no order for checkout_request_id:", checkout_request_id); return; }
  if (status !== "completed" || result_code !== 0) {
    console.log("Tuma callback: payment failed for", order.id, "reason:", failure_reason);
    await updateRow("orders", order.id, { status: "failed" });
    return;
  }
  console.log("Tuma callback: payment succeeded for", order.id, "receipt:", mpesa_receipt_number);
  await updateRow("orders", order.id, { status: "paid", txnId: mpesa_receipt_number || "" });
}));

app.get("/api/admin/overview", requireAdmin, ah(async (req, res) => {
  const [users, orders, reports, requests] = await Promise.all([
    listAll("users", "created_at"),
    listAll("orders", "date"),
    listAll("reports", "date"),
    listAll("requests", "date")
  ]);
  const revenue = orders.filter(o => o.status === "paid").reduce((s, o) => s + (Number(o.total) || 0), 0);
  res.json({
    stats: {
      revenue,
      users: users.length,
      orders: orders.length,
      paid: orders.filter(o => o.status === "paid").length,
      awaiting: orders.filter(o => o.status === "awaiting").length,
      pending: orders.filter(o => o.status === "pending").length,
      reports: reports.length,
      newRequests: requests.filter(r => r.status === "new").length
    },
    users, orders, reports, requests
  });
}));

app.post("/api/orders/:id/banknote", ah(async (req, res) => {
  const u = await authUser(req);
  const o = await findOne("orders", "id", req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  if (!u || o.userId !== u.id) return res.status(401).json({ error: "Log in first" });
  const bankRef = String((req.body || {}).bankRef || "").trim();
  if (!bankRef) return res.status(400).json({ error: "Reference required" });
  await updateRow("orders", o.id, { status: "awaiting", bankRef });
  res.json({ ok: true });
}));

app.post("/api/admin/orders/:id/confirm", requireAdmin, ah(async (req, res) => {
  const o = await updateRow("orders", req.params.id, { status: "paid" });
  o ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
}));

app.delete("/api/admin/orders/:id", requireAdmin, ah(async (req, res) => {
  const o = await findOne("orders", "id", req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  if (o.status === "paid") return res.status(400).json({ error: "Cannot delete a paid order" });
  await deleteRow("orders", req.params.id);
  res.json({ ok: true });
}));

app.post("/api/admin/requests/:id/done", requireAdmin, ah(async (req, res) => {
  const r = await updateRow("requests", req.params.id, { status: "done" });
  r ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
}));

app.post("/api/admin/reports", requireAdmin, ah(async (req, res) => {
  const { orderId, title, body, link } = req.body || {};
  if (!orderId || !title || !body) return res.status(400).json({ error: "Order, title and details are required" });
  const order = await findOne("orders", "id", orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  await insertRow("reports", { id: "RP-" + Date.now(), userId: order.userId, orderId, title: title.trim(), body: body.trim(), link: (link || "").trim(), date: new Date().toISOString() });
  res.json({ ok: true });
}));

app.listen(PORT, () => console.log(`Nyumbani Concierge server running on http://localhost:${PORT} (db: ${useDb ? "supabase" : "json-fallback"})`));
