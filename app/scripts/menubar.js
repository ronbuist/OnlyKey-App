/*
 * Menu-bar mode (macOS).
 *
 * - The main window starts hidden ("show": false in package.json); on macOS the app
 *   lives in the menu bar only (LSUIElement in Info.plist removes the Dock icon).
 * - Closing the main window hides it; the app keeps running so it can keep talking to
 *   the OnlyKey (e.g. setting the key's clock for TOTP whenever it is plugged in).
 * - When a locked OnlyKey is plugged in, a small separate unlock window opens.
 *
 * On Windows and Linux nothing changes: the main window is shown at startup and
 * closing it quits the app, as before.
 *
 * Other scripts use window.okMenuBar (see the bottom of this file).
 */
(function () {
  "use strict";

  if (typeof nw == "undefined") return;

  const os = require("os");
  const osx = os.platform() === "darwin";
  const mainWin = nw.Window.get();

  const PANEL_LINKS = {
    setup: "show-init-panel",
    slots: "show-slot-panel",
    keys: "show-keys-panel",
    backup: "show-backup-panel",
    firmware: "show-firmware-panel",
    preferences: "show-pref-panel",
    advanced: "show-advanced-panel",
    tools: "show-tools-panel",
  };

  let mainVisible = false;
  let quitting = false;
  let unlockWin = null;
  let unlockWinOpening = false;
  let unlockWinReady = false;
  let unlockShownForThisConnection = false;
  let state = {
    connected: false,
    initialized: false,
    locked: false,
    bootloader: false,
    configMode: false,
    deviceType: null,
  };
  const listeners = [];

  // ---------------------------------------------------------------------------
  // Main window
  // ---------------------------------------------------------------------------

  function showMainWindow(panel) {
    closeUnlockWindow();
    mainWin.show();
    mainWin.restore && mainWin.restore();
    mainWin.focus();
    mainVisible = true;

    const linkId = PANEL_LINKS[panel];
    if (linkId) {
      const link = document.getElementById(linkId);
      if (link && !link.classList.contains("hide")) link.click();
    }
    notify();
  }

  function hideMainWindow() {
    mainWin.hide();
    mainVisible = false;
    notify();
  }

  function quitApp() {
    quitting = true;
    closeUnlockWindow();
    nw.App.quit();
  }

  function isPanelAvailable(panel) {
    const link = document.getElementById(PANEL_LINKS[panel]);
    // Locked (initialized) keys must be unlocked first; a new key only offers Setup.
    const usable = state.connected && (!state.locked || !state.initialized || state.bootloader);
    return !!link && !link.classList.contains("hide") && usable;
  }

  if (osx) {
    // Start hidden ("show": false in package.json) and without a Dock icon:
    // NW.js's setShowInTaskbar(false) makes the whole app a menu-bar app on macOS. Don't use LSUIElement in Info.plist instead: Chromium
    // then takes the app for one of its helper processes and crashes at startup.
    mainWin.hide();
    try {
      mainWin.setShowInTaskbar(false);
    } catch (e) {
      console.warn("menubar.js: setShowInTaskbar(false) failed", e);
    }

    // Standard Edit menu, so Cmd+C / Cmd+V / Cmd+A work in text fields even though
    // the app has no visible menu bar of its own.
    try {
      const appMenu = new nw.Menu({ type: "menubar" });
      appMenu.createMacBuiltin((nw.App.manifest && nw.App.manifest.productName) || "OnlyKey", { hideWindow: true });
      mainWin.menu = appMenu;
    } catch (e) {
      console.warn("menubar.js: could not create macOS builtin menu", e);
    }

    // Close button / Cmd+W hides the window. Cmd+Q ("quit") really quits.
    mainWin.on("close", function (reason) {
      if (quitting || reason === "quit") {
        quitting = true;
        closeUnlockWindow();
        this.close(true);
        return;
      }
      hideMainWindow();
    });

    mainWin.on("minimize", () => {
      mainVisible = false;
      notify();
    });
    mainWin.on("restore", () => {
      mainVisible = true;
      notify();
    });

    // Safety net: if the menu-bar icon failed to appear, show the window so the
    // app is never running invisibly.
    setTimeout(() => {
      if (!window.okTray) {
        console.error("menubar.js: no menu-bar icon after 8 s, showing the main window");
        showMainWindow();
      }
    }, 8000);

    // Opening the app again from Finder / Launchpad while it is running.
    nw.App.on("reopen", () => showMainWindow());

    // window.confirm / window.alert block the whole app until answered (e.g. the
    // "new firmware available" question). Make sure the main window is visible first,
    // otherwise the question would sit in a hidden window.
    const nativeConfirm = window.confirm.bind(window);
    const nativeAlert = window.alert.bind(window);
    window.confirm = (...args) => {
      if (!mainVisible) showMainWindow();
      return nativeConfirm(...args);
    };
    window.alert = (...args) => {
      if (!mainVisible) showMainWindow();
      return nativeAlert(...args);
    };
  } else {
    // Previous behaviour on Windows/Linux: show the window at startup.
    showMainWindow();
  }

  // ---------------------------------------------------------------------------
  // Unlock window
  // ---------------------------------------------------------------------------

  function openUnlockWindow() {
    if (!state.connected || !state.locked) return;

    if (unlockWin) {
      unlockWin.show();
      unlockWin.focus();
      return;
    }
    if (unlockWinOpening) return;
    unlockWinOpening = true;
    unlockShownForThisConnection = true;

    const isDuo = state.deviceType === "duo";
    nw.Window.open(
      "unlock.html",
      {
        id: "onlykey-unlock",
        title: "Unlock OnlyKey",
        width: 380,
        height: isDuo ? 255 : 200,
        resizable: false,
        position: "center",
        focus: true,
        show: true,
        show_in_taskbar: false,
      },
      function (win) {
        unlockWinOpening = false;
        // The key may have been unlocked or removed while the window was opening.
        if (!state.connected || !state.locked) {
          win.close(true);
          return;
        }
        unlockWin = win;
        unlockWinReady = false;

        win.on("loaded", () => {
          unlockWinReady = true;
          const w = win.window;
          if (w && typeof w.initUnlock === "function") {
            w.initUnlock({
              submitPin: (pin) => window.OnlyKeyBridge && window.OnlyKeyBridge.submitDuoPin(pin),
              openMainWindow: () => showMainWindow(),
              close: () => closeUnlockWindow(),
            });
            pushStateToUnlockWindow();
          }
          win.focus();
        });

        win.on("closed", () => {
          unlockWin = null;
          unlockWinReady = false;
          notify();
        });
      }
    );
  }

  // ---------------------------------------------------------------------------
  // About window
  // ---------------------------------------------------------------------------

  let aboutWin = null;
  let aboutWinOpening = false;

  function openAboutWindow() {
    if (aboutWin) {
      aboutWin.show();
      aboutWin.focus();
      return;
    }
    if (aboutWinOpening) return;
    aboutWinOpening = true;

    const manifest = nw.App.manifest || {};
    nw.Window.open(
      "about.html",
      {
        id: "keybar-about",
        title: `About ${manifest.productName || "KeyBar"}`,
        width: 460,
        height: 400,
        resizable: false,
        position: "center",
        focus: true,
        show: true,
      },
      function (win) {
        aboutWinOpening = false;
        aboutWin = win;
        win.on("loaded", () => {
          const w = win.window;
          if (w && typeof w.initAbout === "function") {
            w.initAbout({
              version: manifest.version_name || manifest.version,
              openExternal: (url) => nw.Shell.openExternal(url),
              close: () => win.close(true),
            });
          }
          win.focus();
        });
        win.on("closed", () => {
          aboutWin = null;
        });
      }
    );
  }

  function closeUnlockWindow() {
    if (!unlockWin) return;
    const w = unlockWin;
    unlockWin = null;
    unlockWinReady = false;
    try {
      w.close(true);
    } catch (e) {
      /* already closed */
    }
  }

  function pushStateToUnlockWindow(pinResult) {
    if (!unlockWin || !unlockWinReady) return;
    const w = unlockWin.window;
    if (w && typeof w.updateUnlock === "function") {
      w.updateUnlock(state, pinResult);
    }
  }

  // ---------------------------------------------------------------------------
  // Key state
  // ---------------------------------------------------------------------------

  document.addEventListener("onlykey:state", (e) => {
    const prev = state;
    state = Object.assign({}, e.detail);

    if (!state.connected) {
      unlockShownForThisConnection = false;
      closeUnlockWindow();
    } else if (!osx) {
      // Windows/Linux: the main window handles everything, as before.
    } else if (state.bootloader || !state.initialized) {
      // Firmware loading or first-time setup happens in the main window.
      if (state.deviceType || state.bootloader) {
        closeUnlockWindow();
        if (!mainVisible) showMainWindow();
      }
    } else if (state.locked) {
      // Ask for the PIN in the small window, unless the main window is already in
      // front (it shows its own unlock dialog) or the user dismissed it for this
      // insertion (the menu-bar item "Unlock OnlyKey..." opens it again).
      if (!mainVisible && !state.configMode && !unlockShownForThisConnection && state.deviceType) {
        openUnlockWindow();
      } else {
        pushStateToUnlockWindow();
      }
    } else {
      // Unlocked
      closeUnlockWindow();
    }

    if (prev.connected !== state.connected || prev.locked !== state.locked) {
      console.info("menubar.js: OnlyKey state", state);
    }
    notify();
  });

  document.addEventListener("onlykey:pin-result", (e) => {
    if (e.detail && e.detail.setpin) return; // PIN setup in the wizard, not an unlock
    pushStateToUnlockWindow(e.detail && e.detail.result);
  });

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error(err);
      }
    });
  }

  window.okMenuBar = {
    enabled: osx,
    showMainWindow,
    hideMainWindow,
    openUnlockWindow,
    openAboutWindow,
    quit: quitApp,
    isPanelAvailable,
    getState: () => state,
    isMainVisible: () => mainVisible,
    onChange: (fn) => listeners.push(fn),
  };
})();
