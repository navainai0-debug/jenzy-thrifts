// Admin actions added in batch 3: customers & blocking, private order notes,
// WhatsApp messages + confirmation link, order safety settings, staff
// accounts and the blog. Called from /api/admin (permissions checked there).
import { getBody, HttpError, requireMethod } from './http.js';
import { isUuid } from './shop.js';
import { readSetting, writeSetting } from './notify.js';
import {
    normPhone, phoneKey, cleanSafety, cleanTemplates, DEFAULT_WA_TEMPLATES, DEFAULT_SAFETY,
    loadBlocked, buildCustomers, PK_CITIES
} from './safety.js';
import { PERMS, cleanPerms } from './staff.js';
import { adminEmails as adminOwnerEmails } from './auth.js';
import { sanitizePost, ensureStarterPosts } from './content.js';
import { renderMarkdown, slugify } from './markdown.js';

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const needSql = (error, what) => {
    const msg = error?.message || '';
    if (/does not exist|Could not find|schema cache/i.test(msg) && new RegExp(what).test(msg)) {
        return new HttpError(400, 'Run the latest supabase-setup.sql in Supabase (SQL Editor) first — this feature needs the new tables.');
    }
    return error;
};

export const MORE_ACTIONS = new Set([
    'waTemplates', 'saveWaTemplates', 'saveSafety', 'addNote', 'deleteNote', 'confirmSent',
    'customers', 'blockCustomer', 'unblockCustomer', 'staff', 'saveStaff', 'deleteStaff',
    'posts', 'savePost', 'deletePost', 'previewPost'
]);

