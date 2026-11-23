'use strict';
/**
 * modules/userGames.js
 *
 * Games that are not in the catalogue but can still be tried with wiz3D:
 *
 *   - Steam games installed on this PC (read from each library's
 *     appmanifest_<id>.acf), listed automatically with ids "steam_<appid>".
 *   - Games the user adds by picking an .exe, stored in
 *     ~/.stereopticon/user-games.json with ids "user_<slug>".
 *
 * Both come back as ordinary game records with no fixes; the window offers
 * an untested wiz3D fix for any game without one.
 */

const fs   = require('fs');
const path = require('path');
const { BASE } = require('./appSettings');
const peInfo = require('./peInfo');

const STORE = path.join(BASE, 'user-games.json');

// Steam installs that are not games.
const NOT_A_GAME = /redistributable|steamworks|proton|steam linux runtime|steamvr|soundtrack|dedicated server|\bsdk\b|wallpaper engine|benchmark tool|editor$|\btools?\b/i;
const NOT_A_GAME_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710', '431960']);

// Executables that are never the game itself.
const NOT_THE_GAME_EXE = /unins|crash|setup|install|redist|vcredist|vc_redist|dxsetup|directx|prereq|dotnet|launcher|updater|helper|report|easyanticheat|^eac|battleye|beservice|unitycrashhandler|cefprocess|webhelper|uplay|origin|ubisoft|7z|python|node|java|ffmpeg|config|settings/i;

// ── Store ────────────────────────────────────────────────────────

function readStore() {
    try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) || { games: [] }; }
    catch { return { games: [] }; }
}
function writeStore(store) {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
}

const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function graphicsApiOf(exePath) {
    const pe = exePath && peInfo.readPe(exePath);
    let api = pe ? peInfo.graphicsApiFromImports(pe.imports) : null;
    // Unity and Unreal load Direct3D at runtime, so the exe imports none.
    // Both default to DX11 on Windows.
    if (!api && pe) {
        const dir = path.dirname(exePath);
        const unity  = fs.existsSync(path.join(dir, 'UnityPlayer.dll'));
        const unreal = /-Win(64|32)-Shipping\.exe$/i.test(exePath) || /[\\/]Binaries[\\/]Win(64|32)$/i.test(dir);
        if (unity || unreal) api = 'dx10-11';
    }
    return { api, arch: pe?.arch || null };
}

function toGameRecord(entry) {
    const exePath = entry.exe_path || '';
    const { api, arch } = exePath ? graphicsApiOf(exePath) : {};
    return {
        id:             entry.id,
        title:          entry.title,
        developer:      entry.developer || '',
        steam_app_id:   entry.steam_app_id || '',
        exe_name:       exePath ? path.basename(exePath) : '',
        default_path:   exePath || entry.install_dir || '',
        install_dir:    entry.install_dir || (exePath ? path.dirname(exePath) : ''),
        graphics_api:   api || entry.graphics_api || '',
        cpu_architecture: arch || '',
        source:         entry.source,
        fixes:          [],
    };
}

/** Add a game from its executable. Returns the game record. */
function addFromExe(exePath, title) {
    if (!exePath || !fs.existsSync(exePath)) throw new Error('That file does not exist.');
    const store = readStore();
    const existing = store.games.find(g => path.resolve(g.exe_path).toLowerCase() === path.resolve(exePath).toLowerCase());
    if (existing) return toGameRecord(existing);

    // Inside a Steam library? Use the store's name for the folder.
    const steamTitle = steamTitleForPath(exePath);
    const name = title || steamTitle || path.basename(path.dirname(exePath)) || path.basename(exePath, '.exe');
    let id = `user_${slugOf(name) || 'game'}`;
    for (let i = 2; store.games.some(g => g.id === id); i++) id = `user_${slugOf(name)}-${i}`;

    const entry = { id, title: name, exe_path: exePath, install_dir: path.dirname(exePath), source: 'user', added: new Date().toISOString() };
    store.games.push(entry);
    writeStore(store);
    return toGameRecord(entry);
}

function remove(id) {
    const store = readStore();
    store.games = store.games.filter(g => g.id !== id);
    writeStore(store);
}

/** Change a user or Steam game's exe (Steam overrides are stored too). */
function setExe(id, exePath) {
    const store = readStore();
    let entry = store.games.find(g => g.id === id);
    if (!entry) {
        const steam = _steamCache?.find(g => g.id === id);
        if (!steam) throw new Error(`Unknown game ${id}`);
        entry = { ...steam };
        store.games.push(entry);
    }
    entry.exe_path = exePath;
    writeStore(store);
    return toGameRecord(entry);
}

// ── Steam libraries ──────────────────────────────────────────────

let _steamCache = null;

