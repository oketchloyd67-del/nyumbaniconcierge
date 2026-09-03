/* ============================================================
   Nyumbani Concierge — build the site assets FROM the brand
   images in assets/ (pure Node, built-in zlib only).
   Run:  node make-assets.js
   Sources (assets/, added by the owner):
     file_..._10348211a66ab9925b90b73c.png  1672x940   logo banner (wide)
     file_..._27a08211a830d00186ef7182.png  1254x1254  circular badge icon
     file_..._aed482118bdb0061be83fb8d.png  1254x1254  squircle app icon
     file_..._b5208211a4c8428fbeed3a68.png  2172x724   horizontal logo
   Outputs (this folder, used by index.html / manifest / sw):
     favicon-32.png, icon-192.png, icon-512.png,
     icon-512-maskable.png, apple-touch-icon-180.png,
     og-image.png
   ============================================================ */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const SRC = (name) => path.join(__dirname, "assets", name);
const OUT = (name) => path.join(__dirname, name);

const BANNER = "file_0000000010348211a66ab9925b90b73c.png";   // 1672x940  logo banner
const CIRCLE = "file_0000000027a08211a830d00186ef7182.png";   // 1254x1254 circular badge
const HLOGO  = "file_00000000b5208211a4c8428fbeed3a68.png";   // 2172x724 horizontal logo

/* ---------------- PNG decode / encode ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePNG(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(file + " is not a PNG");
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const bitDepth = b[24], colorType = b[25];
  if (bitDepth !== 8 || ![0, 2, 6].includes(colorType)) throw new Error(file + ": unsupported PNG format (depth " + bitDepth + ", type " + colorType + ")");
  let off = 8; const idat = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off); const type = b.slice(off + 4, off + 8).toString();
    if (type === "IDAT") idat.push(b.slice(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;   // bytes per pixel
  const stride = w * bpp;
  const rgba = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? cur[x - bpp] : 0;
      const up = prev[x];
      const ul = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v = (v + left) & 255;
      else if (f === 2) v = (v + up) & 255;
      else if (f === 3) v = (v + ((left + up) >> 1)) & 255;
      else if (f === 4) v = (v + paeth(left, up, ul)) & 255;
      cur[x] = v;
    }
    for (let x = 0; x < w; x++) {
      const si = x * bpp, di = (y * w + x) * 4;
      if (colorType === 6) { rgba[di] = cur[si]; rgba[di + 1] = cur[si + 1]; rgba[di + 2] = cur[si + 2]; rgba[di + 3] = cur[si + 3]; }
      else if (colorType === 2) { rgba[di] = cur[si]; rgba[di + 1] = cur[si + 1]; rgba[di + 2] = cur[si + 2]; rgba[di + 3] = 255; }
      else { rgba[di] = cur[si]; rgba[di + 1] = cur[si]; rgba[di + 2] = cur[si]; rgba[di + 3] = 255; }
    }
    cur.copy(prev);
  }
  return { w, h, rgba };
}
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------------- area-average resize (premultiplied, no dark fringes) ---------------- */
function resize(img, dstW, dstH) {
  const { w: sw, h: sh, rgba } = img;
  const out = Buffer.alloc(dstW * dstH * 4);
  const sx = sw / dstW, sy = sh / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = y * sy, y1 = Math.min(y0 + sy, sh);
    for (let x = 0; x < dstW; x++) {
      const x0 = x * sx, x1 = Math.min(x0 + sx, sw);
      let sumA = 0, sumAr = 0, sumAg = 0, sumAb = 0;
      const yStart = Math.floor(y0), yEnd = Math.min(Math.ceil(y1), sh);
      for (let yy = yStart; yy < yEnd; yy++) {
        const wY = Math.min(yy + 1, y1) - Math.max(yy, y0);
        const xStart = Math.floor(x0), xEnd = Math.min(Math.ceil(x1), sw);
        for (let xx = xStart; xx < xEnd; xx++) {
          const wX = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const w = wX * wY;
          const i = (yy * sw + xx) * 4;
          const a = rgba[i + 3] / 255;
          sumA += a * w;
          sumAr += rgba[i] * a * w; sumAg += rgba[i + 1] * a * w; sumAb += rgba[i + 2] * a * w;
        }
      }
      const total = (x1 - x0) * (y1 - y0);
      const o = (y * dstW + x) * 4;
      const aAvg = sumA / total;
      out[o + 3] = Math.round(aAvg * 255);
      if (aAvg > 0) {
        out[o] = Math.round(sumAr / sumA);
        out[o + 1] = Math.round(sumAg / sumA);
        out[o + 2] = Math.round(sumAb / sumA);
      }
    }
  }
  return { w: dstW, h: dstH, rgba: out };
}

