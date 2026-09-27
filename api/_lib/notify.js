// Order alerts:
//  • Telegram message to the shop owner for every new / cancelled order
//  • Emails (through the shop's Gmail) to the owner and to customers
// Everything is optional — if a setting is missing that channel is simply
// skipped, and a failed alert never breaks an order.
import { getDb } from './db.js';

const TELEGRAM_API = 'https://api.telegram.org';
const SHOP = process.env.SHOP_NAME || 'JENZY THRIFTS';

// Official tracking pages. Customers also get a "copy tracking number" button.
export const COURIERS = {
    'TCS': 'https://www.tcsexpress.com/track/',
    'Leopards': 'https://www.leopardscourier.com/leopards-tracking',
    'PostEx': 'https://postex.pk/tracking',
    'Trax': 'https://sonic.pk/tracking',
    'M&P': 'https://www.mulphilog.com/',
    'Call Courier': 'https://callcourier.com.pk/',
    'BlueEx': 'https://www.blue-ex.com/',
    'Pakistan Post': 'https://ep.gov.pk/',
    'Other': ''
};

export function trackingLink(order) {
    if (!order) return '';
    if (order.tracking_url) return order.tracking_url;
    return COURIERS[order.courier] || '';
}

const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-US');
const orderNo = (n) => 'JT-' + n;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function siteUrl(req) {
    if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '');
    const h = req?.headers || {};
    const host = h['x-forwarded-host'] || h.host || 'jenzy-thrifts.vercel.app';
    const proto = h['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
    return `${proto}://${host}`;
}

// ---------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------
const telegramToken = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim();

async function telegramCall(method, payload) {
    const token = telegramToken();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in Vercel.');
    const res = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(6000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        const msg = data.description || `Telegram error ${res.status}`;
        throw new Error(/unauthorized/i.test(msg) ? 'The Telegram bot token is wrong. Copy it again from @BotFather.' : msg);
    }
    return data.result;
}

export async function readSetting(key) {
    try {
        const { data } = await getDb().from('shop_settings').select('value').eq('key', key).maybeSingle();
        return data?.value || null;
    } catch {
        return null;
    }
}

export async function writeSetting(key, value) {
    const { error } = await getDb().from('shop_settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) {
        if (/shop_settings/.test(error.message || '')) {
            throw new Error('Run the latest supabase-setup.sql in Supabase (SQL Editor) first — the settings table is missing.');
        }
        throw error;
    }
}

async function telegramChatIds() {
    const fromEnv = (process.env.TELEGRAM_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;
    const saved = await readSetting('telegram');
    return Array.isArray(saved?.chats) ? saved.chats.map(c => String(c.id)) : [];
}

async function telegramSend(text) {
    if (!telegramToken()) return 'skipped';
    const chats = await telegramChatIds();
    if (!chats.length) return 'skipped';
    await Promise.all(chats.map(chat_id => telegramCall('sendMessage', {
        chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true
    })));
    return 'sent';
}

// Admin presses "Connect Telegram" after sending /start to their bot.
export async function connectTelegram() {
    const me = await telegramCall('getMe');
    const updates = await telegramCall('getUpdates', { limit: 100, timeout: 0 });
    const chats = new Map();
    for (const u of updates || []) {
        const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
        const chat = m?.chat;
        if (chat && chat.id) {
            chats.set(String(chat.id), {
                id: chat.id,
                name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Chat'
            });
        }
    }
    if (!chats.size) {
        const err = new Error(`Open Telegram, search for @${me.username}, press START (or send "hi"), then click Connect again.`);
        err.status = 400;
        throw err;
    }
    const list = [...chats.values()];
    await writeSetting('telegram', { bot: me.username, chats: list });
    await Promise.all(list.map(c => telegramCall('sendMessage', {
        chat_id: c.id, parse_mode: 'HTML',
        text: `✅ <b>${esc(SHOP)}</b> is connected.\nYou will get a message here for every new order.`
    })));
    return { bot: me.username, chats: list.map(c => c.name) };
}

// ---------------------------------------------------------------------
// Email (Gmail + App Password)
// ---------------------------------------------------------------------
const gmailUser = () => (process.env.GMAIL_USER || '').trim();
const gmailPass = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const emailReady = () => !!(gmailUser() && gmailPass());

function ownerEmails() {
    const list = (process.env.NOTIFY_EMAIL || process.env.ADMIN_EMAILS || '')
        .split(',').map(s => s.trim()).filter(s => s.includes('@'));
    return [...new Set(list)];
}

let transporter = null;
async function mailer() {
    if (globalThis.__JENZY_TEST_MAILER__) return globalThis.__JENZY_TEST_MAILER__;
    if (transporter) return transporter;
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser(), pass: gmailPass() },
        connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000
    });
    return transporter;
}

