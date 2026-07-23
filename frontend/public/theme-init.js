// Executado antes do React para evitar flash de tema claro.
(function () {
  try {
    var saved = localStorage.getItem('financaspro:theme');
    var dark = saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (_error) {
    // Preferência de tema é opcional; bloqueios de storage não impedem o app.
  }
})();
