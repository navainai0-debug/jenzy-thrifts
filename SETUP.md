# JENZY THRIFTS: setup guide

The website has two parts:

- **Store pages:** `index.html`, `product.html`, `checkout.html`, `orders.html`, `wishlist.html` and `sell.html`.
- **Secure server:** the `api/` folder. Vercel runs it automatically.

Orders are saved in your Supabase database. The server checks prices and stock, so nobody can change a price or buy a pair that is already sold.

The admin panel is at **https://jenzy-thrifts.vercel.app/admin.html**. It is **not** linked anywhere on the store, so only people who know the address can find it.

---

## 1. Upload the files to GitHub

1. Unzip the zip file on your computer.
2. On GitHub, open the repository and click **Add file → Upload files**.
3. Drag **everything inside** the unzipped folder into the page: all files (including `vercel.json`, `package.json` and `package-lock.json`) **and** the `api` and `assets` folders.
4. Click **Commit changes**. Vercel redeploys automatically in about a minute.

> Do not copy and paste code into the GitHub editor. Large files get cut off and the site breaks.

## 2. Run the database setup (once)

1. In Supabase, open **SQL Editor → New query**.
2. Paste the whole content of `supabase-setup.sql` and click **Run**.

This is safe to run again, and **you must run it again after this update** (reviews, sell requests, invite codes, visitor stats, small photos and the fit label all need it). It creates or updates:

- the orders table,
- the stock-safe order function,
- the security rules,
- the image bucket,
- live updates,
- courier and tracking-number columns on orders,
- a private settings table (remembers your Telegram chat and the drop countdown),
- the **coupons** table (discount codes you create in admin → Promotions),
- the **restock_requests** table (customers waiting for a size),
- **reviews**, **sell_requests**, **referral codes and credits**, saved **wishlists and carts** (for price-drop and cart emails), **page_views** (visitor stats),
- the `thumbs` (small photos) and `fit` columns on products.

## 3. Add the secret keys in Vercel

Go to **Vercel → your project → Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → **service_role** (secret) key |
| `ADMIN_EMAILS` | Your admin email, e.g. `yourname@gmail.com`. Separate several emails with commas. |

Then go to **Deployments**, click **⋯** on the latest deployment and choose **Redeploy**.

> ⚠️ Never put the service_role key in any website file. It belongs only in Vercel.

### Optional settings (also Vercel environment variables)

| Name | Default | Meaning |
|---|---|---|
| `DELIVERY_FEE` | `250` | Delivery charge in PKR |
| `FREE_DELIVERY_MIN` | `5000` | Orders at or above this amount (after discount) get free delivery |
| `MAX_PENDING_ORDERS` | `5` | The most pending orders one customer can have at a time |
| `SHOP_TIMEZONE` | `Asia/Karachi` | The time zone used for "today" in the dashboard |
| `CRON_SECRET` | *(none)* | Any long random text, e.g. `jenzy-8f3k2q9x7w`. Protects the daily cart-reminder job so only Vercel can start it. Recommended. |

## 4. Firebase settings

1. **Authentication → Sign-in method:** make sure **Google** is enabled.
2. **Authentication → Settings → Authorized domains:** add `jenzy-thrifts.vercel.app`.
3. **Admin login.** The easiest way is to sign in on `admin.html` with **Google**, using the email you put in `ADMIN_EMAILS`.
   - If you prefer email and password instead:
     - enable **Email/Password** in Firebase;
     - under **Authentication → Users → Add user**, create the user with your admin email;
     - the first time you sign in, click the verification link Firebase emails you, then sign in again.

## 5. Your shop details

Edit `assets/js/config.js` to set these (they show in the contact section and the footer):

- your phone number,
- your WhatsApp number (for the "Chat with us" link),
- your email,
- your Instagram,
- your city,
- the announcement bar text.

## 6. Order alerts on your phone (Telegram + Gmail)

You get a message the moment someone orders, even when the admin panel is closed. Customers get emails when their order is placed, confirmed, shipped (with tracking number), delivered or cancelled.

Both are free. You can set up one or both.

### Telegram (instant alerts, recommended)

