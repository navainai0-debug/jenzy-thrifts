// Order alerts:
//  • Telegram message to the shop owner for every new / cancelled order
//  • Emails (through the shop's Zoho Mail / Gmail) to the owner and to customers
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
// Email — your own domain (Zoho Mail or any SMTP) or Gmail + App Password
//   Own domain: SMTP_USER + SMTP_PASS (+ SMTP_HOST, default smtp.zoho.com)
//   Gmail:      GMAIL_USER + GMAIL_APP_PASSWORD (used when SMTP_* is not set)
//   EMAIL_REPLY_TO: where customers' replies go (e.g. support@yourdomain)
// ---------------------------------------------------------------------
const env = (k) => (process.env[k] || '').trim();
const smtpUser = () => env('SMTP_USER');
const smtpPass = () => env('SMTP_PASS');
const smtpOn = () => !!(smtpUser() && smtpPass());
const gmailUser = () => env('GMAIL_USER');
const gmailPass = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const gmailOn = () => !!(gmailUser() && gmailPass());
export const emailReady = () => smtpOn() || gmailOn();
const emailProvider = () => smtpOn() ? (/zoho/i.test(smtpHost()) ? 'Zoho Mail' : /brevo|sendinblue/i.test(smtpHost()) ? 'Brevo' : 'SMTP') : gmailOn() ? 'Gmail' : null;
function smtpHost() { return env('SMTP_HOST') || 'smtp.zoho.com'; }
const isEmail = (s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s || '');
// Zoho/Gmail only send "from" the account you log in with (or its verified alias)
const fromAddress = () => {
    const f = env('EMAIL_FROM');
    return isEmail(f) ? f : (smtpOn() ? smtpUser() : gmailUser());
};
const replyTo = () => {
    const r = env('EMAIL_REPLY_TO');
    return isEmail(r) && r.toLowerCase() !== fromAddress().toLowerCase() ? r : '';
};

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
    const timeouts = { connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 8000 };
    if (smtpOn()) {
        const port = parseInt(env('SMTP_PORT'), 10) || 465;
        transporter = nodemailer.createTransport({
            host: smtpHost(), port, secure: port === 465,
            auth: { user: smtpUser(), pass: smtpPass() },
            ...timeouts
        });
    } else {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser(), pass: gmailPass() },
            ...timeouts
        });
    }
    return transporter;
}

