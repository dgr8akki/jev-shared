// Side panels can't show Chrome's permission prompt, so this tab asks once on the extension's behalf.
// The page needs #allow (a button) and #status (role="status"); #status is made focusable here.
const status = document.getElementById('status');
const allow = document.getElementById('allow');
if (!status.hasAttribute('tabindex')) status.setAttribute('tabindex', '-1');

async function requestMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Microphone allowed. Close this tab and press Start listening in the side panel.';
    status.className = 'status ok';
    // Disabling the focused button would drop focus on body; land on the answer instead.
    status.focus({ preventScroll: true });
    allow.disabled = true;
  } catch (error) {
    // The name (NotAllowedError, NotFoundError, …) tells support which of Chrome's dialogs the user saw.
    status.textContent = `Microphone blocked (${error.name}). Click the icon at the left of the address bar, set Microphone to Allow, then press Allow microphone again.`;
    status.className = 'status error';
  }
}

allow.addEventListener('click', requestMicrophone);
requestMicrophone();
