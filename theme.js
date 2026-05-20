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
      toggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
      toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    });
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
