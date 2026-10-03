// /shoe/<id>  →  the product page, with the shoe's photo, name and price
// added as preview tags so links shared on WhatsApp / Instagram / Facebook
// show a proper preview card. (Rewrite is in vercel.json.)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './_lib/db.js';
import { isUuid } from './_lib/shop.js';
import { siteUrl } from './_lib/notify.js';
import { brandSlug, brandName, brandsFromProducts, publishedPosts } from './_lib/content.js';
import { pickGuides, guideLinks, brandChips, cityChips } from './_lib/links.js';

const SHOP = 'JENZY THRIFTS';
let template = null;

async function loadTemplate(origin) {
    if (template) return template;
    try {
        template = await readFile(path.join(process.cwd(), 'product.html'), 'utf8');
    } catch {
        const r = await fetch(origin + '/product.html', { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error('product.html not found');
        template = await r.text();
    }
    return template;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-US');

function sortSizes(sizes) {
    return [...(sizes || [])].sort((a, b) => parseFloat(a) - parseFloat(b));
}

export function buildMeta(p, origin, id) {
    const url = `${origin}/shoe/${encodeURIComponent(id || '')}`;
    const fallbackImage = `${origin}/assets/img/og-cover.jpg`;
    if (!p || p.status === 'Draft') {
        return {
            title: `Shoe not available | ${SHOP}`,
            description: 'Authentic thrifted sneakers — Nike, Adidas, Jordan, New Balance and more. Cash on delivery across Pakistan.',
            image: fallbackImage, url, jsonLd: null, price: null
        };
    }
    const name = p.brand && !String(p.name).toLowerCase().startsWith(String(p.brand).toLowerCase())
        ? `${p.brand} ${p.name}` : p.name;
    const sold = p.status === 'Sold' || !(p.sizes || []).length;
    const parts = [];
    if (sold) parts.push('SOLD OUT');
    else if ((p.sizes || []).length) parts.push(`Size${p.sizes.length > 1 ? 's' : ''} UK ${sortSizes(p.sizes).join(', ')}`);
    if (p.condition) parts.push(`${p.condition} condition`);
    if (p.original_price > p.price) parts.push(`Retail ${pkr(p.original_price)}`);
    parts.push('Cash on delivery across Pakistan');
    const image = (p.images || []).find(u => /^https:\/\//.test(u)) || fallbackImage;
    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name,
        image: (p.images || []).slice(0, 4),
        brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
        itemCondition: 'https://schema.org/UsedCondition',
        size: sold ? undefined : sortSizes(p.sizes).map(s => ({ '@type': 'SizeSpecification', name: `UK ${s}`, sizeSystem: 'https://schema.org/WearableSizeSystemUK' })),
        offers: {
            '@type': 'Offer',
            price: p.price,
            priceCurrency: 'PKR',
            availability: sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
            url
        }
    };
    return {
        title: `${name} — ${pkr(p.price)} | ${SHOP}`,
        ogTitle: `${name} — ${pkr(p.price)}`,
        description: parts.join(' • '),
        image, url, jsonLd, price: p.price, alt: name
    };
}

// Home › Brands › Nike › Air Force 1  (shown on the page and given to Google)
export function crumbsFor(p, origin, id) {
    const items = [{ name: 'Home', href: '/' }];
    const slug = brandSlug(p?.brand);
    if (slug) items.push({ name: 'Brands', href: '/brands' }, { name: brandName(slug, [p]), href: `/brand/${slug}` });
    else items.push({ name: 'Shop', href: '/#shop' });
    if (p && p.status !== 'Draft') items.push({ name: p.name, href: `/shoe/${encodeURIComponent(id)}` });
    return items;
}
const crumbsHtml = (items) => items.map((c, i) => i < items.length - 1
    ? `<a href="${esc(c.href)}">${esc(c.name)}</a><i class="fas fa-chevron-right"></i>` : `<span>${esc(c.name)}</span>`).join('');
const crumbsLd = (items, origin) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: origin + c.href }))
});

// "Keep exploring" block under the shoe: same-brand page, guides, brands, cities
export function exploreHtml(p, { stock = [], posts = [] } = {}) {
    const slug = brandSlug(p?.brand);
    const brands = brandsFromProducts(stock);
    const mine = brands.find(b => b.slug === slug);
    const name = slug ? brandName(slug, [p]) : '';
    const guides = pickGuides(posts, { brand: slug, slugOf: brandSlug, limit: 4 });
    const cols = [];
    if (slug) cols.push(`<div class="explore-col"><h3>More ${esc(name)}</h3><ul class="link-list">
        <li><a href="/brand/${slug}"><i class="fas fa-shoe-prints"></i><span>All ${esc(name)} sneakers${mine ? ` (${mine.count} in stock)` : ''}</span></a></li>
        <li><a href="/?brand=${encodeURIComponent(p.brand)}#shop"><i class="fas fa-sliders"></i><span>Filter ${esc(name)} by size &amp; price</span></a></li>
        <li><a href="/#shop"><i class="fas fa-bag-shopping"></i><span>All shoes in the shop</span></a></li></ul></div>`);
    if (guides.length) cols.push(`<div class="explore-col"><h3>Helpful guides</h3>${guideLinks(guides)}</div>`);
    cols.push(`<div class="explore-col"><h3>Shop by brand</h3>${brandChips(brands, { skip: slug, limit: 8 })}</div>`);
    cols.push(`<div class="explore-col"><h3>We deliver to</h3>${cityChips('', 8)}</div>`);
    return `<section class="explore container" id="pdExplore">
    <div class="related-head"><div><span class="eyebrow">Keep exploring</span><h2 class="section-title">Find your <span class="grad">next pair</span></h2></div></div>
    <div class="explore-grid">${cols.join('\n')}</div>
</section>`;
}