async function sendEmail({ to, subject, html, text }) {
    if (!emailReady()) return 'skipped';
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return 'skipped';
    const t = await mailer();
    try {
        await t.sendMail({ from: `"${SHOP}" <${gmailUser()}>`, to: recipients.join(', '), subject, html, text });
    } catch (e) {
        if (/535|Username and Password not accepted|Invalid login/i.test(e.message || '')) {
            throw new Error('Gmail refused the login. Check GMAIL_USER and create a new App Password.');
        }
        throw e;
    }
    return 'sent';
}

// ---------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------
function itemsText(order) {
    return (order.items || []).map(i => `• ${i.name}${i.brand ? ' (' + i.brand + ')' : ''} — US ${i.size} — ${pkr(i.price)}`).join('\n');
}

function telegramNewOrder(order, site) {
    const lines = [
        `🛍️ <b>New order ${orderNo(order.order_no)}</b>`,
        `💰 <b>${pkr(order.total)}</b> • Cash on Delivery`,
        '',
        `👤 ${esc(order.customer_name)}`,
        `📞 ${esc(order.phone)}`,
        `📍 ${esc(order.address)}, ${esc(order.city)}`,
        '',
        esc(itemsText(order))
    ];
    if (order.discount) lines.push(`🏷️ Coupon ${esc(order.coupon || '')}: −${pkr(order.discount)}`);
    lines.push(`🚚 Delivery: ${order.delivery_fee ? pkr(order.delivery_fee) : 'Free'}`);
    if (order.notes) lines.push('', `📝 ${esc(order.notes)}`);
    lines.push('', `<a href="${esc(site)}/admin.html#orders">Open admin panel</a>`);
    return lines.join('\n');
}

function emailLayout({ heading, intro, order, extra = '', button, site }) {
    const rows = (order?.items || []).map(i => `
        <tr>
            <td style="padding:10px 0;border-bottom:1px solid #eee;width:64px">${i.image ? `<img src="${esc(i.image)}" width="56" height="56" style="border-radius:8px;object-fit:cover;display:block" alt="">` : ''}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#111"><strong>${esc(i.name)}</strong><br><span style="color:#777;font-size:12px">${esc(i.brand || '')} • Size US ${esc(i.size)}</span></td>
            <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;color:#111">${pkr(i.price)}</td>
        </tr>`).join('');
    const totals = order ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;color:#444">
            <tr><td style="padding:3px 0">Subtotal</td><td align="right">${pkr(order.subtotal)}</td></tr>
            ${order.discount ? `<tr><td style="padding:3px 0">Discount${order.coupon ? ' (' + esc(order.coupon) + ')' : ''}</td><td align="right">− ${pkr(order.discount)}</td></tr>` : ''}
            <tr><td style="padding:3px 0">Delivery</td><td align="right">${order.delivery_fee ? pkr(order.delivery_fee) : 'Free'}</td></tr>
            <tr><td style="padding:8px 0 0;font-size:16px;color:#111"><strong>Total (Cash on Delivery)</strong></td><td align="right" style="padding-top:8px;font-size:16px;color:#111"><strong>${pkr(order.total)}</strong></td></tr>
        </table>
        <p style="font-size:13px;color:#777;margin:18px 0 0">Deliver to: ${esc(order.customer_name)}, ${esc(order.phone)} — ${esc(order.address)}, ${esc(order.city)}</p>` : '';
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
            <tr><td style="background:#0a0a0b;padding:20px 28px;font-size:20px;font-weight:bold;letter-spacing:3px;color:#39ff14">JENZY <span style="color:#aaa;font-size:11px;letter-spacing:4px">THRIFTS</span></td></tr>
            <tr><td style="padding:28px">
                <h1 style="font-size:21px;margin:0 0 10px;color:#111">${heading}</h1>
                <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 18px">${intro}</p>
                ${extra}
                ${rows ? `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>` : ''}
                ${totals}
                ${button ? `<p style="margin:26px 0 4px"><a href="${esc(button.href)}" style="background:#39ff14;color:#0a0a0b;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:10px;display:inline-block">${esc(button.label)}</a></p>` : ''}
            </td></tr>
            <tr><td style="padding:16px 28px;background:#fafafa;font-size:12px;color:#999">${esc(SHOP)} • Authentic thrifted sneakers • <a href="${esc(site)}" style="color:#999">${esc(site.replace(/^https?:\/\//, ''))}</a></td></tr>
        </table>
    </td></tr></table></body></html>`;
}

