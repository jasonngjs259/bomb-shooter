// Metro: bundle .glb models (the Arena character) as assets.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("glb");

module.exports = config;
