'use strict';
/**
 * modules/wiz3dManager.js
 *
 * Downloads and updates wiz3D itself from its GitHub releases (Stereopticon-Org/wiz3D).
 *
 * Layout under appPaths.toolDir('wiz3d'):
 *   versions/<tag>/      one extracted release, without its top "wiz3D/" folder
 *   current.json         { tag, name, installedAt } of the version in use
 *
 * The two most recent versions are kept, plus any version a game is pinned
 * to, so a game page's choice is never deleted from under it.
 *
 * Channels: 'stable' follows the newest full release; 'beta' also accepts
 * pre-releases. Settings → wiz3D sets the channel (modules/appSettings.js).
 */

const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const AdmZip = require('adm-zip');
const { toolDir } = require('./appPaths');
const appSettings = require('./appSettings');
const gamePrefs   = require('./gamePrefs');

const REPO       = 'Stereopticon-Org/wiz3D';
const USER_AGENT = 'Stereopticon';
const KEEP_VERSIONS = 2;

const rootDir     = () => toolDir('wiz3d');
const versionsDir = () => path.join(rootDir(), 'versions');
const currentFile = () => path.join(rootDir(), 'current.json');

function readCurrent() {
    try {
        const cur = JSON.parse(fs.readFileSync(currentFile(), 'utf8'));
        const dir = path.join(versionsDir(), cur.tag);
        return fs.existsSync(dir) ? { ...cur, dir } : null;
    } catch {
        return null;
    }
}

/** Folder of the wiz3D version in use, or null if none is installed. */
function currentDir() {
    return readCurrent()?.dir || null;
}

// ── Network ───────────────────────────────────────────────────

function request(url, { json = false, redirects = 5 } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                ...(json ? { Accept: 'application/vnd.github+json' } : {}),
            },
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(request(new URL(res.headers.location, url).toString(), { json, redirects: redirects - 1 }));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                const hint = res.statusCode === 403 ? ' (GitHub rate limit; try again in an hour)' : '';
                reject(new Error(`GitHub returned HTTP ${res.statusCode} for ${url}${hint}`));
                return;
            }
            resolve(res);
        });
        req.setTimeout(30000, () => req.destroy(new Error(`Timed out connecting to ${new URL(url).host}`)));
        req.on('error', reject);
    });
}

async function fetchJson(url) {
    const res = await request(url, { json: true });
    let body = '';
    for await (const chunk of res) body += chunk;
    return JSON.parse(body);
}

function toRelease(rel) {
    const asset = (rel.assets || []).find(x => /\.zip$/i.test(x.name));
    if (!asset) return null;
    return {
        tag:         rel.tag_name,
        name:        rel.name || rel.tag_name,
        prerelease:  !!rel.prerelease,
        publishedAt: rel.published_at,
        assetName:   asset.name,
        assetUrl:    asset.browser_download_url,
        size:        asset.size,
    };
}

// Releases before 0.4.0 use another folder layout and output numbering,
// which this version of Stereopticon does not drive.
const MIN_VERSION = [0, 4, 0];
function versionOf(tag) {
    const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(tag));
    return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
}
function isSupported(tag) {
    const v = versionOf(tag);
    if (!v) return false;
    for (let i = 0; i < 3; i++) if (v[i] !== MIN_VERSION[i]) return v[i] > MIN_VERSION[i];
    return true;
}

// The release list changes rarely; one request per ten minutes keeps well
// inside GitHub's 60 requests an hour for anonymous clients.
const LIST_TTL_MS = 10 * 60 * 1000;
let _listCache = null;

