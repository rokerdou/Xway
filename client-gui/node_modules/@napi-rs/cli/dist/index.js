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
/**
*
* @usage
*
* ```ts
* const cli = new NapiCli()
*
* cli.build({
*   cwd: '/path/to/your/project',
* })
* ```
*/
var NapiCli = class {
	artifacts = collectArtifacts;
	new = newProject;
	build = buildProject;
	createNpmDirs = createNpmDirs;
	prePublish = prePublish;
	rename = renameProject;
	universalize = universalizeBinaries;
	version = version;
};
function createBuildCommand(args) {
	return cli.process(["build", ...args]);
}
function createArtifactsCommand(args) {
	return cli.process(["artifacts", ...args]);
}
function createCreateNpmDirsCommand(args) {
	return cli.process(["create-npm-dirs", ...args]);
}
function createPrePublishCommand(args) {
	return cli.process(["pre-publish", ...args]);
}
function createRenameCommand(args) {
	return cli.process(["rename", ...args]);
}
function createUniversalizeCommand(args) {
	return cli.process(["universalize", ...args]);
}
function createVersionCommand(args) {
	return cli.process(["version", ...args]);
}
function createNewCommand(args) {
	return cli.process(["new", ...args]);
}
//#endregion
export { NapiCli, cli, createArtifactsCommand, createBuildCommand, createCreateNpmDirsCommand, createNewCommand, createPrePublishCommand, createRenameCommand, createUniversalizeCommand, createVersionCommand, generateTypeDef, parseTriple, readNapiConfig, writeJsBinding };

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJuYW1lcyI6WyJkZWJ1ZyIsInBpY2siLCJwa2dKc29uLnZlcnNpb24iLCJkZWJ1ZyIsImRlYnVnIiwicmVxdWlyZSIsImRlYnVnIiwibWtkaXJBc3luYyIsInJhd01rZGlyQXN5bmMiLCJ3cml0ZUZpbGVBc3luYyIsInJhd1dyaXRlRmlsZUFzeW5jIiwicGljayIsInBhcnNlIiwiI3ByaW50T2JqZWN0IiwiI2Zvcm1hdCIsIiNpc1NpbXBseVNlcmlhbGl6YWJsZSIsIiNkYXRlRGVjbGFyYXRpb24iLCIjc3RyRGVjbGFyYXRpb24iLCIjbnVtYmVyRGVjbGFyYXRpb24iLCIjYm9vbERlY2xhcmF0aW9uIiwiI2dldFR5cGVPZkFycmF5IiwiI2FycmF5RGVjbGFyYXRpb24iLCIjaGVhZGVyR3JvdXAiLCIjcHJpbnRBc0lubGluZVZhbHVlIiwiI2RlY2xhcmF0aW9uIiwiI2hlYWRlciIsIiNhcnJheVR5cGVDYWNoZSIsIiNkb0dldFR5cGVPZkFycmF5IiwiI2lzUHJpbWl0aXZlIiwiI3ByaW50RGF0ZSIsIiNzb3VyY2UiLCIjcG9zaXRpb24iLCIjd2hpdGVzcGFjZSIsImpvaW4iLCJtZXJnZSIsInBhcnNlIiwid2Fsay51cCIsInBhcnNlVG9tbCIsInN0cmluZ2lmeVRvbWwiLCJmaW5kLmRpciIsInlhbWxQYXJzZSIsInlhbWxTdHJpbmdpZnkiLCJkZWJ1ZyIsImZzIiwieWFtbExvYWQiLCJ5YW1sRHVtcCIsImRlYnVnIiwiZGVidWciLCJkZWJ1ZyIsImRlYnVnIl0sInNvdXJjZXMiOlsiLi4vc3JjL2RlZi9hcnRpZmFjdHMudHMiLCIuLi9zcmMvdXRpbHMvbG9nLnRzIiwiLi4vcGFja2FnZS5qc29uIiwiLi4vc3JjL3V0aWxzL21pc2MudHMiLCIuLi9zcmMvdXRpbHMvdGFyZ2V0LnRzIiwiLi4vc3JjL3V0aWxzL3ZlcnNpb24udHMiLCIuLi9zcmMvdXRpbHMvbWV0YWRhdGEudHMiLCIuLi9zcmMvdXRpbHMvY29uZmlnLnRzIiwiLi4vc3JjL3V0aWxzL2NhcmdvLnRzIiwiLi4vc3JjL3V0aWxzL3R5cGVnZW4udHMiLCIuLi9zcmMvdXRpbHMvcmVhZC1jb25maWcudHMiLCIuLi9zcmMvYXBpL2FydGlmYWN0cy50cyIsIi4uL3NyYy9hcGkvdGVtcGxhdGVzL2pzLWJpbmRpbmcudHMiLCIuLi9zcmMvYXBpL3RlbXBsYXRlcy9sb2FkLXdhc2ktdGVtcGxhdGUudHMiLCIuLi9zcmMvYXBpL3RlbXBsYXRlcy93YXNpLXdvcmtlci10ZW1wbGF0ZS50cyIsIi4uL3NyYy9hcGkvYnVpbGQudHMiLCIuLi9zcmMvZGVmL2NyZWF0ZS1ucG0tZGlycy50cyIsIi4uL3NyYy9hcGkvY3JlYXRlLW5wbS1kaXJzLnRzIiwiLi4vc3JjL2RlZi9uZXcudHMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHN0ZC90b21sL3N0cmluZ2lmeS5qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy9AanNyL3N0ZF9fY29sbGVjdGlvbnMvZGVlcF9tZXJnZS5qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ac3RkL3RvbWwvX3BhcnNlci5qcyIsIi4uLy4uL25vZGVfbW9kdWxlcy9Ac3RkL3RvbWwvcGFyc2UuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvZW1wYXRoaWMvcmVzb2x2ZS5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvZW1wYXRoaWMvd2Fsay5tanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvZW1wYXRoaWMvZmluZC5tanMiLCIuLi9zcmMvZGVmL3JlbmFtZS50cyIsIi4uL3NyYy9hcGkvcmVuYW1lLnRzIiwiLi4vc3JjL2FwaS9uZXcudHMiLCIuLi9zcmMvZGVmL3ByZS1wdWJsaXNoLnRzIiwiLi4vc3JjL2RlZi92ZXJzaW9uLnRzIiwiLi4vc3JjL2FwaS92ZXJzaW9uLnRzIiwiLi4vc3JjL2FwaS9wcmUtcHVibGlzaC50cyIsIi4uL3NyYy9kZWYvdW5pdmVyc2FsaXplLnRzIiwiLi4vc3JjL2FwaS91bml2ZXJzYWxpemUudHMiLCIuLi9zcmMvY29tbWFuZHMvYXJ0aWZhY3RzLnRzIiwiLi4vc3JjL2RlZi9idWlsZC50cyIsIi4uL3NyYy9jb21tYW5kcy9idWlsZC50cyIsIi4uL3NyYy9jb21tYW5kcy9jbGktdmVyc2lvbi50cyIsIi4uL3NyYy9jb21tYW5kcy9jcmVhdGUtbnBtLWRpcnMudHMiLCIuLi9zcmMvY29tbWFuZHMvaGVscC50cyIsIi4uL3NyYy9jb21tYW5kcy9uZXcudHMiLCIuLi9zcmMvY29tbWFuZHMvcHJlLXB1Ymxpc2gudHMiLCIuLi9zcmMvY29tbWFuZHMvcmVuYW1lLnRzIiwiLi4vc3JjL2NvbW1hbmRzL3VuaXZlcnNhbGl6ZS50cyIsIi4uL3NyYy9jb21tYW5kcy92ZXJzaW9uLnRzIiwiLi4vc3JjL2luZGV4LnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlQXJ0aWZhY3RzQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWydhcnRpZmFjdHMnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdDb3B5IGFydGlmYWN0cyBmcm9tIEdpdGh1YiBBY3Rpb25zIGludG8gbnBtIHBhY2thZ2VzIGFuZCByZWFkeSB0byBwdWJsaXNoJyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBvdXRwdXREaXIgPSBPcHRpb24uU3RyaW5nKCctLW91dHB1dC1kaXIsLW8sLWQnLCAnLi9hcnRpZmFjdHMnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIGFsbCBidWlsdCBgLm5vZGVgIGZpbGVzIHB1dCwgc2FtZSBhcyBgLS1vdXRwdXQtZGlyYCBvZiBidWlsZCBjb21tYW5kJyxcbiAgfSlcblxuICBucG1EaXIgPSBPcHRpb24uU3RyaW5nKCctLW5wbS1kaXInLCAnbnBtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0JyxcbiAgfSlcblxuICBidWlsZE91dHB1dERpcj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tYnVpbGQtb3V0cHV0LWRpcicsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIHRvIHRoZSBidWlsZCBvdXRwdXQgZGlyLCBvbmx5IG5lZWRlZCB3aGVuIHRhcmdldHMgY29udGFpbnMgYHdhc20zMi13YXNpLSpgJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG91dHB1dERpcjogdGhpcy5vdXRwdXREaXIsXG4gICAgICBucG1EaXI6IHRoaXMubnBtRGlyLFxuICAgICAgYnVpbGRPdXRwdXREaXI6IHRoaXMuYnVpbGRPdXRwdXREaXIsXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ29weSBhcnRpZmFjdHMgZnJvbSBHaXRodWIgQWN0aW9ucyBpbnRvIG5wbSBwYWNrYWdlcyBhbmQgcmVhZHkgdG8gcHVibGlzaFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFydGlmYWN0c09wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgYWxsIGJ1aWx0IGAubm9kZWAgZmlsZXMgcHV0LCBzYW1lIGFzIGAtLW91dHB1dC1kaXJgIG9mIGJ1aWxkIGNvbW1hbmRcbiAgICpcbiAgICogQGRlZmF1bHQgJy4vYXJ0aWZhY3RzJ1xuICAgKi9cbiAgb3V0cHV0RGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXRcbiAgICpcbiAgICogQGRlZmF1bHQgJ25wbSdcbiAgICovXG4gIG5wbURpcj86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgYnVpbGQgb3V0cHV0IGRpciwgb25seSBuZWVkZWQgd2hlbiB0YXJnZXRzIGNvbnRhaW5zIGB3YXNtMzItd2FzaS0qYFxuICAgKi9cbiAgYnVpbGRPdXRwdXREaXI/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdEFydGlmYWN0c09wdGlvbnMob3B0aW9uczogQXJ0aWZhY3RzT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG91dHB1dERpcjogJy4vYXJ0aWZhY3RzJyxcbiAgICBucG1EaXI6ICducG0nLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCAqIGFzIGNvbG9ycyBmcm9tICdjb2xvcmV0dGUnXG5pbXBvcnQgeyBjcmVhdGVEZWJ1ZyB9IGZyb20gJ29idWcnXG5cbmRlY2xhcmUgbW9kdWxlICdvYnVnJyB7XG4gIGludGVyZmFjZSBEZWJ1Z2dlciB7XG4gICAgaW5mbzogdHlwZW9mIGNvbnNvbGUuZXJyb3JcbiAgICB3YXJuOiB0eXBlb2YgY29uc29sZS5lcnJvclxuICAgIGVycm9yOiB0eXBlb2YgY29uc29sZS5lcnJvclxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBkZWJ1Z0ZhY3RvcnkgPSAobmFtZXNwYWNlOiBzdHJpbmcpID0+IHtcbiAgY29uc3QgZGVidWcgPSBjcmVhdGVEZWJ1ZyhgbmFwaToke25hbWVzcGFjZX1gLCB7XG4gICAgZm9ybWF0dGVyczoge1xuICAgICAgLy8gZGVidWcoJyVpJywgJ1RoaXMgaXMgYW4gaW5mbycpXG4gICAgICBpKHYpIHtcbiAgICAgICAgcmV0dXJuIGNvbG9ycy5ncmVlbih2KVxuICAgICAgfSxcbiAgICB9LFxuICB9KVxuXG4gIGRlYnVnLmluZm8gPSAoLi4uYXJnczogYW55W10pID0+XG4gICAgY29uc29sZS5lcnJvcihjb2xvcnMuYmxhY2soY29sb3JzLmJnR3JlZW4oJyBJTkZPICcpKSwgLi4uYXJncylcbiAgZGVidWcud2FybiA9ICguLi5hcmdzOiBhbnlbXSkgPT5cbiAgICBjb25zb2xlLmVycm9yKGNvbG9ycy5ibGFjayhjb2xvcnMuYmdZZWxsb3coJyBXQVJOSU5HICcpKSwgLi4uYXJncylcbiAgZGVidWcuZXJyb3IgPSAoLi4uYXJnczogYW55W10pID0+XG4gICAgY29uc29sZS5lcnJvcihcbiAgICAgIGNvbG9ycy53aGl0ZShjb2xvcnMuYmdSZWQoJyBFUlJPUiAnKSksXG4gICAgICAuLi5hcmdzLm1hcCgoYXJnKSA9PlxuICAgICAgICBhcmcgaW5zdGFuY2VvZiBFcnJvciA/IChhcmcuc3RhY2sgPz8gYXJnLm1lc3NhZ2UpIDogYXJnLFxuICAgICAgKSxcbiAgICApXG5cbiAgcmV0dXJuIGRlYnVnXG59XG5leHBvcnQgY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ3V0aWxzJylcbiIsIiIsImltcG9ydCB7XG4gIHJlYWRGaWxlLFxuICB3cml0ZUZpbGUsXG4gIHVubGluayxcbiAgY29weUZpbGUsXG4gIG1rZGlyLFxuICBzdGF0LFxuICByZWFkZGlyLFxuICBhY2Nlc3MsXG59IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5cbmltcG9ydCBwa2dKc29uIGZyb20gJy4uLy4uL3BhY2thZ2UuanNvbicgd2l0aCB7IHR5cGU6ICdqc29uJyB9XG5pbXBvcnQgeyBkZWJ1ZyB9IGZyb20gJy4vbG9nLmpzJ1xuXG5leHBvcnQgY29uc3QgcmVhZEZpbGVBc3luYyA9IHJlYWRGaWxlXG5leHBvcnQgY29uc3Qgd3JpdGVGaWxlQXN5bmMgPSB3cml0ZUZpbGVcbmV4cG9ydCBjb25zdCB1bmxpbmtBc3luYyA9IHVubGlua1xuZXhwb3J0IGNvbnN0IGNvcHlGaWxlQXN5bmMgPSBjb3B5RmlsZVxuZXhwb3J0IGNvbnN0IG1rZGlyQXN5bmMgPSBta2RpclxuZXhwb3J0IGNvbnN0IHN0YXRBc3luYyA9IHN0YXRcbmV4cG9ydCBjb25zdCByZWFkZGlyQXN5bmMgPSByZWFkZGlyXG5cbmV4cG9ydCBmdW5jdGlvbiBmaWxlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICByZXR1cm4gYWNjZXNzKHBhdGgpLnRoZW4oXG4gICAgKCkgPT4gdHJ1ZSxcbiAgICAoKSA9PiBmYWxzZSxcbiAgKVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGlyRXhpc3RzQXN5bmMocGF0aDogc3RyaW5nKSB7XG4gIHRyeSB7XG4gICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBzdGF0QXN5bmMocGF0aClcbiAgICByZXR1cm4gc3RhdHMuaXNEaXJlY3RvcnkoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcGljazxPLCBLIGV4dGVuZHMga2V5b2YgTz4obzogTywgLi4ua2V5czogS1tdKTogUGljazxPLCBLPiB7XG4gIHJldHVybiBrZXlzLnJlZHVjZSgoYWNjLCBrZXkpID0+IHtcbiAgICBhY2Nba2V5XSA9IG9ba2V5XVxuICAgIHJldHVybiBhY2NcbiAgfSwge30gYXMgTylcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHVwZGF0ZVBhY2thZ2VKc29uKFxuICBwYXRoOiBzdHJpbmcsXG4gIHBhcnRpYWw6IFJlY29yZDxzdHJpbmcsIGFueT4sXG4pIHtcbiAgY29uc3QgZXhpc3RzID0gYXdhaXQgZmlsZUV4aXN0cyhwYXRoKVxuICBpZiAoIWV4aXN0cykge1xuICAgIGRlYnVnKGBGaWxlIG5vdCBleGlzdHMgJHtwYXRofWApXG4gICAgcmV0dXJuXG4gIH1cbiAgY29uc3Qgb2xkID0gSlNPTi5wYXJzZShhd2FpdCByZWFkRmlsZUFzeW5jKHBhdGgsICd1dGY4JykpXG4gIGF3YWl0IHdyaXRlRmlsZUFzeW5jKHBhdGgsIEpTT04uc3RyaW5naWZ5KHsgLi4ub2xkLCAuLi5wYXJ0aWFsIH0sIG51bGwsIDIpKVxufVxuXG5leHBvcnQgY29uc3QgQ0xJX1ZFUlNJT04gPSBwa2dKc29uLnZlcnNpb25cbiIsImltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuXG5leHBvcnQgdHlwZSBQbGF0Zm9ybSA9IE5vZGVKUy5QbGF0Zm9ybSB8ICd3YXNtJyB8ICd3YXNpJyB8ICdvcGVuaGFybW9ueSdcblxuZXhwb3J0IGNvbnN0IFVOSVZFUlNBTF9UQVJHRVRTID0ge1xuICAndW5pdmVyc2FsLWFwcGxlLWRhcndpbic6IFsnYWFyY2g2NC1hcHBsZS1kYXJ3aW4nLCAneDg2XzY0LWFwcGxlLWRhcndpbiddLFxufSBhcyBjb25zdFxuXG5jb25zdCBTVUJfU1lTVEVNUyA9IG5ldyBTZXQoWydhbmRyb2lkJywgJ29ob3MnXSlcblxuZXhwb3J0IGNvbnN0IEFWQUlMQUJMRV9UQVJHRVRTID0gW1xuICAnYWFyY2g2NC1hcHBsZS1kYXJ3aW4nLFxuICAnYWFyY2g2NC1saW51eC1hbmRyb2lkJyxcbiAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAnYWFyY2g2NC11bmtub3duLWxpbnV4LW11c2wnLFxuICAnYWFyY2g2NC11bmtub3duLWxpbnV4LW9ob3MnLFxuICAnYWFyY2g2NC1wYy13aW5kb3dzLW1zdmMnLFxuICAneDg2XzY0LWFwcGxlLWRhcndpbicsXG4gICd4ODZfNjQtcGMtd2luZG93cy1tc3ZjJyxcbiAgJ3g4Nl82NC1wYy13aW5kb3dzLWdudScsXG4gICd4ODZfNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAneDg2XzY0LXVua25vd24tbGludXgtbXVzbCcsXG4gICd4ODZfNjQtdW5rbm93bi1saW51eC1vaG9zJyxcbiAgJ3g4Nl82NC11bmtub3duLWZyZWVic2QnLFxuICAnaTY4Ni1wYy13aW5kb3dzLW1zdmMnLFxuICAnYXJtdjctdW5rbm93bi1saW51eC1nbnVlYWJpaGYnLFxuICAnYXJtdjctdW5rbm93bi1saW51eC1tdXNsZWFiaWhmJyxcbiAgJ2FybXY3LWxpbnV4LWFuZHJvaWRlYWJpJyxcbiAgJ3VuaXZlcnNhbC1hcHBsZS1kYXJ3aW4nLFxuICAnbG9vbmdhcmNoNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAncmlzY3Y2NGdjLXVua25vd24tbGludXgtZ251JyxcbiAgJ3Bvd2VycGM2NGxlLXVua25vd24tbGludXgtZ251JyxcbiAgJ3MzOTB4LXVua25vd24tbGludXgtZ251JyxcbiAgJ3dhc20zMi13YXNpLXByZXZpZXcxLXRocmVhZHMnLFxuICAnd2FzbTMyLXdhc2lwMS10aHJlYWRzJyxcbl0gYXMgY29uc3RcblxuZXhwb3J0IHR5cGUgVGFyZ2V0VHJpcGxlID0gKHR5cGVvZiBBVkFJTEFCTEVfVEFSR0VUUylbbnVtYmVyXVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9UQVJHRVRTID0gW1xuICAneDg2XzY0LWFwcGxlLWRhcndpbicsXG4gICdhYXJjaDY0LWFwcGxlLWRhcndpbicsXG4gICd4ODZfNjQtcGMtd2luZG93cy1tc3ZjJyxcbiAgJ3g4Nl82NC11bmtub3duLWxpbnV4LWdudScsXG5dIGFzIGNvbnN0XG5cbmV4cG9ydCBjb25zdCBUQVJHRVRfTElOS0VSOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAnYWFyY2g2NC11bmtub3duLWxpbnV4LW11c2wnOiAnYWFyY2g2NC1saW51eC1tdXNsLWdjYycsXG4gIC8vIFRPRE86IFN3aXRjaCB0byBsb29uZ2FyY2g2NC1saW51eC1nbnUtZ2NjIHdoZW4gYXZhaWxhYmxlXG4gICdsb29uZ2FyY2g2NC11bmtub3duLWxpbnV4LWdudSc6ICdsb29uZ2FyY2g2NC1saW51eC1nbnUtZ2NjLTEzJyxcbiAgJ3Jpc2N2NjRnYy11bmtub3duLWxpbnV4LWdudSc6ICdyaXNjdjY0LWxpbnV4LWdudS1nY2MnLFxuICAncG93ZXJwYzY0bGUtdW5rbm93bi1saW51eC1nbnUnOiAncG93ZXJwYzY0bGUtbGludXgtZ251LWdjYycsXG4gICdzMzkweC11bmtub3duLWxpbnV4LWdudSc6ICdzMzkweC1saW51eC1nbnUtZ2NjJyxcbn1cblxuLy8gaHR0cHM6Ly9ub2RlanMub3JnL2FwaS9wcm9jZXNzLmh0bWwjcHJvY2Vzc19wcm9jZXNzX2FyY2hcbnR5cGUgTm9kZUpTQXJjaCA9XG4gIHwgJ2FybSdcbiAgfCAnYXJtNjQnXG4gIHwgJ2lhMzInXG4gIHwgJ2xvb25nNjQnXG4gIHwgJ21pcHMnXG4gIHwgJ21pcHNlbCdcbiAgfCAncHBjJ1xuICB8ICdwcGM2NCdcbiAgfCAncmlzY3Y2NCdcbiAgfCAnczM5MCdcbiAgfCAnczM5MHgnXG4gIHwgJ3gzMidcbiAgfCAneDY0J1xuICB8ICd1bml2ZXJzYWwnXG4gIHwgJ3dhc20zMidcblxuY29uc3QgQ3B1VG9Ob2RlQXJjaDogUmVjb3JkPHN0cmluZywgTm9kZUpTQXJjaD4gPSB7XG4gIHg4Nl82NDogJ3g2NCcsXG4gIGFhcmNoNjQ6ICdhcm02NCcsXG4gIGk2ODY6ICdpYTMyJyxcbiAgYXJtdjc6ICdhcm0nLFxuICBsb29uZ2FyY2g2NDogJ2xvb25nNjQnLFxuICByaXNjdjY0Z2M6ICdyaXNjdjY0JyxcbiAgcG93ZXJwYzY0bGU6ICdwcGM2NCcsXG59XG5cbmV4cG9ydCBjb25zdCBOb2RlQXJjaFRvQ3B1OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICB4NjQ6ICd4ODZfNjQnLFxuICBhcm02NDogJ2FhcmNoNjQnLFxuICBpYTMyOiAnaTY4NicsXG4gIGFybTogJ2FybXY3JyxcbiAgbG9vbmc2NDogJ2xvb25nYXJjaDY0JyxcbiAgcmlzY3Y2NDogJ3Jpc2N2NjRnYycsXG4gIHBwYzY0OiAncG93ZXJwYzY0bGUnLFxufVxuXG5jb25zdCBTeXNUb05vZGVQbGF0Zm9ybTogUmVjb3JkPHN0cmluZywgUGxhdGZvcm0+ID0ge1xuICBsaW51eDogJ2xpbnV4JyxcbiAgZnJlZWJzZDogJ2ZyZWVic2QnLFxuICBkYXJ3aW46ICdkYXJ3aW4nLFxuICB3aW5kb3dzOiAnd2luMzInLFxuICBvaG9zOiAnb3Blbmhhcm1vbnknLFxufVxuXG5leHBvcnQgY29uc3QgVW5pQXJjaHNCeVBsYXRmb3JtOiBQYXJ0aWFsPFJlY29yZDxQbGF0Zm9ybSwgTm9kZUpTQXJjaFtdPj4gPSB7XG4gIGRhcndpbjogWyd4NjQnLCAnYXJtNjQnXSxcbn1cblxuZXhwb3J0IGludGVyZmFjZSBUYXJnZXQge1xuICB0cmlwbGU6IHN0cmluZ1xuICBwbGF0Zm9ybUFyY2hBQkk6IHN0cmluZ1xuICBwbGF0Zm9ybTogUGxhdGZvcm1cbiAgYXJjaDogTm9kZUpTQXJjaFxuICBhYmk6IHN0cmluZyB8IG51bGxcbn1cblxuLyoqXG4gKiBBIHRyaXBsZSBpcyBhIHNwZWNpZmljIGZvcm1hdCBmb3Igc3BlY2lmeWluZyBhIHRhcmdldCBhcmNoaXRlY3R1cmUuXG4gKiBUcmlwbGVzIG1heSBiZSByZWZlcnJlZCB0byBhcyBhIHRhcmdldCB0cmlwbGUgd2hpY2ggaXMgdGhlIGFyY2hpdGVjdHVyZSBmb3IgdGhlIGFydGlmYWN0IHByb2R1Y2VkLCBhbmQgdGhlIGhvc3QgdHJpcGxlIHdoaWNoIGlzIHRoZSBhcmNoaXRlY3R1cmUgdGhhdCB0aGUgY29tcGlsZXIgaXMgcnVubmluZyBvbi5cbiAqIFRoZSBnZW5lcmFsIGZvcm1hdCBvZiB0aGUgdHJpcGxlIGlzIGA8YXJjaD48c3ViPi08dmVuZG9yPi08c3lzPi08YWJpPmAgd2hlcmU6XG4gKiAgIC0gYGFyY2hgID0gVGhlIGJhc2UgQ1BVIGFyY2hpdGVjdHVyZSwgZm9yIGV4YW1wbGUgYHg4Nl82NGAsIGBpNjg2YCwgYGFybWAsIGB0aHVtYmAsIGBtaXBzYCwgZXRjLlxuICogICAtIGBzdWJgID0gVGhlIENQVSBzdWItYXJjaGl0ZWN0dXJlLCBmb3IgZXhhbXBsZSBgYXJtYCBoYXMgYHY3YCwgYHY3c2AsIGB2NXRlYCwgZXRjLlxuICogICAtIGB2ZW5kb3JgID0gVGhlIHZlbmRvciwgZm9yIGV4YW1wbGUgYHVua25vd25gLCBgYXBwbGVgLCBgcGNgLCBgbnZpZGlhYCwgZXRjLlxuICogICAtIGBzeXNgID0gVGhlIHN5c3RlbSBuYW1lLCBmb3IgZXhhbXBsZSBgbGludXhgLCBgd2luZG93c2AsIGBkYXJ3aW5gLCBldGMuIG5vbmUgaXMgdHlwaWNhbGx5IHVzZWQgZm9yIGJhcmUtbWV0YWwgd2l0aG91dCBhbiBPUy5cbiAqICAgLSBgYWJpYCA9IFRoZSBBQkksIGZvciBleGFtcGxlIGBnbnVgLCBgYW5kcm9pZGAsIGBlYWJpYCwgZXRjLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VUcmlwbGUocmF3VHJpcGxlOiBzdHJpbmcpOiBUYXJnZXQge1xuICBpZiAoXG4gICAgcmF3VHJpcGxlID09PSAnd2FzbTMyLXdhc2knIHx8XG4gICAgcmF3VHJpcGxlID09PSAnd2FzbTMyLXdhc2ktcHJldmlldzEtdGhyZWFkcycgfHxcbiAgICByYXdUcmlwbGUuc3RhcnRzV2l0aCgnd2FzbTMyLXdhc2lwJylcbiAgKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRyaXBsZTogcmF3VHJpcGxlLFxuICAgICAgcGxhdGZvcm1BcmNoQUJJOiAnd2FzbTMyLXdhc2knLFxuICAgICAgcGxhdGZvcm06ICd3YXNpJyxcbiAgICAgIGFyY2g6ICd3YXNtMzInLFxuICAgICAgYWJpOiAnd2FzaScsXG4gICAgfVxuICB9XG4gIGNvbnN0IHRyaXBsZSA9IHJhd1RyaXBsZS5lbmRzV2l0aCgnZWFiaScpXG4gICAgPyBgJHtyYXdUcmlwbGUuc2xpY2UoMCwgLTQpfS1lYWJpYFxuICAgIDogcmF3VHJpcGxlXG4gIGNvbnN0IHRyaXBsZXMgPSB0cmlwbGUuc3BsaXQoJy0nKVxuICBsZXQgY3B1OiBzdHJpbmdcbiAgbGV0IHN5czogc3RyaW5nXG4gIGxldCBhYmk6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gIGlmICh0cmlwbGVzLmxlbmd0aCA9PT0gMikge1xuICAgIC8vIGFhcmNoNjQtZnVjaHNpYVxuICAgIC8vIF4gY3B1ICAgXiBzeXNcbiAgICA7W2NwdSwgc3lzXSA9IHRyaXBsZXNcbiAgfSBlbHNlIHtcbiAgICAvLyBhYXJjaDY0LXVua25vd24tbGludXgtbXVzbFxuICAgIC8vIF4gY3B1ICAgXnZlbmRvciBeIHN5cyBeIGFiaVxuICAgIC8vIGFhcmNoNjQtYXBwbGUtZGFyd2luXG4gICAgLy8gXiBjcHUgICAgICAgICBeIHN5cyAgKGFiaSBpcyBOb25lKVxuICAgIDtbY3B1LCAsIHN5cywgYWJpID0gbnVsbF0gPSB0cmlwbGVzXG4gIH1cblxuICBpZiAoYWJpICYmIFNVQl9TWVNURU1TLmhhcyhhYmkpKSB7XG4gICAgc3lzID0gYWJpXG4gICAgYWJpID0gbnVsbFxuICB9XG4gIGNvbnN0IHBsYXRmb3JtID0gU3lzVG9Ob2RlUGxhdGZvcm1bc3lzXSA/PyAoc3lzIGFzIFBsYXRmb3JtKVxuICBjb25zdCBhcmNoID0gQ3B1VG9Ob2RlQXJjaFtjcHVdID8/IChjcHUgYXMgTm9kZUpTQXJjaClcblxuICByZXR1cm4ge1xuICAgIHRyaXBsZTogcmF3VHJpcGxlLFxuICAgIHBsYXRmb3JtQXJjaEFCSTogYWJpID8gYCR7cGxhdGZvcm19LSR7YXJjaH0tJHthYml9YCA6IGAke3BsYXRmb3JtfS0ke2FyY2h9YCxcbiAgICBwbGF0Zm9ybSxcbiAgICBhcmNoLFxuICAgIGFiaSxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0U3lzdGVtRGVmYXVsdFRhcmdldCgpOiBUYXJnZXQge1xuICBjb25zdCBob3N0ID0gZXhlY1N5bmMoYHJ1c3RjIC12VmAsIHtcbiAgICBlbnY6IHByb2Nlc3MuZW52LFxuICB9KVxuICAgIC50b1N0cmluZygndXRmOCcpXG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5maW5kKChsaW5lKSA9PiBsaW5lLnN0YXJ0c1dpdGgoJ2hvc3Q6ICcpKVxuICBjb25zdCB0cmlwbGUgPSBob3N0Py5zbGljZSgnaG9zdDogJy5sZW5ndGgpXG4gIGlmICghdHJpcGxlKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgQ2FuIG5vdCBwYXJzZSB0YXJnZXQgdHJpcGxlIGZyb20gaG9zdGApXG4gIH1cbiAgcmV0dXJuIHBhcnNlVHJpcGxlKHRyaXBsZSlcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFRhcmdldExpbmtlcih0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBUQVJHRVRfTElOS0VSW3RhcmdldF1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRhcmdldFRvRW52VmFyKHRhcmdldDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRhcmdldC5yZXBsYWNlKC8tL2csICdfJykudG9VcHBlckNhc2UoKVxufVxuIiwiZXhwb3J0IGVudW0gTmFwaVZlcnNpb24ge1xuICBOYXBpMSA9IDEsXG4gIE5hcGkyLFxuICBOYXBpMyxcbiAgTmFwaTQsXG4gIE5hcGk1LFxuICBOYXBpNixcbiAgTmFwaTcsXG4gIE5hcGk4LFxuICBOYXBpOSxcbn1cblxuLy8vIGJlY2F1c2Ugbm9kZSBzdXBwb3J0IG5ldyBuYXBpIHZlcnNpb24gaW4gc29tZSBtaW5vciB2ZXJzaW9uIHVwZGF0ZXMsIHNvIHdlIG1pZ2h0IG1lZXQgc3VjaCBzaXR1YXRpb246XG4vLy8gYG5vZGUgdjEwLjIwLjBgIHN1cHBvcnRzIGBuYXBpNWAgYW5kIGBuYXBpNmAsIGJ1dCBgbm9kZSB2MTIuMC4wYCBvbmx5IHN1cHBvcnQgYG5hcGk0YCxcbi8vLyBieSB3aGljaCwgd2UgY2FuIG5vdCB0ZWxsIGRpcmVjdGx5IG5hcGkgdmVyc2lvbiBzdXBwb3J0bGVzcyBmcm9tIG5vZGUgdmVyc2lvbiBkaXJlY3RseS5cbmNvbnN0IE5BUElfVkVSU0lPTl9NQVRSSVggPSBuZXcgTWFwPE5hcGlWZXJzaW9uLCBzdHJpbmc+KFtcbiAgW05hcGlWZXJzaW9uLk5hcGkxLCAnOC42LjAgfCA5LjAuMCB8IDEwLjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTIsICc4LjEwLjAgfCA5LjMuMCB8IDEwLjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTMsICc2LjE0LjIgfCA4LjExLjIgfCA5LjExLjAgfCAxMC4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk0LCAnMTAuMTYuMCB8IDExLjguMCB8IDEyLjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTUsICcxMC4xNy4wIHwgMTIuMTEuMCB8IDEzLjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTYsICcxMC4yMC4wIHwgMTIuMTcuMCB8IDE0LjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTcsICcxMC4yMy4wIHwgMTIuMTkuMCB8IDE0LjEyLjAgfCAxNS4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk4LCAnMTIuMjIuMCB8IDE0LjE3LjAgfCAxNS4xMi4wIHwgMTYuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpOSwgJzE4LjE3LjAgfCAyMC4zLjAgfCAyMS4xLjAnXSxcbl0pXG5cbmludGVyZmFjZSBOb2RlVmVyc2lvbiB7XG4gIG1ham9yOiBudW1iZXJcbiAgbWlub3I6IG51bWJlclxuICBwYXRjaDogbnVtYmVyXG59XG5cbmZ1bmN0aW9uIHBhcnNlTm9kZVZlcnNpb24odjogc3RyaW5nKTogTm9kZVZlcnNpb24ge1xuICBjb25zdCBtYXRjaGVzID0gdi5tYXRjaCgvdj8oWzAtOV0rKVxcLihbMC05XSspXFwuKFswLTldKykvaSlcblxuICBpZiAoIW1hdGNoZXMpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gbm9kZSB2ZXJzaW9uIG51bWJlcjogJyArIHYpXG4gIH1cblxuICBjb25zdCBbLCBtYWpvciwgbWlub3IsIHBhdGNoXSA9IG1hdGNoZXNcblxuICByZXR1cm4ge1xuICAgIG1ham9yOiBwYXJzZUludChtYWpvciksXG4gICAgbWlub3I6IHBhcnNlSW50KG1pbm9yKSxcbiAgICBwYXRjaDogcGFyc2VJbnQocGF0Y2gpLFxuICB9XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVkTm9kZVZlcnNpb25zKG5hcGlWZXJzaW9uOiBOYXBpVmVyc2lvbik6IE5vZGVWZXJzaW9uW10ge1xuICBjb25zdCByZXF1aXJlbWVudCA9IE5BUElfVkVSU0lPTl9NQVRSSVguZ2V0KG5hcGlWZXJzaW9uKVxuXG4gIGlmICghcmVxdWlyZW1lbnQpIHtcbiAgICByZXR1cm4gW3BhcnNlTm9kZVZlcnNpb24oJzEwLjAuMCcpXVxuICB9XG5cbiAgcmV0dXJuIHJlcXVpcmVtZW50LnNwbGl0KCd8JykubWFwKHBhcnNlTm9kZVZlcnNpb24pXG59XG5cbmZ1bmN0aW9uIHRvRW5naW5lUmVxdWlyZW1lbnQodmVyc2lvbnM6IE5vZGVWZXJzaW9uW10pOiBzdHJpbmcge1xuICBjb25zdCByZXF1aXJlbWVudHM6IHN0cmluZ1tdID0gW11cbiAgdmVyc2lvbnMuZm9yRWFjaCgodiwgaSkgPT4ge1xuICAgIGxldCByZXEgPSAnJ1xuICAgIGlmIChpICE9PSAwKSB7XG4gICAgICBjb25zdCBsYXN0VmVyc2lvbiA9IHZlcnNpb25zW2kgLSAxXVxuICAgICAgcmVxICs9IGA8ICR7bGFzdFZlcnNpb24ubWFqb3IgKyAxfWBcbiAgICB9XG5cbiAgICByZXEgKz0gYCR7aSA9PT0gMCA/ICcnIDogJyB8fCAnfT49ICR7di5tYWpvcn0uJHt2Lm1pbm9yfS4ke3YucGF0Y2h9YFxuICAgIHJlcXVpcmVtZW50cy5wdXNoKHJlcSlcbiAgfSlcblxuICByZXR1cm4gcmVxdWlyZW1lbnRzLmpvaW4oJyAnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gbmFwaUVuZ2luZVJlcXVpcmVtZW50KG5hcGlWZXJzaW9uOiBOYXBpVmVyc2lvbik6IHN0cmluZyB7XG4gIHJldHVybiB0b0VuZ2luZVJlcXVpcmVtZW50KHJlcXVpcmVkTm9kZVZlcnNpb25zKG5hcGlWZXJzaW9uKSlcbn1cbiIsImltcG9ydCB7IHNwYXduIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMnXG5cbmV4cG9ydCB0eXBlIENyYXRlVGFyZ2V0S2luZCA9XG4gIHwgJ2JpbidcbiAgfCAnZXhhbXBsZSdcbiAgfCAndGVzdCdcbiAgfCAnYmVuY2gnXG4gIHwgJ2xpYidcbiAgfCAncmxpYidcbiAgfCAnY2R5bGliJ1xuICB8ICdjdXN0b20tYnVpbGQnXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ3JhdGVUYXJnZXQge1xuICBuYW1lOiBzdHJpbmdcbiAga2luZDogQ3JhdGVUYXJnZXRLaW5kW11cbiAgY3JhdGVfdHlwZXM6IENyYXRlVGFyZ2V0S2luZFtdXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ3JhdGUge1xuICBpZDogc3RyaW5nXG4gIG5hbWU6IHN0cmluZ1xuICBzcmNfcGF0aDogc3RyaW5nXG4gIHZlcnNpb246IHN0cmluZ1xuICBlZGl0aW9uOiBzdHJpbmdcbiAgdGFyZ2V0czogQ3JhdGVUYXJnZXRbXVxuICBmZWF0dXJlczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+XG4gIG1hbmlmZXN0X3BhdGg6IHN0cmluZ1xuICBkZXBlbmRlbmNpZXM6IEFycmF5PHtcbiAgICBuYW1lOiBzdHJpbmdcbiAgICBzb3VyY2U6IHN0cmluZ1xuICAgIHJlcTogc3RyaW5nXG4gICAga2luZDogc3RyaW5nIHwgbnVsbFxuICAgIHJlbmFtZTogc3RyaW5nIHwgbnVsbFxuICAgIG9wdGlvbmFsOiBib29sZWFuXG4gICAgdXNlc19kZWZhdWx0X2ZlYXR1cmVzOiBib29sZWFuXG4gICAgZmVhdHVyZXM6IHN0cmluZ1tdXG4gICAgdGFyZ2V0OiBzdHJpbmcgfCBudWxsXG4gICAgcmVnaXN0cnk6IHN0cmluZyB8IG51bGxcbiAgfT5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDYXJnb1dvcmtzcGFjZU1ldGFkYXRhIHtcbiAgdmVyc2lvbjogbnVtYmVyXG4gIHBhY2thZ2VzOiBDcmF0ZVtdXG4gIHdvcmtzcGFjZV9tZW1iZXJzOiBzdHJpbmdbXVxuICB0YXJnZXRfZGlyZWN0b3J5OiBzdHJpbmdcbiAgd29ya3NwYWNlX3Jvb3Q6IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGFyc2VNZXRhZGF0YShtYW5pZmVzdFBhdGg6IHN0cmluZykge1xuICBpZiAoIWZzLmV4aXN0c1N5bmMobWFuaWZlc3RQYXRoKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgTm8gY3JhdGUgZm91bmQgaW4gbWFuaWZlc3Q6ICR7bWFuaWZlc3RQYXRofWApXG4gIH1cblxuICBjb25zdCBjaGlsZFByb2Nlc3MgPSBzcGF3bihcbiAgICAnY2FyZ28nLFxuICAgIFsnbWV0YWRhdGEnLCAnLS1tYW5pZmVzdC1wYXRoJywgbWFuaWZlc3RQYXRoLCAnLS1mb3JtYXQtdmVyc2lvbicsICcxJ10sXG4gICAgeyBzdGRpbzogJ3BpcGUnIH0sXG4gIClcblxuICBsZXQgc3Rkb3V0ID0gJydcbiAgbGV0IHN0ZGVyciA9ICcnXG4gIGxldCBzdGF0dXMgPSAwXG4gIGxldCBlcnJvciA9IG51bGxcblxuICBjaGlsZFByb2Nlc3Muc3Rkb3V0Lm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICBzdGRvdXQgKz0gZGF0YVxuICB9KVxuXG4gIGNoaWxkUHJvY2Vzcy5zdGRlcnIub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgIHN0ZGVyciArPSBkYXRhXG4gIH0pXG5cbiAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICBjaGlsZFByb2Nlc3Mub24oJ2Nsb3NlJywgKGNvZGUpID0+IHtcbiAgICAgIHN0YXR1cyA9IGNvZGUgPz8gMFxuICAgICAgcmVzb2x2ZSgpXG4gICAgfSlcbiAgfSlcblxuICBpZiAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhcmdvIG1ldGFkYXRhIGZhaWxlZCB0byBydW4nLCB7IGNhdXNlOiBlcnJvciB9KVxuICB9XG4gIGlmIChzdGF0dXMgIT09IDApIHtcbiAgICBjb25zdCBzaW1wbGVNZXNzYWdlID0gYGNhcmdvIG1ldGFkYXRhIGV4aXRlZCB3aXRoIGNvZGUgJHtzdGF0dXN9YFxuICAgIHRocm93IG5ldyBFcnJvcihgJHtzaW1wbGVNZXNzYWdlfSBhbmQgZXJyb3IgbWVzc2FnZTpcXG5cXG4ke3N0ZGVycn1gLCB7XG4gICAgICBjYXVzZTogbmV3IEVycm9yKHNpbXBsZU1lc3NhZ2UpLFxuICAgIH0pXG4gIH1cblxuICB0cnkge1xuICAgIHJldHVybiBKU09OLnBhcnNlKHN0ZG91dCkgYXMgQ2FyZ29Xb3Jrc3BhY2VNZXRhZGF0YVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gcGFyc2UgY2FyZ28gbWV0YWRhdGEgSlNPTicsIHsgY2F1c2U6IGUgfSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgdW5kZXJsaW5lLCB5ZWxsb3cgfSBmcm9tICdjb2xvcmV0dGUnXG5pbXBvcnQgeyBtZXJnZSwgb21pdCB9IGZyb20gJ2VzLXRvb2xraXQnXG5cbmltcG9ydCB7IGZpbGVFeGlzdHMsIHJlYWRGaWxlQXN5bmMgfSBmcm9tICcuL21pc2MuanMnXG5pbXBvcnQgeyBERUZBVUxUX1RBUkdFVFMsIHBhcnNlVHJpcGxlLCB0eXBlIFRhcmdldCB9IGZyb20gJy4vdGFyZ2V0LmpzJ1xuXG5leHBvcnQgdHlwZSBWYWx1ZU9mQ29uc3RBcnJheTxUPiA9IFRbRXhjbHVkZTxrZXlvZiBULCBrZXlvZiBBcnJheTxhbnk+Pl1cblxuZXhwb3J0IGNvbnN0IFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VycyA9IFsneWFybicsICdwbnBtJ10gYXMgY29uc3RcbmV4cG9ydCBjb25zdCBTdXBwb3J0ZWRUZXN0RnJhbWV3b3JrcyA9IFsnYXZhJ10gYXMgY29uc3RcblxuZXhwb3J0IHR5cGUgU3VwcG9ydGVkUGFja2FnZU1hbmFnZXIgPSBWYWx1ZU9mQ29uc3RBcnJheTxcbiAgdHlwZW9mIFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2Vyc1xuPlxuZXhwb3J0IHR5cGUgU3VwcG9ydGVkVGVzdEZyYW1ld29yayA9IFZhbHVlT2ZDb25zdEFycmF5PFxuICB0eXBlb2YgU3VwcG9ydGVkVGVzdEZyYW1ld29ya3Ncbj5cblxuZXhwb3J0IGludGVyZmFjZSBVc2VyTmFwaUNvbmZpZyB7XG4gIC8qKlxuICAgKiBOYW1lIG9mIHRoZSBiaW5hcnkgdG8gYmUgZ2VuZXJhdGVkLCBkZWZhdWx0IHRvIGBpbmRleGBcbiAgICovXG4gIGJpbmFyeU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIE5hbWUgb2YgdGhlIG5wbSBwYWNrYWdlLCBkZWZhdWx0IHRvIHRoZSBuYW1lIG9mIHJvb3QgcGFja2FnZS5qc29uIG5hbWVcbiAgICpcbiAgICogQWx3YXlzIGdpdmVuIGBAc2NvcGUvcGtnYCBhbmQgYXJjaCBzdWZmaXggd2lsbCBiZSBhcHBlbmRlZCBsaWtlIGBAc2NvcGUvcGtnLWxpbnV4LWdudS14NjRgXG4gICAqL1xuICBwYWNrYWdlTmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogQWxsIHRhcmdldHMgdGhlIGNyYXRlIHdpbGwgYmUgY29tcGlsZWQgZm9yXG4gICAqL1xuICB0YXJnZXRzPzogc3RyaW5nW11cblxuICAvKipcbiAgICogVGhlIG5wbSBjbGllbnQgcHJvamVjdCB1c2VzLlxuICAgKi9cbiAgbnBtQ2xpZW50Pzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgZ2VuZXJhdGUgY29uc3QgZW51bSBmb3IgdHlwZXNjcmlwdCBiaW5kaW5nc1xuICAgKi9cbiAgY29uc3RFbnVtPzogYm9vbGVhblxuXG4gIC8qKlxuICAgKiBkdHMgaGVhZGVyIHByZXBlbmQgdG8gdGhlIGdlbmVyYXRlZCBkdHMgZmlsZVxuICAgKi9cbiAgZHRzSGVhZGVyPzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIGR0cyBoZWFkZXIgZmlsZSBwYXRoIHRvIGJlIHByZXBlbmRlZCB0byB0aGUgZ2VuZXJhdGVkIGR0cyBmaWxlXG4gICAqIGlmIGJvdGggZHRzSGVhZGVyIGFuZCBkdHNIZWFkZXJGaWxlIGFyZSBwcm92aWRlZCwgZHRzSGVhZGVyRmlsZSB3aWxsIGJlIHVzZWRcbiAgICovXG4gIGR0c0hlYWRlckZpbGU/OiBzdHJpbmdcblxuICAvKipcbiAgICogd2FzbSBjb21waWxhdGlvbiBvcHRpb25zXG4gICAqL1xuICB3YXNtPzoge1xuICAgIC8qKlxuICAgICAqIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViQXNzZW1ibHkvSmF2YVNjcmlwdF9pbnRlcmZhY2UvTWVtb3J5XG4gICAgICogQGRlZmF1bHQgNDAwMCBwYWdlcyAoMjU2TWlCKVxuICAgICAqL1xuICAgIGluaXRpYWxNZW1vcnk/OiBudW1iZXJcbiAgICAvKipcbiAgICAgKiBAZGVmYXVsdCA2NTUzNiBwYWdlcyAoNEdpQilcbiAgICAgKi9cbiAgICBtYXhpbXVtTWVtb3J5PzogbnVtYmVyXG5cbiAgICAvKipcbiAgICAgKiBCcm93c2VyIHdhc20gYmluZGluZyBjb25maWd1cmF0aW9uXG4gICAgICovXG4gICAgYnJvd3Nlcjoge1xuICAgICAgLyoqXG4gICAgICAgKiBXaGV0aGVyIHRvIHVzZSBmcyBtb2R1bGUgaW4gYnJvd3NlclxuICAgICAgICovXG4gICAgICBmcz86IGJvb2xlYW5cbiAgICAgIC8qKlxuICAgICAgICogV2hldGhlciB0byBpbml0aWFsaXplIHdhc20gYXN5bmNocm9ub3VzbHlcbiAgICAgICAqL1xuICAgICAgYXN5bmNJbml0PzogYm9vbGVhblxuICAgICAgLyoqXG4gICAgICAgKiBXaGV0aGVyIHRvIGluamVjdCBgYnVmZmVyYCB0byBlbW5hcGkgY29udGV4dFxuICAgICAgICovXG4gICAgICBidWZmZXI/OiBib29sZWFuXG4gICAgICAvKipcbiAgICAgICAqIFdoZXRoZXIgdG8gZW1pdCBjdXN0b20gZXZlbnRzIGZvciBlcnJvcnMgaW4gd29ya2VyXG4gICAgICAgKi9cbiAgICAgIGVycm9yRXZlbnQ/OiBib29sZWFuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIGJpbmFyeU5hbWUgaW5zdGVhZFxuICAgKi9cbiAgbmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHBhY2thZ2VOYW1lIGluc3RlYWRcbiAgICovXG4gIHBhY2thZ2U/OiB7XG4gICAgbmFtZT86IHN0cmluZ1xuICB9XG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgdGFyZ2V0cyBpbnN0ZWFkXG4gICAqL1xuICB0cmlwbGVzPzoge1xuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgZW5hYmxlIGRlZmF1bHQgdGFyZ2V0c1xuICAgICAqL1xuICAgIGRlZmF1bHRzOiBib29sZWFuXG4gICAgLyoqXG4gICAgICogQWRkaXRpb25hbCB0YXJnZXRzIHRvIGJlIGNvbXBpbGVkIGZvclxuICAgICAqL1xuICAgIGFkZGl0aW9uYWw/OiBzdHJpbmdbXVxuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29tbW9uUGFja2FnZUpzb25GaWVsZHMge1xuICBuYW1lOiBzdHJpbmdcbiAgdmVyc2lvbjogc3RyaW5nXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nXG4gIGtleXdvcmRzPzogc3RyaW5nW11cbiAgYXV0aG9yPzogc3RyaW5nXG4gIGF1dGhvcnM/OiBzdHJpbmdbXVxuICBsaWNlbnNlPzogc3RyaW5nXG4gIGNwdT86IHN0cmluZ1tdXG4gIG9zPzogc3RyaW5nW11cbiAgbGliYz86IHN0cmluZ1tdXG4gIGZpbGVzPzogc3RyaW5nW11cbiAgcmVwb3NpdG9yeT86IGFueVxuICBob21lcGFnZT86IGFueVxuICBlbmdpbmVzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICBwdWJsaXNoQ29uZmlnPzogYW55XG4gIGJ1Z3M/OiBhbnlcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVzZS1iZWZvcmUtZGVmaW5lXG4gIG5hcGk/OiBVc2VyTmFwaUNvbmZpZ1xuICB0eXBlPzogJ21vZHVsZScgfCAnY29tbW9uanMnXG4gIHNjcmlwdHM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG5cbiAgLy8gbW9kdWxlc1xuICBtYWluPzogc3RyaW5nXG4gIG1vZHVsZT86IHN0cmluZ1xuICB0eXBlcz86IHN0cmluZ1xuICBicm93c2VyPzogc3RyaW5nXG4gIGV4cG9ydHM/OiBhbnlcblxuICBkZXBlbmRlbmNpZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIGRldkRlcGVuZGVuY2llcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cblxuICBhdmE/OiB7XG4gICAgdGltZW91dD86IHN0cmluZ1xuICB9XG59XG5cbmV4cG9ydCB0eXBlIE5hcGlDb25maWcgPSBSZXF1aXJlZDxcbiAgUGljazxVc2VyTmFwaUNvbmZpZywgJ2JpbmFyeU5hbWUnIHwgJ3BhY2thZ2VOYW1lJyB8ICducG1DbGllbnQnPlxuPiAmXG4gIFBpY2s8VXNlck5hcGlDb25maWcsICd3YXNtJyB8ICdkdHNIZWFkZXInIHwgJ2R0c0hlYWRlckZpbGUnIHwgJ2NvbnN0RW51bSc+ICYge1xuICAgIHRhcmdldHM6IFRhcmdldFtdXG4gICAgcGFja2FnZUpzb246IENvbW1vblBhY2thZ2VKc29uRmllbGRzXG4gIH1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlYWROYXBpQ29uZmlnKFxuICBwYXRoOiBzdHJpbmcsXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcsXG4pOiBQcm9taXNlPE5hcGlDb25maWc+IHtcbiAgaWYgKGNvbmZpZ1BhdGggJiYgIShhd2FpdCBmaWxlRXhpc3RzKGNvbmZpZ1BhdGgpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgTkFQSS1SUyBjb25maWcgbm90IGZvdW5kIGF0ICR7Y29uZmlnUGF0aH1gKVxuICB9XG4gIGlmICghKGF3YWl0IGZpbGVFeGlzdHMocGF0aCkpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBwYWNrYWdlLmpzb24gbm90IGZvdW5kIGF0ICR7cGF0aH1gKVxuICB9XG4gIC8vIE1heSBzdXBwb3J0IG11bHRpcGxlIGNvbmZpZyBzb3VyY2VzIGxhdGVyIG9uLlxuICBjb25zdCBjb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhwYXRoLCAndXRmOCcpXG4gIGxldCBwa2dKc29uXG4gIHRyeSB7XG4gICAgcGtnSnNvbiA9IEpTT04ucGFyc2UoY29udGVudCkgYXMgQ29tbW9uUGFja2FnZUpzb25GaWVsZHNcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIHBhY2thZ2UuanNvbiBhdCAke3BhdGh9YCwge1xuICAgICAgY2F1c2U6IGUsXG4gICAgfSlcbiAgfVxuXG4gIGxldCBzZXBhcmF0ZWRDb25maWc6IFVzZXJOYXBpQ29uZmlnIHwgdW5kZWZpbmVkXG4gIGlmIChjb25maWdQYXRoKSB7XG4gICAgY29uc3QgY29uZmlnQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoY29uZmlnUGF0aCwgJ3V0ZjgnKVxuICAgIHRyeSB7XG4gICAgICBzZXBhcmF0ZWRDb25maWcgPSBKU09OLnBhcnNlKGNvbmZpZ0NvbnRlbnQpIGFzIFVzZXJOYXBpQ29uZmlnXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gcGFyc2UgTkFQSS1SUyBjb25maWcgYXQgJHtjb25maWdQYXRofWAsIHtcbiAgICAgICAgY2F1c2U6IGUsXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHVzZXJOYXBpQ29uZmlnID0gcGtnSnNvbi5uYXBpID8/IHt9XG4gIGlmIChwa2dKc29uLm5hcGkgJiYgc2VwYXJhdGVkQ29uZmlnKSB7XG4gICAgY29uc3QgcGtnSnNvblBhdGggPSB1bmRlcmxpbmUocGF0aClcbiAgICBjb25zdCBjb25maWdQYXRoVW5kZXJsaW5lID0gdW5kZXJsaW5lKGNvbmZpZ1BhdGghKVxuICAgIGNvbnNvbGUud2FybihcbiAgICAgIHllbGxvdyhcbiAgICAgICAgYEJvdGggbmFwaSBmaWVsZCBpbiAke3BrZ0pzb25QYXRofSBhbmQgW05BUEktUlMgY29uZmlnXSgke2NvbmZpZ1BhdGhVbmRlcmxpbmV9KSBmaWxlIGFyZSBmb3VuZCwgdGhlIE5BUEktUlMgY29uZmlnIGZpbGUgd2lsbCBiZSB1c2VkLmAsXG4gICAgICApLFxuICAgIClcbiAgfVxuICBpZiAoc2VwYXJhdGVkQ29uZmlnKSB7XG4gICAgT2JqZWN0LmFzc2lnbih1c2VyTmFwaUNvbmZpZywgc2VwYXJhdGVkQ29uZmlnKVxuICB9XG4gIGNvbnN0IG5hcGlDb25maWc6IE5hcGlDb25maWcgPSBtZXJnZShcbiAgICB7XG4gICAgICBiaW5hcnlOYW1lOiAnaW5kZXgnLFxuICAgICAgcGFja2FnZU5hbWU6IHBrZ0pzb24ubmFtZSxcbiAgICAgIHRhcmdldHM6IFtdLFxuICAgICAgcGFja2FnZUpzb246IHBrZ0pzb24sXG4gICAgICBucG1DbGllbnQ6ICducG0nLFxuICAgIH0sXG4gICAgb21pdCh1c2VyTmFwaUNvbmZpZywgWyd0YXJnZXRzJ10pLFxuICApXG5cbiAgbGV0IHRhcmdldHM6IHN0cmluZ1tdID0gdXNlck5hcGlDb25maWcudGFyZ2V0cyA/PyBbXVxuXG4gIC8vIGNvbXBhdGlibGUgd2l0aCBvbGQgY29uZmlnXG4gIGlmICh1c2VyTmFwaUNvbmZpZz8ubmFtZSkge1xuICAgIGNvbnNvbGUud2FybihcbiAgICAgIHllbGxvdyhcbiAgICAgICAgYFtERVBSRUNBVEVEXSBuYXBpLm5hbWUgaXMgZGVwcmVjYXRlZCwgdXNlIG5hcGkuYmluYXJ5TmFtZSBpbnN0ZWFkLmAsXG4gICAgICApLFxuICAgIClcbiAgICBuYXBpQ29uZmlnLmJpbmFyeU5hbWUgPSB1c2VyTmFwaUNvbmZpZy5uYW1lXG4gIH1cblxuICBpZiAoIXRhcmdldHMubGVuZ3RoKSB7XG4gICAgbGV0IGRlcHJlY2F0ZWRXYXJuZWQgPSBmYWxzZVxuICAgIGNvbnN0IHdhcm5pbmcgPSB5ZWxsb3coXG4gICAgICBgW0RFUFJFQ0FURURdIG5hcGkudHJpcGxlcyBpcyBkZXByZWNhdGVkLCB1c2UgbmFwaS50YXJnZXRzIGluc3RlYWQuYCxcbiAgICApXG4gICAgaWYgKHVzZXJOYXBpQ29uZmlnLnRyaXBsZXM/LmRlZmF1bHRzKSB7XG4gICAgICBkZXByZWNhdGVkV2FybmVkID0gdHJ1ZVxuICAgICAgY29uc29sZS53YXJuKHdhcm5pbmcpXG4gICAgICB0YXJnZXRzID0gdGFyZ2V0cy5jb25jYXQoREVGQVVMVF9UQVJHRVRTKVxuICAgIH1cblxuICAgIGlmICh1c2VyTmFwaUNvbmZpZy50cmlwbGVzPy5hZGRpdGlvbmFsPy5sZW5ndGgpIHtcbiAgICAgIHRhcmdldHMgPSB0YXJnZXRzLmNvbmNhdCh1c2VyTmFwaUNvbmZpZy50cmlwbGVzLmFkZGl0aW9uYWwpXG4gICAgICBpZiAoIWRlcHJlY2F0ZWRXYXJuZWQpIHtcbiAgICAgICAgY29uc29sZS53YXJuKHdhcm5pbmcpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gZmluZCBkdXBsaWNhdGUgdGFyZ2V0c1xuICBjb25zdCB1bmlxdWVUYXJnZXRzID0gbmV3IFNldCh0YXJnZXRzKVxuICBpZiAodW5pcXVlVGFyZ2V0cy5zaXplICE9PSB0YXJnZXRzLmxlbmd0aCkge1xuICAgIGNvbnN0IGR1cGxpY2F0ZVRhcmdldCA9IHRhcmdldHMuZmluZChcbiAgICAgICh0YXJnZXQsIGluZGV4KSA9PiB0YXJnZXRzLmluZGV4T2YodGFyZ2V0KSAhPT0gaW5kZXgsXG4gICAgKVxuICAgIHRocm93IG5ldyBFcnJvcihgRHVwbGljYXRlIHRhcmdldHMgYXJlIG5vdCBhbGxvd2VkOiAke2R1cGxpY2F0ZVRhcmdldH1gKVxuICB9XG5cbiAgbmFwaUNvbmZpZy50YXJnZXRzID0gdGFyZ2V0cy5tYXAocGFyc2VUcmlwbGUpXG5cbiAgcmV0dXJuIG5hcGlDb25maWdcbn1cbiIsImltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuXG5pbXBvcnQgeyBkZWJ1ZyB9IGZyb20gJy4vbG9nLmpzJ1xuXG5leHBvcnQgZnVuY3Rpb24gdHJ5SW5zdGFsbENhcmdvQmluYXJ5KG5hbWU6IHN0cmluZywgYmluOiBzdHJpbmcpIHtcbiAgaWYgKGRldGVjdENhcmdvQmluYXJ5KGJpbikpIHtcbiAgICBkZWJ1ZygnQ2FyZ28gYmluYXJ5IGFscmVhZHkgaW5zdGFsbGVkOiAlcycsIG5hbWUpXG4gICAgcmV0dXJuXG4gIH1cblxuICB0cnkge1xuICAgIGRlYnVnKCdJbnN0YWxsaW5nIGNhcmdvIGJpbmFyeTogJXMnLCBuYW1lKVxuICAgIGV4ZWNTeW5jKGBjYXJnbyBpbnN0YWxsICR7bmFtZX1gLCB7XG4gICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgIH0pXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBpbnN0YWxsIGNhcmdvIGJpbmFyeTogJHtuYW1lfWAsIHtcbiAgICAgIGNhdXNlOiBlLFxuICAgIH0pXG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0Q2FyZ29CaW5hcnkoYmluOiBzdHJpbmcpIHtcbiAgZGVidWcoJ0RldGVjdGluZyBjYXJnbyBiaW5hcnk6ICVzJywgYmluKVxuICB0cnkge1xuICAgIGV4ZWNTeW5jKGBjYXJnbyBoZWxwICR7YmlufWAsIHtcbiAgICAgIHN0ZGlvOiAnaWdub3JlJyxcbiAgICB9KVxuICAgIGRlYnVnKCdDYXJnbyBiaW5hcnkgZGV0ZWN0ZWQ6ICVzJywgYmluKVxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2gge1xuICAgIGRlYnVnKCdDYXJnbyBiaW5hcnkgbm90IGRldGVjdGVkOiAlcycsIGJpbilcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuIiwiaW1wb3J0IHsgc29ydEJ5IH0gZnJvbSAnZXMtdG9vbGtpdCdcblxuaW1wb3J0IHsgcmVhZEZpbGVBc3luYyB9IGZyb20gJy4vbWlzYy5qcydcblxuY29uc3QgVE9QX0xFVkVMX05BTUVTUEFDRSA9ICdfX1RPUF9MRVZFTF9NT0RVTEVfXydcbmV4cG9ydCBjb25zdCBERUZBVUxUX1RZUEVfREVGX0hFQURFUiA9IGAvKiBhdXRvLWdlbmVyYXRlZCBieSBOQVBJLVJTICovXG4vKiBlc2xpbnQtZGlzYWJsZSAqL1xuYFxuXG5lbnVtIFR5cGVEZWZLaW5kIHtcbiAgQ29uc3QgPSAnY29uc3QnLFxuICBFbnVtID0gJ2VudW0nLFxuICBTdHJpbmdFbnVtID0gJ3N0cmluZ19lbnVtJyxcbiAgSW50ZXJmYWNlID0gJ2ludGVyZmFjZScsXG4gIFR5cGUgPSAndHlwZScsXG4gIEZuID0gJ2ZuJyxcbiAgU3RydWN0ID0gJ3N0cnVjdCcsXG4gIEV4dGVuZHMgPSAnZXh0ZW5kcycsXG4gIEltcGwgPSAnaW1wbCcsXG59XG5cbmludGVyZmFjZSBUeXBlRGVmTGluZSB7XG4gIGtpbmQ6IFR5cGVEZWZLaW5kXG4gIG5hbWU6IHN0cmluZ1xuICBvcmlnaW5hbF9uYW1lPzogc3RyaW5nXG4gIGRlZjogc3RyaW5nXG4gIGV4dGVuZHM/OiBzdHJpbmdcbiAganNfZG9jPzogc3RyaW5nXG4gIGpzX21vZD86IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwcmV0dHlQcmludChcbiAgbGluZTogVHlwZURlZkxpbmUsXG4gIGNvbnN0RW51bTogYm9vbGVhbixcbiAgaWRlbnQ6IG51bWJlcixcbiAgYW1iaWVudCA9IGZhbHNlLFxuKTogc3RyaW5nIHtcbiAgbGV0IHMgPSBsaW5lLmpzX2RvYyA/PyAnJ1xuICBzd2l0Y2ggKGxpbmUua2luZCkge1xuICAgIGNhc2UgVHlwZURlZktpbmQuSW50ZXJmYWNlOlxuICAgICAgcyArPSBgZXhwb3J0IGludGVyZmFjZSAke2xpbmUubmFtZX0ge1xcbiR7bGluZS5kZWZ9XFxufWBcbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlIFR5cGVEZWZLaW5kLlR5cGU6XG4gICAgICBzICs9IGBleHBvcnQgdHlwZSAke2xpbmUubmFtZX0gPSBcXG4ke2xpbmUuZGVmfWBcbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlIFR5cGVEZWZLaW5kLkVudW06XG4gICAgICBjb25zdCBlbnVtTmFtZSA9IGNvbnN0RW51bSA/ICdjb25zdCBlbnVtJyA6ICdlbnVtJ1xuICAgICAgcyArPSBgJHtleHBvcnREZWNsYXJlKGFtYmllbnQpfSAke2VudW1OYW1lfSAke2xpbmUubmFtZX0ge1xcbiR7bGluZS5kZWZ9XFxufWBcbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlIFR5cGVEZWZLaW5kLlN0cmluZ0VudW06XG4gICAgICBpZiAoY29uc3RFbnVtKSB7XG4gICAgICAgIHMgKz0gYCR7ZXhwb3J0RGVjbGFyZShhbWJpZW50KX0gY29uc3QgZW51bSAke2xpbmUubmFtZX0ge1xcbiR7bGluZS5kZWZ9XFxufWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHMgKz0gYGV4cG9ydCB0eXBlICR7bGluZS5uYW1lfSA9ICR7bGluZS5kZWYucmVwbGFjZUFsbCgvLio9L2csICcnKS5yZXBsYWNlQWxsKCcsJywgJ3wnKX07YFxuICAgICAgfVxuICAgICAgYnJlYWtcblxuICAgIGNhc2UgVHlwZURlZktpbmQuU3RydWN0OlxuICAgICAgY29uc3QgZXh0ZW5kc0RlZiA9IGxpbmUuZXh0ZW5kcyA/IGAgZXh0ZW5kcyAke2xpbmUuZXh0ZW5kc31gIDogJydcbiAgICAgIGlmIChsaW5lLmV4dGVuZHMpIHtcbiAgICAgICAgLy8gRXh0cmFjdCBnZW5lcmljIHBhcmFtcyBmcm9tIGV4dGVuZHMgdHlwZSBsaWtlIEl0ZXJhdG9yPFQsIFRSZXN1bHQsIFROZXh0PlxuICAgICAgICBjb25zdCBnZW5lcmljTWF0Y2ggPSBsaW5lLmV4dGVuZHMubWF0Y2goL0l0ZXJhdG9yPCguKyk+JC8pXG4gICAgICAgIGlmIChnZW5lcmljTWF0Y2gpIHtcbiAgICAgICAgICBjb25zdCBbVCwgVFJlc3VsdCwgVE5leHRdID0gZ2VuZXJpY01hdGNoWzFdXG4gICAgICAgICAgICAuc3BsaXQoJywnKVxuICAgICAgICAgICAgLm1hcCgocCkgPT4gcC50cmltKCkpXG4gICAgICAgICAgbGluZS5kZWYgPVxuICAgICAgICAgICAgbGluZS5kZWYgK1xuICAgICAgICAgICAgYFxcbm5leHQodmFsdWU/OiAke1ROZXh0fSk6IEl0ZXJhdG9yUmVzdWx0PCR7VH0sICR7VFJlc3VsdH0+YFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBzICs9IGAke2V4cG9ydERlY2xhcmUoYW1iaWVudCl9IGNsYXNzICR7bGluZS5uYW1lfSR7ZXh0ZW5kc0RlZn0ge1xcbiR7bGluZS5kZWZ9XFxufWBcbiAgICAgIGlmIChsaW5lLm9yaWdpbmFsX25hbWUgJiYgbGluZS5vcmlnaW5hbF9uYW1lICE9PSBsaW5lLm5hbWUpIHtcbiAgICAgICAgcyArPSBgXFxuZXhwb3J0IHR5cGUgJHtsaW5lLm9yaWdpbmFsX25hbWV9ID0gJHtsaW5lLm5hbWV9YFxuICAgICAgfVxuICAgICAgYnJlYWtcblxuICAgIGNhc2UgVHlwZURlZktpbmQuRm46XG4gICAgICBzICs9IGAke2V4cG9ydERlY2xhcmUoYW1iaWVudCl9ICR7bGluZS5kZWZ9YFxuICAgICAgYnJlYWtcblxuICAgIGRlZmF1bHQ6XG4gICAgICBzICs9IGxpbmUuZGVmXG4gIH1cblxuICByZXR1cm4gY29ycmVjdFN0cmluZ0lkZW50KHMsIGlkZW50KVxufVxuXG5mdW5jdGlvbiBleHBvcnREZWNsYXJlKGFtYmllbnQ6IGJvb2xlYW4pOiBzdHJpbmcge1xuICBpZiAoYW1iaWVudCkge1xuICAgIHJldHVybiAnZXhwb3J0J1xuICB9XG5cbiAgcmV0dXJuICdleHBvcnQgZGVjbGFyZSdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByb2Nlc3NUeXBlRGVmKFxuICBpbnRlcm1lZGlhdGVUeXBlRmlsZTogc3RyaW5nLFxuICBjb25zdEVudW06IGJvb2xlYW4sXG4pIHtcbiAgY29uc3QgZXhwb3J0czogc3RyaW5nW10gPSBbXVxuICBjb25zdCBkZWZzID0gYXdhaXQgcmVhZEludGVybWVkaWF0ZVR5cGVGaWxlKGludGVybWVkaWF0ZVR5cGVGaWxlKVxuICBjb25zdCBncm91cGVkRGVmcyA9IHByZXByb2Nlc3NUeXBlRGVmKGRlZnMpXG5cbiAgY29uc3QgZHRzID1cbiAgICBzb3J0QnkoQXJyYXkuZnJvbShncm91cGVkRGVmcyksIFsoW25hbWVzcGFjZV0pID0+IG5hbWVzcGFjZV0pXG4gICAgICAubWFwKChbbmFtZXNwYWNlLCBkZWZzXSkgPT4ge1xuICAgICAgICBpZiAobmFtZXNwYWNlID09PSBUT1BfTEVWRUxfTkFNRVNQQUNFKSB7XG4gICAgICAgICAgcmV0dXJuIGRlZnNcbiAgICAgICAgICAgIC5tYXAoKGRlZikgPT4ge1xuICAgICAgICAgICAgICBzd2l0Y2ggKGRlZi5raW5kKSB7XG4gICAgICAgICAgICAgICAgY2FzZSBUeXBlRGVmS2luZC5Db25zdDpcbiAgICAgICAgICAgICAgICBjYXNlIFR5cGVEZWZLaW5kLkVudW06XG4gICAgICAgICAgICAgICAgY2FzZSBUeXBlRGVmS2luZC5TdHJpbmdFbnVtOlxuICAgICAgICAgICAgICAgIGNhc2UgVHlwZURlZktpbmQuRm46XG4gICAgICAgICAgICAgICAgY2FzZSBUeXBlRGVmS2luZC5TdHJ1Y3Q6IHtcbiAgICAgICAgICAgICAgICAgIGV4cG9ydHMucHVzaChkZWYubmFtZSlcbiAgICAgICAgICAgICAgICAgIGlmIChkZWYub3JpZ2luYWxfbmFtZSAmJiBkZWYub3JpZ2luYWxfbmFtZSAhPT0gZGVmLm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgZXhwb3J0cy5wdXNoKGRlZi5vcmlnaW5hbF9uYW1lKVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgYnJlYWtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgcmV0dXJuIHByZXR0eVByaW50KGRlZiwgY29uc3RFbnVtLCAwKVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5qb2luKCdcXG5cXG4nKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGV4cG9ydHMucHVzaChuYW1lc3BhY2UpXG4gICAgICAgICAgbGV0IGRlY2xhcmF0aW9uID0gJydcbiAgICAgICAgICBkZWNsYXJhdGlvbiArPSBgZXhwb3J0IGRlY2xhcmUgbmFtZXNwYWNlICR7bmFtZXNwYWNlfSB7XFxuYFxuICAgICAgICAgIGZvciAoY29uc3QgZGVmIG9mIGRlZnMpIHtcbiAgICAgICAgICAgIGRlY2xhcmF0aW9uICs9IHByZXR0eVByaW50KGRlZiwgY29uc3RFbnVtLCAyLCB0cnVlKSArICdcXG4nXG4gICAgICAgICAgfVxuICAgICAgICAgIGRlY2xhcmF0aW9uICs9ICd9J1xuICAgICAgICAgIHJldHVybiBkZWNsYXJhdGlvblxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmpvaW4oJ1xcblxcbicpICsgJ1xcbidcblxuICByZXR1cm4ge1xuICAgIGR0cyxcbiAgICBleHBvcnRzLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRJbnRlcm1lZGlhdGVUeXBlRmlsZShmaWxlOiBzdHJpbmcpIHtcbiAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoZmlsZSwgJ3V0ZjgnKVxuXG4gIGNvbnN0IGRlZnMgPSBjb250ZW50XG4gICAgLnNwbGl0KCdcXG4nKVxuICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAubWFwKChsaW5lKSA9PiB7XG4gICAgICBsaW5lID0gbGluZS50cmltKClcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobGluZSkgYXMgVHlwZURlZkxpbmVcbiAgICAgIC8vIENvbnZlcnQgZXNjYXBlZCBuZXdsaW5lcyBiYWNrIHRvIGFjdHVhbCBuZXdsaW5lcyBpbiBqc19kb2MgZmllbGRzXG4gICAgICBpZiAocGFyc2VkLmpzX2RvYykge1xuICAgICAgICBwYXJzZWQuanNfZG9jID0gcGFyc2VkLmpzX2RvYy5yZXBsYWNlKC9cXFxcbi9nLCAnXFxuJylcbiAgICAgIH1cbiAgICAgIC8vIENvbnZlcnQgZXNjYXBlZCBuZXdsaW5lcyB0byBhY3R1YWwgbmV3bGluZXMgaW4gZGVmIGZpZWxkcyBmb3Igc3RydWN0L2NsYXNzL2ludGVyZmFjZS90eXBlIHR5cGVzXG4gICAgICAvLyB3aGVyZSBcXG4gcmVwcmVzZW50cyBtZXRob2QvZmllbGQgc2VwYXJhdG9ycyB0aGF0IHNob3VsZCBiZSBhY3R1YWwgbmV3bGluZXNcbiAgICAgIGlmIChwYXJzZWQuZGVmKSB7XG4gICAgICAgIHBhcnNlZC5kZWYgPSBwYXJzZWQuZGVmLnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKVxuICAgICAgfVxuICAgICAgcmV0dXJuIHBhcnNlZFxuICAgIH0pXG5cbiAgLy8gbW92ZSBhbGwgYHN0cnVjdGAgZGVmIHRvIHRoZSB2ZXJ5IHRvcFxuICAvLyBhbmQgb3JkZXIgdGhlIHJlc3QgYWxwaGFiZXRpY2FsbHkuXG4gIHJldHVybiBkZWZzLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5raW5kID09PSBUeXBlRGVmS2luZC5TdHJ1Y3QpIHtcbiAgICAgIGlmIChiLmtpbmQgPT09IFR5cGVEZWZLaW5kLlN0cnVjdCkge1xuICAgICAgICByZXR1cm4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKVxuICAgICAgfVxuICAgICAgcmV0dXJuIC0xXG4gICAgfSBlbHNlIGlmIChiLmtpbmQgPT09IFR5cGVEZWZLaW5kLlN0cnVjdCkge1xuICAgICAgcmV0dXJuIDFcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSlcbiAgICB9XG4gIH0pXG59XG5cbmZ1bmN0aW9uIHByZXByb2Nlc3NUeXBlRGVmKGRlZnM6IFR5cGVEZWZMaW5lW10pOiBNYXA8c3RyaW5nLCBUeXBlRGVmTGluZVtdPiB7XG4gIGNvbnN0IG5hbWVzcGFjZUdyb3VwZWQgPSBuZXcgTWFwPHN0cmluZywgVHlwZURlZkxpbmVbXT4oKVxuICBjb25zdCBjbGFzc0RlZnMgPSBuZXcgTWFwPHN0cmluZywgVHlwZURlZkxpbmU+KClcblxuICBmb3IgKGNvbnN0IGRlZiBvZiBkZWZzKSB7XG4gICAgY29uc3QgbmFtZXNwYWNlID0gZGVmLmpzX21vZCA/PyBUT1BfTEVWRUxfTkFNRVNQQUNFXG4gICAgaWYgKCFuYW1lc3BhY2VHcm91cGVkLmhhcyhuYW1lc3BhY2UpKSB7XG4gICAgICBuYW1lc3BhY2VHcm91cGVkLnNldChuYW1lc3BhY2UsIFtdKVxuICAgIH1cblxuICAgIGNvbnN0IGdyb3VwID0gbmFtZXNwYWNlR3JvdXBlZC5nZXQobmFtZXNwYWNlKSFcblxuICAgIGlmIChkZWYua2luZCA9PT0gVHlwZURlZktpbmQuU3RydWN0KSB7XG4gICAgICBncm91cC5wdXNoKGRlZilcbiAgICAgIGNsYXNzRGVmcy5zZXQoZGVmLm5hbWUsIGRlZilcbiAgICB9IGVsc2UgaWYgKGRlZi5raW5kID09PSBUeXBlRGVmS2luZC5FeHRlbmRzKSB7XG4gICAgICBjb25zdCBjbGFzc0RlZiA9IGNsYXNzRGVmcy5nZXQoZGVmLm5hbWUpXG4gICAgICBpZiAoY2xhc3NEZWYpIHtcbiAgICAgICAgY2xhc3NEZWYuZXh0ZW5kcyA9IGRlZi5kZWZcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGRlZi5raW5kID09PSBUeXBlRGVmS2luZC5JbXBsKSB7XG4gICAgICAvLyBtZXJnZSBgaW1wbGAgaW50byBjbGFzcyBkZWZpbml0aW9uXG4gICAgICBjb25zdCBjbGFzc0RlZiA9IGNsYXNzRGVmcy5nZXQoZGVmLm5hbWUpXG4gICAgICBpZiAoY2xhc3NEZWYpIHtcbiAgICAgICAgaWYgKGNsYXNzRGVmLmRlZikge1xuICAgICAgICAgIGNsYXNzRGVmLmRlZiArPSAnXFxuJ1xuICAgICAgICB9XG5cbiAgICAgICAgY2xhc3NEZWYuZGVmICs9IGRlZi5kZWZcbiAgICAgICAgLy8gQ29udmVydCBhbnkgcmVtYWluaW5nIFxcbiBzZXF1ZW5jZXMgaW4gdGhlIG1lcmdlZCBkZWYgdG8gYWN0dWFsIG5ld2xpbmVzXG4gICAgICAgIGlmIChjbGFzc0RlZi5kZWYpIHtcbiAgICAgICAgICBjbGFzc0RlZi5kZWYgPSBjbGFzc0RlZi5kZWYucmVwbGFjZSgvXFxcXG4vZywgJ1xcbicpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZ3JvdXAucHVzaChkZWYpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG5hbWVzcGFjZUdyb3VwZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvcnJlY3RTdHJpbmdJZGVudChzcmM6IHN0cmluZywgaWRlbnQ6IG51bWJlcik6IHN0cmluZyB7XG4gIGxldCBicmFja2V0RGVwdGggPSAwXG4gIGNvbnN0IHJlc3VsdCA9IHNyY1xuICAgIC5zcGxpdCgnXFxuJylcbiAgICAubWFwKChsaW5lKSA9PiB7XG4gICAgICBsaW5lID0gbGluZS50cmltKClcbiAgICAgIGlmIChsaW5lID09PSAnJykge1xuICAgICAgICByZXR1cm4gJydcbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNJbk11bHRpbGluZUNvbW1lbnQgPSBsaW5lLnN0YXJ0c1dpdGgoJyonKVxuICAgICAgY29uc3QgaXNDbG9zaW5nQnJhY2tldCA9IGxpbmUuZW5kc1dpdGgoJ30nKVxuICAgICAgY29uc3QgaXNPcGVuaW5nQnJhY2tldCA9IGxpbmUuZW5kc1dpdGgoJ3snKVxuICAgICAgY29uc3QgaXNUeXBlRGVjbGFyYXRpb24gPSBsaW5lLmVuZHNXaXRoKCc9JylcbiAgICAgIGNvbnN0IGlzVHlwZVZhcmlhbnQgPSBsaW5lLnN0YXJ0c1dpdGgoJ3wnKVxuXG4gICAgICBsZXQgcmlnaHRJbmRlbnQgPSBpZGVudFxuICAgICAgaWYgKChpc09wZW5pbmdCcmFja2V0IHx8IGlzVHlwZURlY2xhcmF0aW9uKSAmJiAhaXNJbk11bHRpbGluZUNvbW1lbnQpIHtcbiAgICAgICAgYnJhY2tldERlcHRoICs9IDFcbiAgICAgICAgcmlnaHRJbmRlbnQgKz0gKGJyYWNrZXREZXB0aCAtIDEpICogMlxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGlzQ2xvc2luZ0JyYWNrZXQgJiZcbiAgICAgICAgICBicmFja2V0RGVwdGggPiAwICYmXG4gICAgICAgICAgIWlzSW5NdWx0aWxpbmVDb21tZW50ICYmXG4gICAgICAgICAgIWlzVHlwZVZhcmlhbnRcbiAgICAgICAgKSB7XG4gICAgICAgICAgYnJhY2tldERlcHRoIC09IDFcbiAgICAgICAgfVxuICAgICAgICByaWdodEluZGVudCArPSBicmFja2V0RGVwdGggKiAyXG4gICAgICB9XG5cbiAgICAgIGlmIChpc0luTXVsdGlsaW5lQ29tbWVudCkge1xuICAgICAgICByaWdodEluZGVudCArPSAxXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHMgPSBgJHsnICcucmVwZWF0KHJpZ2h0SW5kZW50KX0ke2xpbmV9YFxuXG4gICAgICByZXR1cm4gc1xuICAgIH0pXG4gICAgLmpvaW4oJ1xcbicpXG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuIiwiaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHsgcmVhZE5hcGlDb25maWcgfSBmcm9tICcuL2NvbmZpZy5qcydcblxuaW50ZXJmYWNlIE1pbmltYWxOYXBpT3B0aW9ucyB7XG4gIGN3ZDogc3RyaW5nXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkQ29uZmlnKG9wdGlvbnM6IE1pbmltYWxOYXBpT3B0aW9ucykge1xuICBjb25zdCByZXNvbHZlUGF0aCA9ICguLi5wYXRoczogc3RyaW5nW10pID0+IHJlc29sdmUob3B0aW9ucy5jd2QsIC4uLnBhdGhzKVxuICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICByZXNvbHZlUGF0aChvcHRpb25zLnBhY2thZ2VKc29uUGF0aCA/PyAncGFja2FnZS5qc29uJyksXG4gICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZVBhdGgob3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgKVxuICByZXR1cm4gY29uZmlnXG59XG4iLCJpbXBvcnQgeyBqb2luLCByZXNvbHZlLCBwYXJzZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0ICogYXMgY29sb3JzIGZyb20gJ2NvbG9yZXR0ZSdcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0QXJ0aWZhY3RzT3B0aW9ucyxcbiAgdHlwZSBBcnRpZmFjdHNPcHRpb25zLFxufSBmcm9tICcuLi9kZWYvYXJ0aWZhY3RzLmpzJ1xuaW1wb3J0IHtcbiAgcmVhZE5hcGlDb25maWcsXG4gIGRlYnVnRmFjdG9yeSxcbiAgcmVhZEZpbGVBc3luYyxcbiAgd3JpdGVGaWxlQXN5bmMsXG4gIFVuaUFyY2hzQnlQbGF0Zm9ybSxcbiAgcmVhZGRpckFzeW5jLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ2FydGlmYWN0cycpXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb2xsZWN0QXJ0aWZhY3RzKHVzZXJPcHRpb25zOiBBcnRpZmFjdHNPcHRpb25zKSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRBcnRpZmFjdHNPcHRpb25zKHVzZXJPcHRpb25zKVxuXG4gIGNvbnN0IHJlc29sdmVQYXRoID0gKC4uLnBhdGhzOiBzdHJpbmdbXSkgPT4gcmVzb2x2ZShvcHRpb25zLmN3ZCwgLi4ucGF0aHMpXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHJlc29sdmVQYXRoKG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuICBjb25zdCB7IHRhcmdldHMsIGJpbmFyeU5hbWUsIHBhY2thZ2VOYW1lIH0gPSBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZVBhdGgob3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgKVxuXG4gIGNvbnN0IGRpc3REaXJzID0gdGFyZ2V0cy5tYXAoKHBsYXRmb3JtKSA9PlxuICAgIGpvaW4ob3B0aW9ucy5jd2QsIG9wdGlvbnMubnBtRGlyLCBwbGF0Zm9ybS5wbGF0Zm9ybUFyY2hBQkkpLFxuICApXG5cbiAgY29uc3QgdW5pdmVyc2FsU291cmNlQmlucyA9IG5ldyBTZXQoXG4gICAgdGFyZ2V0c1xuICAgICAgLmZpbHRlcigocGxhdGZvcm0pID0+IHBsYXRmb3JtLmFyY2ggPT09ICd1bml2ZXJzYWwnKVxuICAgICAgLmZsYXRNYXAoKHApID0+XG4gICAgICAgIFVuaUFyY2hzQnlQbGF0Zm9ybVtwLnBsYXRmb3JtXT8ubWFwKChhKSA9PiBgJHtwLnBsYXRmb3JtfS0ke2F9YCksXG4gICAgICApXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pIGFzIHN0cmluZ1tdLFxuICApXG5cbiAgYXdhaXQgY29sbGVjdE5vZGVCaW5hcmllcyhqb2luKG9wdGlvbnMuY3dkLCBvcHRpb25zLm91dHB1dERpcikpLnRoZW4oXG4gICAgKG91dHB1dCkgPT5cbiAgICAgIFByb21pc2UuYWxsKFxuICAgICAgICBvdXRwdXQubWFwKGFzeW5jIChmaWxlUGF0aCkgPT4ge1xuICAgICAgICAgIGRlYnVnLmluZm8oYFJlYWQgWyR7Y29sb3JzLnllbGxvd0JyaWdodChmaWxlUGF0aCl9XWApXG4gICAgICAgICAgY29uc3Qgc291cmNlQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoZmlsZVBhdGgpXG4gICAgICAgICAgY29uc3QgcGFyc2VkTmFtZSA9IHBhcnNlKGZpbGVQYXRoKVxuICAgICAgICAgIGNvbnN0IHRlcm1zID0gcGFyc2VkTmFtZS5uYW1lLnNwbGl0KCcuJylcbiAgICAgICAgICBjb25zdCBwbGF0Zm9ybUFyY2hBQkkgPSB0ZXJtcy5wb3AoKSFcbiAgICAgICAgICBjb25zdCBfYmluYXJ5TmFtZSA9IHRlcm1zLmpvaW4oJy4nKVxuXG4gICAgICAgICAgaWYgKF9iaW5hcnlOYW1lICE9PSBiaW5hcnlOYW1lKSB7XG4gICAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgICBgWyR7X2JpbmFyeU5hbWV9XSBpcyBub3QgbWF0Y2hlZCB3aXRoIFske2JpbmFyeU5hbWV9XSwgc2tpcGAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG4gICAgICAgICAgY29uc3QgZGlyID0gZGlzdERpcnMuZmluZCgoZGlyKSA9PiBkaXIuaW5jbHVkZXMocGxhdGZvcm1BcmNoQUJJKSlcbiAgICAgICAgICBpZiAoIWRpciAmJiB1bml2ZXJzYWxTb3VyY2VCaW5zLmhhcyhwbGF0Zm9ybUFyY2hBQkkpKSB7XG4gICAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgICBgWyR7cGxhdGZvcm1BcmNoQUJJfV0gaGFzIG5vIGRpc3QgZGlyIGJ1dCBpdCBpcyBzb3VyY2UgYmluIGZvciB1bml2ZXJzYWwgYXJjaCwgc2tpcGAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgICByZXR1cm5cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKCFkaXIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gZGlzdCBkaXIgZm91bmQgZm9yICR7ZmlsZVBhdGh9YClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBkaXN0RmlsZVBhdGggPSBqb2luKGRpciwgcGFyc2VkTmFtZS5iYXNlKVxuICAgICAgICAgIGRlYnVnLmluZm8oXG4gICAgICAgICAgICBgV3JpdGUgZmlsZSBjb250ZW50IHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoZGlzdEZpbGVQYXRoKX1dYCxcbiAgICAgICAgICApXG4gICAgICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZGlzdEZpbGVQYXRoLCBzb3VyY2VDb250ZW50KVxuICAgICAgICAgIGNvbnN0IGRpc3RGaWxlUGF0aExvY2FsID0gam9pbihcbiAgICAgICAgICAgIHBhcnNlKHBhY2thZ2VKc29uUGF0aCkuZGlyLFxuICAgICAgICAgICAgcGFyc2VkTmFtZS5iYXNlLFxuICAgICAgICAgIClcbiAgICAgICAgICBkZWJ1Zy5pbmZvKFxuICAgICAgICAgICAgYFdyaXRlIGZpbGUgY29udGVudCB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KGRpc3RGaWxlUGF0aExvY2FsKX1dYCxcbiAgICAgICAgICApXG4gICAgICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZGlzdEZpbGVQYXRoTG9jYWwsIHNvdXJjZUNvbnRlbnQpXG4gICAgICAgIH0pLFxuICAgICAgKSxcbiAgKVxuXG4gIGNvbnN0IHdhc2lUYXJnZXQgPSB0YXJnZXRzLmZpbmQoKHQpID0+IHQucGxhdGZvcm0gPT09ICd3YXNpJylcbiAgaWYgKHdhc2lUYXJnZXQpIHtcbiAgICBjb25zdCB3YXNpRGlyID0gam9pbihcbiAgICAgIG9wdGlvbnMuY3dkLFxuICAgICAgb3B0aW9ucy5ucG1EaXIsXG4gICAgICB3YXNpVGFyZ2V0LnBsYXRmb3JtQXJjaEFCSSxcbiAgICApXG4gICAgY29uc3QgY2pzRmlsZSA9IGpvaW4oXG4gICAgICBvcHRpb25zLmJ1aWxkT3V0cHV0RGlyID8/IG9wdGlvbnMuY3dkLFxuICAgICAgYCR7YmluYXJ5TmFtZX0ud2FzaS5janNgLFxuICAgIClcbiAgICBjb25zdCB3b3JrZXJGaWxlID0gam9pbihcbiAgICAgIG9wdGlvbnMuYnVpbGRPdXRwdXREaXIgPz8gb3B0aW9ucy5jd2QsXG4gICAgICBgd2FzaS13b3JrZXIubWpzYCxcbiAgICApXG4gICAgY29uc3QgYnJvd3NlckVudHJ5ID0gam9pbihcbiAgICAgIG9wdGlvbnMuYnVpbGRPdXRwdXREaXIgPz8gb3B0aW9ucy5jd2QsXG4gICAgICBgJHtiaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgLFxuICAgIClcbiAgICBjb25zdCBicm93c2VyV29ya2VyRmlsZSA9IGpvaW4oXG4gICAgICBvcHRpb25zLmJ1aWxkT3V0cHV0RGlyID8/IG9wdGlvbnMuY3dkLFxuICAgICAgYHdhc2ktd29ya2VyLWJyb3dzZXIubWpzYCxcbiAgICApXG4gICAgZGVidWcuaW5mbyhcbiAgICAgIGBNb3ZlIHdhc2kgYmluZGluZyBmaWxlIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoXG4gICAgICAgIGNqc0ZpbGUsXG4gICAgICApfV0gdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodCh3YXNpRGlyKX1dYCxcbiAgICApXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICBqb2luKHdhc2lEaXIsIGAke2JpbmFyeU5hbWV9Lndhc2kuY2pzYCksXG4gICAgICBhd2FpdCByZWFkRmlsZUFzeW5jKGNqc0ZpbGUpLFxuICAgIClcbiAgICBkZWJ1Zy5pbmZvKFxuICAgICAgYE1vdmUgd2FzaSB3b3JrZXIgZmlsZSBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KFxuICAgICAgICB3b3JrZXJGaWxlLFxuICAgICAgKX1dIHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQod2FzaURpcil9XWAsXG4gICAgKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgam9pbih3YXNpRGlyLCBgd2FzaS13b3JrZXIubWpzYCksXG4gICAgICBhd2FpdCByZWFkRmlsZUFzeW5jKHdvcmtlckZpbGUpLFxuICAgIClcbiAgICBkZWJ1Zy5pbmZvKFxuICAgICAgYE1vdmUgd2FzaSBicm93c2VyIGVudHJ5IGZpbGUgWyR7Y29sb3JzLnllbGxvd0JyaWdodChcbiAgICAgICAgYnJvd3NlckVudHJ5LFxuICAgICAgKX1dIHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQod2FzaURpcil9XWAsXG4gICAgKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgam9pbih3YXNpRGlyLCBgJHtiaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgKSxcbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS92aXRlanMvdml0ZS9pc3N1ZXMvODQyN1xuICAgICAgKGF3YWl0IHJlYWRGaWxlQXN5bmMoYnJvd3NlckVudHJ5LCAndXRmOCcpKS5yZXBsYWNlKFxuICAgICAgICBgbmV3IFVSTCgnLi93YXNpLXdvcmtlci1icm93c2VyLm1qcycsIGltcG9ydC5tZXRhLnVybClgLFxuICAgICAgICBgbmV3IFVSTCgnJHtwYWNrYWdlTmFtZX0td2FzbTMyLXdhc2kvd2FzaS13b3JrZXItYnJvd3Nlci5tanMnLCBpbXBvcnQubWV0YS51cmwpYCxcbiAgICAgICksXG4gICAgKVxuICAgIGRlYnVnLmluZm8oXG4gICAgICBgTW92ZSB3YXNpIGJyb3dzZXIgd29ya2VyIGZpbGUgWyR7Y29sb3JzLnllbGxvd0JyaWdodChcbiAgICAgICAgYnJvd3NlcldvcmtlckZpbGUsXG4gICAgICApfV0gdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodCh3YXNpRGlyKX1dYCxcbiAgICApXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICBqb2luKHdhc2lEaXIsIGB3YXNpLXdvcmtlci1icm93c2VyLm1qc2ApLFxuICAgICAgYXdhaXQgcmVhZEZpbGVBc3luYyhicm93c2VyV29ya2VyRmlsZSksXG4gICAgKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbGxlY3ROb2RlQmluYXJpZXMocm9vdDogc3RyaW5nKSB7XG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgcmVhZGRpckFzeW5jKHJvb3QsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KVxuICBjb25zdCBub2RlQmluYXJpZXMgPSBmaWxlc1xuICAgIC5maWx0ZXIoXG4gICAgICAoZmlsZSkgPT5cbiAgICAgICAgZmlsZS5pc0ZpbGUoKSAmJlxuICAgICAgICAoZmlsZS5uYW1lLmVuZHNXaXRoKCcubm9kZScpIHx8IGZpbGUubmFtZS5lbmRzV2l0aCgnLndhc20nKSksXG4gICAgKVxuICAgIC5tYXAoKGZpbGUpID0+IGpvaW4ocm9vdCwgZmlsZS5uYW1lKSlcblxuICBjb25zdCBkaXJzID0gZmlsZXMuZmlsdGVyKChmaWxlKSA9PiBmaWxlLmlzRGlyZWN0b3J5KCkpXG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoZGlyLm5hbWUgIT09ICdub2RlX21vZHVsZXMnKSB7XG4gICAgICBub2RlQmluYXJpZXMucHVzaCguLi4oYXdhaXQgY29sbGVjdE5vZGVCaW5hcmllcyhqb2luKHJvb3QsIGRpci5uYW1lKSkpKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbm9kZUJpbmFyaWVzXG59XG4iLCJleHBvcnQgZnVuY3Rpb24gY3JlYXRlQ2pzQmluZGluZyhcbiAgbG9jYWxOYW1lOiBzdHJpbmcsXG4gIHBrZ05hbWU6IHN0cmluZyxcbiAgaWRlbnRzOiBzdHJpbmdbXSxcbiAgcGFja2FnZVZlcnNpb24/OiBzdHJpbmcsXG4pOiBzdHJpbmcge1xuICByZXR1cm4gYCR7YmluZGluZ0hlYWRlcn1cbiR7Y3JlYXRlQ29tbW9uQmluZGluZyhsb2NhbE5hbWUsIHBrZ05hbWUsIHBhY2thZ2VWZXJzaW9uKX1cbm1vZHVsZS5leHBvcnRzID0gbmF0aXZlQmluZGluZ1xuJHtpZGVudHNcbiAgLm1hcCgoaWRlbnQpID0+IGBtb2R1bGUuZXhwb3J0cy4ke2lkZW50fSA9IG5hdGl2ZUJpbmRpbmcuJHtpZGVudH1gKVxuICAuam9pbignXFxuJyl9XG5gXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVFc21CaW5kaW5nKFxuICBsb2NhbE5hbWU6IHN0cmluZyxcbiAgcGtnTmFtZTogc3RyaW5nLFxuICBpZGVudHM6IHN0cmluZ1tdLFxuICBwYWNrYWdlVmVyc2lvbj86IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIHJldHVybiBgJHtiaW5kaW5nSGVhZGVyfVxuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJ1xuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKVxuY29uc3QgX19kaXJuYW1lID0gbmV3IFVSTCgnLicsIGltcG9ydC5tZXRhLnVybCkucGF0aG5hbWVcblxuJHtjcmVhdGVDb21tb25CaW5kaW5nKGxvY2FsTmFtZSwgcGtnTmFtZSwgcGFja2FnZVZlcnNpb24pfVxuY29uc3QgeyAke2lkZW50cy5qb2luKCcsICcpfSB9ID0gbmF0aXZlQmluZGluZ1xuJHtpZGVudHMubWFwKChpZGVudCkgPT4gYGV4cG9ydCB7ICR7aWRlbnR9IH1gKS5qb2luKCdcXG4nKX1cbmBcbn1cblxuY29uc3QgYmluZGluZ0hlYWRlciA9IGAvLyBwcmV0dGllci1pZ25vcmVcbi8qIGVzbGludC1kaXNhYmxlICovXG4vLyBAdHMtbm9jaGVja1xuLyogYXV0by1nZW5lcmF0ZWQgYnkgTkFQSS1SUyAqL1xuYFxuXG5mdW5jdGlvbiBjcmVhdGVDb21tb25CaW5kaW5nKFxuICBsb2NhbE5hbWU6IHN0cmluZyxcbiAgcGtnTmFtZTogc3RyaW5nLFxuICBwYWNrYWdlVmVyc2lvbj86IHN0cmluZyxcbik6IHN0cmluZyB7XG4gIGZ1bmN0aW9uIHJlcXVpcmVUdXBsZSh0dXBsZTogc3RyaW5nLCBpZGVudFNpemUgPSA4KSB7XG4gICAgY29uc3QgaWRlbnRMb3cgPSAnICcucmVwZWF0KGlkZW50U2l6ZSAtIDIpXG4gICAgY29uc3QgaWRlbnQgPSAnICcucmVwZWF0KGlkZW50U2l6ZSlcbiAgICBjb25zdCB2ZXJzaW9uQ2hlY2sgPSBwYWNrYWdlVmVyc2lvblxuICAgICAgPyBgXG4ke2lkZW50TG93fXRyeSB7XG4ke2lkZW50fWNvbnN0IGJpbmRpbmcgPSByZXF1aXJlKCcke3BrZ05hbWV9LSR7dHVwbGV9JylcbiR7aWRlbnR9Y29uc3QgYmluZGluZ1BhY2thZ2VWZXJzaW9uID0gcmVxdWlyZSgnJHtwa2dOYW1lfS0ke3R1cGxlfS9wYWNrYWdlLmpzb24nKS52ZXJzaW9uXG4ke2lkZW50fWlmIChiaW5kaW5nUGFja2FnZVZlcnNpb24gIT09ICcke3BhY2thZ2VWZXJzaW9ufScgJiYgcHJvY2Vzcy5lbnYuTkFQSV9SU19FTkZPUkNFX1ZFUlNJT05fQ0hFQ0sgJiYgcHJvY2Vzcy5lbnYuTkFQSV9SU19FTkZPUkNFX1ZFUlNJT05fQ0hFQ0sgIT09ICcwJykge1xuJHtpZGVudH0gIHRocm93IG5ldyBFcnJvcihcXGBOYXRpdmUgYmluZGluZyBwYWNrYWdlIHZlcnNpb24gbWlzbWF0Y2gsIGV4cGVjdGVkICR7cGFja2FnZVZlcnNpb259IGJ1dCBnb3QgXFwke2JpbmRpbmdQYWNrYWdlVmVyc2lvbn0uIFlvdSBjYW4gcmVpbnN0YWxsIGRlcGVuZGVuY2llcyB0byBmaXggdGhpcyBpc3N1ZS5cXGApXG4ke2lkZW50fX1cbiR7aWRlbnR9cmV0dXJuIGJpbmRpbmdcbiR7aWRlbnRMb3d9fSBjYXRjaCAoZSkge1xuJHtpZGVudH1sb2FkRXJyb3JzLnB1c2goZSlcbiR7aWRlbnRMb3d9fWBcbiAgICAgIDogYFxuJHtpZGVudExvd310cnkge1xuJHtpZGVudH1yZXR1cm4gcmVxdWlyZSgnJHtwa2dOYW1lfS0ke3R1cGxlfScpXG4ke2lkZW50TG93fX0gY2F0Y2ggKGUpIHtcbiR7aWRlbnR9bG9hZEVycm9ycy5wdXNoKGUpXG4ke2lkZW50TG93fX1gXG4gICAgcmV0dXJuIGB0cnkge1xuJHtpZGVudH1yZXR1cm4gcmVxdWlyZSgnLi8ke2xvY2FsTmFtZX0uJHt0dXBsZX0ubm9kZScpXG4ke2lkZW50TG93fX0gY2F0Y2ggKGUpIHtcbiR7aWRlbnR9bG9hZEVycm9ycy5wdXNoKGUpXG4ke2lkZW50TG93fX0ke3ZlcnNpb25DaGVja31gXG4gIH1cblxuICByZXR1cm4gYGNvbnN0IHsgcmVhZEZpbGVTeW5jIH0gPSByZXF1aXJlKCdub2RlOmZzJylcbmxldCBuYXRpdmVCaW5kaW5nID0gbnVsbFxuY29uc3QgbG9hZEVycm9ycyA9IFtdXG5cbmNvbnN0IGlzTXVzbCA9ICgpID0+IHtcbiAgbGV0IG11c2wgPSBmYWxzZVxuICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2xpbnV4Jykge1xuICAgIG11c2wgPSBpc011c2xGcm9tRmlsZXN5c3RlbSgpXG4gICAgaWYgKG11c2wgPT09IG51bGwpIHtcbiAgICAgIG11c2wgPSBpc011c2xGcm9tUmVwb3J0KClcbiAgICB9XG4gICAgaWYgKG11c2wgPT09IG51bGwpIHtcbiAgICAgIG11c2wgPSBpc011c2xGcm9tQ2hpbGRQcm9jZXNzKClcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG11c2xcbn1cblxuY29uc3QgaXNGaWxlTXVzbCA9IChmKSA9PiBmLmluY2x1ZGVzKCdsaWJjLm11c2wtJykgfHwgZi5pbmNsdWRlcygnbGQtbXVzbC0nKVxuXG5jb25zdCBpc011c2xGcm9tRmlsZXN5c3RlbSA9ICgpID0+IHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVhZEZpbGVTeW5jKCcvdXNyL2Jpbi9sZGQnLCAndXRmLTgnKS5pbmNsdWRlcygnbXVzbCcpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuY29uc3QgaXNNdXNsRnJvbVJlcG9ydCA9ICgpID0+IHtcbiAgbGV0IHJlcG9ydCA9IG51bGxcbiAgaWYgKHR5cGVvZiBwcm9jZXNzLnJlcG9ydD8uZ2V0UmVwb3J0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcHJvY2Vzcy5yZXBvcnQuZXhjbHVkZU5ldHdvcmsgPSB0cnVlXG4gICAgcmVwb3J0ID0gcHJvY2Vzcy5yZXBvcnQuZ2V0UmVwb3J0KClcbiAgfVxuICBpZiAoIXJlcG9ydCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cbiAgaWYgKHJlcG9ydC5oZWFkZXIgJiYgcmVwb3J0LmhlYWRlci5nbGliY1ZlcnNpb25SdW50aW1lKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkocmVwb3J0LnNoYXJlZE9iamVjdHMpKSB7XG4gICAgaWYgKHJlcG9ydC5zaGFyZWRPYmplY3RzLnNvbWUoaXNGaWxlTXVzbCkpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG5jb25zdCBpc011c2xGcm9tQ2hpbGRQcm9jZXNzID0gKCkgPT4ge1xuICB0cnkge1xuICAgIHJldHVybiByZXF1aXJlKCdjaGlsZF9wcm9jZXNzJykuZXhlY1N5bmMoJ2xkZCAtLXZlcnNpb24nLCB7IGVuY29kaW5nOiAndXRmOCcgfSkuaW5jbHVkZXMoJ211c2wnKVxuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gSWYgd2UgcmVhY2ggdGhpcyBjYXNlLCB3ZSBkb24ndCBrbm93IGlmIHRoZSBzeXN0ZW0gaXMgbXVzbCBvciBub3QsIHNvIGlzIGJldHRlciB0byBqdXN0IGZhbGxiYWNrIHRvIGZhbHNlXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuZnVuY3Rpb24gcmVxdWlyZU5hdGl2ZSgpIHtcbiAgaWYgKHByb2Nlc3MuZW52Lk5BUElfUlNfTkFUSVZFX0xJQlJBUllfUEFUSCkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gcmVxdWlyZShwcm9jZXNzLmVudi5OQVBJX1JTX05BVElWRV9MSUJSQVJZX1BBVEgpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKGVycilcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2FuZHJvaWQnKSB7XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2FuZHJvaWQtYXJtNjQnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybScpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdhbmRyb2lkLWFybS1lYWJpJyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIEFuZHJvaWQgXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3g2NCcpIHtcbiAgICAgIGlmIChwcm9jZXNzLmNvbmZpZz8udmFyaWFibGVzPy5zaGxpYl9zdWZmaXggPT09ICdkbGwuYScgfHwgcHJvY2Vzcy5jb25maWc/LnZhcmlhYmxlcz8ubm9kZV90YXJnZXRfdHlwZSA9PT0gJ3NoYXJlZF9saWJyYXJ5Jykge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnd2luMzIteDY0LWdudScpfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ3dpbjMyLXg2NC1tc3ZjJyl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdpYTMyJykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ3dpbjMyLWlhMzItbXN2YycpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnd2luMzItYXJtNjQtbXN2YycpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBXaW5kb3dzOiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdkYXJ3aW4nKSB7XG4gICAgJHtyZXF1aXJlVHVwbGUoJ2Rhcndpbi11bml2ZXJzYWwnLCA2KX1cbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAneDY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2Rhcndpbi14NjQnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2Rhcndpbi1hcm02NCcpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBtYWNPUzogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZnJlZWJzZCcpIHtcbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAneDY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2ZyZWVic2QteDY0Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdmcmVlYnNkLWFybTY0Jyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIEZyZWVCU0Q6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2xpbnV4Jykge1xuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICd4NjQnKSB7XG4gICAgICBpZiAoaXNNdXNsKCkpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXg2NC1tdXNsJywgMTApfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXg2NC1nbnUnLCAxMCl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgIGlmIChpc011c2woKSkge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtYXJtNjQtbXVzbCcsIDEwKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1hcm02NC1nbnUnLCAxMCl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm0nKSB7XG4gICAgICBpZiAoaXNNdXNsKCkpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWFybS1tdXNsZWFiaWhmJywgMTApfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWFybS1nbnVlYWJpaGYnLCAxMCl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdsb29uZzY0Jykge1xuICAgICAgaWYgKGlzTXVzbCgpKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1sb29uZzY0LW11c2wnLCAxMCl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtbG9vbmc2NC1nbnUnLCAxMCl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdyaXNjdjY0Jykge1xuICAgICAgaWYgKGlzTXVzbCgpKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1yaXNjdjY0LW11c2wnLCAxMCl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtcmlzY3Y2NC1nbnUnLCAxMCl9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdwcGM2NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1wcGM2NC1nbnUnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3MzOTB4Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXMzOTB4LWdudScpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBMaW51eDogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnb3Blbmhhcm1vbnknKSB7XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ29wZW5oYXJtb255LWFybTY0Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICd4NjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnb3Blbmhhcm1vbnkteDY0Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm0nKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnb3Blbmhhcm1vbnktYXJtJyl9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIG9uIE9wZW5IYXJtb255OiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGxvYWRFcnJvcnMucHVzaChuZXcgRXJyb3IoXFxgVW5zdXBwb3J0ZWQgT1M6IFxcJHtwcm9jZXNzLnBsYXRmb3JtfSwgYXJjaGl0ZWN0dXJlOiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gIH1cbn1cblxubmF0aXZlQmluZGluZyA9IHJlcXVpcmVOYXRpdmUoKVxuXG5pZiAoIW5hdGl2ZUJpbmRpbmcgfHwgcHJvY2Vzcy5lbnYuTkFQSV9SU19GT1JDRV9XQVNJKSB7XG4gIGxldCB3YXNpQmluZGluZyA9IG51bGxcbiAgbGV0IHdhc2lCaW5kaW5nRXJyb3IgPSBudWxsXG4gIHRyeSB7XG4gICAgd2FzaUJpbmRpbmcgPSByZXF1aXJlKCcuLyR7bG9jYWxOYW1lfS53YXNpLmNqcycpXG4gICAgbmF0aXZlQmluZGluZyA9IHdhc2lCaW5kaW5nXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChwcm9jZXNzLmVudi5OQVBJX1JTX0ZPUkNFX1dBU0kpIHtcbiAgICAgIHdhc2lCaW5kaW5nRXJyb3IgPSBlcnJcbiAgICB9XG4gIH1cbiAgaWYgKCFuYXRpdmVCaW5kaW5nIHx8IHByb2Nlc3MuZW52Lk5BUElfUlNfRk9SQ0VfV0FTSSkge1xuICAgIHRyeSB7XG4gICAgICB3YXNpQmluZGluZyA9IHJlcXVpcmUoJyR7cGtnTmFtZX0td2FzbTMyLXdhc2knKVxuICAgICAgbmF0aXZlQmluZGluZyA9IHdhc2lCaW5kaW5nXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAocHJvY2Vzcy5lbnYuTkFQSV9SU19GT1JDRV9XQVNJKSB7XG4gICAgICAgIGlmICghd2FzaUJpbmRpbmdFcnJvcikge1xuICAgICAgICAgIHdhc2lCaW5kaW5nRXJyb3IgPSBlcnJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB3YXNpQmluZGluZ0Vycm9yLmNhdXNlID0gZXJyXG4gICAgICAgIH1cbiAgICAgICAgbG9hZEVycm9ycy5wdXNoKGVycilcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgaWYgKHByb2Nlc3MuZW52Lk5BUElfUlNfRk9SQ0VfV0FTSSA9PT0gJ2Vycm9yJyAmJiAhd2FzaUJpbmRpbmcpIHtcbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcignV0FTSSBiaW5kaW5nIG5vdCBmb3VuZCBhbmQgTkFQSV9SU19GT1JDRV9XQVNJIGlzIHNldCB0byBlcnJvcicpXG4gICAgZXJyb3IuY2F1c2UgPSB3YXNpQmluZGluZ0Vycm9yXG4gICAgdGhyb3cgZXJyb3JcbiAgfVxufVxuXG5pZiAoIW5hdGl2ZUJpbmRpbmcpIHtcbiAgaWYgKGxvYWRFcnJvcnMubGVuZ3RoID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFxcYENhbm5vdCBmaW5kIG5hdGl2ZSBiaW5kaW5nLiBcXGAgK1xuICAgICAgICBcXGBucG0gaGFzIGEgYnVnIHJlbGF0ZWQgdG8gb3B0aW9uYWwgZGVwZW5kZW5jaWVzIChodHRwczovL2dpdGh1Yi5jb20vbnBtL2NsaS9pc3N1ZXMvNDgyOCkuIFxcYCArXG4gICAgICAgICdQbGVhc2UgdHJ5IFxcYG5wbSBpXFxgIGFnYWluIGFmdGVyIHJlbW92aW5nIGJvdGggcGFja2FnZS1sb2NrLmpzb24gYW5kIG5vZGVfbW9kdWxlcyBkaXJlY3RvcnkuJyxcbiAgICAgIHtcbiAgICAgICAgY2F1c2U6IGxvYWRFcnJvcnMucmVkdWNlKChlcnIsIGN1cikgPT4ge1xuICAgICAgICAgIGN1ci5jYXVzZSA9IGVyclxuICAgICAgICAgIHJldHVybiBjdXJcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIClcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXFxgRmFpbGVkIHRvIGxvYWQgbmF0aXZlIGJpbmRpbmdcXGApXG59XG5gXG59XG4iLCJleHBvcnQgY29uc3QgY3JlYXRlV2FzaUJyb3dzZXJCaW5kaW5nID0gKFxuICB3YXNpRmlsZW5hbWU6IHN0cmluZyxcbiAgaW5pdGlhbE1lbW9yeSA9IDQwMDAsXG4gIG1heGltdW1NZW1vcnkgPSA2NTUzNixcbiAgZnMgPSBmYWxzZSxcbiAgYXN5bmNJbml0ID0gZmFsc2UsXG4gIGJ1ZmZlciA9IGZhbHNlLFxuICBlcnJvckV2ZW50ID0gZmFsc2UsXG4pID0+IHtcbiAgY29uc3QgZnNJbXBvcnQgPSBmc1xuICAgID8gYnVmZmVyXG4gICAgICA/IGBpbXBvcnQgeyBtZW1mcywgQnVmZmVyIH0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lL2ZzJ2BcbiAgICAgIDogYGltcG9ydCB7IG1lbWZzIH0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lL2ZzJ2BcbiAgICA6ICcnXG4gIGNvbnN0IGJ1ZmZlckltcG9ydCA9IGJ1ZmZlciAmJiAhZnMgPyBgaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSAnYnVmZmVyJ2AgOiAnJ1xuICBjb25zdCB3YXNpQ3JlYXRpb24gPSBmc1xuICAgID8gYFxuZXhwb3J0IGNvbnN0IHsgZnM6IF9fZnMsIHZvbDogX192b2x1bWUgfSA9IG1lbWZzKClcblxuY29uc3QgX193YXNpID0gbmV3IF9fV0FTSSh7XG4gIHZlcnNpb246ICdwcmV2aWV3MScsXG4gIGZzOiBfX2ZzLFxuICBwcmVvcGVuczoge1xuICAgICcvJzogJy8nLFxuICB9LFxufSlgXG4gICAgOiBgXG5jb25zdCBfX3dhc2kgPSBuZXcgX19XQVNJKHtcbiAgdmVyc2lvbjogJ3ByZXZpZXcxJyxcbn0pYFxuXG4gIGNvbnN0IHdvcmtlckZzSGFuZGxlciA9IGZzXG4gICAgPyBgICAgIHdvcmtlci5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgX193YXNtQ3JlYXRlT25NZXNzYWdlRm9yRnNQcm94eShfX2ZzKSlcXG5gXG4gICAgOiAnJ1xuXG4gIGNvbnN0IHdvcmtlckVycm9ySGFuZGxlciA9IGVycm9yRXZlbnRcbiAgICA/IGAgICAgd29ya2VyLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQuZGF0YSAmJiB0eXBlb2YgZXZlbnQuZGF0YSA9PT0gJ29iamVjdCcgJiYgZXZlbnQuZGF0YS50eXBlID09PSAnZXJyb3InKSB7XG4gICAgICAgIHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBDdXN0b21FdmVudCgnbmFwaS1ycy13b3JrZXItZXJyb3InLCB7IGRldGFpbDogZXZlbnQuZGF0YSB9KSlcbiAgICAgIH1cbiAgICB9KVxuYFxuICAgIDogJydcblxuICBjb25zdCBlbW5hcGlJbmplY3RCdWZmZXIgPSBidWZmZXJcbiAgICA/ICdfX2VtbmFwaUNvbnRleHQuZmVhdHVyZS5CdWZmZXIgPSBCdWZmZXInXG4gICAgOiAnJ1xuICBjb25zdCBlbW5hcGlJbnN0YW50aWF0ZUltcG9ydCA9IGFzeW5jSW5pdFxuICAgID8gYGluc3RhbnRpYXRlTmFwaU1vZHVsZSBhcyBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZWBcbiAgICA6IGBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jIGFzIF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlU3luY2BcbiAgY29uc3QgZW1uYXBpSW5zdGFudGlhdGVDYWxsID0gYXN5bmNJbml0XG4gICAgPyBgYXdhaXQgX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVgXG4gICAgOiBgX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jYFxuXG4gIHJldHVybiBgaW1wb3J0IHtcbiAgY3JlYXRlT25NZXNzYWdlIGFzIF9fd2FzbUNyZWF0ZU9uTWVzc2FnZUZvckZzUHJveHksXG4gIGdldERlZmF1bHRDb250ZXh0IGFzIF9fZW1uYXBpR2V0RGVmYXVsdENvbnRleHQsXG4gICR7ZW1uYXBpSW5zdGFudGlhdGVJbXBvcnR9LFxuICBXQVNJIGFzIF9fV0FTSSxcbn0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lJ1xuJHtmc0ltcG9ydH1cbiR7YnVmZmVySW1wb3J0fVxuJHt3YXNpQ3JlYXRpb259XG5cbmNvbnN0IF9fd2FzbVVybCA9IG5ldyBVUkwoJy4vJHt3YXNpRmlsZW5hbWV9Lndhc20nLCBpbXBvcnQubWV0YS51cmwpLmhyZWZcbmNvbnN0IF9fZW1uYXBpQ29udGV4dCA9IF9fZW1uYXBpR2V0RGVmYXVsdENvbnRleHQoKVxuJHtlbW5hcGlJbmplY3RCdWZmZXJ9XG5cbmNvbnN0IF9fc2hhcmVkTWVtb3J5ID0gbmV3IFdlYkFzc2VtYmx5Lk1lbW9yeSh7XG4gIGluaXRpYWw6ICR7aW5pdGlhbE1lbW9yeX0sXG4gIG1heGltdW06ICR7bWF4aW11bU1lbW9yeX0sXG4gIHNoYXJlZDogdHJ1ZSxcbn0pXG5cbmNvbnN0IF9fd2FzbUZpbGUgPSBhd2FpdCBmZXRjaChfX3dhc21VcmwpLnRoZW4oKHJlcykgPT4gcmVzLmFycmF5QnVmZmVyKCkpXG5cbmNvbnN0IHtcbiAgaW5zdGFuY2U6IF9fbmFwaUluc3RhbmNlLFxuICBtb2R1bGU6IF9fd2FzaU1vZHVsZSxcbiAgbmFwaU1vZHVsZTogX19uYXBpTW9kdWxlLFxufSA9ICR7ZW1uYXBpSW5zdGFudGlhdGVDYWxsfShfX3dhc21GaWxlLCB7XG4gIGNvbnRleHQ6IF9fZW1uYXBpQ29udGV4dCxcbiAgYXN5bmNXb3JrUG9vbFNpemU6IDQsXG4gIHdhc2k6IF9fd2FzaSxcbiAgb25DcmVhdGVXb3JrZXIoKSB7XG4gICAgY29uc3Qgd29ya2VyID0gbmV3IFdvcmtlcihuZXcgVVJMKCcuL3dhc2ktd29ya2VyLWJyb3dzZXIubWpzJywgaW1wb3J0Lm1ldGEudXJsKSwge1xuICAgICAgdHlwZTogJ21vZHVsZScsXG4gICAgfSlcbiR7d29ya2VyRnNIYW5kbGVyfVxuJHt3b3JrZXJFcnJvckhhbmRsZXJ9XG4gICAgcmV0dXJuIHdvcmtlclxuICB9LFxuICBvdmVyd3JpdGVJbXBvcnRzKGltcG9ydE9iamVjdCkge1xuICAgIGltcG9ydE9iamVjdC5lbnYgPSB7XG4gICAgICAuLi5pbXBvcnRPYmplY3QuZW52LFxuICAgICAgLi4uaW1wb3J0T2JqZWN0Lm5hcGksXG4gICAgICAuLi5pbXBvcnRPYmplY3QuZW1uYXBpLFxuICAgICAgbWVtb3J5OiBfX3NoYXJlZE1lbW9yeSxcbiAgICB9XG4gICAgcmV0dXJuIGltcG9ydE9iamVjdFxuICB9LFxuICBiZWZvcmVJbml0KHsgaW5zdGFuY2UgfSkge1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiBPYmplY3Qua2V5cyhpbnN0YW5jZS5leHBvcnRzKSkge1xuICAgICAgaWYgKG5hbWUuc3RhcnRzV2l0aCgnX19uYXBpX3JlZ2lzdGVyX18nKSkge1xuICAgICAgICBpbnN0YW5jZS5leHBvcnRzW25hbWVdKClcbiAgICAgIH1cbiAgICB9XG4gIH0sXG59KVxuYFxufVxuXG5leHBvcnQgY29uc3QgY3JlYXRlV2FzaUJpbmRpbmcgPSAoXG4gIHdhc21GaWxlTmFtZTogc3RyaW5nLFxuICBwYWNrYWdlTmFtZTogc3RyaW5nLFxuICBpbml0aWFsTWVtb3J5ID0gNDAwMCxcbiAgbWF4aW11bU1lbW9yeSA9IDY1NTM2LFxuKSA9PiBgLyogZXNsaW50LWRpc2FibGUgKi9cbi8qIHByZXR0aWVyLWlnbm9yZSAqL1xuXG4vKiBhdXRvLWdlbmVyYXRlZCBieSBOQVBJLVJTICovXG5cbmNvbnN0IF9fbm9kZUZzID0gcmVxdWlyZSgnbm9kZTpmcycpXG5jb25zdCBfX25vZGVQYXRoID0gcmVxdWlyZSgnbm9kZTpwYXRoJylcbmNvbnN0IHsgV0FTSTogX19ub2RlV0FTSSB9ID0gcmVxdWlyZSgnbm9kZTp3YXNpJylcbmNvbnN0IHsgV29ya2VyIH0gPSByZXF1aXJlKCdub2RlOndvcmtlcl90aHJlYWRzJylcblxuY29uc3Qge1xuICBjcmVhdGVPbk1lc3NhZ2U6IF9fd2FzbUNyZWF0ZU9uTWVzc2FnZUZvckZzUHJveHksXG4gIGdldERlZmF1bHRDb250ZXh0OiBfX2VtbmFwaUdldERlZmF1bHRDb250ZXh0LFxuICBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jOiBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMsXG59ID0gcmVxdWlyZSgnQG5hcGktcnMvd2FzbS1ydW50aW1lJylcblxuY29uc3QgX19yb290RGlyID0gX19ub2RlUGF0aC5wYXJzZShwcm9jZXNzLmN3ZCgpKS5yb290XG5cbmNvbnN0IF9fd2FzaSA9IG5ldyBfX25vZGVXQVNJKHtcbiAgdmVyc2lvbjogJ3ByZXZpZXcxJyxcbiAgZW52OiBwcm9jZXNzLmVudixcbiAgcHJlb3BlbnM6IHtcbiAgICBbX19yb290RGlyXTogX19yb290RGlyLFxuICB9XG59KVxuXG5jb25zdCBfX2VtbmFwaUNvbnRleHQgPSBfX2VtbmFwaUdldERlZmF1bHRDb250ZXh0KClcblxuY29uc3QgX19zaGFyZWRNZW1vcnkgPSBuZXcgV2ViQXNzZW1ibHkuTWVtb3J5KHtcbiAgaW5pdGlhbDogJHtpbml0aWFsTWVtb3J5fSxcbiAgbWF4aW11bTogJHttYXhpbXVtTWVtb3J5fSxcbiAgc2hhcmVkOiB0cnVlLFxufSlcblxubGV0IF9fd2FzbUZpbGVQYXRoID0gX19ub2RlUGF0aC5qb2luKF9fZGlybmFtZSwgJyR7d2FzbUZpbGVOYW1lfS53YXNtJylcbmNvbnN0IF9fd2FzbURlYnVnRmlsZVBhdGggPSBfX25vZGVQYXRoLmpvaW4oX19kaXJuYW1lLCAnJHt3YXNtRmlsZU5hbWV9LmRlYnVnLndhc20nKVxuXG5pZiAoX19ub2RlRnMuZXhpc3RzU3luYyhfX3dhc21EZWJ1Z0ZpbGVQYXRoKSkge1xuICBfX3dhc21GaWxlUGF0aCA9IF9fd2FzbURlYnVnRmlsZVBhdGhcbn0gZWxzZSBpZiAoIV9fbm9kZUZzLmV4aXN0c1N5bmMoX193YXNtRmlsZVBhdGgpKSB7XG4gIHRyeSB7XG4gICAgX193YXNtRmlsZVBhdGggPSByZXF1aXJlLnJlc29sdmUoJyR7cGFja2FnZU5hbWV9LXdhc20zMi13YXNpLyR7d2FzbUZpbGVOYW1lfS53YXNtJylcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgZmluZCAke3dhc21GaWxlTmFtZX0ud2FzbSBmaWxlLCBhbmQgJHtwYWNrYWdlTmFtZX0td2FzbTMyLXdhc2kgcGFja2FnZSBpcyBub3QgaW5zdGFsbGVkLicpXG4gIH1cbn1cblxuY29uc3QgeyBpbnN0YW5jZTogX19uYXBpSW5zdGFuY2UsIG1vZHVsZTogX193YXNpTW9kdWxlLCBuYXBpTW9kdWxlOiBfX25hcGlNb2R1bGUgfSA9IF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYyhfX25vZGVGcy5yZWFkRmlsZVN5bmMoX193YXNtRmlsZVBhdGgpLCB7XG4gIGNvbnRleHQ6IF9fZW1uYXBpQ29udGV4dCxcbiAgYXN5bmNXb3JrUG9vbFNpemU6IChmdW5jdGlvbigpIHtcbiAgICBjb25zdCB0aHJlYWRzU2l6ZUZyb21FbnYgPSBOdW1iZXIocHJvY2Vzcy5lbnYuTkFQSV9SU19BU1lOQ19XT1JLX1BPT0xfU0laRSA/PyBwcm9jZXNzLmVudi5VVl9USFJFQURQT09MX1NJWkUpXG4gICAgLy8gTmFOID4gMCBpcyBmYWxzZVxuICAgIGlmICh0aHJlYWRzU2l6ZUZyb21FbnYgPiAwKSB7XG4gICAgICByZXR1cm4gdGhyZWFkc1NpemVGcm9tRW52XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiA0XG4gICAgfVxuICB9KSgpLFxuICByZXVzZVdvcmtlcjogdHJ1ZSxcbiAgd2FzaTogX193YXNpLFxuICBvbkNyZWF0ZVdvcmtlcigpIHtcbiAgICBjb25zdCB3b3JrZXIgPSBuZXcgV29ya2VyKF9fbm9kZVBhdGguam9pbihfX2Rpcm5hbWUsICd3YXNpLXdvcmtlci5tanMnKSwge1xuICAgICAgZW52OiBwcm9jZXNzLmVudixcbiAgICB9KVxuICAgIHdvcmtlci5vbm1lc3NhZ2UgPSAoeyBkYXRhIH0pID0+IHtcbiAgICAgIF9fd2FzbUNyZWF0ZU9uTWVzc2FnZUZvckZzUHJveHkoX19ub2RlRnMpKGRhdGEpXG4gICAgfVxuXG4gICAgLy8gVGhlIG1haW4gdGhyZWFkIG9mIE5vZGUuanMgd2FpdHMgZm9yIGFsbCB0aGUgYWN0aXZlIGhhbmRsZXMgYmVmb3JlIGV4aXRpbmcuXG4gICAgLy8gQnV0IFJ1c3QgdGhyZWFkcyBhcmUgbmV2ZXIgd2FpdGVkIHdpdGhvdXQgXFxgdGhyZWFkOjpqb2luXFxgLlxuICAgIC8vIFNvIGhlcmUgd2UgaGFjayB0aGUgY29kZSBvZiBOb2RlLmpzIHRvIHByZXZlbnQgdGhlIHdvcmtlcnMgZnJvbSBiZWluZyByZWZlcmVuY2VkIChhY3RpdmUpLlxuICAgIC8vIEFjY29yZGluZyB0byBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvYmxvYi8xOWUwZDQ3MjcyOGM3OWQ0MThiNzRiZGRmZjU4OGJlYTcwYTQwM2QwL2xpYi9pbnRlcm5hbC93b3JrZXIuanMjTDQxNSxcbiAgICAvLyBhIHdvcmtlciBpcyBjb25zaXN0IG9mIHR3byBoYW5kbGVzOiBrUHVibGljUG9ydCBhbmQga0hhbmRsZS5cbiAgICB7XG4gICAgICBjb25zdCBrUHVibGljUG9ydCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMod29ya2VyKS5maW5kKHMgPT5cbiAgICAgICAgcy50b1N0cmluZygpLmluY2x1ZGVzKFwia1B1YmxpY1BvcnRcIilcbiAgICAgICk7XG4gICAgICBpZiAoa1B1YmxpY1BvcnQpIHtcbiAgICAgICAgd29ya2VyW2tQdWJsaWNQb3J0XS5yZWYgPSAoKSA9PiB7fTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qga0hhbmRsZSA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMod29ya2VyKS5maW5kKHMgPT5cbiAgICAgICAgcy50b1N0cmluZygpLmluY2x1ZGVzKFwia0hhbmRsZVwiKVxuICAgICAgKTtcbiAgICAgIGlmIChrSGFuZGxlKSB7XG4gICAgICAgIHdvcmtlcltrSGFuZGxlXS5yZWYgPSAoKSA9PiB7fTtcbiAgICAgIH1cblxuICAgICAgd29ya2VyLnVucmVmKCk7XG4gICAgfVxuICAgIHJldHVybiB3b3JrZXJcbiAgfSxcbiAgb3ZlcndyaXRlSW1wb3J0cyhpbXBvcnRPYmplY3QpIHtcbiAgICBpbXBvcnRPYmplY3QuZW52ID0ge1xuICAgICAgLi4uaW1wb3J0T2JqZWN0LmVudixcbiAgICAgIC4uLmltcG9ydE9iamVjdC5uYXBpLFxuICAgICAgLi4uaW1wb3J0T2JqZWN0LmVtbmFwaSxcbiAgICAgIG1lbW9yeTogX19zaGFyZWRNZW1vcnksXG4gICAgfVxuICAgIHJldHVybiBpbXBvcnRPYmplY3RcbiAgfSxcbiAgYmVmb3JlSW5pdCh7IGluc3RhbmNlIH0pIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgT2JqZWN0LmtleXMoaW5zdGFuY2UuZXhwb3J0cykpIHtcbiAgICAgIGlmIChuYW1lLnN0YXJ0c1dpdGgoJ19fbmFwaV9yZWdpc3Rlcl9fJykpIHtcbiAgICAgICAgaW5zdGFuY2UuZXhwb3J0c1tuYW1lXSgpXG4gICAgICB9XG4gICAgfVxuICB9LFxufSlcbmBcbiIsImV4cG9ydCBjb25zdCBXQVNJX1dPUktFUl9URU1QTEFURSA9IGBpbXBvcnQgZnMgZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tIFwibm9kZTptb2R1bGVcIjtcbmltcG9ydCB7IHBhcnNlIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgV0FTSSB9IGZyb20gXCJub2RlOndhc2lcIjtcbmltcG9ydCB7IHBhcmVudFBvcnQsIFdvcmtlciB9IGZyb20gXCJub2RlOndvcmtlcl90aHJlYWRzXCI7XG5cbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5cbmNvbnN0IHsgaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYywgTWVzc2FnZUhhbmRsZXIsIGdldERlZmF1bHRDb250ZXh0IH0gPSByZXF1aXJlKFwiQG5hcGktcnMvd2FzbS1ydW50aW1lXCIpO1xuXG5pZiAocGFyZW50UG9ydCkge1xuICBwYXJlbnRQb3J0Lm9uKFwibWVzc2FnZVwiLCAoZGF0YSkgPT4ge1xuICAgIGdsb2JhbFRoaXMub25tZXNzYWdlKHsgZGF0YSB9KTtcbiAgfSk7XG59XG5cbk9iamVjdC5hc3NpZ24oZ2xvYmFsVGhpcywge1xuICBzZWxmOiBnbG9iYWxUaGlzLFxuICByZXF1aXJlLFxuICBXb3JrZXIsXG4gIGltcG9ydFNjcmlwdHM6IGZ1bmN0aW9uIChmKSB7XG4gICAgOygwLCBldmFsKShmcy5yZWFkRmlsZVN5bmMoZiwgXCJ1dGY4XCIpICsgXCIvLyMgc291cmNlVVJMPVwiICsgZik7XG4gIH0sXG4gIHBvc3RNZXNzYWdlOiBmdW5jdGlvbiAobXNnKSB7XG4gICAgaWYgKHBhcmVudFBvcnQpIHtcbiAgICAgIHBhcmVudFBvcnQucG9zdE1lc3NhZ2UobXNnKTtcbiAgICB9XG4gIH0sXG59KTtcblxuY29uc3QgZW1uYXBpQ29udGV4dCA9IGdldERlZmF1bHRDb250ZXh0KCk7XG5cbmNvbnN0IF9fcm9vdERpciA9IHBhcnNlKHByb2Nlc3MuY3dkKCkpLnJvb3Q7XG5cbmNvbnN0IGhhbmRsZXIgPSBuZXcgTWVzc2FnZUhhbmRsZXIoe1xuICBvbkxvYWQoeyB3YXNtTW9kdWxlLCB3YXNtTWVtb3J5IH0pIHtcbiAgICBjb25zdCB3YXNpID0gbmV3IFdBU0koe1xuICAgICAgdmVyc2lvbjogJ3ByZXZpZXcxJyxcbiAgICAgIGVudjogcHJvY2Vzcy5lbnYsXG4gICAgICBwcmVvcGVuczoge1xuICAgICAgICBbX19yb290RGlyXTogX19yb290RGlyLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHJldHVybiBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jKHdhc21Nb2R1bGUsIHtcbiAgICAgIGNoaWxkVGhyZWFkOiB0cnVlLFxuICAgICAgd2FzaSxcbiAgICAgIGNvbnRleHQ6IGVtbmFwaUNvbnRleHQsXG4gICAgICBvdmVyd3JpdGVJbXBvcnRzKGltcG9ydE9iamVjdCkge1xuICAgICAgICBpbXBvcnRPYmplY3QuZW52ID0ge1xuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5lbnYsXG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0Lm5hcGksXG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0LmVtbmFwaSxcbiAgICAgICAgICBtZW1vcnk6IHdhc21NZW1vcnlcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH0sXG59KTtcblxuZ2xvYmFsVGhpcy5vbm1lc3NhZ2UgPSBmdW5jdGlvbiAoZSkge1xuICBoYW5kbGVyLmhhbmRsZShlKTtcbn07XG5gXG5cbmV4cG9ydCBjb25zdCBjcmVhdGVXYXNpQnJvd3NlcldvcmtlckJpbmRpbmcgPSAoXG4gIGZzOiBib29sZWFuLFxuICBlcnJvckV2ZW50OiBib29sZWFuLFxuKSA9PiB7XG4gIGNvbnN0IGZzSW1wb3J0ID0gZnNcbiAgICA/IGBpbXBvcnQgeyBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jLCBNZXNzYWdlSGFuZGxlciwgV0FTSSwgY3JlYXRlRnNQcm94eSB9IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZSdcbmltcG9ydCB7IG1lbWZzRXhwb3J0ZWQgYXMgX19tZW1mc0V4cG9ydGVkIH0gZnJvbSAnQG5hcGktcnMvd2FzbS1ydW50aW1lL2ZzJ1xuXG5jb25zdCBmcyA9IGNyZWF0ZUZzUHJveHkoX19tZW1mc0V4cG9ydGVkKWBcbiAgICA6IGBpbXBvcnQgeyBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jLCBNZXNzYWdlSGFuZGxlciwgV0FTSSB9IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZSdgXG4gIGNvbnN0IGVycm9yT3V0cHV0c0FwcGVuZCA9IGVycm9yRXZlbnRcbiAgICA/IGBcXG4gICAgICAgIGVycm9yT3V0cHV0cy5wdXNoKFsuLi5hcmd1bWVudHNdKWBcbiAgICA6ICcnXG4gIGNvbnN0IHdhc2lDcmVhdGlvbiA9IGZzXG4gICAgPyBgY29uc3Qgd2FzaSA9IG5ldyBXQVNJKHtcbiAgICAgIGZzLFxuICAgICAgcHJlb3BlbnM6IHtcbiAgICAgICAgJy8nOiAnLycsXG4gICAgICB9LFxuICAgICAgcHJpbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKVxuICAgICAgfSxcbiAgICAgIHByaW50RXJyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5lcnJvci5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG4gICAgICAgICR7ZXJyb3JPdXRwdXRzQXBwZW5kfVxuICAgICAgfSxcbiAgICB9KWBcbiAgICA6IGBjb25zdCB3YXNpID0gbmV3IFdBU0koe1xuICAgICAgcHJpbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKVxuICAgICAgfSxcbiAgICAgIHByaW50RXJyOiBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnNvbGVcbiAgICAgICAgY29uc29sZS5lcnJvci5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpXG4gICAgICAgICR7ZXJyb3JPdXRwdXRzQXBwZW5kfVxuICAgICAgfSxcbiAgICB9KWBcbiAgY29uc3QgZXJyb3JIYW5kbGVyID0gZXJyb3JFdmVudFxuICAgID8gYG9uRXJyb3IoZXJyb3IpIHtcbiAgICBwb3N0TWVzc2FnZSh7IHR5cGU6ICdlcnJvcicsIGVycm9yLCBlcnJvck91dHB1dHMgfSlcbiAgICBlcnJvck91dHB1dHMubGVuZ3RoID0gMFxuICB9YFxuICAgIDogJydcbiAgcmV0dXJuIGAke2ZzSW1wb3J0fVxuXG5jb25zdCBlcnJvck91dHB1dHMgPSBbXVxuXG5jb25zdCBoYW5kbGVyID0gbmV3IE1lc3NhZ2VIYW5kbGVyKHtcbiAgb25Mb2FkKHsgd2FzbU1vZHVsZSwgd2FzbU1lbW9yeSB9KSB7XG4gICAgJHt3YXNpQ3JlYXRpb259XG4gICAgcmV0dXJuIGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMod2FzbU1vZHVsZSwge1xuICAgICAgY2hpbGRUaHJlYWQ6IHRydWUsXG4gICAgICB3YXNpLFxuICAgICAgb3ZlcndyaXRlSW1wb3J0cyhpbXBvcnRPYmplY3QpIHtcbiAgICAgICAgaW1wb3J0T2JqZWN0LmVudiA9IHtcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QuZW52LFxuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5uYXBpLFxuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5lbW5hcGksXG4gICAgICAgICAgbWVtb3J5OiB3YXNtTWVtb3J5LFxuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0pXG4gIH0sXG4gICR7ZXJyb3JIYW5kbGVyfVxufSlcblxuZ2xvYmFsVGhpcy5vbm1lc3NhZ2UgPSBmdW5jdGlvbiAoZSkge1xuICBoYW5kbGVyLmhhbmRsZShlKVxufVxuYFxufVxuIiwiaW1wb3J0IHsgc3Bhd24gfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnbm9kZTpjcnlwdG8nXG5pbXBvcnQgeyBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJtU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnXG5pbXBvcnQgeyBob21lZGlyIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCB7IHBhcnNlLCBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgKiBhcyBjb2xvcnMgZnJvbSAnY29sb3JldHRlJ1xuXG5pbXBvcnQgdHlwZSB7IEJ1aWxkT3B0aW9ucyBhcyBSYXdCdWlsZE9wdGlvbnMgfSBmcm9tICcuLi9kZWYvYnVpbGQuanMnXG5pbXBvcnQge1xuICBDTElfVkVSU0lPTixcbiAgY29weUZpbGVBc3luYyxcbiAgdHlwZSBDcmF0ZSxcbiAgZGVidWdGYWN0b3J5LFxuICBERUZBVUxUX1RZUEVfREVGX0hFQURFUixcbiAgZmlsZUV4aXN0cyxcbiAgZ2V0U3lzdGVtRGVmYXVsdFRhcmdldCxcbiAgZ2V0VGFyZ2V0TGlua2VyLFxuICBta2RpckFzeW5jLFxuICB0eXBlIE5hcGlDb25maWcsXG4gIHBhcnNlTWV0YWRhdGEsXG4gIHBhcnNlVHJpcGxlLFxuICBwcm9jZXNzVHlwZURlZixcbiAgcmVhZEZpbGVBc3luYyxcbiAgcmVhZE5hcGlDb25maWcsXG4gIHR5cGUgVGFyZ2V0LFxuICB0YXJnZXRUb0VudlZhcixcbiAgdHJ5SW5zdGFsbENhcmdvQmluYXJ5LFxuICB1bmxpbmtBc3luYyxcbiAgd3JpdGVGaWxlQXN5bmMsXG4gIGRpckV4aXN0c0FzeW5jLFxuICByZWFkZGlyQXN5bmMsXG4gIHR5cGUgQ2FyZ29Xb3Jrc3BhY2VNZXRhZGF0YSxcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmltcG9ydCB7IGNyZWF0ZUNqc0JpbmRpbmcsIGNyZWF0ZUVzbUJpbmRpbmcgfSBmcm9tICcuL3RlbXBsYXRlcy9pbmRleC5qcydcbmltcG9ydCB7XG4gIGNyZWF0ZVdhc2lCaW5kaW5nLFxuICBjcmVhdGVXYXNpQnJvd3NlckJpbmRpbmcsXG59IGZyb20gJy4vdGVtcGxhdGVzL2xvYWQtd2FzaS10ZW1wbGF0ZS5qcydcbmltcG9ydCB7XG4gIGNyZWF0ZVdhc2lCcm93c2VyV29ya2VyQmluZGluZyxcbiAgV0FTSV9XT1JLRVJfVEVNUExBVEUsXG59IGZyb20gJy4vdGVtcGxhdGVzL3dhc2ktd29ya2VyLXRlbXBsYXRlLmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnYnVpbGQnKVxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKVxuXG50eXBlIE91dHB1dEtpbmQgPSAnanMnIHwgJ2R0cycgfCAnbm9kZScgfCAnZXhlJyB8ICd3YXNtJ1xudHlwZSBPdXRwdXQgPSB7IGtpbmQ6IE91dHB1dEtpbmQ7IHBhdGg6IHN0cmluZyB9XG5cbnR5cGUgQnVpbGRPcHRpb25zID0gUmF3QnVpbGRPcHRpb25zICYgeyBjYXJnb09wdGlvbnM/OiBzdHJpbmdbXSB9XG50eXBlIFBhcnNlZEJ1aWxkT3B0aW9ucyA9IE9taXQ8QnVpbGRPcHRpb25zLCAnY3dkJz4gJiB7IGN3ZDogc3RyaW5nIH1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJ1aWxkUHJvamVjdChyYXdPcHRpb25zOiBCdWlsZE9wdGlvbnMpIHtcbiAgZGVidWcoJ25hcGkgYnVpbGQgY29tbWFuZCByZWNlaXZlIG9wdGlvbnM6ICVPJywgcmF3T3B0aW9ucylcblxuICBjb25zdCBvcHRpb25zOiBQYXJzZWRCdWlsZE9wdGlvbnMgPSB7XG4gICAgZHRzQ2FjaGU6IHRydWUsXG4gICAgLi4ucmF3T3B0aW9ucyxcbiAgICBjd2Q6IHJhd09wdGlvbnMuY3dkID8/IHByb2Nlc3MuY3dkKCksXG4gIH1cblxuICBjb25zdCByZXNvbHZlUGF0aCA9ICguLi5wYXRoczogc3RyaW5nW10pID0+IHJlc29sdmUob3B0aW9ucy5jd2QsIC4uLnBhdGhzKVxuXG4gIGNvbnN0IG1hbmlmZXN0UGF0aCA9IHJlc29sdmVQYXRoKG9wdGlvbnMubWFuaWZlc3RQYXRoID8/ICdDYXJnby50b21sJylcbiAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBwYXJzZU1ldGFkYXRhKG1hbmlmZXN0UGF0aClcblxuICBjb25zdCBjcmF0ZSA9IG1ldGFkYXRhLnBhY2thZ2VzLmZpbmQoKHApID0+IHtcbiAgICAvLyBwYWNrYWdlIHdpdGggZ2l2ZW4gbmFtZVxuICAgIGlmIChvcHRpb25zLnBhY2thZ2UpIHtcbiAgICAgIHJldHVybiBwLm5hbWUgPT09IG9wdGlvbnMucGFja2FnZVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcC5tYW5pZmVzdF9wYXRoID09PSBtYW5pZmVzdFBhdGhcbiAgICB9XG4gIH0pXG5cbiAgaWYgKCFjcmF0ZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdVbmFibGUgdG8gZmluZCBjcmF0ZSB0byBidWlsZC4gSXQgc2VlbXMgeW91IGFyZSB0cnlpbmcgdG8gYnVpbGQgYSBjcmF0ZSBpbiBhIHdvcmtzcGFjZSwgdHJ5IHVzaW5nIGAtLXBhY2thZ2VgIG9wdGlvbiB0byBzcGVjaWZ5IHRoZSBwYWNrYWdlIHRvIGJ1aWxkLicsXG4gICAgKVxuICB9XG4gIGNvbnN0IGNvbmZpZyA9IGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgIHJlc29sdmVQYXRoKG9wdGlvbnMucGFja2FnZUpzb25QYXRoID8/ICdwYWNrYWdlLmpzb24nKSxcbiAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlUGF0aChvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICApXG5cbiAgY29uc3QgYnVpbGRlciA9IG5ldyBCdWlsZGVyKG1ldGFkYXRhLCBjcmF0ZSwgY29uZmlnLCBvcHRpb25zKVxuXG4gIHJldHVybiBidWlsZGVyLmJ1aWxkKClcbn1cblxuY2xhc3MgQnVpbGRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYXJnczogc3RyaW5nW10gPSBbXVxuICBwcml2YXRlIHJlYWRvbmx5IGVudnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dHM6IE91dHB1dFtdID0gW11cblxuICBwcml2YXRlIHJlYWRvbmx5IHRhcmdldDogVGFyZ2V0XG4gIHByaXZhdGUgcmVhZG9ubHkgY3JhdGVEaXI6IHN0cmluZ1xuICBwcml2YXRlIHJlYWRvbmx5IG91dHB1dERpcjogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgdGFyZ2V0RGlyOiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSBlbmFibGVUeXBlRGVmOiBib29sZWFuID0gZmFsc2VcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IG1ldGFkYXRhOiBDYXJnb1dvcmtzcGFjZU1ldGFkYXRhLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY3JhdGU6IENyYXRlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBOYXBpQ29uZmlnLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogUGFyc2VkQnVpbGRPcHRpb25zLFxuICApIHtcbiAgICB0aGlzLnRhcmdldCA9IG9wdGlvbnMudGFyZ2V0XG4gICAgICA/IHBhcnNlVHJpcGxlKG9wdGlvbnMudGFyZ2V0KVxuICAgICAgOiBwcm9jZXNzLmVudi5DQVJHT19CVUlMRF9UQVJHRVRcbiAgICAgICAgPyBwYXJzZVRyaXBsZShwcm9jZXNzLmVudi5DQVJHT19CVUlMRF9UQVJHRVQpXG4gICAgICAgIDogZ2V0U3lzdGVtRGVmYXVsdFRhcmdldCgpXG4gICAgdGhpcy5jcmF0ZURpciA9IHBhcnNlKGNyYXRlLm1hbmlmZXN0X3BhdGgpLmRpclxuICAgIHRoaXMub3V0cHV0RGlyID0gcmVzb2x2ZShcbiAgICAgIHRoaXMub3B0aW9ucy5jd2QsXG4gICAgICBvcHRpb25zLm91dHB1dERpciA/PyB0aGlzLmNyYXRlRGlyLFxuICAgIClcbiAgICB0aGlzLnRhcmdldERpciA9XG4gICAgICBvcHRpb25zLnRhcmdldERpciA/P1xuICAgICAgcHJvY2Vzcy5lbnYuQ0FSR09fQlVJTERfVEFSR0VUX0RJUiA/P1xuICAgICAgbWV0YWRhdGEudGFyZ2V0X2RpcmVjdG9yeVxuICAgIHRoaXMuZW5hYmxlVHlwZURlZiA9IHRoaXMuY3JhdGUuZGVwZW5kZW5jaWVzLnNvbWUoXG4gICAgICAoZGVwKSA9PlxuICAgICAgICBkZXAubmFtZSA9PT0gJ25hcGktZGVyaXZlJyAmJlxuICAgICAgICAoZGVwLnVzZXNfZGVmYXVsdF9mZWF0dXJlcyB8fCBkZXAuZmVhdHVyZXMuaW5jbHVkZXMoJ3R5cGUtZGVmJykpLFxuICAgIClcblxuICAgIGlmICghdGhpcy5lbmFibGVUeXBlRGVmKSB7XG4gICAgICBjb25zdCByZXF1aXJlbWVudFdhcm5pbmcgPVxuICAgICAgICAnYG5hcGktZGVyaXZlYCBjcmF0ZSBpcyBub3QgdXNlZCBvciBgdHlwZS1kZWZgIGZlYXR1cmUgaXMgbm90IGVuYWJsZWQgZm9yIGBuYXBpLWRlcml2ZWAgY3JhdGUnXG4gICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICBgJHtyZXF1aXJlbWVudFdhcm5pbmd9LiBXaWxsIHNraXAgYmluZGluZyBnZW5lcmF0aW9uIGZvciBcXGAubm9kZVxcYCwgXFxgLndhc2lcXGAgYW5kIFxcYC5kLnRzXFxgIGZpbGVzLmAsXG4gICAgICApXG5cbiAgICAgIGlmIChcbiAgICAgICAgdGhpcy5vcHRpb25zLmR0cyB8fFxuICAgICAgICB0aGlzLm9wdGlvbnMuZHRzSGVhZGVyIHx8XG4gICAgICAgIHRoaXMuY29uZmlnLmR0c0hlYWRlciB8fFxuICAgICAgICB0aGlzLmNvbmZpZy5kdHNIZWFkZXJGaWxlXG4gICAgICApIHtcbiAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICBgJHtyZXF1aXJlbWVudFdhcm5pbmd9LiBcXGBkdHNcXGAgcmVsYXRlZCBvcHRpb25zIGFyZSBlbmFibGVkIGJ1dCB3aWxsIGJlIGlnbm9yZWQuYCxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldCBjZHlMaWJOYW1lKCkge1xuICAgIHJldHVybiB0aGlzLmNyYXRlLnRhcmdldHMuZmluZCgodCkgPT4gdC5jcmF0ZV90eXBlcy5pbmNsdWRlcygnY2R5bGliJykpXG4gICAgICA/Lm5hbWVcbiAgfVxuXG4gIGdldCBiaW5OYW1lKCkge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLm9wdGlvbnMuYmluID8/XG4gICAgICAvLyBvbmx5IGF2YWlsYWJsZSBpZiBub3QgY2R5bGliIG9yIGJpbiBuYW1lIHNwZWNpZmllZFxuICAgICAgKHRoaXMuY2R5TGliTmFtZVxuICAgICAgICA/IG51bGxcbiAgICAgICAgOiB0aGlzLmNyYXRlLnRhcmdldHMuZmluZCgodCkgPT4gdC5jcmF0ZV90eXBlcy5pbmNsdWRlcygnYmluJykpPy5uYW1lKVxuICAgIClcbiAgfVxuXG4gIGJ1aWxkKCkge1xuICAgIGlmICghdGhpcy5jZHlMaWJOYW1lKSB7XG4gICAgICBjb25zdCB3YXJuaW5nID1cbiAgICAgICAgJ01pc3NpbmcgYGNyYXRlLXR5cGUgPSBbXCJjZHlsaWJcIl1gIGluIFtsaWJdIGNvbmZpZy4gVGhlIGJ1aWxkIHJlc3VsdCB3aWxsIG5vdCBiZSBhdmFpbGFibGUgYXMgbm9kZSBhZGRvbi4nXG5cbiAgICAgIGlmICh0aGlzLmJpbk5hbWUpIHtcbiAgICAgICAgZGVidWcud2Fybih3YXJuaW5nKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHdhcm5pbmcpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGlja0JpbmFyeSgpXG4gICAgICAuc2V0UGFja2FnZSgpXG4gICAgICAuc2V0RmVhdHVyZXMoKVxuICAgICAgLnNldFRhcmdldCgpXG4gICAgICAucGlja0Nyb3NzVG9vbGNoYWluKClcbiAgICAgIC5zZXRFbnZzKClcbiAgICAgIC5zZXRCeXBhc3NBcmdzKClcbiAgICAgIC5leGVjKClcbiAgfVxuXG4gIHByaXZhdGUgcGlja0Nyb3NzVG9vbGNoYWluKCkge1xuICAgIGlmICghdGhpcy5vcHRpb25zLnVzZU5hcGlDcm9zcykge1xuICAgICAgcmV0dXJuIHRoaXNcbiAgICB9XG4gICAgaWYgKHRoaXMub3B0aW9ucy51c2VDcm9zcykge1xuICAgICAgZGVidWcud2FybihcbiAgICAgICAgJ1lvdSBhcmUgdHJ5aW5nIHRvIHVzZSBib3RoIGAtLWNyb3NzYCBhbmQgYC0tdXNlLW5hcGktY3Jvc3NgIG9wdGlvbnMsIGAtLXVzZS1jcm9zc2Agd2lsbCBiZSBpZ25vcmVkLicsXG4gICAgICApXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5jcm9zc0NvbXBpbGUpIHtcbiAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICdZb3UgYXJlIHRyeWluZyB0byB1c2UgYm90aCBgLS1jcm9zcy1jb21waWxlYCBhbmQgYC0tdXNlLW5hcGktY3Jvc3NgIG9wdGlvbnMsIGAtLWNyb3NzLWNvbXBpbGVgIHdpbGwgYmUgaWdub3JlZC4nLFxuICAgICAgKVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IHZlcnNpb24sIGRvd25sb2FkIH0gPSByZXF1aXJlKCdAbmFwaS1ycy9jcm9zcy10b29sY2hhaW4nKVxuXG4gICAgICBjb25zdCBhbGlhczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICAgJ3MzOTB4LXVua25vd24tbGludXgtZ251JzogJ3MzOTB4LWlibS1saW51eC1nbnUnLFxuICAgICAgfVxuXG4gICAgICBjb25zdCB0b29sY2hhaW5QYXRoID0gam9pbihcbiAgICAgICAgaG9tZWRpcigpLFxuICAgICAgICAnLm5hcGktcnMnLFxuICAgICAgICAnY3Jvc3MtdG9vbGNoYWluJyxcbiAgICAgICAgdmVyc2lvbixcbiAgICAgICAgdGhpcy50YXJnZXQudHJpcGxlLFxuICAgICAgKVxuICAgICAgbWtkaXJTeW5jKHRvb2xjaGFpblBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gICAgICBpZiAoZXhpc3RzU3luYyhqb2luKHRvb2xjaGFpblBhdGgsICdwYWNrYWdlLmpzb24nKSkpIHtcbiAgICAgICAgZGVidWcoYFRvb2xjaGFpbiAke3Rvb2xjaGFpblBhdGh9IGV4aXN0cywgc2tpcCBleHRyYWN0aW5nYClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHRhckFyY2hpdmUgPSBkb3dubG9hZChwcm9jZXNzLmFyY2gsIHRoaXMudGFyZ2V0LnRyaXBsZSlcbiAgICAgICAgdGFyQXJjaGl2ZS51bnBhY2sodG9vbGNoYWluUGF0aClcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVwcGVyQ2FzZVRhcmdldCA9IHRhcmdldFRvRW52VmFyKHRoaXMudGFyZ2V0LnRyaXBsZSlcbiAgICAgIGNvbnN0IGNyb3NzVGFyZ2V0TmFtZSA9IGFsaWFzW3RoaXMudGFyZ2V0LnRyaXBsZV0gPz8gdGhpcy50YXJnZXQudHJpcGxlXG4gICAgICBjb25zdCBsaW5rZXJFbnYgPSBgQ0FSR09fVEFSR0VUXyR7dXBwZXJDYXNlVGFyZ2V0fV9MSU5LRVJgXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICBsaW5rZXJFbnYsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tZ2NjYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX1NZU1JPT1QnLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsIGNyb3NzVGFyZ2V0TmFtZSwgJ3N5c3Jvb3QnKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQVInLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LWFyYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX1JBTkxJQicsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tcmFubGliYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX1JFQURFTEYnLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LXJlYWRlbGZgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ19JTkNMVURFX1BBVEgnLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsIGNyb3NzVGFyZ2V0TmFtZSwgJ3N5c3Jvb3QnLCAndXNyJywgJ2luY2x1ZGUvJyksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NDJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1nY2NgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ1hYJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1nKytgKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdCSU5ER0VOX0VYVFJBX0NMQU5HX0FSR1MnLFxuICAgICAgICBgLS1zeXNyb290PSR7dGhpcy5lbnZzLlRBUkdFVF9TWVNST09UfX1gLFxuICAgICAgKVxuXG4gICAgICBpZiAoXG4gICAgICAgIHByb2Nlc3MuZW52LlRBUkdFVF9DQz8uc3RhcnRzV2l0aCgnY2xhbmcnKSB8fFxuICAgICAgICAocHJvY2Vzcy5lbnYuQ0M/LnN0YXJ0c1dpdGgoJ2NsYW5nJykgJiYgIXByb2Nlc3MuZW52LlRBUkdFVF9DQylcbiAgICAgICkge1xuICAgICAgICBjb25zdCBUQVJHRVRfQ0ZMQUdTID0gcHJvY2Vzcy5lbnYuVEFSR0VUX0NGTEFHUyA/PyAnJ1xuICAgICAgICB0aGlzLmVudnMuVEFSR0VUX0NGTEFHUyA9IGAtLXN5c3Jvb3Q9JHt0aGlzLmVudnMuVEFSR0VUX1NZU1JPT1R9IC0tZ2NjLXRvb2xjaGFpbj0ke3Rvb2xjaGFpblBhdGh9ICR7VEFSR0VUX0NGTEFHU31gXG4gICAgICB9XG4gICAgICBpZiAoXG4gICAgICAgIChwcm9jZXNzLmVudi5DWFg/LnN0YXJ0c1dpdGgoJ2NsYW5nKysnKSAmJiAhcHJvY2Vzcy5lbnYuVEFSR0VUX0NYWCkgfHxcbiAgICAgICAgcHJvY2Vzcy5lbnYuVEFSR0VUX0NYWD8uc3RhcnRzV2l0aCgnY2xhbmcrKycpXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgVEFSR0VUX0NYWEZMQUdTID0gcHJvY2Vzcy5lbnYuVEFSR0VUX0NYWEZMQUdTID8/ICcnXG4gICAgICAgIHRoaXMuZW52cy5UQVJHRVRfQ1hYRkxBR1MgPSBgLS1zeXNyb290PSR7dGhpcy5lbnZzLlRBUkdFVF9TWVNST09UfSAtLWdjYy10b29sY2hhaW49JHt0b29sY2hhaW5QYXRofSAke1RBUkdFVF9DWFhGTEFHU31gXG4gICAgICB9XG4gICAgICB0aGlzLmVudnMuUEFUSCA9IHRoaXMuZW52cy5QQVRIXG4gICAgICAgID8gYCR7dG9vbGNoYWluUGF0aH0vYmluOiR7dGhpcy5lbnZzLlBBVEh9OiR7cHJvY2Vzcy5lbnYuUEFUSH1gXG4gICAgICAgIDogYCR7dG9vbGNoYWluUGF0aH0vYmluOiR7cHJvY2Vzcy5lbnYuUEFUSH1gXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZGVidWcud2FybignUGljayBjcm9zcyB0b29sY2hhaW4gZmFpbGVkJywgZSBhcyBFcnJvcilcbiAgICAgIC8vIGlnbm9yZSwgZG8gbm90aGluZ1xuICAgIH1cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBleGVjKCkge1xuICAgIGRlYnVnKGBTdGFydCBidWlsZGluZyBjcmF0ZTogJHt0aGlzLmNyYXRlLm5hbWV9YClcbiAgICBkZWJ1ZygnICAlaScsIGBjYXJnbyAke3RoaXMuYXJncy5qb2luKCcgJyl9YClcblxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKClcblxuICAgIGNvbnN0IHdhdGNoID0gdGhpcy5vcHRpb25zLndhdGNoXG4gICAgY29uc3QgYnVpbGRUYXNrID0gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgaWYgKHRoaXMub3B0aW9ucy51c2VDcm9zcyAmJiB0aGlzLm9wdGlvbnMuY3Jvc3NDb21waWxlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAnYC0tdXNlLWNyb3NzYCBhbmQgYC0tY3Jvc3MtY29tcGlsZWAgY2FuIG5vdCBiZSB1c2VkIHRvZ2V0aGVyJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgY29uc3QgY29tbWFuZCA9XG4gICAgICAgIHByb2Nlc3MuZW52LkNBUkdPID8/ICh0aGlzLm9wdGlvbnMudXNlQ3Jvc3MgPyAnY3Jvc3MnIDogJ2NhcmdvJylcbiAgICAgIGNvbnN0IGJ1aWxkUHJvY2VzcyA9IHNwYXduKGNvbW1hbmQsIHRoaXMuYXJncywge1xuICAgICAgICBlbnY6IHsgLi4ucHJvY2Vzcy5lbnYsIC4uLnRoaXMuZW52cyB9LFxuICAgICAgICBzdGRpbzogd2F0Y2ggPyBbJ2luaGVyaXQnLCAnaW5oZXJpdCcsICdwaXBlJ10gOiAnaW5oZXJpdCcsXG4gICAgICAgIGN3ZDogdGhpcy5vcHRpb25zLmN3ZCxcbiAgICAgICAgc2lnbmFsOiBjb250cm9sbGVyLnNpZ25hbCxcbiAgICAgIH0pXG5cbiAgICAgIGJ1aWxkUHJvY2Vzcy5vbmNlKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICBkZWJ1ZygnJWknLCBgQnVpbGQgY3JhdGUgJHt0aGlzLmNyYXRlLm5hbWV9IHN1Y2Nlc3NmdWxseSFgKVxuICAgICAgICAgIHJlc29sdmUoKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYEJ1aWxkIGZhaWxlZCB3aXRoIGV4aXQgY29kZSAke2NvZGV9YCkpXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIGJ1aWxkUHJvY2Vzcy5vbmNlKCdlcnJvcicsIChlKSA9PiB7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoYEJ1aWxkIGZhaWxlZCB3aXRoIGVycm9yOiAke2UubWVzc2FnZX1gLCB7IGNhdXNlOiBlIH0pKVxuICAgICAgfSlcblxuICAgICAgLy8gd2F0Y2ggbW9kZSBvbmx5LCB0aGV5IGFyZSBwaXBlZCB0aHJvdWdoIHN0ZGVyclxuICAgICAgYnVpbGRQcm9jZXNzLnN0ZGVycj8ub24oJ2RhdGEnLCAoZGF0YSkgPT4ge1xuICAgICAgICBjb25zdCBvdXRwdXQgPSBkYXRhLnRvU3RyaW5nKClcbiAgICAgICAgY29uc29sZS5lcnJvcihvdXRwdXQpXG4gICAgICAgIGlmICgvRmluaXNoZWRcXHMoYGRldmB8YHJlbGVhc2VgKS8udGVzdChvdXRwdXQpKSB7XG4gICAgICAgICAgdGhpcy5wb3N0QnVpbGQoKS5jYXRjaCgoKSA9PiB7fSlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRhc2s6IGJ1aWxkVGFzay50aGVuKCgpID0+IHRoaXMucG9zdEJ1aWxkKCkpLFxuICAgICAgYWJvcnQ6ICgpID0+IGNvbnRyb2xsZXIuYWJvcnQoKSxcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHBpY2tCaW5hcnkoKSB7XG4gICAgbGV0IHNldCA9IGZhbHNlXG4gICAgaWYgKHRoaXMub3B0aW9ucy53YXRjaCkge1xuICAgICAgaWYgKHByb2Nlc3MuZW52LkNJKSB7XG4gICAgICAgIGRlYnVnLndhcm4oJ1dhdGNoIG1vZGUgaXMgbm90IHN1cHBvcnRlZCBpbiBDSSBlbnZpcm9ubWVudCcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWJ1ZygnVXNlICVpJywgJ2NhcmdvLXdhdGNoJylcbiAgICAgICAgdHJ5SW5zdGFsbENhcmdvQmluYXJ5KCdjYXJnby13YXRjaCcsICd3YXRjaCcpXG4gICAgICAgIC8vIHlhcm4gbmFwaSB3YXRjaCAtLXRhcmdldCB4ODZfNjQtdW5rbm93bi1saW51eC1nbnUgWy0tY3Jvc3MtY29tcGlsZV1cbiAgICAgICAgLy8gPT09PlxuICAgICAgICAvLyBjYXJnbyB3YXRjaCBbLi4uXSAtLSBidWlsZCAtLXRhcmdldCB4ODZfNjQtdW5rbm93bi1saW51eC1nbnVcbiAgICAgICAgLy8gY2FyZ28gd2F0Y2ggWy4uLl0gLS0gemlnYnVpbGQgLS10YXJnZXQgeDg2XzY0LXVua25vd24tbGludXgtZ251XG4gICAgICAgIHRoaXMuYXJncy5wdXNoKFxuICAgICAgICAgICd3YXRjaCcsXG4gICAgICAgICAgJy0td2h5JyxcbiAgICAgICAgICAnLWknLFxuICAgICAgICAgICcqLntqcyx0cyxub2RlfScsXG4gICAgICAgICAgJy13JyxcbiAgICAgICAgICB0aGlzLmNyYXRlRGlyLFxuICAgICAgICAgICctLScsXG4gICAgICAgICAgJ2NhcmdvJyxcbiAgICAgICAgICAnYnVpbGQnLFxuICAgICAgICApXG4gICAgICAgIHNldCA9IHRydWVcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLmNyb3NzQ29tcGlsZSkge1xuICAgICAgaWYgKHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInKSB7XG4gICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgICdZb3UgYXJlIHRyeWluZyB0byBjcm9zcyBjb21waWxlIHRvIHdpbjMyIHBsYXRmb3JtIG9uIHdpbjMyIHBsYXRmb3JtIHdoaWNoIGlzIHVubmVjZXNzYXJ5LicsXG4gICAgICAgICAgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHVzZSBjYXJnby14d2luIHRvIGNyb3NzIGNvbXBpbGUgdG8gd2luMzIgcGxhdGZvcm1cbiAgICAgICAgICBkZWJ1ZygnVXNlICVpJywgJ2NhcmdvLXh3aW4nKVxuICAgICAgICAgIHRyeUluc3RhbGxDYXJnb0JpbmFyeSgnY2FyZ28teHdpbicsICd4d2luJylcbiAgICAgICAgICB0aGlzLmFyZ3MucHVzaCgneHdpbicsICdidWlsZCcpXG4gICAgICAgICAgaWYgKHRoaXMudGFyZ2V0LmFyY2ggPT09ICdpYTMyJykge1xuICAgICAgICAgICAgdGhpcy5lbnZzLlhXSU5fQVJDSCA9ICd4ODYnXG4gICAgICAgICAgfVxuICAgICAgICAgIHNldCA9IHRydWVcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnbGludXgnICYmXG4gICAgICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2xpbnV4JyAmJlxuICAgICAgICAgIHRoaXMudGFyZ2V0LmFyY2ggPT09IHByb2Nlc3MuYXJjaCAmJlxuICAgICAgICAgIChmdW5jdGlvbiAoYWJpOiBzdHJpbmcgfCBudWxsKSB7XG4gICAgICAgICAgICBjb25zdCBnbGliY1ZlcnNpb25SdW50aW1lID1cbiAgICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgICAgICAgICAgICBwcm9jZXNzLnJlcG9ydD8uZ2V0UmVwb3J0KCk/LmhlYWRlcj8uZ2xpYmNWZXJzaW9uUnVudGltZVxuICAgICAgICAgICAgY29uc3QgbGliYyA9IGdsaWJjVmVyc2lvblJ1bnRpbWUgPyAnZ251JyA6ICdtdXNsJ1xuICAgICAgICAgICAgcmV0dXJuIGFiaSA9PT0gbGliY1xuICAgICAgICAgIH0pKHRoaXMudGFyZ2V0LmFiaSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgICdZb3UgYXJlIHRyeWluZyB0byBjcm9zcyBjb21waWxlIHRvIGxpbnV4IHRhcmdldCBvbiBsaW51eCBwbGF0Zm9ybSB3aGljaCBpcyB1bm5lY2Vzc2FyeS4nLFxuICAgICAgICAgIClcbiAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ2RhcndpbicgJiZcbiAgICAgICAgICBwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJ1xuICAgICAgICApIHtcbiAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgJ1lvdSBhcmUgdHJ5aW5nIHRvIGNyb3NzIGNvbXBpbGUgdG8gZGFyd2luIHRhcmdldCBvbiBkYXJ3aW4gcGxhdGZvcm0gd2hpY2ggaXMgdW5uZWNlc3NhcnkuJyxcbiAgICAgICAgICApXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdXNlIGNhcmdvLXppZ2J1aWxkIHRvIGNyb3NzIGNvbXBpbGUgdG8gb3RoZXIgcGxhdGZvcm1zXG4gICAgICAgICAgZGVidWcoJ1VzZSAlaScsICdjYXJnby16aWdidWlsZCcpXG4gICAgICAgICAgdHJ5SW5zdGFsbENhcmdvQmluYXJ5KCdjYXJnby16aWdidWlsZCcsICd6aWdidWlsZCcpXG4gICAgICAgICAgdGhpcy5hcmdzLnB1c2goJ3ppZ2J1aWxkJylcbiAgICAgICAgICBzZXQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXNldCkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJ2J1aWxkJylcbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgc2V0UGFja2FnZSgpIHtcbiAgICBjb25zdCBhcmdzID0gW11cblxuICAgIGlmICh0aGlzLm9wdGlvbnMucGFja2FnZSkge1xuICAgICAgYXJncy5wdXNoKCctLXBhY2thZ2UnLCB0aGlzLm9wdGlvbnMucGFja2FnZSlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5iaW5OYW1lKSB7XG4gICAgICBhcmdzLnB1c2goJy0tYmluJywgdGhpcy5iaW5OYW1lKVxuICAgIH1cblxuICAgIGlmIChhcmdzLmxlbmd0aCkge1xuICAgICAgZGVidWcoJ1NldCBwYWNrYWdlIGZsYWdzOiAnKVxuICAgICAgZGVidWcoJyAgJU8nLCBhcmdzKVxuICAgICAgdGhpcy5hcmdzLnB1c2goLi4uYXJncylcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRUYXJnZXQoKSB7XG4gICAgZGVidWcoJ1NldCBjb21waWxpbmcgdGFyZ2V0IHRvOiAnKVxuICAgIGRlYnVnKCcgICVpJywgdGhpcy50YXJnZXQudHJpcGxlKVxuXG4gICAgdGhpcy5hcmdzLnB1c2goJy0tdGFyZ2V0JywgdGhpcy50YXJnZXQudHJpcGxlKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgc2V0RW52cygpIHtcbiAgICAvLyBUWVBFIERFRlxuICAgIGlmICh0aGlzLmVuYWJsZVR5cGVEZWYpIHtcbiAgICAgIHRoaXMuZW52cy5OQVBJX1RZUEVfREVGX1RNUF9GT0xERVIgPVxuICAgICAgICB0aGlzLmdlbmVyYXRlSW50ZXJtZWRpYXRlVHlwZURlZkZvbGRlcigpXG4gICAgICB0aGlzLnNldEZvcmNlQnVpbGRFbnZzKHRoaXMuZW52cy5OQVBJX1RZUEVfREVGX1RNUF9GT0xERVIpXG4gICAgfVxuXG4gICAgLy8gUlVTVEZMQUdTXG4gICAgbGV0IHJ1c3RmbGFncyA9XG4gICAgICBwcm9jZXNzLmVudi5SVVNURkxBR1MgPz8gcHJvY2Vzcy5lbnYuQ0FSR09fQlVJTERfUlVTVEZMQUdTID8/ICcnXG5cbiAgICBpZiAoXG4gICAgICB0aGlzLnRhcmdldC5hYmk/LmluY2x1ZGVzKCdtdXNsJykgJiZcbiAgICAgICFydXN0ZmxhZ3MuaW5jbHVkZXMoJ3RhcmdldC1mZWF0dXJlPS1jcnQtc3RhdGljJylcbiAgICApIHtcbiAgICAgIHJ1c3RmbGFncyArPSAnIC1DIHRhcmdldC1mZWF0dXJlPS1jcnQtc3RhdGljJ1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMuc3RyaXAgJiYgIXJ1c3RmbGFncy5pbmNsdWRlcygnbGluay1hcmc9LXMnKSkge1xuICAgICAgcnVzdGZsYWdzICs9ICcgLUMgbGluay1hcmc9LXMnXG4gICAgfVxuXG4gICAgaWYgKHJ1c3RmbGFncy5sZW5ndGgpIHtcbiAgICAgIHRoaXMuZW52cy5SVVNURkxBR1MgPSBydXN0ZmxhZ3NcbiAgICB9XG4gICAgLy8gRU5EIFJVU1RGTEFHU1xuXG4gICAgLy8gTElOS0VSXG4gICAgY29uc3QgbGlua2VyID0gdGhpcy5vcHRpb25zLmNyb3NzQ29tcGlsZVxuICAgICAgPyB2b2lkIDBcbiAgICAgIDogZ2V0VGFyZ2V0TGlua2VyKHRoaXMudGFyZ2V0LnRyaXBsZSlcbiAgICAvLyBUT0RPOlxuICAgIC8vICAgZGlyZWN0bHkgc2V0IENBUkdPX1RBUkdFVF88dGFyZ2V0Pl9MSU5LRVIgd2lsbCBjb3ZlciAuY2FyZ28vY29uZmlnLnRvbWxcbiAgICAvLyAgIHdpbGwgZGV0ZWN0IGJ5IGNhcmdvIGNvbmZpZyB3aGVuIGl0IGJlY29tZXMgc3RhYmxlXG4gICAgLy8gICBzZWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9ydXN0LWxhbmcvY2FyZ28vaXNzdWVzLzkzMDFcbiAgICBjb25zdCBsaW5rZXJFbnYgPSBgQ0FSR09fVEFSR0VUXyR7dGFyZ2V0VG9FbnZWYXIoXG4gICAgICB0aGlzLnRhcmdldC50cmlwbGUsXG4gICAgKX1fTElOS0VSYFxuICAgIGlmIChsaW5rZXIgJiYgIXByb2Nlc3MuZW52W2xpbmtlckVudl0gJiYgIXRoaXMuZW52c1tsaW5rZXJFbnZdKSB7XG4gICAgICB0aGlzLmVudnNbbGlua2VyRW52XSA9IGxpbmtlclxuICAgIH1cblxuICAgIGlmICh0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ2FuZHJvaWQnKSB7XG4gICAgICB0aGlzLnNldEFuZHJvaWRFbnYoKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dhc2knKSB7XG4gICAgICB0aGlzLnNldFdhc2lFbnYoKVxuICAgIH1cblxuICAgIGlmICh0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ29wZW5oYXJtb255Jykge1xuICAgICAgdGhpcy5zZXRPcGVuSGFybW9ueUVudigpXG4gICAgfVxuXG4gICAgZGVidWcoJ1NldCBlbnZzOiAnKVxuICAgIE9iamVjdC5lbnRyaWVzKHRoaXMuZW52cykuZm9yRWFjaCgoW2ssIHZdKSA9PiB7XG4gICAgICBkZWJ1ZygnICAlaScsIGAke2t9PSR7dn1gKVxuICAgIH0pXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRGb3JjZUJ1aWxkRW52cyh0eXBlRGVmVG1wRm9sZGVyOiBzdHJpbmcpIHtcbiAgICAvLyBkeW5hbWljYWxseSBjaGVjayBhbGwgbmFwaS1ycyBkZXBzIGFuZCBzZXQgYE5BUElfRk9SQ0VfQlVJTERfe3VwcGVyY2FzZShzbmFrZV9jYXNlKG5hbWUpKX0gPSB0aW1lc3RhbXBgXG4gICAgdGhpcy5tZXRhZGF0YS5wYWNrYWdlcy5mb3JFYWNoKChjcmF0ZSkgPT4ge1xuICAgICAgaWYgKFxuICAgICAgICBjcmF0ZS5kZXBlbmRlbmNpZXMuc29tZSgoZCkgPT4gZC5uYW1lID09PSAnbmFwaS1kZXJpdmUnKSAmJlxuICAgICAgICAhZXhpc3RzU3luYyhqb2luKHR5cGVEZWZUbXBGb2xkZXIsIGNyYXRlLm5hbWUpKVxuICAgICAgKSB7XG4gICAgICAgIHRoaXMuZW52c1tcbiAgICAgICAgICBgTkFQSV9GT1JDRV9CVUlMRF8ke2NyYXRlLm5hbWUucmVwbGFjZSgvLS9nLCAnXycpLnRvVXBwZXJDYXNlKCl9YFxuICAgICAgICBdID0gRGF0ZS5ub3coKS50b1N0cmluZygpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgc2V0QW5kcm9pZEVudigpIHtcbiAgICBjb25zdCB7IEFORFJPSURfTkRLX0xBVEVTVF9IT01FIH0gPSBwcm9jZXNzLmVudlxuICAgIGlmICghQU5EUk9JRF9OREtfTEFURVNUX0hPTUUpIHtcbiAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgIGAke2NvbG9ycy5yZWQoXG4gICAgICAgICAgJ0FORFJPSURfTkRLX0xBVEVTVF9IT01FJyxcbiAgICAgICAgKX0gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbWlzc2luZ2AsXG4gICAgICApXG4gICAgfVxuXG4gICAgLy8gc2tpcCBjcm9zcyBjb21waWxlIHNldHVwIGlmIGhvc3QgaXMgYW5kcm9pZFxuICAgIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnYW5kcm9pZCcpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldEFyY2ggPSB0aGlzLnRhcmdldC5hcmNoID09PSAnYXJtJyA/ICdhcm12N2EnIDogJ2FhcmNoNjQnXG4gICAgY29uc3QgdGFyZ2V0UGxhdGZvcm0gPVxuICAgICAgdGhpcy50YXJnZXQuYXJjaCA9PT0gJ2FybScgPyAnYW5kcm9pZGVhYmkyNCcgOiAnYW5kcm9pZDI0J1xuICAgIGNvbnN0IGhvc3RQbGF0Zm9ybSA9XG4gICAgICBwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJ1xuICAgICAgICA/ICdkYXJ3aW4nXG4gICAgICAgIDogcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xuICAgICAgICAgID8gJ3dpbmRvd3MnXG4gICAgICAgICAgOiAnbGludXgnXG4gICAgT2JqZWN0LmFzc2lnbih0aGlzLmVudnMsIHtcbiAgICAgIENBUkdPX1RBUkdFVF9BQVJDSDY0X0xJTlVYX0FORFJPSURfTElOS0VSOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluLyR7dGFyZ2V0QXJjaH0tbGludXgtYW5kcm9pZDI0LWNsYW5nYCxcbiAgICAgIENBUkdPX1RBUkdFVF9BUk1WN19MSU5VWF9BTkRST0lERUFCSV9MSU5LRVI6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vJHt0YXJnZXRBcmNofS1saW51eC1hbmRyb2lkZWFiaTI0LWNsYW5nYCxcbiAgICAgIFRBUkdFVF9DQzogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi8ke3RhcmdldEFyY2h9LWxpbnV4LSR7dGFyZ2V0UGxhdGZvcm19LWNsYW5nYCxcbiAgICAgIFRBUkdFVF9DWFg6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vJHt0YXJnZXRBcmNofS1saW51eC0ke3RhcmdldFBsYXRmb3JtfS1jbGFuZysrYCxcbiAgICAgIFRBUkdFVF9BUjogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi9sbHZtLWFyYCxcbiAgICAgIFRBUkdFVF9SQU5MSUI6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vbGx2bS1yYW5saWJgLFxuICAgICAgQU5EUk9JRF9OREs6IEFORFJPSURfTkRLX0xBVEVTVF9IT01FLFxuICAgICAgUEFUSDogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2JpbiR7cHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyA/ICc7JyA6ICc6J30ke3Byb2Nlc3MuZW52LlBBVEh9YCxcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBzZXRXYXNpRW52KCkge1xuICAgIGNvbnN0IGVtbmFwaSA9IGpvaW4oXG4gICAgICByZXF1aXJlLnJlc29sdmUoJ2VtbmFwaScpLFxuICAgICAgJy4uJyxcbiAgICAgICdsaWInLFxuICAgICAgJ3dhc20zMi13YXNpLXRocmVhZHMnLFxuICAgIClcbiAgICB0aGlzLmVudnMuRU1OQVBJX0xJTktfRElSID0gZW1uYXBpXG4gICAgY29uc3QgZW1uYXBpVmVyc2lvbiA9IHJlcXVpcmUoJ2VtbmFwaS9wYWNrYWdlLmpzb24nKS52ZXJzaW9uXG4gICAgY29uc3QgcHJvamVjdFJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGpvaW4odGhpcy5vcHRpb25zLmN3ZCwgJ3BhY2thZ2UuanNvbicpKVxuICAgIGNvbnN0IGVtbmFwaUNvcmVWZXJzaW9uID0gcHJvamVjdFJlcXVpcmUoJ0BlbW5hcGkvY29yZScpLnZlcnNpb25cbiAgICBjb25zdCBlbW5hcGlSdW50aW1lVmVyc2lvbiA9IHByb2plY3RSZXF1aXJlKCdAZW1uYXBpL3J1bnRpbWUnKS52ZXJzaW9uXG5cbiAgICBpZiAoXG4gICAgICBlbW5hcGlWZXJzaW9uICE9PSBlbW5hcGlDb3JlVmVyc2lvbiB8fFxuICAgICAgZW1uYXBpVmVyc2lvbiAhPT0gZW1uYXBpUnVudGltZVZlcnNpb25cbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYGVtbmFwaSB2ZXJzaW9uIG1pc21hdGNoOiBlbW5hcGlAJHtlbW5hcGlWZXJzaW9ufSwgQGVtbmFwaS9jb3JlQCR7ZW1uYXBpQ29yZVZlcnNpb259LCBAZW1uYXBpL3J1bnRpbWVAJHtlbW5hcGlSdW50aW1lVmVyc2lvbn0uIFBsZWFzZSBlbnN1cmUgYWxsIGVtbmFwaSBwYWNrYWdlcyBhcmUgdGhlIHNhbWUgdmVyc2lvbi5gLFxuICAgICAgKVxuICAgIH1cbiAgICBjb25zdCB7IFdBU0lfU0RLX1BBVEggfSA9IHByb2Nlc3MuZW52XG5cbiAgICBpZiAoV0FTSV9TREtfUEFUSCAmJiBleGlzdHNTeW5jKFdBU0lfU0RLX1BBVEgpKSB7XG4gICAgICB0aGlzLmVudnMuQ0FSR09fVEFSR0VUX1dBU00zMl9XQVNJX1BSRVZJRVcxX1RIUkVBRFNfTElOS0VSID0gam9pbihcbiAgICAgICAgV0FTSV9TREtfUEFUSCxcbiAgICAgICAgJ2JpbicsXG4gICAgICAgICd3YXNtLWxkJyxcbiAgICAgIClcbiAgICAgIHRoaXMuZW52cy5DQVJHT19UQVJHRVRfV0FTTTMyX1dBU0lQMV9MSU5LRVIgPSBqb2luKFxuICAgICAgICBXQVNJX1NES19QQVRILFxuICAgICAgICAnYmluJyxcbiAgICAgICAgJ3dhc20tbGQnLFxuICAgICAgKVxuICAgICAgdGhpcy5lbnZzLkNBUkdPX1RBUkdFVF9XQVNNMzJfV0FTSVAxX1RIUkVBRFNfTElOS0VSID0gam9pbihcbiAgICAgICAgV0FTSV9TREtfUEFUSCxcbiAgICAgICAgJ2JpbicsXG4gICAgICAgICd3YXNtLWxkJyxcbiAgICAgIClcbiAgICAgIHRoaXMuZW52cy5DQVJHT19UQVJHRVRfV0FTTTMyX1dBU0lQMl9MSU5LRVIgPSBqb2luKFxuICAgICAgICBXQVNJX1NES19QQVRILFxuICAgICAgICAnYmluJyxcbiAgICAgICAgJ3dhc20tbGQnLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0NDJywgam9pbihXQVNJX1NES19QQVRILCAnYmluJywgJ2NsYW5nJykpXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NYWCcsXG4gICAgICAgIGpvaW4oV0FTSV9TREtfUEFUSCwgJ2JpbicsICdjbGFuZysrJyksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQVInLCBqb2luKFdBU0lfU0RLX1BBVEgsICdiaW4nLCAnYXInKSlcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfUkFOTElCJyxcbiAgICAgICAgam9pbihXQVNJX1NES19QQVRILCAnYmluJywgJ3JhbmxpYicpLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DRkxBR1MnLFxuICAgICAgICBgLS10YXJnZXQ9d2FzbTMyLXdhc2ktdGhyZWFkcyAtLXN5c3Jvb3Q9JHtXQVNJX1NES19QQVRIfS9zaGFyZS93YXNpLXN5c3Jvb3QgLXB0aHJlYWQgLW1sbHZtIC13YXNtLWVuYWJsZS1zamxqYCxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ1hYRkxBR1MnLFxuICAgICAgICBgLS10YXJnZXQ9d2FzbTMyLXdhc2ktdGhyZWFkcyAtLXN5c3Jvb3Q9JHtXQVNJX1NES19QQVRIfS9zaGFyZS93YXNpLXN5c3Jvb3QgLXB0aHJlYWQgLW1sbHZtIC13YXNtLWVuYWJsZS1zamxqYCxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgIGBUQVJHRVRfTERGTEFHU2AsXG4gICAgICAgIGAtZnVzZS1sZD0ke1dBU0lfU0RLX1BBVEh9L2Jpbi93YXNtLWxkIC0tdGFyZ2V0PXdhc20zMi13YXNpLXRocmVhZHNgLFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2V0T3Blbkhhcm1vbnlFbnYoKSB7XG4gICAgY29uc3QgeyBPSE9TX1NES19QQVRILCBPSE9TX1NES19OQVRJVkUgfSA9IHByb2Nlc3MuZW52XG4gICAgY29uc3QgbmRrUGF0aCA9IE9IT1NfU0RLX1BBVEggPyBgJHtPSE9TX1NES19QQVRIfS9uYXRpdmVgIDogT0hPU19TREtfTkFUSVZFXG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIGlmICghbmRrUGF0aCAmJiBwcm9jZXNzLnBsYXRmb3JtICE9PSAnb3Blbmhhcm1vbnknKSB7XG4gICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICBgJHtjb2xvcnMucmVkKCdPSE9TX1NES19QQVRIJyl9IG9yICR7Y29sb3JzLnJlZCgnT0hPU19TREtfTkFUSVZFJyl9IGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG1pc3NpbmdgLFxuICAgICAgKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGNvbnN0IGxpbmtlck5hbWUgPSBgQ0FSR09fVEFSR0VUXyR7dGhpcy50YXJnZXQudHJpcGxlLnRvVXBwZXJDYXNlKCkucmVwbGFjZSgvLS9nLCAnXycpfV9MSU5LRVJgXG4gICAgY29uc3QgcmFuUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tcmFubGliYFxuICAgIGNvbnN0IGFyUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tYXJgXG4gICAgY29uc3QgY2NQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vJHt0aGlzLnRhcmdldC50cmlwbGV9LWNsYW5nYFxuICAgIGNvbnN0IGN4eFBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi8ke3RoaXMudGFyZ2V0LnRyaXBsZX0tY2xhbmcrK2BcbiAgICBjb25zdCBhc1BhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLWFzYFxuICAgIGNvbnN0IGxkUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xkLmxsZGBcbiAgICBjb25zdCBzdHJpcFBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLXN0cmlwYFxuICAgIGNvbnN0IG9iakR1bXBQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1vYmpkdW1wYFxuICAgIGNvbnN0IG9iakNvcHlQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1vYmpjb3B5YFxuICAgIGNvbnN0IG5tUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tbm1gXG4gICAgY29uc3QgYmluUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluYFxuICAgIGNvbnN0IGxpYlBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2xpYmBcblxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ0xJQkNMQU5HX1BBVEgnLCBsaWJQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ0RFUF9BVE9NSUMnLCAnY2xhbmdfcnQuYnVpbHRpbnMnKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMobGlua2VyTmFtZSwgY2NQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9DQycsIGNjUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQ1hYJywgY3h4UGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQVInLCBhclBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX1JBTkxJQicsIHJhblBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0FTJywgYXNQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9MRCcsIGxkUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfU1RSSVAnLCBzdHJpcFBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX09CSkRVTVAnLCBvYmpEdW1wUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfT0JKQ09QWScsIG9iakNvcHlQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9OTScsIG5tUGF0aClcbiAgICB0aGlzLmVudnMuUEFUSCA9IGAke2JpblBhdGh9JHtwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInID8gJzsnIDogJzonfSR7cHJvY2Vzcy5lbnYuUEFUSH1gXG4gIH1cblxuICBwcml2YXRlIHNldEZlYXR1cmVzKCkge1xuICAgIGNvbnN0IGFyZ3MgPSBbXVxuICAgIGlmICh0aGlzLm9wdGlvbnMuYWxsRmVhdHVyZXMgJiYgdGhpcy5vcHRpb25zLm5vRGVmYXVsdEZlYXR1cmVzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdDYW5ub3Qgc3BlY2lmeSAtLWFsbC1mZWF0dXJlcyBhbmQgLS1uby1kZWZhdWx0LWZlYXR1cmVzIHRvZ2V0aGVyJyxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHRoaXMub3B0aW9ucy5hbGxGZWF0dXJlcykge1xuICAgICAgYXJncy5wdXNoKCctLWFsbC1mZWF0dXJlcycpXG4gICAgfSBlbHNlIGlmICh0aGlzLm9wdGlvbnMubm9EZWZhdWx0RmVhdHVyZXMpIHtcbiAgICAgIGFyZ3MucHVzaCgnLS1uby1kZWZhdWx0LWZlYXR1cmVzJylcbiAgICB9XG4gICAgaWYgKHRoaXMub3B0aW9ucy5mZWF0dXJlcykge1xuICAgICAgYXJncy5wdXNoKCctLWZlYXR1cmVzJywgLi4udGhpcy5vcHRpb25zLmZlYXR1cmVzKVxuICAgIH1cblxuICAgIGRlYnVnKCdTZXQgZmVhdHVyZXMgZmxhZ3M6ICcpXG4gICAgZGVidWcoJyAgJU8nLCBhcmdzKVxuICAgIHRoaXMuYXJncy5wdXNoKC4uLmFyZ3MpXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRCeXBhc3NBcmdzKCkge1xuICAgIGlmICh0aGlzLm9wdGlvbnMucmVsZWFzZSkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJy0tcmVsZWFzZScpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy52ZXJib3NlKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnLS12ZXJib3NlJylcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLnRhcmdldERpcikge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJy0tdGFyZ2V0LWRpcicsIHRoaXMub3B0aW9ucy50YXJnZXREaXIpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5wcm9maWxlKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnLS1wcm9maWxlJywgdGhpcy5vcHRpb25zLnByb2ZpbGUpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5tYW5pZmVzdFBhdGgpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCctLW1hbmlmZXN0LXBhdGgnLCB0aGlzLm9wdGlvbnMubWFuaWZlc3RQYXRoKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMuY2FyZ29PcHRpb25zPy5sZW5ndGgpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKC4uLnRoaXMub3B0aW9ucy5jYXJnb09wdGlvbnMpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVJbnRlcm1lZGlhdGVUeXBlRGVmRm9sZGVyKCkge1xuICAgIGxldCBmb2xkZXIgPSBqb2luKFxuICAgICAgdGhpcy50YXJnZXREaXIsXG4gICAgICAnbmFwaS1ycycsXG4gICAgICBgJHt0aGlzLmNyYXRlLm5hbWV9LSR7Y3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgLnVwZGF0ZSh0aGlzLmNyYXRlLm1hbmlmZXN0X3BhdGgpXG4gICAgICAgIC51cGRhdGUoQ0xJX1ZFUlNJT04pXG4gICAgICAgIC5kaWdlc3QoJ2hleCcpXG4gICAgICAgIC5zdWJzdHJpbmcoMCwgOCl9YCxcbiAgICApXG5cbiAgICBpZiAoIXRoaXMub3B0aW9ucy5kdHNDYWNoZSkge1xuICAgICAgcm1TeW5jKGZvbGRlciwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pXG4gICAgICBmb2xkZXIgKz0gYF8ke0RhdGUubm93KCl9YFxuICAgIH1cblxuICAgIG1rZGlyQXN5bmMoZm9sZGVyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuXG4gICAgcmV0dXJuIGZvbGRlclxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwb3N0QnVpbGQoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGRlYnVnKGBUcnkgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3Rvcnk6YClcbiAgICAgIGRlYnVnKCcgICVpJywgdGhpcy5vdXRwdXREaXIpXG4gICAgICBhd2FpdCBta2RpckFzeW5jKHRoaXMub3V0cHV0RGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICAgICAgZGVidWcoYE91dHB1dCBkaXJlY3RvcnkgY3JlYXRlZGApXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3RvcnkgJHt0aGlzLm91dHB1dERpcn1gLCB7XG4gICAgICAgIGNhdXNlOiBlLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICBjb25zdCB3YXNtQmluYXJ5TmFtZSA9IGF3YWl0IHRoaXMuY29weUFydGlmYWN0KClcblxuICAgIC8vIG9ubHkgZm9yIGNkeWxpYlxuICAgIGlmICh0aGlzLmNkeUxpYk5hbWUpIHtcbiAgICAgIGNvbnN0IGlkZW50cyA9IGF3YWl0IHRoaXMuZ2VuZXJhdGVUeXBlRGVmKClcbiAgICAgIGNvbnN0IGpzT3V0cHV0ID0gYXdhaXQgdGhpcy53cml0ZUpzQmluZGluZyhpZGVudHMpXG4gICAgICBjb25zdCB3YXNtQmluZGluZ3NPdXRwdXQgPSBhd2FpdCB0aGlzLndyaXRlV2FzaUJpbmRpbmcoXG4gICAgICAgIHdhc21CaW5hcnlOYW1lLFxuICAgICAgICBpZGVudHMsXG4gICAgICApXG4gICAgICBpZiAoanNPdXRwdXQpIHtcbiAgICAgICAgdGhpcy5vdXRwdXRzLnB1c2goanNPdXRwdXQpXG4gICAgICB9XG4gICAgICBpZiAod2FzbUJpbmRpbmdzT3V0cHV0KSB7XG4gICAgICAgIHRoaXMub3V0cHV0cy5wdXNoKC4uLndhc21CaW5kaW5nc091dHB1dClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5vdXRwdXRzXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvcHlBcnRpZmFjdCgpIHtcbiAgICBjb25zdCBbc3JjTmFtZSwgZGVzdE5hbWUsIHdhc21CaW5hcnlOYW1lXSA9IHRoaXMuZ2V0QXJ0aWZhY3ROYW1lcygpXG4gICAgaWYgKCFzcmNOYW1lIHx8ICFkZXN0TmFtZSkge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcHJvZmlsZSA9XG4gICAgICB0aGlzLm9wdGlvbnMucHJvZmlsZSA/PyAodGhpcy5vcHRpb25zLnJlbGVhc2UgPyAncmVsZWFzZScgOiAnZGVidWcnKVxuICAgIGNvbnN0IHNyYyA9IGpvaW4odGhpcy50YXJnZXREaXIsIHRoaXMudGFyZ2V0LnRyaXBsZSwgcHJvZmlsZSwgc3JjTmFtZSlcbiAgICBkZWJ1ZyhgQ29weSBhcnRpZmFjdCBmcm9tOiBbJHtzcmN9XWApXG4gICAgY29uc3QgZGVzdCA9IGpvaW4odGhpcy5vdXRwdXREaXIsIGRlc3ROYW1lKVxuICAgIGNvbnN0IGlzV2FzbSA9IGRlc3QuZW5kc1dpdGgoJy53YXNtJylcblxuICAgIHRyeSB7XG4gICAgICBpZiAoYXdhaXQgZmlsZUV4aXN0cyhkZXN0KSkge1xuICAgICAgICBkZWJ1ZygnT2xkIGFydGlmYWN0IGZvdW5kLCByZW1vdmUgaXQgZmlyc3QnKVxuICAgICAgICBhd2FpdCB1bmxpbmtBc3luYyhkZXN0KVxuICAgICAgfVxuICAgICAgZGVidWcoJ0NvcHkgYXJ0aWZhY3QgdG86JylcbiAgICAgIGRlYnVnKCcgICVpJywgZGVzdClcbiAgICAgIGlmIChpc1dhc20pIHtcbiAgICAgICAgY29uc3QgeyBNb2R1bGVDb25maWcgfSA9IGF3YWl0IGltcG9ydCgnQG5hcGktcnMvd2FzbS10b29scycpXG4gICAgICAgIGRlYnVnKCdHZW5lcmF0ZSBkZWJ1ZyB3YXNtIG1vZHVsZScpXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgZGVidWdXYXNtTW9kdWxlID0gbmV3IE1vZHVsZUNvbmZpZygpXG4gICAgICAgICAgICAuZ2VuZXJhdGVEd2FyZih0cnVlKVxuICAgICAgICAgICAgLmdlbmVyYXRlTmFtZVNlY3Rpb24odHJ1ZSlcbiAgICAgICAgICAgIC5nZW5lcmF0ZVByb2R1Y2Vyc1NlY3Rpb24odHJ1ZSlcbiAgICAgICAgICAgIC5wcmVzZXJ2ZUNvZGVUcmFuc2Zvcm0odHJ1ZSlcbiAgICAgICAgICAgIC5zdHJpY3RWYWxpZGF0ZShmYWxzZSlcbiAgICAgICAgICAgIC5wYXJzZShhd2FpdCByZWFkRmlsZUFzeW5jKHNyYykpXG4gICAgICAgICAgY29uc3QgZGVidWdXYXNtQmluYXJ5ID0gZGVidWdXYXNtTW9kdWxlLmVtaXRXYXNtKHRydWUpXG4gICAgICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgICAgICBkZXN0LnJlcGxhY2UoL1xcLndhc20kLywgJy5kZWJ1Zy53YXNtJyksXG4gICAgICAgICAgICBkZWJ1Z1dhc21CaW5hcnksXG4gICAgICAgICAgKVxuICAgICAgICAgIGRlYnVnKCdHZW5lcmF0ZSByZWxlYXNlIHdhc20gbW9kdWxlJylcbiAgICAgICAgICBjb25zdCByZWxlYXNlV2FzbU1vZHVsZSA9IG5ldyBNb2R1bGVDb25maWcoKVxuICAgICAgICAgICAgLmdlbmVyYXRlRHdhcmYoZmFsc2UpXG4gICAgICAgICAgICAuZ2VuZXJhdGVOYW1lU2VjdGlvbihmYWxzZSlcbiAgICAgICAgICAgIC5nZW5lcmF0ZVByb2R1Y2Vyc1NlY3Rpb24oZmFsc2UpXG4gICAgICAgICAgICAucHJlc2VydmVDb2RlVHJhbnNmb3JtKGZhbHNlKVxuICAgICAgICAgICAgLnN0cmljdFZhbGlkYXRlKGZhbHNlKVxuICAgICAgICAgICAgLm9ubHlTdGFibGVGZWF0dXJlcyhmYWxzZSlcbiAgICAgICAgICAgIC5wYXJzZShkZWJ1Z1dhc21CaW5hcnkpXG4gICAgICAgICAgY29uc3QgcmVsZWFzZVdhc21CaW5hcnkgPSByZWxlYXNlV2FzbU1vZHVsZS5lbWl0V2FzbShmYWxzZSlcbiAgICAgICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhkZXN0LCByZWxlYXNlV2FzbUJpbmFyeSlcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICBgRmFpbGVkIHRvIGdlbmVyYXRlIGRlYnVnIHdhc20gbW9kdWxlOiAkeyhlIGFzIGFueSkubWVzc2FnZSA/PyBlfWAsXG4gICAgICAgICAgKVxuICAgICAgICAgIGF3YWl0IGNvcHlGaWxlQXN5bmMoc3JjLCBkZXN0KVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBhd2FpdCBjb3B5RmlsZUFzeW5jKHNyYywgZGVzdClcbiAgICAgIH1cbiAgICAgIHRoaXMub3V0cHV0cy5wdXNoKHtcbiAgICAgICAga2luZDogZGVzdC5lbmRzV2l0aCgnLm5vZGUnKSA/ICdub2RlJyA6IGlzV2FzbSA/ICd3YXNtJyA6ICdleGUnLFxuICAgICAgICBwYXRoOiBkZXN0LFxuICAgICAgfSlcbiAgICAgIHJldHVybiB3YXNtQmluYXJ5TmFtZSA/IGpvaW4odGhpcy5vdXRwdXREaXIsIHdhc21CaW5hcnlOYW1lKSA6IG51bGxcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBjb3B5IGFydGlmYWN0JywgeyBjYXVzZTogZSB9KVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZ2V0QXJ0aWZhY3ROYW1lcygpIHtcbiAgICBpZiAodGhpcy5jZHlMaWJOYW1lKSB7XG4gICAgICBjb25zdCBjZHlMaWIgPSB0aGlzLmNkeUxpYk5hbWUucmVwbGFjZSgvLS9nLCAnXycpXG4gICAgICBjb25zdCB3YXNpVGFyZ2V0ID0gdGhpcy5jb25maWcudGFyZ2V0cy5maW5kKCh0KSA9PiB0LnBsYXRmb3JtID09PSAnd2FzaScpXG5cbiAgICAgIGNvbnN0IHNyY05hbWUgPVxuICAgICAgICB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ2RhcndpbidcbiAgICAgICAgICA/IGBsaWIke2NkeUxpYn0uZHlsaWJgXG4gICAgICAgICAgOiB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dpbjMyJ1xuICAgICAgICAgICAgPyBgJHtjZHlMaWJ9LmRsbGBcbiAgICAgICAgICAgIDogdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3YXNpJyB8fCB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dhc20nXG4gICAgICAgICAgICAgID8gYCR7Y2R5TGlifS53YXNtYFxuICAgICAgICAgICAgICA6IGBsaWIke2NkeUxpYn0uc29gXG5cbiAgICAgIGxldCBkZXN0TmFtZSA9IHRoaXMuY29uZmlnLmJpbmFyeU5hbWVcbiAgICAgIC8vIGFkZCBwbGF0Zm9ybSBzdWZmaXggdG8gYmluYXJ5IG5hbWVcbiAgICAgIC8vIGluZGV4Wy5saW51eC14NjQtZ251XS5ub2RlXG4gICAgICAvLyAgICAgICBeXl5eXl5eXl5eXl5eXlxuICAgICAgaWYgKHRoaXMub3B0aW9ucy5wbGF0Zm9ybSkge1xuICAgICAgICBkZXN0TmFtZSArPSBgLiR7dGhpcy50YXJnZXQucGxhdGZvcm1BcmNoQUJJfWBcbiAgICAgIH1cbiAgICAgIGlmIChzcmNOYW1lLmVuZHNXaXRoKCcud2FzbScpKSB7XG4gICAgICAgIGRlc3ROYW1lICs9ICcud2FzbSdcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlc3ROYW1lICs9ICcubm9kZSdcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFtcbiAgICAgICAgc3JjTmFtZSxcbiAgICAgICAgZGVzdE5hbWUsXG4gICAgICAgIHdhc2lUYXJnZXRcbiAgICAgICAgICA/IGAke3RoaXMuY29uZmlnLmJpbmFyeU5hbWV9LiR7d2FzaVRhcmdldC5wbGF0Zm9ybUFyY2hBQkl9Lndhc21gXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgXVxuICAgIH0gZWxzZSBpZiAodGhpcy5iaW5OYW1lKSB7XG4gICAgICBjb25zdCBzcmNOYW1lID1cbiAgICAgICAgdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3aW4zMicgPyBgJHt0aGlzLmJpbk5hbWV9LmV4ZWAgOiB0aGlzLmJpbk5hbWVcblxuICAgICAgcmV0dXJuIFtzcmNOYW1lLCBzcmNOYW1lXVxuICAgIH1cblxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZW5lcmF0ZVR5cGVEZWYoKSB7XG4gICAgY29uc3QgdHlwZURlZkRpciA9IHRoaXMuZW52cy5OQVBJX1RZUEVfREVGX1RNUF9GT0xERVJcbiAgICBpZiAoIXRoaXMuZW5hYmxlVHlwZURlZikge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuXG4gICAgY29uc3QgeyBleHBvcnRzLCBkdHMgfSA9IGF3YWl0IGdlbmVyYXRlVHlwZURlZih7XG4gICAgICB0eXBlRGVmRGlyLFxuICAgICAgbm9EdHNIZWFkZXI6IHRoaXMub3B0aW9ucy5ub0R0c0hlYWRlcixcbiAgICAgIGR0c0hlYWRlcjogdGhpcy5vcHRpb25zLmR0c0hlYWRlcixcbiAgICAgIGNvbmZpZ0R0c0hlYWRlcjogdGhpcy5jb25maWcuZHRzSGVhZGVyLFxuICAgICAgY29uZmlnRHRzSGVhZGVyRmlsZTogdGhpcy5jb25maWcuZHRzSGVhZGVyRmlsZSxcbiAgICAgIGNvbnN0RW51bTogdGhpcy5vcHRpb25zLmNvbnN0RW51bSA/PyB0aGlzLmNvbmZpZy5jb25zdEVudW0sXG4gICAgICBjd2Q6IHRoaXMub3B0aW9ucy5jd2QsXG4gICAgfSlcblxuICAgIGNvbnN0IGRlc3QgPSBqb2luKHRoaXMub3V0cHV0RGlyLCB0aGlzLm9wdGlvbnMuZHRzID8/ICdpbmRleC5kLnRzJylcblxuICAgIHRyeSB7XG4gICAgICBkZWJ1ZygnV3JpdGluZyB0eXBlIGRlZiB0bzonKVxuICAgICAgZGVidWcoJyAgJWknLCBkZXN0KVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZGVzdCwgZHRzLCAndXRmLTgnKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGRlYnVnLmVycm9yKCdGYWlsZWQgdG8gd3JpdGUgdHlwZSBkZWYgZmlsZScpXG4gICAgICBkZWJ1Zy5lcnJvcihlIGFzIEVycm9yKVxuICAgIH1cblxuICAgIGlmIChleHBvcnRzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGRlc3QgPSBqb2luKHRoaXMub3V0cHV0RGlyLCB0aGlzLm9wdGlvbnMuZHRzID8/ICdpbmRleC5kLnRzJylcbiAgICAgIHRoaXMub3V0cHV0cy5wdXNoKHsga2luZDogJ2R0cycsIHBhdGg6IGRlc3QgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gZXhwb3J0c1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZUpzQmluZGluZyhpZGVudHM6IHN0cmluZ1tdKSB7XG4gICAgcmV0dXJuIHdyaXRlSnNCaW5kaW5nKHtcbiAgICAgIHBsYXRmb3JtOiB0aGlzLm9wdGlvbnMucGxhdGZvcm0sXG4gICAgICBub0pzQmluZGluZzogdGhpcy5vcHRpb25zLm5vSnNCaW5kaW5nLFxuICAgICAgaWRlbnRzLFxuICAgICAganNCaW5kaW5nOiB0aGlzLm9wdGlvbnMuanNCaW5kaW5nLFxuICAgICAgZXNtOiB0aGlzLm9wdGlvbnMuZXNtLFxuICAgICAgYmluYXJ5TmFtZTogdGhpcy5jb25maWcuYmluYXJ5TmFtZSxcbiAgICAgIHBhY2thZ2VOYW1lOiB0aGlzLm9wdGlvbnMuanNQYWNrYWdlTmFtZSA/PyB0aGlzLmNvbmZpZy5wYWNrYWdlTmFtZSxcbiAgICAgIHZlcnNpb246IHByb2Nlc3MuZW52Lm5wbV9uZXdfdmVyc2lvbiA/PyB0aGlzLmNvbmZpZy5wYWNrYWdlSnNvbi52ZXJzaW9uLFxuICAgICAgb3V0cHV0RGlyOiB0aGlzLm91dHB1dERpcixcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZVdhc2lCaW5kaW5nKFxuICAgIGRpc3RGaWxlTmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkIHwgbnVsbCxcbiAgICBpZGVudHM6IHN0cmluZ1tdLFxuICApIHtcbiAgICBpZiAoZGlzdEZpbGVOYW1lKSB7XG4gICAgICBjb25zdCB7IG5hbWUsIGRpciB9ID0gcGFyc2UoZGlzdEZpbGVOYW1lKVxuICAgICAgY29uc3QgYmluZGluZ1BhdGggPSBqb2luKGRpciwgYCR7dGhpcy5jb25maWcuYmluYXJ5TmFtZX0ud2FzaS5janNgKVxuICAgICAgY29uc3QgYnJvd3NlckJpbmRpbmdQYXRoID0gam9pbihcbiAgICAgICAgZGlyLFxuICAgICAgICBgJHt0aGlzLmNvbmZpZy5iaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgLFxuICAgICAgKVxuICAgICAgY29uc3Qgd29ya2VyUGF0aCA9IGpvaW4oZGlyLCAnd2FzaS13b3JrZXIubWpzJylcbiAgICAgIGNvbnN0IGJyb3dzZXJXb3JrZXJQYXRoID0gam9pbihkaXIsICd3YXNpLXdvcmtlci1icm93c2VyLm1qcycpXG4gICAgICBjb25zdCBicm93c2VyRW50cnlQYXRoID0gam9pbihkaXIsICdicm93c2VyLmpzJylcbiAgICAgIGNvbnN0IGV4cG9ydHNDb2RlID1cbiAgICAgICAgYG1vZHVsZS5leHBvcnRzID0gX19uYXBpTW9kdWxlLmV4cG9ydHNcXG5gICtcbiAgICAgICAgaWRlbnRzXG4gICAgICAgICAgLm1hcChcbiAgICAgICAgICAgIChpZGVudCkgPT5cbiAgICAgICAgICAgICAgYG1vZHVsZS5leHBvcnRzLiR7aWRlbnR9ID0gX19uYXBpTW9kdWxlLmV4cG9ydHMuJHtpZGVudH1gLFxuICAgICAgICAgIClcbiAgICAgICAgICAuam9pbignXFxuJylcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICBiaW5kaW5nUGF0aCxcbiAgICAgICAgY3JlYXRlV2FzaUJpbmRpbmcoXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy5wYWNrYWdlTmFtZSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5pbml0aWFsTWVtb3J5LFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/Lm1heGltdW1NZW1vcnksXG4gICAgICAgICkgK1xuICAgICAgICAgIGV4cG9ydHNDb2RlICtcbiAgICAgICAgICAnXFxuJyxcbiAgICAgICAgJ3V0ZjgnLFxuICAgICAgKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgIGJyb3dzZXJCaW5kaW5nUGF0aCxcbiAgICAgICAgY3JlYXRlV2FzaUJyb3dzZXJCaW5kaW5nKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uaW5pdGlhbE1lbW9yeSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5tYXhpbXVtTWVtb3J5LFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmZzLFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmFzeW5jSW5pdCxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5idWZmZXIsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uZXJyb3JFdmVudCxcbiAgICAgICAgKSArXG4gICAgICAgICAgYGV4cG9ydCBkZWZhdWx0IF9fbmFwaU1vZHVsZS5leHBvcnRzXFxuYCArXG4gICAgICAgICAgaWRlbnRzXG4gICAgICAgICAgICAubWFwKFxuICAgICAgICAgICAgICAoaWRlbnQpID0+XG4gICAgICAgICAgICAgICAgYGV4cG9ydCBjb25zdCAke2lkZW50fSA9IF9fbmFwaU1vZHVsZS5leHBvcnRzLiR7aWRlbnR9YCxcbiAgICAgICAgICAgIClcbiAgICAgICAgICAgIC5qb2luKCdcXG4nKSArXG4gICAgICAgICAgJ1xcbicsXG4gICAgICAgICd1dGY4JyxcbiAgICAgIClcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKHdvcmtlclBhdGgsIFdBU0lfV09SS0VSX1RFTVBMQVRFLCAndXRmOCcpXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgYnJvd3NlcldvcmtlclBhdGgsXG4gICAgICAgIGNyZWF0ZVdhc2lCcm93c2VyV29ya2VyQmluZGluZyhcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5mcyA/PyBmYWxzZSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5lcnJvckV2ZW50ID8/IGZhbHNlLFxuICAgICAgICApLFxuICAgICAgICAndXRmOCcsXG4gICAgICApXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgYnJvd3NlckVudHJ5UGF0aCxcbiAgICAgICAgYGV4cG9ydCAqIGZyb20gJyR7dGhpcy5jb25maWcucGFja2FnZU5hbWV9LXdhc20zMi13YXNpJ1xcbmAsXG4gICAgICApXG4gICAgICByZXR1cm4gW1xuICAgICAgICB7IGtpbmQ6ICdqcycsIHBhdGg6IGJpbmRpbmdQYXRoIH0sXG4gICAgICAgIHsga2luZDogJ2pzJywgcGF0aDogYnJvd3NlckJpbmRpbmdQYXRoIH0sXG4gICAgICAgIHsga2luZDogJ2pzJywgcGF0aDogd29ya2VyUGF0aCB9LFxuICAgICAgICB7IGtpbmQ6ICdqcycsIHBhdGg6IGJyb3dzZXJXb3JrZXJQYXRoIH0sXG4gICAgICAgIHsga2luZDogJ2pzJywgcGF0aDogYnJvd3NlckVudHJ5UGF0aCB9LFxuICAgICAgXSBzYXRpc2ZpZXMgT3V0cHV0W11cbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICBwcml2YXRlIHNldEVudklmTm90RXhpc3RzKGVudjogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgaWYgKCFwcm9jZXNzLmVudltlbnZdKSB7XG4gICAgICB0aGlzLmVudnNbZW52XSA9IHZhbHVlXG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV3JpdGVKc0JpbmRpbmdPcHRpb25zIHtcbiAgcGxhdGZvcm0/OiBib29sZWFuXG4gIG5vSnNCaW5kaW5nPzogYm9vbGVhblxuICBpZGVudHM6IHN0cmluZ1tdXG4gIGpzQmluZGluZz86IHN0cmluZ1xuICBlc20/OiBib29sZWFuXG4gIGJpbmFyeU5hbWU6IHN0cmluZ1xuICBwYWNrYWdlTmFtZTogc3RyaW5nXG4gIHZlcnNpb246IHN0cmluZ1xuICBvdXRwdXREaXI6IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd3JpdGVKc0JpbmRpbmcoXG4gIG9wdGlvbnM6IFdyaXRlSnNCaW5kaW5nT3B0aW9ucyxcbik6IFByb21pc2U8T3V0cHV0IHwgdW5kZWZpbmVkPiB7XG4gIGlmIChcbiAgICAhb3B0aW9ucy5wbGF0Zm9ybSB8fFxuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvcHJlZmVyLW51bGxpc2gtY29hbGVzY2luZ1xuICAgIG9wdGlvbnMubm9Kc0JpbmRpbmcgfHxcbiAgICBvcHRpb25zLmlkZW50cy5sZW5ndGggPT09IDBcbiAgKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBuYW1lID0gb3B0aW9ucy5qc0JpbmRpbmcgPz8gJ2luZGV4LmpzJ1xuXG4gIGNvbnN0IGNyZWF0ZUJpbmRpbmcgPSBvcHRpb25zLmVzbSA/IGNyZWF0ZUVzbUJpbmRpbmcgOiBjcmVhdGVDanNCaW5kaW5nXG4gIGNvbnN0IGJpbmRpbmcgPSBjcmVhdGVCaW5kaW5nKFxuICAgIG9wdGlvbnMuYmluYXJ5TmFtZSxcbiAgICBvcHRpb25zLnBhY2thZ2VOYW1lLFxuICAgIG9wdGlvbnMuaWRlbnRzLFxuICAgIC8vIGluIG5wbSBwcmV2ZXJzaW9uIGhvb2tcbiAgICBvcHRpb25zLnZlcnNpb24sXG4gIClcblxuICB0cnkge1xuICAgIGNvbnN0IGRlc3QgPSBqb2luKG9wdGlvbnMub3V0cHV0RGlyLCBuYW1lKVxuICAgIGRlYnVnKCdXcml0aW5nIGpzIGJpbmRpbmcgdG86JylcbiAgICBkZWJ1ZygnICAlaScsIGRlc3QpXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZGVzdCwgYmluZGluZywgJ3V0Zi04JylcbiAgICByZXR1cm4geyBraW5kOiAnanMnLCBwYXRoOiBkZXN0IH0gc2F0aXNmaWVzIE91dHB1dFxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gd3JpdGUganMgYmluZGluZyBmaWxlJywgeyBjYXVzZTogZSB9KVxuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR2VuZXJhdGVUeXBlRGVmT3B0aW9ucyB7XG4gIHR5cGVEZWZEaXI6IHN0cmluZ1xuICBub0R0c0hlYWRlcj86IGJvb2xlYW5cbiAgZHRzSGVhZGVyPzogc3RyaW5nXG4gIGR0c0hlYWRlckZpbGU/OiBzdHJpbmdcbiAgY29uZmlnRHRzSGVhZGVyPzogc3RyaW5nXG4gIGNvbmZpZ0R0c0hlYWRlckZpbGU/OiBzdHJpbmdcbiAgY29uc3RFbnVtPzogYm9vbGVhblxuICBjd2Q6IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVUeXBlRGVmKFxuICBvcHRpb25zOiBHZW5lcmF0ZVR5cGVEZWZPcHRpb25zLFxuKTogUHJvbWlzZTx7IGV4cG9ydHM6IHN0cmluZ1tdOyBkdHM6IHN0cmluZyB9PiB7XG4gIGlmICghKGF3YWl0IGRpckV4aXN0c0FzeW5jKG9wdGlvbnMudHlwZURlZkRpcikpKSB7XG4gICAgcmV0dXJuIHsgZXhwb3J0czogW10sIGR0czogJycgfVxuICB9XG5cbiAgbGV0IGhlYWRlciA9ICcnXG4gIGxldCBkdHMgPSAnJ1xuICBsZXQgZXhwb3J0czogc3RyaW5nW10gPSBbXVxuXG4gIGlmICghb3B0aW9ucy5ub0R0c0hlYWRlcikge1xuICAgIGNvbnN0IGR0c0hlYWRlciA9IG9wdGlvbnMuZHRzSGVhZGVyID8/IG9wdGlvbnMuY29uZmlnRHRzSGVhZGVyXG4gICAgLy8gYGR0c0hlYWRlckZpbGVgIGluIGNvbmZpZyA+IGBkdHNIZWFkZXJgIGluIGNsaSBmbGFnID4gYGR0c0hlYWRlcmAgaW4gY29uZmlnXG4gICAgaWYgKG9wdGlvbnMuY29uZmlnRHRzSGVhZGVyRmlsZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaGVhZGVyID0gYXdhaXQgcmVhZEZpbGVBc3luYyhcbiAgICAgICAgICBqb2luKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ0R0c0hlYWRlckZpbGUpLFxuICAgICAgICAgICd1dGYtOCcsXG4gICAgICAgIClcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICBgRmFpbGVkIHRvIHJlYWQgZHRzIGhlYWRlciBmaWxlICR7b3B0aW9ucy5jb25maWdEdHNIZWFkZXJGaWxlfWAsXG4gICAgICAgICAgZSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZHRzSGVhZGVyKSB7XG4gICAgICBoZWFkZXIgPSBkdHNIZWFkZXJcbiAgICB9IGVsc2Uge1xuICAgICAgaGVhZGVyID0gREVGQVVMVF9UWVBFX0RFRl9IRUFERVJcbiAgICB9XG4gIH1cblxuICBjb25zdCBmaWxlcyA9IGF3YWl0IHJlYWRkaXJBc3luYyhvcHRpb25zLnR5cGVEZWZEaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KVxuXG4gIGlmICghZmlsZXMubGVuZ3RoKSB7XG4gICAgZGVidWcoJ05vIHR5cGUgZGVmIGZpbGVzIGZvdW5kLiBTa2lwIGdlbmVyYXRpbmcgZHRzIGZpbGUuJylcbiAgICByZXR1cm4geyBleHBvcnRzOiBbXSwgZHRzOiAnJyB9XG4gIH1cblxuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBpZiAoIWZpbGUuaXNGaWxlKCkpIHtcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgeyBkdHM6IGZpbGVEdHMsIGV4cG9ydHM6IGZpbGVFeHBvcnRzIH0gPSBhd2FpdCBwcm9jZXNzVHlwZURlZihcbiAgICAgIGpvaW4ob3B0aW9ucy50eXBlRGVmRGlyLCBmaWxlLm5hbWUpLFxuICAgICAgb3B0aW9ucy5jb25zdEVudW0gPz8gdHJ1ZSxcbiAgICApXG5cbiAgICBkdHMgKz0gZmlsZUR0c1xuICAgIGV4cG9ydHMucHVzaCguLi5maWxlRXhwb3J0cylcbiAgfVxuXG4gIGlmIChkdHMuaW5kZXhPZignRXh0ZXJuYWxPYmplY3Q8JykgPiAtMSkge1xuICAgIGhlYWRlciArPSBgXG5leHBvcnQgZGVjbGFyZSBjbGFzcyBFeHRlcm5hbE9iamVjdDxUPiB7XG4gIHJlYWRvbmx5ICcnOiB7XG4gICAgcmVhZG9ubHkgJyc6IHVuaXF1ZSBzeW1ib2xcbiAgICBbSzogc3ltYm9sXTogVFxuICB9XG59XG5gXG4gIH1cblxuICBpZiAoZHRzLmluZGV4T2YoJ1R5cGVkQXJyYXknKSA+IC0xKSB7XG4gICAgaGVhZGVyICs9IGBcbmV4cG9ydCB0eXBlIFR5cGVkQXJyYXkgPSBJbnQ4QXJyYXkgfCBVaW50OEFycmF5IHwgVWludDhDbGFtcGVkQXJyYXkgfCBJbnQxNkFycmF5IHwgVWludDE2QXJyYXkgfCBJbnQzMkFycmF5IHwgVWludDMyQXJyYXkgfCBGbG9hdDMyQXJyYXkgfCBGbG9hdDY0QXJyYXkgfCBCaWdJbnQ2NEFycmF5IHwgQmlnVWludDY0QXJyYXlcbmBcbiAgfVxuXG4gIGR0cyA9IGhlYWRlciArIGR0c1xuXG4gIHJldHVybiB7XG4gICAgZXhwb3J0cyxcbiAgICBkdHMsXG4gIH1cbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlQ3JlYXRlTnBtRGlyc0NvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1snY3JlYXRlLW5wbS1kaXJzJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdDcmVhdGUgbnBtIHBhY2thZ2UgZGlycyBmb3IgZGlmZmVyZW50IHBsYXRmb3JtcycsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgbnBtRGlyID0gT3B0aW9uLlN0cmluZygnLS1ucG0tZGlyJywgJ25wbScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dCcsXG4gIH0pXG5cbiAgZHJ5UnVuID0gT3B0aW9uLkJvb2xlYW4oJy0tZHJ5LXJ1bicsIGZhbHNlLCB7XG4gICAgZGVzY3JpcHRpb246ICdEcnkgcnVuIHdpdGhvdXQgdG91Y2hpbmcgZmlsZSBzeXN0ZW0nLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgbnBtRGlyOiB0aGlzLm5wbURpcixcbiAgICAgIGRyeVJ1bjogdGhpcy5kcnlSdW4sXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQ3JlYXRlIG5wbSBwYWNrYWdlIGRpcnMgZm9yIGRpZmZlcmVudCBwbGF0Zm9ybXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDcmVhdGVOcG1EaXJzT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbnBtJ1xuICAgKi9cbiAgbnBtRGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBEcnkgcnVuIHdpdGhvdXQgdG91Y2hpbmcgZmlsZSBzeXN0ZW1cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIGRyeVJ1bj86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdENyZWF0ZU5wbURpcnNPcHRpb25zKFxuICBvcHRpb25zOiBDcmVhdGVOcG1EaXJzT3B0aW9ucyxcbikge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG5wbURpcjogJ25wbScsXG4gICAgZHJ5UnVuOiBmYWxzZSxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSAnbm9kZTptb2R1bGUnXG5pbXBvcnQgeyBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgeyBwYXJzZSB9IGZyb20gJ3NlbXZlcidcblxuY29uc3QgcmVxdWlyZSA9IGNyZWF0ZVJlcXVpcmUoaW1wb3J0Lm1ldGEudXJsKVxuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHRDcmVhdGVOcG1EaXJzT3B0aW9ucyxcbiAgdHlwZSBDcmVhdGVOcG1EaXJzT3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL2NyZWF0ZS1ucG0tZGlycy5qcydcbmltcG9ydCB7XG4gIGRlYnVnRmFjdG9yeSxcbiAgcmVhZE5hcGlDb25maWcsXG4gIG1rZGlyQXN5bmMgYXMgcmF3TWtkaXJBc3luYyxcbiAgcGljayxcbiAgd3JpdGVGaWxlQXN5bmMgYXMgcmF3V3JpdGVGaWxlQXN5bmMsXG4gIHR5cGUgVGFyZ2V0LFxuICB0eXBlIENvbW1vblBhY2thZ2VKc29uRmllbGRzLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ2NyZWF0ZS1ucG0tZGlycycpXG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFja2FnZU1ldGEge1xuICAnZGlzdC10YWdzJzogeyBbaW5kZXg6IHN0cmluZ106IHN0cmluZyB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVOcG1EaXJzKHVzZXJPcHRpb25zOiBDcmVhdGVOcG1EaXJzT3B0aW9ucykge1xuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0Q3JlYXRlTnBtRGlyc09wdGlvbnModXNlck9wdGlvbnMpXG5cbiAgYXN5bmMgZnVuY3Rpb24gbWtkaXJBc3luYyhkaXI6IHN0cmluZykge1xuICAgIGRlYnVnKCdUcnkgdG8gY3JlYXRlIGRpcjogJWknLCBkaXIpXG4gICAgaWYgKG9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCByYXdNa2RpckFzeW5jKGRpciwge1xuICAgICAgcmVjdXJzaXZlOiB0cnVlLFxuICAgIH0pXG4gIH1cblxuICBhc3luYyBmdW5jdGlvbiB3cml0ZUZpbGVBc3luYyhmaWxlOiBzdHJpbmcsIGNvbnRlbnQ6IHN0cmluZykge1xuICAgIGRlYnVnKCdXcml0aW5nIGZpbGUgJWknLCBmaWxlKVxuXG4gICAgaWYgKG9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgICBkZWJ1Zyhjb250ZW50KVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgcmF3V3JpdGVGaWxlQXN5bmMoZmlsZSwgY29udGVudClcbiAgfVxuXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuICBjb25zdCBucG1QYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5ucG1EaXIpXG5cbiAgZGVidWcoYFJlYWQgY29udGVudCBmcm9tIFske29wdGlvbnMuY29uZmlnUGF0aCA/PyBwYWNrYWdlSnNvblBhdGh9XWApXG5cbiAgY29uc3QgeyB0YXJnZXRzLCBiaW5hcnlOYW1lLCBwYWNrYWdlTmFtZSwgcGFja2FnZUpzb24gfSA9XG4gICAgYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgICBvcHRpb25zLmNvbmZpZ1BhdGggPyByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLmNvbmZpZ1BhdGgpIDogdW5kZWZpbmVkLFxuICAgIClcblxuICBmb3IgKGNvbnN0IHRhcmdldCBvZiB0YXJnZXRzKSB7XG4gICAgY29uc3QgdGFyZ2V0RGlyID0gam9pbihucG1QYXRoLCBgJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfWApXG4gICAgYXdhaXQgbWtkaXJBc3luYyh0YXJnZXREaXIpXG5cbiAgICBjb25zdCBiaW5hcnlGaWxlTmFtZSA9XG4gICAgICB0YXJnZXQuYXJjaCA9PT0gJ3dhc20zMidcbiAgICAgICAgPyBgJHtiaW5hcnlOYW1lfS4ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9Lndhc21gXG4gICAgICAgIDogYCR7YmluYXJ5TmFtZX0uJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfS5ub2RlYFxuICAgIGNvbnN0IHNjb3BlZFBhY2thZ2VKc29uOiBDb21tb25QYWNrYWdlSnNvbkZpZWxkcyA9IHtcbiAgICAgIG5hbWU6IGAke3BhY2thZ2VOYW1lfS0ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9YCxcbiAgICAgIHZlcnNpb246IHBhY2thZ2VKc29uLnZlcnNpb24sXG4gICAgICBjcHU6IHRhcmdldC5hcmNoICE9PSAndW5pdmVyc2FsJyA/IFt0YXJnZXQuYXJjaF0gOiB1bmRlZmluZWQsXG4gICAgICBtYWluOiBiaW5hcnlGaWxlTmFtZSxcbiAgICAgIGZpbGVzOiBbYmluYXJ5RmlsZU5hbWVdLFxuICAgICAgLi4ucGljayhcbiAgICAgICAgcGFja2FnZUpzb24sXG4gICAgICAgICdkZXNjcmlwdGlvbicsXG4gICAgICAgICdrZXl3b3JkcycsXG4gICAgICAgICdhdXRob3InLFxuICAgICAgICAnYXV0aG9ycycsXG4gICAgICAgICdob21lcGFnZScsXG4gICAgICAgICdsaWNlbnNlJyxcbiAgICAgICAgJ2VuZ2luZXMnLFxuICAgICAgICAncmVwb3NpdG9yeScsXG4gICAgICAgICdidWdzJyxcbiAgICAgICksXG4gICAgfVxuICAgIGlmIChwYWNrYWdlSnNvbi5wdWJsaXNoQ29uZmlnKSB7XG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5wdWJsaXNoQ29uZmlnID0gcGljayhcbiAgICAgICAgcGFja2FnZUpzb24ucHVibGlzaENvbmZpZyxcbiAgICAgICAgJ3JlZ2lzdHJ5JyxcbiAgICAgICAgJ2FjY2VzcycsXG4gICAgICApXG4gICAgfVxuICAgIGlmICh0YXJnZXQuYXJjaCAhPT0gJ3dhc20zMicpIHtcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLm9zID0gW3RhcmdldC5wbGF0Zm9ybV1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgZW50cnkgPSBgJHtiaW5hcnlOYW1lfS53YXNpLmNqc2BcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLm1haW4gPSBlbnRyeVxuICAgICAgc2NvcGVkUGFja2FnZUpzb24uYnJvd3NlciA9IGAke2JpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2BcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmZpbGVzPy5wdXNoKFxuICAgICAgICBlbnRyeSxcbiAgICAgICAgc2NvcGVkUGFja2FnZUpzb24uYnJvd3NlcixcbiAgICAgICAgYHdhc2ktd29ya2VyLm1qc2AsXG4gICAgICAgIGB3YXNpLXdvcmtlci1icm93c2VyLm1qc2AsXG4gICAgICApXG4gICAgICBsZXQgbmVlZFJlc3RyaWN0Tm9kZVZlcnNpb24gPSB0cnVlXG4gICAgICBpZiAoc2NvcGVkUGFja2FnZUpzb24uZW5naW5lcz8ubm9kZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHsgbWFqb3IgfSA9IHBhcnNlKHNjb3BlZFBhY2thZ2VKc29uLmVuZ2luZXMubm9kZSkgPz8ge1xuICAgICAgICAgICAgbWFqb3I6IDAsXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChtYWpvciA+PSAxNCkge1xuICAgICAgICAgICAgbmVlZFJlc3RyaWN0Tm9kZVZlcnNpb24gPSBmYWxzZVxuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChuZWVkUmVzdHJpY3ROb2RlVmVyc2lvbikge1xuICAgICAgICBzY29wZWRQYWNrYWdlSnNvbi5lbmdpbmVzID0ge1xuICAgICAgICAgIG5vZGU6ICc+PTE0LjAuMCcsXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNvbnN0IGVtbmFwaVZlcnNpb24gPSByZXF1aXJlKCdlbW5hcGkvcGFja2FnZS5qc29uJykudmVyc2lvblxuICAgICAgY29uc3Qgd2FzbVJ1bnRpbWUgPSBhd2FpdCBmZXRjaChcbiAgICAgICAgYGh0dHBzOi8vcmVnaXN0cnkubnBtanMub3JnL0BuYXBpLXJzL3dhc20tcnVudGltZWAsXG4gICAgICApLnRoZW4oKHJlcykgPT4gcmVzLmpzb24oKSBhcyBQcm9taXNlPFBhY2thZ2VNZXRhPilcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmRlcGVuZGVuY2llcyA9IHtcbiAgICAgICAgJ0BuYXBpLXJzL3dhc20tcnVudGltZSc6IGBeJHt3YXNtUnVudGltZVsnZGlzdC10YWdzJ10ubGF0ZXN0fWAsXG4gICAgICAgICdAZW1uYXBpL2NvcmUnOiBlbW5hcGlWZXJzaW9uLFxuICAgICAgICAnQGVtbmFwaS9ydW50aW1lJzogZW1uYXBpVmVyc2lvbixcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0LmFiaSA9PT0gJ2dudScpIHtcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmxpYmMgPSBbJ2dsaWJjJ11cbiAgICB9IGVsc2UgaWYgKHRhcmdldC5hYmkgPT09ICdtdXNsJykge1xuICAgICAgc2NvcGVkUGFja2FnZUpzb24ubGliYyA9IFsnbXVzbCddXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0UGFja2FnZUpzb24gPSBqb2luKHRhcmdldERpciwgJ3BhY2thZ2UuanNvbicpXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICB0YXJnZXRQYWNrYWdlSnNvbixcbiAgICAgIEpTT04uc3RyaW5naWZ5KHNjb3BlZFBhY2thZ2VKc29uLCBudWxsLCAyKSArICdcXG4nLFxuICAgIClcbiAgICBjb25zdCB0YXJnZXRSZWFkbWUgPSBqb2luKHRhcmdldERpciwgJ1JFQURNRS5tZCcpXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmModGFyZ2V0UmVhZG1lLCByZWFkbWUocGFja2FnZU5hbWUsIHRhcmdldCkpXG5cbiAgICBkZWJ1Zy5pbmZvKGAke3BhY2thZ2VOYW1lfSAtJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfSBjcmVhdGVkYClcbiAgfVxufVxuXG5mdW5jdGlvbiByZWFkbWUocGFja2FnZU5hbWU6IHN0cmluZywgdGFyZ2V0OiBUYXJnZXQpIHtcbiAgcmV0dXJuIGAjIFxcYCR7cGFja2FnZU5hbWV9LSR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1cXGBcblxuVGhpcyBpcyB0aGUgKioke3RhcmdldC50cmlwbGV9KiogYmluYXJ5IGZvciBcXGAke3BhY2thZ2VOYW1lfVxcYFxuYFxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcbmltcG9ydCAqIGFzIHR5cGFuaW9uIGZyb20gJ3R5cGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZU5ld0NvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1snbmV3J11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdDcmVhdGUgYSBuZXcgcHJvamVjdCB3aXRoIHByZS1jb25maWd1cmVkIGJvaWxlcnBsYXRlJyxcbiAgfSlcblxuICAkJHBhdGggPSBPcHRpb24uU3RyaW5nKHsgcmVxdWlyZWQ6IGZhbHNlIH0pXG5cbiAgJCRuYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1uYW1lLC1uJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSBuYW1lIG9mIHRoZSBwcm9qZWN0LCBkZWZhdWx0IHRvIHRoZSBuYW1lIG9mIHRoZSBkaXJlY3RvcnkgaWYgbm90IHByb3ZpZGVkJyxcbiAgfSlcblxuICBtaW5Ob2RlQXBpVmVyc2lvbiA9IE9wdGlvbi5TdHJpbmcoJy0tbWluLW5vZGUtYXBpLC12JywgJzQnLCB7XG4gICAgdmFsaWRhdG9yOiB0eXBhbmlvbi5pc051bWJlcigpLFxuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG1pbmltdW0gTm9kZS1BUEkgdmVyc2lvbiB0byBzdXBwb3J0JyxcbiAgfSlcblxuICBwYWNrYWdlTWFuYWdlciA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1tYW5hZ2VyJywgJ3lhcm4nLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgcGFja2FnZSBtYW5hZ2VyIHRvIHVzZS4gT25seSBzdXBwb3J0IHlhcm4gNC54IGZvciBub3cuJyxcbiAgfSlcblxuICBsaWNlbnNlID0gT3B0aW9uLlN0cmluZygnLS1saWNlbnNlLC1sJywgJ01JVCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0xpY2Vuc2UgZm9yIG9wZW4tc291cmNlZCBwcm9qZWN0JyxcbiAgfSlcblxuICB0YXJnZXRzID0gT3B0aW9uLkFycmF5KCctLXRhcmdldHMsLXQnLCBbXSwge1xuICAgIGRlc2NyaXB0aW9uOiAnQWxsIHRhcmdldHMgdGhlIGNyYXRlIHdpbGwgYmUgY29tcGlsZWQgZm9yLicsXG4gIH0pXG5cbiAgZW5hYmxlRGVmYXVsdFRhcmdldHMgPSBPcHRpb24uQm9vbGVhbignLS1lbmFibGUtZGVmYXVsdC10YXJnZXRzJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBlbmFibGUgZGVmYXVsdCB0YXJnZXRzJyxcbiAgfSlcblxuICBlbmFibGVBbGxUYXJnZXRzID0gT3B0aW9uLkJvb2xlYW4oJy0tZW5hYmxlLWFsbC10YXJnZXRzJywgZmFsc2UsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgZW5hYmxlIGFsbCB0YXJnZXRzJyxcbiAgfSlcblxuICBlbmFibGVUeXBlRGVmID0gT3B0aW9uLkJvb2xlYW4oJy0tZW5hYmxlLXR5cGUtZGVmJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1doZXRoZXIgZW5hYmxlIHRoZSBgdHlwZS1kZWZgIGZlYXR1cmUgZm9yIHR5cGVzY3JpcHQgZGVmaW5pdGlvbnMgYXV0by1nZW5lcmF0aW9uJyxcbiAgfSlcblxuICBlbmFibGVHaXRodWJBY3Rpb25zID0gT3B0aW9uLkJvb2xlYW4oJy0tZW5hYmxlLWdpdGh1Yi1hY3Rpb25zJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBnZW5lcmF0ZSBwcmVjb25maWd1cmVkIEdpdEh1YiBBY3Rpb25zIHdvcmtmbG93JyxcbiAgfSlcblxuICB0ZXN0RnJhbWV3b3JrID0gT3B0aW9uLlN0cmluZygnLS10ZXN0LWZyYW1ld29yaycsICdhdmEnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIEphdmFTY3JpcHQgdGVzdCBmcmFtZXdvcmsgdG8gdXNlLCBvbmx5IHN1cHBvcnQgYGF2YWAgZm9yIG5vdycsXG4gIH0pXG5cbiAgZHJ5UnVuID0gT3B0aW9uLkJvb2xlYW4oJy0tZHJ5LXJ1bicsIGZhbHNlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIHRvIHJ1biB0aGUgY29tbWFuZCBpbiBkcnktcnVuIG1vZGUnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHBhdGg6IHRoaXMuJCRwYXRoLFxuICAgICAgbmFtZTogdGhpcy4kJG5hbWUsXG4gICAgICBtaW5Ob2RlQXBpVmVyc2lvbjogdGhpcy5taW5Ob2RlQXBpVmVyc2lvbixcbiAgICAgIHBhY2thZ2VNYW5hZ2VyOiB0aGlzLnBhY2thZ2VNYW5hZ2VyLFxuICAgICAgbGljZW5zZTogdGhpcy5saWNlbnNlLFxuICAgICAgdGFyZ2V0czogdGhpcy50YXJnZXRzLFxuICAgICAgZW5hYmxlRGVmYXVsdFRhcmdldHM6IHRoaXMuZW5hYmxlRGVmYXVsdFRhcmdldHMsXG4gICAgICBlbmFibGVBbGxUYXJnZXRzOiB0aGlzLmVuYWJsZUFsbFRhcmdldHMsXG4gICAgICBlbmFibGVUeXBlRGVmOiB0aGlzLmVuYWJsZVR5cGVEZWYsXG4gICAgICBlbmFibGVHaXRodWJBY3Rpb25zOiB0aGlzLmVuYWJsZUdpdGh1YkFjdGlvbnMsXG4gICAgICB0ZXN0RnJhbWV3b3JrOiB0aGlzLnRlc3RGcmFtZXdvcmssXG4gICAgICBkcnlSdW46IHRoaXMuZHJ5UnVuLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZSBhIG5ldyBwcm9qZWN0IHdpdGggcHJlLWNvbmZpZ3VyZWQgYm9pbGVycGxhdGVcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBOZXdPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBwYXRoIHdoZXJlIHRoZSBOQVBJLVJTIHByb2plY3Qgd2lsbCBiZSBjcmVhdGVkLlxuICAgKi9cbiAgcGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5hbWUgb2YgdGhlIHByb2plY3QsIGRlZmF1bHQgdG8gdGhlIG5hbWUgb2YgdGhlIGRpcmVjdG9yeSBpZiBub3QgcHJvdmlkZWRcbiAgICovXG4gIG5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBtaW5pbXVtIE5vZGUtQVBJIHZlcnNpb24gdG8gc3VwcG9ydFxuICAgKlxuICAgKiBAZGVmYXVsdCA0XG4gICAqL1xuICBtaW5Ob2RlQXBpVmVyc2lvbj86IG51bWJlclxuICAvKipcbiAgICogVGhlIHBhY2thZ2UgbWFuYWdlciB0byB1c2UuIE9ubHkgc3VwcG9ydCB5YXJuIDQueCBmb3Igbm93LlxuICAgKlxuICAgKiBAZGVmYXVsdCAneWFybidcbiAgICovXG4gIHBhY2thZ2VNYW5hZ2VyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBMaWNlbnNlIGZvciBvcGVuLXNvdXJjZWQgcHJvamVjdFxuICAgKlxuICAgKiBAZGVmYXVsdCAnTUlUJ1xuICAgKi9cbiAgbGljZW5zZT86IHN0cmluZ1xuICAvKipcbiAgICogQWxsIHRhcmdldHMgdGhlIGNyYXRlIHdpbGwgYmUgY29tcGlsZWQgZm9yLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbXVxuICAgKi9cbiAgdGFyZ2V0cz86IHN0cmluZ1tdXG4gIC8qKlxuICAgKiBXaGV0aGVyIGVuYWJsZSBkZWZhdWx0IHRhcmdldHNcbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZW5hYmxlRGVmYXVsdFRhcmdldHM/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGVuYWJsZSBhbGwgdGFyZ2V0c1xuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZW5hYmxlQWxsVGFyZ2V0cz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgZW5hYmxlIHRoZSBgdHlwZS1kZWZgIGZlYXR1cmUgZm9yIHR5cGVzY3JpcHQgZGVmaW5pdGlvbnMgYXV0by1nZW5lcmF0aW9uXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGVuYWJsZVR5cGVEZWY/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGdlbmVyYXRlIHByZWNvbmZpZ3VyZWQgR2l0SHViIEFjdGlvbnMgd29ya2Zsb3dcbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZW5hYmxlR2l0aHViQWN0aW9ucz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFRoZSBKYXZhU2NyaXB0IHRlc3QgZnJhbWV3b3JrIHRvIHVzZSwgb25seSBzdXBwb3J0IGBhdmFgIGZvciBub3dcbiAgICpcbiAgICogQGRlZmF1bHQgJ2F2YSdcbiAgICovXG4gIHRlc3RGcmFtZXdvcms/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcnVuIHRoZSBjb21tYW5kIGluIGRyeS1ydW4gbW9kZVxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZHJ5UnVuPzogYm9vbGVhblxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0TmV3T3B0aW9ucyhvcHRpb25zOiBOZXdPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgbWluTm9kZUFwaVZlcnNpb246IDQsXG4gICAgcGFja2FnZU1hbmFnZXI6ICd5YXJuJyxcbiAgICBsaWNlbnNlOiAnTUlUJyxcbiAgICB0YXJnZXRzOiBbXSxcbiAgICBlbmFibGVEZWZhdWx0VGFyZ2V0czogdHJ1ZSxcbiAgICBlbmFibGVBbGxUYXJnZXRzOiBmYWxzZSxcbiAgICBlbmFibGVUeXBlRGVmOiB0cnVlLFxuICAgIGVuYWJsZUdpdGh1YkFjdGlvbnM6IHRydWUsXG4gICAgdGVzdEZyYW1ld29yazogJ2F2YScsXG4gICAgZHJ5UnVuOiBmYWxzZSxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCIvLyBDb3B5cmlnaHQgMjAxOC0yMDI1IHRoZSBEZW5vIGF1dGhvcnMuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuLy8gQmFyZSBrZXlzIG1heSBvbmx5IGNvbnRhaW4gQVNDSUkgbGV0dGVycyxcbi8vIEFTQ0lJIGRpZ2l0cywgdW5kZXJzY29yZXMsIGFuZCBkYXNoZXMgKEEtWmEtejAtOV8tKS5cbmZ1bmN0aW9uIGpvaW5LZXlzKGtleXMpIHtcbiAgLy8gRG90dGVkIGtleXMgYXJlIGEgc2VxdWVuY2Ugb2YgYmFyZSBvciBxdW90ZWQga2V5cyBqb2luZWQgd2l0aCBhIGRvdC5cbiAgLy8gVGhpcyBhbGxvd3MgZm9yIGdyb3VwaW5nIHNpbWlsYXIgcHJvcGVydGllcyB0b2dldGhlcjpcbiAgcmV0dXJuIGtleXMubWFwKChzdHIpPT57XG4gICAgcmV0dXJuIHN0ci5sZW5ndGggPT09IDAgfHwgc3RyLm1hdGNoKC9bXkEtWmEtejAtOV8tXS8pID8gSlNPTi5zdHJpbmdpZnkoc3RyKSA6IHN0cjtcbiAgfSkuam9pbihcIi5cIik7XG59XG5jbGFzcyBEdW1wZXIge1xuICBtYXhQYWQgPSAwO1xuICBzcmNPYmplY3Q7XG4gIG91dHB1dCA9IFtdO1xuICAjYXJyYXlUeXBlQ2FjaGUgPSBuZXcgTWFwKCk7XG4gIGNvbnN0cnVjdG9yKHNyY09iamMpe1xuICAgIHRoaXMuc3JjT2JqZWN0ID0gc3JjT2JqYztcbiAgfVxuICBkdW1wKGZtdE9wdGlvbnMgPSB7fSkge1xuICAgIC8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG4gICAgdGhpcy5vdXRwdXQgPSB0aGlzLiNwcmludE9iamVjdCh0aGlzLnNyY09iamVjdCk7XG4gICAgdGhpcy5vdXRwdXQgPSB0aGlzLiNmb3JtYXQoZm10T3B0aW9ucyk7XG4gICAgcmV0dXJuIHRoaXMub3V0cHV0O1xuICB9XG4gICNwcmludE9iamVjdChvYmosIGtleXMgPSBbXSkge1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGNvbnN0IHByb3BzID0gT2JqZWN0LmtleXMob2JqKTtcbiAgICBjb25zdCBpbmxpbmVQcm9wcyA9IFtdO1xuICAgIGNvbnN0IG11bHRpbGluZVByb3BzID0gW107XG4gICAgZm9yIChjb25zdCBwcm9wIG9mIHByb3BzKXtcbiAgICAgIGlmICh0aGlzLiNpc1NpbXBseVNlcmlhbGl6YWJsZShvYmpbcHJvcF0pKSB7XG4gICAgICAgIGlubGluZVByb3BzLnB1c2gocHJvcCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtdWx0aWxpbmVQcm9wcy5wdXNoKHByb3ApO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWRQcm9wcyA9IGlubGluZVByb3BzLmNvbmNhdChtdWx0aWxpbmVQcm9wcyk7XG4gICAgZm9yIChjb25zdCBwcm9wIG9mIHNvcnRlZFByb3BzKXtcbiAgICAgIGNvbnN0IHZhbHVlID0gb2JqW3Byb3BdO1xuICAgICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgICBvdXQucHVzaCh0aGlzLiNkYXRlRGVjbGFyYXRpb24oW1xuICAgICAgICAgIHByb3BcbiAgICAgICAgXSwgdmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICAgIG91dC5wdXNoKHRoaXMuI3N0ckRlY2xhcmF0aW9uKFtcbiAgICAgICAgICBwcm9wXG4gICAgICAgIF0sIHZhbHVlLnRvU3RyaW5nKCkpKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIG91dC5wdXNoKHRoaXMuI251bWJlckRlY2xhcmF0aW9uKFtcbiAgICAgICAgICBwcm9wXG4gICAgICAgIF0sIHZhbHVlKSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgICAgb3V0LnB1c2godGhpcy4jYm9vbERlY2xhcmF0aW9uKFtcbiAgICAgICAgICBwcm9wXG4gICAgICAgIF0sIHZhbHVlKSk7XG4gICAgICB9IGVsc2UgaWYgKHZhbHVlIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgY29uc3QgYXJyYXlUeXBlID0gdGhpcy4jZ2V0VHlwZU9mQXJyYXkodmFsdWUpO1xuICAgICAgICBpZiAoYXJyYXlUeXBlID09PSBcIk9OTFlfUFJJTUlUSVZFXCIpIHtcbiAgICAgICAgICBvdXQucHVzaCh0aGlzLiNhcnJheURlY2xhcmF0aW9uKFtcbiAgICAgICAgICAgIHByb3BcbiAgICAgICAgICBdLCB2YWx1ZSkpO1xuICAgICAgICB9IGVsc2UgaWYgKGFycmF5VHlwZSA9PT0gXCJPTkxZX09CSkVDVF9FWENMVURJTkdfQVJSQVlcIikge1xuICAgICAgICAgIC8vIGFycmF5IG9mIG9iamVjdHNcbiAgICAgICAgICBmb3IobGV0IGkgPSAwOyBpIDwgdmFsdWUubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgb3V0LnB1c2goXCJcIik7XG4gICAgICAgICAgICBvdXQucHVzaCh0aGlzLiNoZWFkZXJHcm91cChbXG4gICAgICAgICAgICAgIC4uLmtleXMsXG4gICAgICAgICAgICAgIHByb3BcbiAgICAgICAgICAgIF0pKTtcbiAgICAgICAgICAgIG91dC5wdXNoKC4uLnRoaXMuI3ByaW50T2JqZWN0KHZhbHVlW2ldLCBbXG4gICAgICAgICAgICAgIC4uLmtleXMsXG4gICAgICAgICAgICAgIHByb3BcbiAgICAgICAgICAgIF0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdGhpcyBpcyBhIGNvbXBsZXggYXJyYXksIHVzZSB0aGUgaW5saW5lIGZvcm1hdC5cbiAgICAgICAgICBjb25zdCBzdHIgPSB2YWx1ZS5tYXAoKHgpPT50aGlzLiNwcmludEFzSW5saW5lVmFsdWUoeCkpLmpvaW4oXCIsXCIpO1xuICAgICAgICAgIG91dC5wdXNoKGAke3RoaXMuI2RlY2xhcmF0aW9uKFtcbiAgICAgICAgICAgIHByb3BcbiAgICAgICAgICBdKX1bJHtzdHJ9XWApO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIikge1xuICAgICAgICBvdXQucHVzaChcIlwiKTtcbiAgICAgICAgb3V0LnB1c2godGhpcy4jaGVhZGVyKFtcbiAgICAgICAgICAuLi5rZXlzLFxuICAgICAgICAgIHByb3BcbiAgICAgICAgXSkpO1xuICAgICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgICBjb25zdCB0b1BhcnNlID0gdmFsdWU7XG4gICAgICAgICAgb3V0LnB1c2goLi4udGhpcy4jcHJpbnRPYmplY3QodG9QYXJzZSwgW1xuICAgICAgICAgICAgLi4ua2V5cyxcbiAgICAgICAgICAgIHByb3BcbiAgICAgICAgICBdKSk7XG4gICAgICAgIH1cbiAgICAgIC8vIG91dC5wdXNoKC4uLnRoaXMuX3BhcnNlKHZhbHVlLCBgJHtwYXRofSR7cHJvcH0uYCkpO1xuICAgICAgfVxuICAgIH1cbiAgICBvdXQucHVzaChcIlwiKTtcbiAgICByZXR1cm4gb3V0O1xuICB9XG4gICNpc1ByaW1pdGl2ZSh2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSBpbnN0YW5jZW9mIERhdGUgfHwgdmFsdWUgaW5zdGFuY2VvZiBSZWdFeHAgfHwgW1xuICAgICAgXCJzdHJpbmdcIixcbiAgICAgIFwibnVtYmVyXCIsXG4gICAgICBcImJvb2xlYW5cIlxuICAgIF0uaW5jbHVkZXModHlwZW9mIHZhbHVlKTtcbiAgfVxuICAjZ2V0VHlwZU9mQXJyYXkoYXJyKSB7XG4gICAgaWYgKHRoaXMuI2FycmF5VHlwZUNhY2hlLmhhcyhhcnIpKSB7XG4gICAgICByZXR1cm4gdGhpcy4jYXJyYXlUeXBlQ2FjaGUuZ2V0KGFycik7XG4gICAgfVxuICAgIGNvbnN0IHR5cGUgPSB0aGlzLiNkb0dldFR5cGVPZkFycmF5KGFycik7XG4gICAgdGhpcy4jYXJyYXlUeXBlQ2FjaGUuc2V0KGFyciwgdHlwZSk7XG4gICAgcmV0dXJuIHR5cGU7XG4gIH1cbiAgI2RvR2V0VHlwZU9mQXJyYXkoYXJyKSB7XG4gICAgaWYgKCFhcnIubGVuZ3RoKSB7XG4gICAgICAvLyBhbnkgdHlwZSBzaG91bGQgYmUgZmluZVxuICAgICAgcmV0dXJuIFwiT05MWV9QUklNSVRJVkVcIjtcbiAgICB9XG4gICAgY29uc3Qgb25seVByaW1pdGl2ZSA9IHRoaXMuI2lzUHJpbWl0aXZlKGFyclswXSk7XG4gICAgaWYgKGFyclswXSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICByZXR1cm4gXCJNSVhFRFwiO1xuICAgIH1cbiAgICBmb3IobGV0IGkgPSAxOyBpIDwgYXJyLmxlbmd0aDsgaSsrKXtcbiAgICAgIGlmIChvbmx5UHJpbWl0aXZlICE9PSB0aGlzLiNpc1ByaW1pdGl2ZShhcnJbaV0pIHx8IGFycltpXSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICAgIHJldHVybiBcIk1JWEVEXCI7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBvbmx5UHJpbWl0aXZlID8gXCJPTkxZX1BSSU1JVElWRVwiIDogXCJPTkxZX09CSkVDVF9FWENMVURJTkdfQVJSQVlcIjtcbiAgfVxuICAjcHJpbnRBc0lubGluZVZhbHVlKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgcmV0dXJuIGBcIiR7dGhpcy4jcHJpbnREYXRlKHZhbHVlKX1cImA7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdmFsdWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZS50b1N0cmluZygpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHZhbHVlLnRvU3RyaW5nKCk7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBjb25zdCBzdHIgPSB2YWx1ZS5tYXAoKHgpPT50aGlzLiNwcmludEFzSW5saW5lVmFsdWUoeCkpLmpvaW4oXCIsXCIpO1xuICAgICAgcmV0dXJuIGBbJHtzdHJ9XWA7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU2hvdWxkIG5ldmVyIHJlYWNoXCIpO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RyID0gT2JqZWN0LmtleXModmFsdWUpLm1hcCgoa2V5KT0+e1xuICAgICAgICByZXR1cm4gYCR7am9pbktleXMoW1xuICAgICAgICAgIGtleVxuICAgICAgICBdKX0gPSAkey8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG4gICAgICAgIHRoaXMuI3ByaW50QXNJbmxpbmVWYWx1ZSh2YWx1ZVtrZXldKX1gO1xuICAgICAgfSkuam9pbihcIixcIik7XG4gICAgICByZXR1cm4gYHske3N0cn19YDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiU2hvdWxkIG5ldmVyIHJlYWNoXCIpO1xuICB9XG4gICNpc1NpbXBseVNlcmlhbGl6YWJsZSh2YWx1ZSkge1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIHZhbHVlID09PSBcIm51bWJlclwiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIgfHwgdmFsdWUgaW5zdGFuY2VvZiBSZWdFeHAgfHwgdmFsdWUgaW5zdGFuY2VvZiBEYXRlIHx8IHZhbHVlIGluc3RhbmNlb2YgQXJyYXkgJiYgdGhpcy4jZ2V0VHlwZU9mQXJyYXkodmFsdWUpICE9PSBcIk9OTFlfT0JKRUNUX0VYQ0xVRElOR19BUlJBWVwiO1xuICB9XG4gICNoZWFkZXIoa2V5cykge1xuICAgIHJldHVybiBgWyR7am9pbktleXMoa2V5cyl9XWA7XG4gIH1cbiAgI2hlYWRlckdyb3VwKGtleXMpIHtcbiAgICByZXR1cm4gYFtbJHtqb2luS2V5cyhrZXlzKX1dXWA7XG4gIH1cbiAgI2RlY2xhcmF0aW9uKGtleXMpIHtcbiAgICBjb25zdCB0aXRsZSA9IGpvaW5LZXlzKGtleXMpO1xuICAgIGlmICh0aXRsZS5sZW5ndGggPiB0aGlzLm1heFBhZCkge1xuICAgICAgdGhpcy5tYXhQYWQgPSB0aXRsZS5sZW5ndGg7XG4gICAgfVxuICAgIHJldHVybiBgJHt0aXRsZX0gPSBgO1xuICB9XG4gICNhcnJheURlY2xhcmF0aW9uKGtleXMsIHZhbHVlKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfSR7SlNPTi5zdHJpbmdpZnkodmFsdWUpfWA7XG4gIH1cbiAgI3N0ckRlY2xhcmF0aW9uKGtleXMsIHZhbHVlKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfSR7SlNPTi5zdHJpbmdpZnkodmFsdWUpfWA7XG4gIH1cbiAgI251bWJlckRlY2xhcmF0aW9uKGtleXMsIHZhbHVlKSB7XG4gICAgaWYgKE51bWJlci5pc05hTih2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX1uYW5gO1xuICAgIH1cbiAgICBzd2l0Y2godmFsdWUpe1xuICAgICAgY2FzZSBJbmZpbml0eTpcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfWluZmA7XG4gICAgICBjYXNlIC1JbmZpbml0eTpcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfS1pbmZgO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfSR7dmFsdWV9YDtcbiAgICB9XG4gIH1cbiAgI2Jvb2xEZWNsYXJhdGlvbihrZXlzLCB2YWx1ZSkge1xuICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0ke3ZhbHVlfWA7XG4gIH1cbiAgI3ByaW50RGF0ZSh2YWx1ZSkge1xuICAgIGZ1bmN0aW9uIGR0UGFkKHYsIGxQYWQgPSAyKSB7XG4gICAgICByZXR1cm4gdi5wYWRTdGFydChsUGFkLCBcIjBcIik7XG4gICAgfVxuICAgIGNvbnN0IG0gPSBkdFBhZCgodmFsdWUuZ2V0VVRDTW9udGgoKSArIDEpLnRvU3RyaW5nKCkpO1xuICAgIGNvbnN0IGQgPSBkdFBhZCh2YWx1ZS5nZXRVVENEYXRlKCkudG9TdHJpbmcoKSk7XG4gICAgY29uc3QgaCA9IGR0UGFkKHZhbHVlLmdldFVUQ0hvdXJzKCkudG9TdHJpbmcoKSk7XG4gICAgY29uc3QgbWluID0gZHRQYWQodmFsdWUuZ2V0VVRDTWludXRlcygpLnRvU3RyaW5nKCkpO1xuICAgIGNvbnN0IHMgPSBkdFBhZCh2YWx1ZS5nZXRVVENTZWNvbmRzKCkudG9TdHJpbmcoKSk7XG4gICAgY29uc3QgbXMgPSBkdFBhZCh2YWx1ZS5nZXRVVENNaWxsaXNlY29uZHMoKS50b1N0cmluZygpLCAzKTtcbiAgICAvLyBmb3JtYXR0ZWQgZGF0ZVxuICAgIGNvbnN0IGZEYXRhID0gYCR7dmFsdWUuZ2V0VVRDRnVsbFllYXIoKX0tJHttfS0ke2R9VCR7aH06JHttaW59OiR7c30uJHttc31gO1xuICAgIHJldHVybiBmRGF0YTtcbiAgfVxuICAjZGF0ZURlY2xhcmF0aW9uKGtleXMsIHZhbHVlKSB7XG4gICAgcmV0dXJuIGAke3RoaXMuI2RlY2xhcmF0aW9uKGtleXMpfSR7dGhpcy4jcHJpbnREYXRlKHZhbHVlKX1gO1xuICB9XG4gICNmb3JtYXQob3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgeyBrZXlBbGlnbm1lbnQgPSBmYWxzZSB9ID0gb3B0aW9ucztcbiAgICBjb25zdCByRGVjbGFyYXRpb24gPSAvXihcXFwiLipcXFwifFtePV0qKVxccz0vO1xuICAgIGNvbnN0IG91dCA9IFtdO1xuICAgIGZvcihsZXQgaSA9IDA7IGkgPCB0aGlzLm91dHB1dC5sZW5ndGg7IGkrKyl7XG4gICAgICBjb25zdCBsID0gdGhpcy5vdXRwdXRbaV07XG4gICAgICAvLyB3ZSBrZWVwIGVtcHR5IGVudHJ5IGZvciBhcnJheSBvZiBvYmplY3RzXG4gICAgICBpZiAobFswXSA9PT0gXCJbXCIgJiYgbFsxXSAhPT0gXCJbXCIpIHtcbiAgICAgICAgLy8gbm9uLWVtcHR5IG9iamVjdCB3aXRoIG9ubHkgc3Vib2JqZWN0cyBhcyBwcm9wZXJ0aWVzXG4gICAgICAgIGlmICh0aGlzLm91dHB1dFtpICsgMV0gPT09IFwiXCIgJiYgdGhpcy5vdXRwdXRbaSArIDJdPy5zbGljZSgwLCBsLmxlbmd0aCkgPT09IGwuc2xpY2UoMCwgLTEpICsgXCIuXCIpIHtcbiAgICAgICAgICBpICs9IDE7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgb3V0LnB1c2gobCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoa2V5QWxpZ25tZW50KSB7XG4gICAgICAgICAgY29uc3QgbSA9IHJEZWNsYXJhdGlvbi5leGVjKGwpO1xuICAgICAgICAgIGlmIChtICYmIG1bMV0pIHtcbiAgICAgICAgICAgIG91dC5wdXNoKGwucmVwbGFjZShtWzFdLCBtWzFdLnBhZEVuZCh0aGlzLm1heFBhZCkpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3V0LnB1c2gobCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG91dC5wdXNoKGwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIC8vIENsZWFuaW5nIG11bHRpcGxlIHNwYWNlc1xuICAgIGNvbnN0IGNsZWFuZWRPdXRwdXQgPSBbXTtcbiAgICBmb3IobGV0IGkgPSAwOyBpIDwgb3V0Lmxlbmd0aDsgaSsrKXtcbiAgICAgIGNvbnN0IGwgPSBvdXRbaV07XG4gICAgICBpZiAoIShsID09PSBcIlwiICYmIG91dFtpICsgMV0gPT09IFwiXCIpKSB7XG4gICAgICAgIGNsZWFuZWRPdXRwdXQucHVzaChsKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGNsZWFuZWRPdXRwdXQ7XG4gIH1cbn1cbi8qKlxuICogQ29udmVydHMgYW4gb2JqZWN0IHRvIGEge0BsaW5rIGh0dHBzOi8vdG9tbC5pbyB8IFRPTUx9IHN0cmluZy5cbiAqXG4gKiBAZXhhbXBsZSBVc2FnZVxuICogYGBgdHNcbiAqIGltcG9ydCB7IHN0cmluZ2lmeSB9IGZyb20gXCJAc3RkL3RvbWwvc3RyaW5naWZ5XCI7XG4gKiBpbXBvcnQgeyBhc3NlcnRFcXVhbHMgfSBmcm9tIFwiQHN0ZC9hc3NlcnRcIjtcbiAqXG4gKiBjb25zdCBvYmogPSB7XG4gKiAgIHRpdGxlOiBcIlRPTUwgRXhhbXBsZVwiLFxuICogICBvd25lcjoge1xuICogICAgIG5hbWU6IFwiQm9iXCIsXG4gKiAgICAgYmlvOiBcIkJvYiBpcyBhIGNvb2wgZ3V5XCIsXG4gKiAgfVxuICogfTtcbiAqIGNvbnN0IHRvbWxTdHJpbmcgPSBzdHJpbmdpZnkob2JqKTtcbiAqIGFzc2VydEVxdWFscyh0b21sU3RyaW5nLCBgdGl0bGUgPSBcIlRPTUwgRXhhbXBsZVwiXFxuXFxuW293bmVyXVxcbm5hbWUgPSBcIkJvYlwiXFxuYmlvID0gXCJCb2IgaXMgYSBjb29sIGd1eVwiXFxuYCk7XG4gKiBgYGBcbiAqIEBwYXJhbSBvYmogU291cmNlIG9iamVjdFxuICogQHBhcmFtIG9wdGlvbnMgT3B0aW9ucyBmb3Igc3RyaW5naWZ5aW5nLlxuICogQHJldHVybnMgVE9NTCBzdHJpbmdcbiAqLyBleHBvcnQgZnVuY3Rpb24gc3RyaW5naWZ5KG9iaiwgb3B0aW9ucykge1xuICByZXR1cm4gbmV3IER1bXBlcihvYmopLmR1bXAob3B0aW9ucykuam9pbihcIlxcblwiKTtcbn1cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPXN0cmluZ2lmeS5qcy5tYXAiLCIvLyBDb3B5cmlnaHQgMjAxOC0yMDI2IHRoZSBEZW5vIGF1dGhvcnMuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuLyoqIERlZmF1bHQgbWVyZ2luZyBvcHRpb25zIC0gY2FjaGVkIHRvIGF2b2lkIG9iamVjdCBhbGxvY2F0aW9uIG9uIGVhY2ggY2FsbCAqLyBjb25zdCBERUZBVUxUX09QVElPTlMgPSB7XG4gIGFycmF5czogXCJtZXJnZVwiLFxuICBzZXRzOiBcIm1lcmdlXCIsXG4gIG1hcHM6IFwibWVyZ2VcIlxufTtcbmV4cG9ydCBmdW5jdGlvbiBkZWVwTWVyZ2UocmVjb3JkLCBvdGhlciwgb3B0aW9ucykge1xuICByZXR1cm4gZGVlcE1lcmdlSW50ZXJuYWwocmVjb3JkLCBvdGhlciwgbmV3IFNldCgpLCBvcHRpb25zID8/IERFRkFVTFRfT1BUSU9OUyk7XG59XG5mdW5jdGlvbiBkZWVwTWVyZ2VJbnRlcm5hbChyZWNvcmQsIG90aGVyLCBzZWVuLCBvcHRpb25zKSB7XG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBjb25zdCBrZXlzID0gbmV3IFNldChbXG4gICAgLi4uZ2V0S2V5cyhyZWNvcmQpLFxuICAgIC4uLmdldEtleXMob3RoZXIpXG4gIF0pO1xuICAvLyBJdGVyYXRlIHRocm91Z2ggZWFjaCBrZXkgb2Ygb3RoZXIgb2JqZWN0IGFuZCB1c2UgY29ycmVjdCBtZXJnaW5nIHN0cmF0ZWd5XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpe1xuICAgIC8vIFNraXAgdG8gcHJldmVudCBPYmplY3QucHJvdG90eXBlLl9fcHJvdG9fXyBhY2Nlc3NvciBwcm9wZXJ0eSBjYWxscyBvbiBub24tRGVubyBwbGF0Zm9ybXNcbiAgICBpZiAoa2V5ID09PSBcIl9fcHJvdG9fX1wiKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYSA9IHJlY29yZFtrZXldO1xuICAgIGlmICghT2JqZWN0Lmhhc093bihvdGhlciwga2V5KSkge1xuICAgICAgcmVzdWx0W2tleV0gPSBhO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGIgPSBvdGhlcltrZXldO1xuICAgIGlmIChpc05vbk51bGxPYmplY3QoYSkgJiYgaXNOb25OdWxsT2JqZWN0KGIpICYmICFzZWVuLmhhcyhhKSAmJiAhc2Vlbi5oYXMoYikpIHtcbiAgICAgIHNlZW4uYWRkKGEpO1xuICAgICAgc2Vlbi5hZGQoYik7XG4gICAgICByZXN1bHRba2V5XSA9IG1lcmdlT2JqZWN0cyhhLCBiLCBzZWVuLCBvcHRpb25zKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBPdmVycmlkZSB2YWx1ZVxuICAgIHJlc3VsdFtrZXldID0gYjtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuZnVuY3Rpb24gbWVyZ2VPYmplY3RzKGxlZnQsIHJpZ2h0LCBzZWVuLCBvcHRpb25zKSB7XG4gIC8vIFJlY3Vyc2l2ZWx5IG1lcmdlIG1lcmdlYWJsZSBvYmplY3RzXG4gIGlmIChpc01lcmdlYWJsZShsZWZ0KSAmJiBpc01lcmdlYWJsZShyaWdodCkpIHtcbiAgICByZXR1cm4gZGVlcE1lcmdlSW50ZXJuYWwobGVmdCwgcmlnaHQsIHNlZW4sIG9wdGlvbnMpO1xuICB9XG4gIGlmIChpc0l0ZXJhYmxlKGxlZnQpICYmIGlzSXRlcmFibGUocmlnaHQpKSB7XG4gICAgLy8gSGFuZGxlIGFycmF5c1xuICAgIGlmIChBcnJheS5pc0FycmF5KGxlZnQpICYmIEFycmF5LmlzQXJyYXkocmlnaHQpKSB7XG4gICAgICBpZiAob3B0aW9ucy5hcnJheXMgPT09IFwibWVyZ2VcIikge1xuICAgICAgICByZXR1cm4gbGVmdC5jb25jYXQocmlnaHQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJpZ2h0O1xuICAgIH1cbiAgICAvLyBIYW5kbGUgbWFwc1xuICAgIGlmIChsZWZ0IGluc3RhbmNlb2YgTWFwICYmIHJpZ2h0IGluc3RhbmNlb2YgTWFwKSB7XG4gICAgICBpZiAob3B0aW9ucy5tYXBzID09PSBcIm1lcmdlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gbmV3IE1hcChsZWZ0KTtcbiAgICAgICAgZm9yIChjb25zdCBbaywgdl0gb2YgcmlnaHQpe1xuICAgICAgICAgIHJlc3VsdC5zZXQoaywgdik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIHJldHVybiByaWdodDtcbiAgICB9XG4gICAgLy8gSGFuZGxlIHNldHNcbiAgICBpZiAobGVmdCBpbnN0YW5jZW9mIFNldCAmJiByaWdodCBpbnN0YW5jZW9mIFNldCkge1xuICAgICAgaWYgKG9wdGlvbnMuc2V0cyA9PT0gXCJtZXJnZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBTZXQobGVmdCk7XG4gICAgICAgIGZvciAoY29uc3QgdiBvZiByaWdodCl7XG4gICAgICAgICAgcmVzdWx0LmFkZCh2KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJpZ2h0O1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmlnaHQ7XG59XG4vKipcbiAqIFRlc3Qgd2hldGhlciBhIHZhbHVlIGlzIG1lcmdlYWJsZSBvciBub3RcbiAqIEJ1aWx0aW5zIHRoYXQgbG9vayBsaWtlIG9iamVjdHMsIG51bGwgYW5kIHVzZXIgZGVmaW5lZCBjbGFzc2VzXG4gKiBhcmUgbm90IGNvbnNpZGVyZWQgbWVyZ2VhYmxlIChpdCBtZWFucyB0aGF0IHJlZmVyZW5jZSB3aWxsIGJlIGNvcGllZClcbiAqLyBmdW5jdGlvbiBpc01lcmdlYWJsZSh2YWx1ZSkge1xuICByZXR1cm4gT2JqZWN0LmdldFByb3RvdHlwZU9mKHZhbHVlKSA9PT0gT2JqZWN0LnByb3RvdHlwZTtcbn1cbmZ1bmN0aW9uIGlzSXRlcmFibGUodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZVtTeW1ib2wuaXRlcmF0b3JdID09PSBcImZ1bmN0aW9uXCI7XG59XG5mdW5jdGlvbiBpc05vbk51bGxPYmplY3QodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlICE9PSBudWxsICYmIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIjtcbn1cbmZ1bmN0aW9uIGdldEtleXMocmVjb3JkKSB7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhyZWNvcmQpO1xuICBjb25zdCBzeW1ib2xzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhyZWNvcmQpO1xuICAvLyBGYXN0IHBhdGg6IG1vc3Qgb2JqZWN0cyBoYXZlIG5vIHN5bWJvbCBrZXlzXG4gIGlmIChzeW1ib2xzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIGtleXM7XG4gIGZvciAoY29uc3Qgc3ltIG9mIHN5bWJvbHMpe1xuICAgIGlmIChPYmplY3QucHJvdG90eXBlLnByb3BlcnR5SXNFbnVtZXJhYmxlLmNhbGwocmVjb3JkLCBzeW0pKSB7XG4gICAgICBrZXlzLnB1c2goc3ltKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGtleXM7XG59XG4vLyMgc291cmNlTWFwcGluZ1VSTD1kZWVwX21lcmdlLmpzLm1hcCIsIi8vIENvcHlyaWdodCAyMDE4LTIwMjUgdGhlIERlbm8gYXV0aG9ycy4gTUlUIGxpY2Vuc2UuXG4vLyBUaGlzIG1vZHVsZSBpcyBicm93c2VyIGNvbXBhdGlibGUuXG5pbXBvcnQgeyBkZWVwTWVyZ2UgfSBmcm9tIFwiQGpzci9zdGRfX2NvbGxlY3Rpb25zL2RlZXAtbWVyZ2VcIjtcbi8qKlxuICogQ29weSBvZiBgaW1wb3J0IHsgaXNMZWFwIH0gZnJvbSBcIkBzdGQvZGF0ZXRpbWVcIjtgIGJlY2F1c2UgaXQgY2Fubm90IGJlIGltcG90ZWQgYXMgbG9uZyBhcyBpdCBpcyB1bnN0YWJsZS5cbiAqLyBmdW5jdGlvbiBpc0xlYXAoeWVhck51bWJlcikge1xuICByZXR1cm4geWVhck51bWJlciAlIDQgPT09IDAgJiYgeWVhck51bWJlciAlIDEwMCAhPT0gMCB8fCB5ZWFyTnVtYmVyICUgNDAwID09PSAwO1xufVxuZXhwb3J0IGNsYXNzIFNjYW5uZXIge1xuICAjd2hpdGVzcGFjZSA9IC9bIFxcdF0vO1xuICAjcG9zaXRpb24gPSAwO1xuICAjc291cmNlO1xuICBjb25zdHJ1Y3Rvcihzb3VyY2Upe1xuICAgIHRoaXMuI3NvdXJjZSA9IHNvdXJjZTtcbiAgfVxuICBnZXQgcG9zaXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuI3Bvc2l0aW9uO1xuICB9XG4gIGdldCBzb3VyY2UoKSB7XG4gICAgcmV0dXJuIHRoaXMuI3NvdXJjZTtcbiAgfVxuICAvKipcbiAgICogR2V0IGN1cnJlbnQgY2hhcmFjdGVyXG4gICAqIEBwYXJhbSBpbmRleCAtIHJlbGF0aXZlIGluZGV4IGZyb20gY3VycmVudCBwb3NpdGlvblxuICAgKi8gY2hhcihpbmRleCA9IDApIHtcbiAgICByZXR1cm4gdGhpcy4jc291cmNlW3RoaXMuI3Bvc2l0aW9uICsgaW5kZXhdID8/IFwiXCI7XG4gIH1cbiAgLyoqXG4gICAqIEdldCBzbGljZWQgc3RyaW5nXG4gICAqIEBwYXJhbSBzdGFydCAtIHN0YXJ0IHBvc2l0aW9uIHJlbGF0aXZlIGZyb20gY3VycmVudCBwb3NpdGlvblxuICAgKiBAcGFyYW0gZW5kIC0gZW5kIHBvc2l0aW9uIHJlbGF0aXZlIGZyb20gY3VycmVudCBwb3NpdGlvblxuICAgKi8gc2xpY2Uoc3RhcnQsIGVuZCkge1xuICAgIHJldHVybiB0aGlzLiNzb3VyY2Uuc2xpY2UodGhpcy4jcG9zaXRpb24gKyBzdGFydCwgdGhpcy4jcG9zaXRpb24gKyBlbmQpO1xuICB9XG4gIC8qKlxuICAgKiBNb3ZlIHBvc2l0aW9uIHRvIG5leHRcbiAgICovIG5leHQoY291bnQgPSAxKSB7XG4gICAgdGhpcy4jcG9zaXRpb24gKz0gY291bnQ7XG4gIH1cbiAgc2tpcFdoaXRlc3BhY2VzKCkge1xuICAgIHdoaWxlKHRoaXMuI3doaXRlc3BhY2UudGVzdCh0aGlzLmNoYXIoKSkgJiYgIXRoaXMuZW9mKCkpe1xuICAgICAgdGhpcy5uZXh0KCk7XG4gICAgfVxuICAgIC8vIEludmFsaWQgaWYgY3VycmVudCBjaGFyIGlzIG90aGVyIGtpbmRzIG9mIHdoaXRlc3BhY2VcbiAgICBpZiAoIXRoaXMuaXNDdXJyZW50Q2hhckVPTCgpICYmIC9cXHMvLnRlc3QodGhpcy5jaGFyKCkpKSB7XG4gICAgICBjb25zdCBlc2NhcGVkID0gXCJcXFxcdVwiICsgdGhpcy5jaGFyKCkuY2hhckNvZGVBdCgwKS50b1N0cmluZygxNik7XG4gICAgICBjb25zdCBwb3NpdGlvbiA9IHRoaXMuI3Bvc2l0aW9uO1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBDYW5ub3QgcGFyc2UgdGhlIFRPTUw6IEl0IGNvbnRhaW5zIGludmFsaWQgd2hpdGVzcGFjZSBhdCBwb3NpdGlvbiAnJHtwb3NpdGlvbn0nOiBcXGAke2VzY2FwZWR9XFxgYCk7XG4gICAgfVxuICB9XG4gIG5leHRVbnRpbENoYXIob3B0aW9ucyA9IHtcbiAgICBza2lwQ29tbWVudHM6IHRydWVcbiAgfSkge1xuICAgIHdoaWxlKCF0aGlzLmVvZigpKXtcbiAgICAgIGNvbnN0IGNoYXIgPSB0aGlzLmNoYXIoKTtcbiAgICAgIGlmICh0aGlzLiN3aGl0ZXNwYWNlLnRlc3QoY2hhcikgfHwgdGhpcy5pc0N1cnJlbnRDaGFyRU9MKCkpIHtcbiAgICAgICAgdGhpcy5uZXh0KCk7XG4gICAgICB9IGVsc2UgaWYgKG9wdGlvbnMuc2tpcENvbW1lbnRzICYmIHRoaXMuY2hhcigpID09PSBcIiNcIikge1xuICAgICAgICAvLyBlbnRlcmluZyBjb21tZW50XG4gICAgICAgIHdoaWxlKCF0aGlzLmlzQ3VycmVudENoYXJFT0woKSAmJiAhdGhpcy5lb2YoKSl7XG4gICAgICAgICAgdGhpcy5uZXh0KCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICAvKipcbiAgICogUG9zaXRpb24gcmVhY2hlZCBFT0Ygb3Igbm90XG4gICAqLyBlb2YoKSB7XG4gICAgcmV0dXJuIHRoaXMuI3Bvc2l0aW9uID49IHRoaXMuI3NvdXJjZS5sZW5ndGg7XG4gIH1cbiAgaXNDdXJyZW50Q2hhckVPTCgpIHtcbiAgICByZXR1cm4gdGhpcy5jaGFyKCkgPT09IFwiXFxuXCIgfHwgdGhpcy5zdGFydHNXaXRoKFwiXFxyXFxuXCIpO1xuICB9XG4gIHN0YXJ0c1dpdGgoc2VhcmNoU3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuI3NvdXJjZS5zdGFydHNXaXRoKHNlYXJjaFN0cmluZywgdGhpcy4jcG9zaXRpb24pO1xuICB9XG4gIG1hdGNoKHJlZ0V4cCkge1xuICAgIGlmICghcmVnRXhwLnN0aWNreSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBSZWdFeHAgJHtyZWdFeHB9IGRvZXMgbm90IGhhdmUgYSBzdGlja3kgJ3knIGZsYWdgKTtcbiAgICB9XG4gICAgcmVnRXhwLmxhc3RJbmRleCA9IHRoaXMuI3Bvc2l0aW9uO1xuICAgIHJldHVybiB0aGlzLiNzb3VyY2UubWF0Y2gocmVnRXhwKTtcbiAgfVxufVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFV0aWxpdGllc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmZ1bmN0aW9uIHN1Y2Nlc3MoYm9keSkge1xuICByZXR1cm4ge1xuICAgIG9rOiB0cnVlLFxuICAgIGJvZHlcbiAgfTtcbn1cbmZ1bmN0aW9uIGZhaWx1cmUoKSB7XG4gIHJldHVybiB7XG4gICAgb2s6IGZhbHNlXG4gIH07XG59XG4vKipcbiAqIENyZWF0ZXMgYSBuZXN0ZWQgb2JqZWN0IGZyb20gdGhlIGtleXMgYW5kIHZhbHVlcy5cbiAqXG4gKiBlLmcuIGB1bmZsYXQoW1wiYVwiLCBcImJcIiwgXCJjXCJdLCAxKWAgcmV0dXJucyBgeyBhOiB7IGI6IHsgYzogMSB9IH0gfWBcbiAqLyBleHBvcnQgZnVuY3Rpb24gdW5mbGF0KGtleXMsIHZhbHVlcyA9IHtcbiAgX19wcm90b19fOiBudWxsXG59KSB7XG4gIHJldHVybiBrZXlzLnJlZHVjZVJpZ2h0KChhY2MsIGtleSk9Pih7XG4gICAgICBba2V5XTogYWNjXG4gICAgfSksIHZhbHVlcyk7XG59XG5mdW5jdGlvbiBpc09iamVjdCh2YWx1ZSkge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiICYmIHZhbHVlICE9PSBudWxsO1xufVxuZnVuY3Rpb24gZ2V0VGFyZ2V0VmFsdWUodGFyZ2V0LCBrZXlzKSB7XG4gIGNvbnN0IGtleSA9IGtleXNbMF07XG4gIGlmICgha2V5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHBhcnNlIHRoZSBUT01MOiBrZXkgbGVuZ3RoIGlzIG5vdCBhIHBvc2l0aXZlIG51bWJlclwiKTtcbiAgfVxuICByZXR1cm4gdGFyZ2V0W2tleV07XG59XG5mdW5jdGlvbiBkZWVwQXNzaWduVGFibGUodGFyZ2V0LCB0YWJsZSkge1xuICBjb25zdCB7IGtleXMsIHR5cGUsIHZhbHVlIH0gPSB0YWJsZTtcbiAgY29uc3QgY3VycmVudFZhbHVlID0gZ2V0VGFyZ2V0VmFsdWUodGFyZ2V0LCBrZXlzKTtcbiAgaWYgKGN1cnJlbnRWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24odGFyZ2V0LCB1bmZsYXQoa2V5cywgdmFsdWUpKTtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50VmFsdWUpKSB7XG4gICAgY29uc3QgbGFzdCA9IGN1cnJlbnRWYWx1ZS5hdCgtMSk7XG4gICAgZGVlcEFzc2lnbihsYXN0LCB7XG4gICAgICB0eXBlLFxuICAgICAga2V5czoga2V5cy5zbGljZSgxKSxcbiAgICAgIHZhbHVlXG4gICAgfSk7XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICBpZiAoaXNPYmplY3QoY3VycmVudFZhbHVlKSkge1xuICAgIGRlZXBBc3NpZ24oY3VycmVudFZhbHVlLCB7XG4gICAgICB0eXBlLFxuICAgICAga2V5czoga2V5cy5zbGljZSgxKSxcbiAgICAgIHZhbHVlXG4gICAgfSk7XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIGFzc2lnblwiKTtcbn1cbmZ1bmN0aW9uIGRlZXBBc3NpZ25UYWJsZUFycmF5KHRhcmdldCwgdGFibGUpIHtcbiAgY29uc3QgeyB0eXBlLCBrZXlzLCB2YWx1ZSB9ID0gdGFibGU7XG4gIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IGdldFRhcmdldFZhbHVlKHRhcmdldCwga2V5cyk7XG4gIGlmIChjdXJyZW50VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHRhcmdldCwgdW5mbGF0KGtleXMsIFtcbiAgICAgIHZhbHVlXG4gICAgXSkpO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KGN1cnJlbnRWYWx1ZSkpIHtcbiAgICBpZiAodGFibGUua2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgIGN1cnJlbnRWYWx1ZS5wdXNoKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgbGFzdCA9IGN1cnJlbnRWYWx1ZS5hdCgtMSk7XG4gICAgICBkZWVwQXNzaWduKGxhc3QsIHtcbiAgICAgICAgdHlwZTogdGFibGUudHlwZSxcbiAgICAgICAga2V5czogdGFibGUua2V5cy5zbGljZSgxKSxcbiAgICAgICAgdmFsdWU6IHRhYmxlLnZhbHVlXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICBpZiAoaXNPYmplY3QoY3VycmVudFZhbHVlKSkge1xuICAgIGRlZXBBc3NpZ24oY3VycmVudFZhbHVlLCB7XG4gICAgICB0eXBlLFxuICAgICAga2V5czoga2V5cy5zbGljZSgxKSxcbiAgICAgIHZhbHVlXG4gICAgfSk7XG4gICAgcmV0dXJuIHRhcmdldDtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIGFzc2lnblwiKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBkZWVwQXNzaWduKHRhcmdldCwgYm9keSkge1xuICBzd2l0Y2goYm9keS50eXBlKXtcbiAgICBjYXNlIFwiQmxvY2tcIjpcbiAgICAgIHJldHVybiBkZWVwTWVyZ2UodGFyZ2V0LCBib2R5LnZhbHVlKTtcbiAgICBjYXNlIFwiVGFibGVcIjpcbiAgICAgIHJldHVybiBkZWVwQXNzaWduVGFibGUodGFyZ2V0LCBib2R5KTtcbiAgICBjYXNlIFwiVGFibGVBcnJheVwiOlxuICAgICAgcmV0dXJuIGRlZXBBc3NpZ25UYWJsZUFycmF5KHRhcmdldCwgYm9keSk7XG4gIH1cbn1cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGFyc2VyIGNvbWJpbmF0b3JzIGFuZCBnZW5lcmF0b3JzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGRlbm8tbGludC1pZ25vcmUgbm8tZXhwbGljaXQtYW55XG5mdW5jdGlvbiBvcihwYXJzZXJzKSB7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBmb3IgKGNvbnN0IHBhcnNlIG9mIHBhcnNlcnMpe1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2Uoc2Nhbm5lcik7XG4gICAgICBpZiAocmVzdWx0Lm9rKSByZXR1cm4gcmVzdWx0O1xuICAgIH1cbiAgICByZXR1cm4gZmFpbHVyZSgpO1xuICB9O1xufVxuLyoqIEpvaW4gdGhlIHBhcnNlIHJlc3VsdHMgb2YgdGhlIGdpdmVuIHBhcnNlciBpbnRvIGFuIGFycmF5LlxuICpcbiAqIElmIHRoZSBwYXJzZXIgZmFpbHMgYXQgdGhlIGZpcnN0IGF0dGVtcHQsIGl0IHdpbGwgcmV0dXJuIGFuIGVtcHR5IGFycmF5LlxuICovIGZ1bmN0aW9uIGpvaW4ocGFyc2VyLCBzZXBhcmF0b3IpIHtcbiAgY29uc3QgU2VwYXJhdG9yID0gY2hhcmFjdGVyKHNlcGFyYXRvcik7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCBmaXJzdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIWZpcnN0Lm9rKSByZXR1cm4gc3VjY2VzcyhvdXQpO1xuICAgIG91dC5wdXNoKGZpcnN0LmJvZHkpO1xuICAgIHdoaWxlKCFzY2FubmVyLmVvZigpKXtcbiAgICAgIGlmICghU2VwYXJhdG9yKHNjYW5uZXIpLm9rKSBicmVhaztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCB0b2tlbiBhZnRlciBcIiR7c2VwYXJhdG9yfVwiYCk7XG4gICAgICB9XG4gICAgICBvdXQucHVzaChyZXN1bHQuYm9keSk7XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzKG91dCk7XG4gIH07XG59XG4vKiogSm9pbiB0aGUgcGFyc2UgcmVzdWx0cyBvZiB0aGUgZ2l2ZW4gcGFyc2VyIGludG8gYW4gYXJyYXkuXG4gKlxuICogVGhpcyByZXF1aXJlcyB0aGUgcGFyc2VyIHRvIHN1Y2NlZWQgYXQgbGVhc3Qgb25jZS5cbiAqLyBmdW5jdGlvbiBqb2luMShwYXJzZXIsIHNlcGFyYXRvcikge1xuICBjb25zdCBTZXBhcmF0b3IgPSBjaGFyYWN0ZXIoc2VwYXJhdG9yKTtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGNvbnN0IGZpcnN0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICghZmlyc3Qub2spIHJldHVybiBmYWlsdXJlKCk7XG4gICAgY29uc3Qgb3V0ID0gW1xuICAgICAgZmlyc3QuYm9keVxuICAgIF07XG4gICAgd2hpbGUoIXNjYW5uZXIuZW9mKCkpe1xuICAgICAgaWYgKCFTZXBhcmF0b3Ioc2Nhbm5lcikub2spIGJyZWFrO1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgICAgaWYgKCFyZXN1bHQub2spIHtcbiAgICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIHRva2VuIGFmdGVyIFwiJHtzZXBhcmF0b3J9XCJgKTtcbiAgICAgIH1cbiAgICAgIG91dC5wdXNoKHJlc3VsdC5ib2R5KTtcbiAgICB9XG4gICAgcmV0dXJuIHN1Y2Nlc3Mob3V0KTtcbiAgfTtcbn1cbmZ1bmN0aW9uIGt2KGtleVBhcnNlciwgc2VwYXJhdG9yLCB2YWx1ZVBhcnNlcikge1xuICBjb25zdCBTZXBhcmF0b3IgPSBjaGFyYWN0ZXIoc2VwYXJhdG9yKTtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGNvbnN0IHBvc2l0aW9uID0gc2Nhbm5lci5wb3NpdGlvbjtcbiAgICBjb25zdCBrZXkgPSBrZXlQYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCFrZXkub2spIHJldHVybiBmYWlsdXJlKCk7XG4gICAgY29uc3Qgc2VwID0gU2VwYXJhdG9yKHNjYW5uZXIpO1xuICAgIGlmICghc2VwLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYGtleS92YWx1ZSBwYWlyIGRvZXNuJ3QgaGF2ZSBcIiR7c2VwYXJhdG9yfVwiYCk7XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gdmFsdWVQYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCF2YWx1ZS5vaykge1xuICAgICAgY29uc3QgbGluZUVuZEluZGV4ID0gc2Nhbm5lci5zb3VyY2UuaW5kZXhPZihcIlxcblwiLCBzY2FubmVyLnBvc2l0aW9uKTtcbiAgICAgIGNvbnN0IGVuZFBvc2l0aW9uID0gbGluZUVuZEluZGV4ID4gMCA/IGxpbmVFbmRJbmRleCA6IHNjYW5uZXIuc291cmNlLmxlbmd0aDtcbiAgICAgIGNvbnN0IGxpbmUgPSBzY2FubmVyLnNvdXJjZS5zbGljZShwb3NpdGlvbiwgZW5kUG9zaXRpb24pO1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBDYW5ub3QgcGFyc2UgdmFsdWUgb24gbGluZSAnJHtsaW5lfSdgKTtcbiAgICB9XG4gICAgcmV0dXJuIHN1Y2Nlc3ModW5mbGF0KGtleS5ib2R5LCB2YWx1ZS5ib2R5KSk7XG4gIH07XG59XG5mdW5jdGlvbiBtZXJnZShwYXJzZXIpIHtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIXJlc3VsdC5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICBsZXQgYm9keSA9IHtcbiAgICAgIF9fcHJvdG9fXzogbnVsbFxuICAgIH07XG4gICAgZm9yIChjb25zdCByZWNvcmQgb2YgcmVzdWx0LmJvZHkpe1xuICAgICAgaWYgKHR5cGVvZiByZWNvcmQgPT09IFwib2JqZWN0XCIgJiYgcmVjb3JkICE9PSBudWxsKSB7XG4gICAgICAgIGJvZHkgPSBkZWVwTWVyZ2UoYm9keSwgcmVjb3JkKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHN1Y2Nlc3MoYm9keSk7XG4gIH07XG59XG5mdW5jdGlvbiByZXBlYXQocGFyc2VyKSB7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBjb25zdCBib2R5ID0gW107XG4gICAgd2hpbGUoIXNjYW5uZXIuZW9mKCkpe1xuICAgICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgICAgaWYgKCFyZXN1bHQub2spIGJyZWFrO1xuICAgICAgYm9keS5wdXNoKHJlc3VsdC5ib2R5KTtcbiAgICAgIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICAgIH1cbiAgICBpZiAoYm9keS5sZW5ndGggPT09IDApIHJldHVybiBmYWlsdXJlKCk7XG4gICAgcmV0dXJuIHN1Y2Nlc3MoYm9keSk7XG4gIH07XG59XG5mdW5jdGlvbiBzdXJyb3VuZChsZWZ0LCBwYXJzZXIsIHJpZ2h0KSB7XG4gIGNvbnN0IExlZnQgPSBjaGFyYWN0ZXIobGVmdCk7XG4gIGNvbnN0IFJpZ2h0ID0gY2hhcmFjdGVyKHJpZ2h0KTtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIGlmICghTGVmdChzY2FubmVyKS5vaykge1xuICAgICAgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICB9XG4gICAgY29uc3QgcmVzdWx0ID0gcGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgdG9rZW4gYWZ0ZXIgXCIke2xlZnR9XCJgKTtcbiAgICB9XG4gICAgaWYgKCFSaWdodChzY2FubmVyKS5vaykge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBOb3QgY2xvc2VkIGJ5IFwiJHtyaWdodH1cIiBhZnRlciBzdGFydGVkIHdpdGggXCIke2xlZnR9XCJgKTtcbiAgICB9XG4gICAgcmV0dXJuIHN1Y2Nlc3MocmVzdWx0LmJvZHkpO1xuICB9O1xufVxuZnVuY3Rpb24gY2hhcmFjdGVyKHN0cikge1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgICBpZiAoIXNjYW5uZXIuc3RhcnRzV2l0aChzdHIpKSByZXR1cm4gZmFpbHVyZSgpO1xuICAgIHNjYW5uZXIubmV4dChzdHIubGVuZ3RoKTtcbiAgICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICAgIHJldHVybiBzdWNjZXNzKHVuZGVmaW5lZCk7XG4gIH07XG59XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gUGFyc2VyIGNvbXBvbmVudHNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zdCBCQVJFX0tFWV9SRUdFWFAgPSAvW0EtWmEtejAtOV8tXSsveTtcbmV4cG9ydCBmdW5jdGlvbiBiYXJlS2V5KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3Qga2V5ID0gc2Nhbm5lci5tYXRjaChCQVJFX0tFWV9SRUdFWFApPy5bMF07XG4gIGlmICgha2V5KSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoa2V5Lmxlbmd0aCk7XG4gIHJldHVybiBzdWNjZXNzKGtleSk7XG59XG5mdW5jdGlvbiBlc2NhcGVTZXF1ZW5jZShzY2FubmVyKSB7XG4gIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gXCJcXFxcXCIpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgpO1xuICAvLyBTZWUgaHR0cHM6Ly90b21sLmlvL2VuL3YxLjAuMC1yYy4zI3N0cmluZ1xuICBzd2l0Y2goc2Nhbm5lci5jaGFyKCkpe1xuICAgIGNhc2UgXCJiXCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFxiXCIpO1xuICAgIGNhc2UgXCJ0XCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFx0XCIpO1xuICAgIGNhc2UgXCJuXCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFxuXCIpO1xuICAgIGNhc2UgXCJmXCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFxmXCIpO1xuICAgIGNhc2UgXCJyXCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFxyXCIpO1xuICAgIGNhc2UgXCJ1XCI6XG4gICAgY2FzZSBcIlVcIjpcbiAgICAgIHtcbiAgICAgICAgLy8gVW5pY29kZSBjaGFyYWN0ZXJcbiAgICAgICAgY29uc3QgY29kZVBvaW50TGVuID0gc2Nhbm5lci5jaGFyKCkgPT09IFwidVwiID8gNCA6IDY7XG4gICAgICAgIGNvbnN0IGNvZGVQb2ludCA9IHBhcnNlSW50KFwiMHhcIiArIHNjYW5uZXIuc2xpY2UoMSwgMSArIGNvZGVQb2ludExlbiksIDE2KTtcbiAgICAgICAgY29uc3Qgc3RyID0gU3RyaW5nLmZyb21Db2RlUG9pbnQoY29kZVBvaW50KTtcbiAgICAgICAgc2Nhbm5lci5uZXh0KGNvZGVQb2ludExlbiArIDEpO1xuICAgICAgICByZXR1cm4gc3VjY2VzcyhzdHIpO1xuICAgICAgfVxuICAgIGNhc2UgJ1wiJzpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoJ1wiJyk7XG4gICAgY2FzZSBcIlxcXFxcIjpcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgcmV0dXJuIHN1Y2Nlc3MoXCJcXFxcXCIpO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgZXNjYXBlIHNlcXVlbmNlOiBcXFxcJHtzY2FubmVyLmNoYXIoKX1gKTtcbiAgfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGJhc2ljU3RyaW5nKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSAnXCInKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoKTtcbiAgY29uc3QgYWNjID0gW107XG4gIHdoaWxlKHNjYW5uZXIuY2hhcigpICE9PSAnXCInICYmICFzY2FubmVyLmVvZigpKXtcbiAgICBpZiAoc2Nhbm5lci5jaGFyKCkgPT09IFwiXFxuXCIpIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihcIlNpbmdsZS1saW5lIHN0cmluZyBjYW5ub3QgY29udGFpbiBFT0xcIik7XG4gICAgfVxuICAgIGNvbnN0IGVzY2FwZWRDaGFyID0gZXNjYXBlU2VxdWVuY2Uoc2Nhbm5lcik7XG4gICAgaWYgKGVzY2FwZWRDaGFyLm9rKSB7XG4gICAgICBhY2MucHVzaChlc2NhcGVkQ2hhci5ib2R5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYWNjLnB1c2goc2Nhbm5lci5jaGFyKCkpO1xuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgfVxuICB9XG4gIGlmIChzY2FubmVyLmVvZigpKSB7XG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBTaW5nbGUtbGluZSBzdHJpbmcgaXMgbm90IGNsb3NlZDpcXG4ke2FjYy5qb2luKFwiXCIpfWApO1xuICB9XG4gIHNjYW5uZXIubmV4dCgpOyAvLyBza2lwIGxhc3QgJ1wiXCJcbiAgcmV0dXJuIHN1Y2Nlc3MoYWNjLmpvaW4oXCJcIikpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGxpdGVyYWxTdHJpbmcoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09IFwiJ1wiKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoKTtcbiAgY29uc3QgYWNjID0gW107XG4gIHdoaWxlKHNjYW5uZXIuY2hhcigpICE9PSBcIidcIiAmJiAhc2Nhbm5lci5lb2YoKSl7XG4gICAgaWYgKHNjYW5uZXIuY2hhcigpID09PSBcIlxcblwiKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJTaW5nbGUtbGluZSBzdHJpbmcgY2Fubm90IGNvbnRhaW4gRU9MXCIpO1xuICAgIH1cbiAgICBhY2MucHVzaChzY2FubmVyLmNoYXIoKSk7XG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH1cbiAgaWYgKHNjYW5uZXIuZW9mKCkpIHtcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYFNpbmdsZS1saW5lIHN0cmluZyBpcyBub3QgY2xvc2VkOlxcbiR7YWNjLmpvaW4oXCJcIil9YCk7XG4gIH1cbiAgc2Nhbm5lci5uZXh0KCk7IC8vIHNraXAgbGFzdCBcIidcIlxuICByZXR1cm4gc3VjY2VzcyhhY2Muam9pbihcIlwiKSk7XG59XG5leHBvcnQgZnVuY3Rpb24gbXVsdGlsaW5lQmFzaWNTdHJpbmcoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBpZiAoIXNjYW5uZXIuc3RhcnRzV2l0aCgnXCJcIlwiJykpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgzKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpID09PSBcIlxcblwiKSB7XG4gICAgLy8gVGhlIGZpcnN0IG5ld2xpbmUgKExGKSBpcyB0cmltbWVkXG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH0gZWxzZSBpZiAoc2Nhbm5lci5zdGFydHNXaXRoKFwiXFxyXFxuXCIpKSB7XG4gICAgLy8gVGhlIGZpcnN0IG5ld2xpbmUgKENSTEYpIGlzIHRyaW1tZWRcbiAgICBzY2FubmVyLm5leHQoMik7XG4gIH1cbiAgY29uc3QgYWNjID0gW107XG4gIHdoaWxlKCFzY2FubmVyLnN0YXJ0c1dpdGgoJ1wiXCJcIicpICYmICFzY2FubmVyLmVvZigpKXtcbiAgICAvLyBsaW5lIGVuZGluZyBiYWNrc2xhc2hcbiAgICBpZiAoc2Nhbm5lci5zdGFydHNXaXRoKFwiXFxcXFxcblwiKSkge1xuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICBzY2FubmVyLm5leHRVbnRpbENoYXIoe1xuICAgICAgICBza2lwQ29tbWVudHM6IGZhbHNlXG4gICAgICB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH0gZWxzZSBpZiAoc2Nhbm5lci5zdGFydHNXaXRoKFwiXFxcXFxcclxcblwiKSkge1xuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICBzY2FubmVyLm5leHRVbnRpbENoYXIoe1xuICAgICAgICBza2lwQ29tbWVudHM6IGZhbHNlXG4gICAgICB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBlc2NhcGVkQ2hhciA9IGVzY2FwZVNlcXVlbmNlKHNjYW5uZXIpO1xuICAgIGlmIChlc2NhcGVkQ2hhci5vaykge1xuICAgICAgYWNjLnB1c2goZXNjYXBlZENoYXIuYm9keSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFjYy5wdXNoKHNjYW5uZXIuY2hhcigpKTtcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgIH1cbiAgfVxuICBpZiAoc2Nhbm5lci5lb2YoKSkge1xuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgTXVsdGktbGluZSBzdHJpbmcgaXMgbm90IGNsb3NlZDpcXG4ke2FjYy5qb2luKFwiXCIpfWApO1xuICB9XG4gIC8vIGlmIGVuZHMgd2l0aCA0IGBcImAsIHB1c2ggdGhlIGZpc3QgYFwiYCB0byBzdHJpbmdcbiAgaWYgKHNjYW5uZXIuY2hhcigzKSA9PT0gJ1wiJykge1xuICAgIGFjYy5wdXNoKCdcIicpO1xuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9XG4gIHNjYW5uZXIubmV4dCgzKTsgLy8gc2tpcCBsYXN0ICdcIlwiXCJcIlxuICByZXR1cm4gc3VjY2VzcyhhY2Muam9pbihcIlwiKSk7XG59XG5leHBvcnQgZnVuY3Rpb24gbXVsdGlsaW5lTGl0ZXJhbFN0cmluZyhzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGlmICghc2Nhbm5lci5zdGFydHNXaXRoKFwiJycnXCIpKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoMyk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSA9PT0gXCJcXG5cIikge1xuICAgIC8vIFRoZSBmaXJzdCBuZXdsaW5lIChMRikgaXMgdHJpbW1lZFxuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9IGVsc2UgaWYgKHNjYW5uZXIuc3RhcnRzV2l0aChcIlxcclxcblwiKSkge1xuICAgIC8vIFRoZSBmaXJzdCBuZXdsaW5lIChDUkxGKSBpcyB0cmltbWVkXG4gICAgc2Nhbm5lci5uZXh0KDIpO1xuICB9XG4gIGNvbnN0IGFjYyA9IFtdO1xuICB3aGlsZSghc2Nhbm5lci5zdGFydHNXaXRoKFwiJycnXCIpICYmICFzY2FubmVyLmVvZigpKXtcbiAgICBhY2MucHVzaChzY2FubmVyLmNoYXIoKSk7XG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH1cbiAgaWYgKHNjYW5uZXIuZW9mKCkpIHtcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYE11bHRpLWxpbmUgc3RyaW5nIGlzIG5vdCBjbG9zZWQ6XFxuJHthY2Muam9pbihcIlwiKX1gKTtcbiAgfVxuICAvLyBpZiBlbmRzIHdpdGggNCBgJ2AsIHB1c2ggdGhlIGZpc3QgYCdgIHRvIHN0cmluZ1xuICBpZiAoc2Nhbm5lci5jaGFyKDMpID09PSBcIidcIikge1xuICAgIGFjYy5wdXNoKFwiJ1wiKTtcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfVxuICBzY2FubmVyLm5leHQoMyk7IC8vIHNraXAgbGFzdCBcIicnJ1wiXG4gIHJldHVybiBzdWNjZXNzKGFjYy5qb2luKFwiXCIpKTtcbn1cbmNvbnN0IEJPT0xFQU5fUkVHRVhQID0gLyg/OnRydWV8ZmFsc2UpXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gYm9vbGVhbihzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChCT09MRUFOX1JFR0VYUCk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIGNvbnN0IHN0cmluZyA9IG1hdGNoWzBdO1xuICBzY2FubmVyLm5leHQoc3RyaW5nLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gc3RyaW5nID09PSBcInRydWVcIjtcbiAgcmV0dXJuIHN1Y2Nlc3ModmFsdWUpO1xufVxuY29uc3QgSU5GSU5JVFlfTUFQID0gbmV3IE1hcChbXG4gIFtcbiAgICBcImluZlwiLFxuICAgIEluZmluaXR5XG4gIF0sXG4gIFtcbiAgICBcIitpbmZcIixcbiAgICBJbmZpbml0eVxuICBdLFxuICBbXG4gICAgXCItaW5mXCIsXG4gICAgLUluZmluaXR5XG4gIF1cbl0pO1xuY29uc3QgSU5GSU5JVFlfUkVHRVhQID0gL1srLV0/aW5mXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gaW5maW5pdHkoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goSU5GSU5JVFlfUkVHRVhQKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgY29uc3Qgc3RyaW5nID0gbWF0Y2hbMF07XG4gIHNjYW5uZXIubmV4dChzdHJpbmcubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBJTkZJTklUWV9NQVAuZ2V0KHN0cmluZyk7XG4gIHJldHVybiBzdWNjZXNzKHZhbHVlKTtcbn1cbmNvbnN0IE5BTl9SRUdFWFAgPSAvWystXT9uYW5cXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBuYW4oc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goTkFOX1JFR0VYUCk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIGNvbnN0IHN0cmluZyA9IG1hdGNoWzBdO1xuICBzY2FubmVyLm5leHQoc3RyaW5nLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gTmFOO1xuICByZXR1cm4gc3VjY2Vzcyh2YWx1ZSk7XG59XG5leHBvcnQgY29uc3QgZG90dGVkS2V5ID0gam9pbjEob3IoW1xuICBiYXJlS2V5LFxuICBiYXNpY1N0cmluZyxcbiAgbGl0ZXJhbFN0cmluZ1xuXSksIFwiLlwiKTtcbmNvbnN0IEJJTkFSWV9SRUdFWFAgPSAvMGJbMDFdKyg/Ol9bMDFdKykqXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gYmluYXJ5KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKEJJTkFSWV9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IG1hdGNoLnNsaWNlKDIpLnJlcGxhY2VBbGwoXCJfXCIsIFwiXCIpO1xuICBjb25zdCBudW1iZXIgPSBwYXJzZUludCh2YWx1ZSwgMik7XG4gIHJldHVybiBpc05hTihudW1iZXIpID8gZmFpbHVyZSgpIDogc3VjY2VzcyhudW1iZXIpO1xufVxuY29uc3QgT0NUQUxfUkVHRVhQID0gLzBvWzAtN10rKD86X1swLTddKykqXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gb2N0YWwoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goT0NUQUxfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBtYXRjaC5zbGljZSgyKS5yZXBsYWNlQWxsKFwiX1wiLCBcIlwiKTtcbiAgY29uc3QgbnVtYmVyID0gcGFyc2VJbnQodmFsdWUsIDgpO1xuICByZXR1cm4gaXNOYU4obnVtYmVyKSA/IGZhaWx1cmUoKSA6IHN1Y2Nlc3MobnVtYmVyKTtcbn1cbmNvbnN0IEhFWF9SRUdFWFAgPSAvMHhbMC05YS1mXSsoPzpfWzAtOWEtZl0rKSpcXGIveWk7XG5leHBvcnQgZnVuY3Rpb24gaGV4KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKEhFWF9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IG1hdGNoLnNsaWNlKDIpLnJlcGxhY2VBbGwoXCJfXCIsIFwiXCIpO1xuICBjb25zdCBudW1iZXIgPSBwYXJzZUludCh2YWx1ZSwgMTYpO1xuICByZXR1cm4gaXNOYU4obnVtYmVyKSA/IGZhaWx1cmUoKSA6IHN1Y2Nlc3MobnVtYmVyKTtcbn1cbmNvbnN0IElOVEVHRVJfUkVHRVhQID0gL1srLV0/KD86MHxbMS05XVswLTldKig/Ol9bMC05XSspKilcXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBpbnRlZ2VyKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKElOVEVHRVJfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBtYXRjaC5yZXBsYWNlQWxsKFwiX1wiLCBcIlwiKTtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQodmFsdWUsIDEwKTtcbiAgcmV0dXJuIHN1Y2Nlc3MoaW50KTtcbn1cbmNvbnN0IEZMT0FUX1JFR0VYUCA9IC9bKy1dPyg/OjB8WzEtOV1bMC05XSooPzpfWzAtOV0rKSopKD86XFwuWzAtOV0rKD86X1swLTldKykqKT8oPzplWystXT9bMC05XSsoPzpfWzAtOV0rKSopP1xcYi95aTtcbmV4cG9ydCBmdW5jdGlvbiBmbG9hdChzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChGTE9BVF9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IG1hdGNoLnJlcGxhY2VBbGwoXCJfXCIsIFwiXCIpO1xuICBjb25zdCBmbG9hdCA9IHBhcnNlRmxvYXQodmFsdWUpO1xuICBpZiAoaXNOYU4oZmxvYXQpKSByZXR1cm4gZmFpbHVyZSgpO1xuICByZXR1cm4gc3VjY2VzcyhmbG9hdCk7XG59XG5jb25zdCBEQVRFX1RJTUVfUkVHRVhQID0gLyg/PHllYXI+XFxkezR9KS0oPzxtb250aD5cXGR7Mn0pLSg/PGRheT5cXGR7Mn0pKD86WyAwLTlUWi46Ky1dKyk/XFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gZGF0ZVRpbWUoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goREFURV9USU1FX1JFR0VYUCk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIGNvbnN0IHN0cmluZyA9IG1hdGNoWzBdO1xuICBzY2FubmVyLm5leHQoc3RyaW5nLmxlbmd0aCk7XG4gIGNvbnN0IGdyb3VwcyA9IG1hdGNoLmdyb3VwcztcbiAgLy8gc3BlY2lhbCBjYXNlIGlmIG1vbnRoIGlzIEZlYnJ1YXJ5XG4gIGlmIChncm91cHMubW9udGggPT0gXCIwMlwiKSB7XG4gICAgY29uc3QgZGF5cyA9IHBhcnNlSW50KGdyb3Vwcy5kYXkpO1xuICAgIGlmIChkYXlzID4gMjkpIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCBkYXRlIHN0cmluZyBcIiR7bWF0Y2h9XCJgKTtcbiAgICB9XG4gICAgY29uc3QgeWVhciA9IHBhcnNlSW50KGdyb3Vwcy55ZWFyKTtcbiAgICBpZiAoZGF5cyA+IDI4ICYmICFpc0xlYXAoeWVhcikpIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCBkYXRlIHN0cmluZyBcIiR7bWF0Y2h9XCJgKTtcbiAgICB9XG4gIH1cbiAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0cmluZy50cmltKCkpO1xuICAvLyBpbnZhbGlkIGRhdGVcbiAgaWYgKGlzTmFOKGRhdGUuZ2V0VGltZSgpKSkge1xuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCBkYXRlIHN0cmluZyBcIiR7bWF0Y2h9XCJgKTtcbiAgfVxuICByZXR1cm4gc3VjY2VzcyhkYXRlKTtcbn1cbmNvbnN0IExPQ0FMX1RJTUVfUkVHRVhQID0gLyhcXGR7Mn0pOihcXGR7Mn0pOihcXGR7Mn0pKD86XFwuWzAtOV0rKT9cXGIveTtcbmV4cG9ydCBmdW5jdGlvbiBsb2NhbFRpbWUoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goTE9DQUxfVElNRV9SRUdFWFApPy5bMF07XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dChtYXRjaC5sZW5ndGgpO1xuICByZXR1cm4gc3VjY2VzcyhtYXRjaCk7XG59XG5leHBvcnQgZnVuY3Rpb24gYXJyYXlWYWx1ZShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gXCJbXCIpIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dCgpO1xuICBjb25zdCBhcnJheSA9IFtdO1xuICB3aGlsZSghc2Nhbm5lci5lb2YoKSl7XG4gICAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gICAgY29uc3QgcmVzdWx0ID0gdmFsdWUoc2Nhbm5lcik7XG4gICAgaWYgKCFyZXN1bHQub2spIGJyZWFrO1xuICAgIGFycmF5LnB1c2gocmVzdWx0LmJvZHkpO1xuICAgIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gICAgLy8gbWF5IGhhdmUgYSBuZXh0IGl0ZW0sIGJ1dCB0cmFpbGluZyBjb21tYSBpcyBhbGxvd2VkIGF0IGFycmF5XG4gICAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSBcIixcIikgYnJlYWs7XG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH1cbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gXCJdXCIpIHRocm93IG5ldyBTeW50YXhFcnJvcihcIkFycmF5IGlzIG5vdCBjbG9zZWRcIik7XG4gIHNjYW5uZXIubmV4dCgpO1xuICByZXR1cm4gc3VjY2VzcyhhcnJheSk7XG59XG5leHBvcnQgZnVuY3Rpb24gaW5saW5lVGFibGUoc2Nhbm5lcikge1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigxKSA9PT0gXCJ9XCIpIHtcbiAgICBzY2FubmVyLm5leHQoMik7XG4gICAgcmV0dXJuIHN1Y2Nlc3Moe1xuICAgICAgX19wcm90b19fOiBudWxsXG4gICAgfSk7XG4gIH1cbiAgY29uc3QgcGFpcnMgPSBzdXJyb3VuZChcIntcIiwgam9pbihwYWlyLCBcIixcIiksIFwifVwiKShzY2FubmVyKTtcbiAgaWYgKCFwYWlycy5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgbGV0IHRhYmxlID0ge1xuICAgIF9fcHJvdG9fXzogbnVsbFxuICB9O1xuICBmb3IgKGNvbnN0IHBhaXIgb2YgcGFpcnMuYm9keSl7XG4gICAgdGFibGUgPSBkZWVwTWVyZ2UodGFibGUsIHBhaXIpO1xuICB9XG4gIHJldHVybiBzdWNjZXNzKHRhYmxlKTtcbn1cbmV4cG9ydCBjb25zdCB2YWx1ZSA9IG9yKFtcbiAgbXVsdGlsaW5lQmFzaWNTdHJpbmcsXG4gIG11bHRpbGluZUxpdGVyYWxTdHJpbmcsXG4gIGJhc2ljU3RyaW5nLFxuICBsaXRlcmFsU3RyaW5nLFxuICBib29sZWFuLFxuICBpbmZpbml0eSxcbiAgbmFuLFxuICBkYXRlVGltZSxcbiAgbG9jYWxUaW1lLFxuICBiaW5hcnksXG4gIG9jdGFsLFxuICBoZXgsXG4gIGZsb2F0LFxuICBpbnRlZ2VyLFxuICBhcnJheVZhbHVlLFxuICBpbmxpbmVUYWJsZVxuXSk7XG5leHBvcnQgY29uc3QgcGFpciA9IGt2KGRvdHRlZEtleSwgXCI9XCIsIHZhbHVlKTtcbmV4cG9ydCBmdW5jdGlvbiBibG9jayhzY2FubmVyKSB7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBjb25zdCByZXN1bHQgPSBtZXJnZShyZXBlYXQocGFpcikpKHNjYW5uZXIpO1xuICBpZiAocmVzdWx0Lm9rKSByZXR1cm4gc3VjY2Vzcyh7XG4gICAgdHlwZTogXCJCbG9ja1wiLFxuICAgIHZhbHVlOiByZXN1bHQuYm9keVxuICB9KTtcbiAgcmV0dXJuIGZhaWx1cmUoKTtcbn1cbmV4cG9ydCBjb25zdCB0YWJsZUhlYWRlciA9IHN1cnJvdW5kKFwiW1wiLCBkb3R0ZWRLZXksIFwiXVwiKTtcbmV4cG9ydCBmdW5jdGlvbiB0YWJsZShzY2FubmVyKSB7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBjb25zdCBoZWFkZXIgPSB0YWJsZUhlYWRlcihzY2FubmVyKTtcbiAgaWYgKCFoZWFkZXIub2spIHJldHVybiBmYWlsdXJlKCk7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBjb25zdCBiID0gYmxvY2soc2Nhbm5lcik7XG4gIHJldHVybiBzdWNjZXNzKHtcbiAgICB0eXBlOiBcIlRhYmxlXCIsXG4gICAga2V5czogaGVhZGVyLmJvZHksXG4gICAgdmFsdWU6IGIub2sgPyBiLmJvZHkudmFsdWUgOiB7XG4gICAgICBfX3Byb3RvX186IG51bGxcbiAgICB9XG4gIH0pO1xufVxuZXhwb3J0IGNvbnN0IHRhYmxlQXJyYXlIZWFkZXIgPSBzdXJyb3VuZChcIltbXCIsIGRvdHRlZEtleSwgXCJdXVwiKTtcbmV4cG9ydCBmdW5jdGlvbiB0YWJsZUFycmF5KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGNvbnN0IGhlYWRlciA9IHRhYmxlQXJyYXlIZWFkZXIoc2Nhbm5lcik7XG4gIGlmICghaGVhZGVyLm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgY29uc3QgYiA9IGJsb2NrKHNjYW5uZXIpO1xuICByZXR1cm4gc3VjY2Vzcyh7XG4gICAgdHlwZTogXCJUYWJsZUFycmF5XCIsXG4gICAga2V5czogaGVhZGVyLmJvZHksXG4gICAgdmFsdWU6IGIub2sgPyBiLmJvZHkudmFsdWUgOiB7XG4gICAgICBfX3Byb3RvX186IG51bGxcbiAgICB9XG4gIH0pO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHRvbWwoc2Nhbm5lcikge1xuICBjb25zdCBibG9ja3MgPSByZXBlYXQob3IoW1xuICAgIGJsb2NrLFxuICAgIHRhYmxlQXJyYXksXG4gICAgdGFibGVcbiAgXSkpKHNjYW5uZXIpO1xuICBpZiAoIWJsb2Nrcy5vaykgcmV0dXJuIHN1Y2Nlc3Moe1xuICAgIF9fcHJvdG9fXzogbnVsbFxuICB9KTtcbiAgY29uc3QgYm9keSA9IGJsb2Nrcy5ib2R5LnJlZHVjZShkZWVwQXNzaWduLCB7XG4gICAgX19wcm90b19fOiBudWxsXG4gIH0pO1xuICByZXR1cm4gc3VjY2Vzcyhib2R5KTtcbn1cbmZ1bmN0aW9uIGNyZWF0ZVBhcnNlRXJyb3JNZXNzYWdlKHNjYW5uZXIsIG1lc3NhZ2UpIHtcbiAgY29uc3Qgc3RyaW5nID0gc2Nhbm5lci5zb3VyY2Uuc2xpY2UoMCwgc2Nhbm5lci5wb3NpdGlvbik7XG4gIGNvbnN0IGxpbmVzID0gc3RyaW5nLnNwbGl0KFwiXFxuXCIpO1xuICBjb25zdCByb3cgPSBsaW5lcy5sZW5ndGg7XG4gIGNvbnN0IGNvbHVtbiA9IGxpbmVzLmF0KC0xKT8ubGVuZ3RoID8/IDA7XG4gIHJldHVybiBgUGFyc2UgZXJyb3Igb24gbGluZSAke3Jvd30sIGNvbHVtbiAke2NvbHVtbn06ICR7bWVzc2FnZX1gO1xufVxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlckZhY3RvcnkocGFyc2VyKSB7XG4gIHJldHVybiAodG9tbFN0cmluZyk9PntcbiAgICBjb25zdCBzY2FubmVyID0gbmV3IFNjYW5uZXIodG9tbFN0cmluZyk7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICAgIGlmIChyZXN1bHQub2sgJiYgc2Nhbm5lci5lb2YoKSkgcmV0dXJuIHJlc3VsdC5ib2R5O1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGBVbmV4cGVjdGVkIGNoYXJhY3RlcjogXCIke3NjYW5uZXIuY2hhcigpfVwiYDtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihjcmVhdGVQYXJzZUVycm9yTWVzc2FnZShzY2FubmVyLCBtZXNzYWdlKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihjcmVhdGVQYXJzZUVycm9yTWVzc2FnZShzY2FubmVyLCBlcnJvci5tZXNzYWdlKSk7XG4gICAgICB9XG4gICAgICBjb25zdCBtZXNzYWdlID0gXCJJbnZhbGlkIGVycm9yIHR5cGUgY2F1Z2h0XCI7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoY3JlYXRlUGFyc2VFcnJvck1lc3NhZ2Uoc2Nhbm5lciwgbWVzc2FnZSkpO1xuICAgIH1cbiAgfTtcbn1cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPV9wYXJzZXIuanMubWFwIiwiLy8gQ29weXJpZ2h0IDIwMTgtMjAyNSB0aGUgRGVubyBhdXRob3JzLiBNSVQgbGljZW5zZS5cbi8vIFRoaXMgbW9kdWxlIGlzIGJyb3dzZXIgY29tcGF0aWJsZS5cbmltcG9ydCB7IHBhcnNlckZhY3RvcnksIHRvbWwgfSBmcm9tIFwiLi9fcGFyc2VyLmpzXCI7XG4vKipcbiAqIFBhcnNlcyBhIHtAbGluayBodHRwczovL3RvbWwuaW8gfCBUT01MfSBzdHJpbmcgaW50byBhbiBvYmplY3QuXG4gKlxuICogQGV4YW1wbGUgVXNhZ2VcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBwYXJzZSB9IGZyb20gXCJAc3RkL3RvbWwvcGFyc2VcIjtcbiAqIGltcG9ydCB7IGFzc2VydEVxdWFscyB9IGZyb20gXCJAc3RkL2Fzc2VydFwiO1xuICpcbiAqIGNvbnN0IHRvbWxTdHJpbmcgPSBgdGl0bGUgPSBcIlRPTUwgRXhhbXBsZVwiXG4gKiBbb3duZXJdXG4gKiBuYW1lID0gXCJBbGljZVwiXG4gKiBiaW8gPSBcIkFsaWNlIGlzIGEgcHJvZ3JhbW1lci5cImA7XG4gKlxuICogY29uc3Qgb2JqID0gcGFyc2UodG9tbFN0cmluZyk7XG4gKiBhc3NlcnRFcXVhbHMob2JqLCB7IHRpdGxlOiBcIlRPTUwgRXhhbXBsZVwiLCBvd25lcjogeyBuYW1lOiBcIkFsaWNlXCIsIGJpbzogXCJBbGljZSBpcyBhIHByb2dyYW1tZXIuXCIgfSB9KTtcbiAqIGBgYFxuICogQHBhcmFtIHRvbWxTdHJpbmcgVE9NTCBzdHJpbmcgdG8gYmUgcGFyc2VkLlxuICogQHJldHVybnMgVGhlIHBhcnNlZCBKUyBvYmplY3QuXG4gKi8gZXhwb3J0IGZ1bmN0aW9uIHBhcnNlKHRvbWxTdHJpbmcpIHtcbiAgcmV0dXJuIHBhcnNlckZhY3RvcnkodG9tbCkodG9tbFN0cmluZyk7XG59XG4vLyMgc291cmNlTWFwcGluZ1VSTD1wYXJzZS5qcy5tYXAiLCJpbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSBcIm5vZGU6bW9kdWxlXCI7XG5pbXBvcnQgeyBpc0Fic29sdXRlLCBqb2luLCByZXNvbHZlIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiO1xuLyoqXG4qIFJlc29sdmUgYW4gYWJzb2x1dGUgcGF0aCBmcm9tIHtAbGluayByb290fSwgYnV0IG9ubHlcbiogaWYge0BsaW5rIGlucHV0fSBpc24ndCBhbHJlYWR5IGFic29sdXRlLlxuKlxuKiBAcGFyYW0gaW5wdXQgVGhlIHBhdGggdG8gcmVzb2x2ZS5cbiogQHBhcmFtIHJvb3QgVGhlIGJhc2UgcGF0aDsgZGVmYXVsdCA9IHByb2Nlc3MuY3dkKClcbiogQHJldHVybnMgVGhlIHJlc29sdmVkIGFic29sdXRlIHBhdGguXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIGFic29sdXRlKGlucHV0LCByb290KSB7XG5cdHJldHVybiBpc0Fic29sdXRlKGlucHV0KSA/IGlucHV0IDogcmVzb2x2ZShyb290IHx8IFwiLlwiLCBpbnB1dCk7XG59XG5leHBvcnQgZnVuY3Rpb24gZnJvbShyb290LCBpZGVudCwgc2lsZW50KSB7XG5cdHRyeSB7XG5cdFx0Ly8gTk9URTogZGlycyBuZWVkIGEgdHJhaWxpbmcgXCIvXCIgT1IgZmlsZW5hbWUuIFdpdGggXCIvXCIgcm91dGUsXG5cdFx0Ly8gTm9kZSBhZGRzIFwibm9vcC5qc1wiIGFzIG1haW4gZmlsZSwgc28ganVzdCBkbyBcIm5vb3AuanNcIiBhbnl3YXkuXG5cdFx0bGV0IHIgPSByb290IGluc3RhbmNlb2YgVVJMIHx8IHJvb3Quc3RhcnRzV2l0aChcImZpbGU6Ly9cIikgPyBqb2luKGZpbGVVUkxUb1BhdGgocm9vdCksIFwibm9vcC5qc1wiKSA6IGpvaW4oYWJzb2x1dGUocm9vdCksIFwibm9vcC5qc1wiKTtcblx0XHRyZXR1cm4gY3JlYXRlUmVxdWlyZShyKS5yZXNvbHZlKGlkZW50KTtcblx0fSBjYXRjaCAoZXJyKSB7XG5cdFx0aWYgKCFzaWxlbnQpIHRocm93IGVycjtcblx0fVxufVxuZXhwb3J0IGZ1bmN0aW9uIGN3ZChpZGVudCwgc2lsZW50KSB7XG5cdHJldHVybiBmcm9tKHJlc29sdmUoKSwgaWRlbnQsIHNpbGVudCk7XG59XG4iLCJpbXBvcnQgeyBkaXJuYW1lIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgYWJzb2x1dGUgfSBmcm9tIFwiZW1wYXRoaWMvcmVzb2x2ZVwiO1xuLyoqXG4qIEdldCBhbGwgcGFyZW50IGRpcmVjdG9yaWVzIG9mIHtAbGluayBiYXNlfS5cbiogU3RvcHMgYWZ0ZXIge0BsaW5rIE9wdGlvbnNbJ2xhc3QnXX0gaXMgcHJvY2Vzc2VkLlxuKlxuKiBAcmV0dXJucyBBbiBhcnJheSBvZiBhYnNvbHV0ZSBwYXRocyBvZiBhbGwgcGFyZW50IGRpcmVjdG9yaWVzLlxuKi9cbmV4cG9ydCBmdW5jdGlvbiB1cChiYXNlLCBvcHRpb25zKSB7XG5cdGxldCB7IGxhc3QsIGN3ZCB9ID0gb3B0aW9ucyB8fCB7fTtcblx0bGV0IHRtcCA9IGFic29sdXRlKGJhc2UsIGN3ZCk7XG5cdGxldCByb290ID0gYWJzb2x1dGUobGFzdCB8fCBcIi9cIiwgY3dkKTtcblx0bGV0IHByZXYsIGFyciA9IFtdO1xuXHR3aGlsZSAocHJldiAhPT0gcm9vdCkge1xuXHRcdGFyci5wdXNoKHRtcCk7XG5cdFx0dG1wID0gZGlybmFtZShwcmV2ID0gdG1wKTtcblx0XHRpZiAodG1wID09PSBwcmV2KSBicmVhaztcblx0fVxuXHRyZXR1cm4gYXJyO1xufVxuIiwiaW1wb3J0IHsgam9pbiB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGV4aXN0c1N5bmMsIHN0YXRTeW5jIH0gZnJvbSBcIm5vZGU6ZnNcIjtcbmltcG9ydCAqIGFzIHdhbGsgZnJvbSBcImVtcGF0aGljL3dhbGtcIjtcbi8qKlxuKiBGaW5kIGFuIGl0ZW0gYnkgbmFtZSwgd2Fsa2luZyBwYXJlbnQgZGlyZWN0b3JpZXMgdW50aWwgZm91bmQuXG4qXG4qIEBwYXJhbSBuYW1lIFRoZSBpdGVtIG5hbWUgdG8gZmluZC5cbiogQHJldHVybnMgVGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGl0ZW0sIGlmIGZvdW5kLlxuKi9cbmV4cG9ydCBmdW5jdGlvbiB1cChuYW1lLCBvcHRpb25zKSB7XG5cdGxldCBkaXIsIHRtcDtcblx0bGV0IHN0YXJ0ID0gb3B0aW9ucyAmJiBvcHRpb25zLmN3ZCB8fCBcIlwiO1xuXHRmb3IgKGRpciBvZiB3YWxrLnVwKHN0YXJ0LCBvcHRpb25zKSkge1xuXHRcdHRtcCA9IGpvaW4oZGlyLCBuYW1lKTtcblx0XHRpZiAoZXhpc3RzU3luYyh0bXApKSByZXR1cm4gdG1wO1xuXHR9XG59XG4vKipcbiogR2V0IHRoZSBmaXJzdCBwYXRoIHRoYXQgbWF0Y2hlcyBhbnkgb2YgdGhlIG5hbWVzIHByb3ZpZGVkLlxuKlxuKiA+IFtOT1RFXVxuKiA+IFRoZSBvcmRlciBvZiB7QGxpbmsgbmFtZXN9IGlzIHJlc3BlY3RlZC5cbipcbiogQHBhcmFtIG5hbWVzIFRoZSBpdGVtIG5hbWVzIHRvIGZpbmQuXG4qIEByZXR1cm5zIFRoZSBhYnNvbHV0ZSBwYXRoIG9mIHRoZSBmaXJzdCBpdGVtIGZvdW5kLCBpZiBhbnkuXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIGFueShuYW1lcywgb3B0aW9ucykge1xuXHRsZXQgZGlyLCBzdGFydCA9IG9wdGlvbnMgJiYgb3B0aW9ucy5jd2QgfHwgXCJcIjtcblx0bGV0IGogPSAwLCBsZW4gPSBuYW1lcy5sZW5ndGgsIHRtcDtcblx0Zm9yIChkaXIgb2Ygd2Fsay51cChzdGFydCwgb3B0aW9ucykpIHtcblx0XHRmb3IgKGogPSAwOyBqIDwgbGVuOyBqKyspIHtcblx0XHRcdHRtcCA9IGpvaW4oZGlyLCBuYW1lc1tqXSk7XG5cdFx0XHRpZiAoZXhpc3RzU3luYyh0bXApKSByZXR1cm4gdG1wO1xuXHRcdH1cblx0fVxufVxuLyoqXG4qIEZpbmQgYSBmaWxlIGJ5IG5hbWUsIHdhbGtpbmcgcGFyZW50IGRpcmVjdG9yaWVzIHVudGlsIGZvdW5kLlxuKlxuKiA+IFtOT1RFXVxuKiA+IFRoaXMgZnVuY3Rpb24gb25seSByZXR1cm5zIGEgdmFsdWUgZm9yIGZpbGUgbWF0Y2hlcy5cbiogPiBBIGRpcmVjdG9yeSBtYXRjaCB3aXRoIHRoZSBzYW1lIG5hbWUgd2lsbCBiZSBpZ25vcmVkLlxuKlxuKiBAcGFyYW0gbmFtZSBUaGUgZmlsZSBuYW1lIHRvIGZpbmQuXG4qIEByZXR1cm5zIFRoZSBhYnNvbHV0ZSBwYXRoIHRvIHRoZSBmaWxlLCBpZiBmb3VuZC5cbiovXG5leHBvcnQgZnVuY3Rpb24gZmlsZShuYW1lLCBvcHRpb25zKSB7XG5cdGxldCBkaXIsIHRtcDtcblx0bGV0IHN0YXJ0ID0gb3B0aW9ucyAmJiBvcHRpb25zLmN3ZCB8fCBcIlwiO1xuXHRmb3IgKGRpciBvZiB3YWxrLnVwKHN0YXJ0LCBvcHRpb25zKSkge1xuXHRcdHRyeSB7XG5cdFx0XHR0bXAgPSBqb2luKGRpciwgbmFtZSk7XG5cdFx0XHRpZiAoc3RhdFN5bmModG1wKS5pc0ZpbGUoKSkgcmV0dXJuIHRtcDtcblx0XHR9IGNhdGNoIHt9XG5cdH1cbn1cbi8qKlxuKiBGaW5kIGEgZGlyZWN0b3J5IGJ5IG5hbWUsIHdhbGtpbmcgcGFyZW50IGRpcmVjdG9yaWVzIHVudGlsIGZvdW5kLlxuKlxuKiA+IFtOT1RFXVxuKiA+IFRoaXMgZnVuY3Rpb24gb25seSByZXR1cm5zIGEgdmFsdWUgZm9yIGRpcmVjdG9yeSBtYXRjaGVzLlxuKiA+IEEgZmlsZSBtYXRjaCB3aXRoIHRoZSBzYW1lIG5hbWUgd2lsbCBiZSBpZ25vcmVkLlxuKlxuKiBAcGFyYW0gbmFtZSBUaGUgZGlyZWN0b3J5IG5hbWUgdG8gZmluZC5cbiogQHJldHVybnMgVGhlIGFic29sdXRlIHBhdGggdG8gdGhlIGZpbGUsIGlmIGZvdW5kLlxuKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXIobmFtZSwgb3B0aW9ucykge1xuXHRsZXQgZGlyLCB0bXA7XG5cdGxldCBzdGFydCA9IG9wdGlvbnMgJiYgb3B0aW9ucy5jd2QgfHwgXCJcIjtcblx0Zm9yIChkaXIgb2Ygd2Fsay51cChzdGFydCwgb3B0aW9ucykpIHtcblx0XHR0cnkge1xuXHRcdFx0dG1wID0gam9pbihkaXIsIG5hbWUpO1xuXHRcdFx0aWYgKHN0YXRTeW5jKHRtcCkuaXNEaXJlY3RvcnkoKSkgcmV0dXJuIHRtcDtcblx0XHR9IGNhdGNoIHt9XG5cdH1cbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlUmVuYW1lQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWydyZW5hbWUnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ1JlbmFtZSB0aGUgTkFQSS1SUyBwcm9qZWN0JyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBucG1EaXIgPSBPcHRpb24uU3RyaW5nKCctLW5wbS1kaXInLCAnbnBtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0JyxcbiAgfSlcblxuICAkJG5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLW5hbWUsLW4nLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgbmV3IG5hbWUgb2YgdGhlIHByb2plY3QnLFxuICB9KVxuXG4gIGJpbmFyeU5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWJpbmFyeS1uYW1lLC1iJywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG5ldyBiaW5hcnkgbmFtZSAqLm5vZGUgZmlsZXMnLFxuICB9KVxuXG4gIHBhY2thZ2VOYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLW5hbWUnLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgbmV3IHBhY2thZ2UgbmFtZSBvZiB0aGUgcHJvamVjdCcsXG4gIH0pXG5cbiAgbWFuaWZlc3RQYXRoID0gT3B0aW9uLlN0cmluZygnLS1tYW5pZmVzdC1wYXRoJywgJ0NhcmdvLnRvbWwnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBDYXJnby50b21sYCcsXG4gIH0pXG5cbiAgcmVwb3NpdG9yeT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tcmVwb3NpdG9yeScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBuZXcgcmVwb3NpdG9yeSBvZiB0aGUgcHJvamVjdCcsXG4gIH0pXG5cbiAgZGVzY3JpcHRpb24/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWRlc2NyaXB0aW9uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG5ldyBkZXNjcmlwdGlvbiBvZiB0aGUgcHJvamVjdCcsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBucG1EaXI6IHRoaXMubnBtRGlyLFxuICAgICAgbmFtZTogdGhpcy4kJG5hbWUsXG4gICAgICBiaW5hcnlOYW1lOiB0aGlzLmJpbmFyeU5hbWUsXG4gICAgICBwYWNrYWdlTmFtZTogdGhpcy5wYWNrYWdlTmFtZSxcbiAgICAgIG1hbmlmZXN0UGF0aDogdGhpcy5tYW5pZmVzdFBhdGgsXG4gICAgICByZXBvc2l0b3J5OiB0aGlzLnJlcG9zaXRvcnksXG4gICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZW5hbWUgdGhlIE5BUEktUlMgcHJvamVjdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZU9wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXRcbiAgICpcbiAgICogQGRlZmF1bHQgJ25wbSdcbiAgICovXG4gIG5wbURpcj86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5ldyBuYW1lIG9mIHRoZSBwcm9qZWN0XG4gICAqL1xuICBuYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmV3IGJpbmFyeSBuYW1lICoubm9kZSBmaWxlc1xuICAgKi9cbiAgYmluYXJ5TmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5ldyBwYWNrYWdlIG5hbWUgb2YgdGhlIHByb2plY3RcbiAgICovXG4gIHBhY2thZ2VOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBDYXJnby50b21sYFxuICAgKlxuICAgKiBAZGVmYXVsdCAnQ2FyZ28udG9tbCdcbiAgICovXG4gIG1hbmlmZXN0UGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5ldyByZXBvc2l0b3J5IG9mIHRoZSBwcm9qZWN0XG4gICAqL1xuICByZXBvc2l0b3J5Pzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbmV3IGRlc2NyaXB0aW9uIG9mIHRoZSBwcm9qZWN0XG4gICAqL1xuICBkZXNjcmlwdGlvbj86IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0UmVuYW1lT3B0aW9ucyhvcHRpb25zOiBSZW5hbWVPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgbnBtRGlyOiAnbnBtJyxcbiAgICBtYW5pZmVzdFBhdGg6ICdDYXJnby50b21sJyxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSAnbm9kZTpmcydcbmltcG9ydCB7IHJlbmFtZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgeyByZXNvbHZlLCBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgeyBwYXJzZSBhcyBwYXJzZVRvbWwsIHN0cmluZ2lmeSBhcyBzdHJpbmdpZnlUb21sIH0gZnJvbSAnQHN0ZC90b21sJ1xuaW1wb3J0IHsgbG9hZCBhcyB5YW1sUGFyc2UsIGR1bXAgYXMgeWFtbFN0cmluZ2lmeSB9IGZyb20gJ2pzLXlhbWwnXG5pbXBvcnQgeyBpc05pbCwgbWVyZ2UsIG9taXRCeSwgcGljayB9IGZyb20gJ2VzLXRvb2xraXQnXG5pbXBvcnQgKiBhcyBmaW5kIGZyb20gJ2VtcGF0aGljL2ZpbmQnXG5cbmltcG9ydCB7IGFwcGx5RGVmYXVsdFJlbmFtZU9wdGlvbnMsIHR5cGUgUmVuYW1lT3B0aW9ucyB9IGZyb20gJy4uL2RlZi9yZW5hbWUuanMnXG5pbXBvcnQgeyByZWFkQ29uZmlnLCByZWFkRmlsZUFzeW5jLCB3cml0ZUZpbGVBc3luYyB9IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuYW1lUHJvamVjdCh1c2VyT3B0aW9uczogUmVuYW1lT3B0aW9ucykge1xuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0UmVuYW1lT3B0aW9ucyh1c2VyT3B0aW9ucylcbiAgY29uc3QgbmFwaUNvbmZpZyA9IGF3YWl0IHJlYWRDb25maWcob3B0aW9ucylcbiAgY29uc3Qgb2xkTmFtZSA9IG5hcGlDb25maWcuYmluYXJ5TmFtZVxuXG4gIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMucGFja2FnZUpzb25QYXRoKVxuICBjb25zdCBjYXJnb1RvbWxQYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5tYW5pZmVzdFBhdGgpXG5cbiAgY29uc3QgcGFja2FnZUpzb25Db250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhwYWNrYWdlSnNvblBhdGgsICd1dGY4JylcbiAgY29uc3QgcGFja2FnZUpzb25EYXRhID0gSlNPTi5wYXJzZShwYWNrYWdlSnNvbkNvbnRlbnQpXG5cbiAgbWVyZ2UoXG4gICAgbWVyZ2UoXG4gICAgICBwYWNrYWdlSnNvbkRhdGEsXG4gICAgICBvbWl0QnkoXG4gICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgbWlzc2luZyBmaWVsZHM6IGF1dGhvciBhbmQgbGljZW5zZVxuICAgICAgICBwaWNrKG9wdGlvbnMsIFsnbmFtZScsICdkZXNjcmlwdGlvbicsICdhdXRob3InLCAnbGljZW5zZSddKSxcbiAgICAgICAgaXNOaWwsXG4gICAgICApLFxuICAgICksXG4gICAge1xuICAgICAgbmFwaTogb21pdEJ5KFxuICAgICAgICB7XG4gICAgICAgICAgYmluYXJ5TmFtZTogb3B0aW9ucy5iaW5hcnlOYW1lLFxuICAgICAgICAgIHBhY2thZ2VOYW1lOiBvcHRpb25zLnBhY2thZ2VOYW1lLFxuICAgICAgICB9LFxuICAgICAgICBpc05pbCxcbiAgICAgICksXG4gICAgfSxcbiAgKVxuXG4gIGlmIChvcHRpb25zLmNvbmZpZ1BhdGgpIHtcbiAgICBjb25zdCBjb25maWdQYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdQYXRoKVxuICAgIGNvbnN0IGNvbmZpZ0NvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKGNvbmZpZ1BhdGgsICd1dGY4JylcbiAgICBjb25zdCBjb25maWdEYXRhID0gSlNPTi5wYXJzZShjb25maWdDb250ZW50KVxuICAgIGNvbmZpZ0RhdGEuYmluYXJ5TmFtZSA9IG9wdGlvbnMuYmluYXJ5TmFtZVxuICAgIGNvbmZpZ0RhdGEucGFja2FnZU5hbWUgPSBvcHRpb25zLnBhY2thZ2VOYW1lXG4gICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoY29uZmlnUGF0aCwgSlNPTi5zdHJpbmdpZnkoY29uZmlnRGF0YSwgbnVsbCwgMikpXG4gIH1cblxuICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgSlNPTi5zdHJpbmdpZnkocGFja2FnZUpzb25EYXRhLCBudWxsLCAyKSxcbiAgKVxuXG4gIGNvbnN0IHRvbWxDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhjYXJnb1RvbWxQYXRoLCAndXRmOCcpXG4gIGNvbnN0IGNhcmdvVG9tbCA9IHBhcnNlVG9tbCh0b21sQ29udGVudCkgYXMgYW55XG5cbiAgLy8gVXBkYXRlIHRoZSBwYWNrYWdlIG5hbWVcbiAgaWYgKGNhcmdvVG9tbC5wYWNrYWdlICYmIG9wdGlvbnMuYmluYXJ5TmFtZSkge1xuICAgIC8vIFNhbml0aXplIHRoZSBiaW5hcnkgbmFtZSBmb3IgUnVzdCBwYWNrYWdlIG5hbWluZyBjb252ZW50aW9uc1xuICAgIGNvbnN0IHNhbml0aXplZE5hbWUgPSBvcHRpb25zLmJpbmFyeU5hbWVcbiAgICAgIC5yZXBsYWNlKCdAJywgJycpXG4gICAgICAucmVwbGFjZSgnLycsICdfJylcbiAgICAgIC5yZXBsYWNlKC8tL2csICdfJylcbiAgICAgIC50b0xvd2VyQ2FzZSgpXG4gICAgY2FyZ29Ub21sLnBhY2thZ2UubmFtZSA9IHNhbml0aXplZE5hbWVcbiAgfVxuXG4gIC8vIFN0cmluZ2lmeSB0aGUgdXBkYXRlZCBUT01MXG4gIGNvbnN0IHVwZGF0ZWRUb21sQ29udGVudCA9IHN0cmluZ2lmeVRvbWwoY2FyZ29Ub21sKVxuXG4gIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGNhcmdvVG9tbFBhdGgsIHVwZGF0ZWRUb21sQ29udGVudClcbiAgaWYgKG9sZE5hbWUgIT09IG9wdGlvbnMuYmluYXJ5TmFtZSkge1xuICAgIGNvbnN0IGdpdGh1YkFjdGlvbnNQYXRoID0gZmluZC5kaXIoJy5naXRodWInLCB7XG4gICAgICBjd2Q6IG9wdGlvbnMuY3dkLFxuICAgIH0pXG4gICAgaWYgKGdpdGh1YkFjdGlvbnNQYXRoKSB7XG4gICAgICBjb25zdCBnaXRodWJBY3Rpb25zQ0lZbWxQYXRoID0gam9pbihcbiAgICAgICAgZ2l0aHViQWN0aW9uc1BhdGgsXG4gICAgICAgICd3b3JrZmxvd3MnLFxuICAgICAgICAnQ0kueW1sJyxcbiAgICAgIClcbiAgICAgIGlmIChleGlzdHNTeW5jKGdpdGh1YkFjdGlvbnNDSVltbFBhdGgpKSB7XG4gICAgICAgIGNvbnN0IGdpdGh1YkFjdGlvbnNDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhcbiAgICAgICAgICBnaXRodWJBY3Rpb25zQ0lZbWxQYXRoLFxuICAgICAgICAgICd1dGY4JyxcbiAgICAgICAgKVxuICAgICAgICBjb25zdCBnaXRodWJBY3Rpb25zRGF0YSA9IHlhbWxQYXJzZShnaXRodWJBY3Rpb25zQ29udGVudCkgYXMgYW55XG4gICAgICAgIGlmIChnaXRodWJBY3Rpb25zRGF0YS5lbnY/LkFQUF9OQU1FKSB7XG4gICAgICAgICAgZ2l0aHViQWN0aW9uc0RhdGEuZW52LkFQUF9OQU1FID0gb3B0aW9ucy5iaW5hcnlOYW1lXG4gICAgICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgICAgICBnaXRodWJBY3Rpb25zQ0lZbWxQYXRoLFxuICAgICAgICAgICAgeWFtbFN0cmluZ2lmeShnaXRodWJBY3Rpb25zRGF0YSwge1xuICAgICAgICAgICAgICBsaW5lV2lkdGg6IC0xLFxuICAgICAgICAgICAgICBub1JlZnM6IHRydWUsXG4gICAgICAgICAgICAgIHNvcnRLZXlzOiBmYWxzZSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBvbGRXYXNpQnJvd3NlckJpbmRpbmdQYXRoID0gam9pbihcbiAgICAgIG9wdGlvbnMuY3dkLFxuICAgICAgYCR7b2xkTmFtZX0ud2FzaS1icm93c2VyLmpzYCxcbiAgICApXG4gICAgaWYgKGV4aXN0c1N5bmMob2xkV2FzaUJyb3dzZXJCaW5kaW5nUGF0aCkpIHtcbiAgICAgIGF3YWl0IHJlbmFtZShcbiAgICAgICAgb2xkV2FzaUJyb3dzZXJCaW5kaW5nUGF0aCxcbiAgICAgICAgam9pbihvcHRpb25zLmN3ZCwgYCR7b3B0aW9ucy5iaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgKSxcbiAgICAgIClcbiAgICB9XG4gICAgY29uc3Qgb2xkV2FzaUJpbmRpbmdQYXRoID0gam9pbihvcHRpb25zLmN3ZCwgYCR7b2xkTmFtZX0ud2FzaS5janNgKVxuICAgIGlmIChleGlzdHNTeW5jKG9sZFdhc2lCaW5kaW5nUGF0aCkpIHtcbiAgICAgIGF3YWl0IHJlbmFtZShcbiAgICAgICAgb2xkV2FzaUJpbmRpbmdQYXRoLFxuICAgICAgICBqb2luKG9wdGlvbnMuY3dkLCBgJHtvcHRpb25zLmJpbmFyeU5hbWV9Lndhc2kuY2pzYCksXG4gICAgICApXG4gICAgfVxuICAgIGNvbnN0IGdpdEF0dHJpYnV0ZXNQYXRoID0gam9pbihvcHRpb25zLmN3ZCwgJy5naXRhdHRyaWJ1dGVzJylcbiAgICBpZiAoZXhpc3RzU3luYyhnaXRBdHRyaWJ1dGVzUGF0aCkpIHtcbiAgICAgIGNvbnN0IGdpdEF0dHJpYnV0ZXNDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhcbiAgICAgICAgZ2l0QXR0cmlidXRlc1BhdGgsXG4gICAgICAgICd1dGY4JyxcbiAgICAgIClcbiAgICAgIGNvbnN0IGdpdEF0dHJpYnV0ZXNEYXRhID0gZ2l0QXR0cmlidXRlc0NvbnRlbnRcbiAgICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgICAubWFwKChsaW5lKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGxpbmVcbiAgICAgICAgICAgIC5yZXBsYWNlKFxuICAgICAgICAgICAgICBgJHtvbGROYW1lfS53YXNpLWJyb3dzZXIuanNgLFxuICAgICAgICAgICAgICBgJHtvcHRpb25zLmJpbmFyeU5hbWV9Lndhc2ktYnJvd3Nlci5qc2AsXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAucmVwbGFjZShgJHtvbGROYW1lfS53YXNpLmNqc2AsIGAke29wdGlvbnMuYmluYXJ5TmFtZX0ud2FzaS5janNgKVxuICAgICAgICB9KVxuICAgICAgICAuam9pbignXFxuJylcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGdpdEF0dHJpYnV0ZXNQYXRoLCBnaXRBdHRyaWJ1dGVzRGF0YSlcbiAgICB9XG4gIH1cbn1cbiIsImltcG9ydCB7IGV4ZWMsIGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBob21lZGlyIH0gZnJvbSAnbm9kZTpvcydcbmltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcbmltcG9ydCB7IHByb21pc2VzIGFzIGZzIH0gZnJvbSAnbm9kZTpmcydcblxuaW1wb3J0IHsgbG9hZCBhcyB5YW1sTG9hZCwgZHVtcCBhcyB5YW1sRHVtcCB9IGZyb20gJ2pzLXlhbWwnXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdE5ld09wdGlvbnMsXG4gIHR5cGUgTmV3T3B0aW9ucyBhcyBSYXdOZXdPcHRpb25zLFxufSBmcm9tICcuLi9kZWYvbmV3LmpzJ1xuaW1wb3J0IHtcbiAgQVZBSUxBQkxFX1RBUkdFVFMsXG4gIGRlYnVnRmFjdG9yeSxcbiAgREVGQVVMVF9UQVJHRVRTLFxuICBta2RpckFzeW5jLFxuICByZWFkZGlyQXN5bmMsXG4gIHN0YXRBc3luYyxcbiAgdHlwZSBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlcixcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5pbXBvcnQgeyBuYXBpRW5naW5lUmVxdWlyZW1lbnQgfSBmcm9tICcuLi91dGlscy92ZXJzaW9uLmpzJ1xuaW1wb3J0IHsgcmVuYW1lUHJvamVjdCB9IGZyb20gJy4vcmVuYW1lLmpzJ1xuXG4vLyBUZW1wbGF0ZSBpbXBvcnRzIHJlbW92ZWQgYXMgd2UncmUgbm93IHVzaW5nIGV4dGVybmFsIHRlbXBsYXRlc1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnbmV3JylcblxudHlwZSBOZXdPcHRpb25zID0gUmVxdWlyZWQ8UmF3TmV3T3B0aW9ucz5cblxuY29uc3QgVEVNUExBVEVfUkVQT1MgPSB7XG4gIHlhcm46ICdodHRwczovL2dpdGh1Yi5jb20vbmFwaS1ycy9wYWNrYWdlLXRlbXBsYXRlJyxcbiAgcG5wbTogJ2h0dHBzOi8vZ2l0aHViLmNvbS9uYXBpLXJzL3BhY2thZ2UtdGVtcGxhdGUtcG5wbScsXG59IGFzIGNvbnN0XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrR2l0Q29tbWFuZCgpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgY3AgPSBleGVjKCdnaXQgLS12ZXJzaW9uJylcbiAgICAgIGNwLm9uKCdlcnJvcicsICgpID0+IHtcbiAgICAgICAgcmVzb2x2ZShmYWxzZSlcbiAgICAgIH0pXG4gICAgICBjcC5vbignZXhpdCcsIChjb2RlKSA9PiB7XG4gICAgICAgIGlmIChjb2RlID09PSAwKSB7XG4gICAgICAgICAgcmVzb2x2ZSh0cnVlKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlc29sdmUoZmFsc2UpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgICByZXR1cm4gdHJ1ZVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlbnN1cmVDYWNoZURpcihcbiAgcGFja2FnZU1hbmFnZXI6IFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VyLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgY2FjaGVEaXIgPSBwYXRoLmpvaW4oaG9tZWRpcigpLCAnLm5hcGktcnMnLCAndGVtcGxhdGUnLCBwYWNrYWdlTWFuYWdlcilcbiAgYXdhaXQgbWtkaXJBc3luYyhjYWNoZURpciwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgcmV0dXJuIGNhY2hlRGlyXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRvd25sb2FkVGVtcGxhdGUoXG4gIHBhY2thZ2VNYW5hZ2VyOiBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlcixcbiAgY2FjaGVEaXI6IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCByZXBvVXJsID0gVEVNUExBVEVfUkVQT1NbcGFja2FnZU1hbmFnZXJdXG4gIGNvbnN0IHRlbXBsYXRlUGF0aCA9IHBhdGguam9pbihjYWNoZURpciwgJ3JlcG8nKVxuXG4gIGlmIChleGlzdHNTeW5jKHRlbXBsYXRlUGF0aCkpIHtcbiAgICBkZWJ1ZyhgVGVtcGxhdGUgY2FjaGUgZm91bmQgYXQgJHt0ZW1wbGF0ZVBhdGh9LCB1cGRhdGluZy4uLmApXG4gICAgdHJ5IHtcbiAgICAgIC8vIEZldGNoIGxhdGVzdCBjaGFuZ2VzIGFuZCByZXNldCB0byByZW1vdGVcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgY29uc3QgY3AgPSBleGVjKCdnaXQgZmV0Y2ggb3JpZ2luJywgeyBjd2Q6IHRlbXBsYXRlUGF0aCB9KVxuICAgICAgICBjcC5vbignZXJyb3InLCByZWplY3QpXG4gICAgICAgIGNwLm9uKCdleGl0JywgKGNvZGUpID0+IHtcbiAgICAgICAgICBpZiAoY29kZSA9PT0gMCkge1xuICAgICAgICAgICAgcmVzb2x2ZSgpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gZmV0Y2ggbGF0ZXN0IGNoYW5nZXMsIGdpdCBwcm9jZXNzIGV4aXRlZCB3aXRoIGNvZGUgJHtjb2RlfWAsXG4gICAgICAgICAgICAgICksXG4gICAgICAgICAgICApXG4gICAgICAgICAgfVxuICAgICAgICB9KVxuICAgICAgfSlcbiAgICAgIGV4ZWNTeW5jKCdnaXQgcmVzZXQgLS1oYXJkIG9yaWdpbi9tYWluJywge1xuICAgICAgICBjd2Q6IHRlbXBsYXRlUGF0aCxcbiAgICAgICAgc3RkaW86ICdpZ25vcmUnLFxuICAgICAgfSlcbiAgICAgIGRlYnVnKCdUZW1wbGF0ZSB1cGRhdGVkIHN1Y2Nlc3NmdWxseScpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGRlYnVnKGBGYWlsZWQgdG8gdXBkYXRlIHRlbXBsYXRlOiAke2Vycm9yfWApXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byB1cGRhdGUgdGVtcGxhdGUgZnJvbSAke3JlcG9Vcmx9OiAke2Vycm9yfWApXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGRlYnVnKGBDbG9uaW5nIHRlbXBsYXRlIGZyb20gJHtyZXBvVXJsfS4uLmApXG4gICAgdHJ5IHtcbiAgICAgIGV4ZWNTeW5jKGBnaXQgY2xvbmUgJHtyZXBvVXJsfSByZXBvYCwgeyBjd2Q6IGNhY2hlRGlyLCBzdGRpbzogJ2luaGVyaXQnIH0pXG4gICAgICBkZWJ1ZygnVGVtcGxhdGUgY2xvbmVkIHN1Y2Nlc3NmdWxseScpXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNsb25lIHRlbXBsYXRlIGZyb20gJHtyZXBvVXJsfTogJHtlcnJvcn1gKVxuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBjb3B5RGlyZWN0b3J5KFxuICBzcmM6IHN0cmluZyxcbiAgZGVzdDogc3RyaW5nLFxuICBpbmNsdWRlV2FzaUJpbmRpbmdzOiBib29sZWFuLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IG1rZGlyQXN5bmMoZGVzdCwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgY29uc3QgZW50cmllcyA9IGF3YWl0IGZzLnJlYWRkaXIoc3JjLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSlcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSlcbiAgICBjb25zdCBkZXN0UGF0aCA9IHBhdGguam9pbihkZXN0LCBlbnRyeS5uYW1lKVxuXG4gICAgLy8gU2tpcCAuZ2l0IGRpcmVjdG9yeVxuICAgIGlmIChlbnRyeS5uYW1lID09PSAnLmdpdCcpIHtcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgaWYgKGVudHJ5LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgIGF3YWl0IGNvcHlEaXJlY3Rvcnkoc3JjUGF0aCwgZGVzdFBhdGgsIGluY2x1ZGVXYXNpQmluZGluZ3MpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChcbiAgICAgICAgIWluY2x1ZGVXYXNpQmluZGluZ3MgJiZcbiAgICAgICAgKGVudHJ5Lm5hbWUuZW5kc1dpdGgoJy53YXNpLWJyb3dzZXIuanMnKSB8fFxuICAgICAgICAgIGVudHJ5Lm5hbWUuZW5kc1dpdGgoJy53YXNpLmNqcycpIHx8XG4gICAgICAgICAgZW50cnkubmFtZS5lbmRzV2l0aCgnd2FzaS13b3JrZXIuYnJvd3Nlci5tanMgJykgfHxcbiAgICAgICAgICBlbnRyeS5uYW1lLmVuZHNXaXRoKCd3YXNpLXdvcmtlci5tanMnKSB8fFxuICAgICAgICAgIGVudHJ5Lm5hbWUuZW5kc1dpdGgoJ2Jyb3dzZXIuanMnKSlcbiAgICAgICkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgYXdhaXQgZnMuY29weUZpbGUoc3JjUGF0aCwgZGVzdFBhdGgpXG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbHRlclRhcmdldHNJblBhY2thZ2VKc29uKFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBlbmFibGVkVGFyZ2V0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoLCAndXRmLTgnKVxuICBjb25zdCBwYWNrYWdlSnNvbiA9IEpTT04ucGFyc2UoY29udGVudClcblxuICAvLyBGaWx0ZXIgbmFwaS50YXJnZXRzXG4gIGlmIChwYWNrYWdlSnNvbi5uYXBpPy50YXJnZXRzKSB7XG4gICAgcGFja2FnZUpzb24ubmFwaS50YXJnZXRzID0gcGFja2FnZUpzb24ubmFwaS50YXJnZXRzLmZpbHRlcihcbiAgICAgICh0YXJnZXQ6IHN0cmluZykgPT4gZW5hYmxlZFRhcmdldHMuaW5jbHVkZXModGFyZ2V0KSxcbiAgICApXG4gIH1cblxuICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIEpTT04uc3RyaW5naWZ5KHBhY2thZ2VKc29uLCBudWxsLCAyKSArICdcXG4nKVxufVxuXG5hc3luYyBmdW5jdGlvbiBmaWx0ZXJUYXJnZXRzSW5HaXRodWJBY3Rpb25zKFxuICBmaWxlUGF0aDogc3RyaW5nLFxuICBlbmFibGVkVGFyZ2V0czogc3RyaW5nW10sXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoLCAndXRmLTgnKVxuICBjb25zdCB5YW1sID0geWFtbExvYWQoY29udGVudCkgYXMgYW55XG5cbiAgY29uc3QgbWFjT1NBbmRXaW5kb3dzVGFyZ2V0cyA9IG5ldyBTZXQoW1xuICAgICd4ODZfNjQtcGMtd2luZG93cy1tc3ZjJyxcbiAgICAneDg2XzY0LXBjLXdpbmRvd3MtZ251JyxcbiAgICAnYWFyY2g2NC1wYy13aW5kb3dzLW1zdmMnLFxuICAgICd4ODZfNjQtYXBwbGUtZGFyd2luJyxcbiAgXSlcblxuICBjb25zdCBsaW51eFRhcmdldHMgPSBuZXcgU2V0KFtcbiAgICAneDg2XzY0LXVua25vd24tbGludXgtZ251JyxcbiAgICAneDg2XzY0LXVua25vd24tbGludXgtbXVzbCcsXG4gICAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICdhYXJjaDY0LXVua25vd24tbGludXgtbXVzbCcsXG4gICAgJ2FybXY3LXVua25vd24tbGludXgtZ251ZWFiaWhmJyxcbiAgICAnYXJtdjctdW5rbm93bi1saW51eC1tdXNsZWFiaWhmJyxcbiAgICAnbG9vbmdhcmNoNjQtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICdyaXNjdjY0Z2MtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICdwb3dlcnBjNjRsZS11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ3MzOTB4LXVua25vd24tbGludXgtZ251JyxcbiAgICAnYWFyY2g2NC1saW51eC1hbmRyb2lkJyxcbiAgICAnYXJtdjctbGludXgtYW5kcm9pZGVhYmknLFxuICBdKVxuXG4gIC8vIENoZWNrIGlmIGFueSBMaW51eCB0YXJnZXRzIGFyZSBlbmFibGVkXG4gIGNvbnN0IGhhc0xpbnV4VGFyZ2V0cyA9IGVuYWJsZWRUYXJnZXRzLnNvbWUoKHRhcmdldCkgPT5cbiAgICBsaW51eFRhcmdldHMuaGFzKHRhcmdldCksXG4gIClcblxuICAvLyBGaWx0ZXIgdGhlIG1hdHJpeCBjb25maWd1cmF0aW9ucyBpbiB0aGUgYnVpbGQgam9iXG4gIGlmICh5YW1sPy5qb2JzPy5idWlsZD8uc3RyYXRlZ3k/Lm1hdHJpeD8uc2V0dGluZ3MpIHtcbiAgICB5YW1sLmpvYnMuYnVpbGQuc3RyYXRlZ3kubWF0cml4LnNldHRpbmdzID1cbiAgICAgIHlhbWwuam9icy5idWlsZC5zdHJhdGVneS5tYXRyaXguc2V0dGluZ3MuZmlsdGVyKChzZXR0aW5nOiBhbnkpID0+IHtcbiAgICAgICAgaWYgKHNldHRpbmcudGFyZ2V0KSB7XG4gICAgICAgICAgcmV0dXJuIGVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKHNldHRpbmcudGFyZ2V0KVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9KVxuICB9XG5cbiAgY29uc3Qgam9ic1RvUmVtb3ZlOiBzdHJpbmdbXSA9IFtdXG5cbiAgaWYgKGVuYWJsZWRUYXJnZXRzLmV2ZXJ5KCh0YXJnZXQpID0+ICFtYWNPU0FuZFdpbmRvd3NUYXJnZXRzLmhhcyh0YXJnZXQpKSkge1xuICAgIGpvYnNUb1JlbW92ZS5wdXNoKCd0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZycpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmlsdGVyIHRoZSBtYXRyaXggY29uZmlndXJhdGlvbnMgaW4gdGhlIHRlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nIGpvYlxuICAgIGlmIChcbiAgICAgIHlhbWw/LmpvYnM/LlsndGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcnXT8uc3RyYXRlZ3k/Lm1hdHJpeD8uc2V0dGluZ3NcbiAgICApIHtcbiAgICAgIHlhbWwuam9ic1sndGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcnXS5zdHJhdGVneS5tYXRyaXguc2V0dGluZ3MgPVxuICAgICAgICB5YW1sLmpvYnNbJ3Rlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nJ10uc3RyYXRlZ3kubWF0cml4LnNldHRpbmdzLmZpbHRlcihcbiAgICAgICAgICAoc2V0dGluZzogYW55KSA9PiB7XG4gICAgICAgICAgICBpZiAoc2V0dGluZy50YXJnZXQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKHNldHRpbmcudGFyZ2V0KVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgfVxuICB9XG5cbiAgLy8gSWYgbm8gTGludXggdGFyZ2V0cyBhcmUgZW5hYmxlZCwgcmVtb3ZlIExpbnV4LXNwZWNpZmljIGpvYnNcbiAgaWYgKCFoYXNMaW51eFRhcmdldHMpIHtcbiAgICAvLyBSZW1vdmUgdGVzdC1saW51eC1iaW5kaW5nIGpvYlxuICAgIGlmICh5YW1sPy5qb2JzPy5bJ3Rlc3QtbGludXgtYmluZGluZyddKSB7XG4gICAgICBqb2JzVG9SZW1vdmUucHVzaCgndGVzdC1saW51eC1iaW5kaW5nJylcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gRmlsdGVyIHRoZSBtYXRyaXggY29uZmlndXJhdGlvbnMgaW4gdGhlIHRlc3QtbGludXgteDY0LWdudS1iaW5kaW5nIGpvYlxuICAgIGlmICh5YW1sPy5qb2JzPy5bJ3Rlc3QtbGludXgtYmluZGluZyddPy5zdHJhdGVneT8ubWF0cml4Py50YXJnZXQpIHtcbiAgICAgIHlhbWwuam9ic1sndGVzdC1saW51eC1iaW5kaW5nJ10uc3RyYXRlZ3kubWF0cml4LnRhcmdldCA9IHlhbWwuam9ic1tcbiAgICAgICAgJ3Rlc3QtbGludXgtYmluZGluZydcbiAgICAgIF0uc3RyYXRlZ3kubWF0cml4LnRhcmdldC5maWx0ZXIoKHRhcmdldDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGlmICh0YXJnZXQpIHtcbiAgICAgICAgICByZXR1cm4gZW5hYmxlZFRhcmdldHMuaW5jbHVkZXModGFyZ2V0KVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGlmICghZW5hYmxlZFRhcmdldHMuaW5jbHVkZXMoJ3dhc20zMi13YXNpcDEtdGhyZWFkcycpKSB7XG4gICAgam9ic1RvUmVtb3ZlLnB1c2goJ3Rlc3Qtd2FzaScpXG4gIH1cblxuICBpZiAoIWVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKCd4ODZfNjQtdW5rbm93bi1mcmVlYnNkJykpIHtcbiAgICBqb2JzVG9SZW1vdmUucHVzaCgnYnVpbGQtZnJlZWJzZCcpXG4gIH1cblxuICAvLyBGaWx0ZXIgb3RoZXIgdGVzdCBqb2JzIGJhc2VkIG9uIHRhcmdldFxuICBmb3IgKGNvbnN0IFtqb2JOYW1lLCBqb2JDb25maWddIG9mIE9iamVjdC5lbnRyaWVzKHlhbWwuam9icyB8fCB7fSkpIHtcbiAgICBpZiAoXG4gICAgICBqb2JOYW1lLnN0YXJ0c1dpdGgoJ3Rlc3QtJykgJiZcbiAgICAgIGpvYk5hbWUgIT09ICd0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZycgJiZcbiAgICAgIGpvYk5hbWUgIT09ICd0ZXN0LWxpbnV4LXg2NC1nbnUtYmluZGluZydcbiAgICApIHtcbiAgICAgIC8vIEV4dHJhY3QgdGFyZ2V0IGZyb20gam9iIG5hbWUgb3IgY29uZmlnXG4gICAgICBjb25zdCBqb2IgPSBqb2JDb25maWcgYXMgYW55XG4gICAgICBpZiAoam9iLnN0cmF0ZWd5Py5tYXRyaXg/LnNldHRpbmdzPy5bMF0/LnRhcmdldCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBqb2Iuc3RyYXRlZ3kubWF0cml4LnNldHRpbmdzWzBdLnRhcmdldFxuICAgICAgICBpZiAoIWVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKHRhcmdldCkpIHtcbiAgICAgICAgICBqb2JzVG9SZW1vdmUucHVzaChqb2JOYW1lKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gUmVtb3ZlIGpvYnMgZm9yIGRpc2FibGVkIHRhcmdldHNcbiAgZm9yIChjb25zdCBqb2JOYW1lIG9mIGpvYnNUb1JlbW92ZSkge1xuICAgIGRlbGV0ZSB5YW1sLmpvYnNbam9iTmFtZV1cbiAgfVxuXG4gIGlmIChBcnJheS5pc0FycmF5KHlhbWwuam9icz8ucHVibGlzaD8ubmVlZHMpKSB7XG4gICAgeWFtbC5qb2JzLnB1Ymxpc2gubmVlZHMgPSB5YW1sLmpvYnMucHVibGlzaC5uZWVkcy5maWx0ZXIoXG4gICAgICAobmVlZDogc3RyaW5nKSA9PiAham9ic1RvUmVtb3ZlLmluY2x1ZGVzKG5lZWQpLFxuICAgIClcbiAgfVxuXG4gIC8vIFdyaXRlIGJhY2sgdGhlIGZpbHRlcmVkIFlBTUxcbiAgY29uc3QgdXBkYXRlZFlhbWwgPSB5YW1sRHVtcCh5YW1sLCB7XG4gICAgbGluZVdpZHRoOiAtMSxcbiAgICBub1JlZnM6IHRydWUsXG4gICAgc29ydEtleXM6IGZhbHNlLFxuICB9KVxuICBhd2FpdCBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIHVwZGF0ZWRZYW1sKVxufVxuXG5mdW5jdGlvbiBwcm9jZXNzT3B0aW9ucyhvcHRpb25zOiBSYXdOZXdPcHRpb25zKSB7XG4gIGRlYnVnKCdQcm9jZXNzaW5nIG9wdGlvbnMuLi4nKVxuICBpZiAoIW9wdGlvbnMucGF0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHByb3ZpZGUgdGhlIHBhdGggYXMgdGhlIGFyZ3VtZW50JylcbiAgfVxuICBvcHRpb25zLnBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgb3B0aW9ucy5wYXRoKVxuICBkZWJ1ZyhgUmVzb2x2ZWQgdGFyZ2V0IHBhdGggdG86ICR7b3B0aW9ucy5wYXRofWApXG5cbiAgaWYgKCFvcHRpb25zLm5hbWUpIHtcbiAgICBvcHRpb25zLm5hbWUgPSBwYXRoLnBhcnNlKG9wdGlvbnMucGF0aCkuYmFzZVxuICAgIGRlYnVnKGBObyBwcm9qZWN0IG5hbWUgcHJvdmlkZWQsIGZpeCBpdCB0byBkaXIgbmFtZTogJHtvcHRpb25zLm5hbWV9YClcbiAgfVxuXG4gIGlmICghb3B0aW9ucy50YXJnZXRzPy5sZW5ndGgpIHtcbiAgICBpZiAob3B0aW9ucy5lbmFibGVBbGxUYXJnZXRzKSB7XG4gICAgICBvcHRpb25zLnRhcmdldHMgPSBBVkFJTEFCTEVfVEFSR0VUUy5jb25jYXQoKVxuICAgICAgZGVidWcoJ0VuYWJsZSBhbGwgdGFyZ2V0cycpXG4gICAgfSBlbHNlIGlmIChvcHRpb25zLmVuYWJsZURlZmF1bHRUYXJnZXRzKSB7XG4gICAgICBvcHRpb25zLnRhcmdldHMgPSBERUZBVUxUX1RBUkdFVFMuY29uY2F0KClcbiAgICAgIGRlYnVnKCdFbmFibGUgZGVmYXVsdCB0YXJnZXRzJylcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBdCBsZWFzdCBvbmUgdGFyZ2V0IG11c3QgYmUgZW5hYmxlZCcpXG4gICAgfVxuICB9XG4gIGlmIChcbiAgICBvcHRpb25zLnRhcmdldHMuc29tZSgodGFyZ2V0KSA9PiB0YXJnZXQgPT09ICd3YXNtMzItd2FzaS1wcmV2aWV3MS10aHJlYWRzJylcbiAgKSB7XG4gICAgY29uc3Qgb3V0ID0gZXhlY1N5bmMoYHJ1c3R1cCB0YXJnZXQgbGlzdGAsIHtcbiAgICAgIGVuY29kaW5nOiAndXRmOCcsXG4gICAgfSlcbiAgICBpZiAob3V0LmluY2x1ZGVzKCd3YXNtMzItd2FzaXAxLXRocmVhZHMnKSkge1xuICAgICAgb3B0aW9ucy50YXJnZXRzID0gb3B0aW9ucy50YXJnZXRzLm1hcCgodGFyZ2V0KSA9PlxuICAgICAgICB0YXJnZXQgPT09ICd3YXNtMzItd2FzaS1wcmV2aWV3MS10aHJlYWRzJ1xuICAgICAgICAgID8gJ3dhc20zMi13YXNpcDEtdGhyZWFkcydcbiAgICAgICAgICA6IHRhcmdldCxcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYXBwbHlEZWZhdWx0TmV3T3B0aW9ucyhvcHRpb25zKSBhcyBOZXdPcHRpb25zXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBuZXdQcm9qZWN0KHVzZXJPcHRpb25zOiBSYXdOZXdPcHRpb25zKSB7XG4gIGRlYnVnKCdXaWxsIGNyZWF0ZSBuYXBpLXJzIHByb2plY3Qgd2l0aCBnaXZlbiBvcHRpb25zOicpXG4gIGRlYnVnKHVzZXJPcHRpb25zKVxuXG4gIGNvbnN0IG9wdGlvbnMgPSBwcm9jZXNzT3B0aW9ucyh1c2VyT3B0aW9ucylcblxuICBkZWJ1ZygnVGFyZ2V0cyB0byBiZSBlbmFibGVkOicpXG4gIGRlYnVnKG9wdGlvbnMudGFyZ2V0cylcblxuICAvLyBDaGVjayBpZiBnaXQgaXMgYXZhaWxhYmxlXG4gIGlmICghKGF3YWl0IGNoZWNrR2l0Q29tbWFuZCgpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdHaXQgaXMgbm90IGluc3RhbGxlZCBvciBub3QgYXZhaWxhYmxlIGluIFBBVEguIFBsZWFzZSBpbnN0YWxsIEdpdCB0byBjb250aW51ZS4nLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHBhY2thZ2VNYW5hZ2VyID0gb3B0aW9ucy5wYWNrYWdlTWFuYWdlciBhcyBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlclxuXG4gIC8vIEVuc3VyZSB0YXJnZXQgZGlyZWN0b3J5IGV4aXN0cyBhbmQgaXMgZW1wdHlcbiAgYXdhaXQgZW5zdXJlUGF0aChvcHRpb25zLnBhdGgsIG9wdGlvbnMuZHJ5UnVuKVxuXG4gIGlmICghb3B0aW9ucy5kcnlSdW4pIHtcbiAgICB0cnkge1xuICAgICAgLy8gRG93bmxvYWQgb3IgdXBkYXRlIHRlbXBsYXRlXG4gICAgICBjb25zdCBjYWNoZURpciA9IGF3YWl0IGVuc3VyZUNhY2hlRGlyKHBhY2thZ2VNYW5hZ2VyKVxuICAgICAgYXdhaXQgZG93bmxvYWRUZW1wbGF0ZShwYWNrYWdlTWFuYWdlciwgY2FjaGVEaXIpXG5cbiAgICAgIC8vIENvcHkgdGVtcGxhdGUgZmlsZXMgdG8gdGFyZ2V0IGRpcmVjdG9yeVxuICAgICAgY29uc3QgdGVtcGxhdGVQYXRoID0gcGF0aC5qb2luKGNhY2hlRGlyLCAncmVwbycpXG4gICAgICBhd2FpdCBjb3B5RGlyZWN0b3J5KFxuICAgICAgICB0ZW1wbGF0ZVBhdGgsXG4gICAgICAgIG9wdGlvbnMucGF0aCxcbiAgICAgICAgb3B0aW9ucy50YXJnZXRzLmluY2x1ZGVzKCd3YXNtMzItd2FzaXAxLXRocmVhZHMnKSxcbiAgICAgIClcblxuICAgICAgLy8gUmVuYW1lIHByb2plY3QgdXNpbmcgdGhlIHJlbmFtZSBBUElcbiAgICAgIGF3YWl0IHJlbmFtZVByb2plY3Qoe1xuICAgICAgICBjd2Q6IG9wdGlvbnMucGF0aCxcbiAgICAgICAgbmFtZTogb3B0aW9ucy5uYW1lLFxuICAgICAgICBiaW5hcnlOYW1lOiBnZXRCaW5hcnlOYW1lKG9wdGlvbnMubmFtZSksXG4gICAgICB9KVxuXG4gICAgICAvLyBGaWx0ZXIgdGFyZ2V0cyBpbiBwYWNrYWdlLmpzb25cbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGguam9pbihvcHRpb25zLnBhdGgsICdwYWNrYWdlLmpzb24nKVxuICAgICAgaWYgKGV4aXN0c1N5bmMocGFja2FnZUpzb25QYXRoKSkge1xuICAgICAgICBhd2FpdCBmaWx0ZXJUYXJnZXRzSW5QYWNrYWdlSnNvbihwYWNrYWdlSnNvblBhdGgsIG9wdGlvbnMudGFyZ2V0cylcbiAgICAgIH1cblxuICAgICAgLy8gRmlsdGVyIHRhcmdldHMgaW4gR2l0SHViIEFjdGlvbnMgQ0lcbiAgICAgIGNvbnN0IGNpUGF0aCA9IHBhdGguam9pbihvcHRpb25zLnBhdGgsICcuZ2l0aHViJywgJ3dvcmtmbG93cycsICdDSS55bWwnKVxuICAgICAgaWYgKGV4aXN0c1N5bmMoY2lQYXRoKSAmJiBvcHRpb25zLmVuYWJsZUdpdGh1YkFjdGlvbnMpIHtcbiAgICAgICAgYXdhaXQgZmlsdGVyVGFyZ2V0c0luR2l0aHViQWN0aW9ucyhjaVBhdGgsIG9wdGlvbnMudGFyZ2V0cylcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICFvcHRpb25zLmVuYWJsZUdpdGh1YkFjdGlvbnMgJiZcbiAgICAgICAgZXhpc3RzU3luYyhwYXRoLmpvaW4ob3B0aW9ucy5wYXRoLCAnLmdpdGh1YicpKVxuICAgICAgKSB7XG4gICAgICAgIC8vIFJlbW92ZSAuZ2l0aHViIGRpcmVjdG9yeSBpZiBHaXRIdWIgQWN0aW9ucyBpcyBub3QgZW5hYmxlZFxuICAgICAgICBhd2FpdCBmcy5ybShwYXRoLmpvaW4ob3B0aW9ucy5wYXRoLCAnLmdpdGh1YicpLCB7XG4gICAgICAgICAgcmVjdXJzaXZlOiB0cnVlLFxuICAgICAgICAgIGZvcmNlOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgfVxuXG4gICAgICAvLyBVcGRhdGUgcGFja2FnZS5qc29uIHdpdGggYWRkaXRpb25hbCBjb25maWd1cmF0aW9uc1xuICAgICAgY29uc3QgcGtnSnNvbkNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShwYWNrYWdlSnNvblBhdGgsICd1dGYtOCcpXG4gICAgICBjb25zdCBwa2dKc29uID0gSlNPTi5wYXJzZShwa2dKc29uQ29udGVudClcblxuICAgICAgLy8gVXBkYXRlIGVuZ2luZSByZXF1aXJlbWVudFxuICAgICAgaWYgKCFwa2dKc29uLmVuZ2luZXMpIHtcbiAgICAgICAgcGtnSnNvbi5lbmdpbmVzID0ge31cbiAgICAgIH1cbiAgICAgIHBrZ0pzb24uZW5naW5lcy5ub2RlID0gbmFwaUVuZ2luZVJlcXVpcmVtZW50KG9wdGlvbnMubWluTm9kZUFwaVZlcnNpb24pXG5cbiAgICAgIC8vIFVwZGF0ZSBsaWNlbnNlIGlmIGRpZmZlcmVudCBmcm9tIHRlbXBsYXRlXG4gICAgICBpZiAob3B0aW9ucy5saWNlbnNlICYmIHBrZ0pzb24ubGljZW5zZSAhPT0gb3B0aW9ucy5saWNlbnNlKSB7XG4gICAgICAgIHBrZ0pzb24ubGljZW5zZSA9IG9wdGlvbnMubGljZW5zZVxuICAgICAgfVxuXG4gICAgICAvLyBVcGRhdGUgdGVzdCBmcmFtZXdvcmsgaWYgbmVlZGVkXG4gICAgICBpZiAob3B0aW9ucy50ZXN0RnJhbWV3b3JrICE9PSAnYXZhJykge1xuICAgICAgICAvLyBUaGlzIHdvdWxkIHJlcXVpcmUgbW9yZSBjb21wbGV4IGxvZ2ljIHRvIHVwZGF0ZSB0ZXN0IHNjcmlwdHMgYW5kIGRlcGVuZGVuY2llc1xuICAgICAgICBkZWJ1ZyhcbiAgICAgICAgICBgVGVzdCBmcmFtZXdvcmsgJHtvcHRpb25zLnRlc3RGcmFtZXdvcmt9IHJlcXVlc3RlZCBidXQgbm90IHlldCBpbXBsZW1lbnRlZGAsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKFxuICAgICAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHBrZ0pzb24sIG51bGwsIDIpICsgJ1xcbicsXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBwcm9qZWN0OiAke2Vycm9yfWApXG4gICAgfVxuICB9XG5cbiAgZGVidWcoYFByb2plY3QgY3JlYXRlZCBhdDogJHtvcHRpb25zLnBhdGh9YClcbn1cblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlUGF0aChwYXRoOiBzdHJpbmcsIGRyeVJ1biA9IGZhbHNlKSB7XG4gIGNvbnN0IHN0YXQgPSBhd2FpdCBzdGF0QXN5bmMocGF0aCwge30pLmNhdGNoKCgpID0+IHVuZGVmaW5lZClcblxuICAvLyBmaWxlIGRlc2NyaXB0b3IgZXhpc3RzXG4gIGlmIChzdGF0KSB7XG4gICAgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYFBhdGggJHtwYXRofSBmb3IgY3JlYXRpbmcgbmV3IG5hcGktcnMgcHJvamVjdCBhbHJlYWR5IGV4aXN0cyBhbmQgaXQncyBub3QgYSBkaXJlY3RvcnkuYCxcbiAgICAgIClcbiAgICB9IGVsc2UgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCByZWFkZGlyQXN5bmMocGF0aClcbiAgICAgIGlmIChmaWxlcy5sZW5ndGgpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGBQYXRoICR7cGF0aH0gZm9yIGNyZWF0aW5nIG5ldyBuYXBpLXJzIHByb2plY3QgYWxyZWFkeSBleGlzdHMgYW5kIGl0J3Mgbm90IGVtcHR5LmAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBpZiAoIWRyeVJ1bikge1xuICAgIHRyeSB7XG4gICAgICBkZWJ1ZyhgVHJ5IHRvIGNyZWF0ZSB0YXJnZXQgZGlyZWN0b3J5OiAke3BhdGh9YClcbiAgICAgIGlmICghZHJ5UnVuKSB7XG4gICAgICAgIGF3YWl0IG1rZGlyQXN5bmMocGF0aCwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgdGFyZ2V0IGRpcmVjdG9yeTogJHtwYXRofWAsIHtcbiAgICAgICAgY2F1c2U6IGUsXG4gICAgICB9KVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRCaW5hcnlOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBuYW1lLnNwbGl0KCcvJykucG9wKCkhXG59XG5cbmV4cG9ydCB0eXBlIHsgTmV3T3B0aW9ucyB9XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVByZVB1Ymxpc2hDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ3ByZS1wdWJsaXNoJ10sIFsncHJlcHVibGlzaCddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1VwZGF0ZSBwYWNrYWdlLmpzb24gYW5kIGNvcHkgYWRkb25zIGludG8gcGVyIHBsYXRmb3JtIHBhY2thZ2VzJyxcbiAgfSlcblxuICBjd2QgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHByb2Nlc3MuY3dkKCksIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsICdwYWNrYWdlLmpzb24nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICBucG1EaXIgPSBPcHRpb24uU3RyaW5nKCctLW5wbS1kaXIsLXAnLCAnbnBtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0JyxcbiAgfSlcblxuICB0YWdTdHlsZSA9IE9wdGlvbi5TdHJpbmcoJy0tdGFnLXN0eWxlLC0tdGFnc3R5bGUsLXQnLCAnbGVybmEnLCB7XG4gICAgZGVzY3JpcHRpb246ICdnaXQgdGFnIHN0eWxlLCBgbnBtYCBvciBgbGVybmFgJyxcbiAgfSlcblxuICBnaFJlbGVhc2UgPSBPcHRpb24uQm9vbGVhbignLS1naC1yZWxlYXNlJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBjcmVhdGUgR2l0SHViIHJlbGVhc2UnLFxuICB9KVxuXG4gIGdoUmVsZWFzZU5hbWU/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWdoLXJlbGVhc2UtbmFtZScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0dpdEh1YiByZWxlYXNlIG5hbWUnLFxuICB9KVxuXG4gIGdoUmVsZWFzZUlkPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1naC1yZWxlYXNlLWlkJywge1xuICAgIGRlc2NyaXB0aW9uOiAnRXhpc3RpbmcgR2l0SHViIHJlbGVhc2UgaWQnLFxuICB9KVxuXG4gIHNraXBPcHRpb25hbFB1Ymxpc2ggPSBPcHRpb24uQm9vbGVhbignLS1za2lwLW9wdGlvbmFsLXB1Ymxpc2gnLCBmYWxzZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBza2lwIG9wdGlvbmFsRGVwZW5kZW5jaWVzIHBhY2thZ2VzIHB1Ymxpc2gnLFxuICB9KVxuXG4gIGRyeVJ1biA9IE9wdGlvbi5Cb29sZWFuKCctLWRyeS1ydW4nLCBmYWxzZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnRHJ5IHJ1biB3aXRob3V0IHRvdWNoaW5nIGZpbGUgc3lzdGVtJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG5wbURpcjogdGhpcy5ucG1EaXIsXG4gICAgICB0YWdTdHlsZTogdGhpcy50YWdTdHlsZSxcbiAgICAgIGdoUmVsZWFzZTogdGhpcy5naFJlbGVhc2UsXG4gICAgICBnaFJlbGVhc2VOYW1lOiB0aGlzLmdoUmVsZWFzZU5hbWUsXG4gICAgICBnaFJlbGVhc2VJZDogdGhpcy5naFJlbGVhc2VJZCxcbiAgICAgIHNraXBPcHRpb25hbFB1Ymxpc2g6IHRoaXMuc2tpcE9wdGlvbmFsUHVibGlzaCxcbiAgICAgIGRyeVJ1bjogdGhpcy5kcnlSdW4sXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogVXBkYXRlIHBhY2thZ2UuanNvbiBhbmQgY29weSBhZGRvbnMgaW50byBwZXIgcGxhdGZvcm0gcGFja2FnZXNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcmVQdWJsaXNoT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICpcbiAgICogQGRlZmF1bHQgcHJvY2Vzcy5jd2QoKVxuICAgKi9cbiAgY3dkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlXG4gICAqL1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIGBwYWNrYWdlLmpzb25gXG4gICAqXG4gICAqIEBkZWZhdWx0ICdwYWNrYWdlLmpzb24nXG4gICAqL1xuICBwYWNrYWdlSnNvblBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbnBtJ1xuICAgKi9cbiAgbnBtRGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBnaXQgdGFnIHN0eWxlLCBgbnBtYCBvciBgbGVybmFgXG4gICAqXG4gICAqIEBkZWZhdWx0ICdsZXJuYSdcbiAgICovXG4gIHRhZ1N0eWxlPzogJ25wbScgfCAnbGVybmEnXG4gIC8qKlxuICAgKiBXaGV0aGVyIGNyZWF0ZSBHaXRIdWIgcmVsZWFzZVxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBnaFJlbGVhc2U/OiBib29sZWFuXG4gIC8qKlxuICAgKiBHaXRIdWIgcmVsZWFzZSBuYW1lXG4gICAqL1xuICBnaFJlbGVhc2VOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBFeGlzdGluZyBHaXRIdWIgcmVsZWFzZSBpZFxuICAgKi9cbiAgZ2hSZWxlYXNlSWQ/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgc2tpcCBvcHRpb25hbERlcGVuZGVuY2llcyBwYWNrYWdlcyBwdWJsaXNoXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBza2lwT3B0aW9uYWxQdWJsaXNoPzogYm9vbGVhblxuICAvKipcbiAgICogRHJ5IHJ1biB3aXRob3V0IHRvdWNoaW5nIGZpbGUgc3lzdGVtXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBkcnlSdW4/OiBib29sZWFuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRQcmVQdWJsaXNoT3B0aW9ucyhvcHRpb25zOiBQcmVQdWJsaXNoT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG5wbURpcjogJ25wbScsXG4gICAgdGFnU3R5bGU6ICdsZXJuYScsXG4gICAgZ2hSZWxlYXNlOiB0cnVlLFxuICAgIHNraXBPcHRpb25hbFB1Ymxpc2g6IGZhbHNlLFxuICAgIGRyeVJ1bjogZmFsc2UsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VWZXJzaW9uQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWyd2ZXJzaW9uJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdVcGRhdGUgdmVyc2lvbiBpbiBjcmVhdGVkIG5wbSBwYWNrYWdlcycsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgbnBtRGlyID0gT3B0aW9uLlN0cmluZygnLS1ucG0tZGlyJywgJ25wbScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dCcsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBucG1EaXI6IHRoaXMubnBtRGlyLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFVwZGF0ZSB2ZXJzaW9uIGluIGNyZWF0ZWQgbnBtIHBhY2thZ2VzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmVyc2lvbk9wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXRcbiAgICpcbiAgICogQGRlZmF1bHQgJ25wbSdcbiAgICovXG4gIG5wbURpcj86IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0VmVyc2lvbk9wdGlvbnMob3B0aW9uczogVmVyc2lvbk9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBucG1EaXI6ICducG0nLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdFZlcnNpb25PcHRpb25zLFxuICB0eXBlIFZlcnNpb25PcHRpb25zLFxufSBmcm9tICcuLi9kZWYvdmVyc2lvbi5qcydcbmltcG9ydCB7XG4gIHJlYWROYXBpQ29uZmlnLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIHVwZGF0ZVBhY2thZ2VKc29uLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ3ZlcnNpb24nKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyc2lvbih1c2VyT3B0aW9uczogVmVyc2lvbk9wdGlvbnMpIHtcbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdFZlcnNpb25PcHRpb25zKHVzZXJPcHRpb25zKVxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcblxuICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgKVxuXG4gIGZvciAoY29uc3QgdGFyZ2V0IG9mIGNvbmZpZy50YXJnZXRzKSB7XG4gICAgY29uc3QgcGtnRGlyID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5ucG1EaXIsIHRhcmdldC5wbGF0Zm9ybUFyY2hBQkkpXG5cbiAgICBkZWJ1ZyhgVXBkYXRlIHZlcnNpb24gdG8gJWkgaW4gWyVpXWAsIGNvbmZpZy5wYWNrYWdlSnNvbi52ZXJzaW9uLCBwa2dEaXIpXG4gICAgYXdhaXQgdXBkYXRlUGFja2FnZUpzb24oam9pbihwa2dEaXIsICdwYWNrYWdlLmpzb24nKSwge1xuICAgICAgdmVyc2lvbjogY29uZmlnLnBhY2thZ2VKc29uLnZlcnNpb24sXG4gICAgfSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5pbXBvcnQgeyBleGlzdHNTeW5jLCBzdGF0U3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCdcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0UHJlUHVibGlzaE9wdGlvbnMsXG4gIHR5cGUgUHJlUHVibGlzaE9wdGlvbnMsXG59IGZyb20gJy4uL2RlZi9wcmUtcHVibGlzaC5qcydcbmltcG9ydCB7XG4gIHJlYWRGaWxlQXN5bmMsXG4gIHJlYWROYXBpQ29uZmlnLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIHVwZGF0ZVBhY2thZ2VKc29uLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuaW1wb3J0IHsgdmVyc2lvbiB9IGZyb20gJy4vdmVyc2lvbi5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ3ByZS1wdWJsaXNoJylcblxuaW50ZXJmYWNlIFBhY2thZ2VJbmZvIHtcbiAgbmFtZTogc3RyaW5nXG4gIHZlcnNpb246IHN0cmluZ1xuICB0YWc6IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJlUHVibGlzaCh1c2VyT3B0aW9uczogUHJlUHVibGlzaE9wdGlvbnMpIHtcbiAgZGVidWcoJ1JlY2VpdmUgcHJlLXB1Ymxpc2ggb3B0aW9uczonKVxuICBkZWJ1ZygnICAlTycsIHVzZXJPcHRpb25zKVxuXG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRQcmVQdWJsaXNoT3B0aW9ucyh1c2VyT3B0aW9ucylcblxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcblxuICBjb25zdCB7IHBhY2thZ2VKc29uLCB0YXJnZXRzLCBwYWNrYWdlTmFtZSwgYmluYXJ5TmFtZSwgbnBtQ2xpZW50IH0gPVxuICAgIGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgICAgcGFja2FnZUpzb25QYXRoLFxuICAgICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgICApXG5cbiAgYXN5bmMgZnVuY3Rpb24gY3JlYXRlR2hSZWxlYXNlKHBhY2thZ2VOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZykge1xuICAgIGlmICghb3B0aW9ucy5naFJlbGVhc2UpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG93bmVyOiBudWxsLFxuICAgICAgICByZXBvOiBudWxsLFxuICAgICAgICBwa2dJbmZvOiB7IG5hbWU6IG51bGwsIHZlcnNpb246IG51bGwsIHRhZzogbnVsbCB9LFxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCB7IHJlcG8sIG93bmVyLCBwa2dJbmZvLCBvY3Rva2l0IH0gPSBnZXRSZXBvSW5mbyhwYWNrYWdlTmFtZSwgdmVyc2lvbilcblxuICAgIGlmICghcmVwbyB8fCAhb3duZXIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG93bmVyOiBudWxsLFxuICAgICAgICByZXBvOiBudWxsLFxuICAgICAgICBwa2dJbmZvOiB7IG5hbWU6IG51bGwsIHZlcnNpb246IG51bGwsIHRhZzogbnVsbCB9LFxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghb3B0aW9ucy5kcnlSdW4pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG9jdG9raXQucmVwb3MuY3JlYXRlUmVsZWFzZSh7XG4gICAgICAgICAgb3duZXIsXG4gICAgICAgICAgcmVwbyxcbiAgICAgICAgICB0YWdfbmFtZTogcGtnSW5mby50YWcsXG4gICAgICAgICAgbmFtZTogb3B0aW9ucy5naFJlbGVhc2VOYW1lLFxuICAgICAgICAgIHByZXJlbGVhc2U6XG4gICAgICAgICAgICB2ZXJzaW9uLmluY2x1ZGVzKCdhbHBoYScpIHx8XG4gICAgICAgICAgICB2ZXJzaW9uLmluY2x1ZGVzKCdiZXRhJykgfHxcbiAgICAgICAgICAgIHZlcnNpb24uaW5jbHVkZXMoJ3JjJyksXG4gICAgICAgIH0pXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGRlYnVnKFxuICAgICAgICAgIGBQYXJhbXM6ICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAgICB7IG93bmVyLCByZXBvLCB0YWdfbmFtZTogcGtnSW5mby50YWcgfSxcbiAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAyLFxuICAgICAgICAgICl9YCxcbiAgICAgICAgKVxuICAgICAgICBjb25zb2xlLmVycm9yKGUpXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IG93bmVyLCByZXBvLCBwa2dJbmZvLCBvY3Rva2l0IH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGdldFJlcG9JbmZvKHBhY2thZ2VOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZykge1xuICAgIGNvbnN0IGhlYWRDb21taXQgPSBleGVjU3luYygnZ2l0IGxvZyAtMSAtLXByZXR0eT0lQicsIHtcbiAgICAgIGVuY29kaW5nOiAndXRmLTgnLFxuICAgIH0pLnRyaW0oKVxuXG4gICAgY29uc3QgeyBHSVRIVUJfUkVQT1NJVE9SWSB9ID0gcHJvY2Vzcy5lbnZcbiAgICBpZiAoIUdJVEhVQl9SRVBPU0lUT1JZKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvd25lcjogbnVsbCxcbiAgICAgICAgcmVwbzogbnVsbCxcbiAgICAgICAgcGtnSW5mbzogeyBuYW1lOiBudWxsLCB2ZXJzaW9uOiBudWxsLCB0YWc6IG51bGwgfSxcbiAgICAgIH1cbiAgICB9XG4gICAgZGVidWcoYEdpdGh1YiByZXBvc2l0b3J5OiAke0dJVEhVQl9SRVBPU0lUT1JZfWApXG4gICAgY29uc3QgW293bmVyLCByZXBvXSA9IEdJVEhVQl9SRVBPU0lUT1JZLnNwbGl0KCcvJylcbiAgICBjb25zdCBvY3Rva2l0ID0gbmV3IE9jdG9raXQoe1xuICAgICAgYXV0aDogcHJvY2Vzcy5lbnYuR0lUSFVCX1RPS0VOLFxuICAgIH0pXG4gICAgbGV0IHBrZ0luZm86IFBhY2thZ2VJbmZvIHwgdW5kZWZpbmVkXG4gICAgaWYgKG9wdGlvbnMudGFnU3R5bGUgPT09ICdsZXJuYScpIHtcbiAgICAgIGNvbnN0IHBhY2thZ2VzVG9QdWJsaXNoID0gaGVhZENvbW1pdFxuICAgICAgICAuc3BsaXQoJ1xcbicpXG4gICAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgICAuZmlsdGVyKChsaW5lLCBpbmRleCkgPT4gbGluZS5sZW5ndGggJiYgaW5kZXgpXG4gICAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUuc3Vic3RyaW5nKDIpKVxuICAgICAgICAubWFwKHBhcnNlVGFnKVxuXG4gICAgICBwa2dJbmZvID0gcGFja2FnZXNUb1B1Ymxpc2guZmluZChcbiAgICAgICAgKHBrZ0luZm8pID0+IHBrZ0luZm8ubmFtZSA9PT0gcGFja2FnZU5hbWUsXG4gICAgICApXG5cbiAgICAgIGlmICghcGtnSW5mbykge1xuICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFxuICAgICAgICAgIGBObyByZWxlYXNlIGNvbW1pdCBmb3VuZCB3aXRoICR7cGFja2FnZU5hbWV9LCBvcmlnaW5hbCBjb21taXQgaW5mbzogJHtoZWFkQ29tbWl0fWAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcGtnSW5mbyA9IHtcbiAgICAgICAgdGFnOiBgdiR7dmVyc2lvbn1gLFxuICAgICAgICB2ZXJzaW9uLFxuICAgICAgICBuYW1lOiBwYWNrYWdlTmFtZSxcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgb3duZXIsIHJlcG8sIHBrZ0luZm8sIG9jdG9raXQgfVxuICB9XG5cbiAgaWYgKCFvcHRpb25zLmRyeVJ1bikge1xuICAgIGF3YWl0IHZlcnNpb24odXNlck9wdGlvbnMpXG4gICAgYXdhaXQgdXBkYXRlUGFja2FnZUpzb24ocGFja2FnZUpzb25QYXRoLCB7XG4gICAgICBvcHRpb25hbERlcGVuZGVuY2llczogdGFyZ2V0cy5yZWR1Y2UoXG4gICAgICAgIChkZXBzLCB0YXJnZXQpID0+IHtcbiAgICAgICAgICBkZXBzW2Ake3BhY2thZ2VOYW1lfS0ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9YF0gPSBwYWNrYWdlSnNvbi52ZXJzaW9uXG5cbiAgICAgICAgICByZXR1cm4gZGVwc1xuICAgICAgICB9LFxuICAgICAgICB7fSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICAgICAgKSxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgeyBvd25lciwgcmVwbywgcGtnSW5mbywgb2N0b2tpdCB9ID0gb3B0aW9ucy5naFJlbGVhc2VJZFxuICAgID8gZ2V0UmVwb0luZm8ocGFja2FnZU5hbWUsIHBhY2thZ2VKc29uLnZlcnNpb24pXG4gICAgOiBhd2FpdCBjcmVhdGVHaFJlbGVhc2UocGFja2FnZU5hbWUsIHBhY2thZ2VKc29uLnZlcnNpb24pXG5cbiAgZm9yIChjb25zdCB0YXJnZXQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IHBrZ0RpciA9IHJlc29sdmUoXG4gICAgICBvcHRpb25zLmN3ZCxcbiAgICAgIG9wdGlvbnMubnBtRGlyLFxuICAgICAgYCR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1gLFxuICAgIClcbiAgICBjb25zdCBleHQgPVxuICAgICAgdGFyZ2V0LnBsYXRmb3JtID09PSAnd2FzaScgfHwgdGFyZ2V0LnBsYXRmb3JtID09PSAnd2FzbScgPyAnd2FzbScgOiAnbm9kZSdcbiAgICBjb25zdCBmaWxlbmFtZSA9IGAke2JpbmFyeU5hbWV9LiR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX0uJHtleHR9YFxuICAgIGNvbnN0IGRzdFBhdGggPSBqb2luKHBrZ0RpciwgZmlsZW5hbWUpXG5cbiAgICBpZiAoIW9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgICBpZiAoIWV4aXN0c1N5bmMoZHN0UGF0aCkpIHtcbiAgICAgICAgZGVidWcud2FybihgJXMgZG9lc24ndCBleGlzdGAsIGRzdFBhdGgpXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmICghb3B0aW9ucy5za2lwT3B0aW9uYWxQdWJsaXNoKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3Qgb3V0cHV0ID0gZXhlY1N5bmMoYCR7bnBtQ2xpZW50fSBwdWJsaXNoYCwge1xuICAgICAgICAgICAgY3dkOiBwa2dEaXIsXG4gICAgICAgICAgICBlbnY6IHByb2Nlc3MuZW52LFxuICAgICAgICAgICAgc3RkaW86ICdwaXBlJyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKG91dHB1dClcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGUgaW5zdGFuY2VvZiBFcnJvciAmJlxuICAgICAgICAgICAgZS5tZXNzYWdlLmluY2x1ZGVzKFxuICAgICAgICAgICAgICAnWW91IGNhbm5vdCBwdWJsaXNoIG92ZXIgdGhlIHByZXZpb3VzbHkgcHVibGlzaGVkIHZlcnNpb25zJyxcbiAgICAgICAgICAgIClcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIGNvbnNvbGUuaW5mbyhlLm1lc3NhZ2UpXG4gICAgICAgICAgICBkZWJ1Zy53YXJuKGAke3BrZ0Rpcn0gaGFzIGJlZW4gcHVibGlzaGVkLCBza2lwcGluZ2ApXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IGVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG9wdGlvbnMuZ2hSZWxlYXNlICYmIHJlcG8gJiYgb3duZXIpIHtcbiAgICAgICAgZGVidWcuaW5mbyhgQ3JlYXRpbmcgR2l0SHViIHJlbGVhc2UgJHtwa2dJbmZvLnRhZ31gKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHJlbGVhc2VJZCA9IG9wdGlvbnMuZ2hSZWxlYXNlSWRcbiAgICAgICAgICAgID8gTnVtYmVyKG9wdGlvbnMuZ2hSZWxlYXNlSWQpXG4gICAgICAgICAgICA6IChcbiAgICAgICAgICAgICAgICBhd2FpdCBvY3Rva2l0IS5yZXBvcy5nZXRSZWxlYXNlQnlUYWcoe1xuICAgICAgICAgICAgICAgICAgcmVwbzogcmVwbyxcbiAgICAgICAgICAgICAgICAgIG93bmVyOiBvd25lcixcbiAgICAgICAgICAgICAgICAgIHRhZzogcGtnSW5mby50YWcsXG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgKS5kYXRhLmlkXG4gICAgICAgICAgY29uc3QgZHN0RmlsZVN0YXRzID0gc3RhdFN5bmMoZHN0UGF0aClcbiAgICAgICAgICBjb25zdCBhc3NldEluZm8gPSBhd2FpdCBvY3Rva2l0IS5yZXBvcy51cGxvYWRSZWxlYXNlQXNzZXQoe1xuICAgICAgICAgICAgb3duZXI6IG93bmVyLFxuICAgICAgICAgICAgcmVwbzogcmVwbyxcbiAgICAgICAgICAgIG5hbWU6IGZpbGVuYW1lLFxuICAgICAgICAgICAgcmVsZWFzZV9pZDogcmVsZWFzZUlkLFxuICAgICAgICAgICAgbWVkaWFUeXBlOiB7IGZvcm1hdDogJ3JhdycgfSxcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgJ2NvbnRlbnQtbGVuZ3RoJzogZHN0RmlsZVN0YXRzLnNpemUsXG4gICAgICAgICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG9jdG9raXQgdHlwZXMgYXJlIHdyb25nXG4gICAgICAgICAgICBkYXRhOiBhd2FpdCByZWFkRmlsZUFzeW5jKGRzdFBhdGgpLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgZGVidWcuaW5mbyhgR2l0SHViIHJlbGVhc2UgY3JlYXRlZGApXG4gICAgICAgICAgZGVidWcuaW5mbyhgRG93bmxvYWQgVVJMOiAlc2AsIGFzc2V0SW5mby5kYXRhLmJyb3dzZXJfZG93bmxvYWRfdXJsKVxuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgZGVidWcuZXJyb3IoXG4gICAgICAgICAgICBgUGFyYW06ICR7SlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAgICAgIHsgb3duZXIsIHJlcG8sIHRhZzogcGtnSW5mby50YWcsIGZpbGVuYW1lOiBkc3RQYXRoIH0sXG4gICAgICAgICAgICAgIG51bGwsXG4gICAgICAgICAgICAgIDIsXG4gICAgICAgICAgICApfWAsXG4gICAgICAgICAgKVxuICAgICAgICAgIGRlYnVnLmVycm9yKGUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VUYWcodGFnOiBzdHJpbmcpIHtcbiAgY29uc3Qgc2VnbWVudHMgPSB0YWcuc3BsaXQoJ0AnKVxuICBjb25zdCB2ZXJzaW9uID0gc2VnbWVudHMucG9wKCkhXG4gIGNvbnN0IG5hbWUgPSBzZWdtZW50cy5qb2luKCdAJylcblxuICByZXR1cm4ge1xuICAgIG5hbWUsXG4gICAgdmVyc2lvbixcbiAgICB0YWcsXG4gIH1cbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlVW5pdmVyc2FsaXplQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWyd1bml2ZXJzYWxpemUnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ0NvbWJpbGUgYnVpbHQgYmluYXJpZXMgaW50byBvbmUgdW5pdmVyc2FsIGJpbmFyeScsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgb3V0cHV0RGlyID0gT3B0aW9uLlN0cmluZygnLS1vdXRwdXQtZGlyLC1vJywgJy4vJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSBhbGwgYnVpbHQgYC5ub2RlYCBmaWxlcyBwdXQsIHNhbWUgYXMgYC0tb3V0cHV0LWRpcmAgb2YgYnVpbGQgY29tbWFuZCcsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBvdXRwdXREaXI6IHRoaXMub3V0cHV0RGlyLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENvbWJpbGUgYnVpbHQgYmluYXJpZXMgaW50byBvbmUgdW5pdmVyc2FsIGJpbmFyeVxuICovXG5leHBvcnQgaW50ZXJmYWNlIFVuaXZlcnNhbGl6ZU9wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgYWxsIGJ1aWx0IGAubm9kZWAgZmlsZXMgcHV0LCBzYW1lIGFzIGAtLW91dHB1dC1kaXJgIG9mIGJ1aWxkIGNvbW1hbmRcbiAgICpcbiAgICogQGRlZmF1bHQgJy4vJ1xuICAgKi9cbiAgb3V0cHV0RGlyPzogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRVbml2ZXJzYWxpemVPcHRpb25zKG9wdGlvbnM6IFVuaXZlcnNhbGl6ZU9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBvdXRwdXREaXI6ICcuLycsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0IHsgc3Bhd25TeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0VW5pdmVyc2FsaXplT3B0aW9ucyxcbiAgdHlwZSBVbml2ZXJzYWxpemVPcHRpb25zLFxufSBmcm9tICcuLi9kZWYvdW5pdmVyc2FsaXplLmpzJ1xuaW1wb3J0IHsgcmVhZE5hcGlDb25maWcgfSBmcm9tICcuLi91dGlscy9jb25maWcuanMnXG5pbXBvcnQgeyBkZWJ1Z0ZhY3RvcnkgfSBmcm9tICcuLi91dGlscy9sb2cuanMnXG5pbXBvcnQgeyBmaWxlRXhpc3RzIH0gZnJvbSAnLi4vdXRpbHMvbWlzYy5qcydcbmltcG9ydCB7IFVuaUFyY2hzQnlQbGF0Zm9ybSB9IGZyb20gJy4uL3V0aWxzL3RhcmdldC5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ3VuaXZlcnNhbGl6ZScpXG5cbmNvbnN0IHVuaXZlcnNhbGl6ZXJzOiBQYXJ0aWFsPFxuICBSZWNvcmQ8Tm9kZUpTLlBsYXRmb3JtLCAoaW5wdXRzOiBzdHJpbmdbXSwgb3V0cHV0OiBzdHJpbmcpID0+IHZvaWQ+XG4+ID0ge1xuICBkYXJ3aW46IChpbnB1dHMsIG91dHB1dCkgPT4ge1xuICAgIHNwYXduU3luYygnbGlwbycsIFsnLWNyZWF0ZScsICctb3V0cHV0Jywgb3V0cHV0LCAuLi5pbnB1dHNdLCB7XG4gICAgICBzdGRpbzogJ2luaGVyaXQnLFxuICAgIH0pXG4gIH0sXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1bml2ZXJzYWxpemVCaW5hcmllcyh1c2VyT3B0aW9uczogVW5pdmVyc2FsaXplT3B0aW9ucykge1xuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0VW5pdmVyc2FsaXplT3B0aW9ucyh1c2VyT3B0aW9ucylcblxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBqb2luKG9wdGlvbnMuY3dkLCBvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcblxuICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICBwYWNrYWdlSnNvblBhdGgsXG4gICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgKVxuXG4gIGNvbnN0IHRhcmdldCA9IGNvbmZpZy50YXJnZXRzLmZpbmQoXG4gICAgKHQpID0+IHQucGxhdGZvcm0gPT09IHByb2Nlc3MucGxhdGZvcm0gJiYgdC5hcmNoID09PSAndW5pdmVyc2FsJyxcbiAgKVxuXG4gIGlmICghdGFyZ2V0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYCd1bml2ZXJzYWwnIGFyY2ggZm9yIHBsYXRmb3JtICcke3Byb2Nlc3MucGxhdGZvcm19JyBub3QgZm91bmQgaW4gY29uZmlnIWAsXG4gICAgKVxuICB9XG5cbiAgY29uc3Qgc3JjRmlsZXMgPSBVbmlBcmNoc0J5UGxhdGZvcm1bcHJvY2Vzcy5wbGF0Zm9ybV0/Lm1hcCgoYXJjaCkgPT5cbiAgICByZXNvbHZlKFxuICAgICAgb3B0aW9ucy5jd2QsXG4gICAgICBvcHRpb25zLm91dHB1dERpcixcbiAgICAgIGAke2NvbmZpZy5iaW5hcnlOYW1lfS4ke3Byb2Nlc3MucGxhdGZvcm19LSR7YXJjaH0ubm9kZWAsXG4gICAgKSxcbiAgKVxuXG4gIGlmICghc3JjRmlsZXMgfHwgIXVuaXZlcnNhbGl6ZXJzW3Byb2Nlc3MucGxhdGZvcm1dKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYCd1bml2ZXJzYWwnIGFyY2ggZm9yIHBsYXRmb3JtICcke3Byb2Nlc3MucGxhdGZvcm19JyBub3Qgc3VwcG9ydGVkLmAsXG4gICAgKVxuICB9XG5cbiAgZGVidWcoYExvb2tpbmcgdXAgc291cmNlIGJpbmFyaWVzIHRvIGNvbWJpbmU6IGApXG4gIGRlYnVnKCcgICVPJywgc3JjRmlsZXMpXG5cbiAgY29uc3Qgc3JjRmlsZUxvb2t1cCA9IGF3YWl0IFByb21pc2UuYWxsKHNyY0ZpbGVzLm1hcCgoZikgPT4gZmlsZUV4aXN0cyhmKSkpXG5cbiAgY29uc3Qgbm90Rm91bmRGaWxlcyA9IHNyY0ZpbGVzLmZpbHRlcigoXywgaSkgPT4gIXNyY0ZpbGVMb29rdXBbaV0pXG5cbiAgaWYgKG5vdEZvdW5kRmlsZXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYFNvbWUgYmluYXJ5IGZpbGVzIHdlcmUgbm90IGZvdW5kOiAke0pTT04uc3RyaW5naWZ5KG5vdEZvdW5kRmlsZXMpfWAsXG4gICAgKVxuICB9XG5cbiAgY29uc3Qgb3V0cHV0ID0gcmVzb2x2ZShcbiAgICBvcHRpb25zLmN3ZCxcbiAgICBvcHRpb25zLm91dHB1dERpcixcbiAgICBgJHtjb25maWcuYmluYXJ5TmFtZX0uJHtwcm9jZXNzLnBsYXRmb3JtfS11bml2ZXJzYWwubm9kZWAsXG4gIClcblxuICB1bml2ZXJzYWxpemVyc1twcm9jZXNzLnBsYXRmb3JtXT8uKHNyY0ZpbGVzLCBvdXRwdXQpXG5cbiAgZGVidWcoYFByb2R1Y2VkIHVuaXZlcnNhbCBiaW5hcnk6ICR7b3V0cHV0fWApXG59XG4iLCJpbXBvcnQgeyBDb21tYW5kIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5pbXBvcnQgeyBjb2xsZWN0QXJ0aWZhY3RzIH0gZnJvbSAnLi4vYXBpL2FydGlmYWN0cy5qcydcbmltcG9ydCB7IEJhc2VBcnRpZmFjdHNDb21tYW5kIH0gZnJvbSAnLi4vZGVmL2FydGlmYWN0cy5qcydcblxuZXhwb3J0IGNsYXNzIEFydGlmYWN0c0NvbW1hbmQgZXh0ZW5kcyBCYXNlQXJ0aWZhY3RzQ29tbWFuZCB7XG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnQ29weSBhcnRpZmFjdHMgZnJvbSBHaXRodWIgQWN0aW9ucyBpbnRvIHNwZWNpZmllZCBkaXInLFxuICAgIGV4YW1wbGVzOiBbXG4gICAgICBbXG4gICAgICAgICckMCBhcnRpZmFjdHMgLS1vdXRwdXQtZGlyIC4vYXJ0aWZhY3RzIC0tZGlzdCAuL25wbScsXG4gICAgICAgIGBDb3B5IFtiaW5hcnlOYW1lXS5bcGxhdGZvcm1dLm5vZGUgdW5kZXIgY3VycmVudCBkaXIoLikgaW50byBwYWNrYWdlcyB1bmRlciBucG0gZGlyLlxuZS5nOiBpbmRleC5saW51eC14NjQtZ251Lm5vZGUgLS0+IC4vbnBtL2xpbnV4LXg2NC1nbnUvaW5kZXgubGludXgteDY0LWdudS5ub2RlYCxcbiAgICAgIF0sXG4gICAgXSxcbiAgfSlcblxuICBzdGF0aWMgcGF0aHMgPSBbWydhcnRpZmFjdHMnXV1cblxuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IGNvbGxlY3RBcnRpZmFjdHModGhpcy5nZXRPcHRpb25zKCkpXG4gIH1cbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlQnVpbGRDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ2J1aWxkJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdCdWlsZCB0aGUgTkFQSS1SUyBwcm9qZWN0JyxcbiAgfSlcblxuICB0YXJnZXQ/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXRhcmdldCwtdCcsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdCdWlsZCBmb3IgdGhlIHRhcmdldCB0cmlwbGUsIGJ5cGFzc2VkIHRvIGBjYXJnbyBidWlsZCAtLXRhcmdldGAnLFxuICB9KVxuXG4gIGN3ZD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgbWFuaWZlc3RQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1tYW5pZmVzdC1wYXRoJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgQ2FyZ28udG9tbGAnLFxuICB9KVxuXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWNvbmZpZy1wYXRoLC1jJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZScsXG4gIH0pXG5cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLWpzb24tcGF0aCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIHRhcmdldERpcj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tdGFyZ2V0LWRpcicsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdEaXJlY3RvcnkgZm9yIGFsbCBjcmF0ZSBnZW5lcmF0ZWQgYXJ0aWZhY3RzLCBzZWUgYGNhcmdvIGJ1aWxkIC0tdGFyZ2V0LWRpcmAnLFxuICB9KVxuXG4gIG91dHB1dERpcj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tb3V0cHV0LWRpciwtbycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIHRvIHdoZXJlIGFsbCB0aGUgYnVpbHQgZmlsZXMgd291bGQgYmUgcHV0LiBEZWZhdWx0IHRvIHRoZSBjcmF0ZSBmb2xkZXInLFxuICB9KVxuXG4gIHBsYXRmb3JtPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXBsYXRmb3JtJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0FkZCBwbGF0Zm9ybSB0cmlwbGUgdG8gdGhlIGdlbmVyYXRlZCBub2RlanMgYmluZGluZyBmaWxlLCBlZzogYFtuYW1lXS5saW51eC14NjQtZ251Lm5vZGVgJyxcbiAgfSlcblxuICBqc1BhY2thZ2VOYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1qcy1wYWNrYWdlLW5hbWUnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGFja2FnZSBuYW1lIGluIGdlbmVyYXRlZCBqcyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZycsXG4gIH0pXG5cbiAgY29uc3RFbnVtPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLWNvbnN0LWVudW0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIGdlbmVyYXRlIGNvbnN0IGVudW0gZm9yIHR5cGVzY3JpcHQgYmluZGluZ3MnLFxuICB9KVxuXG4gIGpzQmluZGluZz86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tanMnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCBhbmQgZmlsZW5hbWUgb2YgZ2VuZXJhdGVkIEpTIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLiBSZWxhdGl2ZSB0byBgLS1vdXRwdXQtZGlyYC4nLFxuICB9KVxuXG4gIG5vSnNCaW5kaW5nPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLW5vLWpzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1doZXRoZXIgdG8gZGlzYWJsZSB0aGUgZ2VuZXJhdGlvbiBKUyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy4nLFxuICB9KVxuXG4gIGR0cz86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tZHRzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggYW5kIGZpbGVuYW1lIG9mIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBSZWxhdGl2ZSB0byBgLS1vdXRwdXQtZGlyYCcsXG4gIH0pXG5cbiAgZHRzSGVhZGVyPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1kdHMtaGVhZGVyJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ0N1c3RvbSBmaWxlIGhlYWRlciBmb3IgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIE9ubHkgd29ya3Mgd2hlbiBgdHlwZWRlZmAgZmVhdHVyZSBlbmFibGVkLicsXG4gIH0pXG5cbiAgbm9EdHNIZWFkZXI/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tbm8tZHRzLWhlYWRlcicsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdXaGV0aGVyIHRvIGRpc2FibGUgdGhlIGRlZmF1bHQgZmlsZSBoZWFkZXIgZm9yIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBPbmx5IHdvcmtzIHdoZW4gYHR5cGVkZWZgIGZlYXR1cmUgZW5hYmxlZC4nLFxuICB9KVxuXG4gIGR0c0NhY2hlID0gT3B0aW9uLkJvb2xlYW4oJy0tZHRzLWNhY2hlJywgdHJ1ZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciB0byBlbmFibGUgdGhlIGR0cyBjYWNoZSwgZGVmYXVsdCB0byB0cnVlJyxcbiAgfSlcblxuICBlc20/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tZXNtJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1doZXRoZXIgdG8gZW1pdCBhbiBFU00gSlMgYmluZGluZyBmaWxlIGluc3RlYWQgb2YgQ0pTIGZvcm1hdC4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLicsXG4gIH0pXG5cbiAgc3RyaXA/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tc3RyaXAsLXMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIHN0cmlwIHRoZSBsaWJyYXJ5IHRvIGFjaGlldmUgdGhlIG1pbmltdW0gZmlsZSBzaXplJyxcbiAgfSlcblxuICByZWxlYXNlPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXJlbGVhc2UsLXInLCB7XG4gICAgZGVzY3JpcHRpb246ICdCdWlsZCBpbiByZWxlYXNlIG1vZGUnLFxuICB9KVxuXG4gIHZlcmJvc2U/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tdmVyYm9zZSwtdicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1ZlcmJvc2VseSBsb2cgYnVpbGQgY29tbWFuZCB0cmFjZScsXG4gIH0pXG5cbiAgYmluPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1iaW4nLCB7XG4gICAgZGVzY3JpcHRpb246ICdCdWlsZCBvbmx5IHRoZSBzcGVjaWZpZWQgYmluYXJ5JyxcbiAgfSlcblxuICBwYWNrYWdlPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1wYWNrYWdlLC1wJywge1xuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgdGhlIHNwZWNpZmllZCBsaWJyYXJ5IG9yIHRoZSBvbmUgYXQgY3dkJyxcbiAgfSlcblxuICBwcm9maWxlPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1wcm9maWxlJywge1xuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgYXJ0aWZhY3RzIHdpdGggdGhlIHNwZWNpZmllZCBwcm9maWxlJyxcbiAgfSlcblxuICBjcm9zc0NvbXBpbGU/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tY3Jvc3MtY29tcGlsZSwteCcsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdbZXhwZXJpbWVudGFsXSBjcm9zcy1jb21waWxlIGZvciB0aGUgc3BlY2lmaWVkIHRhcmdldCB3aXRoIGBjYXJnby14d2luYCBvbiB3aW5kb3dzIGFuZCBgY2FyZ28temlnYnVpbGRgIG9uIG90aGVyIHBsYXRmb3JtJyxcbiAgfSlcblxuICB1c2VDcm9zcz86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS11c2UtY3Jvc3MnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnW2V4cGVyaW1lbnRhbF0gdXNlIFtjcm9zc10oaHR0cHM6Ly9naXRodWIuY29tL2Nyb3NzLXJzL2Nyb3NzKSBpbnN0ZWFkIG9mIGBjYXJnb2AnLFxuICB9KVxuXG4gIHVzZU5hcGlDcm9zcz86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS11c2UtbmFwaS1jcm9zcycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdbZXhwZXJpbWVudGFsXSB1c2UgQG5hcGktcnMvY3Jvc3MtdG9vbGNoYWluIHRvIGNyb3NzLWNvbXBpbGUgTGludXggYXJtL2FybTY0L3g2NCBnbnUgdGFyZ2V0cy4nLFxuICB9KVxuXG4gIHdhdGNoPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXdhdGNoLC13Jywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ3dhdGNoIHRoZSBjcmF0ZSBjaGFuZ2VzIGFuZCBidWlsZCBjb250aW51b3VzbHkgd2l0aCBgY2FyZ28td2F0Y2hgIGNyYXRlcycsXG4gIH0pXG5cbiAgZmVhdHVyZXM/OiBzdHJpbmdbXSA9IE9wdGlvbi5BcnJheSgnLS1mZWF0dXJlcywtRicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1NwYWNlLXNlcGFyYXRlZCBsaXN0IG9mIGZlYXR1cmVzIHRvIGFjdGl2YXRlJyxcbiAgfSlcblxuICBhbGxGZWF0dXJlcz86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1hbGwtZmVhdHVyZXMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdBY3RpdmF0ZSBhbGwgYXZhaWxhYmxlIGZlYXR1cmVzJyxcbiAgfSlcblxuICBub0RlZmF1bHRGZWF0dXJlcz86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1uby1kZWZhdWx0LWZlYXR1cmVzJywge1xuICAgIGRlc2NyaXB0aW9uOiAnRG8gbm90IGFjdGl2YXRlIHRoZSBgZGVmYXVsdGAgZmVhdHVyZScsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgdGFyZ2V0OiB0aGlzLnRhcmdldCxcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBtYW5pZmVzdFBhdGg6IHRoaXMubWFuaWZlc3RQYXRoLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIHRhcmdldERpcjogdGhpcy50YXJnZXREaXIsXG4gICAgICBvdXRwdXREaXI6IHRoaXMub3V0cHV0RGlyLFxuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0sXG4gICAgICBqc1BhY2thZ2VOYW1lOiB0aGlzLmpzUGFja2FnZU5hbWUsXG4gICAgICBjb25zdEVudW06IHRoaXMuY29uc3RFbnVtLFxuICAgICAganNCaW5kaW5nOiB0aGlzLmpzQmluZGluZyxcbiAgICAgIG5vSnNCaW5kaW5nOiB0aGlzLm5vSnNCaW5kaW5nLFxuICAgICAgZHRzOiB0aGlzLmR0cyxcbiAgICAgIGR0c0hlYWRlcjogdGhpcy5kdHNIZWFkZXIsXG4gICAgICBub0R0c0hlYWRlcjogdGhpcy5ub0R0c0hlYWRlcixcbiAgICAgIGR0c0NhY2hlOiB0aGlzLmR0c0NhY2hlLFxuICAgICAgZXNtOiB0aGlzLmVzbSxcbiAgICAgIHN0cmlwOiB0aGlzLnN0cmlwLFxuICAgICAgcmVsZWFzZTogdGhpcy5yZWxlYXNlLFxuICAgICAgdmVyYm9zZTogdGhpcy52ZXJib3NlLFxuICAgICAgYmluOiB0aGlzLmJpbixcbiAgICAgIHBhY2thZ2U6IHRoaXMucGFja2FnZSxcbiAgICAgIHByb2ZpbGU6IHRoaXMucHJvZmlsZSxcbiAgICAgIGNyb3NzQ29tcGlsZTogdGhpcy5jcm9zc0NvbXBpbGUsXG4gICAgICB1c2VDcm9zczogdGhpcy51c2VDcm9zcyxcbiAgICAgIHVzZU5hcGlDcm9zczogdGhpcy51c2VOYXBpQ3Jvc3MsXG4gICAgICB3YXRjaDogdGhpcy53YXRjaCxcbiAgICAgIGZlYXR1cmVzOiB0aGlzLmZlYXR1cmVzLFxuICAgICAgYWxsRmVhdHVyZXM6IHRoaXMuYWxsRmVhdHVyZXMsXG4gICAgICBub0RlZmF1bHRGZWF0dXJlczogdGhpcy5ub0RlZmF1bHRGZWF0dXJlcyxcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgTkFQSS1SUyBwcm9qZWN0XG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQnVpbGRPcHRpb25zIHtcbiAgLyoqXG4gICAqIEJ1aWxkIGZvciB0aGUgdGFyZ2V0IHRyaXBsZSwgYnlwYXNzZWQgdG8gYGNhcmdvIGJ1aWxkIC0tdGFyZ2V0YFxuICAgKi9cbiAgdGFyZ2V0Pzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGhcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgQ2FyZ28udG9tbGBcbiAgICovXG4gIG1hbmlmZXN0UGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBEaXJlY3RvcnkgZm9yIGFsbCBjcmF0ZSBnZW5lcmF0ZWQgYXJ0aWZhY3RzLCBzZWUgYGNhcmdvIGJ1aWxkIC0tdGFyZ2V0LWRpcmBcbiAgICovXG4gIHRhcmdldERpcj86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB3aGVyZSBhbGwgdGhlIGJ1aWx0IGZpbGVzIHdvdWxkIGJlIHB1dC4gRGVmYXVsdCB0byB0aGUgY3JhdGUgZm9sZGVyXG4gICAqL1xuICBvdXRwdXREaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEFkZCBwbGF0Zm9ybSB0cmlwbGUgdG8gdGhlIGdlbmVyYXRlZCBub2RlanMgYmluZGluZyBmaWxlLCBlZzogYFtuYW1lXS5saW51eC14NjQtZ251Lm5vZGVgXG4gICAqL1xuICBwbGF0Zm9ybT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFBhY2thZ2UgbmFtZSBpbiBnZW5lcmF0ZWQganMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWdcbiAgICovXG4gIGpzUGFja2FnZU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgZ2VuZXJhdGUgY29uc3QgZW51bSBmb3IgdHlwZXNjcmlwdCBiaW5kaW5nc1xuICAgKi9cbiAgY29uc3RFbnVtPzogYm9vbGVhblxuICAvKipcbiAgICogUGF0aCBhbmQgZmlsZW5hbWUgb2YgZ2VuZXJhdGVkIEpTIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLiBSZWxhdGl2ZSB0byBgLS1vdXRwdXQtZGlyYC5cbiAgICovXG4gIGpzQmluZGluZz86IHN0cmluZ1xuICAvKipcbiAgICogV2hldGhlciB0byBkaXNhYmxlIHRoZSBnZW5lcmF0aW9uIEpTIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnLlxuICAgKi9cbiAgbm9Kc0JpbmRpbmc/OiBib29sZWFuXG4gIC8qKlxuICAgKiBQYXRoIGFuZCBmaWxlbmFtZSBvZiBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gUmVsYXRpdmUgdG8gYC0tb3V0cHV0LWRpcmBcbiAgICovXG4gIGR0cz86IHN0cmluZ1xuICAvKipcbiAgICogQ3VzdG9tIGZpbGUgaGVhZGVyIGZvciBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gT25seSB3b3JrcyB3aGVuIGB0eXBlZGVmYCBmZWF0dXJlIGVuYWJsZWQuXG4gICAqL1xuICBkdHNIZWFkZXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZGlzYWJsZSB0aGUgZGVmYXVsdCBmaWxlIGhlYWRlciBmb3IgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIE9ubHkgd29ya3Mgd2hlbiBgdHlwZWRlZmAgZmVhdHVyZSBlbmFibGVkLlxuICAgKi9cbiAgbm9EdHNIZWFkZXI/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVuYWJsZSB0aGUgZHRzIGNhY2hlLCBkZWZhdWx0IHRvIHRydWVcbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZHRzQ2FjaGU/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGVtaXQgYW4gRVNNIEpTIGJpbmRpbmcgZmlsZSBpbnN0ZWFkIG9mIENKUyBmb3JtYXQuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy5cbiAgICovXG4gIGVzbT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFdoZXRoZXIgc3RyaXAgdGhlIGxpYnJhcnkgdG8gYWNoaWV2ZSB0aGUgbWluaW11bSBmaWxlIHNpemVcbiAgICovXG4gIHN0cmlwPzogYm9vbGVhblxuICAvKipcbiAgICogQnVpbGQgaW4gcmVsZWFzZSBtb2RlXG4gICAqL1xuICByZWxlYXNlPzogYm9vbGVhblxuICAvKipcbiAgICogVmVyYm9zZWx5IGxvZyBidWlsZCBjb21tYW5kIHRyYWNlXG4gICAqL1xuICB2ZXJib3NlPzogYm9vbGVhblxuICAvKipcbiAgICogQnVpbGQgb25seSB0aGUgc3BlY2lmaWVkIGJpbmFyeVxuICAgKi9cbiAgYmluPzogc3RyaW5nXG4gIC8qKlxuICAgKiBCdWlsZCB0aGUgc3BlY2lmaWVkIGxpYnJhcnkgb3IgdGhlIG9uZSBhdCBjd2RcbiAgICovXG4gIHBhY2thZ2U/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEJ1aWxkIGFydGlmYWN0cyB3aXRoIHRoZSBzcGVjaWZpZWQgcHJvZmlsZVxuICAgKi9cbiAgcHJvZmlsZT86IHN0cmluZ1xuICAvKipcbiAgICogW2V4cGVyaW1lbnRhbF0gY3Jvc3MtY29tcGlsZSBmb3IgdGhlIHNwZWNpZmllZCB0YXJnZXQgd2l0aCBgY2FyZ28teHdpbmAgb24gd2luZG93cyBhbmQgYGNhcmdvLXppZ2J1aWxkYCBvbiBvdGhlciBwbGF0Zm9ybVxuICAgKi9cbiAgY3Jvc3NDb21waWxlPzogYm9vbGVhblxuICAvKipcbiAgICogW2V4cGVyaW1lbnRhbF0gdXNlIFtjcm9zc10oaHR0cHM6Ly9naXRodWIuY29tL2Nyb3NzLXJzL2Nyb3NzKSBpbnN0ZWFkIG9mIGBjYXJnb2BcbiAgICovXG4gIHVzZUNyb3NzPzogYm9vbGVhblxuICAvKipcbiAgICogW2V4cGVyaW1lbnRhbF0gdXNlIEBuYXBpLXJzL2Nyb3NzLXRvb2xjaGFpbiB0byBjcm9zcy1jb21waWxlIExpbnV4IGFybS9hcm02NC94NjQgZ251IHRhcmdldHMuXG4gICAqL1xuICB1c2VOYXBpQ3Jvc3M/OiBib29sZWFuXG4gIC8qKlxuICAgKiB3YXRjaCB0aGUgY3JhdGUgY2hhbmdlcyBhbmQgYnVpbGQgY29udGludW91c2x5IHdpdGggYGNhcmdvLXdhdGNoYCBjcmF0ZXNcbiAgICovXG4gIHdhdGNoPzogYm9vbGVhblxuICAvKipcbiAgICogU3BhY2Utc2VwYXJhdGVkIGxpc3Qgb2YgZmVhdHVyZXMgdG8gYWN0aXZhdGVcbiAgICovXG4gIGZlYXR1cmVzPzogc3RyaW5nW11cbiAgLyoqXG4gICAqIEFjdGl2YXRlIGFsbCBhdmFpbGFibGUgZmVhdHVyZXNcbiAgICovXG4gIGFsbEZlYXR1cmVzPzogYm9vbGVhblxuICAvKipcbiAgICogRG8gbm90IGFjdGl2YXRlIHRoZSBgZGVmYXVsdGAgZmVhdHVyZVxuICAgKi9cbiAgbm9EZWZhdWx0RmVhdHVyZXM/OiBib29sZWFuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRCdWlsZE9wdGlvbnMob3B0aW9uczogQnVpbGRPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgZHRzQ2FjaGU6IHRydWUsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdub2RlOmNoaWxkX3Byb2Nlc3MnXG5cbmltcG9ydCB7IE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuaW1wb3J0IHsgYnVpbGRQcm9qZWN0IH0gZnJvbSAnLi4vYXBpL2J1aWxkLmpzJ1xuaW1wb3J0IHsgQmFzZUJ1aWxkQ29tbWFuZCB9IGZyb20gJy4uL2RlZi9idWlsZC5qcydcbmltcG9ydCB7IGRlYnVnRmFjdG9yeSB9IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnYnVpbGQnKVxuXG5leHBvcnQgY2xhc3MgQnVpbGRDb21tYW5kIGV4dGVuZHMgQmFzZUJ1aWxkQ29tbWFuZCB7XG4gIHBpcGUgPSBPcHRpb24uU3RyaW5nKCctLXBpcGUnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGlwZSBhbGwgb3V0cHV0cyBmaWxlIHRvIGdpdmVuIGNvbW1hbmQuIGUuZy4gYG5hcGkgYnVpbGQgLS1waXBlIFwibnB4IHByZXR0aWVyIC0td3JpdGVcImAnLFxuICB9KVxuXG4gIGNhcmdvT3B0aW9ucyA9IE9wdGlvbi5SZXN0KClcblxuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGNvbnN0IHsgdGFzayB9ID0gYXdhaXQgYnVpbGRQcm9qZWN0KHtcbiAgICAgIC4uLnRoaXMuZ2V0T3B0aW9ucygpLFxuICAgICAgY2FyZ29PcHRpb25zOiB0aGlzLmNhcmdvT3B0aW9ucyxcbiAgICB9KVxuXG4gICAgY29uc3Qgb3V0cHV0cyA9IGF3YWl0IHRhc2tcblxuICAgIGlmICh0aGlzLnBpcGUpIHtcbiAgICAgIGZvciAoY29uc3Qgb3V0cHV0IG9mIG91dHB1dHMpIHtcbiAgICAgICAgZGVidWcoJ1BpcGluZyBvdXRwdXQgZmlsZSB0byBjb21tYW5kOiAlcycsIHRoaXMucGlwZSlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBleGVjU3luYyhgJHt0aGlzLnBpcGV9ICR7b3V0cHV0LnBhdGh9YCwge1xuICAgICAgICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICAgICAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICAgICAgfSlcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGRlYnVnLmVycm9yKGBGYWlsZWQgdG8gcGlwZSBvdXRwdXQgZmlsZSAke291dHB1dC5wYXRofSB0byBjb21tYW5kYClcbiAgICAgICAgICBkZWJ1Zy5lcnJvcihlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgeyBDb21tYW5kIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5pbXBvcnQgeyBDTElfVkVSU0lPTiB9IGZyb20gJy4uL3V0aWxzL21pc2MuanMnXG5cbi8qKlxuICogQSBjb21tYW5kIHRoYXQgcHJpbnRzIHRoZSB2ZXJzaW9uIG9mIHRoZSBDTEkuXG4gKlxuICogUGF0aHM6IGAtdmAsIGAtLXZlcnNpb25gXG4gKi9cbmV4cG9ydCBjbGFzcyBDbGlWZXJzaW9uQ29tbWFuZCBleHRlbmRzIENvbW1hbmQ8YW55PiB7XG4gIHN0YXRpYyBwYXRocyA9IFtbYC12YF0sIFtgLS12ZXJzaW9uYF1dXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgdGhpcy5jb250ZXh0LnN0ZG91dC53cml0ZShgJHtDTElfVkVSU0lPTn1cXG5gKVxuICB9XG59XG4iLCJpbXBvcnQgeyBjcmVhdGVOcG1EaXJzIH0gZnJvbSAnLi4vYXBpL2NyZWF0ZS1ucG0tZGlycy5qcydcbmltcG9ydCB7IEJhc2VDcmVhdGVOcG1EaXJzQ29tbWFuZCB9IGZyb20gJy4uL2RlZi9jcmVhdGUtbnBtLWRpcnMuanMnXG5cbmV4cG9ydCBjbGFzcyBDcmVhdGVOcG1EaXJzQ29tbWFuZCBleHRlbmRzIEJhc2VDcmVhdGVOcG1EaXJzQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgY3JlYXRlTnBtRGlycyh0aGlzLmdldE9wdGlvbnMoKSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gJ2NsaXBhbmlvbidcblxuLyoqXG4gKiBBIGNvbW1hbmQgdGhhdCBwcmludHMgdGhlIHVzYWdlIG9mIGFsbCBjb21tYW5kcy5cbiAqXG4gKiBQYXRoczogYC1oYCwgYC0taGVscGBcbiAqL1xuZXhwb3J0IGNsYXNzIEhlbHBDb21tYW5kIGV4dGVuZHMgQ29tbWFuZDxhbnk+IHtcbiAgc3RhdGljIHBhdGhzID0gW1tgLWhgXSwgW2AtLWhlbHBgXV1cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCB0aGlzLmNvbnRleHQuc3Rkb3V0LndyaXRlKHRoaXMuY2xpLnVzYWdlKCkpXG4gIH1cbn1cbiIsImltcG9ydCBwYXRoIGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHsgaW5wdXQsIHNlbGVjdCwgY2hlY2tib3gsIGNvbmZpcm0gfSBmcm9tICdAaW5xdWlyZXIvcHJvbXB0cydcbmltcG9ydCB7IE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuaW1wb3J0IHsgbmV3UHJvamVjdCB9IGZyb20gJy4uL2FwaS9uZXcuanMnXG5pbXBvcnQgeyBCYXNlTmV3Q29tbWFuZCB9IGZyb20gJy4uL2RlZi9uZXcuanMnXG5pbXBvcnQge1xuICBBVkFJTEFCTEVfVEFSR0VUUyxcbiAgZGVidWdGYWN0b3J5LFxuICBERUZBVUxUX1RBUkdFVFMsXG4gIHR5cGUgVGFyZ2V0VHJpcGxlLFxufSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcbmltcG9ydCB7IG5hcGlFbmdpbmVSZXF1aXJlbWVudCB9IGZyb20gJy4uL3V0aWxzL3ZlcnNpb24uanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCduZXcnKVxuXG5leHBvcnQgY2xhc3MgTmV3Q29tbWFuZCBleHRlbmRzIEJhc2VOZXdDb21tYW5kIHtcbiAgaW50ZXJhY3RpdmUgPSBPcHRpb24uQm9vbGVhbignLS1pbnRlcmFjdGl2ZSwtaScsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdBc2sgcHJvamVjdCBiYXNpYyBpbmZvcm1hdGlvbiBpbnRlcmFjdGl2ZWx5IHdpdGhvdXQganVzdCB1c2luZyB0aGUgZGVmYXVsdC4nLFxuICB9KVxuXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCB0aGlzLmZldGNoT3B0aW9ucygpXG4gICAgICBhd2FpdCBuZXdQcm9qZWN0KG9wdGlvbnMpXG4gICAgICByZXR1cm4gMFxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGRlYnVnKCdGYWlsZWQgdG8gY3JlYXRlIG5ldyBwcm9qZWN0JylcbiAgICAgIGRlYnVnLmVycm9yKGUpXG4gICAgICByZXR1cm4gMVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hPcHRpb25zKCkge1xuICAgIGNvbnN0IGNtZE9wdGlvbnMgPSBzdXBlci5nZXRPcHRpb25zKClcblxuICAgIGlmICh0aGlzLmludGVyYWN0aXZlKSB7XG4gICAgICBjb25zdCB0YXJnZXRQYXRoOiBzdHJpbmcgPSBjbWRPcHRpb25zLnBhdGhcbiAgICAgICAgPyBjbWRPcHRpb25zLnBhdGhcbiAgICAgICAgOiBhd2FpdCBpbnF1aXJlclByb2plY3RQYXRoKClcbiAgICAgIGNtZE9wdGlvbnMucGF0aCA9IHRhcmdldFBhdGhcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmNtZE9wdGlvbnMsXG4gICAgICAgIG5hbWU6IGF3YWl0IHRoaXMuZmV0Y2hOYW1lKHBhdGgucGFyc2UodGFyZ2V0UGF0aCkuYmFzZSksXG4gICAgICAgIG1pbk5vZGVBcGlWZXJzaW9uOiBhd2FpdCB0aGlzLmZldGNoTmFwaVZlcnNpb24oKSxcbiAgICAgICAgdGFyZ2V0czogYXdhaXQgdGhpcy5mZXRjaFRhcmdldHMoKSxcbiAgICAgICAgbGljZW5zZTogYXdhaXQgdGhpcy5mZXRjaExpY2Vuc2UoKSxcbiAgICAgICAgZW5hYmxlVHlwZURlZjogYXdhaXQgdGhpcy5mZXRjaFR5cGVEZWYoKSxcbiAgICAgICAgZW5hYmxlR2l0aHViQWN0aW9uczogYXdhaXQgdGhpcy5mZXRjaEdpdGh1YkFjdGlvbnMoKSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY21kT3B0aW9uc1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaE5hbWUoZGVmYXVsdE5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMuJCRuYW1lID8/XG4gICAgICBpbnB1dCh7XG4gICAgICAgIG1lc3NhZ2U6ICdQYWNrYWdlIG5hbWUgKHRoZSBuYW1lIGZpZWxkIGluIHlvdXIgcGFja2FnZS5qc29uIGZpbGUpJyxcbiAgICAgICAgZGVmYXVsdDogZGVmYXVsdE5hbWUsXG4gICAgICB9KVxuICAgIClcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hMaWNlbnNlKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIGlucHV0KHtcbiAgICAgIG1lc3NhZ2U6ICdMaWNlbnNlIGZvciBvcGVuLXNvdXJjZWQgcHJvamVjdCcsXG4gICAgICBkZWZhdWx0OiB0aGlzLmxpY2Vuc2UsXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hOYXBpVmVyc2lvbigpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIHJldHVybiBzZWxlY3Qoe1xuICAgICAgbWVzc2FnZTogJ01pbmltdW0gbm9kZS1hcGkgdmVyc2lvbiAod2l0aCBub2RlIHZlcnNpb24gcmVxdWlyZW1lbnQpJyxcbiAgICAgIGxvb3A6IGZhbHNlLFxuICAgICAgcGFnZVNpemU6IDEwLFxuICAgICAgY2hvaWNlczogQXJyYXkuZnJvbSh7IGxlbmd0aDogOCB9LCAoXywgaSkgPT4gKHtcbiAgICAgICAgbmFtZTogYG5hcGkke2kgKyAxfSAoJHtuYXBpRW5naW5lUmVxdWlyZW1lbnQoaSArIDEpfSlgLFxuICAgICAgICB2YWx1ZTogaSArIDEsXG4gICAgICB9KSksXG4gICAgICAvLyBjaG9pY2UgaW5kZXhcbiAgICAgIGRlZmF1bHQ6IHRoaXMubWluTm9kZUFwaVZlcnNpb24gLSAxLFxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoVGFyZ2V0cygpOiBQcm9taXNlPFRhcmdldFRyaXBsZVtdPiB7XG4gICAgaWYgKHRoaXMuZW5hYmxlQWxsVGFyZ2V0cykge1xuICAgICAgcmV0dXJuIEFWQUlMQUJMRV9UQVJHRVRTLmNvbmNhdCgpXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0cyA9IGF3YWl0IGNoZWNrYm94KHtcbiAgICAgIGxvb3A6IGZhbHNlLFxuICAgICAgbWVzc2FnZTogJ0Nob29zZSB0YXJnZXQocykgeW91ciBjcmF0ZSB3aWxsIGJlIGNvbXBpbGVkIHRvJyxcbiAgICAgIGNob2ljZXM6IEFWQUlMQUJMRV9UQVJHRVRTLm1hcCgodGFyZ2V0KSA9PiAoe1xuICAgICAgICBuYW1lOiB0YXJnZXQsXG4gICAgICAgIHZhbHVlOiB0YXJnZXQsXG4gICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICAgICAgY2hlY2tlZDogREVGQVVMVF9UQVJHRVRTLmluY2x1ZGVzKHRhcmdldCksXG4gICAgICB9KSksXG4gICAgfSlcblxuICAgIHJldHVybiB0YXJnZXRzXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoVHlwZURlZigpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBlbmFibGVUeXBlRGVmID0gYXdhaXQgY29uZmlybSh7XG4gICAgICBtZXNzYWdlOiAnRW5hYmxlIHR5cGUgZGVmaW5pdGlvbiBhdXRvLWdlbmVyYXRpb24nLFxuICAgICAgZGVmYXVsdDogdGhpcy5lbmFibGVUeXBlRGVmLFxuICAgIH0pXG5cbiAgICByZXR1cm4gZW5hYmxlVHlwZURlZlxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEdpdGh1YkFjdGlvbnMoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZW5hYmxlR2l0aHViQWN0aW9ucyA9IGF3YWl0IGNvbmZpcm0oe1xuICAgICAgbWVzc2FnZTogJ0VuYWJsZSBHaXRodWIgQWN0aW9ucyBDSScsXG4gICAgICBkZWZhdWx0OiB0aGlzLmVuYWJsZUdpdGh1YkFjdGlvbnMsXG4gICAgfSlcblxuICAgIHJldHVybiBlbmFibGVHaXRodWJBY3Rpb25zXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5xdWlyZXJQcm9qZWN0UGF0aCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICByZXR1cm4gaW5wdXQoe1xuICAgIG1lc3NhZ2U6ICdUYXJnZXQgcGF0aCB0byBjcmVhdGUgdGhlIHByb2plY3QsIHJlbGF0aXZlIHRvIGN3ZC4nLFxuICB9KS50aGVuKChwYXRoKSA9PiB7XG4gICAgaWYgKCFwYXRoKSB7XG4gICAgICByZXR1cm4gaW5xdWlyZXJQcm9qZWN0UGF0aCgpXG4gICAgfVxuICAgIHJldHVybiBwYXRoXG4gIH0pXG59XG4iLCJpbXBvcnQgeyBwcmVQdWJsaXNoIH0gZnJvbSAnLi4vYXBpL3ByZS1wdWJsaXNoLmpzJ1xuaW1wb3J0IHsgQmFzZVByZVB1Ymxpc2hDb21tYW5kIH0gZnJvbSAnLi4vZGVmL3ByZS1wdWJsaXNoLmpzJ1xuXG5leHBvcnQgY2xhc3MgUHJlUHVibGlzaENvbW1hbmQgZXh0ZW5kcyBCYXNlUHJlUHVibGlzaENvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIC8vIEB0cy1leHBlY3QtZXJyb3IgY29uc3QgJ25wbScgfCAnbGVybmEnIHRvIHN0cmluZ1xuICAgIGF3YWl0IHByZVB1Ymxpc2godGhpcy5nZXRPcHRpb25zKCkpXG4gIH1cbn1cbiIsImltcG9ydCB7IGlucHV0IH0gZnJvbSAnQGlucXVpcmVyL3Byb21wdHMnXG5cbmltcG9ydCB7IHJlbmFtZVByb2plY3QgfSBmcm9tICcuLi9hcGkvcmVuYW1lLmpzJ1xuaW1wb3J0IHsgQmFzZVJlbmFtZUNvbW1hbmQgfSBmcm9tICcuLi9kZWYvcmVuYW1lLmpzJ1xuXG5leHBvcnQgY2xhc3MgUmVuYW1lQ29tbWFuZCBleHRlbmRzIEJhc2VSZW5hbWVDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBpZiAoIW9wdGlvbnMubmFtZSkge1xuICAgICAgY29uc3QgbmFtZSA9IGF3YWl0IGlucHV0KHtcbiAgICAgICAgbWVzc2FnZTogYEVudGVyIHRoZSBuZXcgcGFja2FnZSBuYW1lIGluIHRoZSBwYWNrYWdlLmpzb25gLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIH0pXG4gICAgICBvcHRpb25zLm5hbWUgPSBuYW1lXG4gICAgfVxuICAgIGlmICghb3B0aW9ucy5iaW5hcnlOYW1lKSB7XG4gICAgICBjb25zdCBiaW5hcnlOYW1lID0gYXdhaXQgaW5wdXQoe1xuICAgICAgICBtZXNzYWdlOiBgRW50ZXIgdGhlIG5ldyBiaW5hcnkgbmFtZWAsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSlcbiAgICAgIG9wdGlvbnMuYmluYXJ5TmFtZSA9IGJpbmFyeU5hbWVcbiAgICB9XG4gICAgYXdhaXQgcmVuYW1lUHJvamVjdChvcHRpb25zKVxuICB9XG59XG4iLCJpbXBvcnQgeyB1bml2ZXJzYWxpemVCaW5hcmllcyB9IGZyb20gJy4uL2FwaS91bml2ZXJzYWxpemUuanMnXG5pbXBvcnQgeyBCYXNlVW5pdmVyc2FsaXplQ29tbWFuZCB9IGZyb20gJy4uL2RlZi91bml2ZXJzYWxpemUuanMnXG5cbmV4cG9ydCBjbGFzcyBVbml2ZXJzYWxpemVDb21tYW5kIGV4dGVuZHMgQmFzZVVuaXZlcnNhbGl6ZUNvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IHVuaXZlcnNhbGl6ZUJpbmFyaWVzKHRoaXMuZ2V0T3B0aW9ucygpKVxuICB9XG59XG4iLCJpbXBvcnQgeyB2ZXJzaW9uIH0gZnJvbSAnLi4vYXBpL3ZlcnNpb24uanMnXG5pbXBvcnQgeyBCYXNlVmVyc2lvbkNvbW1hbmQgfSBmcm9tICcuLi9kZWYvdmVyc2lvbi5qcydcblxuZXhwb3J0IGNsYXNzIFZlcnNpb25Db21tYW5kIGV4dGVuZHMgQmFzZVZlcnNpb25Db21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCB2ZXJzaW9uKHRoaXMuZ2V0T3B0aW9ucygpKVxuICB9XG59XG4iLCJpbXBvcnQgeyBDbGkgfSBmcm9tICdjbGlwYW5pb24nXG5cbmltcG9ydCB7IGNvbGxlY3RBcnRpZmFjdHMgfSBmcm9tICcuL2FwaS9hcnRpZmFjdHMuanMnXG5pbXBvcnQgeyBidWlsZFByb2plY3QgfSBmcm9tICcuL2FwaS9idWlsZC5qcydcbmltcG9ydCB7IGNyZWF0ZU5wbURpcnMgfSBmcm9tICcuL2FwaS9jcmVhdGUtbnBtLWRpcnMuanMnXG5pbXBvcnQgeyBuZXdQcm9qZWN0IH0gZnJvbSAnLi9hcGkvbmV3LmpzJ1xuaW1wb3J0IHsgcHJlUHVibGlzaCB9IGZyb20gJy4vYXBpL3ByZS1wdWJsaXNoLmpzJ1xuaW1wb3J0IHsgcmVuYW1lUHJvamVjdCB9IGZyb20gJy4vYXBpL3JlbmFtZS5qcydcbmltcG9ydCB7IHVuaXZlcnNhbGl6ZUJpbmFyaWVzIH0gZnJvbSAnLi9hcGkvdW5pdmVyc2FsaXplLmpzJ1xuaW1wb3J0IHsgdmVyc2lvbiB9IGZyb20gJy4vYXBpL3ZlcnNpb24uanMnXG5pbXBvcnQgeyBBcnRpZmFjdHNDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9hcnRpZmFjdHMuanMnXG5pbXBvcnQgeyBCdWlsZENvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL2J1aWxkLmpzJ1xuaW1wb3J0IHsgQ2xpVmVyc2lvbkNvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL2NsaS12ZXJzaW9uLmpzJ1xuaW1wb3J0IHsgQ3JlYXRlTnBtRGlyc0NvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL2NyZWF0ZS1ucG0tZGlycy5qcydcbmltcG9ydCB7IEhlbHBDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9oZWxwLmpzJ1xuaW1wb3J0IHsgTmV3Q29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvbmV3LmpzJ1xuaW1wb3J0IHsgUHJlUHVibGlzaENvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL3ByZS1wdWJsaXNoLmpzJ1xuaW1wb3J0IHsgUmVuYW1lQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvcmVuYW1lLmpzJ1xuaW1wb3J0IHsgVW5pdmVyc2FsaXplQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvdW5pdmVyc2FsaXplLmpzJ1xuaW1wb3J0IHsgVmVyc2lvbkNvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL3ZlcnNpb24uanMnXG5pbXBvcnQgeyBDTElfVkVSU0lPTiB9IGZyb20gJy4vdXRpbHMvbWlzYy5qcydcblxuZXhwb3J0IGNvbnN0IGNsaSA9IG5ldyBDbGkoe1xuICBiaW5hcnlOYW1lOiAnbmFwaScsXG4gIGJpbmFyeVZlcnNpb246IENMSV9WRVJTSU9OLFxufSlcblxuY2xpLnJlZ2lzdGVyKE5ld0NvbW1hbmQpXG5jbGkucmVnaXN0ZXIoQnVpbGRDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKENyZWF0ZU5wbURpcnNDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKEFydGlmYWN0c0NvbW1hbmQpXG5jbGkucmVnaXN0ZXIoVW5pdmVyc2FsaXplQ29tbWFuZClcbmNsaS5yZWdpc3RlcihSZW5hbWVDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKFByZVB1Ymxpc2hDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKFZlcnNpb25Db21tYW5kKVxuY2xpLnJlZ2lzdGVyKEhlbHBDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKENsaVZlcnNpb25Db21tYW5kKVxuXG4vKipcbiAqXG4gKiBAdXNhZ2VcbiAqXG4gKiBgYGB0c1xuICogY29uc3QgY2xpID0gbmV3IE5hcGlDbGkoKVxuICpcbiAqIGNsaS5idWlsZCh7XG4gKiAgIGN3ZDogJy9wYXRoL3RvL3lvdXIvcHJvamVjdCcsXG4gKiB9KVxuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBOYXBpQ2xpIHtcbiAgYXJ0aWZhY3RzID0gY29sbGVjdEFydGlmYWN0c1xuICBuZXcgPSBuZXdQcm9qZWN0XG4gIGJ1aWxkID0gYnVpbGRQcm9qZWN0XG4gIGNyZWF0ZU5wbURpcnMgPSBjcmVhdGVOcG1EaXJzXG4gIHByZVB1Ymxpc2ggPSBwcmVQdWJsaXNoXG4gIHJlbmFtZSA9IHJlbmFtZVByb2plY3RcbiAgdW5pdmVyc2FsaXplID0gdW5pdmVyc2FsaXplQmluYXJpZXNcbiAgdmVyc2lvbiA9IHZlcnNpb25cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUJ1aWxkQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IEJ1aWxkQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ2J1aWxkJywgLi4uYXJnc10pIGFzIEJ1aWxkQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXJ0aWZhY3RzQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IEFydGlmYWN0c0NvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWydhcnRpZmFjdHMnLCAuLi5hcmdzXSkgYXMgQXJ0aWZhY3RzQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ3JlYXRlTnBtRGlyc0NvbW1hbmQoXG4gIGFyZ3M6IHN0cmluZ1tdLFxuKTogQ3JlYXRlTnBtRGlyc0NvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWydjcmVhdGUtbnBtLWRpcnMnLCAuLi5hcmdzXSkgYXMgQ3JlYXRlTnBtRGlyc0NvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVByZVB1Ymxpc2hDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogUHJlUHVibGlzaENvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWydwcmUtcHVibGlzaCcsIC4uLmFyZ3NdKSBhcyBQcmVQdWJsaXNoQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUmVuYW1lQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IFJlbmFtZUNvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWydyZW5hbWUnLCAuLi5hcmdzXSkgYXMgUmVuYW1lQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVW5pdmVyc2FsaXplQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IFVuaXZlcnNhbGl6ZUNvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWyd1bml2ZXJzYWxpemUnLCAuLi5hcmdzXSkgYXMgVW5pdmVyc2FsaXplQ29tbWFuZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlVmVyc2lvbkNvbW1hbmQoYXJnczogc3RyaW5nW10pOiBWZXJzaW9uQ29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ3ZlcnNpb24nLCAuLi5hcmdzXSkgYXMgVmVyc2lvbkNvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZU5ld0NvbW1hbmQoYXJnczogc3RyaW5nW10pOiBOZXdDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsnbmV3JywgLi4uYXJnc10pIGFzIE5ld0NvbW1hbmRcbn1cblxuZXhwb3J0IHsgcGFyc2VUcmlwbGUgfSBmcm9tICcuL3V0aWxzL3RhcmdldC5qcydcbmV4cG9ydCB7XG4gIHR5cGUgR2VuZXJhdGVUeXBlRGVmT3B0aW9ucyxcbiAgdHlwZSBXcml0ZUpzQmluZGluZ09wdGlvbnMsXG4gIHdyaXRlSnNCaW5kaW5nLFxuICBnZW5lcmF0ZVR5cGVEZWYsXG59IGZyb20gJy4vYXBpL2J1aWxkLmpzJ1xuZXhwb3J0IHsgcmVhZE5hcGlDb25maWcgfSBmcm9tICcuL3V0aWxzL2NvbmZpZy5qcydcbiJdLCJ4X2dvb2dsZV9pZ25vcmVMaXN0IjpbMTksMjAsMjEsMjIsMjMsMjQsMjVdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBSUEsSUFBc0IsdUJBQXRCLGNBQW1ELFFBQVE7Q0FDekQsT0FBTyxRQUFRLENBQUMsQ0FBQyxZQUFZLENBQUM7Q0FFOUIsT0FBTyxRQUFRLFFBQVEsTUFBTSxFQUMzQixhQUNFLDZFQUNILENBQUM7Q0FFRixNQUFNLE9BQU8sT0FBTyxTQUFTLFFBQVEsS0FBSyxFQUFFLEVBQzFDLGFBQ0Usc0hBQ0gsQ0FBQztDQUVGLGFBQXNCLE9BQU8sT0FBTyxvQkFBb0IsRUFDdEQsYUFBYSxtQ0FDZCxDQUFDO0NBRUYsa0JBQWtCLE9BQU8sT0FBTyx1QkFBdUIsZ0JBQWdCLEVBQ3JFLGFBQWEsMEJBQ2QsQ0FBQztDQUVGLFlBQVksT0FBTyxPQUFPLHNCQUFzQixlQUFlLEVBQzdELGFBQ0UsaUdBQ0gsQ0FBQztDQUVGLFNBQVMsT0FBTyxPQUFPLGFBQWEsT0FBTyxFQUN6QyxhQUFhLGlEQUNkLENBQUM7Q0FFRixpQkFBMEIsT0FBTyxPQUFPLHNCQUFzQixFQUM1RCxhQUNFLG1GQUNILENBQUM7Q0FFRixhQUFhO0FBQ1gsU0FBTztHQUNMLEtBQUssS0FBSztHQUNWLFlBQVksS0FBSztHQUNqQixpQkFBaUIsS0FBSztHQUN0QixXQUFXLEtBQUs7R0FDaEIsUUFBUSxLQUFLO0dBQ2IsZ0JBQWdCLEtBQUs7R0FDdEI7OztBQTBDTCxTQUFnQiw2QkFBNkIsU0FBMkI7QUFDdEUsUUFBTztFQUNMLEtBQUssUUFBUSxLQUFLO0VBQ2xCLGlCQUFpQjtFQUNqQixXQUFXO0VBQ1gsUUFBUTtFQUNSLEdBQUc7RUFDSjs7OztBQ3JGSCxNQUFhLGdCQUFnQixjQUFzQjtDQUNqRCxNQUFNLFFBQVEsWUFBWSxRQUFRLGFBQWEsRUFDN0MsWUFBWSxFQUVWLEVBQUUsR0FBRztBQUNILFNB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