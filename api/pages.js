// Server-built pages (good for Google, fast on phones). Rewrites in vercel.json:
//   /blog                 → ?type=blog         all guides
//   /blog/<slug>          → ?type=post         one guide
//   /brands               → ?type=brands       every brand
//   /brand/<slug>         → ?type=brand        e.g. "Nike shoes in Pakistan"
//   /city/<slug>          → ?type=city         e.g. "Thrifted sneakers in Lahore"
//   /c/<token>            → ?type=confirm      customer confirms the order (WhatsApp link)
//   /verify/<code>        → ?type=verify       check an authenticity card
import { getDb } from './_lib/db.js';
import { siteUrl, notifyOwner } from './_lib/notify.js';
import { renderMarkdown, plainText, readingMinutes } from './_lib/markdown.js';
import { ensureStarterPosts, publishedPosts, brandSlug, brandName, brandsFromProducts } from './_lib/content.js';
import { BRAND_INFO, CITY_INFO } from './_lib/seo-content.js';
import { fmtDay, newest, laterDay, timeTag, pubLine, freshLine, pickGuides, autoLinkBrands, cityChips, brandChips } from './_lib/links.js';

const SHOP = 'JENZY THRIFTS';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-US');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const PRODUCT_FIELDS = 'id, name, brand, price, original_price, condition, sizes, status, images, thumbs, tag, created_at, updated_at';

function send(res, status, html, cache = 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400') {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    res.end(html);
}

// ---------------------------------------------------------------------
// Page frame — the normal store header/footer come from store.js
// ---------------------------------------------------------------------
function shell({ title, description, canonical, body, jsonLd = [], noindex = false, image, origin, type = 'website', head = '' }) {
    const img = image || `${origin}/assets/img/og-cover.jpg`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <base href="/">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0a0a0b">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    ${noindex ? '<meta name="robots" content="noindex">' : ''}
    ${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
    <meta property="og:site_name" content="${SHOP}">
    <meta property="og:type" content="${type}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    ${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
    <meta property="og:image" content="${esc(img)}">
    <meta name="twitter:card" content="summary_large_image">
    ${head}
    <link rel="icon" type="image/png" sizes="192x192" href="assets/img/icon-192.png">
    <link rel="apple-touch-icon" href="assets/img/icon-180.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;800;900&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/store.css">
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
    <script src="assets/js/config.js"></script>
    ${jsonLd.filter(Boolean).map(ld).join('\n    ')}
</head>
<body data-page="content">
<main class="container content-page">
${body}
</main>
<script src="assets/js/store.js"></script>
</body>
</html>`;
}

// Small standalone page (confirm link, certificate check) — light and fast
function plainPage({ title, body, origin }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#0a0a0b">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>${esc(title)} | ${SHOP}</title>
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/img/icon-192.png">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;800&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/css/store.css">
</head>
<body class="plain-page">
<header class="plain-head"><a href="${esc(origin)}/" class="brand"><span class="brand-main">JENZY</span><span class="brand-sub">THRIFTS</span></a></header>
<main class="plain-main">
${body}
</main>
</body>
</html>`;
}

const crumbs = (items) => `<nav class="breadcrumb" aria-label="Breadcrumb">${items.map((c, i) => i < items.length - 1
    ? `<a href="${esc(c.href)}">${esc(c.name)}</a><i class="fas fa-chevron-right"></i>`
    : `<span>${esc(c.name)}</span>`).join('')}</nav>`;
const crumbsLd = (items, origin) => ({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: origin + c.href }))
});

const thumb = (p) => p.thumbs?.[0] || p.images?.[0] || '';
const sortSizes = (s) => [...(s || [])].sort((a, b) => (parseFloat(a) || 999) - (parseFloat(b) || 999));
function card(p) {
    const off = p.original_price > p.price ? Math.round((1 - p.price / p.original_price) * 100) : 0;
    const sizes = sortSizes(p.sizes);
    return `<a class="p-card" href="/shoe/${esc(p.id)}">
        <div class="p-media">
            <img class="main main-only" src="${esc(thumb(p))}" alt="${esc((p.brand ? p.brand + ' ' : '') + p.name)}" loading="lazy">
            <div class="p-badges">${p.tag ? `<span class="badge badge-${esc(String(p.tag).toLowerCase())}">${esc(p.tag)}</span>` : ''}${off >= 5 ? `<span class="badge badge-off">-${off}%</span>` : ''}</div>
            <span class="p-view">View details</span>
        </div>
        <div class="p-body">
            <span class="p-brand">${esc(p.brand || '')}</span>
            <h3 class="p-name">${esc(p.name)}</h3>
            <div class="p-meta">${p.condition ? `<span class="cond cond-${esc(p.condition)}">${esc(p.condition)}</span>` : ''}<span>${sizes.length ? 'UK ' + esc(sizes.join(', ')) : ''}</span></div>
            <div class="p-price"><span class="now">${pkr(p.price)}</span>${off ? `<span class="was">${pkr(p.original_price)}</span>` : ''}</div>
        </div>
    </a>`;
}
const grid = (list) => `<div class="p-grid">${list.map(card).join('')}</div>`;