1. Install **Telegram** on your phone and open a chat with **@BotFather**.
2. Send `/newbot`. Choose a name (e.g. `Jenzy Orders`) and a username ending in `bot` (e.g. `jenzy_orders_bot`).
3. BotFather replies with a **token** like `7234567890:AAH...`. Copy it.
4. In Vercel, add the environment variable `TELEGRAM_BOT_TOKEN` with that token, then **Redeploy**.
5. In Telegram, search for your new bot and press **START**.
6. Open **admin.html → Order Alerts** and click **Connect Telegram**. Done. Press **Send test alert** to check.

> To get alerts on more than one phone (e.g. a partner), have them press START on the bot too, then click **Connect Telegram** again.

### Your own email address (Zoho Mail) — recommended

Emails to customers then come from e.g. `support@jenzythrifts.com` instead of a Gmail address.
Zoho's **Forever Free** plan does not allow this (no SMTP) — you need **Mail Lite** or higher.

1. Zoho Mail → **Settings → Mail Accounts** → click the address → **IMAP/POP/SMTP**: make sure SMTP access is on.
2. If you use 2-factor login for Zoho: **accounts.zoho.com → Security → App Passwords** → create one called `Jenzy website`.
3. In Vercel, add these environment variables, then **Redeploy**:

| Name | Value |
|---|---|
| `SMTP_USER` | `support@jenzythrifts.com` (emails are sent from this address) |
| `SMTP_PASS` | Its password (or the app-specific password) |
| `SMTP_HOST` | `smtp.zoho.com` — use `smtp.zoho.in` / `smtp.zoho.eu` if your Zoho Mail address bar ends in `.in` / `.eu` |
| `EMAIL_REPLY_TO` | *(optional)* Where customers' replies go, if different, e.g. `info@jenzythrifts.com` |
| `NOTIFY_EMAIL` | *(optional)* Where new-order emails go, e.g. `info@jenzythrifts.com` |

When `SMTP_USER` + `SMTP_PASS` are set, they are used instead of Gmail. Check **admin → Order Alerts** — it shows "Sending from: support@… (Zoho Mail)" — and press **Send test alert**.

### Free alternative: Brevo (own address on Zoho's free plan)

Brevo sends up to **300 emails a day for free**, from your own address, while you keep reading mail in Zoho.

1. Sign up at **brevo.com** (free plan).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain** → `jenzythrifts.com`. Brevo shows DNS records (a `brevo-code` TXT, a DKIM record and DMARC). Add them where your domain's DNS is managed (the same place you added Zoho's MX records).
   - **SPF:** you must have only ONE record starting with `v=spf1`. Edit the existing Zoho one to `v=spf1 include:zoho.com include:spf.brevo.com ~all` — don't add a second one.
   - Don't touch Zoho's MX records.
3. Wait until Brevo shows the domain as **Authenticated**, then add sender `support@jenzythrifts.com` (**Senders → Add a sender**).
4. **SMTP & API → SMTP → Generate a new SMTP key**. Copy the key and the **SMTP login** shown on that page.
5. In Vercel add, then **Redeploy**:

| Name | Value |
|---|---|
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | The SMTP login from step 4 |
| `SMTP_PASS` | The SMTP key from step 4 |
| `EMAIL_FROM` | `support@jenzythrifts.com` |
| `NOTIFY_EMAIL` | *(optional)* `info@jenzythrifts.com` |

### Gmail (emails to you and your customers)

On Zoho's free plan, keep Gmail and add `EMAIL_REPLY_TO` = `support@jenzythrifts.com`, so customers who reply reach your support inbox.


1. Use a Gmail account for the shop (e.g. `jenzythrift@gmail.com`).
2. Turn on **2-Step Verification**: Google Account → Security.
3. Open **https://myaccount.google.com/apppasswords**, type a name like `Jenzy website` and click **Create**. Copy the 16-letter password.
4. In Vercel, add these environment variables, then **Redeploy**:

| Name | Value |
|---|---|
| `GMAIL_USER` | The shop Gmail address |
| `GMAIL_APP_PASSWORD` | The 16-letter app password (spaces are fine) |
| `NOTIFY_EMAIL` | *(optional)* Where new-order emails go. Default: the emails in `ADMIN_EMAILS` |
| `CUSTOMER_EMAILS` | *(optional)* Set to `off` to stop emailing customers |
| `SITE_URL` | *(optional)* Your site address if you add your own domain later, e.g. `https://jenzythrifts.pk` |

> Gmail allows about 500 emails a day, which is plenty for a shop.

