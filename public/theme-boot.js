(function () {
  try {
    var t = localStorage.getItem("meethint-theme");
    if (t !== "light" && t !== "dark") {
      t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
})();
