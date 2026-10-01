// Customer safety: Pakistani phone checks, blocked customers, fake-order
// risk flags and the customer list. Used by /api/orders and /api/admin.
import { HttpError } from './http.js';

// ---------------------------------------------------------------------
// Phones & cities
// ---------------------------------------------------------------------
// Any Pakistani mobile -> "03001234567". Returns null if it isn't one.
export function normPhone(v) {
    let d = String(v ?? '').replace(/\D/g, '');
    if (d.startsWith('0092')) d = d.slice(4);
    else if (d.startsWith('92') && d.length === 12) d = d.slice(2);
    if (d.length === 10 && d.startsWith('3')) d = '0' + d;
    return /^03\d{9}$/.test(d) ? d : null;
}
// Loose key for matching old orders typed in any format
export const phoneKey = (v) => normPhone(v) || String(v ?? '').replace(/\D/g, '').slice(-10) || null;

// wa.me needs 92XXXXXXXXXX
export function waNumber(v) {
    const p = normPhone(v);
    if (p) return '92' + p.slice(1);
    const d = String(v ?? '').replace(/\D/g, '');
    return d.startsWith('0') ? '92' + d.slice(1) : d;
}

export const PK_CITIES = [
    'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Gujranwala', 'Sialkot',
    'Hyderabad', 'Bahawalpur', 'Sargodha', 'Sukkur', 'Larkana', 'Sheikhupura', 'Rahim Yar Khan', 'Jhang', 'Dera Ghazi Khan', 'Gujrat',
    'Sahiwal', 'Wah Cantt', 'Mardan', 'Kasur', 'Okara', 'Mingora', 'Nawabshah', 'Chiniot', 'Kotri', 'Kamoke',
    'Hafizabad', 'Sadiqabad', 'Mirpur Khas', 'Burewala', 'Kohat', 'Khanewal', 'Dera Ismail Khan', 'Turbat', 'Muzaffargarh', 'Abbottabad',
    'Mandi Bahauddin', 'Shikarpur', 'Jacobabad', 'Jhelum', 'Khanpur', 'Khairpur', 'Khuzdar', 'Pakpattan', 'Hub', 'Daska',
    'Gojra', 'Muridke', 'Bahawalnagar', 'Samundri', 'Jaranwala', 'Chishtian', 'Attock', 'Vehari', 'Kot Abdul Malik', 'Ferozwala',
    'Chakwal', 'Gujar Khan', 'Kamalia', 'Ahmedpur East', 'Kot Addu', 'Wazirabad', 'Mansehra', 'Layyah', 'Mirpur', 'Swabi',
    'Chaman', 'Taxila', 'Nowshera', 'Khushab', 'Shahdadkot', 'Mianwali', 'Jauharabad', 'Badin', 'Lodhran', 'Tando Allahyar',
    'Charsadda', 'Bhakkar', 'Haripur', 'Narowal', 'Toba Tek Singh', 'Muzaffarabad', 'Gwadar', 'Dadu', 'Thatta', 'Murree',
    'Bannu', 'Hasilpur', 'Arifwala', 'Pattoki', 'Rajanpur', 'Shakargarh', 'Pasrur', 'Talagang', 'Kharian', 'Lalamusa',
    'Gilgit', 'Skardu', 'Chitral', 'Batkhela', 'Timergara', 'Sibi', 'Zhob', 'Loralai', 'Umerkot', 'Ghotki',
    'Tando Adam', 'Mian Channu', 'Fort Abbas', 'Dina', 'Fateh Jang', 'Pindi Bhattian', 'Phalia', 'Nankana Sahib', 'Renala Khurd', 'Depalpur',
    'Chichawatni', 'Kabirwala', 'Jampur', 'Taunsa', 'Liaquatpur', 'Yazman', 'Hangu', 'Karak', 'Lakki Marwat', 'Tank'
];
const CITY_SET = new Set(PK_CITIES.map(c => c.toLowerCase()));
export const knownCity = (c) => CITY_SET.has(String(c || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/ city$/, ''));

