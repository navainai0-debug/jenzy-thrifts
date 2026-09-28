// /sitemap.xml  →  list of every page Google should show in search
// (home page, "Sell your sneakers" and every shoe that is for sale).
// Rewrite is in vercel.json. Updates itself when you add or sell shoes.
import { getDb } from './_lib/db.js';
import { siteUrl } from './_lib/notify.js';

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
    const urls = [
        { loc: `${origin}/`, freq: 'daily', priority: '1.0' },
        { loc: `${origin}/sell.html`, freq: 'monthly', priority: '0.5' }
    ];
    try {
        const { data, error } = await getDb()
            .from('products')
            .select('id, created_at, updated_at, images')
            .eq('status', 'Active')
            .order('created_at', { ascending: false })
            .limit(5000);
        if (error) throw error;
        for (const p of data || []) {
            urls.push({
                loc: `${origin}/shoe/${encodeURIComponent(p.id)}`,
                lastmod: day(p.updated_at || p.created_at),
                freq: 'weekly', priority: '0.8',
                image: Array.isArray(p.images) && /^https:\/\//.test(p.images[0] || '') ? p.images[0] : ''
            });
        }
    } catch (e) {
        console.error('[sitemap] could not load products', e.message);
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
