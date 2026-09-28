// "You left something in your cart" emails (run once a day by api/cron.js,
// or from Admin → Order Alerts → "Send cart reminders now").
//
// Who gets one: logged-in customers whose cart was last changed between
// 20 hours and 7 days ago, who were not reminded since that change, who
// have not ordered in the last day, and whose shoes are still available.
import { readSetting, emailReady, customerEmailsOn, emailCartReminder } from './notify.js';

const HOUR = 3600 * 1000;

export async function runCartReminders(db, site, { max = 50 } = {}) {
    const out = { checked: 0, sent: 0, skipped: 0, failed: 0, error: null };
    const settings = (await readSetting('emails')) || {};
    if (settings.cartReminder === false) return { ...out, error: 'Cart reminder emails are switched off.' };
    if (!emailReady()) return { ...out, error: 'Gmail is not set up yet (admin → Order Alerts).' };
    if (!customerEmailsOn()) return { ...out, error: 'Customer emails are switched off (CUSTOMER_EMAILS=off).' };

    const now = Date.now();
    const { data: carts, error } = await db.from('carts').select('*')
        .lte('updated_at', new Date(now - 20 * HOUR).toISOString())
        .gte('updated_at', new Date(now - 7 * 24 * HOUR).toISOString())
        .order('updated_at', { ascending: true })
        .limit(300);
    if (error) {
        if (/carts/.test(error.message || '')) return { ...out, error: 'Run the latest supabase-setup.sql first.' };
        throw error;
    }
    const due = (carts || []).filter(c => c.email && Array.isArray(c.items) && c.items.length &&
        (!c.reminded_at || new Date(c.reminded_at) < new Date(c.updated_at)));
    const markDone = (uid) => db.from('carts').update({ reminded_at: new Date().toISOString() }).eq('user_uid', uid);

    for (const cart of due) {
        if (out.sent >= max) break;
        out.checked++;
        // Ordered recently? Then the cart is probably old news.
        const { count } = await db.from('orders').select('id', { count: 'exact', head: true })
            .eq('user_uid', cart.user_uid).gte('created_at', new Date(now - 24 * HOUR).toISOString());
        if (count) { out.skipped++; await markDone(cart.user_uid); continue; }

        const ids = [...new Set(cart.items.map(i => i.product_id))];
        const { data: products } = await db.from('products').select('*').in('id', ids);
        const byId = new Map((products || []).map(p => [p.id, p]));
        const items = cart.items
            .map(i => ({ p: byId.get(i.product_id), size: i.size }))
            .filter(x => x.p && x.p.status === 'Active' && (x.p.sizes || []).includes(x.size))
            .map(x => ({ ...x.p, size: x.size }));
        if (!items.length) { out.skipped++; await markDone(cart.user_uid); continue; }

        try {
            await emailCartReminder(cart, items, site);
            out.sent++;
            await markDone(cart.user_uid);
        } catch (e) {
            console.error('[cart-reminder]', e.message);
            out.failed++;
            out.error = e.message;
        }
    }
    return out;
}

// Keep the visitor table small (Supabase free plan = 500 MB)
export async function cleanupPageViews(db, days = 120) {
    const { error } = await db.from('page_views').delete().lt('created_at', new Date(Date.now() - days * 24 * HOUR).toISOString());
    return error ? 'error: ' + error.message : 'ok';
}