function trackingBlock(order) {
    if (!order.tracking_no && !order.courier) return '';
    const link = trackingLink(order);
    return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 16px;margin:0 0 18px;font-size:14px;color:#111">
        ${order.courier ? `Courier: <strong>${esc(order.courier)}</strong><br>` : ''}
        ${order.tracking_no ? `Tracking number: <strong style="font-size:16px;letter-spacing:.5px">${esc(order.tracking_no)}</strong><br>` : ''}
        ${link ? `<a href="${esc(link)}" style="color:#15803d;font-weight:bold">Track your parcel →</a>` : ''}
    </div>`;
}

const CUSTOMER_STATUS = {
    Confirmed: {
        subject: (o) => `Order ${orderNo(o.order_no)} confirmed ✅`,
        heading: 'Your order is confirmed',
        intro: (o) => `Hi ${esc(firstName(o))}, we've confirmed your order and we're packing it now. We'll email you again with the tracking number as soon as it ships.`
    },
    Shipped: {
        subject: (o) => `Order ${orderNo(o.order_no)} has shipped 🚚`,
        heading: 'Your order is on the way',
        intro: (o) => `Hi ${esc(firstName(o))}, your order has been handed to the courier. Please keep <strong>${pkr(o.total)}</strong> ready to pay on delivery.`
    },
    Delivered: {
        subject: (o) => `Order ${orderNo(o.order_no)} delivered 🎉`,
        heading: 'Delivered — enjoy your kicks!',
        intro: (o) => `Hi ${esc(firstName(o))}, your order has been delivered. Thank you for shopping with ${esc(SHOP)}! Tag us on Instagram when you wear them.`
    },
    Cancelled: {
        subject: (o) => `Order ${orderNo(o.order_no)} cancelled`,
        heading: 'Your order was cancelled',
        intro: (o) => `Hi ${esc(firstName(o))}, your order ${orderNo(o.order_no)} has been cancelled. If you didn't expect this, just reply to this email or message us on WhatsApp.`
    }
};

function firstName(o) {
    return String(o.customer_name || 'there').trim().split(/\s+/)[0];
}

const customerEmailsOn = () => (process.env.CUSTOMER_EMAILS || 'on').toLowerCase() !== 'off';

// ---------------------------------------------------------------------
// Public events (always resolve — never throw)
// ---------------------------------------------------------------------
async function settle(tasks, label) {
    const results = await Promise.race([
        Promise.allSettled(tasks.map(t => t())),
        new Promise(r => setTimeout(() => r(tasks.map(() => ({ status: 'rejected', reason: new Error('timeout') }))), 9000))
    ]);
    results.forEach(r => { if (r.status === 'rejected') console.error(`[notify:${label}]`, r.reason?.message || r.reason); });
    return results;
}

