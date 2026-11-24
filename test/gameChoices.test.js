'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// Keep settings, prefs, user games, logs and reports in a temporary folder.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-home-'));
process.env.STEREOPTICON_HOME = home;

const gamePrefs   = require('../modules/gamePrefs');
const appSettings = require('../modules/appSettings');
const installer   = require('../modules/installer');
const wiz3dConfig = require('../modules/wiz3dConfig');
const wiz3dManager = require('../modules/wiz3dManager');
const userGames   = require('../modules/userGames');

test('settings default to the stable channel and quiet logging', () => {
    assert.strictEqual(appSettings.get('wiz3dChannel'), 'stable');
    assert.strictEqual(appSettings.get('detailedLogging'), false);
    appSettings.set({ wiz3dChannel: 'beta', detailedLogging: 1 });
    assert.strictEqual(appSettings.get('wiz3dChannel'), 'beta');
    assert.strictEqual(appSettings.get('detailedLogging'), true);
    appSettings.set({ wiz3dChannel: 'nonsense' });
    assert.strictEqual(appSettings.get('wiz3dChannel'), 'stable', 'unknown channels fall back to stable');
});

test('per-game prefs are stored, cleared and pinned versions listed', () => {
    gamePrefs.set('dxhr', { wiz3dVersion: 'v0.4.1', wiz3dPath: 'injector-dx11' });
    gamePrefs.set('other', { wiz3dVersion: 'v0.4.1' });
    assert.deepStrictEqual(gamePrefs.get('dxhr'), { wiz3dVersion: 'v0.4.1', wiz3dPath: 'injector-dx11' });
    assert.deepStrictEqual(gamePrefs.pinnedWiz3DVersions(), ['v0.4.1']);
    gamePrefs.set('dxhr', { wiz3dVersion: null, wiz3dPath: 'not-a-path' });
    assert.deepStrictEqual(gamePrefs.get('dxhr'), {}, 'cleared, and unknown paths dropped');
});

test('a chosen render path overrides the catalogue fix', () => {
    // Deus Ex: Human Revolution is catalogued as HD3D (DX9, 32-bit).
    const dxhr = { type: 'wiz3d_hd3d', wiz3d_api_raw: 'DX9', wiz3d_bits: 'x86' };
    const pe = { arch: 'x86', imports: ['d3d9.dll'] };
    const t = key => installer.resolveWiz3DTarget(gamePrefs.applyWiz3DPath(dxhr, key), null, pe).rel;
    assert.deepStrictEqual(t(null),            ['HD3D', '32-bit'], 'recommended');
    assert.deepStrictEqual(t('injector-dx11'), ['Stereo-Injector', 'DX10-11', '32-bit']);
    assert.deepStrictEqual(t('injector-dx9'),  ['Stereo-Injector', 'DX9', '32-bit']);
    assert.deepStrictEqual(t('3dv-dx11'),      ['3D-Vision-Direct', 'DX11', '32-bit']);
    assert.deepStrictEqual(t('3dv-dx9'),       ['3D-Vision-Direct', 'DX9', '32-bit']);
});

test('the launch config file follows the installed variant', () => {
    assert.strictEqual(wiz3dConfig.configFileForVariant('HD3D/64-bit'), 'HD3D_Config.xml');
    assert.strictEqual(wiz3dConfig.configFileForVariant('3D-Vision-Direct/DX11/64-bit'), '3DVision_Config.xml');
    assert.strictEqual(wiz3dConfig.configFileForVariant('Stereo-Injector/DX9/32-bit'), 'wiz3D_Config.xml');
    assert.strictEqual(wiz3dConfig.configFileForVariant(null), null);
});

test('only wiz3D 0.4.0 and later are offered', () => {
    assert.strictEqual(wiz3dManager.isSupported('v0.4.0'), true);
    assert.strictEqual(wiz3dManager.isSupported('v0.4.2'), true);
    assert.strictEqual(wiz3dManager.isSupported('v1.0'), true);
    assert.strictEqual(wiz3dManager.isSupported('v0.3.1'), false);
    assert.strictEqual(wiz3dManager.isSupported('v0.0.32'), false);
    assert.strictEqual(wiz3dManager.isSupported('nightly'), false);
});

test('a game can be added from its exe and its exe guessed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-usergame-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.copyFileSync(process.execPath, path.join(dir, 'bin', 'MyGame.exe'));   // a real PE file
    fs.writeFileSync(path.join(dir, 'unins000.exe'), 'x'.repeat(10));
    fs.writeFileSync(path.join(dir, 'UnityCrashHandler64.exe'), 'x'.repeat(10));

    assert.strictEqual(userGames.guessExe(dir), path.join(dir, 'bin', 'MyGame.exe'));

    const g = userGames.addFromExe(path.join(dir, 'bin', 'MyGame.exe'), 'My Game');
    assert.match(g.id, /^user_my-game/);
    assert.strictEqual(g.exe_name, 'MyGame.exe');
    assert.strictEqual(g.cpu_architecture, process.arch === 'ia32' ? 'x86' : process.arch);
    assert.ok(userGames.sidebarRows().some(r => r.id === g.id && r.user_game));
    assert.strictEqual(userGames.getOne(g.id).title, 'My Game');
    assert.strictEqual(userGames.addFromExe(path.join(dir, 'bin', 'MyGame.exe')).id, g.id, 'no duplicates');
    userGames.remove(g.id);
    assert.ok(!userGames.sidebarRows().some(r => r.id === g.id));
});

