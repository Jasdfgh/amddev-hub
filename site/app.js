/* Journey links are ordinary anchors. Highlight the location the visitor chose. */
(() => {
  const links = [...document.querySelectorAll('.journey-rail a')];
  function updateJourneyLocation() {
    const current = !location.hash || location.hash === '#top' || location.hash === '#channels'
      ? '#try-token' : location.hash;
    links.forEach(link => {
      const active = link.getAttribute('href') === current;
      link.classList.toggle('is-current', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('hashchange', updateJourneyLocation);
  updateJourneyLocation();
})();