function postCard(p) {
    return `<a class="post-card" href="/blog/${esc(p.slug)}">
        <div class="post-cover">${p.cover_image ? `<img src="${esc(p.cover_image)}" alt="" loading="lazy">` : `<i class="fas fa-book-open"></i>`}</div>
        <div class="post-card-body">
            ${(p.tags || []).length ? `<div class="post-tags">${p.tags.slice(0, 3).map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
            <h3>${esc(p.title)}</h3>
            <p>${esc(p.excerpt || plainText(p.body).slice(0, 150) + '…')}</p>
            <span class="post-meta">${laterDay(p.updated_at, p.published_at) ? 'Updated ' + timeTag(p.updated_at) + ' • ' : p.published_at ? timeTag(p.published_at) + ' • ' : ''}${readingMinutes(p.body)} min read</span>
        </div>
    </a>`;
}

async function activeProducts(db) {
    const { data, error } = await db.from('products').select(PRODUCT_FIELDS).eq('status', 'Active').order('created_at', { ascending: false }).limit(1000);
    if (error) throw error;
    return (data || []).filter(p => (p.sizes || []).length);
}

function faqBlock(faqs) {
    return `<section class="faq-block"><h2>Questions</h2>${faqs.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}</section>`;
}
const faqLd = (faqs) => ({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
});
const itemListLd = (list, origin) => ({
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${origin}/shoe/${p.id}`, name: (p.brand ? p.brand + ' ' : '') + p.name }))
});

// Tells Google what the page is and when its content last changed
const pageLd = (name, url, modified, kind = 'CollectionPage') => ({
    '@context': 'https://schema.org', '@type': kind, name, url,
    ...(modified ? { dateModified: modified } : {}),
    isPartOf: { '@type': 'WebSite', name: SHOP, url: url.replace(/^(https?:\/\/[^/]+).*$/, '$1') }
});
const POST_FIELDS = 'slug, title, tags, excerpt, body, published_at, updated_at, cover_image';
const guideGrid = (title, list) => list.length ? `<section class="seo-section"><div class="section-row"><h2>${esc(title)}</h2><a href="/blog">All guides <i class="fas fa-arrow-right"></i></a></div><div class="post-grid">${list.map(postCard).join('')}</div></section>` : '';

function notFound(res, origin, what = 'page') {
    return send(res, 404, shell({
        origin, title: `Not found | ${SHOP}`, description: 'This page does not exist.', noindex: true,
        body: `<div class="empty-state" style="padding:90px 20px"><i class="fas fa-shoe-prints"></i><p>Sorry, this ${esc(what)} doesn't exist (any more).</p><a href="/#shop" class="btn btn-primary" style="margin-top:18px">Browse shoes</a></div>`
    }), 'public, max-age=0, s-maxage=60');
}