async function sendEmail({ to, subject, html, text }) {
    if (!emailReady()) return 'skipped';
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return 'skipped';
    const t = await mailer();
    try {
        const msg = { from: `"${SHOP}" <${fromAddress()}>`, to: recipients.join(', '), subject, html, text };
        if (replyTo()) msg.replyTo = replyTo();
        await t.sendMail(msg);
    } catch (e) {
        const m = e.message || '';
        if (smtpOn()) {
            if (/535|authentication failed|Invalid login|AUTH/i.test(m)) {
                throw new Error(emailProvider() === 'Brevo'
                    ? `Brevo refused the login for ${smtpUser()}. SMTP_USER must be the SMTP login shown in Brevo → SMTP & API, and SMTP_PASS an SMTP key (not your Brevo password).`
                    : `${emailProvider()} refused the login for ${smtpUser()}. Check SMTP_PASS (use an app-specific password if 2-factor login is on) and that SMTP access is allowed on your plan.`);
            }
            if (/553|sender|relaying|not allowed to send/i.test(m)) {
                throw new Error(emailProvider() === 'Brevo'
                    ? `Brevo would not send from ${fromAddress()}. Add and verify jenzythrifts.com (or this address) in Brevo → Senders, Domains.`
                    : `${emailProvider()} would not send from ${fromAddress()}. EMAIL_FROM must be ${smtpUser()} or one of its aliases.`);
            }
            if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) {
                throw new Error(`Could not reach ${smtpHost()}. Check SMTP_HOST (Brevo: smtp-relay.brevo.com with SMTP_PORT 587 · Zoho: smtp.zoho.com / .in / .eu).`);
            }
        } else if (/535|Username and Password not accepted|Invalid login/i.test(m)) {
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
    return (order.items || []).map(i => `• ${i.name}${i.brand ? ' (' + i.brand + ')' : ''} — UK ${i.size} — ${pkr(i.price)}`).join('\n');
}

// "Coupon ABC", "Buy 2+ deal", "Invite code ALIKH123", "Invite credit"
export function discountName(order) {
    const t = order?.discount_type || (order?.coupon ? 'coupon' : null);
    if (t === 'bundle') return 'Bundle deal';
    if (t === 'referral') return `Invite code ${order.coupon || ''}`.trim();
    if (t === 'credit') return 'Invite credit';
    return order?.coupon ? `Coupon ${order.coupon}` : 'Discount';
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
    if (order.discount) lines.push(`🏷️ ${esc(discountName(order))}: −${pkr(order.discount)}`);
    lines.push(`🚚 Delivery: ${order.delivery_fee ? pkr(order.delivery_fee) : 'Free'}`);
    if (order.notes) lines.push('', `📝 ${esc(order.notes)}`);
    if (order.location && Number.isFinite(order.location.lat)) lines.push(`🗺️ <a href="https://www.google.com/maps?q=${order.location.lat},${order.location.lng}">Customer's map pin</a>`);
    if (order.risk) {
        const icon = { high: '🔴', medium: '🟠', low: '🟢' }[order.risk.level] || '⚪';
        const warn = (order.risk.flags || []).filter(f => f.tone === 'bad' || f.tone === 'warn').map(f => f.text);
        lines.push('', `${icon} <b>Risk: ${esc(order.risk.level.toUpperCase())}</b>${warn.length ? '\n' + warn.map(t => '• ' + esc(t)).join('\n') : ''}`);
        lines.push('📲 Send the WhatsApp confirmation from the admin panel.');
    }
    lines.push('', `<a href="${esc(site)}/admin.html#orders">Open admin panel</a>`);
    return lines.join('\n');
}

function emailLayout({ heading, intro, order, extra = '', button, site }) {
    const rows = (order?.items || []).map(i => `
        <tr>
            <td style="padding:10px 0;border-bottom:1px solid #eee;width:64px">${i.image ? `<img src="${esc(i.image)}" width="56" height="56" style="border-radius:8px;object-fit:cover;display:block" alt="">` : ''}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #eee;font-size:14px;color:#111"><strong>${esc(i.name)}</strong><br><span style="color:#777;font-size:12px">${esc(i.brand || '')} • Size UK ${esc(i.size)}</span></td>
            <td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;white-space:nowrap;color:#111">${pkr(i.price)}</td>
        </tr>`).join('');
    const totals = order ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;font-size:14px;color:#444">
            <tr><td style="padding:3px 0">Subtotal</td><td align="right">${pkr(order.subtotal)}</td></tr>
            ${order.discount ? `<tr><td style="padding:3px 0">Discount (${esc(discountName(order))})</td><td align="right">− ${pkr(order.discount)}</td></tr>` : ''}
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

export const customerEmailsOn = () => (process.env.CUSTOMER_EMAILS || 'on').toLowerCase() !== 'off';

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
            provider: emailProvider(),
            from: emailReady() ? fromAddress() : null,
            replyTo: emailReady() ? (replyTo() || null) : null,
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
        return { sent: [], failed: [], skipped: requests.map(r => r.id), error: 'Email is not set up yet (admin → Order Alerts).' };
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
                        <span style="color:#777;font-size:12px">${esc(r.brand || '')} • Size UK ${esc(r.size)}</span>
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

// ---------------------------------------------------------------------
// Short alerts to the owner (new review, new "sell us your sneakers" request)
// ---------------------------------------------------------------------
export function notifyOwner({ telegram, subject, heading, intro, site, link }) {
    return settle([
        () => telegramSend(telegram + (link ? `\n\n<a href="${esc(link)}">Open admin panel</a>` : '')),
        () => sendEmail({
            to: ownerEmails(), subject,
            html: emailLayout({ heading: esc(heading), intro, site, button: link ? { href: link, label: 'Open admin panel' } : null }),
            text: `${heading}\n${String(intro).replace(/<[^>]+>/g, '')}${link ? '\n' + link : ''}`
        })
    ], 'owner');
}

function shoeCard(p, { price, oldPrice } = {}) {
    const image = p.thumbs?.[0] || p.images?.[0];
    return `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border:1px solid #eee;border-radius:10px">
            <tr>
                <td style="padding:12px;width:84px">${image ? `<img src="${esc(image)}" width="72" height="72" style="border-radius:8px;object-fit:cover;display:block" alt="">` : ''}</td>
                <td style="padding:12px 12px 12px 0;font-size:14px;color:#111"><strong>${esc(p.name)}</strong><br>
                    <span style="color:#777;font-size:12px">${esc(p.brand || '')}${p.size ? ' • Size UK ' + esc(p.size) : ''}</span><br>
                    ${oldPrice ? `<span style="color:#999;text-decoration:line-through;font-size:13px">${pkr(oldPrice)}</span> ` : ''}<strong style="font-size:15px;color:${oldPrice ? '#15803d' : '#111'}">${pkr(price ?? p.price)}</strong></td>
            </tr>
        </table>`;
}

const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// "The shoe on your wishlist is now cheaper" — rows: [{user_uid, email, name}]
export async function emailPriceDrop(rows, product, oldPrice, site) {
    const sent = [], failed = [];
    let error = null;
    if (!emailReady()) return { sent, failed, error: 'Email is not set up yet (admin → Order Alerts).' };
    const link = `${site}/shoe/${product.id}`;
    const saved = oldPrice - product.price;
    for (const r of rows) {
        if (!r.email) continue;
        try {
            await sendEmail({
                to: r.email,
                subject: `Price drop 🔻 ${product.name} is now ${pkr(product.price)}`,
                html: emailLayout({
                    heading: 'A shoe on your wishlist just got cheaper',
                    intro: `Hi ${esc(firstOf(r.name))}, good news: <strong>${esc(product.name)}</strong> dropped by <strong>${pkr(saved)}</strong>. Every pair is one of a kind, so it won't wait long.`,
                    extra: shoeCard(product, { price: product.price, oldPrice }),
                    button: { href: link, label: 'Buy it now' },
                    site
                }),
                text: `${product.name} is now ${pkr(product.price)} (was ${pkr(oldPrice)}): ${link}`
            });
            sent.push(r.user_uid);
        } catch (e) {
            console.error('[notify:price-drop]', e.message);
            error = e.message;
            failed.push(r.user_uid);
        }
    }
    return { sent, failed, error };
}

// "You left something in your cart" — items: [{...product, size}]
export async function emailCartReminder(cart, items, site) {
    if (!emailReady()) throw new Error('Email is not set up yet (admin → Order Alerts).');
    const total = items.reduce((s, p) => s + (p.price || 0), 0);
    await sendEmail({
        to: cart.email,
        subject: items.length > 1 ? `Your ${items.length} pairs are still waiting 👟` : `Still thinking about the ${items[0].name}? 👟`,
        html: emailLayout({
            heading: 'You left something in your cart',
            intro: `Hi ${esc(firstOf(cart.name))}, the ${items.length > 1 ? 'shoes' : 'shoe'} you picked ${items.length > 1 ? 'are' : 'is'} still available, but every pair is one of a kind and someone else could buy ${items.length > 1 ? 'them' : 'it'} first. Cash on delivery, no advance payment.`,
            extra: items.map(p => shoeCard(p)).join('') + `<p style="font-size:14px;color:#444;margin:10px 0 0">Total: <strong>${pkr(total)}</strong></p>`,
            button: { href: `${site}/checkout.html`, label: 'Finish my order' },
            site
        }),
        text: `Hi ${firstOf(cart.name)}, your cart is still waiting: ${items.map(p => p.name + ' (UK ' + p.size + ')').join(', ')}. Finish your order: ${site}/checkout.html`
    });
}

// Our offer for a "sell us your sneakers" request
export async function emailSellOffer(req, site) {
    if (!emailReady()) throw new Error('Email is not set up yet (admin → Order Alerts).');
    if (!req.email) throw new Error('This customer has no email address.');
    await sendEmail({
        to: req.email,
        subject: `Our offer for your ${req.brand} ${req.model}: ${pkr(req.offer_price)}`,
        html: emailLayout({
            heading: `We'd like to buy your ${esc(req.brand)} ${esc(req.model)}`,
            intro: `Hi ${esc(firstOf(req.name))}, thanks for sending us your pair (size ${esc(req.size)}). Our offer is <strong style="font-size:17px">${pkr(req.offer_price)}</strong>.${req.offer_note ? `<br><br>${esc(req.offer_note)}` : ''}<br><br>Open your requests page to accept or decline. We'll then contact you about pickup and payment.`,
            button: { href: `${site}/sell.html`, label: 'Accept or decline' },
            site
        }),
        text: `Our offer for your ${req.brand} ${req.model}: ${pkr(req.offer_price)}. Accept or decline at ${site}/sell.html`
    });
}
