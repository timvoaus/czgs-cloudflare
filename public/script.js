import {
  downloadAndProcessLists,
  syncGatewayLists,
  upsertGatewayRule,
  defragmentLists,
  fullReset
} from './sync-engine.js';

// Recommended lists (same as Constants in backend)
const RECOMMENDED_ALLOWLIST_URLS = [
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_45.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/banks.txt",
  "https://raw.githubusercontent.com/Dogino/Discord-Phishing-URLs/main/official-domains.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/mac.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/windows.txt",
  "https://raw.githubusercontent.com/boutetnico/url-shorteners/master/list.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/firefox.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/android.txt",
  "https://raw.githubusercontent.com/TogoFire-Home/AD-Settings/main/Filters/whitelist.txt",
  "https://raw.githubusercontent.com/DandelionSprout/AdGuard-Home-Whitelist/master/whitelist.txt",
  "https://raw.githubusercontent.com/AdguardTeam/AdGuardSDNSFilter/master/Filters/exclusions.txt",
  "https://raw.githubusercontent.com/AdguardTeam/HttpsExclusions/master/exclusions/issues.txt",
];

const RECOMMENDED_BLOCKLIST_URLS = [
  "https://raw.githubusercontent.com/bigdargon/hostsVN/master/filters/adservers-all.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_5.txt",
  "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/multi-onlydomains.txt",
  "https://adguardteam.github.io/HostlistsRegistry/assets/filter_16.txt",
];