// Pakistan's rough bounding box (for the "Pin my location" check)
export const inPakistan = (loc) => !!loc && loc.lat >= 23.5 && loc.lat <= 37.2 && loc.lng >= 60.8 && loc.lng <= 77.9;

export function cleanLocation(v) {
    if (!v || typeof v !== 'object') return null;
    const lat = Number(v.lat), lng = Number(v.lng), acc = Number(v.acc);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (lat === 0 && lng === 0) return null;
    return {
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        acc: Number.isFinite(acc) && acc >= 0 ? Math.min(Math.round(acc), 100000) : null
    };
}
export const mapsLink = (loc) => loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;

// ---------------------------------------------------------------------
// Settings (Admin → WhatsApp & safety)
// ---------------------------------------------------------------------
export const DEFAULT_SAFETY = { highTotal: 15000, autoBlockRefusals: 0 };
export function cleanSafety(v = {}) {
    const ht = parseInt(v.highTotal, 10), ab = parseInt(v.autoBlockRefusals, 10);
    return {
        highTotal: ht >= 1000 && ht <= 10000000 ? ht : DEFAULT_SAFETY.highTotal,
        autoBlockRefusals: ab >= 1 && ab <= 10 ? ab : 0
    };
}

export const DEFAULT_WA_TEMPLATES = [
    { label: 'Ask to confirm (link)', text: 'Assalam o Alaikum {name}! 👋\nThank you for ordering from {shop}.\n\nOrder {order}: {items}\nTotal (cash on delivery): {total}\nDeliver to: {address}, {city}\n\nPlease tap this link to confirm your order ✅\n{confirm_link}\n\nIf anything is wrong, just reply here.' },
    { label: 'Order confirmed', text: 'Hi {name}, your order {order} is confirmed ✅ We are packing it now and will send you the tracking number as soon as it ships.' },
    { label: 'Shipped + tracking', text: 'Hi {name}, your order {order} has been shipped 🚚\nCourier: {courier}\nTracking no: {tracking}\n{tracking_link}\n\nPlease keep {total} cash ready for the rider.' },
    { label: 'Rider will call today', text: 'Hi {name}, your order {order} will be delivered today 🛵 The rider will call you on this number — please keep {total} cash ready. Thank you!' },
    { label: "Couldn't reach you", text: "Hi {name}, we tried calling you about your order {order} but couldn't reach you. Please reply here or call us back so we can confirm it. Thank you!" },
    { label: 'Size / stock issue', text: 'Hi {name}, sorry — there is an issue with one of the items in your order {order}. Can we suggest another size or a similar pair? Reply here and we will sort it out.' },
    { label: 'Delivered — thank you', text: 'Hi {name}, thank you for shopping with {shop}! 🙏 We hope you love your new pair. You can leave a review from your orders page: {review_link}' }
];
export function cleanTemplates(list) {
    if (!Array.isArray(list)) throw new HttpError(400, 'Invalid templates.');
    const out = list.slice(0, 20).map(t => ({
        label: String(t?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        text: String(t?.text ?? '').replace(/\r/g, '').trim().slice(0, 1200)
    })).filter(t => t.label && t.text);
    if (!out.length) throw new HttpError(400, 'Add at least one message.');
    return out;
}

// ---------------------------------------------------------------------
// Blocked customers
// ---------------------------------------------------------------------
export async function loadBlocked(db) {
    const { data, error } = await db.from('blocked_customers').select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) return { list: [], missing: true };
    return { list: data || [], missing: false };
}
export function blockedMatcher(list) {
    const phones = new Set(), uids = new Set(), emails = new Set();
    for (const b of list) {
        if (b.phone) phones.add(phoneKey(b.phone));
        if (b.user_uid) uids.add(b.user_uid);
        if (b.email) emails.add(String(b.email).toLowerCase());
    }
    return ({ uid, email, phone }) => (uid && uids.has(uid)) || (email && emails.has(String(email).toLowerCase())) || (phone && phones.has(phoneKey(phone)));
}

