import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function putSecret(name, value) {
  console.log(`Setting secret: ${name}...`);
  // Use spawnSync to write directly to stdin, preventing shell newline issues cross-platform
  const child = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    encoding: 'utf8',
    shell: true
  });
  if (child.status !== 0) {
    throw new Error(`Failed to set secret ${name}: ${child.stderr || child.stdout}`);
  }
}

async function main() {
  console.log('==============================================');
  console.log('   Cloudflare New Account One-Click Deployer  ');
  console.log('==============================================\n');

  try {
    // 1. Force login by logging out first
    console.log('Logging out of any previous Cloudflare sessions in Wrangler...');
    try {
      execSync('npx wrangler logout', { stdio: 'ignore' });
    } catch (e) {
      // Ignore if already logged out
    }

    console.log('Opening browser for a fresh Cloudflare login...');
    execSync('npx wrangler login', { stdio: 'inherit' });
    console.log('✅ Wrangler logged in successfully.\n');

    // 2. Ask for Cloudflare credentials and dashboard admin setup
    const apiToken = (await question('Enter CLOUDFLARE_API_TOKEN: ')).trim();
    const accountId = (await question('Enter CLOUDFLARE_ACCOUNT_ID: ')).trim();
    const dashboardUsername = (await question('Enter DASHBOARD_USERNAME (default: admin): ')).trim() || 'admin';
    const dashboardPassword = (await question('Enter DASHBOARD_PASSWORD (required to secure dashboard): ')).trim();

    if (!apiToken || !accountId) {
      console.error('\n❌ Both API Token and Account ID are required to configure the worker.');
      process.exit(1);
    }

    if (!dashboardPassword) {
      console.error('\n❌ DASHBOARD_PASSWORD is required to secure the web dashboard.');
      process.exit(1);
    }

    // 3. Check if D1 database "czgs-db" already exists
    console.log('\nChecking existing D1 databases...');
    const d1ListOutput = execSync('npx wrangler d1 list --json', { encoding: 'utf8' });
    let existingDb = null;
    try {
      const dbList = JSON.parse(d1ListOutput);
      if (Array.isArray(dbList)) {
        existingDb = dbList.find(db => db.name === 'czgs-db');
      }
    } catch (e) {
      console.log('Could not parse D1 list in JSON format, continuing with standard flow...');
    }

    let dbId = '';
    if (existingDb) {
      console.log(`⚠️ Database "czgs-db" already exists (ID: ${existingDb.uuid}).`);
      console.log('\nWhat would you like to do?');
      console.log('[1] Reuse the existing database (Recommended)');
      console.log('[2] Delete and recreate a new database');
      const choice = (await question('Enter option (1 or 2): ')).trim();

      if (choice === '2') {
        console.log('\nDeleting existing database "czgs-db"...');
        execSync('npx wrangler d1 delete czgs-db -y', { stdio: 'inherit' });
        
        console.log('\nCreating a fresh D1 database "czgs-db"...');
        const d1Output = execSync('npx wrangler d1 create czgs-db', { encoding: 'utf8' });
        console.log(d1Output);
        const dbIdMatch = d1Output.match(/database_id["']?\s*[:=]\s*["']([^"']+)["']/i);
        if (!dbIdMatch) {
          throw new Error('Could not parse database_id from D1 creation response.');
        }
        dbId = dbIdMatch[1];
        console.log(`✅ Database recreated with ID: ${dbId}`);
      } else {
        dbId = existingDb.uuid;
        console.log(`✅ Reusing existing database with ID: ${dbId}`);
      }
    } else {
      console.log('\nCreating D1 database "czgs-db"...');
      const d1Output = execSync('npx wrangler d1 create czgs-db', { encoding: 'utf8' });
      console.log(d1Output);
      const dbIdMatch = d1Output.match(/database_id["']?\s*[:=]\s*["']([^"']+)["']/i);
      if (!dbIdMatch) {
        throw new Error('Could not parse database_id from D1 creation response.');
      }
      dbId = dbIdMatch[1];
      console.log(`✅ Database created with ID: ${dbId}`);
    }

    // 4. Update wrangler.json
    console.log('\nUpdating wrangler.json with the new database ID...');
    const wranglerJsonPath = path.join(__dirname, 'wrangler.json');
    const wranglerJson = JSON.parse(fs.readFileSync(wranglerJsonPath, 'utf8'));
    
    if (wranglerJson.d1_databases && wranglerJson.d1_databases[0]) {
      wranglerJson.d1_databases[0].database_id = dbId;
      fs.writeFileSync(wranglerJsonPath, JSON.stringify(wranglerJson, null, 2), 'utf8');
      console.log('✅ wrangler.json updated successfully.');
    } else {
      throw new Error('wrangler.json does not contain D1 databases configuration.');
    }

    // 5. Initialize Schema
    console.log('\nInitializing database schema (schema.sql)...');
    execSync('npx wrangler d1 execute czgs-db --remote --file=schema.sql -y', { stdio: 'inherit' });
    console.log('✅ Database schema initialized.');

    // 6. Set secrets
    console.log('\nSetting secrets on the worker...');
    putSecret('CLOUDFLARE_API_TOKEN', apiToken);
    putSecret('CLOUDFLARE_ACCOUNT_ID', accountId);
    putSecret('DASHBOARD_USERNAME', dashboardUsername);
    putSecret('DASHBOARD_PASSWORD', dashboardPassword);
    console.log('✅ Secrets configured.');

    // 7. Deploy
    console.log('\nDeploying worker and dashboard assets to Cloudflare...');
    execSync('npx wrangler deploy', { stdio: 'inherit' });
    console.log('\n🚀 One-click deployment completed successfully! Your dashboard is live.');

  } catch (err) {
    console.error(`\n❌ Deployment failed: ${err.message}`);
  } finally {
    rl.close();
  }
}

main();
