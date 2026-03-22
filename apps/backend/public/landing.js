const messageNodes = Array.from(document.querySelectorAll('.message'));
const typingPulse = document.getElementById('typingPulse');
const ctaPanel = document.getElementById('ctaPanel');
const getStartedButton = document.getElementById('getStartedButton');
const installChecklist = document.getElementById('installChecklist');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const baseDelayMs = 820;
const perMessageDelayMs = 900;
const ctaDelayMs = 880;

function revealImmediate() {
  if (typingPulse) {
    typingPulse.classList.remove('is-visible');
    typingPulse.classList.add('is-hidden');
  }

  messageNodes.forEach((node) => node.classList.add('is-visible'));
  ctaPanel?.classList.add('is-visible');
}

function runSequence() {
  typingPulse?.classList.add('is-visible');

  messageNodes.forEach((node, index) => {
    const revealDelay = baseDelayMs + index * perMessageDelayMs;

    window.setTimeout(() => {
      if (index === 0 && typingPulse) {
        typingPulse.classList.remove('is-visible');
        typingPulse.classList.add('is-hidden');
      }

      node.classList.add('is-visible');
    }, revealDelay);
  });

  const finalDelay = baseDelayMs + messageNodes.length * perMessageDelayMs + ctaDelayMs;
  window.setTimeout(() => ctaPanel?.classList.add('is-visible'), finalDelay);
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
