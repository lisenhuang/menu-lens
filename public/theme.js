(() => {
  try {
    const theme = localStorage.getItem('menu-lens-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {}
})();
