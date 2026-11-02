// QueuePass sign-in look (spec 027 FR-013, research R10): the lines between the stones pulse
// only while this script runs, since it is what offers the pause button (WCAG 2.2.2). Loaded in
// <head> through theme.properties (scripts=js/motion.js), so the page never starts moving when the
// choice remembered is "paused". The choice is kept in localStorage; a browser that refuses
// storage still pauses and plays, and nothing is remembered.
(function () {
  'use strict';

  var KEY = 'qp-sign-in-motion';
  var root = document.documentElement;

  function rememberedPaused() {
    try {
      return window.localStorage.getItem(KEY) === 'paused';
    } catch {
      return false;
    }
  }

  function remember(paused) {
    try {
      if (paused) window.localStorage.setItem(KEY, 'paused');
      else window.localStorage.removeItem(KEY);
    } catch {
      // Storage refused: the choice lasts for this page only.
    }
  }

  function show(button) {
    var paused = root.classList.contains('qp-paused');
    button.setAttribute('aria-pressed', paused ? 'true' : 'false');
    button.textContent = paused ? 'Play animation' : 'Pause animation';
  }

  root.classList.add('qp-animate');
  if (rememberedPaused()) root.classList.add('qp-paused');

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.querySelector('.qp-motion__toggle');
    if (!button) return;
    show(button);
    button.parentElement.hidden = false;
    button.addEventListener('click', function () {
      var paused = !root.classList.contains('qp-paused');
      root.classList.toggle('qp-paused', paused);
      remember(paused);
      show(button);
    });
  });
})();
