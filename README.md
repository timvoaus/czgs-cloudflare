# CZGS Cloudflare Worker Dashboard

Cloudflare Zero Trust Gateway Scripts (CZGS) Worker Dashboard is a lightweight Cloudflare Worker that provides a web-based dashboard and API proxy for managing Zero Trust DNS blocklists and allowlists.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/timvoaus/czgs-cloudflare)

---

## Post-Deployment Setup Instructions

After deploying the Worker using the **Deploy to Cloudflare** button, you must run the following setup steps to configure the database schema and secrets.

### 1. Initialize D1 Database Schema
The Deploy button will create a D1 database named `czgs-db` under your account. To initialize its tables:
1. Clone this repository locally or open a terminal in this directory.
2. Log in with Wrangler:
   ```bash
   npx wrangler login
   ```
3. Run the schema file on the remote database:
   ```bash
   npx wrangler d1 execute czgs-db --remote --file=schema.sql -y
   ```

### 2. Configure Worker Secrets
The worker requires access to your Cloudflare account to make Zero Trust API requests. Set the following secrets on your deployed worker:
1. **API Token**: Create a Cloudflare API Token with `Account -> Zero Trust -> Edit` permissions, then run:
   ```bash
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   ```
   (Paste your API Token when prompted).

2. **Account ID**: Locate your Cloudflare Account ID and run:
   ```bash
   npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   ```
   (Paste your Account ID when prompted).

---

## Features
- Lightweight dashboard served directly from Cloudflare Worker assets.
- Real-time lists synchronization status.
- D1 Database storage for settings, sync logs, and traffic maps.
- Scheduled Cron job (`*/15 * * * *`) to auto-sync configurations.
