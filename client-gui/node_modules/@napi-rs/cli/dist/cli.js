#!/usr/bin/env node
import { createRequire } from "node:module";
import { Cli, Command, Option } from "clipanion";
import path, { dirname, isAbsolute, join, parse, resolve } from "node:path";
import * as colors from "colorette";
import { underline, yellow } from "colorette";
import { createDebug } from "obug";
import { access, copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { exec, execSync, spawn, spawnSync } from "node:child_process";
import fs, { existsSync, mkdirSync, promises, rmSync, statSync } from "node:fs";
import { isNil, merge, omit, omitBy, pick, sortBy } from "es-toolkit";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { parse as parse$1 } from "semver";
import { dump, load } from "js-yaml";
import * as typanion from "typanion";
import { Octokit } from "@octokit/rest";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
//#region src/def/artifacts.ts
var BaseArtifactsCommand = class extends Command {
	static paths = [["artifacts"]];
	static usage = Command.Usage({ description: "Copy artifacts from Github Actions into npm packages and ready to publish" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	outputDir = Option.String("--output-dir,-o,-d", "./artifacts", { description: "Path to the folder where all built `.node` files put, same as `--output-dir` of build command" });
	npmDir = Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	buildOutputDir = Option.String("--build-output-dir", { description: "Path to the build output dir, only needed when targets contains `wasm32-wasi-*`" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			outputDir: this.outputDir,
			npmDir: this.npmDir,
			buildOutputDir: this.buildOutputDir
		};
	}
};
function applyDefaultArtifactsOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		outputDir: "./artifacts",
		npmDir: "npm",
		...options
	};
}
//#endregion
//#region src/utils/log.ts
const debugFactory = (namespace) => {
	const debug = createDebug(`napi:${namespace}`, { formatters: { i(v) {
		return colors.green(v);
	} } });
	debug.info = (...args) => console.error(colors.black(colors.bgGreen(" INFO ")), ...args);
	debug.warn = (...args) => console.error(colors.black(colors.bgYellow(" WARNING ")), ...args);
	debug.error = (...args) => console.error(colors.white(colors.bgRed(" ERROR ")), ...args.map((arg) => arg instanceof Error ? arg.stack ?? arg.message : arg));
	return debug;
};
const debug$9 = debugFactory("utils");
//#endregion
//#region package.json
var version$1 = "3.6.0";
//#endregion
//#region src/utils/misc.ts
const readFileAsync = readFile;
const writeFileAsync = writeFile;
const unlinkAsync = unlink;
const copyFileAsync = copyFile;
const mkdirAsync = mkdir;
const statAsync = stat;
const readdirAsync = readdir;
function fileExists(path) {
	return access(path).then(() => true, () => false);
}
async function dirExistsAsync(path) {
	try {
		return (await statAsync(path)).isDirectory();
	} catch {
		return false;
	}
}
function pick$1(o, ...keys) {
	return keys.reduce((acc, key) => {
		acc[key] = o[key];
		return acc;
	}, {});
}
async function updatePackageJson(path, partial) {
	if (!await fileExists(path)) {
		debug$9(`File not exists ${path}`);
		return;
	}
	const old = JSON.parse(await readFileAsync(path, "utf8"));
	await writeFileAsync(path, JSON.stringify({
		...old,
		...partial
	}, null, 2));
}
const CLI_VERSION = version$1;
//#endregion
//#region src/utils/target.ts
const SUB_SYSTEMS = new Set(["android", "ohos"]);
const AVAILABLE_TARGETS = [
	"aarch64-apple-darwin",
	"aarch64-linux-android",
	"aarch64-unknown-linux-gnu",
	"aarch64-unknown-linux-musl",
	"aarch64-unknown-linux-ohos",
	"aarch64-pc-windows-msvc",
	"x86_64-apple-darwin",
	"x86_64-pc-windows-msvc",
	"x86_64-pc-windows-gnu",
	"x86_64-unknown-linux-gnu",
	"x86_64-unknown-linux-musl",
	"x86_64-unknown-linux-ohos",
	"x86_64-unknown-freebsd",
	"i686-pc-windows-msvc",
	"armv7-unknown-linux-gnueabihf",
	"armv7-unknown-linux-musleabihf",
	"armv7-linux-androideabi",
	"universal-apple-darwin",
	"loongarch64-unknown-linux-gnu",
	"riscv64gc-unknown-linux-gnu",
	"powerpc64le-unknown-linux-gnu",
	"s390x-unknown-linux-gnu",
	"wasm32-wasi-preview1-threads",
	"wasm32-wasip1-threads"
];
const DEFAULT_TARGETS = [
	"x86_64-apple-darwin",
	"aarch64-apple-darwin",
	"x86_64-pc-windows-msvc",
	"x86_64-unknown-linux-gnu"
];
const TARGET_LINKER = {
	"aarch64-unknown-linux-musl": "aarch64-linux-musl-gcc",
	"loongarch64-unknown-linux-gnu": "loongarch64-linux-gnu-gcc-13",
	"riscv64gc-unknown-linux-gnu": "riscv64-linux-gnu-gcc",
	"powerpc64le-unknown-linux-gnu": "powerpc64le-linux-gnu-gcc",
	"s390x-unknown-linux-gnu": "s390x-linux-gnu-gcc"
};
const CpuToNodeArch = {
	x86_64: "x64",
	aarch64: "arm64",
	i686: "ia32",
	armv7: "arm",
	loongarch64: "loong64",
	riscv64gc: "riscv64",
	powerpc64le: "ppc64"
};
const SysToNodePlatform = {
	linux: "linux",
	freebsd: "freebsd",
	darwin: "darwin",
	windows: "win32",
	ohos: "openharmony"
};
const UniArchsByPlatform = { darwin: ["x64", "arm64"] };
/**
* A triple is a specific format for specifying a target architecture.
* Triples may be referred to as a target triple which is the architecture for the artifact produced, and the host triple which is the architecture that the compiler is running on.
* The general format of the triple is `<arch><sub>-<vendor>-<sys>-<abi>` where:
*   - `arch` = The base CPU architecture, for example `x86_64`, `i686`, `arm`, `thumb`, `mips`, etc.
*   - `sub` = The CPU sub-architecture, for example `arm` has `v7`, `v7s`, `v5te`, etc.
*   - `vendor` = The vendor, for example `unknown`, `apple`, `pc`, `nvidia`, etc.
*   - `sys` = The system name, for example `linux`, `windows`, `darwin`, etc. none is typically used for bare-metal without an OS.
*   - `abi` = The ABI, for example `gnu`, `android`, `eabi`, etc.
*/
function parseTriple(rawTriple) {
	if (rawTriple === "wasm32-wasi" || rawTriple === "wasm32-wasi-preview1-threads" || rawTriple.startsWith("wasm32-wasip")) return {
		triple: rawTriple,
		platformArchABI: "wasm32-wasi",
		platform: "wasi",
		arch: "wasm32",
		abi: "wasi"
	};
	const triples = (rawTriple.endsWith("eabi") ? `${rawTriple.slice(0, -4)}-eabi` : rawTriple).split("-");
	let cpu;
	let sys;
	let abi = null;
	if (triples.length === 2) [cpu, sys] = triples;
	else [cpu, , sys, abi = null] = triples;
	if (abi && SUB_SYSTEMS.has(abi)) {
		sys = abi;
		abi = null;
	}
	const platform = SysToNodePlatform[sys] ?? sys;
	const arch = CpuToNodeArch[cpu] ?? cpu;
	return {
		triple: rawTriple,
		platformArchABI: abi ? `${platform}-${arch}-${abi}` : `${platform}-${arch}`,
		platform,
		arch,
		abi
	};
}
function getSystemDefaultTarget() {
	const host = execSync(`rustc -vV`, { env: process.env }).toString("utf8").split("\n").find((line) => line.startsWith("host: "));
	const triple = host === null || host === void 0 ? void 0 : host.slice(6);
	if (!triple) throw new TypeError(`Can not parse target triple from host`);
	return parseTriple(triple);
}
function getTargetLinker(target) {
	return TARGET_LINKER[target];
}
function targetToEnvVar(target) {
	return target.replace(/-/g, "_").toUpperCase();
}
//#endregion
//#region src/utils/version.ts
let NapiVersion = /* @__PURE__ */ function(NapiVersion) {
	NapiVersion[NapiVersion["Napi1"] = 1] = "Napi1";
	NapiVersion[NapiVersion["Napi2"] = 2] = "Napi2";
	NapiVersion[NapiVersion["Napi3"] = 3] = "Napi3";
	NapiVersion[NapiVersion["Napi4"] = 4] = "Napi4";
	NapiVersion[NapiVersion["Napi5"] = 5] = "Napi5";
	NapiVersion[NapiVersion["Napi6"] = 6] = "Napi6";
	NapiVersion[NapiVersion["Napi7"] = 7] = "Napi7";
	NapiVersion[NapiVersion["Napi8"] = 8] = "Napi8";
	NapiVersion[NapiVersion["Napi9"] = 9] = "Napi9";
	return NapiVersion;
}({});
const NAPI_VERSION_MATRIX = new Map([
	[NapiVersion.Napi1, "8.6.0 | 9.0.0 | 10.0.0"],
	[NapiVersion.Napi2, "8.10.0 | 9.3.0 | 10.0.0"],
	[NapiVersion.Napi3, "6.14.2 | 8.11.2 | 9.11.0 | 10.0.0"],
	[NapiVersion.Napi4, "10.16.0 | 11.8.0 | 12.0.0"],
	[NapiVersion.Napi5, "10.17.0 | 12.11.0 | 13.0.0"],
	[NapiVersion.Napi6, "10.20.0 | 12.17.0 | 14.0.0"],
	[NapiVersion.Napi7, "10.23.0 | 12.19.0 | 14.12.0 | 15.0.0"],
	[NapiVersion.Napi8, "12.22.0 | 14.17.0 | 15.12.0 | 16.0.0"],
	[NapiVersion.Napi9, "18.17.0 | 20.3.0 | 21.1.0"]
]);
function parseNodeVersion(v) {
	const matches = v.match(/v?([0-9]+)\.([0-9]+)\.([0-9]+)/i);
	if (!matches) throw new Error("Unknown node version number: " + v);
	const [, major, minor, patch] = matches;
	return {
		major: parseInt(major),
		minor: parseInt(minor),
		patch: parseInt(patch)
	};
}
function requiredNodeVersions(napiVersion) {
	const requirement = NAPI_VERSION_MATRIX.get(napiVersion);
	if (!requirement) return [parseNodeVersion("10.0.0")];
	return requirement.split("|").map(parseNodeVersion);
}
function toEngineRequirement(versions) {
	const requirements = [];
	versions.forEach((v, i) => {
		let req = "";
		if (i !== 0) {
			const lastVersion = versions[i - 1];
			req += `< ${lastVersion.major + 1}`;
		}
		req += `${i === 0 ? "" : " || "}>= ${v.major}.${v.minor}.${v.patch}`;
		requirements.push(req);
	});
	return requirements.join(" ");
}
function napiEngineRequirement(napiVersion) {
	return toEngineRequirement(requiredNodeVersions(napiVersion));
}
//#endregion
//#region src/utils/metadata.ts
async function parseMetadata(manifestPath) {
	if (!fs.existsSync(manifestPath)) throw new Error(`No crate found in manifest: ${manifestPath}`);
	const childProcess = spawn("cargo", [
		"metadata",
		"--manifest-path",
		manifestPath,
		"--format-version",
		"1"
	], { stdio: "pipe" });
	let stdout = "";
	let stderr = "";
	let status = 0;
	childProcess.stdout.on("data", (data) => {
		stdout += data;
	});
	childProcess.stderr.on("data", (data) => {
		stderr += data;
	});
	await new Promise((resolve) => {
		childProcess.on("close", (code) => {
			status = code ?? 0;
			resolve();
		});
	});
	if (status !== 0) {
		const simpleMessage = `cargo metadata exited with code ${status}`;
		throw new Error(`${simpleMessage} and error message:\n\n${stderr}`, { cause: new Error(simpleMessage) });
	}
	try {
		return JSON.parse(stdout);
	} catch (e) {
		throw new Error("Failed to parse cargo metadata JSON", { cause: e });
	}
}
//#endregion
//#region src/utils/config.ts
async function readNapiConfig(path, configPath) {
	if (configPath && !await fileExists(configPath)) throw new Error(`NAPI-RS config not found at ${configPath}`);
	if (!await fileExists(path)) throw new Error(`package.json not found at ${path}`);
	const content = await readFileAsync(path, "utf8");
	let pkgJson;
	try {
		pkgJson = JSON.parse(content);
	} catch (e) {
		throw new Error(`Failed to parse package.json at ${path}`, { cause: e });
	}
	let separatedConfig;
	if (configPath) {
		const configContent = await readFileAsync(configPath, "utf8");
		try {
			separatedConfig = JSON.parse(configContent);
		} catch (e) {
			throw new Error(`Failed to parse NAPI-RS config at ${configPath}`, { cause: e });
		}
	}
	const userNapiConfig = pkgJson.napi ?? {};
	if (pkgJson.napi && separatedConfig) {
		const pkgJsonPath = underline(path);
		const configPathUnderline = underline(configPath);
		console.warn(yellow(`Both napi field in ${pkgJsonPath} and [NAPI-RS config](${configPathUnderline}) file are found, the NAPI-RS config file will be used.`));
	}
	if (separatedConfig) Object.assign(userNapiConfig, separatedConfig);
	const napiConfig = merge({
		binaryName: "index",
		packageName: pkgJson.name,
		targets: [],
		packageJson: pkgJson,
		npmClient: "npm"
	}, omit(userNapiConfig, ["targets"]));
	let targets = userNapiConfig.targets ?? [];
	if (userNapiConfig === null || userNapiConfig === void 0 ? void 0 : userNapiConfig.name) {
		console.warn(yellow(`[DEPRECATED] napi.name is deprecated, use napi.binaryName instead.`));
		napiConfig.binaryName = userNapiConfig.name;
	}
	if (!targets.length) {
		var _userNapiConfig$tripl, _userNapiConfig$tripl2;
		let deprecatedWarned = false;
		const warning = yellow(`[DEPRECATED] napi.triples is deprecated, use napi.targets instead.`);
		if ((_userNapiConfig$tripl = userNapiConfig.triples) === null || _userNapiConfig$tripl === void 0 ? void 0 : _userNapiConfig$tripl.defaults) {
			deprecatedWarned = true;
			console.warn(warning);
			targets = targets.concat(DEFAULT_TARGETS);
		}
		if ((_userNapiConfig$tripl2 = userNapiConfig.triples) === null || _userNapiConfig$tripl2 === void 0 || (_userNapiConfig$tripl2 = _userNapiConfig$tripl2.additional) === null || _userNapiConfig$tripl2 === void 0 ? void 0 : _userNapiConfig$tripl2.length) {
			targets = targets.concat(userNapiConfig.triples.additional);
			if (!deprecatedWarned) console.warn(warning);
		}
	}
	if (new Set(targets).size !== targets.length) {
		const duplicateTarget = targets.find((target, index) => targets.indexOf(target) !== index);
		throw new Error(`Duplicate targets are not allowed: ${duplicateTarget}`);
	}
	napiConfig.targets = targets.map(parseTriple);
	return napiConfig;
}
//#endregion
//#region src/utils/cargo.ts
function tryInstallCargoBinary(name, bin) {
	if (detectCargoBinary(bin)) {
		debug$9("Cargo binary already installed: %s", name);
		return;
	}
	try {
		debug$9("Installing cargo binary: %s", name);
		execSync(`cargo install ${name}`, { stdio: "inherit" });
	} catch (e) {
		throw new Error(`Failed to install cargo binary: ${name}`, { cause: e });
	}
}
function detectCargoBinary(bin) {
	debug$9("Detecting cargo binary: %s", bin);
	try {
		execSync(`cargo help ${bin}`, { stdio: "ignore" });
		debug$9("Cargo binary detected: %s", bin);
		return true;
	} catch {
		debug$9("Cargo binary not detected: %s", bin);
		return false;
	}
}
//#endregion
//#region src/utils/typegen.ts
const TOP_LEVEL_NAMESPACE = "__TOP_LEVEL_MODULE__";
const DEFAULT_TYPE_DEF_HEADER = `/* auto-generated by NAPI-RS */
/* eslint-disable */
`;
var TypeDefKind = /* @__PURE__ */ function(TypeDefKind) {
	TypeDefKind["Const"] = "const";
	TypeDefKind["Enum"] = "enum";
	TypeDefKind["StringEnum"] = "string_enum";
	TypeDefKind["Interface"] = "interface";
	TypeDefKind["Type"] = "type";
	TypeDefKind["Fn"] = "fn";
	TypeDefKind["Struct"] = "struct";
	TypeDefKind["Extends"] = "extends";
	TypeDefKind["Impl"] = "impl";
	return TypeDefKind;
}(TypeDefKind || {});
function prettyPrint(line, constEnum, ident, ambient = false) {
	let s = line.js_doc ?? "";
	switch (line.kind) {
		case TypeDefKind.Interface:
			s += `export interface ${line.name} {\n${line.def}\n}`;
			break;
		case TypeDefKind.Type:
			s += `export type ${line.name} = \n${line.def}`;
			break;
		case TypeDefKind.Enum:
			const enumName = constEnum ? "const enum" : "enum";
			s += `${exportDeclare(ambient)} ${enumName} ${line.name} {\n${line.def}\n}`;
			break;
		case TypeDefKind.StringEnum:
			if (constEnum) s += `${exportDeclare(ambient)} const enum ${line.name} {\n${line.def}\n}`;
			else s += `export type ${line.name} = ${line.def.replaceAll(/.*=/g, "").replaceAll(",", "|")};`;
			break;
		case TypeDefKind.Struct:
			const extendsDef = line.extends ? ` extends ${line.extends}` : "";
			if (line.extends) {
				const genericMatch = line.extends.match(/Iterator<(.+)>$/);
				if (genericMatch) {
					const [T, TResult, TNext] = genericMatch[1].split(",").map((p) => p.trim());
					line.def = line.def + `\nnext(value?: ${TNext}): IteratorResult<${T}, ${TResult}>`;
				}
			}
			s += `${exportDeclare(ambient)} class ${line.name}${extendsDef} {\n${line.def}\n}`;
			if (line.original_name && line.original_name !== line.name) s += `\nexport type ${line.original_name} = ${line.name}`;
			break;
		case TypeDefKind.Fn:
			s += `${exportDeclare(ambient)} ${line.def}`;
			break;
		default: s += line.def;
	}
	return correctStringIdent(s, ident);
}
function exportDeclare(ambient) {
	if (ambient) return "export";
	return "export declare";
}
async function processTypeDef(intermediateTypeFile, constEnum) {
	const exports = [];
	const groupedDefs = preprocessTypeDef(await readIntermediateTypeFile(intermediateTypeFile));
	return {
		dts: sortBy(Array.from(groupedDefs), [([namespace]) => namespace]).map(([namespace, defs]) => {
			if (namespace === TOP_LEVEL_NAMESPACE) return defs.map((def) => {
				switch (def.kind) {
					case TypeDefKind.Const:
					case TypeDefKind.Enum:
					case TypeDefKind.StringEnum:
					case TypeDefKind.Fn:
					case TypeDefKind.Struct:
						exports.push(def.name);
						if (def.original_name && def.original_name !== def.name) exports.push(def.original_name);
						break;
					default: break;
				}
				return prettyPrint(def, constEnum, 0);
			}).join("\n\n");
			else {
				exports.push(namespace);
				let declaration = "";
				declaration += `export declare namespace ${namespace} {\n`;
				for (const def of defs) declaration += prettyPrint(def, constEnum, 2, true) + "\n";
				declaration += "}";
				return declaration;
			}
		}).join("\n\n") + "\n",
		exports
	};
}
async function readIntermediateTypeFile(file) {
	return (await readFileAsync(file, "utf8")).split("\n").filter(Boolean).map((line) => {
		line = line.trim();
		const parsed = JSON.parse(line);
		if (parsed.js_doc) parsed.js_doc = parsed.js_doc.replace(/\\n/g, "\n");
		if (parsed.def) parsed.def = parsed.def.replace(/\\n/g, "\n");
		return parsed;
	}).sort((a, b) => {
		if (a.kind === TypeDefKind.Struct) {
			if (b.kind === TypeDefKind.Struct) return a.name.localeCompare(b.name);
			return -1;
		} else if (b.kind === TypeDefKind.Struct) return 1;
		else return a.name.localeCompare(b.name);
	});
}
function preprocessTypeDef(defs) {
	const namespaceGrouped = /* @__PURE__ */ new Map();
	const classDefs = /* @__PURE__ */ new Map();
	for (const def of defs) {
		const namespace = def.js_mod ?? TOP_LEVEL_NAMESPACE;
		if (!namespaceGrouped.has(namespace)) namespaceGrouped.set(namespace, []);
		const group = namespaceGrouped.get(namespace);
		if (def.kind === TypeDefKind.Struct) {
			group.push(def);
			classDefs.set(def.name, def);
		} else if (def.kind === TypeDefKind.Extends) {
			const classDef = classDefs.get(def.name);
			if (classDef) classDef.extends = def.def;
		} else if (def.kind === TypeDefKind.Impl) {
			const classDef = classDefs.get(def.name);
			if (classDef) {
				if (classDef.def) classDef.def += "\n";
				classDef.def += def.def;
				if (classDef.def) classDef.def = classDef.def.replace(/\\n/g, "\n");
			}
		} else group.push(def);
	}
	return namespaceGrouped;
}
function correctStringIdent(src, ident) {
	let bracketDepth = 0;
	return src.split("\n").map((line) => {
		line = line.trim();
		if (line === "") return "";
		const isInMultilineComment = line.startsWith("*");
		const isClosingBracket = line.endsWith("}");
		const isOpeningBracket = line.endsWith("{");
		const isTypeDeclaration = line.endsWith("=");
		const isTypeVariant = line.startsWith("|");
		let rightIndent = ident;
		if ((isOpeningBracket || isTypeDeclaration) && !isInMultilineComment) {
			bracketDepth += 1;
			rightIndent += (bracketDepth - 1) * 2;
		} else {
			if (isClosingBracket && bracketDepth > 0 && !isInMultilineComment && !isTypeVariant) bracketDepth -= 1;
			rightIndent += bracketDepth * 2;
		}
		if (isInMultilineComment) rightIndent += 1;
		return `${" ".repeat(rightIndent)}${line}`;
	}).join("\n");
}
//#endregion
//#region src/utils/read-config.ts
async function readConfig(options) {
	const resolvePath = (...paths) => resolve(options.cwd, ...paths);
	return await readNapiConfig(resolvePath(options.packageJsonPath ?? "package.json"), options.configPath ? resolvePath(options.configPath) : void 0);
}
//#endregion
//#region src/api/artifacts.ts
const debug$8 = debugFactory("artifacts");
async function collectArtifacts(userOptions) {
	const options = applyDefaultArtifactsOptions(userOptions);
	const resolvePath = (...paths) => resolve(options.cwd, ...paths);
	const packageJsonPath = resolvePath(options.packageJsonPath);
	const { targets, binaryName, packageName } = await readNapiConfig(packageJsonPath, options.configPath ? resolvePath(options.configPath) : void 0);
	const distDirs = targets.map((platform) => join(options.cwd, options.npmDir, platform.platformArchABI));
	const universalSourceBins = new Set(targets.filter((platform) => platform.arch === "universal").flatMap((p) => {
		var _UniArchsByPlatform$p;
		return (_UniArchsByPlatform$p = UniArchsByPlatform[p.platform]) === null || _UniArchsByPlatform$p === void 0 ? void 0 : _UniArchsByPlatform$p.map((a) => `${p.platform}-${a}`);
	}).filter(Boolean));
	await collectNodeBinaries(join(options.cwd, options.outputDir)).then((output) => Promise.all(output.map(async (filePath) => {
		debug$8.info(`Read [${colors.yellowBright(filePath)}]`);
		const sourceContent = await readFileAsync(filePath);
		const parsedName = parse(filePath);
		const terms = parsedName.name.split(".");
		const platformArchABI = terms.pop();
		const _binaryName = terms.join(".");
		if (_binaryName !== binaryName) {
			debug$8.warn(`[${_binaryName}] is not matched with [${binaryName}], skip`);
			return;
		}
		const dir = distDirs.find((dir) => dir.includes(platformArchABI));
		if (!dir && universalSourceBins.has(platformArchABI)) {
			debug$8.warn(`[${platformArchABI}] has no dist dir but it is source bin for universal arch, skip`);
			return;
		}
		if (!dir) throw new Error(`No dist dir found for ${filePath}`);
		const distFilePath = join(dir, parsedName.base);
		debug$8.info(`Write file content to [${colors.yellowBright(distFilePath)}]`);
		await writeFileAsync(distFilePath, sourceContent);
		const distFilePathLocal = join(parse(packageJsonPath).dir, parsedName.base);
		debug$8.info(`Write file content to [${colors.yellowBright(distFilePathLocal)}]`);
		await writeFileAsync(distFilePathLocal, sourceContent);
	})));
	const wasiTarget = targets.find((t) => t.platform === "wasi");
	if (wasiTarget) {
		const wasiDir = join(options.cwd, options.npmDir, wasiTarget.platformArchABI);
		const cjsFile = join(options.buildOutputDir ?? options.cwd, `${binaryName}.wasi.cjs`);
		const workerFile = join(options.buildOutputDir ?? options.cwd, `wasi-worker.mjs`);
		const browserEntry = join(options.buildOutputDir ?? options.cwd, `${binaryName}.wasi-browser.js`);
		const browserWorkerFile = join(options.buildOutputDir ?? options.cwd, `wasi-worker-browser.mjs`);
		debug$8.info(`Move wasi binding file [${colors.yellowBright(cjsFile)}] to [${colors.yellowBright(wasiDir)}]`);
		await writeFileAsync(join(wasiDir, `${binaryName}.wasi.cjs`), await readFileAsync(cjsFile));
		debug$8.info(`Move wasi worker file [${colors.yellowBright(workerFile)}] to [${colors.yellowBright(wasiDir)}]`);
		await writeFileAsync(join(wasiDir, `wasi-worker.mjs`), await readFileAsync(workerFile));
		debug$8.info(`Move wasi browser entry file [${colors.yellowBright(browserEntry)}] to [${colors.yellowBright(wasiDir)}]`);
		await writeFileAsync(join(wasiDir, `${binaryName}.wasi-browser.js`), (await readFileAsync(browserEntry, "utf8")).replace(`new URL('./wasi-worker-browser.mjs', import.meta.url)`, `new URL('${packageName}-wasm32-wasi/wasi-worker-browser.mjs', import.meta.url)`));
		debug$8.info(`Move wasi browser worker file [${colors.yellowBright(browserWorkerFile)}] to [${colors.yellowBright(wasiDir)}]`);
		await writeFileAsync(join(wasiDir, `wasi-worker-browser.mjs`), await readFileAsync(browserWorkerFile));
	}
}
async function collectNodeBinaries(root) {
	const files = await readdirAsync(root, { withFileTypes: true });
	const nodeBinaries = files.filter((file) => file.isFile() && (file.name.endsWith(".node") || file.name.endsWith(".wasm"))).map((file) => join(root, file.name));
	const dirs = files.filter((file) => file.isDirectory());
	for (const dir of dirs) if (dir.name !== "node_modules") nodeBinaries.push(...await collectNodeBinaries(join(root, dir.name)));
	return nodeBinaries;
}
//#endregion
//#region src/api/templates/js-binding.ts
function createCjsBinding(localName, pkgName, idents, packageVersion) {
	return `${bindingHeader}
${createCommonBinding(localName, pkgName, packageVersion)}
module.exports = nativeBinding
${idents.map((ident) => `module.exports.${ident} = nativeBinding.${ident}`).join("\n")}
`;
}
function createEsmBinding(localName, pkgName, idents, packageVersion) {
	return `${bindingHeader}
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const __dirname = new URL('.', import.meta.url).pathname

${createCommonBinding(localName, pkgName, packageVersion)}
const { ${idents.join(", ")} } = nativeBinding
${idents.map((ident) => `export { ${ident} }`).join("\n")}
`;
}
const bindingHeader = `// prettier-ignore
/* eslint-disable */
// @ts-nocheck
/* auto-generated by NAPI-RS */
`;
function createCommonBinding(localName, pkgName, packageVersion) {
	function requireTuple(tuple, identSize = 8) {
		const identLow = " ".repeat(identSize - 2);
		const ident = " ".repeat(identSize);
		return `try {
${ident}return require('./${localName}.${tuple}.node')
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}${packageVersion ? `
${identLow}try {
${ident}const binding = require('${pkgName}-${tuple}')
${ident}const bindingPackageVersion = require('${pkgName}-${tuple}/package.json').version
${ident}if (bindingPackageVersion !== '${packageVersion}' && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '0') {
${ident}  throw new Error(\`Native binding package version mismatch, expected ${packageVersion} but got \${bindingPackageVersion}. You can reinstall dependencies to fix this issue.\`)
${ident}}
${ident}return binding
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}` : `
${identLow}try {
${ident}return require('${pkgName}-${tuple}')
${identLow}} catch (e) {
${ident}loadErrors.push(e)
${identLow}}`}`;
	}
	return `const { readFileSync } = require('node:fs')
let nativeBinding = null
const loadErrors = []

const isMusl = () => {
  let musl = false
  if (process.platform === 'linux') {
    musl = isMuslFromFilesystem()
    if (musl === null) {
      musl = isMuslFromReport()
    }
    if (musl === null) {
      musl = isMuslFromChildProcess()
    }
  }
  return musl
}

const isFileMusl = (f) => f.includes('libc.musl-') || f.includes('ld-musl-')

const isMuslFromFilesystem = () => {
  try {
    return readFileSync('/usr/bin/ldd', 'utf-8').includes('musl')
  } catch {
    return null
  }
}

const isMuslFromReport = () => {
  let report = null
  if (typeof process.report?.getReport === 'function') {
    process.report.excludeNetwork = true
    report = process.report.getReport()
  }
  if (!report) {
    return null
  }
  if (report.header && report.header.glibcVersionRuntime) {
    return false
  }
  if (Array.isArray(report.sharedObjects)) {
    if (report.sharedObjects.some(isFileMusl)) {
      return true
    }
  }
  return false
}

const isMuslFromChildProcess = () => {
  try {
    return require('child_process').execSync('ldd --version', { encoding: 'utf8' }).includes('musl')
  } catch (e) {
    // If we reach this case, we don't know if the system is musl or not, so is better to just fallback to false
    return false
  }
}

function requireNative() {
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    try {
      return require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);
    } catch (err) {
      loadErrors.push(err)
    }
  } else if (process.platform === 'android') {
    if (process.arch === 'arm64') {
      ${requireTuple("android-arm64")}
    } else if (process.arch === 'arm') {
      ${requireTuple("android-arm-eabi")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Android \${process.arch}\`))
    }
  } else if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      if (process.config?.variables?.shlib_suffix === 'dll.a' || process.config?.variables?.node_target_type === 'shared_library') {
        ${requireTuple("win32-x64-gnu")}
      } else {
        ${requireTuple("win32-x64-msvc")}
      }
    } else if (process.arch === 'ia32') {
      ${requireTuple("win32-ia32-msvc")}
    } else if (process.arch === 'arm64') {
      ${requireTuple("win32-arm64-msvc")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Windows: \${process.arch}\`))
    }
  } else if (process.platform === 'darwin') {
    ${requireTuple("darwin-universal", 6)}
    if (process.arch === 'x64') {
      ${requireTuple("darwin-x64")}
    } else if (process.arch === 'arm64') {
      ${requireTuple("darwin-arm64")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on macOS: \${process.arch}\`))
    }
  } else if (process.platform === 'freebsd') {
    if (process.arch === 'x64') {
      ${requireTuple("freebsd-x64")}
    } else if (process.arch === 'arm64') {
      ${requireTuple("freebsd-arm64")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on FreeBSD: \${process.arch}\`))
    }
  } else if (process.platform === 'linux') {
    if (process.arch === 'x64') {
      if (isMusl()) {
        ${requireTuple("linux-x64-musl", 10)}
      } else {
        ${requireTuple("linux-x64-gnu", 10)}
      }
    } else if (process.arch === 'arm64') {
      if (isMusl()) {
        ${requireTuple("linux-arm64-musl", 10)}
      } else {
        ${requireTuple("linux-arm64-gnu", 10)}
      }
    } else if (process.arch === 'arm') {
      if (isMusl()) {
        ${requireTuple("linux-arm-musleabihf", 10)}
      } else {
        ${requireTuple("linux-arm-gnueabihf", 10)}
      }
    } else if (process.arch === 'loong64') {
      if (isMusl()) {
        ${requireTuple("linux-loong64-musl", 10)}
      } else {
        ${requireTuple("linux-loong64-gnu", 10)}
      }
    } else if (process.arch === 'riscv64') {
      if (isMusl()) {
        ${requireTuple("linux-riscv64-musl", 10)}
      } else {
        ${requireTuple("linux-riscv64-gnu", 10)}
      }
    } else if (process.arch === 'ppc64') {
      ${requireTuple("linux-ppc64-gnu")}
    } else if (process.arch === 's390x') {
      ${requireTuple("linux-s390x-gnu")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on Linux: \${process.arch}\`))
    }
  } else if (process.platform === 'openharmony') {
    if (process.arch === 'arm64') {
      ${requireTuple("openharmony-arm64")}
    } else if (process.arch === 'x64') {
      ${requireTuple("openharmony-x64")}
    } else if (process.arch === 'arm') {
      ${requireTuple("openharmony-arm")}
    } else {
      loadErrors.push(new Error(\`Unsupported architecture on OpenHarmony: \${process.arch}\`))
    }
  } else {
    loadErrors.push(new Error(\`Unsupported OS: \${process.platform}, architecture: \${process.arch}\`))
  }
}

nativeBinding = requireNative()

if (!nativeBinding || process.env.NAPI_RS_FORCE_WASI) {
  let wasiBinding = null
  let wasiBindingError = null
  try {
    wasiBinding = require('./${localName}.wasi.cjs')
    nativeBinding = wasiBinding
  } catch (err) {
    if (process.env.NAPI_RS_FORCE_WASI) {
      wasiBindingError = err
    }
  }
  if (!nativeBinding || process.env.NAPI_RS_FORCE_WASI) {
    try {
      wasiBinding = require('${pkgName}-wasm32-wasi')
      nativeBinding = wasiBinding
    } catch (err) {
      if (process.env.NAPI_RS_FORCE_WASI) {
        if (!wasiBindingError) {
          wasiBindingError = err
        } else {
          wasiBindingError.cause = err
        }
        loadErrors.push(err)
      }
    }
  }
  if (process.env.NAPI_RS_FORCE_WASI === 'error' && !wasiBinding) {
    const error = new Error('WASI binding not found and NAPI_RS_FORCE_WASI is set to error')
    error.cause = wasiBindingError
    throw error
  }
}

if (!nativeBinding) {
  if (loadErrors.length > 0) {
    throw new Error(
      \`Cannot find native binding. \` +
        \`npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). \` +
        'Please try \`npm i\` again after removing both package-lock.json and node_modules directory.',
      {
        cause: loadErrors.reduce((err, cur) => {
          cur.cause = err
          return cur
        }),
      },
    )
  }
  throw new Error(\`Failed to load native binding\`)
}
`;
}
//#endregion
//#region src/api/templates/load-wasi-template.ts
const createWasiBrowserBinding = (wasiFilename, initialMemory = 4e3, maximumMemory = 65536, fs = false, asyncInit = false, buffer = false, errorEvent = false) => {
	return `import {
  createOnMessage as __wasmCreateOnMessageForFsProxy,
  getDefaultContext as __emnapiGetDefaultContext,
  ${asyncInit ? `instantiateNapiModule as __emnapiInstantiateNapiModule` : `instantiateNapiModuleSync as __emnapiInstantiateNapiModuleSync`},
  WASI as __WASI,
} from '@napi-rs/wasm-runtime'
${fs ? buffer ? `import { memfs, Buffer } from '@napi-rs/wasm-runtime/fs'` : `import { memfs } from '@napi-rs/wasm-runtime/fs'` : ""}
${buffer && !fs ? `import { Buffer } from 'buffer'` : ""}
${fs ? `
export const { fs: __fs, vol: __volume } = memfs()

const __wasi = new __WASI({
  version: 'preview1',
  fs: __fs,
  preopens: {
    '/': '/',
  },
})` : `
const __wasi = new __WASI({
  version: 'preview1',
})`}

const __wasmUrl = new URL('./${wasiFilename}.wasm', import.meta.url).href
const __emnapiContext = __emnapiGetDefaultContext()
${buffer ? "__emnapiContext.feature.Buffer = Buffer" : ""}

const __sharedMemory = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
  shared: true,
})

const __wasmFile = await fetch(__wasmUrl).then((res) => res.arrayBuffer())

const {
  instance: __napiInstance,
  module: __wasiModule,
  napiModule: __napiModule,
} = ${asyncInit ? `await __emnapiInstantiateNapiModule` : `__emnapiInstantiateNapiModuleSync`}(__wasmFile, {
  context: __emnapiContext,
  asyncWorkPoolSize: 4,
  wasi: __wasi,
  onCreateWorker() {
    const worker = new Worker(new URL('./wasi-worker-browser.mjs', import.meta.url), {
      type: 'module',
    })
${fs ? `    worker.addEventListener('message', __wasmCreateOnMessageForFsProxy(__fs))\n` : ""}
${errorEvent ? `    worker.addEventListener('error', (event) => {
      if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
        window.dispatchEvent(new CustomEvent('napi-rs-worker-error', { detail: event.data }))
      }
    })
` : ""}
    return worker
  },
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
`;
};
const createWasiBinding = (wasmFileName, packageName, initialMemory = 4e3, maximumMemory = 65536) => `/* eslint-disable */
/* prettier-ignore */

/* auto-generated by NAPI-RS */

const __nodeFs = require('node:fs')
const __nodePath = require('node:path')
const { WASI: __nodeWASI } = require('node:wasi')
const { Worker } = require('node:worker_threads')

const {
  createOnMessage: __wasmCreateOnMessageForFsProxy,
  getDefaultContext: __emnapiGetDefaultContext,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime')

const __rootDir = __nodePath.parse(process.cwd()).root

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: {
    [__rootDir]: __rootDir,
  }
})

const __emnapiContext = __emnapiGetDefaultContext()

const __sharedMemory = new WebAssembly.Memory({
  initial: ${initialMemory},
  maximum: ${maximumMemory},
  shared: true,
})

let __wasmFilePath = __nodePath.join(__dirname, '${wasmFileName}.wasm')
const __wasmDebugFilePath = __nodePath.join(__dirname, '${wasmFileName}.debug.wasm')

if (__nodeFs.existsSync(__wasmDebugFilePath)) {
  __wasmFilePath = __wasmDebugFilePath
} else if (!__nodeFs.existsSync(__wasmFilePath)) {
  try {
    __wasmFilePath = require.resolve('${packageName}-wasm32-wasi/${wasmFileName}.wasm')
  } catch {
    throw new Error('Cannot find ${wasmFileName}.wasm file, and ${packageName}-wasm32-wasi package is not installed.')
  }
}

const { instance: __napiInstance, module: __wasiModule, napiModule: __napiModule } = __emnapiInstantiateNapiModuleSync(__nodeFs.readFileSync(__wasmFilePath), {
  context: __emnapiContext,
  asyncWorkPoolSize: (function() {
    const threadsSizeFromEnv = Number(process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE)
    // NaN > 0 is false
    if (threadsSizeFromEnv > 0) {
      return threadsSizeFromEnv
    } else {
      return 4
    }
  })(),
  reuseWorker: true,
  wasi: __wasi,
  onCreateWorker() {
    const worker = new Worker(__nodePath.join(__dirname, 'wasi-worker.mjs'), {
      env: process.env,
    })
    worker.onmessage = ({ data }) => {
      __wasmCreateOnMessageForFsProxy(__nodeFs)(data)
    }

    // The main thread of Node.js waits for all the active handles before exiting.
    // But Rust threads are never waited without \`thread::join\`.
    // So here we hack the code of Node.js to prevent the workers from being referenced (active).
    // According to https://github.com/nodejs/node/blob/19e0d472728c79d418b74bddff588bea70a403d0/lib/internal/worker.js#L415,
    // a worker is consist of two handles: kPublicPort and kHandle.
    {
      const kPublicPort = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kPublicPort")
      );
      if (kPublicPort) {
        worker[kPublicPort].ref = () => {};
      }

      const kHandle = Object.getOwnPropertySymbols(worker).find(s =>
        s.toString().includes("kHandle")
      );
      if (kHandle) {
        worker[kHandle].ref = () => {};
      }

      worker.unref();
    }
    return worker
  },
  overwriteImports(importObject) {
    importObject.env = {
      ...importObject.env,
      ...importObject.napi,
      ...importObject.emnapi,
      memory: __sharedMemory,
    }
    return importObject
  },
  beforeInit({ instance }) {
    for (const name of Object.keys(instance.exports)) {
      if (name.startsWith('__napi_register__')) {
        instance.exports[name]()
      }
    }
  },
})
`;
//#endregion
//#region src/api/templates/wasi-worker-template.ts
const WASI_WORKER_TEMPLATE = `import fs from "node:fs";
import { createRequire } from "node:module";
import { parse } from "node:path";
import { WASI } from "node:wasi";
import { parentPort, Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);

const { instantiateNapiModuleSync, MessageHandler, getDefaultContext } = require("@napi-rs/wasm-runtime");

if (parentPort) {
  parentPort.on("message", (data) => {
    globalThis.onmessage({ data });
  });
}

Object.assign(globalThis, {
  self: globalThis,
  require,
  Worker,
  importScripts: function (f) {
    ;(0, eval)(fs.readFileSync(f, "utf8") + "//# sourceURL=" + f);
  },
  postMessage: function (msg) {
    if (parentPort) {
      parentPort.postMessage(msg);
    }
  },
});

const emnapiContext = getDefaultContext();

const __rootDir = parse(process.cwd()).root;

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    const wasi = new WASI({
      version: 'preview1',
      env: process.env,
      preopens: {
        [__rootDir]: __rootDir,
      },
    });

    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      context: emnapiContext,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory
        };
      },
    });
  },
});

globalThis.onmessage = function (e) {
  handler.handle(e);
};
`;
const createWasiBrowserWorkerBinding = (fs, errorEvent) => {
	const fsImport = fs ? `import { instantiateNapiModuleSync, MessageHandler, WASI, createFsProxy } from '@napi-rs/wasm-runtime'
import { memfsExported as __memfsExported } from '@napi-rs/wasm-runtime/fs'

const fs = createFsProxy(__memfsExported)` : `import { instantiateNapiModuleSync, MessageHandler, WASI } from '@napi-rs/wasm-runtime'`;
	const errorOutputsAppend = errorEvent ? `\n        errorOutputs.push([...arguments])` : "";
	return `${fsImport}

const errorOutputs = []

const handler = new MessageHandler({
  onLoad({ wasmModule, wasmMemory }) {
    ${fs ? `const wasi = new WASI({
      fs,
      preopens: {
        '/': '/',
      },
      print: function () {
        // eslint-disable-next-line no-console
        console.log.apply(console, arguments)
      },
      printErr: function() {
        // eslint-disable-next-line no-console
        console.error.apply(console, arguments)
        ${errorOutputsAppend}
      },
    })` : `const wasi = new WASI({
      print: function () {
        // eslint-disable-next-line no-console
        console.log.apply(console, arguments)
      },
      printErr: function() {
        // eslint-disable-next-line no-console
        console.error.apply(console, arguments)
        ${errorOutputsAppend}
      },
    })`}
    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      wasi,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        }
      },
    })
  },
  ${errorEvent ? `onError(error) {
    postMessage({ type: 'error', error, errorOutputs })
    errorOutputs.length = 0
  }` : ""}
})

globalThis.onmessage = function (e) {
  handler.handle(e)
}
`;
};
//#endregion
//#region src/api/build.ts
const debug$7 = debugFactory("build");
const require$1 = createRequire(import.meta.url);
async function buildProject(rawOptions) {
	debug$7("napi build command receive options: %O", rawOptions);
	const options = {
		dtsCache: true,
		...rawOptions,
		cwd: rawOptions.cwd ?? process.cwd()
	};
	const resolvePath = (...paths) => resolve(options.cwd, ...paths);
	const manifestPath = resolvePath(options.manifestPath ?? "Cargo.toml");
	const metadata = await parseMetadata(manifestPath);
	const crate = metadata.packages.find((p) => {
		if (options.package) return p.name === options.package;
		else return p.manifest_path === manifestPath;
	});
	if (!crate) throw new Error("Unable to find crate to build. It seems you are trying to build a crate in a workspace, try using `--package` option to specify the package to build.");
	return new Builder(metadata, crate, await readNapiConfig(resolvePath(options.packageJsonPath ?? "package.json"), options.configPath ? resolvePath(options.configPath) : void 0), options).build();
}
var Builder = class {
	args = [];
	envs = {};
	outputs = [];
	target;
	crateDir;
	outputDir;
	targetDir;
	enableTypeDef = false;
	constructor(metadata, crate, config, options) {
		this.metadata = metadata;
		this.crate = crate;
		this.config = config;
		this.options = options;
		this.target = options.target ? parseTriple(options.target) : process.env.CARGO_BUILD_TARGET ? parseTriple(process.env.CARGO_BUILD_TARGET) : getSystemDefaultTarget();
		this.crateDir = parse(crate.manifest_path).dir;
		this.outputDir = resolve(this.options.cwd, options.outputDir ?? this.crateDir);
		this.targetDir = options.targetDir ?? process.env.CARGO_BUILD_TARGET_DIR ?? metadata.target_directory;
		this.enableTypeDef = this.crate.dependencies.some((dep) => dep.name === "napi-derive" && (dep.uses_default_features || dep.features.includes("type-def")));
		if (!this.enableTypeDef) {
			const requirementWarning = "`napi-derive` crate is not used or `type-def` feature is not enabled for `napi-derive` crate";
			debug$7.warn(`${requirementWarning}. Will skip binding generation for \`.node\`, \`.wasi\` and \`.d.ts\` files.`);
			if (this.options.dts || this.options.dtsHeader || this.config.dtsHeader || this.config.dtsHeaderFile) debug$7.warn(`${requirementWarning}. \`dts\` related options are enabled but will be ignored.`);
		}
	}
	get cdyLibName() {
		var _this$crate$targets$f;
		return (_this$crate$targets$f = this.crate.targets.find((t) => t.crate_types.includes("cdylib"))) === null || _this$crate$targets$f === void 0 ? void 0 : _this$crate$targets$f.name;
	}
	get binName() {
		var _this$crate$targets$f2;
		return this.options.bin ?? (this.cdyLibName ? null : (_this$crate$targets$f2 = this.crate.targets.find((t) => t.crate_types.includes("bin"))) === null || _this$crate$targets$f2 === void 0 ? void 0 : _this$crate$targets$f2.name);
	}
	build() {
		if (!this.cdyLibName) {
			const warning = "Missing `crate-type = [\"cdylib\"]` in [lib] config. The build result will not be available as node addon.";
			if (this.binName) debug$7.warn(warning);
			else throw new Error(warning);
		}
		return this.pickBinary().setPackage().setFeatures().setTarget().pickCrossToolchain().setEnvs().setBypassArgs().exec();
	}
	pickCrossToolchain() {
		if (!this.options.useNapiCross) return this;
		if (this.options.useCross) debug$7.warn("You are trying to use both `--cross` and `--use-napi-cross` options, `--use-cross` will be ignored.");
		if (this.options.crossCompile) debug$7.warn("You are trying to use both `--cross-compile` and `--use-napi-cross` options, `--cross-compile` will be ignored.");
		try {
			var _process$env$TARGET_C, _process$env$CC, _process$env$CXX, _process$env$TARGET_C2;
			const { version, download } = require$1("@napi-rs/cross-toolchain");
			const alias = { "s390x-unknown-linux-gnu": "s390x-ibm-linux-gnu" };
			const toolchainPath = join(homedir(), ".napi-rs", "cross-toolchain", version, this.target.triple);
			mkdirSync(toolchainPath, { recursive: true });
			if (existsSync(join(toolchainPath, "package.json"))) debug$7(`Toolchain ${toolchainPath} exists, skip extracting`);
			else download(process.arch, this.target.triple).unpack(toolchainPath);
			const upperCaseTarget = targetToEnvVar(this.target.triple);
			const crossTargetName = alias[this.target.triple] ?? this.target.triple;
			const linkerEnv = `CARGO_TARGET_${upperCaseTarget}_LINKER`;
			this.setEnvIfNotExists(linkerEnv, join(toolchainPath, "bin", `${crossTargetName}-gcc`));
			this.setEnvIfNotExists("TARGET_SYSROOT", join(toolchainPath, crossTargetName, "sysroot"));
			this.setEnvIfNotExists("TARGET_AR", join(toolchainPath, "bin", `${crossTargetName}-ar`));
			this.setEnvIfNotExists("TARGET_RANLIB", join(toolchainPath, "bin", `${crossTargetName}-ranlib`));
			this.setEnvIfNotExists("TARGET_READELF", join(toolchainPath, "bin", `${crossTargetName}-readelf`));
			this.setEnvIfNotExists("TARGET_C_INCLUDE_PATH", join(toolchainPath, crossTargetName, "sysroot", "usr", "include/"));
			this.setEnvIfNotExists("TARGET_CC", join(toolchainPath, "bin", `${crossTargetName}-gcc`));
			this.setEnvIfNotExists("TARGET_CXX", join(toolchainPath, "bin", `${crossTargetName}-g++`));
			this.setEnvIfNotExists("BINDGEN_EXTRA_CLANG_ARGS", `--sysroot=${this.envs.TARGET_SYSROOT}}`);
			if (((_process$env$TARGET_C = process.env.TARGET_CC) === null || _process$env$TARGET_C === void 0 ? void 0 : _process$env$TARGET_C.startsWith("clang")) || ((_process$env$CC = process.env.CC) === null || _process$env$CC === void 0 ? void 0 : _process$env$CC.startsWith("clang")) && !process.env.TARGET_CC) {
				const TARGET_CFLAGS = process.env.TARGET_CFLAGS ?? "";
				this.envs.TARGET_CFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT} --gcc-toolchain=${toolchainPath} ${TARGET_CFLAGS}`;
			}
			if (((_process$env$CXX = process.env.CXX) === null || _process$env$CXX === void 0 ? void 0 : _process$env$CXX.startsWith("clang++")) && !process.env.TARGET_CXX || ((_process$env$TARGET_C2 = process.env.TARGET_CXX) === null || _process$env$TARGET_C2 === void 0 ? void 0 : _process$env$TARGET_C2.startsWith("clang++"))) {
				const TARGET_CXXFLAGS = process.env.TARGET_CXXFLAGS ?? "";
				this.envs.TARGET_CXXFLAGS = `--sysroot=${this.envs.TARGET_SYSROOT} --gcc-toolchain=${toolchainPath} ${TARGET_CXXFLAGS}`;
			}
			this.envs.PATH = this.envs.PATH ? `${toolchainPath}/bin:${this.envs.PATH}:${process.env.PATH}` : `${toolchainPath}/bin:${process.env.PATH}`;
		} catch (e) {
			debug$7.warn("Pick cross toolchain failed", e);
		}
		return this;
	}
	exec() {
		debug$7(`Start building crate: ${this.crate.name}`);
		debug$7("  %i", `cargo ${this.args.join(" ")}`);
		const controller = new AbortController();
		const watch = this.options.watch;
		return {
			task: new Promise((resolve, reject) => {
				var _buildProcess$stderr;
				if (this.options.useCross && this.options.crossCompile) throw new Error("`--use-cross` and `--cross-compile` can not be used together");
				const buildProcess = spawn(process.env.CARGO ?? (this.options.useCross ? "cross" : "cargo"), this.args, {
					env: {
						...process.env,
						...this.envs
					},
					stdio: watch ? [
						"inherit",
						"inherit",
						"pipe"
					] : "inherit",
					cwd: this.options.cwd,
					signal: controller.signal
				});
				buildProcess.once("exit", (code) => {
					if (code === 0) {
						debug$7("%i", `Build crate ${this.crate.name} successfully!`);
						resolve();
					} else reject(/* @__PURE__ */ new Error(`Build failed with exit code ${code}`));
				});
				buildProcess.once("error", (e) => {
					reject(new Error(`Build failed with error: ${e.message}`, { cause: e }));
				});
				(_buildProcess$stderr = buildProcess.stderr) === null || _buildProcess$stderr === void 0 || _buildProcess$stderr.on("data", (data) => {
					const output = data.toString();
					console.error(output);
					if (/Finished\s(`dev`|`release`)/.test(output)) this.postBuild().catch(() => {});
				});
			}).then(() => this.postBuild()),
			abort: () => controller.abort()
		};
	}
	pickBinary() {
		let set = false;
		if (this.options.watch) if (process.env.CI) debug$7.warn("Watch mode is not supported in CI environment");
		else {
			debug$7("Use %i", "cargo-watch");
			tryInstallCargoBinary("cargo-watch", "watch");
			this.args.push("watch", "--why", "-i", "*.{js,ts,node}", "-w", this.crateDir, "--", "cargo", "build");
			set = true;
		}
		if (this.options.crossCompile) if (this.target.platform === "win32") if (process.platform === "win32") debug$7.warn("You are trying to cross compile to win32 platform on win32 platform which is unnecessary.");
		else {
			debug$7("Use %i", "cargo-xwin");
			tryInstallCargoBinary("cargo-xwin", "xwin");
			this.args.push("xwin", "build");
			if (this.target.arch === "ia32") this.envs.XWIN_ARCH = "x86";
			set = true;
		}
		else if (this.target.platform === "linux" && process.platform === "linux" && this.target.arch === process.arch && (function(abi) {
			var _process$report;
			return abi === (((_process$report = process.report) === null || _process$report === void 0 || (_process$report = _process$report.getReport()) === null || _process$report === void 0 || (_process$report = _process$report.header) === null || _process$report === void 0 ? void 0 : _process$report.glibcVersionRuntime) ? "gnu" : "musl");
		})(this.target.abi)) debug$7.warn("You are trying to cross compile to linux target on linux platform which is unnecessary.");
		else if (this.target.platform === "darwin" && process.platform === "darwin") debug$7.warn("You are trying to cross compile to darwin target on darwin platform which is unnecessary.");
		else {
			debug$7("Use %i", "cargo-zigbuild");
			tryInstallCargoBinary("cargo-zigbuild", "zigbuild");
			this.args.push("zigbuild");
			set = true;
		}
		if (!set) this.args.push("build");
		return this;
	}
	setPackage() {
		const args = [];
		if (this.options.package) args.push("--package", this.options.package);
		if (this.binName) args.push("--bin", this.binName);
		if (args.length) {
			debug$7("Set package flags: ");
			debug$7("  %O", args);
			this.args.push(...args);
		}
		return this;
	}
	setTarget() {
		debug$7("Set compiling target to: ");
		debug$7("  %i", this.target.triple);
		this.args.push("--target", this.target.triple);
		return this;
	}
	setEnvs() {
		var _this$target$abi;
		if (this.enableTypeDef) {
			this.envs.NAPI_TYPE_DEF_TMP_FOLDER = this.generateIntermediateTypeDefFolder();
			this.setForceBuildEnvs(this.envs.NAPI_TYPE_DEF_TMP_FOLDER);
		}
		let rustflags = process.env.RUSTFLAGS ?? process.env.CARGO_BUILD_RUSTFLAGS ?? "";
		if (((_this$target$abi = this.target.abi) === null || _this$target$abi === void 0 ? void 0 : _this$target$abi.includes("musl")) && !rustflags.includes("target-feature=-crt-static")) rustflags += " -C target-feature=-crt-static";
		if (this.options.strip && !rustflags.includes("link-arg=-s")) rustflags += " -C link-arg=-s";
		if (rustflags.length) this.envs.RUSTFLAGS = rustflags;
		const linker = this.options.crossCompile ? void 0 : getTargetLinker(this.target.triple);
		const linkerEnv = `CARGO_TARGET_${targetToEnvVar(this.target.triple)}_LINKER`;
		if (linker && !process.env[linkerEnv] && !this.envs[linkerEnv]) this.envs[linkerEnv] = linker;
		if (this.target.platform === "android") this.setAndroidEnv();
		if (this.target.platform === "wasi") this.setWasiEnv();
		if (this.target.platform === "openharmony") this.setOpenHarmonyEnv();
		debug$7("Set envs: ");
		Object.entries(this.envs).forEach(([k, v]) => {
			debug$7("  %i", `${k}=${v}`);
		});
		return this;
	}
	setForceBuildEnvs(typeDefTmpFolder) {
		this.metadata.packages.forEach((crate) => {
			if (crate.dependencies.some((d) => d.name === "napi-derive") && !existsSync(join(typeDefTmpFolder, crate.name))) this.envs[`NAPI_FORCE_BUILD_${crate.name.replace(/-/g, "_").toUpperCase()}`] = Date.now().toString();
		});
	}
	setAndroidEnv() {
		const { ANDROID_NDK_LATEST_HOME } = process.env;
		if (!ANDROID_NDK_LATEST_HOME) debug$7.warn(`${colors.red("ANDROID_NDK_LATEST_HOME")} environment variable is missing`);
		if (process.platform === "android") return;
		const targetArch = this.target.arch === "arm" ? "armv7a" : "aarch64";
		const targetPlatform = this.target.arch === "arm" ? "androideabi24" : "android24";
		const hostPlatform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
		Object.assign(this.envs, {
			CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-android24-clang`,
			CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-androideabi24-clang`,
			TARGET_CC: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang`,
			TARGET_CXX: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/${targetArch}-linux-${targetPlatform}-clang++`,
			TARGET_AR: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ar`,
			TARGET_RANLIB: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin/llvm-ranlib`,
			ANDROID_NDK: ANDROID_NDK_LATEST_HOME,
			PATH: `${ANDROID_NDK_LATEST_HOME}/toolchains/llvm/prebuilt/${hostPlatform}-x86_64/bin${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`
		});
	}
	setWasiEnv() {
		const emnapi = join(require$1.resolve("emnapi"), "..", "lib", "wasm32-wasi-threads");
		this.envs.EMNAPI_LINK_DIR = emnapi;
		const emnapiVersion = require$1("emnapi/package.json").version;
		const projectRequire = createRequire(join(this.options.cwd, "package.json"));
		const emnapiCoreVersion = projectRequire("@emnapi/core").version;
		const emnapiRuntimeVersion = projectRequire("@emnapi/runtime").version;
		if (emnapiVersion !== emnapiCoreVersion || emnapiVersion !== emnapiRuntimeVersion) throw new Error(`emnapi version mismatch: emnapi@${emnapiVersion}, @emnapi/core@${emnapiCoreVersion}, @emnapi/runtime@${emnapiRuntimeVersion}. Please ensure all emnapi packages are the same version.`);
		const { WASI_SDK_PATH } = process.env;
		if (WASI_SDK_PATH && existsSync(WASI_SDK_PATH)) {
			this.envs.CARGO_TARGET_WASM32_WASI_PREVIEW1_THREADS_LINKER = join(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP1_LINKER = join(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER = join(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP2_LINKER = join(WASI_SDK_PATH, "bin", "wasm-ld");
			this.setEnvIfNotExists("TARGET_CC", join(WASI_SDK_PATH, "bin", "clang"));
			this.setEnvIfNotExists("TARGET_CXX", join(WASI_SDK_PATH, "bin", "clang++"));
			this.setEnvIfNotExists("TARGET_AR", join(WASI_SDK_PATH, "bin", "ar"));
			this.setEnvIfNotExists("TARGET_RANLIB", join(WASI_SDK_PATH, "bin", "ranlib"));
			this.setEnvIfNotExists("TARGET_CFLAGS", `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`);
			this.setEnvIfNotExists("TARGET_CXXFLAGS", `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`);
			this.setEnvIfNotExists(`TARGET_LDFLAGS`, `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=wasm32-wasi-threads`);
		}
	}
	setOpenHarmonyEnv() {
		const { OHOS_SDK_PATH, OHOS_SDK_NATIVE } = process.env;
		const ndkPath = OHOS_SDK_PATH ? `${OHOS_SDK_PATH}/native` : OHOS_SDK_NATIVE;
		if (!ndkPath && process.platform !== "openharmony") {
			debug$7.warn(`${colors.red("OHOS_SDK_PATH")} or ${colors.red("OHOS_SDK_NATIVE")} environment variable is missing`);
			return;
		}
		const linkerName = `CARGO_TARGET_${this.target.triple.toUpperCase().replace(/-/g, "_")}_LINKER`;
		const ranPath = `${ndkPath}/llvm/bin/llvm-ranlib`;
		const arPath = `${ndkPath}/llvm/bin/llvm-ar`;
		const ccPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang`;
		const cxxPath = `${ndkPath}/llvm/bin/${this.target.triple}-clang++`;
		const asPath = `${ndkPath}/llvm/bin/llvm-as`;
		const ldPath = `${ndkPath}/llvm/bin/ld.lld`;
		const stripPath = `${ndkPath}/llvm/bin/llvm-strip`;
		const objDumpPath = `${ndkPath}/llvm/bin/llvm-objdump`;
		const objCopyPath = `${ndkPath}/llvm/bin/llvm-objcopy`;
		const nmPath = `${ndkPath}/llvm/bin/llvm-nm`;
		const binPath = `${ndkPath}/llvm/bin`;
		const libPath = `${ndkPath}/llvm/lib`;
		this.setEnvIfNotExists("LIBCLANG_PATH", libPath);
		this.setEnvIfNotExists("DEP_ATOMIC", "clang_rt.builtins");
		this.setEnvIfNotExists(linkerName, ccPath);
		this.setEnvIfNotExists("TARGET_CC", ccPath);
		this.setEnvIfNotExists("TARGET_CXX", cxxPath);
		this.setEnvIfNotExists("TARGET_AR", arPath);
		this.setEnvIfNotExists("TARGET_RANLIB", ranPath);
		this.setEnvIfNotExists("TARGET_AS", asPath);
		this.setEnvIfNotExists("TARGET_LD", ldPath);
		this.setEnvIfNotExists("TARGET_STRIP", stripPath);
		this.setEnvIfNotExists("TARGET_OBJDUMP", objDumpPath);
		this.setEnvIfNotExists("TARGET_OBJCOPY", objCopyPath);
		this.setEnvIfNotExists("TARGET_NM", nmPath);
		this.envs.PATH = `${binPath}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
	}
	setFeatures() {
		const args = [];
		if (this.options.allFeatures && this.options.noDefaultFeatures) throw new Error("Cannot specify --all-features and --no-default-features together");
		if (this.options.allFeatures) args.push("--all-features");
		else if (this.options.noDefaultFeatures) args.push("--no-default-features");
		if (this.options.features) args.push("--features", ...this.options.features);
		debug$7("Set features flags: ");
		debug$7("  %O", args);
		this.args.push(...args);
		return this;
	}
	setBypassArgs() {
		var _this$options$cargoOp;
		if (this.options.release) this.args.push("--release");
		if (this.options.verbose) this.args.push("--verbose");
		if (this.options.targetDir) this.args.push("--target-dir", this.options.targetDir);
		if (this.options.profile) this.args.push("--profile", this.options.profile);
		if (this.options.manifestPath) this.args.push("--manifest-path", this.options.manifestPath);
		if ((_this$options$cargoOp = this.options.cargoOptions) === null || _this$options$cargoOp === void 0 ? void 0 : _this$options$cargoOp.length) this.args.push(...this.options.cargoOptions);
		return this;
	}
	generateIntermediateTypeDefFolder() {
		let folder = join(this.targetDir, "napi-rs", `${this.crate.name}-${createHash("sha256").update(this.crate.manifest_path).update(CLI_VERSION).digest("hex").substring(0, 8)}`);
		if (!this.options.dtsCache) {
			rmSync(folder, {
				recursive: true,
				force: true
			});
			folder += `_${Date.now()}`;
		}
		mkdirAsync(folder, { recursive: true });
		return folder;
	}
	async postBuild() {
		try {
			debug$7(`Try to create output directory:`);
			debug$7("  %i", this.outputDir);
			await mkdirAsync(this.outputDir, { recursive: true });
			debug$7(`Output directory created`);
		} catch (e) {
			throw new Error(`Failed to create output directory ${this.outputDir}`, { cause: e });
		}
		const wasmBinaryName = await this.copyArtifact();
		if (this.cdyLibName) {
			const idents = await this.generateTypeDef();
			const jsOutput = await this.writeJsBinding(idents);
			const wasmBindingsOutput = await this.writeWasiBinding(wasmBinaryName, idents);
			if (jsOutput) this.outputs.push(jsOutput);
			if (wasmBindingsOutput) this.outputs.push(...wasmBindingsOutput);
		}
		return this.outputs;
	}
	async copyArtifact() {
		const [srcName, destName, wasmBinaryName] = this.getArtifactNames();
		if (!srcName || !destName) return;
		const profile = this.options.profile ?? (this.options.release ? "release" : "debug");
		const src = join(this.targetDir, this.target.triple, profile, srcName);
		debug$7(`Copy artifact from: [${src}]`);
		const dest = join(this.outputDir, destName);
		const isWasm = dest.endsWith(".wasm");
		try {
			if (await fileExists(dest)) {
				debug$7("Old artifact found, remove it first");
				await unlinkAsync(dest);
			}
			debug$7("Copy artifact to:");
			debug$7("  %i", dest);
			if (isWasm) {
				const { ModuleConfig } = await import("@napi-rs/wasm-tools");
				debug$7("Generate debug wasm module");
				try {
					const debugWasmBinary = new ModuleConfig().generateDwarf(true).generateNameSection(true).generateProducersSection(true).preserveCodeTransform(true).strictValidate(false).parse(await readFileAsync(src)).emitWasm(true);
					await writeFileAsync(dest.replace(/\.wasm$/, ".debug.wasm"), debugWasmBinary);
					debug$7("Generate release wasm module");
					await writeFileAsync(dest, new ModuleConfig().generateDwarf(false).generateNameSection(false).generateProducersSection(false).preserveCodeTransform(false).strictValidate(false).onlyStableFeatures(false).parse(debugWasmBinary).emitWasm(false));
				} catch (e) {
					debug$7.warn(`Failed to generate debug wasm module: ${e.message ?? e}`);
					await copyFileAsync(src, dest);
				}
			} else await copyFileAsync(src, dest);
			this.outputs.push({
				kind: dest.endsWith(".node") ? "node" : isWasm ? "wasm" : "exe",
				path: dest
			});
			return wasmBinaryName ? join(this.outputDir, wasmBinaryName) : null;
		} catch (e) {
			throw new Error("Failed to copy artifact", { cause: e });
		}
	}
	getArtifactNames() {
		if (this.cdyLibName) {
			const cdyLib = this.cdyLibName.replace(/-/g, "_");
			const wasiTarget = this.config.targets.find((t) => t.platform === "wasi");
			const srcName = this.target.platform === "darwin" ? `lib${cdyLib}.dylib` : this.target.platform === "win32" ? `${cdyLib}.dll` : this.target.platform === "wasi" || this.target.platform === "wasm" ? `${cdyLib}.wasm` : `lib${cdyLib}.so`;
			let destName = this.config.binaryName;
			if (this.options.platform) destName += `.${this.target.platformArchABI}`;
			if (srcName.endsWith(".wasm")) destName += ".wasm";
			else destName += ".node";
			return [
				srcName,
				destName,
				wasiTarget ? `${this.config.binaryName}.${wasiTarget.platformArchABI}.wasm` : null
			];
		} else if (this.binName) {
			const srcName = this.target.platform === "win32" ? `${this.binName}.exe` : this.binName;
			return [srcName, srcName];
		}
		return [];
	}
	async generateTypeDef() {
		const typeDefDir = this.envs.NAPI_TYPE_DEF_TMP_FOLDER;
		if (!this.enableTypeDef) return [];
		const { exports, dts } = await generateTypeDef({
			typeDefDir,
			noDtsHeader: this.options.noDtsHeader,
			dtsHeader: this.options.dtsHeader,
			configDtsHeader: this.config.dtsHeader,
			configDtsHeaderFile: this.config.dtsHeaderFile,
			constEnum: this.options.constEnum ?? this.config.constEnum,
			cwd: this.options.cwd
		});
		const dest = join(this.outputDir, this.options.dts ?? "index.d.ts");
		try {
			debug$7("Writing type def to:");
			debug$7("  %i", dest);
			await writeFileAsync(dest, dts, "utf-8");
		} catch (e) {
			debug$7.error("Failed to write type def file");
			debug$7.error(e);
		}
		if (exports.length > 0) {
			const dest = join(this.outputDir, this.options.dts ?? "index.d.ts");
			this.outputs.push({
				kind: "dts",
				path: dest
			});
		}
		return exports;
	}
	async writeJsBinding(idents) {
		return writeJsBinding({
			platform: this.options.platform,
			noJsBinding: this.options.noJsBinding,
			idents,
			jsBinding: this.options.jsBinding,
			esm: this.options.esm,
			binaryName: this.config.binaryName,
			packageName: this.options.jsPackageName ?? this.config.packageName,
			version: process.env.npm_new_version ?? this.config.packageJson.version,
			outputDir: this.outputDir
		});
	}
	async writeWasiBinding(distFileName, idents) {
		if (distFileName) {
			var _this$config$wasm, _this$config$wasm2, _this$config$wasm3, _this$config$wasm4, _this$config$wasm5, _this$config$wasm6, _this$config$wasm7, _this$config$wasm8, _this$config$wasm9, _this$config$wasm10;
			const { name, dir } = parse(distFileName);
			const bindingPath = join(dir, `${this.config.binaryName}.wasi.cjs`);
			const browserBindingPath = join(dir, `${this.config.binaryName}.wasi-browser.js`);
			const workerPath = join(dir, "wasi-worker.mjs");
			const browserWorkerPath = join(dir, "wasi-worker-browser.mjs");
			const browserEntryPath = join(dir, "browser.js");
			const exportsCode = `module.exports = __napiModule.exports\n` + idents.map((ident) => `module.exports.${ident} = __napiModule.exports.${ident}`).join("\n");
			await writeFileAsync(bindingPath, createWasiBinding(name, this.config.packageName, (_this$config$wasm = this.config.wasm) === null || _this$config$wasm === void 0 ? void 0 : _this$config$wasm.initialMemory, (_this$config$wasm2 = this.config.wasm) === null || _this$config$wasm2 === void 0 ? void 0 : _this$config$wasm2.maximumMemory) + exportsCode + "\n", "utf8");
			await writeFileAsync(browserBindingPath, createWasiBrowserBinding(name, (_this$config$wasm3 = this.config.wasm) === null || _this$config$wasm3 === void 0 ? void 0 : _this$config$wasm3.initialMemory, (_this$config$wasm4 = this.config.wasm) === null || _this$config$wasm4 === void 0 ? void 0 : _this$config$wasm4.maximumMemory, (_this$config$wasm5 = this.config.wasm) === null || _this$config$wasm5 === void 0 || (_this$config$wasm5 = _this$config$wasm5.browser) === null || _this$config$wasm5 === void 0 ? void 0 : _this$config$wasm5.fs, (_this$config$wasm6 = this.config.wasm) === null || _this$config$wasm6 === void 0 || (_this$config$wasm6 = _this$config$wasm6.browser) === null || _this$config$wasm6 === void 0 ? void 0 : _this$config$wasm6.asyncInit, (_this$config$wasm7 = this.config.wasm) === null || _this$config$wasm7 === void 0 || (_this$config$wasm7 = _this$config$wasm7.browser) === null || _this$config$wasm7 === void 0 ? void 0 : _this$config$wasm7.buffer, (_this$config$wasm8 = this.config.wasm) === null || _this$config$wasm8 === void 0 || (_this$config$wasm8 = _this$config$wasm8.browser) === null || _this$config$wasm8 === void 0 ? void 0 : _this$config$wasm8.errorEvent) + `export default __napiModule.exports\n` + idents.map((ident) => `export const ${ident} = __napiModule.exports.${ident}`).join("\n") + "\n", "utf8");
			await writeFileAsync(workerPath, WASI_WORKER_TEMPLATE, "utf8");
			await writeFileAsync(browserWorkerPath, createWasiBrowserWorkerBinding(((_this$config$wasm9 = this.config.wasm) === null || _this$config$wasm9 === void 0 || (_this$config$wasm9 = _this$config$wasm9.browser) === null || _this$config$wasm9 === void 0 ? void 0 : _this$config$wasm9.fs) ?? false, ((_this$config$wasm10 = this.config.wasm) === null || _this$config$wasm10 === void 0 || (_this$config$wasm10 = _this$config$wasm10.browser) === null || _this$config$wasm10 === void 0 ? void 0 : _this$config$wasm10.errorEvent) ?? false), "utf8");
			await writeFileAsync(browserEntryPath, `export * from '${this.config.packageName}-wasm32-wasi'\n`);
			return [
				{
					kind: "js",
					path: bindingPath
				},
				{
					kind: "js",
					path: browserBindingPath
				},
				{
					kind: "js",
					path: workerPath
				},
				{
					kind: "js",
					path: browserWorkerPath
				},
				{
					kind: "js",
					path: browserEntryPath
				}
			];
		}
		return [];
	}
	setEnvIfNotExists(env, value) {
		if (!process.env[env]) this.envs[env] = value;
	}
};
async function writeJsBinding(options) {
	if (!options.platform || options.noJsBinding || options.idents.length === 0) return;
	const name = options.jsBinding ?? "index.js";
	const binding = (options.esm ? createEsmBinding : createCjsBinding)(options.binaryName, options.packageName, options.idents, options.version);
	try {
		const dest = join(options.outputDir, name);
		debug$7("Writing js binding to:");
		debug$7("  %i", dest);
		await writeFileAsync(dest, binding, "utf-8");
		return {
			kind: "js",
			path: dest
		};
	} catch (e) {
		throw new Error("Failed to write js binding file", { cause: e });
	}
}
async function generateTypeDef(options) {
	if (!await dirExistsAsync(options.typeDefDir)) return {
		exports: [],
		dts: ""
	};
	let header = "";
	let dts = "";
	let exports = [];
	if (!options.noDtsHeader) {
		const dtsHeader = options.dtsHeader ?? options.configDtsHeader;
		if (options.configDtsHeaderFile) try {
			header = await readFileAsync(join(options.cwd, options.configDtsHeaderFile), "utf-8");
		} catch (e) {
			debug$7.warn(`Failed to read dts header file ${options.configDtsHeaderFile}`, e);
		}
		else if (dtsHeader) header = dtsHeader;
		else header = DEFAULT_TYPE_DEF_HEADER;
	}
	const files = await readdirAsync(options.typeDefDir, { withFileTypes: true });
	if (!files.length) {
		debug$7("No type def files found. Skip generating dts file.");
		return {
			exports: [],
			dts: ""
		};
	}
	for (const file of files) {
		if (!file.isFile()) continue;
		const { dts: fileDts, exports: fileExports } = await processTypeDef(join(options.typeDefDir, file.name), options.constEnum ?? true);
		dts += fileDts;
		exports.push(...fileExports);
	}
	if (dts.indexOf("ExternalObject<") > -1) header += `
export declare class ExternalObject<T> {
  readonly '': {
    readonly '': unique symbol
    [K: symbol]: T
  }
}
`;
	if (dts.indexOf("TypedArray") > -1) header += `
export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array
`;
	dts = header + dts;
	return {
		exports,
		dts
	};
}
//#endregion
//#region src/def/create-npm-dirs.ts
var BaseCreateNpmDirsCommand = class extends Command {
	static paths = [["create-npm-dirs"]];
	static usage = Command.Usage({ description: "Create npm package dirs for different platforms" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	dryRun = Option.Boolean("--dry-run", false, { description: "Dry run without touching file system" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			npmDir: this.npmDir,
			dryRun: this.dryRun
		};
	}
};
function applyDefaultCreateNpmDirsOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		npmDir: "npm",
		dryRun: false,
		...options
	};
}
//#endregion
//#region src/api/create-npm-dirs.ts
const require = createRequire(import.meta.url);
const debug$6 = debugFactory("create-npm-dirs");
async function createNpmDirs(userOptions) {
	const options = applyDefaultCreateNpmDirsOptions(userOptions);
	async function mkdirAsync$1(dir) {
		debug$6("Try to create dir: %i", dir);
		if (options.dryRun) return;
		await mkdirAsync(dir, { recursive: true });
	}
	async function writeFileAsync$1(file, content) {
		debug$6("Writing file %i", file);
		if (options.dryRun) {
			debug$6(content);
			return;
		}
		await writeFileAsync(file, content);
	}
	const packageJsonPath = resolve(options.cwd, options.packageJsonPath);
	const npmPath = resolve(options.cwd, options.npmDir);
	debug$6(`Read content from [${options.configPath ?? packageJsonPath}]`);
	const { targets, binaryName, packageName, packageJson } = await readNapiConfig(packageJsonPath, options.configPath ? resolve(options.cwd, options.configPath) : void 0);
	for (const target of targets) {
		const targetDir = join(npmPath, `${target.platformArchABI}`);
		await mkdirAsync$1(targetDir);
		const binaryFileName = target.arch === "wasm32" ? `${binaryName}.${target.platformArchABI}.wasm` : `${binaryName}.${target.platformArchABI}.node`;
		const scopedPackageJson = {
			name: `${packageName}-${target.platformArchABI}`,
			version: packageJson.version,
			cpu: target.arch !== "universal" ? [target.arch] : void 0,
			main: binaryFileName,
			files: [binaryFileName],
			...pick$1(packageJson, "description", "keywords", "author", "authors", "homepage", "license", "engines", "repository", "bugs")
		};
		if (packageJson.publishConfig) scopedPackageJson.publishConfig = pick$1(packageJson.publishConfig, "registry", "access");
		if (target.arch !== "wasm32") scopedPackageJson.os = [target.platform];
		else {
			var _scopedPackageJson$fi, _scopedPackageJson$en;
			const entry = `${binaryName}.wasi.cjs`;
			scopedPackageJson.main = entry;
			scopedPackageJson.browser = `${binaryName}.wasi-browser.js`;
			(_scopedPackageJson$fi = scopedPackageJson.files) === null || _scopedPackageJson$fi === void 0 || _scopedPackageJson$fi.push(entry, scopedPackageJson.browser, `wasi-worker.mjs`, `wasi-worker-browser.mjs`);
			let needRestrictNodeVersion = true;
			if ((_scopedPackageJson$en = scopedPackageJson.engines) === null || _scopedPackageJson$en === void 0 ? void 0 : _scopedPackageJson$en.node) try {
				const { major } = parse$1(scopedPackageJson.engines.node) ?? { major: 0 };
				if (major >= 14) needRestrictNodeVersion = false;
			} catch {}
			if (needRestrictNodeVersion) scopedPackageJson.engines = { node: ">=14.0.0" };
			const emnapiVersion = require("emnapi/package.json").version;
			const wasmRuntime = await fetch(`https://registry.npmjs.org/@napi-rs/wasm-runtime`).then((res) => res.json());
			scopedPackageJson.dependencies = {
				"@napi-rs/wasm-runtime": `^${wasmRuntime["dist-tags"].latest}`,
				"@emnapi/core": emnapiVersion,
				"@emnapi/runtime": emnapiVersion
			};
		}
		if (target.abi === "gnu") scopedPackageJson.libc = ["glibc"];
		else if (target.abi === "musl") scopedPackageJson.libc = ["musl"];
		await writeFileAsync$1(join(targetDir, "package.json"), JSON.stringify(scopedPackageJson, null, 2) + "\n");
		await writeFileAsync$1(join(targetDir, "README.md"), readme(packageName, target));
		debug$6.info(`${packageName} -${target.platformArchABI} created`);
	}
}
function readme(packageName, target) {
	return `# \`${packageName}-${target.platformArchABI}\`

This is the **${target.triple}** binary for \`${packageName}\`
`;
}
//#endregion
//#region src/def/new.ts
var BaseNewCommand = class extends Command {
	static paths = [["new"]];
	static usage = Command.Usage({ description: "Create a new project with pre-configured boilerplate" });
	$$path = Option.String({ required: false });
	$$name = Option.String("--name,-n", { description: "The name of the project, default to the name of the directory if not provided" });
	minNodeApiVersion = Option.String("--min-node-api,-v", "4", {
		validator: typanion.isNumber(),
		description: "The minimum Node-API version to support"
	});
	packageManager = Option.String("--package-manager", "yarn", { description: "The package manager to use. Only support yarn 4.x for now." });
	license = Option.String("--license,-l", "MIT", { description: "License for open-sourced project" });
	targets = Option.Array("--targets,-t", [], { description: "All targets the crate will be compiled for." });
	enableDefaultTargets = Option.Boolean("--enable-default-targets", true, { description: "Whether enable default targets" });
	enableAllTargets = Option.Boolean("--enable-all-targets", false, { description: "Whether enable all targets" });
	enableTypeDef = Option.Boolean("--enable-type-def", true, { description: "Whether enable the `type-def` feature for typescript definitions auto-generation" });
	enableGithubActions = Option.Boolean("--enable-github-actions", true, { description: "Whether generate preconfigured GitHub Actions workflow" });
	testFramework = Option.String("--test-framework", "ava", { description: "The JavaScript test framework to use, only support `ava` for now" });
	dryRun = Option.Boolean("--dry-run", false, { description: "Whether to run the command in dry-run mode" });
	getOptions() {
		return {
			path: this.$$path,
			name: this.$$name,
			minNodeApiVersion: this.minNodeApiVersion,
			packageManager: this.packageManager,
			license: this.license,
			targets: this.targets,
			enableDefaultTargets: this.enableDefaultTargets,
			enableAllTargets: this.enableAllTargets,
			enableTypeDef: this.enableTypeDef,
			enableGithubActions: this.enableGithubActions,
			testFramework: this.testFramework,
			dryRun: this.dryRun
		};
	}
};
function applyDefaultNewOptions(options) {
	return {
		minNodeApiVersion: 4,
		packageManager: "yarn",
		license: "MIT",
		targets: [],
		enableDefaultTargets: true,
		enableAllTargets: false,
		enableTypeDef: true,
		enableGithubActions: true,
		testFramework: "ava",
		dryRun: false,
		...options
	};
}
//#endregion
//#region ../node_modules/@std/toml/stringify.js
function joinKeys(keys) {
	return keys.map((str) => {
		return str.length === 0 || str.match(/[^A-Za-z0-9_-]/) ? JSON.stringify(str) : str;
	}).join(".");
}
var Dumper = class {
	maxPad = 0;
	srcObject;
	output = [];
	#arrayTypeCache = /* @__PURE__ */ new Map();
	constructor(srcObjc) {
		this.srcObject = srcObjc;
	}
	dump(fmtOptions = {}) {
		this.output = this.#printObject(this.srcObject);
		this.output = this.#format(fmtOptions);
		return this.output;
	}
	#printObject(obj, keys = []) {
		const out = [];
		const props = Object.keys(obj);
		const inlineProps = [];
		const multilineProps = [];
		for (const prop of props) if (this.#isSimplySerializable(obj[prop])) inlineProps.push(prop);
		else multilineProps.push(prop);
		const sortedProps = inlineProps.concat(multilineProps);
		for (const prop of sortedProps) {
			const value = obj[prop];
			if (value instanceof Date) out.push(this.#dateDeclaration([prop], value));
			else if (typeof value === "string" || value instanceof RegExp) out.push(this.#strDeclaration([prop], value.toString()));
			else if (typeof value === "number") out.push(this.#numberDeclaration([prop], value));
			else if (typeof value === "boolean") out.push(this.#boolDeclaration([prop], value));
			else if (value instanceof Array) {
				const arrayType = this.#getTypeOfArray(value);
				if (arrayType === "ONLY_PRIMITIVE") out.push(this.#arrayDeclaration([prop], value));
				else if (arrayType === "ONLY_OBJECT_EXCLUDING_ARRAY") for (let i = 0; i < value.length; i++) {
					out.push("");
					out.push(this.#headerGroup([...keys, prop]));
					out.push(...this.#printObject(value[i], [...keys, prop]));
				}
				else {
					const str = value.map((x) => this.#printAsInlineValue(x)).join(",");
					out.push(`${this.#declaration([prop])}[${str}]`);
				}
			} else if (typeof value === "object") {
				out.push("");
				out.push(this.#header([...keys, prop]));
				if (value) {
					const toParse = value;
					out.push(...this.#printObject(toParse, [...keys, prop]));
				}
			}
		}
		out.push("");
		return out;
	}
	#isPrimitive(value) {
		return value instanceof Date || value instanceof RegExp || [
			"string",
			"number",
			"boolean"
		].includes(typeof value);
	}
	#getTypeOfArray(arr) {
		if (this.#arrayTypeCache.has(arr)) return this.#arrayTypeCache.get(arr);
		const type = this.#doGetTypeOfArray(arr);
		this.#arrayTypeCache.set(arr, type);
		return type;
	}
	#doGetTypeOfArray(arr) {
		if (!arr.length) return "ONLY_PRIMITIVE";
		const onlyPrimitive = this.#isPrimitive(arr[0]);
		if (arr[0] instanceof Array) return "MIXED";
		for (let i = 1; i < arr.length; i++) if (onlyPrimitive !== this.#isPrimitive(arr[i]) || arr[i] instanceof Array) return "MIXED";
		return onlyPrimitive ? "ONLY_PRIMITIVE" : "ONLY_OBJECT_EXCLUDING_ARRAY";
	}
	#printAsInlineValue(value) {
		if (value instanceof Date) return `"${this.#printDate(value)}"`;
		else if (typeof value === "string" || value instanceof RegExp) return JSON.stringify(value.toString());
		else if (typeof value === "number") return value;
		else if (typeof value === "boolean") return value.toString();
		else if (value instanceof Array) return `[${value.map((x) => this.#printAsInlineValue(x)).join(",")}]`;
		else if (typeof value === "object") {
			if (!value) throw new Error("Should never reach");
			return `{${Object.keys(value).map((key) => {
				return `${joinKeys([key])} = ${this.#printAsInlineValue(value[key])}`;
			}).join(",")}}`;
		}
		throw new Error("Should never reach");
	}
	#isSimplySerializable(value) {
		return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof RegExp || value instanceof Date || value instanceof Array && this.#getTypeOfArray(value) !== "ONLY_OBJECT_EXCLUDING_ARRAY";
	}
	#header(keys) {
		return `[${joinKeys(keys)}]`;
	}
	#headerGroup(keys) {
		return `[[${joinKeys(keys)}]]`;
	}
	#declaration(keys) {
		const title = joinKeys(keys);
		if (title.length > this.maxPad) this.maxPad = title.length;
		return `${title} = `;
	}
	#arrayDeclaration(keys, value) {
		return `${this.#declaration(keys)}${JSON.stringify(value)}`;
	}
	#strDeclaration(keys, value) {
		return `${this.#declaration(keys)}${JSON.stringify(value)}`;
	}
	#numberDeclaration(keys, value) {
		if (Number.isNaN(value)) return `${this.#declaration(keys)}nan`;
		switch (value) {
			case Infinity: return `${this.#declaration(keys)}inf`;
			case -Infinity: return `${this.#declaration(keys)}-inf`;
			default: return `${this.#declaration(keys)}${value}`;
		}
	}
	#boolDeclaration(keys, value) {
		return `${this.#declaration(keys)}${value}`;
	}
	#printDate(value) {
		function dtPad(v, lPad = 2) {
			return v.padStart(lPad, "0");
		}
		const m = dtPad((value.getUTCMonth() + 1).toString());
		const d = dtPad(value.getUTCDate().toString());
		const h = dtPad(value.getUTCHours().toString());
		const min = dtPad(value.getUTCMinutes().toString());
		const s = dtPad(value.getUTCSeconds().toString());
		const ms = dtPad(value.getUTCMilliseconds().toString(), 3);
		return `${value.getUTCFullYear()}-${m}-${d}T${h}:${min}:${s}.${ms}`;
	}
	#dateDeclaration(keys, value) {
		return `${this.#declaration(keys)}${this.#printDate(value)}`;
	}
	#format(options = {}) {
		const { keyAlignment = false } = options;
		const rDeclaration = /^(\".*\"|[^=]*)\s=/;
		const out = [];
		for (let i = 0; i < this.output.length; i++) {
			const l = this.output[i];
			if (l[0] === "[" && l[1] !== "[") {
				var _this$output;
				if (this.output[i + 1] === "" && ((_this$output = this.output[i + 2]) === null || _this$output === void 0 ? void 0 : _this$output.slice(0, l.length)) === l.slice(0, -1) + ".") {
					i += 1;
					continue;
				}
				out.push(l);
			} else if (keyAlignment) {
				const m = rDeclaration.exec(l);
				if (m && m[1]) out.push(l.replace(m[1], m[1].padEnd(this.maxPad)));
				else out.push(l);
			} else out.push(l);
		}
		const cleanedOutput = [];
		for (let i = 0; i < out.length; i++) {
			const l = out[i];
			if (!(l === "" && out[i + 1] === "")) cleanedOutput.push(l);
		}
		return cleanedOutput;
	}
};
/**
* Converts an object to a {@link https://toml.io | TOML} string.
*
* @example Usage
* ```ts
* import { stringify } from "@std/toml/stringify";
* import { assertEquals } from "@std/assert";
*
* const obj = {
*   title: "TOML Example",
*   owner: {
*     name: "Bob",
*     bio: "Bob is a cool guy",
*  }
* };
* const tomlString = stringify(obj);
* assertEquals(tomlString, `title = "TOML Example"\n\n[owner]\nname = "Bob"\nbio = "Bob is a cool guy"\n`);
* ```
* @param obj Source object
* @param options Options for stringifying.
* @returns TOML string
*/ function stringify(obj, options) {
	return new Dumper(obj).dump(options).join("\n");
}
//#endregion
//#region ../node_modules/@jsr/std__collections/deep_merge.js
/** Default merging options - cached to avoid object allocation on each call */ const DEFAULT_OPTIONS = {
	arrays: "merge",
	sets: "merge",
	maps: "merge"
};
function deepMerge(record, other, options) {
	return deepMergeInternal(record, other, /* @__PURE__ */ new Set(), options ?? DEFAULT_OPTIONS);
}
function deepMergeInternal(record, other, seen, options) {
	const result = {};
	const keys = new Set([...getKeys(record), ...getKeys(other)]);
	for (const key of keys) {
		if (key === "__proto__") continue;
		const a = record[key];
		if (!Object.hasOwn(other, key)) {
			result[key] = a;
			continue;
		}
		const b = other[key];
		if (isNonNullObject(a) && isNonNullObject(b) && !seen.has(a) && !seen.has(b)) {
			seen.add(a);
			seen.add(b);
			result[key] = mergeObjects(a, b, seen, options);
			continue;
		}
		result[key] = b;
	}
	return result;
}
function mergeObjects(left, right, seen, options) {
	if (isMergeable(left) && isMergeable(right)) return deepMergeInternal(left, right, seen, options);
	if (isIterable(left) && isIterable(right)) {
		if (Array.isArray(left) && Array.isArray(right)) {
			if (options.arrays === "merge") return left.concat(right);
			return right;
		}
		if (left instanceof Map && right instanceof Map) {
			if (options.maps === "merge") {
				const result = new Map(left);
				for (const [k, v] of right) result.set(k, v);
				return result;
			}
			return right;
		}
		if (left instanceof Set && right instanceof Set) {
			if (options.sets === "merge") {
				const result = new Set(left);
				for (const v of right) result.add(v);
				return result;
			}
			return right;
		}
	}
	return right;
}
/**
* Test whether a value is mergeable or not
* Builtins that look like objects, null and user defined classes
* are not considered mergeable (it means that reference will be copied)
*/ function isMergeable(value) {
	return Object.getPrototypeOf(value) === Object.prototype;
}
function isIterable(value) {
	return typeof value[Symbol.iterator] === "function";
}
function isNonNullObject(value) {
	return value !== null && typeof value === "object";
}
function getKeys(record) {
	const keys = Object.keys(record);
	const symbols = Object.getOwnPropertySymbols(record);
	if (symbols.length === 0) return keys;
	for (const sym of symbols) if (Object.prototype.propertyIsEnumerable.call(record, sym)) keys.push(sym);
	return keys;
}
//#endregion
//#region ../node_modules/@std/toml/_parser.js
/**
* Copy of `import { isLeap } from "@std/datetime";` because it cannot be impoted as long as it is unstable.
*/ function isLeap(yearNumber) {
	return yearNumber % 4 === 0 && yearNumber % 100 !== 0 || yearNumber % 400 === 0;
}
var Scanner = class {
	#whitespace = /[ \t]/;
	#position = 0;
	#source;
	constructor(source) {
		this.#source = source;
	}
	get position() {
		return this.#position;
	}
	get source() {
		return this.#source;
	}
	/**
	* Get current character
	* @param index - relative index from current position
	*/ char(index = 0) {
		return this.#source[this.#position + index] ?? "";
	}
	/**
	* Get sliced string
	* @param start - start position relative from current position
	* @param end - end position relative from current position
	*/ slice(start, end) {
		return this.#source.slice(this.#position + start, this.#position + end);
	}
	/**
	* Move position to next
	*/ next(count = 1) {
		this.#position += count;
	}
	skipWhitespaces() {
		while (this.#whitespace.test(this.char()) && !this.eof()) this.next();
		if (!this.isCurrentCharEOL() && /\s/.test(this.char())) {
			const escaped = "\\u" + this.char().charCodeAt(0).toString(16);
			const position = this.#position;
			throw new SyntaxError(`Cannot parse the TOML: It contains invalid whitespace at position '${position}': \`${escaped}\``);
		}
	}
	nextUntilChar(options = { skipComments: true }) {
		while (!this.eof()) {
			const char = this.char();
			if (this.#whitespace.test(char) || this.isCurrentCharEOL()) this.next();
			else if (options.skipComments && this.char() === "#") while (!this.isCurrentCharEOL() && !this.eof()) this.next();
			else break;
		}
	}
	/**
	* Position reached EOF or not
	*/ eof() {
		return this.#position >= this.#source.length;
	}
	isCurrentCharEOL() {
		return this.char() === "\n" || this.startsWith("\r\n");
	}
	startsWith(searchString) {
		return this.#source.startsWith(searchString, this.#position);
	}
	match(regExp) {
		if (!regExp.sticky) throw new Error(`RegExp ${regExp} does not have a sticky 'y' flag`);
		regExp.lastIndex = this.#position;
		return this.#source.match(regExp);
	}
};
function success(body) {
	return {
		ok: true,
		body
	};
}
function failure() {
	return { ok: false };
}
/**
* Creates a nested object from the keys and values.
*
* e.g. `unflat(["a", "b", "c"], 1)` returns `{ a: { b: { c: 1 } } }`
*/ function unflat(keys, values = { __proto__: null }) {
	return keys.reduceRight((acc, key) => ({ [key]: acc }), values);
}
function isObject(value) {
	return typeof value === "object" && value !== null;
}
function getTargetValue(target, keys) {
	const key = keys[0];
	if (!key) throw new Error("Cannot parse the TOML: key length is not a positive number");
	return target[key];
}
function deepAssignTable(target, table) {
	const { keys, type, value } = table;
	const currentValue = getTargetValue(target, keys);
	if (currentValue === void 0) return Object.assign(target, unflat(keys, value));
	if (Array.isArray(currentValue)) {
		deepAssign(currentValue.at(-1), {
			type,
			keys: keys.slice(1),
			value
		});
		return target;
	}
	if (isObject(currentValue)) {
		deepAssign(currentValue, {
			type,
			keys: keys.slice(1),
			value
		});
		return target;
	}
	throw new Error("Unexpected assign");
}
function deepAssignTableArray(target, table) {
	const { type, keys, value } = table;
	const currentValue = getTargetValue(target, keys);
	if (currentValue === void 0) return Object.assign(target, unflat(keys, [value]));
	if (Array.isArray(currentValue)) {
		if (table.keys.length === 1) currentValue.push(value);
		else deepAssign(currentValue.at(-1), {
			type: table.type,
			keys: table.keys.slice(1),
			value: table.value
		});
		return target;
	}
	if (isObject(currentValue)) {
		deepAssign(currentValue, {
			type,
			keys: keys.slice(1),
			value
		});
		return target;
	}
	throw new Error("Unexpected assign");
}
function deepAssign(target, body) {
	switch (body.type) {
		case "Block": return deepMerge(target, body.value);
		case "Table": return deepAssignTable(target, body);
		case "TableArray": return deepAssignTableArray(target, body);
	}
}
function or(parsers) {
	return (scanner) => {
		for (const parse of parsers) {
			const result = parse(scanner);
			if (result.ok) return result;
		}
		return failure();
	};
}
/** Join the parse results of the given parser into an array.
*
* If the parser fails at the first attempt, it will return an empty array.
*/ function join$1(parser, separator) {
	const Separator = character(separator);
	return (scanner) => {
		const out = [];
		const first = parser(scanner);
		if (!first.ok) return success(out);
		out.push(first.body);
		while (!scanner.eof()) {
			if (!Separator(scanner).ok) break;
			const result = parser(scanner);
			if (!result.ok) throw new SyntaxError(`Invalid token after "${separator}"`);
			out.push(result.body);
		}
		return success(out);
	};
}
/** Join the parse results of the given parser into an array.
*
* This requires the parser to succeed at least once.
*/ function join1(parser, separator) {
	const Separator = character(separator);
	return (scanner) => {
		const first = parser(scanner);
		if (!first.ok) return failure();
		const out = [first.body];
		while (!scanner.eof()) {
			if (!Separator(scanner).ok) break;
			const result = parser(scanner);
			if (!result.ok) throw new SyntaxError(`Invalid token after "${separator}"`);
			out.push(result.body);
		}
		return success(out);
	};
}
function kv(keyParser, separator, valueParser) {
	const Separator = character(separator);
	return (scanner) => {
		const position = scanner.position;
		const key = keyParser(scanner);
		if (!key.ok) return failure();
		if (!Separator(scanner).ok) throw new SyntaxError(`key/value pair doesn't have "${separator}"`);
		const value = valueParser(scanner);
		if (!value.ok) {
			const lineEndIndex = scanner.source.indexOf("\n", scanner.position);
			const endPosition = lineEndIndex > 0 ? lineEndIndex : scanner.source.length;
			const line = scanner.source.slice(position, endPosition);
			throw new SyntaxError(`Cannot parse value on line '${line}'`);
		}
		return success(unflat(key.body, value.body));
	};
}
function merge$1(parser) {
	return (scanner) => {
		const result = parser(scanner);
		if (!result.ok) return failure();
		let body = { __proto__: null };
		for (const record of result.body) if (typeof record === "object" && record !== null) body = deepMerge(body, record);
		return success(body);
	};
}
function repeat(parser) {
	return (scanner) => {
		const body = [];
		while (!scanner.eof()) {
			const result = parser(scanner);
			if (!result.ok) break;
			body.push(result.body);
			scanner.nextUntilChar();
		}
		if (body.length === 0) return failure();
		return success(body);
	};
}
function surround(left, parser, right) {
	const Left = character(left);
	const Right = character(right);
	return (scanner) => {
		if (!Left(scanner).ok) return failure();
		const result = parser(scanner);
		if (!result.ok) throw new SyntaxError(`Invalid token after "${left}"`);
		if (!Right(scanner).ok) throw new SyntaxError(`Not closed by "${right}" after started with "${left}"`);
		return success(result.body);
	};
}
function character(str) {
	return (scanner) => {
		scanner.skipWhitespaces();
		if (!scanner.startsWith(str)) return failure();
		scanner.next(str.length);
		scanner.skipWhitespaces();
		return success(void 0);
	};
}
const BARE_KEY_REGEXP = /[A-Za-z0-9_-]+/y;
function bareKey(scanner) {
	var _scanner$match;
	scanner.skipWhitespaces();
	const key = (_scanner$match = scanner.match(BARE_KEY_REGEXP)) === null || _scanner$match === void 0 ? void 0 : _scanner$match[0];
	if (!key) return failure();
	scanner.next(key.length);
	return success(key);
}
function escapeSequence(scanner) {
	if (scanner.char() !== "\\") return failure();
	scanner.next();
	switch (scanner.char()) {
		case "b":
			scanner.next();
			return success("\b");
		case "t":
			scanner.next();
			return success("	");
		case "n":
			scanner.next();
			return success("\n");
		case "f":
			scanner.next();
			return success("\f");
		case "r":
			scanner.next();
			return success("\r");
		case "u":
		case "U": {
			const codePointLen = scanner.char() === "u" ? 4 : 6;
			const codePoint = parseInt("0x" + scanner.slice(1, 1 + codePointLen), 16);
			const str = String.fromCodePoint(codePoint);
			scanner.next(codePointLen + 1);
			return success(str);
		}
		case "\"":
			scanner.next();
			return success("\"");
		case "\\":
			scanner.next();
			return success("\\");
		default: throw new SyntaxError(`Invalid escape sequence: \\${scanner.char()}`);
	}
}
function basicString(scanner) {
	scanner.skipWhitespaces();
	if (scanner.char() !== "\"") return failure();
	scanner.next();
	const acc = [];
	while (scanner.char() !== "\"" && !scanner.eof()) {
		if (scanner.char() === "\n") throw new SyntaxError("Single-line string cannot contain EOL");
		const escapedChar = escapeSequence(scanner);
		if (escapedChar.ok) acc.push(escapedChar.body);
		else {
			acc.push(scanner.char());
			scanner.next();
		}
	}
	if (scanner.eof()) throw new SyntaxError(`Single-line string is not closed:\n${acc.join("")}`);
	scanner.next();
	return success(acc.join(""));
}
function literalString(scanner) {
	scanner.skipWhitespaces();
	if (scanner.char() !== "'") return failure();
	scanner.next();
	const acc = [];
	while (scanner.char() !== "'" && !scanner.eof()) {
		if (scanner.char() === "\n") throw new SyntaxError("Single-line string cannot contain EOL");
		acc.push(scanner.char());
		scanner.next();
	}
	if (scanner.eof()) throw new SyntaxError(`Single-line string is not closed:\n${acc.join("")}`);
	scanner.next();
	return success(acc.join(""));
}
function multilineBasicString(scanner) {
	scanner.skipWhitespaces();
	if (!scanner.startsWith("\"\"\"")) return failure();
	scanner.next(3);
	if (scanner.char() === "\n") scanner.next();
	else if (scanner.startsWith("\r\n")) scanner.next(2);
	const acc = [];
	while (!scanner.startsWith("\"\"\"") && !scanner.eof()) {
		if (scanner.startsWith("\\\n")) {
			scanner.next();
			scanner.nextUntilChar({ skipComments: false });
			continue;
		} else if (scanner.startsWith("\\\r\n")) {
			scanner.next();
			scanner.nextUntilChar({ skipComments: false });
			continue;
		}
		const escapedChar = escapeSequence(scanner);
		if (escapedChar.ok) acc.push(escapedChar.body);
		else {
			acc.push(scanner.char());
			scanner.next();
		}
	}
	if (scanner.eof()) throw new SyntaxError(`Multi-line string is not closed:\n${acc.join("")}`);
	if (scanner.char(3) === "\"") {
		acc.push("\"");
		scanner.next();
	}
	scanner.next(3);
	return success(acc.join(""));
}
function multilineLiteralString(scanner) {
	scanner.skipWhitespaces();
	if (!scanner.startsWith("'''")) return failure();
	scanner.next(3);
	if (scanner.char() === "\n") scanner.next();
	else if (scanner.startsWith("\r\n")) scanner.next(2);
	const acc = [];
	while (!scanner.startsWith("'''") && !scanner.eof()) {
		acc.push(scanner.char());
		scanner.next();
	}
	if (scanner.eof()) throw new SyntaxError(`Multi-line string is not closed:\n${acc.join("")}`);
	if (scanner.char(3) === "'") {
		acc.push("'");
		scanner.next();
	}
	scanner.next(3);
	return success(acc.join(""));
}
const BOOLEAN_REGEXP = /(?:true|false)\b/y;
function boolean(scanner) {
	scanner.skipWhitespaces();
	const match = scanner.match(BOOLEAN_REGEXP);
	if (!match) return failure();
	const string = match[0];
	scanner.next(string.length);
	return success(string === "true");
}
const INFINITY_MAP = new Map([
	["inf", Infinity],
	["+inf", Infinity],
	["-inf", -Infinity]
]);
const INFINITY_REGEXP = /[+-]?inf\b/y;
function infinity(scanner) {
	scanner.skipWhitespaces();
	const match = scanner.match(INFINITY_REGEXP);
	if (!match) return failure();
	const string = match[0];
	scanner.next(string.length);
	return success(INFINITY_MAP.get(string));
}
const NAN_REGEXP = /[+-]?nan\b/y;
function nan(scanner) {
	scanner.skipWhitespaces();
	const match = scanner.match(NAN_REGEXP);
	if (!match) return failure();
	const string = match[0];
	scanner.next(string.length);
	return success(NaN);
}
const dottedKey = join1(or([
	bareKey,
	basicString,
	literalString
]), ".");
const BINARY_REGEXP = /0b[01]+(?:_[01]+)*\b/y;
function binary(scanner) {
	var _scanner$match2;
	scanner.skipWhitespaces();
	const match = (_scanner$match2 = scanner.match(BINARY_REGEXP)) === null || _scanner$match2 === void 0 ? void 0 : _scanner$match2[0];
	if (!match) return failure();
	scanner.next(match.length);
	const value = match.slice(2).replaceAll("_", "");
	const number = parseInt(value, 2);
	return isNaN(number) ? failure() : success(number);
}
const OCTAL_REGEXP = /0o[0-7]+(?:_[0-7]+)*\b/y;
function octal(scanner) {
	var _scanner$match3;
	scanner.skipWhitespaces();
	const match = (_scanner$match3 = scanner.match(OCTAL_REGEXP)) === null || _scanner$match3 === void 0 ? void 0 : _scanner$match3[0];
	if (!match) return failure();
	scanner.next(match.length);
	const value = match.slice(2).replaceAll("_", "");
	const number = parseInt(value, 8);
	return isNaN(number) ? failure() : success(number);
}
const HEX_REGEXP = /0x[0-9a-f]+(?:_[0-9a-f]+)*\b/iy;
function hex(scanner) {
	var _scanner$match4;
	scanner.skipWhitespaces();
	const match = (_scanner$match4 = scanner.match(HEX_REGEXP)) === null || _scanner$match4 === void 0 ? void 0 : _scanner$match4[0];
	if (!match) return failure();
	scanner.next(match.length);
	const value = match.slice(2).replaceAll("_", "");
	const number = parseInt(value, 16);
	return isNaN(number) ? failure() : success(number);
}
const INTEGER_REGEXP = /[+-]?(?:0|[1-9][0-9]*(?:_[0-9]+)*)\b/y;
function integer(scanner) {
	var _scanner$match5;
	scanner.skipWhitespaces();
	const match = (_scanner$match5 = scanner.match(INTEGER_REGEXP)) === null || _scanner$match5 === void 0 ? void 0 : _scanner$match5[0];
	if (!match) return failure();
	scanner.next(match.length);
	const value = match.replaceAll("_", "");
	return success(parseInt(value, 10));
}
const FLOAT_REGEXP = /[+-]?(?:0|[1-9][0-9]*(?:_[0-9]+)*)(?:\.[0-9]+(?:_[0-9]+)*)?(?:e[+-]?[0-9]+(?:_[0-9]+)*)?\b/iy;
function float(scanner) {
	var _scanner$match6;
	scanner.skipWhitespaces();
	const match = (_scanner$match6 = scanner.match(FLOAT_REGEXP)) === null || _scanner$match6 === void 0 ? void 0 : _scanner$match6[0];
	if (!match) return failure();
	scanner.next(match.length);
	const value = match.replaceAll("_", "");
	const float = parseFloat(value);
	if (isNaN(float)) return failure();
	return success(float);
}
const DATE_TIME_REGEXP = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?:[ 0-9TZ.:+-]+)?\b/y;
function dateTime(scanner) {
	scanner.skipWhitespaces();
	const match = scanner.match(DATE_TIME_REGEXP);
	if (!match) return failure();
	const string = match[0];
	scanner.next(string.length);
	const groups = match.groups;
	if (groups.month == "02") {
		const days = parseInt(groups.day);
		if (days > 29) throw new SyntaxError(`Invalid date string "${match}"`);
		const year = parseInt(groups.year);
		if (days > 28 && !isLeap(year)) throw new SyntaxError(`Invalid date string "${match}"`);
	}
	const date = new Date(string.trim());
	if (isNaN(date.getTime())) throw new SyntaxError(`Invalid date string "${match}"`);
	return success(date);
}
const LOCAL_TIME_REGEXP = /(\d{2}):(\d{2}):(\d{2})(?:\.[0-9]+)?\b/y;
function localTime(scanner) {
	var _scanner$match7;
	scanner.skipWhitespaces();
	const match = (_scanner$match7 = scanner.match(LOCAL_TIME_REGEXP)) === null || _scanner$match7 === void 0 ? void 0 : _scanner$match7[0];
	if (!match) return failure();
	scanner.next(match.length);
	return success(match);
}
function arrayValue(scanner) {
	scanner.skipWhitespaces();
	if (scanner.char() !== "[") return failure();
	scanner.next();
	const array = [];
	while (!scanner.eof()) {
		scanner.nextUntilChar();
		const result = value(scanner);
		if (!result.ok) break;
		array.push(result.body);
		scanner.skipWhitespaces();
		if (scanner.char() !== ",") break;
		scanner.next();
	}
	scanner.nextUntilChar();
	if (scanner.char() !== "]") throw new SyntaxError("Array is not closed");
	scanner.next();
	return success(array);
}
function inlineTable(scanner) {
	scanner.nextUntilChar();
	if (scanner.char(1) === "}") {
		scanner.next(2);
		return success({ __proto__: null });
	}
	const pairs = surround("{", join$1(pair, ","), "}")(scanner);
	if (!pairs.ok) return failure();
	let table = { __proto__: null };
	for (const pair of pairs.body) table = deepMerge(table, pair);
	return success(table);
}
const value = or([
	multilineBasicString,
	multilineLiteralString,
	basicString,
	literalString,
	boolean,
	infinity,
	nan,
	dateTime,
	localTime,
	binary,
	octal,
	hex,
	float,
	integer,
	arrayValue,
	inlineTable
]);
const pair = kv(dottedKey, "=", value);
function block(scanner) {
	scanner.nextUntilChar();
	const result = merge$1(repeat(pair))(scanner);
	if (result.ok) return success({
		type: "Block",
		value: result.body
	});
	return failure();
}
const tableHeader = surround("[", dottedKey, "]");
function table(scanner) {
	scanner.nextUntilChar();
	const header = tableHeader(scanner);
	if (!header.ok) return failure();
	scanner.nextUntilChar();
	const b = block(scanner);
	return success({
		type: "Table",
		keys: header.body,
		value: b.ok ? b.body.value : { __proto__: null }
	});
}
const tableArrayHeader = surround("[[", dottedKey, "]]");
function tableArray(scanner) {
	scanner.nextUntilChar();
	const header = tableArrayHeader(scanner);
	if (!header.ok) return failure();
	scanner.nextUntilChar();
	const b = block(scanner);
	return success({
		type: "TableArray",
		keys: header.body,
		value: b.ok ? b.body.value : { __proto__: null }
	});
}
function toml(scanner) {
	const blocks = repeat(or([
		block,
		tableArray,
		table
	]))(scanner);
	if (!blocks.ok) return success({ __proto__: null });
	return success(blocks.body.reduce(deepAssign, { __proto__: null }));
}
function createParseErrorMessage(scanner, message) {
	var _lines$at;
	const lines = scanner.source.slice(0, scanner.position).split("\n");
	return `Parse error on line ${lines.length}, column ${((_lines$at = lines.at(-1)) === null || _lines$at === void 0 ? void 0 : _lines$at.length) ?? 0}: ${message}`;
}
function parserFactory(parser) {
	return (tomlString) => {
		const scanner = new Scanner(tomlString);
		try {
			const result = parser(scanner);
			if (result.ok && scanner.eof()) return result.body;
			const message = `Unexpected character: "${scanner.char()}"`;
			throw new SyntaxError(createParseErrorMessage(scanner, message));
		} catch (error) {
			if (error instanceof Error) throw new SyntaxError(createParseErrorMessage(scanner, error.message));
			throw new SyntaxError(createParseErrorMessage(scanner, "Invalid error type caught"));
		}
	};
}
//#endregion
//#region ../node_modules/@std/toml/parse.js
/**
* Parses a {@link https://toml.io | TOML} string into an object.
*
* @example Usage
* ```ts
* import { parse } from "@std/toml/parse";
* import { assertEquals } from "@std/assert";
*
* const tomlString = `title = "TOML Example"
* [owner]
* name = "Alice"
* bio = "Alice is a programmer."`;
*
* const obj = parse(tomlString);
* assertEquals(obj, { title: "TOML Example", owner: { name: "Alice", bio: "Alice is a programmer." } });
* ```
* @param tomlString TOML string to be parsed.
* @returns The parsed JS object.
*/ function parse$2(tomlString) {
	return parserFactory(toml)(tomlString);
}
//#endregion
//#region ../node_modules/empathic/resolve.mjs
/**
* Resolve an absolute path from {@link root}, but only
* if {@link input} isn't already absolute.
*
* @param input The path to resolve.
* @param root The base path; default = process.cwd()
* @returns The resolved absolute path.
*/
function absolute(input, root) {
	return isAbsolute(input) ? input : resolve(root || ".", input);
}
//#endregion
//#region ../node_modules/empathic/walk.mjs
/**
* Get all parent directories of {@link base}.
* Stops after {@link Options['last']} is processed.
*
* @returns An array of absolute paths of all parent directories.
*/
function up(base, options) {
	let { last, cwd } = options || {};
	let tmp = absolute(base, cwd);
	let root = absolute(last || "/", cwd);
	let prev, arr = [];
	while (prev !== root) {
		arr.push(tmp);
		tmp = dirname(prev = tmp);
		if (tmp === prev) break;
	}
	return arr;
}
//#endregion
//#region ../node_modules/empathic/find.mjs
/**
* Find a directory by name, walking parent directories until found.
*
* > [NOTE]
* > This function only returns a value for directory matches.
* > A file match with the same name will be ignored.
*
* @param name The directory name to find.
* @returns The absolute path to the file, if found.
*/
function dir(name, options) {
	let dir, tmp;
	for (dir of up(options && options.cwd || "", options)) try {
		tmp = join(dir, name);
		if (statSync(tmp).isDirectory()) return tmp;
	} catch {}
}
//#endregion
//#region src/def/rename.ts
var BaseRenameCommand = class extends Command {
	static paths = [["rename"]];
	static usage = Command.Usage({ description: "Rename the NAPI-RS project" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	$$name = Option.String("--name,-n", { description: "The new name of the project" });
	binaryName = Option.String("--binary-name,-b", { description: "The new binary name *.node files" });
	packageName = Option.String("--package-name", { description: "The new package name of the project" });
	manifestPath = Option.String("--manifest-path", "Cargo.toml", { description: "Path to `Cargo.toml`" });
	repository = Option.String("--repository", { description: "The new repository of the project" });
	description = Option.String("--description", { description: "The new description of the project" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			npmDir: this.npmDir,
			name: this.$$name,
			binaryName: this.binaryName,
			packageName: this.packageName,
			manifestPath: this.manifestPath,
			repository: this.repository,
			description: this.description
		};
	}
};
function applyDefaultRenameOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		npmDir: "npm",
		manifestPath: "Cargo.toml",
		...options
	};
}
//#endregion
//#region src/api/rename.ts
async function renameProject(userOptions) {
	const options = applyDefaultRenameOptions(userOptions);
	const oldName = (await readConfig(options)).binaryName;
	const packageJsonPath = resolve(options.cwd, options.packageJsonPath);
	const cargoTomlPath = resolve(options.cwd, options.manifestPath);
	const packageJsonContent = await readFileAsync(packageJsonPath, "utf8");
	const packageJsonData = JSON.parse(packageJsonContent);
	merge(merge(packageJsonData, omitBy(pick(options, [
		"name",
		"description",
		"author",
		"license"
	]), isNil)), { napi: omitBy({
		binaryName: options.binaryName,
		packageName: options.packageName
	}, isNil) });
	if (options.configPath) {
		const configPath = resolve(options.cwd, options.configPath);
		const configContent = await readFileAsync(configPath, "utf8");
		const configData = JSON.parse(configContent);
		configData.binaryName = options.binaryName;
		configData.packageName = options.packageName;
		await writeFileAsync(configPath, JSON.stringify(configData, null, 2));
	}
	await writeFileAsync(packageJsonPath, JSON.stringify(packageJsonData, null, 2));
	const cargoToml = parse$2(await readFileAsync(cargoTomlPath, "utf8"));
	if (cargoToml.package && options.binaryName) {
		const sanitizedName = options.binaryName.replace("@", "").replace("/", "_").replace(/-/g, "_").toLowerCase();
		cargoToml.package.name = sanitizedName;
	}
	await writeFileAsync(cargoTomlPath, stringify(cargoToml));
	if (oldName !== options.binaryName) {
		const githubActionsPath = dir(".github", { cwd: options.cwd });
		if (githubActionsPath) {
			const githubActionsCIYmlPath = join(githubActionsPath, "workflows", "CI.yml");
			if (existsSync(githubActionsCIYmlPath)) {
				var _githubActionsData$en;
				const githubActionsData = load(await readFileAsync(githubActionsCIYmlPath, "utf8"));
				if ((_githubActionsData$en = githubActionsData.env) === null || _githubActionsData$en === void 0 ? void 0 : _githubActionsData$en.APP_NAME) {
					githubActionsData.env.APP_NAME = options.binaryName;
					await writeFileAsync(githubActionsCIYmlPath, dump(githubActionsData, {
						lineWidth: -1,
						noRefs: true,
						sortKeys: false
					}));
				}
			}
		}
		const oldWasiBrowserBindingPath = join(options.cwd, `${oldName}.wasi-browser.js`);
		if (existsSync(oldWasiBrowserBindingPath)) await rename(oldWasiBrowserBindingPath, join(options.cwd, `${options.binaryName}.wasi-browser.js`));
		const oldWasiBindingPath = join(options.cwd, `${oldName}.wasi.cjs`);
		if (existsSync(oldWasiBindingPath)) await rename(oldWasiBindingPath, join(options.cwd, `${options.binaryName}.wasi.cjs`));
		const gitAttributesPath = join(options.cwd, ".gitattributes");
		if (existsSync(gitAttributesPath)) await writeFileAsync(gitAttributesPath, (await readFileAsync(gitAttributesPath, "utf8")).split("\n").map((line) => {
			return line.replace(`${oldName}.wasi-browser.js`, `${options.binaryName}.wasi-browser.js`).replace(`${oldName}.wasi.cjs`, `${options.binaryName}.wasi.cjs`);
		}).join("\n"));
	}
}
//#endregion
//#region src/api/new.ts
const debug$5 = debugFactory("new");
const TEMPLATE_REPOS = {
	yarn: "https://github.com/napi-rs/package-template",
	pnpm: "https://github.com/napi-rs/package-template-pnpm"
};
async function checkGitCommand() {
	try {
		await new Promise((resolve) => {
			const cp = exec("git --version");
			cp.on("error", () => {
				resolve(false);
			});
			cp.on("exit", (code) => {
				if (code === 0) resolve(true);
				else resolve(false);
			});
		});
		return true;
	} catch {
		return false;
	}
}
async function ensureCacheDir(packageManager) {
	const cacheDir = path.join(homedir(), ".napi-rs", "template", packageManager);
	await mkdirAsync(cacheDir, { recursive: true });
	return cacheDir;
}
async function downloadTemplate(packageManager, cacheDir) {
	const repoUrl = TEMPLATE_REPOS[packageManager];
	const templatePath = path.join(cacheDir, "repo");
	if (existsSync(templatePath)) {
		debug$5(`Template cache found at ${templatePath}, updating...`);
		try {
			await new Promise((resolve, reject) => {
				const cp = exec("git fetch origin", { cwd: templatePath });
				cp.on("error", reject);
				cp.on("exit", (code) => {
					if (code === 0) resolve();
					else reject(/* @__PURE__ */ new Error(`Failed to fetch latest changes, git process exited with code ${code}`));
				});
			});
			execSync("git reset --hard origin/main", {
				cwd: templatePath,
				stdio: "ignore"
			});
			debug$5("Template updated successfully");
		} catch (error) {
			debug$5(`Failed to update template: ${error}`);
			throw new Error(`Failed to update template from ${repoUrl}: ${error}`);
		}
	} else {
		debug$5(`Cloning template from ${repoUrl}...`);
		try {
			execSync(`git clone ${repoUrl} repo`, {
				cwd: cacheDir,
				stdio: "inherit"
			});
			debug$5("Template cloned successfully");
		} catch (error) {
			throw new Error(`Failed to clone template from ${repoUrl}: ${error}`);
		}
	}
}
async function copyDirectory(src, dest, includeWasiBindings) {
	await mkdirAsync(dest, { recursive: true });
	const entries = await promises.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.name === ".git") continue;
		if (entry.isDirectory()) await copyDirectory(srcPath, destPath, includeWasiBindings);
		else {
			if (!includeWasiBindings && (entry.name.endsWith(".wasi-browser.js") || entry.name.endsWith(".wasi.cjs") || entry.name.endsWith("wasi-worker.browser.mjs ") || entry.name.endsWith("wasi-worker.mjs") || entry.name.endsWith("browser.js"))) continue;
			await promises.copyFile(srcPath, destPath);
		}
	}
}
async function filterTargetsInPackageJson(filePath, enabledTargets) {
	var _packageJson$napi;
	const content = await promises.readFile(filePath, "utf-8");
	const packageJson = JSON.parse(content);
	if ((_packageJson$napi = packageJson.napi) === null || _packageJson$napi === void 0 ? void 0 : _packageJson$napi.targets) packageJson.napi.targets = packageJson.napi.targets.filter((target) => enabledTargets.includes(target));
	await promises.writeFile(filePath, JSON.stringify(packageJson, null, 2) + "\n");
}
async function filterTargetsInGithubActions(filePath, enabledTargets) {
	var _yaml$jobs, _yaml$jobs5;
	const yaml = load(await promises.readFile(filePath, "utf-8"));
	const macOSAndWindowsTargets = new Set([
		"x86_64-pc-windows-msvc",
		"x86_64-pc-windows-gnu",
		"aarch64-pc-windows-msvc",
		"x86_64-apple-darwin"
	]);
	const linuxTargets = new Set([
		"x86_64-unknown-linux-gnu",
		"x86_64-unknown-linux-musl",
		"aarch64-unknown-linux-gnu",
		"aarch64-unknown-linux-musl",
		"armv7-unknown-linux-gnueabihf",
		"armv7-unknown-linux-musleabihf",
		"loongarch64-unknown-linux-gnu",
		"riscv64gc-unknown-linux-gnu",
		"powerpc64le-unknown-linux-gnu",
		"s390x-unknown-linux-gnu",
		"aarch64-linux-android",
		"armv7-linux-androideabi"
	]);
	const hasLinuxTargets = enabledTargets.some((target) => linuxTargets.has(target));
	if (yaml === null || yaml === void 0 || (_yaml$jobs = yaml.jobs) === null || _yaml$jobs === void 0 || (_yaml$jobs = _yaml$jobs.build) === null || _yaml$jobs === void 0 || (_yaml$jobs = _yaml$jobs.strategy) === null || _yaml$jobs === void 0 || (_yaml$jobs = _yaml$jobs.matrix) === null || _yaml$jobs === void 0 ? void 0 : _yaml$jobs.settings) yaml.jobs.build.strategy.matrix.settings = yaml.jobs.build.strategy.matrix.settings.filter((setting) => {
		if (setting.target) return enabledTargets.includes(setting.target);
		return true;
	});
	const jobsToRemove = [];
	if (enabledTargets.every((target) => !macOSAndWindowsTargets.has(target))) jobsToRemove.push("test-macOS-windows-binding");
	else {
		var _yaml$jobs2;
		if (yaml === null || yaml === void 0 || (_yaml$jobs2 = yaml.jobs) === null || _yaml$jobs2 === void 0 || (_yaml$jobs2 = _yaml$jobs2["test-macOS-windows-binding"]) === null || _yaml$jobs2 === void 0 || (_yaml$jobs2 = _yaml$jobs2.strategy) === null || _yaml$jobs2 === void 0 || (_yaml$jobs2 = _yaml$jobs2.matrix) === null || _yaml$jobs2 === void 0 ? void 0 : _yaml$jobs2.settings) yaml.jobs["test-macOS-windows-binding"].strategy.matrix.settings = yaml.jobs["test-macOS-windows-binding"].strategy.matrix.settings.filter((setting) => {
			if (setting.target) return enabledTargets.includes(setting.target);
			return true;
		});
	}
	if (!hasLinuxTargets) {
		var _yaml$jobs3;
		if (yaml === null || yaml === void 0 || (_yaml$jobs3 = yaml.jobs) === null || _yaml$jobs3 === void 0 ? void 0 : _yaml$jobs3["test-linux-binding"]) jobsToRemove.push("test-linux-binding");
	} else {
		var _yaml$jobs4;
		if (yaml === null || yaml === void 0 || (_yaml$jobs4 = yaml.jobs) === null || _yaml$jobs4 === void 0 || (_yaml$jobs4 = _yaml$jobs4["test-linux-binding"]) === null || _yaml$jobs4 === void 0 || (_yaml$jobs4 = _yaml$jobs4.strategy) === null || _yaml$jobs4 === void 0 || (_yaml$jobs4 = _yaml$jobs4.matrix) === null || _yaml$jobs4 === void 0 ? void 0 : _yaml$jobs4.target) yaml.jobs["test-linux-binding"].strategy.matrix.target = yaml.jobs["test-linux-binding"].strategy.matrix.target.filter((target) => {
			if (target) return enabledTargets.includes(target);
			return true;
		});
	}
	if (!enabledTargets.includes("wasm32-wasip1-threads")) jobsToRemove.push("test-wasi");
	if (!enabledTargets.includes("x86_64-unknown-freebsd")) jobsToRemove.push("build-freebsd");
	for (const [jobName, jobConfig] of Object.entries(yaml.jobs || {})) if (jobName.startsWith("test-") && jobName !== "test-macOS-windows-binding" && jobName !== "test-linux-x64-gnu-binding") {
		var _job$strategy;
		const job = jobConfig;
		if ((_job$strategy = job.strategy) === null || _job$strategy === void 0 || (_job$strategy = _job$strategy.matrix) === null || _job$strategy === void 0 || (_job$strategy = _job$strategy.settings) === null || _job$strategy === void 0 || (_job$strategy = _job$strategy[0]) === null || _job$strategy === void 0 ? void 0 : _job$strategy.target) {
			const target = job.strategy.matrix.settings[0].target;
			if (!enabledTargets.includes(target)) jobsToRemove.push(jobName);
		}
	}
	for (const jobName of jobsToRemove) delete yaml.jobs[jobName];
	if (Array.isArray((_yaml$jobs5 = yaml.jobs) === null || _yaml$jobs5 === void 0 || (_yaml$jobs5 = _yaml$jobs5.publish) === null || _yaml$jobs5 === void 0 ? void 0 : _yaml$jobs5.needs)) yaml.jobs.publish.needs = yaml.jobs.publish.needs.filter((need) => !jobsToRemove.includes(need));
	const updatedYaml = dump(yaml, {
		lineWidth: -1,
		noRefs: true,
		sortKeys: false
	});
	await promises.writeFile(filePath, updatedYaml);
}
function processOptions(options) {
	var _options$targets;
	debug$5("Processing options...");
	if (!options.path) throw new Error("Please provide the path as the argument");
	options.path = path.resolve(process.cwd(), options.path);
	debug$5(`Resolved target path to: ${options.path}`);
	if (!options.name) {
		options.name = path.parse(options.path).base;
		debug$5(`No project name provided, fix it to dir name: ${options.name}`);
	}
	if (!((_options$targets = options.targets) === null || _options$targets === void 0 ? void 0 : _options$targets.length)) if (options.enableAllTargets) {
		options.targets = AVAILABLE_TARGETS.concat();
		debug$5("Enable all targets");
	} else if (options.enableDefaultTargets) {
		options.targets = DEFAULT_TARGETS.concat();
		debug$5("Enable default targets");
	} else throw new Error("At least one target must be enabled");
	if (options.targets.some((target) => target === "wasm32-wasi-preview1-threads")) {
		if (execSync(`rustup target list`, { encoding: "utf8" }).includes("wasm32-wasip1-threads")) options.targets = options.targets.map((target) => target === "wasm32-wasi-preview1-threads" ? "wasm32-wasip1-threads" : target);
	}
	return applyDefaultNewOptions(options);
}
async function newProject(userOptions) {
	debug$5("Will create napi-rs project with given options:");
	debug$5(userOptions);
	const options = processOptions(userOptions);
	debug$5("Targets to be enabled:");
	debug$5(options.targets);
	if (!await checkGitCommand()) throw new Error("Git is not installed or not available in PATH. Please install Git to continue.");
	const packageManager = options.packageManager;
	await ensurePath(options.path, options.dryRun);
	if (!options.dryRun) try {
		const cacheDir = await ensureCacheDir(packageManager);
		await downloadTemplate(packageManager, cacheDir);
		await copyDirectory(path.join(cacheDir, "repo"), options.path, options.targets.includes("wasm32-wasip1-threads"));
		await renameProject({
			cwd: options.path,
			name: options.name,
			binaryName: getBinaryName(options.name)
		});
		const packageJsonPath = path.join(options.path, "package.json");
		if (existsSync(packageJsonPath)) await filterTargetsInPackageJson(packageJsonPath, options.targets);
		const ciPath = path.join(options.path, ".github", "workflows", "CI.yml");
		if (existsSync(ciPath) && options.enableGithubActions) await filterTargetsInGithubActions(ciPath, options.targets);
		else if (!options.enableGithubActions && existsSync(path.join(options.path, ".github"))) await promises.rm(path.join(options.path, ".github"), {
			recursive: true,
			force: true
		});
		const pkgJsonContent = await promises.readFile(packageJsonPath, "utf-8");
		const pkgJson = JSON.parse(pkgJsonContent);
		if (!pkgJson.engines) pkgJson.engines = {};
		pkgJson.engines.node = napiEngineRequirement(options.minNodeApiVersion);
		if (options.license && pkgJson.license !== options.license) pkgJson.license = options.license;
		if (options.testFramework !== "ava") debug$5(`Test framework ${options.testFramework} requested but not yet implemented`);
		await promises.writeFile(packageJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
	} catch (error) {
		throw new Error(`Failed to create project: ${error}`);
	}
	debug$5(`Project created at: ${options.path}`);
}
async function ensurePath(path, dryRun = false) {
	const stat = await statAsync(path, {}).catch(() => void 0);
	if (stat) {
		if (stat.isFile()) throw new Error(`Path ${path} for creating new napi-rs project already exists and it's not a directory.`);
		else if (stat.isDirectory()) {
			if ((await readdirAsync(path)).length) throw new Error(`Path ${path} for creating new napi-rs project already exists and it's not empty.`);
		}
	}
	if (!dryRun) try {
		debug$5(`Try to create target directory: ${path}`);
		if (!dryRun) await mkdirAsync(path, { recursive: true });
	} catch (e) {
		throw new Error(`Failed to create target directory: ${path}`, { cause: e });
	}
}
function getBinaryName(name) {
	return name.split("/").pop();
}
//#endregion
//#region src/def/pre-publish.ts
var BasePrePublishCommand = class extends Command {
	static paths = [["pre-publish"], ["prepublish"]];
	static usage = Command.Usage({ description: "Update package.json and copy addons into per platform packages" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = Option.String("--npm-dir,-p", "npm", { description: "Path to the folder where the npm packages put" });
	tagStyle = Option.String("--tag-style,--tagstyle,-t", "lerna", { description: "git tag style, `npm` or `lerna`" });
	ghRelease = Option.Boolean("--gh-release", true, { description: "Whether create GitHub release" });
	ghReleaseName = Option.String("--gh-release-name", { description: "GitHub release name" });
	ghReleaseId = Option.String("--gh-release-id", { description: "Existing GitHub release id" });
	skipOptionalPublish = Option.Boolean("--skip-optional-publish", false, { description: "Whether skip optionalDependencies packages publish" });
	dryRun = Option.Boolean("--dry-run", false, { description: "Dry run without touching file system" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			npmDir: this.npmDir,
			tagStyle: this.tagStyle,
			ghRelease: this.ghRelease,
			ghReleaseName: this.ghReleaseName,
			ghReleaseId: this.ghReleaseId,
			skipOptionalPublish: this.skipOptionalPublish,
			dryRun: this.dryRun
		};
	}
};
function applyDefaultPrePublishOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		npmDir: "npm",
		tagStyle: "lerna",
		ghRelease: true,
		skipOptionalPublish: false,
		dryRun: false,
		...options
	};
}
//#endregion
//#region src/def/version.ts
var BaseVersionCommand = class extends Command {
	static paths = [["version"]];
	static usage = Command.Usage({ description: "Update version in created npm packages" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			npmDir: this.npmDir
		};
	}
};
function applyDefaultVersionOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		npmDir: "npm",
		...options
	};
}
//#endregion
//#region src/api/version.ts
const debug$4 = debugFactory("version");
async function version(userOptions) {
	const options = applyDefaultVersionOptions(userOptions);
	const config = await readNapiConfig(resolve(options.cwd, options.packageJsonPath), options.configPath ? resolve(options.cwd, options.configPath) : void 0);
	for (const target of config.targets) {
		const pkgDir = resolve(options.cwd, options.npmDir, target.platformArchABI);
		debug$4(`Update version to %i in [%i]`, config.packageJson.version, pkgDir);
		await updatePackageJson(join(pkgDir, "package.json"), { version: config.packageJson.version });
	}
}
//#endregion
//#region src/api/pre-publish.ts
const debug$3 = debugFactory("pre-publish");
async function prePublish(userOptions) {
	debug$3("Receive pre-publish options:");
	debug$3("  %O", userOptions);
	const options = applyDefaultPrePublishOptions(userOptions);
	const packageJsonPath = resolve(options.cwd, options.packageJsonPath);
	const { packageJson, targets, packageName, binaryName, npmClient } = await readNapiConfig(packageJsonPath, options.configPath ? resolve(options.cwd, options.configPath) : void 0);
	async function createGhRelease(packageName, version) {
		if (!options.ghRelease) return {
			owner: null,
			repo: null,
			pkgInfo: {
				name: null,
				version: null,
				tag: null
			}
		};
		const { repo, owner, pkgInfo, octokit } = getRepoInfo(packageName, version);
		if (!repo || !owner) return {
			owner: null,
			repo: null,
			pkgInfo: {
				name: null,
				version: null,
				tag: null
			}
		};
		if (!options.dryRun) try {
			await octokit.repos.createRelease({
				owner,
				repo,
				tag_name: pkgInfo.tag,
				name: options.ghReleaseName,
				prerelease: version.includes("alpha") || version.includes("beta") || version.includes("rc")
			});
		} catch (e) {
			debug$3(`Params: ${JSON.stringify({
				owner,
				repo,
				tag_name: pkgInfo.tag
			}, null, 2)}`);
			console.error(e);
		}
		return {
			owner,
			repo,
			pkgInfo,
			octokit
		};
	}
	function getRepoInfo(packageName, version) {
		const headCommit = execSync("git log -1 --pretty=%B", { encoding: "utf-8" }).trim();
		const { GITHUB_REPOSITORY } = process.env;
		if (!GITHUB_REPOSITORY) return {
			owner: null,
			repo: null,
			pkgInfo: {
				name: null,
				version: null,
				tag: null
			}
		};
		debug$3(`Github repository: ${GITHUB_REPOSITORY}`);
		const [owner, repo] = GITHUB_REPOSITORY.split("/");
		const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
		let pkgInfo;
		if (options.tagStyle === "lerna") {
			pkgInfo = headCommit.split("\n").map((line) => line.trim()).filter((line, index) => line.length && index).map((line) => line.substring(2)).map(parseTag).find((pkgInfo) => pkgInfo.name === packageName);
			if (!pkgInfo) throw new TypeError(`No release commit found with ${packageName}, original commit info: ${headCommit}`);
		} else pkgInfo = {
			tag: `v${version}`,
			version,
			name: packageName
		};
		return {
			owner,
			repo,
			pkgInfo,
			octokit
		};
	}
	if (!options.dryRun) {
		await version(userOptions);
		await updatePackageJson(packageJsonPath, { optionalDependencies: targets.reduce((deps, target) => {
			deps[`${packageName}-${target.platformArchABI}`] = packageJson.version;
			return deps;
		}, {}) });
	}
	const { owner, repo, pkgInfo, octokit } = options.ghReleaseId ? getRepoInfo(packageName, packageJson.version) : await createGhRelease(packageName, packageJson.version);
	for (const target of targets) {
		const pkgDir = resolve(options.cwd, options.npmDir, `${target.platformArchABI}`);
		const ext = target.platform === "wasi" || target.platform === "wasm" ? "wasm" : "node";
		const filename = `${binaryName}.${target.platformArchABI}.${ext}`;
		const dstPath = join(pkgDir, filename);
		if (!options.dryRun) {
			if (!existsSync(dstPath)) {
				debug$3.warn(`%s doesn't exist`, dstPath);
				continue;
			}
			if (!options.skipOptionalPublish) try {
				const output = execSync(`${npmClient} publish`, {
					cwd: pkgDir,
					env: process.env,
					stdio: "pipe"
				});
				process.stdout.write(output);
			} catch (e) {
				if (e instanceof Error && e.message.includes("You cannot publish over the previously published versions")) {
					console.info(e.message);
					debug$3.warn(`${pkgDir} has been published, skipping`);
				} else throw e;
			}
			if (options.ghRelease && repo && owner) {
				debug$3.info(`Creating GitHub release ${pkgInfo.tag}`);
				try {
					const releaseId = options.ghReleaseId ? Number(options.ghReleaseId) : (await octokit.repos.getReleaseByTag({
						repo,
						owner,
						tag: pkgInfo.tag
					})).data.id;
					const dstFileStats = statSync(dstPath);
					const assetInfo = await octokit.repos.uploadReleaseAsset({
						owner,
						repo,
						name: filename,
						release_id: releaseId,
						mediaType: { format: "raw" },
						headers: {
							"content-length": dstFileStats.size,
							"content-type": "application/octet-stream"
						},
						data: await readFileAsync(dstPath)
					});
					debug$3.info(`GitHub release created`);
					debug$3.info(`Download URL: %s`, assetInfo.data.browser_download_url);
				} catch (e) {
					debug$3.error(`Param: ${JSON.stringify({
						owner,
						repo,
						tag: pkgInfo.tag,
						filename: dstPath
					}, null, 2)}`);
					debug$3.error(e);
				}
			}
		}
	}
}
function parseTag(tag) {
	const segments = tag.split("@");
	const version = segments.pop();
	return {
		name: segments.join("@"),
		version,
		tag
	};
}
//#endregion
//#region src/def/universalize.ts
var BaseUniversalizeCommand = class extends Command {
	static paths = [["universalize"]];
	static usage = Command.Usage({ description: "Combile built binaries into one universal binary" });
	cwd = Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	outputDir = Option.String("--output-dir,-o", "./", { description: "Path to the folder where all built `.node` files put, same as `--output-dir` of build command" });
	getOptions() {
		return {
			cwd: this.cwd,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			outputDir: this.outputDir
		};
	}
};
function applyDefaultUniversalizeOptions(options) {
	return {
		cwd: process.cwd(),
		packageJsonPath: "package.json",
		outputDir: "./",
		...options
	};
}
//#endregion
//#region src/api/universalize.ts
const debug$2 = debugFactory("universalize");
const universalizers = { darwin: (inputs, output) => {
	spawnSync("lipo", [
		"-create",
		"-output",
		output,
		...inputs
	], { stdio: "inherit" });
} };
async function universalizeBinaries(userOptions) {
	var _UniArchsByPlatform$p, _universalizers$proce;
	const options = applyDefaultUniversalizeOptions(userOptions);
	const config = await readNapiConfig(join(options.cwd, options.packageJsonPath), options.configPath ? resolve(options.cwd, options.configPath) : void 0);
	if (!config.targets.find((t) => t.platform === process.platform && t.arch === "universal")) throw new Error(`'universal' arch for platform '${process.platform}' not found in config!`);
	const srcFiles = (_UniArchsByPlatform$p = UniArchsByPlatform[process.platform]) === null || _UniArchsByPlatform$p === void 0 ? void 0 : _UniArchsByPlatform$p.map((arch) => resolve(options.cwd, options.outputDir, `${config.binaryName}.${process.platform}-${arch}.node`));
	if (!srcFiles || !universalizers[process.platform]) throw new Error(`'universal' arch for platform '${process.platform}' not supported.`);
	debug$2(`Looking up source binaries to combine: `);
	debug$2("  %O", srcFiles);
	const srcFileLookup = await Promise.all(srcFiles.map((f) => fileExists(f)));
	const notFoundFiles = srcFiles.filter((_, i) => !srcFileLookup[i]);
	if (notFoundFiles.length) throw new Error(`Some binary files were not found: ${JSON.stringify(notFoundFiles)}`);
	const output = resolve(options.cwd, options.outputDir, `${config.binaryName}.${process.platform}-universal.node`);
	(_universalizers$proce = universalizers[process.platform]) === null || _universalizers$proce === void 0 || _universalizers$proce.call(universalizers, srcFiles, output);
	debug$2(`Produced universal binary: ${output}`);
}
//#endregion
//#region src/commands/artifacts.ts
var ArtifactsCommand = class extends BaseArtifactsCommand {
	static usage = Command.Usage({
		description: "Copy artifacts from Github Actions into specified dir",
		examples: [["$0 artifacts --output-dir ./artifacts --dist ./npm", `Copy [binaryName].[platform].node under current dir(.) into packages under npm dir.
e.g: index.linux-x64-gnu.node --> ./npm/linux-x64-gnu/index.linux-x64-gnu.node`]]
	});
	static paths = [["artifacts"]];
	async execute() {
		await collectArtifacts(this.getOptions());
	}
};
//#endregion
//#region src/def/build.ts
var BaseBuildCommand = class extends Command {
	static paths = [["build"]];
	static usage = Command.Usage({ description: "Build the NAPI-RS project" });
	target = Option.String("--target,-t", { description: "Build for the target triple, bypassed to `cargo build --target`" });
	cwd = Option.String("--cwd", { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	manifestPath = Option.String("--manifest-path", { description: "Path to `Cargo.toml`" });
	configPath = Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = Option.String("--package-json-path", { description: "Path to `package.json`" });
	targetDir = Option.String("--target-dir", { description: "Directory for all crate generated artifacts, see `cargo build --target-dir`" });
	outputDir = Option.String("--output-dir,-o", { description: "Path to where all the built files would be put. Default to the crate folder" });
	platform = Option.Boolean("--platform", { description: "Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`" });
	jsPackageName = Option.String("--js-package-name", { description: "Package name in generated js binding file. Only works with `--platform` flag" });
	constEnum = Option.Boolean("--const-enum", { description: "Whether generate const enum for typescript bindings" });
	jsBinding = Option.String("--js", { description: "Path and filename of generated JS binding file. Only works with `--platform` flag. Relative to `--output-dir`." });
	noJsBinding = Option.Boolean("--no-js", { description: "Whether to disable the generation JS binding file. Only works with `--platform` flag." });
	dts = Option.String("--dts", { description: "Path and filename of generated type def file. Relative to `--output-dir`" });
	dtsHeader = Option.String("--dts-header", { description: "Custom file header for generated type def file. Only works when `typedef` feature enabled." });
	noDtsHeader = Option.Boolean("--no-dts-header", { description: "Whether to disable the default file header for generated type def file. Only works when `typedef` feature enabled." });
	dtsCache = Option.Boolean("--dts-cache", true, { description: "Whether to enable the dts cache, default to true" });
	esm = Option.Boolean("--esm", { description: "Whether to emit an ESM JS binding file instead of CJS format. Only works with `--platform` flag." });
	strip = Option.Boolean("--strip,-s", { description: "Whether strip the library to achieve the minimum file size" });
	release = Option.Boolean("--release,-r", { description: "Build in release mode" });
	verbose = Option.Boolean("--verbose,-v", { description: "Verbosely log build command trace" });
	bin = Option.String("--bin", { description: "Build only the specified binary" });
	package = Option.String("--package,-p", { description: "Build the specified library or the one at cwd" });
	profile = Option.String("--profile", { description: "Build artifacts with the specified profile" });
	crossCompile = Option.Boolean("--cross-compile,-x", { description: "[experimental] cross-compile for the specified target with `cargo-xwin` on windows and `cargo-zigbuild` on other platform" });
	useCross = Option.Boolean("--use-cross", { description: "[experimental] use [cross](https://github.com/cross-rs/cross) instead of `cargo`" });
	useNapiCross = Option.Boolean("--use-napi-cross", { description: "[experimental] use @napi-rs/cross-toolchain to cross-compile Linux arm/arm64/x64 gnu targets." });
	watch = Option.Boolean("--watch,-w", { description: "watch the crate changes and build continuously with `cargo-watch` crates" });
	features = Option.Array("--features,-F", { description: "Space-separated list of features to activate" });
	allFeatures = Option.Boolean("--all-features", { description: "Activate all available features" });
	noDefaultFeatures = Option.Boolean("--no-default-features", { description: "Do not activate the `default` feature" });
	getOptions() {
		return {
			target: this.target,
			cwd: this.cwd,
			manifestPath: this.manifestPath,
			configPath: this.configPath,
			packageJsonPath: this.packageJsonPath,
			targetDir: this.targetDir,
			outputDir: this.outputDir,
			platform: this.platform,
			jsPackageName: this.jsPackageName,
			constEnum: this.constEnum,
			jsBinding: this.jsBinding,
			noJsBinding: this.noJsBinding,
			dts: this.dts,
			dtsHeader: this.dtsHeader,
			noDtsHeader: this.noDtsHeader,
			dtsCache: this.dtsCache,
			esm: this.esm,
			strip: this.strip,
			release: this.release,
			verbose: this.verbose,
			bin: this.bin,
			package: this.package,
			profile: this.profile,
			crossCompile: this.crossCompile,
			useCross: this.useCross,
			useNapiCross: this.useNapiCross,
			watch: this.watch,
			features: this.features,
			allFeatures: this.allFeatures,
			noDefaultFeatures: this.noDefaultFeatures
		};
	}
};
//#endregion
//#region src/commands/build.ts
const debug$1 = debugFactory("build");
var BuildCommand = class extends BaseBuildCommand {
	pipe = Option.String("--pipe", { description: "Pipe all outputs file to given command. e.g. `napi build --pipe \"npx prettier --write\"`" });
	cargoOptions = Option.Rest();
	async execute() {
		const { task } = await buildProject({
			...this.getOptions(),
			cargoOptions: this.cargoOptions
		});
		const outputs = await task;
		if (this.pipe) for (const output of outputs) {
			debug$1("Piping output file to command: %s", this.pipe);
			try {
				execSync(`${this.pipe} ${output.path}`, {
					stdio: "inherit",
					cwd: this.cwd
				});
			} catch (e) {
				debug$1.error(`Failed to pipe output file ${output.path} to command`);
				debug$1.error(e);
			}
		}
	}
};
//#endregion
//#region src/commands/cli-version.ts
/**
* A command that prints the version of the CLI.
*
* Paths: `-v`, `--version`
*/
var CliVersionCommand = class extends Command {
	static paths = [[`-v`], [`--version`]];
	async execute() {
		await this.context.stdout.write(`${CLI_VERSION}\n`);
	}
};
//#endregion
//#region src/commands/create-npm-dirs.ts
var CreateNpmDirsCommand = class extends BaseCreateNpmDirsCommand {
	async execute() {
		await createNpmDirs(this.getOptions());
	}
};
//#endregion
//#region src/commands/help.ts
/**
* A command that prints the usage of all commands.
*
* Paths: `-h`, `--help`
*/
var HelpCommand = class extends Command {
	static paths = [[`-h`], [`--help`]];
	async execute() {
		await this.context.stdout.write(this.cli.usage());
	}
};
//#endregion
//#region src/commands/new.ts
const debug = debugFactory("new");
var NewCommand = class extends BaseNewCommand {
	interactive = Option.Boolean("--interactive,-i", true, { description: "Ask project basic information interactively without just using the default." });
	async execute() {
		try {
			await newProject(await this.fetchOptions());
			return 0;
		} catch (e) {
			debug("Failed to create new project");
			debug.error(e);
			return 1;
		}
	}
	async fetchOptions() {
		const cmdOptions = super.getOptions();
		if (this.interactive) {
			const targetPath = cmdOptions.path ? cmdOptions.path : await inquirerProjectPath();
			cmdOptions.path = targetPath;
			return {
				...cmdOptions,
				name: await this.fetchName(path.parse(targetPath).base),
				minNodeApiVersion: await this.fetchNapiVersion(),
				targets: await this.fetchTargets(),
				license: await this.fetchLicense(),
				enableTypeDef: await this.fetchTypeDef(),
				enableGithubActions: await this.fetchGithubActions()
			};
		}
		return cmdOptions;
	}
	async fetchName(defaultName) {
		return this.$$name ?? input({
			message: "Package name (the name field in your package.json file)",
			default: defaultName
		});
	}
	async fetchLicense() {
		return input({
			message: "License for open-sourced project",
			default: this.license
		});
	}
	async fetchNapiVersion() {
		return select({
			message: "Minimum node-api version (with node version requirement)",
			loop: false,
			pageSize: 10,
			choices: Array.from({ length: 8 }, (_, i) => ({
				name: `napi${i + 1} (${napiEngineRequirement(i + 1)})`,
				value: i + 1
			})),
			default: this.minNodeApiVersion - 1
		});
	}
	async fetchTargets() {
		if (this.enableAllTargets) return AVAILABLE_TARGETS.concat();
		return await checkbox({
			loop: false,
			message: "Choose target(s) your crate will be compiled to",
			choices: AVAILABLE_TARGETS.map((target) => ({
				name: target,
				value: target,
				checked: DEFAULT_TARGETS.includes(target)
			}))
		});
	}
	async fetchTypeDef() {
		return await confirm({
			message: "Enable type definition auto-generation",
			default: this.enableTypeDef
		});
	}
	async fetchGithubActions() {
		return await confirm({
			message: "Enable Github Actions CI",
			default: this.enableGithubActions
		});
	}
};
async function inquirerProjectPath() {
	return input({ message: "Target path to create the project, relative to cwd." }).then((path) => {
		if (!path) return inquirerProjectPath();
		return path;
	});
}
//#endregion
//#region src/commands/pre-publish.ts
var PrePublishCommand = class extends BasePrePublishCommand {
	async execute() {
		await prePublish(this.getOptions());
	}
};
//#endregion
//#region src/commands/rename.ts
var RenameCommand = class extends BaseRenameCommand {
	async execute() {
		const options = this.getOptions();
		if (!options.name) options.name = await input({
			message: `Enter the new package name in the package.json`,
			required: true
		});
		if (!options.binaryName) options.binaryName = await input({
			message: `Enter the new binary name`,
			required: true
		});
		await renameProject(options);
	}
};
//#endregion
//#region src/commands/universalize.ts
var UniversalizeCommand = class extends BaseUniversalizeCommand {
	async execute() {
		await universalizeBinaries(this.getOptions());
	}
};
//#endregion
//#region src/commands/version.ts
var VersionCommand = class extends BaseVersionCommand {
	async execute() {
		await version(this.getOptions());
	}
};
//#endregion
//#region src/index.ts
const cli = new Cli({
	binaryName: "napi",
	binaryVersion: CLI_VERSION
});
cli.register(NewCommand);
cli.register(BuildCommand);
cli.register(CreateNpmDirsCommand);
cli.register(ArtifactsCommand);
cli.register(UniversalizeCommand);
cli.register(RenameCommand);
cli.register(PrePublishCommand);
cli.register(VersionCommand);
cli.register(HelpCommand);
cli.register(CliVersionCommand);
//#endregion
//#region src/cli.ts
cli.runExit(process.argv.slice(2));
//#endregion
export {};

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpLmpzIiwibmFtZXMiOlsiZGVidWciLCJwaWNrIiwicGtnSnNvbi52ZXJzaW9uIiwiZGVidWciLCJkZWJ1ZyIsInJlcXVpcmUiLCJkZWJ1ZyIsIm1rZGlyQXN5bmMiLCJyYXdNa2RpckFzeW5jIiwid3JpdGVGaWxlQXN5bmMiLCJyYXdXcml0ZUZpbGVBc3luYyIsInBpY2siLCJwYXJzZSIsIiNwcmludE9iamVjdCIsIiNmb3JtYXQiLCIjaXNTaW1wbHlTZXJpYWxpemFibGUiLCIjZGF0ZURlY2xhcmF0aW9uIiwiI3N0ckRlY2xhcmF0aW9uIiwiI251bWJlckRlY2xhcmF0aW9uIiwiI2Jvb2xEZWNsYXJhdGlvbiIsIiNnZXRUeXBlT2ZBcnJheSIsIiNhcnJheURlY2xhcmF0aW9uIiwiI2hlYWRlckdyb3VwIiwiI3ByaW50QXNJbmxpbmVWYWx1ZSIsIiNkZWNsYXJhdGlvbiIsIiNoZWFkZXIiLCIjYXJyYXlUeXBlQ2FjaGUiLCIjZG9HZXRUeXBlT2ZBcnJheSIsIiNpc1ByaW1pdGl2ZSIsIiNwcmludERhdGUiLCIjc291cmNlIiwiI3Bvc2l0aW9uIiwiI3doaXRlc3BhY2UiLCJqb2luIiwibWVyZ2UiLCJwYXJzZSIsIndhbGsudXAiLCJwYXJzZVRvbWwiLCJzdHJpbmdpZnlUb21sIiwiZmluZC5kaXIiLCJ5YW1sUGFyc2UiLCJ5YW1sU3RyaW5naWZ5IiwiZGVidWciLCJmcyIsInlhbWxMb2FkIiwieWFtbER1bXAiLCJkZWJ1ZyIsImRlYnVnIiwiZGVidWciLCJkZWJ1ZyJdLCJzb3VyY2VzIjpbIi4uL3NyYy9kZWYvYXJ0aWZhY3RzLnRzIiwiLi4vc3JjL3V0aWxzL2xvZy50cyIsIi4uL3BhY2thZ2UuanNvbiIsIi4uL3NyYy91dGlscy9taXNjLnRzIiwiLi4vc3JjL3V0aWxzL3RhcmdldC50cyIsIi4uL3NyYy91dGlscy92ZXJzaW9uLnRzIiwiLi4vc3JjL3V0aWxzL21ldGFkYXRhLnRzIiwiLi4vc3JjL3V0aWxzL2NvbmZpZy50cyIsIi4uL3NyYy91dGlscy9jYXJnby50cyIsIi4uL3NyYy91dGlscy90eXBlZ2VuLnRzIiwiLi4vc3JjL3V0aWxzL3JlYWQtY29uZmlnLnRzIiwiLi4vc3JjL2FwaS9hcnRpZmFjdHMudHMiLCIuLi9zcmMvYXBpL3RlbXBsYXRlcy9qcy1iaW5kaW5nLnRzIiwiLi4vc3JjL2FwaS90ZW1wbGF0ZXMvbG9hZC13YXNpLXRlbXBsYXRlLnRzIiwiLi4vc3JjL2FwaS90ZW1wbGF0ZXMvd2FzaS13b3JrZXItdGVtcGxhdGUudHMiLCIuLi9zcmMvYXBpL2J1aWxkLnRzIiwiLi4vc3JjL2RlZi9jcmVhdGUtbnBtLWRpcnMudHMiLCIuLi9zcmMvYXBpL2NyZWF0ZS1ucG0tZGlycy50cyIsIi4uL3NyYy9kZWYvbmV3LnRzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0BzdGQvdG9tbC9zdHJpbmdpZnkuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQGpzci9zdGRfX2NvbGxlY3Rpb25zL2RlZXBfbWVyZ2UuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHN0ZC90b21sL19wYXJzZXIuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHN0ZC90b21sL3BhcnNlLmpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL3Jlc29sdmUubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL3dhbGsubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL2ZpbmQubWpzIiwiLi4vc3JjL2RlZi9yZW5hbWUudHMiLCIuLi9zcmMvYXBpL3JlbmFtZS50cyIsIi4uL3NyYy9hcGkvbmV3LnRzIiwiLi4vc3JjL2RlZi9wcmUtcHVibGlzaC50cyIsIi4uL3NyYy9kZWYvdmVyc2lvbi50cyIsIi4uL3NyYy9hcGkvdmVyc2lvbi50cyIsIi4uL3NyYy9hcGkvcHJlLXB1Ymxpc2gudHMiLCIuLi9zcmMvZGVmL3VuaXZlcnNhbGl6ZS50cyIsIi4uL3NyYy9hcGkvdW5pdmVyc2FsaXplLnRzIiwiLi4vc3JjL2NvbW1hbmRzL2FydGlmYWN0cy50cyIsIi4uL3NyYy9kZWYvYnVpbGQudHMiLCIuLi9zcmMvY29tbWFuZHMvYnVpbGQudHMiLCIuLi9zcmMvY29tbWFuZHMvY2xpLXZlcnNpb24udHMiLCIuLi9zcmMvY29tbWFuZHMvY3JlYXRlLW5wbS1kaXJzLnRzIiwiLi4vc3JjL2NvbW1hbmRzL2hlbHAudHMiLCIuLi9zcmMvY29tbWFuZHMvbmV3LnRzIiwiLi4vc3JjL2NvbW1hbmRzL3ByZS1wdWJsaXNoLnRzIiwiLi4vc3JjL2NvbW1hbmRzL3JlbmFtZS50cyIsIi4uL3NyYy9jb21tYW5kcy91bml2ZXJzYWxpemUudHMiLCIuLi9zcmMvY29tbWFuZHMvdmVyc2lvbi50cyIsIi4uL3NyYy9pbmRleC50cyIsIi4uL3NyYy9jbGkudHMiXSwic291cmNlc0NvbnRlbnQiOlsiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VBcnRpZmFjdHNDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ2FydGlmYWN0cyddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0NvcHkgYXJ0aWZhY3RzIGZyb20gR2l0aHViIEFjdGlvbnMgaW50byBucG0gcGFja2FnZXMgYW5kIHJlYWR5IHRvIHB1Ymxpc2gnLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG91dHB1dERpciA9IE9wdGlvbi5TdHJpbmcoJy0tb3V0cHV0LWRpciwtbywtZCcsICcuL2FydGlmYWN0cycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgYWxsIGJ1aWx0IGAubm9kZWAgZmlsZXMgcHV0LCBzYW1lIGFzIGAtLW91dHB1dC1kaXJgIG9mIGJ1aWxkIGNvbW1hbmQnLFxuICB9KVxuXG4gIG5wbURpciA9IE9wdGlvbi5TdHJpbmcoJy0tbnBtLWRpcicsICducG0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXQnLFxuICB9KVxuXG4gIGJ1aWxkT3V0cHV0RGlyPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1idWlsZC1vdXRwdXQtZGlyJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggdG8gdGhlIGJ1aWxkIG91dHB1dCBkaXIsIG9ubHkgbmVlZGVkIHdoZW4gdGFyZ2V0cyBjb250YWlucyBgd2FzbTMyLXdhc2ktKmAnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgb3V0cHV0RGlyOiB0aGlzLm91dHB1dERpcixcbiAgICAgIG5wbURpcjogdGhpcy5ucG1EaXIsXG4gICAgICBidWlsZE91dHB1dERpcjogdGhpcy5idWlsZE91dHB1dERpcixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb3B5IGFydGlmYWN0cyBmcm9tIEdpdGh1YiBBY3Rpb25zIGludG8gbnBtIHBhY2thZ2VzIGFuZCByZWFkeSB0byBwdWJsaXNoXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQXJ0aWZhY3RzT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSBhbGwgYnVpbHQgYC5ub2RlYCBmaWxlcyBwdXQsIHNhbWUgYXMgYC0tb3V0cHV0LWRpcmAgb2YgYnVpbGQgY29tbWFuZFxuICAgKlxuICAgKiBAZGVmYXVsdCAnLi9hcnRpZmFjdHMnXG4gICAqL1xuICBvdXRwdXREaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbnBtJ1xuICAgKi9cbiAgbnBtRGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBidWlsZCBvdXRwdXQgZGlyLCBvbmx5IG5lZWRlZCB3aGVuIHRhcmdldHMgY29udGFpbnMgYHdhc20zMi13YXNpLSpgXG4gICAqL1xuICBidWlsZE91dHB1dERpcj86IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0QXJ0aWZhY3RzT3B0aW9ucyhvcHRpb25zOiBBcnRpZmFjdHNPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgb3V0cHV0RGlyOiAnLi9hcnRpZmFjdHMnLFxuICAgIG5wbURpcjogJ25wbScsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0ICogYXMgY29sb3JzIGZyb20gJ2NvbG9yZXR0ZSdcbmltcG9ydCB7IGNyZWF0ZURlYnVnIH0gZnJvbSAnb2J1ZydcblxuZGVjbGFyZSBtb2R1bGUgJ29idWcnIHtcbiAgaW50ZXJmYWNlIERlYnVnZ2VyIHtcbiAgICBpbmZvOiB0eXBlb2YgY29uc29sZS5lcnJvclxuICAgIHdhcm46IHR5cGVvZiBjb25zb2xlLmVycm9yXG4gICAgZXJyb3I6IHR5cGVvZiBjb25zb2xlLmVycm9yXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGRlYnVnRmFjdG9yeSA9IChuYW1lc3BhY2U6IHN0cmluZykgPT4ge1xuICBjb25zdCBkZWJ1ZyA9IGNyZWF0ZURlYnVnKGBuYXBpOiR7bmFtZXNwYWNlfWAsIHtcbiAgICBmb3JtYXR0ZXJzOiB7XG4gICAgICAvLyBkZWJ1ZygnJWknLCAnVGhpcyBpcyBhbiBpbmZvJylcbiAgICAgIGkodikge1xuICAgICAgICByZXR1cm4gY29sb3JzLmdyZWVuKHYpXG4gICAgICB9LFxuICAgIH0sXG4gIH0pXG5cbiAgZGVidWcuaW5mbyA9ICguLi5hcmdzOiBhbnlbXSkgPT5cbiAgICBjb25zb2xlLmVycm9yKGNvbG9ycy5ibGFjayhjb2xvcnMuYmdHcmVlbignIElORk8gJykpLCAuLi5hcmdzKVxuICBkZWJ1Zy53YXJuID0gKC4uLmFyZ3M6IGFueVtdKSA9PlxuICAgIGNvbnNvbGUuZXJyb3IoY29sb3JzLmJsYWNrKGNvbG9ycy5iZ1llbGxvdygnIFdBUk5JTkcgJykpLCAuLi5hcmdzKVxuICBkZWJ1Zy5lcnJvciA9ICguLi5hcmdzOiBhbnlbXSkgPT5cbiAgICBjb25zb2xlLmVycm9yKFxuICAgICAgY29sb3JzLndoaXRlKGNvbG9ycy5iZ1JlZCgnIEVSUk9SICcpKSxcbiAgICAgIC4uLmFyZ3MubWFwKChhcmcpID0+XG4gICAgICAgIGFyZyBpbnN0YW5jZW9mIEVycm9yID8gKGFyZy5zdGFjayA/PyBhcmcubWVzc2FnZSkgOiBhcmcsXG4gICAgICApLFxuICAgIClcblxuICByZXR1cm4gZGVidWdcbn1cbmV4cG9ydCBjb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgndXRpbHMnKVxuIiwiIiwiaW1wb3J0IHtcbiAgcmVhZEZpbGUsXG4gIHdyaXRlRmlsZSxcbiAgdW5saW5rLFxuICBjb3B5RmlsZSxcbiAgbWtkaXIsXG4gIHN0YXQsXG4gIHJlYWRkaXIsXG4gIGFjY2Vzcyxcbn0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcblxuaW1wb3J0IHBrZ0pzb24gZnJvbSAnLi4vLi4vcGFja2FnZS5qc29uJyB3aXRoIHsgdHlwZTogJ2pzb24nIH1cbmltcG9ydCB7IGRlYnVnIH0gZnJvbSAnLi9sb2cuanMnXG5cbmV4cG9ydCBjb25zdCByZWFkRmlsZUFzeW5jID0gcmVhZEZpbGVcbmV4cG9ydCBjb25zdCB3cml0ZUZpbGVBc3luYyA9IHdyaXRlRmlsZVxuZXhwb3J0IGNvbnN0IHVubGlua0FzeW5jID0gdW5saW5rXG5leHBvcnQgY29uc3QgY29weUZpbGVBc3luYyA9IGNvcHlGaWxlXG5leHBvcnQgY29uc3QgbWtkaXJBc3luYyA9IG1rZGlyXG5leHBvcnQgY29uc3Qgc3RhdEFzeW5jID0gc3RhdFxuZXhwb3J0IGNvbnN0IHJlYWRkaXJBc3luYyA9IHJlYWRkaXJcblxuZXhwb3J0IGZ1bmN0aW9uIGZpbGVFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHJldHVybiBhY2Nlc3MocGF0aCkudGhlbihcbiAgICAoKSA9PiB0cnVlLFxuICAgICgpID0+IGZhbHNlLFxuICApXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkaXJFeGlzdHNBc3luYyhwYXRoOiBzdHJpbmcpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzdGF0cyA9IGF3YWl0IHN0YXRBc3luYyhwYXRoKVxuICAgIHJldHVybiBzdGF0cy5pc0RpcmVjdG9yeSgpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwaWNrPE8sIEsgZXh0ZW5kcyBrZXlvZiBPPihvOiBPLCAuLi5rZXlzOiBLW10pOiBQaWNrPE8sIEs+IHtcbiAgcmV0dXJuIGtleXMucmVkdWNlKChhY2MsIGtleSkgPT4ge1xuICAgIGFjY1trZXldID0gb1trZXldXG4gICAgcmV0dXJuIGFjY1xuICB9LCB7fSBhcyBPKVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdXBkYXRlUGFja2FnZUpzb24oXG4gIHBhdGg6IHN0cmluZyxcbiAgcGFydGlhbDogUmVjb3JkPHN0cmluZywgYW55Pixcbikge1xuICBjb25zdCBleGlzdHMgPSBhd2FpdCBmaWxlRXhpc3RzKHBhdGgpXG4gIGlmICghZXhpc3RzKSB7XG4gICAgZGVidWcoYEZpbGUgbm90IGV4aXN0cyAke3BhdGh9YClcbiAgICByZXR1cm5cbiAgfVxuICBjb25zdCBvbGQgPSBKU09OLnBhcnNlKGF3YWl0IHJlYWRGaWxlQXN5bmMocGF0aCwgJ3V0ZjgnKSlcbiAgYXdhaXQgd3JpdGVGaWxlQXN5bmMocGF0aCwgSlNPTi5zdHJpbmdpZnkoeyAuLi5vbGQsIC4uLnBhcnRpYWwgfSwgbnVsbCwgMikpXG59XG5cbmV4cG9ydCBjb25zdCBDTElfVkVSU0lPTiA9IHBrZ0pzb24udmVyc2lvblxuIiwiaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5cbmV4cG9ydCB0eXBlIFBsYXRmb3JtID0gTm9kZUpTLlBsYXRmb3JtIHwgJ3dhc20nIHwgJ3dhc2knIHwgJ29wZW5oYXJtb255J1xuXG5leHBvcnQgY29uc3QgVU5JVkVSU0FMX1RBUkdFVFMgPSB7XG4gICd1bml2ZXJzYWwtYXBwbGUtZGFyd2luJzogWydhYXJjaDY0LWFwcGxlLWRhcndpbicsICd4ODZfNjQtYXBwbGUtZGFyd2luJ10sXG59IGFzIGNvbnN0XG5cbmNvbnN0IFNVQl9TWVNURU1TID0gbmV3IFNldChbJ2FuZHJvaWQnLCAnb2hvcyddKVxuXG5leHBvcnQgY29uc3QgQVZBSUxBQkxFX1RBUkdFVFMgPSBbXG4gICdhYXJjaDY0LWFwcGxlLWRhcndpbicsXG4gICdhYXJjaDY0LWxpbnV4LWFuZHJvaWQnLFxuICAnYWFyY2g2NC11bmtub3duLWxpbnV4LWdudScsXG4gICdhYXJjaDY0LXVua25vd24tbGludXgtbXVzbCcsXG4gICdhYXJjaDY0LXVua25vd24tbGludXgtb2hvcycsXG4gICdhYXJjaDY0LXBjLXdpbmRvd3MtbXN2YycsXG4gICd4ODZfNjQtYXBwbGUtZGFyd2luJyxcbiAgJ3g4Nl82NC1wYy13aW5kb3dzLW1zdmMnLFxuICAneDg2XzY0LXBjLXdpbmRvd3MtZ251JyxcbiAgJ3g4Nl82NC11bmtub3duLWxpbnV4LWdudScsXG4gICd4ODZfNjQtdW5rbm93bi1saW51eC1tdXNsJyxcbiAgJ3g4Nl82NC11bmtub3duLWxpbnV4LW9ob3MnLFxuICAneDg2XzY0LXVua25vd24tZnJlZWJzZCcsXG4gICdpNjg2LXBjLXdpbmRvd3MtbXN2YycsXG4gICdhcm12Ny11bmtub3duLWxpbnV4LWdudWVhYmloZicsXG4gICdhcm12Ny11bmtub3duLWxpbnV4LW11c2xlYWJpaGYnLFxuICAnYXJtdjctbGludXgtYW5kcm9pZGVhYmknLFxuICAndW5pdmVyc2FsLWFwcGxlLWRhcndpbicsXG4gICdsb29uZ2FyY2g2NC11bmtub3duLWxpbnV4LWdudScsXG4gICdyaXNjdjY0Z2MtdW5rbm93bi1saW51eC1nbnUnLFxuICAncG93ZXJwYzY0bGUtdW5rbm93bi1saW51eC1nbnUnLFxuICAnczM5MHgtdW5rbm93bi1saW51eC1nbnUnLFxuICAnd2FzbTMyLXdhc2ktcHJldmlldzEtdGhyZWFkcycsXG4gICd3YXNtMzItd2FzaXAxLXRocmVhZHMnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBUYXJnZXRUcmlwbGUgPSAodHlwZW9mIEFWQUlMQUJMRV9UQVJHRVRTKVtudW1iZXJdXG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1RBUkdFVFMgPSBbXG4gICd4ODZfNjQtYXBwbGUtZGFyd2luJyxcbiAgJ2FhcmNoNjQtYXBwbGUtZGFyd2luJyxcbiAgJ3g4Nl82NC1wYy13aW5kb3dzLW1zdmMnLFxuICAneDg2XzY0LXVua25vd24tbGludXgtZ251Jyxcbl0gYXMgY29uc3RcblxuZXhwb3J0IGNvbnN0IFRBUkdFVF9MSU5LRVI6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICdhYXJjaDY0LXVua25vd24tbGludXgtbXVzbCc6ICdhYXJjaDY0LWxpbnV4LW11c2wtZ2NjJyxcbiAgLy8gVE9ETzogU3dpdGNoIHRvIGxvb25nYXJjaDY0LWxpbnV4LWdudS1nY2Mgd2hlbiBhdmFpbGFibGVcbiAgJ2xvb25nYXJjaDY0LXVua25vd24tbGludXgtZ251JzogJ2xvb25nYXJjaDY0LWxpbnV4LWdudS1nY2MtMTMnLFxuICAncmlzY3Y2NGdjLXVua25vd24tbGludXgtZ251JzogJ3Jpc2N2NjQtbGludXgtZ251LWdjYycsXG4gICdwb3dlcnBjNjRsZS11bmtub3duLWxpbnV4LWdudSc6ICdwb3dlcnBjNjRsZS1saW51eC1nbnUtZ2NjJyxcbiAgJ3MzOTB4LXVua25vd24tbGludXgtZ251JzogJ3MzOTB4LWxpbnV4LWdudS1nY2MnLFxufVxuXG4vLyBodHRwczovL25vZGVqcy5vcmcvYXBpL3Byb2Nlc3MuaHRtbCNwcm9jZXNzX3Byb2Nlc3NfYXJjaFxudHlwZSBOb2RlSlNBcmNoID1cbiAgfCAnYXJtJ1xuICB8ICdhcm02NCdcbiAgfCAnaWEzMidcbiAgfCAnbG9vbmc2NCdcbiAgfCAnbWlwcydcbiAgfCAnbWlwc2VsJ1xuICB8ICdwcGMnXG4gIHwgJ3BwYzY0J1xuICB8ICdyaXNjdjY0J1xuICB8ICdzMzkwJ1xuICB8ICdzMzkweCdcbiAgfCAneDMyJ1xuICB8ICd4NjQnXG4gIHwgJ3VuaXZlcnNhbCdcbiAgfCAnd2FzbTMyJ1xuXG5jb25zdCBDcHVUb05vZGVBcmNoOiBSZWNvcmQ8c3RyaW5nLCBOb2RlSlNBcmNoPiA9IHtcbiAgeDg2XzY0OiAneDY0JyxcbiAgYWFyY2g2NDogJ2FybTY0JyxcbiAgaTY4NjogJ2lhMzInLFxuICBhcm12NzogJ2FybScsXG4gIGxvb25nYXJjaDY0OiAnbG9vbmc2NCcsXG4gIHJpc2N2NjRnYzogJ3Jpc2N2NjQnLFxuICBwb3dlcnBjNjRsZTogJ3BwYzY0Jyxcbn1cblxuZXhwb3J0IGNvbnN0IE5vZGVBcmNoVG9DcHU6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIHg2NDogJ3g4Nl82NCcsXG4gIGFybTY0OiAnYWFyY2g2NCcsXG4gIGlhMzI6ICdpNjg2JyxcbiAgYXJtOiAnYXJtdjcnLFxuICBsb29uZzY0OiAnbG9vbmdhcmNoNjQnLFxuICByaXNjdjY0OiAncmlzY3Y2NGdjJyxcbiAgcHBjNjQ6ICdwb3dlcnBjNjRsZScsXG59XG5cbmNvbnN0IFN5c1RvTm9kZVBsYXRmb3JtOiBSZWNvcmQ8c3RyaW5nLCBQbGF0Zm9ybT4gPSB7XG4gIGxpbnV4OiAnbGludXgnLFxuICBmcmVlYnNkOiAnZnJlZWJzZCcsXG4gIGRhcndpbjogJ2RhcndpbicsXG4gIHdpbmRvd3M6ICd3aW4zMicsXG4gIG9ob3M6ICdvcGVuaGFybW9ueScsXG59XG5cbmV4cG9ydCBjb25zdCBVbmlBcmNoc0J5UGxhdGZvcm06IFBhcnRpYWw8UmVjb3JkPFBsYXRmb3JtLCBOb2RlSlNBcmNoW10+PiA9IHtcbiAgZGFyd2luOiBbJ3g2NCcsICdhcm02NCddLFxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFRhcmdldCB7XG4gIHRyaXBsZTogc3RyaW5nXG4gIHBsYXRmb3JtQXJjaEFCSTogc3RyaW5nXG4gIHBsYXRmb3JtOiBQbGF0Zm9ybVxuICBhcmNoOiBOb2RlSlNBcmNoXG4gIGFiaTogc3RyaW5nIHwgbnVsbFxufVxuXG4vKipcbiAqIEEgdHJpcGxlIGlzIGEgc3BlY2lmaWMgZm9ybWF0IGZvciBzcGVjaWZ5aW5nIGEgdGFyZ2V0IGFyY2hpdGVjdHVyZS5cbiAqIFRyaXBsZXMgbWF5IGJlIHJlZmVycmVkIHRvIGFzIGEgdGFyZ2V0IHRyaXBsZSB3aGljaCBpcyB0aGUgYXJjaGl0ZWN0dXJlIGZvciB0aGUgYXJ0aWZhY3QgcHJvZHVjZWQsIGFuZCB0aGUgaG9zdCB0cmlwbGUgd2hpY2ggaXMgdGhlIGFyY2hpdGVjdHVyZSB0aGF0IHRoZSBjb21waWxlciBpcyBydW5uaW5nIG9uLlxuICogVGhlIGdlbmVyYWwgZm9ybWF0IG9mIHRoZSB0cmlwbGUgaXMgYDxhcmNoPjxzdWI+LTx2ZW5kb3I+LTxzeXM+LTxhYmk+YCB3aGVyZTpcbiAqICAgLSBgYXJjaGAgPSBUaGUgYmFzZSBDUFUgYXJjaGl0ZWN0dXJlLCBmb3IgZXhhbXBsZSBgeDg2XzY0YCwgYGk2ODZgLCBgYXJtYCwgYHRodW1iYCwgYG1pcHNgLCBldGMuXG4gKiAgIC0gYHN1YmAgPSBUaGUgQ1BVIHN1Yi1hcmNoaXRlY3R1cmUsIGZvciBleGFtcGxlIGBhcm1gIGhhcyBgdjdgLCBgdjdzYCwgYHY1dGVgLCBldGMuXG4gKiAgIC0gYHZlbmRvcmAgPSBUaGUgdmVuZG9yLCBmb3IgZXhhbXBsZSBgdW5rbm93bmAsIGBhcHBsZWAsIGBwY2AsIGBudmlkaWFgLCBldGMuXG4gKiAgIC0gYHN5c2AgPSBUaGUgc3lzdGVtIG5hbWUsIGZvciBleGFtcGxlIGBsaW51eGAsIGB3aW5kb3dzYCwgYGRhcndpbmAsIGV0Yy4gbm9uZSBpcyB0eXBpY2FsbHkgdXNlZCBmb3IgYmFyZS1tZXRhbCB3aXRob3V0IGFuIE9TLlxuICogICAtIGBhYmlgID0gVGhlIEFCSSwgZm9yIGV4YW1wbGUgYGdudWAsIGBhbmRyb2lkYCwgYGVhYmlgLCBldGMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVRyaXBsZShyYXdUcmlwbGU6IHN0cmluZyk6IFRhcmdldCB7XG4gIGlmIChcbiAgICByYXdUcmlwbGUgPT09ICd3YXNtMzItd2FzaScgfHxcbiAgICByYXdUcmlwbGUgPT09ICd3YXNtMzItd2FzaS1wcmV2aWV3MS10aHJlYWRzJyB8fFxuICAgIHJhd1RyaXBsZS5zdGFydHNXaXRoKCd3YXNtMzItd2FzaXAnKVxuICApIHtcbiAgICByZXR1cm4ge1xuICAgICAgdHJpcGxlOiByYXdUcmlwbGUsXG4gICAgICBwbGF0Zm9ybUFyY2hBQkk6ICd3YXNtMzItd2FzaScsXG4gICAgICBwbGF0Zm9ybTogJ3dhc2knLFxuICAgICAgYXJjaDogJ3dhc20zMicsXG4gICAgICBhYmk6ICd3YXNpJyxcbiAgICB9XG4gIH1cbiAgY29uc3QgdHJpcGxlID0gcmF3VHJpcGxlLmVuZHNXaXRoKCdlYWJpJylcbiAgICA/IGAke3Jhd1RyaXBsZS5zbGljZSgwLCAtNCl9LWVhYmlgXG4gICAgOiByYXdUcmlwbGVcbiAgY29uc3QgdHJpcGxlcyA9IHRyaXBsZS5zcGxpdCgnLScpXG4gIGxldCBjcHU6IHN0cmluZ1xuICBsZXQgc3lzOiBzdHJpbmdcbiAgbGV0IGFiaTogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgaWYgKHRyaXBsZXMubGVuZ3RoID09PSAyKSB7XG4gICAgLy8gYWFyY2g2NC1mdWNoc2lhXG4gICAgLy8gXiBjcHUgICBeIHN5c1xuICAgIDtbY3B1LCBzeXNdID0gdHJpcGxlc1xuICB9IGVsc2Uge1xuICAgIC8vIGFhcmNoNjQtdW5rbm93bi1saW51eC1tdXNsXG4gICAgLy8gXiBjcHUgICBedmVuZG9yIF4gc3lzIF4gYWJpXG4gICAgLy8gYWFyY2g2NC1hcHBsZS1kYXJ3aW5cbiAgICAvLyBeIGNwdSAgICAgICAgIF4gc3lzICAoYWJpIGlzIE5vbmUpXG4gICAgO1tjcHUsICwgc3lzLCBhYmkgPSBudWxsXSA9IHRyaXBsZXNcbiAgfVxuXG4gIGlmIChhYmkgJiYgU1VCX1NZU1RFTVMuaGFzKGFiaSkpIHtcbiAgICBzeXMgPSBhYmlcbiAgICBhYmkgPSBudWxsXG4gIH1cbiAgY29uc3QgcGxhdGZvcm0gPSBTeXNUb05vZGVQbGF0Zm9ybVtzeXNdID8/IChzeXMgYXMgUGxhdGZvcm0pXG4gIGNvbnN0IGFyY2ggPSBDcHVUb05vZGVBcmNoW2NwdV0gPz8gKGNwdSBhcyBOb2RlSlNBcmNoKVxuXG4gIHJldHVybiB7XG4gICAgdHJpcGxlOiByYXdUcmlwbGUsXG4gICAgcGxhdGZvcm1BcmNoQUJJOiBhYmkgPyBgJHtwbGF0Zm9ybX0tJHthcmNofS0ke2FiaX1gIDogYCR7cGxhdGZvcm19LSR7YXJjaH1gLFxuICAgIHBsYXRmb3JtLFxuICAgIGFyY2gsXG4gICAgYWJpLFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTeXN0ZW1EZWZhdWx0VGFyZ2V0KCk6IFRhcmdldCB7XG4gIGNvbnN0IGhvc3QgPSBleGVjU3luYyhgcnVzdGMgLXZWYCwge1xuICAgIGVudjogcHJvY2Vzcy5lbnYsXG4gIH0pXG4gICAgLnRvU3RyaW5nKCd1dGY4JylcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLmZpbmQoKGxpbmUpID0+IGxpbmUuc3RhcnRzV2l0aCgnaG9zdDogJykpXG4gIGNvbnN0IHRyaXBsZSA9IGhvc3Q/LnNsaWNlKCdob3N0OiAnLmxlbmd0aClcbiAgaWYgKCF0cmlwbGUpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBDYW4gbm90IHBhcnNlIHRhcmdldCB0cmlwbGUgZnJvbSBob3N0YClcbiAgfVxuICByZXR1cm4gcGFyc2VUcmlwbGUodHJpcGxlKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VGFyZ2V0TGlua2VyKHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIFRBUkdFVF9MSU5LRVJbdGFyZ2V0XVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdGFyZ2V0VG9FbnZWYXIodGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdGFyZ2V0LnJlcGxhY2UoLy0vZywgJ18nKS50b1VwcGVyQ2FzZSgpXG59XG4iLCJleHBvcnQgZW51bSBOYXBpVmVyc2lvbiB7XG4gIE5hcGkxID0gMSxcbiAgTmFwaTIsXG4gIE5hcGkzLFxuICBOYXBpNCxcbiAgTmFwaTUsXG4gIE5hcGk2LFxuICBOYXBpNyxcbiAgTmFwaTgsXG4gIE5hcGk5LFxufVxuXG4vLy8gYmVjYXVzZSBub2RlIHN1cHBvcnQgbmV3IG5hcGkgdmVyc2lvbiBpbiBzb21lIG1pbm9yIHZlcnNpb24gdXBkYXRlcywgc28gd2UgbWlnaHQgbWVldCBzdWNoIHNpdHVhdGlvbjpcbi8vLyBgbm9kZSB2MTAuMjAuMGAgc3VwcG9ydHMgYG5hcGk1YCBhbmQgYG5hcGk2YCwgYnV0IGBub2RlIHYxMi4wLjBgIG9ubHkgc3VwcG9ydCBgbmFwaTRgLFxuLy8vIGJ5IHdoaWNoLCB3ZSBjYW4gbm90IHRlbGwgZGlyZWN0bHkgbmFwaSB2ZXJzaW9uIHN1cHBvcnRsZXNzIGZyb20gbm9kZSB2ZXJzaW9uIGRpcmVjdGx5LlxuY29uc3QgTkFQSV9WRVJTSU9OX01BVFJJWCA9IG5ldyBNYXA8TmFwaVZlcnNpb24sIHN0cmluZz4oW1xuICBbTmFwaVZlcnNpb24uTmFwaTEsICc4LjYuMCB8IDkuMC4wIHwgMTAuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpMiwgJzguMTAuMCB8IDkuMy4wIHwgMTAuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpMywgJzYuMTQuMiB8IDguMTEuMiB8IDkuMTEuMCB8IDEwLjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTQsICcxMC4xNi4wIHwgMTEuOC4wIHwgMTIuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpNSwgJzEwLjE3LjAgfCAxMi4xMS4wIHwgMTMuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpNiwgJzEwLjIwLjAgfCAxMi4xNy4wIHwgMTQuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpNywgJzEwLjIzLjAgfCAxMi4xOS4wIHwgMTQuMTIuMCB8IDE1LjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTgsICcxMi4yMi4wIHwgMTQuMTcuMCB8IDE1LjEyLjAgfCAxNi4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk5LCAnMTguMTcuMCB8IDIwLjMuMCB8IDIxLjEuMCddLFxuXSlcblxuaW50ZXJmYWNlIE5vZGVWZXJzaW9uIHtcbiAgbWFqb3I6IG51bWJlclxuICBtaW5vcjogbnVtYmVyXG4gIHBhdGNoOiBudW1iZXJcbn1cblxuZnVuY3Rpb24gcGFyc2VOb2RlVmVyc2lvbih2OiBzdHJpbmcpOiBOb2RlVmVyc2lvbiB7XG4gIGNvbnN0IG1hdGNoZXMgPSB2Lm1hdGNoKC92PyhbMC05XSspXFwuKFswLTldKylcXC4oWzAtOV0rKS9pKVxuXG4gIGlmICghbWF0Y2hlcykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5rbm93biBub2RlIHZlcnNpb24gbnVtYmVyOiAnICsgdilcbiAgfVxuXG4gIGNvbnN0IFssIG1ham9yLCBtaW5vciwgcGF0Y2hdID0gbWF0Y2hlc1xuXG4gIHJldHVybiB7XG4gICAgbWFqb3I6IHBhcnNlSW50KG1ham9yKSxcbiAgICBtaW5vcjogcGFyc2VJbnQobWlub3IpLFxuICAgIHBhdGNoOiBwYXJzZUludChwYXRjaCksXG4gIH1cbn1cblxuZnVuY3Rpb24gcmVxdWlyZWROb2RlVmVyc2lvbnMobmFwaVZlcnNpb246IE5hcGlWZXJzaW9uKTogTm9kZVZlcnNpb25bXSB7XG4gIGNvbnN0IHJlcXVpcmVtZW50ID0gTkFQSV9WRVJTSU9OX01BVFJJWC5nZXQobmFwaVZlcnNpb24pXG5cbiAgaWYgKCFyZXF1aXJlbWVudCkge1xuICAgIHJldHVybiBbcGFyc2VOb2RlVmVyc2lvbignMTAuMC4wJyldXG4gIH1cblxuICByZXR1cm4gcmVxdWlyZW1lbnQuc3BsaXQoJ3wnKS5tYXAocGFyc2VOb2RlVmVyc2lvbilcbn1cblxuZnVuY3Rpb24gdG9FbmdpbmVSZXF1aXJlbWVudCh2ZXJzaW9uczogTm9kZVZlcnNpb25bXSk6IHN0cmluZyB7XG4gIGNvbnN0IHJlcXVpcmVtZW50czogc3RyaW5nW10gPSBbXVxuICB2ZXJzaW9ucy5mb3JFYWNoKCh2LCBpKSA9PiB7XG4gICAgbGV0IHJlcSA9ICcnXG4gICAgaWYgKGkgIT09IDApIHtcbiAgICAgIGNvbnN0IGxhc3RWZXJzaW9uID0gdmVyc2lvbnNbaSAtIDFdXG4gICAgICByZXEgKz0gYDwgJHtsYXN0VmVyc2lvbi5tYWpvciArIDF9YFxuICAgIH1cblxuICAgIHJlcSArPSBgJHtpID09PSAwID8gJycgOiAnIHx8ICd9Pj0gJHt2Lm1ham9yfS4ke3YubWlub3J9LiR7di5wYXRjaH1gXG4gICAgcmVxdWlyZW1lbnRzLnB1c2gocmVxKVxuICB9KVxuXG4gIHJldHVybiByZXF1aXJlbWVudHMuam9pbignICcpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBuYXBpRW5naW5lUmVxdWlyZW1lbnQobmFwaVZlcnNpb246IE5hcGlWZXJzaW9uKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRvRW5naW5lUmVxdWlyZW1lbnQocmVxdWlyZWROb2RlVmVyc2lvbnMobmFwaVZlcnNpb24pKVxufVxuIiwiaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5pbXBvcnQgZnMgZnJvbSAnbm9kZTpmcydcblxuZXhwb3J0IHR5cGUgQ3JhdGVUYXJnZXRLaW5kID1cbiAgfCAnYmluJ1xuICB8ICdleGFtcGxlJ1xuICB8ICd0ZXN0J1xuICB8ICdiZW5jaCdcbiAgfCAnbGliJ1xuICB8ICdybGliJ1xuICB8ICdjZHlsaWInXG4gIHwgJ2N1c3RvbS1idWlsZCdcblxuZXhwb3J0IGludGVyZmFjZSBDcmF0ZVRhcmdldCB7XG4gIG5hbWU6IHN0cmluZ1xuICBraW5kOiBDcmF0ZVRhcmdldEtpbmRbXVxuICBjcmF0ZV90eXBlczogQ3JhdGVUYXJnZXRLaW5kW11cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDcmF0ZSB7XG4gIGlkOiBzdHJpbmdcbiAgbmFtZTogc3RyaW5nXG4gIHNyY19wYXRoOiBzdHJpbmdcbiAgdmVyc2lvbjogc3RyaW5nXG4gIGVkaXRpb246IHN0cmluZ1xuICB0YXJnZXRzOiBDcmF0ZVRhcmdldFtdXG4gIGZlYXR1cmVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT5cbiAgbWFuaWZlc3RfcGF0aDogc3RyaW5nXG4gIGRlcGVuZGVuY2llczogQXJyYXk8e1xuICAgIG5hbWU6IHN0cmluZ1xuICAgIHNvdXJjZTogc3RyaW5nXG4gICAgcmVxOiBzdHJpbmdcbiAgICBraW5kOiBzdHJpbmcgfCBudWxsXG4gICAgcmVuYW1lOiBzdHJpbmcgfCBudWxsXG4gICAgb3B0aW9uYWw6IGJvb2xlYW5cbiAgICB1c2VzX2RlZmF1bHRfZmVhdHVyZXM6IGJvb2xlYW5cbiAgICBmZWF0dXJlczogc3RyaW5nW11cbiAgICB0YXJnZXQ6IHN0cmluZyB8IG51bGxcbiAgICByZWdpc3RyeTogc3RyaW5nIHwgbnVsbFxuICB9PlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENhcmdvV29ya3NwYWNlTWV0YWRhdGEge1xuICB2ZXJzaW9uOiBudW1iZXJcbiAgcGFja2FnZXM6IENyYXRlW11cbiAgd29ya3NwYWNlX21lbWJlcnM6IHN0cmluZ1tdXG4gIHRhcmdldF9kaXJlY3Rvcnk6IHN0cmluZ1xuICB3b3Jrc3BhY2Vfcm9vdDogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYXJzZU1ldGFkYXRhKG1hbmlmZXN0UGF0aDogc3RyaW5nKSB7XG4gIGlmICghZnMuZXhpc3RzU3luYyhtYW5pZmVzdFBhdGgpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBObyBjcmF0ZSBmb3VuZCBpbiBtYW5pZmVzdDogJHttYW5pZmVzdFBhdGh9YClcbiAgfVxuXG4gIGNvbnN0IGNoaWxkUHJvY2VzcyA9IHNwYXduKFxuICAgICdjYXJnbycsXG4gICAgWydtZXRhZGF0YScsICctLW1hbmlmZXN0LXBhdGgnLCBtYW5pZmVzdFBhdGgsICctLWZvcm1hdC12ZXJzaW9uJywgJzEnXSxcbiAgICB7IHN0ZGlvOiAncGlwZScgfSxcbiAgKVxuXG4gIGxldCBzdGRvdXQgPSAnJ1xuICBsZXQgc3RkZXJyID0gJydcbiAgbGV0IHN0YXR1cyA9IDBcbiAgbGV0IGVycm9yID0gbnVsbFxuXG4gIGNoaWxkUHJvY2Vzcy5zdGRvdXQub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgIHN0ZG91dCArPSBkYXRhXG4gIH0pXG5cbiAgY2hpbGRQcm9jZXNzLnN0ZGVyci5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgc3RkZXJyICs9IGRhdGFcbiAgfSlcblxuICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgIGNoaWxkUHJvY2Vzcy5vbignY2xvc2UnLCAoY29kZSkgPT4ge1xuICAgICAgc3RhdHVzID0gY29kZSA/PyAwXG4gICAgICByZXNvbHZlKClcbiAgICB9KVxuICB9KVxuXG4gIGlmIChlcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcignY2FyZ28gbWV0YWRhdGEgZmFpbGVkIHRvIHJ1bicsIHsgY2F1c2U6IGVycm9yIH0pXG4gIH1cbiAgaWYgKHN0YXR1cyAhPT0gMCkge1xuICAgIGNvbnN0IHNpbXBsZU1lc3NhZ2UgPSBgY2FyZ28gbWV0YWRhdGEgZXhpdGVkIHdpdGggY29kZSAke3N0YXR1c31gXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3NpbXBsZU1lc3NhZ2V9IGFuZCBlcnJvciBtZXNzYWdlOlxcblxcbiR7c3RkZXJyfWAsIHtcbiAgICAgIGNhdXNlOiBuZXcgRXJyb3Ioc2ltcGxlTWVzc2FnZSksXG4gICAgfSlcbiAgfVxuXG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc3Rkb3V0KSBhcyBDYXJnb1dvcmtzcGFjZU1ldGFkYXRhXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBwYXJzZSBjYXJnbyBtZXRhZGF0YSBKU09OJywgeyBjYXVzZTogZSB9KVxuICB9XG59XG4iLCJpbXBvcnQgeyB1bmRlcmxpbmUsIHllbGxvdyB9IGZyb20gJ2NvbG9yZXR0ZSdcbmltcG9ydCB7IG1lcmdlLCBvbWl0IH0gZnJvbSAnZXMtdG9vbGtpdCdcblxuaW1wb3J0IHsgZmlsZUV4aXN0cywgcmVhZEZpbGVBc3luYyB9IGZyb20gJy4vbWlzYy5qcydcbmltcG9ydCB7IERFRkFVTFRfVEFSR0VUUywgcGFyc2VUcmlwbGUsIHR5cGUgVGFyZ2V0IH0gZnJvbSAnLi90YXJnZXQuanMnXG5cbmV4cG9ydCB0eXBlIFZhbHVlT2ZDb25zdEFycmF5PFQ+ID0gVFtFeGNsdWRlPGtleW9mIFQsIGtleW9mIEFycmF5PGFueT4+XVxuXG5leHBvcnQgY29uc3QgU3VwcG9ydGVkUGFja2FnZU1hbmFnZXJzID0gWyd5YXJuJywgJ3BucG0nXSBhcyBjb25zdFxuZXhwb3J0IGNvbnN0IFN1cHBvcnRlZFRlc3RGcmFtZXdvcmtzID0gWydhdmEnXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlciA9IFZhbHVlT2ZDb25zdEFycmF5PFxuICB0eXBlb2YgU3VwcG9ydGVkUGFja2FnZU1hbmFnZXJzXG4+XG5leHBvcnQgdHlwZSBTdXBwb3J0ZWRUZXN0RnJhbWV3b3JrID0gVmFsdWVPZkNvbnN0QXJyYXk8XG4gIHR5cGVvZiBTdXBwb3J0ZWRUZXN0RnJhbWV3b3Jrc1xuPlxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJOYXBpQ29uZmlnIHtcbiAgLyoqXG4gICAqIE5hbWUgb2YgdGhlIGJpbmFyeSB0byBiZSBnZW5lcmF0ZWQsIGRlZmF1bHQgdG8gYGluZGV4YFxuICAgKi9cbiAgYmluYXJ5TmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogTmFtZSBvZiB0aGUgbnBtIHBhY2thZ2UsIGRlZmF1bHQgdG8gdGhlIG5hbWUgb2Ygcm9vdCBwYWNrYWdlLmpzb24gbmFtZVxuICAgKlxuICAgKiBBbHdheXMgZ2l2ZW4gYEBzY29wZS9wa2dgIGFuZCBhcmNoIHN1ZmZpeCB3aWxsIGJlIGFwcGVuZGVkIGxpa2UgYEBzY29wZS9wa2ctbGludXgtZ251LXg2NGBcbiAgICovXG4gIHBhY2thZ2VOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBBbGwgdGFyZ2V0cyB0aGUgY3JhdGUgd2lsbCBiZSBjb21waWxlZCBmb3JcbiAgICovXG4gIHRhcmdldHM/OiBzdHJpbmdbXVxuXG4gIC8qKlxuICAgKiBUaGUgbnBtIGNsaWVudCBwcm9qZWN0IHVzZXMuXG4gICAqL1xuICBucG1DbGllbnQ/OiBzdHJpbmdcblxuICAvKipcbiAgICogV2hldGhlciBnZW5lcmF0ZSBjb25zdCBlbnVtIGZvciB0eXBlc2NyaXB0IGJpbmRpbmdzXG4gICAqL1xuICBjb25zdEVudW0/OiBib29sZWFuXG5cbiAgLyoqXG4gICAqIGR0cyBoZWFkZXIgcHJlcGVuZCB0byB0aGUgZ2VuZXJhdGVkIGR0cyBmaWxlXG4gICAqL1xuICBkdHNIZWFkZXI/OiBzdHJpbmdcblxuICAvKipcbiAgICogZHRzIGhlYWRlciBmaWxlIHBhdGggdG8gYmUgcHJlcGVuZGVkIHRvIHRoZSBnZW5lcmF0ZWQgZHRzIGZpbGVcbiAgICogaWYgYm90aCBkdHNIZWFkZXIgYW5kIGR0c0hlYWRlckZpbGUgYXJlIHByb3ZpZGVkLCBkdHNIZWFkZXJGaWxlIHdpbGwgYmUgdXNlZFxuICAgKi9cbiAgZHRzSGVhZGVyRmlsZT86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiB3YXNtIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAgICovXG4gIHdhc20/OiB7XG4gICAgLyoqXG4gICAgICogaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWJBc3NlbWJseS9KYXZhU2NyaXB0X2ludGVyZmFjZS9NZW1vcnlcbiAgICAgKiBAZGVmYXVsdCA0MDAwIHBhZ2VzICgyNTZNaUIpXG4gICAgICovXG4gICAgaW5pdGlhbE1lbW9yeT86IG51bWJlclxuICAgIC8qKlxuICAgICAqIEBkZWZhdWx0IDY1NTM2IHBhZ2VzICg0R2lCKVxuICAgICAqL1xuICAgIG1heGltdW1NZW1vcnk/OiBudW1iZXJcblxuICAgIC8qKlxuICAgICAqIEJyb3dzZXIgd2FzbSBiaW5kaW5nIGNvbmZpZ3VyYXRpb25cbiAgICAgKi9cbiAgICBicm93c2VyOiB7XG4gICAgICAvKipcbiAgICAgICAqIFdoZXRoZXIgdG8gdXNlIGZzIG1vZHVsZSBpbiBicm93c2VyXG4gICAgICAgKi9cbiAgICAgIGZzPzogYm9vbGVhblxuICAgICAgLyoqXG4gICAgICAgKiBXaGV0aGVyIHRvIGluaXRpYWxpemUgd2FzbSBhc3luY2hyb25vdXNseVxuICAgICAgICovXG4gICAgICBhc3luY0luaXQ/OiBib29sZWFuXG4gICAgICAvKipcbiAgICAgICAqIFdoZXRoZXIgdG8gaW5qZWN0IGBidWZmZXJgIHRvIGVtbmFwaSBjb250ZXh0XG4gICAgICAgKi9cbiAgICAgIGJ1ZmZlcj86IGJvb2xlYW5cbiAgICAgIC8qKlxuICAgICAgICogV2hldGhlciB0byBlbWl0IGN1c3RvbSBldmVudHMgZm9yIGVycm9ycyBpbiB3b3JrZXJcbiAgICAgICAqL1xuICAgICAgZXJyb3JFdmVudD86IGJvb2xlYW5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgYmluYXJ5TmFtZSBpbnN0ZWFkXG4gICAqL1xuICBuYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgcGFja2FnZU5hbWUgaW5zdGVhZFxuICAgKi9cbiAgcGFja2FnZT86IHtcbiAgICBuYW1lPzogc3RyaW5nXG4gIH1cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB0YXJnZXRzIGluc3RlYWRcbiAgICovXG4gIHRyaXBsZXM/OiB7XG4gICAgLyoqXG4gICAgICogV2hldGhlciBlbmFibGUgZGVmYXVsdCB0YXJnZXRzXG4gICAgICovXG4gICAgZGVmYXVsdHM6IGJvb2xlYW5cbiAgICAvKipcbiAgICAgKiBBZGRpdGlvbmFsIHRhcmdldHMgdG8gYmUgY29tcGlsZWQgZm9yXG4gICAgICovXG4gICAgYWRkaXRpb25hbD86IHN0cmluZ1tdXG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb21tb25QYWNrYWdlSnNvbkZpZWxkcyB7XG4gIG5hbWU6IHN0cmluZ1xuICB2ZXJzaW9uOiBzdHJpbmdcbiAgZGVzY3JpcHRpb24/OiBzdHJpbmdcbiAga2V5d29yZHM/OiBzdHJpbmdbXVxuICBhdXRob3I/OiBzdHJpbmdcbiAgYXV0aG9ycz86IHN0cmluZ1tdXG4gIGxpY2Vuc2U/OiBzdHJpbmdcbiAgY3B1Pzogc3RyaW5nW11cbiAgb3M/OiBzdHJpbmdbXVxuICBsaWJjPzogc3RyaW5nW11cbiAgZmlsZXM/OiBzdHJpbmdbXVxuICByZXBvc2l0b3J5PzogYW55XG4gIGhvbWVwYWdlPzogYW55XG4gIGVuZ2luZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIHB1Ymxpc2hDb25maWc/OiBhbnlcbiAgYnVncz86IGFueVxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tdXNlLWJlZm9yZS1kZWZpbmVcbiAgbmFwaT86IFVzZXJOYXBpQ29uZmlnXG4gIHR5cGU/OiAnbW9kdWxlJyB8ICdjb21tb25qcydcbiAgc2NyaXB0cz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cblxuICAvLyBtb2R1bGVzXG4gIG1haW4/OiBzdHJpbmdcbiAgbW9kdWxlPzogc3RyaW5nXG4gIHR5cGVzPzogc3RyaW5nXG4gIGJyb3dzZXI/OiBzdHJpbmdcbiAgZXhwb3J0cz86IGFueVxuXG4gIGRlcGVuZGVuY2llcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgZGV2RGVwZW5kZW5jaWVzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuXG4gIGF2YT86IHtcbiAgICB0aW1lb3V0Pzogc3RyaW5nXG4gIH1cbn1cblxuZXhwb3J0IHR5cGUgTmFwaUNvbmZpZyA9IFJlcXVpcmVkPFxuICBQaWNrPFVzZXJOYXBpQ29uZmlnLCAnYmluYXJ5TmFtZScgfCAncGFja2FnZU5hbWUnIHwgJ25wbUNsaWVudCc+XG4+ICZcbiAgUGljazxVc2VyTmFwaUNvbmZpZywgJ3dhc20nIHwgJ2R0c0hlYWRlcicgfCAnZHRzSGVhZGVyRmlsZScgfCAnY29uc3RFbnVtJz4gJiB7XG4gICAgdGFyZ2V0czogVGFyZ2V0W11cbiAgICBwYWNrYWdlSnNvbjogQ29tbW9uUGFja2FnZUpzb25GaWVsZHNcbiAgfVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZE5hcGlDb25maWcoXG4gIHBhdGg6IHN0cmluZyxcbiAgY29uZmlnUGF0aD86IHN0cmluZyxcbik6IFByb21pc2U8TmFwaUNvbmZpZz4ge1xuICBpZiAoY29uZmlnUGF0aCAmJiAhKGF3YWl0IGZpbGVFeGlzdHMoY29uZmlnUGF0aCkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBOQVBJLVJTIGNvbmZpZyBub3QgZm91bmQgYXQgJHtjb25maWdQYXRofWApXG4gIH1cbiAgaWYgKCEoYXdhaXQgZmlsZUV4aXN0cyhwYXRoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHBhY2thZ2UuanNvbiBub3QgZm91bmQgYXQgJHtwYXRofWApXG4gIH1cbiAgLy8gTWF5IHN1cHBvcnQgbXVsdGlwbGUgY29uZmlnIHNvdXJjZXMgbGF0ZXIgb24uXG4gIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKHBhdGgsICd1dGY4JylcbiAgbGV0IHBrZ0pzb25cbiAgdHJ5IHtcbiAgICBwa2dKc29uID0gSlNPTi5wYXJzZShjb250ZW50KSBhcyBDb21tb25QYWNrYWdlSnNvbkZpZWxkc1xuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcGFyc2UgcGFja2FnZS5qc29uIGF0ICR7cGF0aH1gLCB7XG4gICAgICBjYXVzZTogZSxcbiAgICB9KVxuICB9XG5cbiAgbGV0IHNlcGFyYXRlZENvbmZpZzogVXNlck5hcGlDb25maWcgfCB1bmRlZmluZWRcbiAgaWYgKGNvbmZpZ1BhdGgpIHtcbiAgICBjb25zdCBjb25maWdDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhjb25maWdQYXRoLCAndXRmOCcpXG4gICAgdHJ5IHtcbiAgICAgIHNlcGFyYXRlZENvbmZpZyA9IEpTT04ucGFyc2UoY29uZmlnQ29udGVudCkgYXMgVXNlck5hcGlDb25maWdcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBwYXJzZSBOQVBJLVJTIGNvbmZpZyBhdCAke2NvbmZpZ1BhdGh9YCwge1xuICAgICAgICBjYXVzZTogZSxcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgY29uc3QgdXNlck5hcGlDb25maWcgPSBwa2dKc29uLm5hcGkgPz8ge31cbiAgaWYgKHBrZ0pzb24ubmFwaSAmJiBzZXBhcmF0ZWRDb25maWcpIHtcbiAgICBjb25zdCBwa2dKc29uUGF0aCA9IHVuZGVybGluZShwYXRoKVxuICAgIGNvbnN0IGNvbmZpZ1BhdGhVbmRlcmxpbmUgPSB1bmRlcmxpbmUoY29uZmlnUGF0aCEpXG4gICAgY29uc29sZS53YXJuKFxuICAgICAgeWVsbG93KFxuICAgICAgICBgQm90aCBuYXBpIGZpZWxkIGluICR7cGtnSnNvblBhdGh9IGFuZCBbTkFQSS1SUyBjb25maWddKCR7Y29uZmlnUGF0aFVuZGVybGluZX0pIGZpbGUgYXJlIGZvdW5kLCB0aGUgTkFQSS1SUyBjb25maWcgZmlsZSB3aWxsIGJlIHVzZWQuYCxcbiAgICAgICksXG4gICAgKVxuICB9XG4gIGlmIChzZXBhcmF0ZWRDb25maWcpIHtcbiAgICBPYmplY3QuYXNzaWduKHVzZXJOYXBpQ29uZmlnLCBzZXBhcmF0ZWRDb25maWcpXG4gIH1cbiAgY29uc3QgbmFwaUNvbmZpZzogTmFwaUNvbmZpZyA9IG1lcmdlKFxuICAgIHtcbiAgICAgIGJpbmFyeU5hbWU6ICdpbmRleCcsXG4gICAgICBwYWNrYWdlTmFtZTogcGtnSnNvbi5uYW1lLFxuICAgICAgdGFyZ2V0czogW10sXG4gICAgICBwYWNrYWdlSnNvbjogcGtnSnNvbixcbiAgICAgIG5wbUNsaWVudDogJ25wbScsXG4gICAgfSxcbiAgICBvbWl0KHVzZXJOYXBpQ29uZmlnLCBbJ3RhcmdldHMnXSksXG4gIClcblxuICBsZXQgdGFyZ2V0czogc3RyaW5nW10gPSB1c2VyTmFwaUNvbmZpZy50YXJnZXRzID8/IFtdXG5cbiAgLy8gY29tcGF0aWJsZSB3aXRoIG9sZCBjb25maWdcbiAgaWYgKHVzZXJOYXBpQ29uZmlnPy5uYW1lKSB7XG4gICAgY29uc29sZS53YXJuKFxuICAgICAgeWVsbG93KFxuICAgICAgICBgW0RFUFJFQ0FURURdIG5hcGkubmFtZSBpcyBkZXByZWNhdGVkLCB1c2UgbmFwaS5iaW5hcnlOYW1lIGluc3RlYWQuYCxcbiAgICAgICksXG4gICAgKVxuICAgIG5hcGlDb25maWcuYmluYXJ5TmFtZSA9IHVzZXJOYXBpQ29uZmlnLm5hbWVcbiAgfVxuXG4gIGlmICghdGFyZ2V0cy5sZW5ndGgpIHtcbiAgICBsZXQgZGVwcmVjYXRlZFdhcm5lZCA9IGZhbHNlXG4gICAgY29uc3Qgd2FybmluZyA9IHllbGxvdyhcbiAgICAgIGBbREVQUkVDQVRFRF0gbmFwaS50cmlwbGVzIGlzIGRlcHJlY2F0ZWQsIHVzZSBuYXBpLnRhcmdldHMgaW5zdGVhZC5gLFxuICAgIClcbiAgICBpZiAodXNlck5hcGlDb25maWcudHJpcGxlcz8uZGVmYXVsdHMpIHtcbiAgICAgIGRlcHJlY2F0ZWRXYXJuZWQgPSB0cnVlXG4gICAgICBjb25zb2xlLndhcm4od2FybmluZylcbiAgICAgIHRhcmdldHMgPSB0YXJnZXRzLmNvbmNhdChERUZBVUxUX1RBUkdFVFMpXG4gICAgfVxuXG4gICAgaWYgKHVzZXJOYXBpQ29uZmlnLnRyaXBsZXM/LmFkZGl0aW9uYWw/Lmxlbmd0aCkge1xuICAgICAgdGFyZ2V0cyA9IHRhcmdldHMuY29uY2F0KHVzZXJOYXBpQ29uZmlnLnRyaXBsZXMuYWRkaXRpb25hbClcbiAgICAgIGlmICghZGVwcmVjYXRlZFdhcm5lZCkge1xuICAgICAgICBjb25zb2xlLndhcm4od2FybmluZylcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBmaW5kIGR1cGxpY2F0ZSB0YXJnZXRzXG4gIGNvbnN0IHVuaXF1ZVRhcmdldHMgPSBuZXcgU2V0KHRhcmdldHMpXG4gIGlmICh1bmlxdWVUYXJnZXRzLnNpemUgIT09IHRhcmdldHMubGVuZ3RoKSB7XG4gICAgY29uc3QgZHVwbGljYXRlVGFyZ2V0ID0gdGFyZ2V0cy5maW5kKFxuICAgICAgKHRhcmdldCwgaW5kZXgpID0+IHRhcmdldHMuaW5kZXhPZih0YXJnZXQpICE9PSBpbmRleCxcbiAgICApXG4gICAgdGhyb3cgbmV3IEVycm9yKGBEdXBsaWNhdGUgdGFyZ2V0cyBhcmUgbm90IGFsbG93ZWQ6ICR7ZHVwbGljYXRlVGFyZ2V0fWApXG4gIH1cblxuICBuYXBpQ29uZmlnLnRhcmdldHMgPSB0YXJnZXRzLm1hcChwYXJzZVRyaXBsZSlcblxuICByZXR1cm4gbmFwaUNvbmZpZ1xufVxuIiwiaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5cbmltcG9ydCB7IGRlYnVnIH0gZnJvbSAnLi9sb2cuanMnXG5cbmV4cG9ydCBmdW5jdGlvbiB0cnlJbnN0YWxsQ2FyZ29CaW5hcnkobmFtZTogc3RyaW5nLCBiaW46IHN0cmluZykge1xuICBpZiAoZGV0ZWN0Q2FyZ29CaW5hcnkoYmluKSkge1xuICAgIGRlYnVnKCdDYXJnbyBiaW5hcnkgYWxyZWFkeSBpbnN0YWxsZWQ6ICVzJywgbmFtZSlcbiAgICByZXR1cm5cbiAgfVxuXG4gIHRyeSB7XG4gICAgZGVidWcoJ0luc3RhbGxpbmcgY2FyZ28gYmluYXJ5OiAlcycsIG5hbWUpXG4gICAgZXhlY1N5bmMoYGNhcmdvIGluc3RhbGwgJHtuYW1lfWAsIHtcbiAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgfSlcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGluc3RhbGwgY2FyZ28gYmluYXJ5OiAke25hbWV9YCwge1xuICAgICAgY2F1c2U6IGUsXG4gICAgfSlcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RDYXJnb0JpbmFyeShiaW46IHN0cmluZykge1xuICBkZWJ1ZygnRGV0ZWN0aW5nIGNhcmdvIGJpbmFyeTogJXMnLCBiaW4pXG4gIHRyeSB7XG4gICAgZXhlY1N5bmMoYGNhcmdvIGhlbHAgJHtiaW59YCwge1xuICAgICAgc3RkaW86ICdpZ25vcmUnLFxuICAgIH0pXG4gICAgZGVidWcoJ0NhcmdvIGJpbmFyeSBkZXRlY3RlZDogJXMnLCBiaW4pXG4gICAgcmV0dXJuIHRydWVcbiAgfSBjYXRjaCB7XG4gICAgZGVidWcoJ0NhcmdvIGJpbmFyeSBub3QgZGV0ZWN0ZWQ6ICVzJywgYmluKVxuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG4iLCJpbXBvcnQgeyBzb3J0QnkgfSBmcm9tICdlcy10b29sa2l0J1xuXG5pbXBvcnQgeyByZWFkRmlsZUFzeW5jIH0gZnJvbSAnLi9taXNjLmpzJ1xuXG5jb25zdCBUT1BfTEVWRUxfTkFNRVNQQUNFID0gJ19fVE9QX0xFVkVMX01PRFVMRV9fJ1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfVFlQRV9ERUZfSEVBREVSID0gYC8qIGF1dG8tZ2VuZXJhdGVkIGJ5IE5BUEktUlMgKi9cbi8qIGVzbGludC1kaXNhYmxlICovXG5gXG5cbmVudW0gVHlwZURlZktpbmQge1xuICBDb25zdCA9ICdjb25zdCcsXG4gIEVudW0gPSAnZW51bScsXG4gIFN0cmluZ0VudW0gPSAnc3RyaW5nX2VudW0nLFxuICBJbnRlcmZhY2UgPSAnaW50ZXJmYWNlJyxcbiAgVHlwZSA9ICd0eXBlJyxcbiAgRm4gPSAnZm4nLFxuICBTdHJ1Y3QgPSAnc3RydWN0JyxcbiAgRXh0ZW5kcyA9ICdleHRlbmRzJyxcbiAgSW1wbCA9ICdpbXBsJyxcbn1cblxuaW50ZXJmYWNlIFR5cGVEZWZMaW5lIHtcbiAga2luZDogVHlwZURlZktpbmRcbiAgbmFtZTogc3RyaW5nXG4gIG9yaWdpbmFsX25hbWU/OiBzdHJpbmdcbiAgZGVmOiBzdHJpbmdcbiAgZXh0ZW5kcz86IHN0cmluZ1xuICBqc19kb2M/OiBzdHJpbmdcbiAganNfbW9kPzogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHByZXR0eVByaW50KFxuICBsaW5lOiBUeXBlRGVmTGluZSxcbiAgY29uc3RFbnVtOiBib29sZWFuLFxuICBpZGVudDogbnVtYmVyLFxuICBhbWJpZW50ID0gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBsZXQgcyA9IGxpbmUuanNfZG9jID8/ICcnXG4gIHN3aXRjaCAobGluZS5raW5kKSB7XG4gICAgY2FzZSBUeXBlRGVmS2luZC5JbnRlcmZhY2U6XG4gICAgICBzICs9IGBleHBvcnQgaW50ZXJmYWNlICR7bGluZS5uYW1lfSB7XFxuJHtsaW5lLmRlZn1cXG59YFxuICAgICAgYnJlYWtcblxuICAgIGNhc2UgVHlwZURlZktpbmQuVHlwZTpcbiAgICAgIHMgKz0gYGV4cG9ydCB0eXBlICR7bGluZS5uYW1lfSA9IFxcbiR7bGluZS5kZWZ9YFxuICAgICAgYnJlYWtcblxuICAgIGNhc2UgVHlwZURlZktpbmQuRW51bTpcbiAgICAgIGNvbnN0IGVudW1OYW1lID0gY29uc3RFbnVtID8gJ2NvbnN0IGVudW0nIDogJ2VudW0nXG4gICAgICBzICs9IGAke2V4cG9ydERlY2xhcmUoYW1iaWVudCl9ICR7ZW51bU5hbWV9ICR7bGluZS5uYW1lfSB7XFxuJHtsaW5lLmRlZn1cXG59YFxuICAgICAgYnJlYWtcblxuICAgIGNhc2UgVHlwZURlZktpbmQuU3RyaW5nRW51bTpcbiAgICAgIGlmIChjb25zdEVudW0pIHtcbiAgICAgICAgcyArPSBgJHtleHBvcnREZWNsYXJlKGFtYmllbnQpfSBjb25zdCBlbnVtICR7bGluZS5uYW1lfSB7XFxuJHtsaW5lLmRlZn1cXG59YFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcyArPSBgZXhwb3J0IHR5cGUgJHtsaW5lLm5hbWV9ID0gJHtsaW5lLmRlZi5yZXBsYWNlQWxsKC8uKj0vZywgJycpLnJlcGxhY2VBbGwoJywnLCAnfCcpfTtgXG4gICAgICB9XG4gICAgICBicmVha1xuXG4gICAgY2FzZSBUeXBlRGVmS2luZC5TdHJ1Y3Q6XG4gICAgICBjb25zdCBleHRlbmRzRGVmID0gbGluZS5leHRlbmRzID8gYCBleHRlbmRzICR7bGluZS5leHRlbmRzfWAgOiAnJ1xuICAgICAgaWYgKGxpbmUuZXh0ZW5kcykge1xuICAgICAgICAvLyBFeHRyYWN0IGdlbmVyaWMgcGFyYW1zIGZyb20gZXh0ZW5kcyB0eXBlIGxpa2UgSXRlcmF0b3I8VCwgVFJlc3VsdCwgVE5leHQ+XG4gICAgICAgIGNvbnN0IGdlbmVyaWNNYXRjaCA9IGxpbmUuZXh0ZW5kcy5tYXRjaCgvSXRlcmF0b3I8KC4rKT4kLylcbiAgICAgICAgaWYgKGdlbmVyaWNNYXRjaCkge1xuICAgICAgICAgIGNvbnN0IFtULCBUUmVzdWx0LCBUTmV4dF0gPSBnZW5lcmljTWF0Y2hbMV1cbiAgICAgICAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAgICAgICAubWFwKChwKSA9PiBwLnRyaW0oKSlcbiAgICAgICAgICBsaW5lLmRlZiA9XG4gICAgICAgICAgICBsaW5lLmRlZiArXG4gICAgICAgICAgICBgXFxubmV4dCh2YWx1ZT86ICR7VE5leHR9KTogSXRlcmF0b3JSZXN1bHQ8JHtUfSwgJHtUUmVzdWx0fT5gXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHMgKz0gYCR7ZXhwb3J0RGVjbGFyZShhbWJpZW50KX0gY2xhc3MgJHtsaW5lLm5hbWV9JHtleHRlbmRzRGVmfSB7XFxuJHtsaW5lLmRlZn1cXG59YFxuICAgICAgaWYgKGxpbmUub3JpZ2luYWxfbmFtZSAmJiBsaW5lLm9yaWdpbmFsX25hbWUgIT09IGxpbmUubmFtZSkge1xuICAgICAgICBzICs9IGBcXG5leHBvcnQgdHlwZSAke2xpbmUub3JpZ2luYWxfbmFtZX0gPSAke2xpbmUubmFtZX1gXG4gICAgICB9XG4gICAgICBicmVha1xuXG4gICAgY2FzZSBUeXBlRGVmS2luZC5GbjpcbiAgICAgIHMgKz0gYCR7ZXhwb3J0RGVjbGFyZShhbWJpZW50KX0gJHtsaW5lLmRlZn1gXG4gICAgICBicmVha1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHMgKz0gbGluZS5kZWZcbiAgfVxuXG4gIHJldHVybiBjb3JyZWN0U3RyaW5nSWRlbnQocywgaWRlbnQpXG59XG5cbmZ1bmN0aW9uIGV4cG9ydERlY2xhcmUoYW1iaWVudDogYm9vbGVhbik6IHN0cmluZyB7XG4gIGlmIChhbWJpZW50KSB7XG4gICAgcmV0dXJuICdleHBvcnQnXG4gIH1cblxuICByZXR1cm4gJ2V4cG9ydCBkZWNsYXJlJ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJvY2Vzc1R5cGVEZWYoXG4gIGludGVybWVkaWF0ZVR5cGVGaWxlOiBzdHJpbmcsXG4gIGNvbnN0RW51bTogYm9vbGVhbixcbikge1xuICBjb25zdCBleHBvcnRzOiBzdHJpbmdbXSA9IFtdXG4gIGNvbnN0IGRlZnMgPSBhd2FpdCByZWFkSW50ZXJtZWRpYXRlVHlwZUZpbGUoaW50ZXJtZWRpYXRlVHlwZUZpbGUpXG4gIGNvbnN0IGdyb3VwZWREZWZzID0gcHJlcHJvY2Vzc1R5cGVEZWYoZGVmcylcblxuICBjb25zdCBkdHMgPVxuICAgIHNvcnRCeShBcnJheS5mcm9tKGdyb3VwZWREZWZzKSwgWyhbbmFtZXNwYWNlXSkgPT4gbmFtZXNwYWNlXSlcbiAgICAgIC5tYXAoKFtuYW1lc3BhY2UsIGRlZnNdKSA9PiB7XG4gICAgICAgIGlmIChuYW1lc3BhY2UgPT09IFRPUF9MRVZFTF9OQU1FU1BBQ0UpIHtcbiAgICAgICAgICByZXR1cm4gZGVmc1xuICAgICAgICAgICAgLm1hcCgoZGVmKSA9PiB7XG4gICAgICAgICAgICAgIHN3aXRjaCAoZGVmLmtpbmQpIHtcbiAgICAgICAgICAgICAgICBjYXNlIFR5cGVEZWZLaW5kLkNvbnN0OlxuICAgICAgICAgICAgICAgIGNhc2UgVHlwZURlZktpbmQuRW51bTpcbiAgICAgICAgICAgICAgICBjYXNlIFR5cGVEZWZLaW5kLlN0cmluZ0VudW06XG4gICAgICAgICAgICAgICAgY2FzZSBUeXBlRGVmS2luZC5GbjpcbiAgICAgICAgICAgICAgICBjYXNlIFR5cGVEZWZLaW5kLlN0cnVjdDoge1xuICAgICAgICAgICAgICAgICAgZXhwb3J0cy5wdXNoKGRlZi5uYW1lKVxuICAgICAgICAgICAgICAgICAgaWYgKGRlZi5vcmlnaW5hbF9uYW1lICYmIGRlZi5vcmlnaW5hbF9uYW1lICE9PSBkZWYubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICBleHBvcnRzLnB1c2goZGVmLm9yaWdpbmFsX25hbWUpXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gcHJldHR5UHJpbnQoZGVmLCBjb25zdEVudW0sIDApXG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmpvaW4oJ1xcblxcbicpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZXhwb3J0cy5wdXNoKG5hbWVzcGFjZSlcbiAgICAgICAgICBsZXQgZGVjbGFyYXRpb24gPSAnJ1xuICAgICAgICAgIGRlY2xhcmF0aW9uICs9IGBleHBvcnQgZGVjbGFyZSBuYW1lc3BhY2UgJHtuYW1lc3BhY2V9IHtcXG5gXG4gICAgICAgICAgZm9yIChjb25zdCBkZWYgb2YgZGVmcykge1xuICAgICAgICAgICAgZGVjbGFyYXRpb24gKz0gcHJldHR5UHJpbnQoZGVmLCBjb25zdEVudW0sIDIsIHRydWUpICsgJ1xcbidcbiAgICAgICAgICB9XG4gICAgICAgICAgZGVjbGFyYXRpb24gKz0gJ30nXG4gICAgICAgICAgcmV0dXJuIGRlY2xhcmF0aW9uXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuam9pbignXFxuXFxuJykgKyAnXFxuJ1xuXG4gIHJldHVybiB7XG4gICAgZHRzLFxuICAgIGV4cG9ydHMsXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVhZEludGVybWVkaWF0ZVR5cGVGaWxlKGZpbGU6IHN0cmluZykge1xuICBjb25zdCBjb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhmaWxlLCAndXRmOCcpXG5cbiAgY29uc3QgZGVmcyA9IGNvbnRlbnRcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLmZpbHRlcihCb29sZWFuKVxuICAgIC5tYXAoKGxpbmUpID0+IHtcbiAgICAgIGxpbmUgPSBsaW5lLnRyaW0oKVxuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShsaW5lKSBhcyBUeXBlRGVmTGluZVxuICAgICAgLy8gQ29udmVydCBlc2NhcGVkIG5ld2xpbmVzIGJhY2sgdG8gYWN0dWFsIG5ld2xpbmVzIGluIGpzX2RvYyBmaWVsZHNcbiAgICAgIGlmIChwYXJzZWQuanNfZG9jKSB7XG4gICAgICAgIHBhcnNlZC5qc19kb2MgPSBwYXJzZWQuanNfZG9jLnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKVxuICAgICAgfVxuICAgICAgLy8gQ29udmVydCBlc2NhcGVkIG5ld2xpbmVzIHRvIGFjdHVhbCBuZXdsaW5lcyBpbiBkZWYgZmllbGRzIGZvciBzdHJ1Y3QvY2xhc3MvaW50ZXJmYWNlL3R5cGUgdHlwZXNcbiAgICAgIC8vIHdoZXJlIFxcbiByZXByZXNlbnRzIG1ldGhvZC9maWVsZCBzZXBhcmF0b3JzIHRoYXQgc2hvdWxkIGJlIGFjdHVhbCBuZXdsaW5lc1xuICAgICAgaWYgKHBhcnNlZC5kZWYpIHtcbiAgICAgICAgcGFyc2VkLmRlZiA9IHBhcnNlZC5kZWYucmVwbGFjZSgvXFxcXG4vZywgJ1xcbicpXG4gICAgICB9XG4gICAgICByZXR1cm4gcGFyc2VkXG4gICAgfSlcblxuICAvLyBtb3ZlIGFsbCBgc3RydWN0YCBkZWYgdG8gdGhlIHZlcnkgdG9wXG4gIC8vIGFuZCBvcmRlciB0aGUgcmVzdCBhbHBoYWJldGljYWxseS5cbiAgcmV0dXJuIGRlZnMuc29ydCgoYSwgYikgPT4ge1xuICAgIGlmIChhLmtpbmQgPT09IFR5cGVEZWZLaW5kLlN0cnVjdCkge1xuICAgICAgaWYgKGIua2luZCA9PT0gVHlwZURlZktpbmQuU3RydWN0KSB7XG4gICAgICAgIHJldHVybiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpXG4gICAgICB9XG4gICAgICByZXR1cm4gLTFcbiAgICB9IGVsc2UgaWYgKGIua2luZCA9PT0gVHlwZURlZktpbmQuU3RydWN0KSB7XG4gICAgICByZXR1cm4gMVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKVxuICAgIH1cbiAgfSlcbn1cblxuZnVuY3Rpb24gcHJlcHJvY2Vzc1R5cGVEZWYoZGVmczogVHlwZURlZkxpbmVbXSk6IE1hcDxzdHJpbmcsIFR5cGVEZWZMaW5lW10+IHtcbiAgY29uc3QgbmFtZXNwYWNlR3JvdXBlZCA9IG5ldyBNYXA8c3RyaW5nLCBUeXBlRGVmTGluZVtdPigpXG4gIGNvbnN0IGNsYXNzRGVmcyA9IG5ldyBNYXA8c3RyaW5nLCBUeXBlRGVmTGluZT4oKVxuXG4gIGZvciAoY29uc3QgZGVmIG9mIGRlZnMpIHtcbiAgICBjb25zdCBuYW1lc3BhY2UgPSBkZWYuanNfbW9kID8/IFRPUF9MRVZFTF9OQU1FU1BBQ0VcbiAgICBpZiAoIW5hbWVzcGFjZUdyb3VwZWQuaGFzKG5hbWVzcGFjZSkpIHtcbiAgICAgIG5hbWVzcGFjZUdyb3VwZWQuc2V0KG5hbWVzcGFjZSwgW10pXG4gICAgfVxuXG4gICAgY29uc3QgZ3JvdXAgPSBuYW1lc3BhY2VHcm91cGVkLmdldChuYW1lc3BhY2UpIVxuXG4gICAgaWYgKGRlZi5raW5kID09PSBUeXBlRGVmS2luZC5TdHJ1Y3QpIHtcbiAgICAgIGdyb3VwLnB1c2goZGVmKVxuICAgICAgY2xhc3NEZWZzLnNldChkZWYubmFtZSwgZGVmKVxuICAgIH0gZWxzZSBpZiAoZGVmLmtpbmQgPT09IFR5cGVEZWZLaW5kLkV4dGVuZHMpIHtcbiAgICAgIGNvbnN0IGNsYXNzRGVmID0gY2xhc3NEZWZzLmdldChkZWYubmFtZSlcbiAgICAgIGlmIChjbGFzc0RlZikge1xuICAgICAgICBjbGFzc0RlZi5leHRlbmRzID0gZGVmLmRlZlxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZGVmLmtpbmQgPT09IFR5cGVEZWZLaW5kLkltcGwpIHtcbiAgICAgIC8vIG1lcmdlIGBpbXBsYCBpbnRvIGNsYXNzIGRlZmluaXRpb25cbiAgICAgIGNvbnN0IGNsYXNzRGVmID0gY2xhc3NEZWZzLmdldChkZWYubmFtZSlcbiAgICAgIGlmIChjbGFzc0RlZikge1xuICAgICAgICBpZiAoY2xhc3NEZWYuZGVmKSB7XG4gICAgICAgICAgY2xhc3NEZWYuZGVmICs9ICdcXG4nXG4gICAgICAgIH1cblxuICAgICAgICBjbGFzc0RlZi5kZWYgKz0gZGVmLmRlZlxuICAgICAgICAvLyBDb252ZXJ0IGFueSByZW1haW5pbmcgXFxuIHNlcXVlbmNlcyBpbiB0aGUgbWVyZ2VkIGRlZiB0byBhY3R1YWwgbmV3bGluZXNcbiAgICAgICAgaWYgKGNsYXNzRGVmLmRlZikge1xuICAgICAgICAgIGNsYXNzRGVmLmRlZiA9IGNsYXNzRGVmLmRlZi5yZXBsYWNlKC9cXFxcbi9nLCAnXFxuJylcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBncm91cC5wdXNoKGRlZilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbmFtZXNwYWNlR3JvdXBlZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29ycmVjdFN0cmluZ0lkZW50KHNyYzogc3RyaW5nLCBpZGVudDogbnVtYmVyKTogc3RyaW5nIHtcbiAgbGV0IGJyYWNrZXREZXB0aCA9IDBcbiAgY29uc3QgcmVzdWx0ID0gc3JjXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5tYXAoKGxpbmUpID0+IHtcbiAgICAgIGxpbmUgPSBsaW5lLnRyaW0oKVxuICAgICAgaWYgKGxpbmUgPT09ICcnKSB7XG4gICAgICAgIHJldHVybiAnJ1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0luTXVsdGlsaW5lQ29tbWVudCA9IGxpbmUuc3RhcnRzV2l0aCgnKicpXG4gICAgICBjb25zdCBpc0Nsb3NpbmdCcmFja2V0ID0gbGluZS5lbmRzV2l0aCgnfScpXG4gICAgICBjb25zdCBpc09wZW5pbmdCcmFja2V0ID0gbGluZS5lbmRzV2l0aCgneycpXG4gICAgICBjb25zdCBpc1R5cGVEZWNsYXJhdGlvbiA9IGxpbmUuZW5kc1dpdGgoJz0nKVxuICAgICAgY29uc3QgaXNUeXBlVmFyaWFudCA9IGxpbmUuc3RhcnRzV2l0aCgnfCcpXG5cbiAgICAgIGxldCByaWdodEluZGVudCA9IGlkZW50XG4gICAgICBpZiAoKGlzT3BlbmluZ0JyYWNrZXQgfHwgaXNUeXBlRGVjbGFyYXRpb24pICYmICFpc0luTXVsdGlsaW5lQ29tbWVudCkge1xuICAgICAgICBicmFja2V0RGVwdGggKz0gMVxuICAgICAgICByaWdodEluZGVudCArPSAoYnJhY2tldERlcHRoIC0gMSkgKiAyXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgaXNDbG9zaW5nQnJhY2tldCAmJlxuICAgICAgICAgIGJyYWNrZXREZXB0aCA+IDAgJiZcbiAgICAgICAgICAhaXNJbk11bHRpbGluZUNvbW1lbnQgJiZcbiAgICAgICAgICAhaXNUeXBlVmFyaWFudFxuICAgICAgICApIHtcbiAgICAgICAgICBicmFja2V0RGVwdGggLT0gMVxuICAgICAgICB9XG4gICAgICAgIHJpZ2h0SW5kZW50ICs9IGJyYWNrZXREZXB0aCAqIDJcbiAgICAgIH1cblxuICAgICAgaWYgKGlzSW5NdWx0aWxpbmVDb21tZW50KSB7XG4gICAgICAgIHJpZ2h0SW5kZW50ICs9IDFcbiAgICAgIH1cblxuICAgICAgY29uc3QgcyA9IGAkeycgJy5yZXBlYXQocmlnaHRJbmRlbnQpfSR7bGluZX1gXG5cbiAgICAgIHJldHVybiBzXG4gICAgfSlcbiAgICAuam9pbignXFxuJylcblxuICByZXR1cm4gcmVzdWx0XG59XG4iLCJpbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgeyByZWFkTmFwaUNvbmZpZyB9IGZyb20gJy4vY29uZmlnLmpzJ1xuXG5pbnRlcmZhY2UgTWluaW1hbE5hcGlPcHRpb25zIHtcbiAgY3dkOiBzdHJpbmdcbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWRDb25maWcob3B0aW9uczogTWluaW1hbE5hcGlPcHRpb25zKSB7XG4gIGNvbnN0IHJlc29sdmVQYXRoID0gKC4uLnBhdGhzOiBzdHJpbmdbXSkgPT4gcmVzb2x2ZShvcHRpb25zLmN3ZCwgLi4ucGF0aHMpXG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgIHJlc29sdmVQYXRoKG9wdGlvbnMucGFja2FnZUpzb25QYXRoID8/ICdwYWNrYWdlLmpzb24nKSxcbiAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlUGF0aChvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICApXG4gIHJldHVybiBjb25maWdcbn1cbiIsImltcG9ydCB7IGpvaW4sIHJlc29sdmUsIHBhcnNlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgKiBhcyBjb2xvcnMgZnJvbSAnY29sb3JldHRlJ1xuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHRBcnRpZmFjdHNPcHRpb25zLFxuICB0eXBlIEFydGlmYWN0c09wdGlvbnMsXG59IGZyb20gJy4uL2RlZi9hcnRpZmFjdHMuanMnXG5pbXBvcnQge1xuICByZWFkTmFwaUNvbmZpZyxcbiAgZGVidWdGYWN0b3J5LFxuICByZWFkRmlsZUFzeW5jLFxuICB3cml0ZUZpbGVBc3luYyxcbiAgVW5pQXJjaHNCeVBsYXRmb3JtLFxuICByZWFkZGlyQXN5bmMsXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnYXJ0aWZhY3RzJylcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbGxlY3RBcnRpZmFjdHModXNlck9wdGlvbnM6IEFydGlmYWN0c09wdGlvbnMpIHtcbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdEFydGlmYWN0c09wdGlvbnModXNlck9wdGlvbnMpXG5cbiAgY29uc3QgcmVzb2x2ZVBhdGggPSAoLi4ucGF0aHM6IHN0cmluZ1tdKSA9PiByZXNvbHZlKG9wdGlvbnMuY3dkLCAuLi5wYXRocylcbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcmVzb2x2ZVBhdGgob3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG4gIGNvbnN0IHsgdGFyZ2V0cywgYmluYXJ5TmFtZSwgcGFja2FnZU5hbWUgfSA9IGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlUGF0aChvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICApXG5cbiAgY29uc3QgZGlzdERpcnMgPSB0YXJnZXRzLm1hcCgocGxhdGZvcm0pID0+XG4gICAgam9pbihvcHRpb25zLmN3ZCwgb3B0aW9ucy5ucG1EaXIsIHBsYXRmb3JtLnBsYXRmb3JtQXJjaEFCSSksXG4gIClcblxuICBjb25zdCB1bml2ZXJzYWxTb3VyY2VCaW5zID0gbmV3IFNldChcbiAgICB0YXJnZXRzXG4gICAgICAuZmlsdGVyKChwbGF0Zm9ybSkgPT4gcGxhdGZvcm0uYXJjaCA9PT0gJ3VuaXZlcnNhbCcpXG4gICAgICAuZmxhdE1hcCgocCkgPT5cbiAgICAgICAgVW5pQXJjaHNCeVBsYXRmb3JtW3AucGxhdGZvcm1dPy5tYXAoKGEpID0+IGAke3AucGxhdGZvcm19LSR7YX1gKSxcbiAgICAgIClcbiAgICAgIC5maWx0ZXIoQm9vbGVhbikgYXMgc3RyaW5nW10sXG4gIClcblxuICBhd2FpdCBjb2xsZWN0Tm9kZUJpbmFyaWVzKGpvaW4ob3B0aW9ucy5jd2QsIG9wdGlvbnMub3V0cHV0RGlyKSkudGhlbihcbiAgICAob3V0cHV0KSA9PlxuICAgICAgUHJvbWlzZS5hbGwoXG4gICAgICAgIG91dHB1dC5tYXAoYXN5bmMgKGZpbGVQYXRoKSA9PiB7XG4gICAgICAgICAgZGVidWcuaW5mbyhgUmVhZCBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KGZpbGVQYXRoKX1dYClcbiAgICAgICAgICBjb25zdCBzb3VyY2VDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhmaWxlUGF0aClcbiAgICAgICAgICBjb25zdCBwYXJzZWROYW1lID0gcGFyc2UoZmlsZVBhdGgpXG4gICAgICAgICAgY29uc3QgdGVybXMgPSBwYXJzZWROYW1lLm5hbWUuc3BsaXQoJy4nKVxuICAgICAgICAgIGNvbnN0IHBsYXRmb3JtQXJjaEFCSSA9IHRlcm1zLnBvcCgpIVxuICAgICAgICAgIGNvbnN0IF9iaW5hcnlOYW1lID0gdGVybXMuam9pbignLicpXG5cbiAgICAgICAgICBpZiAoX2JpbmFyeU5hbWUgIT09IGJpbmFyeU5hbWUpIHtcbiAgICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICAgIGBbJHtfYmluYXJ5TmFtZX1dIGlzIG5vdCBtYXRjaGVkIHdpdGggWyR7YmluYXJ5TmFtZX1dLCBza2lwYCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBkaXIgPSBkaXN0RGlycy5maW5kKChkaXIpID0+IGRpci5pbmNsdWRlcyhwbGF0Zm9ybUFyY2hBQkkpKVxuICAgICAgICAgIGlmICghZGlyICYmIHVuaXZlcnNhbFNvdXJjZUJpbnMuaGFzKHBsYXRmb3JtQXJjaEFCSSkpIHtcbiAgICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICAgIGBbJHtwbGF0Zm9ybUFyY2hBQkl9XSBoYXMgbm8gZGlzdCBkaXIgYnV0IGl0IGlzIHNvdXJjZSBiaW4gZm9yIHVuaXZlcnNhbCBhcmNoLCBza2lwYCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIHJldHVyblxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIWRpcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBkaXN0IGRpciBmb3VuZCBmb3IgJHtmaWxlUGF0aH1gKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IGRpc3RGaWxlUGF0aCA9IGpvaW4oZGlyLCBwYXJzZWROYW1lLmJhc2UpXG4gICAgICAgICAgZGVidWcuaW5mbyhcbiAgICAgICAgICAgIGBXcml0ZSBmaWxlIGNvbnRlbnQgdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodChkaXN0RmlsZVBhdGgpfV1gLFxuICAgICAgICAgIClcbiAgICAgICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhkaXN0RmlsZVBhdGgsIHNvdXJjZUNvbnRlbnQpXG4gICAgICAgICAgY29uc3QgZGlzdEZpbGVQYXRoTG9jYWwgPSBqb2luKFxuICAgICAgICAgICAgcGFyc2UocGFja2FnZUpzb25QYXRoKS5kaXIsXG4gICAgICAgICAgICBwYXJzZWROYW1lLmJhc2UsXG4gICAgICAgICAgKVxuICAgICAgICAgIGRlYnVnLmluZm8oXG4gICAgICAgICAgICBgV3JpdGUgZmlsZSBjb250ZW50IHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoZGlzdEZpbGVQYXRoTG9jYWwpfV1gLFxuICAgICAgICAgIClcbiAgICAgICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhkaXN0RmlsZVBhdGhMb2NhbCwgc291cmNlQ29udGVudClcbiAgICAgICAgfSksXG4gICAgICApLFxuICApXG5cbiAgY29uc3Qgd2FzaVRhcmdldCA9IHRhcmdldHMuZmluZCgodCkgPT4gdC5wbGF0Zm9ybSA9PT0gJ3dhc2knKVxuICBpZiAod2FzaVRhcmdldCkge1xuICAgIGNvbnN0IHdhc2lEaXIgPSBqb2luKFxuICAgICAgb3B0aW9ucy5jd2QsXG4gICAgICBvcHRpb25zLm5wbURpcixcbiAgICAgIHdhc2lUYXJnZXQucGxhdGZvcm1BcmNoQUJJLFxuICAgIClcbiAgICBjb25zdCBjanNGaWxlID0gam9pbihcbiAgICAgIG9wdGlvbnMuYnVpbGRPdXRwdXREaXIgPz8gb3B0aW9ucy5jd2QsXG4gICAgICBgJHtiaW5hcnlOYW1lfS53YXNpLmNqc2AsXG4gICAgKVxuICAgIGNvbnN0IHdvcmtlckZpbGUgPSBqb2luKFxuICAgICAgb3B0aW9ucy5idWlsZE91dHB1dERpciA/PyBvcHRpb25zLmN3ZCxcbiAgICAgIGB3YXNpLXdvcmtlci5tanNgLFxuICAgIClcbiAgICBjb25zdCBicm93c2VyRW50cnkgPSBqb2luKFxuICAgICAgb3B0aW9ucy5idWlsZE91dHB1dERpciA/PyBvcHRpb25zLmN3ZCxcbiAgICAgIGAke2JpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2AsXG4gICAgKVxuICAgIGNvbnN0IGJyb3dzZXJXb3JrZXJGaWxlID0gam9pbihcbiAgICAgIG9wdGlvbnMuYnVpbGRPdXRwdXREaXIgPz8gb3B0aW9ucy5jd2QsXG4gICAgICBgd2FzaS13b3JrZXItYnJvd3Nlci5tanNgLFxuICAgIClcbiAgICBkZWJ1Zy5pbmZvKFxuICAgICAgYE1vdmUgd2FzaSBiaW5kaW5nIGZpbGUgWyR7Y29sb3JzLnllbGxvd0JyaWdodChcbiAgICAgICAgY2pzRmlsZSxcbiAgICAgICl9XSB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KHdhc2lEaXIpfV1gLFxuICAgIClcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgIGpvaW4od2FzaURpciwgYCR7YmluYXJ5TmFtZX0ud2FzaS5janNgKSxcbiAgICAgIGF3YWl0IHJlYWRGaWxlQXN5bmMoY2pzRmlsZSksXG4gICAgKVxuICAgIGRlYnVnLmluZm8oXG4gICAgICBgTW92ZSB3YXNpIHdvcmtlciBmaWxlIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoXG4gICAgICAgIHdvcmtlckZpbGUsXG4gICAgICApfV0gdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodCh3YXNpRGlyKX1dYCxcbiAgICApXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICBqb2luKHdhc2lEaXIsIGB3YXNpLXdvcmtlci5tanNgKSxcbiAgICAgIGF3YWl0IHJlYWRGaWxlQXN5bmMod29ya2VyRmlsZSksXG4gICAgKVxuICAgIGRlYnVnLmluZm8oXG4gICAgICBgTW92ZSB3YXNpIGJyb3dzZXIgZW50cnkgZmlsZSBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KFxuICAgICAgICBicm93c2VyRW50cnksXG4gICAgICApfV0gdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodCh3YXNpRGlyKX1dYCxcbiAgICApXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICBqb2luKHdhc2lEaXIsIGAke2JpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2ApLFxuICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3ZpdGVqcy92aXRlL2lzc3Vlcy84NDI3XG4gICAgICAoYXdhaXQgcmVhZEZpbGVBc3luYyhicm93c2VyRW50cnksICd1dGY4JykpLnJlcGxhY2UoXG4gICAgICAgIGBuZXcgVVJMKCcuL3dhc2ktd29ya2VyLWJyb3dzZXIubWpzJywgaW1wb3J0Lm1ldGEudXJsKWAsXG4gICAgICAgIGBuZXcgVVJMKCcke3BhY2thZ2VOYW1lfS13YXNtMzItd2FzaS93YXNpLXdvcmtlci1icm93c2VyLm1qcycsIGltcG9ydC5tZXRhLnVybClgLFxuICAgICAgKSxcbiAgICApXG4gICAgZGVidWcuaW5mbyhcbiAgICAgIGBNb3ZlIHdhc2kgYnJvd3NlciB3b3JrZXIgZmlsZSBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KFxuICAgICAgICBicm93c2VyV29ya2VyRmlsZSxcbiAgICAgICl9XSB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KHdhc2lEaXIpfV1gLFxuICAgIClcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgIGpvaW4od2FzaURpciwgYHdhc2ktd29ya2VyLWJyb3dzZXIubWpzYCksXG4gICAgICBhd2FpdCByZWFkRmlsZUFzeW5jKGJyb3dzZXJXb3JrZXJGaWxlKSxcbiAgICApXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gY29sbGVjdE5vZGVCaW5hcmllcyhyb290OiBzdHJpbmcpIHtcbiAgY29uc3QgZmlsZXMgPSBhd2FpdCByZWFkZGlyQXN5bmMocm9vdCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG4gIGNvbnN0IG5vZGVCaW5hcmllcyA9IGZpbGVzXG4gICAgLmZpbHRlcihcbiAgICAgIChmaWxlKSA9PlxuICAgICAgICBmaWxlLmlzRmlsZSgpICYmXG4gICAgICAgIChmaWxlLm5hbWUuZW5kc1dpdGgoJy5ub2RlJykgfHwgZmlsZS5uYW1lLmVuZHNXaXRoKCcud2FzbScpKSxcbiAgICApXG4gICAgLm1hcCgoZmlsZSkgPT4gam9pbihyb290LCBmaWxlLm5hbWUpKVxuXG4gIGNvbnN0IGRpcnMgPSBmaWxlcy5maWx0ZXIoKGZpbGUpID0+IGZpbGUuaXNEaXJlY3RvcnkoKSlcbiAgZm9yIChjb25zdCBkaXIgb2YgZGlycykge1xuICAgIGlmIChkaXIubmFtZSAhPT0gJ25vZGVfbW9kdWxlcycpIHtcbiAgICAgIG5vZGVCaW5hcmllcy5wdXNoKC4uLihhd2FpdCBjb2xsZWN0Tm9kZUJpbmFyaWVzKGpvaW4ocm9vdCwgZGlyLm5hbWUpKSkpXG4gICAgfVxuICB9XG4gIHJldHVybiBub2RlQmluYXJpZXNcbn1cbiIsImV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDanNCaW5kaW5nKFxuICBsb2NhbE5hbWU6IHN0cmluZyxcbiAgcGtnTmFtZTogc3RyaW5nLFxuICBpZGVudHM6IHN0cmluZ1tdLFxuICBwYWNrYWdlVmVyc2lvbj86IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIHJldHVybiBgJHtiaW5kaW5nSGVhZGVyfVxuJHtjcmVhdGVDb21tb25CaW5kaW5nKGxvY2FsTmFtZSwgcGtnTmFtZSwgcGFja2FnZVZlcnNpb24pfVxubW9kdWxlLmV4cG9ydHMgPSBuYXRpdmVCaW5kaW5nXG4ke2lkZW50c1xuICAubWFwKChpZGVudCkgPT4gYG1vZHVsZS5leHBvcnRzLiR7aWRlbnR9ID0gbmF0aXZlQmluZGluZy4ke2lkZW50fWApXG4gIC5qb2luKCdcXG4nKX1cbmBcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVzbUJpbmRpbmcoXG4gIGxvY2FsTmFtZTogc3RyaW5nLFxuICBwa2dOYW1lOiBzdHJpbmcsXG4gIGlkZW50czogc3RyaW5nW10sXG4gIHBhY2thZ2VWZXJzaW9uPzogc3RyaW5nLFxuKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2JpbmRpbmdIZWFkZXJ9XG5pbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnXG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpXG5jb25zdCBfX2Rpcm5hbWUgPSBuZXcgVVJMKCcuJywgaW1wb3J0Lm1ldGEudXJsKS5wYXRobmFtZVxuXG4ke2NyZWF0ZUNvbW1vbkJpbmRpbmcobG9jYWxOYW1lLCBwa2dOYW1lLCBwYWNrYWdlVmVyc2lvbil9XG5jb25zdCB7ICR7aWRlbnRzLmpvaW4oJywgJyl9IH0gPSBuYXRpdmVCaW5kaW5nXG4ke2lkZW50cy5tYXAoKGlkZW50KSA9PiBgZXhwb3J0IHsgJHtpZGVudH0gfWApLmpvaW4oJ1xcbicpfVxuYFxufVxuXG5jb25zdCBiaW5kaW5nSGVhZGVyID0gYC8vIHByZXR0aWVyLWlnbm9yZVxuLyogZXNsaW50LWRpc2FibGUgKi9cbi8vIEB0cy1ub2NoZWNrXG4vKiBhdXRvLWdlbmVyYXRlZCBieSBOQVBJLVJTICovXG5gXG5cbmZ1bmN0aW9uIGNyZWF0ZUNvbW1vbkJpbmRpbmcoXG4gIGxvY2FsTmFtZTogc3RyaW5nLFxuICBwa2dOYW1lOiBzdHJpbmcsXG4gIHBhY2thZ2VWZXJzaW9uPzogc3RyaW5nLFxuKTogc3RyaW5nIHtcbiAgZnVuY3Rpb24gcmVxdWlyZVR1cGxlKHR1cGxlOiBzdHJpbmcsIGlkZW50U2l6ZSA9IDgpIHtcbiAgICBjb25zdCBpZGVudExvdyA9ICcgJy5yZXBlYXQoaWRlbnRTaXplIC0gMilcbiAgICBjb25zdCBpZGVudCA9ICcgJy5yZXBlYXQoaWRlbnRTaXplKVxuICAgIGNvbnN0IHZlcnNpb25DaGVjayA9IHBhY2thZ2VWZXJzaW9uXG4gICAgICA/IGBcbiR7aWRlbnRMb3d9dHJ5IHtcbiR7aWRlbnR9Y29uc3QgYmluZGluZyA9IHJlcXVpcmUoJyR7cGtnTmFtZX0tJHt0dXBsZX0nKVxuJHtpZGVudH1jb25zdCBiaW5kaW5nUGFja2FnZVZlcnNpb24gPSByZXF1aXJlKCcke3BrZ05hbWV9LSR7dHVwbGV9L3BhY2thZ2UuanNvbicpLnZlcnNpb25cbiR7aWRlbnR9aWYgKGJpbmRpbmdQYWNrYWdlVmVyc2lvbiAhPT0gJyR7cGFja2FnZVZlcnNpb259JyAmJiBwcm9jZXNzLmVudi5OQVBJX1JTX0VORk9SQ0VfVkVSU0lPTl9DSEVDSyAmJiBwcm9jZXNzLmVudi5OQVBJX1JTX0VORk9SQ0VfVkVSU0lPTl9DSEVDSyAhPT0gJzAnKSB7XG4ke2lkZW50fSAgdGhyb3cgbmV3IEVycm9yKFxcYE5hdGl2ZSBiaW5kaW5nIHBhY2thZ2UgdmVyc2lvbiBtaXNtYXRjaCwgZXhwZWN0ZWQgJHtwYWNrYWdlVmVyc2lvbn0gYnV0IGdvdCBcXCR7YmluZGluZ1BhY2thZ2VWZXJzaW9ufS4gWW91IGNhbiByZWluc3RhbGwgZGVwZW5kZW5jaWVzIHRvIGZpeCB0aGlzIGlzc3VlLlxcYClcbiR7aWRlbnR9fVxuJHtpZGVudH1yZXR1cm4gYmluZGluZ1xuJHtpZGVudExvd319IGNhdGNoIChlKSB7XG4ke2lkZW50fWxvYWRFcnJvcnMucHVzaChlKVxuJHtpZGVudExvd319YFxuICAgICAgOiBgXG4ke2lkZW50TG93fXRyeSB7XG4ke2lkZW50fXJldHVybiByZXF1aXJlKCcke3BrZ05hbWV9LSR7dHVwbGV9JylcbiR7aWRlbnRMb3d9fSBjYXRjaCAoZSkge1xuJHtpZGVudH1sb2FkRXJyb3JzLnB1c2goZSlcbiR7aWRlbnRMb3d9fWBcbiAgICByZXR1cm4gYHRyeSB7XG4ke2lkZW50fXJldHVybiByZXF1aXJlKCcuLyR7bG9jYWxOYW1lfS4ke3R1cGxlfS5ub2RlJylcbiR7aWRlbnRMb3d9fSBjYXRjaCAoZSkge1xuJHtpZGVudH1sb2FkRXJyb3JzLnB1c2goZSlcbiR7aWRlbnRMb3d9fSR7dmVyc2lvbkNoZWNrfWBcbiAgfVxuXG4gIHJldHVybiBgY29uc3QgeyByZWFkRmlsZVN5bmMgfSA9IHJlcXVpcmUoJ25vZGU6ZnMnKVxubGV0IG5hdGl2ZUJpbmRpbmcgPSBudWxsXG5jb25zdCBsb2FkRXJyb3JzID0gW11cblxuY29uc3QgaXNNdXNsID0gKCkgPT4ge1xuICBsZXQgbXVzbCA9IGZhbHNlXG4gIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnbGludXgnKSB7XG4gICAgbXVzbCA9IGlzTXVzbEZyb21GaWxlc3lzdGVtKClcbiAgICBpZiAobXVzbCA9PT0gbnVsbCkge1xuICAgICAgbXVzbCA9IGlzTXVzbEZyb21SZXBvcnQoKVxuICAgIH1cbiAgICBpZiAobXVzbCA9PT0gbnVsbCkge1xuICAgICAgbXVzbCA9IGlzTXVzbEZyb21DaGlsZFByb2Nlc3MoKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbXVzbFxufVxuXG5jb25zdCBpc0ZpbGVNdXNsID0gKGYpID0+IGYuaW5jbHVkZXMoJ2xpYmMubXVzbC0nKSB8fCBmLmluY2x1ZGVzKCdsZC1tdXNsLScpXG5cbmNvbnN0IGlzTXVzbEZyb21GaWxlc3lzdGVtID0gKCkgPT4ge1xuICB0cnkge1xuICAgIHJldHVybiByZWFkRmlsZVN5bmMoJy91c3IvYmluL2xkZCcsICd1dGYtOCcpLmluY2x1ZGVzKCdtdXNsJylcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5jb25zdCBpc011c2xGcm9tUmVwb3J0ID0gKCkgPT4ge1xuICBsZXQgcmVwb3J0ID0gbnVsbFxuICBpZiAodHlwZW9mIHByb2Nlc3MucmVwb3J0Py5nZXRSZXBvcnQgPT09ICdmdW5jdGlvbicpIHtcbiAgICBwcm9jZXNzLnJlcG9ydC5leGNsdWRlTmV0d29yayA9IHRydWVcbiAgICByZXBvcnQgPSBwcm9jZXNzLnJlcG9ydC5nZXRSZXBvcnQoKVxuICB9XG4gIGlmICghcmVwb3J0KSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBpZiAocmVwb3J0LmhlYWRlciAmJiByZXBvcnQuaGVhZGVyLmdsaWJjVmVyc2lvblJ1bnRpbWUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShyZXBvcnQuc2hhcmVkT2JqZWN0cykpIHtcbiAgICBpZiAocmVwb3J0LnNoYXJlZE9iamVjdHMuc29tZShpc0ZpbGVNdXNsKSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlXG59XG5cbmNvbnN0IGlzTXVzbEZyb21DaGlsZFByb2Nlc3MgPSAoKSA9PiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlcXVpcmUoJ2NoaWxkX3Byb2Nlc3MnKS5leGVjU3luYygnbGRkIC0tdmVyc2lvbicsIHsgZW5jb2Rpbmc6ICd1dGY4JyB9KS5pbmNsdWRlcygnbXVzbCcpXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICAvLyBJZiB3ZSByZWFjaCB0aGlzIGNhc2UsIHdlIGRvbid0IGtub3cgaWYgdGhlIHN5c3RlbSBpcyBtdXNsIG9yIG5vdCwgc28gaXMgYmV0dGVyIHRvIGp1c3QgZmFsbGJhY2sgdG8gZmFsc2VcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5mdW5jdGlvbiByZXF1aXJlTmF0aXZlKCkge1xuICBpZiAocHJvY2Vzcy5lbnYuTkFQSV9SU19OQVRJVkVfTElCUkFSWV9QQVRIKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiByZXF1aXJlKHByb2Nlc3MuZW52Lk5BUElfUlNfTkFUSVZFX0xJQlJBUllfUEFUSCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2goZXJyKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnYW5kcm9pZCcpIHtcbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnYW5kcm9pZC1hcm02NCcpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtJykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2FuZHJvaWQtYXJtLWVhYmknKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gQW5kcm9pZCBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAneDY0Jykge1xuICAgICAgaWYgKHByb2Nlc3MuY29uZmlnPy52YXJpYWJsZXM/LnNobGliX3N1ZmZpeCA9PT0gJ2RsbC5hJyB8fCBwcm9jZXNzLmNvbmZpZz8udmFyaWFibGVzPy5ub2RlX3RhcmdldF90eXBlID09PSAnc2hhcmVkX2xpYnJhcnknKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCd3aW4zMi14NjQtZ251Jyl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnd2luMzIteDY0LW1zdmMnKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2lhMzInKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnd2luMzItaWEzMi1tc3ZjJyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCd3aW4zMi1hcm02NC1tc3ZjJyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIFdpbmRvd3M6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbicpIHtcbiAgICAke3JlcXVpcmVUdXBsZSgnZGFyd2luLXVuaXZlcnNhbCcsIDYpfVxuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICd4NjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnZGFyd2luLXg2NCcpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnZGFyd2luLWFybTY0Jyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIG1hY09TOiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdmcmVlYnNkJykge1xuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICd4NjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnZnJlZWJzZC14NjQnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2ZyZWVic2QtYXJtNjQnKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gRnJlZUJTRDogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnbGludXgnKSB7XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3g2NCcpIHtcbiAgICAgIGlmIChpc011c2woKSkge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgteDY0LW11c2wnLCAxMCl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgteDY0LWdudScsIDEwKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgaWYgKGlzTXVzbCgpKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1hcm02NC1tdXNsJywgMTApfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWFybTY0LWdudScsIDEwKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybScpIHtcbiAgICAgIGlmIChpc011c2woKSkge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtYXJtLW11c2xlYWJpaGYnLCAxMCl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtYXJtLWdudWVhYmloZicsIDEwKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2xvb25nNjQnKSB7XG4gICAgICBpZiAoaXNNdXNsKCkpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWxvb25nNjQtbXVzbCcsIDEwKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1sb29uZzY0LWdudScsIDEwKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3Jpc2N2NjQnKSB7XG4gICAgICBpZiAoaXNNdXNsKCkpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXJpc2N2NjQtbXVzbCcsIDEwKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1yaXNjdjY0LWdudScsIDEwKX1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3BwYzY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXBwYzY0LWdudScpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnczM5MHgnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtczM5MHgtZ251Jyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIExpbnV4OiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdvcGVuaGFybW9ueScpIHtcbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnb3Blbmhhcm1vbnktYXJtNjQnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3g2NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdvcGVuaGFybW9ueS14NjQnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybScpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdvcGVuaGFybW9ueS1hcm0nKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gT3Blbkhhcm1vbnk6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBPUzogXFwke3Byb2Nlc3MucGxhdGZvcm19LCBhcmNoaXRlY3R1cmU6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgfVxufVxuXG5uYXRpdmVCaW5kaW5nID0gcmVxdWlyZU5hdGl2ZSgpXG5cbmlmICghbmF0aXZlQmluZGluZyB8fCBwcm9jZXNzLmVudi5OQVBJX1JTX0ZPUkNFX1dBU0kpIHtcbiAgbGV0IHdhc2lCaW5kaW5nID0gbnVsbFxuICBsZXQgd2FzaUJpbmRpbmdFcnJvciA9IG51bGxcbiAgdHJ5IHtcbiAgICB3YXNpQmluZGluZyA9IHJlcXVpcmUoJy4vJHtsb2NhbE5hbWV9Lndhc2kuY2pzJylcbiAgICBuYXRpdmVCaW5kaW5nID0gd2FzaUJpbmRpbmdcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52Lk5BUElfUlNfRk9SQ0VfV0FTSSkge1xuICAgICAgd2FzaUJpbmRpbmdFcnJvciA9IGVyclxuICAgIH1cbiAgfVxuICBpZiAoIW5hdGl2ZUJpbmRpbmcgfHwgcHJvY2Vzcy5lbnYuTkFQSV9SU19GT1JDRV9XQVNJKSB7XG4gICAgdHJ5IHtcbiAgICAgIHdhc2lCaW5kaW5nID0gcmVxdWlyZSgnJHtwa2dOYW1lfS13YXNtMzItd2FzaScpXG4gICAgICBuYXRpdmVCaW5kaW5nID0gd2FzaUJpbmRpbmdcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5OQVBJX1JTX0ZPUkNFX1dBU0kpIHtcbiAgICAgICAgaWYgKCF3YXNpQmluZGluZ0Vycm9yKSB7XG4gICAgICAgICAgd2FzaUJpbmRpbmdFcnJvciA9IGVyclxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHdhc2lCaW5kaW5nRXJyb3IuY2F1c2UgPSBlcnJcbiAgICAgICAgfVxuICAgICAgICBsb2FkRXJyb3JzLnB1c2goZXJyKVxuICAgICAgfVxuICAgIH1cbiAgfVxuICBpZiAocHJvY2Vzcy5lbnYuTkFQSV9SU19GT1JDRV9XQVNJID09PSAnZXJyb3InICYmICF3YXNpQmluZGluZykge1xuICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKCdXQVNJIGJpbmRpbmcgbm90IGZvdW5kIGFuZCBOQVBJX1JTX0ZPUkNFX1dBU0kgaXMgc2V0IHRvIGVycm9yJylcbiAgICBlcnJvci5jYXVzZSA9IHdhc2lCaW5kaW5nRXJyb3JcbiAgICB0aHJvdyBlcnJvclxuICB9XG59XG5cbmlmICghbmF0aXZlQmluZGluZykge1xuICBpZiAobG9hZEVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgXFxgQ2Fubm90IGZpbmQgbmF0aXZlIGJpbmRpbmcuIFxcYCArXG4gICAgICAgIFxcYG5wbSBoYXMgYSBidWcgcmVsYXRlZCB0byBvcHRpb25hbCBkZXBlbmRlbmNpZXMgKGh0dHBzOi8vZ2l0aHViLmNvbS9ucG0vY2xpL2lzc3Vlcy80ODI4KS4gXFxgICtcbiAgICAgICAgJ1BsZWFzZSB0cnkgXFxgbnBtIGlcXGAgYWdhaW4gYWZ0ZXIgcmVtb3ZpbmcgYm90aCBwYWNrYWdlLWxvY2suanNvbiBhbmQgbm9kZV9tb2R1bGVzIGRpcmVjdG9yeS4nLFxuICAgICAge1xuICAgICAgICBjYXVzZTogbG9hZEVycm9ycy5yZWR1Y2UoKGVyciwgY3VyKSA9PiB7XG4gICAgICAgICAgY3VyLmNhdXNlID0gZXJyXG4gICAgICAgICAgcmV0dXJuIGN1clxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgKVxuICB9XG4gIHRocm93IG5ldyBFcnJvcihcXGBGYWlsZWQgdG8gbG9hZCBuYXRpdmUgYmluZGluZ1xcYClcbn1cbmBcbn1cbiIsImV4cG9ydCBjb25zdCBjcmVhdGVXYXNpQnJvd3NlckJpbmRpbmcgPSAoXG4gIHdhc2lGaWxlbmFtZTogc3RyaW5nLFxuICBpbml0aWFsTWVtb3J5ID0gNDAwMCxcbiAgbWF4aW11bU1lbW9yeSA9IDY1NTM2LFxuICBmcyA9IGZhbHNlLFxuICBhc3luY0luaXQgPSBmYWxzZSxcbiAgYnVmZmVyID0gZmFsc2UsXG4gIGVycm9yRXZlbnQgPSBmYWxzZSxcbikgPT4ge1xuICBjb25zdCBmc0ltcG9ydCA9IGZzXG4gICAgPyBidWZmZXJcbiAgICAgID8gYGltcG9ydCB7IG1lbWZzLCBCdWZmZXIgfSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUvZnMnYFxuICAgICAgOiBgaW1wb3J0IHsgbWVtZnMgfSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUvZnMnYFxuICAgIDogJydcbiAgY29uc3QgYnVmZmVySW1wb3J0ID0gYnVmZmVyICYmICFmcyA/IGBpbXBvcnQgeyBCdWZmZXIgfSBmcm9tICdidWZmZXInYCA6ICcnXG4gIGNvbnN0IHdhc2lDcmVhdGlvbiA9IGZzXG4gICAgPyBgXG5leHBvcnQgY29uc3QgeyBmczogX19mcywgdm9sOiBfX3ZvbHVtZSB9ID0gbWVtZnMoKVxuXG5jb25zdCBfX3dhc2kgPSBuZXcgX19XQVNJKHtcbiAgdmVyc2lvbjogJ3ByZXZpZXcxJyxcbiAgZnM6IF9fZnMsXG4gIHByZW9wZW5zOiB7XG4gICAgJy8nOiAnLycsXG4gIH0sXG59KWBcbiAgICA6IGBcbmNvbnN0IF9fd2FzaSA9IG5ldyBfX1dBU0koe1xuICB2ZXJzaW9uOiAncHJldmlldzEnLFxufSlgXG5cbiAgY29uc3Qgd29ya2VyRnNIYW5kbGVyID0gZnNcbiAgICA/IGAgICAgd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBfX3dhc21DcmVhdGVPbk1lc3NhZ2VGb3JGc1Byb3h5KF9fZnMpKVxcbmBcbiAgICA6ICcnXG5cbiAgY29uc3Qgd29ya2VyRXJyb3JIYW5kbGVyID0gZXJyb3JFdmVudFxuICAgID8gYCAgICB3b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5kYXRhICYmIHR5cGVvZiBldmVudC5kYXRhID09PSAnb2JqZWN0JyAmJiBldmVudC5kYXRhLnR5cGUgPT09ICdlcnJvcicpIHtcbiAgICAgICAgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEN1c3RvbUV2ZW50KCduYXBpLXJzLXdvcmtlci1lcnJvcicsIHsgZGV0YWlsOiBldmVudC5kYXRhIH0pKVxuICAgICAgfVxuICAgIH0pXG5gXG4gICAgOiAnJ1xuXG4gIGNvbnN0IGVtbmFwaUluamVjdEJ1ZmZlciA9IGJ1ZmZlclxuICAgID8gJ19fZW1uYXBpQ29udGV4dC5mZWF0dXJlLkJ1ZmZlciA9IEJ1ZmZlcidcbiAgICA6ICcnXG4gIGNvbnN0IGVtbmFwaUluc3RhbnRpYXRlSW1wb3J0ID0gYXN5bmNJbml0XG4gICAgPyBgaW5zdGFudGlhdGVOYXBpTW9kdWxlIGFzIF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlYFxuICAgIDogYGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMgYXMgX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jYFxuICBjb25zdCBlbW5hcGlJbnN0YW50aWF0ZUNhbGwgPSBhc3luY0luaXRcbiAgICA/IGBhd2FpdCBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZWBcbiAgICA6IGBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmNgXG5cbiAgcmV0dXJuIGBpbXBvcnQge1xuICBjcmVhdGVPbk1lc3NhZ2UgYXMgX193YXNtQ3JlYXRlT25NZXNzYWdlRm9yRnNQcm94eSxcbiAgZ2V0RGVmYXVsdENvbnRleHQgYXMgX19lbW5hcGlHZXREZWZhdWx0Q29udGV4dCxcbiAgJHtlbW5hcGlJbnN0YW50aWF0ZUltcG9ydH0sXG4gIFdBU0kgYXMgX19XQVNJLFxufSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUnXG4ke2ZzSW1wb3J0fVxuJHtidWZmZXJJbXBvcnR9XG4ke3dhc2lDcmVhdGlvbn1cblxuY29uc3QgX193YXNtVXJsID0gbmV3IFVSTCgnLi8ke3dhc2lGaWxlbmFtZX0ud2FzbScsIGltcG9ydC5tZXRhLnVybCkuaHJlZlxuY29uc3QgX19lbW5hcGlDb250ZXh0ID0gX19lbW5hcGlHZXREZWZhdWx0Q29udGV4dCgpXG4ke2VtbmFwaUluamVjdEJ1ZmZlcn1cblxuY29uc3QgX19zaGFyZWRNZW1vcnkgPSBuZXcgV2ViQXNzZW1ibHkuTWVtb3J5KHtcbiAgaW5pdGlhbDogJHtpbml0aWFsTWVtb3J5fSxcbiAgbWF4aW11bTogJHttYXhpbXVtTWVtb3J5fSxcbiAgc2hhcmVkOiB0cnVlLFxufSlcblxuY29uc3QgX193YXNtRmlsZSA9IGF3YWl0IGZldGNoKF9fd2FzbVVybCkudGhlbigocmVzKSA9PiByZXMuYXJyYXlCdWZmZXIoKSlcblxuY29uc3Qge1xuICBpbnN0YW5jZTogX19uYXBpSW5zdGFuY2UsXG4gIG1vZHVsZTogX193YXNpTW9kdWxlLFxuICBuYXBpTW9kdWxlOiBfX25hcGlNb2R1bGUsXG59ID0gJHtlbW5hcGlJbnN0YW50aWF0ZUNhbGx9KF9fd2FzbUZpbGUsIHtcbiAgY29udGV4dDogX19lbW5hcGlDb250ZXh0LFxuICBhc3luY1dvcmtQb29sU2l6ZTogNCxcbiAgd2FzaTogX193YXNpLFxuICBvbkNyZWF0ZVdvcmtlcigpIHtcbiAgICBjb25zdCB3b3JrZXIgPSBuZXcgV29ya2VyKG5ldyBVUkwoJy4vd2FzaS13b3JrZXItYnJvd3Nlci5tanMnLCBpbXBvcnQubWV0YS51cmwpLCB7XG4gICAgICB0eXBlOiAnbW9kdWxlJyxcbiAgICB9KVxuJHt3b3JrZXJGc0hhbmRsZXJ9XG4ke3dvcmtlckVycm9ySGFuZGxlcn1cbiAgICByZXR1cm4gd29ya2VyXG4gIH0sXG4gIG92ZXJ3cml0ZUltcG9ydHMoaW1wb3J0T2JqZWN0KSB7XG4gICAgaW1wb3J0T2JqZWN0LmVudiA9IHtcbiAgICAgIC4uLmltcG9ydE9iamVjdC5lbnYsXG4gICAgICAuLi5pbXBvcnRPYmplY3QubmFwaSxcbiAgICAgIC4uLmltcG9ydE9iamVjdC5lbW5hcGksXG4gICAgICBtZW1vcnk6IF9fc2hhcmVkTWVtb3J5LFxuICAgIH1cbiAgICByZXR1cm4gaW1wb3J0T2JqZWN0XG4gIH0sXG4gIGJlZm9yZUluaXQoeyBpbnN0YW5jZSB9KSB7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIE9iamVjdC5rZXlzKGluc3RhbmNlLmV4cG9ydHMpKSB7XG4gICAgICBpZiAobmFtZS5zdGFydHNXaXRoKCdfX25hcGlfcmVnaXN0ZXJfXycpKSB7XG4gICAgICAgIGluc3RhbmNlLmV4cG9ydHNbbmFtZV0oKVxuICAgICAgfVxuICAgIH1cbiAgfSxcbn0pXG5gXG59XG5cbmV4cG9ydCBjb25zdCBjcmVhdGVXYXNpQmluZGluZyA9IChcbiAgd2FzbUZpbGVOYW1lOiBzdHJpbmcsXG4gIHBhY2thZ2VOYW1lOiBzdHJpbmcsXG4gIGluaXRpYWxNZW1vcnkgPSA0MDAwLFxuICBtYXhpbXVtTWVtb3J5ID0gNjU1MzYsXG4pID0+IGAvKiBlc2xpbnQtZGlzYWJsZSAqL1xuLyogcHJldHRpZXItaWdub3JlICovXG5cbi8qIGF1dG8tZ2VuZXJhdGVkIGJ5IE5BUEktUlMgKi9cblxuY29uc3QgX19ub2RlRnMgPSByZXF1aXJlKCdub2RlOmZzJylcbmNvbnN0IF9fbm9kZVBhdGggPSByZXF1aXJlKCdub2RlOnBhdGgnKVxuY29uc3QgeyBXQVNJOiBfX25vZGVXQVNJIH0gPSByZXF1aXJlKCdub2RlOndhc2knKVxuY29uc3QgeyBXb3JrZXIgfSA9IHJlcXVpcmUoJ25vZGU6d29ya2VyX3RocmVhZHMnKVxuXG5jb25zdCB7XG4gIGNyZWF0ZU9uTWVzc2FnZTogX193YXNtQ3JlYXRlT25NZXNzYWdlRm9yRnNQcm94eSxcbiAgZ2V0RGVmYXVsdENvbnRleHQ6IF9fZW1uYXBpR2V0RGVmYXVsdENvbnRleHQsXG4gIGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmM6IF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYyxcbn0gPSByZXF1aXJlKCdAbmFwaS1ycy93YXNtLXJ1bnRpbWUnKVxuXG5jb25zdCBfX3Jvb3REaXIgPSBfX25vZGVQYXRoLnBhcnNlKHByb2Nlc3MuY3dkKCkpLnJvb3RcblxuY29uc3QgX193YXNpID0gbmV3IF9fbm9kZVdBU0koe1xuICB2ZXJzaW9uOiAncHJldmlldzEnLFxuICBlbnY6IHByb2Nlc3MuZW52LFxuICBwcmVvcGVuczoge1xuICAgIFtfX3Jvb3REaXJdOiBfX3Jvb3REaXIsXG4gIH1cbn0pXG5cbmNvbnN0IF9fZW1uYXBpQ29udGV4dCA9IF9fZW1uYXBpR2V0RGVmYXVsdENvbnRleHQoKVxuXG5jb25zdCBfX3NoYXJlZE1lbW9yeSA9IG5ldyBXZWJBc3NlbWJseS5NZW1vcnkoe1xuICBpbml0aWFsOiAke2luaXRpYWxNZW1vcnl9LFxuICBtYXhpbXVtOiAke21heGltdW1NZW1vcnl9LFxuICBzaGFyZWQ6IHRydWUsXG59KVxuXG5sZXQgX193YXNtRmlsZVBhdGggPSBfX25vZGVQYXRoLmpvaW4oX19kaXJuYW1lLCAnJHt3YXNtRmlsZU5hbWV9Lndhc20nKVxuY29uc3QgX193YXNtRGVidWdGaWxlUGF0aCA9IF9fbm9kZVBhdGguam9pbihfX2Rpcm5hbWUsICcke3dhc21GaWxlTmFtZX0uZGVidWcud2FzbScpXG5cbmlmIChfX25vZGVGcy5leGlzdHNTeW5jKF9fd2FzbURlYnVnRmlsZVBhdGgpKSB7XG4gIF9fd2FzbUZpbGVQYXRoID0gX193YXNtRGVidWdGaWxlUGF0aFxufSBlbHNlIGlmICghX19ub2RlRnMuZXhpc3RzU3luYyhfX3dhc21GaWxlUGF0aCkpIHtcbiAgdHJ5IHtcbiAgICBfX3dhc21GaWxlUGF0aCA9IHJlcXVpcmUucmVzb2x2ZSgnJHtwYWNrYWdlTmFtZX0td2FzbTMyLXdhc2kvJHt3YXNtRmlsZU5hbWV9Lndhc20nKVxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBmaW5kICR7d2FzbUZpbGVOYW1lfS53YXNtIGZpbGUsIGFuZCAke3BhY2thZ2VOYW1lfS13YXNtMzItd2FzaSBwYWNrYWdlIGlzIG5vdCBpbnN0YWxsZWQuJylcbiAgfVxufVxuXG5jb25zdCB7IGluc3RhbmNlOiBfX25hcGlJbnN0YW5jZSwgbW9kdWxlOiBfX3dhc2lNb2R1bGUsIG5hcGlNb2R1bGU6IF9fbmFwaU1vZHVsZSB9ID0gX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jKF9fbm9kZUZzLnJlYWRGaWxlU3luYyhfX3dhc21GaWxlUGF0aCksIHtcbiAgY29udGV4dDogX19lbW5hcGlDb250ZXh0LFxuICBhc3luY1dvcmtQb29sU2l6ZTogKGZ1bmN0aW9uKCkge1xuICAgIGNvbnN0IHRocmVhZHNTaXplRnJvbUVudiA9IE51bWJlcihwcm9jZXNzLmVudi5OQVBJX1JTX0FTWU5DX1dPUktfUE9PTF9TSVpFID8/IHByb2Nlc3MuZW52LlVWX1RIUkVBRFBPT0xfU0laRSlcbiAgICAvLyBOYU4gPiAwIGlzIGZhbHNlXG4gICAgaWYgKHRocmVhZHNTaXplRnJvbUVudiA+IDApIHtcbiAgICAgIHJldHVybiB0aHJlYWRzU2l6ZUZyb21FbnZcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIDRcbiAgICB9XG4gIH0pKCksXG4gIHJldXNlV29ya2VyOiB0cnVlLFxuICB3YXNpOiBfX3dhc2ksXG4gIG9uQ3JlYXRlV29ya2VyKCkge1xuICAgIGNvbnN0IHdvcmtlciA9IG5ldyBXb3JrZXIoX19ub2RlUGF0aC5qb2luKF9fZGlybmFtZSwgJ3dhc2ktd29ya2VyLm1qcycpLCB7XG4gICAgICBlbnY6IHByb2Nlc3MuZW52LFxuICAgIH0pXG4gICAgd29ya2VyLm9ubWVzc2FnZSA9ICh7IGRhdGEgfSkgPT4ge1xuICAgICAgX193YXNtQ3JlYXRlT25NZXNzYWdlRm9yRnNQcm94eShfX25vZGVGcykoZGF0YSlcbiAgICB9XG5cbiAgICAvLyBUaGUgbWFpbiB0aHJlYWQgb2YgTm9kZS5qcyB3YWl0cyBmb3IgYWxsIHRoZSBhY3RpdmUgaGFuZGxlcyBiZWZvcmUgZXhpdGluZy5cbiAgICAvLyBCdXQgUnVzdCB0aHJlYWRzIGFyZSBuZXZlciB3YWl0ZWQgd2l0aG91dCBcXGB0aHJlYWQ6OmpvaW5cXGAuXG4gICAgLy8gU28gaGVyZSB3ZSBoYWNrIHRoZSBjb2RlIG9mIE5vZGUuanMgdG8gcHJldmVudCB0aGUgd29ya2VycyBmcm9tIGJlaW5nIHJlZmVyZW5jZWQgKGFjdGl2ZSkuXG4gICAgLy8gQWNjb3JkaW5nIHRvIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9ibG9iLzE5ZTBkNDcyNzI4Yzc5ZDQxOGI3NGJkZGZmNTg4YmVhNzBhNDAzZDAvbGliL2ludGVybmFsL3dvcmtlci5qcyNMNDE1LFxuICAgIC8vIGEgd29ya2VyIGlzIGNvbnNpc3Qgb2YgdHdvIGhhbmRsZXM6IGtQdWJsaWNQb3J0IGFuZCBrSGFuZGxlLlxuICAgIHtcbiAgICAgIGNvbnN0IGtQdWJsaWNQb3J0ID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyh3b3JrZXIpLmZpbmQocyA9PlxuICAgICAgICBzLnRvU3RyaW5nKCkuaW5jbHVkZXMoXCJrUHVibGljUG9ydFwiKVxuICAgICAgKTtcbiAgICAgIGlmIChrUHVibGljUG9ydCkge1xuICAgICAgICB3b3JrZXJba1B1YmxpY1BvcnRdLnJlZiA9ICgpID0+IHt9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBrSGFuZGxlID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyh3b3JrZXIpLmZpbmQocyA9PlxuICAgICAgICBzLnRvU3RyaW5nKCkuaW5jbHVkZXMoXCJrSGFuZGxlXCIpXG4gICAgICApO1xuICAgICAgaWYgKGtIYW5kbGUpIHtcbiAgICAgICAgd29ya2VyW2tIYW5kbGVdLnJlZiA9ICgpID0+IHt9O1xuICAgICAgfVxuXG4gICAgICB3b3JrZXIudW5yZWYoKTtcbiAgICB9XG4gICAgcmV0dXJuIHdvcmtlclxuICB9LFxuICBvdmVyd3JpdGVJbXBvcnRzKGltcG9ydE9iamVjdCkge1xuICAgIGltcG9ydE9iamVjdC5lbnYgPSB7XG4gICAgICAuLi5pbXBvcnRPYmplY3QuZW52LFxuICAgICAgLi4uaW1wb3J0T2JqZWN0Lm5hcGksXG4gICAgICAuLi5pbXBvcnRPYmplY3QuZW1uYXBpLFxuICAgICAgbWVtb3J5OiBfX3NoYXJlZE1lbW9yeSxcbiAgICB9XG4gICAgcmV0dXJuIGltcG9ydE9iamVjdFxuICB9LFxuICBiZWZvcmVJbml0KHsgaW5zdGFuY2UgfSkge1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBPYmplY3Qua2V5cyhpbnN0YW5jZS5leHBvcnRzKSkge1xuICAgICAgaWYgKG5hbWUuc3RhcnRzV2l0aCgnX19uYXBpX3JlZ2lzdGVyX18nKSkge1xuICAgICAgICBpbnN0YW5jZS5leHBvcnRzW25hbWVdKClcbiAgICAgIH1cbiAgICB9XG4gIH0sXG59KVxuYFxuIiwiZXhwb3J0IGNvbnN0IFdBU0lfV09SS0VSX1RFTVBMQVRFID0gYGltcG9ydCBmcyBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gXCJub2RlOm1vZHVsZVwiO1xuaW1wb3J0IHsgcGFyc2UgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQgeyBXQVNJIH0gZnJvbSBcIm5vZGU6d2FzaVwiO1xuaW1wb3J0IHsgcGFyZW50UG9ydCwgV29ya2VyIH0gZnJvbSBcIm5vZGU6d29ya2VyX3RocmVhZHNcIjtcblxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKTtcblxuY29uc3QgeyBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jLCBNZXNzYWdlSGFuZGxlciwgZ2V0RGVmYXVsdENvbnRleHQgfSA9IHJlcXVpcmUoXCJAbmFwaS1ycy93YXNtLXJ1bnRpbWVcIik7XG5cbmlmIChwYXJlbnRQb3J0KSB7XG4gIHBhcmVudFBvcnQub24oXCJtZXNzYWdlXCIsIChkYXRhKSA9PiB7XG4gICAgZ2xvYmFsVGhpcy5vbm1lc3NhZ2UoeyBkYXRhIH0pO1xuICB9KTtcbn1cblxuT2JqZWN0LmFzc2lnbihnbG9iYWxUaGlzLCB7XG4gIHNlbGY6IGdsb2JhbFRoaXMsXG4gIHJlcXVpcmUsXG4gIFdvcmtlcixcbiAgaW1wb3J0U2NyaXB0czogZnVuY3Rpb24gKGYpIHtcbiAgICA7KDAsIGV2YWwpKGZzLnJlYWRGaWxlU3luYyhmLCBcInV0ZjhcIikgKyBcIi8vIyBzb3VyY2VVUkw9XCIgKyBmKTtcbiAgfSxcbiAgcG9zdE1lc3NhZ2U6IGZ1bmN0aW9uIChtc2cpIHtcbiAgICBpZiAocGFyZW50UG9ydCkge1xuICAgICAgcGFyZW50UG9ydC5wb3N0TWVzc2FnZShtc2cpO1xuICAgIH1cbiAgfSxcbn0pO1xuXG5jb25zdCBlbW5hcGlDb250ZXh0ID0gZ2V0RGVmYXVsdENvbnRleHQoKTtcblxuY29uc3QgX19yb290RGlyID0gcGFyc2UocHJvY2Vzcy5jd2QoKSkucm9vdDtcblxuY29uc3QgaGFuZGxlciA9IG5ldyBNZXNzYWdlSGFuZGxlcih7XG4gIG9uTG9hZCh7IHdhc21Nb2R1bGUsIHdhc21NZW1vcnkgfSkge1xuICAgIGNvbnN0IHdhc2kgPSBuZXcgV0FTSSh7XG4gICAgICB2ZXJzaW9uOiAncHJldmlldzEnLFxuICAgICAgZW52OiBwcm9jZXNzLmVudixcbiAgICAgIHByZW9wZW5zOiB7XG4gICAgICAgIFtfX3Jvb3REaXJdOiBfX3Jvb3REaXIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMod2FzbU1vZHVsZSwge1xuICAgICAgY2hpbGRUaHJlYWQ6IHRydWUsXG4gICAgICB3YXNpLFxuICAgICAgY29udGV4dDogZW1uYXBpQ29udGV4dCxcbiAgICAgIG92ZXJ3cml0ZUltcG9ydHMoaW1wb3J0T2JqZWN0KSB7XG4gICAgICAgIGltcG9ydE9iamVjdC5lbnYgPSB7XG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0LmVudixcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QubmFwaSxcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QuZW1uYXBpLFxuICAgICAgICAgIG1lbW9yeTogd2FzbU1lbW9yeVxuICAgICAgICB9O1xuICAgICAgfSxcbiAgICB9KTtcbiAgfSxcbn0pO1xuXG5nbG9iYWxUaGlzLm9ubWVzc2FnZSA9IGZ1bmN0aW9uIChlKSB7XG4gIGhhbmRsZXIuaGFuZGxlKGUpO1xufTtcbmBcblxuZXhwb3J0IGNvbnN0IGNyZWF0ZVdhc2lCcm93c2VyV29ya2VyQmluZGluZyA9IChcbiAgZnM6IGJvb2xlYW4sXG4gIGVycm9yRXZlbnQ6IGJvb2xlYW4sXG4pID0+IHtcbiAgY29uc3QgZnNJbXBvcnQgPSBmc1xuICAgID8gYGltcG9ydCB7IGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMsIE1lc3NhZ2VIYW5kbGVyLCBXQVNJLCBjcmVhdGVGc1Byb3h5IH0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lJ1xuaW1wb3J0IHsgbWVtZnNFeHBvcnRlZCBhcyBfX21lbWZzRXhwb3J0ZWQgfSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUvZnMnXG5cbmNvbnN0IGZzID0gY3JlYXRlRnNQcm94eShfX21lbWZzRXhwb3J0ZWQpYFxuICAgIDogYGltcG9ydCB7IGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMsIE1lc3NhZ2VIYW5kbGVyLCBXQVNJIH0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lJ2BcbiAgY29uc3QgZXJyb3JPdXRwdXRzQXBwZW5kID0gZXJyb3JFdmVudFxuICAgID8gYFxcbiAgICAgICAgZXJyb3JPdXRwdXRzLnB1c2goWy4uLmFyZ3VtZW50c10pYFxuICAgIDogJydcbiAgY29uc3Qgd2FzaUNyZWF0aW9uID0gZnNcbiAgICA/IGBjb25zdCB3YXNpID0gbmV3IFdBU0koe1xuICAgICAgZnMsXG4gICAgICBwcmVvcGVuczoge1xuICAgICAgICAnLyc6ICcvJyxcbiAgICAgIH0sXG4gICAgICBwcmludDogZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmxvZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG4gICAgICB9LFxuICAgICAgcHJpbnRFcnI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cylcbiAgICAgICAgJHtlcnJvck91dHB1dHNBcHBlbmR9XG4gICAgICB9LFxuICAgIH0pYFxuICAgIDogYGNvbnN0IHdhc2kgPSBuZXcgV0FTSSh7XG4gICAgICBwcmludDogZnVuY3Rpb24gKCkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmxvZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG4gICAgICB9LFxuICAgICAgcHJpbnRFcnI6IGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc29sZVxuICAgICAgICBjb25zb2xlLmVycm9yLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cylcbiAgICAgICAgJHtlcnJvck91dHB1dHNBcHBlbmR9XG4gICAgICB9LFxuICAgIH0pYFxuICBjb25zdCBlcnJvckhhbmRsZXIgPSBlcnJvckV2ZW50XG4gICAgPyBgb25FcnJvcihlcnJvcikge1xuICAgIHBvc3RNZXNzYWdlKHsgdHlwZTogJ2Vycm9yJywgZXJyb3IsIGVycm9yT3V0cHV0cyB9KVxuICAgIGVycm9yT3V0cHV0cy5sZW5ndGggPSAwXG4gIH1gXG4gICAgOiAnJ1xuICByZXR1cm4gYCR7ZnNJbXBvcnR9XG5cbmNvbnN0IGVycm9yT3V0cHV0cyA9IFtdXG5cbmNvbnN0IGhhbmRsZXIgPSBuZXcgTWVzc2FnZUhhbmRsZXIoe1xuICBvbkxvYWQoeyB3YXNtTW9kdWxlLCB3YXNtTWVtb3J5IH0pIHtcbiAgICAke3dhc2lDcmVhdGlvbn1cbiAgICByZXR1cm4gaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYyh3YXNtTW9kdWxlLCB7XG4gICAgICBjaGlsZFRocmVhZDogdHJ1ZSxcbiAgICAgIHdhc2ksXG4gICAgICBvdmVyd3JpdGVJbXBvcnRzKGltcG9ydE9iamVjdCkge1xuICAgICAgICBpbXBvcnRPYmplY3QuZW52ID0ge1xuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5lbnYsXG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0Lm5hcGksXG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0LmVtbmFwaSxcbiAgICAgICAgICBtZW1vcnk6IHdhc21NZW1vcnksXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSlcbiAgfSxcbiAgJHtlcnJvckhhbmRsZXJ9XG59KVxuXG5nbG9iYWxUaGlzLm9ubWVzc2FnZSA9IGZ1bmN0aW9uIChlKSB7XG4gIGhhbmRsZXIuaGFuZGxlKGUpXG59XG5gXG59XG4iLCJpbXBvcnQgeyBzcGF3biB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCB7IGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcm1TeW5jIH0gZnJvbSAnbm9kZTpmcydcbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSdcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHsgcGFyc2UsIGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCAqIGFzIGNvbG9ycyBmcm9tICdjb2xvcmV0dGUnXG5cbmltcG9ydCB0eXBlIHsgQnVpbGRPcHRpb25zIGFzIFJhd0J1aWxkT3B0aW9ucyB9IGZyb20gJy4uL2RlZi9idWlsZC5qcydcbmltcG9ydCB7XG4gIENMSV9WRVJTSU9OLFxuICBjb3B5RmlsZUFzeW5jLFxuICB0eXBlIENyYXRlLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIERFRkFVTFRfVFlQRV9ERUZfSEVBREVSLFxuICBmaWxlRXhpc3RzLFxuICBnZXRTeXN0ZW1EZWZhdWx0VGFyZ2V0LFxuICBnZXRUYXJnZXRMaW5rZXIsXG4gIG1rZGlyQXN5bmMsXG4gIHR5cGUgTmFwaUNvbmZpZyxcbiAgcGFyc2VNZXRhZGF0YSxcbiAgcGFyc2VUcmlwbGUsXG4gIHByb2Nlc3NUeXBlRGVmLFxuICByZWFkRmlsZUFzeW5jLFxuICByZWFkTmFwaUNvbmZpZyxcbiAgdHlwZSBUYXJnZXQsXG4gIHRhcmdldFRvRW52VmFyLFxuICB0cnlJbnN0YWxsQ2FyZ29CaW5hcnksXG4gIHVubGlua0FzeW5jLFxuICB3cml0ZUZpbGVBc3luYyxcbiAgZGlyRXhpc3RzQXN5bmMsXG4gIHJlYWRkaXJBc3luYyxcbiAgdHlwZSBDYXJnb1dvcmtzcGFjZU1ldGFkYXRhLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuaW1wb3J0IHsgY3JlYXRlQ2pzQmluZGluZywgY3JlYXRlRXNtQmluZGluZyB9IGZyb20gJy4vdGVtcGxhdGVzL2luZGV4LmpzJ1xuaW1wb3J0IHtcbiAgY3JlYXRlV2FzaUJpbmRpbmcsXG4gIGNyZWF0ZVdhc2lCcm93c2VyQmluZGluZyxcbn0gZnJvbSAnLi90ZW1wbGF0ZXMvbG9hZC13YXNpLXRlbXBsYXRlLmpzJ1xuaW1wb3J0IHtcbiAgY3JlYXRlV2FzaUJyb3dzZXJXb3JrZXJCaW5kaW5nLFxuICBXQVNJX1dPUktFUl9URU1QTEFURSxcbn0gZnJvbSAnLi90ZW1wbGF0ZXMvd2FzaS13b3JrZXItdGVtcGxhdGUuanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCdidWlsZCcpXG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpXG5cbnR5cGUgT3V0cHV0S2luZCA9ICdqcycgfCAnZHRzJyB8ICdub2RlJyB8ICdleGUnIHwgJ3dhc20nXG50eXBlIE91dHB1dCA9IHsga2luZDogT3V0cHV0S2luZDsgcGF0aDogc3RyaW5nIH1cblxudHlwZSBCdWlsZE9wdGlvbnMgPSBSYXdCdWlsZE9wdGlvbnMgJiB7IGNhcmdvT3B0aW9ucz86IHN0cmluZ1tdIH1cbnR5cGUgUGFyc2VkQnVpbGRPcHRpb25zID0gT21pdDxCdWlsZE9wdGlvbnMsICdjd2QnPiAmIHsgY3dkOiBzdHJpbmcgfVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYnVpbGRQcm9qZWN0KHJhd09wdGlvbnM6IEJ1aWxkT3B0aW9ucykge1xuICBkZWJ1ZygnbmFwaSBidWlsZCBjb21tYW5kIHJlY2VpdmUgb3B0aW9uczogJU8nLCByYXdPcHRpb25zKVxuXG4gIGNvbnN0IG9wdGlvbnM6IFBhcnNlZEJ1aWxkT3B0aW9ucyA9IHtcbiAgICBkdHNDYWNoZTogdHJ1ZSxcbiAgICAuLi5yYXdPcHRpb25zLFxuICAgIGN3ZDogcmF3T3B0aW9ucy5jd2QgPz8gcHJvY2Vzcy5jd2QoKSxcbiAgfVxuXG4gIGNvbnN0IHJlc29sdmVQYXRoID0gKC4uLnBhdGhzOiBzdHJpbmdbXSkgPT4gcmVzb2x2ZShvcHRpb25zLmN3ZCwgLi4ucGF0aHMpXG5cbiAgY29uc3QgbWFuaWZlc3RQYXRoID0gcmVzb2x2ZVBhdGgob3B0aW9ucy5tYW5pZmVzdFBhdGggPz8gJ0NhcmdvLnRvbWwnKVxuICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHBhcnNlTWV0YWRhdGEobWFuaWZlc3RQYXRoKVxuXG4gIGNvbnN0IGNyYXRlID0gbWV0YWRhdGEucGFja2FnZXMuZmluZCgocCkgPT4ge1xuICAgIC8vIHBhY2thZ2Ugd2l0aCBnaXZlbiBuYW1lXG4gICAgaWYgKG9wdGlvbnMucGFja2FnZSkge1xuICAgICAgcmV0dXJuIHAubmFtZSA9PT0gb3B0aW9ucy5wYWNrYWdlXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBwLm1hbmlmZXN0X3BhdGggPT09IG1hbmlmZXN0UGF0aFxuICAgIH1cbiAgfSlcblxuICBpZiAoIWNyYXRlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ1VuYWJsZSB0byBmaW5kIGNyYXRlIHRvIGJ1aWxkLiBJdCBzZWVtcyB5b3UgYXJlIHRyeWluZyB0byBidWlsZCBhIGNyYXRlIGluIGEgd29ya3NwYWNlLCB0cnkgdXNpbmcgYC0tcGFja2FnZWAgb3B0aW9uIHRvIHNwZWNpZnkgdGhlIHBhY2thZ2UgdG8gYnVpbGQuJyxcbiAgICApXG4gIH1cbiAgY29uc3QgY29uZmlnID0gYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgcmVzb2x2ZVBhdGgob3B0aW9ucy5wYWNrYWdlSnNvblBhdGggPz8gJ3BhY2thZ2UuanNvbicpLFxuICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmVQYXRoKG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gIClcblxuICBjb25zdCBidWlsZGVyID0gbmV3IEJ1aWxkZXIobWV0YWRhdGEsIGNyYXRlLCBjb25maWcsIG9wdGlvbnMpXG5cbiAgcmV0dXJuIGJ1aWxkZXIuYnVpbGQoKVxufVxuXG5jbGFzcyBCdWlsZGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBhcmdzOiBzdHJpbmdbXSA9IFtdXG4gIHByaXZhdGUgcmVhZG9ubHkgZW52czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0czogT3V0cHV0W10gPSBbXVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgdGFyZ2V0OiBUYXJnZXRcbiAgcHJpdmF0ZSByZWFkb25seSBjcmF0ZURpcjogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgb3V0cHV0RGlyOiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSB0YXJnZXREaXI6IHN0cmluZ1xuICBwcml2YXRlIHJlYWRvbmx5IGVuYWJsZVR5cGVEZWY6IGJvb2xlYW4gPSBmYWxzZVxuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbWV0YWRhdGE6IENhcmdvV29ya3NwYWNlTWV0YWRhdGEsXG4gICAgcHJpdmF0ZSByZWFkb25seSBjcmF0ZTogQ3JhdGUsXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IE5hcGlDb25maWcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBQYXJzZWRCdWlsZE9wdGlvbnMsXG4gICkge1xuICAgIHRoaXMudGFyZ2V0ID0gb3B0aW9ucy50YXJnZXRcbiAgICAgID8gcGFyc2VUcmlwbGUob3B0aW9ucy50YXJnZXQpXG4gICAgICA6IHByb2Nlc3MuZW52LkNBUkdPX0JVSUxEX1RBUkdFVFxuICAgICAgICA/IHBhcnNlVHJpcGxlKHByb2Nlc3MuZW52LkNBUkdPX0JVSUxEX1RBUkdFVClcbiAgICAgICAgOiBnZXRTeXN0ZW1EZWZhdWx0VGFyZ2V0KClcbiAgICB0aGlzLmNyYXRlRGlyID0gcGFyc2UoY3JhdGUubWFuaWZlc3RfcGF0aCkuZGlyXG4gICAgdGhpcy5vdXRwdXREaXIgPSByZXNvbHZlKFxuICAgICAgdGhpcy5vcHRpb25zLmN3ZCxcbiAgICAgIG9wdGlvbnMub3V0cHV0RGlyID8/IHRoaXMuY3JhdGVEaXIsXG4gICAgKVxuICAgIHRoaXMudGFyZ2V0RGlyID1cbiAgICAgIG9wdGlvbnMudGFyZ2V0RGlyID8/XG4gICAgICBwcm9jZXNzLmVudi5DQVJHT19CVUlMRF9UQVJHRVRfRElSID8/XG4gICAgICBtZXRhZGF0YS50YXJnZXRfZGlyZWN0b3J5XG4gICAgdGhpcy5lbmFibGVUeXBlRGVmID0gdGhpcy5jcmF0ZS5kZXBlbmRlbmNpZXMuc29tZShcbiAgICAgIChkZXApID0+XG4gICAgICAgIGRlcC5uYW1lID09PSAnbmFwaS1kZXJpdmUnICYmXG4gICAgICAgIChkZXAudXNlc19kZWZhdWx0X2ZlYXR1cmVzIHx8IGRlcC5mZWF0dXJlcy5pbmNsdWRlcygndHlwZS1kZWYnKSksXG4gICAgKVxuXG4gICAgaWYgKCF0aGlzLmVuYWJsZVR5cGVEZWYpIHtcbiAgICAgIGNvbnN0IHJlcXVpcmVtZW50V2FybmluZyA9XG4gICAgICAgICdgbmFwaS1kZXJpdmVgIGNyYXRlIGlzIG5vdCB1c2VkIG9yIGB0eXBlLWRlZmAgZmVhdHVyZSBpcyBub3QgZW5hYmxlZCBmb3IgYG5hcGktZGVyaXZlYCBjcmF0ZSdcbiAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgIGAke3JlcXVpcmVtZW50V2FybmluZ30uIFdpbGwgc2tpcCBiaW5kaW5nIGdlbmVyYXRpb24gZm9yIFxcYC5ub2RlXFxgLCBcXGAud2FzaVxcYCBhbmQgXFxgLmQudHNcXGAgZmlsZXMuYCxcbiAgICAgIClcblxuICAgICAgaWYgKFxuICAgICAgICB0aGlzLm9wdGlvbnMuZHRzIHx8XG4gICAgICAgIHRoaXMub3B0aW9ucy5kdHNIZWFkZXIgfHxcbiAgICAgICAgdGhpcy5jb25maWcuZHRzSGVhZGVyIHx8XG4gICAgICAgIHRoaXMuY29uZmlnLmR0c0hlYWRlckZpbGVcbiAgICAgICkge1xuICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgIGAke3JlcXVpcmVtZW50V2FybmluZ30uIFxcYGR0c1xcYCByZWxhdGVkIG9wdGlvbnMgYXJlIGVuYWJsZWQgYnV0IHdpbGwgYmUgaWdub3JlZC5gLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0IGNkeUxpYk5hbWUoKSB7XG4gICAgcmV0dXJuIHRoaXMuY3JhdGUudGFyZ2V0cy5maW5kKCh0KSA9PiB0LmNyYXRlX3R5cGVzLmluY2x1ZGVzKCdjZHlsaWInKSlcbiAgICAgID8ubmFtZVxuICB9XG5cbiAgZ2V0IGJpbk5hbWUoKSB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMub3B0aW9ucy5iaW4gPz9cbiAgICAgIC8vIG9ubHkgYXZhaWxhYmxlIGlmIG5vdCBjZHlsaWIgb3IgYmluIG5hbWUgc3BlY2lmaWVkXG4gICAgICAodGhpcy5jZHlMaWJOYW1lXG4gICAgICAgID8gbnVsbFxuICAgICAgICA6IHRoaXMuY3JhdGUudGFyZ2V0cy5maW5kKCh0KSA9PiB0LmNyYXRlX3R5cGVzLmluY2x1ZGVzKCdiaW4nKSk/Lm5hbWUpXG4gICAgKVxuICB9XG5cbiAgYnVpbGQoKSB7XG4gICAgaWYgKCF0aGlzLmNkeUxpYk5hbWUpIHtcbiAgICAgIGNvbnN0IHdhcm5pbmcgPVxuICAgICAgICAnTWlzc2luZyBgY3JhdGUtdHlwZSA9IFtcImNkeWxpYlwiXWAgaW4gW2xpYl0gY29uZmlnLiBUaGUgYnVpbGQgcmVzdWx0IHdpbGwgbm90IGJlIGF2YWlsYWJsZSBhcyBub2RlIGFkZG9uLidcblxuICAgICAgaWYgKHRoaXMuYmluTmFtZSkge1xuICAgICAgICBkZWJ1Zy53YXJuKHdhcm5pbmcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3Iod2FybmluZylcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5waWNrQmluYXJ5KClcbiAgICAgIC5zZXRQYWNrYWdlKClcbiAgICAgIC5zZXRGZWF0dXJlcygpXG4gICAgICAuc2V0VGFyZ2V0KClcbiAgICAgIC5waWNrQ3Jvc3NUb29sY2hhaW4oKVxuICAgICAgLnNldEVudnMoKVxuICAgICAgLnNldEJ5cGFzc0FyZ3MoKVxuICAgICAgLmV4ZWMoKVxuICB9XG5cbiAgcHJpdmF0ZSBwaWNrQ3Jvc3NUb29sY2hhaW4oKSB7XG4gICAgaWYgKCF0aGlzLm9wdGlvbnMudXNlTmFwaUNyb3NzKSB7XG4gICAgICByZXR1cm4gdGhpc1xuICAgIH1cbiAgICBpZiAodGhpcy5vcHRpb25zLnVzZUNyb3NzKSB7XG4gICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAnWW91IGFyZSB0cnlpbmcgdG8gdXNlIGJvdGggYC0tY3Jvc3NgIGFuZCBgLS11c2UtbmFwaS1jcm9zc2Agb3B0aW9ucywgYC0tdXNlLWNyb3NzYCB3aWxsIGJlIGlnbm9yZWQuJyxcbiAgICAgIClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLmNyb3NzQ29tcGlsZSkge1xuICAgICAgZGVidWcud2FybihcbiAgICAgICAgJ1lvdSBhcmUgdHJ5aW5nIHRvIHVzZSBib3RoIGAtLWNyb3NzLWNvbXBpbGVgIGFuZCBgLS11c2UtbmFwaS1jcm9zc2Agb3B0aW9ucywgYC0tY3Jvc3MtY29tcGlsZWAgd2lsbCBiZSBpZ25vcmVkLicsXG4gICAgICApXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgdmVyc2lvbiwgZG93bmxvYWQgfSA9IHJlcXVpcmUoJ0BuYXBpLXJzL2Nyb3NzLXRvb2xjaGFpbicpXG5cbiAgICAgIGNvbnN0IGFsaWFzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICAnczM5MHgtdW5rbm93bi1saW51eC1nbnUnOiAnczM5MHgtaWJtLWxpbnV4LWdudScsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRvb2xjaGFpblBhdGggPSBqb2luKFxuICAgICAgICBob21lZGlyKCksXG4gICAgICAgICcubmFwaS1ycycsXG4gICAgICAgICdjcm9zcy10b29sY2hhaW4nLFxuICAgICAgICB2ZXJzaW9uLFxuICAgICAgICB0aGlzLnRhcmdldC50cmlwbGUsXG4gICAgICApXG4gICAgICBta2RpclN5bmModG9vbGNoYWluUGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgICAgIGlmIChleGlzdHNTeW5jKGpvaW4odG9vbGNoYWluUGF0aCwgJ3BhY2thZ2UuanNvbicpKSkge1xuICAgICAgICBkZWJ1ZyhgVG9vbGNoYWluICR7dG9vbGNoYWluUGF0aH0gZXhpc3RzLCBza2lwIGV4dHJhY3RpbmdgKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgdGFyQXJjaGl2ZSA9IGRvd25sb2FkKHByb2Nlc3MuYXJjaCwgdGhpcy50YXJnZXQudHJpcGxlKVxuICAgICAgICB0YXJBcmNoaXZlLnVucGFjayh0b29sY2hhaW5QYXRoKVxuICAgICAgfVxuICAgICAgY29uc3QgdXBwZXJDYXNlVGFyZ2V0ID0gdGFyZ2V0VG9FbnZWYXIodGhpcy50YXJnZXQudHJpcGxlKVxuICAgICAgY29uc3QgY3Jvc3NUYXJnZXROYW1lID0gYWxpYXNbdGhpcy50YXJnZXQudHJpcGxlXSA/PyB0aGlzLnRhcmdldC50cmlwbGVcbiAgICAgIGNvbnN0IGxpbmtlckVudiA9IGBDQVJHT19UQVJHRVRfJHt1cHBlckNhc2VUYXJnZXR9X0xJTktFUmBcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgIGxpbmtlckVudixcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1nY2NgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfU1lTUk9PVCcsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgY3Jvc3NUYXJnZXROYW1lLCAnc3lzcm9vdCcpLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9BUicsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tYXJgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfUkFOTElCJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1yYW5saWJgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfUkVBREVMRicsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tcmVhZGVsZmApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DX0lOQ0xVREVfUEFUSCcsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgY3Jvc3NUYXJnZXROYW1lLCAnc3lzcm9vdCcsICd1c3InLCAnaW5jbHVkZS8nKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ0MnLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LWdjY2ApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DWFgnLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LWcrK2ApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ0JJTkRHRU5fRVhUUkFfQ0xBTkdfQVJHUycsXG4gICAgICAgIGAtLXN5c3Jvb3Q9JHt0aGlzLmVudnMuVEFSR0VUX1NZU1JPT1R9fWAsXG4gICAgICApXG5cbiAgICAgIGlmIChcbiAgICAgICAgcHJvY2Vzcy5lbnYuVEFSR0VUX0NDPy5zdGFydHNXaXRoKCdjbGFuZycpIHx8XG4gICAgICAgIChwcm9jZXNzLmVudi5DQz8uc3RhcnRzV2l0aCgnY2xhbmcnKSAmJiAhcHJvY2Vzcy5lbnYuVEFSR0VUX0NDKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IFRBUkdFVF9DRkxBR1MgPSBwcm9jZXNzLmVudi5UQVJHRVRfQ0ZMQUdTID8/ICcnXG4gICAgICAgIHRoaXMuZW52cy5UQVJHRVRfQ0ZMQUdTID0gYC0tc3lzcm9vdD0ke3RoaXMuZW52cy5UQVJHRVRfU1lTUk9PVH0gLS1nY2MtdG9vbGNoYWluPSR7dG9vbGNoYWluUGF0aH0gJHtUQVJHRVRfQ0ZMQUdTfWBcbiAgICAgIH1cbiAgICAgIGlmIChcbiAgICAgICAgKHByb2Nlc3MuZW52LkNYWD8uc3RhcnRzV2l0aCgnY2xhbmcrKycpICYmICFwcm9jZXNzLmVudi5UQVJHRVRfQ1hYKSB8fFxuICAgICAgICBwcm9jZXNzLmVudi5UQVJHRVRfQ1hYPy5zdGFydHNXaXRoKCdjbGFuZysrJylcbiAgICAgICkge1xuICAgICAgICBjb25zdCBUQVJHRVRfQ1hYRkxBR1MgPSBwcm9jZXNzLmVudi5UQVJHRVRfQ1hYRkxBR1MgPz8gJydcbiAgICAgICAgdGhpcy5lbnZzLlRBUkdFVF9DWFhGTEFHUyA9IGAtLXN5c3Jvb3Q9JHt0aGlzLmVudnMuVEFSR0VUX1NZU1JPT1R9IC0tZ2NjLXRvb2xjaGFpbj0ke3Rvb2xjaGFpblBhdGh9ICR7VEFSR0VUX0NYWEZMQUdTfWBcbiAgICAgIH1cbiAgICAgIHRoaXMuZW52cy5QQVRIID0gdGhpcy5lbnZzLlBBVEhcbiAgICAgICAgPyBgJHt0b29sY2hhaW5QYXRofS9iaW46JHt0aGlzLmVudnMuUEFUSH06JHtwcm9jZXNzLmVudi5QQVRIfWBcbiAgICAgICAgOiBgJHt0b29sY2hhaW5QYXRofS9iaW46JHtwcm9jZXNzLmVudi5QQVRIfWBcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBkZWJ1Zy53YXJuKCdQaWNrIGNyb3NzIHRvb2xjaGFpbiBmYWlsZWQnLCBlIGFzIEVycm9yKVxuICAgICAgLy8gaWdub3JlLCBkbyBub3RoaW5nXG4gICAgfVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIGV4ZWMoKSB7XG4gICAgZGVidWcoYFN0YXJ0IGJ1aWxkaW5nIGNyYXRlOiAke3RoaXMuY3JhdGUubmFtZX1gKVxuICAgIGRlYnVnKCcgICVpJywgYGNhcmdvICR7dGhpcy5hcmdzLmpvaW4oJyAnKX1gKVxuXG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKVxuXG4gICAgY29uc3Qgd2F0Y2ggPSB0aGlzLm9wdGlvbnMud2F0Y2hcbiAgICBjb25zdCBidWlsZFRhc2sgPSBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBpZiAodGhpcy5vcHRpb25zLnVzZUNyb3NzICYmIHRoaXMub3B0aW9ucy5jcm9zc0NvbXBpbGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICdgLS11c2UtY3Jvc3NgIGFuZCBgLS1jcm9zcy1jb21waWxlYCBjYW4gbm90IGJlIHVzZWQgdG9nZXRoZXInLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBjb25zdCBjb21tYW5kID1cbiAgICAgICAgcHJvY2Vzcy5lbnYuQ0FSR08gPz8gKHRoaXMub3B0aW9ucy51c2VDcm9zcyA/ICdjcm9zcycgOiAnY2FyZ28nKVxuICAgICAgY29uc3QgYnVpbGRQcm9jZXNzID0gc3Bhd24oY29tbWFuZCwgdGhpcy5hcmdzLCB7XG4gICAgICAgIGVudjogeyAuLi5wcm9jZXNzLmVudiwgLi4udGhpcy5lbnZzIH0sXG4gICAgICAgIHN0ZGlvOiB3YXRjaCA/IFsnaW5oZXJpdCcsICdpbmhlcml0JywgJ3BpcGUnXSA6ICdpbmhlcml0JyxcbiAgICAgICAgY3dkOiB0aGlzLm9wdGlvbnMuY3dkLFxuICAgICAgICBzaWduYWw6IGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgfSlcblxuICAgICAgYnVpbGRQcm9jZXNzLm9uY2UoJ2V4aXQnLCAoY29kZSkgPT4ge1xuICAgICAgICBpZiAoY29kZSA9PT0gMCkge1xuICAgICAgICAgIGRlYnVnKCclaScsIGBCdWlsZCBjcmF0ZSAke3RoaXMuY3JhdGUubmFtZX0gc3VjY2Vzc2Z1bGx5IWApXG4gICAgICAgICAgcmVzb2x2ZSgpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQnVpbGQgZmFpbGVkIHdpdGggZXhpdCBjb2RlICR7Y29kZX1gKSlcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgICAgYnVpbGRQcm9jZXNzLm9uY2UoJ2Vycm9yJywgKGUpID0+IHtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihgQnVpbGQgZmFpbGVkIHdpdGggZXJyb3I6ICR7ZS5tZXNzYWdlfWAsIHsgY2F1c2U6IGUgfSkpXG4gICAgICB9KVxuXG4gICAgICAvLyB3YXRjaCBtb2RlIG9ubHksIHRoZXkgYXJlIHBpcGVkIHRocm91Z2ggc3RkZXJyXG4gICAgICBidWlsZFByb2Nlc3Muc3RkZXJyPy5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgICAgIGNvbnN0IG91dHB1dCA9IGRhdGEudG9TdHJpbmcoKVxuICAgICAgICBjb25zb2xlLmVycm9yKG91dHB1dClcbiAgICAgICAgaWYgKC9GaW5pc2hlZFxccyhgZGV2YHxgcmVsZWFzZWApLy50ZXN0KG91dHB1dCkpIHtcbiAgICAgICAgICB0aGlzLnBvc3RCdWlsZCgpLmNhdGNoKCgpID0+IHt9KVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG5cbiAgICByZXR1cm4ge1xuICAgICAgdGFzazogYnVpbGRUYXNrLnRoZW4oKCkgPT4gdGhpcy5wb3N0QnVpbGQoKSksXG4gICAgICBhYm9ydDogKCkgPT4gY29udHJvbGxlci5hYm9ydCgpLFxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGlja0JpbmFyeSgpIHtcbiAgICBsZXQgc2V0ID0gZmFsc2VcbiAgICBpZiAodGhpcy5vcHRpb25zLndhdGNoKSB7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuQ0kpIHtcbiAgICAgICAgZGVidWcud2FybignV2F0Y2ggbW9kZSBpcyBub3Qgc3VwcG9ydGVkIGluIENJIGVudmlyb25tZW50JylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlYnVnKCdVc2UgJWknLCAnY2FyZ28td2F0Y2gnKVxuICAgICAgICB0cnlJbnN0YWxsQ2FyZ29CaW5hcnkoJ2NhcmdvLXdhdGNoJywgJ3dhdGNoJylcbiAgICAgICAgLy8geWFybiBuYXBpIHdhdGNoIC0tdGFyZ2V0IHg4Nl82NC11bmtub3duLWxpbnV4LWdudSBbLS1jcm9zcy1jb21waWxlXVxuICAgICAgICAvLyA9PT0+XG4gICAgICAgIC8vIGNhcmdvIHdhdGNoIFsuLi5dIC0tIGJ1aWxkIC0tdGFyZ2V0IHg4Nl82NC11bmtub3duLWxpbnV4LWdudVxuICAgICAgICAvLyBjYXJnbyB3YXRjaCBbLi4uXSAtLSB6aWdidWlsZCAtLXRhcmdldCB4ODZfNjQtdW5rbm93bi1saW51eC1nbnVcbiAgICAgICAgdGhpcy5hcmdzLnB1c2goXG4gICAgICAgICAgJ3dhdGNoJyxcbiAgICAgICAgICAnLS13aHknLFxuICAgICAgICAgICctaScsXG4gICAgICAgICAgJyoue2pzLHRzLG5vZGV9JyxcbiAgICAgICAgICAnLXcnLFxuICAgICAgICAgIHRoaXMuY3JhdGVEaXIsXG4gICAgICAgICAgJy0tJyxcbiAgICAgICAgICAnY2FyZ28nLFxuICAgICAgICAgICdidWlsZCcsXG4gICAgICAgIClcbiAgICAgICAgc2V0ID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMuY3Jvc3NDb21waWxlKSB7XG4gICAgICBpZiAodGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicpIHtcbiAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgJ1lvdSBhcmUgdHJ5aW5nIHRvIGNyb3NzIGNvbXBpbGUgdG8gd2luMzIgcGxhdGZvcm0gb24gd2luMzIgcGxhdGZvcm0gd2hpY2ggaXMgdW5uZWNlc3NhcnkuJyxcbiAgICAgICAgICApXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdXNlIGNhcmdvLXh3aW4gdG8gY3Jvc3MgY29tcGlsZSB0byB3aW4zMiBwbGF0Zm9ybVxuICAgICAgICAgIGRlYnVnKCdVc2UgJWknLCAnY2FyZ28teHdpbicpXG4gICAgICAgICAgdHJ5SW5zdGFsbENhcmdvQmluYXJ5KCdjYXJnby14d2luJywgJ3h3aW4nKVxuICAgICAgICAgIHRoaXMuYXJncy5wdXNoKCd4d2luJywgJ2J1aWxkJylcbiAgICAgICAgICBpZiAodGhpcy50YXJnZXQuYXJjaCA9PT0gJ2lhMzInKSB7XG4gICAgICAgICAgICB0aGlzLmVudnMuWFdJTl9BUkNIID0gJ3g4NidcbiAgICAgICAgICB9XG4gICAgICAgICAgc2V0ID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICdsaW51eCcgJiZcbiAgICAgICAgICBwcm9jZXNzLnBsYXRmb3JtID09PSAnbGludXgnICYmXG4gICAgICAgICAgdGhpcy50YXJnZXQuYXJjaCA9PT0gcHJvY2Vzcy5hcmNoICYmXG4gICAgICAgICAgKGZ1bmN0aW9uIChhYmk6IHN0cmluZyB8IG51bGwpIHtcbiAgICAgICAgICAgIGNvbnN0IGdsaWJjVmVyc2lvblJ1bnRpbWUgPVxuICAgICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgICAgICAgICAgIHByb2Nlc3MucmVwb3J0Py5nZXRSZXBvcnQoKT8uaGVhZGVyPy5nbGliY1ZlcnNpb25SdW50aW1lXG4gICAgICAgICAgICBjb25zdCBsaWJjID0gZ2xpYmNWZXJzaW9uUnVudGltZSA/ICdnbnUnIDogJ211c2wnXG4gICAgICAgICAgICByZXR1cm4gYWJpID09PSBsaWJjXG4gICAgICAgICAgfSkodGhpcy50YXJnZXQuYWJpKVxuICAgICAgICApIHtcbiAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgJ1lvdSBhcmUgdHJ5aW5nIHRvIGNyb3NzIGNvbXBpbGUgdG8gbGludXggdGFyZ2V0IG9uIGxpbnV4IHBsYXRmb3JtIHdoaWNoIGlzIHVubmVjZXNzYXJ5LicsXG4gICAgICAgICAgKVxuICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgIHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnZGFyd2luJyAmJlxuICAgICAgICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nXG4gICAgICAgICkge1xuICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICAnWW91IGFyZSB0cnlpbmcgdG8gY3Jvc3MgY29tcGlsZSB0byBkYXJ3aW4gdGFyZ2V0IG9uIGRhcndpbiBwbGF0Zm9ybSB3aGljaCBpcyB1bm5lY2Vzc2FyeS4nLFxuICAgICAgICAgIClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB1c2UgY2FyZ28temlnYnVpbGQgdG8gY3Jvc3MgY29tcGlsZSB0byBvdGhlciBwbGF0Zm9ybXNcbiAgICAgICAgICBkZWJ1ZygnVXNlICVpJywgJ2NhcmdvLXppZ2J1aWxkJylcbiAgICAgICAgICB0cnlJbnN0YWxsQ2FyZ29CaW5hcnkoJ2NhcmdvLXppZ2J1aWxkJywgJ3ppZ2J1aWxkJylcbiAgICAgICAgICB0aGlzLmFyZ3MucHVzaCgnemlnYnVpbGQnKVxuICAgICAgICAgIHNldCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghc2V0KSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnYnVpbGQnKVxuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRQYWNrYWdlKCkge1xuICAgIGNvbnN0IGFyZ3MgPSBbXVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5wYWNrYWdlKSB7XG4gICAgICBhcmdzLnB1c2goJy0tcGFja2FnZScsIHRoaXMub3B0aW9ucy5wYWNrYWdlKVxuICAgIH1cblxuICAgIGlmICh0aGlzLmJpbk5hbWUpIHtcbiAgICAgIGFyZ3MucHVzaCgnLS1iaW4nLCB0aGlzLmJpbk5hbWUpXG4gICAgfVxuXG4gICAgaWYgKGFyZ3MubGVuZ3RoKSB7XG4gICAgICBkZWJ1ZygnU2V0IHBhY2thZ2UgZmxhZ3M6ICcpXG4gICAgICBkZWJ1ZygnICAlTycsIGFyZ3MpXG4gICAgICB0aGlzLmFyZ3MucHVzaCguLi5hcmdzKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIHNldFRhcmdldCgpIHtcbiAgICBkZWJ1ZygnU2V0IGNvbXBpbGluZyB0YXJnZXQgdG86ICcpXG4gICAgZGVidWcoJyAgJWknLCB0aGlzLnRhcmdldC50cmlwbGUpXG5cbiAgICB0aGlzLmFyZ3MucHVzaCgnLS10YXJnZXQnLCB0aGlzLnRhcmdldC50cmlwbGUpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRFbnZzKCkge1xuICAgIC8vIFRZUEUgREVGXG4gICAgaWYgKHRoaXMuZW5hYmxlVHlwZURlZikge1xuICAgICAgdGhpcy5lbnZzLk5BUElfVFlQRV9ERUZfVE1QX0ZPTERFUiA9XG4gICAgICAgIHRoaXMuZ2VuZXJhdGVJbnRlcm1lZGlhdGVUeXBlRGVmRm9sZGVyKClcbiAgICAgIHRoaXMuc2V0Rm9yY2VCdWlsZEVudnModGhpcy5lbnZzLk5BUElfVFlQRV9ERUZfVE1QX0ZPTERFUilcbiAgICB9XG5cbiAgICAvLyBSVVNURkxBR1NcbiAgICBsZXQgcnVzdGZsYWdzID1cbiAgICAgIHByb2Nlc3MuZW52LlJVU1RGTEFHUyA/PyBwcm9jZXNzLmVudi5DQVJHT19CVUlMRF9SVVNURkxBR1MgPz8gJydcblxuICAgIGlmIChcbiAgICAgIHRoaXMudGFyZ2V0LmFiaT8uaW5jbHVkZXMoJ211c2wnKSAmJlxuICAgICAgIXJ1c3RmbGFncy5pbmNsdWRlcygndGFyZ2V0LWZlYXR1cmU9LWNydC1zdGF0aWMnKVxuICAgICkge1xuICAgICAgcnVzdGZsYWdzICs9ICcgLUMgdGFyZ2V0LWZlYXR1cmU9LWNydC1zdGF0aWMnXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5zdHJpcCAmJiAhcnVzdGZsYWdzLmluY2x1ZGVzKCdsaW5rLWFyZz0tcycpKSB7XG4gICAgICBydXN0ZmxhZ3MgKz0gJyAtQyBsaW5rLWFyZz0tcydcbiAgICB9XG5cbiAgICBpZiAocnVzdGZsYWdzLmxlbmd0aCkge1xuICAgICAgdGhpcy5lbnZzLlJVU1RGTEFHUyA9IHJ1c3RmbGFnc1xuICAgIH1cbiAgICAvLyBFTkQgUlVTVEZMQUdTXG5cbiAgICAvLyBMSU5LRVJcbiAgICBjb25zdCBsaW5rZXIgPSB0aGlzLm9wdGlvbnMuY3Jvc3NDb21waWxlXG4gICAgICA/IHZvaWQgMFxuICAgICAgOiBnZXRUYXJnZXRMaW5rZXIodGhpcy50YXJnZXQudHJpcGxlKVxuICAgIC8vIFRPRE86XG4gICAgLy8gICBkaXJlY3RseSBzZXQgQ0FSR09fVEFSR0VUXzx0YXJnZXQ+X0xJTktFUiB3aWxsIGNvdmVyIC5jYXJnby9jb25maWcudG9tbFxuICAgIC8vICAgd2lsbCBkZXRlY3QgYnkgY2FyZ28gY29uZmlnIHdoZW4gaXQgYmVjb21lcyBzdGFibGVcbiAgICAvLyAgIHNlZTogaHR0cHM6Ly9naXRodWIuY29tL3J1c3QtbGFuZy9jYXJnby9pc3N1ZXMvOTMwMVxuICAgIGNvbnN0IGxpbmtlckVudiA9IGBDQVJHT19UQVJHRVRfJHt0YXJnZXRUb0VudlZhcihcbiAgICAgIHRoaXMudGFyZ2V0LnRyaXBsZSxcbiAgICApfV9MSU5LRVJgXG4gICAgaWYgKGxpbmtlciAmJiAhcHJvY2Vzcy5lbnZbbGlua2VyRW52XSAmJiAhdGhpcy5lbnZzW2xpbmtlckVudl0pIHtcbiAgICAgIHRoaXMuZW52c1tsaW5rZXJFbnZdID0gbGlua2VyXG4gICAgfVxuXG4gICAgaWYgKHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnYW5kcm9pZCcpIHtcbiAgICAgIHRoaXMuc2V0QW5kcm9pZEVudigpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2FzaScpIHtcbiAgICAgIHRoaXMuc2V0V2FzaUVudigpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnb3Blbmhhcm1vbnknKSB7XG4gICAgICB0aGlzLnNldE9wZW5IYXJtb255RW52KClcbiAgICB9XG5cbiAgICBkZWJ1ZygnU2V0IGVudnM6ICcpXG4gICAgT2JqZWN0LmVudHJpZXModGhpcy5lbnZzKS5mb3JFYWNoKChbaywgdl0pID0+IHtcbiAgICAgIGRlYnVnKCcgICVpJywgYCR7a309JHt2fWApXG4gICAgfSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIHNldEZvcmNlQnVpbGRFbnZzKHR5cGVEZWZUbXBGb2xkZXI6IHN0cmluZykge1xuICAgIC8vIGR5bmFtaWNhbGx5IGNoZWNrIGFsbCBuYXBpLXJzIGRlcHMgYW5kIHNldCBgTkFQSV9GT1JDRV9CVUlMRF97dXBwZXJjYXNlKHNuYWtlX2Nhc2UobmFtZSkpfSA9IHRpbWVzdGFtcGBcbiAgICB0aGlzLm1ldGFkYXRhLnBhY2thZ2VzLmZvckVhY2goKGNyYXRlKSA9PiB7XG4gICAgICBpZiAoXG4gICAgICAgIGNyYXRlLmRlcGVuZGVuY2llcy5zb21lKChkKSA9PiBkLm5hbWUgPT09ICduYXBpLWRlcml2ZScpICYmXG4gICAgICAgICFleGlzdHNTeW5jKGpvaW4odHlwZURlZlRtcEZvbGRlciwgY3JhdGUubmFtZSkpXG4gICAgICApIHtcbiAgICAgICAgdGhpcy5lbnZzW1xuICAgICAgICAgIGBOQVBJX0ZPUkNFX0JVSUxEXyR7Y3JhdGUubmFtZS5yZXBsYWNlKC8tL2csICdfJykudG9VcHBlckNhc2UoKX1gXG4gICAgICAgIF0gPSBEYXRlLm5vdygpLnRvU3RyaW5nKClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBzZXRBbmRyb2lkRW52KCkge1xuICAgIGNvbnN0IHsgQU5EUk9JRF9OREtfTEFURVNUX0hPTUUgfSA9IHByb2Nlc3MuZW52XG4gICAgaWYgKCFBTkRST0lEX05ES19MQVRFU1RfSE9NRSkge1xuICAgICAgZGVidWcud2FybihcbiAgICAgICAgYCR7Y29sb3JzLnJlZChcbiAgICAgICAgICAnQU5EUk9JRF9OREtfTEFURVNUX0hPTUUnLFxuICAgICAgICApfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBtaXNzaW5nYCxcbiAgICAgIClcbiAgICB9XG5cbiAgICAvLyBza2lwIGNyb3NzIGNvbXBpbGUgc2V0dXAgaWYgaG9zdCBpcyBhbmRyb2lkXG4gICAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdhbmRyb2lkJykge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0QXJjaCA9IHRoaXMudGFyZ2V0LmFyY2ggPT09ICdhcm0nID8gJ2FybXY3YScgOiAnYWFyY2g2NCdcbiAgICBjb25zdCB0YXJnZXRQbGF0Zm9ybSA9XG4gICAgICB0aGlzLnRhcmdldC5hcmNoID09PSAnYXJtJyA/ICdhbmRyb2lkZWFiaTI0JyA6ICdhbmRyb2lkMjQnXG4gICAgY29uc3QgaG9zdFBsYXRmb3JtID1cbiAgICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nXG4gICAgICAgID8gJ2RhcndpbidcbiAgICAgICAgOiBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInXG4gICAgICAgICAgPyAnd2luZG93cydcbiAgICAgICAgICA6ICdsaW51eCdcbiAgICBPYmplY3QuYXNzaWduKHRoaXMuZW52cywge1xuICAgICAgQ0FSR09fVEFSR0VUX0FBUkNINjRfTElOVVhfQU5EUk9JRF9MSU5LRVI6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vJHt0YXJnZXRBcmNofS1saW51eC1hbmRyb2lkMjQtY2xhbmdgLFxuICAgICAgQ0FSR09fVEFSR0VUX0FSTVY3X0xJTlVYX0FORFJPSURFQUJJX0xJTktFUjogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi8ke3RhcmdldEFyY2h9LWxpbnV4LWFuZHJvaWRlYWJpMjQtY2xhbmdgLFxuICAgICAgVEFSR0VUX0NDOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluLyR7dGFyZ2V0QXJjaH0tbGludXgtJHt0YXJnZXRQbGF0Zm9ybX0tY2xhbmdgLFxuICAgICAgVEFSR0VUX0NYWDogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi8ke3RhcmdldEFyY2h9LWxpbnV4LSR7dGFyZ2V0UGxhdGZvcm19LWNsYW5nKytgLFxuICAgICAgVEFSR0VUX0FSOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluL2xsdm0tYXJgLFxuICAgICAgVEFSR0VUX1JBTkxJQjogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi9sbHZtLXJhbmxpYmAsXG4gICAgICBBTkRST0lEX05ESzogQU5EUk9JRF9OREtfTEFURVNUX0hPTUUsXG4gICAgICBQQVRIOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluJHtwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInID8gJzsnIDogJzonfSR7cHJvY2Vzcy5lbnYuUEFUSH1gLFxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHNldFdhc2lFbnYoKSB7XG4gICAgY29uc3QgZW1uYXBpID0gam9pbihcbiAgICAgIHJlcXVpcmUucmVzb2x2ZSgnZW1uYXBpJyksXG4gICAgICAnLi4nLFxuICAgICAgJ2xpYicsXG4gICAgICAnd2FzbTMyLXdhc2ktdGhyZWFkcycsXG4gICAgKVxuICAgIHRoaXMuZW52cy5FTU5BUElfTElOS19ESVIgPSBlbW5hcGlcbiAgICBjb25zdCBlbW5hcGlWZXJzaW9uID0gcmVxdWlyZSgnZW1uYXBpL3BhY2thZ2UuanNvbicpLnZlcnNpb25cbiAgICBjb25zdCBwcm9qZWN0UmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoam9pbih0aGlzLm9wdGlvbnMuY3dkLCAncGFja2FnZS5qc29uJykpXG4gICAgY29uc3QgZW1uYXBpQ29yZVZlcnNpb24gPSBwcm9qZWN0UmVxdWlyZSgnQGVtbmFwaS9jb3JlJykudmVyc2lvblxuICAgIGNvbnN0IGVtbmFwaVJ1bnRpbWVWZXJzaW9uID0gcHJvamVjdFJlcXVpcmUoJ0BlbW5hcGkvcnVudGltZScpLnZlcnNpb25cblxuICAgIGlmIChcbiAgICAgIGVtbmFwaVZlcnNpb24gIT09IGVtbmFwaUNvcmVWZXJzaW9uIHx8XG4gICAgICBlbW5hcGlWZXJzaW9uICE9PSBlbW5hcGlSdW50aW1lVmVyc2lvblxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgZW1uYXBpIHZlcnNpb24gbWlzbWF0Y2g6IGVtbmFwaUAke2VtbmFwaVZlcnNpb259LCBAZW1uYXBpL2NvcmVAJHtlbW5hcGlDb3JlVmVyc2lvbn0sIEBlbW5hcGkvcnVudGltZUAke2VtbmFwaVJ1bnRpbWVWZXJzaW9ufS4gUGxlYXNlIGVuc3VyZSBhbGwgZW1uYXBpIHBhY2thZ2VzIGFyZSB0aGUgc2FtZSB2ZXJzaW9uLmAsXG4gICAgICApXG4gICAgfVxuICAgIGNvbnN0IHsgV0FTSV9TREtfUEFUSCB9ID0gcHJvY2Vzcy5lbnZcblxuICAgIGlmIChXQVNJX1NES19QQVRIICYmIGV4aXN0c1N5bmMoV0FTSV9TREtfUEFUSCkpIHtcbiAgICAgIHRoaXMuZW52cy5DQVJHT19UQVJHRVRfV0FTTTMyX1dBU0lfUFJFVklFVzFfVEhSRUFEU19MSU5LRVIgPSBqb2luKFxuICAgICAgICBXQVNJX1NES19QQVRILFxuICAgICAgICAnYmluJyxcbiAgICAgICAgJ3dhc20tbGQnLFxuICAgICAgKVxuICAgICAgdGhpcy5lbnZzLkNBUkdPX1RBUkdFVF9XQVNNMzJfV0FTSVAxX0xJTktFUiA9IGpvaW4oXG4gICAgICAgIFdBU0lfU0RLX1BBVEgsXG4gICAgICAgICdiaW4nLFxuICAgICAgICAnd2FzbS1sZCcsXG4gICAgICApXG4gICAgICB0aGlzLmVudnMuQ0FSR09fVEFSR0VUX1dBU00zMl9XQVNJUDFfVEhSRUFEU19MSU5LRVIgPSBqb2luKFxuICAgICAgICBXQVNJX1NES19QQVRILFxuICAgICAgICAnYmluJyxcbiAgICAgICAgJ3dhc20tbGQnLFxuICAgICAgKVxuICAgICAgdGhpcy5lbnZzLkNBUkdPX1RBUkdFVF9XQVNNMzJfV0FTSVAyX0xJTktFUiA9IGpvaW4oXG4gICAgICAgIFdBU0lfU0RLX1BBVEgsXG4gICAgICAgICdiaW4nLFxuICAgICAgICAnd2FzbS1sZCcsXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQ0MnLCBqb2luKFdBU0lfU0RLX1BBVEgsICdiaW4nLCAnY2xhbmcnKSlcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ1hYJyxcbiAgICAgICAgam9pbihXQVNJX1NES19QQVRILCAnYmluJywgJ2NsYW5nKysnKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9BUicsIGpvaW4oV0FTSV9TREtfUEFUSCwgJ2JpbicsICdhcicpKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9SQU5MSUInLFxuICAgICAgICBqb2luKFdBU0lfU0RLX1BBVEgsICdiaW4nLCAncmFubGliJyksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NGTEFHUycsXG4gICAgICAgIGAtLXRhcmdldD13YXNtMzItd2FzaS10aHJlYWRzIC0tc3lzcm9vdD0ke1dBU0lfU0RLX1BBVEh9L3NoYXJlL3dhc2ktc3lzcm9vdCAtcHRocmVhZCAtbWxsdm0gLXdhc20tZW5hYmxlLXNqbGpgLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DWFhGTEFHUycsXG4gICAgICAgIGAtLXRhcmdldD13YXNtMzItd2FzaS10aHJlYWRzIC0tc3lzcm9vdD0ke1dBU0lfU0RLX1BBVEh9L3NoYXJlL3dhc2ktc3lzcm9vdCAtcHRocmVhZCAtbWxsdm0gLXdhc20tZW5hYmxlLXNqbGpgLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgYFRBUkdFVF9MREZMQUdTYCxcbiAgICAgICAgYC1mdXNlLWxkPSR7V0FTSV9TREtfUEFUSH0vYmluL3dhc20tbGQgLS10YXJnZXQ9d2FzbTMyLXdhc2ktdGhyZWFkc2AsXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZXRPcGVuSGFybW9ueUVudigpIHtcbiAgICBjb25zdCB7IE9IT1NfU0RLX1BBVEgsIE9IT1NfU0RLX05BVElWRSB9ID0gcHJvY2Vzcy5lbnZcbiAgICBjb25zdCBuZGtQYXRoID0gT0hPU19TREtfUEFUSCA/IGAke09IT1NfU0RLX1BBVEh9L25hdGl2ZWAgOiBPSE9TX1NES19OQVRJVkVcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgaWYgKCFuZGtQYXRoICYmIHByb2Nlc3MucGxhdGZvcm0gIT09ICdvcGVuaGFybW9ueScpIHtcbiAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgIGAke2NvbG9ycy5yZWQoJ09IT1NfU0RLX1BBVEgnKX0gb3IgJHtjb2xvcnMucmVkKCdPSE9TX1NES19OQVRJVkUnKX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbWlzc2luZ2AsXG4gICAgICApXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgbGlua2VyTmFtZSA9IGBDQVJHT19UQVJHRVRfJHt0aGlzLnRhcmdldC50cmlwbGUudG9VcHBlckNhc2UoKS5yZXBsYWNlKC8tL2csICdfJyl9X0xJTktFUmBcbiAgICBjb25zdCByYW5QYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1yYW5saWJgXG4gICAgY29uc3QgYXJQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1hcmBcbiAgICBjb25zdCBjY1BhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi8ke3RoaXMudGFyZ2V0LnRyaXBsZX0tY2xhbmdgXG4gICAgY29uc3QgY3h4UGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluLyR7dGhpcy50YXJnZXQudHJpcGxlfS1jbGFuZysrYFxuICAgIGNvbnN0IGFzUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tYXNgXG4gICAgY29uc3QgbGRQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGQubGxkYFxuICAgIGNvbnN0IHN0cmlwUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tc3RyaXBgXG4gICAgY29uc3Qgb2JqRHVtcFBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLW9iamR1bXBgXG4gICAgY29uc3Qgb2JqQ29weVBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLW9iamNvcHlgXG4gICAgY29uc3Qgbm1QYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1ubWBcbiAgICBjb25zdCBiaW5QYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW5gXG4gICAgY29uc3QgbGliUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vbGliYFxuXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnTElCQ0xBTkdfUEFUSCcsIGxpYlBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnREVQX0FUT01JQycsICdjbGFuZ19ydC5idWlsdGlucycpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhsaW5rZXJOYW1lLCBjY1BhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0NDJywgY2NQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9DWFgnLCBjeHhQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9BUicsIGFyUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfUkFOTElCJywgcmFuUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQVMnLCBhc1BhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0xEJywgbGRQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9TVFJJUCcsIHN0cmlwUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfT0JKRFVNUCcsIG9iakR1bXBQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9PQkpDT1BZJywgb2JqQ29weVBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX05NJywgbm1QYXRoKVxuICAgIHRoaXMuZW52cy5QQVRIID0gYCR7YmluUGF0aH0ke3Byb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgPyAnOycgOiAnOid9JHtwcm9jZXNzLmVudi5QQVRIfWBcbiAgfVxuXG4gIHByaXZhdGUgc2V0RmVhdHVyZXMoKSB7XG4gICAgY29uc3QgYXJncyA9IFtdXG4gICAgaWYgKHRoaXMub3B0aW9ucy5hbGxGZWF0dXJlcyAmJiB0aGlzLm9wdGlvbnMubm9EZWZhdWx0RmVhdHVyZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ0Nhbm5vdCBzcGVjaWZ5IC0tYWxsLWZlYXR1cmVzIGFuZCAtLW5vLWRlZmF1bHQtZmVhdHVyZXMgdG9nZXRoZXInLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAodGhpcy5vcHRpb25zLmFsbEZlYXR1cmVzKSB7XG4gICAgICBhcmdzLnB1c2goJy0tYWxsLWZlYXR1cmVzJylcbiAgICB9IGVsc2UgaWYgKHRoaXMub3B0aW9ucy5ub0RlZmF1bHRGZWF0dXJlcykge1xuICAgICAgYXJncy5wdXNoKCctLW5vLWRlZmF1bHQtZmVhdHVyZXMnKVxuICAgIH1cbiAgICBpZiAodGhpcy5vcHRpb25zLmZlYXR1cmVzKSB7XG4gICAgICBhcmdzLnB1c2goJy0tZmVhdHVyZXMnLCAuLi50aGlzLm9wdGlvbnMuZmVhdHVyZXMpXG4gICAgfVxuXG4gICAgZGVidWcoJ1NldCBmZWF0dXJlcyBmbGFnczogJylcbiAgICBkZWJ1ZygnICAlTycsIGFyZ3MpXG4gICAgdGhpcy5hcmdzLnB1c2goLi4uYXJncylcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIHNldEJ5cGFzc0FyZ3MoKSB7XG4gICAgaWYgKHRoaXMub3B0aW9ucy5yZWxlYXNlKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnLS1yZWxlYXNlJylcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLnZlcmJvc2UpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCctLXZlcmJvc2UnKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMudGFyZ2V0RGlyKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnLS10YXJnZXQtZGlyJywgdGhpcy5vcHRpb25zLnRhcmdldERpcilcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLnByb2ZpbGUpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCctLXByb2ZpbGUnLCB0aGlzLm9wdGlvbnMucHJvZmlsZSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLm1hbmlmZXN0UGF0aCkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJy0tbWFuaWZlc3QtcGF0aCcsIHRoaXMub3B0aW9ucy5tYW5pZmVzdFBhdGgpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5jYXJnb09wdGlvbnM/Lmxlbmd0aCkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goLi4udGhpcy5vcHRpb25zLmNhcmdvT3B0aW9ucylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBnZW5lcmF0ZUludGVybWVkaWF0ZVR5cGVEZWZGb2xkZXIoKSB7XG4gICAgbGV0IGZvbGRlciA9IGpvaW4oXG4gICAgICB0aGlzLnRhcmdldERpcixcbiAgICAgICduYXBpLXJzJyxcbiAgICAgIGAke3RoaXMuY3JhdGUubmFtZX0tJHtjcmVhdGVIYXNoKCdzaGEyNTYnKVxuICAgICAgICAudXBkYXRlKHRoaXMuY3JhdGUubWFuaWZlc3RfcGF0aClcbiAgICAgICAgLnVwZGF0ZShDTElfVkVSU0lPTilcbiAgICAgICAgLmRpZ2VzdCgnaGV4JylcbiAgICAgICAgLnN1YnN0cmluZygwLCA4KX1gLFxuICAgIClcblxuICAgIGlmICghdGhpcy5vcHRpb25zLmR0c0NhY2hlKSB7XG4gICAgICBybVN5bmMoZm9sZGVyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSlcbiAgICAgIGZvbGRlciArPSBgXyR7RGF0ZS5ub3coKX1gXG4gICAgfVxuXG4gICAgbWtkaXJBc3luYyhmb2xkZXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG5cbiAgICByZXR1cm4gZm9sZGVyXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBvc3RCdWlsZCgpIHtcbiAgICB0cnkge1xuICAgICAgZGVidWcoYFRyeSB0byBjcmVhdGUgb3V0cHV0IGRpcmVjdG9yeTpgKVxuICAgICAgZGVidWcoJyAgJWknLCB0aGlzLm91dHB1dERpcilcbiAgICAgIGF3YWl0IG1rZGlyQXN5bmModGhpcy5vdXRwdXREaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gICAgICBkZWJ1ZyhgT3V0cHV0IGRpcmVjdG9yeSBjcmVhdGVkYClcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgb3V0cHV0IGRpcmVjdG9yeSAke3RoaXMub3V0cHV0RGlyfWAsIHtcbiAgICAgICAgY2F1c2U6IGUsXG4gICAgICB9KVxuICAgIH1cblxuICAgIGNvbnN0IHdhc21CaW5hcnlOYW1lID0gYXdhaXQgdGhpcy5jb3B5QXJ0aWZhY3QoKVxuXG4gICAgLy8gb25seSBmb3IgY2R5bGliXG4gICAgaWYgKHRoaXMuY2R5TGliTmFtZSkge1xuICAgICAgY29uc3QgaWRlbnRzID0gYXdhaXQgdGhpcy5nZW5lcmF0ZVR5cGVEZWYoKVxuICAgICAgY29uc3QganNPdXRwdXQgPSBhd2FpdCB0aGlzLndyaXRlSnNCaW5kaW5nKGlkZW50cylcbiAgICAgIGNvbnN0IHdhc21CaW5kaW5nc091dHB1dCA9IGF3YWl0IHRoaXMud3JpdGVXYXNpQmluZGluZyhcbiAgICAgICAgd2FzbUJpbmFyeU5hbWUsXG4gICAgICAgIGlkZW50cyxcbiAgICAgIClcbiAgICAgIGlmIChqc091dHB1dCkge1xuICAgICAgICB0aGlzLm91dHB1dHMucHVzaChqc091dHB1dClcbiAgICAgIH1cbiAgICAgIGlmICh3YXNtQmluZGluZ3NPdXRwdXQpIHtcbiAgICAgICAgdGhpcy5vdXRwdXRzLnB1c2goLi4ud2FzbUJpbmRpbmdzT3V0cHV0KVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLm91dHB1dHNcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY29weUFydGlmYWN0KCkge1xuICAgIGNvbnN0IFtzcmNOYW1lLCBkZXN0TmFtZSwgd2FzbUJpbmFyeU5hbWVdID0gdGhpcy5nZXRBcnRpZmFjdE5hbWVzKClcbiAgICBpZiAoIXNyY05hbWUgfHwgIWRlc3ROYW1lKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwcm9maWxlID1cbiAgICAgIHRoaXMub3B0aW9ucy5wcm9maWxlID8/ICh0aGlzLm9wdGlvbnMucmVsZWFzZSA/ICdyZWxlYXNlJyA6ICdkZWJ1ZycpXG4gICAgY29uc3Qgc3JjID0gam9pbih0aGlzLnRhcmdldERpciwgdGhpcy50YXJnZXQudHJpcGxlLCBwcm9maWxlLCBzcmNOYW1lKVxuICAgIGRlYnVnKGBDb3B5IGFydGlmYWN0IGZyb206IFske3NyY31dYClcbiAgICBjb25zdCBkZXN0ID0gam9pbih0aGlzLm91dHB1dERpciwgZGVzdE5hbWUpXG4gICAgY29uc3QgaXNXYXNtID0gZGVzdC5lbmRzV2l0aCgnLndhc20nKVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmIChhd2FpdCBmaWxlRXhpc3RzKGRlc3QpKSB7XG4gICAgICAgIGRlYnVnKCdPbGQgYXJ0aWZhY3QgZm91bmQsIHJlbW92ZSBpdCBmaXJzdCcpXG4gICAgICAgIGF3YWl0IHVubGlua0FzeW5jKGRlc3QpXG4gICAgICB9XG4gICAgICBkZWJ1ZygnQ29weSBhcnRpZmFjdCB0bzonKVxuICAgICAgZGVidWcoJyAgJWknLCBkZXN0KVxuICAgICAgaWYgKGlzV2FzbSkge1xuICAgICAgICBjb25zdCB7IE1vZHVsZUNvbmZpZyB9ID0gYXdhaXQgaW1wb3J0KCdAbmFwaS1ycy93YXNtLXRvb2xzJylcbiAgICAgICAgZGVidWcoJ0dlbmVyYXRlIGRlYnVnIHdhc20gbW9kdWxlJylcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBkZWJ1Z1dhc21Nb2R1bGUgPSBuZXcgTW9kdWxlQ29uZmlnKClcbiAgICAgICAgICAgIC5nZW5lcmF0ZUR3YXJmKHRydWUpXG4gICAgICAgICAgICAuZ2VuZXJhdGVOYW1lU2VjdGlvbih0cnVlKVxuICAgICAgICAgICAgLmdlbmVyYXRlUHJvZHVjZXJzU2VjdGlvbih0cnVlKVxuICAgICAgICAgICAgLnByZXNlcnZlQ29kZVRyYW5zZm9ybSh0cnVlKVxuICAgICAgICAgICAgLnN0cmljdFZhbGlkYXRlKGZhbHNlKVxuICAgICAgICAgICAgLnBhcnNlKGF3YWl0IHJlYWRGaWxlQXN5bmMoc3JjKSlcbiAgICAgICAgICBjb25zdCBkZWJ1Z1dhc21CaW5hcnkgPSBkZWJ1Z1dhc21Nb2R1bGUuZW1pdFdhc20odHJ1ZSlcbiAgICAgICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgICAgIGRlc3QucmVwbGFjZSgvXFwud2FzbSQvLCAnLmRlYnVnLndhc20nKSxcbiAgICAgICAgICAgIGRlYnVnV2FzbUJpbmFyeSxcbiAgICAgICAgICApXG4gICAgICAgICAgZGVidWcoJ0dlbmVyYXRlIHJlbGVhc2Ugd2FzbSBtb2R1bGUnKVxuICAgICAgICAgIGNvbnN0IHJlbGVhc2VXYXNtTW9kdWxlID0gbmV3IE1vZHVsZUNvbmZpZygpXG4gICAgICAgICAgICAuZ2VuZXJhdGVEd2FyZihmYWxzZSlcbiAgICAgICAgICAgIC5nZW5lcmF0ZU5hbWVTZWN0aW9uKGZhbHNlKVxuICAgICAgICAgICAgLmdlbmVyYXRlUHJvZHVjZXJzU2VjdGlvbihmYWxzZSlcbiAgICAgICAgICAgIC5wcmVzZXJ2ZUNvZGVUcmFuc2Zvcm0oZmFsc2UpXG4gICAgICAgICAgICAuc3RyaWN0VmFsaWRhdGUoZmFsc2UpXG4gICAgICAgICAgICAub25seVN0YWJsZUZlYXR1cmVzKGZhbHNlKVxuICAgICAgICAgICAgLnBhcnNlKGRlYnVnV2FzbUJpbmFyeSlcbiAgICAgICAgICBjb25zdCByZWxlYXNlV2FzbUJpbmFyeSA9IHJlbGVhc2VXYXNtTW9kdWxlLmVtaXRXYXNtKGZhbHNlKVxuICAgICAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGRlc3QsIHJlbGVhc2VXYXNtQmluYXJ5KVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgIGBGYWlsZWQgdG8gZ2VuZXJhdGUgZGVidWcgd2FzbSBtb2R1bGU6ICR7KGUgYXMgYW55KS5tZXNzYWdlID8/IGV9YCxcbiAgICAgICAgICApXG4gICAgICAgICAgYXdhaXQgY29weUZpbGVBc3luYyhzcmMsIGRlc3QpXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNvcHlGaWxlQXN5bmMoc3JjLCBkZXN0KVxuICAgICAgfVxuICAgICAgdGhpcy5vdXRwdXRzLnB1c2goe1xuICAgICAgICBraW5kOiBkZXN0LmVuZHNXaXRoKCcubm9kZScpID8gJ25vZGUnIDogaXNXYXNtID8gJ3dhc20nIDogJ2V4ZScsXG4gICAgICAgIHBhdGg6IGRlc3QsXG4gICAgICB9KVxuICAgICAgcmV0dXJuIHdhc21CaW5hcnlOYW1lID8gam9pbih0aGlzLm91dHB1dERpciwgd2FzbUJpbmFyeU5hbWUpIDogbnVsbFxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGNvcHkgYXJ0aWZhY3QnLCB7IGNhdXNlOiBlIH0pXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRBcnRpZmFjdE5hbWVzKCkge1xuICAgIGlmICh0aGlzLmNkeUxpYk5hbWUpIHtcbiAgICAgIGNvbnN0IGNkeUxpYiA9IHRoaXMuY2R5TGliTmFtZS5yZXBsYWNlKC8tL2csICdfJylcbiAgICAgIGNvbnN0IHdhc2lUYXJnZXQgPSB0aGlzLmNvbmZpZy50YXJnZXRzLmZpbmQoKHQpID0+IHQucGxhdGZvcm0gPT09ICd3YXNpJylcblxuICAgICAgY29uc3Qgc3JjTmFtZSA9XG4gICAgICAgIHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnZGFyd2luJ1xuICAgICAgICAgID8gYGxpYiR7Y2R5TGlifS5keWxpYmBcbiAgICAgICAgICA6IHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2luMzInXG4gICAgICAgICAgICA/IGAke2NkeUxpYn0uZGxsYFxuICAgICAgICAgICAgOiB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dhc2knIHx8IHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2FzbSdcbiAgICAgICAgICAgICAgPyBgJHtjZHlMaWJ9Lndhc21gXG4gICAgICAgICAgICAgIDogYGxpYiR7Y2R5TGlifS5zb2BcblxuICAgICAgbGV0IGRlc3ROYW1lID0gdGhpcy5jb25maWcuYmluYXJ5TmFtZVxuICAgICAgLy8gYWRkIHBsYXRmb3JtIHN1ZmZpeCB0byBiaW5hcnkgbmFtZVxuICAgICAgLy8gaW5kZXhbLmxpbnV4LXg2NC1nbnVdLm5vZGVcbiAgICAgIC8vICAgICAgIF5eXl5eXl5eXl5eXl5eXG4gICAgICBpZiAodGhpcy5vcHRpb25zLnBsYXRmb3JtKSB7XG4gICAgICAgIGRlc3ROYW1lICs9IGAuJHt0aGlzLnRhcmdldC5wbGF0Zm9ybUFyY2hBQkl9YFxuICAgICAgfVxuICAgICAgaWYgKHNyY05hbWUuZW5kc1dpdGgoJy53YXNtJykpIHtcbiAgICAgICAgZGVzdE5hbWUgKz0gJy53YXNtJ1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVzdE5hbWUgKz0gJy5ub2RlJ1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gW1xuICAgICAgICBzcmNOYW1lLFxuICAgICAgICBkZXN0TmFtZSxcbiAgICAgICAgd2FzaVRhcmdldFxuICAgICAgICAgID8gYCR7dGhpcy5jb25maWcuYmluYXJ5TmFtZX0uJHt3YXNpVGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX0ud2FzbWBcbiAgICAgICAgICA6IG51bGwsXG4gICAgICBdXG4gICAgfSBlbHNlIGlmICh0aGlzLmJpbk5hbWUpIHtcbiAgICAgIGNvbnN0IHNyY05hbWUgPVxuICAgICAgICB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyA/IGAke3RoaXMuYmluTmFtZX0uZXhlYCA6IHRoaXMuYmluTmFtZVxuXG4gICAgICByZXR1cm4gW3NyY05hbWUsIHNyY05hbWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdlbmVyYXRlVHlwZURlZigpIHtcbiAgICBjb25zdCB0eXBlRGVmRGlyID0gdGhpcy5lbnZzLk5BUElfVFlQRV9ERUZfVE1QX0ZPTERFUlxuICAgIGlmICghdGhpcy5lbmFibGVUeXBlRGVmKSB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG5cbiAgICBjb25zdCB7IGV4cG9ydHMsIGR0cyB9ID0gYXdhaXQgZ2VuZXJhdGVUeXBlRGVmKHtcbiAgICAgIHR5cGVEZWZEaXIsXG4gICAgICBub0R0c0hlYWRlcjogdGhpcy5vcHRpb25zLm5vRHRzSGVhZGVyLFxuICAgICAgZHRzSGVhZGVyOiB0aGlzLm9wdGlvbnMuZHRzSGVhZGVyLFxuICAgICAgY29uZmlnRHRzSGVhZGVyOiB0aGlzLmNvbmZpZy5kdHNIZWFkZXIsXG4gICAgICBjb25maWdEdHNIZWFkZXJGaWxlOiB0aGlzLmNvbmZpZy5kdHNIZWFkZXJGaWxlLFxuICAgICAgY29uc3RFbnVtOiB0aGlzLm9wdGlvbnMuY29uc3RFbnVtID8/IHRoaXMuY29uZmlnLmNvbnN0RW51bSxcbiAgICAgIGN3ZDogdGhpcy5vcHRpb25zLmN3ZCxcbiAgICB9KVxuXG4gICAgY29uc3QgZGVzdCA9IGpvaW4odGhpcy5vdXRwdXREaXIsIHRoaXMub3B0aW9ucy5kdHMgPz8gJ2luZGV4LmQudHMnKVxuXG4gICAgdHJ5IHtcbiAgICAgIGRlYnVnKCdXcml0aW5nIHR5cGUgZGVmIHRvOicpXG4gICAgICBkZWJ1ZygnICAlaScsIGRlc3QpXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhkZXN0LCBkdHMsICd1dGYtOCcpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZGVidWcuZXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSB0eXBlIGRlZiBmaWxlJylcbiAgICAgIGRlYnVnLmVycm9yKGUgYXMgRXJyb3IpXG4gICAgfVxuXG4gICAgaWYgKGV4cG9ydHMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgZGVzdCA9IGpvaW4odGhpcy5vdXRwdXREaXIsIHRoaXMub3B0aW9ucy5kdHMgPz8gJ2luZGV4LmQudHMnKVxuICAgICAgdGhpcy5vdXRwdXRzLnB1c2goeyBraW5kOiAnZHRzJywgcGF0aDogZGVzdCB9KVxuICAgIH1cblxuICAgIHJldHVybiBleHBvcnRzXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlSnNCaW5kaW5nKGlkZW50czogc3RyaW5nW10pIHtcbiAgICByZXR1cm4gd3JpdGVKc0JpbmRpbmcoe1xuICAgICAgcGxhdGZvcm06IHRoaXMub3B0aW9ucy5wbGF0Zm9ybSxcbiAgICAgIG5vSnNCaW5kaW5nOiB0aGlzLm9wdGlvbnMubm9Kc0JpbmRpbmcsXG4gICAgICBpZGVudHMsXG4gICAgICBqc0JpbmRpbmc6IHRoaXMub3B0aW9ucy5qc0JpbmRpbmcsXG4gICAgICBlc206IHRoaXMub3B0aW9ucy5lc20sXG4gICAgICBiaW5hcnlOYW1lOiB0aGlzLmNvbmZpZy5iaW5hcnlOYW1lLFxuICAgICAgcGFja2FnZU5hbWU6IHRoaXMub3B0aW9ucy5qc1BhY2thZ2VOYW1lID8/IHRoaXMuY29uZmlnLnBhY2thZ2VOYW1lLFxuICAgICAgdmVyc2lvbjogcHJvY2Vzcy5lbnYubnBtX25ld192ZXJzaW9uID8/IHRoaXMuY29uZmlnLnBhY2thZ2VKc29uLnZlcnNpb24sXG4gICAgICBvdXRwdXREaXI6IHRoaXMub3V0cHV0RGlyLFxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyaXRlV2FzaUJpbmRpbmcoXG4gICAgZGlzdEZpbGVOYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsLFxuICAgIGlkZW50czogc3RyaW5nW10sXG4gICkge1xuICAgIGlmIChkaXN0RmlsZU5hbWUpIHtcbiAgICAgIGNvbnN0IHsgbmFtZSwgZGlyIH0gPSBwYXJzZShkaXN0RmlsZU5hbWUpXG4gICAgICBjb25zdCBiaW5kaW5nUGF0aCA9IGpvaW4oZGlyLCBgJHt0aGlzLmNvbmZpZy5iaW5hcnlOYW1lfS53YXNpLmNqc2ApXG4gICAgICBjb25zdCBicm93c2VyQmluZGluZ1BhdGggPSBqb2luKFxuICAgICAgICBkaXIsXG4gICAgICAgIGAke3RoaXMuY29uZmlnLmJpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2AsXG4gICAgICApXG4gICAgICBjb25zdCB3b3JrZXJQYXRoID0gam9pbihkaXIsICd3YXNpLXdvcmtlci5tanMnKVxuICAgICAgY29uc3QgYnJvd3NlcldvcmtlclBhdGggPSBqb2luKGRpciwgJ3dhc2ktd29ya2VyLWJyb3dzZXIubWpzJylcbiAgICAgIGNvbnN0IGJyb3dzZXJFbnRyeVBhdGggPSBqb2luKGRpciwgJ2Jyb3dzZXIuanMnKVxuICAgICAgY29uc3QgZXhwb3J0c0NvZGUgPVxuICAgICAgICBgbW9kdWxlLmV4cG9ydHMgPSBfX25hcGlNb2R1bGUuZXhwb3J0c1xcbmAgK1xuICAgICAgICBpZGVudHNcbiAgICAgICAgICAubWFwKFxuICAgICAgICAgICAgKGlkZW50KSA9PlxuICAgICAgICAgICAgICBgbW9kdWxlLmV4cG9ydHMuJHtpZGVudH0gPSBfX25hcGlNb2R1bGUuZXhwb3J0cy4ke2lkZW50fWAsXG4gICAgICAgICAgKVxuICAgICAgICAgIC5qb2luKCdcXG4nKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgIGJpbmRpbmdQYXRoLFxuICAgICAgICBjcmVhdGVXYXNpQmluZGluZyhcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHRoaXMuY29uZmlnLnBhY2thZ2VOYW1lLFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmluaXRpYWxNZW1vcnksXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8ubWF4aW11bU1lbW9yeSxcbiAgICAgICAgKSArXG4gICAgICAgICAgZXhwb3J0c0NvZGUgK1xuICAgICAgICAgICdcXG4nLFxuICAgICAgICAndXRmOCcsXG4gICAgICApXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgYnJvd3NlckJpbmRpbmdQYXRoLFxuICAgICAgICBjcmVhdGVXYXNpQnJvd3NlckJpbmRpbmcoXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5pbml0aWFsTWVtb3J5LFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/Lm1heGltdW1NZW1vcnksXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uZnMsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uYXN5bmNJbml0LFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmJ1ZmZlcixcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5lcnJvckV2ZW50LFxuICAgICAgICApICtcbiAgICAgICAgICBgZXhwb3J0IGRlZmF1bHQgX19uYXBpTW9kdWxlLmV4cG9ydHNcXG5gICtcbiAgICAgICAgICBpZGVudHNcbiAgICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAgIChpZGVudCkgPT5cbiAgICAgICAgICAgICAgICBgZXhwb3J0IGNvbnN0ICR7aWRlbnR9ID0gX19uYXBpTW9kdWxlLmV4cG9ydHMuJHtpZGVudH1gLFxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLmpvaW4oJ1xcbicpICtcbiAgICAgICAgICAnXFxuJyxcbiAgICAgICAgJ3V0ZjgnLFxuICAgICAgKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMod29ya2VyUGF0aCwgV0FTSV9XT1JLRVJfVEVNUExBVEUsICd1dGY4JylcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICBicm93c2VyV29ya2VyUGF0aCxcbiAgICAgICAgY3JlYXRlV2FzaUJyb3dzZXJXb3JrZXJCaW5kaW5nKFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmZzID8/IGZhbHNlLFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmVycm9yRXZlbnQgPz8gZmFsc2UsXG4gICAgICAgICksXG4gICAgICAgICd1dGY4JyxcbiAgICAgIClcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICBicm93c2VyRW50cnlQYXRoLFxuICAgICAgICBgZXhwb3J0ICogZnJvbSAnJHt0aGlzLmNvbmZpZy5wYWNrYWdlTmFtZX0td2FzbTMyLXdhc2knXFxuYCxcbiAgICAgIClcbiAgICAgIHJldHVybiBbXG4gICAgICAgIHsga2luZDogJ2pzJywgcGF0aDogYmluZGluZ1BhdGggfSxcbiAgICAgICAgeyBraW5kOiAnanMnLCBwYXRoOiBicm93c2VyQmluZGluZ1BhdGggfSxcbiAgICAgICAgeyBraW5kOiAnanMnLCBwYXRoOiB3b3JrZXJQYXRoIH0sXG4gICAgICAgIHsga2luZDogJ2pzJywgcGF0aDogYnJvd3NlcldvcmtlclBhdGggfSxcbiAgICAgICAgeyBraW5kOiAnanMnLCBwYXRoOiBicm93c2VyRW50cnlQYXRoIH0sXG4gICAgICBdIHNhdGlzZmllcyBPdXRwdXRbXVxuICAgIH1cbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIHByaXZhdGUgc2V0RW52SWZOb3RFeGlzdHMoZW52OiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpIHtcbiAgICBpZiAoIXByb2Nlc3MuZW52W2Vudl0pIHtcbiAgICAgIHRoaXMuZW52c1tlbnZdID0gdmFsdWVcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBXcml0ZUpzQmluZGluZ09wdGlvbnMge1xuICBwbGF0Zm9ybT86IGJvb2xlYW5cbiAgbm9Kc0JpbmRpbmc/OiBib29sZWFuXG4gIGlkZW50czogc3RyaW5nW11cbiAganNCaW5kaW5nPzogc3RyaW5nXG4gIGVzbT86IGJvb2xlYW5cbiAgYmluYXJ5TmFtZTogc3RyaW5nXG4gIHBhY2thZ2VOYW1lOiBzdHJpbmdcbiAgdmVyc2lvbjogc3RyaW5nXG4gIG91dHB1dERpcjogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB3cml0ZUpzQmluZGluZyhcbiAgb3B0aW9uczogV3JpdGVKc0JpbmRpbmdPcHRpb25zLFxuKTogUHJvbWlzZTxPdXRwdXQgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKFxuICAgICFvcHRpb25zLnBsYXRmb3JtIHx8XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9wcmVmZXItbnVsbGlzaC1jb2FsZXNjaW5nXG4gICAgb3B0aW9ucy5ub0pzQmluZGluZyB8fFxuICAgIG9wdGlvbnMuaWRlbnRzLmxlbmd0aCA9PT0gMFxuICApIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBvcHRpb25zLmpzQmluZGluZyA/PyAnaW5kZXguanMnXG5cbiAgY29uc3QgY3JlYXRlQmluZGluZyA9IG9wdGlvbnMuZXNtID8gY3JlYXRlRXNtQmluZGluZyA6IGNyZWF0ZUNqc0JpbmRpbmdcbiAgY29uc3QgYmluZGluZyA9IGNyZWF0ZUJpbmRpbmcoXG4gICAgb3B0aW9ucy5iaW5hcnlOYW1lLFxuICAgIG9wdGlvbnMucGFja2FnZU5hbWUsXG4gICAgb3B0aW9ucy5pZGVudHMsXG4gICAgLy8gaW4gbnBtIHByZXZlcnNpb24gaG9va1xuICAgIG9wdGlvbnMudmVyc2lvbixcbiAgKVxuXG4gIHRyeSB7XG4gICAgY29uc3QgZGVzdCA9IGpvaW4ob3B0aW9ucy5vdXRwdXREaXIsIG5hbWUpXG4gICAgZGVidWcoJ1dyaXRpbmcganMgYmluZGluZyB0bzonKVxuICAgIGRlYnVnKCcgICVpJywgZGVzdClcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhkZXN0LCBiaW5kaW5nLCAndXRmLTgnKVxuICAgIHJldHVybiB7IGtpbmQ6ICdqcycsIHBhdGg6IGRlc3QgfSBzYXRpc2ZpZXMgT3V0cHV0XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byB3cml0ZSBqcyBiaW5kaW5nIGZpbGUnLCB7IGNhdXNlOiBlIH0pXG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHZW5lcmF0ZVR5cGVEZWZPcHRpb25zIHtcbiAgdHlwZURlZkRpcjogc3RyaW5nXG4gIG5vRHRzSGVhZGVyPzogYm9vbGVhblxuICBkdHNIZWFkZXI/OiBzdHJpbmdcbiAgZHRzSGVhZGVyRmlsZT86IHN0cmluZ1xuICBjb25maWdEdHNIZWFkZXI/OiBzdHJpbmdcbiAgY29uZmlnRHRzSGVhZGVyRmlsZT86IHN0cmluZ1xuICBjb25zdEVudW0/OiBib29sZWFuXG4gIGN3ZDogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZW5lcmF0ZVR5cGVEZWYoXG4gIG9wdGlvbnM6IEdlbmVyYXRlVHlwZURlZk9wdGlvbnMsXG4pOiBQcm9taXNlPHsgZXhwb3J0czogc3RyaW5nW107IGR0czogc3RyaW5nIH0+IHtcbiAgaWYgKCEoYXdhaXQgZGlyRXhpc3RzQXN5bmMob3B0aW9ucy50eXBlRGVmRGlyKSkpIHtcbiAgICByZXR1cm4geyBleHBvcnRzOiBbXSwgZHRzOiAnJyB9XG4gIH1cblxuICBsZXQgaGVhZGVyID0gJydcbiAgbGV0IGR0cyA9ICcnXG4gIGxldCBleHBvcnRzOiBzdHJpbmdbXSA9IFtdXG5cbiAgaWYgKCFvcHRpb25zLm5vRHRzSGVhZGVyKSB7XG4gICAgY29uc3QgZHRzSGVhZGVyID0gb3B0aW9ucy5kdHNIZWFkZXIgPz8gb3B0aW9ucy5jb25maWdEdHNIZWFkZXJcbiAgICAvLyBgZHRzSGVhZGVyRmlsZWAgaW4gY29uZmlnID4gYGR0c0hlYWRlcmAgaW4gY2xpIGZsYWcgPiBgZHRzSGVhZGVyYCBpbiBjb25maWdcbiAgICBpZiAob3B0aW9ucy5jb25maWdEdHNIZWFkZXJGaWxlKSB7XG4gICAgICB0cnkge1xuICAgICAgICBoZWFkZXIgPSBhd2FpdCByZWFkRmlsZUFzeW5jKFxuICAgICAgICAgIGpvaW4ob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnRHRzSGVhZGVyRmlsZSksXG4gICAgICAgICAgJ3V0Zi04JyxcbiAgICAgICAgKVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgIGBGYWlsZWQgdG8gcmVhZCBkdHMgaGVhZGVyIGZpbGUgJHtvcHRpb25zLmNvbmZpZ0R0c0hlYWRlckZpbGV9YCxcbiAgICAgICAgICBlLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChkdHNIZWFkZXIpIHtcbiAgICAgIGhlYWRlciA9IGR0c0hlYWRlclxuICAgIH0gZWxzZSB7XG4gICAgICBoZWFkZXIgPSBERUZBVUxUX1RZUEVfREVGX0hFQURFUlxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgcmVhZGRpckFzeW5jKG9wdGlvbnMudHlwZURlZkRpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG5cbiAgaWYgKCFmaWxlcy5sZW5ndGgpIHtcbiAgICBkZWJ1ZygnTm8gdHlwZSBkZWYgZmlsZXMgZm91bmQuIFNraXAgZ2VuZXJhdGluZyBkdHMgZmlsZS4nKVxuICAgIHJldHVybiB7IGV4cG9ydHM6IFtdLCBkdHM6ICcnIH1cbiAgfVxuXG4gIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgIGlmICghZmlsZS5pc0ZpbGUoKSkge1xuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCB7IGR0czogZmlsZUR0cywgZXhwb3J0czogZmlsZUV4cG9ydHMgfSA9IGF3YWl0IHByb2Nlc3NUeXBlRGVmKFxuICAgICAgam9pbihvcHRpb25zLnR5cGVEZWZEaXIsIGZpbGUubmFtZSksXG4gICAgICBvcHRpb25zLmNvbnN0RW51bSA/PyB0cnVlLFxuICAgIClcblxuICAgIGR0cyArPSBmaWxlRHRzXG4gICAgZXhwb3J0cy5wdXNoKC4uLmZpbGVFeHBvcnRzKVxuICB9XG5cbiAgaWYgKGR0cy5pbmRleE9mKCdFeHRlcm5hbE9iamVjdDwnKSA+IC0xKSB7XG4gICAgaGVhZGVyICs9IGBcbmV4cG9ydCBkZWNsYXJlIGNsYXNzIEV4dGVybmFsT2JqZWN0PFQ+IHtcbiAgcmVhZG9ubHkgJyc6IHtcbiAgICByZWFkb25seSAnJzogdW5pcXVlIHN5bWJvbFxuICAgIFtLOiBzeW1ib2xdOiBUXG4gIH1cbn1cbmBcbiAgfVxuXG4gIGlmIChkdHMuaW5kZXhPZignVHlwZWRBcnJheScpID4gLTEpIHtcbiAgICBoZWFkZXIgKz0gYFxuZXhwb3J0IHR5cGUgVHlwZWRBcnJheSA9IEludDhBcnJheSB8IFVpbnQ4QXJyYXkgfCBVaW50OENsYW1wZWRBcnJheSB8IEludDE2QXJyYXkgfCBVaW50MTZBcnJheSB8IEludDMyQXJyYXkgfCBVaW50MzJBcnJheSB8IEZsb2F0MzJBcnJheSB8IEZsb2F0NjRBcnJheSB8IEJpZ0ludDY0QXJyYXkgfCBCaWdVaW50NjRBcnJheVxuYFxuICB9XG5cbiAgZHRzID0gaGVhZGVyICsgZHRzXG5cbiAgcmV0dXJuIHtcbiAgICBleHBvcnRzLFxuICAgIGR0cyxcbiAgfVxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VDcmVhdGVOcG1EaXJzQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWydjcmVhdGUtbnBtLWRpcnMnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ0NyZWF0ZSBucG0gcGFja2FnZSBkaXJzIGZvciBkaWZmZXJlbnQgcGxhdGZvcm1zJyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBucG1EaXIgPSBPcHRpb24uU3RyaW5nKCctLW5wbS1kaXInLCAnbnBtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0JyxcbiAgfSlcblxuICBkcnlSdW4gPSBPcHRpb24uQm9vbGVhbignLS1kcnktcnVuJywgZmFsc2UsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0RyeSBydW4gd2l0aG91dCB0b3VjaGluZyBmaWxlIHN5c3RlbScsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBucG1EaXI6IHRoaXMubnBtRGlyLFxuICAgICAgZHJ5UnVuOiB0aGlzLmRyeVJ1bixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGUgbnBtIHBhY2thZ2UgZGlycyBmb3IgZGlmZmVyZW50IHBsYXRmb3Jtc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIENyZWF0ZU5wbURpcnNPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0XG4gICAqXG4gICAqIEBkZWZhdWx0ICducG0nXG4gICAqL1xuICBucG1EaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIERyeSBydW4gd2l0aG91dCB0b3VjaGluZyBmaWxlIHN5c3RlbVxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZHJ5UnVuPzogYm9vbGVhblxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0Q3JlYXRlTnBtRGlyc09wdGlvbnMoXG4gIG9wdGlvbnM6IENyZWF0ZU5wbURpcnNPcHRpb25zLFxuKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgbnBtRGlyOiAnbnBtJyxcbiAgICBkcnlSdW46IGZhbHNlLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSdcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7IHBhcnNlIH0gZnJvbSAnc2VtdmVyJ1xuXG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdENyZWF0ZU5wbURpcnNPcHRpb25zLFxuICB0eXBlIENyZWF0ZU5wbURpcnNPcHRpb25zLFxufSBmcm9tICcuLi9kZWYvY3JlYXRlLW5wbS1kaXJzLmpzJ1xuaW1wb3J0IHtcbiAgZGVidWdGYWN0b3J5LFxuICByZWFkTmFwaUNvbmZpZyxcbiAgbWtkaXJBc3luYyBhcyByYXdNa2RpckFzeW5jLFxuICBwaWNrLFxuICB3cml0ZUZpbGVBc3luYyBhcyByYXdXcml0ZUZpbGVBc3luYyxcbiAgdHlwZSBUYXJnZXQsXG4gIHR5cGUgQ29tbW9uUGFja2FnZUpzb25GaWVsZHMsXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnY3JlYXRlLW5wbS1kaXJzJylcblxuZXhwb3J0IGludGVyZmFjZSBQYWNrYWdlTWV0YSB7XG4gICdkaXN0LXRhZ3MnOiB7IFtpbmRleDogc3RyaW5nXTogc3RyaW5nIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZU5wbURpcnModXNlck9wdGlvbnM6IENyZWF0ZU5wbURpcnNPcHRpb25zKSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRDcmVhdGVOcG1EaXJzT3B0aW9ucyh1c2VyT3B0aW9ucylcblxuICBhc3luYyBmdW5jdGlvbiBta2RpckFzeW5jKGRpcjogc3RyaW5nKSB7XG4gICAgZGVidWcoJ1RyeSB0byBjcmVhdGUgZGlyOiAlaScsIGRpcilcbiAgICBpZiAob3B0aW9ucy5kcnlSdW4pIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHJhd01rZGlyQXN5bmMoZGlyLCB7XG4gICAgICByZWN1cnNpdmU6IHRydWUsXG4gICAgfSlcbiAgfVxuXG4gIGFzeW5jIGZ1bmN0aW9uIHdyaXRlRmlsZUFzeW5jKGZpbGU6IHN0cmluZywgY29udGVudDogc3RyaW5nKSB7XG4gICAgZGVidWcoJ1dyaXRpbmcgZmlsZSAlaScsIGZpbGUpXG5cbiAgICBpZiAob3B0aW9ucy5kcnlSdW4pIHtcbiAgICAgIGRlYnVnKGNvbnRlbnQpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCByYXdXcml0ZUZpbGVBc3luYyhmaWxlLCBjb250ZW50KVxuICB9XG5cbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG4gIGNvbnN0IG5wbVBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLm5wbURpcilcblxuICBkZWJ1ZyhgUmVhZCBjb250ZW50IGZyb20gWyR7b3B0aW9ucy5jb25maWdQYXRoID8/IHBhY2thZ2VKc29uUGF0aH1dYClcblxuICBjb25zdCB7IHRhcmdldHMsIGJpbmFyeU5hbWUsIHBhY2thZ2VOYW1lLCBwYWNrYWdlSnNvbiB9ID1cbiAgICBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gICAgKVxuXG4gIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCB0YXJnZXREaXIgPSBqb2luKG5wbVBhdGgsIGAke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9YClcbiAgICBhd2FpdCBta2RpckFzeW5jKHRhcmdldERpcilcblxuICAgIGNvbnN0IGJpbmFyeUZpbGVOYW1lID1cbiAgICAgIHRhcmdldC5hcmNoID09PSAnd2FzbTMyJ1xuICAgICAgICA/IGAke2JpbmFyeU5hbWV9LiR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX0ud2FzbWBcbiAgICAgICAgOiBgJHtiaW5hcnlOYW1lfS4ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9Lm5vZGVgXG4gICAgY29uc3Qgc2NvcGVkUGFja2FnZUpzb246IENvbW1vblBhY2thZ2VKc29uRmllbGRzID0ge1xuICAgICAgbmFtZTogYCR7cGFja2FnZU5hbWV9LSR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1gLFxuICAgICAgdmVyc2lvbjogcGFja2FnZUpzb24udmVyc2lvbixcbiAgICAgIGNwdTogdGFyZ2V0LmFyY2ggIT09ICd1bml2ZXJzYWwnID8gW3RhcmdldC5hcmNoXSA6IHVuZGVmaW5lZCxcbiAgICAgIG1haW46IGJpbmFyeUZpbGVOYW1lLFxuICAgICAgZmlsZXM6IFtiaW5hcnlGaWxlTmFtZV0sXG4gICAgICAuLi5waWNrKFxuICAgICAgICBwYWNrYWdlSnNvbixcbiAgICAgICAgJ2Rlc2NyaXB0aW9uJyxcbiAgICAgICAgJ2tleXdvcmRzJyxcbiAgICAgICAgJ2F1dGhvcicsXG4gICAgICAgICdhdXRob3JzJyxcbiAgICAgICAgJ2hvbWVwYWdlJyxcbiAgICAgICAgJ2xpY2Vuc2UnLFxuICAgICAgICAnZW5naW5lcycsXG4gICAgICAgICdyZXBvc2l0b3J5JyxcbiAgICAgICAgJ2J1Z3MnLFxuICAgICAgKSxcbiAgICB9XG4gICAgaWYgKHBhY2thZ2VKc29uLnB1Ymxpc2hDb25maWcpIHtcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLnB1Ymxpc2hDb25maWcgPSBwaWNrKFxuICAgICAgICBwYWNrYWdlSnNvbi5wdWJsaXNoQ29uZmlnLFxuICAgICAgICAncmVnaXN0cnknLFxuICAgICAgICAnYWNjZXNzJyxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHRhcmdldC5hcmNoICE9PSAnd2FzbTMyJykge1xuICAgICAgc2NvcGVkUGFja2FnZUpzb24ub3MgPSBbdGFyZ2V0LnBsYXRmb3JtXVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBlbnRyeSA9IGAke2JpbmFyeU5hbWV9Lndhc2kuY2pzYFxuICAgICAgc2NvcGVkUGFja2FnZUpzb24ubWFpbiA9IGVudHJ5XG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5icm93c2VyID0gYCR7YmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYFxuICAgICAgc2NvcGVkUGFja2FnZUpzb24uZmlsZXM/LnB1c2goXG4gICAgICAgIGVudHJ5LFxuICAgICAgICBzY29wZWRQYWNrYWdlSnNvbi5icm93c2VyLFxuICAgICAgICBgd2FzaS13b3JrZXIubWpzYCxcbiAgICAgICAgYHdhc2ktd29ya2VyLWJyb3dzZXIubWpzYCxcbiAgICAgIClcbiAgICAgIGxldCBuZWVkUmVzdHJpY3ROb2RlVmVyc2lvbiA9IHRydWVcbiAgICAgIGlmIChzY29wZWRQYWNrYWdlSnNvbi5lbmdpbmVzPy5ub2RlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgeyBtYWpvciB9ID0gcGFyc2Uoc2NvcGVkUGFja2FnZUpzb24uZW5naW5lcy5ub2RlKSA/PyB7XG4gICAgICAgICAgICBtYWpvcjogMCxcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKG1ham9yID49IDE0KSB7XG4gICAgICAgICAgICBuZWVkUmVzdHJpY3ROb2RlVmVyc2lvbiA9IGZhbHNlXG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBpZ25vcmVcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG5lZWRSZXN0cmljdE5vZGVWZXJzaW9uKSB7XG4gICAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmVuZ2luZXMgPSB7XG4gICAgICAgICAgbm9kZTogJz49MTQuMC4wJyxcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgZW1uYXBpVmVyc2lvbiA9IHJlcXVpcmUoJ2VtbmFwaS9wYWNrYWdlLmpzb24nKS52ZXJzaW9uXG4gICAgICBjb25zdCB3YXNtUnVudGltZSA9IGF3YWl0IGZldGNoKFxuICAgICAgICBgaHR0cHM6Ly9yZWdpc3RyeS5ucG1qcy5vcmcvQG5hcGktcnMvd2FzbS1ydW50aW1lYCxcbiAgICAgICkudGhlbigocmVzKSA9PiByZXMuanNvbigpIGFzIFByb21pc2U8UGFja2FnZU1ldGE+KVxuICAgICAgc2NvcGVkUGFja2FnZUpzb24uZGVwZW5kZW5jaWVzID0ge1xuICAgICAgICAnQG5hcGktcnMvd2FzbS1ydW50aW1lJzogYF4ke3dhc21SdW50aW1lWydkaXN0LXRhZ3MnXS5sYXRlc3R9YCxcbiAgICAgICAgJ0BlbW5hcGkvY29yZSc6IGVtbmFwaVZlcnNpb24sXG4gICAgICAgICdAZW1uYXBpL3J1bnRpbWUnOiBlbW5hcGlWZXJzaW9uLFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0YXJnZXQuYWJpID09PSAnZ251Jykge1xuICAgICAgc2NvcGVkUGFja2FnZUpzb24ubGliYyA9IFsnZ2xpYmMnXVxuICAgIH0gZWxzZSBpZiAodGFyZ2V0LmFiaSA9PT0gJ211c2wnKSB7XG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5saWJjID0gWydtdXNsJ11cbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRQYWNrYWdlSnNvbiA9IGpvaW4odGFyZ2V0RGlyLCAncGFja2FnZS5qc29uJylcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgIHRhcmdldFBhY2thZ2VKc29uLFxuICAgICAgSlNPTi5zdHJpbmdpZnkoc2NvcGVkUGFja2FnZUpzb24sIG51bGwsIDIpICsgJ1xcbicsXG4gICAgKVxuICAgIGNvbnN0IHRhcmdldFJlYWRtZSA9IGpvaW4odGFyZ2V0RGlyLCAnUkVBRE1FLm1kJylcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyh0YXJnZXRSZWFkbWUsIHJlYWRtZShwYWNrYWdlTmFtZSwgdGFyZ2V0KSlcblxuICAgIGRlYnVnLmluZm8oYCR7cGFja2FnZU5hbWV9IC0ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9IGNyZWF0ZWRgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlYWRtZShwYWNrYWdlTmFtZTogc3RyaW5nLCB0YXJnZXQ6IFRhcmdldCkge1xuICByZXR1cm4gYCMgXFxgJHtwYWNrYWdlTmFtZX0tJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfVxcYFxuXG5UaGlzIGlzIHRoZSAqKiR7dGFyZ2V0LnRyaXBsZX0qKiBiaW5hcnkgZm9yIFxcYCR7cGFja2FnZU5hbWV9XFxgXG5gXG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuaW1wb3J0ICogYXMgdHlwYW5pb24gZnJvbSAndHlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlTmV3Q29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWyduZXcnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ0NyZWF0ZSBhIG5ldyBwcm9qZWN0IHdpdGggcHJlLWNvbmZpZ3VyZWQgYm9pbGVycGxhdGUnLFxuICB9KVxuXG4gICQkcGF0aCA9IE9wdGlvbi5TdHJpbmcoeyByZXF1aXJlZDogZmFsc2UgfSlcblxuICAkJG5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLW5hbWUsLW4nLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIG5hbWUgb2YgdGhlIHByb2plY3QsIGRlZmF1bHQgdG8gdGhlIG5hbWUgb2YgdGhlIGRpcmVjdG9yeSBpZiBub3QgcHJvdmlkZWQnLFxuICB9KVxuXG4gIG1pbk5vZGVBcGlWZXJzaW9uID0gT3B0aW9uLlN0cmluZygnLS1taW4tbm9kZS1hcGksLXYnLCAnNCcsIHtcbiAgICB2YWxpZGF0b3I6IHR5cGFuaW9uLmlzTnVtYmVyKCksXG4gICAgZGVzY3JpcHRpb246ICdUaGUgbWluaW11bSBOb2RlLUFQSSB2ZXJzaW9uIHRvIHN1cHBvcnQnLFxuICB9KVxuXG4gIHBhY2thZ2VNYW5hZ2VyID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLW1hbmFnZXInLCAneWFybicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBwYWNrYWdlIG1hbmFnZXIgdG8gdXNlLiBPbmx5IHN1cHBvcnQgeWFybiA0LnggZm9yIG5vdy4nLFxuICB9KVxuXG4gIGxpY2Vuc2UgPSBPcHRpb24uU3RyaW5nKCctLWxpY2Vuc2UsLWwnLCAnTUlUJywge1xuICAgIGRlc2NyaXB0aW9uOiAnTGljZW5zZSBmb3Igb3Blbi1zb3VyY2VkIHByb2plY3QnLFxuICB9KVxuXG4gIHRhcmdldHMgPSBPcHRpb24uQXJyYXkoJy0tdGFyZ2V0cywtdCcsIFtdLCB7XG4gICAgZGVzY3JpcHRpb246ICdBbGwgdGFyZ2V0cyB0aGUgY3JhdGUgd2lsbCBiZSBjb21waWxlZCBmb3IuJyxcbiAgfSlcblxuICBlbmFibGVEZWZhdWx0VGFyZ2V0cyA9IE9wdGlvbi5Cb29sZWFuKCctLWVuYWJsZS1kZWZhdWx0LXRhcmdldHMnLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIGVuYWJsZSBkZWZhdWx0IHRhcmdldHMnLFxuICB9KVxuXG4gIGVuYWJsZUFsbFRhcmdldHMgPSBPcHRpb24uQm9vbGVhbignLS1lbmFibGUtYWxsLXRhcmdldHMnLCBmYWxzZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBlbmFibGUgYWxsIHRhcmdldHMnLFxuICB9KVxuXG4gIGVuYWJsZVR5cGVEZWYgPSBPcHRpb24uQm9vbGVhbignLS1lbmFibGUtdHlwZS1kZWYnLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnV2hldGhlciBlbmFibGUgdGhlIGB0eXBlLWRlZmAgZmVhdHVyZSBmb3IgdHlwZXNjcmlwdCBkZWZpbml0aW9ucyBhdXRvLWdlbmVyYXRpb24nLFxuICB9KVxuXG4gIGVuYWJsZUdpdGh1YkFjdGlvbnMgPSBPcHRpb24uQm9vbGVhbignLS1lbmFibGUtZ2l0aHViLWFjdGlvbnMnLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIGdlbmVyYXRlIHByZWNvbmZpZ3VyZWQgR2l0SHViIEFjdGlvbnMgd29ya2Zsb3cnLFxuICB9KVxuXG4gIHRlc3RGcmFtZXdvcmsgPSBPcHRpb24uU3RyaW5nKCctLXRlc3QtZnJhbWV3b3JrJywgJ2F2YScsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgSmF2YVNjcmlwdCB0ZXN0IGZyYW1ld29yayB0byB1c2UsIG9ubHkgc3VwcG9ydCBgYXZhYCBmb3Igbm93JyxcbiAgfSlcblxuICBkcnlSdW4gPSBPcHRpb24uQm9vbGVhbignLS1kcnktcnVuJywgZmFsc2UsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgdG8gcnVuIHRoZSBjb21tYW5kIGluIGRyeS1ydW4gbW9kZScsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgcGF0aDogdGhpcy4kJHBhdGgsXG4gICAgICBuYW1lOiB0aGlzLiQkbmFtZSxcbiAgICAgIG1pbk5vZGVBcGlWZXJzaW9uOiB0aGlzLm1pbk5vZGVBcGlWZXJzaW9uLFxuICAgICAgcGFja2FnZU1hbmFnZXI6IHRoaXMucGFja2FnZU1hbmFnZXIsXG4gICAgICBsaWNlbnNlOiB0aGlzLmxpY2Vuc2UsXG4gICAgICB0YXJnZXRzOiB0aGlzLnRhcmdldHMsXG4gICAgICBlbmFibGVEZWZhdWx0VGFyZ2V0czogdGhpcy5lbmFibGVEZWZhdWx0VGFyZ2V0cyxcbiAgICAgIGVuYWJsZUFsbFRhcmdldHM6IHRoaXMuZW5hYmxlQWxsVGFyZ2V0cyxcbiAgICAgIGVuYWJsZVR5cGVEZWY6IHRoaXMuZW5hYmxlVHlwZURlZixcbiAgICAgIGVuYWJsZUdpdGh1YkFjdGlvbnM6IHRoaXMuZW5hYmxlR2l0aHViQWN0aW9ucyxcbiAgICAgIHRlc3RGcmFtZXdvcms6IHRoaXMudGVzdEZyYW1ld29yayxcbiAgICAgIGRyeVJ1bjogdGhpcy5kcnlSdW4sXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIGEgbmV3IHByb2plY3Qgd2l0aCBwcmUtY29uZmlndXJlZCBib2lsZXJwbGF0ZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIE5ld09wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHBhdGggd2hlcmUgdGhlIE5BUEktUlMgcHJvamVjdCB3aWxsIGJlIGNyZWF0ZWQuXG4gICAqL1xuICBwYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmFtZSBvZiB0aGUgcHJvamVjdCwgZGVmYXVsdCB0byB0aGUgbmFtZSBvZiB0aGUgZGlyZWN0b3J5IGlmIG5vdCBwcm92aWRlZFxuICAgKi9cbiAgbmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG1pbmltdW0gTm9kZS1BUEkgdmVyc2lvbiB0byBzdXBwb3J0XG4gICAqXG4gICAqIEBkZWZhdWx0IDRcbiAgICovXG4gIG1pbk5vZGVBcGlWZXJzaW9uPzogbnVtYmVyXG4gIC8qKlxuICAgKiBUaGUgcGFja2FnZSBtYW5hZ2VyIHRvIHVzZS4gT25seSBzdXBwb3J0IHlhcm4gNC54IGZvciBub3cuXG4gICAqXG4gICAqIEBkZWZhdWx0ICd5YXJuJ1xuICAgKi9cbiAgcGFja2FnZU1hbmFnZXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIExpY2Vuc2UgZm9yIG9wZW4tc291cmNlZCBwcm9qZWN0XG4gICAqXG4gICAqIEBkZWZhdWx0ICdNSVQnXG4gICAqL1xuICBsaWNlbnNlPzogc3RyaW5nXG4gIC8qKlxuICAgKiBBbGwgdGFyZ2V0cyB0aGUgY3JhdGUgd2lsbCBiZSBjb21waWxlZCBmb3IuXG4gICAqXG4gICAqIEBkZWZhdWx0IFtdXG4gICAqL1xuICB0YXJnZXRzPzogc3RyaW5nW11cbiAgLyoqXG4gICAqIFdoZXRoZXIgZW5hYmxlIGRlZmF1bHQgdGFyZ2V0c1xuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBlbmFibGVEZWZhdWx0VGFyZ2V0cz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgZW5hYmxlIGFsbCB0YXJnZXRzXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBlbmFibGVBbGxUYXJnZXRzPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciBlbmFibGUgdGhlIGB0eXBlLWRlZmAgZmVhdHVyZSBmb3IgdHlwZXNjcmlwdCBkZWZpbml0aW9ucyBhdXRvLWdlbmVyYXRpb25cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZW5hYmxlVHlwZURlZj86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgZ2VuZXJhdGUgcHJlY29uZmlndXJlZCBHaXRIdWIgQWN0aW9ucyB3b3JrZmxvd1xuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBlbmFibGVHaXRodWJBY3Rpb25zPzogYm9vbGVhblxuICAvKipcbiAgICogVGhlIEphdmFTY3JpcHQgdGVzdCBmcmFtZXdvcmsgdG8gdXNlLCBvbmx5IHN1cHBvcnQgYGF2YWAgZm9yIG5vd1xuICAgKlxuICAgKiBAZGVmYXVsdCAnYXZhJ1xuICAgKi9cbiAgdGVzdEZyYW1ld29yaz86IHN0cmluZ1xuICAvKipcbiAgICogV2hldGhlciB0byBydW4gdGhlIGNvbW1hbmQgaW4gZHJ5LXJ1biBtb2RlXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBkcnlSdW4/OiBib29sZWFuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHROZXdPcHRpb25zKG9wdGlvbnM6IE5ld09wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBtaW5Ob2RlQXBpVmVyc2lvbjogNCxcbiAgICBwYWNrYWdlTWFuYWdlcjogJ3lhcm4nLFxuICAgIGxpY2Vuc2U6ICdNSVQnLFxuICAgIHRhcmdldHM6IFtdLFxuICAgIGVuYWJsZURlZmF1bHRUYXJnZXRzOiB0cnVlLFxuICAgIGVuYWJsZUFsbFRhcmdldHM6IGZhbHNlLFxuICAgIGVuYWJsZVR5cGVEZWY6IHRydWUsXG4gICAgZW5hYmxlR2l0aHViQWN0aW9uczogdHJ1ZSxcbiAgICB0ZXN0RnJhbWV3b3JrOiAnYXZhJyxcbiAgICBkcnlSdW46IGZhbHNlLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsIi8vIENvcHlyaWdodCAyMDE4LTIwMjUgdGhlIERlbm8gYXV0aG9ycy4gTUlUIGxpY2Vuc2UuXG4vLyBUaGlzIG1vZHVsZSBpcyBicm93c2VyIGNvbXBhdGlibGUuXG4vLyBCYXJlIGtleXMgbWF5IG9ubHkgY29udGFpbiBBU0NJSSBsZXR0ZXJzLFxuLy8gQVNDSUkgZGlnaXRzLCB1bmRlcnNjb3JlcywgYW5kIGRhc2hlcyAoQS1aYS16MC05Xy0pLlxuZnVuY3Rpb24gam9pbktleXMoa2V5cykge1xuICAvLyBEb3R0ZWQga2V5cyBhcmUgYSBzZXF1ZW5jZSBvZiBiYXJlIG9yIHF1b3RlZCBrZXlzIGpvaW5lZCB3aXRoIGEgZG90LlxuICAvLyBUaGlzIGFsbG93cyBmb3IgZ3JvdXBpbmcgc2ltaWxhciBwcm9wZXJ0aWVzIHRvZ2V0aGVyOlxuICByZXR1cm4ga2V5cy5tYXAoKHN0cik9PntcbiAgICByZXR1cm4gc3RyLmxlbmd0aCA9PT0gMCB8fCBzdHIubWF0Y2goL1teQS1aYS16MC05Xy1dLykgPyBKU09OLnN0cmluZ2lmeShzdHIpIDogc3RyO1xuICB9KS5qb2luKFwiLlwiKTtcbn1cbmNsYXNzIER1bXBlciB7XG4gIG1heFBhZCA9IDA7XG4gIHNyY09iamVjdDtcbiAgb3V0cHV0ID0gW107XG4gICNhcnJheVR5cGVDYWNoZSA9IG5ldyBNYXAoKTtcbiAgY29uc3RydWN0b3Ioc3JjT2JqYyl7XG4gICAgdGhpcy5zcmNPYmplY3QgPSBzcmNPYmpjO1xuICB9XG4gIGR1bXAoZm10T3B0aW9ucyA9IHt9KSB7XG4gICAgLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgICB0aGlzLm91dHB1dCA9IHRoaXMuI3ByaW50T2JqZWN0KHRoaXMuc3JjT2JqZWN0KTtcbiAgICB0aGlzLm91dHB1dCA9IHRoaXMuI2Zvcm1hdChmbXRPcHRpb25zKTtcbiAgICByZXR1cm4gdGhpcy5vdXRwdXQ7XG4gIH1cbiAgI3ByaW50T2JqZWN0KG9iaiwga2V5cyA9IFtdKSB7XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgY29uc3QgcHJvcHMgPSBPYmplY3Qua2V5cyhvYmopO1xuICAgIGNvbnN0IGlubGluZVByb3BzID0gW107XG4gICAgY29uc3QgbXVsdGlsaW5lUHJvcHMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IHByb3Agb2YgcHJvcHMpe1xuICAgICAgaWYgKHRoaXMuI2lzU2ltcGx5U2VyaWFsaXphYmxlKG9ialtwcm9wXSkpIHtcbiAgICAgICAgaW5saW5lUHJvcHMucHVzaChwcm9wKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG11bHRpbGluZVByb3BzLnB1c2gocHJvcCk7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZFByb3BzID0gaW5saW5lUHJvcHMuY29uY2F0KG11bHRpbGluZVByb3BzKTtcbiAgICBmb3IgKGNvbnN0IHByb3Agb2Ygc29ydGVkUHJvcHMpe1xuICAgICAgY29uc3QgdmFsdWUgPSBvYmpbcHJvcF07XG4gICAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIG91dC5wdXNoKHRoaXMuI2RhdGVEZWNsYXJhdGlvbihbXG4gICAgICAgICAgcHJvcFxuICAgICAgICBdLCB2YWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdmFsdWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgICAgb3V0LnB1c2godGhpcy4jc3RyRGVjbGFyYXRpb24oW1xuICAgICAgICAgIHByb3BcbiAgICAgICAgXSwgdmFsdWUudG9TdHJpbmcoKSkpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgb3V0LnB1c2godGhpcy4jbnVtYmVyRGVjbGFyYXRpb24oW1xuICAgICAgICAgIHByb3BcbiAgICAgICAgXSwgdmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgICAgICBvdXQucHVzaCh0aGlzLiNib29sRGVjbGFyYXRpb24oW1xuICAgICAgICAgIHByb3BcbiAgICAgICAgXSwgdmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAodmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICBjb25zdCBhcnJheVR5cGUgPSB0aGlzLiNnZXRUeXBlT2ZBcnJheSh2YWx1ZSk7XG4gICAgICAgIGlmIChhcnJheVR5cGUgPT09IFwiT05MWV9QUklNSVRJVkVcIikge1xuICAgICAgICAgIG91dC5wdXNoKHRoaXMuI2FycmF5RGVjbGFyYXRpb24oW1xuICAgICAgICAgICAgcHJvcFxuICAgICAgICAgIF0sIHZhbHVlKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoYXJyYXlUeXBlID09PSBcIk9OTFlfT0JKRUNUX0VYQ0xVRElOR19BUlJBWVwiKSB7XG4gICAgICAgICAgLy8gYXJyYXkgb2Ygb2JqZWN0c1xuICAgICAgICAgIGZvcihsZXQgaSA9IDA7IGkgPCB2YWx1ZS5sZW5ndGg7IGkrKyl7XG4gICAgICAgICAgICBvdXQucHVzaChcIlwiKTtcbiAgICAgICAgICAgIG91dC5wdXNoKHRoaXMuI2hlYWRlckdyb3VwKFtcbiAgICAgICAgICAgICAgLi4ua2V5cyxcbiAgICAgICAgICAgICAgcHJvcFxuICAgICAgICAgICAgXSkpO1xuICAgICAgICAgICAgb3V0LnB1c2goLi4udGhpcy4jcHJpbnRPYmplY3QodmFsdWVbaV0sIFtcbiAgICAgICAgICAgICAgLi4ua2V5cyxcbiAgICAgICAgICAgICAgcHJvcFxuICAgICAgICAgICAgXSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB0aGlzIGlzIGEgY29tcGxleCBhcnJheSwgdXNlIHRoZSBpbmxpbmUgZm9ybWF0LlxuICAgICAgICAgIGNvbnN0IHN0ciA9IHZhbHVlLm1hcCgoeCk9PnRoaXMuI3ByaW50QXNJbmxpbmVWYWx1ZSh4KSkuam9pbihcIixcIik7XG4gICAgICAgICAgb3V0LnB1c2goYCR7dGhpcy4jZGVjbGFyYXRpb24oW1xuICAgICAgICAgICAgcHJvcFxuICAgICAgICAgIF0pfVske3N0cn1dYCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICAgIG91dC5wdXNoKFwiXCIpO1xuICAgICAgICBvdXQucHVzaCh0aGlzLiNoZWFkZXIoW1xuICAgICAgICAgIC4uLmtleXMsXG4gICAgICAgICAgcHJvcFxuICAgICAgICBdKSk7XG4gICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgIGNvbnN0IHRvUGFyc2UgPSB2YWx1ZTtcbiAgICAgICAgICBvdXQucHVzaCguLi50aGlzLiNwcmludE9iamVjdCh0b1BhcnNlLCBbXG4gICAgICAgICAgICAuLi5rZXlzLFxuICAgICAgICAgICAgcHJvcFxuICAgICAgICAgIF0pKTtcbiAgICAgICAgfVxuICAgICAgLy8gb3V0LnB1c2goLi4udGhpcy5fcGFyc2UodmFsdWUsIGAke3BhdGh9JHtwcm9wfS5gKSk7XG4gICAgICB9XG4gICAgfVxuICAgIG91dC5wdXNoKFwiXCIpO1xuICAgIHJldHVybiBvdXQ7XG4gIH1cbiAgI2lzUHJpbWl0aXZlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlIGluc3RhbmNlb2YgRGF0ZSB8fCB2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCB8fCBbXG4gICAgICBcInN0cmluZ1wiLFxuICAgICAgXCJudW1iZXJcIixcbiAgICAgIFwiYm9vbGVhblwiXG4gICAgXS5pbmNsdWRlcyh0eXBlb2YgdmFsdWUpO1xuICB9XG4gICNnZXRUeXBlT2ZBcnJheShhcnIpIHtcbiAgICBpZiAodGhpcy4jYXJyYXlUeXBlQ2FjaGUuaGFzKGFycikpIHtcbiAgICAgIHJldHVybiB0aGlzLiNhcnJheVR5cGVDYWNoZS5nZXQoYXJyKTtcbiAgICB9XG4gICAgY29uc3QgdHlwZSA9IHRoaXMuI2RvR2V0VHlwZU9mQXJyYXkoYXJyKTtcbiAgICB0aGlzLiNhcnJheVR5cGVDYWNoZS5zZXQoYXJyLCB0eXBlKTtcbiAgICByZXR1cm4gdHlwZTtcbiAgfVxuICAjZG9HZXRUeXBlT2ZBcnJheShhcnIpIHtcbiAgICBpZiAoIWFyci5sZW5ndGgpIHtcbiAgICAgIC8vIGFueSB0eXBlIHNob3VsZCBiZSBmaW5lXG4gICAgICByZXR1cm4gXCJPTkxZX1BSSU1JVElWRVwiO1xuICAgIH1cbiAgICBjb25zdCBvbmx5UHJpbWl0aXZlID0gdGhpcy4jaXNQcmltaXRpdmUoYXJyWzBdKTtcbiAgICBpZiAoYXJyWzBdIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHJldHVybiBcIk1JWEVEXCI7XG4gICAgfVxuICAgIGZvcihsZXQgaSA9IDE7IGkgPCBhcnIubGVuZ3RoOyBpKyspe1xuICAgICAgaWYgKG9ubHlQcmltaXRpdmUgIT09IHRoaXMuI2lzUHJpbWl0aXZlKGFycltpXSkgfHwgYXJyW2ldIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIFwiTUlYRURcIjtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG9ubHlQcmltaXRpdmUgPyBcIk9OTFlfUFJJTUlUSVZFXCIgOiBcIk9OTFlfT0JKRUNUX0VYQ0xVRElOR19BUlJBWVwiO1xuICB9XG4gICNwcmludEFzSW5saW5lVmFsdWUodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gYFwiJHt0aGlzLiNwcmludERhdGUodmFsdWUpfVwiYDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlLnRvU3RyaW5nKCkpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICByZXR1cm4gdmFsdWUudG9TdHJpbmcoKTtcbiAgICB9IGVsc2UgaWYgKHZhbHVlIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIGNvbnN0IHN0ciA9IHZhbHVlLm1hcCgoeCk9PnRoaXMuI3ByaW50QXNJbmxpbmVWYWx1ZSh4KSkuam9pbihcIixcIik7XG4gICAgICByZXR1cm4gYFske3N0cn1dYDtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTaG91bGQgbmV2ZXIgcmVhY2hcIik7XG4gICAgICB9XG4gICAgICBjb25zdCBzdHIgPSBPYmplY3Qua2V5cyh2YWx1ZSkubWFwKChrZXkpPT57XG4gICAgICAgIHJldHVybiBgJHtqb2luS2V5cyhbXG4gICAgICAgICAga2V5XG4gICAgICAgIF0pfSA9ICR7Ly8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbiAgICAgICAgdGhpcy4jcHJpbnRBc0lubGluZVZhbHVlKHZhbHVlW2tleV0pfWA7XG4gICAgICB9KS5qb2luKFwiLFwiKTtcbiAgICAgIHJldHVybiBgeyR7c3RyfX1gO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJTaG91bGQgbmV2ZXIgcmVhY2hcIik7XG4gIH1cbiAgI2lzU2ltcGx5U2VyaWFsaXphYmxlKHZhbHVlKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIiB8fCB2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCB8fCB2YWx1ZSBpbnN0YW5jZW9mIERhdGUgfHwgdmFsdWUgaW5zdGFuY2VvZiBBcnJheSAmJiB0aGlzLiNnZXRUeXBlT2ZBcnJheSh2YWx1ZSkgIT09IFwiT05MWV9PQkpFQ1RfRVhDTFVESU5HX0FSUkFZXCI7XG4gIH1cbiAgI2hlYWRlcihrZXlzKSB7XG4gICAgcmV0dXJuIGBbJHtqb2luS2V5cyhrZXlzKX1dYDtcbiAgfVxuICAjaGVhZGVyR3JvdXAoa2V5cykge1xuICAgIHJldHVybiBgW1ske2pvaW5LZXlzKGtleXMpfV1dYDtcbiAgfVxuICAjZGVjbGFyYXRpb24oa2V5cykge1xuICAgIGNvbnN0IHRpdGxlID0gam9pbktleXMoa2V5cyk7XG4gICAgaWYgKHRpdGxlLmxlbmd0aCA+IHRoaXMubWF4UGFkKSB7XG4gICAgICB0aGlzLm1heFBhZCA9IHRpdGxlLmxlbmd0aDtcbiAgICB9XG4gICAgcmV0dXJuIGAke3RpdGxlfSA9IGA7XG4gIH1cbiAgI2FycmF5RGVjbGFyYXRpb24oa2V5cywgdmFsdWUpIHtcbiAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9JHtKU09OLnN0cmluZ2lmeSh2YWx1ZSl9YDtcbiAgfVxuICAjc3RyRGVjbGFyYXRpb24oa2V5cywgdmFsdWUpIHtcbiAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9JHtKU09OLnN0cmluZ2lmeSh2YWx1ZSl9YDtcbiAgfVxuICAjbnVtYmVyRGVjbGFyYXRpb24oa2V5cywgdmFsdWUpIHtcbiAgICBpZiAoTnVtYmVyLmlzTmFOKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfW5hbmA7XG4gICAgfVxuICAgIHN3aXRjaCh2YWx1ZSl7XG4gICAgICBjYXNlIEluZmluaXR5OlxuICAgICAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9aW5mYDtcbiAgICAgIGNhc2UgLUluZmluaXR5OlxuICAgICAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9LWluZmA7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9JHt2YWx1ZX1gO1xuICAgIH1cbiAgfVxuICAjYm9vbERlY2xhcmF0aW9uKGtleXMsIHZhbHVlKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfSR7dmFsdWV9YDtcbiAgfVxuICAjcHJpbnREYXRlKHZhbHVlKSB7XG4gICAgZnVuY3Rpb24gZHRQYWQodiwgbFBhZCA9IDIpIHtcbiAgICAgIHJldHVybiB2LnBhZFN0YXJ0KGxQYWQsIFwiMFwiKTtcbiAgICB9XG4gICAgY29uc3QgbSA9IGR0UGFkKCh2YWx1ZS5nZXRVVENNb250aCgpICsgMSkudG9TdHJpbmcoKSk7XG4gICAgY29uc3QgZCA9IGR0UGFkKHZhbHVlLmdldFVUQ0RhdGUoKS50b1N0cmluZygpKTtcbiAgICBjb25zdCBoID0gZHRQYWQodmFsdWUuZ2V0VVRDSG91cnMoKS50b1N0cmluZygpKTtcbiAgICBjb25zdCBtaW4gPSBkdFBhZCh2YWx1ZS5nZXRVVENNaW51dGVzKCkudG9TdHJpbmcoKSk7XG4gICAgY29uc3QgcyA9IGR0UGFkKHZhbHVlLmdldFVUQ1NlY29uZHMoKS50b1N0cmluZygpKTtcbiAgICBjb25zdCBtcyA9IGR0UGFkKHZhbHVlLmdldFVUQ01pbGxpc2Vjb25kcygpLnRvU3RyaW5nKCksIDMpO1xuICAgIC8vIGZvcm1hdHRlZCBkYXRlXG4gICAgY29uc3QgZkRhdGEgPSBgJHt2YWx1ZS5nZXRVVENGdWxsWWVhcigpfS0ke219LSR7ZH1UJHtofToke21pbn06JHtzfS4ke21zfWA7XG4gICAgcmV0dXJuIGZEYXRhO1xuICB9XG4gICNkYXRlRGVjbGFyYXRpb24oa2V5cywgdmFsdWUpIHtcbiAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9JHt0aGlzLiNwcmludERhdGUodmFsdWUpfWA7XG4gIH1cbiAgI2Zvcm1hdChvcHRpb25zID0ge30pIHtcbiAgICBjb25zdCB7IGtleUFsaWdubWVudCA9IGZhbHNlIH0gPSBvcHRpb25zO1xuICAgIGNvbnN0IHJEZWNsYXJhdGlvbiA9IC9eKFxcXCIuKlxcXCJ8W149XSopXFxzPS87XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgZm9yKGxldCBpID0gMDsgaSA8IHRoaXMub3V0cHV0Lmxlbmd0aDsgaSsrKXtcbiAgICAgIGNvbnN0IGwgPSB0aGlzLm91dHB1dFtpXTtcbiAgICAgIC8vIHdlIGtlZXAgZW1wdHkgZW50cnkgZm9yIGFycmF5IG9mIG9iamVjdHNcbiAgICAgIGlmIChsWzBdID09PSBcIltcIiAmJiBsWzFdICE9PSBcIltcIikge1xuICAgICAgICAvLyBub24tZW1wdHkgb2JqZWN0IHdpdGggb25seSBzdWJvYmplY3RzIGFzIHByb3BlcnRpZXNcbiAgICAgICAgaWYgKHRoaXMub3V0cHV0W2kgKyAxXSA9PT0gXCJcIiAmJiB0aGlzLm91dHB1dFtpICsgMl0/LnNsaWNlKDAsIGwubGVuZ3RoKSA9PT0gbC5zbGljZSgwLCAtMSkgKyBcIi5cIikge1xuICAgICAgICAgIGkgKz0gMTtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBvdXQucHVzaChsKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChrZXlBbGlnbm1lbnQpIHtcbiAgICAgICAgICBjb25zdCBtID0gckRlY2xhcmF0aW9uLmV4ZWMobCk7XG4gICAgICAgICAgaWYgKG0gJiYgbVsxXSkge1xuICAgICAgICAgICAgb3V0LnB1c2gobC5yZXBsYWNlKG1bMV0sIG1bMV0ucGFkRW5kKHRoaXMubWF4UGFkKSkpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvdXQucHVzaChsKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb3V0LnB1c2gobCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgLy8gQ2xlYW5pbmcgbXVsdGlwbGUgc3BhY2VzXG4gICAgY29uc3QgY2xlYW5lZE91dHB1dCA9IFtdO1xuICAgIGZvcihsZXQgaSA9IDA7IGkgPCBvdXQubGVuZ3RoOyBpKyspe1xuICAgICAgY29uc3QgbCA9IG91dFtpXTtcbiAgICAgIGlmICghKGwgPT09IFwiXCIgJiYgb3V0W2kgKyAxXSA9PT0gXCJcIikpIHtcbiAgICAgICAgY2xlYW5lZE91dHB1dC5wdXNoKGwpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gY2xlYW5lZE91dHB1dDtcbiAgfVxufVxuLyoqXG4gKiBDb252ZXJ0cyBhbiBvYmplY3QgdG8gYSB7QGxpbmsgaHR0cHM6Ly90b21sLmlvIHwgVE9NTH0gc3RyaW5nLlxuICpcbiAqIEBleGFtcGxlIFVzYWdlXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgc3RyaW5naWZ5IH0gZnJvbSBcIkBzdGQvdG9tbC9zdHJpbmdpZnlcIjtcbiAqIGltcG9ydCB7IGFzc2VydEVxdWFscyB9IGZyb20gXCJAc3RkL2Fzc2VydFwiO1xuICpcbiAqIGNvbnN0IG9iaiA9IHtcbiAqICAgdGl0bGU6IFwiVE9NTCBFeGFtcGxlXCIsXG4gKiAgIG93bmVyOiB7XG4gKiAgICAgbmFtZTogXCJCb2JcIixcbiAqICAgICBiaW86IFwiQm9iIGlzIGEgY29vbCBndXlcIixcbiAqICB9XG4gKiB9O1xuICogY29uc3QgdG9tbFN0cmluZyA9IHN0cmluZ2lmeShvYmopO1xuICogYXNzZXJ0RXF1YWxzKHRvbWxTdHJpbmcsIGB0aXRsZSA9IFwiVE9NTCBFeGFtcGxlXCJcXG5cXG5bb3duZXJdXFxubmFtZSA9IFwiQm9iXCJcXG5iaW8gPSBcIkJvYiBpcyBhIGNvb2wgZ3V5XCJcXG5gKTtcbiAqIGBgYFxuICogQHBhcmFtIG9iaiBTb3VyY2Ugb2JqZWN0XG4gKiBAcGFyYW0gb3B0aW9ucyBPcHRpb25zIGZvciBzdHJpbmdpZnlpbmcuXG4gKiBAcmV0dXJucyBUT01MIHN0cmluZ1xuICovIGV4cG9ydCBmdW5jdGlvbiBzdHJpbmdpZnkob2JqLCBvcHRpb25zKSB7XG4gIHJldHVybiBuZXcgRHVtcGVyKG9iaikuZHVtcChvcHRpb25zKS5qb2luKFwiXFxuXCIpO1xufVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9c3RyaW5naWZ5LmpzLm1hcCIsIi8vIENvcHlyaWdodCAyMDE4LTIwMjYgdGhlIERlbm8gYXV0aG9ycy4gTUlUIGxpY2Vuc2UuXG4vLyBUaGlzIG1vZHVsZSBpcyBicm93c2VyIGNvbXBhdGlibGUuXG4vKiogRGVmYXVsdCBtZXJnaW5nIG9wdGlvbnMgLSBjYWNoZWQgdG8gYXZvaWQgb2JqZWN0IGFsbG9jYXRpb24gb24gZWFjaCBjYWxsICovIGNvbnN0IERFRkFVTFRfT1BUSU9OUyA9IHtcbiAgYXJyYXlzOiBcIm1lcmdlXCIsXG4gIHNldHM6IFwibWVyZ2VcIixcbiAgbWFwczogXCJtZXJnZVwiXG59O1xuZXhwb3J0IGZ1bmN0aW9uIGRlZXBNZXJnZShyZWNvcmQsIG90aGVyLCBvcHRpb25zKSB7XG4gIHJldHVybiBkZWVwTWVyZ2VJbnRlcm5hbChyZWNvcmQsIG90aGVyLCBuZXcgU2V0KCksIG9wdGlvbnMgPz8gREVGQVVMVF9PUFRJT05TKTtcbn1cbmZ1bmN0aW9uIGRlZXBNZXJnZUludGVybmFsKHJlY29yZCwgb3RoZXIsIHNlZW4sIG9wdGlvbnMpIHtcbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGNvbnN0IGtleXMgPSBuZXcgU2V0KFtcbiAgICAuLi5nZXRLZXlzKHJlY29yZCksXG4gICAgLi4uZ2V0S2V5cyhvdGhlcilcbiAgXSk7XG4gIC8vIEl0ZXJhdGUgdGhyb3VnaCBlYWNoIGtleSBvZiBvdGhlciBvYmplY3QgYW5kIHVzZSBjb3JyZWN0IG1lcmdpbmcgc3RyYXRlZ3lcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cyl7XG4gICAgLy8gU2tpcCB0byBwcmV2ZW50IE9iamVjdC5wcm90b3R5cGUuX19wcm90b19fIGFjY2Vzc29yIHByb3BlcnR5IGNhbGxzIG9uIG5vbi1EZW5vIHBsYXRmb3Jtc1xuICAgIGlmIChrZXkgPT09IFwiX19wcm90b19fXCIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBhID0gcmVjb3JkW2tleV07XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKG90aGVyLCBrZXkpKSB7XG4gICAgICByZXN1bHRba2V5XSA9IGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYiA9IG90aGVyW2tleV07XG4gICAgaWYgKGlzTm9uTnVsbE9iamVjdChhKSAmJiBpc05vbk51bGxPYmplY3QoYikgJiYgIXNlZW4uaGFzKGEpICYmICFzZWVuLmhhcyhiKSkge1xuICAgICAgc2Vlbi5hZGQoYSk7XG4gICAgICBzZWVuLmFkZChiKTtcbiAgICAgIHJlc3VsdFtrZXldID0gbWVyZ2VPYmplY3RzKGEsIGIsIHNlZW4sIG9wdGlvbnMpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIE92ZXJyaWRlIHZhbHVlXG4gICAgcmVzdWx0W2tleV0gPSBiO1xuICB9XG4gIHJldHVybiByZXN1bHQ7XG59XG5mdW5jdGlvbiBtZXJnZU9iamVjdHMobGVmdCwgcmlnaHQsIHNlZW4sIG9wdGlvbnMpIHtcbiAgLy8gUmVjdXJzaXZlbHkgbWVyZ2UgbWVyZ2VhYmxlIG9iamVjdHNcbiAgaWYgKGlzTWVyZ2VhYmxlKGxlZnQpICYmIGlzTWVyZ2VhYmxlKHJpZ2h0KSkge1xuICAgIHJldHVybiBkZWVwTWVyZ2VJbnRlcm5hbChsZWZ0LCByaWdodCwgc2Vlbiwgb3B0aW9ucyk7XG4gIH1cbiAgaWYgKGlzSXRlcmFibGUobGVmdCkgJiYgaXNJdGVyYWJsZShyaWdodCkpIHtcbiAgICAvLyBIYW5kbGUgYXJyYXlzXG4gICAgaWYgKEFycmF5LmlzQXJyYXkobGVmdCkgJiYgQXJyYXkuaXNBcnJheShyaWdodCkpIHtcbiAgICAgIGlmIChvcHRpb25zLmFycmF5cyA9PT0gXCJtZXJnZVwiKSB7XG4gICAgICAgIHJldHVybiBsZWZ0LmNvbmNhdChyaWdodCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmlnaHQ7XG4gICAgfVxuICAgIC8vIEhhbmRsZSBtYXBzXG4gICAgaWYgKGxlZnQgaW5zdGFuY2VvZiBNYXAgJiYgcmlnaHQgaW5zdGFuY2VvZiBNYXApIHtcbiAgICAgIGlmIChvcHRpb25zLm1hcHMgPT09IFwibWVyZ2VcIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBuZXcgTWFwKGxlZnQpO1xuICAgICAgICBmb3IgKGNvbnN0IFtrLCB2XSBvZiByaWdodCl7XG4gICAgICAgICAgcmVzdWx0LnNldChrLCB2KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJpZ2h0O1xuICAgIH1cbiAgICAvLyBIYW5kbGUgc2V0c1xuICAgIGlmIChsZWZ0IGluc3RhbmNlb2YgU2V0ICYmIHJpZ2h0IGluc3RhbmNlb2YgU2V0KSB7XG4gICAgICBpZiAob3B0aW9ucy5zZXRzID09PSBcIm1lcmdlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gbmV3IFNldChsZWZ0KTtcbiAgICAgICAgZm9yIChjb25zdCB2IG9mIHJpZ2h0KXtcbiAgICAgICAgICByZXN1bHQuYWRkKHYpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmlnaHQ7XG4gICAgfVxuICB9XG4gIHJldHVybiByaWdodDtcbn1cbi8qKlxuICogVGVzdCB3aGV0aGVyIGEgdmFsdWUgaXMgbWVyZ2VhYmxlIG9yIG5vdFxuICogQnVpbHRpbnMgdGhhdCBsb29rIGxpa2Ugb2JqZWN0cywgbnVsbCBhbmQgdXNlciBkZWZpbmVkIGNsYXNzZXNcbiAqIGFyZSBub3QgY29uc2lkZXJlZCBtZXJnZWFibGUgKGl0IG1lYW5zIHRoYXQgcmVmZXJlbmNlIHdpbGwgYmUgY29waWVkKVxuICovIGZ1bmN0aW9uIGlzTWVyZ2VhYmxlKHZhbHVlKSB7XG4gIHJldHVybiBPYmplY3QuZ2V0UHJvdG90eXBlT2YodmFsdWUpID09PSBPYmplY3QucHJvdG90eXBlO1xufVxuZnVuY3Rpb24gaXNJdGVyYWJsZSh2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlW1N5bWJvbC5pdGVyYXRvcl0gPT09IFwiZnVuY3Rpb25cIjtcbn1cbmZ1bmN0aW9uIGlzTm9uTnVsbE9iamVjdCh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgIT09IG51bGwgJiYgdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiO1xufVxuZnVuY3Rpb24gZ2V0S2V5cyhyZWNvcmQpIHtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHJlY29yZCk7XG4gIGNvbnN0IHN5bWJvbHMgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKHJlY29yZCk7XG4gIC8vIEZhc3QgcGF0aDogbW9zdCBvYmplY3RzIGhhdmUgbm8gc3ltYm9sIGtleXNcbiAgaWYgKHN5bWJvbHMubGVuZ3RoID09PSAwKSByZXR1cm4ga2V5cztcbiAgZm9yIChjb25zdCBzeW0gb2Ygc3ltYm9scyl7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGUuY2FsbChyZWNvcmQsIHN5bSkpIHtcbiAgICAgIGtleXMucHVzaChzeW0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cztcbn1cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWRlZXBfbWVyZ2UuanMubWFwIiwiLy8gQ29weXJpZ2h0IDIwMTgtMjAyNSB0aGUgRGVubyBhdXRob3JzLiBNSVQgbGljZW5zZS5cbi8vIFRoaXMgbW9kdWxlIGlzIGJyb3dzZXIgY29tcGF0aWJsZS5cbmltcG9ydCB7IGRlZXBNZXJnZSB9IGZyb20gXCJAanNyL3N0ZF9fY29sbGVjdGlvbnMvZGVlcC1tZXJnZVwiO1xuLyoqXG4gKiBDb3B5IG9mIGBpbXBvcnQgeyBpc0xlYXAgfSBmcm9tIFwiQHN0ZC9kYXRldGltZVwiO2AgYmVjYXVzZSBpdCBjYW5ub3QgYmUgaW1wb3RlZCBhcyBsb25nIGFzIGl0IGlzIHVuc3RhYmxlLlxuICovIGZ1bmN0aW9uIGlzTGVhcCh5ZWFyTnVtYmVyKSB7XG4gIHJldHVybiB5ZWFyTnVtYmVyICUgNCA9PT0gMCAmJiB5ZWFyTnVtYmVyICUgMTAwICE9PSAwIHx8IHllYXJOdW1iZXIgJSA0MDAgPT09IDA7XG59XG5leHBvcnQgY2xhc3MgU2Nhbm5lciB7XG4gICN3aGl0ZXNwYWNlID0gL1sgXFx0XS87XG4gICNwb3NpdGlvbiA9IDA7XG4gICNzb3VyY2U7XG4gIGNvbnN0cnVjdG9yKHNvdXJjZSl7XG4gICAgdGhpcy4jc291cmNlID0gc291cmNlO1xuICB9XG4gIGdldCBwb3NpdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy4jcG9zaXRpb247XG4gIH1cbiAgZ2V0IHNvdXJjZSgpIHtcbiAgICByZXR1cm4gdGhpcy4jc291cmNlO1xuICB9XG4gIC8qKlxuICAgKiBHZXQgY3VycmVudCBjaGFyYWN0ZXJcbiAgICogQHBhcmFtIGluZGV4IC0gcmVsYXRpdmUgaW5kZXggZnJvbSBjdXJyZW50IHBvc2l0aW9uXG4gICAqLyBjaGFyKGluZGV4ID0gMCkge1xuICAgIHJldHVybiB0aGlzLiNzb3VyY2VbdGhpcy4jcG9zaXRpb24gKyBpbmRleF0gPz8gXCJcIjtcbiAgfVxuICAvKipcbiAgICogR2V0IHNsaWNlZCBzdHJpbmdcbiAgICogQHBhcmFtIHN0YXJ0IC0gc3RhcnQgcG9zaXRpb24gcmVsYXRpdmUgZnJvbSBjdXJyZW50IHBvc2l0aW9uXG4gICAqIEBwYXJhbSBlbmQgLSBlbmQgcG9zaXRpb24gcmVsYXRpdmUgZnJvbSBjdXJyZW50IHBvc2l0aW9uXG4gICAqLyBzbGljZShzdGFydCwgZW5kKSB7XG4gICAgcmV0dXJuIHRoaXMuI3NvdXJjZS5zbGljZSh0aGlzLiNwb3NpdGlvbiArIHN0YXJ0LCB0aGlzLiNwb3NpdGlvbiArIGVuZCk7XG4gIH1cbiAgLyoqXG4gICAqIE1vdmUgcG9zaXRpb24gdG8gbmV4dFxuICAgKi8gbmV4dChjb3VudCA9IDEpIHtcbiAgICB0aGlzLiNwb3NpdGlvbiArPSBjb3VudDtcbiAgfVxuICBza2lwV2hpdGVzcGFjZXMoKSB7XG4gICAgd2hpbGUodGhpcy4jd2hpdGVzcGFjZS50ZXN0KHRoaXMuY2hhcigpKSAmJiAhdGhpcy5lb2YoKSl7XG4gICAgICB0aGlzLm5leHQoKTtcbiAgICB9XG4gICAgLy8gSW52YWxpZCBpZiBjdXJyZW50IGNoYXIgaXMgb3RoZXIga2luZHMgb2Ygd2hpdGVzcGFjZVxuICAgIGlmICghdGhpcy5pc0N1cnJlbnRDaGFyRU9MKCkgJiYgL1xccy8udGVzdCh0aGlzLmNoYXIoKSkpIHtcbiAgICAgIGNvbnN0IGVzY2FwZWQgPSBcIlxcXFx1XCIgKyB0aGlzLmNoYXIoKS5jaGFyQ29kZUF0KDApLnRvU3RyaW5nKDE2KTtcbiAgICAgIGNvbnN0IHBvc2l0aW9uID0gdGhpcy4jcG9zaXRpb247XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYENhbm5vdCBwYXJzZSB0aGUgVE9NTDogSXQgY29udGFpbnMgaW52YWxpZCB3aGl0ZXNwYWNlIGF0IHBvc2l0aW9uICcke3Bvc2l0aW9ufSc6IFxcYCR7ZXNjYXBlZH1cXGBgKTtcbiAgICB9XG4gIH1cbiAgbmV4dFVudGlsQ2hhcihvcHRpb25zID0ge1xuICAgIHNraXBDb21tZW50czogdHJ1ZVxuICB9KSB7XG4gICAgd2hpbGUoIXRoaXMuZW9mKCkpe1xuICAgICAgY29uc3QgY2hhciA9IHRoaXMuY2hhcigpO1xuICAgICAgaWYgKHRoaXMuI3doaXRlc3BhY2UudGVzdChjaGFyKSB8fCB0aGlzLmlzQ3VycmVudENoYXJFT0woKSkge1xuICAgICAgICB0aGlzLm5leHQoKTtcbiAgICAgIH0gZWxzZSBpZiAob3B0aW9ucy5za2lwQ29tbWVudHMgJiYgdGhpcy5jaGFyKCkgPT09IFwiI1wiKSB7XG4gICAgICAgIC8vIGVudGVyaW5nIGNvbW1lbnRcbiAgICAgICAgd2hpbGUoIXRoaXMuaXNDdXJyZW50Q2hhckVPTCgpICYmICF0aGlzLmVvZigpKXtcbiAgICAgICAgICB0aGlzLm5leHQoKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIC8qKlxuICAgKiBQb3NpdGlvbiByZWFjaGVkIEVPRiBvciBub3RcbiAgICovIGVvZigpIHtcbiAgICByZXR1cm4gdGhpcy4jcG9zaXRpb24gPj0gdGhpcy4jc291cmNlLmxlbmd0aDtcbiAgfVxuICBpc0N1cnJlbnRDaGFyRU9MKCkge1xuICAgIHJldHVybiB0aGlzLmNoYXIoKSA9PT0gXCJcXG5cIiB8fCB0aGlzLnN0YXJ0c1dpdGgoXCJcXHJcXG5cIik7XG4gIH1cbiAgc3RhcnRzV2l0aChzZWFyY2hTdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy4jc291cmNlLnN0YXJ0c1dpdGgoc2VhcmNoU3RyaW5nLCB0aGlzLiNwb3NpdGlvbik7XG4gIH1cbiAgbWF0Y2gocmVnRXhwKSB7XG4gICAgaWYgKCFyZWdFeHAuc3RpY2t5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFJlZ0V4cCAke3JlZ0V4cH0gZG9lcyBub3QgaGF2ZSBhIHN0aWNreSAneScgZmxhZ2ApO1xuICAgIH1cbiAgICByZWdFeHAubGFzdEluZGV4ID0gdGhpcy4jcG9zaXRpb247XG4gICAgcmV0dXJuIHRoaXMuI3NvdXJjZS5tYXRjaChyZWdFeHApO1xuICB9XG59XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gVXRpbGl0aWVzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuZnVuY3Rpb24gc3VjY2Vzcyhib2R5KSB7XG4gIHJldHVybiB7XG4gICAgb2s6IHRydWUsXG4gICAgYm9keVxuICB9O1xufVxuZnVuY3Rpb24gZmFpbHVyZSgpIHtcbiAgcmV0dXJuIHtcbiAgICBvazogZmFsc2VcbiAgfTtcbn1cbi8qKlxuICogQ3JlYXRlcyBhIG5lc3RlZCBvYmplY3QgZnJvbSB0aGUga2V5cyBhbmQgdmFsdWVzLlxuICpcbiAqIGUuZy4gYHVuZmxhdChbXCJhXCIsIFwiYlwiLCBcImNcIl0sIDEpYCByZXR1cm5zIGB7IGE6IHsgYjogeyBjOiAxIH0gfSB9YFxuICovIGV4cG9ydCBmdW5jdGlvbiB1bmZsYXQoa2V5cywgdmFsdWVzID0ge1xuICBfX3Byb3RvX186IG51bGxcbn0pIHtcbiAgcmV0dXJuIGtleXMucmVkdWNlUmlnaHQoKGFjYywga2V5KT0+KHtcbiAgICAgIFtrZXldOiBhY2NcbiAgICB9KSwgdmFsdWVzKTtcbn1cbmZ1bmN0aW9uIGlzT2JqZWN0KHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIgJiYgdmFsdWUgIT09IG51bGw7XG59XG5mdW5jdGlvbiBnZXRUYXJnZXRWYWx1ZSh0YXJnZXQsIGtleXMpIHtcbiAgY29uc3Qga2V5ID0ga2V5c1swXTtcbiAgaWYgKCFrZXkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJDYW5ub3QgcGFyc2UgdGhlIFRPTUw6IGtleSBsZW5ndGggaXMgbm90IGEgcG9zaXRpdmUgbnVtYmVyXCIpO1xuICB9XG4gIHJldHVybiB0YXJnZXRba2V5XTtcbn1cbmZ1bmN0aW9uIGRlZXBBc3NpZ25UYWJsZSh0YXJnZXQsIHRhYmxlKSB7XG4gIGNvbnN0IHsga2V5cywgdHlwZSwgdmFsdWUgfSA9IHRhYmxlO1xuICBjb25zdCBjdXJyZW50VmFsdWUgPSBnZXRUYXJnZXRWYWx1ZSh0YXJnZXQsIGtleXMpO1xuICBpZiAoY3VycmVudFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih0YXJnZXQsIHVuZmxhdChrZXlzLCB2YWx1ZSkpO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnRWYWx1ZSkpIHtcbiAgICBjb25zdCBsYXN0ID0gY3VycmVudFZhbHVlLmF0KC0xKTtcbiAgICBkZWVwQXNzaWduKGxhc3QsIHtcbiAgICAgIHR5cGUsXG4gICAgICBrZXlzOiBrZXlzLnNsaWNlKDEpLFxuICAgICAgdmFsdWVcbiAgICB9KTtcbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIGlmIChpc09iamVjdChjdXJyZW50VmFsdWUpKSB7XG4gICAgZGVlcEFzc2lnbihjdXJyZW50VmFsdWUsIHtcbiAgICAgIHR5cGUsXG4gICAgICBrZXlzOiBrZXlzLnNsaWNlKDEpLFxuICAgICAgdmFsdWVcbiAgICB9KTtcbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcIlVuZXhwZWN0ZWQgYXNzaWduXCIpO1xufVxuZnVuY3Rpb24gZGVlcEFzc2lnblRhYmxlQXJyYXkodGFyZ2V0LCB0YWJsZSkge1xuICBjb25zdCB7IHR5cGUsIGtleXMsIHZhbHVlIH0gPSB0YWJsZTtcbiAgY29uc3QgY3VycmVudFZhbHVlID0gZ2V0VGFyZ2V0VmFsdWUodGFyZ2V0LCBrZXlzKTtcbiAgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24odGFyZ2V0LCB1bmZsYXQoa2V5cywgW1xuICAgICAgdmFsdWVcbiAgICBdKSk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudFZhbHVlKSkge1xuICAgIGlmICh0YWJsZS5rZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgY3VycmVudFZhbHVlLnB1c2godmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBsYXN0ID0gY3VycmVudFZhbHVlLmF0KC0xKTtcbiAgICAgIGRlZXBBc3NpZ24obGFzdCwge1xuICAgICAgICB0eXBlOiB0YWJsZS50eXBlLFxuICAgICAgICBrZXlzOiB0YWJsZS5rZXlzLnNsaWNlKDEpLFxuICAgICAgICB2YWx1ZTogdGFibGUudmFsdWVcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIGlmIChpc09iamVjdChjdXJyZW50VmFsdWUpKSB7XG4gICAgZGVlcEFzc2lnbihjdXJyZW50VmFsdWUsIHtcbiAgICAgIHR5cGUsXG4gICAgICBrZXlzOiBrZXlzLnNsaWNlKDEpLFxuICAgICAgdmFsdWVcbiAgICB9KTtcbiAgICByZXR1cm4gdGFyZ2V0O1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcIlVuZXhwZWN0ZWQgYXNzaWduXCIpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGRlZXBBc3NpZ24odGFyZ2V0LCBib2R5KSB7XG4gIHN3aXRjaChib2R5LnR5cGUpe1xuICAgIGNhc2UgXCJCbG9ja1wiOlxuICAgICAgcmV0dXJuIGRlZXBNZXJnZSh0YXJnZXQsIGJvZHkudmFsdWUpO1xuICAgIGNhc2UgXCJUYWJsZVwiOlxuICAgICAgcmV0dXJuIGRlZXBBc3NpZ25UYWJsZSh0YXJnZXQsIGJvZHkpO1xuICAgIGNhc2UgXCJUYWJsZUFycmF5XCI6XG4gICAgICByZXR1cm4gZGVlcEFzc2lnblRhYmxlQXJyYXkodGFyZ2V0LCBib2R5KTtcbiAgfVxufVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXJzZXIgY29tYmluYXRvcnMgYW5kIGdlbmVyYXRvcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gZGVuby1saW50LWlnbm9yZSBuby1leHBsaWNpdC1hbnlcbmZ1bmN0aW9uIG9yKHBhcnNlcnMpIHtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGZvciAoY29uc3QgcGFyc2Ugb2YgcGFyc2Vycyl7XG4gICAgICBjb25zdCByZXN1bHQgPSBwYXJzZShzY2FubmVyKTtcbiAgICAgIGlmIChyZXN1bHQub2spIHJldHVybiByZXN1bHQ7XG4gICAgfVxuICAgIHJldHVybiBmYWlsdXJlKCk7XG4gIH07XG59XG4vKiogSm9pbiB0aGUgcGFyc2UgcmVzdWx0cyBvZiB0aGUgZ2l2ZW4gcGFyc2VyIGludG8gYW4gYXJyYXkuXG4gKlxuICogSWYgdGhlIHBhcnNlciBmYWlscyBhdCB0aGUgZmlyc3QgYXR0ZW1wdCwgaXQgd2lsbCByZXR1cm4gYW4gZW1wdHkgYXJyYXkuXG4gKi8gZnVuY3Rpb24gam9pbihwYXJzZXIsIHNlcGFyYXRvcikge1xuICBjb25zdCBTZXBhcmF0b3IgPSBjaGFyYWN0ZXIoc2VwYXJhdG9yKTtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGNvbnN0IGZpcnN0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICghZmlyc3Qub2spIHJldHVybiBzdWNjZXNzKG91dCk7XG4gICAgb3V0LnB1c2goZmlyc3QuYm9keSk7XG4gICAgd2hpbGUoIXNjYW5uZXIuZW9mKCkpe1xuICAgICAgaWYgKCFTZXBhcmF0b3Ioc2Nhbm5lcikub2spIGJyZWFrO1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIHRva2VuIGFmdGVyIFwiJHtzZXBhcmF0b3J9XCJgKTtcbiAgICAgIH1cbiAgICAgIG91dC5wdXNoKHJlc3VsdC5ib2R5KTtcbiAgICB9XG4gICAgcmV0dXJuIHN1Y2Nlc3Mob3V0KTtcbiAgfTtcbn1cbi8qKiBKb2luIHRoZSBwYXJzZSByZXN1bHRzIG9mIHRoZSBnaXZlbiBwYXJzZXIgaW50byBhbiBhcnJheS5cbiAqXG4gKiBUaGlzIHJlcXVpcmVzIHRoZSBwYXJzZXIgdG8gc3VjY2VlZCBhdCBsZWFzdCBvbmNlLlxuICovIGZ1bmN0aW9uIGpvaW4xKHBhcnNlciwgc2VwYXJhdG9yKSB7XG4gIGNvbnN0IFNlcGFyYXRvciA9IGNoYXJhY3RlcihzZXBhcmF0b3IpO1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgY29uc3QgZmlyc3QgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCFmaXJzdC5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICBjb25zdCBvdXQgPSBbXG4gICAgICBmaXJzdC5ib2R5XG4gICAgXTtcbiAgICB3aGlsZSghc2Nhbm5lci5lb2YoKSl7XG4gICAgICBpZiAoIVNlcGFyYXRvcihzY2FubmVyKS5vaykgYnJlYWs7XG4gICAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgdG9rZW4gYWZ0ZXIgXCIke3NlcGFyYXRvcn1cImApO1xuICAgICAgfVxuICAgICAgb3V0LnB1c2gocmVzdWx0LmJvZHkpO1xuICAgIH1cbiAgICByZXR1cm4gc3VjY2VzcyhvdXQpO1xuICB9O1xufVxuZnVuY3Rpb24ga3Yoa2V5UGFyc2VyLCBzZXBhcmF0b3IsIHZhbHVlUGFyc2VyKSB7XG4gIGNvbnN0IFNlcGFyYXRvciA9IGNoYXJhY3RlcihzZXBhcmF0b3IpO1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgY29uc3QgcG9zaXRpb24gPSBzY2FubmVyLnBvc2l0aW9uO1xuICAgIGNvbnN0IGtleSA9IGtleVBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIWtleS5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICBjb25zdCBzZXAgPSBTZXBhcmF0b3Ioc2Nhbm5lcik7XG4gICAgaWYgKCFzZXAub2spIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihga2V5L3ZhbHVlIHBhaXIgZG9lc24ndCBoYXZlIFwiJHtzZXBhcmF0b3J9XCJgKTtcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSB2YWx1ZVBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIXZhbHVlLm9rKSB7XG4gICAgICBjb25zdCBsaW5lRW5kSW5kZXggPSBzY2FubmVyLnNvdXJjZS5pbmRleE9mKFwiXFxuXCIsIHNjYW5uZXIucG9zaXRpb24pO1xuICAgICAgY29uc3QgZW5kUG9zaXRpb24gPSBsaW5lRW5kSW5kZXggPiAwID8gbGluZUVuZEluZGV4IDogc2Nhbm5lci5zb3VyY2UubGVuZ3RoO1xuICAgICAgY29uc3QgbGluZSA9IHNjYW5uZXIuc291cmNlLnNsaWNlKHBvc2l0aW9uLCBlbmRQb3NpdGlvbik7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYENhbm5vdCBwYXJzZSB2YWx1ZSBvbiBsaW5lICcke2xpbmV9J2ApO1xuICAgIH1cbiAgICByZXR1cm4gc3VjY2Vzcyh1bmZsYXQoa2V5LmJvZHksIHZhbHVlLmJvZHkpKTtcbiAgfTtcbn1cbmZ1bmN0aW9uIG1lcmdlKHBhcnNlcikge1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICghcmVzdWx0Lm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICAgIGxldCBib2R5ID0ge1xuICAgICAgX19wcm90b19fOiBudWxsXG4gICAgfTtcbiAgICBmb3IgKGNvbnN0IHJlY29yZCBvZiByZXN1bHQuYm9keSl7XG4gICAgICBpZiAodHlwZW9mIHJlY29yZCA9PT0gXCJvYmplY3RcIiAmJiByZWNvcmQgIT09IG51bGwpIHtcbiAgICAgICAgYm9keSA9IGRlZXBNZXJnZShib2R5LCByZWNvcmQpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3VjY2Vzcyhib2R5KTtcbiAgfTtcbn1cbmZ1bmN0aW9uIHJlcGVhdChwYXJzZXIpIHtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGNvbnN0IGJvZHkgPSBbXTtcbiAgICB3aGlsZSghc2Nhbm5lci5lb2YoKSl7XG4gICAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgICBpZiAoIXJlc3VsdC5vaykgYnJlYWs7XG4gICAgICBib2R5LnB1c2gocmVzdWx0LmJvZHkpO1xuICAgICAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gICAgfVxuICAgIGlmIChib2R5Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICByZXR1cm4gc3VjY2Vzcyhib2R5KTtcbiAgfTtcbn1cbmZ1bmN0aW9uIHN1cnJvdW5kKGxlZnQsIHBhcnNlciwgcmlnaHQpIHtcbiAgY29uc3QgTGVmdCA9IGNoYXJhY3RlcihsZWZ0KTtcbiAgY29uc3QgUmlnaHQgPSBjaGFyYWN0ZXIocmlnaHQpO1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgaWYgKCFMZWZ0KHNjYW5uZXIpLm9rKSB7XG4gICAgICByZXR1cm4gZmFpbHVyZSgpO1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCB0b2tlbiBhZnRlciBcIiR7bGVmdH1cImApO1xuICAgIH1cbiAgICBpZiAoIVJpZ2h0KHNjYW5uZXIpLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYE5vdCBjbG9zZWQgYnkgXCIke3JpZ2h0fVwiIGFmdGVyIHN0YXJ0ZWQgd2l0aCBcIiR7bGVmdH1cImApO1xuICAgIH1cbiAgICByZXR1cm4gc3VjY2VzcyhyZXN1bHQuYm9keSk7XG4gIH07XG59XG5mdW5jdGlvbiBjaGFyYWN0ZXIoc3RyKSB7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICAgIGlmICghc2Nhbm5lci5zdGFydHNXaXRoKHN0cikpIHJldHVybiBmYWlsdXJlKCk7XG4gICAgc2Nhbm5lci5uZXh0KHN0ci5sZW5ndGgpO1xuICAgIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gICAgcmV0dXJuIHN1Y2Nlc3ModW5kZWZpbmVkKTtcbiAgfTtcbn1cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBQYXJzZXIgY29tcG9uZW50c1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IEJBUkVfS0VZX1JFR0VYUCA9IC9bQS1aYS16MC05Xy1dKy95O1xuZXhwb3J0IGZ1bmN0aW9uIGJhcmVLZXkoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBrZXkgPSBzY2FubmVyLm1hdGNoKEJBUkVfS0VZX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFrZXkpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChrZXkubGVuZ3RoKTtcbiAgcmV0dXJuIHN1Y2Nlc3Moa2V5KTtcbn1cbmZ1bmN0aW9uIGVzY2FwZVNlcXVlbmNlKHNjYW5uZXIpIHtcbiAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSBcIlxcXFxcIikgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KCk7XG4gIC8vIFNlZSBodHRwczovL3RvbWwuaW8vZW4vdjEuMC4wLXJjLjMjc3RyaW5nXG4gIHN3aXRjaChzY2FubmVyLmNoYXIoKSl7XG4gICAgY2FzZSBcImJcIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXGJcIik7XG4gICAgY2FzZSBcInRcIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXHRcIik7XG4gICAgY2FzZSBcIm5cIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXG5cIik7XG4gICAgY2FzZSBcImZcIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXGZcIik7XG4gICAgY2FzZSBcInJcIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXHJcIik7XG4gICAgY2FzZSBcInVcIjpcbiAgICBjYXNlIFwiVVwiOlxuICAgICAge1xuICAgICAgICAvLyBVbmljb2RlIGNoYXJhY3RlclxuICAgICAgICBjb25zdCBjb2RlUG9pbnRMZW4gPSBzY2FubmVyLmNoYXIoKSA9PT0gXCJ1XCIgPyA0IDogNjtcbiAgICAgICAgY29uc3QgY29kZVBvaW50ID0gcGFyc2VJbnQoXCIweFwiICsgc2Nhbm5lci5zbGljZSgxLCAxICsgY29kZVBvaW50TGVuKSwgMTYpO1xuICAgICAgICBjb25zdCBzdHIgPSBTdHJpbmcuZnJvbUNvZGVQb2ludChjb2RlUG9pbnQpO1xuICAgICAgICBzY2FubmVyLm5leHQoY29kZVBvaW50TGVuICsgMSk7XG4gICAgICAgIHJldHVybiBzdWNjZXNzKHN0cik7XG4gICAgICB9XG4gICAgY2FzZSAnXCInOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcygnXCInKTtcbiAgICBjYXNlIFwiXFxcXFwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcXFxcIik7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCBlc2NhcGUgc2VxdWVuY2U6IFxcXFwke3NjYW5uZXIuY2hhcigpfWApO1xuICB9XG59XG5leHBvcnQgZnVuY3Rpb24gYmFzaWNTdHJpbmcoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09ICdcIicpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgpO1xuICBjb25zdCBhY2MgPSBbXTtcbiAgd2hpbGUoc2Nhbm5lci5jaGFyKCkgIT09ICdcIicgJiYgIXNjYW5uZXIuZW9mKCkpe1xuICAgIGlmIChzY2FubmVyLmNoYXIoKSA9PT0gXCJcXG5cIikge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiU2luZ2xlLWxpbmUgc3RyaW5nIGNhbm5vdCBjb250YWluIEVPTFwiKTtcbiAgICB9XG4gICAgY29uc3QgZXNjYXBlZENoYXIgPSBlc2NhcGVTZXF1ZW5jZShzY2FubmVyKTtcbiAgICBpZiAoZXNjYXBlZENoYXIub2spIHtcbiAgICAgIGFjYy5wdXNoKGVzY2FwZWRDaGFyLmJvZHkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhY2MucHVzaChzY2FubmVyLmNoYXIoKSk7XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICB9XG4gIH1cbiAgaWYgKHNjYW5uZXIuZW9mKCkpIHtcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYFNpbmdsZS1saW5lIHN0cmluZyBpcyBub3QgY2xvc2VkOlxcbiR7YWNjLmpvaW4oXCJcIil9YCk7XG4gIH1cbiAgc2Nhbm5lci5uZXh0KCk7IC8vIHNraXAgbGFzdCAnXCJcIlxuICByZXR1cm4gc3VjY2VzcyhhY2Muam9pbihcIlwiKSk7XG59XG5leHBvcnQgZnVuY3Rpb24gbGl0ZXJhbFN0cmluZyhzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gXCInXCIpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgpO1xuICBjb25zdCBhY2MgPSBbXTtcbiAgd2hpbGUoc2Nhbm5lci5jaGFyKCkgIT09IFwiJ1wiICYmICFzY2FubmVyLmVvZigpKXtcbiAgICBpZiAoc2Nhbm5lci5jaGFyKCkgPT09IFwiXFxuXCIpIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlNpbmdsZS1saW5lIHN0cmluZyBjYW5ub3QgY29udGFpbiBFT0xcIik7XG4gICAgfVxuICAgIGFjYy5wdXNoKHNjYW5uZXIuY2hhcigpKTtcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfVxuICBpZiAoc2Nhbm5lci5lb2YoKSkge1xuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgU2luZ2xlLWxpbmUgc3RyaW5nIGlzIG5vdCBjbG9zZWQ6XFxuJHthY2Muam9pbihcIlwiKX1gKTtcbiAgfVxuICBzY2FubmVyLm5leHQoKTsgLy8gc2tpcCBsYXN0IFwiJ1wiXG4gIHJldHVybiBzdWNjZXNzKGFjYy5qb2luKFwiXCIpKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBtdWx0aWxpbmVCYXNpY1N0cmluZyhzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGlmICghc2Nhbm5lci5zdGFydHNXaXRoKCdcIlwiXCInKSkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KDMpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgPT09IFwiXFxuXCIpIHtcbiAgICAvLyBUaGUgZmlyc3QgbmV3bGluZSAoTEYpIGlzIHRyaW1tZWRcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfSBlbHNlIGlmIChzY2FubmVyLnN0YXJ0c1dpdGgoXCJcXHJcXG5cIikpIHtcbiAgICAvLyBUaGUgZmlyc3QgbmV3bGluZSAoQ1JMRikgaXMgdHJpbW1lZFxuICAgIHNjYW5uZXIubmV4dCgyKTtcbiAgfVxuICBjb25zdCBhY2MgPSBbXTtcbiAgd2hpbGUoIXNjYW5uZXIuc3RhcnRzV2l0aCgnXCJcIlwiJykgJiYgIXNjYW5uZXIuZW9mKCkpe1xuICAgIC8vIGxpbmUgZW5kaW5nIGJhY2tzbGFzaFxuICAgIGlmIChzY2FubmVyLnN0YXJ0c1dpdGgoXCJcXFxcXFxuXCIpKSB7XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHNjYW5uZXIubmV4dFVudGlsQ2hhcih7XG4gICAgICAgIHNraXBDb21tZW50czogZmFsc2VcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfSBlbHNlIGlmIChzY2FubmVyLnN0YXJ0c1dpdGgoXCJcXFxcXFxyXFxuXCIpKSB7XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHNjYW5uZXIubmV4dFVudGlsQ2hhcih7XG4gICAgICAgIHNraXBDb21tZW50czogZmFsc2VcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGVzY2FwZWRDaGFyID0gZXNjYXBlU2VxdWVuY2Uoc2Nhbm5lcik7XG4gICAgaWYgKGVzY2FwZWRDaGFyLm9rKSB7XG4gICAgICBhY2MucHVzaChlc2NhcGVkQ2hhci5ib2R5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWNjLnB1c2goc2Nhbm5lci5jaGFyKCkpO1xuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgfVxuICB9XG4gIGlmIChzY2FubmVyLmVvZigpKSB7XG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBNdWx0aS1saW5lIHN0cmluZyBpcyBub3QgY2xvc2VkOlxcbiR7YWNjLmpvaW4oXCJcIil9YCk7XG4gIH1cbiAgLy8gaWYgZW5kcyB3aXRoIDQgYFwiYCwgcHVzaCB0aGUgZmlzdCBgXCJgIHRvIHN0cmluZ1xuICBpZiAoc2Nhbm5lci5jaGFyKDMpID09PSAnXCInKSB7XG4gICAgYWNjLnB1c2goJ1wiJyk7XG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH1cbiAgc2Nhbm5lci5uZXh0KDMpOyAvLyBza2lwIGxhc3QgJ1wiXCJcIlwiXG4gIHJldHVybiBzdWNjZXNzKGFjYy5qb2luKFwiXCIpKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBtdWx0aWxpbmVMaXRlcmFsU3RyaW5nKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgaWYgKCFzY2FubmVyLnN0YXJ0c1dpdGgoXCInJydcIikpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgzKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpID09PSBcIlxcblwiKSB7XG4gICAgLy8gVGhlIGZpcnN0IG5ld2xpbmUgKExGKSBpcyB0cmltbWVkXG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH0gZWxzZSBpZiAoc2Nhbm5lci5zdGFydHNXaXRoKFwiXFxyXFxuXCIpKSB7XG4gICAgLy8gVGhlIGZpcnN0IG5ld2xpbmUgKENSTEYpIGlzIHRyaW1tZWRcbiAgICBzY2FubmVyLm5leHQoMik7XG4gIH1cbiAgY29uc3QgYWNjID0gW107XG4gIHdoaWxlKCFzY2FubmVyLnN0YXJ0c1dpdGgoXCInJydcIikgJiYgIXNjYW5uZXIuZW9mKCkpe1xuICAgIGFjYy5wdXNoKHNjYW5uZXIuY2hhcigpKTtcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfVxuICBpZiAoc2Nhbm5lci5lb2YoKSkge1xuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgTXVsdGktbGluZSBzdHJpbmcgaXMgbm90IGNsb3NlZDpcXG4ke2FjYy5qb2luKFwiXCIpfWApO1xuICB9XG4gIC8vIGlmIGVuZHMgd2l0aCA0IGAnYCwgcHVzaCB0aGUgZmlzdCBgJ2AgdG8gc3RyaW5nXG4gIGlmIChzY2FubmVyLmNoYXIoMykgPT09IFwiJ1wiKSB7XG4gICAgYWNjLnB1c2goXCInXCIpO1xuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9XG4gIHNjYW5uZXIubmV4dCgzKTsgLy8gc2tpcCBsYXN0IFwiJycnXCJcbiAgcmV0dXJuIHN1Y2Nlc3MoYWNjLmpvaW4oXCJcIikpO1xufVxuY29uc3QgQk9PTEVBTl9SRUdFWFAgPSAvKD86dHJ1ZXxmYWxzZSlcXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBib29sZWFuKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKEJPT0xFQU5fUkVHRVhQKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgY29uc3Qgc3RyaW5nID0gbWF0Y2hbMF07XG4gIHNjYW5uZXIubmV4dChzdHJpbmcubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBzdHJpbmcgPT09IFwidHJ1ZVwiO1xuICByZXR1cm4gc3VjY2Vzcyh2YWx1ZSk7XG59XG5jb25zdCBJTkZJTklUWV9NQVAgPSBuZXcgTWFwKFtcbiAgW1xuICAgIFwiaW5mXCIsXG4gICAgSW5maW5pdHlcbiAgXSxcbiAgW1xuICAgIFwiK2luZlwiLFxuICAgIEluZmluaXR5XG4gIF0sXG4gIFtcbiAgICBcIi1pbmZcIixcbiAgICAtSW5maW5pdHlcbiAgXVxuXSk7XG5jb25zdCBJTkZJTklUWV9SRUdFWFAgPSAvWystXT9pbmZcXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBpbmZpbml0eShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChJTkZJTklUWV9SRUdFWFApO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBjb25zdCBzdHJpbmcgPSBtYXRjaFswXTtcbiAgc2Nhbm5lci5uZXh0KHN0cmluZy5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IElORklOSVRZX01BUC5nZXQoc3RyaW5nKTtcbiAgcmV0dXJuIHN1Y2Nlc3ModmFsdWUpO1xufVxuY29uc3QgTkFOX1JFR0VYUCA9IC9bKy1dP25hblxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIG5hbihzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChOQU5fUkVHRVhQKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgY29uc3Qgc3RyaW5nID0gbWF0Y2hbMF07XG4gIHNjYW5uZXIubmV4dChzdHJpbmcubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBOYU47XG4gIHJldHVybiBzdWNjZXNzKHZhbHVlKTtcbn1cbmV4cG9ydCBjb25zdCBkb3R0ZWRLZXkgPSBqb2luMShvcihbXG4gIGJhcmVLZXksXG4gIGJhc2ljU3RyaW5nLFxuICBsaXRlcmFsU3RyaW5nXG5dKSwgXCIuXCIpO1xuY29uc3QgQklOQVJZX1JFR0VYUCA9IC8wYlswMV0rKD86X1swMV0rKSpcXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBiaW5hcnkoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goQklOQVJZX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gbWF0Y2guc2xpY2UoMikucmVwbGFjZUFsbChcIl9cIiwgXCJcIik7XG4gIGNvbnN0IG51bWJlciA9IHBhcnNlSW50KHZhbHVlLCAyKTtcbiAgcmV0dXJuIGlzTmFOKG51bWJlcikgPyBmYWlsdXJlKCkgOiBzdWNjZXNzKG51bWJlcik7XG59XG5jb25zdCBPQ1RBTF9SRUdFWFAgPSAvMG9bMC03XSsoPzpfWzAtN10rKSpcXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBvY3RhbChzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChPQ1RBTF9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IG1hdGNoLnNsaWNlKDIpLnJlcGxhY2VBbGwoXCJfXCIsIFwiXCIpO1xuICBjb25zdCBudW1iZXIgPSBwYXJzZUludCh2YWx1ZSwgOCk7XG4gIHJldHVybiBpc05hTihudW1iZXIpID8gZmFpbHVyZSgpIDogc3VjY2VzcyhudW1iZXIpO1xufVxuY29uc3QgSEVYX1JFR0VYUCA9IC8weFswLTlhLWZdKyg/Ol9bMC05YS1mXSspKlxcYi95aTtcbmV4cG9ydCBmdW5jdGlvbiBoZXgoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goSEVYX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gbWF0Y2guc2xpY2UoMikucmVwbGFjZUFsbChcIl9cIiwgXCJcIik7XG4gIGNvbnN0IG51bWJlciA9IHBhcnNlSW50KHZhbHVlLCAxNik7XG4gIHJldHVybiBpc05hTihudW1iZXIpID8gZmFpbHVyZSgpIDogc3VjY2VzcyhudW1iZXIpO1xufVxuY29uc3QgSU5URUdFUl9SRUdFWFAgPSAvWystXT8oPzowfFsxLTldWzAtOV0qKD86X1swLTldKykqKVxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGludGVnZXIoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goSU5URUdFUl9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IG1hdGNoLnJlcGxhY2VBbGwoXCJfXCIsIFwiXCIpO1xuICBjb25zdCBpbnQgPSBwYXJzZUludCh2YWx1ZSwgMTApO1xuICByZXR1cm4gc3VjY2VzcyhpbnQpO1xufVxuY29uc3QgRkxPQVRfUkVHRVhQID0gL1srLV0/KD86MHxbMS05XVswLTldKig/Ol9bMC05XSspKikoPzpcXC5bMC05XSsoPzpfWzAtOV0rKSopPyg/OmVbKy1dP1swLTldKyg/Ol9bMC05XSspKik/XFxiL3lpO1xuZXhwb3J0IGZ1bmN0aW9uIGZsb2F0KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKEZMT0FUX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gbWF0Y2gucmVwbGFjZUFsbChcIl9cIiwgXCJcIik7XG4gIGNvbnN0IGZsb2F0ID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gIGlmIChpc05hTihmbG9hdCkpIHJldHVybiBmYWlsdXJlKCk7XG4gIHJldHVybiBzdWNjZXNzKGZsb2F0KTtcbn1cbmNvbnN0IERBVEVfVElNRV9SRUdFWFAgPSAvKD88eWVhcj5cXGR7NH0pLSg/PG1vbnRoPlxcZHsyfSktKD88ZGF5PlxcZHsyfSkoPzpbIDAtOVRaLjorLV0rKT9cXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBkYXRlVGltZShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChEQVRFX1RJTUVfUkVHRVhQKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgY29uc3Qgc3RyaW5nID0gbWF0Y2hbMF07XG4gIHNjYW5uZXIubmV4dChzdHJpbmcubGVuZ3RoKTtcbiAgY29uc3QgZ3JvdXBzID0gbWF0Y2guZ3JvdXBzO1xuICAvLyBzcGVjaWFsIGNhc2UgaWYgbW9udGggaXMgRmVicnVhcnlcbiAgaWYgKGdyb3Vwcy5tb250aCA9PSBcIjAyXCIpIHtcbiAgICBjb25zdCBkYXlzID0gcGFyc2VJbnQoZ3JvdXBzLmRheSk7XG4gICAgaWYgKGRheXMgPiAyOSkge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIGRhdGUgc3RyaW5nIFwiJHttYXRjaH1cImApO1xuICAgIH1cbiAgICBjb25zdCB5ZWFyID0gcGFyc2VJbnQoZ3JvdXBzLnllYXIpO1xuICAgIGlmIChkYXlzID4gMjggJiYgIWlzTGVhcCh5ZWFyKSkge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIGRhdGUgc3RyaW5nIFwiJHttYXRjaH1cImApO1xuICAgIH1cbiAgfVxuICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyaW5nLnRyaW0oKSk7XG4gIC8vIGludmFsaWQgZGF0ZVxuICBpZiAoaXNOYU4oZGF0ZS5nZXRUaW1lKCkpKSB7XG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIGRhdGUgc3RyaW5nIFwiJHttYXRjaH1cImApO1xuICB9XG4gIHJldHVybiBzdWNjZXNzKGRhdGUpO1xufVxuY29uc3QgTE9DQUxfVElNRV9SRUdFWFAgPSAvKFxcZHsyfSk6KFxcZHsyfSk6KFxcZHsyfSkoPzpcXC5bMC05XSspP1xcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGxvY2FsVGltZShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChMT0NBTF9USU1FX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIHJldHVybiBzdWNjZXNzKG1hdGNoKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBhcnJheVZhbHVlKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSBcIltcIikgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KCk7XG4gIGNvbnN0IGFycmF5ID0gW107XG4gIHdoaWxlKCFzY2FubmVyLmVvZigpKXtcbiAgICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgICBjb25zdCByZXN1bHQgPSB2YWx1ZShzY2FubmVyKTtcbiAgICBpZiAoIXJlc3VsdC5vaykgYnJlYWs7XG4gICAgYXJyYXkucHVzaChyZXN1bHQuYm9keSk7XG4gICAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgICAvLyBtYXkgaGF2ZSBhIG5leHQgaXRlbSwgYnV0IHRyYWlsaW5nIGNvbW1hIGlzIGFsbG93ZWQgYXQgYXJyYXlcbiAgICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09IFwiLFwiKSBicmVhaztcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfVxuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSBcIl1cIikgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiQXJyYXkgaXMgbm90IGNsb3NlZFwiKTtcbiAgc2Nhbm5lci5uZXh0KCk7XG4gIHJldHVybiBzdWNjZXNzKGFycmF5KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBpbmxpbmVUYWJsZShzY2FubmVyKSB7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBpZiAoc2Nhbm5lci5jaGFyKDEpID09PSBcIn1cIikge1xuICAgIHNjYW5uZXIubmV4dCgyKTtcbiAgICByZXR1cm4gc3VjY2Vzcyh7XG4gICAgICBfX3Byb3RvX186IG51bGxcbiAgICB9KTtcbiAgfVxuICBjb25zdCBwYWlycyA9IHN1cnJvdW5kKFwie1wiLCBqb2luKHBhaXIsIFwiLFwiKSwgXCJ9XCIpKHNjYW5uZXIpO1xuICBpZiAoIXBhaXJzLm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICBsZXQgdGFibGUgPSB7XG4gICAgX19wcm90b19fOiBudWxsXG4gIH07XG4gIGZvciAoY29uc3QgcGFpciBvZiBwYWlycy5ib2R5KXtcbiAgICB0YWJsZSA9IGRlZXBNZXJnZSh0YWJsZSwgcGFpcik7XG4gIH1cbiAgcmV0dXJuIHN1Y2Nlc3ModGFibGUpO1xufVxuZXhwb3J0IGNvbnN0IHZhbHVlID0gb3IoW1xuICBtdWx0aWxpbmVCYXNpY1N0cmluZyxcbiAgbXVsdGlsaW5lTGl0ZXJhbFN0cmluZyxcbiAgYmFzaWNTdHJpbmcsXG4gIGxpdGVyYWxTdHJpbmcsXG4gIGJvb2xlYW4sXG4gIGluZmluaXR5LFxuICBuYW4sXG4gIGRhdGVUaW1lLFxuICBsb2NhbFRpbWUsXG4gIGJpbmFyeSxcbiAgb2N0YWwsXG4gIGhleCxcbiAgZmxvYXQsXG4gIGludGVnZXIsXG4gIGFycmF5VmFsdWUsXG4gIGlubGluZVRhYmxlXG5dKTtcbmV4cG9ydCBjb25zdCBwYWlyID0ga3YoZG90dGVkS2V5LCBcIj1cIiwgdmFsdWUpO1xuZXhwb3J0IGZ1bmN0aW9uIGJsb2NrKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGNvbnN0IHJlc3VsdCA9IG1lcmdlKHJlcGVhdChwYWlyKSkoc2Nhbm5lcik7XG4gIGlmIChyZXN1bHQub2spIHJldHVybiBzdWNjZXNzKHtcbiAgICB0eXBlOiBcIkJsb2NrXCIsXG4gICAgdmFsdWU6IHJlc3VsdC5ib2R5XG4gIH0pO1xuICByZXR1cm4gZmFpbHVyZSgpO1xufVxuZXhwb3J0IGNvbnN0IHRhYmxlSGVhZGVyID0gc3Vycm91bmQoXCJbXCIsIGRvdHRlZEtleSwgXCJdXCIpO1xuZXhwb3J0IGZ1bmN0aW9uIHRhYmxlKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGNvbnN0IGhlYWRlciA9IHRhYmxlSGVhZGVyKHNjYW5uZXIpO1xuICBpZiAoIWhlYWRlci5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGNvbnN0IGIgPSBibG9jayhzY2FubmVyKTtcbiAgcmV0dXJuIHN1Y2Nlc3Moe1xuICAgIHR5cGU6IFwiVGFibGVcIixcbiAgICBrZXlzOiBoZWFkZXIuYm9keSxcbiAgICB2YWx1ZTogYi5vayA/IGIuYm9keS52YWx1ZSA6IHtcbiAgICAgIF9fcHJvdG9fXzogbnVsbFxuICAgIH1cbiAgfSk7XG59XG5leHBvcnQgY29uc3QgdGFibGVBcnJheUhlYWRlciA9IHN1cnJvdW5kKFwiW1tcIiwgZG90dGVkS2V5LCBcIl1dXCIpO1xuZXhwb3J0IGZ1bmN0aW9uIHRhYmxlQXJyYXkoc2Nhbm5lcikge1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgY29uc3QgaGVhZGVyID0gdGFibGVBcnJheUhlYWRlcihzY2FubmVyKTtcbiAgaWYgKCFoZWFkZXIub2spIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBjb25zdCBiID0gYmxvY2soc2Nhbm5lcik7XG4gIHJldHVybiBzdWNjZXNzKHtcbiAgICB0eXBlOiBcIlRhYmxlQXJyYXlcIixcbiAgICBrZXlzOiBoZWFkZXIuYm9keSxcbiAgICB2YWx1ZTogYi5vayA/IGIuYm9keS52YWx1ZSA6IHtcbiAgICAgIF9fcHJvdG9fXzogbnVsbFxuICAgIH1cbiAgfSk7XG59XG5leHBvcnQgZnVuY3Rpb24gdG9tbChzY2FubmVyKSB7XG4gIGNvbnN0IGJsb2NrcyA9IHJlcGVhdChvcihbXG4gICAgYmxvY2ssXG4gICAgdGFibGVBcnJheSxcbiAgICB0YWJsZVxuICBdKSkoc2Nhbm5lcik7XG4gIGlmICghYmxvY2tzLm9rKSByZXR1cm4gc3VjY2Vzcyh7XG4gICAgX19wcm90b19fOiBudWxsXG4gIH0pO1xuICBjb25zdCBib2R5ID0gYmxvY2tzLmJvZHkucmVkdWNlKGRlZXBBc3NpZ24sIHtcbiAgICBfX3Byb3RvX186IG51bGxcbiAgfSk7XG4gIHJldHVybiBzdWNjZXNzKGJvZHkpO1xufVxuZnVuY3Rpb24gY3JlYXRlUGFyc2VFcnJvck1lc3NhZ2Uoc2Nhbm5lciwgbWVzc2FnZSkge1xuICBjb25zdCBzdHJpbmcgPSBzY2FubmVyLnNvdXJjZS5zbGljZSgwLCBzY2FubmVyLnBvc2l0aW9uKTtcbiAgY29uc3QgbGluZXMgPSBzdHJpbmcuc3BsaXQoXCJcXG5cIik7XG4gIGNvbnN0IHJvdyA9IGxpbmVzLmxlbmd0aDtcbiAgY29uc3QgY29sdW1uID0gbGluZXMuYXQoLTEpPy5sZW5ndGggPz8gMDtcbiAgcmV0dXJuIGBQYXJzZSBlcnJvciBvbiBsaW5lICR7cm93fSwgY29sdW1uICR7Y29sdW1ufTogJHttZXNzYWdlfWA7XG59XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VyRmFjdG9yeShwYXJzZXIpIHtcbiAgcmV0dXJuICh0b21sU3RyaW5nKT0+e1xuICAgIGNvbnN0IHNjYW5uZXIgPSBuZXcgU2Nhbm5lcih0b21sU3RyaW5nKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgICAgaWYgKHJlc3VsdC5vayAmJiBzY2FubmVyLmVvZigpKSByZXR1cm4gcmVzdWx0LmJvZHk7XG4gICAgICBjb25zdCBtZXNzYWdlID0gYFVuZXhwZWN0ZWQgY2hhcmFjdGVyOiBcIiR7c2Nhbm5lci5jaGFyKCl9XCJgO1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGNyZWF0ZVBhcnNlRXJyb3JNZXNzYWdlKHNjYW5uZXIsIG1lc3NhZ2UpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGNyZWF0ZVBhcnNlRXJyb3JNZXNzYWdlKHNjYW5uZXIsIGVycm9yLm1lc3NhZ2UpKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBcIkludmFsaWQgZXJyb3IgdHlwZSBjYXVnaHRcIjtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihjcmVhdGVQYXJzZUVycm9yTWVzc2FnZShzY2FubmVyLCBtZXNzYWdlKSk7XG4gICAgfVxuICB9O1xufVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9X3BhcnNlci5qcy5tYXAiLCIvLyBDb3B5cmlnaHQgMjAxOC0yMDI1IHRoZSBEZW5vIGF1dGhvcnMuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuaW1wb3J0IHsgcGFyc2VyRmFjdG9yeSwgdG9tbCB9IGZyb20gXCIuL19wYXJzZXIuanNcIjtcbi8qKlxuICogUGFyc2VzIGEge0BsaW5rIGh0dHBzOi8vdG9tbC5pbyB8IFRPTUx9IHN0cmluZyBpbnRvIGFuIG9iamVjdC5cbiAqXG4gKiBAZXhhbXBsZSBVc2FnZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IHBhcnNlIH0gZnJvbSBcIkBzdGQvdG9tbC9wYXJzZVwiO1xuICogaW1wb3J0IHsgYXNzZXJ0RXF1YWxzIH0gZnJvbSBcIkBzdGQvYXNzZXJ0XCI7XG4gKlxuICogY29uc3QgdG9tbFN0cmluZyA9IGB0aXRsZSA9IFwiVE9NTCBFeGFtcGxlXCJcbiAqIFtvd25lcl1cbiAqIG5hbWUgPSBcIkFsaWNlXCJcbiAqIGJpbyA9IFwiQWxpY2UgaXMgYSBwcm9ncmFtbWVyLlwiYDtcbiAqXG4gKiBjb25zdCBvYmogPSBwYXJzZSh0b21sU3RyaW5nKTtcbiAqIGFzc2VydEVxdWFscyhvYmosIHsgdGl0bGU6IFwiVE9NTCBFeGFtcGxlXCIsIG93bmVyOiB7IG5hbWU6IFwiQWxpY2VcIiwgYmlvOiBcIkFsaWNlIGlzIGEgcHJvZ3JhbW1lci5cIiB9IH0pO1xuICogYGBgXG4gKiBAcGFyYW0gdG9tbFN0cmluZyBUT01MIHN0cmluZyB0byBiZSBwYXJzZWQuXG4gKiBAcmV0dXJucyBUaGUgcGFyc2VkIEpTIG9iamVjdC5cbiAqLyBleHBvcnQgZnVuY3Rpb24gcGFyc2UodG9tbFN0cmluZykge1xuICByZXR1cm4gcGFyc2VyRmFjdG9yeSh0b21sKSh0b21sU3RyaW5nKTtcbn1cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPXBhcnNlLmpzLm1hcCIsImltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tIFwibm9kZTptb2R1bGVcIjtcbmltcG9ydCB7IGlzQWJzb2x1dGUsIGpvaW4sIHJlc29sdmUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcIm5vZGU6dXJsXCI7XG4vKipcbiogUmVzb2x2ZSBhbiBhYnNvbHV0ZSBwYXRoIGZyb20ge0BsaW5rIHJvb3R9LCBidXQgb25seVxuKiBpZiB7QGxpbmsgaW5wdXR9IGlzbid0IGFscmVhZHkgYWJzb2x1dGUuXG4qXG4qIEBwYXJhbSBpbnB1dCBUaGUgcGF0aCB0byByZXNvbHZlLlxuKiBAcGFyYW0gcm9vdCBUaGUgYmFzZSBwYXRoOyBkZWZhdWx0ID0gcHJvY2Vzcy5jd2QoKVxuKiBAcmV0dXJucyBUaGUgcmVzb2x2ZWQgYWJzb2x1dGUgcGF0aC5cbiovXG5leHBvcnQgZnVuY3Rpb24gYWJzb2x1dGUoaW5wdXQsIHJvb3QpIHtcblx0cmV0dXJuIGlzQWJzb2x1dGUoaW5wdXQpID8gaW5wdXQgOiByZXNvbHZlKHJvb3QgfHwgXCIuXCIsIGlucHV0KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBmcm9tKHJvb3QsIGlkZW50LCBzaWxlbnQpIHtcblx0dHJ5IHtcblx0XHQvLyBOT1RFOiBkaXJzIG5lZWQgYSB0cmFpbGluZyBcIi9cIiBPUiBmaWxlbmFtZS4gV2l0aCBcIi9cIiByb3V0ZSxcblx0XHQvLyBOb2RlIGFkZHMgXCJub29wLmpzXCIgYXMgbWFpbiBmaWxlLCBzbyBqdXN0IGRvIFwibm9vcC5qc1wiIGFueXdheS5cblx0XHRsZXQgciA9IHJvb3QgaW5zdGFuY2VvZiBVUkwgfHwgcm9vdC5zdGFydHNXaXRoKFwiZmlsZTovL1wiKSA/IGpvaW4oZmlsZVVSTFRvUGF0aChyb290KSwgXCJub29wLmpzXCIpIDogam9pbihhYnNvbHV0ZShyb290KSwgXCJub29wLmpzXCIpO1xuXHRcdHJldHVybiBjcmVhdGVSZXF1aXJlKHIpLnJlc29sdmUoaWRlbnQpO1xuXHR9IGNhdGNoIChlcnIpIHtcblx0XHRpZiAoIXNpbGVudCkgdGhyb3cgZXJyO1xuXHR9XG59XG5leHBvcnQgZnVuY3Rpb24gY3dkKGlkZW50LCBzaWxlbnQpIHtcblx0cmV0dXJuIGZyb20ocmVzb2x2ZSgpLCBpZGVudCwgc2lsZW50KTtcbn1cbiIsImltcG9ydCB7IGRpcm5hbWUgfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQgeyBhYnNvbHV0ZSB9IGZyb20gXCJlbXBhdGhpYy9yZXNvbHZlXCI7XG4vKipcbiogR2V0IGFsbCBwYXJlbnQgZGlyZWN0b3JpZXMgb2Yge0BsaW5rIGJhc2V9LlxuKiBTdG9wcyBhZnRlciB7QGxpbmsgT3B0aW9uc1snbGFzdCddfSBpcyBwcm9jZXNzZWQuXG4qXG4qIEByZXR1cm5zIEFuIGFycmF5IG9mIGFic29sdXRlIHBhdGhzIG9mIGFsbCBwYXJlbnQgZGlyZWN0b3JpZXMuXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIHVwKGJhc2UsIG9wdGlvbnMpIHtcblx0bGV0IHsgbGFzdCwgY3dkIH0gPSBvcHRpb25zIHx8IHt9O1xuXHRsZXQgdG1wID0gYWJzb2x1dGUoYmFzZSwgY3dkKTtcblx0bGV0IHJvb3QgPSBhYnNvbHV0ZShsYXN0IHx8IFwiL1wiLCBjd2QpO1xuXHRsZXQgcHJldiwgYXJyID0gW107XG5cdHdoaWxlIChwcmV2ICE9PSByb290KSB7XG5cdFx0YXJyLnB1c2godG1wKTtcblx0XHR0bXAgPSBkaXJuYW1lKHByZXYgPSB0bXApO1xuXHRcdGlmICh0bXAgPT09IHByZXYpIGJyZWFrO1xuXHR9XG5cdHJldHVybiBhcnI7XG59XG4iLCJpbXBvcnQgeyBqb2luIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgZXhpc3RzU3luYywgc3RhdFN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0ICogYXMgd2FsayBmcm9tIFwiZW1wYXRoaWMvd2Fsa1wiO1xuLyoqXG4qIEZpbmQgYW4gaXRlbSBieSBuYW1lLCB3YWxraW5nIHBhcmVudCBkaXJlY3RvcmllcyB1bnRpbCBmb3VuZC5cbipcbiogQHBhcmFtIG5hbWUgVGhlIGl0ZW0gbmFtZSB0byBmaW5kLlxuKiBAcmV0dXJucyBUaGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgaXRlbSwgaWYgZm91bmQuXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIHVwKG5hbWUsIG9wdGlvbnMpIHtcblx0bGV0IGRpciwgdG1wO1xuXHRsZXQgc3RhcnQgPSBvcHRpb25zICYmIG9wdGlvbnMuY3dkIHx8IFwiXCI7XG5cdGZvciAoZGlyIG9mIHdhbGsudXAoc3RhcnQsIG9wdGlvbnMpKSB7XG5cdFx0dG1wID0gam9pbihkaXIsIG5hbWUpO1xuXHRcdGlmIChleGlzdHNTeW5jKHRtcCkpIHJldHVybiB0bXA7XG5cdH1cbn1cbi8qKlxuKiBHZXQgdGhlIGZpcnN0IHBhdGggdGhhdCBtYXRjaGVzIGFueSBvZiB0aGUgbmFtZXMgcHJvdmlkZWQuXG4qXG4qID4gW05PVEVdXG4qID4gVGhlIG9yZGVyIG9mIHtAbGluayBuYW1lc30gaXMgcmVzcGVjdGVkLlxuKlxuKiBAcGFyYW0gbmFtZXMgVGhlIGl0ZW0gbmFtZXMgdG8gZmluZC5cbiogQHJldHVybnMgVGhlIGFic29sdXRlIHBhdGggb2YgdGhlIGZpcnN0IGl0ZW0gZm91bmQsIGlmIGFueS5cbiovXG5leHBvcnQgZnVuY3Rpb24gYW55KG5hbWVzLCBvcHRpb25zKSB7XG5cdGxldCBkaXIsIHN0YXJ0ID0gb3B0aW9ucyAmJiBvcHRpb25zLmN3ZCB8fCBcIlwiO1xuXHRsZXQgaiA9IDAsIGxlbiA9IG5hbWVzLmxlbmd0aCwgdG1wO1xuXHRmb3IgKGRpciBvZiB3YWxrLnVwKHN0YXJ0LCBvcHRpb25zKSkge1xuXHRcdGZvciAoaiA9IDA7IGogPCBsZW47IGorKykge1xuXHRcdFx0dG1wID0gam9pbihkaXIsIG5hbWVzW2pdKTtcblx0XHRcdGlmIChleGlzdHNTeW5jKHRtcCkpIHJldHVybiB0bXA7XG5cdFx0fVxuXHR9XG59XG4vKipcbiogRmluZCBhIGZpbGUgYnkgbmFtZSwgd2Fsa2luZyBwYXJlbnQgZGlyZWN0b3JpZXMgdW50aWwgZm91bmQuXG4qXG4qID4gW05PVEVdXG4qID4gVGhpcyBmdW5jdGlvbiBvbmx5IHJldHVybnMgYSB2YWx1ZSBmb3IgZmlsZSBtYXRjaGVzLlxuKiA+IEEgZGlyZWN0b3J5IG1hdGNoIHdpdGggdGhlIHNhbWUgbmFtZSB3aWxsIGJlIGlnbm9yZWQuXG4qXG4qIEBwYXJhbSBuYW1lIFRoZSBmaWxlIG5hbWUgdG8gZmluZC5cbiogQHJldHVybnMgVGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGZpbGUsIGlmIGZvdW5kLlxuKi9cbmV4cG9ydCBmdW5jdGlvbiBmaWxlKG5hbWUsIG9wdGlvbnMpIHtcblx0bGV0IGRpciwgdG1wO1xuXHRsZXQgc3RhcnQgPSBvcHRpb25zICYmIG9wdGlvbnMuY3dkIHx8IFwiXCI7XG5cdGZvciAoZGlyIG9mIHdhbGsudXAoc3RhcnQsIG9wdGlvbnMpKSB7XG5cdFx0dHJ5IHtcblx0XHRcdHRtcCA9IGpvaW4oZGlyLCBuYW1lKTtcblx0XHRcdGlmIChzdGF0U3luYyh0bXApLmlzRmlsZSgpKSByZXR1cm4gdG1wO1xuXHRcdH0gY2F0Y2gge31cblx0fVxufVxuLyoqXG4qIEZpbmQgYSBkaXJlY3RvcnkgYnkgbmFtZSwgd2Fsa2luZyBwYXJlbnQgZGlyZWN0b3JpZXMgdW50aWwgZm91bmQuXG4qXG4qID4gW05PVEVdXG4qID4gVGhpcyBmdW5jdGlvbiBvbmx5IHJldHVybnMgYSB2YWx1ZSBmb3IgZGlyZWN0b3J5IG1hdGNoZXMuXG4qID4gQSBmaWxlIG1hdGNoIHdpdGggdGhlIHNhbWUgbmFtZSB3aWxsIGJlIGlnbm9yZWQuXG4qXG4qIEBwYXJhbSBuYW1lIFRoZSBkaXJlY3RvcnkgbmFtZSB0byBmaW5kLlxuKiBAcmV0dXJucyBUaGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgZmlsZSwgaWYgZm91bmQuXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIGRpcihuYW1lLCBvcHRpb25zKSB7XG5cdGxldCBkaXIsIHRtcDtcblx0bGV0IHN0YXJ0ID0gb3B0aW9ucyAmJiBvcHRpb25zLmN3ZCB8fCBcIlwiO1xuXHRmb3IgKGRpciBvZiB3YWxrLnVwKHN0YXJ0LCBvcHRpb25zKSkge1xuXHRcdHRyeSB7XG5cdFx0XHR0bXAgPSBqb2luKGRpciwgbmFtZSk7XG5cdFx0XHRpZiAoc3RhdFN5bmModG1wKS5pc0RpcmVjdG9yeSgpKSByZXR1cm4gdG1wO1xuXHRcdH0gY2F0Y2gge31cblx0fVxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VSZW5hbWVDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ3JlbmFtZSddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnUmVuYW1lIHRoZSBOQVBJLVJTIHByb2plY3QnLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG5wbURpciA9IE9wdGlvbi5TdHJpbmcoJy0tbnBtLWRpcicsICducG0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXQnLFxuICB9KVxuXG4gICQkbmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tbmFtZSwtbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBuZXcgbmFtZSBvZiB0aGUgcHJvamVjdCcsXG4gIH0pXG5cbiAgYmluYXJ5TmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tYmluYXJ5LW5hbWUsLWInLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgbmV3IGJpbmFyeSBuYW1lICoubm9kZSBmaWxlcycsXG4gIH0pXG5cbiAgcGFja2FnZU5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtbmFtZScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBuZXcgcGFja2FnZSBuYW1lIG9mIHRoZSBwcm9qZWN0JyxcbiAgfSlcblxuICBtYW5pZmVzdFBhdGggPSBPcHRpb24uU3RyaW5nKCctLW1hbmlmZXN0LXBhdGgnLCAnQ2FyZ28udG9tbCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYENhcmdvLnRvbWxgJyxcbiAgfSlcblxuICByZXBvc2l0b3J5Pzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1yZXBvc2l0b3J5Jywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG5ldyByZXBvc2l0b3J5IG9mIHRoZSBwcm9qZWN0JyxcbiAgfSlcblxuICBkZXNjcmlwdGlvbj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tZGVzY3JpcHRpb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgbmV3IGRlc2NyaXB0aW9uIG9mIHRoZSBwcm9qZWN0JyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG5wbURpcjogdGhpcy5ucG1EaXIsXG4gICAgICBuYW1lOiB0aGlzLiQkbmFtZSxcbiAgICAgIGJpbmFyeU5hbWU6IHRoaXMuYmluYXJ5TmFtZSxcbiAgICAgIHBhY2thZ2VOYW1lOiB0aGlzLnBhY2thZ2VOYW1lLFxuICAgICAgbWFuaWZlc3RQYXRoOiB0aGlzLm1hbmlmZXN0UGF0aCxcbiAgICAgIHJlcG9zaXRvcnk6IHRoaXMucmVwb3NpdG9yeSxcbiAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJlbmFtZSB0aGUgTkFQSS1SUyBwcm9qZWN0XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbnBtJ1xuICAgKi9cbiAgbnBtRGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmV3IG5hbWUgb2YgdGhlIHByb2plY3RcbiAgICovXG4gIG5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuZXcgYmluYXJ5IG5hbWUgKi5ub2RlIGZpbGVzXG4gICAqL1xuICBiaW5hcnlOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmV3IHBhY2thZ2UgbmFtZSBvZiB0aGUgcHJvamVjdFxuICAgKi9cbiAgcGFja2FnZU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYENhcmdvLnRvbWxgXG4gICAqXG4gICAqIEBkZWZhdWx0ICdDYXJnby50b21sJ1xuICAgKi9cbiAgbWFuaWZlc3RQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmV3IHJlcG9zaXRvcnkgb2YgdGhlIHByb2plY3RcbiAgICovXG4gIHJlcG9zaXRvcnk/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuZXcgZGVzY3JpcHRpb24gb2YgdGhlIHByb2plY3RcbiAgICovXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRSZW5hbWVPcHRpb25zKG9wdGlvbnM6IFJlbmFtZU9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBucG1EaXI6ICducG0nLFxuICAgIG1hbmlmZXN0UGF0aDogJ0NhcmdvLnRvbWwnLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgcmVuYW1lIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB7IHJlc29sdmUsIGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7IHBhcnNlIGFzIHBhcnNlVG9tbCwgc3RyaW5naWZ5IGFzIHN0cmluZ2lmeVRvbWwgfSBmcm9tICdAc3RkL3RvbWwnXG5pbXBvcnQgeyBsb2FkIGFzIHlhbWxQYXJzZSwgZHVtcCBhcyB5YW1sU3RyaW5naWZ5IH0gZnJvbSAnanMteWFtbCdcbmltcG9ydCB7IGlzTmlsLCBtZXJnZSwgb21pdEJ5LCBwaWNrIH0gZnJvbSAnZXMtdG9vbGtpdCdcbmltcG9ydCAqIGFzIGZpbmQgZnJvbSAnZW1wYXRoaWMvZmluZCdcblxuaW1wb3J0IHsgYXBwbHlEZWZhdWx0UmVuYW1lT3B0aW9ucywgdHlwZSBSZW5hbWVPcHRpb25zIH0gZnJvbSAnLi4vZGVmL3JlbmFtZS5qcydcbmltcG9ydCB7IHJlYWRDb25maWcsIHJlYWRGaWxlQXN5bmMsIHdyaXRlRmlsZUFzeW5jIH0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5hbWVQcm9qZWN0KHVzZXJPcHRpb25zOiBSZW5hbWVPcHRpb25zKSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRSZW5hbWVPcHRpb25zKHVzZXJPcHRpb25zKVxuICBjb25zdCBuYXBpQ29uZmlnID0gYXdhaXQgcmVhZENvbmZpZyhvcHRpb25zKVxuICBjb25zdCBvbGROYW1lID0gbmFwaUNvbmZpZy5iaW5hcnlOYW1lXG5cbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG4gIGNvbnN0IGNhcmdvVG9tbFBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLm1hbmlmZXN0UGF0aClcblxuICBjb25zdCBwYWNrYWdlSnNvbkNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKHBhY2thZ2VKc29uUGF0aCwgJ3V0ZjgnKVxuICBjb25zdCBwYWNrYWdlSnNvbkRhdGEgPSBKU09OLnBhcnNlKHBhY2thZ2VKc29uQ29udGVudClcblxuICBtZXJnZShcbiAgICBtZXJnZShcbiAgICAgIHBhY2thZ2VKc29uRGF0YSxcbiAgICAgIG9taXRCeShcbiAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBtaXNzaW5nIGZpZWxkczogYXV0aG9yIGFuZCBsaWNlbnNlXG4gICAgICAgIHBpY2sob3B0aW9ucywgWyduYW1lJywgJ2Rlc2NyaXB0aW9uJywgJ2F1dGhvcicsICdsaWNlbnNlJ10pLFxuICAgICAgICBpc05pbCxcbiAgICAgICksXG4gICAgKSxcbiAgICB7XG4gICAgICBuYXBpOiBvbWl0QnkoXG4gICAgICAgIHtcbiAgICAgICAgICBiaW5hcnlOYW1lOiBvcHRpb25zLmJpbmFyeU5hbWUsXG4gICAgICAgICAgcGFja2FnZU5hbWU6IG9wdGlvbnMucGFja2FnZU5hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIGlzTmlsLFxuICAgICAgKSxcbiAgICB9LFxuICApXG5cbiAgaWYgKG9wdGlvbnMuY29uZmlnUGF0aCkge1xuICAgIGNvbnN0IGNvbmZpZ1BhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ1BhdGgpXG4gICAgY29uc3QgY29uZmlnQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoY29uZmlnUGF0aCwgJ3V0ZjgnKVxuICAgIGNvbnN0IGNvbmZpZ0RhdGEgPSBKU09OLnBhcnNlKGNvbmZpZ0NvbnRlbnQpXG4gICAgY29uZmlnRGF0YS5iaW5hcnlOYW1lID0gb3B0aW9ucy5iaW5hcnlOYW1lXG4gICAgY29uZmlnRGF0YS5wYWNrYWdlTmFtZSA9IG9wdGlvbnMucGFja2FnZU5hbWVcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhjb25maWdQYXRoLCBKU09OLnN0cmluZ2lmeShjb25maWdEYXRhLCBudWxsLCAyKSlcbiAgfVxuXG4gIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbkRhdGEsIG51bGwsIDIpLFxuICApXG5cbiAgY29uc3QgdG9tbENvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKGNhcmdvVG9tbFBhdGgsICd1dGY4JylcbiAgY29uc3QgY2FyZ29Ub21sID0gcGFyc2VUb21sKHRvbWxDb250ZW50KSBhcyBhbnlcblxuICAvLyBVcGRhdGUgdGhlIHBhY2thZ2UgbmFtZVxuICBpZiAoY2FyZ29Ub21sLnBhY2thZ2UgJiYgb3B0aW9ucy5iaW5hcnlOYW1lKSB7XG4gICAgLy8gU2FuaXRpemUgdGhlIGJpbmFyeSBuYW1lIGZvciBSdXN0IHBhY2thZ2UgbmFtaW5nIGNvbnZlbnRpb25zXG4gICAgY29uc3Qgc2FuaXRpemVkTmFtZSA9IG9wdGlvbnMuYmluYXJ5TmFtZVxuICAgICAgLnJlcGxhY2UoJ0AnLCAnJylcbiAgICAgIC5yZXBsYWNlKCcvJywgJ18nKVxuICAgICAgLnJlcGxhY2UoLy0vZywgJ18nKVxuICAgICAgLnRvTG93ZXJDYXNlKClcbiAgICBjYXJnb1RvbWwucGFja2FnZS5uYW1lID0gc2FuaXRpemVkTmFtZVxuICB9XG5cbiAgLy8gU3RyaW5naWZ5IHRoZSB1cGRhdGVkIFRPTUxcbiAgY29uc3QgdXBkYXRlZFRvbWxDb250ZW50ID0gc3RyaW5naWZ5VG9tbChjYXJnb1RvbWwpXG5cbiAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoY2FyZ29Ub21sUGF0aCwgdXBkYXRlZFRvbWxDb250ZW50KVxuICBpZiAob2xkTmFtZSAhPT0gb3B0aW9ucy5iaW5hcnlOYW1lKSB7XG4gICAgY29uc3QgZ2l0aHViQWN0aW9uc1BhdGggPSBmaW5kLmRpcignLmdpdGh1YicsIHtcbiAgICAgIGN3ZDogb3B0aW9ucy5jd2QsXG4gICAgfSlcbiAgICBpZiAoZ2l0aHViQWN0aW9uc1BhdGgpIHtcbiAgICAgIGNvbnN0IGdpdGh1YkFjdGlvbnNDSVltbFBhdGggPSBqb2luKFxuICAgICAgICBnaXRodWJBY3Rpb25zUGF0aCxcbiAgICAgICAgJ3dvcmtmbG93cycsXG4gICAgICAgICdDSS55bWwnLFxuICAgICAgKVxuICAgICAgaWYgKGV4aXN0c1N5bmMoZ2l0aHViQWN0aW9uc0NJWW1sUGF0aCkpIHtcbiAgICAgICAgY29uc3QgZ2l0aHViQWN0aW9uc0NvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKFxuICAgICAgICAgIGdpdGh1YkFjdGlvbnNDSVltbFBhdGgsXG4gICAgICAgICAgJ3V0ZjgnLFxuICAgICAgICApXG4gICAgICAgIGNvbnN0IGdpdGh1YkFjdGlvbnNEYXRhID0geWFtbFBhcnNlKGdpdGh1YkFjdGlvbnNDb250ZW50KSBhcyBhbnlcbiAgICAgICAgaWYgKGdpdGh1YkFjdGlvbnNEYXRhLmVudj8uQVBQX05BTUUpIHtcbiAgICAgICAgICBnaXRodWJBY3Rpb25zRGF0YS5lbnYuQVBQX05BTUUgPSBvcHRpb25zLmJpbmFyeU5hbWVcbiAgICAgICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgICAgIGdpdGh1YkFjdGlvbnNDSVltbFBhdGgsXG4gICAgICAgICAgICB5YW1sU3RyaW5naWZ5KGdpdGh1YkFjdGlvbnNEYXRhLCB7XG4gICAgICAgICAgICAgIGxpbmVXaWR0aDogLTEsXG4gICAgICAgICAgICAgIG5vUmVmczogdHJ1ZSxcbiAgICAgICAgICAgICAgc29ydEtleXM6IGZhbHNlLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG9sZFdhc2lCcm93c2VyQmluZGluZ1BhdGggPSBqb2luKFxuICAgICAgb3B0aW9ucy5jd2QsXG4gICAgICBgJHtvbGROYW1lfS53YXNpLWJyb3dzZXIuanNgLFxuICAgIClcbiAgICBpZiAoZXhpc3RzU3luYyhvbGRXYXNpQnJvd3NlckJpbmRpbmdQYXRoKSkge1xuICAgICAgYXdhaXQgcmVuYW1lKFxuICAgICAgICBvbGRXYXNpQnJvd3NlckJpbmRpbmdQYXRoLFxuICAgICAgICBqb2luKG9wdGlvbnMuY3dkLCBgJHtvcHRpb25zLmJpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2ApLFxuICAgICAgKVxuICAgIH1cbiAgICBjb25zdCBvbGRXYXNpQmluZGluZ1BhdGggPSBqb2luKG9wdGlvbnMuY3dkLCBgJHtvbGROYW1lfS53YXNpLmNqc2ApXG4gICAgaWYgKGV4aXN0c1N5bmMob2xkV2FzaUJpbmRpbmdQYXRoKSkge1xuICAgICAgYXdhaXQgcmVuYW1lKFxuICAgICAgICBvbGRXYXNpQmluZGluZ1BhdGgsXG4gICAgICAgIGpvaW4ob3B0aW9ucy5jd2QsIGAke29wdGlvbnMuYmluYXJ5TmFtZX0ud2FzaS5janNgKSxcbiAgICAgIClcbiAgICB9XG4gICAgY29uc3QgZ2l0QXR0cmlidXRlc1BhdGggPSBqb2luKG9wdGlvbnMuY3dkLCAnLmdpdGF0dHJpYnV0ZXMnKVxuICAgIGlmIChleGlzdHNTeW5jKGdpdEF0dHJpYnV0ZXNQYXRoKSkge1xuICAgICAgY29uc3QgZ2l0QXR0cmlidXRlc0NvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKFxuICAgICAgICBnaXRBdHRyaWJ1dGVzUGF0aCxcbiAgICAgICAgJ3V0ZjgnLFxuICAgICAgKVxuICAgICAgY29uc3QgZ2l0QXR0cmlidXRlc0RhdGEgPSBnaXRBdHRyaWJ1dGVzQ29udGVudFxuICAgICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAgIC5tYXAoKGxpbmUpID0+IHtcbiAgICAgICAgICByZXR1cm4gbGluZVxuICAgICAgICAgICAgLnJlcGxhY2UoXG4gICAgICAgICAgICAgIGAke29sZE5hbWV9Lndhc2ktYnJvd3Nlci5qc2AsXG4gICAgICAgICAgICAgIGAke29wdGlvbnMuYmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIC5yZXBsYWNlKGAke29sZE5hbWV9Lndhc2kuY2pzYCwgYCR7b3B0aW9ucy5iaW5hcnlOYW1lfS53YXNpLmNqc2ApXG4gICAgICAgIH0pXG4gICAgICAgIC5qb2luKCdcXG4nKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZ2l0QXR0cmlidXRlc1BhdGgsIGdpdEF0dHJpYnV0ZXNEYXRhKVxuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IHsgZXhlYywgZXhlY1N5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnbm9kZTpmcydcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tICdub2RlOm9zJ1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHsgcHJvbWlzZXMgYXMgZnMgfSBmcm9tICdub2RlOmZzJ1xuXG5pbXBvcnQgeyBsb2FkIGFzIHlhbWxMb2FkLCBkdW1wIGFzIHlhbWxEdW1wIH0gZnJvbSAnanMteWFtbCdcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0TmV3T3B0aW9ucyxcbiAgdHlwZSBOZXdPcHRpb25zIGFzIFJhd05ld09wdGlvbnMsXG59IGZyb20gJy4uL2RlZi9uZXcuanMnXG5pbXBvcnQge1xuICBBVkFJTEFCTEVfVEFSR0VUUyxcbiAgZGVidWdGYWN0b3J5LFxuICBERUZBVUxUX1RBUkdFVFMsXG4gIG1rZGlyQXN5bmMsXG4gIHJlYWRkaXJBc3luYyxcbiAgc3RhdEFzeW5jLFxuICB0eXBlIFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VyLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcbmltcG9ydCB7IG5hcGlFbmdpbmVSZXF1aXJlbWVudCB9IGZyb20gJy4uL3V0aWxzL3ZlcnNpb24uanMnXG5pbXBvcnQgeyByZW5hbWVQcm9qZWN0IH0gZnJvbSAnLi9yZW5hbWUuanMnXG5cbi8vIFRlbXBsYXRlIGltcG9ydHMgcmVtb3ZlZCBhcyB3ZSdyZSBub3cgdXNpbmcgZXh0ZXJuYWwgdGVtcGxhdGVzXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCduZXcnKVxuXG50eXBlIE5ld09wdGlvbnMgPSBSZXF1aXJlZDxSYXdOZXdPcHRpb25zPlxuXG5jb25zdCBURU1QTEFURV9SRVBPUyA9IHtcbiAgeWFybjogJ2h0dHBzOi8vZ2l0aHViLmNvbS9uYXBpLXJzL3BhY2thZ2UtdGVtcGxhdGUnLFxuICBwbnBtOiAnaHR0cHM6Ly9naXRodWIuY29tL25hcGktcnMvcGFja2FnZS10ZW1wbGF0ZS1wbnBtJyxcbn0gYXMgY29uc3RcblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tHaXRDb21tYW5kKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCBjcCA9IGV4ZWMoJ2dpdCAtLXZlcnNpb24nKVxuICAgICAgY3Aub24oJ2Vycm9yJywgKCkgPT4ge1xuICAgICAgICByZXNvbHZlKGZhbHNlKVxuICAgICAgfSlcbiAgICAgIGNwLm9uKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICByZXNvbHZlKHRydWUpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZShmYWxzZSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZUNhY2hlRGlyKFxuICBwYWNrYWdlTWFuYWdlcjogU3VwcG9ydGVkUGFja2FnZU1hbmFnZXIsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBjYWNoZURpciA9IHBhdGguam9pbihob21lZGlyKCksICcubmFwaS1ycycsICd0ZW1wbGF0ZScsIHBhY2thZ2VNYW5hZ2VyKVxuICBhd2FpdCBta2RpckFzeW5jKGNhY2hlRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICByZXR1cm4gY2FjaGVEaXJcbn1cblxuYXN5bmMgZnVuY3Rpb24gZG93bmxvYWRUZW1wbGF0ZShcbiAgcGFja2FnZU1hbmFnZXI6IFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VyLFxuICBjYWNoZURpcjogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHJlcG9VcmwgPSBURU1QTEFURV9SRVBPU1twYWNrYWdlTWFuYWdlcl1cbiAgY29uc3QgdGVtcGxhdGVQYXRoID0gcGF0aC5qb2luKGNhY2hlRGlyLCAncmVwbycpXG5cbiAgaWYgKGV4aXN0c1N5bmModGVtcGxhdGVQYXRoKSkge1xuICAgIGRlYnVnKGBUZW1wbGF0ZSBjYWNoZSBmb3VuZCBhdCAke3RlbXBsYXRlUGF0aH0sIHVwZGF0aW5nLi4uYClcbiAgICB0cnkge1xuICAgICAgLy8gRmV0Y2ggbGF0ZXN0IGNoYW5nZXMgYW5kIHJlc2V0IHRvIHJlbW90ZVxuICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBjb25zdCBjcCA9IGV4ZWMoJ2dpdCBmZXRjaCBvcmlnaW4nLCB7IGN3ZDogdGVtcGxhdGVQYXRoIH0pXG4gICAgICAgIGNwLm9uKCdlcnJvcicsIHJlamVjdClcbiAgICAgICAgY3Aub24oJ2V4aXQnLCAoY29kZSkgPT4ge1xuICAgICAgICAgIGlmIChjb2RlID09PSAwKSB7XG4gICAgICAgICAgICByZXNvbHZlKClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgICAgYEZhaWxlZCB0byBmZXRjaCBsYXRlc3QgY2hhbmdlcywgZ2l0IHByb2Nlc3MgZXhpdGVkIHdpdGggY29kZSAke2NvZGV9YCxcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgIClcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgICAgZXhlY1N5bmMoJ2dpdCByZXNldCAtLWhhcmQgb3JpZ2luL21haW4nLCB7XG4gICAgICAgIGN3ZDogdGVtcGxhdGVQYXRoLFxuICAgICAgICBzdGRpbzogJ2lnbm9yZScsXG4gICAgICB9KVxuICAgICAgZGVidWcoJ1RlbXBsYXRlIHVwZGF0ZWQgc3VjY2Vzc2Z1bGx5JylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgZGVidWcoYEZhaWxlZCB0byB1cGRhdGUgdGVtcGxhdGU6ICR7ZXJyb3J9YClcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHVwZGF0ZSB0ZW1wbGF0ZSBmcm9tICR7cmVwb1VybH06ICR7ZXJyb3J9YClcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgZGVidWcoYENsb25pbmcgdGVtcGxhdGUgZnJvbSAke3JlcG9Vcmx9Li4uYClcbiAgICB0cnkge1xuICAgICAgZXhlY1N5bmMoYGdpdCBjbG9uZSAke3JlcG9Vcmx9IHJlcG9gLCB7IGN3ZDogY2FjaGVEaXIsIHN0ZGlvOiAnaW5oZXJpdCcgfSlcbiAgICAgIGRlYnVnKCdUZW1wbGF0ZSBjbG9uZWQgc3VjY2Vzc2Z1bGx5JylcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY2xvbmUgdGVtcGxhdGUgZnJvbSAke3JlcG9Vcmx9OiAke2Vycm9yfWApXG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvcHlEaXJlY3RvcnkoXG4gIHNyYzogc3RyaW5nLFxuICBkZXN0OiBzdHJpbmcsXG4gIGluY2x1ZGVXYXNpQmluZGluZ3M6IGJvb2xlYW4sXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgbWtkaXJBc3luYyhkZXN0LCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICBjb25zdCBlbnRyaWVzID0gYXdhaXQgZnMucmVhZGRpcihzcmMsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KVxuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgIGNvbnN0IHNyY1BhdGggPSBwYXRoLmpvaW4oc3JjLCBlbnRyeS5uYW1lKVxuICAgIGNvbnN0IGRlc3RQYXRoID0gcGF0aC5qb2luKGRlc3QsIGVudHJ5Lm5hbWUpXG5cbiAgICAvLyBTa2lwIC5naXQgZGlyZWN0b3J5XG4gICAgaWYgKGVudHJ5Lm5hbWUgPT09ICcuZ2l0Jykge1xuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgYXdhaXQgY29weURpcmVjdG9yeShzcmNQYXRoLCBkZXN0UGF0aCwgaW5jbHVkZVdhc2lCaW5kaW5ncylcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICAhaW5jbHVkZVdhc2lCaW5kaW5ncyAmJlxuICAgICAgICAoZW50cnkubmFtZS5lbmRzV2l0aCgnLndhc2ktYnJvd3Nlci5qcycpIHx8XG4gICAgICAgICAgZW50cnkubmFtZS5lbmRzV2l0aCgnLndhc2kuY2pzJykgfHxcbiAgICAgICAgICBlbnRyeS5uYW1lLmVuZHNXaXRoKCd3YXNpLXdvcmtlci5icm93c2VyLm1qcyAnKSB8fFxuICAgICAgICAgIGVudHJ5Lm5hbWUuZW5kc1dpdGgoJ3dhc2ktd29ya2VyLm1qcycpIHx8XG4gICAgICAgICAgZW50cnkubmFtZS5lbmRzV2l0aCgnYnJvd3Nlci5qcycpKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG4gICAgICBhd2FpdCBmcy5jb3B5RmlsZShzcmNQYXRoLCBkZXN0UGF0aClcbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmlsdGVyVGFyZ2V0c0luUGFja2FnZUpzb24oXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIGVuYWJsZWRUYXJnZXRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgsICd1dGYtOCcpXG4gIGNvbnN0IHBhY2thZ2VKc29uID0gSlNPTi5wYXJzZShjb250ZW50KVxuXG4gIC8vIEZpbHRlciBuYXBpLnRhcmdldHNcbiAgaWYgKHBhY2thZ2VKc29uLm5hcGk/LnRhcmdldHMpIHtcbiAgICBwYWNrYWdlSnNvbi5uYXBpLnRhcmdldHMgPSBwYWNrYWdlSnNvbi5uYXBpLnRhcmdldHMuZmlsdGVyKFxuICAgICAgKHRhcmdldDogc3RyaW5nKSA9PiBlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcyh0YXJnZXQpLFxuICAgIClcbiAgfVxuXG4gIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgSlNPTi5zdHJpbmdpZnkocGFja2FnZUpzb24sIG51bGwsIDIpICsgJ1xcbicpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbHRlclRhcmdldHNJbkdpdGh1YkFjdGlvbnMoXG4gIGZpbGVQYXRoOiBzdHJpbmcsXG4gIGVuYWJsZWRUYXJnZXRzOiBzdHJpbmdbXSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgsICd1dGYtOCcpXG4gIGNvbnN0IHlhbWwgPSB5YW1sTG9hZChjb250ZW50KSBhcyBhbnlcblxuICBjb25zdCBtYWNPU0FuZFdpbmRvd3NUYXJnZXRzID0gbmV3IFNldChbXG4gICAgJ3g4Nl82NC1wYy13aW5kb3dzLW1zdmMnLFxuICAgICd4ODZfNjQtcGMtd2luZG93cy1nbnUnLFxuICAgICdhYXJjaDY0LXBjLXdpbmRvd3MtbXN2YycsXG4gICAgJ3g4Nl82NC1hcHBsZS1kYXJ3aW4nLFxuICBdKVxuXG4gIGNvbnN0IGxpbnV4VGFyZ2V0cyA9IG5ldyBTZXQoW1xuICAgICd4ODZfNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICd4ODZfNjQtdW5rbm93bi1saW51eC1tdXNsJyxcbiAgICAnYWFyY2g2NC11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1tdXNsJyxcbiAgICAnYXJtdjctdW5rbm93bi1saW51eC1nbnVlYWJpaGYnLFxuICAgICdhcm12Ny11bmtub3duLWxpbnV4LW11c2xlYWJpaGYnLFxuICAgICdsb29uZ2FyY2g2NC11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ3Jpc2N2NjRnYy11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ3Bvd2VycGM2NGxlLXVua25vd24tbGludXgtZ251JyxcbiAgICAnczM5MHgtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICdhYXJjaDY0LWxpbnV4LWFuZHJvaWQnLFxuICAgICdhcm12Ny1saW51eC1hbmRyb2lkZWFiaScsXG4gIF0pXG5cbiAgLy8gQ2hlY2sgaWYgYW55IExpbnV4IHRhcmdldHMgYXJlIGVuYWJsZWRcbiAgY29uc3QgaGFzTGludXhUYXJnZXRzID0gZW5hYmxlZFRhcmdldHMuc29tZSgodGFyZ2V0KSA9PlxuICAgIGxpbnV4VGFyZ2V0cy5oYXModGFyZ2V0KSxcbiAgKVxuXG4gIC8vIEZpbHRlciB0aGUgbWF0cml4IGNvbmZpZ3VyYXRpb25zIGluIHRoZSBidWlsZCBqb2JcbiAgaWYgKHlhbWw/LmpvYnM/LmJ1aWxkPy5zdHJhdGVneT8ubWF0cml4Py5zZXR0aW5ncykge1xuICAgIHlhbWwuam9icy5idWlsZC5zdHJhdGVneS5tYXRyaXguc2V0dGluZ3MgPVxuICAgICAgeWFtbC5qb2JzLmJ1aWxkLnN0cmF0ZWd5Lm1hdHJpeC5zZXR0aW5ncy5maWx0ZXIoKHNldHRpbmc6IGFueSkgPT4ge1xuICAgICAgICBpZiAoc2V0dGluZy50YXJnZXQpIHtcbiAgICAgICAgICByZXR1cm4gZW5hYmxlZFRhcmdldHMuaW5jbHVkZXMoc2V0dGluZy50YXJnZXQpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG4gIH1cblxuICBjb25zdCBqb2JzVG9SZW1vdmU6IHN0cmluZ1tdID0gW11cblxuICBpZiAoZW5hYmxlZFRhcmdldHMuZXZlcnkoKHRhcmdldCkgPT4gIW1hY09TQW5kV2luZG93c1RhcmdldHMuaGFzKHRhcmdldCkpKSB7XG4gICAgam9ic1RvUmVtb3ZlLnB1c2goJ3Rlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nJylcbiAgfSBlbHNlIHtcbiAgICAvLyBGaWx0ZXIgdGhlIG1hdHJpeCBjb25maWd1cmF0aW9ucyBpbiB0aGUgdGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcgam9iXG4gICAgaWYgKFxuICAgICAgeWFtbD8uam9icz8uWyd0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZyddPy5zdHJhdGVneT8ubWF0cml4Py5zZXR0aW5nc1xuICAgICkge1xuICAgICAgeWFtbC5qb2JzWyd0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZyddLnN0cmF0ZWd5Lm1hdHJpeC5zZXR0aW5ncyA9XG4gICAgICAgIHlhbWwuam9ic1sndGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcnXS5zdHJhdGVneS5tYXRyaXguc2V0dGluZ3MuZmlsdGVyKFxuICAgICAgICAgIChzZXR0aW5nOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmIChzZXR0aW5nLnRhcmdldCkge1xuICAgICAgICAgICAgICByZXR1cm4gZW5hYmxlZFRhcmdldHMuaW5jbHVkZXMoc2V0dGluZy50YXJnZXQpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICB9XG4gIH1cblxuICAvLyBJZiBubyBMaW51eCB0YXJnZXRzIGFyZSBlbmFibGVkLCByZW1vdmUgTGludXgtc3BlY2lmaWMgam9ic1xuICBpZiAoIWhhc0xpbnV4VGFyZ2V0cykge1xuICAgIC8vIFJlbW92ZSB0ZXN0LWxpbnV4LWJpbmRpbmcgam9iXG4gICAgaWYgKHlhbWw/LmpvYnM/LlsndGVzdC1saW51eC1iaW5kaW5nJ10pIHtcbiAgICAgIGpvYnNUb1JlbW92ZS5wdXNoKCd0ZXN0LWxpbnV4LWJpbmRpbmcnKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBGaWx0ZXIgdGhlIG1hdHJpeCBjb25maWd1cmF0aW9ucyBpbiB0aGUgdGVzdC1saW51eC14NjQtZ251LWJpbmRpbmcgam9iXG4gICAgaWYgKHlhbWw/LmpvYnM/LlsndGVzdC1saW51eC1iaW5kaW5nJ10/LnN0cmF0ZWd5Py5tYXRyaXg/LnRhcmdldCkge1xuICAgICAgeWFtbC5qb2JzWyd0ZXN0LWxpbnV4LWJpbmRpbmcnXS5zdHJhdGVneS5tYXRyaXgudGFyZ2V0ID0geWFtbC5qb2JzW1xuICAgICAgICAndGVzdC1saW51eC1iaW5kaW5nJ1xuICAgICAgXS5zdHJhdGVneS5tYXRyaXgudGFyZ2V0LmZpbHRlcigodGFyZ2V0OiBzdHJpbmcpID0+IHtcbiAgICAgICAgaWYgKHRhcmdldCkge1xuICAgICAgICAgIHJldHVybiBlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcyh0YXJnZXQpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgIH0pXG4gICAgfVxuICB9XG5cbiAgaWYgKCFlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcygnd2FzbTMyLXdhc2lwMS10aHJlYWRzJykpIHtcbiAgICBqb2JzVG9SZW1vdmUucHVzaCgndGVzdC13YXNpJylcbiAgfVxuXG4gIGlmICghZW5hYmxlZFRhcmdldHMuaW5jbHVkZXMoJ3g4Nl82NC11bmtub3duLWZyZWVic2QnKSkge1xuICAgIGpvYnNUb1JlbW92ZS5wdXNoKCdidWlsZC1mcmVlYnNkJylcbiAgfVxuXG4gIC8vIEZpbHRlciBvdGhlciB0ZXN0IGpvYnMgYmFzZWQgb24gdGFyZ2V0XG4gIGZvciAoY29uc3QgW2pvYk5hbWUsIGpvYkNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMoeWFtbC5qb2JzIHx8IHt9KSkge1xuICAgIGlmIChcbiAgICAgIGpvYk5hbWUuc3RhcnRzV2l0aCgndGVzdC0nKSAmJlxuICAgICAgam9iTmFtZSAhPT0gJ3Rlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nJyAmJlxuICAgICAgam9iTmFtZSAhPT0gJ3Rlc3QtbGludXgteDY0LWdudS1iaW5kaW5nJ1xuICAgICkge1xuICAgICAgLy8gRXh0cmFjdCB0YXJnZXQgZnJvbSBqb2IgbmFtZSBvciBjb25maWdcbiAgICAgIGNvbnN0IGpvYiA9IGpvYkNvbmZpZyBhcyBhbnlcbiAgICAgIGlmIChqb2Iuc3RyYXRlZ3k/Lm1hdHJpeD8uc2V0dGluZ3M/LlswXT8udGFyZ2V0KSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGpvYi5zdHJhdGVneS5tYXRyaXguc2V0dGluZ3NbMF0udGFyZ2V0XG4gICAgICAgIGlmICghZW5hYmxlZFRhcmdldHMuaW5jbHVkZXModGFyZ2V0KSkge1xuICAgICAgICAgIGpvYnNUb1JlbW92ZS5wdXNoKGpvYk5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBSZW1vdmUgam9icyBmb3IgZGlzYWJsZWQgdGFyZ2V0c1xuICBmb3IgKGNvbnN0IGpvYk5hbWUgb2Ygam9ic1RvUmVtb3ZlKSB7XG4gICAgZGVsZXRlIHlhbWwuam9ic1tqb2JOYW1lXVxuICB9XG5cbiAgaWYgKEFycmF5LmlzQXJyYXkoeWFtbC5qb2JzPy5wdWJsaXNoPy5uZWVkcykpIHtcbiAgICB5YW1sLmpvYnMucHVibGlzaC5uZWVkcyA9IHlhbWwuam9icy5wdWJsaXNoLm5lZWRzLmZpbHRlcihcbiAgICAgIChuZWVkOiBzdHJpbmcpID0+ICFqb2JzVG9SZW1vdmUuaW5jbHVkZXMobmVlZCksXG4gICAgKVxuICB9XG5cbiAgLy8gV3JpdGUgYmFjayB0aGUgZmlsdGVyZWQgWUFNTFxuICBjb25zdCB1cGRhdGVkWWFtbCA9IHlhbWxEdW1wKHlhbWwsIHtcbiAgICBsaW5lV2lkdGg6IC0xLFxuICAgIG5vUmVmczogdHJ1ZSxcbiAgICBzb3J0S2V5czogZmFsc2UsXG4gIH0pXG4gIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwgdXBkYXRlZFlhbWwpXG59XG5cbmZ1bmN0aW9uIHByb2Nlc3NPcHRpb25zKG9wdGlvbnM6IFJhd05ld09wdGlvbnMpIHtcbiAgZGVidWcoJ1Byb2Nlc3Npbmcgb3B0aW9ucy4uLicpXG4gIGlmICghb3B0aW9ucy5wYXRoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2UgcHJvdmlkZSB0aGUgcGF0aCBhcyB0aGUgYXJndW1lbnQnKVxuICB9XG4gIG9wdGlvbnMucGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLnBhdGgpXG4gIGRlYnVnKGBSZXNvbHZlZCB0YXJnZXQgcGF0aCB0bzogJHtvcHRpb25zLnBhdGh9YClcblxuICBpZiAoIW9wdGlvbnMubmFtZSkge1xuICAgIG9wdGlvbnMubmFtZSA9IHBhdGgucGFyc2Uob3B0aW9ucy5wYXRoKS5iYXNlXG4gICAgZGVidWcoYE5vIHByb2plY3QgbmFtZSBwcm92aWRlZCwgZml4IGl0IHRvIGRpciBuYW1lOiAke29wdGlvbnMubmFtZX1gKVxuICB9XG5cbiAgaWYgKCFvcHRpb25zLnRhcmdldHM/Lmxlbmd0aCkge1xuICAgIGlmIChvcHRpb25zLmVuYWJsZUFsbFRhcmdldHMpIHtcbiAgICAgIG9wdGlvbnMudGFyZ2V0cyA9IEFWQUlMQUJMRV9UQVJHRVRTLmNvbmNhdCgpXG4gICAgICBkZWJ1ZygnRW5hYmxlIGFsbCB0YXJnZXRzJylcbiAgICB9IGVsc2UgaWYgKG9wdGlvbnMuZW5hYmxlRGVmYXVsdFRhcmdldHMpIHtcbiAgICAgIG9wdGlvbnMudGFyZ2V0cyA9IERFRkFVTFRfVEFSR0VUUy5jb25jYXQoKVxuICAgICAgZGVidWcoJ0VuYWJsZSBkZWZhdWx0IHRhcmdldHMnKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0F0IGxlYXN0IG9uZSB0YXJnZXQgbXVzdCBiZSBlbmFibGVkJylcbiAgICB9XG4gIH1cbiAgaWYgKFxuICAgIG9wdGlvbnMudGFyZ2V0cy5zb21lKCh0YXJnZXQpID0+IHRhcmdldCA9PT0gJ3dhc20zMi13YXNpLXByZXZpZXcxLXRocmVhZHMnKVxuICApIHtcbiAgICBjb25zdCBvdXQgPSBleGVjU3luYyhgcnVzdHVwIHRhcmdldCBsaXN0YCwge1xuICAgICAgZW5jb2Rpbmc6ICd1dGY4JyxcbiAgICB9KVxuICAgIGlmIChvdXQuaW5jbHVkZXMoJ3dhc20zMi13YXNpcDEtdGhyZWFkcycpKSB7XG4gICAgICBvcHRpb25zLnRhcmdldHMgPSBvcHRpb25zLnRhcmdldHMubWFwKCh0YXJnZXQpID0+XG4gICAgICAgIHRhcmdldCA9PT0gJ3dhc20zMi13YXNpLXByZXZpZXcxLXRocmVhZHMnXG4gICAgICAgICAgPyAnd2FzbTMyLXdhc2lwMS10aHJlYWRzJ1xuICAgICAgICAgIDogdGFyZ2V0LFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBhcHBseURlZmF1bHROZXdPcHRpb25zKG9wdGlvbnMpIGFzIE5ld09wdGlvbnNcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG5ld1Byb2plY3QodXNlck9wdGlvbnM6IFJhd05ld09wdGlvbnMpIHtcbiAgZGVidWcoJ1dpbGwgY3JlYXRlIG5hcGktcnMgcHJvamVjdCB3aXRoIGdpdmVuIG9wdGlvbnM6JylcbiAgZGVidWcodXNlck9wdGlvbnMpXG5cbiAgY29uc3Qgb3B0aW9ucyA9IHByb2Nlc3NPcHRpb25zKHVzZXJPcHRpb25zKVxuXG4gIGRlYnVnKCdUYXJnZXRzIHRvIGJlIGVuYWJsZWQ6JylcbiAgZGVidWcob3B0aW9ucy50YXJnZXRzKVxuXG4gIC8vIENoZWNrIGlmIGdpdCBpcyBhdmFpbGFibGVcbiAgaWYgKCEoYXdhaXQgY2hlY2tHaXRDb21tYW5kKCkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0dpdCBpcyBub3QgaW5zdGFsbGVkIG9yIG5vdCBhdmFpbGFibGUgaW4gUEFUSC4gUGxlYXNlIGluc3RhbGwgR2l0IHRvIGNvbnRpbnVlLicsXG4gICAgKVxuICB9XG5cbiAgY29uc3QgcGFja2FnZU1hbmFnZXIgPSBvcHRpb25zLnBhY2thZ2VNYW5hZ2VyIGFzIFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VyXG5cbiAgLy8gRW5zdXJlIHRhcmdldCBkaXJlY3RvcnkgZXhpc3RzIGFuZCBpcyBlbXB0eVxuICBhd2FpdCBlbnN1cmVQYXRoKG9wdGlvbnMucGF0aCwgb3B0aW9ucy5kcnlSdW4pXG5cbiAgaWYgKCFvcHRpb25zLmRyeVJ1bikge1xuICAgIHRyeSB7XG4gICAgICAvLyBEb3dubG9hZCBvciB1cGRhdGUgdGVtcGxhdGVcbiAgICAgIGNvbnN0IGNhY2hlRGlyID0gYXdhaXQgZW5zdXJlQ2FjaGVEaXIocGFja2FnZU1hbmFnZXIpXG4gICAgICBhd2FpdCBkb3dubG9hZFRlbXBsYXRlKHBhY2thZ2VNYW5hZ2VyLCBjYWNoZURpcilcblxuICAgICAgLy8gQ29weSB0ZW1wbGF0ZSBmaWxlcyB0byB0YXJnZXQgZGlyZWN0b3J5XG4gICAgICBjb25zdCB0ZW1wbGF0ZVBhdGggPSBwYXRoLmpvaW4oY2FjaGVEaXIsICdyZXBvJylcbiAgICAgIGF3YWl0IGNvcHlEaXJlY3RvcnkoXG4gICAgICAgIHRlbXBsYXRlUGF0aCxcbiAgICAgICAgb3B0aW9ucy5wYXRoLFxuICAgICAgICBvcHRpb25zLnRhcmdldHMuaW5jbHVkZXMoJ3dhc20zMi13YXNpcDEtdGhyZWFkcycpLFxuICAgICAgKVxuXG4gICAgICAvLyBSZW5hbWUgcHJvamVjdCB1c2luZyB0aGUgcmVuYW1lIEFQSVxuICAgICAgYXdhaXQgcmVuYW1lUHJvamVjdCh7XG4gICAgICAgIGN3ZDogb3B0aW9ucy5wYXRoLFxuICAgICAgICBuYW1lOiBvcHRpb25zLm5hbWUsXG4gICAgICAgIGJpbmFyeU5hbWU6IGdldEJpbmFyeU5hbWUob3B0aW9ucy5uYW1lKSxcbiAgICAgIH0pXG5cbiAgICAgIC8vIEZpbHRlciB0YXJnZXRzIGluIHBhY2thZ2UuanNvblxuICAgICAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcGF0aC5qb2luKG9wdGlvbnMucGF0aCwgJ3BhY2thZ2UuanNvbicpXG4gICAgICBpZiAoZXhpc3RzU3luYyhwYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAgIGF3YWl0IGZpbHRlclRhcmdldHNJblBhY2thZ2VKc29uKHBhY2thZ2VKc29uUGF0aCwgb3B0aW9ucy50YXJnZXRzKVxuICAgICAgfVxuXG4gICAgICAvLyBGaWx0ZXIgdGFyZ2V0cyBpbiBHaXRIdWIgQWN0aW9ucyBDSVxuICAgICAgY29uc3QgY2lQYXRoID0gcGF0aC5qb2luKG9wdGlvbnMucGF0aCwgJy5naXRodWInLCAnd29ya2Zsb3dzJywgJ0NJLnltbCcpXG4gICAgICBpZiAoZXhpc3RzU3luYyhjaVBhdGgpICYmIG9wdGlvbnMuZW5hYmxlR2l0aHViQWN0aW9ucykge1xuICAgICAgICBhd2FpdCBmaWx0ZXJUYXJnZXRzSW5HaXRodWJBY3Rpb25zKGNpUGF0aCwgb3B0aW9ucy50YXJnZXRzKVxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgIW9wdGlvbnMuZW5hYmxlR2l0aHViQWN0aW9ucyAmJlxuICAgICAgICBleGlzdHNTeW5jKHBhdGguam9pbihvcHRpb25zLnBhdGgsICcuZ2l0aHViJykpXG4gICAgICApIHtcbiAgICAgICAgLy8gUmVtb3ZlIC5naXRodWIgZGlyZWN0b3J5IGlmIEdpdEh1YiBBY3Rpb25zIGlzIG5vdCBlbmFibGVkXG4gICAgICAgIGF3YWl0IGZzLnJtKHBhdGguam9pbihvcHRpb25zLnBhdGgsICcuZ2l0aHViJyksIHtcbiAgICAgICAgICByZWN1cnNpdmU6IHRydWUsXG4gICAgICAgICAgZm9yY2U6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICB9XG5cbiAgICAgIC8vIFVwZGF0ZSBwYWNrYWdlLmpzb24gd2l0aCBhZGRpdGlvbmFsIGNvbmZpZ3VyYXRpb25zXG4gICAgICBjb25zdCBwa2dKc29uQ29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKHBhY2thZ2VKc29uUGF0aCwgJ3V0Zi04JylcbiAgICAgIGNvbnN0IHBrZ0pzb24gPSBKU09OLnBhcnNlKHBrZ0pzb25Db250ZW50KVxuXG4gICAgICAvLyBVcGRhdGUgZW5naW5lIHJlcXVpcmVtZW50XG4gICAgICBpZiAoIXBrZ0pzb24uZW5naW5lcykge1xuICAgICAgICBwa2dKc29uLmVuZ2luZXMgPSB7fVxuICAgICAgfVxuICAgICAgcGtnSnNvbi5lbmdpbmVzLm5vZGUgPSBuYXBpRW5naW5lUmVxdWlyZW1lbnQob3B0aW9ucy5taW5Ob2RlQXBpVmVyc2lvbilcblxuICAgICAgLy8gVXBkYXRlIGxpY2Vuc2UgaWYgZGlmZmVyZW50IGZyb20gdGVtcGxhdGVcbiAgICAgIGlmIChvcHRpb25zLmxpY2Vuc2UgJiYgcGtnSnNvbi5saWNlbnNlICE9PSBvcHRpb25zLmxpY2Vuc2UpIHtcbiAgICAgICAgcGtnSnNvbi5saWNlbnNlID0gb3B0aW9ucy5saWNlbnNlXG4gICAgICB9XG5cbiAgICAgIC8vIFVwZGF0ZSB0ZXN0IGZyYW1ld29yayBpZiBuZWVkZWRcbiAgICAgIGlmIChvcHRpb25zLnRlc3RGcmFtZXdvcmsgIT09ICdhdmEnKSB7XG4gICAgICAgIC8vIFRoaXMgd291bGQgcmVxdWlyZSBtb3JlIGNvbXBsZXggbG9naWMgdG8gdXBkYXRlIHRlc3Qgc2NyaXB0cyBhbmQgZGVwZW5kZW5jaWVzXG4gICAgICAgIGRlYnVnKFxuICAgICAgICAgIGBUZXN0IGZyYW1ld29yayAke29wdGlvbnMudGVzdEZyYW1ld29ya30gcmVxdWVzdGVkIGJ1dCBub3QgeWV0IGltcGxlbWVudGVkYCxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBhd2FpdCBmcy53cml0ZUZpbGUoXG4gICAgICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkocGtnSnNvbiwgbnVsbCwgMikgKyAnXFxuJyxcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHByb2plY3Q6ICR7ZXJyb3J9YClcbiAgICB9XG4gIH1cblxuICBkZWJ1ZyhgUHJvamVjdCBjcmVhdGVkIGF0OiAke29wdGlvbnMucGF0aH1gKVxufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVQYXRoKHBhdGg6IHN0cmluZywgZHJ5UnVuID0gZmFsc2UpIHtcbiAgY29uc3Qgc3RhdCA9IGF3YWl0IHN0YXRBc3luYyhwYXRoLCB7fSkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKVxuXG4gIC8vIGZpbGUgZGVzY3JpcHRvciBleGlzdHNcbiAgaWYgKHN0YXQpIHtcbiAgICBpZiAoc3RhdC5pc0ZpbGUoKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgUGF0aCAke3BhdGh9IGZvciBjcmVhdGluZyBuZXcgbmFwaS1ycyBwcm9qZWN0IGFscmVhZHkgZXhpc3RzIGFuZCBpdCdzIG5vdCBhIGRpcmVjdG9yeS5gLFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHJlYWRkaXJBc3luYyhwYXRoKVxuICAgICAgaWYgKGZpbGVzLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgYFBhdGggJHtwYXRofSBmb3IgY3JlYXRpbmcgbmV3IG5hcGktcnMgcHJvamVjdCBhbHJlYWR5IGV4aXN0cyBhbmQgaXQncyBub3QgZW1wdHkuYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICghZHJ5UnVuKSB7XG4gICAgdHJ5IHtcbiAgICAgIGRlYnVnKGBUcnkgdG8gY3JlYXRlIHRhcmdldCBkaXJlY3Rvcnk6ICR7cGF0aH1gKVxuICAgICAgaWYgKCFkcnlSdW4pIHtcbiAgICAgICAgYXdhaXQgbWtkaXJBc3luYyhwYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSB0YXJnZXQgZGlyZWN0b3J5OiAke3BhdGh9YCwge1xuICAgICAgICBjYXVzZTogZSxcbiAgICAgIH0pXG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGdldEJpbmFyeU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG5hbWUuc3BsaXQoJy8nKS5wb3AoKSFcbn1cblxuZXhwb3J0IHR5cGUgeyBOZXdPcHRpb25zIH1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlUHJlUHVibGlzaENvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1sncHJlLXB1Ymxpc2gnXSwgWydwcmVwdWJsaXNoJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVXBkYXRlIHBhY2thZ2UuanNvbiBhbmQgY29weSBhZGRvbnMgaW50byBwZXIgcGxhdGZvcm0gcGFja2FnZXMnLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG5wbURpciA9IE9wdGlvbi5TdHJpbmcoJy0tbnBtLWRpciwtcCcsICducG0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXQnLFxuICB9KVxuXG4gIHRhZ1N0eWxlID0gT3B0aW9uLlN0cmluZygnLS10YWctc3R5bGUsLS10YWdzdHlsZSwtdCcsICdsZXJuYScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ2dpdCB0YWcgc3R5bGUsIGBucG1gIG9yIGBsZXJuYWAnLFxuICB9KVxuXG4gIGdoUmVsZWFzZSA9IE9wdGlvbi5Cb29sZWFuKCctLWdoLXJlbGVhc2UnLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIGNyZWF0ZSBHaXRIdWIgcmVsZWFzZScsXG4gIH0pXG5cbiAgZ2hSZWxlYXNlTmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tZ2gtcmVsZWFzZS1uYW1lJywge1xuICAgIGRlc2NyaXB0aW9uOiAnR2l0SHViIHJlbGVhc2UgbmFtZScsXG4gIH0pXG5cbiAgZ2hSZWxlYXNlSWQ/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWdoLXJlbGVhc2UtaWQnLCB7XG4gICAgZGVzY3JpcHRpb246ICdFeGlzdGluZyBHaXRIdWIgcmVsZWFzZSBpZCcsXG4gIH0pXG5cbiAgc2tpcE9wdGlvbmFsUHVibGlzaCA9IE9wdGlvbi5Cb29sZWFuKCctLXNraXAtb3B0aW9uYWwtcHVibGlzaCcsIGZhbHNlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIHNraXAgb3B0aW9uYWxEZXBlbmRlbmNpZXMgcGFja2FnZXMgcHVibGlzaCcsXG4gIH0pXG5cbiAgZHJ5UnVuID0gT3B0aW9uLkJvb2xlYW4oJy0tZHJ5LXJ1bicsIGZhbHNlLCB7XG4gICAgZGVzY3JpcHRpb246ICdEcnkgcnVuIHdpdGhvdXQgdG91Y2hpbmcgZmlsZSBzeXN0ZW0nLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgbnBtRGlyOiB0aGlzLm5wbURpcixcbiAgICAgIHRhZ1N0eWxlOiB0aGlzLnRhZ1N0eWxlLFxuICAgICAgZ2hSZWxlYXNlOiB0aGlzLmdoUmVsZWFzZSxcbiAgICAgIGdoUmVsZWFzZU5hbWU6IHRoaXMuZ2hSZWxlYXNlTmFtZSxcbiAgICAgIGdoUmVsZWFzZUlkOiB0aGlzLmdoUmVsZWFzZUlkLFxuICAgICAgc2tpcE9wdGlvbmFsUHVibGlzaDogdGhpcy5za2lwT3B0aW9uYWxQdWJsaXNoLFxuICAgICAgZHJ5UnVuOiB0aGlzLmRyeVJ1bixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBVcGRhdGUgcGFja2FnZS5qc29uIGFuZCBjb3B5IGFkZG9ucyBpbnRvIHBlciBwbGF0Zm9ybSBwYWNrYWdlc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFByZVB1Ymxpc2hPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0XG4gICAqXG4gICAqIEBkZWZhdWx0ICducG0nXG4gICAqL1xuICBucG1EaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIGdpdCB0YWcgc3R5bGUsIGBucG1gIG9yIGBsZXJuYWBcbiAgICpcbiAgICogQGRlZmF1bHQgJ2xlcm5hJ1xuICAgKi9cbiAgdGFnU3R5bGU/OiAnbnBtJyB8ICdsZXJuYSdcbiAgLyoqXG4gICAqIFdoZXRoZXIgY3JlYXRlIEdpdEh1YiByZWxlYXNlXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGdoUmVsZWFzZT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIEdpdEh1YiByZWxlYXNlIG5hbWVcbiAgICovXG4gIGdoUmVsZWFzZU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEV4aXN0aW5nIEdpdEh1YiByZWxlYXNlIGlkXG4gICAqL1xuICBnaFJlbGVhc2VJZD86IHN0cmluZ1xuICAvKipcbiAgICogV2hldGhlciBza2lwIG9wdGlvbmFsRGVwZW5kZW5jaWVzIHBhY2thZ2VzIHB1Ymxpc2hcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHNraXBPcHRpb25hbFB1Ymxpc2g/OiBib29sZWFuXG4gIC8qKlxuICAgKiBEcnkgcnVuIHdpdGhvdXQgdG91Y2hpbmcgZmlsZSBzeXN0ZW1cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIGRyeVJ1bj86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdFByZVB1Ymxpc2hPcHRpb25zKG9wdGlvbnM6IFByZVB1Ymxpc2hPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgbnBtRGlyOiAnbnBtJyxcbiAgICB0YWdTdHlsZTogJ2xlcm5hJyxcbiAgICBnaFJlbGVhc2U6IHRydWUsXG4gICAgc2tpcE9wdGlvbmFsUHVibGlzaDogZmFsc2UsXG4gICAgZHJ5UnVuOiBmYWxzZSxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVZlcnNpb25Db21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ3ZlcnNpb24nXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ1VwZGF0ZSB2ZXJzaW9uIGluIGNyZWF0ZWQgbnBtIHBhY2thZ2VzJyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBucG1EaXIgPSBPcHRpb24uU3RyaW5nKCctLW5wbS1kaXInLCAnbnBtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0JyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG5wbURpcjogdGhpcy5ucG1EaXIsXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVXBkYXRlIHZlcnNpb24gaW4gY3JlYXRlZCBucG0gcGFja2FnZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBWZXJzaW9uT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbnBtJ1xuICAgKi9cbiAgbnBtRGlyPzogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRWZXJzaW9uT3B0aW9ucyhvcHRpb25zOiBWZXJzaW9uT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG5wbURpcjogJ25wbScsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0VmVyc2lvbk9wdGlvbnMsXG4gIHR5cGUgVmVyc2lvbk9wdGlvbnMsXG59IGZyb20gJy4uL2RlZi92ZXJzaW9uLmpzJ1xuaW1wb3J0IHtcbiAgcmVhZE5hcGlDb25maWcsXG4gIGRlYnVnRmFjdG9yeSxcbiAgdXBkYXRlUGFja2FnZUpzb24sXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgndmVyc2lvbicpXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJzaW9uKHVzZXJPcHRpb25zOiBWZXJzaW9uT3B0aW9ucykge1xuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0VmVyc2lvbk9wdGlvbnModXNlck9wdGlvbnMpXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuXG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICApXG5cbiAgZm9yIChjb25zdCB0YXJnZXQgb2YgY29uZmlnLnRhcmdldHMpIHtcbiAgICBjb25zdCBwa2dEaXIgPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLm5wbURpciwgdGFyZ2V0LnBsYXRmb3JtQXJjaEFCSSlcblxuICAgIGRlYnVnKGBVcGRhdGUgdmVyc2lvbiB0byAlaSBpbiBbJWldYCwgY29uZmlnLnBhY2thZ2VKc29uLnZlcnNpb24sIHBrZ0RpcilcbiAgICBhd2FpdCB1cGRhdGVQYWNrYWdlSnNvbihqb2luKHBrZ0RpciwgJ3BhY2thZ2UuanNvbicpLCB7XG4gICAgICB2ZXJzaW9uOiBjb25maWcucGFja2FnZUpzb24udmVyc2lvbixcbiAgICB9KVxuICB9XG59XG4iLCJpbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IGV4aXN0c1N5bmMsIHN0YXRTeW5jIH0gZnJvbSAnbm9kZTpmcydcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7IE9jdG9raXQgfSBmcm9tICdAb2N0b2tpdC9yZXN0J1xuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHRQcmVQdWJsaXNoT3B0aW9ucyxcbiAgdHlwZSBQcmVQdWJsaXNoT3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL3ByZS1wdWJsaXNoLmpzJ1xuaW1wb3J0IHtcbiAgcmVhZEZpbGVBc3luYyxcbiAgcmVhZE5hcGlDb25maWcsXG4gIGRlYnVnRmFjdG9yeSxcbiAgdXBkYXRlUGFja2FnZUpzb24sXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5pbXBvcnQgeyB2ZXJzaW9uIH0gZnJvbSAnLi92ZXJzaW9uLmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgncHJlLXB1Ymxpc2gnKVxuXG5pbnRlcmZhY2UgUGFja2FnZUluZm8ge1xuICBuYW1lOiBzdHJpbmdcbiAgdmVyc2lvbjogc3RyaW5nXG4gIHRhZzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcmVQdWJsaXNoKHVzZXJPcHRpb25zOiBQcmVQdWJsaXNoT3B0aW9ucykge1xuICBkZWJ1ZygnUmVjZWl2ZSBwcmUtcHVibGlzaCBvcHRpb25zOicpXG4gIGRlYnVnKCcgICVPJywgdXNlck9wdGlvbnMpXG5cbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdFByZVB1Ymxpc2hPcHRpb25zKHVzZXJPcHRpb25zKVxuXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuXG4gIGNvbnN0IHsgcGFja2FnZUpzb24sIHRhcmdldHMsIHBhY2thZ2VOYW1lLCBiaW5hcnlOYW1lLCBucG1DbGllbnQgfSA9XG4gICAgYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICAgIClcblxuICBhc3luYyBmdW5jdGlvbiBjcmVhdGVHaFJlbGVhc2UocGFja2FnZU5hbWU6IHN0cmluZywgdmVyc2lvbjogc3RyaW5nKSB7XG4gICAgaWYgKCFvcHRpb25zLmdoUmVsZWFzZSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3duZXI6IG51bGwsXG4gICAgICAgIHJlcG86IG51bGwsXG4gICAgICAgIHBrZ0luZm86IHsgbmFtZTogbnVsbCwgdmVyc2lvbjogbnVsbCwgdGFnOiBudWxsIH0sXG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IHsgcmVwbywgb3duZXIsIHBrZ0luZm8sIG9jdG9raXQgfSA9IGdldFJlcG9JbmZvKHBhY2thZ2VOYW1lLCB2ZXJzaW9uKVxuXG4gICAgaWYgKCFyZXBvIHx8ICFvd25lcikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3duZXI6IG51bGwsXG4gICAgICAgIHJlcG86IG51bGwsXG4gICAgICAgIHBrZ0luZm86IHsgbmFtZTogbnVsbCwgdmVyc2lvbjogbnVsbCwgdGFnOiBudWxsIH0sXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFvcHRpb25zLmRyeVJ1bikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgb2N0b2tpdC5yZXBvcy5jcmVhdGVSZWxlYXNlKHtcbiAgICAgICAgICBvd25lcixcbiAgICAgICAgICByZXBvLFxuICAgICAgICAgIHRhZ19uYW1lOiBwa2dJbmZvLnRhZyxcbiAgICAgICAgICBuYW1lOiBvcHRpb25zLmdoUmVsZWFzZU5hbWUsXG4gICAgICAgICAgcHJlcmVsZWFzZTpcbiAgICAgICAgICAgIHZlcnNpb24uaW5jbHVkZXMoJ2FscGhhJykgfHxcbiAgICAgICAgICAgIHZlcnNpb24uaW5jbHVkZXMoJ2JldGEnKSB8fFxuICAgICAgICAgICAgdmVyc2lvbi5pbmNsdWRlcygncmMnKSxcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgZGVidWcoXG4gICAgICAgICAgYFBhcmFtczogJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICAgIHsgb3duZXIsIHJlcG8sIHRhZ19uYW1lOiBwa2dJbmZvLnRhZyB9LFxuICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgIDIsXG4gICAgICAgICAgKX1gLFxuICAgICAgICApXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZSlcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgb3duZXIsIHJlcG8sIHBrZ0luZm8sIG9jdG9raXQgfVxuICB9XG5cbiAgZnVuY3Rpb24gZ2V0UmVwb0luZm8ocGFja2FnZU5hbWU6IHN0cmluZywgdmVyc2lvbjogc3RyaW5nKSB7XG4gICAgY29uc3QgaGVhZENvbW1pdCA9IGV4ZWNTeW5jKCdnaXQgbG9nIC0xIC0tcHJldHR5PSVCJywge1xuICAgICAgZW5jb2Rpbmc6ICd1dGYtOCcsXG4gICAgfSkudHJpbSgpXG5cbiAgICBjb25zdCB7IEdJVEhVQl9SRVBPU0lUT1JZIH0gPSBwcm9jZXNzLmVudlxuICAgIGlmICghR0lUSFVCX1JFUE9TSVRPUlkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG93bmVyOiBudWxsLFxuICAgICAgICByZXBvOiBudWxsLFxuICAgICAgICBwa2dJbmZvOiB7IG5hbWU6IG51bGwsIHZlcnNpb246IG51bGwsIHRhZzogbnVsbCB9LFxuICAgICAgfVxuICAgIH1cbiAgICBkZWJ1ZyhgR2l0aHViIHJlcG9zaXRvcnk6ICR7R0lUSFVCX1JFUE9TSVRPUll9YClcbiAgICBjb25zdCBbb3duZXIsIHJlcG9dID0gR0lUSFVCX1JFUE9TSVRPUlkuc3BsaXQoJy8nKVxuICAgIGNvbnN0IG9jdG9raXQgPSBuZXcgT2N0b2tpdCh7XG4gICAgICBhdXRoOiBwcm9jZXNzLmVudi5HSVRIVUJfVE9LRU4sXG4gICAgfSlcbiAgICBsZXQgcGtnSW5mbzogUGFja2FnZUluZm8gfCB1bmRlZmluZWRcbiAgICBpZiAob3B0aW9ucy50YWdTdHlsZSA9PT0gJ2xlcm5hJykge1xuICAgICAgY29uc3QgcGFja2FnZXNUb1B1Ymxpc2ggPSBoZWFkQ29tbWl0XG4gICAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoKGxpbmUsIGluZGV4KSA9PiBsaW5lLmxlbmd0aCAmJiBpbmRleClcbiAgICAgICAgLm1hcCgobGluZSkgPT4gbGluZS5zdWJzdHJpbmcoMikpXG4gICAgICAgIC5tYXAocGFyc2VUYWcpXG5cbiAgICAgIHBrZ0luZm8gPSBwYWNrYWdlc1RvUHVibGlzaC5maW5kKFxuICAgICAgICAocGtnSW5mbykgPT4gcGtnSW5mby5uYW1lID09PSBwYWNrYWdlTmFtZSxcbiAgICAgIClcblxuICAgICAgaWYgKCFwa2dJbmZvKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgYE5vIHJlbGVhc2UgY29tbWl0IGZvdW5kIHdpdGggJHtwYWNrYWdlTmFtZX0sIG9yaWdpbmFsIGNvbW1pdCBpbmZvOiAke2hlYWRDb21taXR9YCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBwa2dJbmZvID0ge1xuICAgICAgICB0YWc6IGB2JHt2ZXJzaW9ufWAsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIG5hbWU6IHBhY2thZ2VOYW1lLFxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBvd25lciwgcmVwbywgcGtnSW5mbywgb2N0b2tpdCB9XG4gIH1cblxuICBpZiAoIW9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgYXdhaXQgdmVyc2lvbih1c2VyT3B0aW9ucylcbiAgICBhd2FpdCB1cGRhdGVQYWNrYWdlSnNvbihwYWNrYWdlSnNvblBhdGgsIHtcbiAgICAgIG9wdGlvbmFsRGVwZW5kZW5jaWVzOiB0YXJnZXRzLnJlZHVjZShcbiAgICAgICAgKGRlcHMsIHRhcmdldCkgPT4ge1xuICAgICAgICAgIGRlcHNbYCR7cGFja2FnZU5hbWV9LSR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1gXSA9IHBhY2thZ2VKc29uLnZlcnNpb25cblxuICAgICAgICAgIHJldHVybiBkZXBzXG4gICAgICAgIH0sXG4gICAgICAgIHt9IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICApLFxuICAgIH0pXG4gIH1cblxuICBjb25zdCB7IG93bmVyLCByZXBvLCBwa2dJbmZvLCBvY3Rva2l0IH0gPSBvcHRpb25zLmdoUmVsZWFzZUlkXG4gICAgPyBnZXRSZXBvSW5mbyhwYWNrYWdlTmFtZSwgcGFja2FnZUpzb24udmVyc2lvbilcbiAgICA6IGF3YWl0IGNyZWF0ZUdoUmVsZWFzZShwYWNrYWdlTmFtZSwgcGFja2FnZUpzb24udmVyc2lvbilcblxuICBmb3IgKGNvbnN0IHRhcmdldCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgcGtnRGlyID0gcmVzb2x2ZShcbiAgICAgIG9wdGlvbnMuY3dkLFxuICAgICAgb3B0aW9ucy5ucG1EaXIsXG4gICAgICBgJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfWAsXG4gICAgKVxuICAgIGNvbnN0IGV4dCA9XG4gICAgICB0YXJnZXQucGxhdGZvcm0gPT09ICd3YXNpJyB8fCB0YXJnZXQucGxhdGZvcm0gPT09ICd3YXNtJyA/ICd3YXNtJyA6ICdub2RlJ1xuICAgIGNvbnN0IGZpbGVuYW1lID0gYCR7YmluYXJ5TmFtZX0uJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfS4ke2V4dH1gXG4gICAgY29uc3QgZHN0UGF0aCA9IGpvaW4ocGtnRGlyLCBmaWxlbmFtZSlcblxuICAgIGlmICghb3B0aW9ucy5kcnlSdW4pIHtcbiAgICAgIGlmICghZXhpc3RzU3luYyhkc3RQYXRoKSkge1xuICAgICAgICBkZWJ1Zy53YXJuKGAlcyBkb2Vzbid0IGV4aXN0YCwgZHN0UGF0aClcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKCFvcHRpb25zLnNraXBPcHRpb25hbFB1Ymxpc2gpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBvdXRwdXQgPSBleGVjU3luYyhgJHtucG1DbGllbnR9IHB1Ymxpc2hgLCB7XG4gICAgICAgICAgICBjd2Q6IHBrZ0RpcixcbiAgICAgICAgICAgIGVudjogcHJvY2Vzcy5lbnYsXG4gICAgICAgICAgICBzdGRpbzogJ3BpcGUnLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgcHJvY2Vzcy5zdGRvdXQud3JpdGUob3V0cHV0KVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgZSBpbnN0YW5jZW9mIEVycm9yICYmXG4gICAgICAgICAgICBlLm1lc3NhZ2UuaW5jbHVkZXMoXG4gICAgICAgICAgICAgICdZb3UgY2Fubm90IHB1Ymxpc2ggb3ZlciB0aGUgcHJldmlvdXNseSBwdWJsaXNoZWQgdmVyc2lvbnMnLFxuICAgICAgICAgICAgKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgY29uc29sZS5pbmZvKGUubWVzc2FnZSlcbiAgICAgICAgICAgIGRlYnVnLndhcm4oYCR7cGtnRGlyfSBoYXMgYmVlbiBwdWJsaXNoZWQsIHNraXBwaW5nYClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAob3B0aW9ucy5naFJlbGVhc2UgJiYgcmVwbyAmJiBvd25lcikge1xuICAgICAgICBkZWJ1Zy5pbmZvKGBDcmVhdGluZyBHaXRIdWIgcmVsZWFzZSAke3BrZ0luZm8udGFnfWApXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgcmVsZWFzZUlkID0gb3B0aW9ucy5naFJlbGVhc2VJZFxuICAgICAgICAgICAgPyBOdW1iZXIob3B0aW9ucy5naFJlbGVhc2VJZClcbiAgICAgICAgICAgIDogKFxuICAgICAgICAgICAgICAgIGF3YWl0IG9jdG9raXQhLnJlcG9zLmdldFJlbGVhc2VCeVRhZyh7XG4gICAgICAgICAgICAgICAgICByZXBvOiByZXBvLFxuICAgICAgICAgICAgICAgICAgb3duZXI6IG93bmVyLFxuICAgICAgICAgICAgICAgICAgdGFnOiBwa2dJbmZvLnRhZyxcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICApLmRhdGEuaWRcbiAgICAgICAgICBjb25zdCBkc3RGaWxlU3RhdHMgPSBzdGF0U3luYyhkc3RQYXRoKVxuICAgICAgICAgIGNvbnN0IGFzc2V0SW5mbyA9IGF3YWl0IG9jdG9raXQhLnJlcG9zLnVwbG9hZFJlbGVhc2VBc3NldCh7XG4gICAgICAgICAgICBvd25lcjogb3duZXIsXG4gICAgICAgICAgICByZXBvOiByZXBvLFxuICAgICAgICAgICAgbmFtZTogZmlsZW5hbWUsXG4gICAgICAgICAgICByZWxlYXNlX2lkOiByZWxlYXNlSWQsXG4gICAgICAgICAgICBtZWRpYVR5cGU6IHsgZm9ybWF0OiAncmF3JyB9LFxuICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAnY29udGVudC1sZW5ndGgnOiBkc3RGaWxlU3RhdHMuc2l6ZSxcbiAgICAgICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3Igb2N0b2tpdCB0eXBlcyBhcmUgd3JvbmdcbiAgICAgICAgICAgIGRhdGE6IGF3YWl0IHJlYWRGaWxlQXN5bmMoZHN0UGF0aCksXG4gICAgICAgICAgfSlcbiAgICAgICAgICBkZWJ1Zy5pbmZvKGBHaXRIdWIgcmVsZWFzZSBjcmVhdGVkYClcbiAgICAgICAgICBkZWJ1Zy5pbmZvKGBEb3dubG9hZCBVUkw6ICVzYCwgYXNzZXRJbmZvLmRhdGEuYnJvd3Nlcl9kb3dubG9hZF91cmwpXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBkZWJ1Zy5lcnJvcihcbiAgICAgICAgICAgIGBQYXJhbTogJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICAgICAgeyBvd25lciwgcmVwbywgdGFnOiBwa2dJbmZvLnRhZywgZmlsZW5hbWU6IGRzdFBhdGggfSxcbiAgICAgICAgICAgICAgbnVsbCxcbiAgICAgICAgICAgICAgMixcbiAgICAgICAgICAgICl9YCxcbiAgICAgICAgICApXG4gICAgICAgICAgZGVidWcuZXJyb3IoZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVRhZyh0YWc6IHN0cmluZykge1xuICBjb25zdCBzZWdtZW50cyA9IHRhZy5zcGxpdCgnQCcpXG4gIGNvbnN0IHZlcnNpb24gPSBzZWdtZW50cy5wb3AoKSFcbiAgY29uc3QgbmFtZSA9IHNlZ21lbnRzLmpvaW4oJ0AnKVxuXG4gIHJldHVybiB7XG4gICAgbmFtZSxcbiAgICB2ZXJzaW9uLFxuICAgIHRhZyxcbiAgfVxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VVbml2ZXJzYWxpemVDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ3VuaXZlcnNhbGl6ZSddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnQ29tYmlsZSBidWlsdCBiaW5hcmllcyBpbnRvIG9uZSB1bml2ZXJzYWwgYmluYXJ5JyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBvdXRwdXREaXIgPSBPcHRpb24uU3RyaW5nKCctLW91dHB1dC1kaXIsLW8nLCAnLi8nLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIGFsbCBidWlsdCBgLm5vZGVgIGZpbGVzIHB1dCwgc2FtZSBhcyBgLS1vdXRwdXQtZGlyYCBvZiBidWlsZCBjb21tYW5kJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG91dHB1dERpcjogdGhpcy5vdXRwdXREaXIsXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29tYmlsZSBidWlsdCBiaW5hcmllcyBpbnRvIG9uZSB1bml2ZXJzYWwgYmluYXJ5XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVW5pdmVyc2FsaXplT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSBhbGwgYnVpbHQgYC5ub2RlYCBmaWxlcyBwdXQsIHNhbWUgYXMgYC0tb3V0cHV0LWRpcmAgb2YgYnVpbGQgY29tbWFuZFxuICAgKlxuICAgKiBAZGVmYXVsdCAnLi8nXG4gICAqL1xuICBvdXRwdXREaXI/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdFVuaXZlcnNhbGl6ZU9wdGlvbnMob3B0aW9uczogVW5pdmVyc2FsaXplT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG91dHB1dERpcjogJy4vJyxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgeyBzcGF3blN5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5pbXBvcnQgeyBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHRVbml2ZXJzYWxpemVPcHRpb25zLFxuICB0eXBlIFVuaXZlcnNhbGl6ZU9wdGlvbnMsXG59IGZyb20gJy4uL2RlZi91bml2ZXJzYWxpemUuanMnXG5pbXBvcnQgeyByZWFkTmFwaUNvbmZpZyB9IGZyb20gJy4uL3V0aWxzL2NvbmZpZy5qcydcbmltcG9ydCB7IGRlYnVnRmFjdG9yeSB9IGZyb20gJy4uL3V0aWxzL2xvZy5qcydcbmltcG9ydCB7IGZpbGVFeGlzdHMgfSBmcm9tICcuLi91dGlscy9taXNjLmpzJ1xuaW1wb3J0IHsgVW5pQXJjaHNCeVBsYXRmb3JtIH0gZnJvbSAnLi4vdXRpbHMvdGFyZ2V0LmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgndW5pdmVyc2FsaXplJylcblxuY29uc3QgdW5pdmVyc2FsaXplcnM6IFBhcnRpYWw8XG4gIFJlY29yZDxOb2RlSlMuUGxhdGZvcm0sIChpbnB1dHM6IHN0cmluZ1tdLCBvdXRwdXQ6IHN0cmluZykgPT4gdm9pZD5cbj4gPSB7XG4gIGRhcndpbjogKGlucHV0cywgb3V0cHV0KSA9PiB7XG4gICAgc3Bhd25TeW5jKCdsaXBvJywgWyctY3JlYXRlJywgJy1vdXRwdXQnLCBvdXRwdXQsIC4uLmlucHV0c10sIHtcbiAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgfSlcbiAgfSxcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVuaXZlcnNhbGl6ZUJpbmFyaWVzKHVzZXJPcHRpb25zOiBVbml2ZXJzYWxpemVPcHRpb25zKSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRVbml2ZXJzYWxpemVPcHRpb25zKHVzZXJPcHRpb25zKVxuXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IGpvaW4ob3B0aW9ucy5jd2QsIG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuXG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICApXG5cbiAgY29uc3QgdGFyZ2V0ID0gY29uZmlnLnRhcmdldHMuZmluZChcbiAgICAodCkgPT4gdC5wbGF0Zm9ybSA9PT0gcHJvY2Vzcy5wbGF0Zm9ybSAmJiB0LmFyY2ggPT09ICd1bml2ZXJzYWwnLFxuICApXG5cbiAgaWYgKCF0YXJnZXQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgJ3VuaXZlcnNhbCcgYXJjaCBmb3IgcGxhdGZvcm0gJyR7cHJvY2Vzcy5wbGF0Zm9ybX0nIG5vdCBmb3VuZCBpbiBjb25maWchYCxcbiAgICApXG4gIH1cblxuICBjb25zdCBzcmNGaWxlcyA9IFVuaUFyY2hzQnlQbGF0Zm9ybVtwcm9jZXNzLnBsYXRmb3JtXT8ubWFwKChhcmNoKSA9PlxuICAgIHJlc29sdmUoXG4gICAgICBvcHRpb25zLmN3ZCxcbiAgICAgIG9wdGlvbnMub3V0cHV0RGlyLFxuICAgICAgYCR7Y29uZmlnLmJpbmFyeU5hbWV9LiR7cHJvY2Vzcy5wbGF0Zm9ybX0tJHthcmNofS5ub2RlYCxcbiAgICApLFxuICApXG5cbiAgaWYgKCFzcmNGaWxlcyB8fCAhdW5pdmVyc2FsaXplcnNbcHJvY2Vzcy5wbGF0Zm9ybV0pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgJ3VuaXZlcnNhbCcgYXJjaCBmb3IgcGxhdGZvcm0gJyR7cHJvY2Vzcy5wbGF0Zm9ybX0nIG5vdCBzdXBwb3J0ZWQuYCxcbiAgICApXG4gIH1cblxuICBkZWJ1ZyhgTG9va2luZyB1cCBzb3VyY2UgYmluYXJpZXMgdG8gY29tYmluZTogYClcbiAgZGVidWcoJyAgJU8nLCBzcmNGaWxlcylcblxuICBjb25zdCBzcmNGaWxlTG9va3VwID0gYXdhaXQgUHJvbWlzZS5hbGwoc3JjRmlsZXMubWFwKChmKSA9PiBmaWxlRXhpc3RzKGYpKSlcblxuICBjb25zdCBub3RGb3VuZEZpbGVzID0gc3JjRmlsZXMuZmlsdGVyKChfLCBpKSA9PiAhc3JjRmlsZUxvb2t1cFtpXSlcblxuICBpZiAobm90Rm91bmRGaWxlcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgU29tZSBiaW5hcnkgZmlsZXMgd2VyZSBub3QgZm91bmQ6ICR7SlNPTi5zdHJpbmdpZnkobm90Rm91bmRGaWxlcyl9YCxcbiAgICApXG4gIH1cblxuICBjb25zdCBvdXRwdXQgPSByZXNvbHZlKFxuICAgIG9wdGlvbnMuY3dkLFxuICAgIG9wdGlvbnMub3V0cHV0RGlyLFxuICAgIGAke2NvbmZpZy5iaW5hcnlOYW1lfS4ke3Byb2Nlc3MucGxhdGZvcm19LXVuaXZlcnNhbC5ub2RlYCxcbiAgKVxuXG4gIHVuaXZlcnNhbGl6ZXJzW3Byb2Nlc3MucGxhdGZvcm1dPy4oc3JjRmlsZXMsIG91dHB1dClcblxuICBkZWJ1ZyhgUHJvZHVjZWQgdW5pdmVyc2FsIGJpbmFyeTogJHtvdXRwdXR9YClcbn1cbiIsImltcG9ydCB7IENvbW1hbmQgfSBmcm9tICdjbGlwYW5pb24nXG5cbmltcG9ydCB7IGNvbGxlY3RBcnRpZmFjdHMgfSBmcm9tICcuLi9hcGkvYXJ0aWZhY3RzLmpzJ1xuaW1wb3J0IHsgQmFzZUFydGlmYWN0c0NvbW1hbmQgfSBmcm9tICcuLi9kZWYvYXJ0aWZhY3RzLmpzJ1xuXG5leHBvcnQgY2xhc3MgQXJ0aWZhY3RzQ29tbWFuZCBleHRlbmRzIEJhc2VBcnRpZmFjdHNDb21tYW5kIHtcbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdDb3B5IGFydGlmYWN0cyBmcm9tIEdpdGh1YiBBY3Rpb25zIGludG8gc3BlY2lmaWVkIGRpcicsXG4gICAgZXhhbXBsZXM6IFtcbiAgICAgIFtcbiAgICAgICAgJyQwIGFydGlmYWN0cyAtLW91dHB1dC1kaXIgLi9hcnRpZmFjdHMgLS1kaXN0IC4vbnBtJyxcbiAgICAgICAgYENvcHkgW2JpbmFyeU5hbWVdLltwbGF0Zm9ybV0ubm9kZSB1bmRlciBjdXJyZW50IGRpciguKSBpbnRvIHBhY2thZ2VzIHVuZGVyIG5wbSBkaXIuXG5lLmc6IGluZGV4LmxpbnV4LXg2NC1nbnUubm9kZSAtLT4gLi9ucG0vbGludXgteDY0LWdudS9pbmRleC5saW51eC14NjQtZ251Lm5vZGVgLFxuICAgICAgXSxcbiAgICBdLFxuICB9KVxuXG4gIHN0YXRpYyBwYXRocyA9IFtbJ2FydGlmYWN0cyddXVxuXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgY29sbGVjdEFydGlmYWN0cyh0aGlzLmdldE9wdGlvbnMoKSlcbiAgfVxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VCdWlsZENvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1snYnVpbGQnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIHRoZSBOQVBJLVJTIHByb2plY3QnLFxuICB9KVxuXG4gIHRhcmdldD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tdGFyZ2V0LC10Jywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0J1aWxkIGZvciB0aGUgdGFyZ2V0IHRyaXBsZSwgYnlwYXNzZWQgdG8gYGNhcmdvIGJ1aWxkIC0tdGFyZ2V0YCcsXG4gIH0pXG5cbiAgY3dkPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBtYW5pZmVzdFBhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLW1hbmlmZXN0LXBhdGgnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBDYXJnby50b21sYCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgdGFyZ2V0RGlyPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS10YXJnZXQtZGlyJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0RpcmVjdG9yeSBmb3IgYWxsIGNyYXRlIGdlbmVyYXRlZCBhcnRpZmFjdHMsIHNlZSBgY2FyZ28gYnVpbGQgLS10YXJnZXQtZGlyYCcsXG4gIH0pXG5cbiAgb3V0cHV0RGlyPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1vdXRwdXQtZGlyLC1vJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggdG8gd2hlcmUgYWxsIHRoZSBidWlsdCBmaWxlcyB3b3VsZCBiZSBwdXQuIERlZmF1bHQgdG8gdGhlIGNyYXRlIGZvbGRlcicsXG4gIH0pXG5cbiAgcGxhdGZvcm0/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tcGxhdGZvcm0nLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQWRkIHBsYXRmb3JtIHRyaXBsZSB0byB0aGUgZ2VuZXJhdGVkIG5vZGVqcyBiaW5kaW5nIGZpbGUsIGVnOiBgW25hbWVdLmxpbnV4LXg2NC1nbnUubm9kZWAnLFxuICB9KVxuXG4gIGpzUGFja2FnZU5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWpzLXBhY2thZ2UtbmFtZScsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYWNrYWdlIG5hbWUgaW4gZ2VuZXJhdGVkIGpzIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnJyxcbiAgfSlcblxuICBjb25zdEVudW0/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tY29uc3QtZW51bScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgZ2VuZXJhdGUgY29uc3QgZW51bSBmb3IgdHlwZXNjcmlwdCBiaW5kaW5ncycsXG4gIH0pXG5cbiAganNCaW5kaW5nPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1qcycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIGFuZCBmaWxlbmFtZSBvZiBnZW5lcmF0ZWQgSlMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuIFJlbGF0aXZlIHRvIGAtLW91dHB1dC1kaXJgLicsXG4gIH0pXG5cbiAgbm9Kc0JpbmRpbmc/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tbm8tanMnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnV2hldGhlciB0byBkaXNhYmxlIHRoZSBnZW5lcmF0aW9uIEpTIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLicsXG4gIH0pXG5cbiAgZHRzPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1kdHMnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCBhbmQgZmlsZW5hbWUgb2YgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIFJlbGF0aXZlIHRvIGAtLW91dHB1dC1kaXJgJyxcbiAgfSlcblxuICBkdHNIZWFkZXI/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWR0cy1oZWFkZXInLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQ3VzdG9tIGZpbGUgaGVhZGVyIGZvciBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gT25seSB3b3JrcyB3aGVuIGB0eXBlZGVmYCBmZWF0dXJlIGVuYWJsZWQuJyxcbiAgfSlcblxuICBub0R0c0hlYWRlcj86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1uby1kdHMtaGVhZGVyJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1doZXRoZXIgdG8gZGlzYWJsZSB0aGUgZGVmYXVsdCBmaWxlIGhlYWRlciBmb3IgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIE9ubHkgd29ya3Mgd2hlbiBgdHlwZWRlZmAgZmVhdHVyZSBlbmFibGVkLicsXG4gIH0pXG5cbiAgZHRzQ2FjaGUgPSBPcHRpb24uQm9vbGVhbignLS1kdHMtY2FjaGUnLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIHRvIGVuYWJsZSB0aGUgZHRzIGNhY2hlLCBkZWZhdWx0IHRvIHRydWUnLFxuICB9KVxuXG4gIGVzbT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1lc20nLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnV2hldGhlciB0byBlbWl0IGFuIEVTTSBKUyBiaW5kaW5nIGZpbGUgaW5zdGVhZCBvZiBDSlMgZm9ybWF0LiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuJyxcbiAgfSlcblxuICBzdHJpcD86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1zdHJpcCwtcycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgc3RyaXAgdGhlIGxpYnJhcnkgdG8gYWNoaWV2ZSB0aGUgbWluaW11bSBmaWxlIHNpemUnLFxuICB9KVxuXG4gIHJlbGVhc2U/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tcmVsZWFzZSwtcicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIGluIHJlbGVhc2UgbW9kZScsXG4gIH0pXG5cbiAgdmVyYm9zZT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS12ZXJib3NlLC12Jywge1xuICAgIGRlc2NyaXB0aW9uOiAnVmVyYm9zZWx5IGxvZyBidWlsZCBjb21tYW5kIHRyYWNlJyxcbiAgfSlcblxuICBiaW4/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWJpbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIG9ubHkgdGhlIHNwZWNpZmllZCBiaW5hcnknLFxuICB9KVxuXG4gIHBhY2thZ2U/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UsLXAnLCB7XG4gICAgZGVzY3JpcHRpb246ICdCdWlsZCB0aGUgc3BlY2lmaWVkIGxpYnJhcnkgb3IgdGhlIG9uZSBhdCBjd2QnLFxuICB9KVxuXG4gIHByb2ZpbGU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXByb2ZpbGUnLCB7XG4gICAgZGVzY3JpcHRpb246ICdCdWlsZCBhcnRpZmFjdHMgd2l0aCB0aGUgc3BlY2lmaWVkIHByb2ZpbGUnLFxuICB9KVxuXG4gIGNyb3NzQ29tcGlsZT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1jcm9zcy1jb21waWxlLC14Jywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1tleHBlcmltZW50YWxdIGNyb3NzLWNvbXBpbGUgZm9yIHRoZSBzcGVjaWZpZWQgdGFyZ2V0IHdpdGggYGNhcmdvLXh3aW5gIG9uIHdpbmRvd3MgYW5kIGBjYXJnby16aWdidWlsZGAgb24gb3RoZXIgcGxhdGZvcm0nLFxuICB9KVxuXG4gIHVzZUNyb3NzPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXVzZS1jcm9zcycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdbZXhwZXJpbWVudGFsXSB1c2UgW2Nyb3NzXShodHRwczovL2dpdGh1Yi5jb20vY3Jvc3MtcnMvY3Jvc3MpIGluc3RlYWQgb2YgYGNhcmdvYCcsXG4gIH0pXG5cbiAgdXNlTmFwaUNyb3NzPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXVzZS1uYXBpLWNyb3NzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1tleHBlcmltZW50YWxdIHVzZSBAbmFwaS1ycy9jcm9zcy10b29sY2hhaW4gdG8gY3Jvc3MtY29tcGlsZSBMaW51eCBhcm0vYXJtNjQveDY0IGdudSB0YXJnZXRzLicsXG4gIH0pXG5cbiAgd2F0Y2g/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0td2F0Y2gsLXcnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnd2F0Y2ggdGhlIGNyYXRlIGNoYW5nZXMgYW5kIGJ1aWxkIGNvbnRpbnVvdXNseSB3aXRoIGBjYXJnby13YXRjaGAgY3JhdGVzJyxcbiAgfSlcblxuICBmZWF0dXJlcz86IHN0cmluZ1tdID0gT3B0aW9uLkFycmF5KCctLWZlYXR1cmVzLC1GJywge1xuICAgIGRlc2NyaXB0aW9uOiAnU3BhY2Utc2VwYXJhdGVkIGxpc3Qgb2YgZmVhdHVyZXMgdG8gYWN0aXZhdGUnLFxuICB9KVxuXG4gIGFsbEZlYXR1cmVzPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLWFsbC1mZWF0dXJlcycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0FjdGl2YXRlIGFsbCBhdmFpbGFibGUgZmVhdHVyZXMnLFxuICB9KVxuXG4gIG5vRGVmYXVsdEZlYXR1cmVzPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLW5vLWRlZmF1bHQtZmVhdHVyZXMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdEbyBub3QgYWN0aXZhdGUgdGhlIGBkZWZhdWx0YCBmZWF0dXJlJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICB0YXJnZXQ6IHRoaXMudGFyZ2V0LFxuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIG1hbmlmZXN0UGF0aDogdGhpcy5tYW5pZmVzdFBhdGgsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgdGFyZ2V0RGlyOiB0aGlzLnRhcmdldERpcixcbiAgICAgIG91dHB1dERpcjogdGhpcy5vdXRwdXREaXIsXG4gICAgICBwbGF0Zm9ybTogdGhpcy5wbGF0Zm9ybSxcbiAgICAgIGpzUGFja2FnZU5hbWU6IHRoaXMuanNQYWNrYWdlTmFtZSxcbiAgICAgIGNvbnN0RW51bTogdGhpcy5jb25zdEVudW0sXG4gICAgICBqc0JpbmRpbmc6IHRoaXMuanNCaW5kaW5nLFxuICAgICAgbm9Kc0JpbmRpbmc6IHRoaXMubm9Kc0JpbmRpbmcsXG4gICAgICBkdHM6IHRoaXMuZHRzLFxuICAgICAgZHRzSGVhZGVyOiB0aGlzLmR0c0hlYWRlcixcbiAgICAgIG5vRHRzSGVhZGVyOiB0aGlzLm5vRHRzSGVhZGVyLFxuICAgICAgZHRzQ2FjaGU6IHRoaXMuZHRzQ2FjaGUsXG4gICAgICBlc206IHRoaXMuZXNtLFxuICAgICAgc3RyaXA6IHRoaXMuc3RyaXAsXG4gICAgICByZWxlYXNlOiB0aGlzLnJlbGVhc2UsXG4gICAgICB2ZXJib3NlOiB0aGlzLnZlcmJvc2UsXG4gICAgICBiaW46IHRoaXMuYmluLFxuICAgICAgcGFja2FnZTogdGhpcy5wYWNrYWdlLFxuICAgICAgcHJvZmlsZTogdGhpcy5wcm9maWxlLFxuICAgICAgY3Jvc3NDb21waWxlOiB0aGlzLmNyb3NzQ29tcGlsZSxcbiAgICAgIHVzZUNyb3NzOiB0aGlzLnVzZUNyb3NzLFxuICAgICAgdXNlTmFwaUNyb3NzOiB0aGlzLnVzZU5hcGlDcm9zcyxcbiAgICAgIHdhdGNoOiB0aGlzLndhdGNoLFxuICAgICAgZmVhdHVyZXM6IHRoaXMuZmVhdHVyZXMsXG4gICAgICBhbGxGZWF0dXJlczogdGhpcy5hbGxGZWF0dXJlcyxcbiAgICAgIG5vRGVmYXVsdEZlYXR1cmVzOiB0aGlzLm5vRGVmYXVsdEZlYXR1cmVzLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBOQVBJLVJTIHByb2plY3RcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBCdWlsZE9wdGlvbnMge1xuICAvKipcbiAgICogQnVpbGQgZm9yIHRoZSB0YXJnZXQgdHJpcGxlLCBieXBhc3NlZCB0byBgY2FyZ28gYnVpbGQgLS10YXJnZXRgXG4gICAqL1xuICB0YXJnZXQ/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBDYXJnby50b21sYFxuICAgKi9cbiAgbWFuaWZlc3RQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIERpcmVjdG9yeSBmb3IgYWxsIGNyYXRlIGdlbmVyYXRlZCBhcnRpZmFjdHMsIHNlZSBgY2FyZ28gYnVpbGQgLS10YXJnZXQtZGlyYFxuICAgKi9cbiAgdGFyZ2V0RGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHdoZXJlIGFsbCB0aGUgYnVpbHQgZmlsZXMgd291bGQgYmUgcHV0LiBEZWZhdWx0IHRvIHRoZSBjcmF0ZSBmb2xkZXJcbiAgICovXG4gIG91dHB1dERpcj86IHN0cmluZ1xuICAvKipcbiAgICogQWRkIHBsYXRmb3JtIHRyaXBsZSB0byB0aGUgZ2VuZXJhdGVkIG5vZGVqcyBiaW5kaW5nIGZpbGUsIGVnOiBgW25hbWVdLmxpbnV4LXg2NC1nbnUubm9kZWBcbiAgICovXG4gIHBsYXRmb3JtPzogYm9vbGVhblxuICAvKipcbiAgICogUGFja2FnZSBuYW1lIGluIGdlbmVyYXRlZCBqcyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZ1xuICAgKi9cbiAganNQYWNrYWdlTmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogV2hldGhlciBnZW5lcmF0ZSBjb25zdCBlbnVtIGZvciB0eXBlc2NyaXB0IGJpbmRpbmdzXG4gICAqL1xuICBjb25zdEVudW0/OiBib29sZWFuXG4gIC8qKlxuICAgKiBQYXRoIGFuZCBmaWxlbmFtZSBvZiBnZW5lcmF0ZWQgSlMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuIFJlbGF0aXZlIHRvIGAtLW91dHB1dC1kaXJgLlxuICAgKi9cbiAganNCaW5kaW5nPzogc3RyaW5nXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGRpc2FibGUgdGhlIGdlbmVyYXRpb24gSlMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuXG4gICAqL1xuICBub0pzQmluZGluZz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFBhdGggYW5kIGZpbGVuYW1lIG9mIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBSZWxhdGl2ZSB0byBgLS1vdXRwdXQtZGlyYFxuICAgKi9cbiAgZHRzPzogc3RyaW5nXG4gIC8qKlxuICAgKiBDdXN0b20gZmlsZSBoZWFkZXIgZm9yIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBPbmx5IHdvcmtzIHdoZW4gYHR5cGVkZWZgIGZlYXR1cmUgZW5hYmxlZC5cbiAgICovXG4gIGR0c0hlYWRlcj86IHN0cmluZ1xuICAvKipcbiAgICogV2hldGhlciB0byBkaXNhYmxlIHRoZSBkZWZhdWx0IGZpbGUgaGVhZGVyIGZvciBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gT25seSB3b3JrcyB3aGVuIGB0eXBlZGVmYCBmZWF0dXJlIGVuYWJsZWQuXG4gICAqL1xuICBub0R0c0hlYWRlcj86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZW5hYmxlIHRoZSBkdHMgY2FjaGUsIGRlZmF1bHQgdG8gdHJ1ZVxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBkdHNDYWNoZT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZW1pdCBhbiBFU00gSlMgYmluZGluZyBmaWxlIGluc3RlYWQgb2YgQ0pTIGZvcm1hdC4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLlxuICAgKi9cbiAgZXNtPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciBzdHJpcCB0aGUgbGlicmFyeSB0byBhY2hpZXZlIHRoZSBtaW5pbXVtIGZpbGUgc2l6ZVxuICAgKi9cbiAgc3RyaXA/OiBib29sZWFuXG4gIC8qKlxuICAgKiBCdWlsZCBpbiByZWxlYXNlIG1vZGVcbiAgICovXG4gIHJlbGVhc2U/OiBib29sZWFuXG4gIC8qKlxuICAgKiBWZXJib3NlbHkgbG9nIGJ1aWxkIGNvbW1hbmQgdHJhY2VcbiAgICovXG4gIHZlcmJvc2U/OiBib29sZWFuXG4gIC8qKlxuICAgKiBCdWlsZCBvbmx5IHRoZSBzcGVjaWZpZWQgYmluYXJ5XG4gICAqL1xuICBiaW4/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEJ1aWxkIHRoZSBzcGVjaWZpZWQgbGlicmFyeSBvciB0aGUgb25lIGF0IGN3ZFxuICAgKi9cbiAgcGFja2FnZT86IHN0cmluZ1xuICAvKipcbiAgICogQnVpbGQgYXJ0aWZhY3RzIHdpdGggdGhlIHNwZWNpZmllZCBwcm9maWxlXG4gICAqL1xuICBwcm9maWxlPzogc3RyaW5nXG4gIC8qKlxuICAgKiBbZXhwZXJpbWVudGFsXSBjcm9zcy1jb21waWxlIGZvciB0aGUgc3BlY2lmaWVkIHRhcmdldCB3aXRoIGBjYXJnby14d2luYCBvbiB3aW5kb3dzIGFuZCBgY2FyZ28temlnYnVpbGRgIG9uIG90aGVyIHBsYXRmb3JtXG4gICAqL1xuICBjcm9zc0NvbXBpbGU/OiBib29sZWFuXG4gIC8qKlxuICAgKiBbZXhwZXJpbWVudGFsXSB1c2UgW2Nyb3NzXShodHRwczovL2dpdGh1Yi5jb20vY3Jvc3MtcnMvY3Jvc3MpIGluc3RlYWQgb2YgYGNhcmdvYFxuICAgKi9cbiAgdXNlQ3Jvc3M/OiBib29sZWFuXG4gIC8qKlxuICAgKiBbZXhwZXJpbWVudGFsXSB1c2UgQG5hcGktcnMvY3Jvc3MtdG9vbGNoYWluIHRvIGNyb3NzLWNvbXBpbGUgTGludXggYXJtL2FybTY0L3g2NCBnbnUgdGFyZ2V0cy5cbiAgICovXG4gIHVzZU5hcGlDcm9zcz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIHdhdGNoIHRoZSBjcmF0ZSBjaGFuZ2VzIGFuZCBidWlsZCBjb250aW51b3VzbHkgd2l0aCBgY2FyZ28td2F0Y2hgIGNyYXRlc1xuICAgKi9cbiAgd2F0Y2g/OiBib29sZWFuXG4gIC8qKlxuICAgKiBTcGFjZS1zZXBhcmF0ZWQgbGlzdCBvZiBmZWF0dXJlcyB0byBhY3RpdmF0ZVxuICAgKi9cbiAgZmVhdHVyZXM/OiBzdHJpbmdbXVxuICAvKipcbiAgICogQWN0aXZhdGUgYWxsIGF2YWlsYWJsZSBmZWF0dXJlc1xuICAgKi9cbiAgYWxsRmVhdHVyZXM/OiBib29sZWFuXG4gIC8qKlxuICAgKiBEbyBub3QgYWN0aXZhdGUgdGhlIGBkZWZhdWx0YCBmZWF0dXJlXG4gICAqL1xuICBub0RlZmF1bHRGZWF0dXJlcz86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdEJ1aWxkT3B0aW9ucyhvcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBkdHNDYWNoZTogdHJ1ZSxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcblxuaW1wb3J0IHsgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5pbXBvcnQgeyBidWlsZFByb2plY3QgfSBmcm9tICcuLi9hcGkvYnVpbGQuanMnXG5pbXBvcnQgeyBCYXNlQnVpbGRDb21tYW5kIH0gZnJvbSAnLi4vZGVmL2J1aWxkLmpzJ1xuaW1wb3J0IHsgZGVidWdGYWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCdidWlsZCcpXG5cbmV4cG9ydCBjbGFzcyBCdWlsZENvbW1hbmQgZXh0ZW5kcyBCYXNlQnVpbGRDb21tYW5kIHtcbiAgcGlwZSA9IE9wdGlvbi5TdHJpbmcoJy0tcGlwZScsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQaXBlIGFsbCBvdXRwdXRzIGZpbGUgdG8gZ2l2ZW4gY29tbWFuZC4gZS5nLiBgbmFwaSBidWlsZCAtLXBpcGUgXCJucHggcHJldHRpZXIgLS13cml0ZVwiYCcsXG4gIH0pXG5cbiAgY2FyZ29PcHRpb25zID0gT3B0aW9uLlJlc3QoKVxuXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3QgeyB0YXNrIH0gPSBhd2FpdCBidWlsZFByb2plY3Qoe1xuICAgICAgLi4udGhpcy5nZXRPcHRpb25zKCksXG4gICAgICBjYXJnb09wdGlvbnM6IHRoaXMuY2FyZ29PcHRpb25zLFxuICAgIH0pXG5cbiAgICBjb25zdCBvdXRwdXRzID0gYXdhaXQgdGFza1xuXG4gICAgaWYgKHRoaXMucGlwZSkge1xuICAgICAgZm9yIChjb25zdCBvdXRwdXQgb2Ygb3V0cHV0cykge1xuICAgICAgICBkZWJ1ZygnUGlwaW5nIG91dHB1dCBmaWxlIHRvIGNvbW1hbmQ6ICVzJywgdGhpcy5waXBlKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGV4ZWNTeW5jKGAke3RoaXMucGlwZX0gJHtvdXRwdXQucGF0aH1gLCB7XG4gICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgICAgICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgICAgICB9KVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgZGVidWcuZXJyb3IoYEZhaWxlZCB0byBwaXBlIG91dHB1dCBmaWxlICR7b3V0cHV0LnBhdGh9IHRvIGNvbW1hbmRgKVxuICAgICAgICAgIGRlYnVnLmVycm9yKGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCB7IENvbW1hbmQgfSBmcm9tICdjbGlwYW5pb24nXG5cbmltcG9ydCB7IENMSV9WRVJTSU9OIH0gZnJvbSAnLi4vdXRpbHMvbWlzYy5qcydcblxuLyoqXG4gKiBBIGNvbW1hbmQgdGhhdCBwcmludHMgdGhlIHZlcnNpb24gb2YgdGhlIENMSS5cbiAqXG4gKiBQYXRoczogYC12YCwgYC0tdmVyc2lvbmBcbiAqL1xuZXhwb3J0IGNsYXNzIENsaVZlcnNpb25Db21tYW5kIGV4dGVuZHMgQ29tbWFuZDxhbnk+IHtcbiAgc3RhdGljIHBhdGhzID0gW1tgLXZgXSwgW2AtLXZlcnNpb25gXV1cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNvbnRleHQuc3Rkb3V0LndyaXRlKGAke0NMSV9WRVJTSU9OfVxcbmApXG4gIH1cbn1cbiIsImltcG9ydCB7IGNyZWF0ZU5wbURpcnMgfSBmcm9tICcuLi9hcGkvY3JlYXRlLW5wbS1kaXJzLmpzJ1xuaW1wb3J0IHsgQmFzZUNyZWF0ZU5wbURpcnNDb21tYW5kIH0gZnJvbSAnLi4vZGVmL2NyZWF0ZS1ucG0tZGlycy5qcydcblxuZXhwb3J0IGNsYXNzIENyZWF0ZU5wbURpcnNDb21tYW5kIGV4dGVuZHMgQmFzZUNyZWF0ZU5wbURpcnNDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCBjcmVhdGVOcG1EaXJzKHRoaXMuZ2V0T3B0aW9ucygpKVxuICB9XG59XG4iLCJpbXBvcnQgeyBDb21tYW5kIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG4vKipcbiAqIEEgY29tbWFuZCB0aGF0IHByaW50cyB0aGUgdXNhZ2Ugb2YgYWxsIGNvbW1hbmRzLlxuICpcbiAqIFBhdGhzOiBgLWhgLCBgLS1oZWxwYFxuICovXG5leHBvcnQgY2xhc3MgSGVscENvbW1hbmQgZXh0ZW5kcyBDb21tYW5kPGFueT4ge1xuICBzdGF0aWMgcGF0aHMgPSBbW2AtaGBdLCBbYC0taGVscGBdXVxuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IHRoaXMuY29udGV4dC5zdGRvdXQud3JpdGUodGhpcy5jbGkudXNhZ2UoKSlcbiAgfVxufVxuIiwiaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgeyBpbnB1dCwgc2VsZWN0LCBjaGVja2JveCwgY29uZmlybSB9IGZyb20gJ0BpbnF1aXJlci9wcm9tcHRzJ1xuaW1wb3J0IHsgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5pbXBvcnQgeyBuZXdQcm9qZWN0IH0gZnJvbSAnLi4vYXBpL25ldy5qcydcbmltcG9ydCB7IEJhc2VOZXdDb21tYW5kIH0gZnJvbSAnLi4vZGVmL25ldy5qcydcbmltcG9ydCB7XG4gIEFWQUlMQUJMRV9UQVJHRVRTLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIERFRkFVTFRfVEFSR0VUUyxcbiAgdHlwZSBUYXJnZXRUcmlwbGUsXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuaW1wb3J0IHsgbmFwaUVuZ2luZVJlcXVpcmVtZW50IH0gZnJvbSAnLi4vdXRpbHMvdmVyc2lvbi5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ25ldycpXG5cbmV4cG9ydCBjbGFzcyBOZXdDb21tYW5kIGV4dGVuZHMgQmFzZU5ld0NvbW1hbmQge1xuICBpbnRlcmFjdGl2ZSA9IE9wdGlvbi5Cb29sZWFuKCctLWludGVyYWN0aXZlLC1pJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0FzayBwcm9qZWN0IGJhc2ljIGluZm9ybWF0aW9uIGludGVyYWN0aXZlbHkgd2l0aG91dCBqdXN0IHVzaW5nIHRoZSBkZWZhdWx0LicsXG4gIH0pXG5cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgb3B0aW9ucyA9IGF3YWl0IHRoaXMuZmV0Y2hPcHRpb25zKClcbiAgICAgIGF3YWl0IG5ld1Byb2plY3Qob3B0aW9ucylcbiAgICAgIHJldHVybiAwXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZGVidWcoJ0ZhaWxlZCB0byBjcmVhdGUgbmV3IHByb2plY3QnKVxuICAgICAgZGVidWcuZXJyb3IoZSlcbiAgICAgIHJldHVybiAxXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaE9wdGlvbnMoKSB7XG4gICAgY29uc3QgY21kT3B0aW9ucyA9IHN1cGVyLmdldE9wdGlvbnMoKVxuXG4gICAgaWYgKHRoaXMuaW50ZXJhY3RpdmUpIHtcbiAgICAgIGNvbnN0IHRhcmdldFBhdGg6IHN0cmluZyA9IGNtZE9wdGlvbnMucGF0aFxuICAgICAgICA/IGNtZE9wdGlvbnMucGF0aFxuICAgICAgICA6IGF3YWl0IGlucXVpcmVyUHJvamVjdFBhdGgoKVxuICAgICAgY21kT3B0aW9ucy5wYXRoID0gdGFyZ2V0UGF0aFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4uY21kT3B0aW9ucyxcbiAgICAgICAgbmFtZTogYXdhaXQgdGhpcy5mZXRjaE5hbWUocGF0aC5wYXJzZSh0YXJnZXRQYXRoKS5iYXNlKSxcbiAgICAgICAgbWluTm9kZUFwaVZlcnNpb246IGF3YWl0IHRoaXMuZmV0Y2hOYXBpVmVyc2lvbigpLFxuICAgICAgICB0YXJnZXRzOiBhd2FpdCB0aGlzLmZldGNoVGFyZ2V0cygpLFxuICAgICAgICBsaWNlbnNlOiBhd2FpdCB0aGlzLmZldGNoTGljZW5zZSgpLFxuICAgICAgICBlbmFibGVUeXBlRGVmOiBhd2FpdCB0aGlzLmZldGNoVHlwZURlZigpLFxuICAgICAgICBlbmFibGVHaXRodWJBY3Rpb25zOiBhd2FpdCB0aGlzLmZldGNoR2l0aHViQWN0aW9ucygpLFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjbWRPcHRpb25zXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTmFtZShkZWZhdWx0TmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy4kJG5hbWUgPz9cbiAgICAgIGlucHV0KHtcbiAgICAgICAgbWVzc2FnZTogJ1BhY2thZ2UgbmFtZSAodGhlIG5hbWUgZmllbGQgaW4geW91ciBwYWNrYWdlLmpzb24gZmlsZSknLFxuICAgICAgICBkZWZhdWx0OiBkZWZhdWx0TmFtZSxcbiAgICAgIH0pXG4gICAgKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaExpY2Vuc2UoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gaW5wdXQoe1xuICAgICAgbWVzc2FnZTogJ0xpY2Vuc2UgZm9yIG9wZW4tc291cmNlZCBwcm9qZWN0JyxcbiAgICAgIGRlZmF1bHQ6IHRoaXMubGljZW5zZSxcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaE5hcGlWZXJzaW9uKCk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgcmV0dXJuIHNlbGVjdCh7XG4gICAgICBtZXNzYWdlOiAnTWluaW11bSBub2RlLWFwaSB2ZXJzaW9uICh3aXRoIG5vZGUgdmVyc2lvbiByZXF1aXJlbWVudCknLFxuICAgICAgbG9vcDogZmFsc2UsXG4gICAgICBwYWdlU2l6ZTogMTAsXG4gICAgICBjaG9pY2VzOiBBcnJheS5mcm9tKHsgbGVuZ3RoOiA4IH0sIChfLCBpKSA9PiAoe1xuICAgICAgICBuYW1lOiBgbmFwaSR7aSArIDF9ICgke25hcGlFbmdpbmVSZXF1aXJlbWVudChpICsgMSl9KWAsXG4gICAgICAgIHZhbHVlOiBpICsgMSxcbiAgICAgIH0pKSxcbiAgICAgIC8vIGNob2ljZSBpbmRleFxuICAgICAgZGVmYXVsdDogdGhpcy5taW5Ob2RlQXBpVmVyc2lvbiAtIDEsXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hUYXJnZXRzKCk6IFByb21pc2U8VGFyZ2V0VHJpcGxlW10+IHtcbiAgICBpZiAodGhpcy5lbmFibGVBbGxUYXJnZXRzKSB7XG4gICAgICByZXR1cm4gQVZBSUxBQkxFX1RBUkdFVFMuY29uY2F0KClcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRzID0gYXdhaXQgY2hlY2tib3goe1xuICAgICAgbG9vcDogZmFsc2UsXG4gICAgICBtZXNzYWdlOiAnQ2hvb3NlIHRhcmdldChzKSB5b3VyIGNyYXRlIHdpbGwgYmUgY29tcGlsZWQgdG8nLFxuICAgICAgY2hvaWNlczogQVZBSUxBQkxFX1RBUkdFVFMubWFwKCh0YXJnZXQpID0+ICh7XG4gICAgICAgIG5hbWU6IHRhcmdldCxcbiAgICAgICAgdmFsdWU6IHRhcmdldCxcbiAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgICBjaGVja2VkOiBERUZBVUxUX1RBUkdFVFMuaW5jbHVkZXModGFyZ2V0KSxcbiAgICAgIH0pKSxcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRhcmdldHNcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hUeXBlRGVmKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVuYWJsZVR5cGVEZWYgPSBhd2FpdCBjb25maXJtKHtcbiAgICAgIG1lc3NhZ2U6ICdFbmFibGUgdHlwZSBkZWZpbml0aW9uIGF1dG8tZ2VuZXJhdGlvbicsXG4gICAgICBkZWZhdWx0OiB0aGlzLmVuYWJsZVR5cGVEZWYsXG4gICAgfSlcblxuICAgIHJldHVybiBlbmFibGVUeXBlRGVmXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoR2l0aHViQWN0aW9ucygpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBlbmFibGVHaXRodWJBY3Rpb25zID0gYXdhaXQgY29uZmlybSh7XG4gICAgICBtZXNzYWdlOiAnRW5hYmxlIEdpdGh1YiBBY3Rpb25zIENJJyxcbiAgICAgIGRlZmF1bHQ6IHRoaXMuZW5hYmxlR2l0aHViQWN0aW9ucyxcbiAgICB9KVxuXG4gICAgcmV0dXJuIGVuYWJsZUdpdGh1YkFjdGlvbnNcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBpbnF1aXJlclByb2plY3RQYXRoKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHJldHVybiBpbnB1dCh7XG4gICAgbWVzc2FnZTogJ1RhcmdldCBwYXRoIHRvIGNyZWF0ZSB0aGUgcHJvamVjdCwgcmVsYXRpdmUgdG8gY3dkLicsXG4gIH0pLnRoZW4oKHBhdGgpID0+IHtcbiAgICBpZiAoIXBhdGgpIHtcbiAgICAgIHJldHVybiBpbnF1aXJlclByb2plY3RQYXRoKClcbiAgICB9XG4gICAgcmV0dXJuIHBhdGhcbiAgfSlcbn1cbiIsImltcG9ydCB7IHByZVB1Ymxpc2ggfSBmcm9tICcuLi9hcGkvcHJlLXB1Ymxpc2guanMnXG5pbXBvcnQgeyBCYXNlUHJlUHVibGlzaENvbW1hbmQgfSBmcm9tICcuLi9kZWYvcHJlLXB1Ymxpc2guanMnXG5cbmV4cG9ydCBjbGFzcyBQcmVQdWJsaXNoQ29tbWFuZCBleHRlbmRzIEJhc2VQcmVQdWJsaXNoQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvciBjb25zdCAnbnBtJyB8ICdsZXJuYScgdG8gc3RyaW5nXG4gICAgYXdhaXQgcHJlUHVibGlzaCh0aGlzLmdldE9wdGlvbnMoKSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgaW5wdXQgfSBmcm9tICdAaW5xdWlyZXIvcHJvbXB0cydcblxuaW1wb3J0IHsgcmVuYW1lUHJvamVjdCB9IGZyb20gJy4uL2FwaS9yZW5hbWUuanMnXG5pbXBvcnQgeyBCYXNlUmVuYW1lQ29tbWFuZCB9IGZyb20gJy4uL2RlZi9yZW5hbWUuanMnXG5cbmV4cG9ydCBjbGFzcyBSZW5hbWVDb21tYW5kIGV4dGVuZHMgQmFzZVJlbmFtZUNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuICAgIGlmICghb3B0aW9ucy5uYW1lKSB7XG4gICAgICBjb25zdCBuYW1lID0gYXdhaXQgaW5wdXQoe1xuICAgICAgICBtZXNzYWdlOiBgRW50ZXIgdGhlIG5ldyBwYWNrYWdlIG5hbWUgaW4gdGhlIHBhY2thZ2UuanNvbmAsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSlcbiAgICAgIG9wdGlvbnMubmFtZSA9IG5hbWVcbiAgICB9XG4gICAgaWYgKCFvcHRpb25zLmJpbmFyeU5hbWUpIHtcbiAgICAgIGNvbnN0IGJpbmFyeU5hbWUgPSBhd2FpdCBpbnB1dCh7XG4gICAgICAgIG1lc3NhZ2U6IGBFbnRlciB0aGUgbmV3IGJpbmFyeSBuYW1lYCxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9KVxuICAgICAgb3B0aW9ucy5iaW5hcnlOYW1lID0gYmluYXJ5TmFtZVxuICAgIH1cbiAgICBhd2FpdCByZW5hbWVQcm9qZWN0KG9wdGlvbnMpXG4gIH1cbn1cbiIsImltcG9ydCB7IHVuaXZlcnNhbGl6ZUJpbmFyaWVzIH0gZnJvbSAnLi4vYXBpL3VuaXZlcnNhbGl6ZS5qcydcbmltcG9ydCB7IEJhc2VVbml2ZXJzYWxpemVDb21tYW5kIH0gZnJvbSAnLi4vZGVmL3VuaXZlcnNhbGl6ZS5qcydcblxuZXhwb3J0IGNsYXNzIFVuaXZlcnNhbGl6ZUNvbW1hbmQgZXh0ZW5kcyBCYXNlVW5pdmVyc2FsaXplQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgdW5pdmVyc2FsaXplQmluYXJpZXModGhpcy5nZXRPcHRpb25zKCkpXG4gIH1cbn1cbiIsImltcG9ydCB7IHZlcnNpb24gfSBmcm9tICcuLi9hcGkvdmVyc2lvbi5qcydcbmltcG9ydCB7IEJhc2VWZXJzaW9uQ29tbWFuZCB9IGZyb20gJy4uL2RlZi92ZXJzaW9uLmpzJ1xuXG5leHBvcnQgY2xhc3MgVmVyc2lvbkNvbW1hbmQgZXh0ZW5kcyBCYXNlVmVyc2lvbkNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IHZlcnNpb24odGhpcy5nZXRPcHRpb25zKCkpXG4gIH1cbn1cbiIsImltcG9ydCB7IENsaSB9IGZyb20gJ2NsaXBhbmlvbidcblxuaW1wb3J0IHsgY29sbGVjdEFydGlmYWN0cyB9IGZyb20gJy4vYXBpL2FydGlmYWN0cy5qcydcbmltcG9ydCB7IGJ1aWxkUHJvamVjdCB9IGZyb20gJy4vYXBpL2J1aWxkLmpzJ1xuaW1wb3J0IHsgY3JlYXRlTnBtRGlycyB9IGZyb20gJy4vYXBpL2NyZWF0ZS1ucG0tZGlycy5qcydcbmltcG9ydCB7IG5ld1Byb2plY3QgfSBmcm9tICcuL2FwaS9uZXcuanMnXG5pbXBvcnQgeyBwcmVQdWJsaXNoIH0gZnJvbSAnLi9hcGkvcHJlLXB1Ymxpc2guanMnXG5pbXBvcnQgeyByZW5hbWVQcm9qZWN0IH0gZnJvbSAnLi9hcGkvcmVuYW1lLmpzJ1xuaW1wb3J0IHsgdW5pdmVyc2FsaXplQmluYXJpZXMgfSBmcm9tICcuL2FwaS91bml2ZXJzYWxpemUuanMnXG5pbXBvcnQgeyB2ZXJzaW9uIH0gZnJvbSAnLi9hcGkvdmVyc2lvbi5qcydcbmltcG9ydCB7IEFydGlmYWN0c0NvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL2FydGlmYWN0cy5qcydcbmltcG9ydCB7IEJ1aWxkQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvYnVpbGQuanMnXG5pbXBvcnQgeyBDbGlWZXJzaW9uQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvY2xpLXZlcnNpb24uanMnXG5pbXBvcnQgeyBDcmVhdGVOcG1EaXJzQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvY3JlYXRlLW5wbS1kaXJzLmpzJ1xuaW1wb3J0IHsgSGVscENvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL2hlbHAuanMnXG5pbXBvcnQgeyBOZXdDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9uZXcuanMnXG5pbXBvcnQgeyBQcmVQdWJsaXNoQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvcHJlLXB1Ymxpc2guanMnXG5pbXBvcnQgeyBSZW5hbWVDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9yZW5hbWUuanMnXG5pbXBvcnQgeyBVbml2ZXJzYWxpemVDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy91bml2ZXJzYWxpemUuanMnXG5pbXBvcnQgeyBWZXJzaW9uQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvdmVyc2lvbi5qcydcbmltcG9ydCB7IENMSV9WRVJTSU9OIH0gZnJvbSAnLi91dGlscy9taXNjLmpzJ1xuXG5leHBvcnQgY29uc3QgY2xpID0gbmV3IENsaSh7XG4gIGJpbmFyeU5hbWU6ICduYXBpJyxcbiAgYmluYXJ5VmVyc2lvbjogQ0xJX1ZFUlNJT04sXG59KVxuXG5jbGkucmVnaXN0ZXIoTmV3Q29tbWFuZClcbmNsaS5yZWdpc3RlcihCdWlsZENvbW1hbmQpXG5jbGkucmVnaXN0ZXIoQ3JlYXRlTnBtRGlyc0NvbW1hbmQpXG5jbGkucmVnaXN0ZXIoQXJ0aWZhY3RzQ29tbWFuZClcbmNsaS5yZWdpc3RlcihVbml2ZXJzYWxpemVDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKFJlbmFtZUNvbW1hbmQpXG5jbGkucmVnaXN0ZXIoUHJlUHVibGlzaENvbW1hbmQpXG5jbGkucmVnaXN0ZXIoVmVyc2lvbkNvbW1hbmQpXG5jbGkucmVnaXN0ZXIoSGVscENvbW1hbmQpXG5jbGkucmVnaXN0ZXIoQ2xpVmVyc2lvbkNvbW1hbmQpXG5cbi8qKlxuICpcbiAqIEB1c2FnZVxuICpcbiAqIGBgYHRzXG4gKiBjb25zdCBjbGkgPSBuZXcgTmFwaUNsaSgpXG4gKlxuICogY2xpLmJ1aWxkKHtcbiAqICAgY3dkOiAnL3BhdGgvdG8veW91ci9wcm9qZWN0JyxcbiAqIH0pXG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIE5hcGlDbGkge1xuICBhcnRpZmFjdHMgPSBjb2xsZWN0QXJ0aWZhY3RzXG4gIG5ldyA9IG5ld1Byb2plY3RcbiAgYnVpbGQgPSBidWlsZFByb2plY3RcbiAgY3JlYXRlTnBtRGlycyA9IGNyZWF0ZU5wbURpcnNcbiAgcHJlUHVibGlzaCA9IHByZVB1Ymxpc2hcbiAgcmVuYW1lID0gcmVuYW1lUHJvamVjdFxuICB1bml2ZXJzYWxpemUgPSB1bml2ZXJzYWxpemVCaW5hcmllc1xuICB2ZXJzaW9uID0gdmVyc2lvblxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQnVpbGRDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogQnVpbGRDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsnYnVpbGQnLCAuLi5hcmdzXSkgYXMgQnVpbGRDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBcnRpZmFjdHNDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogQXJ0aWZhY3RzQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ2FydGlmYWN0cycsIC4uLmFyZ3NdKSBhcyBBcnRpZmFjdHNDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDcmVhdGVOcG1EaXJzQ29tbWFuZChcbiAgYXJnczogc3RyaW5nW10sXG4pOiBDcmVhdGVOcG1EaXJzQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ2NyZWF0ZS1ucG0tZGlycycsIC4uLmFyZ3NdKSBhcyBDcmVhdGVOcG1EaXJzQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUHJlUHVibGlzaENvbW1hbmQoYXJnczogc3RyaW5nW10pOiBQcmVQdWJsaXNoQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ3ByZS1wdWJsaXNoJywgLi4uYXJnc10pIGFzIFByZVB1Ymxpc2hDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVSZW5hbWVDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogUmVuYW1lQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ3JlbmFtZScsIC4uLmFyZ3NdKSBhcyBSZW5hbWVDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVVbml2ZXJzYWxpemVDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogVW5pdmVyc2FsaXplQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ3VuaXZlcnNhbGl6ZScsIC4uLmFyZ3NdKSBhcyBVbml2ZXJzYWxpemVDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVWZXJzaW9uQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IFZlcnNpb25Db21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsndmVyc2lvbicsIC4uLmFyZ3NdKSBhcyBWZXJzaW9uQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlTmV3Q29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IE5ld0NvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWyduZXcnLCAuLi5hcmdzXSkgYXMgTmV3Q29tbWFuZFxufVxuXG5leHBvcnQgeyBwYXJzZVRyaXBsZSB9IGZyb20gJy4vdXRpbHMvdGFyZ2V0LmpzJ1xuZXhwb3J0IHtcbiAgdHlwZSBHZW5lcmF0ZVR5cGVEZWZPcHRpb25zLFxuICB0eXBlIFdyaXRlSnNCaW5kaW5nT3B0aW9ucyxcbiAgd3JpdGVKc0JpbmRpbmcsXG4gIGdlbmVyYXRlVHlwZURlZixcbn0gZnJvbSAnLi9hcGkvYnVpbGQuanMnXG5leHBvcnQgeyByZWFkTmFwaUNvbmZpZyB9IGZyb20gJy4vdXRpbHMvY29uZmlnLmpzJ1xuIiwiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuXG5pbXBvcnQgeyBjbGkgfSBmcm9tICcuL2luZGV4LmpzJ1xuXG52b2lkIGNsaS5ydW5FeGl0KHByb2Nlc3MuYXJndi5zbGljZSgyKSlcbiJdLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMTksMjAsMjEsMjIsMjMsMjQsMjVdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUlBLElBQXNCLHVCQUF0QixjQUFtRCxRQUFRO0NBQ3pELE9BQU8sUUFBUSxDQUFDLENBQUMsWUFBWSxDQUFDO0NBRTlCLE9BQU8sUUFBUSxRQUFRLE1BQU0sRUFDM0IsYUFDRSw2RUFDSCxDQUFDO0NBRUYsTUFBTSxPQUFPLE9BQU8sU0FBUyxRQUFRLEtBQUssRUFBRSxFQUMxQyxhQUNFLHNIQUNILENBQUM7Q0FFRixhQUFzQixPQUFPLE9BQU8sb0JBQW9CLEVBQ3RELGFBQWEsbUNBQ2QsQ0FBQztDQUVGLGtCQUFrQixPQUFPLE9BQU8sdUJBQXVCLGdCQUFnQixFQUNyRSxhQUFhLDBCQUNkLENBQUM7Q0FFRixZQUFZLE9BQU8sT0FBTyxzQkFBc0IsZUFBZSxFQUM3RCxhQUNFLGlHQUNILENBQUM7Q0FFRixTQUFTLE9BQU8sT0FBTyxhQUFhLE9BQU8sRUFDekMsYUFBYSxpREFDZCxDQUFDO0NBRUYsaUJBQTBCLE9BQU8sT0FBTyxzQkFBc0IsRUFDNUQsYUFDRSxtRkFDSCxDQUFDO0NBRUYsYUFBYTtBQUNYLFNBQU87R0FDTCxLQUFLLEtBQUs7R0FDVixZQUFZLEtBQUs7R0FDakIsaUJBQWlCLEtBQUs7R0FDdEIsV0FBVyxLQUFLO0dBQ2hCLFFBQVEsS0FBSztHQUNiLGdCQUFnQixLQUFLO0dBQ3RCOzs7QUEwQ0wsU0FBZ0IsNkJBQTZCLFNBQTJCO0FBQ3RFLFFBQU87RUFDTCxLQUFLLFFBQVEsS0FBSztFQUNsQixpQkFBaUI7RUFDakIsV0FB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