function parseManifest(file) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        const get = k => (new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(text) || [])[1] || '';
        return { appid: get('appid'), name: get('name'), installdir: get('installdir') };
    } catch { return null; }
}

/**
 * Installed Steam games not in the catalogue.
 * commonPaths: Steam "steamapps/common" folders; knownAppIds: catalogue ids.
 */
function discoverSteamGames(commonPaths, knownAppIds) {
    const known = new Set([...knownAppIds].map(String));
    const out = [];
    const seen = new Set();
    for (const common of commonPaths) {
        const steamapps = path.dirname(common);
        let files;
        try { files = fs.readdirSync(steamapps).filter(f => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
        for (const f of files) {
            const m = parseManifest(path.join(steamapps, f));
            if (!m?.appid || !m.installdir || seen.has(m.appid)) continue;
            seen.add(m.appid);
            if (known.has(m.appid) || NOT_A_GAME_IDS.has(m.appid) || NOT_A_GAME.test(m.name)) continue;
            const dir = path.join(common, m.installdir);
            if (!fs.existsSync(dir)) continue;
            out.push({ id: `steam_${m.appid}`, title: m.name || m.installdir, steam_app_id: m.appid,
                       install_dir: dir, source: 'steam' });
        }
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    _steamCache = out;
    return out;
}

function steamTitleForPath(exePath) {
    const parts = path.resolve(exePath).split(path.sep);
    const i = parts.findIndex(p => p.toLowerCase() === 'common');
    if (i < 1 || parts[i - 1].toLowerCase() !== 'steamapps' || !parts[i + 1]) return null;
    const steamapps = parts.slice(0, i).join(path.sep);
    const folder = parts[i + 1];
    try {
        for (const f of fs.readdirSync(steamapps).filter(x => /^appmanifest_\d+\.acf$/i.test(x))) {
            const m = parseManifest(path.join(steamapps, f));
            if (m?.installdir?.toLowerCase() === folder.toLowerCase()) return m.name;
        }
    } catch { /* not readable */ }
    return null;
}

/**
 * Best guess at a game's main executable under dir: skip launchers,
 * installers and crash reporters, prefer one that imports a graphics API,
 * then the largest.
 */
function guessExe(dir, maxDepth = 3) {
    const found = [];
    let level = [dir];
    for (let depth = 0; depth <= maxDepth && level.length; depth++) {
        const next = [];
        for (const d of level) {
            let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
            for (const e of entries) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) {
                    if (!/^(_commonredist|redist|redistributables?|directx|dotnet|vcredist|support|tools|__installer|engine)$/i.test(e.name)) next.push(full);
                } else if (/\.exe$/i.test(e.name) && !NOT_THE_GAME_EXE.test(e.name)) {
                    try { found.push({ full, size: fs.statSync(full).size }); } catch { /* skip */ }
                }
            }
        }
        level = next;
    }
    if (!found.length) return null;
    // Only the largest few are read as PE files; reading every exe is slow.
    found.sort((a, b) => b.size - a.size);
    const scored = found.slice(0, 5).map(f => {
        const pe = peInfo.readPe(f.full);
        const api = pe ? peInfo.graphicsApiFromImports(pe.imports) : null;
        return { ...f, score: (api ? 1e12 : 0) + f.size };
    }).sort((a, b) => b.score - a.score);
    return scored[0].full;
}

/** All extra games: user-added first, then Steam ones not already added. */
function list(steamGames = _steamCache || []) {
    const store = readStore();
    const ids = new Set(store.games.map(g => g.id));
    return [...store.games.map(g => ({ ...g })), ...steamGames.filter(g => !ids.has(g.id))];
}

/** Full record for one id, guessing a Steam game's exe the first time. */
function getOne(id) {
    const entry = list().find(g => g.id === id);
    if (!entry) return null;
    if (!entry.exe_path && entry.install_dir) entry.exe_path = guessExe(entry.install_dir) || '';
    // Remember the guess so it is not repeated (and can be corrected).
    if (entry.source === 'steam' && entry.exe_path && _steamCache) {
        const cached = _steamCache.find(g => g.id === id);
        if (cached) cached.exe_path = entry.exe_path;
    }
    return toGameRecord(entry);
}

/** Light rows for the library list. */
function sidebarRows() {
    return list().map(g => ({
        id: g.id, title: g.title, steam_app_id: g.steam_app_id || '',
        native_outputs: [], has_headtracking: false, has_native_stereo: false,
        rendering_methods: [], recommended_fix_type: '', fix_count: 0, fix_types: [],
        user_game: true, source: g.source,
        install_dir: g.install_dir || (g.exe_path ? path.dirname(g.exe_path) : ''),
    }));
}

module.exports = { addFromExe, remove, setExe, discoverSteamGames, guessExe, list, getOne, sidebarRows, STORE };
