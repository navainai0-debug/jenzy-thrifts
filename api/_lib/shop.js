// Shop rules: delivery fee, coupons, validation.
// You can change these with Vercel environment variables (no code edit needed):
//   DELIVERY_FEE=250          delivery charge in PKR
//   FREE_DELIVERY_MIN=5000    free delivery when order total (after discount) is at least this
//   COUPONS=JENZY20:20        comma separated CODE:PERCENT list, e.g. "JENZY20:20,EID10:10"
import { HttpError } from './http.js';

function intEnv(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function shopConfig() {
    const coupons = {};
    (process.env.COUPONS ?? 'JENZY20:20').split(',').forEach(pair => {
        const [code, pct] = pair.split(':').map(s => (s || '').trim());
        const n = parseInt(pct, 10);
        if (code && n > 0 && n <= 90) coupons[code.toUpperCase()] = n;
    });
    return {
        currency: 'PKR',
        deliveryFee: intEnv('DELIVERY_FEE', 250),
        freeDeliveryMin: intEnv('FREE_DELIVERY_MIN', 5000),
        coupons,
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

export function couponPercent(code, cfg = shopConfig()) {
    if (!code) return { code: null, percent: 0 };
    const clean = String(code).trim().toUpperCase();
    if (!clean) return { code: null, percent: 0 };
    const percent = cfg.coupons[clean];
    if (!percent) throw new HttpError(400, `Coupon "${clean}" is not valid.`);
    return { code: clean, percent };
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
    return null;
}
