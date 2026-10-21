# Meta ads: install the Pixel and run your first campaign

**Short answer:** yes — it is called the **Meta Pixel** (people also say "Facebook Pixel").
It is a small piece of code that tells Meta what happens on your website: who looked
at a shoe, who added it to the cart, who reached checkout and who actually ordered.
Without it, Meta can show your ads but cannot learn who buys, cannot retarget the
people who almost bought, and cannot show you which ads bring orders.

Your website is now ready for it. You only need to paste **one number** (your Pixel ID)
in `assets/js/config.js` and redeploy.

---

## 1. Create the pixel (5 minutes, free)

1. Go to **[Meta Events Manager](https://business.facebook.com/events_manager)** and make
   sure your shop's **Business Manager** account is selected at the top left.
2. Click **Data sources** (the database icon) → **+ Connect data**.
3. Choose **Web** → **Meta Pixel** → **Create pixel**.
4. Name it `JENZY THRIFTS` and click **Create**.
5. Open **Settings** for the pixel. At the top you will see the **Pixel ID** — a long
   number such as `1234567890123456`. Copy it (digits only).

> If you already created a pixel in the past, use that one. Do not create a second
> pixel for the same website — two pixels mean confusing, duplicated numbers.

## 2. The Pixel ID is installed

Your pixel is **1637709681337379**, already set in `assets/js/config.js`:

```js
    meta: {
        pixelId: "1637709681337379",
        advancedMatching: true,
        debug: false
    },
```

Nothing else to paste. "Meta code" (the snippet Meta gave you) does **not** need to be
added to any page — `assets/js/pixel.js` already contains the same base code and fires
`PageView`. Pasting the snippet too would load the pixel twice and **double every event**,
which inflates your ad reports. You can delete the `meta code` file from the repository.

- Leave `advancedMatching: true`. When a customer is logged in, the site sends Meta a
  **hashed** (scrambled) version of their email. Meta cannot read it; it only uses it to
  match the visitor to their Facebook/Instagram account. Better matching = better ads.
- `debug: true` prints every event in the browser console. Useful for one test, switch
  it back to `false` afterwards.

Commit the change. Vercel deploys in about a minute.

> **No ID?** Everything still works. With an empty `pixelId` the file does nothing at all,
> so it is safe to deploy now and add the ID later.

## 3. Check that it works (2 minutes)

> The number in the Events Manager top-right bar (e.g. `1983…`) is your **ad account**.
> The **pixel / dataset** ID is the one in `assets/js/config.js` (e.g. `1637…`).
> Two different numbers is normal — the site must send to the *pixel* ID.

### Where "Test events" lives in the new Events Manager

It is **not** on the "Welcome / Overview" screen. Path:
**Events Manager → left sidebar `Datasets` → click your dataset (e.g. `ALI`) →
`Test events` tab** (next to Overview / Diagnostics / History / Settings).
Direct link pattern:
`https://business.facebook.com/events_manager2/list/pixel/<PIXEL_ID>/test_events?act=<AD_ACCOUNT_ID>`

### The two-window method (important!)

Test events only shows events that arrive **while the tab is open**, and your own
everyday browser is deliberately opted out (see below). So:

1. **Window 1** (logged into Facebook): Datasets → your pixel → **Test events**,
   leave it open.
2. **Window 2**: an **incognito / private window** (or any phone that never opened
   `admin.html`) → open `https://www.jenzythrifts.com`, view a shoe, add to cart,
   open checkout.
3. Back in Window 1, within ~30 seconds: `PageView`, `ViewContent`, `AddToCart`,
   `InitiateCheckout` appear one by one.

Browsing in your normal logged-in Chrome will show **nothing**, because the admin
panel marked that browser "do not track" — that is correct behaviour, not a bug.

### 10-second technical proof (no Meta UI needed)

In an incognito window on your site, press `F12`:

- **Console** → type `fbq` → Enter. A function (not `undefined`) means the pixel
  code ran and `PageView` was queued.
- **Network** tab → filter box: `facebook` → reload. You should see
  `fbevents.js` and one or more `tr/?id=<PIXEL_ID>&ev=PageView…` requests with
  status 200. Those rows *are* the events reaching Meta.

### Manual check

Install the **Meta Pixel Helper** extension in Chrome, open your site (incognito),
and click the extension icon. It lists every event received.

**Owner devices are skipped.** The admin panel puts a "do not track" mark
(`jenzyNoTrack` in localStorage) on your own phone and computer, so your testing and
your own orders do not spoil the ad data. Localhost is skipped too. To un-mark a
device: open the site console and run `localStorage.removeItem('jenzyNoTrack')`.

---

## What your website sends to Meta

These are standard events, so Meta understands them without any extra setup:

| Where it fires | Event | What Meta learns |
|---|---|---|
| Every page (store, product, blog, brand, city) | `PageView` | Someone visited |
| Opening a shoe page | `ViewContent` | Which shoe they looked at, and its price |
| "Add to cart" | `AddToCart` | Which shoe, price |
| Tapping the heart | `AddToWishlist` | Which shoe |
| Checkout with items | `InitiateCheckout` | Basket value (fired once per basket, not on every refresh) |
| Order placed | `Purchase` | Order value and items — the important one |

Prices are sent in **PKR**, and values are whole rupees.

**Cash on delivery caveat:** `Purchase` means "order placed", not "money received".
In Pakistan many COD orders are cancelled or fake. Your ad reports will look better than
reality. The honest long-term fix is to send Meta the **Confirmed** and **Delivered**
statuses later as "offline conversions" — we can add that when you are ready, using the
order numbers already in your admin panel.

---

## 4. Run your first campaign

Do not start with a big budget. Start small, learn, then scale what works.

**Objective**
- Campaign objective: **Sales** → conversion event **Purchase**.
- If you get fewer than about 50 orders a week, optimize for **InitiateCheckout** first.
  Meta needs roughly 50 of the chosen event per week per ad set to learn properly.
  Switch to `Purchase` once you are above that.

**Audience (first campaign)**
- Country: **Pakistan**. Start with the big cities plus your best delivery areas
  (Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar...).
- Age **18–34**, all genders (sneaker buyers skew male, but do not exclude women — women
  buy for brothers, husbands and themselves).
- Interests (start with one ad set): Nike, Adidas, Jordan, New Balance, sneakers,
  streetwear, hypebeast, online shopping. Keep it broad — 1–3 interests, not 20.
- Exclude your existing customers and people who already purchased in the last 180 days.

**Budget and patience**
- PKR 1,500–3,000 per day is enough to start for one ad set.
- Do **not** edit the campaign for 5–7 days. Every edit restarts learning.
- Judge by **cost per order**, not by likes or clicks.

**Creative**
- Use the real shoe photos from your site — they already look good and are honest about
  condition.
- Show **price** and **"Cash on delivery all over Pakistan"** on the image or in the
  first line of text. Price shocks are the number one wasted click for thrift shops.
- Use short video if you have it: shoe in hand, close-up of the sole and label, then the
  price. 6–15 seconds.
- One ad set can hold 3–5 creatives. Let Meta find the winner.

**Landing page**
- Send traffic to the shoe page, not the home page, when advertising one pair.
  `/shoe/<id>` links already show a photo preview on WhatsApp and Instagram.
- If you advertise a collection, send people to `/#shop`.

---

## 5. Two settings that protect your data

**Verify your domain.** In Business Manager go to **Brand safety → Domains → Add**, enter
`jenzythrifts.com`, and verify with a DNS **TXT** record at your domain registrar. This
also lets you choose which events Meta prioritises on iPhones (Aggregated Event
Measurement). If you would rather verify with a meta tag, paste the tag Meta gives you
and we will add it to the top of `index.html`.

**Set event priority.** Events Manager → **Aggregated event measurement** → configure
events for `jenzythrifts.com`. Put **Purchase** first, then **InitiateCheckout**,
**AddToCart**, **ViewContent**. iPhone users may not report every event, and this order
decides which ones are kept.

**Add a privacy page.** Meta asks for a privacy policy link when you set up a catalogue,
lead ads or a shop. The website does not have one yet. Say the word and we will add a
short, accurate `/privacy` page: what the pixel collects, cookie use, and how delivery
details are stored.

---

## 6. Retargeting (where small shops win)

After the pixel has collected a week or two of visitors:

| Audience | Days | Why |
|---|---|---|
| Viewed a shoe, did not add to cart | 7–14 | Show the same shoe with a clearer price |
| Added to cart, did not reach checkout | 7–14 | Nudge with delivery info or a small coupon |
| Reached checkout, did not order | 7 | These are the warmest people you have |
| Purchased | 180 | **Exclude** them from the audiences above |

Create these in **Audiences** (Events Manager / Ads Manager → Audiences → Create audience
→ Custom audience → Website). Retargeting usually costs much less per order than cold
traffic.

---

## 7. Catalogue / dynamic product ads (optional, next step)

Dynamic ads show each person the exact shoe they looked at. That needs a **product
catalogue** in Commerce Manager, filled from a feed (a CSV/XML file Meta refreshes
regularly). Your products live in Supabase, so we can generate a feed at
`/api/feed` and let Meta pull it automatically. Ask when you want this — it takes one
small file and makes retargeting much stronger.

Two things to remember for the catalogue: the product **ID** in the feed must be the same
UUID used on the site (`content_ids`), and prices must match the site exactly.

---

## 8. If something looks wrong

| Problem | Cause / fix |
|---|---|
| No events in Test Events | `pixelId` not saved, or the site was not redeployed after the edit. Check the ID has digits only, no spaces. |
| Events show but no `Purchase` | The order page must open right after checkout in the same tab. Make sure the customer clicks "Place order" from the site and does not type the order page address. |
| Owner's own visits appear | Use the admin panel on that device once (it sets the "do not track" mark), or clear it and log in to admin again. |
| Numbers look doubled | Two pixels are installed (for example an old hard-coded snippet plus this one). Keep only one. |
| Fewer purchases than orders in admin | Normal on iPhones and with ad blockers. The gap is usually 10–30%. Domain verification reduces it. |
| Campaign gets no sales but clicks are cheap | Usually a price or trust problem, not a pixel problem: check the landing shoe's price, photos, size availability and delivery promise. |

---

## Quick checklist

- [x] Pixel created in Events Manager (`1637709681337379`)
- [x] Pixel ID set in `assets/js/config.js` → `meta.pixelId`
- [ ] Code merged to `main` and deployed on Vercel
- [ ] `PageView` and `ViewContent` visible in Test Events
- [ ] Test order placed → `Purchase` visible (then cancel the test order in admin)
- [ ] Domain verified in Business Manager
- [ ] Event priority set (Purchase first)
- [ ] First campaign: Sales objective, Pakistan, 18–34, PKR 1,500–3,000/day
- [ ] Retargeting audiences created after one week

---

## Files that make it work

Only for reference — you do not need to touch them.

| File | Job |
|---|---|
| `assets/js/pixel.js` | Loads the Meta Pixel, sends `PageView`, keeps every other event safe when no ID is set, hashes the customer email for advanced matching |
| `assets/js/config.js` | Holds your Pixel ID (`meta.pixelId`) |
| `assets/js/store.js` | Sends `AddToCart` and `AddToWishlist` |
| `product.html` | Sends `ViewContent` |
| `checkout.html` | Sends `InitiateCheckout` (once per basket) and remembers the order |
| `orders.html` | Sends `Purchase` (once per order) |
| `api/pages.js` | Adds the pixel to blog, brand and city pages |

Your own devices are excluded automatically: the admin panel marks the device, and
localhost is ignored.
