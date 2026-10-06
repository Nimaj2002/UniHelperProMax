// Applies the last theme before the app loads, so pages never flash the wrong theme (005 C5).
// Mirrors src/app/theme.tsx; the app takes over (and corrects it) once it starts.
(function () {
  try {
    var c = JSON.parse(localStorage.getItem("uh.theme") || "null") || { kind: "system" };
    var root = document.documentElement;
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = c.kind === "light" || c.kind === "dark" ? c.kind : c.kind === "custom" ? c.base : dark ? "dark" : "light";
    root.dataset.theme = theme === "dark" ? "dark" : "light";
    if (c.kind === "custom" && c.vars) {
      for (var name in c.vars) {
        if (/^--[a-z-]+$/.test(name) && /^#[0-9a-f]{6}$/i.test(c.vars[name])) root.style.setProperty(name, c.vars[name]);
      }
    }
  } catch (e) {
    /* no cached theme: the app applies one when it starts */
  }
})();
