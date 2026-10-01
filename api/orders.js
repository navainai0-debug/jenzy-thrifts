// /api/orders — customer ordering
//   GET  ?action=config   delivery fee etc. (public)
//   POST ?action=quote    live prices, availability and totals for a cart (public)
//   POST ?action=place    place a Cash-on-Delivery order (login required)
//   GET  ?action=mine     the logged-in customer's orders
//   POST ?action=cancel   cancel own order while it is still Pending
//   POST ?action=notify   "tell me when size X arrives" (login required)
//   POST ?action=wish     { product_id, on }  save / remove a wishlist shoe (for price-drop emails)
//   POST ?action=wishSync { ids }             add local wishlist shoes, returns the saved list
//   POST ?action=cart     { items }           remember the cart (for the reminder email)
//   GET  ?action=referral                     invite code, credits and friends
//   POST ?action=referral                     create my invite code
//   POST ?action=uploadUrl { kind, ext }      photo upload for a review or a sell request
//   POST ?action=review   { order_id, rating, text, images }
//   GET  ?action=sellMine                     my "sell us your sneakers" requests
//   POST ?action=sell     { ...request }
//   POST ?action=sellRespond { id, accept }   accept / decline our offer
import { route, getBody, getQuery, HttpError, requireMethod } from './_lib/http.js';
import { getDb, BUCKET, storagePath } from './_lib/db.js';
import { getUser } from './_lib/auth.js';
import {
    shopConfig, computeTotals, findCoupon, findCredit, computeDiscount, discountLabel, readOffers,
    validateItems, validateCustomer, isUuid, orderErrorMessage
} from './_lib/shop.js';
import { notifyNewOrder, notifyCustomerCancelled, notifyOwner, siteUrl, trackingLink, readSetting } from './_lib/notify.js';
import { checkCanOrder, cleanLocation, cleanSafety, loadHistory, loadBlocked, riskContext, computeRisk } from './_lib/safety.js';

const PUBLIC_ORDER_FIELDS =
    'id, order_no, created_at, updated_at, customer_name, phone, address, city, notes, payment_method, items, subtotal, discount, coupon, discount_type, delivery_fee, total, status, status_history, courier, tracking_no, tracking_url';

// Logged-in customer if a valid token was sent, otherwise null (quote is public)
async function optionalUser(req) {
    const h = req.headers.authorization || req.headers.Authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    try { return await getUser(req); } catch { return null; }
}

const img0 = (p) => p?.thumbs?.[0] || p?.images?.[0] || '';

