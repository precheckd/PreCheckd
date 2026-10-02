(function () {
  var sidebar = document.getElementById('cc-sidebar');
  if (!sidebar) return;

  var STORAGE_KEY = 'precheckd_cc_collapsed';
  var toggleBtn = document.getElementById('cc-toggle-btn');
  var mobileToggle = document.getElementById('cc-mobile-toggle');
  var backdrop = document.getElementById('cc-sidebar-backdrop');

  // Keep the sidebar's sticky offset (desktop) lined up with the actual
  // header height, since the header can wrap to two lines on narrower
  // viewports rather than staying a fixed size.
  function syncHeaderHeight() {
    var header = document.querySelector('header');
    if (header) {
      document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
    }
  }
  syncHeaderHeight();
  window.addEventListener('resize', syncHeaderHeight);

  // Desktop collapse/expand, persisted across visits. Collapsed is the
  // default (matches the server-rendered markup), so there's nothing to
  // apply on first load unless a prior visit expanded it.
  var stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    // Private browsing / blocked storage — fall back to the default.
  }
  var collapsed = stored === null ? true : stored === 'true';

  function applyCollapsed() {
    sidebar.classList.toggle('cc-collapsed', collapsed);
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  applyCollapsed();

  function setCollapsed(next) {
    collapsed = next;
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch (e) {
      // Ignore — collapse state just won't persist this session.
    }
    applyCollapsed();
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      setCollapsed(!collapsed);
    });
  }

  // A tool like Email Checker has no page of its own to link to, so its
  // header is a button rather than a link: clicking it while collapsed
  // expands the sidebar instead of navigating anywhere.
  var expandButtons = sidebar.querySelectorAll('.cc-nav-item-expand');
  for (var i = 0; i < expandButtons.length; i++) {
    expandButtons[i].addEventListener('click', function () {
      if (collapsed) setCollapsed(false);
    });
  }

  // Mobile off-canvas drawer — separate from the desktop collapse state;
  // always closed on load.
  function openMobile() {
    sidebar.classList.add('cc-mobile-open');
    if (backdrop) backdrop.classList.add('cc-visible');
  }
  function closeMobile() {
    sidebar.classList.remove('cc-mobile-open');
    if (backdrop) backdrop.classList.remove('cc-visible');
  }
  if (mobileToggle) {
    mobileToggle.addEventListener('click', function () {
      if (sidebar.classList.contains('cc-mobile-open')) {
        closeMobile();
      } else {
        openMobile();
      }
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeMobile);
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMobile();
  });
})();