## 7. Shipping and tracking numbers

When you send a parcel:

1. Open the order in **admin → Orders**. After you press **Confirmed**, a **Shipping & tracking** box appears.
2. Pick the courier (TCS, Leopards, PostEx, Trax, M&P and others), type the tracking number, then press **Mark Shipped**.
3. The customer gets an email with the tracking number, and sees it on **My Orders** with **Track parcel** and **Copy number** buttons.

The courier websites don't accept a tracking number in the link, so **Track parcel** opens the courier's tracking page and the customer pastes the number (one tap on **Copy number**). If your courier gives you an exact tracking link, paste it in the optional box and the button will go straight there.

## 8. Share links

Every shoe has its own link, like `https://jenzy-thrifts.vercel.app/shoe/…`. The product page has **WhatsApp** and **Copy link** buttons. When the link is pasted into WhatsApp, Instagram or Facebook, it shows the shoe's photo, name and price.

> WhatsApp remembers a link preview for a while. If you change a photo or price, the old preview may show for up to a few days on links that were already shared.

## 9. Coupon codes and the drop countdown (admin → Promotions)

**Coupon codes.** Only the codes you create here work at checkout. There are no built-in codes (the old `JENZY20` is gone).

1. Type the code (e.g. `EID15`) and the % off. Optional:
   - **Min. order:** the cart must reach this amount before the discount.
   - **Max uses:** the code stops working after this many orders.
   - **Last day:** the code works until the end of that day.
2. Tick **Show this code in the website's top bar** to advertise it ("Use code EID15 for 15% off"). Only one code shows at a time.
3. Press **Create coupon**. Use **Turn off** to pause a code, or the bin button to delete it. Orders that already used a code keep their discount.

If a customer cancels an order, its coupon use is given back.

**Drop countdown.** Set a title, the date and time, and tick **Show the countdown**. The home page shows a live countdown (days, hours, minutes, seconds) with a button to your Instagram. When the time comes it says **The drop is live** for 48 hours, then hides itself.

## 10. Waiting list (admin → Waiting list)

On a sold-out shoe, or when their size is missing, customers can tap **Notify me**, pick their size and log in with Google. The request appears under **Waiting list**, grouped by shoe and size. A green **This size is in stock now** label shows once you have added that size.

- Press **Email them** to send everyone waiting for that size an email with a link to the shoe (needs Gmail from step 6). They move to **Notified**.
- If they left a phone number, **WhatsApp** opens a ready-made message to them.
- **Done** marks a request as told without emailing; the bin deletes it.

## 11. Wishlist, recently viewed, filters and brand pages

These work by themselves, with nothing to set up:

- **Wishlist:** the heart on every shoe saves it. Saved shoes are on `wishlist.html` (heart icon in the header). For logged-in customers it is also saved to your database, so they can get price-drop emails (step 12).
- **Recently viewed:** the home page and product pages show the last shoes the customer opened.
- **Filters:** price, condition and brand chips above the shoes.
- **Brand pages:** links like `https://jenzy-thrifts.vercel.app/?brand=Nike#shop` show only that brand. Tap a brand name on any product page, or share the link on Instagram.
- **Photo zoom:** on a computer, hovering over the photo magnifies it. Clicking (or tapping on a phone) opens full screen, with swipe and tap-to-zoom.
- **WhatsApp help button:** the green button at the bottom corner opens a chat with your number from `config.js`. On a product page the message already names the shoe.

## 12. Batch 2 features

### Size guide and fit
On a product page, **Size guide** opens a US / UK / EU / cm chart. Customers type their foot length in cm and it tells them their size and whether this shoe has it. In admin → Add product, set **Fit** (True to size / Runs small / Runs large); the page shows it and the size finder adjusts for it.

### Small, fast photos
Every new photo you upload also gets a small 480px version, used in the shop grid. This makes the shop much faster on mobile data and saves your Supabase bandwidth (5 GB/month free). For shoes added **before** this update, open **Products** and press **Optimize old photos** once.

### Deals (admin → Promotions)
- **Bundle deal:** buy 2 or more pairs, get 10% off. You can change the numbers or switch it off.
- **Invite friends:** every logged-in customer gets an invite code on **My Orders**. Their friend gets 10% off the first order; when that order is **Delivered**, the customer gets PKR 300 credit, used automatically on their next order.
- **Discounts never add up.** Each order gets only the biggest one: coupon, bundle, invite code or credit.

