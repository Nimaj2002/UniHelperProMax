import Amber from 'amber-scroll';
import parallax from 'amber-scroll/parallax';
import Motion, { bindScroll } from 'amber-motion';

const REPO = 'Nimaj2002/UniHelperProMax';

/* ---------- Smooth scroll, Yuii parallax, story progress bar ---------- */
const amber = new Amber({ plugins: [parallax] });

bindScroll(amber, new Motion({
  targets: '.progress-bar',
  properties: { s: { v: [0, 1], name: 'scaleX' } },
  respectReducedMotion: false, // a progress bar is information, not decoration
}), { source: 'progress' });

const nav = document.querySelector('.nav-wrap');
// Scroll position that puts an element's top right under the sticky nav.
const pageTop = (el) => Math.round(el.getBoundingClientRect().top + scrollY - nav.offsetHeight);

// Amber's own scrollTo eases out exponentially (fast start), which reads as a snap over a whole
// screen. Glide with ease-in-out instead, feeding each frame to Amber so its state stays in sync.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
let glideId = 0;
function glideTo(y, onDone) {
  const id = ++glideId;
  const from = scrollY;
  const dist = y - from;
  if (reduceMotion.matches || Math.abs(dist) < 2) { amber.scrollTo(y, { immediate: true }); onDone?.(); return; }
  const duration = Math.min(1100, 500 + Math.abs(dist) * 0.3);
  const start = performance.now();
  const frame = (now) => {
    if (id !== glideId) return; // a newer glide (or the user) took over
    const t = Math.min(1, (now - start) / duration);
    amber.scrollTo(from + dist * easeInOut(t), { immediate: true });
    if (t < 1) requestAnimationFrame(frame);
    else onDone?.();
  };
  requestAnimationFrame(frame);
}
// Touch or keyboard scrolling stops a glide instead of fighting it.
addEventListener('touchstart', () => { glideId++; }, { passive: true });
addEventListener('keydown', () => { glideId++; });

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  const target = link && link.hash.length > 1 && document.querySelector(link.hash);
  if (!target) return;
  e.preventDefault();
  history.replaceState(null, '', link.hash);
  // Move keyboard focus along (skip link, nav links) only once there: focusing earlier
  // makes Amber jump straight to the target, which is the snap we're avoiding.
  glideTo(Math.max(0, pageTop(target)), () => {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
});

/* ---------- Wheel pager: one wheel gesture = one chapter ---------- */
const chapters = [...document.querySelectorAll('.chapter')];

// Every resting point: each chapter's top, extra screens inside a chapter taller than the
// viewport (so nothing is skipped), and the page bottom (footer). Measured fresh each time
// because layout changes with tabs, the <details> block and resizes.
function stops() {
  const view = innerHeight - nav.offsetHeight;
  const max = document.documentElement.scrollHeight - innerHeight;
  const out = [max];
  chapters.forEach((c) => {
    const top = pageTop(c);
    const end = top + c.offsetHeight - view;
    out.push(top);
    if (end - top > 24) { // taller than the screen (ignoring a few pixels): page through it
      for (let y = top + Math.round(view * 0.85); y < end; y += Math.round(view * 0.85)) out.push(y);
      out.push(end);
    }
  });
  return [...new Set(out.map((y) => Math.min(max, Math.max(0, y))))].sort((a, b) => a - b);
}

// A gesture is a burst of wheel events with no pause over 200 ms: one mouse-wheel spin, or one
// trackpad swipe including its long inertia tail. Each gesture moves exactly one stop.
const GESTURE_GAP = 200;
let lastWheel = 0;
let target = null;
let targetAt = 0;
addEventListener('wheel', (e) => {
  // Leave pinch-zoom and sideways scrolling (the carousel tab strip, code blocks) alone.
  if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  e.preventDefault(); // Amber skips prevented events, so it won't add its own smooth scroll
  const now = performance.now();
  const sameGesture = now - lastWheel < GESTURE_GAP;
  lastWheel = now;
  if (sameGesture) return;
  // While the previous step is still gliding, count from where it is heading, not where it is.
  const y = target !== null && now - targetAt < 1200 ? target : scrollY;
  const list = stops();
  const to = e.deltaY > 0 ? list.find((s) => s > y + 2) : list.findLast((s) => s < y - 2);
  if (to === undefined) return;
  target = to;
  targetAt = now;
  glideTo(to);
}, { passive: false, capture: true });

