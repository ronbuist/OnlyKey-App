(async function () {
  "use strict";

  if (typeof nw == "undefined") return;

  const userPreferences = require('./scripts/userPreferences.js');
  const settingsMenu = new nw.Menu();
  
  const os = require('os');
  const osx = os.platform() === 'darwin';
  const linux = os.platform() === 'linux';

  const appPath = osx ? require('./scripts/non-renderer-app-path') : process.execPath;
  const productName = (nw.App.manifest && nw.App.manifest.productName) || 'OnlyKey';
  const appName = appPath.includes('node_modules') ? `${productName}-dev` : productName;

  const logParams = {
    location: 'tray.js',
    appPath,
    appName,
    os_platform: os.platform(),
  }

  console.info(logParams);

  const AutoLaunch = require("auto-launch");

  // LINUX: adds "~/.config/autostart/nw.desktop" file when autoLaunch is enabled
  const autoLaunchOptions = {
      name: appName, // the AutoLaunch class overwrites this required prop! (see the "fixOpts" method)
      isHidden: !(osx || linux), // this flag breaks the autoLaunch feature in Mac & Linux 
  };

  if (osx) {
      // MACOS: use a launch agent (~/Library/LaunchAgents/<appName>.plist) instead of a
      // login item: login items go through System Events, which needs an extra
      // permission prompt and can hang. The agent starts the executable directly.
      autoLaunchOptions.path = `${appPath}/Contents/MacOS/${productName}`;
      autoLaunchOptions.mac = { useLaunchAgent: true };
  }

  const autoLaunch = new AutoLaunch(autoLaunchOptions);
  // On macOS isEnabled() asks System Events (AppleScript). That can hang or fail,
  // e.g. while a permission prompt is pending, so never let it block the menu-bar
  // icon: wait at most 3 seconds, then build the menu and update the checkbox later.
  let autoLaunchEnabledInOSAtLaunch = !!userPreferences.autoLaunch;
  const autoLaunchCheck = autoLaunch.isEnabled().then(isEnabled => {
    autoLaunchEnabledInOSAtLaunch = isEnabled;
    userPreferences.autoLaunch = isEnabled;
    return isEnabled;
  }).catch((err) => {
    console.error('tray.js: could not read auto-launch state', err);
    return autoLaunchEnabledInOSAtLaunch;
  });
  await Promise.race([autoLaunchCheck, new Promise((resolve) => setTimeout(resolve, 3000))]);

  // First run: enable auto-launch by default (this used to be done in app.js).
  if (!userPreferences.hasStoredValue('autoLaunch')) {
    autoLaunchCheck.then((isEnabled) => {
      if (isEnabled) return;
      console.info('tray.js: first run, enabling auto-launch');
      return autoLaunch.enable().then(() => {
        userPreferences.autoLaunch = true;
        autoLaunchMenuItem.checked = true;
        refreshMenuItem(autoLaunchMenuItem, 0);
      });
    }).catch(console.error);
  }

  const autoLaunchMenuItem = new nw.MenuItem({
    label: 'Auto-launch app on system login',
    click: function () {
      userPreferences.autoLaunch = !userPreferences.autoLaunch;
      console.info(`Toggled autoLaunch to ${userPreferences.autoLaunch}`);
  
      autoLaunch
        .isEnabled()
        .then((isEnabled) => {
          if (isEnabled && !userPreferences.autoLaunch) {
            autoLaunch.disable();
          } else if (!isEnabled && userPreferences.autoLaunch) {
            autoLaunch.enable();
          }
          refreshMenuItem(autoLaunchMenuItem, 0);
        })
        .catch(console.error);
    },
    type: 'checkbox',
    checked: !!autoLaunchEnabledInOSAtLaunch,
  });
  // the real answer may arrive after the menu was built
  autoLaunchCheck.then((isEnabled) => {
    if (autoLaunchMenuItem.checked !== !!isEnabled) {
      autoLaunchMenuItem.checked = !!isEnabled;
      refreshMenuItem(autoLaunchMenuItem, 0);
    }
  });

  const autoUpdateFWMenuItem = new nw.MenuItem({
    label: 'Automatically check for firmware updates',
    click: function () {
      userPreferences.autoUpdateFW = !userPreferences.autoUpdateFW;
      console.info(`Toggled autoUpdateFW to ${userPreferences.autoUpdateFW}`);
      refreshMenuItem(autoUpdateFWMenuItem, 1);
    },
    type: 'checkbox',
    checked: userPreferences.autoUpdateFW,
  });

  const tray = new nw.Tray({
    icon: './images/ok-tray-logo.png',
  });
  // keep a global reference, otherwise the icon can disappear when garbage-collected
  window.okTray = tray;

  const menuBar = osx && window.okMenuBar && window.okMenuBar.enabled ? window.okMenuBar : null;

  if (!menuBar) {
    // Windows / Linux: unchanged, the tray menu only holds the settings.

    // linux tooltip resulted in menu items failing to render sometimes when the app was launched
    if (!linux) tray.tooltip = 'OnlyKey Configuration App settings';

    settingsMenu.append(autoLaunchMenuItem);
    settingsMenu.append(autoUpdateFWMenuItem);

    // using setTimeout to counteract anomalies including empty tray menu
    setTimeout(() => {
      tray.menu = settingsMenu;
      console.info({ ...logParams, tray });
    }, 500);
  } else {
    // macOS menu-bar mode: everything is reachable from the menu-bar icon.
    tray.iconsAreTemplates = true; // white icon adapts to light/dark menu bar
    tray.tooltip = 'OnlyKey';

    const mainMenu = new nw.Menu();

    const statusItem = new nw.MenuItem({ label: 'No OnlyKey connected', enabled: false });
    const unlockItem = new nw.MenuItem({
      label: 'Unlock OnlyKey\u2026',
      enabled: false,
      click: () => menuBar.openUnlockWindow(),
    });
    const openItem = new nw.MenuItem({
      label: 'Open OnlyKey App',
      click: () => menuBar.showMainWindow(),
    });

    const panelItems = [
      ['slots', 'Slots\u2026'],
      ['keys', 'Keys\u2026'],
      ['backup', 'Backup / Restore\u2026'],
      ['firmware', 'Firmware\u2026'],
      ['preferences', 'Preferences\u2026'],
      ['advanced', 'Advanced\u2026'],
      ['tools', 'Tools\u2026'],
      ['setup', 'Setup\u2026'],
    ].map(([panel, label]) => ({
      panel,
      item: new nw.MenuItem({
        label,
        enabled: false,
        click: () => menuBar.showMainWindow(panel),
      }),
    }));

    // the existing preference checkboxes move into a submenu
    settingsMenu.append(autoLaunchMenuItem);
    settingsMenu.append(autoUpdateFWMenuItem);
    const settingsItem = new nw.MenuItem({ label: 'App Settings', submenu: settingsMenu });

    const quitItem = new nw.MenuItem({
      label: `Quit ${productName}`,
      key: 'q',
      modifiers: 'cmd',
      click: () => menuBar.quit(),
    });

    mainMenu.append(statusItem);
    mainMenu.append(new nw.MenuItem({ type: 'separator' }));
    mainMenu.append(unlockItem);
    mainMenu.append(openItem);
    mainMenu.append(new nw.MenuItem({ type: 'separator' }));
    panelItems.forEach(({ item }) => mainMenu.append(item));
    mainMenu.append(new nw.MenuItem({ type: 'separator' }));
    mainMenu.append(settingsItem);
    mainMenu.append(new nw.MenuItem({ type: 'separator' }));
    mainMenu.append(quitItem);

    const deviceName = (state) => (state.deviceType === 'duo' ? 'OnlyKey DUO' : 'OnlyKey');

    const describe = (state) => {
      if (!state.connected) return 'No OnlyKey connected';
      if (!state.deviceType) return 'OnlyKey connecting\u2026';
      if (state.bootloader) return `${deviceName(state)} \u2013 firmware update mode`;
      if (!state.initialized) return `${deviceName(state)} \u2013 needs setup`;
      if (state.configMode) return `${deviceName(state)} \u2013 config mode`;
      if (state.locked) return `${deviceName(state)} \u2013 locked`;
      return `${deviceName(state)} \u2013 unlocked`;
    };

    let lastSignature = '';
    const refresh = (state) => {
      const status = describe(state);
      const unlockEnabled = state.connected && state.locked && state.initialized && !state.bootloader;
      const panels = panelItems.map(({ panel }) => menuBar.isPanelAvailable(panel));

      // only touch the native menu when something changed
      const signature = JSON.stringify([status, unlockEnabled, panels]);
      if (signature === lastSignature) return;
      lastSignature = signature;

      statusItem.label = status;
      tray.tooltip = status;
      unlockItem.enabled = unlockEnabled;
      panelItems.forEach(({ item }, i) => (item.enabled = panels[i]));
      tray.menu = mainMenu;
    };

    menuBar.onChange(refresh);
    // using setTimeout to counteract anomalies including empty tray menu
    setTimeout(() => {
      refresh(menuBar.getState());
      console.info({ ...logParams, tray });
    }, 500);
  }

  // discovered on linux that the menu item checked state does not live update
  function refreshMenuItem(menuItem, index) {
    if (!linux) return;

    settingsMenu.remove(menuItem);
    settingsMenu.insert(menuItem, index);
    tray.menu = settingsMenu;
  }
})();
