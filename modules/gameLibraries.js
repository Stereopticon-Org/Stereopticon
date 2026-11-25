'use strict';
/**
 * modules/gameLibraries.js
 *
 * Finds the games installed on this PC, from every launcher at once:
 *
 *   Steam      appmanifest_*.acf in every library in libraryfolders.vdf
 *   Epic       Manifests/*.item and LauncherInstalled.dat
 *   GOG        GOG.com registry keys, and goggame-*.info files in game folders
 *   Ubisoft    Ubisoft\Launcher\Installs registry keys
 *   Xbox app   <drive>:\XboxGames\<game>\Content
 *   Windows    the installed-programs list (EA app, Battle.net, Rockstar,
 *              GOG and standalone installers all register there)
 *
 * Everything is read once per scan, asynchronously (no blocking registry
 * calls on the main thread), and matched against the catalogue in memory.
 * The result is cached at ~/.stereopticon/cache/libraries.json so the next
 * start shows it straight away while a fresh scan runs.
 */

const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { BASE } = require('./appSettings');

const CACHE_FILE = path.join(BASE, 'cache', 'libraries.json');

const slugOf = s => String(s || '').toLowerCase()
    .replace(/[™®©]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const tick = () => new Promise(r => setImmediate(r));

function regQuery(key) {
    return new Promise(resolve => {
        execFile('reg', ['query', key, '/s'], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 20000 },
            (err, out) => resolve(err ? '' : String(out)));
    });
}
/** reg query /s output → [{ key, values: { Name: value } }] */
function parseReg(out) {
    const blocks = [];
    let cur = null;
    for (const line of out.split(/\r?\n/)) {
        if (/^HKEY_/.test(line)) { cur = { key: line.trim(), values: {} }; blocks.push(cur); continue; }
        const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
        if (m && cur) cur.values[m[1]] = m[2].trim();
    }
    return blocks;
}
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function readdirSafe(p) { try { return await fsp.readdir(p, { withFileTypes: true }); } catch { return []; } }
const normDir = d => path.resolve(String(d).replace(/\//g, '\\')).replace(/\\+$/, '').toLowerCase();

// ── Steam ────────────────────────────────────────────────────────

async function steamLibraries() {
    const roots = new Set(['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']);
    const reg = parseReg(await regQuery('HKCU\\SOFTWARE\\Valve\\Steam'));
    for (const b of reg) if (b.values.SteamPath) roots.add(b.values.SteamPath.replace(/\//g, '\\'));
    const libs = new Map();
    for (const root of roots) {
        let text;
        try { text = await fsp.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'); } catch { continue; }
        libs.set(root.toLowerCase(), root);
        for (const m of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
            const lib = m[1].replace(/\\\\/g, '\\');
            if (!libs.has(lib.toLowerCase())) libs.set(lib.toLowerCase(), lib);
        }
    }
    const out = [];
    for (const lib of libs.values()) out.push({ path: lib, available: await exists(path.join(lib, 'steamapps')) });
    return out;
}

const NOT_A_GAME = /redistributable|steamworks|proton|steam linux runtime|steamvr|soundtrack|dedicated server|\bsdk\b|wallpaper engine|benchmark tool|\btools?\b/i;
const NOT_A_GAME_IDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710', '431960']);

async function steamGames(libs) {
    const out = [];
    for (const lib of libs.filter(l => l.available)) {
        const steamapps = path.join(lib.path, 'steamapps');
        const files = (await readdirSafe(steamapps)).filter(e => /^appmanifest_\d+\.acf$/i.test(e.name));
        for (const f of files) {
            let text; try { text = await fsp.readFile(path.join(steamapps, f.name), 'utf8'); } catch { continue; }
            const get = k => (new RegExp(`"${k}"\\s+"([^"]*)"`, 'i').exec(text) || [])[1] || '';
            const appid = get('appid'), name = get('name'), installdir = get('installdir');
            if (!appid || !installdir || NOT_A_GAME_IDS.has(appid) || NOT_A_GAME.test(name)) continue;
            out.push({ source: 'steam', id: `steam_${appid}`, steam_app_id: appid, title: name || installdir,
                       dir: path.join(steamapps, 'common', installdir) });
        }
        await tick();
    }
    return out;
}

// ── Epic ─────────────────────────────────────────────────────────

async function epicGames() {
    const out = [];
    const pd = process.env.PROGRAMDATA || 'C:\\ProgramData';
    const dir = path.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    for (const e of await readdirSafe(dir)) {
        if (!/\.item$/i.test(e.name)) continue;
        try {
            const j = JSON.parse(await fsp.readFile(path.join(dir, e.name), 'utf8'));
            if (!j.InstallLocation || j.bIsApplication === false) continue;
            // Launching through Epic (its URL) keeps sign-in and DRM working.
            const launchUrl = j.CatalogNamespace && j.CatalogItemId && j.AppName
                ? `com.epicgames.launcher://apps/${encodeURIComponent(`${j.CatalogNamespace}:${j.CatalogItemId}:${j.AppName}`)}?action=launch&silent=true`
                : null;
            out.push({ source: 'epic', title: j.DisplayName || path.basename(j.InstallLocation), dir: j.InstallLocation,
                       exe: j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : null, launchUrl });
        } catch { /* unreadable manifest */ }
    }
    try {
        const dat = JSON.parse(await fsp.readFile(path.join(pd, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat'), 'utf8'));
        for (const i of dat.InstallationList || []) {
            if (i.InstallLocation) out.push({ source: 'epic', title: path.basename(i.InstallLocation), dir: i.InstallLocation });
        }
    } catch { /* no Epic */ }
    return out;
}

// ── GOG ──────────────────────────────────────────────────────────

async function gogGames() {
    const out = [];
    for (const key of ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']) {
        for (const b of parseReg(await regQuery(key))) {
            const v = b.values;
            if (v.path && (v.gameName || v.GAMENAME)) {
                out.push({ source: 'gog', title: v.gameName || v.GAMENAME, dir: v.path,
                           exe: v.exe || v.EXE || null });
            }
        }
    }
    // GOG Galaxy's own library folders: each game has a goggame-<id>.info with its name.
    for (const root of ['C:\\Program Files (x86)\\GOG Galaxy\\Games', 'C:\\GOG Games']) {
        for (const e of await readdirSafe(root)) {
            if (!e.isDirectory()) continue;
            const dir = path.join(root, e.name);
            let title = e.name;
            const info = (await readdirSafe(dir)).find(f => /^goggame-\d+\.info$/i.test(f.name));
            let exe = null;
            if (info) {
                try {
                    const j = JSON.parse(await fsp.readFile(path.join(dir, info.name), 'utf8'));
                    title = j.name || title;
                    // The primary play task is the exe GOG Galaxy starts.
                    const tasks = j.playTasks || [];
                    const task = tasks.find(t => t.isPrimary && t.path) || tasks.find(t => t.path && /\.exe$/i.test(t.path));
                    if (task) exe = path.join(dir, task.path);
                } catch { /* keep folder name */ }
            }
            out.push({ source: 'gog', title, dir, exe });
        }
    }
    return out;
}

// ── Ubisoft Connect ──────────────────────────────────────────────

async function ubisoftGames() {
    const out = [];
    for (const b of parseReg(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs'))) {
        const dir = b.values.InstallDir;
        if (dir) out.push({ source: 'ubisoft', title: path.basename(dir.replace(/[\\/]+$/, '')), dir: dir.replace(/\//g, '\\') });
    }
    return out;
}

// ── Xbox app ─────────────────────────────────────────────────────

// An Xbox app (PC Game Pass) game's MicrosoftGame.config names the game and
// its exe: <ShellVisuals DefaultDisplayName="..."/> and <Executable Name="..."/>.
async function msGameConfig(dir) {
    try {
        const xml = await fsp.readFile(path.join(dir, 'MicrosoftGame.config'), 'utf8');
        const name = (/DefaultDisplayName="([^"]+)"/i.exec(xml) || [])[1];
        const exe = (/<Executable[^>]*\sName="([^"]+\.exe)"/i.exec(xml) || [])[1];
        return { name: name && !/^ms-resource:/i.test(name) ? name : null, exe: exe ? path.join(dir, exe) : null };
    } catch { return {}; }
}

async function xboxGames() {
    const out = [];
    const dirs = new Set();
    // The Xbox app's default library folders on every drive...
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\XboxGames`;
        for (const e of await readdirSafe(root)) {
            if (!e.isDirectory() || /^GameSave$/i.test(e.name)) continue;
            const content = path.join(root, e.name, 'Content');
            dirs.add((await exists(content)) ? content : path.join(root, e.name));
        }
    }
    // ...and the install folders Gaming Services records, which can be anywhere.
    for (const b of parseReg(await regQuery('HKLM\\SOFTWARE\\Microsoft\\GamingServices\\PackageRepository\\Root'))) {
        for (const v of Object.values(b.values)) {
            if (/^[A-Z]:\\/i.test(v) && !/\\WindowsApps\\/i.test(v) && await exists(v)) dirs.add(v.replace(/\\+$/, ''));
        }
    }
    for (const dir of dirs) {
        const cfg = await msGameConfig(dir);
        const folder = /^content$/i.test(path.basename(dir)) ? path.basename(path.dirname(dir)) : path.basename(dir);
        out.push({ source: 'xbox', title: cfg.name || folder, dir, exe: cfg.exe && await exists(cfg.exe) ? cfg.exe : null });
    }
    return out;
}

// ── Windows installed programs (EA app, Battle.net, Rockstar, ...) ─

const LAUNCHER_OR_TOOL = /launcher|galaxy|ubisoft connect|battle\.net|gamespy|redistributable|runtime|driver|\bsdk\b|visual c\+\+|directx|\.net|updater|anti-?cheat|easyanticheat|battleye|overlay|prism|sview|steam$|origin$|ea app|uplay/i;
const GAME_PUBLISHER = /electronic arts|blizzard|activision|rockstar|bethesda|ubisoft|cd projekt|square enix|bandai|capcom|sega|2k|take-two|warner|codemasters|focus|paradox|devolver|sony|microsoft studios|xbox game studios|epic games|riot|valve|thq|eidos|deep silver|koei|konami|namco|atlus|nis america|505 games|team17|frontier|remedy|io interactive/i;

function installedPrograms() {
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
        "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | " +
        "Where-Object { $_.DisplayName -and $_.InstallLocation } | " +
        "Select-Object DisplayName,InstallLocation,Publisher,SystemComponent,DisplayIcon | ConvertTo-Json -Compress";
    return new Promise(resolve => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
            { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30000, encoding: 'utf8' },
            (err, out) => {
                if (err) { resolve([]); return; }
                try { const j = JSON.parse(out || '[]'); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
            });
    });
}

async function windowsPrograms() {
    const out = [];
    for (const v of await installedPrograms()) {
        const dir = String(v.InstallLocation || '').replace(/^"|"$/g, '');
        if (!v.DisplayName || !dir || v.SystemComponent === 1) continue;
        if (LAUNCHER_OR_TOOL.test(v.DisplayName)) continue;
        // Only programs that look like games are listed as new games;
        // every entry still helps match catalogue games by name.
        const looksLikeGame = GAME_PUBLISHER.test(v.Publisher || '') ||
            /[\\/](games?|ea games|epic games|ubi connect|gog galaxy|xboxgames)[\\/]/i.test(dir);
        // The program's icon is usually its exe ("C:\...\Game.exe,0").
        const icon = String(v.DisplayIcon || '').replace(/,\s*-?\d+$/, '').replace(/^"+|"+$/g, '');
        const exe = /\.exe$/i.test(icon) && !/unins|setup|install|launcher/i.test(path.basename(icon)) ? icon : null;
        out.push({ source: 'windows', title: String(v.DisplayName).replace(/\s*\(version [^)]*\)$/i, ''), dir,
                   publisher: v.Publisher || '', listable: looksLikeGame, exe });
    }
    return out;
}

// ── Scan ─────────────────────────────────────────────────────────

/**
 * Everything installed, de-duplicated by folder.
 * Returns { entries: [{source, title, dir, steam_app_id?, exe?, listable}], steamLibraries }.
 */
async function discoverAll() {
    const libs = await steamLibraries();
    const groups = await Promise.all([
        steamGames(libs), epicGames(), gogGames(), ubisoftGames(), xboxGames(), windowsPrograms(),
    ]);
    const byDir = new Map();
    for (const e of groups.flat()) {
        if (!e.dir) continue;
        const k = normDir(e.dir);
        const prev = byDir.get(k);
        // A launcher's own record beats the Windows programs list.
        if (!prev || (prev.source === 'windows' && e.source !== 'windows')) byDir.set(k, { listable: true, ...e });
    }
    const entries = [];
    for (const e of byDir.values()) {
        if (await exists(e.dir)) entries.push(e);
    }
    return { entries, steamLibraries: libs };
}

async function exeUnder(dir, exeName, depth = 3) {
    if (!exeName) return true;
    const wanted = path.basename(exeName).toLowerCase();
    let level = [dir];
    for (let d = 0; d <= depth && level.length; d++) {
        const next = [];
        for (const x of level) {
            const items = await readdirSafe(x);
            for (const i of items) {
                if (i.isFile() && i.name.toLowerCase() === wanted) return true;
                if (i.isDirectory() && next.length < 200) next.push(path.join(x, i.name));
            }
        }
        level = next;
    }
    return false;
}

/**
 * Match catalogue games to what is installed.
 * targets: [{ id, title, exeName, steamAppId }]
 * Returns { paths: { gameId: dir }, extras: [entries not in the catalogue], steamLibraries }.
 */
async function scan(targets, { folderMatches }) {
    const { entries, steamLibraries: libs } = await discoverAll();
    const bySteamId = new Map(entries.filter(e => e.steam_app_id).map(e => [String(e.steam_app_id), e]));
    const bySlug = new Map();
    for (const e of entries) {
        for (const s of [slugOf(e.title), slugOf(path.basename(e.dir)), slugOf(path.basename(path.dirname(e.dir)))]) {
            if (s && !bySlug.has(s)) bySlug.set(s, e);
        }
    }

    // Per catalogue game: its folder, the exe its launcher reports, its Steam id.
    const paths = {}, exes = {}, steamIds = {}, launchUrls = {};
    const used = new Set();
    let n = 0;
    for (const t of targets) {
        if (++n % 100 === 0) await tick();
        let hit = t.steamAppId && bySteamId.get(String(t.steamAppId));
        if (!hit) {
            const exact = bySlug.get(slugOf(t.title));
            if (exact && await exeUnder(exact.dir, t.exeName)) hit = exact;
        }
        if (!hit && t.exeName) {
            // A looser name match, confirmed by finding the game's exe.
            for (const e of entries) {
                if (folderMatches(t.title, e.title, true) && await exeUnder(e.dir, t.exeName, 2)) { hit = e; break; }
            }
        }
        if (hit) {
            paths[t.id] = hit.dir; used.add(hit);
            if (hit.exe) exes[t.id] = hit.exe;
            if (hit.launchUrl) launchUrls[t.id] = hit.launchUrl;
            if (hit.steam_app_id) steamIds[t.id] = String(hit.steam_app_id);
        }
    }

    const catalogueSteam = new Set(targets.map(t => String(t.steamAppId || '')).filter(Boolean));
    const extras = entries.filter(e => !used.has(e) && e.listable !== false &&
                                       !(e.steam_app_id && catalogueSteam.has(String(e.steam_app_id))));

    // Games found per launcher (catalogue matches and others), for Settings.
    const sources = {};
    for (const e of [...used, ...extras]) sources[e.source] = (sources[e.source] || 0) + 1;
    const result = { at: Date.now(), paths, exes, steamIds, launchUrls, extras, steamLibraries: libs, sources };
    try {
        await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        await fsp.writeFile(CACHE_FILE, JSON.stringify(result));
    } catch { /* cache is optional */ }
    return result;
}

function cached() {
    try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return null; }
}

module.exports = { scan, cached, discoverAll, steamLibraries, parseReg, slugOf };