/* ---------------- helpers ---------------- */
function sample(img, x, y) { const i = (y * img.w + x) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]]; }
function fillTransparent(img, r, g, b) {
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] < 10) { img.rgba[i - 3] = r; img.rgba[i - 2] = g; img.rgba[i - 1] = b; img.rgba[i] = 255; }
  return img;
}
function contentBBox(img, alphaMin) {
  let minX = img.w, minY = img.h, maxX = 0, maxY = 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}
function cropY(img, top, height) {
  const out = Buffer.alloc(img.w * height * 4);
  img.rgba.copy(out, 0, top * img.w * 4, (top + height) * img.w * 4);
  return { w: img.w, h: height, rgba: out };
}

/* ---------------- build ---------------- */
console.log("Reading brand assets from assets/ ...");
const circle = decodePNG(SRC(CIRCLE));     // 1254x1254 badge
const banner = decodePNG(SRC(BANNER));     // 1672x940 wide logo

const write = (name, buf) => { fs.writeFileSync(OUT(name), buf); console.log("wrote " + name + " (" + buf.length + " bytes)"); };

// 1) PWA icons from the circular badge
write("favicon-32.png", encodePNG(32, 32, resize(circle, 32, 32).rgba));
write("icon-192.png", encodePNG(192, 192, resize(circle, 192, 192).rgba));
write("icon-512.png", encodePNG(512, 512, resize(circle, 512, 512).rgba));
write("icon-512-maskable.png", encodePNG(512, 512, resize(circle, 512, 512).rgba));

// 2) apple-touch-icon: opaque (iOS ignores alpha) — fill the background with the
// badge's dark-blue interior (average of a few samples inside the globe area)
function findInteriorColor(img) {
  const pts = [[0.5, 0.28], [0.5, 0.72], [0.28, 0.5], [0.72, 0.5]];
  let r = 0, g = 0, b = 0, n = 0;
  for (const [fx, fy] of pts) {
    const i = (Math.floor(img.h * fy) * img.w + Math.floor(img.w * fx)) * 4;
    if (img.rgba[i + 3] > 120) { r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; n++; }
  }
  if (!n) return [15, 42, 90];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
const apple = resize(circle, 180, 180);
const bg = findInteriorColor(circle);
console.log("  interior color found:", bg.join(","));
fillTransparent(apple, bg[0], bg[1], bg[2]);
write("apple-touch-icon-180.png", encodePNG(180, 180, apple.rgba));

// 3) og-image 1200x630 from the wide logo banner (resize, then content-aware center crop)
const ogResized = resize(banner, 1200, Math.round(banner.h * (1200 / banner.w)));   // 1200x675
const box = contentBBox(ogResized, 12);
const windowH = 630;
// anchor the crop on the bottom of the content so the tagline is never clipped
let top = Math.max(0, Math.min(box.maxY - windowH, ogResized.h - windowH));
write("og-image.png", encodePNG(1200, windowH, cropY(ogResized, top, windowH).rgba));
console.log("  og crop: y " + top + ".." + (top + windowH) + " of " + ogResized.h + " (content " + box.minY + "-" + box.maxY + ")");
console.log("Done.");