### Reviews (admin → Reviews)
Customers can rate an order (stars, text and up to 3 photos) once it is **Delivered**. Reviews show on the website only after you press **Approve**.

### Sell your sneakers (admin → Sell requests)
`sell.html` (linked in the menu and footer) lets customers send you 2–5 photos of shoes they want to sell. Type your offer and press **Send offer**: they get an email (if Gmail is set up) and can accept or decline on the Sell page. Then message them on WhatsApp to arrange pickup, and press **Mark as bought**.

### Automatic emails (admin → Order Alerts), need Gmail from step 6
- **Price drop:** when you lower a shoe's price, logged-in customers who saved it get one email.
- **Cart reminder:** once a day (about 4 PM) customers who left shoes in their cart for a day get one reminder, only if the shoes are still available. It runs by itself through `vercel.json`. Set `CRON_SECRET` (step 3) to protect it, then Redeploy. **Send cart reminders now** runs it by hand.

Both can be switched off in admin → Order Alerts.

### Invoices, labels and courier export (admin → Orders)
- Open an order and press **Print invoice** (A5) or **Print label** (100×150 mm, fits courier label stickers).
- Tick orders (or leave all unticked to use the list you see) and press **Print labels** to print them all, or **Courier CSV** to download a file for PostEx, Leopards or TCS bulk booking. Match the columns once in the courier's upload page. If you open the file in Excel, set the phone column to *Text* so the leading 0 stays.

### Instagram stories (admin → Products)
Press the Instagram button on any shoe. It makes a 1080×1920 story picture with the photo, price and sizes. Download (or Share on a phone), post it, and add a **Link sticker** with the copied shoe link. Visits from these links show as Instagram in **Visitors**.

### Visitors (admin → Visitors)
Counts visitors, page views, where they came from (Instagram, WhatsApp, Google…), phone or computer, the most viewed shoes, and how many visitors ordered. It is anonymous and your own visits on the device you use for admin are not counted.

---

## 13. Batch 3 features

**First:** run the latest `supabase-setup.sql` again (step 2). It adds the order columns (notes, map pin, WhatsApp confirm link) and the tables for blocked customers, staff and blog posts. It's safe to run more than once.

### WhatsApp confirm link (admin → Orders → open an order)
Press **Send confirmation link**. WhatsApp opens with the message filled in. When the customer taps the link and presses **Confirm**, the order shows **Confirmed ✓**. If they press "I didn't order this", the order is cancelled. It's free: no SMS and no paid plan.

### Quick WhatsApp messages (admin → WhatsApp & Safety)
Each order has buttons such as "Order confirmed", "Shipped + tracking" and "Rider will call today". Change the wording, add or remove buttons here. Lines with an empty value (e.g. no tracking number yet) are left out automatically.

### Fake order protection
Every open order gets **Low / Check / High risk**, with the reasons listed (refused parcels before, new customer, phone used on several accounts, high value, no house number, no map pin, not confirmed). The **Risky** tab in Orders lists them. Mark refused parcels as **Returned**: the pairs go back into stock and the refusal counts against that phone and account. In WhatsApp & Safety you can choose to refuse orders automatically after 1, 2 or 3 refused parcels.

### Customers (admin → Customers)
Every buyer with their phones, cities, orders, spending and refused parcels. Tabs: Repeat, Refused, Blocked, Shared phone. **Block** stops a Google account and its phone numbers from ordering. You can also block a number by hand.

### Private notes and staff accounts
Every order has private notes that only the shop team sees. **Staff** (owner only) lets you add helpers by Gmail address and tick what they may use (orders, products, blog, …). They open `/admin` and sign in with Google. Settings pages and money totals stay hidden unless you allow "Sales numbers".

### Authenticity card (admin → open an order → Authenticity card)
Prints a small A6 "Verified Authentic by JENZY" card for each pair to put in the box. The card number can be checked at `jenzythrifts.com/verify/<number>`.

### Blog, brand and city pages (good for Google)
- `/blog`: six starter guides are added automatically. Write more in **admin → Blog / Guides** (Preview, Publish, Draft). A brand name as a tag shows the post on that brand's page.
- `/brands` and `/brand/nike`, `/brand/jordan`, …: a page per brand with its shoes.
- `/city/lahore`, `/city/karachi`, …: delivery pages for 14 cities.

