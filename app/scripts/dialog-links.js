const dialogMgr = new DialogMgr();
(document.querySelectorAll('[data-dialog]') || []).forEach(trigger => {
    trigger.addEventListener('click', e => {
        e && e.preventDefault && e.preventDefault();
        const dialog = document.getElementById(trigger.getAttribute('data-dialog'));
        dialogMgr.open(dialog);
    });
});
(document.querySelectorAll('.dialog-close') || []).forEach(btn => {
    btn.addEventListener('click', e => {
        e && e.preventDefault && e.preventDefault();
        dialogMgr.close(btn.parentNode);
    });
});

// Last script on the page: start the wizard and the device code even if
// DOMContentLoaded / load never fire (seen with NW.js on macOS, PR #243).
// Both functions only run once, so the normal events firing as well is harmless.
window.startOnlyKeyWizard && window.startOnlyKeyWizard();
window.startOnlyKeyComm && window.startOnlyKeyComm();
