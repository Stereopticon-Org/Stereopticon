const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

resolveShippingExe: (exePath) => ipcRenderer.invoke('game:resolveShippingExe', { exePath }),
 
onUEVRInjectStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('uevr:injectStatus', handler);
    return () => ipcRenderer.removeListener('uevr:injectStatus', handler);
},
// ── Display channels ──────────────────────────────────────────
listDisplayFamilies:       ()                          => ipcRenderer.invoke('display:listFamilies'),
getDisplayFamily:          (familyId)                  => ipcRenderer.invoke('display:getFamily',    { familyId }),
getDisplayDevice:          (familyId, deviceId)        => ipcRenderer.invoke('display:getDevice',    { familyId, deviceId }),
getAllDisplayDevices:       ()                          => ipcRenderer.invoke('display:getAllDevices'),

// ── Profile channels ──────────────────────────────────────────
// preview: resolve pipeline without writing anything — use to show user what will happen
previewProfile:            (fix, familyId, deviceId, options) =>
    ipcRenderer.invoke('profile:preview',            { fix, familyId, deviceId, options }),

// apply: resolve pipeline AND write config files (VRto3D, UEVR profile etc)
applyProfile:              (fix, familyId, deviceId, options) =>
    ipcRenderer.invoke('profile:apply',              { fix, familyId, deviceId, options }),