/** Every published release with a .zip, newest first. */
async function listReleases({ fresh = false } = {}) {
    if (!fresh && _listCache && Date.now() - _listCache.at < LIST_TTL_MS) return _listCache.list;
    const raw = await fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=50`);
    const list = (Array.isArray(raw) ? raw : [])
        .filter(r => !r.draft)
        .map(toRelease).filter(r => r && isSupported(r.tag));
    // The newest automatic build of main counts as a beta release.
    const build = await latestActionsBuild().catch(() => null);
    if (build && isSupported(build.tag) && !list.some(r => r.tag === build.tag)) list.push(build);
    list.sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)));
    _listCache = { at: Date.now(), list };
    return list;
}

/**
 * The newest successful GitHub Actions build of wiz3D's main branch, as a
 * pre-release. Actions downloads normally need a GitHub sign-in, so the
 * file comes through nightly.link, a public service that serves the
 * artifacts of public repositories.
 */
async function latestActionsBuild() {
    const runs = await fetchJson(`https://api.github.com/repos/${REPO}/actions/workflows/release.yml/runs?branch=main&status=success&per_page=1`);
    const run = runs?.workflow_runs?.[0];
    if (!run) return null;
    const arts = await fetchJson(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/artifacts`);
    const art = (arts?.artifacts || []).find(a => !a.expired && /^wiz3D.v/i.test(a.name));
    if (!art) return null;
    const version = art.name.replace(/^wiz3D.v/i, '');
    return {
        tag:         `v${version}-build.${run.run_number}`,
        name:        `wiz3D ${version} build ${run.run_number} (${String(run.head_sha).slice(0, 7)})`,
        prerelease:  true,
        actionsBuild: true,
        publishedAt: run.updated_at || run.created_at,
        assetName:   `${art.name}.zip`,
        assetUrl:    `https://nightly.link/${REPO}/actions/runs/${run.id}/${encodeURIComponent(art.name)}.zip`,
        size:        0,   // the artifact size is of the unzipped files, not the download
    };
}

function channel() {
    return appSettings.get('wiz3dChannel') === 'beta' ? 'beta' : 'stable';
}

/** Newest release on the channel: { tag, name, prerelease, publishedAt, assetName, assetUrl, size }. */
async function getLatestRelease({ channel: ch = channel() } = {}) {
    const list = await listReleases();
    const rel = ch === 'beta' ? list[0] : list.find(r => !r.prerelease);
    if (!rel) throw new Error('No wiz3D release with a .zip download was found');
    return rel;
}

async function getRelease(tag) {
    const rel = (await listReleases()).find(r => r.tag === tag);
    if (!rel) throw new Error(`wiz3D ${tag} is not a published release`);
    return rel;
}

async function download(url, dest, size, onProgress) {
    const res = await request(url);
    const total = Number(res.headers['content-length']) || size || 0;
    let done = 0;
    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(dest);
        res.on('data', chunk => {
            done += chunk.length;
            if (total) onProgress({ stage: 'download', percent: Math.round(done / total * 100), done, total });
        });
        res.on('error', reject);
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
    });
    if (total && done !== total) throw new Error(`Download incomplete (${done} of ${total} bytes)`);
}

// ── Install ───────────────────────────────────────────────────

// Extract a release zip, dropping its single top-level folder ("wiz3D/").
function extractRelease(zipPath, destDir) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const tops = new Set(entries.map(e => e.entryName.split('/')[0]));
    const strip = tops.size === 1 && entries.every(e => e.entryName.includes('/')) ? [...tops][0] + '/' : '';
    for (const e of entries) {
        const rel = strip ? e.entryName.slice(strip.length) : e.entryName;
        const out = path.join(destDir, rel);
        const back = path.relative(destDir, out);
        if (!rel || back.startsWith('..') || path.isAbsolute(back)) continue;   // never write outside destDir
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, e.getData());
    }
}

function pruneOldVersions(keepTag) {
    const pinned = new Set(gamePrefs.pinnedWiz3DVersions());
    let dirs;
    try { dirs = fs.readdirSync(versionsDir(), { withFileTypes: true }).filter(d => d.isDirectory()); }
    catch { return; }
    const byAge = dirs
        .map(d => ({ name: d.name, mtime: fs.statSync(path.join(versionsDir(), d.name)).mtimeMs }))
        .filter(d => d.name !== keepTag && !d.name.endsWith('.partial') && !pinned.has(d.name) && !isCustomTag(d.name))
        .sort((a, b) => b.mtime - a.mtime);
    for (const d of byAge.slice(KEEP_VERSIONS - 1)) {
        fs.rmSync(path.join(versionsDir(), d.name), { recursive: true, force: true });
    }
}

