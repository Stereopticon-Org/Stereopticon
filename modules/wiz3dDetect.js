'use strict';
/**
 * modules/wiz3dDetect.js
 *
 * Is wiz3D already in a game's folder (put there by hand, or by another
 * copy of Stereopticon), and which version? Looks next to the game's exe
 * and in the game folder for wiz3D's files, and reads the version from the
 * DLLs' version resource (wiz3D stamps every DLL, e.g. 0.4.2.0).
 */

const fs   = require('fs');
const path = require('path');

const CONFIGS = {
    'wiz3D_Config.xml':    'Stereo Injector or OpenGL',
    'HD3D_Config.xml':     'AMD HD3D',
    '3DVision_Config.xml': '3D Vision Direct',
};
const MARKER_DLLS = ['S3DAPI.dll', 'S3DUtils.dll', 'S3DWrapperD3D9.dll', 'S3DWrapperD3D10.dll',
                     'S3DWrapperD3D11.dll', 'S3DWrapperD3D8.dll', 'S3DWrapperD3D7.dll'];
const VERSIONED_DLLS = ['S3DAPI.dll', 'd3d9.dll', 'd3d11.dll', 'dxgi.dll', 'd3d8.dll', 'ddraw.dll', 'opengl32.dll'];

/** "a.b.c.d" from a PE file's VS_FIXEDFILEINFO, or null. */
function fileVersion(file) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return null; }
    const sig = Buffer.from([0xBD, 0x04, 0xEF, 0xFE]);   // 0xFEEF04BD, little-endian
    const at = buf.lastIndexOf(sig);
    if (at < 0 || at + 16 > buf.length) return null;
    const ms = buf.readUInt32LE(at + 8), ls = buf.readUInt32LE(at + 12);
    return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
}

// The DLL describes itself as wiz3D's (and not, say, DXVK's d3d9.dll).
function isWiz3DDll(file) {
    try {
        const text = fs.readFileSync(file).toString('utf16le');
        return /wiz3D|S3DAPI|S3DWrapper|iZ3D/i.test(text);
    } catch { return false; }
}

/**
 * dirs: folders to look in (the exe's folder first).
 * Returns { found, dir, version, kind, files } or { found: false }.
 */
function detect(dirs) {
    for (const dir of [...new Set(dirs.filter(Boolean))]) {
        let names;
        try { names = fs.readdirSync(dir); } catch { continue; }
        const lower = new Map(names.map(n => [n.toLowerCase(), n]));
        const configs = Object.keys(CONFIGS).filter(c => lower.has(c.toLowerCase()));
        const markers = MARKER_DLLS.filter(d => lower.has(d.toLowerCase()));
        if (!configs.length && !markers.length) continue;

        let version = null;
        for (const d of VERSIONED_DLLS) {
            const real = lower.get(d.toLowerCase());
            if (!real) continue;
            const full = path.join(dir, real);
            if (d !== 'S3DAPI.dll' && !isWiz3DDll(full)) continue;
            const v = fileVersion(full);
            if (v && v !== '0.0.0.0') { version = v.replace(/\.0$/, ''); break; }
        }
        return {
            found: true, dir, version,
            kind: configs.length ? CONFIGS[configs[0]] : 'Stereo Injector',
            files: [...configs, ...markers].map(f => lower.get(f.toLowerCase())),
        };
    }
    return { found: false };
}

module.exports = { detect, fileVersion };
