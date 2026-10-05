// SPDX-License-Identifier: AGPL-3.0-or-later
// The wall mask (map-pack/walls.bin) is bundled as a binary asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('bin');

module.exports = config;
