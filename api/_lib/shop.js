// Shop rules: delivery fee, coupons, validation.
// You can change these with Vercel environment variables (no code edit needed):
//   DELIVERY_FEE=250          delivery charge in PKR
//   FREE_DELIVERY_MIN=5000    free delivery when order total (after discount) is at least this
// Coupon codes, the "buy 2+" deal and invite-friends offer are set in the
// admin panel (Promotions) and stored in Supabase.
import { HttpError } from './http.js';

function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function shopConfig() {
    return {
        currency: 'PKR',
        deliveryFee: intEnv('DELIVERY_FEE', 250),
        freeDeliveryMin: intEnv('FREE_DELIVERY_MIN', 5000),
        paymentMethods: ['COD'],
        maxPendingOrdersPerUser: intEnv('MAX_PENDING_ORDERS', 5)
    };
}

// Same formula as the place_order() function in supabase-setup.sql
export function computeTotals(subtotal, discount, cfg = shopConfig()) {
    discount = Math.max(0, Math.min(Math.floor(discount || 0), subtotal));
    const after = subtotal - discount;
    const deliveryFee = subtotal === 0 ? 0 : (after >= cfg.freeDeliveryMin ? 0 : cfg.deliveryFee);
    return { subtotal, discount, deliveryFee, total: after + deliveryFee };
}

export const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;
export const REFERRAL_RE = /^[A-Z0-9]{4,20}$/;

const clampPct = (n, dflt) => {
    const v = parseInt(n, 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(v, 50)) : dflt;
};

// "Buy 2+ get 10% off" and "Invite friends" settings (Admin → Promotions).
// Same defaults as supabase-setup.sql / place_order().
export function normalizeOffers(bundle, referral) {
    const b = bundle || {};
    const r = referral || {};
    return {
        bundle: {
            active: b.active !== false,
            min: Math.max(2, Math.min(parseInt(b.min, 10) || 2, 10)),
            percent: clampPct(b.percent, 10)
        },
        referral: {
            active: r.active !== false,
            percent: clampPct(r.percent, 10),
            reward: Math.max(1, Math.min(parseInt(r.reward, 10) || 300, 100000))
        }
    };
}

export async function readOffers(db) {
    const { data, error } = await db.from('shop_settings').select('key, value').in('key', ['bundle', 'referral']);
    if (error) return normalizeOffers(null, null);
    const map = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    return normalizeOffers(map.bundle, map.referral);
}

// Looks the code up: first in the coupons table, then the customers' invite
// codes. Same rules as place_order() in supabase-setup.sql (which re-checks
// everything when the order is saved).
//   subtotal = null skips the minimum-order check
//   user = { uid } (optional) lets us check "own code" / "first order only"
export async function findCoupon(db, code, subtotal = null, { user = null, offers = null } = {}) {
    const clean = String(code ?? '').trim().toUpperCase();
    if (!clean) return { code: null, percent: 0, kind: null };
    const invalid = new HttpError(400, `Coupon "${clean.slice(0, 20)}" is not valid.`);
    if (!COUPON_RE.test(clean)) throw invalid;
    const { data, error } = await db.from('coupons')
        .select('code, percent, active, min_order, max_uses, used_count, expires_at')
        .eq('code', clean).maybeSingle();
    if (error && !/coupons/.test(error.message || '')) throw error;
    if (data) {
        if (!data.active) throw invalid;
        if (data.expires_at && new Date(data.expires_at) <= new Date()) throw new HttpError(400, `Coupon "${clean}" has expired.`);
        if (data.max_uses && data.used_count >= data.max_uses) throw new HttpError(400, `Coupon "${clean}" has been fully used.`);
        if (subtotal !== null && data.min_order && subtotal < data.min_order) {
            throw new HttpError(400, `Coupon "${clean}" needs an order of at least PKR ${Number(data.min_order).toLocaleString('en-US')}.`);
        }
        return { code: clean, percent: data.percent, kind: 'coupon' };
    }

    // A friend's invite code?
    if (!REFERRAL_RE.test(clean)) throw invalid;
    const { data: ref, error: refError } = await db.from('referral_codes').select('code, user_uid').eq('code', clean).maybeSingle();
    if (refError && !/referral_codes/.test(refError.message || '')) throw refError;
    const cfg = (offers || await readOffers(db)).referral;
    if (!ref || !cfg.active) throw invalid;
    if (user) {
        if (ref.user_uid === user.uid) {
            throw new HttpError(400, 'This is your own invite code. Share it with friends: they get the discount and you get credit.');
        }
        const { count, error: cErr } = await db.from('orders').select('id', { count: 'exact', head: true })
            .eq('user_uid', user.uid).neq('status', 'Cancelled');
        if (cErr) throw cErr;
        if ((count || 0) > 0) throw new HttpError(400, 'Invite codes only work on your first order.');
    }
    return { code: clean, percent: cfg.percent, kind: 'referral', referrerUid: ref.user_uid };
}