export async function handleMore(action, req, res, db, member) {
    switch (action) {
        // ---------- WhatsApp messages + safety settings ----------
        case 'waTemplates': {
            requireMethod(req, 'GET');
            const saved = await readSetting('wa_templates');
            const safety = cleanSafety((await readSetting('safety')) || DEFAULT_SAFETY);
            return res.status(200).json({
                templates: Array.isArray(saved?.list) && saved.list.length ? saved.list : DEFAULT_WA_TEMPLATES,
                defaults: DEFAULT_WA_TEMPLATES, safety, cities: PK_CITIES
            });
        }
        case 'saveWaTemplates': {
            requireMethod(req, 'POST');
            const list = cleanTemplates(getBody(req).templates);
            try { await writeSetting('wa_templates', { list }); } catch (e) { throw new HttpError(400, e.message); }
            return res.status(200).json({ templates: list });
        }
        case 'saveSafety': {
            requireMethod(req, 'POST');
            const safety = cleanSafety(getBody(req).safety);
            try { await writeSetting('safety', safety); } catch (e) { throw new HttpError(400, e.message); }
            return res.status(200).json({ safety });
        }

        // ---------- Private order notes ----------
        case 'addNote': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            const text = String(getBody(req).text ?? '').replace(/\r/g, '').trim().slice(0, 1000);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid order id.');
            if (!text) throw new HttpError(400, 'Write a note first.');
            const { data: o, error } = await db.from('orders').select('id, admin_notes').eq('id', id).maybeSingle();
            if (error) throw needSql(error, 'admin_notes');
            if (!o) throw new HttpError(404, 'Order not found.');
            const notes = [...(o.admin_notes || []), { text, by: member.email, at: new Date().toISOString() }].slice(-100);
            const up = await db.from('orders').update({ admin_notes: notes }).eq('id', id).select('id, admin_notes').single();
            if (up.error) throw needSql(up.error, 'admin_notes');
            return res.status(200).json({ notes: up.data.admin_notes });
        }
        case 'deleteNote': {
            requireMethod(req, 'POST');
            const { id, at } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid order id.');
            const { data: o, error } = await db.from('orders').select('id, admin_notes').eq('id', id).maybeSingle();
            if (error) throw needSql(error, 'admin_notes');
            if (!o) throw new HttpError(404, 'Order not found.');
            const note = (o.admin_notes || []).find(n => n.at === at);
            if (!note) throw new HttpError(404, 'Note not found.');
            if (member.role !== 'owner' && note.by !== member.email) throw new HttpError(403, 'You can only delete your own notes.');
            const notes = (o.admin_notes || []).filter(n => n.at !== at);
            const up = await db.from('orders').update({ admin_notes: notes }).eq('id', id).select('id, admin_notes').single();
            if (up.error) throw up.error;
            return res.status(200).json({ notes: up.data.admin_notes });
        }

        // ---------- WhatsApp confirmation link was sent ----------
        case 'confirmSent': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid order id.');
            const at = new Date().toISOString();
            const { data, error } = await db.from('orders').update({ confirm_sent_at: at }).eq('id', id).select('id, confirm_sent_at').maybeSingle();
            if (error) throw needSql(error, 'confirm_sent_at');
            if (!data) throw new HttpError(404, 'Order not found.');
            return res.status(200).json({ confirm_sent_at: data.confirm_sent_at });
        }

        // ---------- Customers ----------
        case 'customers': {
            requireMethod(req, 'GET');
            let r = await db.from('orders')
                .select('id, order_no, created_at, user_uid, user_email, customer_name, phone, city, total, status, customer_confirmed_at')
                .order('created_at', { ascending: false }).limit(5000);
            if (r.error && /customer_confirmed_at/.test(r.error.message || '')) {
                r = await db.from('orders').select('id, order_no, created_at, user_uid, user_email, customer_name, phone, city, total, status')
                    .order('created_at', { ascending: false }).limit(5000);
            }
            if (r.error) throw r.error;
            const blocked = await loadBlocked(db);
            return res.status(200).json({
                customers: buildCustomers(r.data || [], blocked.list),
                blocked: blocked.list, needsSql: blocked.missing
            });
        }
        case 'blockCustomer': {
            requireMethod(req, 'POST');
            const b = getBody(req);
            const phone = b.phone ? (normPhone(b.phone) || phoneKey(b.phone)) : null;
            const row = {
                phone, user_uid: str(b.uid, 128) || null, email: str(b.email, 200).toLowerCase() || null,
                name: str(b.name, 80) || null, reason: str(b.reason, 300) || null, blocked_by: member.email
            };
            if (!row.phone && !row.user_uid && !row.email) throw new HttpError(400, 'Nothing to block — choose a phone or customer.');
            // also block every phone this account used
            const rows = [row];
            if (row.user_uid && Array.isArray(b.phones)) {
                for (const p of b.phones.slice(0, 10)) {
                    const n = normPhone(p) || phoneKey(p);
                    if (n && n !== row.phone) rows.push({ ...row, phone: n, user_uid: null, email: null });
                }
            }
            const { data, error } = await db.from('blocked_customers').insert(rows).select('*');
            if (error) throw needSql(error, 'blocked_customers');
            return res.status(200).json({ blocked: data });
        }
        case 'unblockCustomer': {
            requireMethod(req, 'POST');
            const b = getBody(req);
            const { list, missing } = await loadBlocked(db);
            if (missing) throw new HttpError(400, 'Run the latest supabase-setup.sql in Supabase (SQL Editor) first.');
            let ids = [];
            if (isUuid(b.id)) ids = [b.id];
            else {
                const phones = new Set((b.phones || []).concat(b.phone || []).map(phoneKey).filter(Boolean));
                ids = list.filter(x => (b.uid && x.user_uid === b.uid) || (b.email && x.email === String(b.email).toLowerCase()) || (x.phone && phones.has(phoneKey(x.phone)))).map(x => x.id);
            }
            if (!ids.length) return res.status(200).json({ removed: 0 });
            const { error } = await db.from('blocked_customers').delete().in('id', ids);
            if (error) throw error;
            return res.status(200).json({ removed: ids.length });
        }

        // ---------- Staff (owner only) ----------
        case 'staff': {
            requireMethod(req, 'GET');
            const { data, error } = await db.from('staff_members').select('*').order('created_at', { ascending: true });
            return res.status(200).json({ staff: error ? [] : data || [], perms: PERMS, owners: adminOwnerEmails(), needsSql: !!error });
        }
        case 'saveStaff': {
            requireMethod(req, 'POST');
            const s = getBody(req).staff || {};
            const email = str(s.email, 200).toLowerCase();
            if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
            if (adminOwnerEmails().includes(email)) throw new HttpError(400, 'This email is already an owner (ADMIN_EMAILS) with full access.');
            const perms = cleanPerms(s.perms);
            if (!perms.length) throw new HttpError(400, 'Tick at least one thing this person may do.');
            const row = { email, name: str(s.name, 60) || null, perms, active: s.active !== false, added_by: member.email, updated_at: new Date().toISOString() };
            const { data, error } = await db.from('staff_members').upsert(row, { onConflict: 'email' }).select('*').single();
            if (error) throw needSql(error, 'staff_members');
            return res.status(200).json({ staff: data });
        }
        case 'deleteStaff': {
            requireMethod(req, 'POST');
            const email = str(getBody(req).email, 200).toLowerCase();
            const { error } = await db.from('staff_members').delete().eq('email', email);
            if (error) throw needSql(error, 'staff_members');
            return res.status(200).json({ ok: true });
        }

        // ---------- Blog ----------
        case 'posts': {
            requireMethod(req, 'GET');
            await ensureStarterPosts(db);
            const { data, error } = await db.from('posts').select('*').order('created_at', { ascending: false }).limit(500);
            if (error) return res.status(200).json({ posts: [], needsSql: true });
            return res.status(200).json({ posts: data || [] });
        }
        case 'savePost': {
            requireMethod(req, 'POST');
            const { id, post } = getBody(req);
            const clean = sanitizePost(post);
            let before = null;
            if (id) {
                if (!isUuid(id)) throw new HttpError(400, 'Invalid post.');
                const b = await db.from('posts').select('id, status, published_at').eq('id', id).maybeSingle();
                if (b.error) throw needSql(b.error, 'posts');
                before = b.data;
                if (!before) throw new HttpError(404, 'Post not found.');
            }
            const now = new Date().toISOString();
            const row = { ...clean, updated_at: now };
            if (clean.status === 'Published' && !before?.published_at) row.published_at = now;
            if (!id) row.author = member.staffName || member.name || member.email;
            const result = id
                ? await db.from('posts').update(row).eq('id', id).select('*').single()
                : await db.from('posts').insert(row).select('*').single();
            if (result.error) {
                if (result.error.code === '23505' || /duplicate|unique/i.test(result.error.message || '')) {
                    throw new HttpError(400, `Another post already uses the web address "/blog/${clean.slug}". Change the slug.`);
                }
                throw needSql(result.error, 'posts');
            }
            return res.status(200).json({ post: result.data });
        }
        case 'deletePost': {
            requireMethod(req, 'POST');
            const { id } = getBody(req);
            if (!isUuid(id)) throw new HttpError(400, 'Invalid post.');
            const { error } = await db.from('posts').delete().eq('id', id);
            if (error) throw needSql(error, 'posts');
            return res.status(200).json({ ok: true });
        }
        case 'previewPost': {
            requireMethod(req, 'POST');
            const body = String(getBody(req).body ?? '').slice(0, 60000);
            return res.status(200).json({ html: renderMarkdown(body), slug: slugify(getBody(req).title || '') });
        }
    }
    throw new HttpError(404, 'Unknown action');
}
