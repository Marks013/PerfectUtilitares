(function () {
  var storageKey = "app-theme";
  var root = document.documentElement;

  function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    var normalized = normalizeTheme(theme);
    root.dataset.theme = normalized;
    root.classList.toggle("light", normalized === "light");
    root.classList.toggle("dark", normalized === "dark");
    return normalized;
  }

  var storedTheme = null;
  try {
    storedTheme = window.localStorage.getItem(storageKey);
  } catch (_) {
    storedTheme = null;
  }

  applyTheme(storedTheme || root.dataset.theme || "dark");

  window.AppTheme = {
    get: function () {
      return normalizeTheme(root.dataset.theme);
    },
    set: function (theme) {
      var normalized = applyTheme(theme);
      try {
        window.localStorage.setItem(storageKey, normalized);
      } catch (_) {}
      window.dispatchEvent(
        new CustomEvent("app-theme-change", { detail: { theme: normalized } }),
      );
      return normalized;
    },
    toggle: function () {
      return this.set(this.get() === "dark" ? "light" : "dark");
    },
  };
})();
