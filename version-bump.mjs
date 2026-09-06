// Keeps manifest.json + versions.json in lockstep with package.json.
// Runs automatically via the "version" npm script (see package.json), so:
//
//   npm version patch   ->   bumps package.json, then this updates
//                            manifest.json + versions.json and stages them.
//
// versions.json maps each plugin version -> the minimum Obsidian version, which
// Obsidian uses to decide which release a given app version may install.
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// manifest.json — bump "version", keep the rest.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// versions.json — record this version's minAppVersion.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
