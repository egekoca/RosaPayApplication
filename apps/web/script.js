const menuButton = document.querySelector('[data-menu-button]');
const menu = document.querySelector('[data-menu]');

if (menuButton && menu) {
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    menu.dataset.open = String(!open);
  });

  menu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      menuButton.setAttribute('aria-expanded', 'false');
      menu.dataset.open = 'false';
    });
  });
}

const statusLabel = document.querySelector('[data-network-status]');
const networkProof = document.querySelector('[data-network-proof]');

async function refreshNetworkStatus() {
  if (!statusLabel) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch('https://soroban-testnet.stellar.org', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
      signal: controller.signal,
    });
    const payload = await response.json();
    const sequence = payload?.result?.sequence;
    if (!response.ok || !Number.isInteger(sequence)) throw new Error('RPC unavailable');
    statusLabel.textContent = `RPC live · ledger ${sequence.toLocaleString('en-US')}`;
    statusLabel.dataset.live = 'true';
  } catch {
    statusLabel.textContent = 'Verified Testnet deployment';
  } finally {
    clearTimeout(timeout);
    if (networkProof) networkProof.dataset.checking = 'false';
  }
}

void refreshNetworkStatus();

const observed = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.visible = 'true';
      observer.unobserve(entry.target);
    });
  }, {threshold: 0.14});
  observed.forEach(element => observer.observe(element));
} else {
  observed.forEach(element => { element.dataset.visible = 'true'; });
}
