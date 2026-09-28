// /api/admin — everything the admin panel needs. Only emails listed in
// the ADMIN_EMAILS environment variable can use it.
//   GET  ?action=whoami
//   GET  ?action=dashboard           real stats + recent orders
//   GET  ?action=products            all products (incl. Draft / Sold)
//   POST ?action=saveProduct         { id?, product }
//   POST ?action=deleteProduct       { id }
//   POST ?action=uploadUrl           { ext } -> signed upload for one image
//   POST ?action=deleteImages        { urls }
//   GET  ?action=orders&status=      all orders
//   POST ?action=orderStatus         { id, status, courier?, tracking_no?, tracking_url? }
//   POST ?action=orderTracking       { id, courier, tracking_no, tracking_url }
//   GET  ?action=notifyStatus        Telegram / email alert setup
//   POST ?action=telegramConnect     link the owner's Telegram chat
//   POST ?action=testNotify          send a test alert
//   GET  ?action=coupons             coupon codes
//   POST ?action=saveCoupon          { coupon, isNew }
//   POST ?action=deleteCoupon        { code }
//   GET  ?action=drop                drop countdown settings
//   POST ?action=saveDrop            { drop }
//   GET  ?action=waitlist            "notify me when my size arrives" requests
//   POST ?action=waitlistNotify      { ids }  email them that the size is here
//   POST ?action=waitlistMark        { ids, status }
//   POST ?action=waitlistDelete      { ids }
//   GET  ?action=messages
//   POST ?action=messageRead         { id, read }
//   POST ?action=deleteMessage       { id }
//   POST ?action=setThumbs           { id, thumbs }  small photos for old products
//   GET  ?action=offers              bundle deal + invite-friends settings and stats
//   POST ?action=saveOffers          { bundle, referral }
//   POST ?action=saveEmailSettings   { priceDrop, cartReminder }
//   POST ?action=runReminders        send cart reminder emails now
//   GET  ?action=reviews
//   POST ?action=reviewStatus        { id, status }
//   POST ?action=deleteReview        { id }
//   GET  ?action=sellRequests
//   POST ?action=sellOffer           { id, offer_price, offer_note }
//   POST ?action=sellStatus          { id, status }
//   POST ?action=deleteSell          { id }
//   GET  ?action=visitors&days=7     visitor stats
import { route, getBody, getQuery, HttpError, requireMethod } from './_lib/http.js';
import { getDb, BUCKET, storagePath } from './_lib/db.js';
import { getAdmin } from './_lib/auth.js';
import { isUuid, COUPON_RE, normalizeOffers } from './_lib/shop.js';
import {
    COURIERS, notifyStatusChange, notifyStatus, connectTelegram, sendTestAlert, siteUrl,
    readSetting, writeSetting, notifyRestock, emailPriceDrop, emailSellOffer, emailReady
} from './_lib/notify.js';
import { runCartReminders } from './_lib/reminders.js';

const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
const PRODUCT_STATUSES = ['Active', 'Draft', 'Sold'];
const REVIEW_STATUSES = ['Pending', 'Approved', 'Hidden'];
const SELL_STATUSES = ['New', 'Offered', 'Accepted', 'Declined', 'Rejected', 'Bought'];
const TIMEZONE = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

function dayKey(date) {
    // YYYY-MM-DD in the shop's timezone
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(date));
}

function str(v, max) {
    return String(v ?? '').trim().slice(0, max);
}

function toInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Courier + tracking number typed in the order window
function sanitizeTracking(b = {}) {
    const courier = Object.prototype.hasOwnProperty.call(COURIERS, b.courier) ? b.courier : '';
    const tracking_no = str(b.tracking_no, 60).replace(/[^A-Za-z0-9 \-\/]/g, '');
    const tracking_url = str(b.tracking_url, 500);
    if (tracking_url && !/^https?:\/\/[^\s]+$/i.test(tracking_url)) {
        throw new HttpError(400, 'The tracking link must start with https://');
    }
    return { courier: courier || null, tracking_no: tracking_no || null, tracking_url: tracking_url || null };
}