export function notifyNewOrder(order, site) {
    const text = itemsText(order);
    return settle([
        () => telegramSend(telegramNewOrder(order, site)),
        () => sendEmail({
            to: ownerEmails(),
            subject: `🛍️ New order ${orderNo(order.order_no)} — ${pkr(order.total)} — ${order.customer_name}, ${order.city}`,
            html: emailLayout({
                heading: `New order ${orderNo(order.order_no)}`,
                intro: `${esc(order.customer_name)} (${esc(order.phone)}) ordered ${(order.items || []).length} item(s). Call to confirm, then update it in the admin panel.${order.notes ? `<br><br><em>Note: ${esc(order.notes)}</em>` : ''}`,
                order, site, button: { href: `${site}/admin.html#orders`, label: 'Open admin panel' }
            }),
            text: `New order ${orderNo(order.order_no)} — ${pkr(order.total)}\n${order.customer_name}, ${order.phone}\n${order.address}, ${order.city}\n\n${text}`
        }),
        () => customerEmailsOn() && order.user_email ? sendEmail({
            to: order.user_email,
            subject: `We got your order ${orderNo(order.order_no)} 🛍️`,
            html: emailLayout({
                heading: 'Thank you for your order!',
                intro: `Hi ${esc(firstName(order))}, we received your order <strong>${orderNo(order.order_no)}</strong>. We'll call you on ${esc(order.phone)} to confirm it. You pay cash when it arrives.`,
                order, site, button: { href: `${site}/orders.html`, label: 'Track your order' }
            }),
            text: `Thank you! We received your order ${orderNo(order.order_no)} (${pkr(order.total)}). We'll call you to confirm. Track it at ${site}/orders.html`
        }) : 'skipped'
    ], 'new-order');
}

export function notifyCustomerCancelled(order, site) {
    const msg = `❌ <b>Order ${orderNo(order.order_no)} cancelled by the customer</b>\n${esc(order.customer_name)} • ${esc(order.phone)} • ${pkr(order.total)}\nThe pairs are back in stock.`;
    return settle([
        () => telegramSend(msg),
        () => sendEmail({
            to: ownerEmails(),
            subject: `❌ Order ${orderNo(order.order_no)} cancelled by customer`,
            html: emailLayout({ heading: `Order ${orderNo(order.order_no)} was cancelled`, intro: `${esc(order.customer_name)} cancelled this order from their account. The pairs are back in stock automatically.`, order, site }),
            text: `Order ${orderNo(order.order_no)} was cancelled by ${order.customer_name}. The pairs are back in stock.`
        })
    ], 'customer-cancel');
}

export function notifyStatusChange(order, site) {
    const tpl = CUSTOMER_STATUS[order.status];
    if (!tpl || !customerEmailsOn() || !order.user_email) return Promise.resolve([]);
    return settle([
        () => sendEmail({
            to: order.user_email,
            subject: tpl.subject(order),
            html: emailLayout({
                heading: tpl.heading, intro: tpl.intro(order), site,
                extra: order.status === 'Shipped' ? trackingBlock(order) : '',
                order: order.status === 'Cancelled' ? null : order,
                button: { href: `${site}/orders.html`, label: order.status === 'Shipped' ? 'See order status' : 'View your order' }
            }),
            text: `${tpl.heading} — order ${orderNo(order.order_no)}.${order.tracking_no ? ` Tracking: ${order.courier || ''} ${order.tracking_no}.` : ''} ${site}/orders.html`
        })
    ], 'status');
}

