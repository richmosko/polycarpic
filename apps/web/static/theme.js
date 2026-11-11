(function () {
  var root = document.documentElement;
  var query = window.matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    if (root.classList.contains('auto')) root.classList.toggle('dark', query.matches);
  }
  apply();
  query.addEventListener('change', apply);
})();
