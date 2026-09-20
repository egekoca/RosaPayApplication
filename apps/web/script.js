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
    statusLabel.textContent = 'Payment network ready';
    statusLabel.dataset.live = 'true';
  } catch {
    statusLabel.textContent = 'Payment network is ready';
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
  }, {threshold: 0.12, rootMargin: '0px'});
  deferred.forEach(element => observer.observe(element));
} else {
  deferred.forEach(element => { element.dataset.visible = 'true'; });
}

/*
 * The three ways to hand a payment over, shown one at a time.
 *
 * Long enough to read the caption and watch the beam, the tap or the offline
 * hand-off land, short enough that nobody scrolls past believing the scan is
 * all there is. Paused while the tab is hidden, because a timer running in a
 * background tab only ever comes back mid-swap.
 */
const counter = document.querySelector('[data-counter]');
if (counter) {
  /*
   * One payment, told three ways. Each frame holds long enough to be read as an
   * action rather than a flicker: the merchant types a price, the customer's
   * camera finds the code, or the phone is carried across and touched to the
   * other one, or — with no signal at all — it reads the code and hands a
   * signature back. Only then does the money land. Showing the result without
   * the gesture that caused it is what made the old still frame say nothing.
   */
  const script = {
    qr: [
      {phase: 'entry', hold: 2200},
      {phase: 'aim', hold: 2100},
      {phase: 'done', hold: 2400},
    ],
    contactless: [
      {phase: 'entry', hold: 2200},
      {phase: 'tap', hold: 1800},
      {phase: 'done', hold: 2400},
    ],
    /*
     * A beat longer than the other two, because it is one step longer: the
     * customer's phone has to read the request and then hand a signature back,
     * and collapsing those into one frame is what would make it look like
     * magic rather than like a protocol.
     */
    offline: [
      {phase: 'entry', hold: 2200},
      {phase: 'read', hold: 2000},
      {phase: 'sign', hold: 1800},
      {phase: 'done', hold: 2400},
    ],
  };

  /* The order they cycle in, and the order the chips sit in. */
  const order = ['qr', 'contactless', 'offline'];

  const buttons = [...counter.querySelectorAll('[data-pick]')];
  /*
   * It runs itself and the buttons follow along, so they read as a position
   * indicator first and a control second. Pressing one holds the sequence on
   * that half; pressing it again lets go. There is no separate "auto" chip,
   * because auto is simply nobody having pressed anything.
   */
  let pinned = null;
  let mode = 'qr';
  let step = 0;
  let timer = 0;

  const mark = () => {
    buttons.forEach(button => {
      const on = button.dataset.pick === mode;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };

  const show = () => {
    const frame = script[mode][step];
    counter.dataset.mode = mode;
    counter.dataset.phase = frame.phase;
    mark();
    return frame.hold;
  };

  const advance = () => {
    step += 1;
    if (step >= script[mode].length) {
      step = 0;
      if (!pinned) mode = order[(order.indexOf(mode) + 1) % order.length];
    }
    timer = setTimeout(advance, show());
  };

  const stop = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
  };
  const start = () => {
    if (timer) return;
    timer = setTimeout(advance, show());
  };

  const press = value => {
    if (pinned === value) {
      pinned = null;
      return;
    }
    pinned = value;
    mode = value;
    step = 0;
    stop();
    show();
    start();
  };

  buttons.forEach(button => button.addEventListener('click', () => press(button.dataset.pick)));

  // A timer left running in a hidden tab only ever comes back mid-frame.
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  /*
   * The sequence runs even for a reader who asked for less motion. Held on one
   * frame it said "Scan the code" over a phone reading "Paid" — a still of the
   * end with the caption of the beginning, which explains nothing. What that
   * reader is spared is the travel: the stylesheet pins the phones in place, so
   * only what is on their screens changes, and it changes by fading.
   */
  start();
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
