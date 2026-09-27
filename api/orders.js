// /api/orders — customer ordering
//   GET  ?action=config   delivery fee etc. (public)
//   POST ?action=quote    live prices, availability and totals for a cart (public)
//   POST ?action=place    place a Cash-on-Delivery order (login required)
//   GET  ?action=mine     the logged-in customer's orders
//   POST ?action=cancel   cancel own order while it is still Pending
//   POST ?action=notify   "tell me when size X arrives" (login required)
import { route, getBody, getQuery, HttpError, requireMethod } from './_lib/http.js';
import { getDb } from './_lib/db.js';
import { getUser } from './_lib/auth.js';
import {
    shopConfig, computeTotals, findCoupon, validateItems, validateCustomer,
    isUuid, orderErrorMessage
} from './_lib/shop.js';
import { notifyNewOrder, notifyCustomerCancelled, siteUrl, trackingLink } from './_lib/notify.js';

const PUBLIC_ORDER_FIELDS =
    'id, order_no, created_at, updated_at, customer_name, phone, address, city, notes, payment_method, items, subtotal, discount, coupon, delivery_fee, total, status, status_history, courier, tracking_no, tracking_url';

async function quote(body) {
    const cfg = shopConfig();
    const items = validateItems(body.items);
    const db = getDb();
    const ids = [...new Set(items.map(i => i.product_id))];
    const { data, error } = await db
        .from('products')
        .select('id, name, brand, price, original_price, sizes, status, images')
        .in('id', ids);
    if (error) throw error;

    const byId = new Map((data || []).map(p => [p.id, p]));
    let subtotal = 0;
    const lines = items.map(it => {
        const p = byId.get(it.product_id);
        if (!p || p.status !== 'Active') {
            return { ...it, available: false, reason: 'Sold out', name: p?.name || 'Item', brand: p?.brand || '', price: p?.price || 0, image: p?.images?.[0] || '' };
        }
        if (!(p.sizes || []).includes(it.size)) {
            return { ...it, available: false, reason: `Size ${it.size} sold out`, name: p.name, brand: p.brand, price: p.price, image: p.images?.[0] || '' };
        }
        subtotal += p.price;
        return { ...it, available: true, name: p.name, brand: p.brand, price: p.price, original_price: p.original_price || 0, image: p.images?.[0] || '' };
    });

    let coupon = { code: null, percent: 0 };
    let couponError = null;
    try {
        coupon = await findCoupon(db, body.coupon, subtotal);
    } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        couponError = e.message;
    }

    return {
        items: lines,
        coupon: coupon.code,
        couponPercent: coupon.percent,
        couponError,
        ...computeTotals(subtotal, coupon.percent, cfg),
        freeDeliveryMin: cfg.freeDeliveryMin,
        allAvailable: lines.every(l => l.available)
    };
}

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
        return res.status(200).json(await quote(getBody(req)));
    }

    if (action === 'place') {
        requireMethod(req, 'POST');
        const user = await getUser(req);
        const body = getBody(req);
        const cfg = shopConfig();
        const items = validateItems(body.items);
        const customer = validateCustomer(body.customer);
        const db = getDb();
        const coupon = await findCoupon(db, body.coupon);

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
        // Telegram / email alerts (never block or break the order)
        await notifyNewOrder({ ...order, user_email: order.user_email || user.email || null }, siteUrl(req));
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
        return res.status(200).json({ orders });
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

    throw new HttpError(404, 'Unknown action');
});
