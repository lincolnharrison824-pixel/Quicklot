# QuickLot setup

Step 1 works on its own. You can try QuickLot on a real car today, without accounts or any cost. Steps 2 to 5 add Google sign-in, saved cars, and the AI writer.

Menus on these sites change from time to time. If a label doesn't match exactly, look for the closest one, or ask.

## What it costs

| Thing | Cost |
| --- | --- |
| Chrome extension in local mode (step 1) | Free |
| Supabase (accounts and database), Free plan | $0 |
| Google sign-in (Google Cloud) | $0 |
| Vercel, Hobby plan | $0 while it's just you testing. Vercel says Hobby is for non-commercial use, so plan on Pro ($20 a month) once you charge customers. |
| Claude API (the AI writer) | Pay as you go. My estimate is about 1 to 2 cents per listing. I haven't measured that yet. You buy credits up front, and the smallest top-up is $5. |
| Chrome Web Store (only to publish for other people later) | $5 once |

Nothing in steps 2 to 5 charges you without you entering a card yourself.

---

## Step 1: Load the extension (free, about 5 minutes)

1. Get the code on your computer. Open https://github.com/lincolnharrison824-pixel/quicklot, click the green **Code** button, then **Download ZIP**. Unzip it somewhere you'll keep it, like your Documents folder.
2. In Chrome, open `chrome://extensions` (type it in the address bar).
3. Turn on **Developer mode** with the switch at the top right.
4. Click **Load unpacked** and pick the `extension` folder inside the unzipped `quicklot` folder.
5. Click the puzzle-piece icon at the right of Chrome's toolbar, then the pin next to **QuickLot**.
6. Open a car on genesisofconway.com, for example the [2023 GV70](https://www.genesisofconway.com/used-+Conway-2023-Genesis-GV70-25T-KMUMADTB5PU123389), and click the QuickLot icon.
7. Go through the short setup (risk warning, writing style, look). Then click **Write listing**, read it over, and click **Fill Marketplace**.
8. QuickLot opens Marketplace's vehicle form and fills it. A QuickLot panel at the bottom right shows each field as **Filled** or **Check**. Fix anything marked Check, pick the condition, tick Clean title only if it's true, then click Next and Publish yourself. If you don't want to publish the test, close the tab instead.

If anything goes wrong, take a screenshot of the QuickLot panel and send it to me. That panel shows exactly which fields worked.

---

## Step 2: Create the Supabase project (free)

1. Go to https://supabase.com/dashboard and sign in with your Google account.
2. Click **New project**. Name: `quicklot`. Database password: click **Generate a password** and save it in your notes. Region: **East US (North Virginia)**. Plan: **Free**. Click **Create new project**, then wait about 2 minutes.
3. In the left menu, click **SQL Editor**, then **New query**.
4. Open `supabase/migrations/0001_init.sql` from the code, copy all of it, paste it into the query box, and click **Run**. You should see "Success. No rows returned".
5. Click **Project Settings** (the gear at the bottom left), then **API Keys**. Copy the **Publishable key** (or the **anon public** key under Legacy API Keys). Then open **Data API** in the same menu and copy the **Project URL**, which looks like `https://abcdxyz.supabase.co`. You'll need both in steps 4 and 5.

## Step 3: Turn on Google sign-in (free)

**Your extension ID** is always `nfgdpjkijaefboopngejalcbgjiomdkd` (it's fixed in the code, so it doesn't change when you move or re-download the folder). If you loaded a version older than 0.2.0, remove that QuickLot card on `chrome://extensions` and click **Load unpacked** again so Chrome picks up the fixed ID.

**Google side:**
1. Go to https://console.cloud.google.com/projectcreate. Name it `QuickLot` and click **Create**.
2. Go to https://console.cloud.google.com/auth/overview with the QuickLot project selected and click **Get started**. App name: `QuickLot`. Support email: yours. Audience: **External**. Contact email: yours. Agree and click **Create**.
3. Go to https://console.cloud.google.com/auth/audience and, under **Test users**, click **Add users** and add your own Gmail address.
4. Go to https://console.cloud.google.com/auth/clients and click **Create client**. Application type: **Web application**. Name: `QuickLot Supabase`. Under **Authorized redirect URIs**, click **Add URI** and paste `https://YOUR-PROJECT.supabase.co/auth/v1/callback`, using your Project URL from step 2. Click **Create**. Copy the **Client ID** and **Client secret**.

**Supabase side:**
5. In Supabase, go to **Authentication**, then **Sign In / Providers**, then **Google**. Turn it on, paste the Client ID and Client secret, and click **Save**.
6. Go to **Authentication**, then **URL Configuration**. Under **Redirect URLs**, click **Add URL** and paste `https://nfgdpjkijaefboopngejalcbgjiomdkd.chromiumapp.org/**`. Click **Save**.

## Step 4: AI key and the Vercel backend

**Claude API key (paid, pay as you go):**
1. Go to https://platform.claude.com and sign in or create an account.
2. Open **Settings**, then **Billing**, and buy the smallest amount of credits ($5). Turning auto-reload off keeps your spending capped at what you bought.
3. Open **Settings**, then **API Keys**, and click **Create Key**. Name it `quicklot` and copy the key. You only see it once.

**Vercel (free Hobby plan):**
4. Go to https://vercel.com/new and sign in with GitHub. Next to **quicklot**, click **Import**.
5. Set **Root Directory** to `web` (click **Edit** next to it).
6. Open **Environment Variables** and add these four:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Project URL from step 2
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your publishable or anon key from step 2
   - `ANTHROPIC_API_KEY` = the key from step 4.3
   - `DAILY_LISTING_LIMIT` = `40`
7. Click **Deploy**. When it finishes, copy the address it shows, like `https://quicklot-xxxx.vercel.app`.

## Step 5: Connect the extension

1. Open `extension/config.js` in the folder from step 1, using TextEdit (Mac) or Notepad (Windows).
2. Fill in the three values between the quotes:
   - `SUPABASE_URL`: your Project URL
   - `SUPABASE_ANON_KEY`: your publishable or anon key
   - `API_URL`: your Vercel address
3. Save the file. On `chrome://extensions`, click the circular reload arrow on the QuickLot card.
4. Click the QuickLot icon. You'll see **Continue with Google**. After signing in, run the setup again. Listings are now written by the AI, and your cars are saved to your account under **My cars**.

If the AI writer can't be reached, QuickLot says so and uses the free built-in writer, so you're never stuck.
