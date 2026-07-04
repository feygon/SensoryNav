(function () {
  const storageKey = "sensorynav-theme";
  let togglesBound = false;

  // An explicit user choice ("dark"/"light") is stored; anything else means
  // "no explicit choice — defer to the browser".
  function getStoredPreference() {
    const stored = localStorage.getItem(storageKey);
    return stored === "dark" || stored === "light" ? stored : null;
  }

  function systemPrefersDark() {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // Effective theme = explicit stored choice if any, otherwise the browser/OS
  // preference (Chrome's built-in dark mode). Our theme is subservient to it:
  // absent a user override, whatever Chrome reports wins. Light is the last resort.
  function getTheme() {
    const stored = getStoredPreference();
    if (stored) return stored;
    return systemPrefersDark() ? "dark" : "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    const root = document.documentElement;
    root.classList.toggle("dark-mode", isDark);
    // Declare the active scheme to the UA so native controls (form inputs,
    // <progress>, scrollbars, date pickers) render to match — this is what makes
    // dark mode cooperate with the browser's built-in accessibility rendering.
    if (root.style) {
      root.style.colorScheme = isDark ? "dark" : "light";
    }

    if (document.body) {
      document.body.classList.toggle("dark-mode", isDark);
    }

    updateToggleLabels(theme);
  }

  function setTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    localStorage.setItem(storageKey, nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new CustomEvent("sensorynav-theme-change", {
      detail: { theme: nextTheme }
    }));
  }

  function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }

  function updateToggleLabels(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
      const targetTheme = theme === "dark" ? "light" : "dark";
      const label = targetTheme === "light" ? "Light mode" : "Dark mode";

      toggle.innerHTML = `${getBulbIcon(targetTheme)}<span>${label}</span>`;
      toggle.setAttribute("aria-label", targetTheme === "light" ? "Switch to light mode" : "Switch to dark mode");
      toggle.setAttribute("title", targetTheme === "light" ? "Switch to light mode" : "Switch to dark mode");
    });
  }

  function getBulbIcon(targetTheme) {
    const isLightTarget = targetTheme === "light";

    if (isLightTarget) {
      return `<svg class="bulb-icon bulb-icon-on" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M9 21h6"/><path d="M10 17h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.9.7 1.6 1.8 1.6 3.2h4c0-1.4.7-2.5 1.6-3.2A6 6 0 0 0 12 3Z" fill="currentColor"/><path d="M12 1v1"/><path d="M4.2 4.2l.7.7"/><path d="M19.8 4.2l-.7.7"/><path d="M3 12h1"/><path d="M20 12h1"/></svg>`;
    }

    return `<svg class="bulb-icon bulb-icon-off" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M8.7 21h6.6"/><path d="M9.6 17h4.8"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.9.7 1.6 1.8 1.6 3.2h4c0-1.4.7-2.5 1.6-3.2A6 6 0 0 0 12 3Z" fill="#000" stroke="#000"/><circle cx="9.7" cy="6.7" r="0.9" fill="#fff" stroke="none"/></svg>`;
  }

  function handleThemeToggleClick(event) {
    if (!event.target.closest("[data-theme-toggle]")) {
      return;
    }

    event.preventDefault();
    toggleTheme();
  }

  // When the user has NOT made an explicit choice, follow live changes to the
  // browser/OS scheme (e.g. Chrome auto-switching at sunset).
  function watchSystemPreference() {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!getStoredPreference()) {
        applyTheme(getTheme());
      }
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
    }
  }

  function bindThemeToggles() {
    if (!togglesBound) {
      document.addEventListener("click", handleThemeToggleClick);
      watchSystemPreference();
      togglesBound = true;
    }

    applyTheme(getTheme());
  }

  window.SensoryNavTheme = {
    applyTheme,
    getTheme,
    setTheme,
    toggleTheme
  };

  applyTheme(getTheme());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindThemeToggles);
  } else {
    bindThemeToggles();
  }
}());
