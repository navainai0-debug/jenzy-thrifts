// /sitemap.xml  →  list of every page Google should show in search
// (home page, shoes for sale, brand + city pages and blog guides).
// Rewrite is in vercel.json. Updates itself when you add or sell shoes.
import { getDb } from './_lib/db.js';
import { siteUrl } from './_lib/notify.js';
import { ensureStarterPosts, publishedPosts, brandsFromProducts, brandSlug } from './_lib/content.js';
import { newest } from './_lib/links.js';
import { CITY_INFO } from './_lib/seo-content.js';

const xmlEsc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const day = (d) => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toISOString().slice(0, 10) : ''; };

// Google Search Console "HTML file" check: /google1234abcd.html
// Set GOOGLE_VERIFICATION in Vercel to the file name Google gives you.
function googleVerification(req, res, file) {
    const want = (process.env.GOOGLE_VERIFICATION || '').trim().replace(/\.html$/i, '');
    const got = String(file || '').replace(/\.html$/i, '');
    if (!want || want !== got) { res.statusCode = 404; return res.end('Not found'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`google-site-verification: ${want}.html`);
}

export default async function handler(req, res) {
    const origin = siteUrl(req);
    const gsv = (req.query && req.query.gsv) || new URL(req.url, origin).searchParams.get('gsv');
    if (gsv) return googleVerification(req, res, gsv);
    const db = getDb();
    // Real "last changed" dates: newest product change / newest guide edit
    let products = [], posts = [];
    try {
        const { data, error } = await db
            .from('products')
            .select('id, created_at, updated_at, images, brand, sizes')
            .eq('status', 'Active')
            .order('created_at', { ascending: false })
            .limit(5000);
        if (error) throw error;
        products = data || [];
    } catch (e) {
        console.error('[sitemap] could not load products', e.message);
    }
    try {
        await ensureStarterPosts(db);
        posts = await publishedPosts(db, { limit: 1000, fields: 'slug, published_at, updated_at' });
    } catch (e) {
        console.error('[sitemap] could not load posts', e.message);
    }
    const inStock = products.filter(p => (p.sizes || []).length);
    const stockDay = day(newest(products, 'updated_at', 'created_at'));
    const urls = [
        { loc: `${origin}/`, lastmod: stockDay, freq: 'daily', priority: '1.0' },
        { loc: `${origin}/sell.html`, freq: 'monthly', priority: '0.5' },
        { loc: `${origin}/brands`, lastmod: stockDay, freq: 'weekly', priority: '0.7' },
        { loc: `${origin}/blog`, lastmod: day(newest(posts, 'updated_at', 'published_at')), freq: 'weekly', priority: '0.6' }
    ];
    // Blog guides
    for (const p of posts) {
        urls.push({ loc: `${origin}/blog/${encodeURIComponent(p.slug)}`, lastmod: day(p.updated_at || p.published_at), freq: 'monthly', priority: '0.6' });
    }
    // City pages (they show the latest arrivals)
    for (const slug of Object.keys(CITY_INFO)) urls.push({ loc: `${origin}/city/${slug}`, lastmod: stockDay, freq: 'weekly', priority: '0.6' });
    // Brand pages (only brands with shoes in stock)
    for (const b of brandsFromProducts(inStock)) {
        const mine = inStock.filter(p => brandSlug(p.brand) === b.slug);
        urls.push({ loc: `${origin}/brand/${b.slug}`, lastmod: day(newest(mine, 'updated_at', 'created_at')), freq: 'daily', priority: '0.8' });
    }
    for (const p of products) {
        urls.push({
            loc: `${origin}/shoe/${encodeURIComponent(p.id)}`,
            lastmod: day(p.updated_at || p.created_at),
            freq: 'weekly', priority: '0.8',
            image: Array.isArray(p.images) && /^https:\/\//.test(p.images[0] || '') ? p.images[0] : ''
        });
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map(u => `  <url>
    <loc>${xmlEsc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>${u.image ? `\n    <image:image><image:loc>${xmlEsc(u.image)}</image:loc></image:image>` : ''}
  </url>`).join('\n')}
</urlset>
`;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.end(body);
}
