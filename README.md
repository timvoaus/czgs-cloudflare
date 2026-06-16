# CZGS Cloudflare Worker Dashboard

Cloudflare Zero Trust Gateway Scripts (CZGS) Worker Dashboard is a lightweight Cloudflare Worker that provides a web-based dashboard and API proxy for managing Zero Trust DNS blocklists and allowlists.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/timvoaus/czgs-cloudflare)

---

## 🚀 One-Click Deploy Flow

When you click the **Deploy to Cloudflare** button, you will be guided through a simple setup page:

1. **Connect Git Account**: Cloudflare requires you to connect your GitHub or GitLab account. Cloudflare will clone this template repository into your personal account so that future updates are deployed automatically.
2. **Select D1 Database**: Cloudflare will automatically detect the database requirement. In the **Select D1 database** dropdown, select **`+ Create new`**. Cloudflare will automatically provision a new D1 database instance and bind it to your worker as `env.DB`.
3. **Deploy**: Click **Deploy** to publish the worker and the static assets.

---

## 🛠️ Post-Deployment Setup Instructions

After the Worker is successfully deployed, you must complete the setup by creating the database schema and adding your secrets.

### Step 1: Initialize the D1 Database Schema
The one-click deploy provisions a blank D1 database. To create the necessary tables:
1. Clone your newly created GitHub repository locally and open a terminal in its directory.
2. Log in to your Cloudflare account via Wrangler:
   ```bash
   npx wrangler login
   ```
3. Run the schema creation file on the remote database:
   ```bash
   npx wrangler d1 execute czgs-db --remote --file=schema.sql -y
   ```

### Step 2: Prepare Your Cloudflare Credentials
The Worker needs credentials to authenticate against your Cloudflare account and manage the Zero Trust Gateway lists.

1. **Get Cloudflare Account ID**:
   - Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/).
   - Select any website on your account, or go to **Workers & Pages** -> **Overview**.
   - Look at the right-hand sidebar for your **Account ID**.
   - Copy this 32-character string.

2. **Generate Cloudflare API Token**:
   - Go to the [API Tokens section of your User Profile](https://dash.cloudflare.com/profile/api-tokens).
   - Click **Create Token** -> Click **Use Custom Token**.
   - Enter a token name (e.g., `CZGS Gateway Token`).
   - Under **Permissions**, add:
     - **Account** -> **Zero Trust** -> **Edit**
   - Click **Continue to summary** -> **Create Token**.
   - Copy the generated API Token (keep it secure!).

### Step 3: Provide Credentials to the Worker
You must configure the Account ID and API Token as secrets on the deployed Worker so it can call Cloudflare APIs.

#### Option A: Via the Cloudflare Web Dashboard (Recommended)
1. Go to your [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** -> Select your **`czgs-dashboard`** worker.
3. Click on the **Settings** tab.
4. Click **Variables** in the left sidebar.
5. In the **Environment Variables** section, click **Add**.
6. Add the following variables:
   - **Name**: `CLOUDFLARE_ACCOUNT_ID` | **Value**: `<Your Account ID>`
   - **Name**: `CLOUDFLARE_API_TOKEN` | **Value**: `<Your API Token>` | Check **Encrypt** (to store it securely as a secret).
7. Click **Save and Deploy**.

#### Option B: Via command line (Wrangler CLI)
Open a terminal in your cloned project folder and run:
```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
# (Paste your API Token when prompted)

npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
# (Paste your Account ID when prompted)
```

### Step 4: Run the Initial Synchronization
After you have configured the database schema and the worker secrets:
1. Open your deployed dashboard URL in your browser: `https://czgs-dashboard.<your-subdomain>.workers.dev`.
2. Refresh/reload the page to ensure the configuration status updates.
3. Navigate to the **Quick Update** tab and click the **Run Update** button to trigger the initial list download and synchronization.

---

## Features
- Lightweight dashboard served directly from Cloudflare Worker assets.
- Real-time lists synchronization status.
- D1 Database storage for settings, sync logs, and traffic maps.
- Scheduled Cron job (`*/15 * * * *`) to auto-sync configurations.
