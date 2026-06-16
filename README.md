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
You can add them directly via the Cloudflare Web Dashboard as secure secrets:
1. In your [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Workers & Pages** -> select the deployed **`czgs-dashboard`** worker.
2. Navigate to the **Settings** tab at the top.
3. Click **Variables** in the left sidebar.
4. Under **Environment Variables**, click **Add variable**.
5. Input the following two fields:
   - **Name**: `CLOUDFLARE_ACCOUNT_ID` | **Value**: *(Paste your Account ID)*
   - **Name**: `CLOUDFLARE_API_TOKEN` | **Value**: *(Paste your API Token)* -> **Make sure to click "Encrypt"** on this row to securely encrypt it as a secret!
6. Click **Save and deploy**.

*Alternatively, you can set them via command line (Wrangler CLI):*
```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
# (Paste your API Token when prompted)

npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
# (Paste your Account ID when prompted)
```

### Step 4: Run the Initial Synchronization
Once these are saved, you can open your worker dashboard or refresh the page. Click Refresh button to load Analytic and traffic map and click **Run Update** to sync your gateway scripts!
1. Open your deployed dashboard URL in your browser: `https://czgs-dashboard.<your-subdomain>.workers.dev`.
2. Refresh/reload the page to ensure the configuration status updates.
3. Navigate to the **Quick Update** tab and click the **Run Update** button to trigger the initial list download and synchronization.

---

## Features
- Lightweight dashboard served directly from Cloudflare Worker assets.
- Real-time lists synchronization status.
- D1 Database storage for settings, sync logs, and traffic maps.
- Scheduled Cron job (`*/15 * * * *`) to auto-sync configurations.