test('Steam games outside the catalogue are found from app manifests', () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-steam-'));
    const common = path.join(lib, 'steamapps', 'common');
    const add = (id, name, folder) => {
        fs.mkdirSync(path.join(common, folder), { recursive: true });
        fs.writeFileSync(path.join(lib, 'steamapps', `appmanifest_${id}.acf`),
            `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${folder}"\n}\n`);
    };
    add('111', 'Uncatalogued Game', 'Uncatalogued');
    add('222', 'Catalogued Game', 'Catalogued');
    add('228980', 'Steamworks Common Redistributables', 'Steamworks Shared');
    add('333', 'Proton 9.0', 'Proton 9.0');
    const found = userGames.discoverSteamGames([common], ['222']);
    assert.deepStrictEqual(found.map(g => g.id), ['steam_111']);
    assert.strictEqual(found[0].install_dir, path.join(common, 'Uncatalogued'));
});

test('a report zip holds the report and the game logs', async () => {
    const reporter = require('../modules/reporter');
    const gameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-reportgame-'));
    fs.writeFileSync(path.join(gameDir, 'wiz3D_proxy.log'), 'proxy log line');
    fs.writeFileSync(path.join(gameDir, 'wiz3D_Config.xml'), '<Config/>');
    fs.writeFileSync(path.join(gameDir, 'savegame.txt'), 'not ours');
    const r = await reporter.createReport({
        kind: 'game', outcome: 'partial', notes: 'HUD at screen depth',
        game: { id: 'dxhr', title: 'Deus Ex: Human Revolution', exe: 'dxhr.exe' },
        fix: { id: 'f', name: 'wiz3D', type: 'wiz3d_hd3d' },
        record: { installDir: gameDir, wiz3dVersion: 'v0.4.2', wiz3dVariant: 'HD3D/32-bit' },
        appVersion: '0.1.0',
    });
    assert.ok(fs.existsSync(r.zipPath));
    const AdmZip = require('adm-zip');
    const names = new AdmZip(r.zipPath).getEntries().map(e => e.entryName);
    assert.ok(names.includes('report.md'));
    assert.ok(names.includes('game/wiz3D_proxy.log'));
    assert.ok(names.includes('game/wiz3D_Config.xml'));
    assert.ok(!names.includes('game/savegame.txt'));
    // The website's report form, with its fields filled in.
    assert.match(r.issueUrl, /^https:\/\/github\.com\/Stereopticon-Org\/stereopticon\.org\/issues\/new\?template=compat-report\.yml&/);
    const q = new URL(r.issueUrl).searchParams;
    assert.strictEqual(q.get('result'), 'Partial');
    assert.strictEqual(q.get('version'), '0.4.2');
    assert.strictEqual(q.get('folder'), 'HD3D/32-bit');
    assert.strictEqual(q.get('api'), 'HD3D');
    assert.match(q.get('notes'), /HUD at screen depth/);
});

test('registry output is parsed into keys and values', () => {
    const { parseReg } = require('../modules/gameLibraries');
    const out = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Ubisoft\\Launcher\\Installs\\13\r\n' +
                '    Language    REG_SZ    en-US\r\n    InstallDir    REG_SZ    D:/Games/Driver San Francisco/\r\n\r\n' +
                'HKEY_LOCAL_MACHINE\\SOFTWARE\\Ubisoft\\Launcher\\Installs\\856\r\n';
    const blocks = parseReg(out);
    assert.strictEqual(blocks.length, 2);
    assert.strictEqual(blocks[0].values.InstallDir, 'D:/Games/Driver San Francisco/');
});

test('games from other launchers get stable ids and duplicates are dropped', () => {
    const rows = userGames.setDiscovered([
        { source: 'windows', title: 'MONGIL: STAR DIVE Epic', dir: 'D:/x' },
        { source: 'epic', title: 'MONGIL: STAR DIVE', dir: 'D:/y' },
        { source: 'steam', title: 'Uncatalogued', steam_app_id: '111', dir: 'D:/z' },
    ]);
    assert.deepStrictEqual(rows.map(r => r.id).sort(), ['epic_mongil-star-dive', 'steam_111']);
});

test('a custom wiz3D build can be added from a folder and made the default', () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-custom-'));
    process.env.STEREOPTICON_DATA_DIR = data;
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'stereopticon-build-'));
    fs.mkdirSync(path.join(src, 'wiz3D', 'Stereo-Injector', 'DX9', '64-bit'), { recursive: true });
    const r = wiz3dManager.addCustom(src, 'My build');
    assert.strictEqual(r.tag, 'custom-my-build');
    assert.ok(fs.existsSync(path.join(data, 'tools', 'wiz3d', 'versions', r.tag, 'Stereo-Injector')));
    wiz3dManager.setCurrent(r.tag);
    assert.throws(() => wiz3dManager.removeCustom(r.tag), /default/);
});

test("Steam's launch entries: Windows exes first, launchers last", () => {
    const { windowsExes } = require('../modules/steamLaunch');
    const launch = {
        0: { executable: 'PlayGTAV.exe', type: 'default' },
        1: { executable: './Binaries/Win32/Game.exe' },
        2: { executable: 'Game.app', config: { oslist: 'macos' } },
        3: { executable: '2KLauncher/LauncherPatcher.exe' },
    };
    const exes = windowsExes(launch);
    assert.deepStrictEqual(exes.slice(0, 2), ['PlayGTAV.exe', 'Binaries\\Win32\\Game.exe']);
    assert.strictEqual(exes[exes.length - 1], '2KLauncher\\LauncherPatcher.exe');
    assert.ok(!exes.includes('Game.app'));
});
