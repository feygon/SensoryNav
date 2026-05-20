(function () {
  const storageKey = "sensorynav-theme";

  function getTheme() {
    return localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark-mode", isDark);

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

  function bindThemeToggles() {
    document.querySelectorAll("[data-theme-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        toggleTheme();
      });
    });

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
