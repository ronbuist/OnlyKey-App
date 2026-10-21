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
      autoLaunchOptions.path = appPath;
  }

  const autoLaunch = new AutoLaunch(autoLaunchOptions);
  let autoLaunchEnabledInOSAtLaunch;
  await autoLaunch.isEnabled().then(isEnabled => {
    autoLaunchEnabledInOSAtLaunch = isEnabled;
    userPreferences.autoLaunch = isEnabled;
  });

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

  const autoUpdateMenuItem = new nw.MenuItem({
    label: 'Automatically check for app updates',
    click: function () {
      userPreferences.autoUpdate = !userPreferences.autoUpdate;
      console.info(`Toggled autoUpdate to ${userPreferences.autoUpdate}`);
      refreshMenuItem(autoUpdateMenuItem, 1);
    },
    type: 'checkbox',
    checked: userPreferences.autoUpdate,
  });

  const autoUpdateFWMenuItem = new nw.MenuItem({
    label: 'Automatically check for firmware updates',
    click: function () {
      userPreferences.autoUpdateFW = !userPreferences.autoUpdateFW;
      console.info(`Toggled autoUpdateFW to ${userPreferences.autoUpdateFW}`);
      refreshMenuItem(autoUpdateFWMenuItem, 2);
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
    settingsMenu.append(autoUpdateMenuItem);
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
      label: 'Unlock OnlyKey…',
      enabled: false,
      click: () => menuBar.openUnlockWindow(),
    });
    const openItem = new nw.MenuItem({
      label: 'Open OnlyKey App',
      click: () => menuBar.showMainWindow(),
    });

    const panelItems = [
      ['slots', 'Slots…'],
      ['keys', 'Keys…'],
      ['backup', 'Backup / Restore…'],
      ['firmware', 'Firmware…'],
      ['preferences', 'Preferences…'],
      ['advanced', 'Advanced…'],
      ['tools', 'Tools…'],
      ['setup', 'Setup…'],
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
    settingsMenu.append(autoUpdateMenuItem);
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
      if (!state.deviceType) return 'OnlyKey connecting…';
      if (state.bootloader) return `${deviceName(state)} – firmware update mode`;
      if (!state.initialized) return `${deviceName(state)} – needs setup`;
      if (state.configMode) return `${deviceName(state)} – config mode`;
      if (state.locked) return `${deviceName(state)} – locked`;
      return `${deviceName(state)} – unlocked`;
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
