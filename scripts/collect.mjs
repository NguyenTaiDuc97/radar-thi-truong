// Thu thập dữ liệu thị trường mỗi ngày -> docs/data.json (dashboard đọc file này)
// Chạy: node scripts/collect.mjs   (Node 18+; không cần cài thư viện)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HIST_DIR = path.join(ROOT, 'data', 'history');
const OUT = path.join(ROOT, 'docs', 'data.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const LIMIT = Math.min(config.so_san_pham_moi_tu_khoa || 30, 40);

// Ngày theo giờ Việt Nam (UTC+7)
const vnDate = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const today = vnDate();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400e3);

async function getJSON(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries) throw e;
      await sleep(1500 * i);
    }
  }
}

// ---------- Lọc sản phẩm đúng từ khóa (Tiki hay trả kèm hàng không liên quan) ----------
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
function relevant(name, keyword) {
  const n = ' ' + fold(name).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const toks = fold(keyword).split(/\s+/).filter(Boolean);
  const hit = toks.filter((t) => n.includes(' ' + t + ' ')).length;
  return n.includes(' ' + toks[0] + ' ') && hit / toks.length >= 0.75;
}

// ---------- Tiki: top bán chạy theo từ khóa ----------
async function tiki(keyword) {
  let raw = [];
  for (let page = 1; page <= 3 && raw.filter((p) => relevant(p.name, keyword)).length < LIMIT; page++) {
    const url = `https://tiki.vn/api/v2/products?limit=40&page=${page}&q=${encodeURIComponent(keyword)}&sort=top_seller`;
    const j = await getJSON(url);
    if (!j.data?.length) break;
    raw.push(...j.data);
    await sleep(500);
  }
  const seen = new Set();
  raw = raw.filter((p) => relevant(p.name, keyword) && !seen.has(p.id) && seen.add(p.id)).slice(0, LIMIT);
  return raw.map((p) => ({
    key: 'tiki:' + p.id,
    platform: 'Tiki',
    name: p.name,
    price: p.price,
    original_price: p.original_price,
    discount: p.discount_rate || 0,
    sold: p.quantity_sold?.value ?? 0,
    rating: p.rating_average || 0,
    reviews: p.review_count || 0,
    brand: p.brand_name || '',
    seller: p.seller_name || '',
    category: p.primary_category_name || '',
    image: p.thumbnail_url,
    url: 'https://tiki.vn/' + p.url_path,
  }));
}

