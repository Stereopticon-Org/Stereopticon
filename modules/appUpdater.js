'use strict';
/**
 * modules/appUpdater.js
 *
 * Updates for Stereopticon itself, from its GitHub releases.
 *
 *   Installed copy (Setup.exe): the new release's installer is downloaded and
 *   started, and Stereopticon quits so it can replace the files. Works the
 *   same for releases and nightly pre-releases.
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
    const published = (await fetchReleases()).filter(r => !r.draft);
    // Until the first full release (1.0) there are only nightly builds, so
    // those are offered whichever channel is chosen.
    const stable = published.filter(r => !r.prerelease);
    const releases = channel === 'beta' || !stable.length ? published : stable;
    const rel = releases[0];
    const setup = rel && (rel.assets || []).find(a => /Setup.*\.exe$/i.test(a.name));
    const latest = rel ? { version: rel.tag_name.replace(/^v/, ''), name: rel.name || rel.tag_name,
                           url: rel.html_url, prerelease: !!rel.prerelease,
                           setupUrl: setup?.browser_download_url || null, setupName: setup?.name || null,
                           setupSize: setup?.size || 0 } : null;
    return {
        current, latest, channel,
        updateAvailable: !!(latest && isNewer(latest.version, current)),
        canInstall: isInstalledCopy(),
    };
}

function download(url, dest, size, onProgress, redirects = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Stereopticon' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(download(new URL(res.headers.location, url).toString(), dest, size, onProgress, redirects - 1));
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub returned HTTP ${res.statusCode}`)); return; }
            const total = Number(res.headers['content-length']) || size || 0;
            let done = 0;
            const out = fs.createWriteStream(dest);
            res.on('data', c => { done += c.length; if (total) onProgress(Math.round(done / total * 100)); });
            res.on('error', reject); out.on('error', reject);
            out.on('finish', () => resolve());
            res.pipe(out);
        }).on('error', reject);
    });
}

/** Download the newer installer, start it, and quit so it can update the files. */
async function downloadAndInstall(onProgress = () => {}) {
    if (!isInstalledCopy()) throw new Error('Only the installed copy can update itself. Download the new version from the release page.');
    const info = await check();
    if (!info.updateAvailable) throw new Error('No newer version was found.');
    if (!info.latest.setupUrl) throw new Error(`Release ${info.latest.version} has no installer to download.`);
    const dest = path.join(require('os').tmpdir(), info.latest.setupName);
    await download(info.latest.setupUrl, dest, info.latest.setupSize, onProgress);
    const { spawn } = require('child_process');
    spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => electronApp.quit(), 500);
    return { version: info.latest.version };
}

module.exports = { check, downloadAndInstall, isNewer, isInstalledCopy };
