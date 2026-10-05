// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Expo config plugin: copies the map tiles (map-pack/tiles, built by the map kit) and Leaflet
 * into the Android assets. The map WebView reads them directly from file:///android_asset/map/:
 * nothing to download or extract, works without any network.
 *
 * Runs during `expo prebuild` (hence in every build, dev or release).
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withMapAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const pack = path.join(root, 'map-pack');
      if (!fs.existsSync(path.join(pack, 'map.json'))) {
        throw new Error('No map pack in app/map-pack: build one first (./build.sh does it, see docs/map-packs.md)');
      }
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets', 'map');
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(pack, 'tiles'), path.join(dest, 'tiles'), { recursive: true });
      // Leaflet (BSD-2-Clause): its licence travels with the copy
      const leaflet = path.dirname(require.resolve('leaflet/package.json', { paths: [root] }));
      fs.mkdirSync(path.join(dest, 'leaflet'), { recursive: true });
      for (const f of ['dist/leaflet.js', 'dist/leaflet.css', 'LICENSE']) {
        fs.copyFileSync(path.join(leaflet, f), path.join(dest, 'leaflet', path.basename(f)));
      }
      return cfg;
    },
  ]);
};
