import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The app version comes from desktop/package.json, which scripts/tag.sh bumps on every release.
// It fills %APP_VERSION% in index.html (JSON-LD softwareVersion and the download filenames shown
// before main.js loads the live release), so the static HTML never goes stale.
function appVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8')).version;
  } catch {
    return null; // built without the rest of the repo: fall back to a neutral placeholder
  }
}

const versionPlugin = () => {
  const version = appVersion();
  return {
    name: 'app-version',
    transformIndexHtml(html) {
      if (version) return html.replaceAll('%APP_VERSION%', version);
      return html
        .replace(/\s*"softwareVersion": "%APP_VERSION%",/, '')
        .replace('Latest: v%APP_VERSION%', 'Latest release')
        .replaceAll('%APP_VERSION%', '&lt;version&gt;');
    },
  };
};

// Relative base so the built site works from any host path (GitHub Pages project URL, a subfolder, …).
export default defineConfig({ base: './', plugins: [versionPlugin()] });