// ---------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------
async function blogList(db, origin, res) {
    await ensureStarterPosts(db);
    const [posts, products] = await Promise.all([publishedPosts(db), activeProducts(db).catch(() => [])]);
    const updated = newest(posts, 'updated_at', 'published_at');
    const items = [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/blog' }];
    const body = `${crumbs(items)}
    <div class="page-head"><h1>Sneaker Guides &amp; Tips</h1><p>How to spot fakes, find your size, keep your kicks clean and shop smart in Pakistan.</p>${freshLine(updated, 'Last updated')}</div>
    ${posts.length ? `<div class="post-grid">${posts.map(postCard).join('')}</div>`
        : `<div class="empty-state"><i class="fas fa-book-open"></i><p>Guides are coming soon.</p></div>`}
    <div class="seo-cta"><h2>Looking for a pair?</h2><p>Original thrifted Nike, Jordan, Adidas and more — cash on delivery across Pakistan.</p><a href="/#shop" class="btn btn-primary"><i class="fas fa-bag-shopping"></i> Shop all shoes</a> <a href="/brands" class="btn btn-outline">Shop by brand</a></div>
    ${products.length ? `<section class="seo-section"><h2>Shop by brand</h2>${brandChips(brandsFromProducts(products))}</section>` : ''}`;
    return send(res, 200, shell({
        origin, title: `Sneaker Guides & Tips | ${SHOP}`, canonical: `${origin}/blog`,
        description: 'Guides from JENZY THRIFTS: how to spot fake Nikes, sneaker size charts, cleaning tips and how to buy thrifted sneakers in Pakistan.',
        body, jsonLd: [crumbsLd(items, origin), {
            '@context': 'https://schema.org', '@type': 'Blog', name: `${SHOP} Guides`, url: `${origin}/blog`, ...(updated ? { dateModified: updated } : {}),
            blogPost: posts.slice(0, 20).map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${origin}/blog/${p.slug}`, datePublished: p.published_at, dateModified: p.updated_at || p.published_at }))
        }]
    }));
}

async function blogPost(db, origin, res, slug) {
    await ensureStarterPosts(db);
    const { data: post } = await db.from('posts').select('*').eq('slug', String(slug || '').toLowerCase()).maybeSingle();
    if (!post || post.status !== 'Published') return notFound(res, origin, 'guide');
    const [others, products] = await Promise.all([publishedPosts(db, { limit: 12 }), activeProducts(db).catch(() => [])]);
    const tagBrands = new Set((post.tags || []).map(brandSlug));
    const picks = [...products.filter(p => tagBrands.has(brandSlug(p.brand))), ...products.filter(p => !tagBrands.has(brandSlug(p.brand)))].slice(0, 4);
    const more = others.filter(p => p.slug !== post.slug).slice(0, 3);
    const stock = brandsFromProducts(products);
    const inStock = new Set(stock.map(b => b.slug));
    // Brands this guide is about (from its tags) that have shoes in the shop
    const postBrands = stock.filter(b => tagBrands.has(b.slug));
    const modified = laterDay(post.updated_at, post.published_at) ? post.updated_at : post.published_at;
    const url = `${origin}/blog/${post.slug}`;
    const items = [{ name: 'Home', href: '/' }, { name: 'Guides', href: '/blog' }, { name: post.title, href: `/blog/${post.slug}` }];
    const description = post.excerpt || plainText(post.body).slice(0, 155);
    const share = encodeURIComponent(`${post.title}\n${url}`);
    const body = `${crumbs(items)}
    <article class="post">
        <header class="post-head">
            ${(post.tags || []).length ? `<div class="post-tags">${post.tags.map(t => inStock.has(brandSlug(t)) ? `<a href="/brand/${esc(brandSlug(t))}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join('')}</div>` : ''}
            <h1>${esc(post.title)}</h1>
            <p class="post-meta">${pubLine(post.published_at, post.updated_at) ? pubLine(post.published_at, post.updated_at) + ' • ' : ''}${readingMinutes(post.body)} min read • By ${SHOP}</p>
        </header>
        ${post.cover_image ? `<img class="post-hero" src="${esc(post.cover_image)}" alt="">` : ''}
        <div class="prose">${autoLinkBrands(renderMarkdown(post.body), { inStock })}</div>
        <div class="post-share">
            <span>Share this guide:</span>
            <a class="btn btn-outline btn-sm" href="https://wa.me/?text=${share}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> WhatsApp</a>
            <a class="btn btn-outline btn-sm" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener"><i class="fab fa-facebook"></i> Facebook</a>
        </div>
    </article>
    ${picks.length ? `<section class="seo-section"><div class="section-row"><h2>Shop the look</h2><a href="${postBrands.length === 1 ? `/brand/${postBrands[0].slug}` : '/#shop'}">${postBrands.length === 1 ? `All ${esc(postBrands[0].name)} shoes` : 'See all shoes'} <i class="fas fa-arrow-right"></i></a></div>${grid(picks)}</section>` : ''}
    ${guideGrid('More guides', more)}
    ${stock.length ? `<section class="seo-section"><h2>Shop by brand</h2>${brandChips([...postBrands, ...stock.filter(b => !tagBrands.has(b.slug))])}</section>` : ''}`;
    return send(res, 200, shell({
        origin, type: 'article', title: `${post.title} | ${SHOP}`, canonical: url, description, image: post.cover_image || undefined, body,
        head: [post.published_at ? `<meta property="article:published_time" content="${esc(new Date(post.published_at).toISOString())}">` : '',
            modified ? `<meta property="article:modified_time" content="${esc(new Date(modified).toISOString())}">` : ''].filter(Boolean).join('\n    '),
        jsonLd: [crumbsLd(items, origin), {
            '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description,
            datePublished: post.published_at, dateModified: modified || post.published_at,
            mainEntityOfPage: url, image: post.cover_image ? [post.cover_image] : [`${origin}/assets/img/og-cover.jpg`],
            author: { '@type': 'Organization', name: SHOP, url: origin },
            publisher: { '@type': 'Organization', name: SHOP, logo: { '@type': 'ImageObject', url: `${origin}/assets/img/icon-192.png` } }
        }]
    }));
}

// ---------------------------------------------------------------------
// Brands & cities
// ---------------------------------------------------------------------
const brandFaqs = (name) => [
    { q: `Are your ${name} shoes original?`, a: `Yes. Every ${name} pair at ${SHOP} is an authentic pre-owned (thrifted) shoe. We check each pair — size tag, style code, stitching, materials and shape — before listing it. We never sell copies.` },
    { q: 'How does cash on delivery work?', a: 'Place your order on the website, confirm it with the WhatsApp link we send you, and pay the rider in cash when the parcel arrives.' },
    { q: 'Do you deliver all over Pakistan?', a: 'Yes, we ship by courier to cities across Pakistan, including Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan and Peshawar.' },
    { q: 'How do I find my size?', a: 'Every shoe page has a size guide in centimetres. Measure your foot in cm and match it — or message us on WhatsApp and we will help.' }
];

async function brandsIndex(db, origin, res) {
    const products = await activeProducts(db);
    const brands = brandsFromProducts(products);
    const updated = newest(products, 'updated_at', 'created_at');
    const { data: postsData } = await db.from('posts').select(POST_FIELDS).eq('status', 'Published').order('published_at', { ascending: false }).limit(50);
    const guides = pickGuides(postsData || []);
    const items = [{ name: 'Home', href: '/' }, { name: 'Brands', href: '/brands' }];
    const body = `${crumbs(items)}
    <div class="page-head"><h1>Shop by Brand</h1><p>Original thrifted sneakers from the world's top brands — checked, cleaned and delivered across Pakistan.</p>${freshLine(updated)}</div>
    ${brands.length ? `<div class="brand-tiles">${brands.map(b => `<a class="brand-tile" href="/brand/${esc(b.slug)}"><strong>${esc(b.name)}</strong><span>${b.count} ${b.count === 1 ? 'pair' : 'pairs'}</span></a>`).join('')}</div>`
        : '<div class="empty-state"><i class="fas fa-shoe-prints"></i><p>New stock is on the way.</p></div>'}
    ${guideGrid('Before you buy', guides)}
    <section class="seo-section"><h2>Shop by city</h2>${cityChips()}</section>`;
    return send(res, 200, shell({
        origin, title: `Shop Sneakers by Brand — Nike, Jordan, Adidas & More | ${SHOP}`, canonical: `${origin}/brands`,
        description: `Original thrifted sneakers by brand: ${brands.slice(0, 8).map(b => b.name).join(', ') || 'Nike, Jordan, Adidas, New Balance'}. Cash on delivery across Pakistan.`,
        body, jsonLd: [crumbsLd(items, origin), pageLd('Shop sneakers by brand', `${origin}/brands`, updated)]
    }));
}

async function brandPage(db, origin, res, slug) {
    slug = String(slug || '').toLowerCase();
    const products = await activeProducts(db);
    const list = products.filter(p => brandSlug(p.brand) === slug);
    const info = BRAND_INFO[slug];
    if (!info && !list.length) return notFound(res, origin, 'brand');
    const name = brandName(slug, products);
    const min = list.length ? Math.min(...list.map(p => p.price)) : 0;
    const { data: postsData } = await db.from('posts').select(POST_FIELDS).eq('status', 'Published').order('published_at', { ascending: false }).limit(200);
    const guides = pickGuides(postsData || [], { brand: slug, slugOf: brandSlug });
    const ownGuides = guides.some(p => (p.tags || []).some(t => brandSlug(t) === slug));
    const updated = newest(list, 'updated_at', 'created_at');
    const otherBrands = brandsFromProducts(products).filter(b => b.slug !== slug).slice(0, 12);
    const items = [{ name: 'Home', href: '/' }, { name: 'Brands', href: '/brands' }, { name, href: `/brand/${slug}` }];
    const faqs = brandFaqs(name);
    const intro = info?.intro || `Shop original thrifted ${name} shoes in Pakistan. Every pair is checked for authenticity, deep-cleaned and honestly graded, with real photos of the exact pair you get.`;
    const body = `${crumbs(items)}
    <section class="seo-hero">
        <h1>${esc(name)} Shoes in Pakistan</h1>
        <p class="seo-sub">Original thrifted ${esc(name)} sneakers • Checked for authenticity • Cash on delivery</p>
        <p>${esc(intro)}</p>
        ${info?.points ? `<ul class="seo-points">${info.points.map(t => `<li><i class="fas fa-check"></i> ${esc(t)}</li>`).join('')}</ul>` : ''}
        ${list.length ? `<p class="seo-count"><strong>${list.length}</strong> ${list.length === 1 ? 'pair' : 'pairs'} in stock from <strong>${pkr(min)}</strong></p>` : ''}
        ${freshLine(updated)}
    </section>
    ${list.length ? grid(list) : `<div class="empty-state"><i class="fas fa-shoe-prints"></i><p>No ${esc(name)} pairs in stock right now — new pairs arrive often.<br>Message us on WhatsApp and we'll tell you when one comes in.</p><a href="/#shop" class="btn btn-primary" style="margin-top:18px">See all shoes</a></div>`}
    ${list.length > 0 ? `<p style="text-align:center;margin-top:26px"><a class="btn btn-outline" href="/?brand=${encodeURIComponent(name)}#shop"><i class="fas fa-sliders"></i> Filter ${esc(name)} by size &amp; price</a></p>` : ''}
    ${guideGrid(ownGuides ? `${name} guides` : 'Helpful guides', guides)}
    ${faqBlock(faqs)}
    ${otherBrands.length ? `<section class="seo-section"><h2>Other brands</h2>${brandChips(otherBrands)}</section>` : ''}
    <section class="seo-section"><h2>${esc(name)} delivery by city</h2>${cityChips()}</section>`;
    return send(res, 200, shell({
        origin, canonical: `${origin}/brand/${slug}`, noindex: !list.length,
        title: `${name} Shoes in Pakistan — Original Thrifted ${name} | ${SHOP}`,
        description: list.length
            ? `Shop original thrifted ${name} sneakers in Pakistan. ${list.length} ${list.length === 1 ? 'pair' : 'pairs'} in stock from ${pkr(min)}. Authenticity checked, real photos, cash on delivery.`
            : `Original thrifted ${name} sneakers in Pakistan — authenticity checked, cash on delivery.`,
        image: list[0]?.images?.[0], body,
        jsonLd: [crumbsLd(items, origin), pageLd(`${name} shoes in Pakistan`, `${origin}/brand/${slug}`, updated), list.length ? itemListLd(list, origin) : null, faqLd(faqs)]
    }));
}

async function cityPage(db, origin, res, slug) {
    slug = String(slug || '').toLowerCase();
    const city = CITY_INFO[slug];
    if (!city) return notFound(res, origin, 'page');
    const products = await activeProducts(db);
    let delivered = 0;
    try {
        const { data } = await db.from('orders').select('items').eq('status', 'Delivered').ilike('city', city.name).limit(5000);
        delivered = (data || []).reduce((s, o) => s + (o.items || []).length, 0);
    } catch { /* ignore */ }
    const brands = brandsFromProducts(products).slice(0, 10);
    const updated = newest(products, 'updated_at', 'created_at');
    const { data: postsData } = await db.from('posts').select(POST_FIELDS).eq('status', 'Published').order('published_at', { ascending: false }).limit(50);
    const guides = pickGuides(postsData || []);
    const items = [{ name: 'Home', href: '/' }, { name: 'Brands', href: '/brands' }, { name: city.name, href: `/city/${slug}` }];
    const faqs = [
        { q: `Do you deliver sneakers to ${city.name}?`, a: `Yes. We deliver to every area of ${city.name} by courier. ${city.note}.` },
        { q: `Can I pay cash on delivery in ${city.name}?`, a: 'Yes — you pay the rider in cash when your parcel arrives. No advance payment is needed.' },
        { q: 'Are the shoes original?', a: `Every pair is an authentic pre-owned shoe from brands like Nike, Jordan, Adidas and New Balance, checked before listing. ${SHOP} never sells copies.` },
        { q: 'How do I track my order?', a: 'Once your order ships you get the courier tracking number by email and on your My Orders page.' }
    ];
    const body = `${crumbs(items)}
    <section class="seo-hero">
        <h1>Thrifted Sneakers in ${esc(city.name)}</h1>
        <p class="seo-sub">Original Nike, Jordan, Adidas &amp; more • Delivered in ${esc(city.name)} • Cash on delivery</p>
        <p>Get authentic branded sneakers delivered to your door in ${esc(city.name)} — ${esc(city.note.charAt(0).toLowerCase() + city.note.slice(1))}. Every pair is checked, cleaned and photographed, and you only pay when the parcel arrives.</p>
        ${delivered >= 3 ? `<p class="seo-count"><strong>${delivered}</strong> pairs already delivered to ${esc(city.name)}</p>` : ''}
        ${freshLine(updated)}
    </section>
    ${products.length ? `<div class="section-row"><h2>Latest arrivals</h2><a href="/#shop">See all shoes <i class="fas fa-arrow-right"></i></a></div>${grid(products.slice(0, 12))}` : ''}
    ${brands.length ? `<section class="seo-section"><h2>Popular brands</h2>${brandChips(brands)}</section>` : ''}
    ${guideGrid('Before you buy', guides)}
    ${faqBlock(faqs)}
    <section class="seo-section"><h2>Other cities</h2>${cityChips(slug)}</section>`;
    return send(res, 200, shell({
        origin, canonical: `${origin}/city/${slug}`,
        title: `Thrifted Sneakers in ${city.name} — Original Nike, Jordan & Adidas | ${SHOP}`,
        description: `Original thrifted sneakers delivered in ${city.name}. Nike, Jordan, Adidas, New Balance and more — authenticity checked, cash on delivery.`,
        body, jsonLd: [crumbsLd(items, origin), pageLd(`Thrifted sneakers in ${city.name}`, `${origin}/city/${slug}`, updated), products.length ? itemListLd(products.slice(0, 12), origin) : null, faqLd(faqs)]
    }));
}

// ---------------------------------------------------------------------
// WhatsApp confirmation link: /c/<token>
// GET only shows the order (WhatsApp opens links to build previews);
// the customer must press a button (POST) to confirm.
// ---------------------------------------------------------------------
const CONFIRM_FIELDS = 'id, order_no, created_at, customer_name, phone, address, city, items, subtotal, discount, delivery_fee, total, status, customer_confirmed_at, confirm_token, location';

function parseForm(req) {
    const b = req.body;
    if (!b) return {};
    if (typeof b === 'string') {
        try { return JSON.parse(b); } catch { return Object.fromEntries(new URLSearchParams(b)); }
    }
    if (Buffer.isBuffer(b)) return Object.fromEntries(new URLSearchParams(b.toString('utf8')));
    return b;
}

function orderSummary(o) {
    return `<div class="cf-items">${(o.items || []).map(i => `<div class="cf-item">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}<div><strong>${esc(i.name)}</strong><span>${esc(i.brand || '')} • Size UK ${esc(i.size)}</span></div><b>${pkr(i.price)}</b></div>`).join('')}</div>
    <div class="cf-total"><span>Total — cash on delivery</span><strong>${pkr(o.total)}</strong></div>
    <div class="cf-addr"><i class="fas fa-location-dot"></i><div><strong>${esc(o.customer_name)}</strong> • ${esc(o.phone)}<br>${esc(o.address)}, ${esc(o.city)}</div></div>`;
}

async function confirmPage(req, db, origin, res, token) {
    token = String(token || '').toLowerCase();
    const page = (title, body, status = 200) => send(res, status, plainPage({ title, body, origin }), 'no-store');
    if (!/^[a-f0-9]{16,64}$/.test(token)) return page('Link not valid', `<div class="cf-card"><i class="fas fa-link-slash cf-icon bad"></i><h1>This link is not valid</h1><p>Please open the link exactly as we sent it on WhatsApp, or message us.</p></div>`, 404);
    const { data: order, error } = await db.from('orders').select(CONFIRM_FIELDS).eq('confirm_token', token).maybeSingle();
    if (error || !order) return page('Link not valid', `<div class="cf-card"><i class="fas fa-link-slash cf-icon bad"></i><h1>This link is not valid</h1><p>The order may have been removed. Please message us on WhatsApp.</p></div>`, 404);
    const no = 'JT-' + order.order_no;
    const ordersLink = `<a class="btn btn-outline" href="${esc(origin)}/orders.html"><i class="fas fa-box"></i> My orders</a>`;
    let notice = '';

    if (req.method === 'POST') {
        const form = parseForm(req);
        if (form.do === 'confirm' && !['Cancelled', 'Returned'].includes(order.status) && !order.customer_confirmed_at) {
            const at = new Date().toISOString();
            const { error: upError } = await db.from('orders').update({ customer_confirmed_at: at }).eq('id', order.id).is('customer_confirmed_at', null);
            if (!upError) {
                order.customer_confirmed_at = at;
                await notifyOwner({
                    telegram: `✅ <b>${no} confirmed by the customer</b>\n${esc(order.customer_name)} • ${esc(order.phone)} • ${pkr(order.total)}\nThey tapped the WhatsApp confirmation link.`,
                    subject: `✅ ${no} confirmed by the customer`, heading: `${no} confirmed by the customer`,
                    intro: `${esc(order.customer_name)} (${esc(order.phone)}) confirmed the order with the WhatsApp link.`,
                    site: origin, link: `${origin}/admin.html#orders`
                });
            }
        } else if (form.do === 'cancel' && order.status === 'Pending') {
            const { data, error: cErr } = await db.rpc('set_order_status', { p_order_id: order.id, p_status: 'Cancelled', p_by: 'customer (WhatsApp link)' });
            if (!cErr) {
                order.status = (Array.isArray(data) ? data[0] : data)?.status || 'Cancelled';
                await notifyOwner({
                    telegram: `❌ <b>${no} cancelled from the WhatsApp link</b>\n${esc(order.customer_name)} • ${esc(order.phone)} • ${pkr(order.total)}\nThe person with this number said: <i>I did not place this order / cancel it.</i> The pairs are back in stock.`,
                    subject: `❌ ${no} cancelled from the WhatsApp link`, heading: `${no} was cancelled from the WhatsApp link`,
                    intro: `The person on ${esc(order.phone)} said they did not place this order (or want to cancel it). The pairs are back in stock.`,
                    site: origin, link: `${origin}/admin.html#orders`
                });
                notice = 'cancelled';
            }
        }
    }

    if (order.status === 'Cancelled' || order.status === 'Returned') {
        return page(`${no} cancelled`, `<div class="cf-card"><i class="fas fa-circle-xmark cf-icon bad"></i><h1>Order ${no} is cancelled</h1>
            <p>${notice === 'cancelled' ? "Done — we've cancelled this order. Sorry for the trouble!" : 'This order was cancelled. If this is a mistake, please message us on WhatsApp.'}</p>
            <a class="btn btn-primary" href="${esc(origin)}/#shop">Browse shoes</a></div>`);
    }
    if (order.customer_confirmed_at) {
        return page(`${no} confirmed`, `<div class="cf-card"><i class="fas fa-circle-check cf-icon ok"></i><h1>Thank you — order ${no} is confirmed!</h1>
            <p>We'll pack it and send you the tracking number as soon as it ships. Please keep <strong>${pkr(order.total)}</strong> cash ready for the rider.</p>
            ${orderSummary(order)}
            <div class="cf-actions">${ordersLink}</div></div>`);
    }
    return page(`Confirm ${no}`, `<div class="cf-card"><i class="fas fa-clipboard-check cf-icon"></i><h1>Please confirm your order ${no}</h1>
        <p>Check the details below and tap <strong>Yes, confirm my order</strong>.</p>
        ${orderSummary(order)}
        <form method="post" class="cf-actions">
            <button class="btn btn-primary btn-lg" name="do" value="confirm" type="submit"><i class="fas fa-check"></i> Yes, confirm my order</button>
            ${order.status === 'Pending' ? `<button class="btn btn-danger" name="do" value="cancel" type="submit" onclick="return confirm('Cancel order ${no}? Choose this if you did not place this order.')"><i class="fas fa-xmark"></i> I didn't order this / cancel</button>` : ''}
        </form>
        <p class="cf-small">Something wrong with the address or size? Just reply to our WhatsApp message.</p></div>`);
}

// ---------------------------------------------------------------------
// Authenticity card check: /verify/JT1234-ABC123
// ---------------------------------------------------------------------
async function verifyPage(db, origin, res, code) {
    const page = (title, body, status = 200) => send(res, status, plainPage({ title, body, origin }), 'no-store');
    const m = String(code || '').toUpperCase().replace(/\s+/g, '').match(/^JT-?(\d{3,9})-([A-F0-9]{6})$/);
    const bad = () => page('Certificate not found', `<div class="cf-card"><i class="fas fa-circle-question cf-icon bad"></i><h1>Certificate not found</h1><p>We couldn't find an authenticity card with the code <strong>${esc(code)}</strong>. Check the code on the card, or message us on WhatsApp.</p><a class="btn btn-primary" href="${esc(origin)}/">Visit ${SHOP}</a></div>`, 404);
    if (!m) return bad();
    const { data: o } = await db.from('orders').select('order_no, created_at, items, status, confirm_token').eq('order_no', parseInt(m[1], 10)).maybeSingle();
    if (!o || !o.confirm_token || !o.confirm_token.toUpperCase().endsWith(m[2])) return bad();
    const valid = !['Cancelled', 'Returned'].includes(o.status);
    return page('Authenticity verified', `<div class="cf-card cert-check">
        <i class="fas ${valid ? 'fa-shield-halved cf-icon ok' : 'fa-triangle-exclamation cf-icon bad'}"></i>
        <h1>${valid ? 'Genuine JENZY authenticity card' : 'This card is no longer valid'}</h1>
        <p>${valid ? `Card <strong>${esc(m[0])}</strong> was issued by ${SHOP} for order JT-${o.order_no} on ${fmtDay(o.created_at)}. These items were inspected and verified authentic:` : `This card belonged to order JT-${o.order_no}, which was ${o.status === 'Returned' ? 'returned' : 'cancelled'}.`}</p>
        ${valid ? `<div class="cf-items">${(o.items || []).map(i => `<div class="cf-item">${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}<div><strong>${esc(i.brand ? i.brand + ' ' : '')}${esc(i.name)}</strong><span>Size UK ${esc(i.size)}</span></div></div>`).join('')}</div>` : ''}
        <a class="btn btn-primary" href="${esc(origin)}/#shop">Shop authentic sneakers</a></div>`);
}

// Small JSON list for the home page "Explore" box: brands in stock, latest
// guides and when the stock last changed. GET /api/pages?type=nav
async function navJson(db, res) {
    await ensureStarterPosts(db).catch(() => false);
    const [products, posts] = await Promise.all([activeProducts(db).catch(() => []), publishedPosts(db, { limit: 6, fields: 'slug, title, published_at, updated_at' })]);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
    res.end(JSON.stringify({
        brands: brandsFromProducts(products).slice(0, 16),
        posts: posts.map(p => ({ slug: p.slug, title: p.title, published_at: p.published_at, updated_at: p.updated_at })),
        stockUpdated: newest(products, 'updated_at', 'created_at')
    }));
}

export default async function handler(req, res) {
    const origin = siteUrl(req);
    const q = req.query || Object.fromEntries(new URL(req.url, origin).searchParams);
    const db = getDb();
    try {
        switch (q.type) {
            case 'blog': return await blogList(db, origin, res);
            case 'post': return await blogPost(db, origin, res, q.slug);
            case 'brands': return await brandsIndex(db, origin, res);
            case 'brand': return await brandPage(db, origin, res, q.slug);
            case 'city': return await cityPage(db, origin, res, q.slug);
            case 'confirm': return await confirmPage(req, db, origin, res, q.t);
            case 'verify': return await verifyPage(db, origin, res, q.code);
            case 'nav': return await navJson(db, res);
            default: return notFound(res, origin);
        }
    } catch (e) {
        console.error('[pages]', q.type, e);
        return send(res, 500, plainPage({ origin, title: 'Error', body: `<div class="cf-card"><i class="fas fa-plug-circle-exclamation cf-icon bad"></i><h1>Something went wrong</h1><p>Please try again in a minute.</p><a class="btn btn-primary" href="${esc(origin)}/">Go to the shop</a></div>` }), 'no-store');
    }
}