// ---------- Google Trends: tìm kiếm đang nổi ở VN ----------
async function googleTrends() {
  const r = await fetch('https://trends.google.com/trending/rss?geo=VN', { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const xml = await r.text();
  const tag = (s, t) => (s.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim() || '';
  const dec1 = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/gi, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const dec = (s) => dec1(dec1(s)); // RSS của Google đôi khi mã hóa 2 lần
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => ({
    term: dec(tag(m[1], 'title')),
    traffic: tag(m[1], 'ht:approx_traffic'),
    news: dec(tag(m[1], 'ht:news_item_title')),
    news_url: dec(tag(m[1], 'ht:news_item_url')),
    date: tag(m[1], 'pubDate'),
  }));
}

// ---------- Dữ liệu nhập tay (Shopee, TikTok, Lazada, Facebook...) ----------
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const num = (s) => {
  const n = Number(String(s || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(s || '').trim() !== '' ? n : null;
};
function manual() {
  const f = path.join(ROOT, 'data', 'manual.csv');
  if (!fs.existsSync(f)) return [];
  const [head, ...rows] = parseCSV(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const g = (r, k) => (r[idx[k]] ?? '').trim();
  return rows
    .filter((r) => g(r, 'ten_san_pham') && !/^VÍ DỤ/i.test(g(r, 'ten_san_pham')))
    .map((r, i) => ({
      key: 'manual:' + i,
      platform: g(r, 'nen_tang') || 'Khác',
      keyword: g(r, 'tu_khoa'),
      name: g(r, 'ten_san_pham'),
      price: num(g(r, 'gia')),
      sold: num(g(r, 'da_ban')) ?? 0,
      per_day: num(g(r, 'ban_moi_ngay')),
      url: g(r, 'link'),
      date: g(r, 'ngay'),
      rating: 0, reviews: 0, manual: true,
    }));
}

// ---------- Lịch sử: so sánh số đã bán để ra "bán/ngày" ----------
function loadHistory() {
  if (!fs.existsSync(HIST_DIR)) return [];
  return fs.readdirSync(HIST_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < today)
    .sort()
    .map((f) => ({ date: f.slice(0, 10), sold: JSON.parse(fs.readFileSync(path.join(HIST_DIR, f), 'utf8')).sold }));
}

// Chọn mốc so sánh: cũ nhất trong vòng 7 ngày gần đây (ít nhất 1 ngày)
function baseline(history, key) {
  for (const h of history) {
    const d = daysBetween(h.date, today);
    if (d >= 1 && d <= 7 && h.sold[key] != null) return { days: d, sold: h.sold[key] };
  }
  return null;
}

const norm = (vals) => {
  const max = Math.max(...vals, 0);
  return (v) => (max > 0 ? v / max : 0);
};

function score(list) {
  // Điểm hot 0-100: ưu tiên tốc độ bán (bán/ngày), sau đó tổng đã bán và đánh giá
  const hasVel = list.some((p) => p.per_day != null);
  const nv = norm(list.map((p) => Math.log1p(p.per_day || 0)));
  const ns = norm(list.map((p) => Math.log1p(p.sold || 0)));
  for (const p of list) {
    const r = (p.rating || 0) / 5;
    const s = hasVel ? 0.6 * nv(Math.log1p(p.per_day || 0)) + 0.3 * ns(Math.log1p(p.sold)) + 0.1 * r
                     : 0.85 * ns(Math.log1p(p.sold)) + 0.15 * r;
    p.score = Math.round(s * 100);
  }
}

async function main() {
  const history = loadHistory();
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const errors = [];
  const keywords = [];
  const snapshot = {};

  for (const [category, kws] of Object.entries(config.nganh_hang)) {
    for (const kw of kws) {
      let products = [];
      try {
        products = await tiki(kw);
      } catch (e) {
        errors.push(`Tiki "${kw}": ${e.message}`);
        // giữ dữ liệu cũ nếu hôm nay lỗi
        products = prev?.keywords.find((k) => k.keyword === kw)?.products.filter((p) => !p.manual) || [];
      }
      for (const p of products) {
        snapshot[p.key] = p.sold;
        const b = baseline(history, p.key);
        p.per_day = b ? Math.max(0, Math.round(((p.sold - b.sold) / b.days) * 10) / 10) : null;
        p.base_days = b?.days ?? null;
      }
      keywords.push({ category, keyword: kw, products });
      console.log(`✓ ${category} / ${kw}: ${products.length} sản phẩm`);
      await sleep(800);
    }
  }

  // Gộp dữ liệu nhập tay vào đúng từ khóa (hoặc tạo từ khóa mới)
  for (const m of manual()) {
    let k = keywords.find((x) => x.keyword.toLowerCase() === m.keyword.toLowerCase());
    if (!k) { k = { category: 'Nhập tay', keyword: m.keyword || '(không từ khóa)', products: [] }; keywords.push(k); }
    k.products.push(m);
  }

  for (const k of keywords) {
    score(k.products);
    k.products.sort((a, b) => b.score - a.score);
    k.total_sold = k.products.reduce((s, p) => s + (p.sold || 0), 0);
    k.total_per_day = k.products.some((p) => p.per_day != null)
      ? Math.round(k.products.reduce((s, p) => s + (p.per_day || 0), 0)) : null;
  }

  let trends = [];
  try { trends = await googleTrends(); } catch (e) { errors.push('Google Trends: ' + e.message); trends = prev?.trends || []; }

  fs.mkdirSync(HIST_DIR, { recursive: true });
  fs.writeFileSync(path.join(HIST_DIR, today + '.json'), JSON.stringify({ date: today, sold: snapshot }));

  // Xóa lịch sử cũ hơn 60 ngày cho repo gọn
  for (const f of fs.readdirSync(HIST_DIR)) if (daysBetween(f.slice(0, 10), today) > 60) fs.unlinkSync(path.join(HIST_DIR, f));

  const out = {
    updated_at: new Date().toISOString(),
    date: today,
    history_days: history.length,
    keywords,
    trends,
    errors,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`\nXong: ${keywords.length} từ khóa, ${trends.length} xu hướng Google. Lỗi: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