// The customer's oldest unused invite credit (PKR), or null
export async function findCredit(db, uid) {
    if (!uid) return null;
    const { data, error } = await db.from('credits').select('id, amount, created_at')
        .eq('user_uid', uid).is('used_order_id', null).order('created_at', { ascending: true }).limit(1);
    if (error) return null;   // table not created yet
    return data && data[0] ? data[0] : null;
}

// ONLY THE BIGGEST discount applies. Same order of preference as place_order():
// buy-2 deal, then coupon, then invite code, then credit.
export function computeDiscount({ subtotal, count, code = null, offers, credit = null }) {
    const pct = (p) => Math.floor((subtotal * p) / 100);
    const b = offers.bundle;
    const cand = {
        bundle: b.active && count >= b.min ? pct(b.percent) : 0,
        coupon: code && code.kind === 'coupon' ? pct(Math.max(0, Math.min(code.percent, 100))) : 0,
        referral: code && code.kind === 'referral' ? pct(code.percent) : 0,
        credit: credit ? Math.min(credit.amount, subtotal) : 0
    };
    let type = null;
    if (cand.bundle > 0 && cand.bundle >= Math.max(cand.coupon, cand.referral, cand.credit)) type = 'bundle';
    else if (cand.coupon > 0 && cand.coupon >= Math.max(cand.referral, cand.credit)) type = 'coupon';
    else if (cand.referral > 0 && cand.referral >= cand.credit) type = 'referral';
    else if (cand.credit > 0) type = 'credit';
    return { type, discount: type ? cand[type] : 0, candidates: cand };
}

export function discountLabel(type, { code = null, offers = null } = {}) {
    if (type === 'bundle') return `Buy ${offers?.bundle.min || 2}+ deal (${offers?.bundle.percent || 10}% off)`;
    if (type === 'coupon') return `Coupon ${code?.code || ''} (${code?.percent || 0}% off)`.replace('  ', ' ');
    if (type === 'referral') return `Friend's invite code (${code?.percent || 10}% off)`;
    if (type === 'credit') return 'Invite credit';
    return '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateItems(items) {
    if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your cart is empty.');
    if (items.length > 20) throw new HttpError(400, 'Too many items in one order (max 20).');
    const seen = new Set();
    return items.map(it => {
        const product_id = String(it?.product_id || it?.id || '');
        const size = String(it?.size ?? '').trim();
        if (!UUID_RE.test(product_id)) throw new HttpError(400, 'Invalid product in cart.');
        if (!size || size.length > 10) throw new HttpError(400, 'Please choose a size for every item.');
        const key = product_id + '|' + size;
        if (seen.has(key)) throw new HttpError(400, 'The same pair is in your cart twice.');
        seen.add(key);
        return { product_id, size };
    });
}

function cleanText(v, max) {
    return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function validateCustomer(c = {}) {
    const name = cleanText(c.name, 80);
    const phone = String(c.phone ?? '').replace(/[^\d+]/g, '');
    const city = cleanText(c.city, 60);
    const address = cleanText(c.address, 300);
    const notes = cleanText(c.notes, 300);
    const digits = phone.replace(/\D/g, '');
    if (name.length < 2) throw new HttpError(400, 'Please enter your full name.');
    if (digits.length < 10 || digits.length > 15) throw new HttpError(400, 'Please enter a valid phone number, e.g. 03001234567.');
    if (city.length < 2) throw new HttpError(400, 'Please enter your city.');
    if (address.length < 10) throw new HttpError(400, 'Please enter your full delivery address (house, street, area).');
    return { name, phone, city, address, notes };
}

export function isUuid(v) {
    return UUID_RE.test(String(v || ''));
}

// Turns database errors from place_order() into friendly messages
export function orderErrorMessage(err) {
    const msg = err?.message || '';
    if (msg.startsWith('UNAVAILABLE:')) return `Sorry, "${msg.slice(12)}" was just sold or is no longer available. Please remove it from your cart.`;
    if (msg.startsWith('SIZE_UNAVAILABLE:')) return `Sorry, ${msg.slice(17)} is no longer available. Please choose another size.`;
    if (msg.startsWith('EMPTY_CART')) return 'Your cart is empty.';
    if (msg.startsWith('COUPON:')) return msg.slice(7);
    return null;
}
