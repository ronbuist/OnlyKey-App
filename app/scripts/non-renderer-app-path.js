// Path of the outer .app bundle (macOS), used for auto-launch on login.
// process.execPath points into a helper inside the bundle, e.g.
//   /Applications/OnlyKey Menu Bar.app/Contents/Frameworks/.../nwjs Helper (Renderer).app/...
// so the first "*.app" in the path is the app itself, whatever it is called
// (in development this is node_modules/nw/.../nwjs.app).
console.log({ location: 'non-renderer-app-path.js', process_execPath: process.execPath })
const match = process.execPath.match(/^(.*?\.app)(\/|$)/);
const appPath = match ? match[1] : process.execPath;

module.exports = appPath;
