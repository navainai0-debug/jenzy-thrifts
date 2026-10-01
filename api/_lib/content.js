// Blog posts + brand helpers shared by /api/pages, /api/sitemap and /api/admin.
import { HttpError } from './http.js';
import { slugify } from './markdown.js';
import { STARTER_GUIDES } from './guides.js';
import { BRAND_INFO } from './seo-content.js';
import { readSetting, writeSetting } from './notify.js';

// ---------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------
const ALIAS = new Map();
for (const [slug, b] of Object.entries(BRAND_INFO)) for (const a of b.aliases) ALIAS.set(a, slug);

export function brandSlug(brand) {
    const key = String(brand || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return '';
    return ALIAS.get(key) || slugify(key);
}
export function brandName(slug, products = []) {
    if (BRAND_INFO[slug]) return BRAND_INFO[slug].name;
    const p = products.find(x => brandSlug(x.brand) === slug);
    return p ? String(p.brand).trim() : slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
// [{ slug, name, count }] for brands with shoes in the shop (most shoes first)
export function brandsFromProducts(products) {
    const map = new Map();
    for (const p of products) {
        const slug = brandSlug(p.brand);
        if (!slug) continue;
        if (!map.has(slug)) map.set(slug, { slug, name: BRAND_INFO[slug]?.name || String(p.brand).trim(), count: 0 });
        map.get(slug).count += 1;
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------
// The 6 starter guides are added once (the first time the blog is used).
// Deleting one later is respected — it doesn't come back.
export async function ensureStarterPosts(db) {
    if (await readSetting('blog_seeded')) return false;
    const { error: tableError } = await db.from('posts').select('id', { head: true, count: 'exact' });
    if (tableError) return false;   // supabase-setup.sql not re-run yet
    const now = Date.now();
    const rows = STARTER_GUIDES.map((g, i) => ({
        slug: g.slug, title: g.title, excerpt: g.excerpt, body: g.body, tags: g.tags,
        status: 'Published', author: 'JENZY THRIFTS',
        published_at: new Date(now - (STARTER_GUIDES.length - i) * 86400000).toISOString()
    }));
    const { error } = await db.from('posts').upsert(rows, { onConflict: 'slug', ignoreDuplicates: true });
    if (error) { console.error('[blog] could not add starter guides', error.message); return false; }
    try { await writeSetting('blog_seeded', { at: new Date().toISOString(), count: rows.length }); } catch { /* ignore */ }
    return true;
}

export async function publishedPosts(db, { limit = 100, fields = 'id, slug, title, excerpt, cover_image, tags, published_at, updated_at, body' } = {}) {
    const { data, error } = await db.from('posts').select(fields).eq('status', 'Published')
        .order('published_at', { ascending: false }).limit(limit);
    if (error) return [];
    return data || [];
}

const okImage = (u) => /^https:\/\/[^\s"'<>]+$/.test(String(u || ''));

export function sanitizePost(p = {}) {
    const title = String(p.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (title.length < 3) throw new HttpError(400, 'Please write a title (at least 3 letters).');
    const slug = slugify(p.slug || title);
    if (!slug) throw new HttpError(400, 'Please choose a web address (slug) using letters and numbers.');
    const body = String(p.body ?? '').replace(/\r/g, '').slice(0, 60000);
    if (body.trim().length < 20) throw new HttpError(400, 'The post is too short — write at least a few sentences.');
    const status = p.status === 'Published' ? 'Published' : 'Draft';
    const tags = [...new Set((Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(','))
        .map(t => String(t).replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
    return {
        title, slug, body, status, tags,
        excerpt: String(p.excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
        cover_image: okImage(p.cover_image) ? String(p.cover_image) : null
    };
}
