// Shoe sizes are UK. Shoes listed before the switch were typed in US sizes:
// the owner converts them once (Admin → Products → "Convert sizes to UK").
import { HttpError } from './http.js';
import { brandSlug } from './content.js';
import { readSetting, writeSetting } from './notify.js';

export const SIZE_UNIT = 'UK';

const fmt = (n) => String(Math.round(n * 2) / 2).replace(/\.0$/, '');

// How far the UK number is below the US number (brand charts differ a little)
export function usToUkStep({ brand, gender } = {}) {
    const b = brandSlug(brand);
    if (gender === 'Kids') return 0.5;
    if (gender === 'Women') {
        if (b === 'nike' || b === 'jordan') return 2.5;          // Nike W US 8 = UK 5.5
        if (b === 'adidas' || b === 'yeezy') return 1.5;         // Adidas W US 8 = UK 6.5
        return 2;                                                // most brands
    }
    if (b === 'converse') return 0;                              // Chuck Taylor: US = UK
    if (b === 'adidas' || b === 'yeezy' || b === 'new-balance') return 0.5;   // US 9 = UK 8.5
    return 1;                                                    // Nike, Jordan, Puma, Vans, Asics… US 9 = UK 8
}

export function usToUk(size, product = {}) {
    const s = String(size ?? '').trim();
    if (!/^\d{1,2}(\.5)?$/.test(s)) return s;                    // not a plain number → leave it
    const uk = parseFloat(s) - usToUkStep(product);
    return uk >= 1 ? fmt(uk) : s;
}

const cleanSize = (s) => {
    const v = String(s ?? '').trim().replace(/^uk\s*/i, '');
    return /^\d{1,2}(\.5)?$/.test(v) && parseFloat(v) >= 1 && parseFloat(v) <= 18 ? fmt(parseFloat(v)) : null;
};
const sortNum = (a) => [...new Set(a)].sort((x, y) => parseFloat(x) - parseFloat(y));

export async function sizeStatus() {
    return (await readSetting('size_system')) || null;
}

// Preview: every shoe with its US sizes and the suggested UK sizes
export async function sizePreview(db) {
    const status = await sizeStatus();
    const { data, error } = await db.from('products').select('id, name, brand, gender, status, sizes, images, thumbs').order('created_at', { ascending: false }).limit(2000);
    if (error) throw error;
    const products = (data || []).map(p => ({
        id: p.id, name: p.name, brand: p.brand, gender: p.gender, status: p.status,
        image: (p.thumbs || [])[0] || (p.images || [])[0] || '',
        sizes: p.sizes || [],
        suggested: (p.sizes || []).map(s => usToUk(s, p))
    }));
    return { status, products };
}

// One-time switch. body.map = { productId: ['8', '8.5'] } (UK sizes, same order as the US list)
export async function convertSizes(db, member, body = {}) {
    if (await sizeStatus()) throw new HttpError(409, 'Sizes were already switched to UK.');
    const now = new Date().toISOString();
    if (body.skip) {
        await writeSetting('size_system', { unit: SIZE_UNIT, converted: false, at: now, by: member.email });
        await patchGuides(db, now);
        return { converted: 0, skipped: true };
    }
    const map = body.map && typeof body.map === 'object' ? body.map : {};
    const { data: products, error } = await db.from('products').select('id, name, brand, gender, sizes').limit(5000);
    if (error) throw error;

    // US → UK per product (owner's numbers, or the suggestion)
    const lookup = new Map();
    const updates = [];
    for (const p of products || []) {
        const old = p.sizes || [];
        let next = old.map(s => usToUk(s, p));
        if (Array.isArray(map[p.id])) {
            const typed = map[p.id].map(cleanSize);
            if (typed.some(v => !v)) throw new HttpError(400, `Check the UK sizes for "${p.name}" — use numbers like 7 or 8.5.`);
            if (typed.length !== old.length) throw new HttpError(400, `"${p.name}" has ${old.length} size${old.length === 1 ? '' : 's'} — enter the same number of UK sizes.`);
            next = typed;
        }
        const pairs = new Map(old.map((s, i) => [String(s), next[i]]));
        lookup.set(p.id, { p, pairs });
        if (old.length) updates.push({ id: p.id, sizes: sortNum(next) });
    }
    const convert = (productId, size, fallback = {}) => {
        const hit = lookup.get(productId);
        if (hit && hit.pairs.has(String(size))) return hit.pairs.get(String(size));
        return usToUk(size, hit ? hit.p : fallback);
    };

    // Save the setting first, so a second tap can never convert twice
    await writeSetting('size_system', { unit: SIZE_UNIT, converted: true, at: now, by: member.email, products: updates.length });
    for (const u of updates) {
        const { error: e } = await db.from('products').update({ sizes: u.sizes }).eq('id', u.id);
        if (e) throw e;
    }

    // Past orders, waiting list, saved carts and sell requests say the same size in UK
    const counts = { products: updates.length, orders: 0, waitlist: 0, carts: 0, sell: 0 };
    const { data: orders } = await db.from('orders').select('id, items').limit(20000);
    for (const o of orders || []) {
        const items = (o.items || []).map(i => i && i.size != null ? { ...i, size: convert(i.product_id, i.size, i) } : i);
        if (JSON.stringify(items) !== JSON.stringify(o.items)) { await db.from('orders').update({ items }).eq('id', o.id); counts.orders++; }
    }
    const { data: waits } = await db.from('restock_requests').select('id, product_id, brand, size').limit(20000);
    for (const w of waits || []) {
        const size = convert(w.product_id, w.size, w);
        if (size !== w.size) { await db.from('restock_requests').update({ size }).eq('id', w.id); counts.waitlist++; }
    }
    const { data: carts } = await db.from('carts').select('user_uid, items').limit(20000);
    for (const c of carts || []) {
        const items = (c.items || []).map(i => i && i.size != null ? { ...i, size: convert(i.product_id, i.size) } : i);
        if (JSON.stringify(items) !== JSON.stringify(c.items)) { await db.from('carts').update({ items }).eq('user_uid', c.user_uid); counts.carts++; }
    }
    const { data: sells } = await db.from('sell_requests').select('id, brand, size').limit(20000);
    for (const s of sells || []) {
        const size = usToUk(s.size, { brand: s.brand });
        if (size !== s.size) { await db.from('sell_requests').update({ size }).eq('id', s.id); counts.sell++; }
    }

    await patchGuides(db, now);
    await writeSetting('size_system', { unit: SIZE_UNIT, converted: true, at: now, by: member.email, ...counts });
    return { converted: updates.length, counts };
}

// The size guide said "Every shoe on our site shows US sizes"
async function patchGuides(db, now) {
    try {
        const { data: posts } = await db.from('posts').select('id, body').in('slug', ['sneaker-size-guide-nike-adidas-jordan-new-balance', 'nike-vs-adidas-which-sneakers-to-buy']);
        for (const p of posts || []) {
            const body2 = String(p.body)
                .replace('Every shoe on our site shows **US sizes**', 'Every shoe on our site shows **UK sizes**')
                .replace('Compare in **US sizes or cm**', 'Compare in **cm** (or the US size printed on the tag)');
            if (body2 !== p.body) await db.from('posts').update({ body: body2, updated_at: now }).eq('id', p.id);
        }
    } catch { /* blog table missing — fine */ }
}
