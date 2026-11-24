'use strict';
/**
 * modules/appUpdater.js
 *
 * Updates for Stereopticon itself, from its GitHub releases.
 *
 *   Installed copy (Setup.exe): electron-updater downloads the new installer
 *   and runs it when the user says so.
 *   Portable copy or running from source: no self-update; the user is sent to
 *   the release page.
 *
 * The channel comes from Settings → About (stable, or beta with pre-releases).
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const appSettings = require('./appSettings');

const REPO = 'Stereopticon-Org/Stereopticon';

let electronApp = null;
try { electronApp = require('electron').app; } catch { /* tests */ }

/** Installed by the NSIS installer (has its uninstaller next to the exe). */
function isInstalledCopy() {
    if (!electronApp?.isPackaged) return false;
    const dir = path.dirname(process.execPath);
    try { return fs.readdirSync(dir).some(f => /^Uninstall .*\.exe$/i.test(f)); }
    catch { return false; }
}

function versionParts(v) {
    const m = /(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(String(v));
    return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] || '' } : null;
}
/** a > b, with a pre-release lower than its final version. */
function isNewer(a, b) {
    const x = versionParts(a), y = versionParts(b);
    if (!x || !y) return false;
    for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i];
    if (x.pre === y.pre) return false;
    if (!x.pre) return true;
    if (!y.pre) return false;
    return x.pre.localeCompare(y.pre, undefined, { numeric: true }) > 0;
}

function fetchReleases() {
    return new Promise((resolve, reject) => {
        https.get(`https://api.github.com/repos/${REPO}/releases?per_page=20`,
            { headers: { 'User-Agent': 'Stereopticon', Accept: 'application/vnd.github+json' } }, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub returned HTTP ${res.statusCode}`)); return; }
            let body = ''; res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

/**
 * { current, latest: {version, name, url, prerelease}|null, updateAvailable,
 *   canInstall, channel }
 */
async function check() {
    const channel = appSettings.get('appChannel') === 'beta' ? 'beta' : 'stable';
    const current = electronApp?.getVersion?.() || require('../package.json').version;
    const releases = (await fetchReleases()).filter(r => !r.draft && (channel === 'beta' || !r.prerelease));
    const rel = releases[0];
    const latest = rel ? { version: rel.tag_name.replace(/^v/, ''), name: rel.name || rel.tag_name,
                           url: rel.html_url, prerelease: !!rel.prerelease } : null;
    return {
        current, latest, channel,
        updateAvailable: !!(latest && isNewer(latest.version, current)),
        canInstall: isInstalledCopy(),
    };
}

/** Download the update with electron-updater, then quit and run the installer. */
async function downloadAndInstall(onProgress = () => {}) {
    if (!isInstalledCopy()) throw new Error('Only the installed copy can update itself. Download the new version from the release page.');
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.allowPrerelease = appSettings.get('appChannel') === 'beta';
    autoUpdater.on('download-progress', p => onProgress(Math.round(p.percent || 0)));
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || !isNewer(result.updateInfo.version, electronApp.getVersion())) {
        throw new Error('No newer version was found.');
    }
    await autoUpdater.downloadUpdate();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { version: result.updateInfo.version };
}

module.exports = { check, downloadAndInstall, isNewer, isInstalledCopy };
