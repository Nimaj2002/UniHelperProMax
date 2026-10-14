// Sticky nav hairline once the page scrolls.
const nav = document.querySelector('.nav');
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Copy buttons on code blocks.
document.querySelectorAll('.code__copy').forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.parentElement.querySelector('code').innerText;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      button.classList.add('is-copied');
    } catch {
      button.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('is-copied');
    }, 1800);
  });
});

// Install method tabs (WAI-ARIA tabs pattern), preselected for the visitor's OS.
const tabs = [...document.querySelectorAll('[role="tab"]')];
const selectTab = (tab, focus = false) => {
  tabs.forEach((t) => {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
};
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const moves = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    selectTab(tabs[(moves[event.key] + tabs.length) % tabs.length], true);
  });
});
const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
if (platform.includes('win')) selectTab(document.getElementById('tab-windows'));

// Fade sections in as they enter the viewport.
const revealTargets = document.querySelectorAll(
  '.section__head, .card, .feature, .mini, .install__panel, .accent-card, .data__side, .cta__inner'
);
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  revealTargets.forEach((el) => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}
