const pageShell = document.getElementById('pageShell');
const messageNodes = Array.from(document.querySelectorAll('.message'));
const typingPulse = document.getElementById('typingPulse');
const ctaPanel = document.getElementById('ctaPanel');
const getStartedButton = document.getElementById('getStartedButton');
const installChecklist = document.getElementById('installChecklist');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const introDelayMs = 540;
const typingLeadMs = 340;
const typingHideMs = 130;
const settleGapMs = 240;
const finalHoldMs = 520;

function revealImmediate() {
  if (typingPulse) {
    typingPulse.classList.remove('is-visible');
    typingPulse.classList.add('is-hidden');
  }

  messageNodes.forEach((node) => node.classList.add('is-visible'));
  ctaPanel?.classList.add('is-visible');
  pageShell?.classList.add('is-infused');
}

function runSequence() {
  let timeline = introDelayMs;

  messageNodes.forEach((node) => {
    const isOutgoing = node.classList.contains('message-outgoing');
    const typingClass = isOutgoing ? 'is-right' : 'is-left';
    const dwellMs = isOutgoing ? 220 : 320;

    window.setTimeout(() => {
      if (!typingPulse) return;
      typingPulse.classList.remove('is-hidden', 'is-left', 'is-right');
      typingPulse.classList.add(typingClass, 'is-visible');
    }, timeline);

    timeline += typingLeadMs + dwellMs;

    window.setTimeout(() => {
      if (typingPulse) {
        typingPulse.classList.remove('is-visible');
        typingPulse.classList.add('is-hidden');
      }
    }, timeline);

    timeline += typingHideMs;

    window.setTimeout(() => {
      node.classList.add('is-visible');
    }, timeline);

    timeline += settleGapMs;
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
