(function() {
    'use strict';

    if (typeof nw == 'undefined') return;

    // Shows the app version. The automatic app update check (nw-autoupdater) was
    // removed in this version: it checked the official CryptoTrust releases, which
    // would replace this build, and the package depended on a vulnerable unpacker.
    // The firmware update check (OnlyKeyComm.js) is unaffected.
    const appVersionUi = document.querySelector('#appVersion');
    appVersionUi.innerHTML = `${nw.App.manifest.productName || 'App'} v${nw.App.manifest.version_name}\n`;
})();