// Refuses an order from a blocked customer (or one with too many refused parcels)
export async function checkCanOrder(db, { uid, email, phone }, safety = DEFAULT_SAFETY) {
    const { list } = await loadBlocked(db);
    const NO = "Sorry, we can't accept online orders from this account right now. Please contact us on WhatsApp.";
    if (list.length && blockedMatcher(list)({ uid, email, phone })) throw new HttpError(403, NO);
    if (safety.autoBlockRefusals > 0) {
        const p = phoneKey(phone);
        const { data } = await db.from('orders').select('id, user_uid, phone').eq('status', 'Returned').limit(5000);
        const refused = (data || []).filter(o => o.user_uid === uid || (p && phoneKey(o.phone) === p)).length;
        if (refused >= safety.autoBlockRefusals) throw new HttpError(403, NO);
    }
}

// ---------------------------------------------------------------------
// Fake-order risk
// ---------------------------------------------------------------------
const HISTORY_FIELDS = 'id, order_no, created_at, user_uid, user_email, phone, status, total, customer_confirmed_at';

export async function loadHistory(db) {
    let r = await db.from('orders').select(HISTORY_FIELDS).order('created_at', { ascending: false }).limit(5000);
    if (r.error && /customer_confirmed_at/.test(r.error.message || '')) {
        r = await db.from('orders').select('id, order_no, created_at, user_uid, user_email, phone, status, total').order('created_at', { ascending: false }).limit(5000);
    }
    if (r.error) throw r.error;
    return r.data || [];
}

