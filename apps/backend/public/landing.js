const pageShell = document.getElementById('pageShell');
const messageNodes = Array.from(document.querySelectorAll('.message'));
const ctaPanel = document.getElementById('ctaPanel');
const getStartedButton = document.getElementById('getStartedButton');
const installChecklist = document.getElementById('installChecklist');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const introDelayMs = 320;
const messageGapMs = 420;
const finalHoldMs = 520;

function revealImmediate() {
  messageNodes.forEach((node) => node.classList.add('is-visible'));
  ctaPanel?.classList.add('is-visible');
  pageShell?.classList.add('is-infused');
}

function runSequence() {
  let timeline = introDelayMs;

  messageNodes.forEach((node) => {
    window.setTimeout(() => {
      node.classList.add('is-visible');
    }, timeline);

    timeline += messageGapMs;
  });

  timeline += finalHoldMs;

  window.setTimeout(() => {
    pageShell?.classList.add('is-infused');
    ctaPanel?.classList.add('is-visible');
  }, timeline);
}

function expandChecklist() {
  if (!installChecklist || !getStartedButton) return;
  if (!installChecklist.hidden) return;

  installChecklist.hidden = false;
  getStartedButton.setAttribute('aria-expanded', 'true');
}

if (prefersReducedMotion.matches) {
  revealImmediate();
} else {
  runSequence();
}

getStartedButton?.addEventListener('click', expandChecklist);

prefersReducedMotion.addEventListener('change', (event) => {
  if (event.matches) {
    revealImmediate();
  }
});
