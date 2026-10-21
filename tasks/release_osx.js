'use strict';

const Q = require('q');
const path = require('path');
const { execFileSync } = require('child_process');
const jetpack = require('fs-jetpack');
const { replace } = require('./utils');
const nwjs = require('./nwjs');

let projectDir;
let releasesDir;
let tmpDir;
let finalAppDir;
let manifest;
let node_modules_dir;
let arch;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const init = function (params={}) {
    projectDir = params.projectDir || jetpack;
    tmpDir = params.tmpDir || projectDir.dir('./tmp', { empty: true });
    releasesDir = params.releasesDir || projectDir.dir('./releases');
    manifest = params.manifest || projectDir.read('package.json', 'json');
    node_modules_dir = params.node_modules_dir || 'node_modules';
    arch = nwjs.targetArch();

    finalAppDir = tmpDir.cwd(manifest.productName + '.app');
    return Q();
};

const copyRuntime = function () {
    const runtimeApp = path.join(nwjs.runtimeDir(node_modules_dir), 'nwjs.app');
    console.log(`Copying NW.js runtime from ${runtimeApp}...`);

    // ditto keeps the framework symlinks and extended attributes intact
    run('ditto', [runtimeApp, finalAppDir.path()]);

    // Remove the localized strings, otherwise the application name shows up
    // as 'nwjs'. Thanks to https://github.com/nwjs-community/nw-builder/
    finalAppDir.find('Contents/Resources', { matching: '*.lproj/*', files: true, directories: false })
        .forEach((file) => finalAppDir.remove(file));

    return Q();
};

const copyBuiltApp = function () {
    console.log(`Copying /build contents into app.nw`);
    return projectDir.copyAsync('build', finalAppDir.path('Contents/Resources/app.nw'));
};

const plistToJson = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));

const prepareOsSpecificThings = function () {
    console.log('Doing OSX-specific things...');

    // Info.plist: keep NW.js's own Info.plist (it has keys Chromium needs) and
    // overlay our keys from resources/osx/Info.plist on top of it.
    let info = projectDir.read('resources/osx/Info.plist');
    info = replace(info, {
        productName: manifest.productName,
        version: manifest.version
    });
    tmpDir.write('Info.overlay.plist', info);

    const targetPlist = finalAppDir.path('Contents/Info.plist');
    const overlay = plistToJson(tmpDir.path('Info.overlay.plist'));
    if (overlay.LSUIElement || overlay.LSBackgroundOnly) {
        // Chromium treats a bundle with LSUIElement as one of its helper processes,
        // looks for its framework in the wrong place and aborts ("icudtl.dat not found").
        // The Dock icon is hidden at runtime instead (show_in_taskbar: false).
        throw new Error('Do not set LSUIElement / LSBackgroundOnly in resources/osx/Info.plist: NW.js crashes at startup.');
    }
    Object.keys(overlay).forEach((key) => {
        const value = overlay[key];
        const type = typeof value === 'boolean' ? 'bool' : 'string';
        run('plutil', ['-replace', key, `-${type}`, String(value), targetPlist]);
    });
    tmpDir.remove('Info.overlay.plist');

    // Icon
    projectDir.copy('resources/osx/icon.icns', finalAppDir.path('Contents/Resources/icon.icns'), { overwrite: true });

    // Rename executable, so it looks nice in the installer
    jetpack.rename(finalAppDir.path('Contents/MacOS/nwjs'), manifest.productName);

    return Q();
};

const checkArchitecture = function () {
    const exe = finalAppDir.path('Contents/MacOS', manifest.productName);
    const archs = run('lipo', ['-archs', exe]);
    console.log(`Executable architecture(s): ${archs}`);
    if (!archs.split(/\s+/).includes(arch)) {
        throw new Error(`Expected a ${arch} build, but the NW.js runtime is "${archs}". ` +
            `Delete node_modules and run "npm install" again (NWJS_ARCH=${arch}).`);
    }
    return Q();
};

const signApp = function () {
    // Changing Info.plist and adding app.nw invalidates NW.js's signature, and
    // Apple Silicon Macs refuse to start unsigned arm64 code. Re-sign the bundle:
    // ad-hoc ("-") by default, or with your Developer ID via CODESIGN_IDENTITY.
    const identity = process.env.CODESIGN_IDENTITY || '-';
    console.log(`Code signing with identity "${identity}"...`);
    run('codesign', ['--force', '--deep', '--sign', identity, finalAppDir.path()]);
    run('codesign', ['--verify', '--deep', '--strict', finalAppDir.path()]);
    return Q();
};

const copyAppToReleases = function () {
    const target = releasesDir.path(`${manifest.productName}.app`);
    releasesDir.remove(`${manifest.productName}.app`);
    run('ditto', [finalAppDir.path(), target]);
    console.log('App ready!', target);
    return Q();
};

const packToDmgFile = function () {
    const deferred = Q.defer();

    const dmgName = `${manifest.name}_${manifest.version}_${arch}.dmg`;

    let appdmg;
    try {
        appdmg = require('appdmg');
    } catch (e) {
        // appdmg has native dependencies that don't always build (e.g. on newer
        // Node versions); plain hdiutil always works, just without the background.
        console.log('appdmg not available, building a plain DMG with hdiutil...');
        const staging = tmpDir.dir('dmg');
        run('ditto', [finalAppDir.path(), staging.path(`${manifest.productName}.app`)]);
        run('ln', ['-s', '/Applications', staging.path('Applications')]);
        releasesDir.remove(dmgName);
        run('hdiutil', ['create', '-volname', manifest.productName, '-srcfolder', staging.path(),
            '-ov', '-format', 'UDZO', releasesDir.path(dmgName)]);
        console.log('DMG file ready!', releasesDir.path(dmgName));
        return Q();
    }

    // Prepare appdmg config
    let dmgManifest = projectDir.read('resources/osx/appdmg.json');
    dmgManifest = replace(dmgManifest, {
        productName: manifest.productName,
        appPath: finalAppDir.path(),
        dmgIcon: projectDir.path("resources/osx/dmg-icon.icns"),
        dmgBackground: projectDir.path("resources/osx/dmg-background.png")
    });
    tmpDir.write('appdmg.json', dmgManifest);

    // Delete DMG file with this name if already exists
    releasesDir.remove(dmgName);

    console.log('Packaging to DMG file...');

    const readyDmgPath = releasesDir.path(dmgName);
    appdmg({
        source: tmpDir.path('appdmg.json'),
        target: readyDmgPath
    })
    .on('error', function (err) {
        console.error(err);
        deferred.resolve();
    })
    .on('finish', function () {
        console.log('DMG file ready!', readyDmgPath);
        deferred.resolve();
    });

    return deferred.promise;
};

const cleanClutter = function () {
    return tmpDir.removeAsync('.');
};

module.exports = function (params) {
    return init(params)
    .then(copyRuntime)
    .then(copyBuiltApp)
    .then(prepareOsSpecificThings)
    .then(checkArchitecture)
    .then(signApp)
    .then(copyAppToReleases)
    .then(packToDmgFile)
    .then(cleanClutter);
};
