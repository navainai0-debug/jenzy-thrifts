// Verifies Firebase login tokens sent by the website
// (Authorization: Bearer <Firebase ID token>).
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, configError } from './http.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'jenzythrifts-c7f90';

// Google's public keys for Firebase ID tokens
const JWKS = createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyToken(token) {
    if (globalThis.__JENZY_TEST_VERIFY__) return globalThis.__JENZY_TEST_VERIFY__(token);
    const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${PROJECT_ID}`,
        audience: PROJECT_ID
    });
    return payload;
}

export async function getUser(req) {
    const header = req.headers.authorization || req.headers.Authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please log in first.');

    let payload;
    try {
        payload = await verifyToken(token);
    } catch (err) {
        throw new HttpError(401, 'Your login has expired. Please log in again.');
    }
    if (!payload || !payload.sub) throw new HttpError(401, 'Please log in first.');

    return {
        uid: payload.sub,
        email: (payload.email || '').toLowerCase(),
        name: payload.name || '',
        emailVerified: !!payload.email_verified,
        provider: payload.firebase?.sign_in_provider || ''
    };
}

export function adminEmails() {
    return (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
}

export async function getAdmin(req) {
    const user = await getUser(req);
    const admins = adminEmails();
    if (admins.length === 0) {
        throw configError(
            'Admin access is not set up: add ADMIN_EMAILS (your admin email) in Vercel → Project → Settings → Environment Variables, then redeploy.'
        );
    }
    if (!user.email || !admins.includes(user.email)) {
        throw new HttpError(403, 'This account does not have admin access.');
    }
    // Stops anyone from registering your admin email with a password before you do:
    // Google accounts are always verified; email/password accounts must click the
    // verification link Firebase sends.
    if (!user.emailVerified) {
        const err = new HttpError(403, 'Please verify your admin email first — open the verification link we emailed you, then log in again.');
        err.code = 'EMAIL_NOT_VERIFIED';
        throw err;
    }
    return user;
}
