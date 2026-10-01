// Who may use the admin panel:
//   • owners  = emails in ADMIN_EMAILS (everything, incl. settings and staff)
//   • staff   = rows in staff_members, each with ticked permissions
import { HttpError, configError } from './http.js';
import { getUser, adminEmails } from './auth.js';

export const PERMS = {
    orders: 'Orders — see orders, change status, notes, WhatsApp, print labels',
    customers: 'Customers — customer list, block / unblock',
    products: 'Products — add, edit and delete shoes, photos, Instagram story',
    promotions: 'Promotions — coupons, drop countdown, bundle & invite offers',
    messages: 'Messages & waiting list',
    reviews: 'Reviews — approve or hide',
    sell: 'Sell requests',
    blog: 'Blog — write and publish guides',
    stats: 'Sales numbers & visitors (revenue, charts)'
};
export const PERM_KEYS = Object.keys(PERMS);

// Which permission each admin API action needs. Anything not listed = owner only.
const ACTION_PERMS = {
    whoami: 'any', dashboard: 'any', waTemplates: 'any',
    orders: 'orders', orderStatus: 'orders', orderTracking: 'orders', addNote: 'orders', deleteNote: 'orders', confirmSent: 'orders',
    customers: 'customers', blockCustomer: 'customers', unblockCustomer: 'customers',
    products: 'products', saveProduct: 'products', deleteProduct: 'products', deleteImages: 'products', setThumbs: 'products',
    uploadUrl: ['products', 'blog'],
    coupons: 'promotions', saveCoupon: 'promotions', deleteCoupon: 'promotions', drop: 'promotions', saveDrop: 'promotions',
    offers: 'promotions', saveOffers: 'promotions',
    messages: 'messages', messageRead: 'messages', deleteMessage: 'messages',
    waitlist: 'messages', waitlistNotify: 'messages', waitlistMark: 'messages', waitlistDelete: 'messages',
    reviews: 'reviews', reviewStatus: 'reviews', deleteReview: 'reviews',
    sellRequests: 'sell', sellOffer: 'sell', sellStatus: 'sell', deleteSell: 'sell',
    posts: 'blog', savePost: 'blog', deletePost: 'blog', previewPost: 'blog',
    visitors: 'stats'
};

export const can = (member, perm) => member.role === 'owner' || (member.perms || []).includes(perm);

export function requireAction(member, action) {
    const need = ACTION_PERMS[action];
    if (member.role === 'owner' || need === 'any') return;
    const list = need ? [].concat(need) : [];
    if (list.length && list.some(p => can(member, p))) return;
    throw new HttpError(403, need ? "Your staff account doesn't have permission for this. Ask the shop owner." : 'Only the shop owner can do this.');
}

export function cleanPerms(perms) {
    return [...new Set((Array.isArray(perms) ? perms : []).filter(p => PERM_KEYS.includes(p)))];
}

// Replaces getAdmin(): returns { uid, email, name, role, perms }
export async function getMember(req, db) {
    const user = await getUser(req);
    const owners = adminEmails();
    if (owners.length === 0) {
        throw configError(
            'Admin access is not set up: add ADMIN_EMAILS (your admin email) in Vercel → Project → Settings → Environment Variables, then redeploy.'
        );
    }
    let member = null;
    if (user.email && owners.includes(user.email)) {
        member = { ...user, role: 'owner', perms: PERM_KEYS };
    } else if (user.email) {
        const { data, error } = await db.from('staff_members').select('email, name, perms, active').eq('email', user.email).maybeSingle();
        if (!error && data && data.active) member = { ...user, role: 'staff', perms: cleanPerms(data.perms), staffName: data.name || '' };
    }
    if (!member) throw new HttpError(403, 'This account does not have admin access.');
    // Stops anyone from registering an admin/staff email with a password before its owner does
    if (!user.emailVerified) {
        const err = new HttpError(403, 'Please verify your email first — open the verification link we emailed you, then log in again.');
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
    }
    return member;
}