document.addEventListener('DOMContentLoaded', () => {
  const terminalHost = document.getElementById('terminal');
  const trafficMapDashboard = window.createTrafficMapDashboard?.();

  // Preload traffic map is deferred until after auth verification in verifyAuthAndInit

  // Terminal Setup
  const term = createTerminal(terminalHost);

  let isSyncing = false;
  window.addEventListener('beforeunload', (e) => {
    if (isSyncing) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function createTerminal(host) {
    if (window.Terminal && window.FitAddon) {
      host.classList.add('has-xterm');
      const xterm = new Terminal({
        theme: {
          background: '#00000000',
          foreground: '#d8e7ff',
          cursor: '#ff9e42',
          cursorAccent: '#0b1224',
          selectionBackground: 'rgba(255, 158, 66, 0.28)',
          black: '#102034',
          brightBlack: '#637693',
          red: '#ff7a70',
          brightRed: '#ffb4ad',
          green: '#51d89b',
          brightGreen: '#8cf0c0',
          yellow: '#ffd166',
          brightYellow: '#ffe199',
          blue: '#7db6ff',
          brightBlue: '#b6d6ff',
          magenta: '#d8b4fe',
          brightMagenta: '#ead6ff',
          cyan: '#67e8f9',
          brightCyan: '#a5f3fc',
          white: '#e8f1ff',
          brightWhite: '#ffffff'
        },
        fontFamily: '"SF Mono", "Cascadia Code", Consolas, monospace',
        fontWeight: 600,
        fontWeightBold: 800,
        fontSize: 13,
        lineHeight: 1.42,
        convertEol: true,
        allowTransparency: true
      });

      const fitAddon = new FitAddon.FitAddon();
      xterm.loadAddon(fitAddon);
      xterm.open(host);

      const observer = new ResizeObserver(() => {
        fitAddon.fit();
      });
      observer.observe(host);

      setTimeout(() => {
        fitAddon.fit();
        xterm.writeln('Welcome to Cloudflare Zerotrust Gateway Scripts');
        xterm.writeln('Waiting for commands...\n');
      }, 100);

      return xterm;
    }

    const fallbackOutput = document.createElement('pre');
    host.classList.add('has-fallback');
    fallbackOutput.className = 'fallback-terminal';
    host.appendChild(fallbackOutput);

    const stripAnsi = (value) => String(value).replace(/\x1B\[[0-9;]*m/g, '');
    const scrollToEnd = () => {
      host.scrollTop = host.scrollHeight;
    };

    const fallback = {
      write(data) {
        fallbackOutput.textContent += stripAnsi(data);
        scrollToEnd();
      },
      writeln(data = '') {
        this.write(`${data}\n`);
      },
      clear() {
        fallbackOutput.textContent = '';
      }
    };

    fallback.writeln('Welcome to Cloudflare Zerotrust Gateway Scripts');
    fallback.writeln('Waiting for commands...\n');
    return fallback;
  }

  // Connection Status indicator (using polling health check instead of websockets)
  const statusIndicator = document.getElementById('connection-status');
  const loginContainer = document.getElementById('login-container');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const appContainer = document.querySelector('.app-container');

  function showLoginOverlay(isError = false) {
    if (loginContainer) loginContainer.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';
    if (isError && loginError) {
      loginError.textContent = 'Invalid username or password.';
      loginError.style.display = 'block';
    } else if (loginError) {
      loginError.style.display = 'none';
    }
  }

  function hideLoginOverlay() {
    if (loginContainer) loginContainer.style.display = 'none';
    if (appContainer) appContainer.style.display = 'flex';
  }

  async function checkConnection() {
    try {
      const headers = {};
      const credentials = localStorage.getItem('czgs_credentials');
      if (credentials) {
        headers['Authorization'] = `Basic ${credentials}`;
      }
      const res = await fetch('/api/health', { headers });
      if (res.status === 401) {
        statusIndicator.textContent = 'Unauthorized';
        statusIndicator.classList.remove('connected');
        statusIndicator.style.color = 'var(--danger)';
        showLoginOverlay();
        return false;
      } else if (res.ok) {
        statusIndicator.textContent = 'Connected';
        statusIndicator.classList.add('connected');
        statusIndicator.style.color = '';
        return true;
      } else {
        statusIndicator.textContent = 'Connection Error';
        statusIndicator.classList.remove('connected');
        statusIndicator.style.color = 'var(--danger)';
        return false;
      }
    } catch (err) {
      statusIndicator.textContent = 'Disconnected';
      statusIndicator.classList.remove('connected');
      statusIndicator.style.color = 'var(--danger)';
      return false;
    }
  }

  async function verifyAuthAndInit() {
    const credentials = localStorage.getItem('czgs_credentials');
    
    // If no credentials, show login screen immediately without API check
    if (!credentials) {
      showLoginOverlay();
      return;
    }

    const isAuthed = await checkConnection();
    if (isAuthed) {
      hideLoginOverlay();

      const authIndicator = document.getElementById('auth-status-indicator');
      const logoutBtn = document.getElementById('nav-logout');
      if (authIndicator) {
        authIndicator.textContent = 'Protected';
        authIndicator.style.color = '';
      }
      if (logoutBtn) logoutBtn.style.display = '';

      if (trafficMapDashboard && !window.trafficMapInitialLoaded) {
        trafficMapDashboard.load();
        window.trafficMapInitialLoaded = true;
      }
      if (document.getElementById('section-dns-analytics')?.classList.contains('active') && !dnsChart) {
        initDNSChart();
        loadDNSAnalytics();
      }
    } else {
      showLoginOverlay();
    }
  }

  // Password Visibility Toggle
  const passwordToggle = document.getElementById('login-password-toggle');
  if (passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const passwordInput = document.getElementById('login-password');
      const eyeShow = passwordToggle.querySelector('.eye-show');
      const eyeHide = passwordToggle.querySelector('.eye-hide');
      if (passwordInput && eyeShow && eyeHide) {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          eyeShow.style.display = 'none';
          eyeHide.style.display = 'block';
        } else {
          passwordInput.type = 'password';
          eyeShow.style.display = 'block';
          eyeHide.style.display = 'none';
        }
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const submitBtn = document.getElementById('login-submit-btn');
      const btnText = submitBtn ? submitBtn.querySelector('.btn-text') : null;
      const btnSpinner = submitBtn ? submitBtn.querySelector('.btn-spinner') : null;
      if (!usernameInput || !passwordInput) return;

      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      const credentials = btoa(`${username}:${password}`);

      // UI Loading State
      if (submitBtn) submitBtn.disabled = true;
      if (btnText) btnText.textContent = 'Unlocking...';
      if (btnSpinner) btnSpinner.style.display = 'block';
      usernameInput.disabled = true;
      passwordInput.disabled = true;
      if (loginError) loginError.style.display = 'none';

      try {
        const res = await fetch('/api/health', {
          headers: { 'Authorization': `Basic ${credentials}` }
        });
        if (res.ok) {
          localStorage.setItem('czgs_credentials', credentials);
          hideLoginOverlay();
          window.location.reload();
        } else {
          // Reset UI
          if (submitBtn) submitBtn.disabled = false;
          if (btnText) btnText.textContent = 'Unlock Dashboard';
          if (btnSpinner) btnSpinner.style.display = 'none';
          usernameInput.disabled = false;
          passwordInput.disabled = false;

          if (loginError) {
            loginError.textContent = 'Invalid username or password.';
            loginError.style.display = 'block';
          }
        }
      } catch (err) {
        // Reset UI
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.textContent = 'Unlock Dashboard';
        if (btnSpinner) btnSpinner.style.display = 'none';
        usernameInput.disabled = false;
        passwordInput.disabled = false;

        if (loginError) {
          loginError.textContent = 'Connection error: ' + err.message;
          loginError.style.display = 'block';
        }
      }
    });
  }

  const logoutBtn = document.getElementById('nav-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('czgs_credentials');
      window.location.reload();
    });
  }

  // REST API Client helper
  async function fetchApi(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    const credentials = localStorage.getItem('czgs_credentials');
    if (credentials) {
      headers['Authorization'] = `Basic ${credentials}`;
    }
    const response = await fetch(url, {
      ...options,
      headers
    });
    if (response.status === 401) {
      localStorage.removeItem('czgs_credentials');
      showLoginOverlay();
      throw new Error('Unauthorized');
    }
    if (!response.ok) {
      const errText = await response.text();
      let errMsg = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error) errMsg = errJson.error;
      } catch (_) {}
      throw new Error(errMsg);
    }
    return response.json();
  }

  // Domain parsing helper
  function extractDomain(domain) {
    const parts = domain.split(".");
    const extractedDomains = [];
    for (let i = 0; i < parts.length; i++) {
      const subdomains = parts.slice(i).join(".");
      extractedDomains.unshift(subdomains);
    }
    return extractedDomains;
  }

  // Script Progress Elements
  const progressElements = {
    update: {
      container: document.getElementById('update-progress'),
      phase: document.getElementById('progress-phase'),
      fraction: document.getElementById('progress-fraction'),
      bar: document.getElementById('progress-bar'),
    },
    defragment: {
      container: document.getElementById('defragment-progress'),
      phase: document.getElementById('defragment-progress-phase'),
      fraction: document.getElementById('defragment-progress-fraction'),
      bar: document.getElementById('defragment-progress-bar'),
    },
    'full-reset': {
      container: document.getElementById('full-reset-progress'),
      phase: document.getElementById('full-reset-progress-phase'),
      fraction: document.getElementById('full-reset-progress-fraction'),
      bar: document.getElementById('full-reset-progress-bar'),
    },
  };

  function updateProgress(data) {
    const operation = data.operation || 'update';
    const progress = progressElements[operation] || progressElements.update;
    if (!progress?.container || !progress.phase || !progress.fraction || !progress.bar) return;

    progress.container.style.display = 'block';

    const phase = data.phase || 'progress';
    const phaseDisplay = phase.charAt(0).toUpperCase() + phase.slice(1);
    progress.phase.textContent = data.message || `${phaseDisplay}...`;
    progress.fraction.textContent = `${data.current}/${data.total}`;

    const percent = data.total > 0 ? (data.current / data.total) * 100 : 0;
    progress.bar.style.width = `${Math.min(percent, 100)}%`;
  }

  function resetProgress(operation, message = 'Starting...') {
    const progress = progressElements[operation];
    if (!progress?.container || !progress.phase || !progress.fraction || !progress.bar) return;
    progress.phase.textContent = message;
    progress.fraction.textContent = '0/0';
    progress.bar.style.width = '0%';
    progress.container.style.display = 'block';
  }

  function hideProgress(operation) {
    const progress = progressElements[operation];
    if (progress?.container) {
      progress.container.style.display = 'none';
    }
  }

  document.getElementById('btn-clear-term').addEventListener('click', () => {
    term.clear();
  });

  // Navigation Logic
  const navBtns = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.section');
  const contentSections = document.querySelector('.content-sections');
  const currentViewLabel = document.getElementById('current-view-label');
  let activeDashboardTab = document.querySelector('.nav-btn.active')?.dataset.target || 'dns-analytics';

  const mobileLayoutQuery = window.matchMedia('(max-width: 980px)');
  const updateContentOverflow = () => {
    if (!contentSections) return;
    if (mobileLayoutQuery.matches) {
      contentSections.classList.remove('is-overflowing');
      return;
    }

    const isOverflowing = contentSections.scrollHeight > contentSections.clientHeight + 1;
    contentSections.classList.toggle('is-overflowing', isOverflowing);
  };
  const scheduleContentOverflowCheck = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(updateContentOverflow);
    });
  };

  if (window.ResizeObserver && contentSections) {
    const contentResizeObserver = new ResizeObserver(scheduleContentOverflowCheck);
    contentResizeObserver.observe(contentSections);
    sections.forEach(section => contentResizeObserver.observe(section));
  }

  if (window.MutationObserver && contentSections) {
    const contentMutationObserver = new MutationObserver(scheduleContentOverflowCheck);
    contentMutationObserver.observe(contentSections, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
  }

  window.addEventListener('resize', scheduleContentOverflowCheck);
  mobileLayoutQuery.addEventListener?.('change', scheduleContentOverflowCheck);
  scheduleContentOverflowCheck();

  // Terminal container for show/hide logic
  const terminalContainer = document.querySelector('.terminal-container');

  // Hide terminal on initial load if DNS Analytics is the active section
  if (terminalContainer && document.getElementById('section-dns-analytics')?.classList.contains('active')) {
    terminalContainer.style.display = 'none';
  }

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const currentActive = document.querySelector('.section.visible');
      const nextSection = document.getElementById(`section-${targetId}`);
      if (!nextSection) return;

      if (currentActive === nextSection) return;
      activeDashboardTab = targetId;

      // Update active nav immediately
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentViewLabel.textContent = btn.dataset.label || btn.textContent.trim();

      // Hide current section
      if (currentActive) {
        currentActive.classList.remove('active');
        currentActive.classList.remove('visible');
      }
      scheduleContentOverflowCheck();

      // Show/hide terminal based on section
      if (targetId === 'dns-analytics' || targetId === 'traffic-map') {
        if (terminalContainer) terminalContainer.style.display = 'none';
      } else {
        if (terminalContainer) terminalContainer.style.display = '';
      }

      // Step 1: make next section display:block (visible class)
      // Step 2: on next frame add active to trigger CSS transition
      nextSection.classList.add('visible');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          nextSection.classList.add('active');
          scheduleContentOverflowCheck();

          if (targetId === 'dns-analytics') {
            if (!dnsChart) {
              initDNSChart();
            }
            loadDNSAnalytics();
          } else if (targetId === 'manage-urls') {
            loadUrls();
          } else if (targetId === 'update-ipv4-location') {
            loadIpv4Location();
          } else if (targetId === 'manage-rewrites') {
            loadDnsRewrites();
          } else if (targetId === 'manage-allowlist') {
            loadAllowlist();
          } else if (targetId === 'manage-denylist') {
            loadDenylist();
          } else if (targetId === 'traffic-map') {
            trafficMapDashboard?.load();
          }
        });
      });
    });
  });

  // --- Dashboard Actions ---
  const btnRunUpdate = document.getElementById('btn-run-update');
  btnRunUpdate.addEventListener('click', async () => {
    isSyncing = true;
    btnRunUpdate.disabled = true;
    btnDefragment.disabled = true;
    btnFullReset.disabled = true;

    term.writeln('\n\x1b[36m--- Starting Update ---\x1b[0m\n');
    resetProgress('update');

    const log = (msg) => {
      term.writeln(msg);
    };

    const updateStarted = Date.now();

    try {
      log('Retrieving settings from database...');
      const settingsRes = await fetchApi('/api/settings');
      const settings = settingsRes.settings || {};

      let blocklistUrls = RECOMMENDED_BLOCKLIST_URLS;
      let allowlistUrls = RECOMMENDED_ALLOWLIST_URLS;

      if (settings.blocklist_urls) {
        try {
          blocklistUrls = JSON.parse(settings.blocklist_urls);
        } catch (_) {
          blocklistUrls = settings.blocklist_urls.split('\n').map(u => u.trim()).filter(Boolean);
        }
      }
      if (settings.allowlist_urls) {
        try {
          allowlistUrls = JSON.parse(settings.allowlist_urls);
        } catch (_) {
          allowlistUrls = settings.allowlist_urls.split('\n').map(u => u.trim()).filter(Boolean);
        }
      }

      const listLimit = settings.list_limit ? parseInt(settings.list_limit, 10) : 300000;
      const patchSize = settings.patch_size ? parseInt(settings.patch_size, 10) : 1000;
      const blockBasedOnSni = settings.block_based_on_sni === '1' || settings.block_based_on_sni === 'true';

      log('Starting download and parse phase...');
      const totalUrls = allowlistUrls.length + blocklistUrls.length;
      let urlsCompleted = 0;

      const allowlistDomains = await downloadAndProcessLists(allowlistUrls, true, log, (current, total) => {
        urlsCompleted++;
        const percent = totalUrls > 0 ? (urlsCompleted / totalUrls) * 50 : 0;
        updateProgress({
          operation: 'update',
          phase: 'download',
          message: `Downloading allowlist (${urlsCompleted}/${totalUrls})...`,
          current: Math.round(percent),
          total: 100
        });
      });

      const blocklistDomains = await downloadAndProcessLists(blocklistUrls, false, log, (current, total) => {
        urlsCompleted++;
        const percent = totalUrls > 0 ? (urlsCompleted / totalUrls) * 50 : 0;
        updateProgress({
          operation: 'update',
          phase: 'download',
          message: `Downloading blocklist (${urlsCompleted}/${totalUrls})...`,
          current: Math.round(percent),
          total: 100
        });
      });

      log('Processing lists & filtering allowlisted subdomains...');
      updateProgress({ operation: 'update', phase: 'process', message: 'Filtering & processing...', current: 52, total: 100 });

      // build allowlist indexes
      const allowlistMap = new Map();
      const allowlistParents = new Set();
      for (const domain of allowlistDomains) {
        allowlistMap.set(domain, 1);
        const parents = extractDomain(domain).slice(1);
        for (const parent of parents) {
          allowlistParents.add(parent);
        }
      }

      const blocklistMap = new Map();
      const finalBlockedDomains = [];
      let allowedCount = 0;
      let duplicateCount = 0;
      let unnecessaryCount = 0;

      for (const domain of blocklistDomains) {
        if (finalBlockedDomains.length >= listLimit) {
          break;
        }

        if (allowlistMap.has(domain)) {
          allowedCount++;
          continue;
        }

        if (blocklistMap.has(domain)) {
          duplicateCount++;
          continue;
        }

        let skip = false;
        const parents = extractDomain(domain).slice(1);
        for (const parent of parents) {
          if (allowlistParents.has(parent)) {
            allowedCount++;
            skip = true;
            break;
          }
          if (blocklistMap.has(parent)) {
            unnecessaryCount++;
            skip = true;
            break;
          }
        }

        if (skip) continue;

        blocklistMap.set(domain, 1);
        finalBlockedDomains.push(domain);
      }

      log('\n--- Domain Processing Stats ---');
      log(`Processed blocklist domains: ${blocklistDomains.length}`);
      log(`Duplicate domains: ${duplicateCount}`);
      log(`Unnecessary subdomains: ${unnecessaryCount}`);
      log(`Allowed domains: ${allowedCount}`);
      log(`Blocked domains count: ${finalBlockedDomains.length}`);
      log('-------------------------------\n');

      updateProgress({ operation: 'update', phase: 'sync', message: 'Syncing lists to Cloudflare...', current: 55, total: 100 });
      await syncGatewayLists(finalBlockedDomains, listLimit, patchSize, log, (step, current, total) => {
        let percent = 55;
        let message = 'Syncing...';
        if (step === 'fetch') {
          percent = 55 + (total > 0 ? (current / total) : 0) * 15; // 55% to 70%
          message = `Fetching existing chunks (${current}/${total})...`;
        } else if (step === 'patch') {
          percent = 70 + (total > 0 ? (current / total) : 0) * 15; // 70% to 85%
          message = `Patching chunks (${current}/${total})...`;
        } else if (step === 'create') {
          percent = 85 + (total > 0 ? (current / total) : 0) * 10; // 85% to 95%
          message = `Creating new chunks (${current}/${total})...`;
        }
        updateProgress({
          operation: 'update',
          phase: 'sync',
          message: message,
          current: Math.round(percent),
          total: 100
        });
      });

      updateProgress({ operation: 'update', phase: 'rules', message: 'Updating DNS Rule...', current: 96, total: 100 });
      await upsertGatewayRule("CZGS Filter Lists", false, log);

      if (blockBasedOnSni) {
        updateProgress({ operation: 'update', phase: 'rules', message: 'Updating SNI Rule...', current: 98, total: 100 });
        log('Updating SNI Filter Rule...');
        await upsertGatewayRule("CZGS Filter Lists - SNI Based Filtering", true, log);
      }

      updateProgress({ operation: 'update', phase: 'complete', message: 'Update complete!', current: 100, total: 100 });
      const durationSec = ((Date.now() - updateStarted) / 1000).toFixed(1);
      log(`\n\x1b[32m=== All tasks completed in ${durationSec}s ===\x1b[0m\n`);
    } catch (err) {
      log(`\n\x1b[31mError during update: ${err.message}\x1b[0m\n`);
    } finally {
      isSyncing = false;
      btnRunUpdate.disabled = false;
      btnDefragment.disabled = false;
      btnFullReset.disabled = false;
      hideProgress('update');
    }
  });

  const btnDefragment = document.getElementById('btn-run-defragment');
  btnDefragment.addEventListener('click', async () => {
    if (confirm('Defragment will optimize your CZGS lists by consolidating entries and deleting empty lists. Continue?')) {
      isSyncing = true;
      btnRunUpdate.disabled = true;
      btnDefragment.disabled = true;
      btnFullReset.disabled = true;

      term.writeln('\n\x1b[36m--- Starting Defragment ---\x1b[0m\n');
      resetProgress('defragment', 'Starting defragment...');

      const log = (msg) => { term.writeln(msg); };
      const onProgress = (phase, current, total, message) => {
        updateProgress({ operation: 'defragment', phase, current, total, message });
      };

      try {
        await defragmentLists(log, onProgress);
        term.writeln('\n\x1b[32m=== All tasks completed ===\x1b[0m\n');
      } catch (err) {
        log(`\n\x1b[31mError during defragment: ${err.message}\x1b[0m\n`);
      } finally {
        isSyncing = false;
        btnRunUpdate.disabled = false;
        btnDefragment.disabled = false;
        btnFullReset.disabled = false;
        hideProgress('defragment');
      }
    }
  });

  const btnFullReset = document.getElementById('btn-run-full-reset');
  btnFullReset.addEventListener('click', async () => {
    if (confirm('Are you SURE you want to do a full reset? This will DELETE generated CZGS block lists and block rules, but will preserve the custom allowlist/denylist and their custom rules.')) {
      isSyncing = true;
      btnRunUpdate.disabled = true;
      btnDefragment.disabled = true;
      btnFullReset.disabled = true;

      term.writeln('\n\x1b[31m--- Starting Full Reset ---\x1b[0m\n');
      resetProgress('full-reset', 'Starting full reset...');

      const log = (msg) => { term.writeln(msg); };
      const onProgress = (phase, current, total, message) => {
        updateProgress({ operation: 'full-reset', phase, current, total, message });
      };

      try {
        await fullReset(log, onProgress);
        term.writeln('\n\x1b[32m=== All tasks completed ===\x1b[0m\n');
      } catch (err) {
        log(`\n\x1b[31mError during full reset: ${err.message}\x1b[0m\n`);
      } finally {
        isSyncing = false;
        btnRunUpdate.disabled = false;
        btnDefragment.disabled = false;
        btnFullReset.disabled = false;
        hideProgress('full-reset');
      }
    }
  });

  // --- IPv4 Location Actions ---
  const ipv4LocationName = document.getElementById('ipv4-location-name');
  const ipv4CurrentNetwork = document.getElementById('ipv4-current-network');
  const ipv4LocationLoader = document.getElementById('ipv4-location-loader');
  const ipv4LocationInput = document.getElementById('ipv4-location-input');
  const ipv4LocationStatus = document.getElementById('ipv4-location-status');
  const btnUpdateIpv4Location = document.getElementById('btn-update-ipv4-location');
  const endpointIpv4 = document.getElementById('endpoint-ipv4');
  const endpointIpv6 = document.getElementById('endpoint-ipv6');
  const endpointDot = document.getElementById('endpoint-dot');
  const endpointDoh = document.getElementById('endpoint-doh');
  let loadedIpv4Network = '';

  function isValidIpv4(value) {
    const parts = String(value || '').trim().split('.');
    return parts.length === 4 && parts.every(part => {
      if (!/^\d{1,3}$/.test(part)) return false;
      if (part.length > 1 && part.startsWith('0')) return false;
      const numeric = Number(part);
      return numeric >= 0 && numeric <= 255;
    });
  }

  function setIpv4LocationStatus(message, type = '') {
    ipv4LocationStatus.textContent = message;
    ipv4LocationStatus.className = type ? `status-msg ${type}` : 'status-msg';
  }

  function setIpv4LocationLoading(isLoading) {
    ipv4LocationLoader.style.display = isLoading ? 'block' : 'none';
    btnUpdateIpv4Location.disabled = isLoading;
  }

  function endpointValue(endpoint) {
    if (!endpoint || endpoint.enabled === false || !endpoint.value) return 'Unavailable';
    return endpoint.value;
  }

  function renderDnsEndpoints(dnsEndpoints = {}) {
    endpointIpv4.textContent = endpointValue(dnsEndpoints.ipv4);
    endpointIpv6.textContent = endpointValue(dnsEndpoints.ipv6);
    endpointDot.textContent = endpointValue(dnsEndpoints.dot);
    endpointDoh.textContent = endpointValue(dnsEndpoints.doh);
  }

  function renderGatewayLocationData({ locationName, protectedNetwork, network, dnsEndpoints, updatedAt }) {
    const currentNetwork = protectedNetwork || network || '';
    loadedIpv4Network = currentNetwork;
    ipv4LocationName.textContent = locationName || 'Cloudflare location';
    ipv4CurrentNetwork.textContent = currentNetwork || 'No protected source IPv4 configured';
    ipv4LocationInput.value = currentNetwork ? currentNetwork.replace(/\/32$/, '') : '';
    renderDnsEndpoints(dnsEndpoints);
    setIpv4LocationStatus(updatedAt ? `Loaded from Cloudflare. Updated ${new Date(updatedAt).toLocaleString()}.` : 'Loaded from Cloudflare.', 'success');
  }

  async function loadIpv4Location() {
    setIpv4LocationLoading(true);
    setIpv4LocationStatus('Loading current Cloudflare location...');
    ipv4LocationName.textContent = 'Loading...';
    ipv4CurrentNetwork.textContent = 'Loading...';
    renderDnsEndpoints({
      ipv4: { value: 'Loading...', enabled: true },
      ipv6: { value: 'Loading...', enabled: true },
      dot: { value: 'Loading...', enabled: true },
      doh: { value: 'Loading...', enabled: true },
    });

    try {
      const res = await fetchApi('/api/gateway/location-ipv4');
      setIpv4LocationLoading(false);
      if (res.success && res.serialized) {
        renderGatewayLocationData(res.serialized);
      } else {
        throw new Error(res.error || 'Failed to parse location response.');
      }
    } catch (err) {
      setIpv4LocationLoading(false);
      setIpv4LocationStatus(`Error: ${err.message}`, 'error');
      ipv4LocationName.textContent = 'Unable to load';
      ipv4CurrentNetwork.textContent = 'Unavailable';
      renderDnsEndpoints();
    }
  }

  btnUpdateIpv4Location.addEventListener('click', async () => {
    const ipv4 = ipv4LocationInput.value.trim();
    if (!isValidIpv4(ipv4)) {
      setIpv4LocationStatus('Enter a valid IPv4 address.', 'error');
      return;
    }

    const newNetwork = `${ipv4}/32`;
    if (loadedIpv4Network === newNetwork) {
      setIpv4LocationStatus('This IPv4 is already protected.', 'success');
      return;
    }

    btnUpdateIpv4Location.disabled = true;
    setIpv4LocationStatus('Updating Cloudflare location...');
    term.writeln('\n\x1b[36m--- Updating Cloudflare IPv4 location ---\x1b[0m\n');
    try {
      const res = await fetchApi('/api/gateway/location-ipv4', {
        method: 'POST',
        body: JSON.stringify({ ipv4 })
      });
      btnUpdateIpv4Location.disabled = false;
      if (res.success) {
        await loadIpv4Location();
        setIpv4LocationStatus('Updated successfully.', 'success');
      } else {
        throw new Error(res.error || 'Failed to update location');
      }
    } catch (err) {
      btnUpdateIpv4Location.disabled = false;
      setIpv4LocationStatus(`Error: ${err.message}`, 'error');
    }
  });

  // --- Manage URLs Actions ---
  let currentUrlType = 'blocklist';
  const urlTextarea = document.getElementById('url-textarea');
  const urlStatus = document.getElementById('url-save-status');
  
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentUrlType = btn.getAttribute('data-type');
      loadUrls();
    });
  });

  async function loadUrls() {
    urlTextarea.value = 'Loading...';
    try {
      const res = await fetchApi('/api/settings');
      const settings = res.settings || {};
      const key = currentUrlType === 'blocklist' ? 'blocklist_urls' : 'allowlist_urls';
      
      let urls = [];
      const storedUrls = settings[key];
      if (storedUrls) {
        try {
          urls = JSON.parse(storedUrls);
        } catch (_) {
          urls = storedUrls.split('\n').map(u => u.trim()).filter(Boolean);
        }
      }
      
      if (!urls || urls.length === 0) {
        urls = currentUrlType === 'blocklist' ? RECOMMENDED_BLOCKLIST_URLS : RECOMMENDED_ALLOWLIST_URLS;
      }
      urlTextarea.value = urls.join('\n');
    } catch (err) {
      urlTextarea.value = `Error loading URLs: ${err.message}`;
    }
  }

  document.getElementById('btn-save-urls').addEventListener('click', async () => {
    const urls = urlTextarea.value.split('\n').map(u => u.trim()).filter(Boolean);
    urlStatus.textContent = 'Saving...';
    urlStatus.className = 'status-msg';
    try {
      const key = currentUrlType === 'blocklist' ? 'blocklist_urls' : 'allowlist_urls';
      const res = await fetchApi('/api/settings', {
        method: 'POST',
        body: JSON.stringify({ [key]: JSON.stringify(urls) })
      });
      if (res.success) {
        urlStatus.textContent = 'Saved successfully!';
        urlStatus.className = 'status-msg success';
        setTimeout(() => { urlStatus.textContent = ''; }, 3000);
      } else {
        throw new Error(res.error || 'Failed to save settings.');
      }
    } catch (err) {
      urlStatus.textContent = `Error: ${err.message}`;
      urlStatus.className = 'status-msg error';
    }
  });

  // --- DNS Rewrite Actions ---
  const rewritesUl = document.getElementById('rewrites-ul');
  const rewritesLoader = document.getElementById('rewrites-loader');
  const rewritesTextarea = document.getElementById('rewrites-textarea');
  const rewritesStatus = document.getElementById('rewrites-save-status');
  const btnSaveRewrites = document.getElementById('btn-save-rewrites');
  let loadedRewriteCount = 0;

  async function loadDnsRewrites() {
    rewritesUl.textContent = '';
    rewritesLoader.style.display = 'block';
    try {
      const res = await fetchApi('/api/gateway/dns-rewrites');
      loadedRewriteCount = res.rewrites.length;
      rewritesLoader.style.display = 'none';
      rewritesUl.textContent = '';
      rewritesTextarea.value = res.rewrites
        .map(({ domain, ips }) => `${domain} -> ${ips.join(', ')}`)
        .join('\n');

      if (res.rewrites.length === 0) {
        renderRewriteMessage('No rewrites configured.', '--text-muted');
        return;
      }

      for (const { domain, ips } of res.rewrites) {
        const li = document.createElement('li');
        
        const info = document.createElement('span');
        info.textContent = `${domain} -> ${ips.join(', ')}`;
        li.appendChild(info);

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-rewrite';
        delBtn.title = `Delete rewrite for ${domain}`;
        delBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        
        delBtn.addEventListener('click', () => {
          deleteRewrite(domain);
        });

        li.appendChild(delBtn);
        rewritesUl.appendChild(li);
      }
    } catch (err) {
      rewritesLoader.style.display = 'none';
      renderRewriteMessage(`Error: ${err.message}`, '--danger');
    }
  }

  function renderRewriteMessage(message, colorVar) {
    rewritesUl.textContent = '';
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.style.color = `var(${colorVar})`;
    span.textContent = message;
    li.appendChild(span);
    rewritesUl.appendChild(li);
  }

  async function deleteRewrite(domainToDelete) {
    const lines = rewritesTextarea.value.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return true;
      
      const normalizedLine = trimmed
        .replace(/\s*->\s*/, ' ')
        .replace(/\s*=\s*/, ' ')
        .replace(/\s+/g, ' ');
      const domain = normalizedLine.split(/[,\s]+/)[0]?.trim().toLowerCase();
      
      return domain !== domainToDelete.toLowerCase();
    });

    const newRaw = filteredLines.join('\n');
    rewritesTextarea.value = newRaw;
    
    term.writeln(`\x1b[33mDeleting DNS rewrite for: ${domainToDelete}\x1b[0m`);
    rewritesStatus.textContent = 'Deleting...';
    rewritesStatus.className = 'status-msg';

    try {
      const res = await fetchApi('/api/gateway/dns-rewrites', {
        method: 'POST',
        body: JSON.stringify({ raw: newRaw })
      });
      if (res.success) {
        rewritesStatus.textContent = 'Deleted successfully!';
        rewritesStatus.className = 'status-msg success';
        await loadDnsRewrites();
        setTimeout(() => { rewritesStatus.textContent = ''; }, 3000);
      } else {
        throw new Error(res.error || 'Failed to delete rewrite');
      }
    } catch (err) {
      rewritesStatus.textContent = `Error: ${err.message}`;
      rewritesStatus.className = 'status-msg error';
    }
  }

  btnSaveRewrites.addEventListener('click', async () => {
    const raw = rewritesTextarea.value.trim();
    if (!raw && loadedRewriteCount > 0 && !confirm('Save an empty rewrite list? This will delete all dashboard-managed DNS rewrite rules.')) {
      return;
    }

    btnSaveRewrites.disabled = true;
    rewritesStatus.textContent = 'Saving...';
    rewritesStatus.className = 'status-msg';
    term.writeln('\x1b[36m--- Saving DNS rewrites ---\x1b[0m');

    try {
      const res = await fetchApi('/api/gateway/dns-rewrites', {
        method: 'POST',
        body: JSON.stringify({ raw })
      });
      btnSaveRewrites.disabled = false;
      if (res.success) {
        rewritesStatus.textContent = 'Saved successfully!';
        rewritesStatus.className = 'status-msg success';
        await loadDnsRewrites();
        setTimeout(() => { rewritesStatus.textContent = ''; }, 3000);
      } else {
        throw new Error(res.error || 'Failed to save rewrites');
      }
    } catch (err) {
      btnSaveRewrites.disabled = false;
      rewritesStatus.textContent = `Error: ${err.message}`;
      rewritesStatus.className = 'status-msg error';
    }
  });

  // --- Manage Allowlist Actions ---
  const allowlistUl = document.getElementById('allowlist-ul');
  const allowlistLoader = document.getElementById('allowlist-loader');
  const allowlistTextarea = document.getElementById('allowlist-textarea');
  let customListId = null;

  async function loadAllowlist() {
    allowlistUl.textContent = '';
    allowlistLoader.style.display = 'block';
    try {
      const res = await fetchApi('/api/gateway/custom-allowlist');
      customListId = res.id;
      allowlistLoader.style.display = 'none';
      allowlistUl.textContent = '';
      if (res.items.length === 0) {
        renderAllowlistMessage('List is empty.', '--text-muted');
        return;
      }
      const domains = (res.items || []).map(item => typeof item === 'object' ? item.value : item);
      for (const domain of domains) {
        const li = document.createElement('li');
        li.textContent = domain;
        allowlistUl.appendChild(li);
      }
    } catch (err) {
      allowlistLoader.style.display = 'none';
      renderAllowlistMessage(`Error loading list: ${err.message}`, '--danger');
    }
  }

  function renderAllowlistMessage(message, colorVar) {
    allowlistUl.textContent = '';
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.style.color = `var(${colorVar})`;
    span.textContent = message;
    li.appendChild(span);
    allowlistUl.appendChild(li);
  }

  async function handleAllowlistAction(action) {
    if (!customListId) return alert('Allowlist not loaded yet.');
    const raw = allowlistTextarea.value;
    const domains = raw.split(/[\s,]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
    
    if (domains.length === 0) return alert('Please enter at least one valid domain.');
    
    document.getElementById('btn-allowlist-add').disabled = true;
    document.getElementById('btn-allowlist-remove').disabled = true;
    
    term.writeln(`\x1b[36m--- Allowlist ${action} ---\x1b[0m`);

    try {
      term.writeln(`\x1b[34mChecking domains in list...\x1b[0m`);
      const res = await fetchApi('/api/gateway/custom-allowlist');
      const existingItems = (res.items || []).map(item => typeof item === 'object' ? item.value : item);
      const existingSet = new Set(existingItems);

      const CUSTOM_LIST_DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
      const validDomains = [];
      const invalidDomains = [];
      const duplicateDomains = [];
      const seenDomains = new Set();

      for (const value of domains) {
        const domain = value.trim().toLowerCase();
        if (!CUSTOM_LIST_DOMAIN_RE.test(domain)) {
          invalidDomains.push(value);
          continue;
        }
        if (seenDomains.has(domain)) {
          duplicateDomains.push(domain);
          continue;
        }
        seenDomains.add(domain);
        validDomains.push(domain);
      }

      if (invalidDomains.length > 0) {
        term.writeln(`\x1b[33mSkipping ${invalidDomains.length} invalid domain(s): ${invalidDomains.join(', ')}\x1b[0m`);
      }
      if (duplicateDomains.length > 0) {
        term.writeln(`\x1b[33mSkipping ${duplicateDomains.length} duplicate input domain(s): ${duplicateDomains.join(', ')}\x1b[0m`);
      }

      if (validDomains.length === 0) {
        term.writeln(`\x1b[31mNo valid domains to process.\x1b[0m`);
        document.getElementById('btn-allowlist-add').disabled = false;
        document.getElementById('btn-allowlist-remove').disabled = false;
        return;
      }

      let finalDomains = [];
      if (action === 'add') {
        const existingDomains = validDomains.filter(domain => existingSet.has(domain));
        finalDomains = validDomains.filter(domain => !existingSet.has(domain));

        if (existingDomains.length > 0) {
          term.writeln(`\x1b[33mSkipping ${existingDomains.length} domain(s) already in list: ${existingDomains.join(', ')}\x1b[0m`);
        }
        if (finalDomains.length === 0) {
          term.writeln(`\x1b[33mAll valid domains are already in the list. Skipping add.\x1b[0m`);
          document.getElementById('btn-allowlist-add').disabled = false;
          document.getElementById('btn-allowlist-remove').disabled = false;
          return;
        }
      } else if (action === 'remove') {
        finalDomains = validDomains.filter(domain => existingSet.has(domain));
        const notFoundDomains = validDomains.filter(domain => !existingSet.has(domain));

        if (notFoundDomains.length > 0) {
          term.writeln(`\x1b[33mSkipping ${notFoundDomains.length} domain(s) not found in list: ${notFoundDomains.join(', ')}\x1b[0m`);
        }
        if (finalDomains.length === 0) {
          term.writeln(`\x1b[33mNone of the valid domains were found in the list. Skipping remove.\x1b[0m`);
          document.getElementById('btn-allowlist-add').disabled = false;
          document.getElementById('btn-allowlist-remove').disabled = false;
          return;
        }
      }

      term.writeln(`\x1b[34mProcessing ${action} for ${finalDomains.length} domain(s)...\x1b[0m`);
      const patch = action === 'add'
        ? { append: finalDomains.map(d => ({ value: d })) }
        : { remove: finalDomains };

      const patchRes = await fetchApi('/api/gateway/patch', {
        method: 'POST',
        body: JSON.stringify({ listId: customListId, patch, listName: 'Custom Allowlist' })
      });

      if (patchRes.success) {
        term.writeln(`\x1b[32mSuccessfully updated allowlist and rule.\x1b[0m`);
      } else {
        throw new Error(patchRes.error || 'Failed to patch list');
      }
    } catch (err) {
      term.writeln(`\x1b[31mAllowlist update failed: ${err.message}\x1b[0m`);
    } finally {
      document.getElementById('btn-allowlist-add').disabled = false;
      document.getElementById('btn-allowlist-remove').disabled = false;
      allowlistTextarea.value = '';
      await loadAllowlist();
    }
  }

  document.getElementById('btn-allowlist-add').addEventListener('click', () => handleAllowlistAction('add'));
  document.getElementById('btn-allowlist-remove').addEventListener('click', () => handleAllowlistAction('remove'));

  // --- Manage Denylist Actions ---
  const denylistUl = document.getElementById('denylist-ul');
  const denylistLoader = document.getElementById('denylist-loader');
  const denylistTextarea = document.getElementById('denylist-textarea');
  let customDenyListId = null;

  async function loadDenylist() {
    denylistUl.textContent = '';
    denylistLoader.style.display = 'block';
    try {
      const res = await fetchApi('/api/gateway/custom-denylist');
      customDenyListId = res.id;
      denylistLoader.style.display = 'none';
      denylistUl.textContent = '';
      if (res.items.length === 0) {
        renderDenylistMessage('List is empty.', '--text-muted');
        return;
      }
      const domains = (res.items || []).map(item => typeof item === 'object' ? item.value : item);
      for (const domain of domains) {
        const li = document.createElement('li');
        li.textContent = domain;
        denylistUl.appendChild(li);
      }
    } catch (err) {
      denylistLoader.style.display = 'none';
      renderDenylistMessage(`Error loading list: ${err.message}`, '--danger');
    }
  }

  function renderDenylistMessage(message, colorVar) {
    denylistUl.textContent = '';
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.style.color = `var(${colorVar})`;
    span.textContent = message;
    li.appendChild(span);
    denylistUl.appendChild(li);
  }

  async function handleDenylistAction(action) {
    if (!customDenyListId) return alert('Denylist not loaded yet.');
    const raw = denylistTextarea.value;
    const domains = raw.split(/[\s,]+/).map(d => d.trim().toLowerCase()).filter(Boolean);
    
    if (domains.length === 0) return alert('Please enter at least one valid domain.');
    
    document.getElementById('btn-denylist-add').disabled = true;
    document.getElementById('btn-denylist-remove').disabled = true;
    
    term.writeln(`\x1b[36m--- Denylist ${action} ---\x1b[0m`);

    try {
      term.writeln(`\x1b[34mChecking domains in list...\x1b[0m`);
      const res = await fetchApi('/api/gateway/custom-denylist');
      const existingItems = (res.items || []).map(item => typeof item === 'object' ? item.value : item);
      const existingSet = new Set(existingItems);

      const CUSTOM_LIST_DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
      const validDomains = [];
      const invalidDomains = [];
      const duplicateDomains = [];
      const seenDomains = new Set();

      for (const value of domains) {
        const domain = value.trim().toLowerCase();
        if (!CUSTOM_LIST_DOMAIN_RE.test(domain)) {
          invalidDomains.push(value);
          continue;
        }
        if (seenDomains.has(domain)) {
          duplicateDomains.push(domain);
          continue;
        }
        seenDomains.add(domain);
        validDomains.push(domain);
      }

      if (invalidDomains.length > 0) {
        term.writeln(`\x1b[33mSkipping ${invalidDomains.length} invalid domain(s): ${invalidDomains.join(', ')}\x1b[0m`);
      }
      if (duplicateDomains.length > 0) {
        term.writeln(`\x1b[33mSkipping ${duplicateDomains.length} duplicate input domain(s): ${duplicateDomains.join(', ')}\x1b[0m`);
      }

      if (validDomains.length === 0) {
        term.writeln(`\x1b[31mNo valid domains to process.\x1b[0m`);
        document.getElementById('btn-denylist-add').disabled = false;
        document.getElementById('btn-denylist-remove').disabled = false;
        return;
      }

      let finalDomains = [];
      if (action === 'add') {
        const existingDomains = validDomains.filter(domain => existingSet.has(domain));
        finalDomains = validDomains.filter(domain => !existingSet.has(domain));

        if (existingDomains.length > 0) {
          term.writeln(`\x1b[33mSkipping ${existingDomains.length} domain(s) already in list: ${existingDomains.join(', ')}\x1b[0m`);
        }
        if (finalDomains.length === 0) {
          term.writeln(`\x1b[33mAll valid domains are already in the list. Skipping add.\x1b[0m`);
          document.getElementById('btn-denylist-add').disabled = false;
          document.getElementById('btn-denylist-remove').disabled = false;
          return;
        }
      } else if (action === 'remove') {
        finalDomains = validDomains.filter(domain => existingSet.has(domain));
        const notFoundDomains = validDomains.filter(domain => !existingSet.has(domain));

        if (notFoundDomains.length > 0) {
          term.writeln(`\x1b[33mSkipping ${notFoundDomains.length} domain(s) not found in list: ${notFoundDomains.join(', ')}\x1b[0m`);
        }
        if (finalDomains.length === 0) {
          term.writeln(`\x1b[33mNone of the valid domains were found in the list. Skipping remove.\x1b[0m`);
          document.getElementById('btn-denylist-add').disabled = false;
          document.getElementById('btn-denylist-remove').disabled = false;
          return;
        }
      }

      term.writeln(`\x1b[34mProcessing ${action} for ${finalDomains.length} domain(s)...\x1b[0m`);
      const patch = action === 'add'
        ? { append: finalDomains.map(d => ({ value: d })) }
        : { remove: finalDomains };

      const patchRes = await fetchApi('/api/gateway/patch', {
        method: 'POST',
        body: JSON.stringify({ listId: customDenyListId, patch, listName: 'Custom Denylist' })
      });

      if (patchRes.success) {
        term.writeln(`\x1b[32mSuccessfully updated denylist and rule.\x1b[0m`);
      } else {
        throw new Error(patchRes.error || 'Failed to patch list');
      }
    } catch (err) {
      term.writeln(`\x1b[31mDenylist update failed: ${err.message}\x1b[0m`);
    } finally {
      document.getElementById('btn-denylist-add').disabled = false;
      document.getElementById('btn-denylist-remove').disabled = false;
      denylistTextarea.value = '';
      await loadDenylist();
    }
  }

  document.getElementById('btn-denylist-add').addEventListener('click', () => handleDenylistAction('add'));
  document.getElementById('btn-denylist-remove').addEventListener('click', () => handleDenylistAction('remove'));

  // --- DNS Analytics ---
  let dnsChart = null;
  let currentDNSRange = '24h';
  const btnRefreshAnalytics = document.getElementById('btn-refresh-analytics');
  const analyticsTotalQueries = document.getElementById('analytics-total-queries');
  const analyticsTimePeriod = document.getElementById('analytics-time-period');
  const topDomainsList = document.getElementById('top-domains-list');
  const topLocationsList = document.getElementById('top-locations-list');
  const topDomainsLoader = document.getElementById('top-domains-loader');
  const topLocationsLoader = document.getElementById('top-locations-loader');
  const resolverDecisionsLoader = document.getElementById('resolver-decisions-loader');
  const resolverDecisionsLegend = document.getElementById('resolver-decisions-legend');
  const dnsRangePills = document.getElementById('dns-range-pills');
  const dnsDataStatus = document.getElementById('dns-data-status');
  let resolverDecisionChart = null;

  const RESOLVER_DECISION_COLORS = {
    5: '#3b82f6',
    9: '#f59e0b',
    10: '#ec4899',
  };
  const RESOLVER_DECISION_FALLBACK_COLORS = ['#22c55e', '#a855f7', '#14b8a6', '#ef4444', '#eab308', '#6366f1'];
  const DNS_BUCKET_MS = {
    '24h': 60 * 60 * 1000,
    '7d': 24 * 60 * 60 * 1000,
    '30d': 7 * 24 * 60 * 60 * 1000,
  };

  function bucketStartMs(date, bucketMs) {
    const ms = date.getTime();
    return Math.floor(ms / bucketMs) * bucketMs;
  }

  function aggregateDNSPoints(timeSeries, range) {
    if (!Array.isArray(timeSeries)) return { labels: [], data: [] };
    const bucketMs = DNS_BUCKET_MS[range] || DNS_BUCKET_MS['24h'];
    const buckets = new Map();
    timeSeries.forEach(item => {
      const date = new Date(item.time);
      if (isNaN(date.getTime())) return;
      const key = bucketStartMs(date, bucketMs);
      buckets.set(key, (buckets.get(key) || 0) + (Number(item.count) || 0));
    });

    const rows = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, count]) => ({ time: new Date(ms).toISOString(), count }));

    return {
      labels: rows.map(d => d.time),
      data: rows.map(d => d.count),
    };
  }

  function shouldShowDNSXAxisLabel(index, totalLabels, label, range) {
    if (totalLabels <= 1) return true;
    const isMobile = window.innerWidth < 720;

    if (range === '30d') {
      return true;
    }

    if (range === '7d') {
      return true;
    }

    if (isMobile) {
      const positions = [
        0,
        Math.floor((totalLabels - 1) * 0.25),
        Math.floor((totalLabels - 1) * 0.5),
        Math.floor((totalLabels - 1) * 0.75),
        totalLabels - 1,
      ];
      return positions.includes(index);
    }

    const step = Math.max(1, Math.ceil(totalLabels / 8));
    return index === 0 || index === totalLabels - 1 || index % step === 0;
  }

  function formatDNSAxisLabel(label, range) {
    const date = new Date(label);
    if (isNaN(date.getTime())) return '';

    if (range === '30d') {
      const endDate = new Date(date.getTime() + (6 * 24 * 60 * 60 * 1000));
      const startLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endLabel = endDate.getMonth() === date.getMonth()
        ? endDate.toLocaleDateString('en-US', { day: 'numeric' })
        : endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${startLabel}-${endLabel}`;
    }

    if (range === '7d') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    if (date.getHours() === 0 && date.getMinutes() === 0) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function applyDNSChartRangeStyle(range) {
    if (!dnsChart) return;
    const [primaryDataset, averageDataset] = dnsChart.data.datasets;

    primaryDataset.type = 'line';
    primaryDataset.label = {
      '24h': 'Hourly queries',
      '7d': 'Daily queries',
      '30d': 'Weekly queries',
    }[range] || 'DNS Queries';
    primaryDataset.borderColor = '#7db6ff';
    primaryDataset.backgroundColor = 'rgba(125, 182, 255, 0.1)';
    primaryDataset.borderWidth = 2.2;
    primaryDataset.borderRadius = 0;
    primaryDataset.fill = true;
    primaryDataset.tension = 0.34;
    primaryDataset.pointRadius = range === '24h' ? 2.4 : 3.6;
    primaryDataset.pointHoverRadius = 5;

    averageDataset.hidden = true;
    averageDataset.data = [];
  }

  function renderResolverDecisions(decisions) {
    if (!decisions || decisions.length === 0) {
      if (resolverDecisionsLegend) resolverDecisionsLegend.innerHTML = '';
      if (resolverDecisionChart) {
        resolverDecisionChart.data.labels = [];
        resolverDecisionChart.data.datasets[0].data = [];
        resolverDecisionChart.update();
      }
      return;
    }

    const colors = decisions.map((d, i) => RESOLVER_DECISION_COLORS[d.metric] || RESOLVER_DECISION_FALLBACK_COLORS[i % RESOLVER_DECISION_FALLBACK_COLORS.length]);

    const canvas = document.getElementById('resolver-decision-chart');
    if (canvas && !resolverDecisionChart) {
      resolverDecisionChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: decisions.map(d => d.label),
          datasets: [{
            data: decisions.map(d => d.count),
            backgroundColor: colors,
            borderColor: 'rgba(11, 18, 36, 0.9)',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(11, 18, 36, 0.95)',
              titleColor: '#e8f1ff',
              bodyColor: '#d8e7ff',
              borderColor: 'rgba(125, 182, 255, 0.3)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: function(ctx) {
                  return `${ctx.label}: ${ctx.parsed.toLocaleString()}`;
                },
              },
            },
          },
        },
      });
    } else if (resolverDecisionChart) {
      resolverDecisionChart.data.labels = decisions.map(d => d.label);
      resolverDecisionChart.data.datasets[0].data = decisions.map(d => d.count);
      resolverDecisionChart.data.datasets[0].backgroundColor = colors;
      resolverDecisionChart.update();
    }

    if (resolverDecisionsLegend) {
      resolverDecisionsLegend.innerHTML = decisions.map((d, i) => `
        <li class="resolver-decision-item">
          <span class="resolver-decision-dot" style="background:${colors[i]}"></span>
          <span class="resolver-decision-label">${d.label}</span>
          <span class="resolver-decision-count">${formatNumber(d.count)}</span>
        </li>
      `).join('');
    }
  }

  function initDNSChart() {
    const ctx = document.getElementById('dns-queries-chart').getContext('2d');
    dnsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'DNS Queries',
            data: [],
            borderColor: '#7db6ff',
            backgroundColor: 'rgba(125, 182, 255, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: '#7db6ff',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            spanGaps: true,
          },
          {
            label: '7-day average',
            data: [],
            hidden: true,
            type: 'line',
            borderColor: '#ff8a1f',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.34,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(11, 18, 36, 0.95)',
            titleColor: '#e8f1ff',
            bodyColor: '#d8e7ff',
            borderColor: 'rgba(125, 182, 255, 0.3)',
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            callbacks: {
              title: function(context) {
                const dataPoint = context[0];
                const timeStr = dataPoint.label;
                const date = new Date(timeStr);
                if (!isNaN(date.getTime())) {
                  return date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                    timeZone: 'UTC'
                  });
                }
                return timeStr;
              },
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'category',
            grid: {
              color: function(context) {
                const index = context.index;
                const totalLabels = context.scale.ticks.length;
                const label = context.scale.getLabelForValue(context.tick.value);
                return shouldShowDNSXAxisLabel(index, totalLabels, label, currentDNSRange)
                  ? 'rgba(125, 182, 255, 0.1)'
                  : 'transparent';
              },
              drawBorder: false,
              drawTicks: true,
              tickLength: 5,
              tickColor: function(context) {
                const index = context.index;
                const totalLabels = context.scale.ticks.length;
                const label = context.scale.getLabelForValue(context.tick.value);
                const isLabeled = shouldShowDNSXAxisLabel(index, totalLabels, label, currentDNSRange);
                return isLabeled ? 'rgba(125, 182, 255, 0.1)' : 'transparent';
              }
            },
            ticks: {
              color: '#8fa3c0',
              maxRotation: 0,
              autoSkip: false,
              autoSkipPadding: 20,
              callback: function(value, index, values) {
                const label = this.getLabelForValue(value);
                const date = new Date(label);
                if (!isNaN(date.getTime())) {
                  const totalLabels = values.length;
                  if (!shouldShowDNSXAxisLabel(index, totalLabels, label, currentDNSRange)) {
                    return '';
                  }
                  return formatDNSAxisLabel(label, currentDNSRange);
                }
                return '';
              }
            }
          },
          y: {
            min: 0,
            grid: {
              color: 'rgba(125, 182, 255, 0.1)',
              drawBorder: false
            },
            ticks: {
              color: '#8fa3c0',
              callback: function(value) {
                if (value >= 1000) {
                  return (value / 1000).toFixed(1) + 'k';
                }
                return value;
              }
            }
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        }
      }
    });
  }

  function formatNumber(num) {
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'k';
    }
    return num.toString();
  }

  function renderTopList(container, items, key) {
    container.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.className = 'top-list-empty';
      li.textContent = 'No data available';
      container.appendChild(li);
      return;
    }

    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'top-list-item';
      li.innerHTML = `
        <span class="top-list-rank">${index + 1}</span>
        <span class="top-list-name" title="${item[key]}">${item[key]}</span>
        <span class="top-list-count">${formatNumber(item.count)}</span>
      `;
      container.appendChild(li);
    });
  }

  function updateDNSStatus(source, cachedAt) {
    if (!dnsDataStatus) return;
    dnsDataStatus.className = 'data-status data-timestamp';
    const formatStatusTime = value => new Date(value || Date.now()).toLocaleTimeString();
    
    if (source === 'live') {
      dnsDataStatus.classList.add('live');
      dnsDataStatus.textContent = `Live ${formatStatusTime(cachedAt)}`;
      dnsDataStatus.title = `Live data at ${new Date(cachedAt || Date.now()).toLocaleString()}`;
    } else if (source === 'cache' && cachedAt) {
      dnsDataStatus.classList.add('cache');
      const date = new Date(cachedAt);
      dnsDataStatus.textContent = `Cached ${formatStatusTime(cachedAt)}`;
      dnsDataStatus.title = `Cached at ${date.toLocaleString()}`;
    } else if (source === 'loading') {
      dnsDataStatus.classList.add('loading');
      dnsDataStatus.textContent = 'Loading...';
      dnsDataStatus.title = 'Loading...';
    } else if (source === 'error') {
      dnsDataStatus.classList.add('error');
      dnsDataStatus.textContent = 'Error';
      dnsDataStatus.title = 'Failed to load data';
    } else {
      dnsDataStatus.textContent = 'No data';
      dnsDataStatus.title = 'No data';
    }
  }

  function setDNSRange(range) {
    currentDNSRange = range;
    
    // Update pill UI
    if (dnsRangePills) {
      dnsRangePills.querySelectorAll('.range-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.range === range);
      });
    }
    
    // Update time period text
    const rangeLabels = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
    if (analyticsTimePeriod) analyticsTimePeriod.textContent = rangeLabels[range] || 'Last 24 hours';
    
    // Load data for new range
    loadDNSAnalytics(range);
  }

  async function loadDNSAnalytics(range = currentDNSRange, options = {}) {
    const rangeLabels = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' };
    if (analyticsTimePeriod) analyticsTimePeriod.textContent = rangeLabels[range] || 'Last 24 hours';

    const isRefresh = options.refresh === true;
    const skipLive = options.skipLive === true;

    // Show loaders only on first load (no cached data yet)
    if (!isRefresh) {
      if (topDomainsLoader) topDomainsLoader.style.display = 'block';
      if (topLocationsLoader) topLocationsLoader.style.display = 'block';
      if (resolverDecisionsLoader) resolverDecisionsLoader.style.display = 'block';
      updateDNSStatus('loading', null);
    }

    try {
      // Build URL — add refresh=true for live sync
      const url = isRefresh
        ? `/api/dns-analytics?range=${range}&refresh=true`
        : `/api/dns-analytics?range=${range}`;
      const res = await fetchApi(url);

      if (topDomainsLoader) topDomainsLoader.style.display = 'none';
      if (topLocationsLoader) topLocationsLoader.style.display = 'none';
      if (resolverDecisionsLoader) resolverDecisionsLoader.style.display = 'none';

      if (!res.success) {
        throw new Error(res.error || 'Failed to load DNS analytics.');
      }

      if (range !== currentDNSRange) return; // Discard stale request

      const data = res.data || {
        timeSeries: [],
        totalCount: 0,
        topDomains: [],
        topLocations: [],
        resolverDecisions: [],
        cachedAt: null
      };

      updateDNSStatus(data.cachedAt ? (isRefresh ? 'live' : 'cache') : 'live', data.cachedAt || new Date().toISOString());
      analyticsTotalQueries.textContent = formatNumber(data.totalCount || 0);

      if (dnsChart) {
        const timeSeries = data.timeSeries || [];
        const chartData = aggregateDNSPoints(timeSeries, range);
        applyDNSChartRangeStyle(range);

        const numericValues = chartData.data.filter(v => v != null && !isNaN(v));
        if (numericValues.length > 0) {
          const maxVal = Math.max(...numericValues);
          dnsChart.options.scales.y.min = 0;
          dnsChart.options.scales.y.max = Math.ceil(maxVal * 1.1);
        } else {
          dnsChart.options.scales.y.min = 0;
          dnsChart.options.scales.y.max = undefined;
        }

        dnsChart.data.labels = chartData.labels;
        dnsChart.data.datasets[0].data = chartData.data;
        dnsChart.data.datasets[1].data = [];
        dnsChart.update();
      }

      if (data.topDomains) renderTopList(topDomainsList, data.topDomains, 'domain');
      if (data.topLocations) renderTopList(topLocationsList, data.topLocations, 'location');
      if (data.resolverDecisions) renderResolverDecisions(data.resolverDecisions);

      // After showing cached data, auto-fetch live data in the background
      if (!isRefresh && !skipLive) {
        loadDNSAnalytics(range, { refresh: true, skipLive: true });
      }
    } catch (err) {
      if (topDomainsLoader) topDomainsLoader.style.display = 'none';
      if (topLocationsLoader) topLocationsLoader.style.display = 'none';
      if (resolverDecisionsLoader) resolverDecisionsLoader.style.display = 'none';
      console.error('DNS analytics error:', err);
      // Only show error UI if this was the initial load, not the background refresh
      if (!isRefresh) {
        analyticsTotalQueries.textContent = 'Error';
        updateDNSStatus('error', null);
      }
    }
  }

  // Range pill click handlers
  if (dnsRangePills) {
    dnsRangePills.querySelectorAll('.range-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const range = pill.dataset.range;
        if (range && range !== currentDNSRange) {
          setDNSRange(range);
        }
      });
    });
  }

  // Chart is initialized and loaded on navigation click and initial load.

  // Defer analytics loading until after verifyAuthAndInit runs
  verifyAuthAndInit();

  if (btnRefreshAnalytics) {
    btnRefreshAnalytics.addEventListener('click', async () => {
      if (dnsChart) {
        dnsChart.data.labels = [];
        dnsChart.data.datasets[0].data = [];
        dnsChart.update('none');
      }
      updateDNSStatus('loading', null);
      loadDNSAnalytics(currentDNSRange, { refresh: true, skipLive: true });
    });
  }

  if (document.getElementById('section-traffic-map')?.classList.contains('active')) {
    trafficMapDashboard?.load();
  }
});