/**
 * Download a release (the newest on the channel when none is given) and,
 * unless makeCurrent is false, switch to it.
 * onProgress receives { stage: 'check'|'download'|'extract'|'done', percent, message }.
 */
async function installRelease(release = null, onProgress = () => {}, { makeCurrent = true } = {}) {
    onProgress({ stage: 'check', percent: 0, message: 'Checking the latest wiz3D release…' });
    const rel = release || await getLatestRelease();

    const finalDir = path.join(versionsDir(), rel.tag);
    if (!fs.existsSync(finalDir)) {
        const partial = finalDir + '.partial';
        const zipPath = path.join(versionsDir(), `${rel.tag}.zip`);
        fs.mkdirSync(versionsDir(), { recursive: true });
        fs.rmSync(partial, { recursive: true, force: true });
        try {
            await download(rel.assetUrl, zipPath, rel.size, p =>
                onProgress({ ...p, message: `Downloading wiz3D ${rel.tag}… ${p.percent}%` }));
            onProgress({ stage: 'extract', percent: 100, message: `Extracting wiz3D ${rel.tag}…` });
            extractRelease(zipPath, partial);
            // Actions builds may keep an extra folder level; find the real root.
            const root = findReleaseRoot(partial) || partial;
            if (root === partial) fs.renameSync(partial, finalDir);
            else { fs.renameSync(root, finalDir); fs.rmSync(partial, { recursive: true, force: true }); }
        } finally {
            fs.rmSync(zipPath, { force: true });
            fs.rmSync(partial, { recursive: true, force: true });
        }
    }

    if (makeCurrent || !readCurrent()) {
        fs.writeFileSync(currentFile(), JSON.stringify({
            tag: rel.tag, name: rel.name, prerelease: !!rel.prerelease, installedAt: new Date().toISOString(),
        }, null, 2));
        pruneOldVersions(rel.tag);
    }
    onProgress({ stage: 'done', percent: 100, message: `wiz3D ${rel.tag} ready` });
    return { tag: rel.tag, name: rel.name, dir: finalDir };
}

/** Installed wiz3D, downloading the latest release first if there is none. */
async function ensureInstalled(onProgress) {
    return readCurrent() || installRelease(null, onProgress);
}

/**
 * A specific release, downloaded if it is not here yet. The current version
 * is left alone. Returns { tag, name, dir }.
 */
async function ensureVersion(tag, onProgress = () => {}) {
    const dir = path.join(versionsDir(), tag);
    if (fs.existsSync(dir)) return { tag, name: tag, dir };
    return installRelease(await getRelease(tag), onProgress, { makeCurrent: false });
}