// software status: check which display-required software is installed
getDisplaySoftwareStatus:  (familyId, deviceId)        =>
    ipcRenderer.invoke('profile:getSoftwareStatus',  { familyId, deviceId }),
    // External software (NewAxis, vorpX, etc.)
    softwareCheck:         (softwareId)              => ipcRenderer.invoke('software:check', { softwareId }),
    softwareCheckForType:  (fixType)                 => ipcRenderer.invoke('software:checkForFixType', { fixType }),
    softwareLaunch:        (softwareId, exePath)     => ipcRenderer.invoke('software:launch', { softwareId, exePathOverride: exePath || null }),
 
    // ── UPDATE these two existing bindings to pass steamAppId ──────
    // Replace your current gameScan / gameScanAll lines with these:
    gameScan:    (title, exeName, steamAppId) => ipcRenderer.invoke('game:scan',    { title, exeName, steamAppId: steamAppId || null }),
    gameScanAll: ()                          => ipcRenderer.invoke('game:scanAll'),
    gameLastScan: ()                         => ipcRenderer.invoke('game:lastScan'),
 
    // Data
    loadGames:        () => ipcRenderer.invoke('games:loadAll'),
    loadPipelines:    () => ipcRenderer.invoke('pipelines:loadAll'),
    loadOutputs:      () => ipcRenderer.invoke('outputs:loadAll'),
    // Lazy-load: light sidebar projection + per-game detail fetch.
    loadGamesSidebar: ()    => ipcRenderer.invoke('games:loadSidebar'),
    loadGameOne:      (id)  => ipcRenderer.invoke('games:loadOne', { id }),
    loadDisplay:   (displayId) => ipcRenderer.invoke('displays:loadOne', { displayId }),
    launchWithUEVR: (exePath) => ipcRenderer.invoke('game:launchWithUEVR', { exePath }),

    // Display / monitor hardware settings
    displayGetSettings:  ()                                => ipcRenderer.invoke('display:getSettings'),
    displayWriteSetting: (profileId, settingId, value)    => ipcRenderer.invoke('display:writeSetting', { profileId, settingId, value }),

    // Installer
    installFix: (profile, gameId, gamePath, exeName, defaultWiz3dPath) =>
        ipcRenderer.invoke('install:fix', { profile, gameId, gamePath, exeName, defaultWiz3dPath: defaultWiz3dPath || null }),
    installUEVRProfile: (profile) =>
        ipcRenderer.invoke('install:uevrProfile', { profile }),
    onInstallProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('install:progress', handler);
        return () => ipcRenderer.removeListener('install:progress', handler);
    },

    // Uninstall
    uninstallFix: (profile, gamePath, options) =>
        ipcRenderer.invoke('install:uninstall', { profile, gamePath, options }),

    // Install state
    isInstalled:         (fixId) => ipcRenderer.invoke('install:isInstalled',    { fixId }),
    getInstallRecord:    (fixId) => ipcRenderer.invoke('install:getRecord',       { fixId }),
    getAllInstalled:      ()      => ipcRenderer.invoke('install:allInstalled'),
    getInstalledGameIds: ()      => ipcRenderer.invoke('install:installedGameIds'),

    // Launch
    launchGame: (exePath) => ipcRenderer.invoke('game:launch', { exePath }),

    // Pipeline executor (resolver-driven adapter dispatch — single call
    // replaces scattered per-tool config writes from the renderer).
    executePipeline: (input) => ipcRenderer.invoke('pipeline:execute', input),

    // ReShade — full set
    reshadeDetect:    (gamePath)                    => ipcRenderer.invoke('reshade:detect',            { gamePath }),
    reshadeStatus:      (gamePath, profile)           => ipcRenderer.invoke('reshade:status',            { gamePath, profile }),
    reshadeUpdatePreset:(gamePath, shaders)           => ipcRenderer.invoke('reshade:updatePreset',      { gamePath, shaders }),
    reshadeDetectApi: (gamePath, exePath, profile)  => ipcRenderer.invoke('reshade:detectApi',         { gamePath, exePath, profile }),
    reshadeGetShaders:(steps)                       => ipcRenderer.invoke('reshade:shadersForPipeline', { steps }),
    reshadeInstall:   (gamePath, exePath, profile, requiredShaders, geo11Installed) =>
        ipcRenderer.invoke('reshade:install', { gamePath, exePath, profile, requiredShaders, geo11Installed }),
    onReshadeProgress: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('reshade:progress', handler);
        return () => ipcRenderer.removeListener('reshade:progress', handler);
    },

    // Cache
    getCacheInfo: () => ipcRenderer.invoke('install:cacheInfo'),
    clearCache:   () => ipcRenderer.invoke('install:clearCache'),

    // Ini editor
    iniGetState: (fixId, iniPath)         => ipcRenderer.invoke('ini:getState',  { fixId, iniPath }),
    iniApply:    (fixId, iniPath, values) => ipcRenderer.invoke('ini:apply',     { fixId, iniPath, values }),
    reshadeIniPatch: (iniPath, section, patches) => ipcRenderer.invoke('reshade:iniPatch', { iniPath, section, patches }),
    reshadeToggle3DGameBridge: (gamePath, enabled) => ipcRenderer.invoke('reshade:toggle3DGameBridge', { gamePath, enabled }),
    reshadeEnsureVRServer: () => ipcRenderer.invoke('reshade:ensureVRServer'),
    // UE3D / UEVR
    installUE3D:      (profile, gamePath, exeName)  => ipcRenderer.invoke('install:ue3d',      { profile, gamePath, exeName }),
    uevrReadConfig:   (exeName)                     => ipcRenderer.invoke('uevr:readConfig',    { exeName }),
    uevrWriteConfig:  (exeName, values)             => ipcRenderer.invoke('uevr:writeConfig',   { exeName, values }),
    uevrWriteAutoConfig: (gameName, config)         => ipcRenderer.invoke('uevr:writeAutoConfig', { gameName, config }),
    writeGameMarker:  (gameName)                    => ipcRenderer.invoke('uevr:writeGameMarker', { gameName }),
    vrto3dReadConfig: ()                            => ipcRenderer.invoke('vrto3d:readConfig'),
    vrto3dWriteConfig:(values)                      => ipcRenderer.invoke('vrto3d:writeConfig', { values }),
    vrto3dWriteGameProfile: (exeName, settings)    => ipcRenderer.invoke('vrto3d:writeGameProfile', { exeName, settings }),
    vrto3dIsInstalled: ()                           => ipcRenderer.invoke('vrto3d:isInstalled'),
    vrto3dInstall: (force)                          => ipcRenderer.invoke('vrto3d:install', { force }),
    setInstallExtra:  (fixId, extra)               => ipcRenderer.invoke('installState:setExtra', { fixId, extra }),
    sendKeys: (keys, delayMs) => ipcRenderer.invoke('launch:sendKeys', { keys, delayMs }),
    iniReset:    (fixId, iniPath)         => ipcRenderer.invoke('ini:reset',     { fixId, iniPath }),
    iniSnapshot: (fixId, iniPath)         => ipcRenderer.invoke('ini:snapshot',  { fixId, iniPath }),

    // External / dialog
    openExternal:        (url) => ipcRenderer.invoke('shell:openExternal', url),
    openUrl:             (url) => ipcRenderer.invoke('shell:openExternal', url),
    openLocalPath:       (p)   => ipcRenderer.invoke('shell:openPath', p),
    openDirectoryDialog: ()    => ipcRenderer.invoke('dialog:openDirectory'),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window:minimize'),
    maximizeWindow: () => ipcRenderer.send('window:maximize'),
    closeWindow:    () => ipcRenderer.send('window:close'),
    openOpenTrackHub: () => ipcRenderer.invoke('opentrack:open'),
    getAppVersion:    () => ipcRenderer.invoke('app:version'),

    // wiz3D release management
    wiz3dStatus:      (opts) => ipcRenderer.invoke('wiz3d:status', opts || {}),
    wiz3dUpdate:      ()     => ipcRenderer.invoke('wiz3d:update'),
    onWiz3dProgress:  (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('wiz3d:progress', handler);
        return () => ipcRenderer.removeListener('wiz3d:progress', handler);
    },
    wiz3dListReleases: () => ipcRenderer.invoke('wiz3d:listReleases'),
    wiz3dPaths:        () => ipcRenderer.invoke('wiz3d:paths'),
    wiz3dAddCustom:    (kind, name) => ipcRenderer.invoke('wiz3d:addCustom', { kind, name }),
    wiz3dRemoveCustom: (tag) => ipcRenderer.invoke('wiz3d:removeCustom', { tag }),
    wiz3dSetDefault:   (tag) => ipcRenderer.invoke('wiz3d:setDefault', { tag }),

    // Settings kept by the main process (wiz3D channel, detailed logging)
    getSettings: ()       => ipcRenderer.invoke('settings:get'),
    setSettings: (values) => ipcRenderer.invoke('settings:set', values),

    // Per-game wiz3D version and render path
    getGamePrefs: (gameId)         => ipcRenderer.invoke('gamePrefs:get', { gameId }),
    setGamePrefs: (gameId, values) => ipcRenderer.invoke('gamePrefs:set', { gameId, values }),

    // Games outside the catalogue
    addGameFromExe: ()       => ipcRenderer.invoke('games:addFromExe'),
    chooseGameExe:  (gameId) => ipcRenderer.invoke('games:chooseExe', { gameId }),
    removeUserGame: (gameId) => ipcRenderer.invoke('games:removeUser', { gameId }),

    // stereopticon.org data
    siteGames: (opts) => ipcRenderer.invoke('site:games', opts || {}),
    siteNews:  (opts) => ipcRenderer.invoke('site:news', opts || {}),

    // Stereo Loom
    loomStatus: () => ipcRenderer.invoke('loom:status'),
    loomOpen:   () => ipcRenderer.invoke('loom:open'),
    onLoomProgress: (callback) => {
        const handler = (_e, pct) => callback(pct);
        ipcRenderer.on('loom:progress', handler);
        return () => ipcRenderer.removeListener('loom:progress', handler);
    },

    // Stereopticon updates
    appUpdateCheck:   () => ipcRenderer.invoke('appUpdate:check'),
    appUpdateInstall: () => ipcRenderer.invoke('appUpdate:install'),
    onAppUpdateProgress: (callback) => {
        const handler = (_e, pct) => callback(pct);
        ipcRenderer.on('appUpdate:progress', handler);
        return () => ipcRenderer.removeListener('appUpdate:progress', handler);
    },

    // Game details: name, artwork, API, catalogue match
    setGameDetails: (gameId, details) => ipcRenderer.invoke('gameDetails:set', { gameId, details }),
    steamSearch:    (term) => ipcRenderer.invoke('steam:search', { term }),
    sgdbSearch:     (term) => ipcRenderer.invoke('sgdb:search', { term }),
    sgdbArtwork:    (id)   => ipcRenderer.invoke('sgdb:artwork', { id }),

    // Logs and reports
    writeLog:     (level, args) => ipcRenderer.send('log:write', { level, args }),
    openLogs:     ()    => ipcRenderer.invoke('logs:open'),
    createReport: (ctx) => ipcRenderer.invoke('report:create', ctx),
    showItem:     (p)   => ipcRenderer.invoke('shell:showItem', p),
    pathExists:   (p)   => ipcRenderer.invoke('fs:exists', p),
    inspectGame:  (gameId, gamePath, exeName, siteExe, steamAppId) => ipcRenderer.invoke('game:inspect', { gameId, gamePath, exeName, siteExe, steamAppId }),
    chooseExeFor: (gameId, gamePath) => ipcRenderer.invoke('game:chooseExeFor', { gameId, gamePath }),
    steamLibraries: ()  => ipcRenderer.invoke('games:steamLibraries'),
});

// Uncaught errors in the window go to Stereopticon's log file. (Console
// lines are forwarded by renderer.js, which owns the page's console.)
window.addEventListener('error', e =>
    ipcRenderer.send('log:write', { level: 'error', args: [`${e.message} at ${e.filename}:${e.lineno}`] }));
window.addEventListener('unhandledrejection', e =>
    ipcRenderer.send('log:write', { level: 'error', args: ['Unhandled rejection:', String(e.reason?.stack || e.reason)] }));