export function riskContext(history, blockedList, safety = DEFAULT_SAFETY) {
    const byUid = new Map(), byPhone = new Map();
    for (const o of history) {
        if (!byUid.has(o.user_uid)) byUid.set(o.user_uid, []);
        byUid.get(o.user_uid).push(o);
        const k = phoneKey(o.phone);
        if (k) {
            if (!byPhone.has(k)) byPhone.set(k, []);
            byPhone.get(k).push(o);
        }
    }
    return { byUid, byPhone, isBlocked: blockedMatcher(blockedList || []), safety };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// -> { level: 'low'|'medium'|'high', score, flags: [{ text, tone: 'bad'|'warn'|'good'|'info' }], stats }
export function computeRisk(order, ctx) {
    const flags = [];
    let score = 0;
    const add = (pts, tone, text) => { score += pts; flags.push({ tone, text }); };
    const k = phoneKey(order.phone);
    const seen = new Map();
    for (const o of [...(ctx.byUid.get(order.user_uid) || []), ...(k ? ctx.byPhone.get(k) || [] : [])]) seen.set(o.id, o);
    seen.delete(order.id);
    const others = [...seen.values()];
    const before = others.filter(o => new Date(o.created_at) < new Date(order.created_at));
    const delivered = before.filter(o => o.status === 'Delivered').length;
    const refused = others.filter(o => o.status === 'Returned').length;
    const cancelled = before.filter(o => o.status === 'Cancelled').length;

    if (ctx.isBlocked({ uid: order.user_uid, email: order.user_email, phone: order.phone })) add(100, 'bad', 'Blocked customer');
    if (refused) add(Math.min(refused, 2) * 40, 'bad', `Refused / returned ${plural(refused, 'parcel')} before`);
    if (delivered) add(-15, 'good', `Returning customer — ${delivered} delivered before`);
    else add(10, 'info', 'New customer — no delivered orders yet');
    if (cancelled >= 2) add(10, 'warn', `${cancelled} cancelled orders before`);

    if (!normPhone(order.phone)) add(25, 'warn', 'Phone is not a Pakistani mobile number');
    if (k) {
        const accounts = new Set((ctx.byPhone.get(k) || []).map(o => o.user_uid));
        accounts.delete(order.user_uid);
        if (accounts.size) add(15, 'warn', `Same phone used by ${plural(accounts.size, 'other account')}`);
        const confirmedBefore = (ctx.byPhone.get(k) || []).some(o => o.id !== order.id && o.customer_confirmed_at);
        if (confirmedBefore && !order.customer_confirmed_at) add(-10, 'good', 'Phone confirmed on an earlier order');
    }
    const day = new Date(order.created_at).getTime();
    const burst = others.filter(o => Math.abs(new Date(o.created_at).getTime() - day) < 86400000 && o.status !== 'Cancelled').length;
    if (burst >= 2) add(15, 'warn', `${burst + 1} orders within 24 hours`);

    if (order.total >= ctx.safety.highTotal) add(15, 'warn', `High order value (PKR ${ctx.safety.highTotal.toLocaleString('en-US')}+)`);
    if (!/\d/.test(order.address || '')) add(10, 'warn', 'No house / street number in the address');
    if (!knownCity(order.city)) add(5, 'info', 'City not in our Pakistan city list — check spelling');
    if (order.location) {
        if (!inPakistan(order.location)) add(20, 'warn', 'Location pin is outside Pakistan');
        else flags.push({ tone: 'good', text: 'Location pinned on the map' });
    } else add(5, 'info', 'No location pin');

    if (order.customer_confirmed_at) add(-25, 'good', 'Customer confirmed on WhatsApp');
    else if (['Pending', 'Confirmed'].includes(order.status)) add(order.confirm_sent_at ? 10 : 5, 'info', order.confirm_sent_at ? 'Confirmation sent — not tapped yet' : 'Not confirmed on WhatsApp yet');

    const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
    return { level, score, flags, stats: { delivered, refused, cancelled, orders: others.length } };
}

// ---------------------------------------------------------------------
// Customer list (grouped by Google account)
// ---------------------------------------------------------------------
export function buildCustomers(orders, blockedList) {
    const isBlocked = blockedMatcher(blockedList);
    const map = new Map();
    // newest first, so the first row gives the latest name / city
    for (const o of orders) {
        let c = map.get(o.user_uid);
        if (!c) {
            c = {
                uid: o.user_uid, name: o.customer_name, email: o.user_email || null, phones: [], cities: [],
                orders: 0, delivered: 0, returned: 0, cancelled: 0, open: 0, spent: 0, confirmed: 0,
                firstOrder: o.created_at, lastOrder: o.created_at, orderIds: [], recent: []
            };
            map.set(o.user_uid, c);
        }
        c.orders += 1;
        c.orderIds.push(o.id);
        if (c.recent.length < 30) c.recent.push({ id: o.id, order_no: o.order_no, created_at: o.created_at, total: o.total, status: o.status, confirmed: !!o.customer_confirmed_at });
        if (o.status === 'Delivered') { c.delivered += 1; c.spent += o.total || 0; }
        else if (o.status === 'Returned') c.returned += 1;
        else if (o.status === 'Cancelled') c.cancelled += 1;
        else c.open += 1;
        if (o.customer_confirmed_at) c.confirmed += 1;
        const p = normPhone(o.phone) || o.phone;
        if (p && !c.phones.includes(p)) c.phones.push(p);
        if (o.city && !c.cities.some(x => x.toLowerCase() === o.city.toLowerCase())) c.cities.push(o.city);
        if (!c.email && o.user_email) c.email = o.user_email;
        if (o.created_at < c.firstOrder) c.firstOrder = o.created_at;
    }
    // phones shared between accounts
    const phoneOwners = new Map();
    for (const c of map.values()) for (const p of c.phones) {
        const k = phoneKey(p);
        phoneOwners.set(k, (phoneOwners.get(k) || 0) + 1);
    }
    return [...map.values()].map(c => ({
        ...c,
        sharedPhone: c.phones.some(p => (phoneOwners.get(phoneKey(p)) || 0) > 1),
        blocked: !!isBlocked({ uid: c.uid, email: c.email }) || c.phones.some(p => isBlocked({ phone: p }))
    }));
}
