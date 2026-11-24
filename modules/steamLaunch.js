'use strict';
/**
 * modules/steamLaunch.js
 *
 * The exe Steam starts for a game, from the game's launch settings
 * (config.launch in Steam's app info). Steam keeps these in an undocumented
 * local cache, so they are read from api.steamcmd.net, a public service that
 * serves the same app info. Answers are cached in
 * ~/.stereopticon/cache/steam-launch.json, so each game is looked up once.
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const { BASE } = require('./appSettings');

const CACHE_FILE = path.join(BASE, 'cache', 'steam-launch.json');
let _cache = null;

function cache() {
    if (_cache) return _cache;
    try { _cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { _cache = {}; }
    return _cache;
}
function save() {
    try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(_cache)); }
    catch { /* the cache is optional */ }
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Stereopticon', Accept: 'application/json' } }, res => {
            let body = ''; res.setEncoding('utf8');
            res.on('data', c => { body += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
        });
        req.setTimeout(10000, () => req.destroy(new Error('Timed out')));
        req.on('error', reject);
    });
}

// Launchers and tools that a launch entry may point at instead of the game.
const NOT_THE_GAME = /launcher|setup|install|redist|vcredist|dxsetup|config|settings|crash|report|benchmark|editor|server|unins/i;

/** Windows launch entries' exes (relative to the game folder), best first. */
function windowsExes(launch) {
    const entries = Object.values(launch || {}).filter(e => e && e.executable);
    const forWindows = entries.filter(e => {
        const os = String(e.config?.oslist || '');
        return !os || /windows/i.test(os);
    }).filter(e => /\.exe$/i.test(e.executable));
    const rank = e => (NOT_THE_GAME.test(path.basename(e.executable)) ? 2 : 0) +
                      (e.type && !/default|none/i.test(e.type) ? 1 : 0);
    return forWindows.sort((a, b) => rank(a) - rank(b))
        .map(e => e.executable.replace(/^\.[\\/]/, '').replace(/\//g, '\\'));
}

/** Relative exe paths Steam lists for an app ([] if none or offline). */
async function launchExes(appId) {
    const id = String(appId || '');
    if (!/^\d+$/.test(id)) return [];
    const c = cache();
    if (c[id] && Date.now() - c[id].at < 30 * 24 * 60 * 60 * 1000) return c[id].exes;
    try {
        const j = await getJson(`https://api.steamcmd.net/v1/info/${id}`);
        const app = j?.data?.[id];
        const exes = windowsExes(app?.config?.launch);
        c[id] = { at: Date.now(), exes };
        save();
        return exes;
    } catch {
        return c[id]?.exes || [];
    }
}

/**
 * The game's own exe from a launcher's list (full paths that exist):
 *   - an Unreal stub at the top of the folder is followed to the real
 *     <Game>\Binaries\Win64\<Game>-Shipping.exe, which is what wiz3D needs;
 *   - with several candidates, one that uses a graphics API (d3d9, dxgi,
 *     opengl32 ...) beats a launcher such as PlayGTAV.exe.
 */
function bestGameExe(candidates) {
    const { findUnrealShippingExe } = require('./gameEngineUtils');
    const peInfo = require('./peInfo');
    const resolved = [...new Set(candidates.filter(p => p && fs.existsSync(p)).map(p => {
        try { return findUnrealShippingExe(p) || p; } catch { return p; }
    }))];
    if (resolved.length <= 1) return resolved[0] || null;
    const graphics = resolved.find(p => {
        const pe = peInfo.readPe(p);
        return pe && peInfo.graphicsApiFromImports(pe.imports);
    });
    return graphics || resolved[0];
}

/** The exe Steam launches for appId, as a full path under gameDir, if it exists. */
async function findExe(appId, gameDir) {
    if (!gameDir) return null;
    const rels = await launchExes(appId);
    return bestGameExe(rels.map(rel => path.join(gameDir, rel)));
}

module.exports = { findExe, launchExes, windowsExes, bestGameExe };