// Status shown in the admin "Order alerts" page
export async function notifyStatus() {
    const saved = telegramToken() ? await readSetting('telegram') : null;
    const envChats = (process.env.TELEGRAM_CHAT_ID || '').split(',').filter(Boolean).length;
    let bot = saved?.bot || null;
    let tokenError = null;
    if (telegramToken() && !bot) {
        try { bot = (await telegramCall('getMe')).username; } catch (e) { tokenError = e.message; }
    }
    return {
        telegram: {
            token: !!telegramToken(),
            tokenError,
            connected: envChats > 0 || !!saved?.chats?.length,
            bot,
            chats: envChats ? [`${envChats} chat(s) from TELEGRAM_CHAT_ID`] : (saved?.chats || []).map(c => c.name)
        },
        email: {
            configured: emailReady(),
            from: gmailUser() || null,
            owner: ownerEmails(),
            customers: customerEmailsOn()
        }
    };
}

export async function sendTestAlert(site, adminEmail) {
    const out = {};
    try {
        out.telegram = await telegramSend(`🔔 <b>Test alert from ${esc(SHOP)}</b>\nOrder alerts are working. 👍`);
    } catch (e) { out.telegram = 'error: ' + e.message; }
    try {
        out.email = await sendEmail({
            to: ownerEmails().length ? ownerEmails() : [adminEmail],
            subject: `🔔 Test alert from ${SHOP}`,
            html: emailLayout({ heading: 'Order alerts are working 👍', intro: 'This is a test email from your admin panel. New orders will arrive like this.', site }),
            text: 'Order alerts are working.'
        });
    } catch (e) { out.email = 'error: ' + e.message; }
    return out;
}

// "Your size is back" emails for the waiting list. Returns { sent, failed, skipped, error }.
export async function notifyRestock(requests, productsById, site) {
    if (!emailReady()) {
        return { sent: [], failed: [], skipped: requests.map(r => r.id), error: 'Gmail is not set up yet (admin → Order Alerts).' };
    }
    const sent = [], failed = [], skipped = [];
    let error = null;
    for (const r of requests) {
        if (!r.email) { skipped.push(r.id); continue; }
        const p = productsById.get(r.product_id);
        const link = r.product_id ? `${site}/shoe/${r.product_id}` : `${site}/index.html#shop`;
        const available = p && p.status === 'Active' && (p.sizes || []).includes(r.size);
        const first = String(r.name || '').trim().split(/\s+/)[0] || 'there';
        const image = p?.images?.[0];
        const card = `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;border:1px solid #eee;border-radius:10px">
                <tr>
                    <td style="padding:12px;width:84px">${image ? `<img src="${esc(image)}" width="72" height="72" style="border-radius:8px;object-fit:cover;display:block" alt="">` : ''}</td>
                    <td style="padding:12px 12px 12px 0;font-size:14px;color:#111"><strong>${esc(r.product_name)}</strong><br>
                        <span style="color:#777;font-size:12px">${esc(r.brand || '')} • Size US ${esc(r.size)}</span>
                        ${p ? `<br><strong style="font-size:15px">${pkr(p.price)}</strong>` : ''}</td>
                </tr>
            </table>`;
        try {
            await sendEmail({
                to: r.email,
                subject: available ? `Size ${r.size} is here: ${r.product_name} 👟` : `Update on your size ${r.size} request — ${r.product_name}`,
                html: emailLayout({
                    heading: available ? `Good news, your size is here!` : `New pairs just landed`,
                    intro: available
                        ? `Hi ${esc(first)}, you asked us to tell you when <strong>size ${esc(r.size)}</strong> arrives. It's in stock right now. Every pair is one of a kind, so grab it before someone else does.`
                        : `Hi ${esc(first)}, you asked about <strong>size ${esc(r.size)}</strong>. We've just added new pairs that may interest you. Take a look.`,
                    extra: card,
                    button: { href: link, label: available ? 'Buy it now' : 'See the shoes' },
                    site
                }),
                text: `Hi ${first}, size ${r.size} of ${r.product_name} ${available ? 'is in stock now' : 'update'}: ${link}`
            });
            sent.push(r.id);
        } catch (e) {
            console.error('[notify:restock]', e.message);
            error = e.message;
            failed.push(r.id);
        }
    }
    return { sent, failed, skipped, error };
}
