/* =====================================================================
   JENZY THRIFTS — shared store code (header, footer, login, cart, API)
   Loaded on every store page after config.js, Firebase and Supabase.
   ===================================================================== */
(function () {
    const CFG = window.JENZY_CONFIG;
    const SITE = CFG.site;

    // ---------- Init services ----------
    firebase.initializeApp(CFG.firebase);
    const auth = firebase.auth();
    const db = supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);

    // ---------- Helpers ----------
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pkr = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-PK');
    const orderNo = (n) => 'JT-' + n;
    const discountPct = (p) => (p.original_price && p.original_price > p.price) ? Math.round((1 - p.price / p.original_price) * 100) : 0;
    // Short, shareable product links (/shoe/<id>) — they show a photo preview on WhatsApp / Instagram
    const productUrl = (p) => '/shoe/' + encodeURIComponent(p.id || p);
    // src = where the link is shared ('wa' = WhatsApp) — shows up in admin → Visitors
    const shareUrl = (p, src) => location.origin + productUrl(p) + (src ? '?s=' + encodeURIComponent(src) : '');
    const firstImage = (p) => (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800';
    // Small, fast photo for grids and lists (falls back to the full photo)
    const thumb = (p, i = 0) => (p && p.thumbs && p.thumbs[i]) || (p && p.images && p.images[i]) || (i === 0 ? firstImage(p || {}) : '');
    // ★★★★½ as icons
    const stars = (n) => {
        const v = Math.round((Number(n) || 0) * 2) / 2;
        return [1, 2, 3, 4, 5].map(i => `<i class="${v >= i ? 'fas fa-star' : v >= i - 0.5 ? 'fas fa-star-half-stroke' : 'fa-regular fa-star'}"></i>`).join('');
    };
    const sortSizes = (sizes) => [...(sizes || [])].sort((a, b) => (parseFloat(a) || 999) - (parseFloat(b) || 999));
    const qs = (name) => new URLSearchParams(location.search).get(name);
    async function copyText(text, okMessage = 'Link copied') {
        try {
            await navigator.clipboard.writeText(text);
            toast(okMessage);
        } catch {
            window.prompt('Copy this link:', text);
        }
    }
    const GOOGLE_SVG = '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

    // ---------- Layout (header, drawers, modal, footer) ----------
    const page = document.body.dataset.page || '';
    const navLink = (href, label, key) => `<a href="${href}" data-nav="${key}" class="${page === key ? 'active' : ''}">${label}</a>`;

    document.body.insertAdjacentHTML('afterbegin', `
    <div class="announce" id="announceBar"><div class="announce-track"><span>${esc(SITE.announcement)}</span><span aria-hidden="true">${esc(SITE.announcement)}</span></div></div>
    <header class="site-header">
        <div class="container header-inner">
            <div style="display:flex;align-items:center;gap:10px">
                <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu"><i class="fas fa-bars"></i></button>
                <a href="index.html" class="brand" aria-label="JENZY THRIFTS home"><span class="brand-main">JENZY</span><span class="brand-sub">THRIFTS</span></a>
            </div>
            <nav class="main-nav" aria-label="Main">
                ${navLink('index.html', 'Home', 'home')}
                ${navLink('index.html#shop', 'Shop', 'shop')}
                ${navLink('index.html?gender=Men#shop', 'Men', 'men')}
                ${navLink('index.html?gender=Women#shop', 'Women', 'women')}
                ${navLink('index.html#about', 'About', 'about')}
                ${navLink('index.html#contact', 'Contact', 'contact')}
            </nav>
            <div class="header-actions">
                <div id="accountSlot" style="min-width:42px"></div>
                <a class="icon-btn wish-link" id="wishLink" href="wishlist.html" aria-label="Wishlist"><i class="fa-regular fa-heart"></i><span class="cart-count zero" id="wishCount">0</span></a>
                <button class="icon-btn" id="cartBtn" aria-label="Open cart"><i class="fas fa-bag-shopping"></i><span class="cart-count zero" id="cartCount">0</span></button>
            </div>
        </div>
    </header>
    <div class="overlay" id="overlay"></div>
    <aside class="mobile-nav" id="mobileNav" aria-label="Menu">
        <div class="mobile-nav-head">
            <a href="index.html" class="brand"><span class="brand-main">JENZY</span><span class="brand-sub">THRIFTS</span></a>
            <button class="icon-btn" data-close aria-label="Close menu"><i class="fas fa-xmark"></i></button>
        </div>
        <a class="m-link" href="index.html"><i class="fas fa-house"></i>Home</a>
        <a class="m-link" href="index.html#shop"><i class="fas fa-store"></i>Shop All</a>
        <a class="m-link" href="index.html?gender=Men#shop"><i class="fas fa-person"></i>Men</a>
        <a class="m-link" href="index.html?gender=Women#shop"><i class="fas fa-person-dress"></i>Women</a>
        <a class="m-link" href="wishlist.html"><i class="fas fa-heart"></i>Wishlist<span class="m-count" id="wishCountM"></span></a>
        <a class="m-link" href="orders.html"><i class="fas fa-box"></i>My Orders</a>
        <a class="m-link" href="orders.html#invite"><i class="fas fa-gift"></i>Invite friends</a>
        <a class="m-link" href="/brands"><i class="fas fa-tags"></i>Shop by brand</a>
        <a class="m-link" href="/blog"><i class="fas fa-book-open"></i>Guides &amp; tips</a>
        <a class="m-link" href="sell.html"><i class="fas fa-hand-holding-dollar"></i>Sell your sneakers</a>
        <a class="m-link" href="index.html#about"><i class="fas fa-circle-info"></i>About</a>
        <a class="m-link" href="index.html#contact"><i class="fas fa-envelope"></i>Contact</a>
    </aside>
    <aside class="cart-drawer" id="cartDrawer" aria-label="Cart">
        <div class="drawer-head">
            <h3>Your Cart <span class="muted" id="cartHeadCount"></span></h3>
            <button class="icon-btn" data-close aria-label="Close cart"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="drawer-body" id="cartBody"></div>
        <div class="drawer-foot" id="cartFoot"></div>
    </aside>
    <div class="modal" id="loginModal" role="dialog" aria-modal="true" aria-labelledby="loginTitle">
        <div class="modal-card">
            <button class="icon-btn modal-close" data-close-login aria-label="Close"><i class="fas fa-xmark"></i></button>
            <div class="brand"><span class="brand-main">JENZY</span><span class="brand-sub">THRIFTS</span></div>
            <h3 id="loginTitle">Log in to your account</h3>
            <p id="loginReason">Log in to place orders and track them.</p>
            <div id="inappNote"></div>
            <button class="google-btn" id="googleBtn">${GOOGLE_SVG}<span>Continue with Google</span></button>
            <div class="alert" id="loginError"></div>
            <p class="modal-legal">We only use your name and email to process your orders.</p>
        </div>
    </div>
    <div class="toast" id="toast"><i class="fas fa-circle-check"></i><span id="toastText"></span></div>
    `);

    const year = new Date().getFullYear();
    const telHref = 'tel:' + SITE.phone.replace(/[^\d+]/g, '');
    document.body.insertAdjacentHTML('beforeend', `
    <footer class="site-footer">
        <div class="container">
            <div class="footer-grid">
                <div>
                    <a href="index.html" class="brand"><span class="brand-main">JENZY</span><span class="brand-sub">THRIFTS</span></a>
                    <p>Authentic, hand-picked thrifted sneakers from the world's top brands — checked, cleaned and priced for everyone.</p>
                    <div class="social">
                        <a href="https://wa.me/${esc(SITE.whatsapp)}" target="_blank" rel="noopener" aria-label="WhatsApp"><i class="fab fa-whatsapp"></i></a>
                        ${SITE.instagram ? `<a href="${esc(SITE.instagram)}" target="_blank" rel="noopener" aria-label="Instagram"><i class="fab fa-instagram"></i></a>` : ''}
                        <a href="mailto:${esc(SITE.email)}" aria-label="Email"><i class="fas fa-envelope"></i></a>
                    </div>
                </div>
                <div>
                    <h5>Shop</h5>
                    <ul>
                        <li><a href="index.html#shop">All Shoes</a></li>
                        <li><a href="index.html?gender=Men#shop">Men</a></li>
                        <li><a href="index.html?gender=Women#shop">Women</a></li>
                        <li><a href="/brands">Shop by brand</a></li>
                        <li><a href="sell.html">Sell your sneakers</a></li>
                        <li><a href="orders.html#invite">Invite friends</a></li>
                    </ul>
                </div>
                <div>
                    <h5>Help</h5>
                    <ul>
                        <li><a href="orders.html">My Orders</a></li>
                        <li><a href="wishlist.html">Wishlist</a></li>
                        <li><a href="index.html#how">How to Order</a></li>
                        <li><a href="/blog">Guides &amp; tips</a></li>
                        <li><a href="index.html#about">About Us</a></li>
                        <li><a href="index.html#contact">Contact</a></li>
                    </ul>
                </div>
                <div>
                    <h5>Contact</h5>
                    <ul>
                        <li><a href="${telHref}"><i class="fas fa-phone" style="width:18px"></i> ${esc(SITE.phone)}</a></li>
                        <li><a href="mailto:${esc(SITE.email)}"><i class="fas fa-envelope" style="width:18px"></i> ${esc(SITE.email)}</a></li>
                        <li><span><i class="fas fa-location-dot" style="width:18px"></i> ${esc(SITE.city)}</span></li>
                    </ul>
                </div>
            </div>
            <div class="footer-bottom">
                <span>© ${year} JENZY THRIFTS. All rights reserved.</span>
                <span>Cash on Delivery • Delivery across Pakistan</span>
            </div>
        </div>
    </footer>`);

    const $ = (id) => document.getElementById(id);
    const overlay = $('overlay');

    // ---------- Floating WhatsApp help button (questions only — orders go through the website) ----------
    const WA_DEFAULT = 'Hi JENZY THRIFTS! I have a question.';
    let waMessage = WA_DEFAULT;
    if (SITE.whatsapp && page !== 'checkout') {
        document.body.insertAdjacentHTML('beforeend', `
            <a class="wa-float" id="waFloat" href="#" target="_blank" rel="noopener" aria-label="Questions? Chat with us on WhatsApp">
                <i class="fab fa-whatsapp"></i><span>Questions? Chat with us</span>
            </a>`);
    }
    function setHelpMessage(text) {
        waMessage = text || WA_DEFAULT;
        const a = $('waFloat');
        if (a) a.href = `https://wa.me/${encodeURIComponent(SITE.whatsapp)}?text=${encodeURIComponent(waMessage)}`;
    }
    setHelpMessage(WA_DEFAULT);

    // ---------- Top bar: add the coupon you choose to advertise (admin → Promotions) ----------
    function setAnnouncement(text) {
        const track = document.querySelector('#announceBar .announce-track');
        if (track) track.innerHTML = `<span>${esc(text)}</span><span aria-hidden="true">${esc(text)}</span>`;
    }

    function openPanel(el) { el.classList.add('open'); overlay.classList.add('show'); document.body.style.overflow = 'hidden'; }
    function closePanels() {
        ['mobileNav', 'cartDrawer'].forEach(id => $(id).classList.remove('open'));
        overlay.classList.remove('show');
        document.body.style.overflow = '';
    }
    $('menuBtn').addEventListener('click', () => openPanel($('mobileNav')));
    overlay.addEventListener('click', closePanels);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanels));
    document.querySelectorAll('#mobileNav a').forEach(a => a.addEventListener('click', closePanels));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePanels(); closeLogin(); } });

    // ---------- Toast ----------
    let toastTimer;
    function toast(text, type = 'ok') {
        const t = $('toast');
        $('toastText').textContent = text;
        t.classList.toggle('error', type === 'error');
        t.querySelector('i').className = type === 'error' ? 'fas fa-circle-exclamation' : 'fas fa-circle-check';
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
    }

    // ---------- In-app browsers (Instagram, Facebook, TikTok…) ----------
    // Google does not allow signing in inside these apps' built-in browsers.
    const UA = navigator.userAgent || '';
    const inAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|TikTok|musical_ly|BytedanceWebview|Snapchat|Line\/|Twitter/i.test(UA);
    const isAndroid = /Android/i.test(UA);
    const appName = /Instagram/i.test(UA) ? 'Instagram' : /FBAN|FBAV|FB_IAB|FBIOS/i.test(UA) ? 'Facebook' : /TikTok|musical_ly|Bytedance/i.test(UA) ? 'TikTok' : 'this app';
    function renderInAppNote() {
        const box = $('inappNote');
        if (!inAppBrowser) { box.innerHTML = ''; return; }
        const chromeUrl = `intent://${location.host}${location.pathname}${location.search}${location.hash}#Intent;scheme=https;package=com.android.chrome;end`;
        box.innerHTML = `
            <div class="inapp-note">
                <strong><i class="fas fa-circle-info"></i> Open in your browser to log in</strong>
                Google login doesn't work inside ${esc(appName)}. ${isAndroid
                    ? 'Tap the button below to open this page in Chrome.'
                    : 'Tap <b>•••</b> (top-right) and choose <b>Open in external browser</b> (Safari), then log in.'}
                <div class="inapp-actions">
                    ${isAndroid ? `<a class="btn btn-primary btn-sm" href="${esc(chromeUrl)}"><i class="fab fa-chrome"></i> Open in Chrome</a>` : ''}
                    <button class="btn btn-outline btn-sm" id="copyLinkBtn" type="button"><i class="fas fa-link"></i> Copy link</button>
                </div>
            </div>`;
        $('copyLinkBtn').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(location.href); toast('Link copied — paste it in Chrome or Safari'); }
            catch { window.prompt('Copy this link and open it in Chrome or Safari:', location.href); }
        });
    }

    // ---------- Auth (Google) ----------
    let currentUser = null;
    let authResolved = false;
    const authListeners = [];
    let loginResolvers = [];

    function renderAccount() {
        const slot = $('accountSlot');
        if (!authResolved) { slot.innerHTML = ''; return; }
        if (!currentUser) {
            slot.innerHTML = `<button class="login-btn" id="loginBtn"><i class="fa-regular fa-user"></i><span>Login</span></button>`;
            $('loginBtn').addEventListener('click', () => openLogin());
            return;
        }
        const name = currentUser.displayName || currentUser.email || 'Account';
        const first = name.split(' ')[0];
        const avatar = currentUser.photoURL
            ? `<img src="${esc(currentUser.photoURL)}" alt="" referrerpolicy="no-referrer">`
            : esc(name.charAt(0).toUpperCase());
        slot.innerHTML = `
            <div class="account">
                <button class="account-btn" id="accountBtn" aria-haspopup="true"><span class="avatar">${avatar}</span><span class="account-name">${esc(first)}</span><i class="fas fa-chevron-down" style="font-size:10px;color:var(--text-3)"></i></button>
                <div class="account-menu" id="accountMenu">
                    <div class="am-head"><strong>${esc(name)}</strong><span>${esc(currentUser.email || '')}</span></div>
                    <a href="orders.html"><i class="fas fa-box"></i>My Orders</a>
                    <a href="orders.html#invite"><i class="fas fa-gift"></i>Invite friends</a>
                    <a href="sell.html"><i class="fas fa-hand-holding-dollar"></i>Sell your sneakers</a>
                    <button id="logoutBtn"><i class="fas fa-arrow-right-from-bracket"></i>Log out</button>
                </div>
            </div>`;
        $('accountBtn').addEventListener('click', e => { e.stopPropagation(); $('accountMenu').classList.toggle('open'); });
        $('logoutBtn').addEventListener('click', async () => { await auth.signOut(); toast('You have been logged out'); });
    }
    document.addEventListener('click', e => {
        if (!e.target.closest('.account')) $('accountMenu')?.classList.remove('open');
    });

    auth.onAuthStateChanged(user => {
        currentUser = user;
        authResolved = true;
        renderAccount();
        if (user) {
            const resolvers = loginResolvers; loginResolvers = [];
            resolvers.forEach(r => r.resolve(user));
            closeLogin(true);
        }
        authListeners.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
    });
    auth.getRedirectResult().catch(err => console.warn('Redirect login error', err));

    function onAuth(fn) {
        authListeners.push(fn);
        if (authResolved) fn(currentUser);
    }

    function openLogin(reason) {
        $('loginReason').textContent = reason || 'Log in to place orders and track them.';
        $('loginError').classList.remove('show');
        renderInAppNote();
        $('loginModal').classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeLogin(success) {
        $('loginModal').classList.remove('open');
        if (!document.querySelector('.cart-drawer.open, .mobile-nav.open')) document.body.style.overflow = '';
        if (!success) {
            const resolvers = loginResolvers; loginResolvers = [];
            resolvers.forEach(r => r.reject(new Error('login-cancelled')));
        }
    }
    // Resolves with the user once logged in (opens the login window if needed)
    function requireLogin(reason) {
        if (currentUser) return Promise.resolve(currentUser);
        return new Promise((resolve, reject) => {
            loginResolvers.push({ resolve, reject });
            openLogin(reason);
        });
    }
    document.querySelector('[data-close-login]').addEventListener('click', () => closeLogin(false));
    $('loginModal').addEventListener('click', e => { if (e.target.id === 'loginModal') closeLogin(false); });

    $('googleBtn').addEventListener('click', async () => {
        const btn = $('googleBtn');
        const err = $('loginError');
        err.classList.remove('show');
        btn.disabled = true;
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
            await auth.signInWithPopup(provider);
            toast('Welcome! You are logged in.');
        } catch (e) {
            console.error('Google login error', e);
            if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
                return auth.signInWithRedirect(provider);
            }
            const messages = {
                'auth/popup-closed-by-user': null,
                'auth/cancelled-popup-request': null,
                'auth/unauthorized-domain': 'This website address is not allowed in Firebase yet (Authentication → Settings → Authorized domains).',
                'auth/operation-not-allowed': 'Google login is not enabled in Firebase (Authentication → Sign-in method → Google).',
                'auth/network-request-failed': 'Network problem. Please check your internet and try again.'
            };
            const msg = e.code in messages ? messages[e.code]
                : (inAppBrowser
                    ? `Google login is blocked inside ${appName}. Please open this page in Chrome or Safari (see above).`
                    : 'Login failed. Please try again.');
            if (msg) { err.textContent = msg; err.classList.add('show'); }
        } finally {
            btn.disabled = false;
        }
    });

    // ---------- API (our Vercel server) ----------
    async function api(path, { method = 'GET', body, auth: needAuth = false } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (needAuth || currentUser) {
            if (!currentUser) throw Object.assign(new Error('Please log in first.'), { status: 401 });
            headers.Authorization = 'Bearer ' + await currentUser.getIdToken();
        }
        let res;
        try {
            res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
        } catch (e) {
            throw new Error('Network problem. Please check your internet and try again.');
        }
        let data = {};
        try { data = await res.json(); } catch { /* not JSON */ }
        if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
        return data;
    }

    // ---------- Cart ----------
    // Stored as [{ id, size, name, brand, price, image }]
    const CART_KEY = 'jenzyCart.v2';
    let cart = [];
    try { cart = JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { cart = []; }
    cart = cart.filter(i => i && i.id && i.size);
    const cartListeners = [];

    function saveCart() {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        renderCartCount();
        cartListeners.forEach(fn => fn(cart));
        scheduleCartSync();
    }

    // Logged-in customers: remember the cart on the server so we can send
    // one friendly "you left something" email the next day.
    const CART_SYNC_KEY = 'jenzyCartSync';
    let cartSyncTimer = null;
    const cartSignature = () => cart.map(i => i.id + '|' + i.size).sort().join(',');
    function scheduleCartSync(delay = 3000) {
        clearTimeout(cartSyncTimer);
        cartSyncTimer = setTimeout(syncCart, delay);
    }
    async function syncCart() {
        if (!currentUser) return;
        const sig = currentUser.uid + ':' + cartSignature();
        if (localStorage.getItem(CART_SYNC_KEY) === sig) return;
        try {
            await api('/api/orders?action=cart', { method: 'POST', body: { items: cart.map(i => ({ product_id: i.id, size: i.size })) } });
            localStorage.setItem(CART_SYNC_KEY, sig);
        } catch { /* try again next time */ }
    }
    function renderCartCount() {
        const n = cart.length;
        $('cartCount').textContent = n;
        $('cartCount').classList.toggle('zero', n === 0);
    }
    function addToCart(product, size) {
        if (cart.some(i => i.id === product.id && i.size === size)) {
            toast('This pair is already in your cart');
            return false;
        }
        cart.push({ id: product.id, size, name: product.name, brand: product.brand || '', price: product.price, image: thumb(product) });
        saveCart();
        toast(`Added to cart: ${product.name} (US ${size})`);
        return true;
    }
    function removeFromCart(id, size) {
        cart = cart.filter(i => !(i.id === id && i.size === size));
        saveCart();
    }
    function clearCart() { cart = []; saveCart(); }

    // Check the cart against live stock and prices
    async function refreshCart() {
        if (!cart.length) return cart;
        const ids = [...new Set(cart.map(i => i.id))];
        const { data, error } = await db.from('products').select('*').in('id', ids);
        if (error) return cart;
        const byId = new Map((data || []).map(p => [p.id, p]));
        cart = cart.map(i => {
            const p = byId.get(i.id);
            const available = !!p && p.status === 'Active' && (p.sizes || []).includes(i.size);
            return p ? { ...i, name: p.name, brand: p.brand || '', price: p.price, image: thumb(p), unavailable: !available } : { ...i, unavailable: true };
        });
        saveCart();
        return cart;
    }

    function renderCartDrawer() {
        const body = $('cartBody');
        const foot = $('cartFoot');
        $('cartHeadCount').textContent = cart.length ? `(${cart.length})` : '';
        if (!cart.length) {
            body.innerHTML = `<div class="cart-empty"><i class="fas fa-bag-shopping"></i><p>Your cart is empty</p><a href="index.html#shop" class="btn btn-outline btn-sm" style="margin-top:16px" data-close-cart>Browse shoes</a></div>`;
            foot.innerHTML = '';
            body.querySelector('[data-close-cart]')?.addEventListener('click', closePanels);
            return;
        }
        const available = cart.filter(i => !i.unavailable);
        const subtotal = available.reduce((s, i) => s + (Number(i.price) || 0), 0);
        body.innerHTML = cart.map(i => `
            <div class="cart-line ${i.unavailable ? 'unavailable' : ''}">
                <a href="${productUrl(i.id)}"><img src="${esc(i.image)}" alt=""></a>
                <div>
                    <h4><a href="${productUrl(i.id)}">${esc(i.name)}</a></h4>
                    <div class="cl-meta">${esc(i.brand)} • US ${esc(i.size)}</div>
                    ${i.unavailable ? '<div class="cl-flag">Sold out — please remove</div>' : `<div class="cl-price">${pkr(i.price)}</div>`}
                </div>
                <button class="cl-remove" data-remove="${esc(i.id)}" data-size="${esc(i.size)}" aria-label="Remove"><i class="fas fa-trash-can"></i></button>
            </div>`).join('');
        const b = offersCache && offersCache.bundle;
        let dealNote = '';
        if (b && b.active && available.length) {
            dealNote = available.length >= b.min
                ? `<div class="deal-note on"><i class="fas fa-tags"></i> Bundle deal: ${b.percent}% off is applied at checkout</div>`
                : `<div class="deal-note"><i class="fas fa-tags"></i> Add ${b.min - available.length} more pair${b.min - available.length > 1 ? 's' : ''} and get ${b.percent}% off</div>`;
        }
        foot.innerHTML = `
            ${dealNote}
            <div class="sum-row total"><span>Subtotal</span><span>${pkr(subtotal)}</span></div>
            <p class="drawer-note">Delivery and discount codes are applied at checkout. Pay cash on delivery.</p>
            <a href="checkout.html" class="btn btn-primary btn-block btn-lg ${available.length ? '' : 'disabled'}" ${available.length ? '' : 'aria-disabled="true" style="pointer-events:none;opacity:.5"'}><i class="fas fa-lock"></i> Checkout</a>`;
        body.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
            removeFromCart(b.dataset.remove, b.dataset.size);
            renderCartDrawer();
        }));
    }
    async function openCart() {
        if (!offersCache) loadOffers().then(() => renderCartDrawer());
        renderCartDrawer();
        openPanel($('cartDrawer'));
        await refreshCart();
        renderCartDrawer();
    }
    $('cartBtn').addEventListener('click', openCart);
    renderCartCount();
    window.addEventListener('storage', e => {
        if (e.key === CART_KEY) {
            try { cart = JSON.parse(e.newValue) || []; } catch { cart = []; }
            renderCartCount();
        }
    });

    // ---------- Wishlist ❤️ (saved on this device) ----------
    const WISH_KEY = 'jenzyWishlist.v1';
    let wishlist = [];
    try { wishlist = JSON.parse(localStorage.getItem(WISH_KEY)) || []; } catch { wishlist = []; }
    wishlist = wishlist.filter(id => typeof id === 'string').slice(0, 100);
    const wishListeners = [];
    function renderWishCount() {
        const n = wishlist.length;
        $('wishCount').textContent = n;
        $('wishCount').classList.toggle('zero', n === 0);
        $('wishCountM').textContent = n ? n : '';
    }
    function syncWishButtons(id) {
        const on = wishlist.includes(id);
        document.querySelectorAll(`[data-wish="${CSS.escape(id)}"]`).forEach(b => {
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Save to wishlist');
            const i = b.querySelector('i');
            if (i) i.className = (on ? 'fas' : 'fa-regular') + ' fa-heart';
            const label = b.querySelector('[data-wish-label]');
            if (label) label.textContent = on ? 'Saved' : 'Save';
        });
    }
    function saveWishlist(changedId) {
        try { localStorage.setItem(WISH_KEY, JSON.stringify(wishlist)); } catch { /* storage full / private mode */ }
        renderWishCount();
        if (changedId) syncWishButtons(changedId);
        wishListeners.forEach(fn => fn(wishlist));
    }
    function toggleWish(id) {
        if (!id) return false;
        const on = !wishlist.includes(id);
        wishlist = on ? [id, ...wishlist].slice(0, 100) : wishlist.filter(x => x !== id);
        saveWishlist(id);
        if (currentUser) {
            toast(on ? "Saved! We'll email you if the price drops" : 'Removed from your wishlist');
            api('/api/orders?action=wish', { method: 'POST', body: { product_id: id, on } }).catch(() => {});
        } else {
            toast(on ? 'Saved to your wishlist' : 'Removed from your wishlist');
        }
        return on;
    }
    // After login: save this device's wishlist to the account (for price-drop
    // emails) and bring back hearts saved on other devices.
    async function syncWishlist(user) {
        const key = 'jenzyWishSync:' + user.uid;
        if (sessionStorage.getItem(key)) return;
        try {
            const res = await api('/api/orders?action=wishSync', { method: 'POST', body: { ids: wishlist } });
            sessionStorage.setItem(key, '1');
            const merged = [...new Set([...wishlist, ...(res.ids || [])])].slice(0, 100);
            if (merged.length !== wishlist.length) {
                wishlist = merged;
                saveWishlist();
                document.querySelectorAll('[data-wish]').forEach(b => syncWishButtons(b.dataset.wish));
            }
        } catch { /* not important */ }
    }
    // Heart buttons anywhere on the page (cards sit inside links, so stop the link opening)
    document.addEventListener('click', e => {
        const b = e.target.closest('[data-wish]');
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        toggleWish(b.dataset.wish);
    });
    renderWishCount();
    window.addEventListener('storage', e => {
        if (e.key !== WISH_KEY) return;
        try { wishlist = JSON.parse(e.newValue) || []; } catch { wishlist = []; }
        renderWishCount();
        document.querySelectorAll('[data-wish]').forEach(b => syncWishButtons(b.dataset.wish));
    });
    const wishButton = (id, extraClass = '') => {
        const on = wishlist.includes(id);
        return `<button type="button" class="wish-btn ${extraClass} ${on ? 'on' : ''}" data-wish="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from wishlist' : 'Save to wishlist'}"><i class="${on ? 'fas' : 'fa-regular'} fa-heart"></i></button>`;
    };

    // ---------- Recently viewed (saved on this device) ----------
    const RECENT_KEY = 'jenzyRecent.v1';
    function recentIds() {
        try { return (JSON.parse(localStorage.getItem(RECENT_KEY)) || []).filter(id => typeof id === 'string').slice(0, 12); } catch { return []; }
    }
    function addRecent(id) {
        if (!id) return;
        const list = [id, ...recentIds().filter(x => x !== id)].slice(0, 12);
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
    }
    // Loads saved products (keeps the saved order; drafts/deleted ones drop out)
    async function loadProductsByIds(ids) {
        if (!ids.length) return [];
        const { data, error } = await db.from('products').select('*').in('id', ids).in('status', ['Active', 'Sold']);
        if (error) { console.warn(error); return []; }
        const byId = new Map((data || []).map(p => [p.id, p]));
        return ids.map(id => byId.get(id)).filter(Boolean);
    }

    // ---------- Coupon banner ----------
    (async () => {
        try {
            const { data, error } = await db.from('coupons').select('code, percent, min_order, expires_at').limit(1);
            const c = !error && data && data[0];
            if (!c) return;
            const min = c.min_order > 0 ? ` on orders above ${pkr(c.min_order)}` : '';
            setAnnouncement(`${SITE.announcement}  •  Use code ${c.code} for ${c.percent}% off${min}`);
        } catch { /* coupons table not set up yet */ }
    })();

    // ---------- Live product updates (Supabase Realtime) ----------
    function onProductsChange(callback) {
        try {
            const channel = db.channel('products-live-' + Math.random().toString(36).slice(2, 8))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, payload => callback(payload))
                .subscribe();
            return () => db.removeChannel(channel);
        } catch (e) {
            console.warn('Realtime not available', e);
            return () => {};
        }
    }

    // ---------- Product card HTML (used by home + product pages) ----------
    function productCard(p) {
        const off = discountPct(p);
        const tag = (p.tag || '').toLowerCase();
        const sold = p.status === 'Sold';
        const sizes = sortSizes(p.sizes);
        const alt = p.images && p.images[1] ? thumb(p, 1) : '';
        return `
        <a class="p-card" href="${productUrl(p)}">
            <div class="p-media">
                <img class="main ${alt ? '' : 'main-only'}" src="${esc(thumb(p))}" alt="${esc(p.name)}" loading="lazy">
                ${alt ? `<img class="alt" src="${esc(alt)}" alt="" loading="lazy">` : ''}
                <div class="p-badges">
                    ${sold ? '<span class="badge badge-sold">Sold out</span>' : ''}
                    ${!sold && p.tag ? `<span class="badge badge-${esc(tag)}">${esc(p.tag)}</span>` : ''}
                    ${!sold && off >= 5 ? `<span class="badge badge-off">-${off}%</span>` : ''}
                </div>
                <span class="p-view">View details</span>
                ${wishButton(p.id)}
            </div>
            <div class="p-body">
                <span class="p-brand">${esc(p.brand || '')}</span>
                <h3 class="p-name">${esc(p.name)}</h3>
                <div class="p-meta">
                    ${p.condition ? `<span class="cond cond-${esc(p.condition)}">${esc(p.condition)}</span>` : ''}
                    <span>${sizes.length ? 'US ' + esc(sizes.join(', ')) : (sold ? 'Sold out' : '')}</span>
                </div>
                <div class="p-price">
                    <span class="now">${pkr(p.price)}</span>
                    ${p.original_price && p.original_price > p.price ? `<span class="was">${pkr(p.original_price)}</span>` : ''}
                </div>
            </div>
        </a>`;
    }

    // ---------- Customer photo uploads (reviews, sell requests) ----------
    // Shrinks the photo in the browser (fast uploads, small storage), then
    // uploads it with a one-time link from our server. Returns the public URL.
    function resizeImage(file, max = 1280, quality = 0.82) {
        return new Promise((resolve, reject) => {
            if (!/^image\//.test(file.type || '')) return reject(new Error('Please choose a photo (JPG or PNG).'));
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                const c = document.createElement('canvas');
                c.width = Math.round(img.naturalWidth * scale);
                c.height = Math.round(img.naturalHeight * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                c.toBlob(b => b ? resolve(b) : reject(new Error('Could not read this photo.')), 'image/jpeg', quality);
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this photo. Try a JPG or PNG.')); };
            img.src = url;
        });
    }
    async function uploadPhoto(kind, file) {
        const blob = await resizeImage(file);
        const signed = await api('/api/orders?action=uploadUrl', { method: 'POST', auth: true, body: { kind, ext: 'jpg' } });
        const { error } = await db.storage.from('product-images').uploadToSignedUrl(signed.path, signed.token, blob, { contentType: 'image/jpeg' });
        if (error) throw new Error('Photo upload failed. Please try again.');
        return signed.publicUrl;
    }

    // ---------- Shop offers (bundle deal, invite friends) ----------
    let offersCache = null;
    let offersPromise = null;
    function loadOffers() {
        if (!offersPromise) {
            offersPromise = (async () => {
                const out = { bundle: { active: true, min: 2, percent: 10 }, referral: { active: true, percent: 10, reward: 300 } };
                try {
                    const { data, error } = await db.from('shop_settings').select('key, value').in('key', ['bundle', 'referral']);
                    if (!error) (data || []).forEach(r => { out[r.key] = { ...out[r.key], ...r.value }; });
                } catch { /* defaults */ }
                offersCache = out;
                return out;
            })();
        }
        return offersPromise;
    }

    // ---------- Invite links (?ref=CODE) ----------
    const REF_KEY = 'jenzyRef';
    const refParam = (qs('ref') || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4,20}$/.test(refParam)) {
        const had = localStorage.getItem(REF_KEY);
        try { localStorage.setItem(REF_KEY, refParam); } catch { /* ignore */ }
        if (had !== refParam) {
            loadOffers().then(o => {
                if (o.referral.active) setTimeout(() => toast(`Invite code ${refParam} saved: ${o.referral.percent}% off your first order at checkout`), 900);
            });
        }
    }
    const referralCode = () => localStorage.getItem(REF_KEY) || '';

    // ---------- Visitor stats (anonymous: a random id, the page, where they came from) ----------
    (function trackView() {
        try {
            if (/bot|crawl|spider|slurp|facebookexternalhit|WhatsApp\/|Lighthouse|preview|HeadlessChromeBot/i.test(UA)) return;
            if (localStorage.getItem('jenzyNoTrack')) return;   // set on the shop owner's devices by the admin panel
            let vid = localStorage.getItem('jenzyVid');
            if (!/^[a-z0-9]{8,32}$/.test(vid || '')) {
                vid = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(10, '0');
                localStorage.setItem('jenzyVid', vid);
            }
            let src = sessionStorage.getItem('jenzySrc');
            if (!src) {
                const q = new URLSearchParams(location.search);
                const hint = (q.get('s') || q.get('utm_source') || '').toLowerCase();
                const ref = document.referrer ? (() => { try { return new URL(document.referrer).hostname; } catch { return ''; } })() : '';
                const MAP = { wa: 'whatsapp', whatsapp: 'whatsapp', ig: 'instagram', instagram: 'instagram', story: 'instagram', fb: 'facebook', facebook: 'facebook', tt: 'tiktok', tiktok: 'tiktok', yt: 'youtube', youtube: 'youtube', google: 'google' };
                if (MAP[hint]) src = MAP[hint];
                else if (q.get('igshid') || /Instagram/i.test(UA) || /instagram\.com$/.test(ref)) src = 'instagram';
                else if (q.get('fbclid') || /FBAN|FBAV|FB_IAB|FBIOS/i.test(UA) || /(facebook\.com|fb\.me|fb\.com)$/.test(ref)) src = 'facebook';
                else if (/TikTok|musical_ly|Bytedance/i.test(UA) || /tiktok\.com$/.test(ref)) src = 'tiktok';
                else if (q.get('gclid') || /(^|\.)google\./.test(ref)) src = 'google';
                else if (/whatsapp|wa\.me$/.test(ref)) src = 'whatsapp';
                else if (/youtube\.com$|youtu\.be$/.test(ref)) src = 'youtube';
                else if (hint || (ref && ref !== location.hostname)) src = 'other';
                else src = 'direct';
                sessionStorage.setItem('jenzySrc', src);
            }
            const device = /iPad|Tablet/i.test(UA) || (/Android/i.test(UA) && !/Mobile/i.test(UA)) ? 'tablet' : /Mobi|Android|iPhone|iPod/i.test(UA) ? 'mobile' : 'desktop';
            let path = location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '') || '/';
            let productId = null;
            const m = location.pathname.match(/^\/shoe\/([0-9a-f-]{36})/i);
            if (m || page === 'product') { path = '/shoe'; productId = m ? m[1] : qs('id'); }
            if (productId && !/^[0-9a-f-]{36}$/i.test(productId)) productId = null;
            db.from('page_views').insert({ visitor: vid, path: path.slice(0, 120), product_id: productId, source: src, device }).then(() => {}, () => {});
        } catch { /* never break the page */ }
    })();

    // Logged-in: sync wishlist + cart
    onAuth(user => {
        if (!user) return;
        syncWishlist(user);
        scheduleCartSync(1500);
    });

    window.Store = {
        config: CFG, site: SITE, db, auth,
        esc, pkr, orderNo, discountPct, productUrl, shareUrl, copyText, firstImage, thumb, stars, sortSizes, qs, toast,
        offers: loadOffers, uploadPhoto, referralCode, clearReferralCode: () => localStorage.removeItem(REF_KEY),
        onAuth, requireLogin, openLogin, get user() { return currentUser; },
        api,
        cart: {
            get items() { return cart; },
            add: addToCart, remove: removeFromCart, clear: clearCart, refresh: refreshCart,
            open: openCart, onChange: (fn) => cartListeners.push(fn)
        },
        onProductsChange, productCard,
        wishlist: {
            get ids() { return wishlist.slice(); },
            has: (id) => wishlist.includes(id),
            toggle: toggleWish,
            button: wishButton,
            onChange: (fn) => wishListeners.push(fn)
        },
        recent: { ids: recentIds, add: addRecent },
        loadProductsByIds, setHelpMessage, setAnnouncement
    };
})();