function hasTracking(b = {}) {
    return ['courier', 'tracking_no', 'tracking_url'].some(k => Object.prototype.hasOwnProperty.call(b, k));
}

async function saveTracking(db, id, tracking) {
    const { data, error } = await db.from('orders')
        .update({ ...tracking, updated_at: new Date().toISOString() })
        .eq('id', id).select('*').maybeSingle();
    if (error) {
        if (/courier|tracking_/.test(error.message || '')) {
            throw new HttpError(400, 'Run the latest supabase-setup.sql in Supabase (SQL Editor) to enable tracking numbers.');
        }
        throw error;
    }
    if (!data) throw new HttpError(404, 'Order not found.');
    return data;
}

function sanitizeProduct(p = {}) {
    const name = str(p.name, 120);
    if (!name) throw new HttpError(400, 'Product name is required.');
    const price = toInt(p.price);
    if (!price) throw new HttpError(400, 'Selling price is required.');
    const status = PRODUCT_STATUSES.includes(p.status) ? p.status : 'Active';
    const sizes = [...new Set((Array.isArray(p.sizes) ? p.sizes : []).map(s => str(s, 10)).filter(Boolean))];
    if (status === 'Active' && sizes.length === 0) throw new HttpError(400, 'Select at least one available size.');
    const images = (Array.isArray(p.images) ? p.images : [])
        .map(u => str(u, 500))
        .filter(u => /^https:\/\//.test(u))
        .slice(0, 8);
    if (images.length === 0) throw new HttpError(400, 'Upload at least one image.');
    // Small grid photos, same order as images ('' = none yet)
    const thumbIn = Array.isArray(p.thumbs) ? p.thumbs : [];
    const thumbs = images.map((_, i) => {
        const t = str(thumbIn[i], 500);
        return /^https:\/\//.test(t) ? t : '';
    });
    const fit = FITS.includes(p.fit) ? p.fit : null;
    return {
        name,
        brand: str(p.brand, 60),
        category: str(p.category, 60),
        condition: str(p.condition, 30),
        price,
        original_price: toInt(p.original_price),
        gender: ['Men', 'Women', 'Unisex', 'Kids'].includes(p.gender) ? p.gender : 'Unisex',
        color: str(p.color, 60),
        sizes,
        status,
        tag: str(p.tag, 20) || null,
        description: str(p.description, 3000),
        images,
        thumbs: thumbs.some(Boolean) ? thumbs : [],
        fit,
        updated_at: new Date().toISOString()
    };
}

const FITS = ['True to size', 'Runs small', 'Runs large'];

const SETUP_SQL_MSG = 'Run the latest supabase-setup.sql in Supabase (SQL Editor) first, then try again.';
function missingTable(error, table) {
    return new RegExp(table).test(error?.message || '') ? new HttpError(400, SETUP_SQL_MSG) : error;
}

function sanitizeCoupon(c = {}) {
    const code = str(c.code, 20).toUpperCase().replace(/\s+/g, '');
    if (!COUPON_RE.test(code)) throw new HttpError(400, 'Code must be 3–20 letters or numbers (A–Z, 0–9, - or _), e.g. EID15.');
    const percent = parseInt(c.percent, 10);
    if (!(percent >= 1 && percent <= 90)) throw new HttpError(400, 'Discount must be between 1% and 90%.');
    const maxUses = c.max_uses === '' || c.max_uses == null ? null : parseInt(c.max_uses, 10);
    if (maxUses !== null && !(maxUses >= 1 && maxUses <= 100000)) throw new HttpError(400, 'Max uses must be a number above 0 — or leave it empty for unlimited.');
    let expires = null;
    if (c.expires_at) {
        const d = new Date(c.expires_at);
        if (isNaN(d)) throw new HttpError(400, 'Invalid expiry date.');
        expires = d.toISOString();
    }
    return {
        code, percent,
        min_order: toInt(c.min_order),
        max_uses: maxUses,
        expires_at: expires,
        active: c.active !== false,
        show_banner: !!c.show_banner
    };
}

function sanitizeDrop(d = {}) {
    const at = d.at ? new Date(d.at) : null;
    if (d.active && (!at || isNaN(at))) throw new HttpError(400, 'Pick the date and time of the drop.');
    return {
        active: !!d.active,
        title: str(d.title, 60) || 'New drop',
        note: str(d.note, 140),
        at: at && !isNaN(at) ? at.toISOString() : null
    };
}

function cleanIds(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(isUuid).slice(0, 500);
    if (!list.length) throw new HttpError(400, 'Nothing selected.');
    return list;
}


async function sendPriceDrop(db, product, oldPrice, site) {
    const settings = (await readSetting('emails')) || {};
    if (settings.priceDrop === false) return { sent: 0, off: true };
    const { data: rows, error } = await db.from('wishlist_items').select('user_uid, email, name, alerted_price').eq('product_id', product.id);
    if (error || !rows?.length) return { sent: 0 };
    // Only people we have not already told about this (or a lower) price
    const due = rows.filter(r => r.email && (r.alerted_price == null || product.price < r.alerted_price));
    if (!due.length) return { sent: 0 };
    if (!emailReady()) return { sent: 0, error: 'Gmail is not set up, so price-drop emails were not sent.' };
    const result = await emailPriceDrop(due, product, oldPrice, site);
    if (result.sent.length) {
        await db.from('wishlist_items').update({ alerted_price: product.price })
            .eq('product_id', product.id).in('user_uid', result.sent);
    }
    return { sent: result.sent.length, failed: result.failed.length, error: result.error };
}

function sanitizeOffers(b = {}, r = {}) {
    const bp = parseInt(b.percent, 10), rp = parseInt(r.percent, 10), rw = parseInt(r.reward, 10), bm = parseInt(b.min, 10);
    if (!(bm >= 2 && bm <= 10)) throw new HttpError(400, 'Bundle: minimum pairs must be between 2 and 10.');
    if (!(bp >= 1 && bp <= 50)) throw new HttpError(400, 'Bundle: discount must be between 1% and 50%.');
    if (!(rp >= 1 && rp <= 50)) throw new HttpError(400, "Invite: the friend's discount must be between 1% and 50%.");
    if (!(rw >= 50 && rw <= 20000)) throw new HttpError(400, 'Invite: the reward must be between PKR 50 and PKR 20,000.');
    return normalizeOffers({ active: !!b.active, min: bm, percent: bp }, { active: !!r.active, percent: rp, reward: rw });
}

async function referralStats(db) {
    const [codes, orders, credits] = await Promise.all([
        db.from('referral_codes').select('code', { count: 'exact', head: true }),
        db.from('orders').select('id, status, total, referrer_uid').not('referrer_uid', 'is', null).limit(5000),
        db.from('credits').select('amount, used_order_id').limit(5000)
    ]);
    const live = (orders.data || []).filter(o => o.status !== 'Cancelled');
    const cr = credits.data || [];
    return {
        codes: codes.count || 0,
        orders: live.length,
        delivered: live.filter(o => o.status === 'Delivered').length,
        sales: live.reduce((s, o) => s + o.total, 0),
        creditsGiven: cr.reduce((s, c) => s + c.amount, 0),
        creditsUsed: cr.filter(c => c.used_order_id).reduce((s, c) => s + c.amount, 0)
    };
}

async function dashboard(db) {
    const [productsRes, ordersRes, messagesRes, waitRes, reviewRes, sellRes] = await Promise.all([
        db.from('products').select('id, name, brand, price, sizes, status, images, created_at').order('created_at', { ascending: false }),
        db.from('orders')
            .select('id, order_no, created_at, customer_name, phone, city, total, status, user_uid, items')
            .order('created_at', { ascending: false })
            .limit(5000),
        db.from('messages').select('id', { count: 'exact', head: true }).eq('is_read', false),
        db.from('restock_requests').select('id', { count: 'exact', head: true }).eq('status', 'Waiting'),
        db.from('reviews').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
        db.from('sell_requests').select('id', { count: 'exact', head: true }).in('status', ['New', 'Accepted'])
    ]);
    if (productsRes.error) throw productsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (messagesRes.error) throw messagesRes.error;

    const products = productsRes.data || [];
    const orders = ordersRes.data || [];
    const live = orders.filter(o => o.status !== 'Cancelled');
    const today = dayKey(Date.now());

    // Last 7 days sales chart
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const key = dayKey(Date.now() - i * 86400000);
        days.push({ date: key, orders: 0, revenue: 0 });
    }
    const dayMap = new Map(days.map(d => [d.date, d]));
    live.forEach(o => {
        const d = dayMap.get(dayKey(o.created_at));
        if (d) { d.orders += 1; d.revenue += o.total; }
    });

    const revenue = live.reduce((s, o) => s + o.total, 0);
    const todays = live.filter(o => dayKey(o.created_at) === today);

    return {
        stats: {
            revenue,
            revenueDelivered: orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0),
            revenueToday: todays.reduce((s, o) => s + o.total, 0),
            totalOrders: orders.length,
            ordersToday: todays.length,
            pendingOrders: orders.filter(o => o.status === 'Pending').length,
            confirmedOrders: orders.filter(o => o.status === 'Confirmed').length,
            shippedOrders: orders.filter(o => o.status === 'Shipped').length,
            deliveredOrders: orders.filter(o => o.status === 'Delivered').length,
            cancelledOrders: orders.filter(o => o.status === 'Cancelled').length,
            customers: new Set(orders.map(o => o.user_uid)).size,
            avgOrderValue: live.length ? Math.round(revenue / live.length) : 0,
            pairsSold: live.reduce((s, o) => s + (o.items?.length || 0), 0),
            totalProducts: products.length,
            activeProducts: products.filter(p => p.status === 'Active').length,
            soldProducts: products.filter(p => p.status === 'Sold').length,
            draftProducts: products.filter(p => p.status === 'Draft').length,
            unreadMessages: messagesRes.count || 0,
            waitingRequests: waitRes.error ? 0 : (waitRes.count || 0),
            pendingReviews: reviewRes.error ? 0 : (reviewRes.count || 0),
            newSellRequests: sellRes.error ? 0 : (sellRes.count || 0)
        },
        salesChart: days,
        recentOrders: orders.slice(0, 8).map(({ user_uid, ...o }) => ({ ...o, itemCount: o.items?.length || 0, items: undefined })),
        recentProducts: products.slice(0, 5),
        latestOrderId: orders[0]?.id || null,
        serverTime: new Date().toISOString()
    };
}

