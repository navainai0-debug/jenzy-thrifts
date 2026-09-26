# JENZY THRIFTS: setup guide

The website has two parts:

- **Store pages:** `index.html`, `product.html`, `checkout.html` and `orders.html`.
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

This is safe to run again, and **you must run it again after this update**: it adds the tracking-number columns and the settings table used by order alerts. It creates or updates:

- the orders table,
- the stock-safe order function,
- the security rules,
- the image bucket,
- live updates,
- courier and tracking-number columns on orders,
- a private settings table (remembers your Telegram chat).

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
| `COUPONS` | `JENZY20:20` | Discount codes as `CODE:PERCENT`, comma separated, e.g. `JENZY20:20,EID10:10`. Set it to an empty value to turn codes off. |
| `MAX_PENDING_ORDERS` | `5` | The most pending orders one customer can have at a time |
| `SHOP_TIMEZONE` | `Asia/Karachi` | The time zone used for "today" in the dashboard |

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

### Gmail (emails to you and your customers)

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

---

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
| Shoe links (`/shoe/…`) show "404" | Make sure `vercel.json` and `api/shoe.js` were uploaded |
| Google login fails inside Instagram or TikTok | Open the site in Chrome or Safari (tap ⋮ → Open in browser) |