export function injectMeta(html, m, extra = {}) {
    const tags = [
        `<meta property="og:site_name" content="${SHOP}">`,
        `<meta property="og:type" content="${m.price ? 'product' : 'website'}">`,
        `<meta property="og:title" content="${esc(m.ogTitle || m.title)}">`,
        `<meta property="og:description" content="${esc(m.description)}">`,
        `<meta property="og:url" content="${esc(m.url)}">`,
        `<meta property="og:image" content="${esc(m.image)}">`,
        m.alt ? `<meta property="og:image:alt" content="${esc(m.alt)}">` : '',
        m.price ? `<meta property="product:price:amount" content="${m.price}">` : '',
        m.price ? `<meta property="product:price:currency" content="PKR">` : '',
        `<meta name="twitter:card" content="summary_large_image">`,
        `<link rel="canonical" href="${esc(m.url)}">`,
        m.jsonLd ? `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
        extra.crumbs ? `<script type="application/ld+json">${JSON.stringify(crumbsLd(extra.crumbs, extra.origin)).replace(/</g, '\\u003c')}</script>` : '',
        extra.links ? `<script type="application/json" id="pdLinks">${JSON.stringify(extra.links).replace(/</g, '\\u003c')}</script>` : ''
    ].filter(Boolean).map(t => '    ' + t).join('\n');

    let out = html;
    if (extra.crumbs) out = out.replace(/(<nav class="breadcrumb" id="breadcrumb"[^>]*>)[\s\S]*?(<\/nav>)/, `$1${crumbsHtml(extra.crumbs)}$2`);
    if (extra.explore) out = out.replace(/<section class="explore container" id="pdExplore">[\s\S]*?<\/section>/, () => extra.explore);
    return out
        // pages use relative links (assets/…, checkout.html) — resolve them from the site root
        .replace(/<head>/i, '<head>\n    <base href="/">')
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(m.title)}</title>`)
        .replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${esc(m.description)}">`)
        .replace(/<\/head>/i, `${tags}\n</head>`);
}

export default async function handler(req, res) {
    const origin = siteUrl(req);
    const url = new URL(req.url, origin);
    const id = (req.query && req.query.id) || url.searchParams.get('id') || '';

    // Pictures: /assets/img/<name> is rewritten here when the image file itself
    // was not uploaded (vercel.json). Cached for a year at the edge.
    const img = (req.query && req.query.img) || url.searchParams.get('img');
    if (img) {
        const { IMAGES } = await import('./_lib/images.js');
        const file = Object.prototype.hasOwnProperty.call(IMAGES, img) ? IMAGES[img] : null;
        if (!file) { res.statusCode = 404; return res.end('Not found'); }
        res.statusCode = 200;
        res.setHeader('Content-Type', file.type);
        res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=31536000, immutable');
        return res.end(Buffer.from(file.data, 'base64'));
    }

    let html;
    try {
        html = await loadTemplate(origin);
    } catch {
        res.statusCode = 302;
        res.setHeader('Location', `/product.html?id=${encodeURIComponent(id)}`);
        return res.end();
    }

    let product = null, stock = [], posts = [];
    if (isUuid(id)) {
        const db = getDb();
        const [one, many, guides] = await Promise.allSettled([
            db.from('products').select('id, name, brand, price, original_price, condition, sizes, status, images').eq('id', id).maybeSingle(),
            db.from('products').select('brand, sizes').eq('status', 'Active').limit(2000),
            publishedPosts(db, { limit: 30, fields: 'slug, title, tags, published_at' })
        ]);
        if (one.status === 'fulfilled' && !one.value.error) product = one.value.data || null;
        else console.error('[shoe] could not load product', one.reason?.message || one.value?.error?.message);
        if (many.status === 'fulfilled' && !many.value.error) stock = (many.value.data || []).filter(p => (p.sizes || []).length);
        if (guides.status === 'fulfilled') posts = guides.value || [];
    }
    const visible = product && product.status !== 'Draft';
    const crumbs = visible ? crumbsFor(product, origin, id) : null;
    const slug = visible ? brandSlug(product.brand) : '';

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache at Vercel's edge for 5 min (the page itself always loads live stock)
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.end(injectMeta(html, buildMeta(product, origin, id), visible ? {
        origin, crumbs,
        links: slug ? { brandSlug: slug, brandName: brandName(slug, [product]) } : {},
        explore: exploreHtml(product, { stock, posts })
    } : {}));
}
