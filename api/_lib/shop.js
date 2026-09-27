// Shop rules: delivery fee, coupons, validation.
// You can change these with Vercel environment variables (no code edit needed):
//   DELIVERY_FEE=250          delivery charge in PKR
//   FREE_DELIVERY_MIN=5000    free delivery when order total (after discount) is at least this
// Coupon codes are created in the admin panel (Promotions) and stored in the
// "coupons" table in Supabase.
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
export function computeTotals(subtotal, discountPercent, cfg = shopConfig()) {
    const discount = Math.floor((subtotal * discountPercent) / 100);
    const after = subtotal - discount;
    const deliveryFee = subtotal === 0 ? 0 : (after >= cfg.freeDeliveryMin ? 0 : cfg.deliveryFee);
    return { subtotal, discount, deliveryFee, total: after + deliveryFee };
}

export const COUPON_RE = /^[A-Z0-9_-]{3,20}$/;

// Looks the code up in the coupons table. Same rules as place_order() in
// supabase-setup.sql (which re-checks them when the order is saved).
// Pass subtotal = null to skip the minimum-order check.
export async function findCoupon(db, code, subtotal = null) {
    const clean = String(code ?? '').trim().toUpperCase();
    if (!clean) return { code: null, percent: 0 };
    const invalid = new HttpError(400, `Coupon "${clean.slice(0, 20)}" is not valid.`);
    if (!COUPON_RE.test(clean)) throw invalid;
    const { data, error } = await db.from('coupons')
        .select('code, percent, active, min_order, max_uses, used_count, expires_at')
        .eq('code', clean).maybeSingle();
    if (error) {
        if (/coupons/.test(error.message || '')) throw invalid; // table not created yet
        throw error;
    }
    if (!data || !data.active) throw invalid;
    if (data.expires_at && new Date(data.expires_at) <= new Date()) throw new HttpError(400, `Coupon "${clean}" has expired.`);
    if (data.max_uses && data.used_count >= data.max_uses) throw new HttpError(400, `Coupon "${clean}" has been fully used.`);
    if (subtotal !== null && data.min_order && subtotal < data.min_order) {
        throw new HttpError(400, `Coupon "${clean}" needs an order of at least PKR ${Number(data.min_order).toLocaleString('en-US')}.`);
    }
    return { code: clean, percent: data.percent };
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
