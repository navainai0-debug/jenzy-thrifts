// /api/cron — runs once a day (see "crons" in vercel.json):
//   • cart reminder emails
//   • deletes visitor stats older than 120 days
// Optional: set CRON_SECRET in Vercel so nobody else can trigger it
// (Vercel then sends it automatically as "Authorization: Bearer <secret>").
import { route, HttpError } from './_lib/http.js';
import { getDb } from './_lib/db.js';
import { siteUrl } from './_lib/notify.js';
import { runCartReminders, cleanupPageViews } from './_lib/reminders.js';

export default route(async (req, res) => {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = req.headers.authorization || '';
    const ua = String(req.headers['user-agent'] || '');
    if (secret ? auth !== `Bearer ${secret}` : !/vercel-cron/i.test(ua)) {
        throw new HttpError(401, 'Not allowed');
    }
    const db = getDb();
    const reminders = await runCartReminders(db, siteUrl(req));
    const cleanup = await cleanupPageViews(db);
    console.log('[cron]', JSON.stringify({ reminders, cleanup }));
    return res.status(200).json({ reminders, cleanup });
});