All of these are in the sitemap automatically.

### Checkout
Customers now enter area/sector and nearest landmark and can tap **Pin my location**, so riders find them more easily. The phone must be a Pakistani mobile number.

## 14. Internal links and "last updated" dates (SEO)

Nothing to set up; it all works on its own from your real data.

- **Links between pages:** every shoe page links to its brand page (`/brand/nike`), helpful guides, other brands and city pages. Breadcrumbs (Home › Brands › Nike › shoe) are also given to Google.
- **Guides:** the first mention of a brand in a guide becomes a link to that brand's page (only brands you have in stock). Brand tags on a guide are links too.
- **Home page:** a new "Explore" box shows the brands in stock, the latest guides and city pages. The footer on every page links to the popular brands and all 14 city pages.
- **Dates:** guides show "Published … • Updated …" (Updated only appears if you edited the guide on a later day). Shoe pages show "Listed …" (and "Updated …" when the pair changed). Shop, brand and city pages show "Stock updated …". The sitemap gives Google the same real dates.
- To show a fresh "Updated" date on a guide, open it in admin → Blog, make your changes and save.

## How orders work

1. The customer opens a shoe, picks a size, and clicks **Buy Now** or **Add to Cart**.
2. At checkout, they log in with Google and enter their phone number and address. Payment is Cash on Delivery.
3. The order is saved right away with an order number such as **JT-1001**, and that size is removed from stock. When all sizes are gone, the shoe shows as **Sold out**.
4. The customer can track the order under **My Orders**. They can cancel it while it is still *Pending*.
5. In the admin panel, new orders appear automatically, with an alert. Change the status as the order moves along: **Confirmed → Shipped → Delivered**.
   - When you mark it **Shipped**, add the courier and tracking number (see step 7).
   - If you cancel an order, its pairs go back into stock automatically.
   - The customer gets an email at each step (if Gmail is set up), and you get a Telegram message for every new order and every customer cancellation.

Every number on the dashboard (revenue, orders, customers and so on) is calculated from your real orders.

## Troubleshooting

| Message | Fix |
|---|---|
| "Server not configured: add SUPABASE_SERVICE_ROLE_KEY…" | Do step 3, then redeploy |
| "Admin access is not set up: add ADMIN_EMAILS…" | Do step 3, then redeploy |
| "…is not an admin account" | Sign in with the exact email you put in `ADMIN_EMAILS` |
| "This website address is not allowed in Firebase…" | Do step 4.2 |
| "The admin server (/api/admin) was not found" | Make sure the `api` folder was uploaded to GitHub |
| "The Telegram bot token is wrong" | Copy the token from @BotFather again into `TELEGRAM_BOT_TOKEN`, then redeploy |
| "Open Telegram, search for @…, press START…" when clicking Connect | Do exactly that: open your bot, press START (or send "hi"), then click Connect again |
| "Gmail refused the login" | Create a new App Password (step 6) and check `GMAIL_USER` is the same account, then redeploy |
| "Zoho Mail refused the login" | Check `SMTP_PASS` (use an app-specific password if 2-factor login is on), that SMTP is allowed on your Zoho plan, and `SMTP_HOST` matches your Zoho region. Redeploy after changes |
| "Run the latest supabase-setup.sql…" in Promotions or Waiting list | Do step 2 again |
| Customers see "Size alerts are not switched on yet" | Do step 2 again |
| "Run the latest supabase-setup.sql…" in Reviews, Sell requests, Visitors or Promotions | Do step 2 again |
| Cart reminders never arrive | Check Gmail (step 6) is set up and cart reminders are on in Order Alerts. Vercel → your project → **Settings → Cron Jobs** shows the daily job. |
| Shoe links (`/shoe/…`) show "404" | Make sure `vercel.json` and `api/shoe.js` were uploaded |
| "Run the latest supabase-setup.sql…" in Customers, Blog, Staff or an order | Do step 2 again (batch 3 tables) |
| A helper sees "doesn't have access" | Add their exact Gmail in admin → Staff, and make sure they're not paused |
| Order shows "Run the latest supabase-setup.sql to turn on WhatsApp confirmation links" | Do step 2 again |
| Google login fails inside Instagram or TikTok | Open the site in Chrome or Safari (tap ⋮ → Open in browser) |