async function quote(body, user) {
    const cfg = shopConfig();
    const items = validateItems(body.items);
    const db = getDb();
    const ids = [...new Set(items.map(i => i.product_id))];
    const { data, error } = await db
        .from('products')
        .select('*')
        .in('id', ids);
    if (error) throw error;

    const byId = new Map((data || []).map(p => [p.id, p]));
    let subtotal = 0;
    let count = 0;
    const lines = items.map(it => {
        const p = byId.get(it.product_id);
        if (!p || p.status !== 'Active') {
            return { ...it, available: false, reason: 'Sold out', name: p?.name || 'Item', brand: p?.brand || '', price: p?.price || 0, image: img0(p) };
        }
        if (!(p.sizes || []).includes(it.size)) {
            return { ...it, available: false, reason: `Size ${it.size} sold out`, name: p.name, brand: p.brand, price: p.price, image: img0(p) };
        }
        subtotal += p.price;
        count++;
        return { ...it, available: true, name: p.name, brand: p.brand, price: p.price, original_price: p.original_price || 0, image: img0(p) };
    });

    const offers = await readOffers(db);
    let code = null;
    let couponError = null;
    try {
        code = await findCoupon(db, body.coupon, subtotal, { user, offers });
        if (!code.code) code = null;
    } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        couponError = e.message;
    }
    const credit = user ? await findCredit(db, user.uid) : null;
    const d = computeDiscount({ subtotal, count, code, offers, credit });

    // Friendly notes for the checkout page
    let couponNote = null;
    if (code && d.type !== code.kind && d.candidates[code.kind] > 0) {
        couponNote = `Your code gives PKR ${d.candidates[code.kind].toLocaleString('en-US')} off, but the ${d.type === 'bundle' ? 'bundle deal' : 'invite credit'} saves you more, so we applied that. Only the biggest discount is used.`;
    }
    let bundleHint = null;
    if (offers.bundle.active && count > 0 && count < offers.bundle.min) {
        const more = offers.bundle.min - count;
        bundleHint = `Add ${more} more pair${more > 1 ? 's' : ''} and get ${offers.bundle.percent}% off your order.`;
    }

    return {
        items: lines,
        coupon: code && d.type === code.kind ? code.code : null,
        codeKind: code ? code.kind : null,
        couponPercent: code ? code.percent : 0,
        couponError,
        couponNote,
        discountType: d.type,
        discountLabel: discountLabel(d.type, { code, offers }),
        credit: credit ? { amount: credit.amount, applied: d.type === 'credit' } : null,
        bundle: offers.bundle,
        bundleHint,
        ...computeTotals(subtotal, d.discount, cfg),
        freeDeliveryMin: cfg.freeDeliveryMin,
        allAvailable: lines.every(l => l.available)
    };
}

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeUid = (uid) => String(uid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'user';

// Photos a customer uploaded with ?action=uploadUrl (only their own folder)
function ownPhotos(urls, kind, user, max) {
    const prefix = `${kind}/${safeUid(user.uid)}/`;
    const list = (Array.isArray(urls) ? urls : []).map(u => String(u || '')).filter(u => {
        const path = storagePath(u);
        return /^https:\/\//.test(u) && path && path.startsWith(prefix);
    });
    return [...new Set(list)].slice(0, max);
}

// "Ali Khan" -> "Ali K."
function shortName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Customer';
    const first = parts[0].slice(0, 20);
    return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

async function referralInfo(db, user) {
    const offers = await readOffers(db);
    const [codeRes, creditRes, friendsRes] = await Promise.all([
        db.from('referral_codes').select('code').eq('user_uid', user.uid).maybeSingle(),
        db.from('credits').select('amount, reason, created_at, used_at, used_order_id').eq('user_uid', user.uid).order('created_at', { ascending: false }).limit(50),
        db.from('orders').select('status').eq('referrer_uid', user.uid).limit(500)
    ]);
    if (codeRes.error) {
        if (/referral_codes/.test(codeRes.error.message || '')) throw new HttpError(503, 'Invite codes are not switched on yet.');
        throw codeRes.error;
    }
    const credits = creditRes.data || [];
    const friends = (friendsRes.data || []).filter(o => o.status !== 'Cancelled');
    return {
        code: codeRes.data?.code || null,
        offer: offers.referral,
        balance: credits.filter(c => !c.used_order_id).reduce((s, c) => s + c.amount, 0),
        credits: credits.map(c => ({ amount: c.amount, reason: c.reason, created_at: c.created_at, used: !!c.used_order_id, used_at: c.used_at })),
        friends: friends.length,
        friendsDelivered: friends.filter(o => o.status === 'Delivered').length
    };
}

function makeCode(name) {
    const letters = String(name || '').normalize('NFKD').toUpperCase().replace(/[^A-Z]/g, '');
    const base = (letters + 'JENZY').slice(0, 5);
    return base + String(Math.floor(100 + Math.random() * 900));
}

const SELL_FIELDS = 'id, created_at, updated_at, brand, model, size, condition, asking_price, notes, images, status, offer_price, offer_note';

export default route(async (req, res) => {
    const { action } = getQuery(req);

    if (action === 'config') {
        requireMethod(req, 'GET');
        const cfg = shopConfig();
        return res.status(200).json({
            currency: cfg.currency,
            deliveryFee: cfg.deliveryFee,
            freeDeliveryMin: cfg.freeDeliveryMin,
            paymentMethods: cfg.paymentMethods
        });
    }

    if (action === 'quote') {
        requireMethod(req, 'POST');
        return res.status(200).json(await quote(getBody(req), await optionalUser(req)));
    }

    if (action === 'place') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const body = getBody(req);
        const cfg = shopConfig();
        const items = validateItems(body.items);
        const customer = validateCustomer(body.customer);
        const db = getDb();
        const coupon = await findCoupon(db, body.coupon, null, { user });
        const location = cleanLocation(body.location);
        const safety = cleanSafety((await readSetting('safety')) || {});
        // Blocked numbers / accounts can't order
        await checkCanOrder(db, { uid: user.uid, email: user.email, phone: customer.phone }, safety);

        // Stop people from locking up stock with lots of fake orders
        const { count, error: countError } = await db
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_uid', user.uid)
            .eq('status', 'Pending');
        if (countError) throw countError;
        if ((count || 0) >= cfg.maxPendingOrdersPerUser) {
            throw new HttpError(429, 'You already have several pending orders. Please wait until we confirm them.');
        }

        const { data, error } = await db.rpc('place_order', {
            p_user_uid: user.uid,
            p_user_email: user.email || null,
            p_customer_name: customer.name,
            p_phone: customer.phone,
            p_address: customer.address,
            p_city: customer.city,
            p_notes: customer.notes,
            p_items: items,
            p_coupon: coupon.code,
            p_discount_percent: coupon.percent,
            p_delivery_fee: cfg.deliveryFee,
            p_free_delivery_min: cfg.freeDeliveryMin
        });
        if (error) {
            const friendly = orderErrorMessage(error);
            if (friendly) throw new HttpError(String(error.message || '').startsWith('COUPON:') ? 400 : 409, friendly);
            throw error;
        }
        const order = Array.isArray(data) ? data[0] : data;
        if (location) {
            // "Pin my location" (ignored if supabase-setup.sql wasn't re-run yet)
            const { error: locError } = await db.from('orders').update({ location }).eq('id', order.id);
            if (!locError) order.location = location;
        }
        // Fake-order check for the owner's alert (never blocks the order)
        let risk = null;
        try {
            const [history, blocked] = await Promise.all([loadHistory(db), loadBlocked(db)]);
            risk = computeRisk(order, riskContext(history, blocked.list, safety));
        } catch (e) { console.error('[risk]', e.message); }
        // Telegram / email alerts (never block or break the order)
        await notifyNewOrder({ ...order, risk, user_email: order.user_email || user.email || null }, siteUrl(req));
        return res.status(201).json({
            order: { id: order.id, order_no: order.order_no, total: order.total, status: order.status }
        });
    }

    if (action === 'mine') {
        requireMethod(req, 'GET');
        const user = await getUser(req);
        const { data, error } = await getDb()
            .from('orders')
            .select(PUBLIC_ORDER_FIELDS)
            .eq('user_uid', user.uid)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        const orders = (data || []).map(o => ({ ...o, tracking_link: trackingLink(o) }));
        // Reviews the customer already wrote
        const delivered = orders.filter(o => o.status === 'Delivered').map(o => o.id);
        const reviews = {};
        if (delivered.length) {
            const { data: rv } = await getDb().from('reviews').select('order_id, rating, status').in('order_id', delivered);
            for (const r of rv || []) reviews[r.order_id] = { rating: r.rating, status: r.status };
        }
        return res.status(200).json({ orders, reviews });
    }

    if (action === 'cancel') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const { id } = getBody(req);
        if (!isUuid(id)) throw new HttpError(400, 'Invalid order.');
        const db = getDb();
        const { data: order, error } = await db
            .from('orders')
            .select('id, user_uid, status')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!order || order.user_uid !== user.uid) throw new HttpError(404, 'Order not found.');
        if (order.status !== 'Pending') {
            throw new HttpError(400, 'This order is already being processed and can no longer be cancelled online. Please contact us.');
        }
        const { data: updated, error: rpcError } = await db.rpc('set_order_status', {
            p_order_id: id, p_status: 'Cancelled', p_by: 'customer'
        });
        if (rpcError) throw rpcError;
        const row = Array.isArray(updated) ? updated[0] : updated;
        await notifyCustomerCancelled(row, siteUrl(req));
        return res.status(200).json({ order: { id: row.id, status: row.status } });
    }

    if (action === 'notify') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const body = getBody(req);
        const productId = String(body.product_id || '');
        const size = String(body.size ?? '').trim();
        if (!isUuid(productId)) throw new HttpError(400, 'Invalid shoe.');
        if (!/^\d{1,2}(\.5)?$/.test(size) || parseFloat(size) < 1 || parseFloat(size) > 18) throw new HttpError(400, 'Please choose your US size.');
        const phoneDigits = String(body.phone ?? '').replace(/[^\d+]/g, '');
        if (phoneDigits && (phoneDigits.replace(/\D/g, '').length < 10 || phoneDigits.length > 16)) {
            throw new HttpError(400, 'Please enter a valid WhatsApp number, e.g. 03001234567 — or leave it empty.');
        }
        const db = getDb();
        const { data: product, error: pErr } = await db.from('products')
            .select('id, name, brand, status, sizes').eq('id', productId).maybeSingle();
        if (pErr) throw pErr;
        if (!product || product.status === 'Draft') throw new HttpError(404, 'This shoe is no longer listed.');
        if (product.status === 'Active' && (product.sizes || []).includes(size)) {
            throw new HttpError(400, `Size ${size} is available right now — you can order it.`);
        }
        const { count, error: cErr } = await db.from('restock_requests')
            .select('id', { count: 'exact', head: true })
            .eq('user_uid', user.uid).eq('status', 'Waiting');
        if (cErr) {
            if (/restock_requests/.test(cErr.message || '')) throw new HttpError(503, 'Size alerts are not switched on yet. Please try again later.');
            throw cErr;
        }
        if ((count || 0) >= 20) throw new HttpError(429, 'You already have 20 size alerts. We will email you as soon as they arrive.');
        const { error } = await db.from('restock_requests').insert({
            product_id: product.id,
            product_name: product.name,
            brand: product.brand || null,
            size,
            user_uid: user.uid,
            email: user.email || null,
            name: String(user.name || '').slice(0, 80) || null,
            phone: phoneDigits || null
        });
        if (error) {
            if (error.code === '23505') return res.status(200).json({ ok: true, already: true });
            throw error;
        }
        return res.status(201).json({ ok: true });
    }

    if (action === 'wish') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const { product_id, on } = getBody(req);
        if (!isUuid(product_id)) throw new HttpError(400, 'Invalid shoe.');
        const db = getDb();
        if (on) {
            const { data: p } = await db.from('products').select('id, price').eq('id', product_id).maybeSingle();
            if (!p) throw new HttpError(404, 'This shoe is no longer listed.');
            const { error } = await db.from('wishlist_items').upsert({
                user_uid: user.uid, product_id, email: user.email || null, name: str(user.name, 80) || null, alerted_price: p.price
            }, { onConflict: 'user_uid,product_id', ignoreDuplicates: true });
            if (error && !/wishlist_items/.test(error.message || '')) throw error;
        } else {
            const { error } = await db.from('wishlist_items').delete().eq('user_uid', user.uid).eq('product_id', product_id);
            if (error && !/wishlist_items/.test(error.message || '')) throw error;
        }
        return res.status(200).json({ ok: true });
    }

    if (action === 'wishSync') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const ids = [...new Set((Array.isArray(getBody(req).ids) ? getBody(req).ids : []).filter(isUuid))].slice(0, 100);
        const db = getDb();
        if (ids.length) {
            const { data: prods } = await db.from('products').select('id, price').in('id', ids);
            const rows = (prods || []).map(p => ({ user_uid: user.uid, product_id: p.id, email: user.email || null, name: str(user.name, 80) || null, alerted_price: p.price }));
            if (rows.length) {
                const { error } = await db.from('wishlist_items').upsert(rows, { onConflict: 'user_uid,product_id', ignoreDuplicates: true });
                if (error) {
                    if (/wishlist_items/.test(error.message || '')) return res.status(200).json({ ids });
                    throw error;
                }
            }
        }
        const { data, error } = await db.from('wishlist_items').select('product_id').eq('user_uid', user.uid).order('created_at', { ascending: false }).limit(200);
        if (error) return res.status(200).json({ ids });
        return res.status(200).json({ ids: (data || []).map(r => r.product_id) });
    }

    if (action === 'cart') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const raw = Array.isArray(getBody(req).items) ? getBody(req).items : [];
        const items = raw.slice(0, 20).map(it => ({ product_id: String(it?.product_id || it?.id || ''), size: String(it?.size ?? '').slice(0, 10) }))
            .filter(it => isUuid(it.product_id) && it.size);
        const db = getDb();
        const { error } = items.length
            ? await db.from('carts').upsert({ user_uid: user.uid, email: user.email || null, name: str(user.name, 80) || null, items, updated_at: new Date().toISOString() })
            : await db.from('carts').delete().eq('user_uid', user.uid);
        if (error && !/carts/.test(error.message || '')) throw error;
        return res.status(200).json({ ok: true });
    }

    if (action === 'referral') {
        const user = await getUser(req);
        const db = getDb();
        if (req.method === 'POST') {
            const info = await referralInfo(db, user);
            if (!info.offer.active) throw new HttpError(400, 'Invite codes are switched off right now.');
            if (!info.code) {
                let lastError = null;
                for (let i = 0; i < 6 && !info.code; i++) {
                    const code = makeCode(user.name || user.email);
                    const { error } = await db.from('referral_codes').insert({ code, user_uid: user.uid, email: user.email || null, name: str(user.name, 80) || null });
                    if (!error) info.code = code;
                    else if (error.code === '23505' && /user_uid/.test(error.message + (error.details || ''))) {
                        return res.status(200).json(await referralInfo(db, user));
                    } else lastError = error;
                }
                if (!info.code) throw lastError || new HttpError(500, 'Could not create your code. Please try again.');
            }
            return res.status(200).json(info);
        }
        requireMethod(req, 'GET');
        return res.status(200).json(await referralInfo(db, user));
    }

    if (action === 'uploadUrl') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const { kind, ext } = getBody(req);
        if (!['reviews', 'sell'].includes(kind)) throw new HttpError(400, 'Invalid upload.');
        const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : 'jpg';
        const path = `${kind}/${safeUid(user.uid)}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${safeExt}`;
        const db = getDb();
        const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) throw error;
        const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
        return res.status(200).json({ path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl });
    }

    if (action === 'review') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const body = getBody(req);
        if (!isUuid(body.order_id)) throw new HttpError(400, 'Invalid order.');
        const rating = parseInt(body.rating, 10);
        if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Please choose 1 to 5 stars.');
        const text = String(body.text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000);
        if (rating <= 3 && text.length < 5) throw new HttpError(400, 'Please tell us a little about what went wrong.');
        const db = getDb();
        const { data: order, error } = await db.from('orders').select('id, user_uid, status, customer_name, city, items').eq('id', body.order_id).maybeSingle();
        if (error) throw error;
        if (!order || order.user_uid !== user.uid) throw new HttpError(404, 'Order not found.');
        if (order.status !== 'Delivered') throw new HttpError(400, 'You can review your order after it is delivered.');
        const row = {
            order_id: order.id,
            user_uid: user.uid,
            name: shortName(order.customer_name || user.name),
            city: str(order.city, 60) || null,
            rating,
            text: text || null,
            images: ownPhotos(body.images, 'reviews', user, 3),
            product_names: (order.items || []).map(i => i.name).join(', ').slice(0, 300)
        };
        const { error: insError } = await db.from('reviews').insert(row);
        if (insError) {
            if (insError.code === '23505') throw new HttpError(400, 'You already reviewed this order. Thank you!');
            if (/reviews/.test(insError.message || '')) throw new HttpError(503, 'Reviews are not switched on yet.');
            throw insError;
        }
        const site = siteUrl(req);
        await notifyOwner({
            telegram: `⭐ <b>New review: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</b>\n${row.name}${row.city ? ', ' + row.city : ''}\n${row.text ? '“' + row.text.slice(0, 300).replace(/[<>&]/g, '') + '”' : ''}${row.images.length ? `\n📷 ${row.images.length} photo(s)` : ''}\nApprove it in the admin panel to show it on the website.`,
            subject: `⭐ New ${rating}-star review from ${row.name}`,
            heading: `New ${rating}-star review`,
            intro: `${row.name}${row.city ? ' from ' + row.city : ''} reviewed their order${row.text ? ': “' + row.text.slice(0, 300).replace(/[<>&"]/g, '') + '”' : '.'} Approve it to show it on the website.`,
            site, link: `${site}/admin.html#reviews`
        });
        return res.status(201).json({ ok: true, status: 'Pending' });
    }

    if (action === 'sellMine') {
        requireMethod(req, 'GET');
        const user = await getUser(req);
        const { data, error } = await getDb().from('sell_requests').select(SELL_FIELDS).eq('user_uid', user.uid).order('created_at', { ascending: false }).limit(30);
        if (error) {
            if (/sell_requests/.test(error.message || '')) return res.status(200).json({ requests: [] });
            throw error;
        }
        return res.status(200).json({ requests: data || [] });
    }

    if (action === 'sell') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const b = getBody(req);
        const name = str(b.name, 80);
        const phone = String(b.phone ?? '').replace(/[^\d+]/g, '');
        const brand = str(b.brand, 40);
        const model = str(b.model, 80);
        const size = str(b.size, 10);
        const asking = parseInt(b.asking_price, 10);
        if (name.length < 2) throw new HttpError(400, 'Please enter your name.');
        if (phone.replace(/\D/g, '').length < 10 || phone.length > 16) throw new HttpError(400, 'Please enter a valid WhatsApp number, e.g. 03001234567.');
        if (!brand) throw new HttpError(400, 'Which brand are the shoes?');
        if (model.length < 2) throw new HttpError(400, 'Please write the model name, e.g. Air Force 1.');
        if (!size) throw new HttpError(400, 'Please enter the size.');
        const images = ownPhotos(b.images, 'sell', user, 5);
        if (images.length < 2) throw new HttpError(400, 'Please add at least 2 clear photos (sides, sole and inside label).');
        const db = getDb();
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count, error: cErr } = await db.from('sell_requests').select('id', { count: 'exact', head: true }).eq('user_uid', user.uid).gte('created_at', since);
        if (cErr) {
            if (/sell_requests/.test(cErr.message || '')) throw new HttpError(503, 'Selling is not switched on yet. Please message us on WhatsApp.');
            throw cErr;
        }
        if ((count || 0) >= 5) throw new HttpError(429, 'You sent 5 requests today. Please wait for our reply first.');
        const row = {
            user_uid: user.uid, email: user.email || null, name, phone,
            city: str(b.city, 60) || null, brand, model, size,
            condition: str(b.condition, 30) || null,
            asking_price: Number.isFinite(asking) && asking > 0 ? Math.min(asking, 10000000) : null,
            notes: String(b.notes ?? '').trim().slice(0, 600) || null,
            images
        };
        const { data, error } = await db.from('sell_requests').insert(row).select(SELL_FIELDS).single();
        if (error) throw error;
        const site = siteUrl(req);
        const clean = (t) => String(t).replace(/[<>&]/g, '');
        await notifyOwner({
            telegram: `👟 <b>Someone wants to sell you shoes</b>\n${clean(brand)} ${clean(model)} • US ${clean(size)}${row.condition ? ' • ' + clean(row.condition) : ''}\n${row.asking_price ? 'Asking: PKR ' + row.asking_price.toLocaleString('en-US') + '\n' : ''}👤 ${clean(name)} • 📞 ${clean(phone)}${row.city ? ' • ' + clean(row.city) : ''}\n📷 ${images.length} photos`,
            subject: `👟 Sell request: ${brand} ${model} (US ${size}) from ${name}`,
            heading: 'New "sell us your sneakers" request',
            intro: `${clean(name)} (${clean(phone)}) wants to sell <strong>${clean(brand)} ${clean(model)}</strong>, size ${clean(size)}${row.asking_price ? ', asking PKR ' + row.asking_price.toLocaleString('en-US') : ''}. See the photos and send an offer from the admin panel.`,
            site, link: `${site}/admin.html#sell`
        });
        return res.status(201).json({ request: data });
    }

    if (action === 'sellRespond') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const { id, accept } = getBody(req);
        if (!isUuid(id)) throw new HttpError(400, 'Invalid request.');
        const db = getDb();
        const { data: r, error } = await db.from('sell_requests').select('id, user_uid, status, brand, model, size, name, phone, offer_price').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!r || r.user_uid !== user.uid) throw new HttpError(404, 'Request not found.');
        if (r.status !== 'Offered') throw new HttpError(400, 'There is no open offer on this request.');
        const status = accept ? 'Accepted' : 'Declined';
        const { data, error: upError } = await db.from('sell_requests').update({ status, updated_at: new Date().toISOString() }).eq('id', id).select(SELL_FIELDS).single();
        if (upError) throw upError;
        const site = siteUrl(req);
        const clean = (t) => String(t).replace(/[<>&]/g, '');
        await notifyOwner({
            telegram: `${accept ? '✅' : '❌'} <b>Offer ${accept ? 'accepted' : 'declined'}</b>\n${clean(r.brand)} ${clean(r.model)} • US ${clean(r.size)} • PKR ${Number(r.offer_price || 0).toLocaleString('en-US')}\n👤 ${clean(r.name)} • 📞 ${clean(r.phone)}${accept ? '\nContact them to arrange pickup and payment.' : ''}`,
            subject: `${accept ? '✅ Offer accepted' : '❌ Offer declined'}: ${r.brand} ${r.model}`,
            heading: `Offer ${accept ? 'accepted' : 'declined'}`,
            intro: `${clean(r.name)} ${accept ? 'accepted' : 'declined'} your offer of PKR ${Number(r.offer_price || 0).toLocaleString('en-US')} for ${clean(r.brand)} ${clean(r.model)}.${accept ? ` Call them on ${clean(r.phone)} to arrange pickup and payment.` : ''}`,
            site, link: `${site}/admin.html#sell`
        });
        return res.status(200).json({ request: data });
    }

    throw new HttpError(404, 'Unknown action');
});
