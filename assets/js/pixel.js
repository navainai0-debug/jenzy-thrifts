/* =====================================================================
   JENZY THRIFTS — Meta Pixel (Facebook + Instagram ads)
   ---------------------------------------------------------------------
   The standard Meta snippet sits in the <head> of every page (that is what
   Meta's setup tools scan for). This file adds the ecommerce events on top,
   and loads the base code itself as a fallback if the snippet is missing.

   The store pages then report these standard events automatically:
     PageView          every page
     ViewContent       a shoe page
     AddToCart         added to cart
     AddToWishlist     hearted a shoe
     InitiateCheckout  opened checkout with items
     Purchase          order placed (cash on delivery)

   Everything is safe when no Pixel ID is set: the functions do nothing.
   Owner devices (admin panel sets jenzyNoTrack) are never tracked.
   ===================================================================== */
(function () {
    var CFG = window.JENZY_CONFIG || {};
    var META = CFG.meta || {};
    var ID = String(META.pixelId || '').trim();
    var DEBUG = !!META.debug;
    var VALID_ID = /^\d{6,20}$/.test(ID);
    var CURRENCY = 'PKR';

    function optedOut() {
        try {
            // Set by the admin panel on your own phone / computer so your
            // visits and test orders do not pollute your ad data.
            if (localStorage.getItem('jenzyNoTrack')) return true;
        } catch (e) { /* private mode */ }
        // Local development file:// or localhost never sends data
        if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(location.hostname)) return true;
        return false;
    }

    var active = VALID_ID && !optedOut();

    function log(event, data) {
        if (!DEBUG) return;
        try { console.info('[Meta Pixel]', event, data); } catch (e) { /* ignore */ }
    }

    // remove empty values so Meta never receives null / undefined params
    function clean(params) {
        var out = {};
        if (!params) return out;
        Object.keys(params).forEach(function (k) {
            var v = params[k];
            if (v === undefined || v === null || v === '') return;
            if (typeof v === 'function') return;
            out[k] = v;
        });
        return out;
    }

    function standard(event, params, options) {
        if (!active) { log(event, params); return; }
        var data = clean(params);
        if (data.value !== undefined) data.value = Math.max(0, Math.round(Number(data.value) || 0));
        if (!data.currency) data.currency = CURRENCY;
        try {
            if (options && options.eventID) {
                window.fbq('track', event, data, { eventID: String(options.eventID) });
            } else {
                window.fbq('track', event, data);
            }
        } catch (e) { /* never break the page */ }
        log(event, data);
    }

    function custom(name, params) {
        if (!active) { log(name, params); return; }
        try { window.fbq('trackCustom', name, clean(params)); } catch (e) { /* ignore */ }
        log(name, params);
    }

    // SHA-256 of the value, hex. Meta lets you send hashed customer data
    // (advanced matching) and we NEVER send a raw email or phone number.
    function sha256(value) {
        var v = String(value || '').trim().toLowerCase();
        if (!v || !window.crypto || !window.crypto.subtle) return Promise.resolve('');
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)).then(function (buf) {
            var bytes = new Uint8Array(buf), hex = '';
            for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
            return hex;
        }).catch(function () { return ''; });
    }

    // 03001234567 / +92 300 1234567  →  923001234567
    function normalizePhone(phone) {
        var d = String(phone || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('92') === 0) return d;
        if (d.indexOf('0') === 0) return '92' + d.slice(1);
        return d;
    }

    var lastUserKey = '';
    function identify(user) {
        if (!active || !META.advancedMatching || !user) return;
        var email = user.email || '';
        var phone = user.phone || '';
        var externalId = user.externalId || '';
        var key = [email, phone, externalId].filter(Boolean).join('|');
        if (!key || key === lastUserKey) return;
        lastUserKey = key;
        Promise.all([sha256(email), sha256(normalizePhone(phone)), sha256(externalId)]).then(function (h) {
            var data = {};
            if (h[0]) data.em = h[0];
            if (h[1]) data.ph = h[1];
            if (h[2]) data.external_id = h[2];
            if (!Object.keys(data).length) return;
            try { window.fbq('init', ID, data); } catch (e) { /* ignore */ }
            log('Advanced matching', Object.keys(data).join(', '));
        }).catch(function () { /* ignore */ });
    }

    // Public API used by store.js, product.html, checkout.html and orders.html
    window.JenzyPixel = {
        active: active,
        id: active ? ID : null,
        currency: CURRENCY,
        track: standard,
        custom: custom,
        identify: identify
    };

    if (!active) {
        if (DEBUG) {
            console.info(VALID_ID
                ? '[Meta Pixel] off on this device (jenzyNoTrack / localhost).'
                : '[Meta Pixel] no Pixel ID yet — add it in assets/js/config.js → meta.pixelId, then redeploy.');
        }
        return;
    }

    // ---------- Meta base code (fallback only) ----------
    // The standard snippet is already written in the <head> of every page, because
    // Meta's setup tools only look for the pixel in the page source. This block
    // runs only if that snippet is missing, so the pixel is never loaded twice.
    if (typeof window.fbq !== 'function') {
        /* eslint-disable */
        !function (f, b, e, v, n, t, s) {
            if (f.fbq) return;
            n = f.fbq = function () {
                n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
            };
            if (!f._fbq) f._fbq = n;
            n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
            t = b.createElement(e); t.async = !0; t.src = v;
            s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
        }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        /* eslint-enable */

        window.fbq('init', ID);
        window.fbq('track', 'PageView');
        log('PageView (loaded by fallback)', { page: location.pathname });
    }

    // Logged-in customers already loaded on the page (Firebase restores the
    // session a moment later — store.js calls identify() again then).
    var auth = null;
    try { auth = window.firebase && firebase.auth ? firebase.auth() : null; } catch (e) { auth = null; }
    if (auth) {
        auth.onAuthStateChanged(function (user) {
            if (user) identify({ email: user.email, externalId: user.uid });
        });
    }
})();
