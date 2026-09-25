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
//   POST ?action=orderStatus         { id, status }
//   GET  ?action=messages
//   POST ?action=messageRead         { id, read }
//   POST ?action=deleteMessage       { id }
import { route, getBody, getQuery, HttpError, requireMethod } from './_lib/http.js';
import { getDb, BUCKET } from './_lib/db.js';
import { getAdmin } from './_lib/auth.js';
import { isUuid } from './_lib/shop.js';

const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
const PRODUCT_STATUSES = ['Active', 'Draft', 'Sold'];
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
        updated_at: new Date().toISOString()
    };
}

function storagePath(url) {
    const m = String(url || '').match(new RegExp(`/${BUCKET}/(shoes/[^?#]+)`));
    return m ? decodeURIComponent(m[1]) : null;
}

async function dashboard(db) {
    const [productsRes, ordersRes, messagesRes] = await Promise.all([
        db.from('products').select('id, name, brand, price, sizes, status, images, created_at').order('created_at', { ascending: false }),
        db.from('orders')
            .select('id, order_no, created_at, customer_name, phone, city, total, status, user_uid, items')
            .order('created_at', { ascending: false })
            .limit(5000),
        db.from('messages').select('id', { count: 'exact', head: true }).eq('is_read', false)
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
            unreadMessages: messagesRes.count || 0
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
            if (id) {
                if (!isUuid(id)) throw new HttpError(400, 'Invalid product id.');
                result = await db.from('products').update(clean).eq('id', id).select().single();
            } else {
                result = await db.from('products').insert([clean]).select().single();
            }
            if (result.error) throw result.error;
            return res.status(200).json({ product: result.data });
        }

        case 'deleteProduct': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid product id.');
            const { data: p, error } = await db.from('products').select('id, images').eq('id', id).maybeSingle();
            if (error) throw error;
            if (!p) throw new HttpError(404, 'Product not found.');
            const paths = (p.images || []).map(storagePath).filter(Boolean);
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
            const { id, status: newStatus } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid order id.');
            if (!STATUSES.includes(newStatus)) throw new HttpError(400, 'Invalid status.');
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
            return res.status(200).json({ order: Array.isArray(data) ? data[0] : data });
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

        default:
            throw new HttpError(404, 'Unknown action');
    }
});
