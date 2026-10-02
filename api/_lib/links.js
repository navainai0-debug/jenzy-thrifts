// Internal links + "last updated" dates, shared by /api/pages, /api/shoe and
// /api/sitemap. Every date shown comes from the database (when a shoe was
// listed or changed, when a guide was published or edited) — never made up.
import { BRAND_INFO, CITY_INFO } from './seo-content.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------
const valid = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t : null; };
const KHI = { timeZone: 'Asia/Karachi' };

export function fmtDay(d) {
    const t = valid(d);
    return t ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...KHI }) : '';
}
const dayKey = (d) => { const t = valid(d); return t ? t.toLocaleDateString('en-CA', KHI) : ''; };   // 2026-10-02 (Pakistan time)

// The newest date found in a list of rows, e.g. newest(products, 'updated_at', 'created_at')
export function newest(rows, ...fields) {
    let best = null;
    for (const r of rows || []) for (const f of fields) {
        const t = valid(r?.[f]);
        if (t && (!best || t > best)) best = t;
    }
    return best ? best.toISOString() : null;
}

// A later edit counts as an "update" only if it happened on a later day
export const laterDay = (updated, published) => !!(valid(updated) && valid(published) && dayKey(updated) > dayKey(published));

export function timeTag(d) {
    const t = valid(d);
    return t ? `<time datetime="${t.toISOString()}">${esc(fmtDay(t))}</time>` : '';
}

// "Published 1 Oct 2026 · Updated 3 Oct 2026"
export function pubLine(published, updated) {
    const parts = [];
    if (valid(published)) parts.push(`Published ${timeTag(published)}`);
    if (laterDay(updated, published)) parts.push(`Updated ${timeTag(updated)}`);
    else if (!valid(published) && valid(updated)) parts.push(`Updated ${timeTag(updated)}`);
    return parts.join(' • ');
}

// Small "Stock updated 2 October 2026" line for shop pages
export function freshLine(date, label = 'Stock updated') {
    return valid(date) ? `<p class="fresh-line"><i class="fa-regular fa-clock"></i> ${esc(label)} ${timeTag(date)}</p>` : '';
}

// ---------------------------------------------------------------------
// Guides: pick the most useful ones for a page
// ---------------------------------------------------------------------
// Always-useful guides (only shown if they are still published)
export const KEY_GUIDES = [
    'sneaker-size-guide-nike-adidas-jordan-new-balance',
    'how-to-spot-fake-nike-sneakers',
    'how-ordering-and-cash-on-delivery-works',
    'why-buy-thrifted-sneakers-in-pakistan'
];

// Guides tagged with the brand first, then the key guides, then the newest
export function pickGuides(posts, { brand = '', slugOf = (t) => t, exclude = '', limit = 3 } = {}) {
    const list = (posts || []).filter(p => p && p.slug && p.slug !== exclude);
    const out = [];
    const add = (p) => { if (p && out.length < limit && !out.includes(p)) out.push(p); };
    if (brand) list.filter(p => (p.tags || []).some(t => slugOf(t) === brand)).forEach(add);
    KEY_GUIDES.forEach(s => add(list.find(p => p.slug === s)));
    list.forEach(add);
    return out;
}

// ---------------------------------------------------------------------
// Link brand names inside a guide to their brand page
// ---------------------------------------------------------------------
// Only the first mention of each brand, only brands with shoes in stock,
// never inside an existing link, heading or code.
const BRAND_WORDS = Object.entries(BRAND_INFO)
    .map(([slug, b]) => ({ slug, re: new RegExp(`(^|[^\\w-])(${b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w-])`) }));

export function autoLinkBrands(html, { inStock = new Set(), max = 6 } = {}) {
    const linked = new Set();
    for (const m of String(html).matchAll(/href="\/brand\/([a-z0-9-]+)"/g)) linked.add(m[1]);
    let todo = BRAND_WORDS.filter(b => inStock.has(b.slug) && !linked.has(b.slug));
    if (!todo.length) return html;
    let count = 0, blocked = 0;
    return String(html).split(/(<[^>]+>)/).map(part => {
        if (part.startsWith('<')) {
            const m = part.match(/^<(\/?)(a|h[1-6]|code|pre|button)\b/i);
            if (m) blocked = Math.max(0, blocked + (m[1] ? -1 : 1));
            return part;
        }
        if (blocked || count >= max || !todo.length || !part.trim()) return part;
        let out = '', rest = part;
        for (;;) {
            let hit = null;
            for (const b of todo) {
                const m = b.re.exec(rest);
                if (m && (!hit || m.index < hit.m.index)) hit = { b, m };
            }
            if (!hit || count >= max) break;
            const start = hit.m.index + hit.m[1].length;
            const word = hit.m[2];
            out += rest.slice(0, start) + `<a href="/brand/${hit.b.slug}">${word}</a>`;
            rest = rest.slice(start + word.length);
            todo = todo.filter(b => b !== hit.b);
            count++;
        }
        return out + rest;
    }).join('');
}

// ---------------------------------------------------------------------
// Ready-made link blocks
// ---------------------------------------------------------------------
export const cityChips = (skip = '', limit = 99) => `<div class="chip-links">${Object.entries(CITY_INFO).filter(([s]) => s !== skip).slice(0, limit)
    .map(([s, c]) => `<a href="/city/${s}">${esc(c.name)}</a>`).join('')}</div>`;

export const brandChips = (brands, { skip = '', limit = 12, all = true } = {}) => {
    const list = (brands || []).filter(b => b.slug !== skip).slice(0, limit);
    if (!list.length && !all) return '';
    return `<div class="chip-links">${list.map(b => `<a href="/brand/${esc(b.slug)}">${esc(b.name)}</a>`).join('')}${all ? '<a href="/brands">All brands <i class="fas fa-arrow-right"></i></a>' : ''}</div>`;
};

export const guideLinks = (posts) => (posts || []).length
    ? `<ul class="link-list">${posts.map(p => `<li><a href="/blog/${esc(p.slug)}"><i class="fas fa-book-open"></i><span>${esc(p.title)}</span></a></li>`).join('')}<li><a href="/blog"><i class="fas fa-arrow-right"></i><span>All guides</span></a></li></ul>`
    : '';
