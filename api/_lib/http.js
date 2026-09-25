// Small helpers shared by the API routes.

export class HttpError extends Error {
    constructor(status, message, { expose = true } = {}) {
        super(message);
        this.status = status;
        this.expose = expose;
    }
}

// Errors caused by missing Vercel settings — always shown so they are easy to fix.
export function configError(message) {
    return new HttpError(500, message, { expose: true });
}

export function getBody(req) {
    if (!req.body) return {};
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'Invalid JSON body'); }
    }
    return req.body;
}

export function getQuery(req) {
    if (req.query) return req.query;
    const url = new URL(req.url, 'http://localhost');
    return Object.fromEntries(url.searchParams.entries());
}

// Wraps a route: JSON errors, no caching.
export function route(fn) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            await fn(req, res);
        } catch (err) {
            const status = err.status || 500;
            if (status >= 500) console.error('[api error]', err);
            const message = err.expose || status < 500
                ? err.message
                : 'Something went wrong on our side. Please try again.';
            res.status(status).json(err.code && status < 500 ? { error: message, code: err.code } : { error: message });
        }
    };
}

export function requireMethod(req, method) {
    if (req.method !== method) throw new HttpError(405, `Use ${method} for this action`);
}