/** Tags that are downloaded, current or not. */
function downloadedVersions() {
    try {
        return fs.readdirSync(versionsDir(), { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.endsWith('.partial')).map(d => d.name);
    } catch { return []; }
}

/**
 * { installed: {tag,name,installedAt}|null, latest: {...}|null, updateAvailable, error }
 * The network check is skipped when offline; `error` then says why.
 */
async function status({ checkOnline = true } = {}) {
    const installed = readCurrent();
    let latest = null, error = null;
    if (checkOnline) {
        try { latest = await getLatestRelease(); }
        catch (e) { error = e.message; }
    }
    const info = installed && { tag: installed.tag, name: installed.name, prerelease: !!installed.prerelease,
                                custom: !!installed.custom, installedAt: installed.installedAt };
    return {
        installed: info || null,
        latest,
        channel: channel(),
        // A custom build chosen as the default is never replaced automatically.
        updateAvailable: !!(latest && (!installed || (!installed.custom && installed.tag !== latest.tag))),
        error,
    };
}

// ── Custom builds ─────────────────────────────────────────────
// A wiz3D build from your own PC (a folder or a zip, such as a local build
// or a GitHub Actions artifact), stored as versions/custom-<name> next to
// the downloaded releases. Never pruned; a game page can pick it like a release.

const CUSTOM_PREFIX = 'custom-';
const FAMILY_DIRS = ['Stereo-Injector', 'HD3D', '3D-Vision-Direct', 'OpenGL-Quad-Buffer-Stereo'];
const customFile = () => path.join(rootDir(), 'custom.json');

function isCustomTag(tag) { return String(tag).startsWith(CUSTOM_PREFIX); }

function listCustom() {
    try { return JSON.parse(fs.readFileSync(customFile(), 'utf8')).filter(c => fs.existsSync(path.join(versionsDir(), c.tag))); }
    catch { return []; }
}
function saveCustom(list) {
    fs.mkdirSync(rootDir(), { recursive: true });
    fs.writeFileSync(customFile(), JSON.stringify(list, null, 2));
}

// The folder that holds Stereo-Injector/, HD3D/ ... somewhere under dir.
function findReleaseRoot(dir, depth = 3) {
    let level = [dir];
    for (let d = 0; d <= depth && level.length; d++) {
        const next = [];
        for (const x of level) {
            let items; try { items = fs.readdirSync(x, { withFileTypes: true }); } catch { continue; }
            if (items.some(i => i.isDirectory() && FAMILY_DIRS.includes(i.name))) return x;
            for (const i of items) if (i.isDirectory()) next.push(path.join(x, i.name));
        }
        level = next;
    }
    return null;
}

/** Add a build from a folder or a .zip. Returns { tag, name }. */
function addCustom(source, name) {
    if (!source || !fs.existsSync(source)) throw new Error('That file or folder does not exist.');
    const label = (name || path.basename(source).replace(/\.zip$/i, '')).trim() || 'build';
    const slug = label.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'build';
    let tag = CUSTOM_PREFIX + slug;
    for (let i = 2; fs.existsSync(path.join(versionsDir(), tag)); i++) tag = `${CUSTOM_PREFIX}${slug}-${i}`;
    const dest = path.join(versionsDir(), tag);
    const staging = dest + '.partial';
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        if (/\.zip$/i.test(source)) {
            extractRelease(source, staging);
        } else {
            fs.cpSync(source, staging, { recursive: true });
        }
        const root = findReleaseRoot(staging);
        if (!root) throw new Error(`No wiz3D folders (${FAMILY_DIRS.join(', ')}) were found in it.`);
        if (root === staging) fs.renameSync(staging, dest);
        else { fs.renameSync(root, dest); fs.rmSync(staging, { recursive: true, force: true }); }
    } catch (e) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw e;
    }
    const list = listCustom().filter(c => c.tag !== tag);
    list.push({ tag, name: label, source, addedAt: new Date().toISOString() });
    saveCustom(list);
    return { tag, name: label };
}

function removeCustom(tag) {
    if (!isCustomTag(tag)) throw new Error('Only custom builds can be removed here.');
    if (readCurrent()?.tag === tag) throw new Error('This build is the default. Choose another default first.');
    fs.rmSync(path.join(versionsDir(), tag), { recursive: true, force: true });
    saveCustom(listCustom().filter(c => c.tag !== tag));
}

/** Make a downloaded release or a custom build the default for every game. */
function setCurrent(tag) {
    const dir = path.join(versionsDir(), tag);
    if (!fs.existsSync(dir)) throw new Error(`${tag} is not on this PC.`);
    const custom = listCustom().find(c => c.tag === tag);
    fs.writeFileSync(currentFile(), JSON.stringify({
        tag, name: custom?.name || tag, custom: !!custom, installedAt: new Date().toISOString(),
    }, null, 2));
    return { tag };
}

module.exports = { currentDir, listReleases, getLatestRelease, getRelease, installRelease, ensureInstalled,
                   ensureVersion, downloadedVersions, status, extractRelease, channel, isSupported,
                   listCustom, addCustom, removeCustom, setCurrent, isCustomTag };
