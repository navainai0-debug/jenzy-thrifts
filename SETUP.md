# JENZY THRIFTS: setup guide

The website has two parts:

- **Store pages:** `index.html`, `product.html`, `checkout.html` and `orders.html`.
- **Secure server:** the `api/` folder. Vercel runs it automatically.

Orders are saved in your Supabase database. The server checks prices and stock, so nobody can change a price or buy a pair that is already sold.

The admin panel is at **https://jenzy-thrifts.vercel.app/admin.html**. It is **not** linked anywhere on the store, so only people who know the address can find it.

---

## 1. Upload the files to GitHub

1. Unzip `jenzy-thrifts-update.zip` on your computer.
2. On GitHub, open the repository and click **Add file → Upload files**.
3. Drag **everything inside** the unzipped folder into the page: all files **and** the `api` and `assets` folders.
4. Click **Commit changes**. Vercel redeploys automatically in about a minute.

> Do not copy and paste code into the GitHub editor. Large files get cut off and the site breaks.

## 2. Run the database setup (once)

1. In Supabase, open **SQL Editor → New query**.
2. Paste the whole content of `supabase-setup.sql` and click **Run**.

This is safe to run again later. It creates or updates:

- the orders table,
- the stock-safe order function,
- the security rules,
- the image bucket,
- live updates.

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

---

## How orders work

1. The customer opens a shoe, picks a size, and clicks **Buy Now** or **Add to Cart**.
2. At checkout, they log in with Google and enter their phone number and address. Payment is Cash on Delivery.
3. The order is saved right away with an order number such as **JT-1001**, and that size is removed from stock. When all sizes are gone, the shoe shows as **Sold out**.
4. The customer can track the order under **My Orders**. They can cancel it while it is still *Pending*.
5. In the admin panel, new orders appear automatically, with an alert. Change the status as the order moves along: **Confirmed → Shipped → Delivered**.
   - If you cancel an order, its pairs go back into stock automatically.

Every number on the dashboard (revenue, orders, customers and so on) is calculated from your real orders.

## Troubleshooting

| Message | Fix |
|---|---|
| "Server not configured: add SUPABASE_SERVICE_ROLE_KEY…" | Do step 3, then redeploy |
| "Admin access is not set up: add ADMIN_EMAILS…" | Do step 3, then redeploy |
| "…is not an admin account" | Sign in with the exact email you put in `ADMIN_EMAILS` |
| "This website address is not allowed in Firebase…" | Do step 4.2 |
| "The admin server (/api/admin) was not found" | Make sure the `api` folder was uploaded to GitHub |
| Google login fails inside Instagram or TikTok | Open the site in Chrome or Safari (tap ⋮ → Open in browser) |