export default route(async (req, res) => {
    const admin = await getAdmin(req);
    const { action, status } = getQuery(req);
    const db = getDb();

    switch (action) {
        case 'whoami':
            return res.status(200).json({ email: admin.email });

        case 'dashboard':
            requireMethod(req, 'GET');
            return res.status(200).json(await dashboard(db));

        case 'products': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('products').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            return res.status(200).json({ products: data || [] });
        }

        case 'saveProduct': {
            requireMethod(req, 'POST');
            const { id, product } = getBody(req);
            const clean = sanitizeProduct(product);
            let result;
            let before = null;
            const save = (row) => id
                ? db.from('products').update(row).eq('id', id).select().single()
                : db.from('products').insert([row]).select().single();
            if (id) {
                if (!isUuid(id)) throw new HttpError(400, 'Invalid product id.');
                const b = await db.from('products').select('id, price, status').eq('id', id).maybeSingle();
                before = b.data || null;
            }
            result = await save(clean);
            if (result.error && /thumbs|fit/.test(result.error.message || '')) {
                // supabase-setup.sql not re-run yet: save without the new columns
                const { thumbs, fit, ...old } = clean;
                result = await save(old);
            }
            if (result.error) throw result.error;
            const saved = result.data;

            // Price went down -> email everyone who saved this shoe
            let priceDrop = null;
            if (before && saved.status === 'Active' && saved.price < before.price) {
                priceDrop = await sendPriceDrop(db, saved, before.price, siteUrl(req));
            }
            return res.status(200).json({ product: saved, priceDrop });
        }

        case 'deleteProduct': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid product id.');
            const { data: p, error } = await db.from('products').select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            if (!p) throw new HttpError(404, 'Product not found.');
            const paths = [...(p.images || []), ...(p.thumbs || [])].map(storagePath).filter(Boolean);
            if (paths.length) await db.storage.from(BUCKET).remove(paths);
            const del = await db.from('products').delete().eq('id', id);
            if (del.error) throw del.error;
            return res.status(200).json({ ok: true });
        }

        case 'uploadUrl': {
            requireMethod(req, 'POST');
            const { ext } = getBody(req);
            const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : 'jpg';
            const path = `shoes/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
            const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
            if (error) throw error;
            const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
            return res.status(200).json({ path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl });
        }

        case 'deleteImages': {
            requireMethod(req, 'POST');
            const { urls } = getBody(req);
            const paths = (Array.isArray(urls) ? urls : []).map(storagePath).filter(Boolean);
            if (paths.length) {
                const { error } = await db.storage.from(BUCKET).remove(paths);
                if (error) throw error;
            }
            return res.status(200).json({ removed: paths.length });
        }

        case 'orders': {
            requireMethod(req, 'GET');
            let q = db.from('orders').select('*').order('created_at', { ascending: false }).limit(1000);
            if (status && STATUSES.includes(status)) q = q.eq('status', status);
            const { data, error } = await q;
            if (error) throw error;
            return res.status(200).json({ orders: data || [] });
        }

        case 'orderStatus': {
            requireMethod(req, 'POST');
            const body = getBody(req);
            const { id, status: newStatus } = body;
            if (!isUuid(id)) throw new HttpError(400, 'Invalid order id.');
            if (!STATUSES.includes(newStatus)) throw new HttpError(400, 'Invalid status.');
            const { data: before, error: beforeError } = await db.from('orders').select('id, status').eq('id', id).maybeSingle();
            if (beforeError) throw beforeError;
            if (!before) throw new HttpError(404, 'Order not found.');
            if (hasTracking(body) && before.status !== 'Cancelled') await saveTracking(db, id, sanitizeTracking(body));
            const { data, error } = await db.rpc('set_order_status', {
                p_order_id: id, p_status: newStatus, p_by: admin.email
            });
            if (error) {
                if ((error.message || '').includes('ALREADY_CANCELLED')) {
                    throw new HttpError(400, 'This order was cancelled and its pairs went back into stock. Ask the customer to place a new order.');
                }
                if ((error.message || '').includes('ORDER_NOT_FOUND')) throw new HttpError(404, 'Order not found.');
                throw error;
            }
            const order = Array.isArray(data) ? data[0] : data;
            // Email the customer when the status really changed
            if (order && before.status !== order.status) await notifyStatusChange(order, siteUrl(req));
            return res.status(200).json({ order });
        }

        case 'orderTracking': {
            requireMethod(req, 'POST');
            const body = getBody(req);
            if (!isUuid(body.id)) throw new HttpError(400, 'Invalid order id.');
            const { data: before, error: beforeError } = await db.from('orders').select('id, status, courier, tracking_no, tracking_url').eq('id', body.id).maybeSingle();
            if (beforeError) {
                if (/courier|tracking_/.test(beforeError.message || '')) throw new HttpError(400, 'Run the latest supabase-setup.sql in Supabase (SQL Editor) to enable tracking numbers.');
                throw beforeError;
            }
            if (!before) throw new HttpError(404, 'Order not found.');
            if (before.status === 'Cancelled') throw new HttpError(400, 'This order is cancelled.');
            const tracking = sanitizeTracking(body);
            const order = await saveTracking(db, body.id, tracking);
            const changed = (before.tracking_no || null) !== tracking.tracking_no || (before.courier || null) !== tracking.courier;
            let emailed = false;
            if (order.status === 'Shipped' && changed && tracking.tracking_no) {
                await notifyStatusChange(order, siteUrl(req));
                emailed = !!order.user_email;
            }
            return res.status(200).json({ order, emailed });
        }

        case 'notifyStatus':
            requireMethod(req, 'GET');
            return res.status(200).json(await notifyStatus());

        case 'telegramConnect':
            requireMethod(req, 'POST');
            try {
                return res.status(200).json(await connectTelegram());
            } catch (e) {
                throw new HttpError(e.status || 400, e.message);
            }

        case 'testNotify':
            requireMethod(req, 'POST');
            return res.status(200).json(await sendTestAlert(siteUrl(req), admin.email));

        case 'coupons': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('coupons').select('*').order('created_at', { ascending: false });
            if (error) throw missingTable(error, 'coupons');
            return res.status(200).json({ coupons: data || [] });
        }

        case 'saveCoupon': {
            requireMethod(req, 'POST');
            const { coupon, isNew } = getBody(req);
            const clean = sanitizeCoupon(coupon);
            if (clean.show_banner && clean.active) {
                // Only one code can be advertised in the top bar at a time
                const { error: offError } = await db.from('coupons').update({ show_banner: false }).neq('code', clean.code);
                if (offError) throw missingTable(offError, 'coupons');
            }
            let result;
            if (isNew) {
                result = await db.from('coupons').insert(clean).select('*').single();
                if (result.error?.code === '23505') throw new HttpError(400, `The code ${clean.code} already exists.`);
            } else {
                const { code, ...changes } = clean;
                result = await db.from('coupons').update(changes).eq('code', code).select('*').maybeSingle();
                if (!result.error && !result.data) throw new HttpError(404, 'Coupon not found.');
            }
            if (result.error) throw missingTable(result.error, 'coupons');
            return res.status(200).json({ coupon: result.data });
        }

        case 'deleteCoupon': {
            requireMethod(req, 'POST');
            const code = str(getBody(req).code, 20).toUpperCase();
            if (!COUPON_RE.test(code)) throw new HttpError(400, 'Invalid code.');
            const { error } = await db.from('coupons').delete().eq('code', code);
            if (error) throw missingTable(error, 'coupons');
            return res.status(200).json({ ok: true });
        }

        case 'drop':
            requireMethod(req, 'GET');
            return res.status(200).json({ drop: (await readSetting('drop')) || { active: false, title: 'New drop', note: '', at: null } });

        case 'saveDrop': {
            requireMethod(req, 'POST');
            const drop = sanitizeDrop(getBody(req).drop);
            try {
                await writeSetting('drop', drop);
            } catch (e) {
                throw new HttpError(400, e.message);
            }
            return res.status(200).json({ drop });
        }

        case 'waitlist': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('restock_requests').select('*').order('created_at', { ascending: false }).limit(1000);
            if (error) throw missingTable(error, 'restock_requests');
            const ids = [...new Set((data || []).map(r => r.product_id).filter(Boolean))];
            let products = [];
            if (ids.length) {
                const pr = await db.from('products').select('id, name, brand, price, sizes, status, images').in('id', ids);
                if (pr.error) throw pr.error;
                products = pr.data || [];
            }
            return res.status(200).json({ requests: data || [], products, emailReady: !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) });
        }

        case 'waitlistNotify': {
            requireMethod(req, 'POST');
            const ids = cleanIds(getBody(req).ids);
            const { data, error } = await db.from('restock_requests').select('*').in('id', ids);
            if (error) throw missingTable(error, 'restock_requests');
            const productIds = [...new Set((data || []).map(r => r.product_id).filter(Boolean))];
            const pr = productIds.length
                ? await db.from('products').select('id, name, brand, price, sizes, status, images').in('id', productIds)
                : { data: [] };
            if (pr.error) throw pr.error;
            const result = await notifyRestock(data || [], new Map((pr.data || []).map(p => [p.id, p])), siteUrl(req));
            if (result.sent.length) {
                const { error: upError } = await db.from('restock_requests')
                    .update({ status: 'Notified', notified_at: new Date().toISOString() }).in('id', result.sent);
                if (upError) throw upError;
            }
            if (!result.sent.length && result.error) throw new HttpError(400, result.error);
            return res.status(200).json({ sent: result.sent.length, failed: result.failed.length, skipped: result.skipped.length, error: result.error });
        }

        case 'waitlistMark': {
            requireMethod(req, 'POST');
            const body = getBody(req);
            const ids = cleanIds(body.ids);
            const status = body.status === 'Waiting' ? 'Waiting' : 'Notified';
            const { error } = await db.from('restock_requests')
                .update({ status, notified_at: status === 'Notified' ? new Date().toISOString() : null }).in('id', ids);
            if (error) {
                if (error.code === '23505') throw new HttpError(400, 'This customer is already waiting for that size.');
                throw missingTable(error, 'restock_requests');
            }
            return res.status(200).json({ ok: true });
        }

        case 'waitlistDelete': {
            requireMethod(req, 'POST');
            const ids = cleanIds(getBody(req).ids);
            const { error } = await db.from('restock_requests').delete().in('id', ids);
            if (error) throw missingTable(error, 'restock_requests');
            return res.status(200).json({ ok: true });
        }

        case 'messages': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('messages').select('*').order('created_at', { ascending: false }).limit(300);
            if (error) throw error;
            return res.status(200).json({ messages: data || [] });
        }

        case 'messageRead': {
            requireMethod(req, 'POST');
            const { id, read } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid message id.');
            const { error } = await db.from('messages').update({ is_read: !!read }).eq('id', id);
            if (error) throw error;
            return res.status(200).json({ ok: true });
        }

        case 'deleteMessage': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid message id.');
            const { error } = await db.from('messages').delete().eq('id', id);
            if (error) throw error;
            return res.status(200).json({ ok: true });
        }

        case 'setThumbs': {
            requireMethod(req, 'POST');
            const { id, thumbs } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid product id.');
            const { data: p, error } = await db.from('products').select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            if (!p) throw new HttpError(404, 'Product not found.');
            const list = (p.images || []).map((_, i) => {
                const t = str(Array.isArray(thumbs) ? thumbs[i] : '', 500);
                return /^https:\/\//.test(t) ? t : (p.thumbs?.[i] || '');
            });
            const up = await db.from('products').update({ thumbs: list }).eq('id', id).select('id, thumbs').single();
            if (up.error) throw missingTable(up.error, 'thumbs');
            return res.status(200).json({ product: up.data });
        }

        case 'offers': {
            requireMethod(req, 'GET');
            const [bundle, referral, emails] = await Promise.all([readSetting('bundle'), readSetting('referral'), readSetting('emails')]);
            const offers = normalizeOffers(bundle, referral);
            let stats = null;
            try { stats = await referralStats(db); } catch { stats = null; }
            return res.status(200).json({ ...offers, stats, emails: { priceDrop: emails?.priceDrop !== false, cartReminder: emails?.cartReminder !== false } });
        }

        case 'saveOffers': {
            requireMethod(req, 'POST');
            const body = getBody(req);
            const offers = sanitizeOffers(body.bundle, body.referral);
            try {
                await writeSetting('bundle', offers.bundle);
                await writeSetting('referral', offers.referral);
            } catch (e) {
                throw new HttpError(400, e.message);
            }
            return res.status(200).json(offers);
        }

        case 'saveEmailSettings': {
            requireMethod(req, 'POST');
            const b = getBody(req);
            const emails = { priceDrop: b.priceDrop !== false, cartReminder: b.cartReminder !== false };
            try { await writeSetting('emails', emails); } catch (e) { throw new HttpError(400, e.message); }
            return res.status(200).json({ emails });
        }

        case 'runReminders': {
            requireMethod(req, 'POST');
            const out = await runCartReminders(db, siteUrl(req));
            if (!out.sent && out.error) throw new HttpError(400, out.error);
            return res.status(200).json(out);
        }

        case 'reviews': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('reviews').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) throw missingTable(error, 'reviews');
            const orderIds = (data || []).map(r => r.order_id).filter(Boolean);
            let orders = [];
            if (orderIds.length) {
                const o = await db.from('orders').select('id, order_no, customer_name, phone').in('id', orderIds);
                orders = o.data || [];
            }
            const byId = new Map(orders.map(o => [o.id, o]));
            return res.status(200).json({ reviews: (data || []).map(r => ({ ...r, order: byId.get(r.order_id) || null })) });
        }

        case 'reviewStatus': {
            requireMethod(req, 'POST');
            const { id, status: st } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid review.');
            if (!REVIEW_STATUSES.includes(st)) throw new HttpError(400, 'Invalid status.');
            const { data, error } = await db.from('reviews')
                .update({ status: st, approved_at: st === 'Approved' ? new Date().toISOString() : null })
                .eq('id', id).select('*').maybeSingle();
            if (error) throw missingTable(error, 'reviews');
            if (!data) throw new HttpError(404, 'Review not found.');
            return res.status(200).json({ review: data });
        }

        case 'deleteReview': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid review.');
            const { data, error } = await db.from('reviews').delete().eq('id', id).select('images');
            if (error) throw missingTable(error, 'reviews');
            const paths = (data || []).flatMap(r => r.images || []).map(storagePath).filter(Boolean);
            if (paths.length) await db.storage.from(BUCKET).remove(paths);
            return res.status(200).json({ ok: true });
        }

        case 'sellRequests': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('sell_requests').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) throw missingTable(error, 'sell_requests');
            return res.status(200).json({ requests: data || [], emailReady: emailReady() });
        }

        case 'sellOffer': {
            requireMethod(req, 'POST');
            const b = getBody(req);
            if (!isUuid(b.id)) throw new HttpError(400, 'Invalid request.');
            const price = parseInt(b.offer_price, 10);
            if (!(price >= 100 && price <= 10000000)) throw new HttpError(400, 'Enter your offer in PKR (at least 100).');
            const { data, error } = await db.from('sell_requests')
                .update({ status: 'Offered', offer_price: price, offer_note: str(b.offer_note, 400) || null, updated_at: new Date().toISOString() })
                .eq('id', b.id).select('*').maybeSingle();
            if (error) throw missingTable(error, 'sell_requests');
            if (!data) throw new HttpError(404, 'Request not found.');
            let emailed = false, emailError = null;
            try { await emailSellOffer(data, siteUrl(req)); emailed = true; } catch (e) { emailError = e.message; }
            return res.status(200).json({ request: data, emailed, emailError });
        }

        case 'sellStatus': {
            requireMethod(req, 'POST');
            const { id, status: st } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid request.');
            if (!SELL_STATUSES.includes(st)) throw new HttpError(400, 'Invalid status.');
            const { data, error } = await db.from('sell_requests').update({ status: st, updated_at: new Date().toISOString() })
                .eq('id', id).select('*').maybeSingle();
            if (error) throw missingTable(error, 'sell_requests');
            if (!data) throw new HttpError(404, 'Request not found.');
            return res.status(200).json({ request: data });
        }

        case 'deleteSell': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid request.');
            const { data, error } = await db.from('sell_requests').delete().eq('id', id).select('images');
            if (error) throw missingTable(error, 'sell_requests');
            const paths = (data || []).flatMap(r => r.images || []).map(storagePath).filter(Boolean);
            if (paths.length) await db.storage.from(BUCKET).remove(paths);
            return res.status(200).json({ ok: true });
        }

        case 'visitors': {
            requireMethod(req, 'GET');
            const days = [7, 30, 90].includes(parseInt(getQuery(req).days, 10)) ? parseInt(getQuery(req).days, 10) : 7;
            const { data, error } = await db.rpc('visitor_stats', { p_days: days, p_tz: TIMEZONE });
            if (error) throw missingTable(error, 'visitor_stats|page_views');
            const since = new Date(Date.now() - days * 86400000).toISOString();
            const { data: orders } = await db.from('orders').select('user_uid, total, status').gte('created_at', since).neq('status', 'Cancelled').limit(5000);
            return res.status(200).json({
                days,
                ...(data || {}),
                orders: (orders || []).length,
                buyers: new Set((orders || []).map(o => o.user_uid)).size,
                sales: (orders || []).reduce((s, o) => s + o.total, 0)
            });
        }

        default:
            throw new HttpError(404, 'Unknown action');
    }
});