/* ---------- Reveal each chapter as it scrolls in ---------- */
const POSES = {
  pop: { y: { v: [48, 0], unit: 'px' }, s: [0.86, 1], o: [0, 1] },
  wobble: { r: [-12, 0], s: [0.8, 1], o: [0, 1] },
};
const chapterAnimations = new Map();
document.querySelectorAll('.chapter').forEach((chapter) => {
  const anims = [];
  const text = chapter.querySelectorAll('[data-reveal=""]');
  if (text.length) {
    anims.push(new Motion({
      targets: text, duration: 650, stagger: 90, easing: 'o4',
      properties: { y: { v: [28, 0], unit: 'px' }, o: [0, 1] },
    }));
  }
  chapter.querySelectorAll('[data-reveal="pop"], [data-reveal="wobble"]').forEach((el) => {
    anims.push(new Motion({ targets: el, duration: 900, easing: 'ob', properties: POSES[el.dataset.reveal] }));
  });
  const notes = chapter.querySelectorAll('.sticky');
  if (notes.length) {
    anims.push(new Motion({
      targets: notes, duration: 600, delay: 350, stagger: 140, easing: 'ob',
      properties: { s: [0.4, 1], o: [0, 1] },
    }));
  }
  chapterAnimations.set(chapter, anims);
});
const revealer = new IntersectionObserver((entries) => {
  entries.forEach(({ isIntersecting, target }) => {
    if (!isIntersecting) return;
    chapterAnimations.get(target).forEach((a) => a.play());
    revealer.unobserve(target);
  });
}, { threshold: 0.18 });
chapterAnimations.forEach((_, chapter) => revealer.observe(chapter));

/* ---------- Tabs (feature carousel + install OS picker) ---------- */
function makeTabs(list, onChange) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  let current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  let anim; // one animation owns the panel transition at a time
  const select = (i, { focus = false, animate = true } = {}) => {
    const next = (i + tabs.length) % tabs.length;
    const dir = next > current ? 1 : -1;
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', j === next);
      t.tabIndex = j === next ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = j !== next;
    });
    if (focus) tabs[next].focus({ preventScroll: true });
    // Keep the chosen tab visible in a horizontally scrolling strip without moving the page.
    list.scrollTo({ left: tabs[next].offsetLeft - (list.clientWidth - tabs[next].offsetWidth) / 2, behavior: 'smooth' });
    const panel = document.getElementById(tabs[next].getAttribute('aria-controls'));
    if (animate && next !== current) {
      anim?.destroy();
      anim = new Motion({
        targets: panel, duration: 450, easing: 'o4',
        properties: { x: { v: [40 * dir, 0], unit: 'px' }, o: [0, 1] },
      }).play();
    }
    current = next;
    onChange?.(next, tabs[next]);
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (e) => {
      const to = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      select(to, { focus: true });
    });
  });
  return { tabs, select, get current() { return current; } };
}

const carousel = document.querySelector('[data-carousel]');
const counter = carousel.querySelector('[data-current]');
const slides = makeTabs(carousel.querySelector('[role="tablist"]'), (i) => { counter.textContent = i + 1; });
carousel.querySelector('[data-prev]').addEventListener('click', () => slides.select(slides.current - 1));
carousel.querySelector('[data-next]').addEventListener('click', () => slides.select(slides.current + 1));

const osTabs = makeTabs(document.querySelector('[data-tabs]'));

/* ---------- OS detection + latest release links ---------- */
const OS_NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const ASSET_MATCH = { windows: [/\.exe$/i], macos: [/\.dmg$/i], linux: [/\.AppImage$/i, /\.deb$/i] };

function detectOS() {
  const ua = navigator.userAgent;
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win') || /Windows/.test(ua)) return 'windows';
  if (p.includes('mac') || /Mac OS X|iPhone|iPad/.test(ua)) return 'macos';
  return 'linux';
}
const os = detectOS();
// Phones can't run the installers, so chapter 4 only offers the email form there.
// iPadOS reports itself as a Mac, so a touch-capable "Mac" counts as mobile too.
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
if (isMobile) document.querySelectorAll('#download .actions, #download .meta').forEach((el) => { el.hidden = true; });
osTabs.select(osTabs.tabs.findIndex((t) => t.dataset.os === os), { animate: false });

const mb = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;
fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
  .then((rel) => {
    document.getElementById('dl-version').textContent = `Latest: ${rel.tag_name}`;
    Object.entries(ASSET_MATCH).forEach(([key, patterns]) => {
      const files = patterns.map((re) => rel.assets.find((a) => re.test(a.name))).filter(Boolean);
      const box = document.querySelector(`[data-assets="${key}"]`);
      if (!files.length || !box) return;
      box.replaceChildren(...files.map((a) => {
        const link = document.createElement('a');
        link.className = 'asset';
        link.href = a.browser_download_url;
        const name = Object.assign(document.createElement('span'), { className: 'mono', textContent: a.name });
        const size = Object.assign(document.createElement('span'), { className: 'size', textContent: mb(a.size) });
        link.append(name, size);
        return link;
      }));
      if (key === os) {
        const main = document.getElementById('dl-main');
        main.href = files[0].browser_download_url;
        main.textContent = `Download for ${OS_NAMES[os]}`;
      }
    });
  })
  .catch(() => { /* offline or rate-limited: the static links to the releases page still work */ });

/* ---------- Copy buttons ---------- */
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById(btn.dataset.copy).textContent);
      btn.textContent = 'Copied!';
    } catch {
      btn.textContent = 'Select & copy';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  });
});
