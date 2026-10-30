(() => {
  const REPO = 'Nimaj2002/UniHelperProMax';
  const M = window.Motion; // undefined if the CDN failed: the page still works, just without motion
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionOn = !!M && !reduced;
  const spring = { type: 'spring', stiffness: 380, damping: 34 };

  const OS_NAMES = { windows: 'Windows', macos: 'macOS', linux: 'Linux', docker: 'Docker' };
  const HERO_CMD = {
    windows: 'irm https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.ps1 | iex',
    macos: 'curl -fsSL https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.sh | bash',
    linux: 'curl -fsSL https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.sh | bash',
    docker: 'git clone https://github.com/Nimaj2002/UniHelperProMax.git && cd UniHelperProMax && mkdir -p backend/data keys && docker compose up -d --build',
  };
  const ASSET_MATCH = { windows: [/\.exe$/i], macos: [/\.dmg$/i], linux: [/\.AppImage$/i, /\.deb$/i] };

  function detectOS() {
    const ua = navigator.userAgent;
    const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    if (p.includes('win') || /Windows/.test(ua)) return 'windows';
    if (p.includes('mac') || /Mac OS X|iPhone|iPad/.test(ua)) return 'macos';
    return 'linux';
  }

  /* ---------- Tabs (segmented control with a sliding pill) ---------- */
  const tabSets = {};
  document.querySelectorAll('[data-tabs]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.setAttribute('aria-hidden', 'true');
    list.prepend(pill);

    const placePill = (tab, animate) => {
      const to = { x: tab.offsetLeft, width: tab.offsetWidth };
      // Motion tracks its own transform values, so once it's on, every placement goes through it.
      if (motionOn) M.animate(pill, to, animate ? spring : { duration: 0 });
      else Object.assign(pill.style, { transform: `translateX(${to.x}px)`, width: `${to.width}px` });
    };

    const select = (tab, { focus = false, animate = true } = {}) => {
      const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      placePill(tab, animate);
      if (focus) tab.focus();
      if (animate && motionOn && current !== tab) {
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        const dir = tabs.indexOf(tab) > tabs.indexOf(current) ? 1 : -1;
        M.animate(panel, { opacity: [0, 1], x: [24 * dir, 0] }, { duration: 0.45, ease: [0.22, 1, 0.36, 1] });
        const kids = panel.querySelectorAll('.checks li, .install-card');
        if (kids.length) M.animate(kids, { opacity: [0, 1], y: [12, 0] }, { delay: M.stagger(0.04, { startDelay: 0.08 }), duration: 0.4 });
      }
    };

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (e) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(tabs[(next + tabs.length) % tabs.length], { focus: true });
      });
    });

    const reflow = () => placePill(tabs.find((t) => t.getAttribute('aria-selected') === 'true'), false);
    addEventListener('resize', reflow);
    document.fonts && document.fonts.ready.then(reflow);
    reflow();
    tabSets[list.dataset.tabs] = { tabs, select };
  });

  /* ---------- OS-aware defaults ---------- */
  const os = detectOS();
  const osTab = tabSets.os && tabSets.os.tabs.find((t) => t.dataset.os === os);
  if (osTab) tabSets.os.select(osTab, { animate: false });
  document.getElementById('hero-cmd').textContent = HERO_CMD[os];
  document.getElementById('hero-download-label').textContent = `Download for ${OS_NAMES[os]}`;
  document.getElementById('os-hint').textContent = `Looks like you're on ${OS_NAMES[os]}, so that's selected. Every option is one tab away.`;

  /* ---------- Copy buttons ---------- */
  const copy = async (text, btn) => {
    try {
      await navigator.clipboard.writeText(text);
      const label = btn.textContent;
      btn.textContent = 'Copied';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1600);
    } catch {
      btn.textContent = 'Select & copy';
    }
  };
  document.querySelectorAll('pre.code:not(.code-tree)').forEach((pre) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy command');
    btn.addEventListener('click', () => copy(pre.querySelector('code').textContent, btn));
    pre.append(btn);
  });
  document.querySelectorAll('[data-copy-target]').forEach((btn) =>
    btn.addEventListener('click', () => copy(document.getElementById(btn.dataset.copyTarget).textContent, btn)));

  /* ---------- Latest release files from GitHub ---------- */
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      const version = rel.tag_name;
      document.getElementById('hero-version').textContent = `Latest: ${version}`;
      document.getElementById('res-version').textContent = version;
      Object.entries(ASSET_MATCH).forEach(([key, patterns]) => {
        const files = patterns.map((re) => rel.assets.find((a) => re.test(a.name))).filter(Boolean);
        const box = document.querySelector(`[data-assets="${key}"]`);
        if (!files.length || !box) return;
        box.replaceChildren(...files.map((a) => {
          const link = document.createElement('a');
          link.className = 'asset';
          link.href = a.browser_download_url;
          const name = document.createElement('span');
          name.className = 'mono';
          name.textContent = a.name;
          const size = document.createElement('span');
          size.className = 'size';
          size.textContent = mb(a.size);
          link.append(name, size);
          return link;
        }));
        if (key === os) {
          document.getElementById('hero-download').href = files[0].browser_download_url;
          document.getElementById('hero-download-label').textContent = `Download for ${OS_NAMES[os]} · ${version}`;
        }
      });
    })
    .catch(() => { /* keep the releases/latest links already in the HTML */ });

  /* ---------- Motion ---------- */
  if (!motionOn) return;
  const { animate, inView, scroll, stagger } = M;
  const ease = [0.22, 1, 0.36, 1];

  document.querySelectorAll('[data-reveal]').forEach((el) => {
    el.style.opacity = 0;
    inView(el, () => { animate(el, { opacity: 1, y: [28, 0] }, { duration: 0.8, ease }); }, { margin: '0px 0px -10% 0px' });
  });
  document.querySelectorAll('[data-stagger]').forEach((group) => {
    const kids = [...group.children];
    kids.forEach((k) => { k.style.opacity = 0; });
    inView(group, () => { animate(kids, { opacity: 1, y: [32, 0] }, { duration: 0.7, ease, delay: stagger(0.06) }); }, { margin: '0px 0px -10% 0px' });
  });

  // Hero screenshot tilts up into place as the page scrolls.
  const shot = document.querySelector('[data-hero-shot]');
  shot.parentElement.style.perspective = '1600px';
  animate(shot, { opacity: [0, 1] }, { duration: 1, delay: 0.4 });
  scroll(animate(shot, { rotateX: [18, 0], scale: [0.92, 1], y: [40, 0] }, { ease: 'linear' }),
    { target: shot, offset: ['start end', 'start 0.35'] });

  // Ambient glow drifts slower than the page.
  scroll(animate('.glow-hero', { y: [0, 200], opacity: [1, 0.3] }, { ease: 'linear' }),
    { target: document.querySelector('.hero'), offset: ['start start', 'end start'] });
})();
