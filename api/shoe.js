// /shoe/<id>  →  the product page, with the shoe's photo, name and price
// added as preview tags so links shared on WhatsApp / Instagram / Facebook
// show a proper preview card. (Rewrite is in vercel.json.)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from './_lib/db.js';
import { isUuid } from './_lib/shop.js';
import { siteUrl } from './_lib/notify.js';

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
    else if ((p.sizes || []).length) parts.push(`Size${p.sizes.length > 1 ? 's' : ''} US ${sortSizes(p.sizes).join(', ')}`);
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

export function injectMeta(html, m) {
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
        m.jsonLd ? `<script type="application/ld+json">${JSON.stringify(m.jsonLd).replace(/</g, '\\u003c')}</script>` : ''
    ].filter(Boolean).map(t => '    ' + t).join('\n');

    return html
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

    let product = null;
    if (isUuid(id)) {
        try {
            const { data } = await getDb()
                .from('products')
                .select('id, name, brand, price, original_price, condition, sizes, status, images')
                .eq('id', id)
                .maybeSingle();
            product = data || null;
        } catch (e) {
            console.error('[shoe] could not load product', e.message);
        }
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache at Vercel's edge for 5 min (the page itself always loads live stock)
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
    res.end(injectMeta(html, buildMeta(product, origin, id)));
}
