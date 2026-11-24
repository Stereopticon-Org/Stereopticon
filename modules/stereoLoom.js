'use strict';
/**
 * modules/stereoLoom.js
 *
 * Stereo Loom (github.com/Stereopticon-Org/StereoLoom) is a single tray-app
 * .exe. Stereopticon downloads the latest release on request into
 * <tools>/stereoloom/<tag>/StereoLoom.exe and starts it from there.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { toolDir } = require('./appPaths');

const REPO = 'Stereopticon-Org/StereoLoom';
const root = () => toolDir('stereoloom');
const currentFile = () => path.join(root(), 'current.json');

function request(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Stereopticon', Accept: 'application/vnd.github+json' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(request(new URL(res.headers.location, url).toString(), redirects - 1));
                return;
            }
            if (res.statusCode !== 200) { res.resume(); reject(new Error(`GitHub returned HTTP ${res.statusCode}`)); return; }
            resolve(res);
        }).on('error', reject);
    });
}

function installed() {
    try {
        const cur = JSON.parse(fs.readFileSync(currentFile(), 'utf8'));
        const exe = path.join(root(), cur.tag, 'StereoLoom.exe');
        return fs.existsSync(exe) ? { ...cur, exe } : null;
    } catch { return null; }
}

async function latestRelease() {
    const res = await request(`https://api.github.com/repos/${REPO}/releases/latest`);
    let body = ''; for await (const c of res) body += c;
    const rel = JSON.parse(body);
    const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name));
    if (!asset) throw new Error(`Stereo Loom ${rel.tag_name} has no .exe download`);
    return { tag: rel.tag_name, name: rel.name || rel.tag_name, url: asset.browser_download_url, size: asset.size };
}

async function download(onProgress = () => {}) {
    const rel = await latestRelease();
    const dir = path.join(root(), rel.tag);
    const exe = path.join(dir, 'StereoLoom.exe');
    if (!fs.existsSync(exe)) {
        fs.mkdirSync(dir, { recursive: true });
        const res = await request(rel.url);
        const total = Number(res.headers['content-length']) || rel.size || 0;
        let done = 0;
        const part = exe + '.partial';
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(part);
            res.on('data', c => { done += c.length; if (total) onProgress(Math.round(done / total * 100)); });
            res.on('error', reject); out.on('error', reject); out.on('finish', resolve);
            res.pipe(out);
        });
        fs.renameSync(part, exe);
    }
    fs.writeFileSync(currentFile(), JSON.stringify({ tag: rel.tag, name: rel.name, installedAt: new Date().toISOString() }, null, 2));
    return { tag: rel.tag, exe };
}

/** Start Stereo Loom, downloading it first if needed. */
async function open(onProgress) {
    const loom = installed() || await download(onProgress);
    spawn(loom.exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(loom.exe) }).unref();
    return loom;
}

module.exports = { installed, latestRelease, download, open };
