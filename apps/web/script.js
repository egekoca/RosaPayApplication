const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- navigation ---------- */
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

const header = document.querySelector('[data-header]');
const syncHeader = () => {
  if (header) header.dataset.stuck = String(window.scrollY > 12);
};
syncHeader();
window.addEventListener('scroll', syncHeader, {passive: true});

/* ---------- live testnet proof ---------- */
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
    statusLabel.textContent = `Stellar Testnet live · ledger ${sequence.toLocaleString('en-US')}`;
    statusLabel.dataset.live = 'true';
  } catch {
    statusLabel.textContent = 'Verified on Stellar Testnet';
  } finally {
    clearTimeout(timeout);
    if (networkProof) networkProof.dataset.checking = 'false';
  }
}

void refreshNetworkStatus();

/* ---------- scroll reveals ---------- */
const revealed = [...document.querySelectorAll('[data-rise]')];
const above = element => element.closest('.hero') !== null;

/* the hero is on screen at load: play its entrance straight away */
revealed.filter(above).forEach(element => { element.dataset.visible = 'true'; });

const deferred = revealed.filter(element => !above(element));
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.dataset.visible = 'true';
      observer.unobserve(entry.target);
    });
  }, {threshold: 0.12, rootMargin: '0px 0px -6% 0px'});
  deferred.forEach(element => observer.observe(element));
} else {
  deferred.forEach(element => { element.dataset.visible = 'true'; });
}

/* ---------- extruded phone body ---------- */
function extrude(host) {
  const depth = Number(host.dataset.extrude);
  if (!Number.isFinite(depth) || depth <= 0) return;

  const fragment = document.createDocumentFragment();
  const steps = Math.round(depth);

  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const layer = document.createElement('div');
    layer.className = 'slab';
    layer.style.setProperty('--z', `${depth / 2 - index}px`);
    layer.style.setProperty('--b', (1 - ratio * 0.72).toFixed(3));
    fragment.appendChild(layer);
  }

  host.appendChild(fragment);
}

document.querySelectorAll('[data-extrude]').forEach(extrude);

/* ---------- pointer + scroll driven rotation ---------- */
const stage = document.querySelector('[data-stage]');
const phone = document.querySelector('[data-phone]');

if (stage && phone && !reduceMotion) {
  const rest = {rx: 6, ry: -19, rz: 1};
  const target = {...rest};
  const current = {...rest};
  let pointerInside = false;
  let frame = 0;

  const render = () => {
    frame = 0;
    let moving = false;

    for (const axis of ['rx', 'ry', 'rz']) {
      const delta = target[axis] - current[axis];
      if (Math.abs(delta) > 0.01) {
        current[axis] += delta * 0.09;
        moving = true;
      } else {
        current[axis] = target[axis];
      }
    }

    phone.style.setProperty('--rx', `${current.rx.toFixed(2)}deg`);
    phone.style.setProperty('--ry', `${current.ry.toFixed(2)}deg`);
    phone.style.setProperty('--rz', `${current.rz.toFixed(2)}deg`);
    phone.style.setProperty('--glare', (current.ry * 2.4).toFixed(1));

    if (moving) frame = requestAnimationFrame(render);
  };

  const queue = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const setTarget = (pointer = {x: 0, y: 0}) => {
    const scrolled = Math.min(1, Math.max(0, window.scrollY / 700));
    target.rx = rest.rx - pointer.y * 9 - scrolled * 3;
    target.ry = rest.ry + pointer.x * 17 + scrolled * 13;
    target.rz = rest.rz + pointer.x * 1.6;
    queue();
  };

  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const bounds = stage.getBoundingClientRect();
    pointerInside = true;
    setTarget({
      x: (event.clientX - bounds.left) / bounds.width - 0.5,
      y: (event.clientY - bounds.top) / bounds.height - 0.5,
    });
  });

  stage.addEventListener('pointerleave', () => {
    pointerInside = false;
    setTarget();
  });

  window.addEventListener('scroll', () => {
    if (!pointerInside) setTarget();
  }, {passive: true});

  setTarget();
}

/* ---------- headline reveal ---------- */
/*
 * React Bits' SplitText, ported the way this site is built. The library is
 * React and these pages are static HTML, so the effect is reimplemented rather
 * than imported — the same idea, none of the runtime.
 *
 * Words rather than characters: a payment headline should read as language on
 * the way in, not assemble itself letter by letter.
 */
function splitIntoWords(element) {
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const fragment = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach(part => {
        if (!part.trim()) {
          fragment.appendChild(document.createTextNode(part));
          return;
        }
        const word = document.createElement('span');
        word.className = 'word';
        word.textContent = part;
        fragment.appendChild(word);
      });
      node.replaceWith(fragment);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
      [...node.childNodes].forEach(walk);
    }
  };
  [...element.childNodes].forEach(walk);

  element.querySelectorAll('.word').forEach((word, index) => {
    word.style.setProperty('--word-delay', `${index * 42}ms`);
  });
}

if (!reduceMotion) {
  const headlines = document.querySelectorAll('[data-split]');
  headlines.forEach(splitIntoWords);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.dataset.split = 'shown';
          observer.unobserve(entry.target);
        });
      },
      {threshold: 0.3},
    );
    headlines.forEach(headline => {
      // The hero is already on screen; anything below waits its turn.
      if (headline.closest('.hero')) headline.dataset.split = 'shown';
      else observer.observe(headline);
    });
  } else {
    headlines.forEach(headline => { headline.dataset.split = 'shown'; });
  }
}

/* ---------- ledger figure ---------- */
/* CountUp, same reasoning: the number is evidence, so it counts to the real
   value and never past it. */
function countUp(element) {
  const target = Number(element.dataset.countTo);
  if (!Number.isFinite(target)) return;

  const duration = 1100;
  const start = performance.now();
  const format = new Intl.NumberFormat('en-US');

  const step = now => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format.format(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const counters = [...document.querySelectorAll('[data-count-to]')];
if (counters.length && !reduceMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        observer.unobserve(entry.target);
      });
    },
    {threshold: 0.6},
  );
  counters.forEach(counter => observer.observe(counter));
}
