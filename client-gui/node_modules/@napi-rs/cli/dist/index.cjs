Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let clipanion = require("clipanion");
let node_path = require("node:path");
node_path = __toESM(node_path);
let colorette = require("colorette");
colorette = __toESM(colorette);
let obug = require("obug");
let node_fs_promises = require("node:fs/promises");
let node_child_process = require("node:child_process");
let node_fs = require("node:fs");
node_fs = __toESM(node_fs);
let es_toolkit = require("es-toolkit");
let node_crypto = require("node:crypto");
let node_module = require("node:module");
let node_os = require("node:os");
let semver = require("semver");
let js_yaml = require("js-yaml");
let typanion = require("typanion");
typanion = __toESM(typanion);
let _octokit_rest = require("@octokit/rest");
let _inquirer_prompts = require("@inquirer/prompts");
//#region src/def/artifacts.ts
var BaseArtifactsCommand = class extends clipanion.Command {
	static paths = [["artifacts"]];
	static usage = clipanion.Command.Usage({ description: "Copy artifacts from Github Actions into npm packages and ready to publish" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	outputDir = clipanion.Option.String("--output-dir,-o,-d", "./artifacts", { description: "Path to the folder where all built `.node` files put, same as `--output-dir` of build command" });
	npmDir = clipanion.Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	buildOutputDir = clipanion.Option.String("--build-output-dir", { description: "Path to the build output dir, only needed when targets contains `wasm32-wasi-*`" });
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
	const debug = (0, obug.createDebug)(`napi:${namespace}`, { formatters: { i(v) {
		return colorette.green(v);
	} } });
	debug.info = (...args) => console.error(colorette.black(colorette.bgGreen(" INFO ")), ...args);
	debug.warn = (...args) => console.error(colorette.black(colorette.bgYellow(" WARNING ")), ...args);
	debug.error = (...args) => console.error(colorette.white(colorette.bgRed(" ERROR ")), ...args.map((arg) => arg instanceof Error ? arg.stack ?? arg.message : arg));
	return debug;
};
const debug$9 = debugFactory("utils");
//#endregion
//#region package.json
var version$1 = "3.6.0";
//#endregion
//#region src/utils/misc.ts
const readFileAsync = node_fs_promises.readFile;
const writeFileAsync = node_fs_promises.writeFile;
const unlinkAsync = node_fs_promises.unlink;
const copyFileAsync = node_fs_promises.copyFile;
const mkdirAsync = node_fs_promises.mkdir;
const statAsync = node_fs_promises.stat;
const readdirAsync = node_fs_promises.readdir;
function fileExists(path) {
	return (0, node_fs_promises.access)(path).then(() => true, () => false);
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
	const host = (0, node_child_process.execSync)(`rustc -vV`, { env: process.env }).toString("utf8").split("\n").find((line) => line.startsWith("host: "));
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
	if (!node_fs.default.existsSync(manifestPath)) throw new Error(`No crate found in manifest: ${manifestPath}`);
	const childProcess = (0, node_child_process.spawn)("cargo", [
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
		const pkgJsonPath = (0, colorette.underline)(path);
		const configPathUnderline = (0, colorette.underline)(configPath);
		console.warn((0, colorette.yellow)(`Both napi field in ${pkgJsonPath} and [NAPI-RS config](${configPathUnderline}) file are found, the NAPI-RS config file will be used.`));
	}
	if (separatedConfig) Object.assign(userNapiConfig, separatedConfig);
	const napiConfig = (0, es_toolkit.merge)({
		binaryName: "index",
		packageName: pkgJson.name,
		targets: [],
		packageJson: pkgJson,
		npmClient: "npm"
	}, (0, es_toolkit.omit)(userNapiConfig, ["targets"]));
	let targets = userNapiConfig.targets ?? [];
	if (userNapiConfig === null || userNapiConfig === void 0 ? void 0 : userNapiConfig.name) {
		console.warn((0, colorette.yellow)(`[DEPRECATED] napi.name is deprecated, use napi.binaryName instead.`));
		napiConfig.binaryName = userNapiConfig.name;
	}
	if (!targets.length) {
		var _userNapiConfig$tripl, _userNapiConfig$tripl2;
		let deprecatedWarned = false;
		const warning = (0, colorette.yellow)(`[DEPRECATED] napi.triples is deprecated, use napi.targets instead.`);
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
		(0, node_child_process.execSync)(`cargo install ${name}`, { stdio: "inherit" });
	} catch (e) {
		throw new Error(`Failed to install cargo binary: ${name}`, { cause: e });
	}
}
function detectCargoBinary(bin) {
	debug$9("Detecting cargo binary: %s", bin);
	try {
		(0, node_child_process.execSync)(`cargo help ${bin}`, { stdio: "ignore" });
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
		dts: (0, es_toolkit.sortBy)(Array.from(groupedDefs), [([namespace]) => namespace]).map(([namespace, defs]) => {
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
	const resolvePath = (...paths) => (0, node_path.resolve)(options.cwd, ...paths);
	return await readNapiConfig(resolvePath(options.packageJsonPath ?? "package.json"), options.configPath ? resolvePath(options.configPath) : void 0);
}
//#endregion
//#region src/api/artifacts.ts
const debug$8 = debugFactory("artifacts");
async function collectArtifacts(userOptions) {
	const options = applyDefaultArtifactsOptions(userOptions);
	const resolvePath = (...paths) => (0, node_path.resolve)(options.cwd, ...paths);
	const packageJsonPath = resolvePath(options.packageJsonPath);
	const { targets, binaryName, packageName } = await readNapiConfig(packageJsonPath, options.configPath ? resolvePath(options.configPath) : void 0);
	const distDirs = targets.map((platform) => (0, node_path.join)(options.cwd, options.npmDir, platform.platformArchABI));
	const universalSourceBins = new Set(targets.filter((platform) => platform.arch === "universal").flatMap((p) => {
		var _UniArchsByPlatform$p;
		return (_UniArchsByPlatform$p = UniArchsByPlatform[p.platform]) === null || _UniArchsByPlatform$p === void 0 ? void 0 : _UniArchsByPlatform$p.map((a) => `${p.platform}-${a}`);
	}).filter(Boolean));
	await collectNodeBinaries((0, node_path.join)(options.cwd, options.outputDir)).then((output) => Promise.all(output.map(async (filePath) => {
		debug$8.info(`Read [${colorette.yellowBright(filePath)}]`);
		const sourceContent = await readFileAsync(filePath);
		const parsedName = (0, node_path.parse)(filePath);
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
		const distFilePath = (0, node_path.join)(dir, parsedName.base);
		debug$8.info(`Write file content to [${colorette.yellowBright(distFilePath)}]`);
		await writeFileAsync(distFilePath, sourceContent);
		const distFilePathLocal = (0, node_path.join)((0, node_path.parse)(packageJsonPath).dir, parsedName.base);
		debug$8.info(`Write file content to [${colorette.yellowBright(distFilePathLocal)}]`);
		await writeFileAsync(distFilePathLocal, sourceContent);
	})));
	const wasiTarget = targets.find((t) => t.platform === "wasi");
	if (wasiTarget) {
		const wasiDir = (0, node_path.join)(options.cwd, options.npmDir, wasiTarget.platformArchABI);
		const cjsFile = (0, node_path.join)(options.buildOutputDir ?? options.cwd, `${binaryName}.wasi.cjs`);
		const workerFile = (0, node_path.join)(options.buildOutputDir ?? options.cwd, `wasi-worker.mjs`);
		const browserEntry = (0, node_path.join)(options.buildOutputDir ?? options.cwd, `${binaryName}.wasi-browser.js`);
		const browserWorkerFile = (0, node_path.join)(options.buildOutputDir ?? options.cwd, `wasi-worker-browser.mjs`);
		debug$8.info(`Move wasi binding file [${colorette.yellowBright(cjsFile)}] to [${colorette.yellowBright(wasiDir)}]`);
		await writeFileAsync((0, node_path.join)(wasiDir, `${binaryName}.wasi.cjs`), await readFileAsync(cjsFile));
		debug$8.info(`Move wasi worker file [${colorette.yellowBright(workerFile)}] to [${colorette.yellowBright(wasiDir)}]`);
		await writeFileAsync((0, node_path.join)(wasiDir, `wasi-worker.mjs`), await readFileAsync(workerFile));
		debug$8.info(`Move wasi browser entry file [${colorette.yellowBright(browserEntry)}] to [${colorette.yellowBright(wasiDir)}]`);
		await writeFileAsync((0, node_path.join)(wasiDir, `${binaryName}.wasi-browser.js`), (await readFileAsync(browserEntry, "utf8")).replace(`new URL('./wasi-worker-browser.mjs', import.meta.url)`, `new URL('${packageName}-wasm32-wasi/wasi-worker-browser.mjs', import.meta.url)`));
		debug$8.info(`Move wasi browser worker file [${colorette.yellowBright(browserWorkerFile)}] to [${colorette.yellowBright(wasiDir)}]`);
		await writeFileAsync((0, node_path.join)(wasiDir, `wasi-worker-browser.mjs`), await readFileAsync(browserWorkerFile));
	}
}
async function collectNodeBinaries(root) {
	const files = await readdirAsync(root, { withFileTypes: true });
	const nodeBinaries = files.filter((file) => file.isFile() && (file.name.endsWith(".node") || file.name.endsWith(".wasm"))).map((file) => (0, node_path.join)(root, file.name));
	const dirs = files.filter((file) => file.isDirectory());
	for (const dir of dirs) if (dir.name !== "node_modules") nodeBinaries.push(...await collectNodeBinaries((0, node_path.join)(root, dir.name)));
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
const require$2 = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href);
async function buildProject(rawOptions) {
	debug$7("napi build command receive options: %O", rawOptions);
	const options = {
		dtsCache: true,
		...rawOptions,
		cwd: rawOptions.cwd ?? process.cwd()
	};
	const resolvePath = (...paths) => (0, node_path.resolve)(options.cwd, ...paths);
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
		this.crateDir = (0, node_path.parse)(crate.manifest_path).dir;
		this.outputDir = (0, node_path.resolve)(this.options.cwd, options.outputDir ?? this.crateDir);
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
			const { version, download } = require$2("@napi-rs/cross-toolchain");
			const alias = { "s390x-unknown-linux-gnu": "s390x-ibm-linux-gnu" };
			const toolchainPath = (0, node_path.join)((0, node_os.homedir)(), ".napi-rs", "cross-toolchain", version, this.target.triple);
			(0, node_fs.mkdirSync)(toolchainPath, { recursive: true });
			if ((0, node_fs.existsSync)((0, node_path.join)(toolchainPath, "package.json"))) debug$7(`Toolchain ${toolchainPath} exists, skip extracting`);
			else download(process.arch, this.target.triple).unpack(toolchainPath);
			const upperCaseTarget = targetToEnvVar(this.target.triple);
			const crossTargetName = alias[this.target.triple] ?? this.target.triple;
			const linkerEnv = `CARGO_TARGET_${upperCaseTarget}_LINKER`;
			this.setEnvIfNotExists(linkerEnv, (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-gcc`));
			this.setEnvIfNotExists("TARGET_SYSROOT", (0, node_path.join)(toolchainPath, crossTargetName, "sysroot"));
			this.setEnvIfNotExists("TARGET_AR", (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-ar`));
			this.setEnvIfNotExists("TARGET_RANLIB", (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-ranlib`));
			this.setEnvIfNotExists("TARGET_READELF", (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-readelf`));
			this.setEnvIfNotExists("TARGET_C_INCLUDE_PATH", (0, node_path.join)(toolchainPath, crossTargetName, "sysroot", "usr", "include/"));
			this.setEnvIfNotExists("TARGET_CC", (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-gcc`));
			this.setEnvIfNotExists("TARGET_CXX", (0, node_path.join)(toolchainPath, "bin", `${crossTargetName}-g++`));
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
				const buildProcess = (0, node_child_process.spawn)(process.env.CARGO ?? (this.options.useCross ? "cross" : "cargo"), this.args, {
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
			if (crate.dependencies.some((d) => d.name === "napi-derive") && !(0, node_fs.existsSync)((0, node_path.join)(typeDefTmpFolder, crate.name))) this.envs[`NAPI_FORCE_BUILD_${crate.name.replace(/-/g, "_").toUpperCase()}`] = Date.now().toString();
		});
	}
	setAndroidEnv() {
		const { ANDROID_NDK_LATEST_HOME } = process.env;
		if (!ANDROID_NDK_LATEST_HOME) debug$7.warn(`${colorette.red("ANDROID_NDK_LATEST_HOME")} environment variable is missing`);
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
		const emnapi = (0, node_path.join)(require$2.resolve("emnapi"), "..", "lib", "wasm32-wasi-threads");
		this.envs.EMNAPI_LINK_DIR = emnapi;
		const emnapiVersion = require$2("emnapi/package.json").version;
		const projectRequire = (0, node_module.createRequire)((0, node_path.join)(this.options.cwd, "package.json"));
		const emnapiCoreVersion = projectRequire("@emnapi/core").version;
		const emnapiRuntimeVersion = projectRequire("@emnapi/runtime").version;
		if (emnapiVersion !== emnapiCoreVersion || emnapiVersion !== emnapiRuntimeVersion) throw new Error(`emnapi version mismatch: emnapi@${emnapiVersion}, @emnapi/core@${emnapiCoreVersion}, @emnapi/runtime@${emnapiRuntimeVersion}. Please ensure all emnapi packages are the same version.`);
		const { WASI_SDK_PATH } = process.env;
		if (WASI_SDK_PATH && (0, node_fs.existsSync)(WASI_SDK_PATH)) {
			this.envs.CARGO_TARGET_WASM32_WASI_PREVIEW1_THREADS_LINKER = (0, node_path.join)(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP1_LINKER = (0, node_path.join)(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP1_THREADS_LINKER = (0, node_path.join)(WASI_SDK_PATH, "bin", "wasm-ld");
			this.envs.CARGO_TARGET_WASM32_WASIP2_LINKER = (0, node_path.join)(WASI_SDK_PATH, "bin", "wasm-ld");
			this.setEnvIfNotExists("TARGET_CC", (0, node_path.join)(WASI_SDK_PATH, "bin", "clang"));
			this.setEnvIfNotExists("TARGET_CXX", (0, node_path.join)(WASI_SDK_PATH, "bin", "clang++"));
			this.setEnvIfNotExists("TARGET_AR", (0, node_path.join)(WASI_SDK_PATH, "bin", "ar"));
			this.setEnvIfNotExists("TARGET_RANLIB", (0, node_path.join)(WASI_SDK_PATH, "bin", "ranlib"));
			this.setEnvIfNotExists("TARGET_CFLAGS", `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`);
			this.setEnvIfNotExists("TARGET_CXXFLAGS", `--target=wasm32-wasi-threads --sysroot=${WASI_SDK_PATH}/share/wasi-sysroot -pthread -mllvm -wasm-enable-sjlj`);
			this.setEnvIfNotExists(`TARGET_LDFLAGS`, `-fuse-ld=${WASI_SDK_PATH}/bin/wasm-ld --target=wasm32-wasi-threads`);
		}
	}
	setOpenHarmonyEnv() {
		const { OHOS_SDK_PATH, OHOS_SDK_NATIVE } = process.env;
		const ndkPath = OHOS_SDK_PATH ? `${OHOS_SDK_PATH}/native` : OHOS_SDK_NATIVE;
		if (!ndkPath && process.platform !== "openharmony") {
			debug$7.warn(`${colorette.red("OHOS_SDK_PATH")} or ${colorette.red("OHOS_SDK_NATIVE")} environment variable is missing`);
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
		let folder = (0, node_path.join)(this.targetDir, "napi-rs", `${this.crate.name}-${(0, node_crypto.createHash)("sha256").update(this.crate.manifest_path).update(CLI_VERSION).digest("hex").substring(0, 8)}`);
		if (!this.options.dtsCache) {
			(0, node_fs.rmSync)(folder, {
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
		const src = (0, node_path.join)(this.targetDir, this.target.triple, profile, srcName);
		debug$7(`Copy artifact from: [${src}]`);
		const dest = (0, node_path.join)(this.outputDir, destName);
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
			return wasmBinaryName ? (0, node_path.join)(this.outputDir, wasmBinaryName) : null;
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
		const dest = (0, node_path.join)(this.outputDir, this.options.dts ?? "index.d.ts");
		try {
			debug$7("Writing type def to:");
			debug$7("  %i", dest);
			await writeFileAsync(dest, dts, "utf-8");
		} catch (e) {
			debug$7.error("Failed to write type def file");
			debug$7.error(e);
		}
		if (exports.length > 0) {
			const dest = (0, node_path.join)(this.outputDir, this.options.dts ?? "index.d.ts");
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
			const { name, dir } = (0, node_path.parse)(distFileName);
			const bindingPath = (0, node_path.join)(dir, `${this.config.binaryName}.wasi.cjs`);
			const browserBindingPath = (0, node_path.join)(dir, `${this.config.binaryName}.wasi-browser.js`);
			const workerPath = (0, node_path.join)(dir, "wasi-worker.mjs");
			const browserWorkerPath = (0, node_path.join)(dir, "wasi-worker-browser.mjs");
			const browserEntryPath = (0, node_path.join)(dir, "browser.js");
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
		const dest = (0, node_path.join)(options.outputDir, name);
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
			header = await readFileAsync((0, node_path.join)(options.cwd, options.configDtsHeaderFile), "utf-8");
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
		const { dts: fileDts, exports: fileExports } = await processTypeDef((0, node_path.join)(options.typeDefDir, file.name), options.constEnum ?? true);
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
var BaseCreateNpmDirsCommand = class extends clipanion.Command {
	static paths = [["create-npm-dirs"]];
	static usage = clipanion.Command.Usage({ description: "Create npm package dirs for different platforms" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = clipanion.Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	dryRun = clipanion.Option.Boolean("--dry-run", false, { description: "Dry run without touching file system" });
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
const require$1 = (0, node_module.createRequire)(require("url").pathToFileURL(__filename).href);
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
	const packageJsonPath = (0, node_path.resolve)(options.cwd, options.packageJsonPath);
	const npmPath = (0, node_path.resolve)(options.cwd, options.npmDir);
	debug$6(`Read content from [${options.configPath ?? packageJsonPath}]`);
	const { targets, binaryName, packageName, packageJson } = await readNapiConfig(packageJsonPath, options.configPath ? (0, node_path.resolve)(options.cwd, options.configPath) : void 0);
	for (const target of targets) {
		const targetDir = (0, node_path.join)(npmPath, `${target.platformArchABI}`);
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
				const { major } = (0, semver.parse)(scopedPackageJson.engines.node) ?? { major: 0 };
				if (major >= 14) needRestrictNodeVersion = false;
			} catch {}
			if (needRestrictNodeVersion) scopedPackageJson.engines = { node: ">=14.0.0" };
			const emnapiVersion = require$1("emnapi/package.json").version;
			const wasmRuntime = await fetch(`https://registry.npmjs.org/@napi-rs/wasm-runtime`).then((res) => res.json());
			scopedPackageJson.dependencies = {
				"@napi-rs/wasm-runtime": `^${wasmRuntime["dist-tags"].latest}`,
				"@emnapi/core": emnapiVersion,
				"@emnapi/runtime": emnapiVersion
			};
		}
		if (target.abi === "gnu") scopedPackageJson.libc = ["glibc"];
		else if (target.abi === "musl") scopedPackageJson.libc = ["musl"];
		await writeFileAsync$1((0, node_path.join)(targetDir, "package.json"), JSON.stringify(scopedPackageJson, null, 2) + "\n");
		await writeFileAsync$1((0, node_path.join)(targetDir, "README.md"), readme(packageName, target));
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
var BaseNewCommand = class extends clipanion.Command {
	static paths = [["new"]];
	static usage = clipanion.Command.Usage({ description: "Create a new project with pre-configured boilerplate" });
	$$path = clipanion.Option.String({ required: false });
	$$name = clipanion.Option.String("--name,-n", { description: "The name of the project, default to the name of the directory if not provided" });
	minNodeApiVersion = clipanion.Option.String("--min-node-api,-v", "4", {
		validator: typanion.isNumber(),
		description: "The minimum Node-API version to support"
	});
	packageManager = clipanion.Option.String("--package-manager", "yarn", { description: "The package manager to use. Only support yarn 4.x for now." });
	license = clipanion.Option.String("--license,-l", "MIT", { description: "License for open-sourced project" });
	targets = clipanion.Option.Array("--targets,-t", [], { description: "All targets the crate will be compiled for." });
	enableDefaultTargets = clipanion.Option.Boolean("--enable-default-targets", true, { description: "Whether enable default targets" });
	enableAllTargets = clipanion.Option.Boolean("--enable-all-targets", false, { description: "Whether enable all targets" });
	enableTypeDef = clipanion.Option.Boolean("--enable-type-def", true, { description: "Whether enable the `type-def` feature for typescript definitions auto-generation" });
	enableGithubActions = clipanion.Option.Boolean("--enable-github-actions", true, { description: "Whether generate preconfigured GitHub Actions workflow" });
	testFramework = clipanion.Option.String("--test-framework", "ava", { description: "The JavaScript test framework to use, only support `ava` for now" });
	dryRun = clipanion.Option.Boolean("--dry-run", false, { description: "Whether to run the command in dry-run mode" });
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
*/ function join$6(parser, separator) {
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
	const pairs = surround("{", join$6(pair, ","), "}")(scanner);
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
*/ function parse(tomlString) {
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
	return (0, node_path.isAbsolute)(input) ? input : (0, node_path.resolve)(root || ".", input);
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
		tmp = (0, node_path.dirname)(prev = tmp);
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
		tmp = (0, node_path.join)(dir, name);
		if ((0, node_fs.statSync)(tmp).isDirectory()) return tmp;
	} catch {}
}
//#endregion
//#region src/def/rename.ts
var BaseRenameCommand = class extends clipanion.Command {
	static paths = [["rename"]];
	static usage = clipanion.Command.Usage({ description: "Rename the NAPI-RS project" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = clipanion.Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
	$$name = clipanion.Option.String("--name,-n", { description: "The new name of the project" });
	binaryName = clipanion.Option.String("--binary-name,-b", { description: "The new binary name *.node files" });
	packageName = clipanion.Option.String("--package-name", { description: "The new package name of the project" });
	manifestPath = clipanion.Option.String("--manifest-path", "Cargo.toml", { description: "Path to `Cargo.toml`" });
	repository = clipanion.Option.String("--repository", { description: "The new repository of the project" });
	description = clipanion.Option.String("--description", { description: "The new description of the project" });
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
	const packageJsonPath = (0, node_path.resolve)(options.cwd, options.packageJsonPath);
	const cargoTomlPath = (0, node_path.resolve)(options.cwd, options.manifestPath);
	const packageJsonContent = await readFileAsync(packageJsonPath, "utf8");
	const packageJsonData = JSON.parse(packageJsonContent);
	(0, es_toolkit.merge)((0, es_toolkit.merge)(packageJsonData, (0, es_toolkit.omitBy)((0, es_toolkit.pick)(options, [
		"name",
		"description",
		"author",
		"license"
	]), es_toolkit.isNil)), { napi: (0, es_toolkit.omitBy)({
		binaryName: options.binaryName,
		packageName: options.packageName
	}, es_toolkit.isNil) });
	if (options.configPath) {
		const configPath = (0, node_path.resolve)(options.cwd, options.configPath);
		const configContent = await readFileAsync(configPath, "utf8");
		const configData = JSON.parse(configContent);
		configData.binaryName = options.binaryName;
		configData.packageName = options.packageName;
		await writeFileAsync(configPath, JSON.stringify(configData, null, 2));
	}
	await writeFileAsync(packageJsonPath, JSON.stringify(packageJsonData, null, 2));
	const cargoToml = parse(await readFileAsync(cargoTomlPath, "utf8"));
	if (cargoToml.package && options.binaryName) {
		const sanitizedName = options.binaryName.replace("@", "").replace("/", "_").replace(/-/g, "_").toLowerCase();
		cargoToml.package.name = sanitizedName;
	}
	await writeFileAsync(cargoTomlPath, stringify(cargoToml));
	if (oldName !== options.binaryName) {
		const githubActionsPath = dir(".github", { cwd: options.cwd });
		if (githubActionsPath) {
			const githubActionsCIYmlPath = (0, node_path.join)(githubActionsPath, "workflows", "CI.yml");
			if ((0, node_fs.existsSync)(githubActionsCIYmlPath)) {
				var _githubActionsData$en;
				const githubActionsData = (0, js_yaml.load)(await readFileAsync(githubActionsCIYmlPath, "utf8"));
				if ((_githubActionsData$en = githubActionsData.env) === null || _githubActionsData$en === void 0 ? void 0 : _githubActionsData$en.APP_NAME) {
					githubActionsData.env.APP_NAME = options.binaryName;
					await writeFileAsync(githubActionsCIYmlPath, (0, js_yaml.dump)(githubActionsData, {
						lineWidth: -1,
						noRefs: true,
						sortKeys: false
					}));
				}
			}
		}
		const oldWasiBrowserBindingPath = (0, node_path.join)(options.cwd, `${oldName}.wasi-browser.js`);
		if ((0, node_fs.existsSync)(oldWasiBrowserBindingPath)) await (0, node_fs_promises.rename)(oldWasiBrowserBindingPath, (0, node_path.join)(options.cwd, `${options.binaryName}.wasi-browser.js`));
		const oldWasiBindingPath = (0, node_path.join)(options.cwd, `${oldName}.wasi.cjs`);
		if ((0, node_fs.existsSync)(oldWasiBindingPath)) await (0, node_fs_promises.rename)(oldWasiBindingPath, (0, node_path.join)(options.cwd, `${options.binaryName}.wasi.cjs`));
		const gitAttributesPath = (0, node_path.join)(options.cwd, ".gitattributes");
		if ((0, node_fs.existsSync)(gitAttributesPath)) await writeFileAsync(gitAttributesPath, (await readFileAsync(gitAttributesPath, "utf8")).split("\n").map((line) => {
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
			const cp = (0, node_child_process.exec)("git --version");
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
	const cacheDir = node_path.default.join((0, node_os.homedir)(), ".napi-rs", "template", packageManager);
	await mkdirAsync(cacheDir, { recursive: true });
	return cacheDir;
}
async function downloadTemplate(packageManager, cacheDir) {
	const repoUrl = TEMPLATE_REPOS[packageManager];
	const templatePath = node_path.default.join(cacheDir, "repo");
	if ((0, node_fs.existsSync)(templatePath)) {
		debug$5(`Template cache found at ${templatePath}, updating...`);
		try {
			await new Promise((resolve, reject) => {
				const cp = (0, node_child_process.exec)("git fetch origin", { cwd: templatePath });
				cp.on("error", reject);
				cp.on("exit", (code) => {
					if (code === 0) resolve();
					else reject(/* @__PURE__ */ new Error(`Failed to fetch latest changes, git process exited with code ${code}`));
				});
			});
			(0, node_child_process.execSync)("git reset --hard origin/main", {
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
			(0, node_child_process.execSync)(`git clone ${repoUrl} repo`, {
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
	const entries = await node_fs.promises.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = node_path.default.join(src, entry.name);
		const destPath = node_path.default.join(dest, entry.name);
		if (entry.name === ".git") continue;
		if (entry.isDirectory()) await copyDirectory(srcPath, destPath, includeWasiBindings);
		else {
			if (!includeWasiBindings && (entry.name.endsWith(".wasi-browser.js") || entry.name.endsWith(".wasi.cjs") || entry.name.endsWith("wasi-worker.browser.mjs ") || entry.name.endsWith("wasi-worker.mjs") || entry.name.endsWith("browser.js"))) continue;
			await node_fs.promises.copyFile(srcPath, destPath);
		}
	}
}
async function filterTargetsInPackageJson(filePath, enabledTargets) {
	var _packageJson$napi;
	const content = await node_fs.promises.readFile(filePath, "utf-8");
	const packageJson = JSON.parse(content);
	if ((_packageJson$napi = packageJson.napi) === null || _packageJson$napi === void 0 ? void 0 : _packageJson$napi.targets) packageJson.napi.targets = packageJson.napi.targets.filter((target) => enabledTargets.includes(target));
	await node_fs.promises.writeFile(filePath, JSON.stringify(packageJson, null, 2) + "\n");
}
async function filterTargetsInGithubActions(filePath, enabledTargets) {
	var _yaml$jobs, _yaml$jobs5;
	const yaml = (0, js_yaml.load)(await node_fs.promises.readFile(filePath, "utf-8"));
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
	const updatedYaml = (0, js_yaml.dump)(yaml, {
		lineWidth: -1,
		noRefs: true,
		sortKeys: false
	});
	await node_fs.promises.writeFile(filePath, updatedYaml);
}
function processOptions(options) {
	var _options$targets;
	debug$5("Processing options...");
	if (!options.path) throw new Error("Please provide the path as the argument");
	options.path = node_path.default.resolve(process.cwd(), options.path);
	debug$5(`Resolved target path to: ${options.path}`);
	if (!options.name) {
		options.name = node_path.default.parse(options.path).base;
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
		if ((0, node_child_process.execSync)(`rustup target list`, { encoding: "utf8" }).includes("wasm32-wasip1-threads")) options.targets = options.targets.map((target) => target === "wasm32-wasi-preview1-threads" ? "wasm32-wasip1-threads" : target);
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
		await copyDirectory(node_path.default.join(cacheDir, "repo"), options.path, options.targets.includes("wasm32-wasip1-threads"));
		await renameProject({
			cwd: options.path,
			name: options.name,
			binaryName: getBinaryName(options.name)
		});
		const packageJsonPath = node_path.default.join(options.path, "package.json");
		if ((0, node_fs.existsSync)(packageJsonPath)) await filterTargetsInPackageJson(packageJsonPath, options.targets);
		const ciPath = node_path.default.join(options.path, ".github", "workflows", "CI.yml");
		if ((0, node_fs.existsSync)(ciPath) && options.enableGithubActions) await filterTargetsInGithubActions(ciPath, options.targets);
		else if (!options.enableGithubActions && (0, node_fs.existsSync)(node_path.default.join(options.path, ".github"))) await node_fs.promises.rm(node_path.default.join(options.path, ".github"), {
			recursive: true,
			force: true
		});
		const pkgJsonContent = await node_fs.promises.readFile(packageJsonPath, "utf-8");
		const pkgJson = JSON.parse(pkgJsonContent);
		if (!pkgJson.engines) pkgJson.engines = {};
		pkgJson.engines.node = napiEngineRequirement(options.minNodeApiVersion);
		if (options.license && pkgJson.license !== options.license) pkgJson.license = options.license;
		if (options.testFramework !== "ava") debug$5(`Test framework ${options.testFramework} requested but not yet implemented`);
		await node_fs.promises.writeFile(packageJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
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
var BasePrePublishCommand = class extends clipanion.Command {
	static paths = [["pre-publish"], ["prepublish"]];
	static usage = clipanion.Command.Usage({ description: "Update package.json and copy addons into per platform packages" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = clipanion.Option.String("--npm-dir,-p", "npm", { description: "Path to the folder where the npm packages put" });
	tagStyle = clipanion.Option.String("--tag-style,--tagstyle,-t", "lerna", { description: "git tag style, `npm` or `lerna`" });
	ghRelease = clipanion.Option.Boolean("--gh-release", true, { description: "Whether create GitHub release" });
	ghReleaseName = clipanion.Option.String("--gh-release-name", { description: "GitHub release name" });
	ghReleaseId = clipanion.Option.String("--gh-release-id", { description: "Existing GitHub release id" });
	skipOptionalPublish = clipanion.Option.Boolean("--skip-optional-publish", false, { description: "Whether skip optionalDependencies packages publish" });
	dryRun = clipanion.Option.Boolean("--dry-run", false, { description: "Dry run without touching file system" });
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
var BaseVersionCommand = class extends clipanion.Command {
	static paths = [["version"]];
	static usage = clipanion.Command.Usage({ description: "Update version in created npm packages" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	npmDir = clipanion.Option.String("--npm-dir", "npm", { description: "Path to the folder where the npm packages put" });
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
	const config = await readNapiConfig((0, node_path.resolve)(options.cwd, options.packageJsonPath), options.configPath ? (0, node_path.resolve)(options.cwd, options.configPath) : void 0);
	for (const target of config.targets) {
		const pkgDir = (0, node_path.resolve)(options.cwd, options.npmDir, target.platformArchABI);
		debug$4(`Update version to %i in [%i]`, config.packageJson.version, pkgDir);
		await updatePackageJson((0, node_path.join)(pkgDir, "package.json"), { version: config.packageJson.version });
	}
}
//#endregion
//#region src/api/pre-publish.ts
const debug$3 = debugFactory("pre-publish");
async function prePublish(userOptions) {
	debug$3("Receive pre-publish options:");
	debug$3("  %O", userOptions);
	const options = applyDefaultPrePublishOptions(userOptions);
	const packageJsonPath = (0, node_path.resolve)(options.cwd, options.packageJsonPath);
	const { packageJson, targets, packageName, binaryName, npmClient } = await readNapiConfig(packageJsonPath, options.configPath ? (0, node_path.resolve)(options.cwd, options.configPath) : void 0);
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
		const headCommit = (0, node_child_process.execSync)("git log -1 --pretty=%B", { encoding: "utf-8" }).trim();
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
		const octokit = new _octokit_rest.Octokit({ auth: process.env.GITHUB_TOKEN });
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
		const pkgDir = (0, node_path.resolve)(options.cwd, options.npmDir, `${target.platformArchABI}`);
		const ext = target.platform === "wasi" || target.platform === "wasm" ? "wasm" : "node";
		const filename = `${binaryName}.${target.platformArchABI}.${ext}`;
		const dstPath = (0, node_path.join)(pkgDir, filename);
		if (!options.dryRun) {
			if (!(0, node_fs.existsSync)(dstPath)) {
				debug$3.warn(`%s doesn't exist`, dstPath);
				continue;
			}
			if (!options.skipOptionalPublish) try {
				const output = (0, node_child_process.execSync)(`${npmClient} publish`, {
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
					const dstFileStats = (0, node_fs.statSync)(dstPath);
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
var BaseUniversalizeCommand = class extends clipanion.Command {
	static paths = [["universalize"]];
	static usage = clipanion.Command.Usage({ description: "Combile built binaries into one universal binary" });
	cwd = clipanion.Option.String("--cwd", process.cwd(), { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", "package.json", { description: "Path to `package.json`" });
	outputDir = clipanion.Option.String("--output-dir,-o", "./", { description: "Path to the folder where all built `.node` files put, same as `--output-dir` of build command" });
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
	(0, node_child_process.spawnSync)("lipo", [
		"-create",
		"-output",
		output,
		...inputs
	], { stdio: "inherit" });
} };
async function universalizeBinaries(userOptions) {
	var _UniArchsByPlatform$p, _universalizers$proce;
	const options = applyDefaultUniversalizeOptions(userOptions);
	const config = await readNapiConfig((0, node_path.join)(options.cwd, options.packageJsonPath), options.configPath ? (0, node_path.resolve)(options.cwd, options.configPath) : void 0);
	if (!config.targets.find((t) => t.platform === process.platform && t.arch === "universal")) throw new Error(`'universal' arch for platform '${process.platform}' not found in config!`);
	const srcFiles = (_UniArchsByPlatform$p = UniArchsByPlatform[process.platform]) === null || _UniArchsByPlatform$p === void 0 ? void 0 : _UniArchsByPlatform$p.map((arch) => (0, node_path.resolve)(options.cwd, options.outputDir, `${config.binaryName}.${process.platform}-${arch}.node`));
	if (!srcFiles || !universalizers[process.platform]) throw new Error(`'universal' arch for platform '${process.platform}' not supported.`);
	debug$2(`Looking up source binaries to combine: `);
	debug$2("  %O", srcFiles);
	const srcFileLookup = await Promise.all(srcFiles.map((f) => fileExists(f)));
	const notFoundFiles = srcFiles.filter((_, i) => !srcFileLookup[i]);
	if (notFoundFiles.length) throw new Error(`Some binary files were not found: ${JSON.stringify(notFoundFiles)}`);
	const output = (0, node_path.resolve)(options.cwd, options.outputDir, `${config.binaryName}.${process.platform}-universal.node`);
	(_universalizers$proce = universalizers[process.platform]) === null || _universalizers$proce === void 0 || _universalizers$proce.call(universalizers, srcFiles, output);
	debug$2(`Produced universal binary: ${output}`);
}
//#endregion
//#region src/commands/artifacts.ts
var ArtifactsCommand = class extends BaseArtifactsCommand {
	static usage = clipanion.Command.Usage({
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
var BaseBuildCommand = class extends clipanion.Command {
	static paths = [["build"]];
	static usage = clipanion.Command.Usage({ description: "Build the NAPI-RS project" });
	target = clipanion.Option.String("--target,-t", { description: "Build for the target triple, bypassed to `cargo build --target`" });
	cwd = clipanion.Option.String("--cwd", { description: "The working directory of where napi command will be executed in, all other paths options are relative to this path" });
	manifestPath = clipanion.Option.String("--manifest-path", { description: "Path to `Cargo.toml`" });
	configPath = clipanion.Option.String("--config-path,-c", { description: "Path to `napi` config json file" });
	packageJsonPath = clipanion.Option.String("--package-json-path", { description: "Path to `package.json`" });
	targetDir = clipanion.Option.String("--target-dir", { description: "Directory for all crate generated artifacts, see `cargo build --target-dir`" });
	outputDir = clipanion.Option.String("--output-dir,-o", { description: "Path to where all the built files would be put. Default to the crate folder" });
	platform = clipanion.Option.Boolean("--platform", { description: "Add platform triple to the generated nodejs binding file, eg: `[name].linux-x64-gnu.node`" });
	jsPackageName = clipanion.Option.String("--js-package-name", { description: "Package name in generated js binding file. Only works with `--platform` flag" });
	constEnum = clipanion.Option.Boolean("--const-enum", { description: "Whether generate const enum for typescript bindings" });
	jsBinding = clipanion.Option.String("--js", { description: "Path and filename of generated JS binding file. Only works with `--platform` flag. Relative to `--output-dir`." });
	noJsBinding = clipanion.Option.Boolean("--no-js", { description: "Whether to disable the generation JS binding file. Only works with `--platform` flag." });
	dts = clipanion.Option.String("--dts", { description: "Path and filename of generated type def file. Relative to `--output-dir`" });
	dtsHeader = clipanion.Option.String("--dts-header", { description: "Custom file header for generated type def file. Only works when `typedef` feature enabled." });
	noDtsHeader = clipanion.Option.Boolean("--no-dts-header", { description: "Whether to disable the default file header for generated type def file. Only works when `typedef` feature enabled." });
	dtsCache = clipanion.Option.Boolean("--dts-cache", true, { description: "Whether to enable the dts cache, default to true" });
	esm = clipanion.Option.Boolean("--esm", { description: "Whether to emit an ESM JS binding file instead of CJS format. Only works with `--platform` flag." });
	strip = clipanion.Option.Boolean("--strip,-s", { description: "Whether strip the library to achieve the minimum file size" });
	release = clipanion.Option.Boolean("--release,-r", { description: "Build in release mode" });
	verbose = clipanion.Option.Boolean("--verbose,-v", { description: "Verbosely log build command trace" });
	bin = clipanion.Option.String("--bin", { description: "Build only the specified binary" });
	package = clipanion.Option.String("--package,-p", { description: "Build the specified library or the one at cwd" });
	profile = clipanion.Option.String("--profile", { description: "Build artifacts with the specified profile" });
	crossCompile = clipanion.Option.Boolean("--cross-compile,-x", { description: "[experimental] cross-compile for the specified target with `cargo-xwin` on windows and `cargo-zigbuild` on other platform" });
	useCross = clipanion.Option.Boolean("--use-cross", { description: "[experimental] use [cross](https://github.com/cross-rs/cross) instead of `cargo`" });
	useNapiCross = clipanion.Option.Boolean("--use-napi-cross", { description: "[experimental] use @napi-rs/cross-toolchain to cross-compile Linux arm/arm64/x64 gnu targets." });
	watch = clipanion.Option.Boolean("--watch,-w", { description: "watch the crate changes and build continuously with `cargo-watch` crates" });
	features = clipanion.Option.Array("--features,-F", { description: "Space-separated list of features to activate" });
	allFeatures = clipanion.Option.Boolean("--all-features", { description: "Activate all available features" });
	noDefaultFeatures = clipanion.Option.Boolean("--no-default-features", { description: "Do not activate the `default` feature" });
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
	pipe = clipanion.Option.String("--pipe", { description: "Pipe all outputs file to given command. e.g. `napi build --pipe \"npx prettier --write\"`" });
	cargoOptions = clipanion.Option.Rest();
	async execute() {
		const { task } = await buildProject({
			...this.getOptions(),
			cargoOptions: this.cargoOptions
		});
		const outputs = await task;
		if (this.pipe) for (const output of outputs) {
			debug$1("Piping output file to command: %s", this.pipe);
			try {
				(0, node_child_process.execSync)(`${this.pipe} ${output.path}`, {
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
var CliVersionCommand = class extends clipanion.Command {
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
var HelpCommand = class extends clipanion.Command {
	static paths = [[`-h`], [`--help`]];
	async execute() {
		await this.context.stdout.write(this.cli.usage());
	}
};
//#endregion
//#region src/commands/new.ts
const debug = debugFactory("new");
var NewCommand = class extends BaseNewCommand {
	interactive = clipanion.Option.Boolean("--interactive,-i", true, { description: "Ask project basic information interactively without just using the default." });
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
				name: await this.fetchName(node_path.default.parse(targetPath).base),
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
		return this.$$name ?? (0, _inquirer_prompts.input)({
			message: "Package name (the name field in your package.json file)",
			default: defaultName
		});
	}
	async fetchLicense() {
		return (0, _inquirer_prompts.input)({
			message: "License for open-sourced project",
			default: this.license
		});
	}
	async fetchNapiVersion() {
		return (0, _inquirer_prompts.select)({
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
		return await (0, _inquirer_prompts.checkbox)({
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
		return await (0, _inquirer_prompts.confirm)({
			message: "Enable type definition auto-generation",
			default: this.enableTypeDef
		});
	}
	async fetchGithubActions() {
		return await (0, _inquirer_prompts.confirm)({
			message: "Enable Github Actions CI",
			default: this.enableGithubActions
		});
	}
};
async function inquirerProjectPath() {
	return (0, _inquirer_prompts.input)({ message: "Target path to create the project, relative to cwd." }).then((path) => {
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
		if (!options.name) options.name = await (0, _inquirer_prompts.input)({
			message: `Enter the new package name in the package.json`,
			required: true
		});
		if (!options.binaryName) options.binaryName = await (0, _inquirer_prompts.input)({
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
const cli = new clipanion.Cli({
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
exports.NapiCli = NapiCli;
exports.cli = cli;
exports.createArtifactsCommand = createArtifactsCommand;
exports.createBuildCommand = createBuildCommand;
exports.createCreateNpmDirsCommand = createCreateNpmDirsCommand;
exports.createNewCommand = createNewCommand;
exports.createPrePublishCommand = createPrePublishCommand;
exports.createRenameCommand = createRenameCommand;
exports.createUniversalizeCommand = createUniversalizeCommand;
exports.createVersionCommand = createVersionCommand;
exports.generateTypeDef = generateTypeDef;
exports.parseTriple = parseTriple;
exports.readNapiConfig = readNapiConfig;
exports.writeJsBinding = writeJsBinding;

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguY2pzIiwibmFtZXMiOlsiQ29tbWFuZCIsIk9wdGlvbiIsImNvbG9ycyIsImRlYnVnIiwicmVhZEZpbGUiLCJ3cml0ZUZpbGUiLCJ1bmxpbmsiLCJjb3B5RmlsZSIsIm1rZGlyIiwic3RhdCIsInJlYWRkaXIiLCJwaWNrIiwicGtnSnNvbi52ZXJzaW9uIiwiZnMiLCJkZWJ1ZyIsImNvbG9ycyIsImRlYnVnIiwicmVxdWlyZSIsImNvbG9ycyIsIkNvbW1hbmQiLCJPcHRpb24iLCJyZXF1aXJlIiwiZGVidWciLCJta2RpckFzeW5jIiwicmF3TWtkaXJBc3luYyIsIndyaXRlRmlsZUFzeW5jIiwicmF3V3JpdGVGaWxlQXN5bmMiLCJwaWNrIiwiQ29tbWFuZCIsIk9wdGlvbiIsIiNwcmludE9iamVjdCIsIiNmb3JtYXQiLCIjaXNTaW1wbHlTZXJpYWxpemFibGUiLCIjZGF0ZURlY2xhcmF0aW9uIiwiI3N0ckRlY2xhcmF0aW9uIiwiI251bWJlckRlY2xhcmF0aW9uIiwiI2Jvb2xEZWNsYXJhdGlvbiIsIiNnZXRUeXBlT2ZBcnJheSIsIiNhcnJheURlY2xhcmF0aW9uIiwiI2hlYWRlckdyb3VwIiwiI3ByaW50QXNJbmxpbmVWYWx1ZSIsIiNkZWNsYXJhdGlvbiIsIiNoZWFkZXIiLCIjYXJyYXlUeXBlQ2FjaGUiLCIjZG9HZXRUeXBlT2ZBcnJheSIsIiNpc1ByaW1pdGl2ZSIsIiNwcmludERhdGUiLCIjc291cmNlIiwiI3Bvc2l0aW9uIiwiI3doaXRlc3BhY2UiLCJqb2luIiwibWVyZ2UiLCJ3YWxrLnVwIiwiQ29tbWFuZCIsIk9wdGlvbiIsImlzTmlsIiwicGFyc2VUb21sIiwic3RyaW5naWZ5VG9tbCIsImZpbmQuZGlyIiwiZGVidWciLCJwYXRoIiwiZnMiLCJDb21tYW5kIiwiT3B0aW9uIiwiQ29tbWFuZCIsIk9wdGlvbiIsImRlYnVnIiwiZGVidWciLCJPY3Rva2l0IiwiQ29tbWFuZCIsIk9wdGlvbiIsImRlYnVnIiwiQ29tbWFuZCIsIkNvbW1hbmQiLCJPcHRpb24iLCJkZWJ1ZyIsIk9wdGlvbiIsIkNvbW1hbmQiLCJDb21tYW5kIiwiT3B0aW9uIiwicGF0aCIsIkNsaSJdLCJzb3VyY2VzIjpbIi4uL3NyYy9kZWYvYXJ0aWZhY3RzLnRzIiwiLi4vc3JjL3V0aWxzL2xvZy50cyIsIi4uL3BhY2thZ2UuanNvbiIsIi4uL3NyYy91dGlscy9taXNjLnRzIiwiLi4vc3JjL3V0aWxzL3RhcmdldC50cyIsIi4uL3NyYy91dGlscy92ZXJzaW9uLnRzIiwiLi4vc3JjL3V0aWxzL21ldGFkYXRhLnRzIiwiLi4vc3JjL3V0aWxzL2NvbmZpZy50cyIsIi4uL3NyYy91dGlscy9jYXJnby50cyIsIi4uL3NyYy91dGlscy90eXBlZ2VuLnRzIiwiLi4vc3JjL3V0aWxzL3JlYWQtY29uZmlnLnRzIiwiLi4vc3JjL2FwaS9hcnRpZmFjdHMudHMiLCIuLi9zcmMvYXBpL3RlbXBsYXRlcy9qcy1iaW5kaW5nLnRzIiwiLi4vc3JjL2FwaS90ZW1wbGF0ZXMvbG9hZC13YXNpLXRlbXBsYXRlLnRzIiwiLi4vc3JjL2FwaS90ZW1wbGF0ZXMvd2FzaS13b3JrZXItdGVtcGxhdGUudHMiLCIuLi9zcmMvYXBpL2J1aWxkLnRzIiwiLi4vc3JjL2RlZi9jcmVhdGUtbnBtLWRpcnMudHMiLCIuLi9zcmMvYXBpL2NyZWF0ZS1ucG0tZGlycy50cyIsIi4uL3NyYy9kZWYvbmV3LnRzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL0BzdGQvdG9tbC9zdHJpbmdpZnkuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQGpzci9zdGRfX2NvbGxlY3Rpb25zL2RlZXBfbWVyZ2UuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHN0ZC90b21sL19wYXJzZXIuanMiLCIuLi8uLi9ub2RlX21vZHVsZXMvQHN0ZC90b21sL3BhcnNlLmpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL3Jlc29sdmUubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL3dhbGsubWpzIiwiLi4vLi4vbm9kZV9tb2R1bGVzL2VtcGF0aGljL2ZpbmQubWpzIiwiLi4vc3JjL2RlZi9yZW5hbWUudHMiLCIuLi9zcmMvYXBpL3JlbmFtZS50cyIsIi4uL3NyYy9hcGkvbmV3LnRzIiwiLi4vc3JjL2RlZi9wcmUtcHVibGlzaC50cyIsIi4uL3NyYy9kZWYvdmVyc2lvbi50cyIsIi4uL3NyYy9hcGkvdmVyc2lvbi50cyIsIi4uL3NyYy9hcGkvcHJlLXB1Ymxpc2gudHMiLCIuLi9zcmMvZGVmL3VuaXZlcnNhbGl6ZS50cyIsIi4uL3NyYy9hcGkvdW5pdmVyc2FsaXplLnRzIiwiLi4vc3JjL2NvbW1hbmRzL2FydGlmYWN0cy50cyIsIi4uL3NyYy9kZWYvYnVpbGQudHMiLCIuLi9zcmMvY29tbWFuZHMvYnVpbGQudHMiLCIuLi9zcmMvY29tbWFuZHMvY2xpLXZlcnNpb24udHMiLCIuLi9zcmMvY29tbWFuZHMvY3JlYXRlLW5wbS1kaXJzLnRzIiwiLi4vc3JjL2NvbW1hbmRzL2hlbHAudHMiLCIuLi9zcmMvY29tbWFuZHMvbmV3LnRzIiwiLi4vc3JjL2NvbW1hbmRzL3ByZS1wdWJsaXNoLnRzIiwiLi4vc3JjL2NvbW1hbmRzL3JlbmFtZS50cyIsIi4uL3NyYy9jb21tYW5kcy91bml2ZXJzYWxpemUudHMiLCIuLi9zcmMvY29tbWFuZHMvdmVyc2lvbi50cyIsIi4uL3NyYy9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUFydGlmYWN0c0NvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1snYXJ0aWZhY3RzJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQ29weSBhcnRpZmFjdHMgZnJvbSBHaXRodWIgQWN0aW9ucyBpbnRvIG5wbSBwYWNrYWdlcyBhbmQgcmVhZHkgdG8gcHVibGlzaCcsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgb3V0cHV0RGlyID0gT3B0aW9uLlN0cmluZygnLS1vdXRwdXQtZGlyLC1vLC1kJywgJy4vYXJ0aWZhY3RzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSBhbGwgYnVpbHQgYC5ub2RlYCBmaWxlcyBwdXQsIHNhbWUgYXMgYC0tb3V0cHV0LWRpcmAgb2YgYnVpbGQgY29tbWFuZCcsXG4gIH0pXG5cbiAgbnBtRGlyID0gT3B0aW9uLlN0cmluZygnLS1ucG0tZGlyJywgJ25wbScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dCcsXG4gIH0pXG5cbiAgYnVpbGRPdXRwdXREaXI/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWJ1aWxkLW91dHB1dC1kaXInLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCB0byB0aGUgYnVpbGQgb3V0cHV0IGRpciwgb25seSBuZWVkZWQgd2hlbiB0YXJnZXRzIGNvbnRhaW5zIGB3YXNtMzItd2FzaS0qYCcsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBvdXRwdXREaXI6IHRoaXMub3V0cHV0RGlyLFxuICAgICAgbnBtRGlyOiB0aGlzLm5wbURpcixcbiAgICAgIGJ1aWxkT3V0cHV0RGlyOiB0aGlzLmJ1aWxkT3V0cHV0RGlyLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENvcHkgYXJ0aWZhY3RzIGZyb20gR2l0aHViIEFjdGlvbnMgaW50byBucG0gcGFja2FnZXMgYW5kIHJlYWR5IHRvIHB1Ymxpc2hcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBcnRpZmFjdHNPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIGFsbCBidWlsdCBgLm5vZGVgIGZpbGVzIHB1dCwgc2FtZSBhcyBgLS1vdXRwdXQtZGlyYCBvZiBidWlsZCBjb21tYW5kXG4gICAqXG4gICAqIEBkZWZhdWx0ICcuL2FydGlmYWN0cydcbiAgICovXG4gIG91dHB1dERpcj86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0XG4gICAqXG4gICAqIEBkZWZhdWx0ICducG0nXG4gICAqL1xuICBucG1EaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gdGhlIGJ1aWxkIG91dHB1dCBkaXIsIG9ubHkgbmVlZGVkIHdoZW4gdGFyZ2V0cyBjb250YWlucyBgd2FzbTMyLXdhc2ktKmBcbiAgICovXG4gIGJ1aWxkT3V0cHV0RGlyPzogc3RyaW5nXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRBcnRpZmFjdHNPcHRpb25zKG9wdGlvbnM6IEFydGlmYWN0c09wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBvdXRwdXREaXI6ICcuL2FydGlmYWN0cycsXG4gICAgbnBtRGlyOiAnbnBtJyxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgKiBhcyBjb2xvcnMgZnJvbSAnY29sb3JldHRlJ1xuaW1wb3J0IHsgY3JlYXRlRGVidWcgfSBmcm9tICdvYnVnJ1xuXG5kZWNsYXJlIG1vZHVsZSAnb2J1Zycge1xuICBpbnRlcmZhY2UgRGVidWdnZXIge1xuICAgIGluZm86IHR5cGVvZiBjb25zb2xlLmVycm9yXG4gICAgd2FybjogdHlwZW9mIGNvbnNvbGUuZXJyb3JcbiAgICBlcnJvcjogdHlwZW9mIGNvbnNvbGUuZXJyb3JcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgZGVidWdGYWN0b3J5ID0gKG5hbWVzcGFjZTogc3RyaW5nKSA9PiB7XG4gIGNvbnN0IGRlYnVnID0gY3JlYXRlRGVidWcoYG5hcGk6JHtuYW1lc3BhY2V9YCwge1xuICAgIGZvcm1hdHRlcnM6IHtcbiAgICAgIC8vIGRlYnVnKCclaScsICdUaGlzIGlzIGFuIGluZm8nKVxuICAgICAgaSh2KSB7XG4gICAgICAgIHJldHVybiBjb2xvcnMuZ3JlZW4odilcbiAgICAgIH0sXG4gICAgfSxcbiAgfSlcblxuICBkZWJ1Zy5pbmZvID0gKC4uLmFyZ3M6IGFueVtdKSA9PlxuICAgIGNvbnNvbGUuZXJyb3IoY29sb3JzLmJsYWNrKGNvbG9ycy5iZ0dyZWVuKCcgSU5GTyAnKSksIC4uLmFyZ3MpXG4gIGRlYnVnLndhcm4gPSAoLi4uYXJnczogYW55W10pID0+XG4gICAgY29uc29sZS5lcnJvcihjb2xvcnMuYmxhY2soY29sb3JzLmJnWWVsbG93KCcgV0FSTklORyAnKSksIC4uLmFyZ3MpXG4gIGRlYnVnLmVycm9yID0gKC4uLmFyZ3M6IGFueVtdKSA9PlxuICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICBjb2xvcnMud2hpdGUoY29sb3JzLmJnUmVkKCcgRVJST1IgJykpLFxuICAgICAgLi4uYXJncy5tYXAoKGFyZykgPT5cbiAgICAgICAgYXJnIGluc3RhbmNlb2YgRXJyb3IgPyAoYXJnLnN0YWNrID8/IGFyZy5tZXNzYWdlKSA6IGFyZyxcbiAgICAgICksXG4gICAgKVxuXG4gIHJldHVybiBkZWJ1Z1xufVxuZXhwb3J0IGNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCd1dGlscycpXG4iLCIiLCJpbXBvcnQge1xuICByZWFkRmlsZSxcbiAgd3JpdGVGaWxlLFxuICB1bmxpbmssXG4gIGNvcHlGaWxlLFxuICBta2RpcixcbiAgc3RhdCxcbiAgcmVhZGRpcixcbiAgYWNjZXNzLFxufSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuXG5pbXBvcnQgcGtnSnNvbiBmcm9tICcuLi8uLi9wYWNrYWdlLmpzb24nIHdpdGggeyB0eXBlOiAnanNvbicgfVxuaW1wb3J0IHsgZGVidWcgfSBmcm9tICcuL2xvZy5qcydcblxuZXhwb3J0IGNvbnN0IHJlYWRGaWxlQXN5bmMgPSByZWFkRmlsZVxuZXhwb3J0IGNvbnN0IHdyaXRlRmlsZUFzeW5jID0gd3JpdGVGaWxlXG5leHBvcnQgY29uc3QgdW5saW5rQXN5bmMgPSB1bmxpbmtcbmV4cG9ydCBjb25zdCBjb3B5RmlsZUFzeW5jID0gY29weUZpbGVcbmV4cG9ydCBjb25zdCBta2RpckFzeW5jID0gbWtkaXJcbmV4cG9ydCBjb25zdCBzdGF0QXN5bmMgPSBzdGF0XG5leHBvcnQgY29uc3QgcmVhZGRpckFzeW5jID0gcmVhZGRpclxuXG5leHBvcnQgZnVuY3Rpb24gZmlsZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgcmV0dXJuIGFjY2VzcyhwYXRoKS50aGVuKFxuICAgICgpID0+IHRydWUsXG4gICAgKCkgPT4gZmFsc2UsXG4gIClcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRpckV4aXN0c0FzeW5jKHBhdGg6IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgc3RhdEFzeW5jKHBhdGgpXG4gICAgcmV0dXJuIHN0YXRzLmlzRGlyZWN0b3J5KClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBpY2s8TywgSyBleHRlbmRzIGtleW9mIE8+KG86IE8sIC4uLmtleXM6IEtbXSk6IFBpY2s8TywgSz4ge1xuICByZXR1cm4ga2V5cy5yZWR1Y2UoKGFjYywga2V5KSA9PiB7XG4gICAgYWNjW2tleV0gPSBvW2tleV1cbiAgICByZXR1cm4gYWNjXG4gIH0sIHt9IGFzIE8pXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cGRhdGVQYWNrYWdlSnNvbihcbiAgcGF0aDogc3RyaW5nLFxuICBwYXJ0aWFsOiBSZWNvcmQ8c3RyaW5nLCBhbnk+LFxuKSB7XG4gIGNvbnN0IGV4aXN0cyA9IGF3YWl0IGZpbGVFeGlzdHMocGF0aClcbiAgaWYgKCFleGlzdHMpIHtcbiAgICBkZWJ1ZyhgRmlsZSBub3QgZXhpc3RzICR7cGF0aH1gKVxuICAgIHJldHVyblxuICB9XG4gIGNvbnN0IG9sZCA9IEpTT04ucGFyc2UoYXdhaXQgcmVhZEZpbGVBc3luYyhwYXRoLCAndXRmOCcpKVxuICBhd2FpdCB3cml0ZUZpbGVBc3luYyhwYXRoLCBKU09OLnN0cmluZ2lmeSh7IC4uLm9sZCwgLi4ucGFydGlhbCB9LCBudWxsLCAyKSlcbn1cblxuZXhwb3J0IGNvbnN0IENMSV9WRVJTSU9OID0gcGtnSnNvbi52ZXJzaW9uXG4iLCJpbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcblxuZXhwb3J0IHR5cGUgUGxhdGZvcm0gPSBOb2RlSlMuUGxhdGZvcm0gfCAnd2FzbScgfCAnd2FzaScgfCAnb3Blbmhhcm1vbnknXG5cbmV4cG9ydCBjb25zdCBVTklWRVJTQUxfVEFSR0VUUyA9IHtcbiAgJ3VuaXZlcnNhbC1hcHBsZS1kYXJ3aW4nOiBbJ2FhcmNoNjQtYXBwbGUtZGFyd2luJywgJ3g4Nl82NC1hcHBsZS1kYXJ3aW4nXSxcbn0gYXMgY29uc3RcblxuY29uc3QgU1VCX1NZU1RFTVMgPSBuZXcgU2V0KFsnYW5kcm9pZCcsICdvaG9zJ10pXG5cbmV4cG9ydCBjb25zdCBBVkFJTEFCTEVfVEFSR0VUUyA9IFtcbiAgJ2FhcmNoNjQtYXBwbGUtZGFyd2luJyxcbiAgJ2FhcmNoNjQtbGludXgtYW5kcm9pZCcsXG4gICdhYXJjaDY0LXVua25vd24tbGludXgtZ251JyxcbiAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1tdXNsJyxcbiAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1vaG9zJyxcbiAgJ2FhcmNoNjQtcGMtd2luZG93cy1tc3ZjJyxcbiAgJ3g4Nl82NC1hcHBsZS1kYXJ3aW4nLFxuICAneDg2XzY0LXBjLXdpbmRvd3MtbXN2YycsXG4gICd4ODZfNjQtcGMtd2luZG93cy1nbnUnLFxuICAneDg2XzY0LXVua25vd24tbGludXgtZ251JyxcbiAgJ3g4Nl82NC11bmtub3duLWxpbnV4LW11c2wnLFxuICAneDg2XzY0LXVua25vd24tbGludXgtb2hvcycsXG4gICd4ODZfNjQtdW5rbm93bi1mcmVlYnNkJyxcbiAgJ2k2ODYtcGMtd2luZG93cy1tc3ZjJyxcbiAgJ2FybXY3LXVua25vd24tbGludXgtZ251ZWFiaWhmJyxcbiAgJ2FybXY3LXVua25vd24tbGludXgtbXVzbGVhYmloZicsXG4gICdhcm12Ny1saW51eC1hbmRyb2lkZWFiaScsXG4gICd1bml2ZXJzYWwtYXBwbGUtZGFyd2luJyxcbiAgJ2xvb25nYXJjaDY0LXVua25vd24tbGludXgtZ251JyxcbiAgJ3Jpc2N2NjRnYy11bmtub3duLWxpbnV4LWdudScsXG4gICdwb3dlcnBjNjRsZS11bmtub3duLWxpbnV4LWdudScsXG4gICdzMzkweC11bmtub3duLWxpbnV4LWdudScsXG4gICd3YXNtMzItd2FzaS1wcmV2aWV3MS10aHJlYWRzJyxcbiAgJ3dhc20zMi13YXNpcDEtdGhyZWFkcycsXG5dIGFzIGNvbnN0XG5cbmV4cG9ydCB0eXBlIFRhcmdldFRyaXBsZSA9ICh0eXBlb2YgQVZBSUxBQkxFX1RBUkdFVFMpW251bWJlcl1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfVEFSR0VUUyA9IFtcbiAgJ3g4Nl82NC1hcHBsZS1kYXJ3aW4nLFxuICAnYWFyY2g2NC1hcHBsZS1kYXJ3aW4nLFxuICAneDg2XzY0LXBjLXdpbmRvd3MtbXN2YycsXG4gICd4ODZfNjQtdW5rbm93bi1saW51eC1nbnUnLFxuXSBhcyBjb25zdFxuXG5leHBvcnQgY29uc3QgVEFSR0VUX0xJTktFUjogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgJ2FhcmNoNjQtdW5rbm93bi1saW51eC1tdXNsJzogJ2FhcmNoNjQtbGludXgtbXVzbC1nY2MnLFxuICAvLyBUT0RPOiBTd2l0Y2ggdG8gbG9vbmdhcmNoNjQtbGludXgtZ251LWdjYyB3aGVuIGF2YWlsYWJsZVxuICAnbG9vbmdhcmNoNjQtdW5rbm93bi1saW51eC1nbnUnOiAnbG9vbmdhcmNoNjQtbGludXgtZ251LWdjYy0xMycsXG4gICdyaXNjdjY0Z2MtdW5rbm93bi1saW51eC1nbnUnOiAncmlzY3Y2NC1saW51eC1nbnUtZ2NjJyxcbiAgJ3Bvd2VycGM2NGxlLXVua25vd24tbGludXgtZ251JzogJ3Bvd2VycGM2NGxlLWxpbnV4LWdudS1nY2MnLFxuICAnczM5MHgtdW5rbm93bi1saW51eC1nbnUnOiAnczM5MHgtbGludXgtZ251LWdjYycsXG59XG5cbi8vIGh0dHBzOi8vbm9kZWpzLm9yZy9hcGkvcHJvY2Vzcy5odG1sI3Byb2Nlc3NfcHJvY2Vzc19hcmNoXG50eXBlIE5vZGVKU0FyY2ggPVxuICB8ICdhcm0nXG4gIHwgJ2FybTY0J1xuICB8ICdpYTMyJ1xuICB8ICdsb29uZzY0J1xuICB8ICdtaXBzJ1xuICB8ICdtaXBzZWwnXG4gIHwgJ3BwYydcbiAgfCAncHBjNjQnXG4gIHwgJ3Jpc2N2NjQnXG4gIHwgJ3MzOTAnXG4gIHwgJ3MzOTB4J1xuICB8ICd4MzInXG4gIHwgJ3g2NCdcbiAgfCAndW5pdmVyc2FsJ1xuICB8ICd3YXNtMzInXG5cbmNvbnN0IENwdVRvTm9kZUFyY2g6IFJlY29yZDxzdHJpbmcsIE5vZGVKU0FyY2g+ID0ge1xuICB4ODZfNjQ6ICd4NjQnLFxuICBhYXJjaDY0OiAnYXJtNjQnLFxuICBpNjg2OiAnaWEzMicsXG4gIGFybXY3OiAnYXJtJyxcbiAgbG9vbmdhcmNoNjQ6ICdsb29uZzY0JyxcbiAgcmlzY3Y2NGdjOiAncmlzY3Y2NCcsXG4gIHBvd2VycGM2NGxlOiAncHBjNjQnLFxufVxuXG5leHBvcnQgY29uc3QgTm9kZUFyY2hUb0NwdTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgeDY0OiAneDg2XzY0JyxcbiAgYXJtNjQ6ICdhYXJjaDY0JyxcbiAgaWEzMjogJ2k2ODYnLFxuICBhcm06ICdhcm12NycsXG4gIGxvb25nNjQ6ICdsb29uZ2FyY2g2NCcsXG4gIHJpc2N2NjQ6ICdyaXNjdjY0Z2MnLFxuICBwcGM2NDogJ3Bvd2VycGM2NGxlJyxcbn1cblxuY29uc3QgU3lzVG9Ob2RlUGxhdGZvcm06IFJlY29yZDxzdHJpbmcsIFBsYXRmb3JtPiA9IHtcbiAgbGludXg6ICdsaW51eCcsXG4gIGZyZWVic2Q6ICdmcmVlYnNkJyxcbiAgZGFyd2luOiAnZGFyd2luJyxcbiAgd2luZG93czogJ3dpbjMyJyxcbiAgb2hvczogJ29wZW5oYXJtb255Jyxcbn1cblxuZXhwb3J0IGNvbnN0IFVuaUFyY2hzQnlQbGF0Zm9ybTogUGFydGlhbDxSZWNvcmQ8UGxhdGZvcm0sIE5vZGVKU0FyY2hbXT4+ID0ge1xuICBkYXJ3aW46IFsneDY0JywgJ2FybTY0J10sXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGFyZ2V0IHtcbiAgdHJpcGxlOiBzdHJpbmdcbiAgcGxhdGZvcm1BcmNoQUJJOiBzdHJpbmdcbiAgcGxhdGZvcm06IFBsYXRmb3JtXG4gIGFyY2g6IE5vZGVKU0FyY2hcbiAgYWJpOiBzdHJpbmcgfCBudWxsXG59XG5cbi8qKlxuICogQSB0cmlwbGUgaXMgYSBzcGVjaWZpYyBmb3JtYXQgZm9yIHNwZWNpZnlpbmcgYSB0YXJnZXQgYXJjaGl0ZWN0dXJlLlxuICogVHJpcGxlcyBtYXkgYmUgcmVmZXJyZWQgdG8gYXMgYSB0YXJnZXQgdHJpcGxlIHdoaWNoIGlzIHRoZSBhcmNoaXRlY3R1cmUgZm9yIHRoZSBhcnRpZmFjdCBwcm9kdWNlZCwgYW5kIHRoZSBob3N0IHRyaXBsZSB3aGljaCBpcyB0aGUgYXJjaGl0ZWN0dXJlIHRoYXQgdGhlIGNvbXBpbGVyIGlzIHJ1bm5pbmcgb24uXG4gKiBUaGUgZ2VuZXJhbCBmb3JtYXQgb2YgdGhlIHRyaXBsZSBpcyBgPGFyY2g+PHN1Yj4tPHZlbmRvcj4tPHN5cz4tPGFiaT5gIHdoZXJlOlxuICogICAtIGBhcmNoYCA9IFRoZSBiYXNlIENQVSBhcmNoaXRlY3R1cmUsIGZvciBleGFtcGxlIGB4ODZfNjRgLCBgaTY4NmAsIGBhcm1gLCBgdGh1bWJgLCBgbWlwc2AsIGV0Yy5cbiAqICAgLSBgc3ViYCA9IFRoZSBDUFUgc3ViLWFyY2hpdGVjdHVyZSwgZm9yIGV4YW1wbGUgYGFybWAgaGFzIGB2N2AsIGB2N3NgLCBgdjV0ZWAsIGV0Yy5cbiAqICAgLSBgdmVuZG9yYCA9IFRoZSB2ZW5kb3IsIGZvciBleGFtcGxlIGB1bmtub3duYCwgYGFwcGxlYCwgYHBjYCwgYG52aWRpYWAsIGV0Yy5cbiAqICAgLSBgc3lzYCA9IFRoZSBzeXN0ZW0gbmFtZSwgZm9yIGV4YW1wbGUgYGxpbnV4YCwgYHdpbmRvd3NgLCBgZGFyd2luYCwgZXRjLiBub25lIGlzIHR5cGljYWxseSB1c2VkIGZvciBiYXJlLW1ldGFsIHdpdGhvdXQgYW4gT1MuXG4gKiAgIC0gYGFiaWAgPSBUaGUgQUJJLCBmb3IgZXhhbXBsZSBgZ251YCwgYGFuZHJvaWRgLCBgZWFiaWAsIGV0Yy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlVHJpcGxlKHJhd1RyaXBsZTogc3RyaW5nKTogVGFyZ2V0IHtcbiAgaWYgKFxuICAgIHJhd1RyaXBsZSA9PT0gJ3dhc20zMi13YXNpJyB8fFxuICAgIHJhd1RyaXBsZSA9PT0gJ3dhc20zMi13YXNpLXByZXZpZXcxLXRocmVhZHMnIHx8XG4gICAgcmF3VHJpcGxlLnN0YXJ0c1dpdGgoJ3dhc20zMi13YXNpcCcpXG4gICkge1xuICAgIHJldHVybiB7XG4gICAgICB0cmlwbGU6IHJhd1RyaXBsZSxcbiAgICAgIHBsYXRmb3JtQXJjaEFCSTogJ3dhc20zMi13YXNpJyxcbiAgICAgIHBsYXRmb3JtOiAnd2FzaScsXG4gICAgICBhcmNoOiAnd2FzbTMyJyxcbiAgICAgIGFiaTogJ3dhc2knLFxuICAgIH1cbiAgfVxuICBjb25zdCB0cmlwbGUgPSByYXdUcmlwbGUuZW5kc1dpdGgoJ2VhYmknKVxuICAgID8gYCR7cmF3VHJpcGxlLnNsaWNlKDAsIC00KX0tZWFiaWBcbiAgICA6IHJhd1RyaXBsZVxuICBjb25zdCB0cmlwbGVzID0gdHJpcGxlLnNwbGl0KCctJylcbiAgbGV0IGNwdTogc3RyaW5nXG4gIGxldCBzeXM6IHN0cmluZ1xuICBsZXQgYWJpOiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICBpZiAodHJpcGxlcy5sZW5ndGggPT09IDIpIHtcbiAgICAvLyBhYXJjaDY0LWZ1Y2hzaWFcbiAgICAvLyBeIGNwdSAgIF4gc3lzXG4gICAgO1tjcHUsIHN5c10gPSB0cmlwbGVzXG4gIH0gZWxzZSB7XG4gICAgLy8gYWFyY2g2NC11bmtub3duLWxpbnV4LW11c2xcbiAgICAvLyBeIGNwdSAgIF52ZW5kb3IgXiBzeXMgXiBhYmlcbiAgICAvLyBhYXJjaDY0LWFwcGxlLWRhcndpblxuICAgIC8vIF4gY3B1ICAgICAgICAgXiBzeXMgIChhYmkgaXMgTm9uZSlcbiAgICA7W2NwdSwgLCBzeXMsIGFiaSA9IG51bGxdID0gdHJpcGxlc1xuICB9XG5cbiAgaWYgKGFiaSAmJiBTVUJfU1lTVEVNUy5oYXMoYWJpKSkge1xuICAgIHN5cyA9IGFiaVxuICAgIGFiaSA9IG51bGxcbiAgfVxuICBjb25zdCBwbGF0Zm9ybSA9IFN5c1RvTm9kZVBsYXRmb3JtW3N5c10gPz8gKHN5cyBhcyBQbGF0Zm9ybSlcbiAgY29uc3QgYXJjaCA9IENwdVRvTm9kZUFyY2hbY3B1XSA/PyAoY3B1IGFzIE5vZGVKU0FyY2gpXG5cbiAgcmV0dXJuIHtcbiAgICB0cmlwbGU6IHJhd1RyaXBsZSxcbiAgICBwbGF0Zm9ybUFyY2hBQkk6IGFiaSA/IGAke3BsYXRmb3JtfS0ke2FyY2h9LSR7YWJpfWAgOiBgJHtwbGF0Zm9ybX0tJHthcmNofWAsXG4gICAgcGxhdGZvcm0sXG4gICAgYXJjaCxcbiAgICBhYmksXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFN5c3RlbURlZmF1bHRUYXJnZXQoKTogVGFyZ2V0IHtcbiAgY29uc3QgaG9zdCA9IGV4ZWNTeW5jKGBydXN0YyAtdlZgLCB7XG4gICAgZW52OiBwcm9jZXNzLmVudixcbiAgfSlcbiAgICAudG9TdHJpbmcoJ3V0ZjgnKVxuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuZmluZCgobGluZSkgPT4gbGluZS5zdGFydHNXaXRoKCdob3N0OiAnKSlcbiAgY29uc3QgdHJpcGxlID0gaG9zdD8uc2xpY2UoJ2hvc3Q6ICcubGVuZ3RoKVxuICBpZiAoIXRyaXBsZSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYENhbiBub3QgcGFyc2UgdGFyZ2V0IHRyaXBsZSBmcm9tIGhvc3RgKVxuICB9XG4gIHJldHVybiBwYXJzZVRyaXBsZSh0cmlwbGUpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRUYXJnZXRMaW5rZXIodGFyZ2V0OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gVEFSR0VUX0xJTktFUlt0YXJnZXRdXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0YXJnZXRUb0VudlZhcih0YXJnZXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0YXJnZXQucmVwbGFjZSgvLS9nLCAnXycpLnRvVXBwZXJDYXNlKClcbn1cbiIsImV4cG9ydCBlbnVtIE5hcGlWZXJzaW9uIHtcbiAgTmFwaTEgPSAxLFxuICBOYXBpMixcbiAgTmFwaTMsXG4gIE5hcGk0LFxuICBOYXBpNSxcbiAgTmFwaTYsXG4gIE5hcGk3LFxuICBOYXBpOCxcbiAgTmFwaTksXG59XG5cbi8vLyBiZWNhdXNlIG5vZGUgc3VwcG9ydCBuZXcgbmFwaSB2ZXJzaW9uIGluIHNvbWUgbWlub3IgdmVyc2lvbiB1cGRhdGVzLCBzbyB3ZSBtaWdodCBtZWV0IHN1Y2ggc2l0dWF0aW9uOlxuLy8vIGBub2RlIHYxMC4yMC4wYCBzdXBwb3J0cyBgbmFwaTVgIGFuZCBgbmFwaTZgLCBidXQgYG5vZGUgdjEyLjAuMGAgb25seSBzdXBwb3J0IGBuYXBpNGAsXG4vLy8gYnkgd2hpY2gsIHdlIGNhbiBub3QgdGVsbCBkaXJlY3RseSBuYXBpIHZlcnNpb24gc3VwcG9ydGxlc3MgZnJvbSBub2RlIHZlcnNpb24gZGlyZWN0bHkuXG5jb25zdCBOQVBJX1ZFUlNJT05fTUFUUklYID0gbmV3IE1hcDxOYXBpVmVyc2lvbiwgc3RyaW5nPihbXG4gIFtOYXBpVmVyc2lvbi5OYXBpMSwgJzguNi4wIHwgOS4wLjAgfCAxMC4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGkyLCAnOC4xMC4wIHwgOS4zLjAgfCAxMC4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGkzLCAnNi4xNC4yIHwgOC4xMS4yIHwgOS4xMS4wIHwgMTAuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpNCwgJzEwLjE2LjAgfCAxMS44LjAgfCAxMi4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk1LCAnMTAuMTcuMCB8IDEyLjExLjAgfCAxMy4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk2LCAnMTAuMjAuMCB8IDEyLjE3LjAgfCAxNC4wLjAnXSxcbiAgW05hcGlWZXJzaW9uLk5hcGk3LCAnMTAuMjMuMCB8IDEyLjE5LjAgfCAxNC4xMi4wIHwgMTUuMC4wJ10sXG4gIFtOYXBpVmVyc2lvbi5OYXBpOCwgJzEyLjIyLjAgfCAxNC4xNy4wIHwgMTUuMTIuMCB8IDE2LjAuMCddLFxuICBbTmFwaVZlcnNpb24uTmFwaTksICcxOC4xNy4wIHwgMjAuMy4wIHwgMjEuMS4wJ10sXG5dKVxuXG5pbnRlcmZhY2UgTm9kZVZlcnNpb24ge1xuICBtYWpvcjogbnVtYmVyXG4gIG1pbm9yOiBudW1iZXJcbiAgcGF0Y2g6IG51bWJlclxufVxuXG5mdW5jdGlvbiBwYXJzZU5vZGVWZXJzaW9uKHY6IHN0cmluZyk6IE5vZGVWZXJzaW9uIHtcbiAgY29uc3QgbWF0Y2hlcyA9IHYubWF0Y2goL3Y/KFswLTldKylcXC4oWzAtOV0rKVxcLihbMC05XSspL2kpXG5cbiAgaWYgKCFtYXRjaGVzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIG5vZGUgdmVyc2lvbiBudW1iZXI6ICcgKyB2KVxuICB9XG5cbiAgY29uc3QgWywgbWFqb3IsIG1pbm9yLCBwYXRjaF0gPSBtYXRjaGVzXG5cbiAgcmV0dXJuIHtcbiAgICBtYWpvcjogcGFyc2VJbnQobWFqb3IpLFxuICAgIG1pbm9yOiBwYXJzZUludChtaW5vciksXG4gICAgcGF0Y2g6IHBhcnNlSW50KHBhdGNoKSxcbiAgfVxufVxuXG5mdW5jdGlvbiByZXF1aXJlZE5vZGVWZXJzaW9ucyhuYXBpVmVyc2lvbjogTmFwaVZlcnNpb24pOiBOb2RlVmVyc2lvbltdIHtcbiAgY29uc3QgcmVxdWlyZW1lbnQgPSBOQVBJX1ZFUlNJT05fTUFUUklYLmdldChuYXBpVmVyc2lvbilcblxuICBpZiAoIXJlcXVpcmVtZW50KSB7XG4gICAgcmV0dXJuIFtwYXJzZU5vZGVWZXJzaW9uKCcxMC4wLjAnKV1cbiAgfVxuXG4gIHJldHVybiByZXF1aXJlbWVudC5zcGxpdCgnfCcpLm1hcChwYXJzZU5vZGVWZXJzaW9uKVxufVxuXG5mdW5jdGlvbiB0b0VuZ2luZVJlcXVpcmVtZW50KHZlcnNpb25zOiBOb2RlVmVyc2lvbltdKTogc3RyaW5nIHtcbiAgY29uc3QgcmVxdWlyZW1lbnRzOiBzdHJpbmdbXSA9IFtdXG4gIHZlcnNpb25zLmZvckVhY2goKHYsIGkpID0+IHtcbiAgICBsZXQgcmVxID0gJydcbiAgICBpZiAoaSAhPT0gMCkge1xuICAgICAgY29uc3QgbGFzdFZlcnNpb24gPSB2ZXJzaW9uc1tpIC0gMV1cbiAgICAgIHJlcSArPSBgPCAke2xhc3RWZXJzaW9uLm1ham9yICsgMX1gXG4gICAgfVxuXG4gICAgcmVxICs9IGAke2kgPT09IDAgPyAnJyA6ICcgfHwgJ30+PSAke3YubWFqb3J9LiR7di5taW5vcn0uJHt2LnBhdGNofWBcbiAgICByZXF1aXJlbWVudHMucHVzaChyZXEpXG4gIH0pXG5cbiAgcmV0dXJuIHJlcXVpcmVtZW50cy5qb2luKCcgJylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5hcGlFbmdpbmVSZXF1aXJlbWVudChuYXBpVmVyc2lvbjogTmFwaVZlcnNpb24pOiBzdHJpbmcge1xuICByZXR1cm4gdG9FbmdpbmVSZXF1aXJlbWVudChyZXF1aXJlZE5vZGVWZXJzaW9ucyhuYXBpVmVyc2lvbikpXG59XG4iLCJpbXBvcnQgeyBzcGF3biB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCBmcyBmcm9tICdub2RlOmZzJ1xuXG5leHBvcnQgdHlwZSBDcmF0ZVRhcmdldEtpbmQgPVxuICB8ICdiaW4nXG4gIHwgJ2V4YW1wbGUnXG4gIHwgJ3Rlc3QnXG4gIHwgJ2JlbmNoJ1xuICB8ICdsaWInXG4gIHwgJ3JsaWInXG4gIHwgJ2NkeWxpYidcbiAgfCAnY3VzdG9tLWJ1aWxkJ1xuXG5leHBvcnQgaW50ZXJmYWNlIENyYXRlVGFyZ2V0IHtcbiAgbmFtZTogc3RyaW5nXG4gIGtpbmQ6IENyYXRlVGFyZ2V0S2luZFtdXG4gIGNyYXRlX3R5cGVzOiBDcmF0ZVRhcmdldEtpbmRbXVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENyYXRlIHtcbiAgaWQ6IHN0cmluZ1xuICBuYW1lOiBzdHJpbmdcbiAgc3JjX3BhdGg6IHN0cmluZ1xuICB2ZXJzaW9uOiBzdHJpbmdcbiAgZWRpdGlvbjogc3RyaW5nXG4gIHRhcmdldHM6IENyYXRlVGFyZ2V0W11cbiAgZmVhdHVyZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPlxuICBtYW5pZmVzdF9wYXRoOiBzdHJpbmdcbiAgZGVwZW5kZW5jaWVzOiBBcnJheTx7XG4gICAgbmFtZTogc3RyaW5nXG4gICAgc291cmNlOiBzdHJpbmdcbiAgICByZXE6IHN0cmluZ1xuICAgIGtpbmQ6IHN0cmluZyB8IG51bGxcbiAgICByZW5hbWU6IHN0cmluZyB8IG51bGxcbiAgICBvcHRpb25hbDogYm9vbGVhblxuICAgIHVzZXNfZGVmYXVsdF9mZWF0dXJlczogYm9vbGVhblxuICAgIGZlYXR1cmVzOiBzdHJpbmdbXVxuICAgIHRhcmdldDogc3RyaW5nIHwgbnVsbFxuICAgIHJlZ2lzdHJ5OiBzdHJpbmcgfCBudWxsXG4gIH0+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2FyZ29Xb3Jrc3BhY2VNZXRhZGF0YSB7XG4gIHZlcnNpb246IG51bWJlclxuICBwYWNrYWdlczogQ3JhdGVbXVxuICB3b3Jrc3BhY2VfbWVtYmVyczogc3RyaW5nW11cbiAgdGFyZ2V0X2RpcmVjdG9yeTogc3RyaW5nXG4gIHdvcmtzcGFjZV9yb290OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhcnNlTWV0YWRhdGEobWFuaWZlc3RQYXRoOiBzdHJpbmcpIHtcbiAgaWYgKCFmcy5leGlzdHNTeW5jKG1hbmlmZXN0UGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNyYXRlIGZvdW5kIGluIG1hbmlmZXN0OiAke21hbmlmZXN0UGF0aH1gKVxuICB9XG5cbiAgY29uc3QgY2hpbGRQcm9jZXNzID0gc3Bhd24oXG4gICAgJ2NhcmdvJyxcbiAgICBbJ21ldGFkYXRhJywgJy0tbWFuaWZlc3QtcGF0aCcsIG1hbmlmZXN0UGF0aCwgJy0tZm9ybWF0LXZlcnNpb24nLCAnMSddLFxuICAgIHsgc3RkaW86ICdwaXBlJyB9LFxuICApXG5cbiAgbGV0IHN0ZG91dCA9ICcnXG4gIGxldCBzdGRlcnIgPSAnJ1xuICBsZXQgc3RhdHVzID0gMFxuICBsZXQgZXJyb3IgPSBudWxsXG5cbiAgY2hpbGRQcm9jZXNzLnN0ZG91dC5vbignZGF0YScsIChkYXRhKSA9PiB7XG4gICAgc3Rkb3V0ICs9IGRhdGFcbiAgfSlcblxuICBjaGlsZFByb2Nlc3Muc3RkZXJyLm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICBzdGRlcnIgKz0gZGF0YVxuICB9KVxuXG4gIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgY2hpbGRQcm9jZXNzLm9uKCdjbG9zZScsIChjb2RlKSA9PiB7XG4gICAgICBzdGF0dXMgPSBjb2RlID8/IDBcbiAgICAgIHJlc29sdmUoKVxuICAgIH0pXG4gIH0pXG5cbiAgaWYgKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjYXJnbyBtZXRhZGF0YSBmYWlsZWQgdG8gcnVuJywgeyBjYXVzZTogZXJyb3IgfSlcbiAgfVxuICBpZiAoc3RhdHVzICE9PSAwKSB7XG4gICAgY29uc3Qgc2ltcGxlTWVzc2FnZSA9IGBjYXJnbyBtZXRhZGF0YSBleGl0ZWQgd2l0aCBjb2RlICR7c3RhdHVzfWBcbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7c2ltcGxlTWVzc2FnZX0gYW5kIGVycm9yIG1lc3NhZ2U6XFxuXFxuJHtzdGRlcnJ9YCwge1xuICAgICAgY2F1c2U6IG5ldyBFcnJvcihzaW1wbGVNZXNzYWdlKSxcbiAgICB9KVxuICB9XG5cbiAgdHJ5IHtcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzdGRvdXQpIGFzIENhcmdvV29ya3NwYWNlTWV0YWRhdGFcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHBhcnNlIGNhcmdvIG1ldGFkYXRhIEpTT04nLCB7IGNhdXNlOiBlIH0pXG4gIH1cbn1cbiIsImltcG9ydCB7IHVuZGVybGluZSwgeWVsbG93IH0gZnJvbSAnY29sb3JldHRlJ1xuaW1wb3J0IHsgbWVyZ2UsIG9taXQgfSBmcm9tICdlcy10b29sa2l0J1xuXG5pbXBvcnQgeyBmaWxlRXhpc3RzLCByZWFkRmlsZUFzeW5jIH0gZnJvbSAnLi9taXNjLmpzJ1xuaW1wb3J0IHsgREVGQVVMVF9UQVJHRVRTLCBwYXJzZVRyaXBsZSwgdHlwZSBUYXJnZXQgfSBmcm9tICcuL3RhcmdldC5qcydcblxuZXhwb3J0IHR5cGUgVmFsdWVPZkNvbnN0QXJyYXk8VD4gPSBUW0V4Y2x1ZGU8a2V5b2YgVCwga2V5b2YgQXJyYXk8YW55Pj5dXG5cbmV4cG9ydCBjb25zdCBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlcnMgPSBbJ3lhcm4nLCAncG5wbSddIGFzIGNvbnN0XG5leHBvcnQgY29uc3QgU3VwcG9ydGVkVGVzdEZyYW1ld29ya3MgPSBbJ2F2YSddIGFzIGNvbnN0XG5cbmV4cG9ydCB0eXBlIFN1cHBvcnRlZFBhY2thZ2VNYW5hZ2VyID0gVmFsdWVPZkNvbnN0QXJyYXk8XG4gIHR5cGVvZiBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlcnNcbj5cbmV4cG9ydCB0eXBlIFN1cHBvcnRlZFRlc3RGcmFtZXdvcmsgPSBWYWx1ZU9mQ29uc3RBcnJheTxcbiAgdHlwZW9mIFN1cHBvcnRlZFRlc3RGcmFtZXdvcmtzXG4+XG5cbmV4cG9ydCBpbnRlcmZhY2UgVXNlck5hcGlDb25maWcge1xuICAvKipcbiAgICogTmFtZSBvZiB0aGUgYmluYXJ5IHRvIGJlIGdlbmVyYXRlZCwgZGVmYXVsdCB0byBgaW5kZXhgXG4gICAqL1xuICBiaW5hcnlOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBOYW1lIG9mIHRoZSBucG0gcGFja2FnZSwgZGVmYXVsdCB0byB0aGUgbmFtZSBvZiByb290IHBhY2thZ2UuanNvbiBuYW1lXG4gICAqXG4gICAqIEFsd2F5cyBnaXZlbiBgQHNjb3BlL3BrZ2AgYW5kIGFyY2ggc3VmZml4IHdpbGwgYmUgYXBwZW5kZWQgbGlrZSBgQHNjb3BlL3BrZy1saW51eC1nbnUteDY0YFxuICAgKi9cbiAgcGFja2FnZU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEFsbCB0YXJnZXRzIHRoZSBjcmF0ZSB3aWxsIGJlIGNvbXBpbGVkIGZvclxuICAgKi9cbiAgdGFyZ2V0cz86IHN0cmluZ1tdXG5cbiAgLyoqXG4gICAqIFRoZSBucG0gY2xpZW50IHByb2plY3QgdXNlcy5cbiAgICovXG4gIG5wbUNsaWVudD86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGdlbmVyYXRlIGNvbnN0IGVudW0gZm9yIHR5cGVzY3JpcHQgYmluZGluZ3NcbiAgICovXG4gIGNvbnN0RW51bT86IGJvb2xlYW5cblxuICAvKipcbiAgICogZHRzIGhlYWRlciBwcmVwZW5kIHRvIHRoZSBnZW5lcmF0ZWQgZHRzIGZpbGVcbiAgICovXG4gIGR0c0hlYWRlcj86IHN0cmluZ1xuXG4gIC8qKlxuICAgKiBkdHMgaGVhZGVyIGZpbGUgcGF0aCB0byBiZSBwcmVwZW5kZWQgdG8gdGhlIGdlbmVyYXRlZCBkdHMgZmlsZVxuICAgKiBpZiBib3RoIGR0c0hlYWRlciBhbmQgZHRzSGVhZGVyRmlsZSBhcmUgcHJvdmlkZWQsIGR0c0hlYWRlckZpbGUgd2lsbCBiZSB1c2VkXG4gICAqL1xuICBkdHNIZWFkZXJGaWxlPzogc3RyaW5nXG5cbiAgLyoqXG4gICAqIHdhc20gY29tcGlsYXRpb24gb3B0aW9uc1xuICAgKi9cbiAgd2FzbT86IHtcbiAgICAvKipcbiAgICAgKiBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYkFzc2VtYmx5L0phdmFTY3JpcHRfaW50ZXJmYWNlL01lbW9yeVxuICAgICAqIEBkZWZhdWx0IDQwMDAgcGFnZXMgKDI1Nk1pQilcbiAgICAgKi9cbiAgICBpbml0aWFsTWVtb3J5PzogbnVtYmVyXG4gICAgLyoqXG4gICAgICogQGRlZmF1bHQgNjU1MzYgcGFnZXMgKDRHaUIpXG4gICAgICovXG4gICAgbWF4aW11bU1lbW9yeT86IG51bWJlclxuXG4gICAgLyoqXG4gICAgICogQnJvd3NlciB3YXNtIGJpbmRpbmcgY29uZmlndXJhdGlvblxuICAgICAqL1xuICAgIGJyb3dzZXI6IHtcbiAgICAgIC8qKlxuICAgICAgICogV2hldGhlciB0byB1c2UgZnMgbW9kdWxlIGluIGJyb3dzZXJcbiAgICAgICAqL1xuICAgICAgZnM/OiBib29sZWFuXG4gICAgICAvKipcbiAgICAgICAqIFdoZXRoZXIgdG8gaW5pdGlhbGl6ZSB3YXNtIGFzeW5jaHJvbm91c2x5XG4gICAgICAgKi9cbiAgICAgIGFzeW5jSW5pdD86IGJvb2xlYW5cbiAgICAgIC8qKlxuICAgICAgICogV2hldGhlciB0byBpbmplY3QgYGJ1ZmZlcmAgdG8gZW1uYXBpIGNvbnRleHRcbiAgICAgICAqL1xuICAgICAgYnVmZmVyPzogYm9vbGVhblxuICAgICAgLyoqXG4gICAgICAgKiBXaGV0aGVyIHRvIGVtaXQgY3VzdG9tIGV2ZW50cyBmb3IgZXJyb3JzIGluIHdvcmtlclxuICAgICAgICovXG4gICAgICBlcnJvckV2ZW50PzogYm9vbGVhblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCBiaW5hcnlOYW1lIGluc3RlYWRcbiAgICovXG4gIG5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEBkZXByZWNhdGVkIHVzZSBwYWNrYWdlTmFtZSBpbnN0ZWFkXG4gICAqL1xuICBwYWNrYWdlPzoge1xuICAgIG5hbWU/OiBzdHJpbmdcbiAgfVxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHRhcmdldHMgaW5zdGVhZFxuICAgKi9cbiAgdHJpcGxlcz86IHtcbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIGVuYWJsZSBkZWZhdWx0IHRhcmdldHNcbiAgICAgKi9cbiAgICBkZWZhdWx0czogYm9vbGVhblxuICAgIC8qKlxuICAgICAqIEFkZGl0aW9uYWwgdGFyZ2V0cyB0byBiZSBjb21waWxlZCBmb3JcbiAgICAgKi9cbiAgICBhZGRpdGlvbmFsPzogc3RyaW5nW11cbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbW1vblBhY2thZ2VKc29uRmllbGRzIHtcbiAgbmFtZTogc3RyaW5nXG4gIHZlcnNpb246IHN0cmluZ1xuICBkZXNjcmlwdGlvbj86IHN0cmluZ1xuICBrZXl3b3Jkcz86IHN0cmluZ1tdXG4gIGF1dGhvcj86IHN0cmluZ1xuICBhdXRob3JzPzogc3RyaW5nW11cbiAgbGljZW5zZT86IHN0cmluZ1xuICBjcHU/OiBzdHJpbmdbXVxuICBvcz86IHN0cmluZ1tdXG4gIGxpYmM/OiBzdHJpbmdbXVxuICBmaWxlcz86IHN0cmluZ1tdXG4gIHJlcG9zaXRvcnk/OiBhbnlcbiAgaG9tZXBhZ2U/OiBhbnlcbiAgZW5naW5lcz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgcHVibGlzaENvbmZpZz86IGFueVxuICBidWdzPzogYW55XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby11c2UtYmVmb3JlLWRlZmluZVxuICBuYXBpPzogVXNlck5hcGlDb25maWdcbiAgdHlwZT86ICdtb2R1bGUnIHwgJ2NvbW1vbmpzJ1xuICBzY3JpcHRzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuXG4gIC8vIG1vZHVsZXNcbiAgbWFpbj86IHN0cmluZ1xuICBtb2R1bGU/OiBzdHJpbmdcbiAgdHlwZXM/OiBzdHJpbmdcbiAgYnJvd3Nlcj86IHN0cmluZ1xuICBleHBvcnRzPzogYW55XG5cbiAgZGVwZW5kZW5jaWVzPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICBkZXZEZXBlbmRlbmNpZXM/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG5cbiAgYXZhPzoge1xuICAgIHRpbWVvdXQ/OiBzdHJpbmdcbiAgfVxufVxuXG5leHBvcnQgdHlwZSBOYXBpQ29uZmlnID0gUmVxdWlyZWQ8XG4gIFBpY2s8VXNlck5hcGlDb25maWcsICdiaW5hcnlOYW1lJyB8ICdwYWNrYWdlTmFtZScgfCAnbnBtQ2xpZW50Jz5cbj4gJlxuICBQaWNrPFVzZXJOYXBpQ29uZmlnLCAnd2FzbScgfCAnZHRzSGVhZGVyJyB8ICdkdHNIZWFkZXJGaWxlJyB8ICdjb25zdEVudW0nPiAmIHtcbiAgICB0YXJnZXRzOiBUYXJnZXRbXVxuICAgIHBhY2thZ2VKc29uOiBDb21tb25QYWNrYWdlSnNvbkZpZWxkc1xuICB9XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkTmFwaUNvbmZpZyhcbiAgcGF0aDogc3RyaW5nLFxuICBjb25maWdQYXRoPzogc3RyaW5nLFxuKTogUHJvbWlzZTxOYXBpQ29uZmlnPiB7XG4gIGlmIChjb25maWdQYXRoICYmICEoYXdhaXQgZmlsZUV4aXN0cyhjb25maWdQYXRoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYE5BUEktUlMgY29uZmlnIG5vdCBmb3VuZCBhdCAke2NvbmZpZ1BhdGh9YClcbiAgfVxuICBpZiAoIShhd2FpdCBmaWxlRXhpc3RzKHBhdGgpKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgcGFja2FnZS5qc29uIG5vdCBmb3VuZCBhdCAke3BhdGh9YClcbiAgfVxuICAvLyBNYXkgc3VwcG9ydCBtdWx0aXBsZSBjb25maWcgc291cmNlcyBsYXRlciBvbi5cbiAgY29uc3QgY29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMocGF0aCwgJ3V0ZjgnKVxuICBsZXQgcGtnSnNvblxuICB0cnkge1xuICAgIHBrZ0pzb24gPSBKU09OLnBhcnNlKGNvbnRlbnQpIGFzIENvbW1vblBhY2thZ2VKc29uRmllbGRzXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBwYXJzZSBwYWNrYWdlLmpzb24gYXQgJHtwYXRofWAsIHtcbiAgICAgIGNhdXNlOiBlLFxuICAgIH0pXG4gIH1cblxuICBsZXQgc2VwYXJhdGVkQ29uZmlnOiBVc2VyTmFwaUNvbmZpZyB8IHVuZGVmaW5lZFxuICBpZiAoY29uZmlnUGF0aCkge1xuICAgIGNvbnN0IGNvbmZpZ0NvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKGNvbmZpZ1BhdGgsICd1dGY4JylcbiAgICB0cnkge1xuICAgICAgc2VwYXJhdGVkQ29uZmlnID0gSlNPTi5wYXJzZShjb25maWdDb250ZW50KSBhcyBVc2VyTmFwaUNvbmZpZ1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHBhcnNlIE5BUEktUlMgY29uZmlnIGF0ICR7Y29uZmlnUGF0aH1gLCB7XG4gICAgICAgIGNhdXNlOiBlLFxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBjb25zdCB1c2VyTmFwaUNvbmZpZyA9IHBrZ0pzb24ubmFwaSA/PyB7fVxuICBpZiAocGtnSnNvbi5uYXBpICYmIHNlcGFyYXRlZENvbmZpZykge1xuICAgIGNvbnN0IHBrZ0pzb25QYXRoID0gdW5kZXJsaW5lKHBhdGgpXG4gICAgY29uc3QgY29uZmlnUGF0aFVuZGVybGluZSA9IHVuZGVybGluZShjb25maWdQYXRoISlcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICB5ZWxsb3coXG4gICAgICAgIGBCb3RoIG5hcGkgZmllbGQgaW4gJHtwa2dKc29uUGF0aH0gYW5kIFtOQVBJLVJTIGNvbmZpZ10oJHtjb25maWdQYXRoVW5kZXJsaW5lfSkgZmlsZSBhcmUgZm91bmQsIHRoZSBOQVBJLVJTIGNvbmZpZyBmaWxlIHdpbGwgYmUgdXNlZC5gLFxuICAgICAgKSxcbiAgICApXG4gIH1cbiAgaWYgKHNlcGFyYXRlZENvbmZpZykge1xuICAgIE9iamVjdC5hc3NpZ24odXNlck5hcGlDb25maWcsIHNlcGFyYXRlZENvbmZpZylcbiAgfVxuICBjb25zdCBuYXBpQ29uZmlnOiBOYXBpQ29uZmlnID0gbWVyZ2UoXG4gICAge1xuICAgICAgYmluYXJ5TmFtZTogJ2luZGV4JyxcbiAgICAgIHBhY2thZ2VOYW1lOiBwa2dKc29uLm5hbWUsXG4gICAgICB0YXJnZXRzOiBbXSxcbiAgICAgIHBhY2thZ2VKc29uOiBwa2dKc29uLFxuICAgICAgbnBtQ2xpZW50OiAnbnBtJyxcbiAgICB9LFxuICAgIG9taXQodXNlck5hcGlDb25maWcsIFsndGFyZ2V0cyddKSxcbiAgKVxuXG4gIGxldCB0YXJnZXRzOiBzdHJpbmdbXSA9IHVzZXJOYXBpQ29uZmlnLnRhcmdldHMgPz8gW11cblxuICAvLyBjb21wYXRpYmxlIHdpdGggb2xkIGNvbmZpZ1xuICBpZiAodXNlck5hcGlDb25maWc/Lm5hbWUpIHtcbiAgICBjb25zb2xlLndhcm4oXG4gICAgICB5ZWxsb3coXG4gICAgICAgIGBbREVQUkVDQVRFRF0gbmFwaS5uYW1lIGlzIGRlcHJlY2F0ZWQsIHVzZSBuYXBpLmJpbmFyeU5hbWUgaW5zdGVhZC5gLFxuICAgICAgKSxcbiAgICApXG4gICAgbmFwaUNvbmZpZy5iaW5hcnlOYW1lID0gdXNlck5hcGlDb25maWcubmFtZVxuICB9XG5cbiAgaWYgKCF0YXJnZXRzLmxlbmd0aCkge1xuICAgIGxldCBkZXByZWNhdGVkV2FybmVkID0gZmFsc2VcbiAgICBjb25zdCB3YXJuaW5nID0geWVsbG93KFxuICAgICAgYFtERVBSRUNBVEVEXSBuYXBpLnRyaXBsZXMgaXMgZGVwcmVjYXRlZCwgdXNlIG5hcGkudGFyZ2V0cyBpbnN0ZWFkLmAsXG4gICAgKVxuICAgIGlmICh1c2VyTmFwaUNvbmZpZy50cmlwbGVzPy5kZWZhdWx0cykge1xuICAgICAgZGVwcmVjYXRlZFdhcm5lZCA9IHRydWVcbiAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nKVxuICAgICAgdGFyZ2V0cyA9IHRhcmdldHMuY29uY2F0KERFRkFVTFRfVEFSR0VUUylcbiAgICB9XG5cbiAgICBpZiAodXNlck5hcGlDb25maWcudHJpcGxlcz8uYWRkaXRpb25hbD8ubGVuZ3RoKSB7XG4gICAgICB0YXJnZXRzID0gdGFyZ2V0cy5jb25jYXQodXNlck5hcGlDb25maWcudHJpcGxlcy5hZGRpdGlvbmFsKVxuICAgICAgaWYgKCFkZXByZWNhdGVkV2FybmVkKSB7XG4gICAgICAgIGNvbnNvbGUud2Fybih3YXJuaW5nKVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIGZpbmQgZHVwbGljYXRlIHRhcmdldHNcbiAgY29uc3QgdW5pcXVlVGFyZ2V0cyA9IG5ldyBTZXQodGFyZ2V0cylcbiAgaWYgKHVuaXF1ZVRhcmdldHMuc2l6ZSAhPT0gdGFyZ2V0cy5sZW5ndGgpIHtcbiAgICBjb25zdCBkdXBsaWNhdGVUYXJnZXQgPSB0YXJnZXRzLmZpbmQoXG4gICAgICAodGFyZ2V0LCBpbmRleCkgPT4gdGFyZ2V0cy5pbmRleE9mKHRhcmdldCkgIT09IGluZGV4LFxuICAgIClcbiAgICB0aHJvdyBuZXcgRXJyb3IoYER1cGxpY2F0ZSB0YXJnZXRzIGFyZSBub3QgYWxsb3dlZDogJHtkdXBsaWNhdGVUYXJnZXR9YClcbiAgfVxuXG4gIG5hcGlDb25maWcudGFyZ2V0cyA9IHRhcmdldHMubWFwKHBhcnNlVHJpcGxlKVxuXG4gIHJldHVybiBuYXBpQ29uZmlnXG59XG4iLCJpbXBvcnQgeyBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcblxuaW1wb3J0IHsgZGVidWcgfSBmcm9tICcuL2xvZy5qcydcblxuZXhwb3J0IGZ1bmN0aW9uIHRyeUluc3RhbGxDYXJnb0JpbmFyeShuYW1lOiBzdHJpbmcsIGJpbjogc3RyaW5nKSB7XG4gIGlmIChkZXRlY3RDYXJnb0JpbmFyeShiaW4pKSB7XG4gICAgZGVidWcoJ0NhcmdvIGJpbmFyeSBhbHJlYWR5IGluc3RhbGxlZDogJXMnLCBuYW1lKVxuICAgIHJldHVyblxuICB9XG5cbiAgdHJ5IHtcbiAgICBkZWJ1ZygnSW5zdGFsbGluZyBjYXJnbyBiaW5hcnk6ICVzJywgbmFtZSlcbiAgICBleGVjU3luYyhgY2FyZ28gaW5zdGFsbCAke25hbWV9YCwge1xuICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICB9KVxuICB9IGNhdGNoIChlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gaW5zdGFsbCBjYXJnbyBiaW5hcnk6ICR7bmFtZX1gLCB7XG4gICAgICBjYXVzZTogZSxcbiAgICB9KVxuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdENhcmdvQmluYXJ5KGJpbjogc3RyaW5nKSB7XG4gIGRlYnVnKCdEZXRlY3RpbmcgY2FyZ28gYmluYXJ5OiAlcycsIGJpbilcbiAgdHJ5IHtcbiAgICBleGVjU3luYyhgY2FyZ28gaGVscCAke2Jpbn1gLCB7XG4gICAgICBzdGRpbzogJ2lnbm9yZScsXG4gICAgfSlcbiAgICBkZWJ1ZygnQ2FyZ28gYmluYXJ5IGRldGVjdGVkOiAlcycsIGJpbilcbiAgICByZXR1cm4gdHJ1ZVxuICB9IGNhdGNoIHtcbiAgICBkZWJ1ZygnQ2FyZ28gYmluYXJ5IG5vdCBkZXRlY3RlZDogJXMnLCBiaW4pXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cbiIsImltcG9ydCB7IHNvcnRCeSB9IGZyb20gJ2VzLXRvb2xraXQnXG5cbmltcG9ydCB7IHJlYWRGaWxlQXN5bmMgfSBmcm9tICcuL21pc2MuanMnXG5cbmNvbnN0IFRPUF9MRVZFTF9OQU1FU1BBQ0UgPSAnX19UT1BfTEVWRUxfTU9EVUxFX18nXG5leHBvcnQgY29uc3QgREVGQVVMVF9UWVBFX0RFRl9IRUFERVIgPSBgLyogYXV0by1nZW5lcmF0ZWQgYnkgTkFQSS1SUyAqL1xuLyogZXNsaW50LWRpc2FibGUgKi9cbmBcblxuZW51bSBUeXBlRGVmS2luZCB7XG4gIENvbnN0ID0gJ2NvbnN0JyxcbiAgRW51bSA9ICdlbnVtJyxcbiAgU3RyaW5nRW51bSA9ICdzdHJpbmdfZW51bScsXG4gIEludGVyZmFjZSA9ICdpbnRlcmZhY2UnLFxuICBUeXBlID0gJ3R5cGUnLFxuICBGbiA9ICdmbicsXG4gIFN0cnVjdCA9ICdzdHJ1Y3QnLFxuICBFeHRlbmRzID0gJ2V4dGVuZHMnLFxuICBJbXBsID0gJ2ltcGwnLFxufVxuXG5pbnRlcmZhY2UgVHlwZURlZkxpbmUge1xuICBraW5kOiBUeXBlRGVmS2luZFxuICBuYW1lOiBzdHJpbmdcbiAgb3JpZ2luYWxfbmFtZT86IHN0cmluZ1xuICBkZWY6IHN0cmluZ1xuICBleHRlbmRzPzogc3RyaW5nXG4gIGpzX2RvYz86IHN0cmluZ1xuICBqc19tb2Q/OiBzdHJpbmdcbn1cblxuZnVuY3Rpb24gcHJldHR5UHJpbnQoXG4gIGxpbmU6IFR5cGVEZWZMaW5lLFxuICBjb25zdEVudW06IGJvb2xlYW4sXG4gIGlkZW50OiBudW1iZXIsXG4gIGFtYmllbnQgPSBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGxldCBzID0gbGluZS5qc19kb2MgPz8gJydcbiAgc3dpdGNoIChsaW5lLmtpbmQpIHtcbiAgICBjYXNlIFR5cGVEZWZLaW5kLkludGVyZmFjZTpcbiAgICAgIHMgKz0gYGV4cG9ydCBpbnRlcmZhY2UgJHtsaW5lLm5hbWV9IHtcXG4ke2xpbmUuZGVmfVxcbn1gXG4gICAgICBicmVha1xuXG4gICAgY2FzZSBUeXBlRGVmS2luZC5UeXBlOlxuICAgICAgcyArPSBgZXhwb3J0IHR5cGUgJHtsaW5lLm5hbWV9ID0gXFxuJHtsaW5lLmRlZn1gXG4gICAgICBicmVha1xuXG4gICAgY2FzZSBUeXBlRGVmS2luZC5FbnVtOlxuICAgICAgY29uc3QgZW51bU5hbWUgPSBjb25zdEVudW0gPyAnY29uc3QgZW51bScgOiAnZW51bSdcbiAgICAgIHMgKz0gYCR7ZXhwb3J0RGVjbGFyZShhbWJpZW50KX0gJHtlbnVtTmFtZX0gJHtsaW5lLm5hbWV9IHtcXG4ke2xpbmUuZGVmfVxcbn1gXG4gICAgICBicmVha1xuXG4gICAgY2FzZSBUeXBlRGVmS2luZC5TdHJpbmdFbnVtOlxuICAgICAgaWYgKGNvbnN0RW51bSkge1xuICAgICAgICBzICs9IGAke2V4cG9ydERlY2xhcmUoYW1iaWVudCl9IGNvbnN0IGVudW0gJHtsaW5lLm5hbWV9IHtcXG4ke2xpbmUuZGVmfVxcbn1gXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzICs9IGBleHBvcnQgdHlwZSAke2xpbmUubmFtZX0gPSAke2xpbmUuZGVmLnJlcGxhY2VBbGwoLy4qPS9nLCAnJykucmVwbGFjZUFsbCgnLCcsICd8Jyl9O2BcbiAgICAgIH1cbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlIFR5cGVEZWZLaW5kLlN0cnVjdDpcbiAgICAgIGNvbnN0IGV4dGVuZHNEZWYgPSBsaW5lLmV4dGVuZHMgPyBgIGV4dGVuZHMgJHtsaW5lLmV4dGVuZHN9YCA6ICcnXG4gICAgICBpZiAobGluZS5leHRlbmRzKSB7XG4gICAgICAgIC8vIEV4dHJhY3QgZ2VuZXJpYyBwYXJhbXMgZnJvbSBleHRlbmRzIHR5cGUgbGlrZSBJdGVyYXRvcjxULCBUUmVzdWx0LCBUTmV4dD5cbiAgICAgICAgY29uc3QgZ2VuZXJpY01hdGNoID0gbGluZS5leHRlbmRzLm1hdGNoKC9JdGVyYXRvcjwoLispPiQvKVxuICAgICAgICBpZiAoZ2VuZXJpY01hdGNoKSB7XG4gICAgICAgICAgY29uc3QgW1QsIFRSZXN1bHQsIFROZXh0XSA9IGdlbmVyaWNNYXRjaFsxXVxuICAgICAgICAgICAgLnNwbGl0KCcsJylcbiAgICAgICAgICAgIC5tYXAoKHApID0+IHAudHJpbSgpKVxuICAgICAgICAgIGxpbmUuZGVmID1cbiAgICAgICAgICAgIGxpbmUuZGVmICtcbiAgICAgICAgICAgIGBcXG5uZXh0KHZhbHVlPzogJHtUTmV4dH0pOiBJdGVyYXRvclJlc3VsdDwke1R9LCAke1RSZXN1bHR9PmBcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcyArPSBgJHtleHBvcnREZWNsYXJlKGFtYmllbnQpfSBjbGFzcyAke2xpbmUubmFtZX0ke2V4dGVuZHNEZWZ9IHtcXG4ke2xpbmUuZGVmfVxcbn1gXG4gICAgICBpZiAobGluZS5vcmlnaW5hbF9uYW1lICYmIGxpbmUub3JpZ2luYWxfbmFtZSAhPT0gbGluZS5uYW1lKSB7XG4gICAgICAgIHMgKz0gYFxcbmV4cG9ydCB0eXBlICR7bGluZS5vcmlnaW5hbF9uYW1lfSA9ICR7bGluZS5uYW1lfWBcbiAgICAgIH1cbiAgICAgIGJyZWFrXG5cbiAgICBjYXNlIFR5cGVEZWZLaW5kLkZuOlxuICAgICAgcyArPSBgJHtleHBvcnREZWNsYXJlKGFtYmllbnQpfSAke2xpbmUuZGVmfWBcbiAgICAgIGJyZWFrXG5cbiAgICBkZWZhdWx0OlxuICAgICAgcyArPSBsaW5lLmRlZlxuICB9XG5cbiAgcmV0dXJuIGNvcnJlY3RTdHJpbmdJZGVudChzLCBpZGVudClcbn1cblxuZnVuY3Rpb24gZXhwb3J0RGVjbGFyZShhbWJpZW50OiBib29sZWFuKTogc3RyaW5nIHtcbiAgaWYgKGFtYmllbnQpIHtcbiAgICByZXR1cm4gJ2V4cG9ydCdcbiAgfVxuXG4gIHJldHVybiAnZXhwb3J0IGRlY2xhcmUnXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcm9jZXNzVHlwZURlZihcbiAgaW50ZXJtZWRpYXRlVHlwZUZpbGU6IHN0cmluZyxcbiAgY29uc3RFbnVtOiBib29sZWFuLFxuKSB7XG4gIGNvbnN0IGV4cG9ydHM6IHN0cmluZ1tdID0gW11cbiAgY29uc3QgZGVmcyA9IGF3YWl0IHJlYWRJbnRlcm1lZGlhdGVUeXBlRmlsZShpbnRlcm1lZGlhdGVUeXBlRmlsZSlcbiAgY29uc3QgZ3JvdXBlZERlZnMgPSBwcmVwcm9jZXNzVHlwZURlZihkZWZzKVxuXG4gIGNvbnN0IGR0cyA9XG4gICAgc29ydEJ5KEFycmF5LmZyb20oZ3JvdXBlZERlZnMpLCBbKFtuYW1lc3BhY2VdKSA9PiBuYW1lc3BhY2VdKVxuICAgICAgLm1hcCgoW25hbWVzcGFjZSwgZGVmc10pID0+IHtcbiAgICAgICAgaWYgKG5hbWVzcGFjZSA9PT0gVE9QX0xFVkVMX05BTUVTUEFDRSkge1xuICAgICAgICAgIHJldHVybiBkZWZzXG4gICAgICAgICAgICAubWFwKChkZWYpID0+IHtcbiAgICAgICAgICAgICAgc3dpdGNoIChkZWYua2luZCkge1xuICAgICAgICAgICAgICAgIGNhc2UgVHlwZURlZktpbmQuQ29uc3Q6XG4gICAgICAgICAgICAgICAgY2FzZSBUeXBlRGVmS2luZC5FbnVtOlxuICAgICAgICAgICAgICAgIGNhc2UgVHlwZURlZktpbmQuU3RyaW5nRW51bTpcbiAgICAgICAgICAgICAgICBjYXNlIFR5cGVEZWZLaW5kLkZuOlxuICAgICAgICAgICAgICAgIGNhc2UgVHlwZURlZktpbmQuU3RydWN0OiB7XG4gICAgICAgICAgICAgICAgICBleHBvcnRzLnB1c2goZGVmLm5hbWUpXG4gICAgICAgICAgICAgICAgICBpZiAoZGVmLm9yaWdpbmFsX25hbWUgJiYgZGVmLm9yaWdpbmFsX25hbWUgIT09IGRlZi5uYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIGV4cG9ydHMucHVzaChkZWYub3JpZ2luYWxfbmFtZSlcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgICAgICAgICBicmVha1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBwcmV0dHlQcmludChkZWYsIGNvbnN0RW51bSwgMClcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuam9pbignXFxuXFxuJylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBleHBvcnRzLnB1c2gobmFtZXNwYWNlKVxuICAgICAgICAgIGxldCBkZWNsYXJhdGlvbiA9ICcnXG4gICAgICAgICAgZGVjbGFyYXRpb24gKz0gYGV4cG9ydCBkZWNsYXJlIG5hbWVzcGFjZSAke25hbWVzcGFjZX0ge1xcbmBcbiAgICAgICAgICBmb3IgKGNvbnN0IGRlZiBvZiBkZWZzKSB7XG4gICAgICAgICAgICBkZWNsYXJhdGlvbiArPSBwcmV0dHlQcmludChkZWYsIGNvbnN0RW51bSwgMiwgdHJ1ZSkgKyAnXFxuJ1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZWNsYXJhdGlvbiArPSAnfSdcbiAgICAgICAgICByZXR1cm4gZGVjbGFyYXRpb25cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5qb2luKCdcXG5cXG4nKSArICdcXG4nXG5cbiAgcmV0dXJuIHtcbiAgICBkdHMsXG4gICAgZXhwb3J0cyxcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZWFkSW50ZXJtZWRpYXRlVHlwZUZpbGUoZmlsZTogc3RyaW5nKSB7XG4gIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKGZpbGUsICd1dGY4JylcblxuICBjb25zdCBkZWZzID0gY29udGVudFxuICAgIC5zcGxpdCgnXFxuJylcbiAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgLm1hcCgobGluZSkgPT4ge1xuICAgICAgbGluZSA9IGxpbmUudHJpbSgpXG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGxpbmUpIGFzIFR5cGVEZWZMaW5lXG4gICAgICAvLyBDb252ZXJ0IGVzY2FwZWQgbmV3bGluZXMgYmFjayB0byBhY3R1YWwgbmV3bGluZXMgaW4ganNfZG9jIGZpZWxkc1xuICAgICAgaWYgKHBhcnNlZC5qc19kb2MpIHtcbiAgICAgICAgcGFyc2VkLmpzX2RvYyA9IHBhcnNlZC5qc19kb2MucmVwbGFjZSgvXFxcXG4vZywgJ1xcbicpXG4gICAgICB9XG4gICAgICAvLyBDb252ZXJ0IGVzY2FwZWQgbmV3bGluZXMgdG8gYWN0dWFsIG5ld2xpbmVzIGluIGRlZiBmaWVsZHMgZm9yIHN0cnVjdC9jbGFzcy9pbnRlcmZhY2UvdHlwZSB0eXBlc1xuICAgICAgLy8gd2hlcmUgXFxuIHJlcHJlc2VudHMgbWV0aG9kL2ZpZWxkIHNlcGFyYXRvcnMgdGhhdCBzaG91bGQgYmUgYWN0dWFsIG5ld2xpbmVzXG4gICAgICBpZiAocGFyc2VkLmRlZikge1xuICAgICAgICBwYXJzZWQuZGVmID0gcGFyc2VkLmRlZi5yZXBsYWNlKC9cXFxcbi9nLCAnXFxuJylcbiAgICAgIH1cbiAgICAgIHJldHVybiBwYXJzZWRcbiAgICB9KVxuXG4gIC8vIG1vdmUgYWxsIGBzdHJ1Y3RgIGRlZiB0byB0aGUgdmVyeSB0b3BcbiAgLy8gYW5kIG9yZGVyIHRoZSByZXN0IGFscGhhYmV0aWNhbGx5LlxuICByZXR1cm4gZGVmcy5zb3J0KChhLCBiKSA9PiB7XG4gICAgaWYgKGEua2luZCA9PT0gVHlwZURlZktpbmQuU3RydWN0KSB7XG4gICAgICBpZiAoYi5raW5kID09PSBUeXBlRGVmS2luZC5TdHJ1Y3QpIHtcbiAgICAgICAgcmV0dXJuIGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSlcbiAgICAgIH1cbiAgICAgIHJldHVybiAtMVxuICAgIH0gZWxzZSBpZiAoYi5raW5kID09PSBUeXBlRGVmS2luZC5TdHJ1Y3QpIHtcbiAgICAgIHJldHVybiAxXG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpXG4gICAgfVxuICB9KVxufVxuXG5mdW5jdGlvbiBwcmVwcm9jZXNzVHlwZURlZihkZWZzOiBUeXBlRGVmTGluZVtdKTogTWFwPHN0cmluZywgVHlwZURlZkxpbmVbXT4ge1xuICBjb25zdCBuYW1lc3BhY2VHcm91cGVkID0gbmV3IE1hcDxzdHJpbmcsIFR5cGVEZWZMaW5lW10+KClcbiAgY29uc3QgY2xhc3NEZWZzID0gbmV3IE1hcDxzdHJpbmcsIFR5cGVEZWZMaW5lPigpXG5cbiAgZm9yIChjb25zdCBkZWYgb2YgZGVmcykge1xuICAgIGNvbnN0IG5hbWVzcGFjZSA9IGRlZi5qc19tb2QgPz8gVE9QX0xFVkVMX05BTUVTUEFDRVxuICAgIGlmICghbmFtZXNwYWNlR3JvdXBlZC5oYXMobmFtZXNwYWNlKSkge1xuICAgICAgbmFtZXNwYWNlR3JvdXBlZC5zZXQobmFtZXNwYWNlLCBbXSlcbiAgICB9XG5cbiAgICBjb25zdCBncm91cCA9IG5hbWVzcGFjZUdyb3VwZWQuZ2V0KG5hbWVzcGFjZSkhXG5cbiAgICBpZiAoZGVmLmtpbmQgPT09IFR5cGVEZWZLaW5kLlN0cnVjdCkge1xuICAgICAgZ3JvdXAucHVzaChkZWYpXG4gICAgICBjbGFzc0RlZnMuc2V0KGRlZi5uYW1lLCBkZWYpXG4gICAgfSBlbHNlIGlmIChkZWYua2luZCA9PT0gVHlwZURlZktpbmQuRXh0ZW5kcykge1xuICAgICAgY29uc3QgY2xhc3NEZWYgPSBjbGFzc0RlZnMuZ2V0KGRlZi5uYW1lKVxuICAgICAgaWYgKGNsYXNzRGVmKSB7XG4gICAgICAgIGNsYXNzRGVmLmV4dGVuZHMgPSBkZWYuZGVmXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChkZWYua2luZCA9PT0gVHlwZURlZktpbmQuSW1wbCkge1xuICAgICAgLy8gbWVyZ2UgYGltcGxgIGludG8gY2xhc3MgZGVmaW5pdGlvblxuICAgICAgY29uc3QgY2xhc3NEZWYgPSBjbGFzc0RlZnMuZ2V0KGRlZi5uYW1lKVxuICAgICAgaWYgKGNsYXNzRGVmKSB7XG4gICAgICAgIGlmIChjbGFzc0RlZi5kZWYpIHtcbiAgICAgICAgICBjbGFzc0RlZi5kZWYgKz0gJ1xcbidcbiAgICAgICAgfVxuXG4gICAgICAgIGNsYXNzRGVmLmRlZiArPSBkZWYuZGVmXG4gICAgICAgIC8vIENvbnZlcnQgYW55IHJlbWFpbmluZyBcXG4gc2VxdWVuY2VzIGluIHRoZSBtZXJnZWQgZGVmIHRvIGFjdHVhbCBuZXdsaW5lc1xuICAgICAgICBpZiAoY2xhc3NEZWYuZGVmKSB7XG4gICAgICAgICAgY2xhc3NEZWYuZGVmID0gY2xhc3NEZWYuZGVmLnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGdyb3VwLnB1c2goZGVmKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBuYW1lc3BhY2VHcm91cGVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb3JyZWN0U3RyaW5nSWRlbnQoc3JjOiBzdHJpbmcsIGlkZW50OiBudW1iZXIpOiBzdHJpbmcge1xuICBsZXQgYnJhY2tldERlcHRoID0gMFxuICBjb25zdCByZXN1bHQgPSBzcmNcbiAgICAuc3BsaXQoJ1xcbicpXG4gICAgLm1hcCgobGluZSkgPT4ge1xuICAgICAgbGluZSA9IGxpbmUudHJpbSgpXG4gICAgICBpZiAobGluZSA9PT0gJycpIHtcbiAgICAgICAgcmV0dXJuICcnXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzSW5NdWx0aWxpbmVDb21tZW50ID0gbGluZS5zdGFydHNXaXRoKCcqJylcbiAgICAgIGNvbnN0IGlzQ2xvc2luZ0JyYWNrZXQgPSBsaW5lLmVuZHNXaXRoKCd9JylcbiAgICAgIGNvbnN0IGlzT3BlbmluZ0JyYWNrZXQgPSBsaW5lLmVuZHNXaXRoKCd7JylcbiAgICAgIGNvbnN0IGlzVHlwZURlY2xhcmF0aW9uID0gbGluZS5lbmRzV2l0aCgnPScpXG4gICAgICBjb25zdCBpc1R5cGVWYXJpYW50ID0gbGluZS5zdGFydHNXaXRoKCd8JylcblxuICAgICAgbGV0IHJpZ2h0SW5kZW50ID0gaWRlbnRcbiAgICAgIGlmICgoaXNPcGVuaW5nQnJhY2tldCB8fCBpc1R5cGVEZWNsYXJhdGlvbikgJiYgIWlzSW5NdWx0aWxpbmVDb21tZW50KSB7XG4gICAgICAgIGJyYWNrZXREZXB0aCArPSAxXG4gICAgICAgIHJpZ2h0SW5kZW50ICs9IChicmFja2V0RGVwdGggLSAxKSAqIDJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBpc0Nsb3NpbmdCcmFja2V0ICYmXG4gICAgICAgICAgYnJhY2tldERlcHRoID4gMCAmJlxuICAgICAgICAgICFpc0luTXVsdGlsaW5lQ29tbWVudCAmJlxuICAgICAgICAgICFpc1R5cGVWYXJpYW50XG4gICAgICAgICkge1xuICAgICAgICAgIGJyYWNrZXREZXB0aCAtPSAxXG4gICAgICAgIH1cbiAgICAgICAgcmlnaHRJbmRlbnQgKz0gYnJhY2tldERlcHRoICogMlxuICAgICAgfVxuXG4gICAgICBpZiAoaXNJbk11bHRpbGluZUNvbW1lbnQpIHtcbiAgICAgICAgcmlnaHRJbmRlbnQgKz0gMVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzID0gYCR7JyAnLnJlcGVhdChyaWdodEluZGVudCl9JHtsaW5lfWBcblxuICAgICAgcmV0dXJuIHNcbiAgICB9KVxuICAgIC5qb2luKCdcXG4nKVxuXG4gIHJldHVybiByZXN1bHRcbn1cbiIsImltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7IHJlYWROYXBpQ29uZmlnIH0gZnJvbSAnLi9jb25maWcuanMnXG5cbmludGVyZmFjZSBNaW5pbWFsTmFwaU9wdGlvbnMge1xuICBjd2Q6IHN0cmluZ1xuICBjb25maWdQYXRoPzogc3RyaW5nXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVhZENvbmZpZyhvcHRpb25zOiBNaW5pbWFsTmFwaU9wdGlvbnMpIHtcbiAgY29uc3QgcmVzb2x2ZVBhdGggPSAoLi4ucGF0aHM6IHN0cmluZ1tdKSA9PiByZXNvbHZlKG9wdGlvbnMuY3dkLCAuLi5wYXRocylcbiAgY29uc3QgY29uZmlnID0gYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgcmVzb2x2ZVBhdGgob3B0aW9ucy5wYWNrYWdlSnNvblBhdGggPz8gJ3BhY2thZ2UuanNvbicpLFxuICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmVQYXRoKG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gIClcbiAgcmV0dXJuIGNvbmZpZ1xufVxuIiwiaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSwgcGFyc2UgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCAqIGFzIGNvbG9ycyBmcm9tICdjb2xvcmV0dGUnXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdEFydGlmYWN0c09wdGlvbnMsXG4gIHR5cGUgQXJ0aWZhY3RzT3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL2FydGlmYWN0cy5qcydcbmltcG9ydCB7XG4gIHJlYWROYXBpQ29uZmlnLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIHJlYWRGaWxlQXN5bmMsXG4gIHdyaXRlRmlsZUFzeW5jLFxuICBVbmlBcmNoc0J5UGxhdGZvcm0sXG4gIHJlYWRkaXJBc3luYyxcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCdhcnRpZmFjdHMnKVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29sbGVjdEFydGlmYWN0cyh1c2VyT3B0aW9uczogQXJ0aWZhY3RzT3B0aW9ucykge1xuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0QXJ0aWZhY3RzT3B0aW9ucyh1c2VyT3B0aW9ucylcblxuICBjb25zdCByZXNvbHZlUGF0aCA9ICguLi5wYXRoczogc3RyaW5nW10pID0+IHJlc29sdmUob3B0aW9ucy5jd2QsIC4uLnBhdGhzKVxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlUGF0aChvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcbiAgY29uc3QgeyB0YXJnZXRzLCBiaW5hcnlOYW1lLCBwYWNrYWdlTmFtZSB9ID0gYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgcGFja2FnZUpzb25QYXRoLFxuICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmVQYXRoKG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gIClcblxuICBjb25zdCBkaXN0RGlycyA9IHRhcmdldHMubWFwKChwbGF0Zm9ybSkgPT5cbiAgICBqb2luKG9wdGlvbnMuY3dkLCBvcHRpb25zLm5wbURpciwgcGxhdGZvcm0ucGxhdGZvcm1BcmNoQUJJKSxcbiAgKVxuXG4gIGNvbnN0IHVuaXZlcnNhbFNvdXJjZUJpbnMgPSBuZXcgU2V0KFxuICAgIHRhcmdldHNcbiAgICAgIC5maWx0ZXIoKHBsYXRmb3JtKSA9PiBwbGF0Zm9ybS5hcmNoID09PSAndW5pdmVyc2FsJylcbiAgICAgIC5mbGF0TWFwKChwKSA9PlxuICAgICAgICBVbmlBcmNoc0J5UGxhdGZvcm1bcC5wbGF0Zm9ybV0/Lm1hcCgoYSkgPT4gYCR7cC5wbGF0Zm9ybX0tJHthfWApLFxuICAgICAgKVxuICAgICAgLmZpbHRlcihCb29sZWFuKSBhcyBzdHJpbmdbXSxcbiAgKVxuXG4gIGF3YWl0IGNvbGxlY3ROb2RlQmluYXJpZXMoam9pbihvcHRpb25zLmN3ZCwgb3B0aW9ucy5vdXRwdXREaXIpKS50aGVuKFxuICAgIChvdXRwdXQpID0+XG4gICAgICBQcm9taXNlLmFsbChcbiAgICAgICAgb3V0cHV0Lm1hcChhc3luYyAoZmlsZVBhdGgpID0+IHtcbiAgICAgICAgICBkZWJ1Zy5pbmZvKGBSZWFkIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoZmlsZVBhdGgpfV1gKVxuICAgICAgICAgIGNvbnN0IHNvdXJjZUNvbnRlbnQgPSBhd2FpdCByZWFkRmlsZUFzeW5jKGZpbGVQYXRoKVxuICAgICAgICAgIGNvbnN0IHBhcnNlZE5hbWUgPSBwYXJzZShmaWxlUGF0aClcbiAgICAgICAgICBjb25zdCB0ZXJtcyA9IHBhcnNlZE5hbWUubmFtZS5zcGxpdCgnLicpXG4gICAgICAgICAgY29uc3QgcGxhdGZvcm1BcmNoQUJJID0gdGVybXMucG9wKCkhXG4gICAgICAgICAgY29uc3QgX2JpbmFyeU5hbWUgPSB0ZXJtcy5qb2luKCcuJylcblxuICAgICAgICAgIGlmIChfYmluYXJ5TmFtZSAhPT0gYmluYXJ5TmFtZSkge1xuICAgICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgICAgYFske19iaW5hcnlOYW1lfV0gaXMgbm90IG1hdGNoZWQgd2l0aCBbJHtiaW5hcnlOYW1lfV0sIHNraXBgLFxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnN0IGRpciA9IGRpc3REaXJzLmZpbmQoKGRpcikgPT4gZGlyLmluY2x1ZGVzKHBsYXRmb3JtQXJjaEFCSSkpXG4gICAgICAgICAgaWYgKCFkaXIgJiYgdW5pdmVyc2FsU291cmNlQmlucy5oYXMocGxhdGZvcm1BcmNoQUJJKSkge1xuICAgICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgICAgYFske3BsYXRmb3JtQXJjaEFCSX1dIGhhcyBubyBkaXN0IGRpciBidXQgaXQgaXMgc291cmNlIGJpbiBmb3IgdW5pdmVyc2FsIGFyY2gsIHNraXBgLFxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgcmV0dXJuXG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghZGlyKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGRpc3QgZGlyIGZvdW5kIGZvciAke2ZpbGVQYXRofWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgZGlzdEZpbGVQYXRoID0gam9pbihkaXIsIHBhcnNlZE5hbWUuYmFzZSlcbiAgICAgICAgICBkZWJ1Zy5pbmZvKFxuICAgICAgICAgICAgYFdyaXRlIGZpbGUgY29udGVudCB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KGRpc3RGaWxlUGF0aCl9XWAsXG4gICAgICAgICAgKVxuICAgICAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGRpc3RGaWxlUGF0aCwgc291cmNlQ29udGVudClcbiAgICAgICAgICBjb25zdCBkaXN0RmlsZVBhdGhMb2NhbCA9IGpvaW4oXG4gICAgICAgICAgICBwYXJzZShwYWNrYWdlSnNvblBhdGgpLmRpcixcbiAgICAgICAgICAgIHBhcnNlZE5hbWUuYmFzZSxcbiAgICAgICAgICApXG4gICAgICAgICAgZGVidWcuaW5mbyhcbiAgICAgICAgICAgIGBXcml0ZSBmaWxlIGNvbnRlbnQgdG8gWyR7Y29sb3JzLnllbGxvd0JyaWdodChkaXN0RmlsZVBhdGhMb2NhbCl9XWAsXG4gICAgICAgICAgKVxuICAgICAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGRpc3RGaWxlUGF0aExvY2FsLCBzb3VyY2VDb250ZW50KVxuICAgICAgICB9KSxcbiAgICAgICksXG4gIClcblxuICBjb25zdCB3YXNpVGFyZ2V0ID0gdGFyZ2V0cy5maW5kKCh0KSA9PiB0LnBsYXRmb3JtID09PSAnd2FzaScpXG4gIGlmICh3YXNpVGFyZ2V0KSB7XG4gICAgY29uc3Qgd2FzaURpciA9IGpvaW4oXG4gICAgICBvcHRpb25zLmN3ZCxcbiAgICAgIG9wdGlvbnMubnBtRGlyLFxuICAgICAgd2FzaVRhcmdldC5wbGF0Zm9ybUFyY2hBQkksXG4gICAgKVxuICAgIGNvbnN0IGNqc0ZpbGUgPSBqb2luKFxuICAgICAgb3B0aW9ucy5idWlsZE91dHB1dERpciA/PyBvcHRpb25zLmN3ZCxcbiAgICAgIGAke2JpbmFyeU5hbWV9Lndhc2kuY2pzYCxcbiAgICApXG4gICAgY29uc3Qgd29ya2VyRmlsZSA9IGpvaW4oXG4gICAgICBvcHRpb25zLmJ1aWxkT3V0cHV0RGlyID8/IG9wdGlvbnMuY3dkLFxuICAgICAgYHdhc2ktd29ya2VyLm1qc2AsXG4gICAgKVxuICAgIGNvbnN0IGJyb3dzZXJFbnRyeSA9IGpvaW4oXG4gICAgICBvcHRpb25zLmJ1aWxkT3V0cHV0RGlyID8/IG9wdGlvbnMuY3dkLFxuICAgICAgYCR7YmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYCxcbiAgICApXG4gICAgY29uc3QgYnJvd3NlcldvcmtlckZpbGUgPSBqb2luKFxuICAgICAgb3B0aW9ucy5idWlsZE91dHB1dERpciA/PyBvcHRpb25zLmN3ZCxcbiAgICAgIGB3YXNpLXdvcmtlci1icm93c2VyLm1qc2AsXG4gICAgKVxuICAgIGRlYnVnLmluZm8oXG4gICAgICBgTW92ZSB3YXNpIGJpbmRpbmcgZmlsZSBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KFxuICAgICAgICBjanNGaWxlLFxuICAgICAgKX1dIHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQod2FzaURpcil9XWAsXG4gICAgKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgam9pbih3YXNpRGlyLCBgJHtiaW5hcnlOYW1lfS53YXNpLmNqc2ApLFxuICAgICAgYXdhaXQgcmVhZEZpbGVBc3luYyhjanNGaWxlKSxcbiAgICApXG4gICAgZGVidWcuaW5mbyhcbiAgICAgIGBNb3ZlIHdhc2kgd29ya2VyIGZpbGUgWyR7Y29sb3JzLnllbGxvd0JyaWdodChcbiAgICAgICAgd29ya2VyRmlsZSxcbiAgICAgICl9XSB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KHdhc2lEaXIpfV1gLFxuICAgIClcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgIGpvaW4od2FzaURpciwgYHdhc2ktd29ya2VyLm1qc2ApLFxuICAgICAgYXdhaXQgcmVhZEZpbGVBc3luYyh3b3JrZXJGaWxlKSxcbiAgICApXG4gICAgZGVidWcuaW5mbyhcbiAgICAgIGBNb3ZlIHdhc2kgYnJvd3NlciBlbnRyeSBmaWxlIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoXG4gICAgICAgIGJyb3dzZXJFbnRyeSxcbiAgICAgICl9XSB0byBbJHtjb2xvcnMueWVsbG93QnJpZ2h0KHdhc2lEaXIpfV1gLFxuICAgIClcbiAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgIGpvaW4od2FzaURpciwgYCR7YmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYCksXG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vdml0ZWpzL3ZpdGUvaXNzdWVzLzg0MjdcbiAgICAgIChhd2FpdCByZWFkRmlsZUFzeW5jKGJyb3dzZXJFbnRyeSwgJ3V0ZjgnKSkucmVwbGFjZShcbiAgICAgICAgYG5ldyBVUkwoJy4vd2FzaS13b3JrZXItYnJvd3Nlci5tanMnLCBpbXBvcnQubWV0YS51cmwpYCxcbiAgICAgICAgYG5ldyBVUkwoJyR7cGFja2FnZU5hbWV9LXdhc20zMi13YXNpL3dhc2ktd29ya2VyLWJyb3dzZXIubWpzJywgaW1wb3J0Lm1ldGEudXJsKWAsXG4gICAgICApLFxuICAgIClcbiAgICBkZWJ1Zy5pbmZvKFxuICAgICAgYE1vdmUgd2FzaSBicm93c2VyIHdvcmtlciBmaWxlIFske2NvbG9ycy55ZWxsb3dCcmlnaHQoXG4gICAgICAgIGJyb3dzZXJXb3JrZXJGaWxlLFxuICAgICAgKX1dIHRvIFske2NvbG9ycy55ZWxsb3dCcmlnaHQod2FzaURpcil9XWAsXG4gICAgKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgam9pbih3YXNpRGlyLCBgd2FzaS13b3JrZXItYnJvd3Nlci5tanNgKSxcbiAgICAgIGF3YWl0IHJlYWRGaWxlQXN5bmMoYnJvd3NlcldvcmtlckZpbGUpLFxuICAgIClcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0Tm9kZUJpbmFyaWVzKHJvb3Q6IHN0cmluZykge1xuICBjb25zdCBmaWxlcyA9IGF3YWl0IHJlYWRkaXJBc3luYyhyb290LCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSlcbiAgY29uc3Qgbm9kZUJpbmFyaWVzID0gZmlsZXNcbiAgICAuZmlsdGVyKFxuICAgICAgKGZpbGUpID0+XG4gICAgICAgIGZpbGUuaXNGaWxlKCkgJiZcbiAgICAgICAgKGZpbGUubmFtZS5lbmRzV2l0aCgnLm5vZGUnKSB8fCBmaWxlLm5hbWUuZW5kc1dpdGgoJy53YXNtJykpLFxuICAgIClcbiAgICAubWFwKChmaWxlKSA9PiBqb2luKHJvb3QsIGZpbGUubmFtZSkpXG5cbiAgY29uc3QgZGlycyA9IGZpbGVzLmZpbHRlcigoZmlsZSkgPT4gZmlsZS5pc0RpcmVjdG9yeSgpKVxuICBmb3IgKGNvbnN0IGRpciBvZiBkaXJzKSB7XG4gICAgaWYgKGRpci5uYW1lICE9PSAnbm9kZV9tb2R1bGVzJykge1xuICAgICAgbm9kZUJpbmFyaWVzLnB1c2goLi4uKGF3YWl0IGNvbGxlY3ROb2RlQmluYXJpZXMoam9pbihyb290LCBkaXIubmFtZSkpKSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG5vZGVCaW5hcmllc1xufVxuIiwiZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNqc0JpbmRpbmcoXG4gIGxvY2FsTmFtZTogc3RyaW5nLFxuICBwa2dOYW1lOiBzdHJpbmcsXG4gIGlkZW50czogc3RyaW5nW10sXG4gIHBhY2thZ2VWZXJzaW9uPzogc3RyaW5nLFxuKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke2JpbmRpbmdIZWFkZXJ9XG4ke2NyZWF0ZUNvbW1vbkJpbmRpbmcobG9jYWxOYW1lLCBwa2dOYW1lLCBwYWNrYWdlVmVyc2lvbil9XG5tb2R1bGUuZXhwb3J0cyA9IG5hdGl2ZUJpbmRpbmdcbiR7aWRlbnRzXG4gIC5tYXAoKGlkZW50KSA9PiBgbW9kdWxlLmV4cG9ydHMuJHtpZGVudH0gPSBuYXRpdmVCaW5kaW5nLiR7aWRlbnR9YClcbiAgLmpvaW4oJ1xcbicpfVxuYFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRXNtQmluZGluZyhcbiAgbG9jYWxOYW1lOiBzdHJpbmcsXG4gIHBrZ05hbWU6IHN0cmluZyxcbiAgaWRlbnRzOiBzdHJpbmdbXSxcbiAgcGFja2FnZVZlcnNpb24/OiBzdHJpbmcsXG4pOiBzdHJpbmcge1xuICByZXR1cm4gYCR7YmluZGluZ0hlYWRlcn1cbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgfSBmcm9tICdub2RlOm1vZHVsZSdcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybClcbmNvbnN0IF9fZGlybmFtZSA9IG5ldyBVUkwoJy4nLCBpbXBvcnQubWV0YS51cmwpLnBhdGhuYW1lXG5cbiR7Y3JlYXRlQ29tbW9uQmluZGluZyhsb2NhbE5hbWUsIHBrZ05hbWUsIHBhY2thZ2VWZXJzaW9uKX1cbmNvbnN0IHsgJHtpZGVudHMuam9pbignLCAnKX0gfSA9IG5hdGl2ZUJpbmRpbmdcbiR7aWRlbnRzLm1hcCgoaWRlbnQpID0+IGBleHBvcnQgeyAke2lkZW50fSB9YCkuam9pbignXFxuJyl9XG5gXG59XG5cbmNvbnN0IGJpbmRpbmdIZWFkZXIgPSBgLy8gcHJldHRpZXItaWdub3JlXG4vKiBlc2xpbnQtZGlzYWJsZSAqL1xuLy8gQHRzLW5vY2hlY2tcbi8qIGF1dG8tZ2VuZXJhdGVkIGJ5IE5BUEktUlMgKi9cbmBcblxuZnVuY3Rpb24gY3JlYXRlQ29tbW9uQmluZGluZyhcbiAgbG9jYWxOYW1lOiBzdHJpbmcsXG4gIHBrZ05hbWU6IHN0cmluZyxcbiAgcGFja2FnZVZlcnNpb24/OiBzdHJpbmcsXG4pOiBzdHJpbmcge1xuICBmdW5jdGlvbiByZXF1aXJlVHVwbGUodHVwbGU6IHN0cmluZywgaWRlbnRTaXplID0gOCkge1xuICAgIGNvbnN0IGlkZW50TG93ID0gJyAnLnJlcGVhdChpZGVudFNpemUgLSAyKVxuICAgIGNvbnN0IGlkZW50ID0gJyAnLnJlcGVhdChpZGVudFNpemUpXG4gICAgY29uc3QgdmVyc2lvbkNoZWNrID0gcGFja2FnZVZlcnNpb25cbiAgICAgID8gYFxuJHtpZGVudExvd310cnkge1xuJHtpZGVudH1jb25zdCBiaW5kaW5nID0gcmVxdWlyZSgnJHtwa2dOYW1lfS0ke3R1cGxlfScpXG4ke2lkZW50fWNvbnN0IGJpbmRpbmdQYWNrYWdlVmVyc2lvbiA9IHJlcXVpcmUoJyR7cGtnTmFtZX0tJHt0dXBsZX0vcGFja2FnZS5qc29uJykudmVyc2lvblxuJHtpZGVudH1pZiAoYmluZGluZ1BhY2thZ2VWZXJzaW9uICE9PSAnJHtwYWNrYWdlVmVyc2lvbn0nICYmIHByb2Nlc3MuZW52Lk5BUElfUlNfRU5GT1JDRV9WRVJTSU9OX0NIRUNLICYmIHByb2Nlc3MuZW52Lk5BUElfUlNfRU5GT1JDRV9WRVJTSU9OX0NIRUNLICE9PSAnMCcpIHtcbiR7aWRlbnR9ICB0aHJvdyBuZXcgRXJyb3IoXFxgTmF0aXZlIGJpbmRpbmcgcGFja2FnZSB2ZXJzaW9uIG1pc21hdGNoLCBleHBlY3RlZCAke3BhY2thZ2VWZXJzaW9ufSBidXQgZ290IFxcJHtiaW5kaW5nUGFja2FnZVZlcnNpb259LiBZb3UgY2FuIHJlaW5zdGFsbCBkZXBlbmRlbmNpZXMgdG8gZml4IHRoaXMgaXNzdWUuXFxgKVxuJHtpZGVudH19XG4ke2lkZW50fXJldHVybiBiaW5kaW5nXG4ke2lkZW50TG93fX0gY2F0Y2ggKGUpIHtcbiR7aWRlbnR9bG9hZEVycm9ycy5wdXNoKGUpXG4ke2lkZW50TG93fX1gXG4gICAgICA6IGBcbiR7aWRlbnRMb3d9dHJ5IHtcbiR7aWRlbnR9cmV0dXJuIHJlcXVpcmUoJyR7cGtnTmFtZX0tJHt0dXBsZX0nKVxuJHtpZGVudExvd319IGNhdGNoIChlKSB7XG4ke2lkZW50fWxvYWRFcnJvcnMucHVzaChlKVxuJHtpZGVudExvd319YFxuICAgIHJldHVybiBgdHJ5IHtcbiR7aWRlbnR9cmV0dXJuIHJlcXVpcmUoJy4vJHtsb2NhbE5hbWV9LiR7dHVwbGV9Lm5vZGUnKVxuJHtpZGVudExvd319IGNhdGNoIChlKSB7XG4ke2lkZW50fWxvYWRFcnJvcnMucHVzaChlKVxuJHtpZGVudExvd319JHt2ZXJzaW9uQ2hlY2t9YFxuICB9XG5cbiAgcmV0dXJuIGBjb25zdCB7IHJlYWRGaWxlU3luYyB9ID0gcmVxdWlyZSgnbm9kZTpmcycpXG5sZXQgbmF0aXZlQmluZGluZyA9IG51bGxcbmNvbnN0IGxvYWRFcnJvcnMgPSBbXVxuXG5jb25zdCBpc011c2wgPSAoKSA9PiB7XG4gIGxldCBtdXNsID0gZmFsc2VcbiAgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdsaW51eCcpIHtcbiAgICBtdXNsID0gaXNNdXNsRnJvbUZpbGVzeXN0ZW0oKVxuICAgIGlmIChtdXNsID09PSBudWxsKSB7XG4gICAgICBtdXNsID0gaXNNdXNsRnJvbVJlcG9ydCgpXG4gICAgfVxuICAgIGlmIChtdXNsID09PSBudWxsKSB7XG4gICAgICBtdXNsID0gaXNNdXNsRnJvbUNoaWxkUHJvY2VzcygpXG4gICAgfVxuICB9XG4gIHJldHVybiBtdXNsXG59XG5cbmNvbnN0IGlzRmlsZU11c2wgPSAoZikgPT4gZi5pbmNsdWRlcygnbGliYy5tdXNsLScpIHx8IGYuaW5jbHVkZXMoJ2xkLW11c2wtJylcblxuY29uc3QgaXNNdXNsRnJvbUZpbGVzeXN0ZW0gPSAoKSA9PiB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHJlYWRGaWxlU3luYygnL3Vzci9iaW4vbGRkJywgJ3V0Zi04JykuaW5jbHVkZXMoJ211c2wnKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmNvbnN0IGlzTXVzbEZyb21SZXBvcnQgPSAoKSA9PiB7XG4gIGxldCByZXBvcnQgPSBudWxsXG4gIGlmICh0eXBlb2YgcHJvY2Vzcy5yZXBvcnQ/LmdldFJlcG9ydCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHByb2Nlc3MucmVwb3J0LmV4Y2x1ZGVOZXR3b3JrID0gdHJ1ZVxuICAgIHJlcG9ydCA9IHByb2Nlc3MucmVwb3J0LmdldFJlcG9ydCgpXG4gIH1cbiAgaWYgKCFyZXBvcnQpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG4gIGlmIChyZXBvcnQuaGVhZGVyICYmIHJlcG9ydC5oZWFkZXIuZ2xpYmNWZXJzaW9uUnVudGltZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KHJlcG9ydC5zaGFyZWRPYmplY3RzKSkge1xuICAgIGlmIChyZXBvcnQuc2hhcmVkT2JqZWN0cy5zb21lKGlzRmlsZU11c2wpKSB7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2Vcbn1cblxuY29uc3QgaXNNdXNsRnJvbUNoaWxkUHJvY2VzcyA9ICgpID0+IHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gcmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKCdsZGQgLS12ZXJzaW9uJywgeyBlbmNvZGluZzogJ3V0ZjgnIH0pLmluY2x1ZGVzKCdtdXNsJylcbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vIElmIHdlIHJlYWNoIHRoaXMgY2FzZSwgd2UgZG9uJ3Qga25vdyBpZiB0aGUgc3lzdGVtIGlzIG11c2wgb3Igbm90LCBzbyBpcyBiZXR0ZXIgdG8ganVzdCBmYWxsYmFjayB0byBmYWxzZVxuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVOYXRpdmUoKSB7XG4gIGlmIChwcm9jZXNzLmVudi5OQVBJX1JTX05BVElWRV9MSUJSQVJZX1BBVEgpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHJlcXVpcmUocHJvY2Vzcy5lbnYuTkFQSV9SU19OQVRJVkVfTElCUkFSWV9QQVRIKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvYWRFcnJvcnMucHVzaChlcnIpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdhbmRyb2lkJykge1xuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdhbmRyb2lkLWFybTY0Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm0nKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnYW5kcm9pZC1hcm0tZWFiaScpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBBbmRyb2lkIFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICd4NjQnKSB7XG4gICAgICBpZiAocHJvY2Vzcy5jb25maWc/LnZhcmlhYmxlcz8uc2hsaWJfc3VmZml4ID09PSAnZGxsLmEnIHx8IHByb2Nlc3MuY29uZmlnPy52YXJpYWJsZXM/Lm5vZGVfdGFyZ2V0X3R5cGUgPT09ICdzaGFyZWRfbGlicmFyeScpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ3dpbjMyLXg2NC1nbnUnKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCd3aW4zMi14NjQtbXN2YycpfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnaWEzMicpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCd3aW4zMi1pYTMyLW1zdmMnKX1cbiAgICB9IGVsc2UgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ2FybTY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ3dpbjMyLWFybTY0LW1zdmMnKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gV2luZG93czogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIGlmIChwcm9jZXNzLnBsYXRmb3JtID09PSAnZGFyd2luJykge1xuICAgICR7cmVxdWlyZVR1cGxlKCdkYXJ3aW4tdW5pdmVyc2FsJywgNil9XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3g2NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdkYXJ3aW4teDY0Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdkYXJ3aW4tYXJtNjQnKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gbWFjT1M6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2ZyZWVic2QnKSB7XG4gICAgaWYgKHByb2Nlc3MuYXJjaCA9PT0gJ3g2NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdmcmVlYnNkLXg2NCcpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnZnJlZWJzZC1hcm02NCcpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBGcmVlQlNEOiBcXCR7cHJvY2Vzcy5hcmNofVxcYCkpXG4gICAgfVxuICB9IGVsc2UgaWYgKHByb2Nlc3MucGxhdGZvcm0gPT09ICdsaW51eCcpIHtcbiAgICBpZiAocHJvY2Vzcy5hcmNoID09PSAneDY0Jykge1xuICAgICAgaWYgKGlzTXVzbCgpKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC14NjQtbXVzbCcsIDEwKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC14NjQtZ251JywgMTApfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtNjQnKSB7XG4gICAgICBpZiAoaXNNdXNsKCkpIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWFybTY0LW11c2wnLCAxMCl9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtYXJtNjQtZ251JywgMTApfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtJykge1xuICAgICAgaWYgKGlzTXVzbCgpKSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1hcm0tbXVzbGVhYmloZicsIDEwKX1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1hcm0tZ251ZWFiaWhmJywgMTApfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnbG9vbmc2NCcpIHtcbiAgICAgIGlmIChpc011c2woKSkge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtbG9vbmc2NC1tdXNsJywgMTApfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LWxvb25nNjQtZ251JywgMTApfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAncmlzY3Y2NCcpIHtcbiAgICAgIGlmIChpc011c2woKSkge1xuICAgICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtcmlzY3Y2NC1tdXNsJywgMTApfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgJHtyZXF1aXJlVHVwbGUoJ2xpbnV4LXJpc2N2NjQtZ251JywgMTApfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAncHBjNjQnKSB7XG4gICAgICAke3JlcXVpcmVUdXBsZSgnbGludXgtcHBjNjQtZ251Jyl9XG4gICAgfSBlbHNlIGlmIChwcm9jZXNzLmFyY2ggPT09ICdzMzkweCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdsaW51eC1zMzkweC1nbnUnKX1cbiAgICB9IGVsc2Uge1xuICAgICAgbG9hZEVycm9ycy5wdXNoKG5ldyBFcnJvcihcXGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgb24gTGludXg6IFxcJHtwcm9jZXNzLmFyY2h9XFxgKSlcbiAgICB9XG4gIH0gZWxzZSBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ29wZW5oYXJtb255Jykge1xuICAgIGlmIChwcm9jZXNzLmFyY2ggPT09ICdhcm02NCcpIHtcbiAgICAgICR7cmVxdWlyZVR1cGxlKCdvcGVuaGFybW9ueS1hcm02NCcpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAneDY0Jykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ29wZW5oYXJtb255LXg2NCcpfVxuICAgIH0gZWxzZSBpZiAocHJvY2Vzcy5hcmNoID09PSAnYXJtJykge1xuICAgICAgJHtyZXF1aXJlVHVwbGUoJ29wZW5oYXJtb255LWFybScpfVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBvbiBPcGVuSGFybW9ueTogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBsb2FkRXJyb3JzLnB1c2gobmV3IEVycm9yKFxcYFVuc3VwcG9ydGVkIE9TOiBcXCR7cHJvY2Vzcy5wbGF0Zm9ybX0sIGFyY2hpdGVjdHVyZTogXFwke3Byb2Nlc3MuYXJjaH1cXGApKVxuICB9XG59XG5cbm5hdGl2ZUJpbmRpbmcgPSByZXF1aXJlTmF0aXZlKClcblxuaWYgKCFuYXRpdmVCaW5kaW5nIHx8IHByb2Nlc3MuZW52Lk5BUElfUlNfRk9SQ0VfV0FTSSkge1xuICBsZXQgd2FzaUJpbmRpbmcgPSBudWxsXG4gIGxldCB3YXNpQmluZGluZ0Vycm9yID0gbnVsbFxuICB0cnkge1xuICAgIHdhc2lCaW5kaW5nID0gcmVxdWlyZSgnLi8ke2xvY2FsTmFtZX0ud2FzaS5janMnKVxuICAgIG5hdGl2ZUJpbmRpbmcgPSB3YXNpQmluZGluZ1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBpZiAocHJvY2Vzcy5lbnYuTkFQSV9SU19GT1JDRV9XQVNJKSB7XG4gICAgICB3YXNpQmluZGluZ0Vycm9yID0gZXJyXG4gICAgfVxuICB9XG4gIGlmICghbmF0aXZlQmluZGluZyB8fCBwcm9jZXNzLmVudi5OQVBJX1JTX0ZPUkNFX1dBU0kpIHtcbiAgICB0cnkge1xuICAgICAgd2FzaUJpbmRpbmcgPSByZXF1aXJlKCcke3BrZ05hbWV9LXdhc20zMi13YXNpJylcbiAgICAgIG5hdGl2ZUJpbmRpbmcgPSB3YXNpQmluZGluZ1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKHByb2Nlc3MuZW52Lk5BUElfUlNfRk9SQ0VfV0FTSSkge1xuICAgICAgICBpZiAoIXdhc2lCaW5kaW5nRXJyb3IpIHtcbiAgICAgICAgICB3YXNpQmluZGluZ0Vycm9yID0gZXJyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgd2FzaUJpbmRpbmdFcnJvci5jYXVzZSA9IGVyclxuICAgICAgICB9XG4gICAgICAgIGxvYWRFcnJvcnMucHVzaChlcnIpXG4gICAgICB9XG4gICAgfVxuICB9XG4gIGlmIChwcm9jZXNzLmVudi5OQVBJX1JTX0ZPUkNFX1dBU0kgPT09ICdlcnJvcicgJiYgIXdhc2lCaW5kaW5nKSB7XG4gICAgY29uc3QgZXJyb3IgPSBuZXcgRXJyb3IoJ1dBU0kgYmluZGluZyBub3QgZm91bmQgYW5kIE5BUElfUlNfRk9SQ0VfV0FTSSBpcyBzZXQgdG8gZXJyb3InKVxuICAgIGVycm9yLmNhdXNlID0gd2FzaUJpbmRpbmdFcnJvclxuICAgIHRocm93IGVycm9yXG4gIH1cbn1cblxuaWYgKCFuYXRpdmVCaW5kaW5nKSB7XG4gIGlmIChsb2FkRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcXGBDYW5ub3QgZmluZCBuYXRpdmUgYmluZGluZy4gXFxgICtcbiAgICAgICAgXFxgbnBtIGhhcyBhIGJ1ZyByZWxhdGVkIHRvIG9wdGlvbmFsIGRlcGVuZGVuY2llcyAoaHR0cHM6Ly9naXRodWIuY29tL25wbS9jbGkvaXNzdWVzLzQ4MjgpLiBcXGAgK1xuICAgICAgICAnUGxlYXNlIHRyeSBcXGBucG0gaVxcYCBhZ2FpbiBhZnRlciByZW1vdmluZyBib3RoIHBhY2thZ2UtbG9jay5qc29uIGFuZCBub2RlX21vZHVsZXMgZGlyZWN0b3J5LicsXG4gICAgICB7XG4gICAgICAgIGNhdXNlOiBsb2FkRXJyb3JzLnJlZHVjZSgoZXJyLCBjdXIpID0+IHtcbiAgICAgICAgICBjdXIuY2F1c2UgPSBlcnJcbiAgICAgICAgICByZXR1cm4gY3VyXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICApXG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxcYEZhaWxlZCB0byBsb2FkIG5hdGl2ZSBiaW5kaW5nXFxgKVxufVxuYFxufVxuIiwiZXhwb3J0IGNvbnN0IGNyZWF0ZVdhc2lCcm93c2VyQmluZGluZyA9IChcbiAgd2FzaUZpbGVuYW1lOiBzdHJpbmcsXG4gIGluaXRpYWxNZW1vcnkgPSA0MDAwLFxuICBtYXhpbXVtTWVtb3J5ID0gNjU1MzYsXG4gIGZzID0gZmFsc2UsXG4gIGFzeW5jSW5pdCA9IGZhbHNlLFxuICBidWZmZXIgPSBmYWxzZSxcbiAgZXJyb3JFdmVudCA9IGZhbHNlLFxuKSA9PiB7XG4gIGNvbnN0IGZzSW1wb3J0ID0gZnNcbiAgICA/IGJ1ZmZlclxuICAgICAgPyBgaW1wb3J0IHsgbWVtZnMsIEJ1ZmZlciB9IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZS9mcydgXG4gICAgICA6IGBpbXBvcnQgeyBtZW1mcyB9IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZS9mcydgXG4gICAgOiAnJ1xuICBjb25zdCBidWZmZXJJbXBvcnQgPSBidWZmZXIgJiYgIWZzID8gYGltcG9ydCB7IEJ1ZmZlciB9IGZyb20gJ2J1ZmZlcidgIDogJydcbiAgY29uc3Qgd2FzaUNyZWF0aW9uID0gZnNcbiAgICA/IGBcbmV4cG9ydCBjb25zdCB7IGZzOiBfX2ZzLCB2b2w6IF9fdm9sdW1lIH0gPSBtZW1mcygpXG5cbmNvbnN0IF9fd2FzaSA9IG5ldyBfX1dBU0koe1xuICB2ZXJzaW9uOiAncHJldmlldzEnLFxuICBmczogX19mcyxcbiAgcHJlb3BlbnM6IHtcbiAgICAnLyc6ICcvJyxcbiAgfSxcbn0pYFxuICAgIDogYFxuY29uc3QgX193YXNpID0gbmV3IF9fV0FTSSh7XG4gIHZlcnNpb246ICdwcmV2aWV3MScsXG59KWBcblxuICBjb25zdCB3b3JrZXJGc0hhbmRsZXIgPSBmc1xuICAgID8gYCAgICB3b3JrZXIuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIF9fd2FzbUNyZWF0ZU9uTWVzc2FnZUZvckZzUHJveHkoX19mcykpXFxuYFxuICAgIDogJydcblxuICBjb25zdCB3b3JrZXJFcnJvckhhbmRsZXIgPSBlcnJvckV2ZW50XG4gICAgPyBgICAgIHdvcmtlci5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmRhdGEgJiYgdHlwZW9mIGV2ZW50LmRhdGEgPT09ICdvYmplY3QnICYmIGV2ZW50LmRhdGEudHlwZSA9PT0gJ2Vycm9yJykge1xuICAgICAgICB3aW5kb3cuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoJ25hcGktcnMtd29ya2VyLWVycm9yJywgeyBkZXRhaWw6IGV2ZW50LmRhdGEgfSkpXG4gICAgICB9XG4gICAgfSlcbmBcbiAgICA6ICcnXG5cbiAgY29uc3QgZW1uYXBpSW5qZWN0QnVmZmVyID0gYnVmZmVyXG4gICAgPyAnX19lbW5hcGlDb250ZXh0LmZlYXR1cmUuQnVmZmVyID0gQnVmZmVyJ1xuICAgIDogJydcbiAgY29uc3QgZW1uYXBpSW5zdGFudGlhdGVJbXBvcnQgPSBhc3luY0luaXRcbiAgICA/IGBpbnN0YW50aWF0ZU5hcGlNb2R1bGUgYXMgX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVgXG4gICAgOiBgaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYyBhcyBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmNgXG4gIGNvbnN0IGVtbmFwaUluc3RhbnRpYXRlQ2FsbCA9IGFzeW5jSW5pdFxuICAgID8gYGF3YWl0IF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlYFxuICAgIDogYF9fZW1uYXBpSW5zdGFudGlhdGVOYXBpTW9kdWxlU3luY2BcblxuICByZXR1cm4gYGltcG9ydCB7XG4gIGNyZWF0ZU9uTWVzc2FnZSBhcyBfX3dhc21DcmVhdGVPbk1lc3NhZ2VGb3JGc1Byb3h5LFxuICBnZXREZWZhdWx0Q29udGV4dCBhcyBfX2VtbmFwaUdldERlZmF1bHRDb250ZXh0LFxuICAke2VtbmFwaUluc3RhbnRpYXRlSW1wb3J0fSxcbiAgV0FTSSBhcyBfX1dBU0ksXG59IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZSdcbiR7ZnNJbXBvcnR9XG4ke2J1ZmZlckltcG9ydH1cbiR7d2FzaUNyZWF0aW9ufVxuXG5jb25zdCBfX3dhc21VcmwgPSBuZXcgVVJMKCcuLyR7d2FzaUZpbGVuYW1lfS53YXNtJywgaW1wb3J0Lm1ldGEudXJsKS5ocmVmXG5jb25zdCBfX2VtbmFwaUNvbnRleHQgPSBfX2VtbmFwaUdldERlZmF1bHRDb250ZXh0KClcbiR7ZW1uYXBpSW5qZWN0QnVmZmVyfVxuXG5jb25zdCBfX3NoYXJlZE1lbW9yeSA9IG5ldyBXZWJBc3NlbWJseS5NZW1vcnkoe1xuICBpbml0aWFsOiAke2luaXRpYWxNZW1vcnl9LFxuICBtYXhpbXVtOiAke21heGltdW1NZW1vcnl9LFxuICBzaGFyZWQ6IHRydWUsXG59KVxuXG5jb25zdCBfX3dhc21GaWxlID0gYXdhaXQgZmV0Y2goX193YXNtVXJsKS50aGVuKChyZXMpID0+IHJlcy5hcnJheUJ1ZmZlcigpKVxuXG5jb25zdCB7XG4gIGluc3RhbmNlOiBfX25hcGlJbnN0YW5jZSxcbiAgbW9kdWxlOiBfX3dhc2lNb2R1bGUsXG4gIG5hcGlNb2R1bGU6IF9fbmFwaU1vZHVsZSxcbn0gPSAke2VtbmFwaUluc3RhbnRpYXRlQ2FsbH0oX193YXNtRmlsZSwge1xuICBjb250ZXh0OiBfX2VtbmFwaUNvbnRleHQsXG4gIGFzeW5jV29ya1Bvb2xTaXplOiA0LFxuICB3YXNpOiBfX3dhc2ksXG4gIG9uQ3JlYXRlV29ya2VyKCkge1xuICAgIGNvbnN0IHdvcmtlciA9IG5ldyBXb3JrZXIobmV3IFVSTCgnLi93YXNpLXdvcmtlci1icm93c2VyLm1qcycsIGltcG9ydC5tZXRhLnVybCksIHtcbiAgICAgIHR5cGU6ICdtb2R1bGUnLFxuICAgIH0pXG4ke3dvcmtlckZzSGFuZGxlcn1cbiR7d29ya2VyRXJyb3JIYW5kbGVyfVxuICAgIHJldHVybiB3b3JrZXJcbiAgfSxcbiAgb3ZlcndyaXRlSW1wb3J0cyhpbXBvcnRPYmplY3QpIHtcbiAgICBpbXBvcnRPYmplY3QuZW52ID0ge1xuICAgICAgLi4uaW1wb3J0T2JqZWN0LmVudixcbiAgICAgIC4uLmltcG9ydE9iamVjdC5uYXBpLFxuICAgICAgLi4uaW1wb3J0T2JqZWN0LmVtbmFwaSxcbiAgICAgIG1lbW9yeTogX19zaGFyZWRNZW1vcnksXG4gICAgfVxuICAgIHJldHVybiBpbXBvcnRPYmplY3RcbiAgfSxcbiAgYmVmb3JlSW5pdCh7IGluc3RhbmNlIH0pIHtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgT2JqZWN0LmtleXMoaW5zdGFuY2UuZXhwb3J0cykpIHtcbiAgICAgIGlmIChuYW1lLnN0YXJ0c1dpdGgoJ19fbmFwaV9yZWdpc3Rlcl9fJykpIHtcbiAgICAgICAgaW5zdGFuY2UuZXhwb3J0c1tuYW1lXSgpXG4gICAgICB9XG4gICAgfVxuICB9LFxufSlcbmBcbn1cblxuZXhwb3J0IGNvbnN0IGNyZWF0ZVdhc2lCaW5kaW5nID0gKFxuICB3YXNtRmlsZU5hbWU6IHN0cmluZyxcbiAgcGFja2FnZU5hbWU6IHN0cmluZyxcbiAgaW5pdGlhbE1lbW9yeSA9IDQwMDAsXG4gIG1heGltdW1NZW1vcnkgPSA2NTUzNixcbikgPT4gYC8qIGVzbGludC1kaXNhYmxlICovXG4vKiBwcmV0dGllci1pZ25vcmUgKi9cblxuLyogYXV0by1nZW5lcmF0ZWQgYnkgTkFQSS1SUyAqL1xuXG5jb25zdCBfX25vZGVGcyA9IHJlcXVpcmUoJ25vZGU6ZnMnKVxuY29uc3QgX19ub2RlUGF0aCA9IHJlcXVpcmUoJ25vZGU6cGF0aCcpXG5jb25zdCB7IFdBU0k6IF9fbm9kZVdBU0kgfSA9IHJlcXVpcmUoJ25vZGU6d2FzaScpXG5jb25zdCB7IFdvcmtlciB9ID0gcmVxdWlyZSgnbm9kZTp3b3JrZXJfdGhyZWFkcycpXG5cbmNvbnN0IHtcbiAgY3JlYXRlT25NZXNzYWdlOiBfX3dhc21DcmVhdGVPbk1lc3NhZ2VGb3JGc1Byb3h5LFxuICBnZXREZWZhdWx0Q29udGV4dDogX19lbW5hcGlHZXREZWZhdWx0Q29udGV4dCxcbiAgaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYzogX19lbW5hcGlJbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jLFxufSA9IHJlcXVpcmUoJ0BuYXBpLXJzL3dhc20tcnVudGltZScpXG5cbmNvbnN0IF9fcm9vdERpciA9IF9fbm9kZVBhdGgucGFyc2UocHJvY2Vzcy5jd2QoKSkucm9vdFxuXG5jb25zdCBfX3dhc2kgPSBuZXcgX19ub2RlV0FTSSh7XG4gIHZlcnNpb246ICdwcmV2aWV3MScsXG4gIGVudjogcHJvY2Vzcy5lbnYsXG4gIHByZW9wZW5zOiB7XG4gICAgW19fcm9vdERpcl06IF9fcm9vdERpcixcbiAgfVxufSlcblxuY29uc3QgX19lbW5hcGlDb250ZXh0ID0gX19lbW5hcGlHZXREZWZhdWx0Q29udGV4dCgpXG5cbmNvbnN0IF9fc2hhcmVkTWVtb3J5ID0gbmV3IFdlYkFzc2VtYmx5Lk1lbW9yeSh7XG4gIGluaXRpYWw6ICR7aW5pdGlhbE1lbW9yeX0sXG4gIG1heGltdW06ICR7bWF4aW11bU1lbW9yeX0sXG4gIHNoYXJlZDogdHJ1ZSxcbn0pXG5cbmxldCBfX3dhc21GaWxlUGF0aCA9IF9fbm9kZVBhdGguam9pbihfX2Rpcm5hbWUsICcke3dhc21GaWxlTmFtZX0ud2FzbScpXG5jb25zdCBfX3dhc21EZWJ1Z0ZpbGVQYXRoID0gX19ub2RlUGF0aC5qb2luKF9fZGlybmFtZSwgJyR7d2FzbUZpbGVOYW1lfS5kZWJ1Zy53YXNtJylcblxuaWYgKF9fbm9kZUZzLmV4aXN0c1N5bmMoX193YXNtRGVidWdGaWxlUGF0aCkpIHtcbiAgX193YXNtRmlsZVBhdGggPSBfX3dhc21EZWJ1Z0ZpbGVQYXRoXG59IGVsc2UgaWYgKCFfX25vZGVGcy5leGlzdHNTeW5jKF9fd2FzbUZpbGVQYXRoKSkge1xuICB0cnkge1xuICAgIF9fd2FzbUZpbGVQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCcke3BhY2thZ2VOYW1lfS13YXNtMzItd2FzaS8ke3dhc21GaWxlTmFtZX0ud2FzbScpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGZpbmQgJHt3YXNtRmlsZU5hbWV9Lndhc20gZmlsZSwgYW5kICR7cGFja2FnZU5hbWV9LXdhc20zMi13YXNpIHBhY2thZ2UgaXMgbm90IGluc3RhbGxlZC4nKVxuICB9XG59XG5cbmNvbnN0IHsgaW5zdGFuY2U6IF9fbmFwaUluc3RhbmNlLCBtb2R1bGU6IF9fd2FzaU1vZHVsZSwgbmFwaU1vZHVsZTogX19uYXBpTW9kdWxlIH0gPSBfX2VtbmFwaUluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMoX19ub2RlRnMucmVhZEZpbGVTeW5jKF9fd2FzbUZpbGVQYXRoKSwge1xuICBjb250ZXh0OiBfX2VtbmFwaUNvbnRleHQsXG4gIGFzeW5jV29ya1Bvb2xTaXplOiAoZnVuY3Rpb24oKSB7XG4gICAgY29uc3QgdGhyZWFkc1NpemVGcm9tRW52ID0gTnVtYmVyKHByb2Nlc3MuZW52Lk5BUElfUlNfQVNZTkNfV09SS19QT09MX1NJWkUgPz8gcHJvY2Vzcy5lbnYuVVZfVEhSRUFEUE9PTF9TSVpFKVxuICAgIC8vIE5hTiA+IDAgaXMgZmFsc2VcbiAgICBpZiAodGhyZWFkc1NpemVGcm9tRW52ID4gMCkge1xuICAgICAgcmV0dXJuIHRocmVhZHNTaXplRnJvbUVudlxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gNFxuICAgIH1cbiAgfSkoKSxcbiAgcmV1c2VXb3JrZXI6IHRydWUsXG4gIHdhc2k6IF9fd2FzaSxcbiAgb25DcmVhdGVXb3JrZXIoKSB7XG4gICAgY29uc3Qgd29ya2VyID0gbmV3IFdvcmtlcihfX25vZGVQYXRoLmpvaW4oX19kaXJuYW1lLCAnd2FzaS13b3JrZXIubWpzJyksIHtcbiAgICAgIGVudjogcHJvY2Vzcy5lbnYsXG4gICAgfSlcbiAgICB3b3JrZXIub25tZXNzYWdlID0gKHsgZGF0YSB9KSA9PiB7XG4gICAgICBfX3dhc21DcmVhdGVPbk1lc3NhZ2VGb3JGc1Byb3h5KF9fbm9kZUZzKShkYXRhKVxuICAgIH1cblxuICAgIC8vIFRoZSBtYWluIHRocmVhZCBvZiBOb2RlLmpzIHdhaXRzIGZvciBhbGwgdGhlIGFjdGl2ZSBoYW5kbGVzIGJlZm9yZSBleGl0aW5nLlxuICAgIC8vIEJ1dCBSdXN0IHRocmVhZHMgYXJlIG5ldmVyIHdhaXRlZCB3aXRob3V0IFxcYHRocmVhZDo6am9pblxcYC5cbiAgICAvLyBTbyBoZXJlIHdlIGhhY2sgdGhlIGNvZGUgb2YgTm9kZS5qcyB0byBwcmV2ZW50IHRoZSB3b3JrZXJzIGZyb20gYmVpbmcgcmVmZXJlbmNlZCAoYWN0aXZlKS5cbiAgICAvLyBBY2NvcmRpbmcgdG8gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2Jsb2IvMTllMGQ0NzI3MjhjNzlkNDE4Yjc0YmRkZmY1ODhiZWE3MGE0MDNkMC9saWIvaW50ZXJuYWwvd29ya2VyLmpzI0w0MTUsXG4gICAgLy8gYSB3b3JrZXIgaXMgY29uc2lzdCBvZiB0d28gaGFuZGxlczoga1B1YmxpY1BvcnQgYW5kIGtIYW5kbGUuXG4gICAge1xuICAgICAgY29uc3Qga1B1YmxpY1BvcnQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKHdvcmtlcikuZmluZChzID0+XG4gICAgICAgIHMudG9TdHJpbmcoKS5pbmNsdWRlcyhcImtQdWJsaWNQb3J0XCIpXG4gICAgICApO1xuICAgICAgaWYgKGtQdWJsaWNQb3J0KSB7XG4gICAgICAgIHdvcmtlcltrUHVibGljUG9ydF0ucmVmID0gKCkgPT4ge307XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGtIYW5kbGUgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKHdvcmtlcikuZmluZChzID0+XG4gICAgICAgIHMudG9TdHJpbmcoKS5pbmNsdWRlcyhcImtIYW5kbGVcIilcbiAgICAgICk7XG4gICAgICBpZiAoa0hhbmRsZSkge1xuICAgICAgICB3b3JrZXJba0hhbmRsZV0ucmVmID0gKCkgPT4ge307XG4gICAgICB9XG5cbiAgICAgIHdvcmtlci51bnJlZigpO1xuICAgIH1cbiAgICByZXR1cm4gd29ya2VyXG4gIH0sXG4gIG92ZXJ3cml0ZUltcG9ydHMoaW1wb3J0T2JqZWN0KSB7XG4gICAgaW1wb3J0T2JqZWN0LmVudiA9IHtcbiAgICAgIC4uLmltcG9ydE9iamVjdC5lbnYsXG4gICAgICAuLi5pbXBvcnRPYmplY3QubmFwaSxcbiAgICAgIC4uLmltcG9ydE9iamVjdC5lbW5hcGksXG4gICAgICBtZW1vcnk6IF9fc2hhcmVkTWVtb3J5LFxuICAgIH1cbiAgICByZXR1cm4gaW1wb3J0T2JqZWN0XG4gIH0sXG4gIGJlZm9yZUluaXQoeyBpbnN0YW5jZSB9KSB7XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIE9iamVjdC5rZXlzKGluc3RhbmNlLmV4cG9ydHMpKSB7XG4gICAgICBpZiAobmFtZS5zdGFydHNXaXRoKCdfX25hcGlfcmVnaXN0ZXJfXycpKSB7XG4gICAgICAgIGluc3RhbmNlLmV4cG9ydHNbbmFtZV0oKVxuICAgICAgfVxuICAgIH1cbiAgfSxcbn0pXG5gXG4iLCJleHBvcnQgY29uc3QgV0FTSV9XT1JLRVJfVEVNUExBVEUgPSBgaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgeyBjcmVhdGVSZXF1aXJlIH0gZnJvbSBcIm5vZGU6bW9kdWxlXCI7XG5pbXBvcnQgeyBwYXJzZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IFdBU0kgfSBmcm9tIFwibm9kZTp3YXNpXCI7XG5pbXBvcnQgeyBwYXJlbnRQb3J0LCBXb3JrZXIgfSBmcm9tIFwibm9kZTp3b3JrZXJfdGhyZWFkc1wiO1xuXG5jb25zdCByZXF1aXJlID0gY3JlYXRlUmVxdWlyZShpbXBvcnQubWV0YS51cmwpO1xuXG5jb25zdCB7IGluc3RhbnRpYXRlTmFwaU1vZHVsZVN5bmMsIE1lc3NhZ2VIYW5kbGVyLCBnZXREZWZhdWx0Q29udGV4dCB9ID0gcmVxdWlyZShcIkBuYXBpLXJzL3dhc20tcnVudGltZVwiKTtcblxuaWYgKHBhcmVudFBvcnQpIHtcbiAgcGFyZW50UG9ydC5vbihcIm1lc3NhZ2VcIiwgKGRhdGEpID0+IHtcbiAgICBnbG9iYWxUaGlzLm9ubWVzc2FnZSh7IGRhdGEgfSk7XG4gIH0pO1xufVxuXG5PYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtcbiAgc2VsZjogZ2xvYmFsVGhpcyxcbiAgcmVxdWlyZSxcbiAgV29ya2VyLFxuICBpbXBvcnRTY3JpcHRzOiBmdW5jdGlvbiAoZikge1xuICAgIDsoMCwgZXZhbCkoZnMucmVhZEZpbGVTeW5jKGYsIFwidXRmOFwiKSArIFwiLy8jIHNvdXJjZVVSTD1cIiArIGYpO1xuICB9LFxuICBwb3N0TWVzc2FnZTogZnVuY3Rpb24gKG1zZykge1xuICAgIGlmIChwYXJlbnRQb3J0KSB7XG4gICAgICBwYXJlbnRQb3J0LnBvc3RNZXNzYWdlKG1zZyk7XG4gICAgfVxuICB9LFxufSk7XG5cbmNvbnN0IGVtbmFwaUNvbnRleHQgPSBnZXREZWZhdWx0Q29udGV4dCgpO1xuXG5jb25zdCBfX3Jvb3REaXIgPSBwYXJzZShwcm9jZXNzLmN3ZCgpKS5yb290O1xuXG5jb25zdCBoYW5kbGVyID0gbmV3IE1lc3NhZ2VIYW5kbGVyKHtcbiAgb25Mb2FkKHsgd2FzbU1vZHVsZSwgd2FzbU1lbW9yeSB9KSB7XG4gICAgY29uc3Qgd2FzaSA9IG5ldyBXQVNJKHtcbiAgICAgIHZlcnNpb246ICdwcmV2aWV3MScsXG4gICAgICBlbnY6IHByb2Nlc3MuZW52LFxuICAgICAgcHJlb3BlbnM6IHtcbiAgICAgICAgW19fcm9vdERpcl06IF9fcm9vdERpcixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICByZXR1cm4gaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYyh3YXNtTW9kdWxlLCB7XG4gICAgICBjaGlsZFRocmVhZDogdHJ1ZSxcbiAgICAgIHdhc2ksXG4gICAgICBjb250ZXh0OiBlbW5hcGlDb250ZXh0LFxuICAgICAgb3ZlcndyaXRlSW1wb3J0cyhpbXBvcnRPYmplY3QpIHtcbiAgICAgICAgaW1wb3J0T2JqZWN0LmVudiA9IHtcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QuZW52LFxuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5uYXBpLFxuICAgICAgICAgIC4uLmltcG9ydE9iamVjdC5lbW5hcGksXG4gICAgICAgICAgbWVtb3J5OiB3YXNtTWVtb3J5XG4gICAgICAgIH07XG4gICAgICB9LFxuICAgIH0pO1xuICB9LFxufSk7XG5cbmdsb2JhbFRoaXMub25tZXNzYWdlID0gZnVuY3Rpb24gKGUpIHtcbiAgaGFuZGxlci5oYW5kbGUoZSk7XG59O1xuYFxuXG5leHBvcnQgY29uc3QgY3JlYXRlV2FzaUJyb3dzZXJXb3JrZXJCaW5kaW5nID0gKFxuICBmczogYm9vbGVhbixcbiAgZXJyb3JFdmVudDogYm9vbGVhbixcbikgPT4ge1xuICBjb25zdCBmc0ltcG9ydCA9IGZzXG4gICAgPyBgaW1wb3J0IHsgaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYywgTWVzc2FnZUhhbmRsZXIsIFdBU0ksIGNyZWF0ZUZzUHJveHkgfSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUnXG5pbXBvcnQgeyBtZW1mc0V4cG9ydGVkIGFzIF9fbWVtZnNFeHBvcnRlZCB9IGZyb20gJ0BuYXBpLXJzL3dhc20tcnVudGltZS9mcydcblxuY29uc3QgZnMgPSBjcmVhdGVGc1Byb3h5KF9fbWVtZnNFeHBvcnRlZClgXG4gICAgOiBgaW1wb3J0IHsgaW5zdGFudGlhdGVOYXBpTW9kdWxlU3luYywgTWVzc2FnZUhhbmRsZXIsIFdBU0kgfSBmcm9tICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUnYFxuICBjb25zdCBlcnJvck91dHB1dHNBcHBlbmQgPSBlcnJvckV2ZW50XG4gICAgPyBgXFxuICAgICAgICBlcnJvck91dHB1dHMucHVzaChbLi4uYXJndW1lbnRzXSlgXG4gICAgOiAnJ1xuICBjb25zdCB3YXNpQ3JlYXRpb24gPSBmc1xuICAgID8gYGNvbnN0IHdhc2kgPSBuZXcgV0FTSSh7XG4gICAgICBmcyxcbiAgICAgIHByZW9wZW5zOiB7XG4gICAgICAgICcvJzogJy8nLFxuICAgICAgfSxcbiAgICAgIHByaW50OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cylcbiAgICAgIH0sXG4gICAgICBwcmludEVycjogZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgIGNvbnNvbGUuZXJyb3IuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKVxuICAgICAgICAke2Vycm9yT3V0cHV0c0FwcGVuZH1cbiAgICAgIH0sXG4gICAgfSlgXG4gICAgOiBgY29uc3Qgd2FzaSA9IG5ldyBXQVNJKHtcbiAgICAgIHByaW50OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgIGNvbnNvbGUubG9nLmFwcGx5KGNvbnNvbGUsIGFyZ3VtZW50cylcbiAgICAgIH0sXG4gICAgICBwcmludEVycjogZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zb2xlXG4gICAgICAgIGNvbnNvbGUuZXJyb3IuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKVxuICAgICAgICAke2Vycm9yT3V0cHV0c0FwcGVuZH1cbiAgICAgIH0sXG4gICAgfSlgXG4gIGNvbnN0IGVycm9ySGFuZGxlciA9IGVycm9yRXZlbnRcbiAgICA/IGBvbkVycm9yKGVycm9yKSB7XG4gICAgcG9zdE1lc3NhZ2UoeyB0eXBlOiAnZXJyb3InLCBlcnJvciwgZXJyb3JPdXRwdXRzIH0pXG4gICAgZXJyb3JPdXRwdXRzLmxlbmd0aCA9IDBcbiAgfWBcbiAgICA6ICcnXG4gIHJldHVybiBgJHtmc0ltcG9ydH1cblxuY29uc3QgZXJyb3JPdXRwdXRzID0gW11cblxuY29uc3QgaGFuZGxlciA9IG5ldyBNZXNzYWdlSGFuZGxlcih7XG4gIG9uTG9hZCh7IHdhc21Nb2R1bGUsIHdhc21NZW1vcnkgfSkge1xuICAgICR7d2FzaUNyZWF0aW9ufVxuICAgIHJldHVybiBpbnN0YW50aWF0ZU5hcGlNb2R1bGVTeW5jKHdhc21Nb2R1bGUsIHtcbiAgICAgIGNoaWxkVGhyZWFkOiB0cnVlLFxuICAgICAgd2FzaSxcbiAgICAgIG92ZXJ3cml0ZUltcG9ydHMoaW1wb3J0T2JqZWN0KSB7XG4gICAgICAgIGltcG9ydE9iamVjdC5lbnYgPSB7XG4gICAgICAgICAgLi4uaW1wb3J0T2JqZWN0LmVudixcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QubmFwaSxcbiAgICAgICAgICAuLi5pbXBvcnRPYmplY3QuZW1uYXBpLFxuICAgICAgICAgIG1lbW9yeTogd2FzbU1lbW9yeSxcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KVxuICB9LFxuICAke2Vycm9ySGFuZGxlcn1cbn0pXG5cbmdsb2JhbFRoaXMub25tZXNzYWdlID0gZnVuY3Rpb24gKGUpIHtcbiAgaGFuZGxlci5oYW5kbGUoZSlcbn1cbmBcbn1cbiIsImltcG9ydCB7IHNwYXduIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ25vZGU6Y3J5cHRvJ1xuaW1wb3J0IHsgZXhpc3RzU3luYywgbWtkaXJTeW5jLCBybVN5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJ1xuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgeyBwYXJzZSwgam9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0ICogYXMgY29sb3JzIGZyb20gJ2NvbG9yZXR0ZSdcblxuaW1wb3J0IHR5cGUgeyBCdWlsZE9wdGlvbnMgYXMgUmF3QnVpbGRPcHRpb25zIH0gZnJvbSAnLi4vZGVmL2J1aWxkLmpzJ1xuaW1wb3J0IHtcbiAgQ0xJX1ZFUlNJT04sXG4gIGNvcHlGaWxlQXN5bmMsXG4gIHR5cGUgQ3JhdGUsXG4gIGRlYnVnRmFjdG9yeSxcbiAgREVGQVVMVF9UWVBFX0RFRl9IRUFERVIsXG4gIGZpbGVFeGlzdHMsXG4gIGdldFN5c3RlbURlZmF1bHRUYXJnZXQsXG4gIGdldFRhcmdldExpbmtlcixcbiAgbWtkaXJBc3luYyxcbiAgdHlwZSBOYXBpQ29uZmlnLFxuICBwYXJzZU1ldGFkYXRhLFxuICBwYXJzZVRyaXBsZSxcbiAgcHJvY2Vzc1R5cGVEZWYsXG4gIHJlYWRGaWxlQXN5bmMsXG4gIHJlYWROYXBpQ29uZmlnLFxuICB0eXBlIFRhcmdldCxcbiAgdGFyZ2V0VG9FbnZWYXIsXG4gIHRyeUluc3RhbGxDYXJnb0JpbmFyeSxcbiAgdW5saW5rQXN5bmMsXG4gIHdyaXRlRmlsZUFzeW5jLFxuICBkaXJFeGlzdHNBc3luYyxcbiAgcmVhZGRpckFzeW5jLFxuICB0eXBlIENhcmdvV29ya3NwYWNlTWV0YWRhdGEsXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuXG5pbXBvcnQgeyBjcmVhdGVDanNCaW5kaW5nLCBjcmVhdGVFc21CaW5kaW5nIH0gZnJvbSAnLi90ZW1wbGF0ZXMvaW5kZXguanMnXG5pbXBvcnQge1xuICBjcmVhdGVXYXNpQmluZGluZyxcbiAgY3JlYXRlV2FzaUJyb3dzZXJCaW5kaW5nLFxufSBmcm9tICcuL3RlbXBsYXRlcy9sb2FkLXdhc2ktdGVtcGxhdGUuanMnXG5pbXBvcnQge1xuICBjcmVhdGVXYXNpQnJvd3NlcldvcmtlckJpbmRpbmcsXG4gIFdBU0lfV09SS0VSX1RFTVBMQVRFLFxufSBmcm9tICcuL3RlbXBsYXRlcy93YXNpLXdvcmtlci10ZW1wbGF0ZS5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ2J1aWxkJylcbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybClcblxudHlwZSBPdXRwdXRLaW5kID0gJ2pzJyB8ICdkdHMnIHwgJ25vZGUnIHwgJ2V4ZScgfCAnd2FzbSdcbnR5cGUgT3V0cHV0ID0geyBraW5kOiBPdXRwdXRLaW5kOyBwYXRoOiBzdHJpbmcgfVxuXG50eXBlIEJ1aWxkT3B0aW9ucyA9IFJhd0J1aWxkT3B0aW9ucyAmIHsgY2FyZ29PcHRpb25zPzogc3RyaW5nW10gfVxudHlwZSBQYXJzZWRCdWlsZE9wdGlvbnMgPSBPbWl0PEJ1aWxkT3B0aW9ucywgJ2N3ZCc+ICYgeyBjd2Q6IHN0cmluZyB9XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBidWlsZFByb2plY3QocmF3T3B0aW9uczogQnVpbGRPcHRpb25zKSB7XG4gIGRlYnVnKCduYXBpIGJ1aWxkIGNvbW1hbmQgcmVjZWl2ZSBvcHRpb25zOiAlTycsIHJhd09wdGlvbnMpXG5cbiAgY29uc3Qgb3B0aW9uczogUGFyc2VkQnVpbGRPcHRpb25zID0ge1xuICAgIGR0c0NhY2hlOiB0cnVlLFxuICAgIC4uLnJhd09wdGlvbnMsXG4gICAgY3dkOiByYXdPcHRpb25zLmN3ZCA/PyBwcm9jZXNzLmN3ZCgpLFxuICB9XG5cbiAgY29uc3QgcmVzb2x2ZVBhdGggPSAoLi4ucGF0aHM6IHN0cmluZ1tdKSA9PiByZXNvbHZlKG9wdGlvbnMuY3dkLCAuLi5wYXRocylcblxuICBjb25zdCBtYW5pZmVzdFBhdGggPSByZXNvbHZlUGF0aChvcHRpb25zLm1hbmlmZXN0UGF0aCA/PyAnQ2FyZ28udG9tbCcpXG4gIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgcGFyc2VNZXRhZGF0YShtYW5pZmVzdFBhdGgpXG5cbiAgY29uc3QgY3JhdGUgPSBtZXRhZGF0YS5wYWNrYWdlcy5maW5kKChwKSA9PiB7XG4gICAgLy8gcGFja2FnZSB3aXRoIGdpdmVuIG5hbWVcbiAgICBpZiAob3B0aW9ucy5wYWNrYWdlKSB7XG4gICAgICByZXR1cm4gcC5uYW1lID09PSBvcHRpb25zLnBhY2thZ2VcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHAubWFuaWZlc3RfcGF0aCA9PT0gbWFuaWZlc3RQYXRoXG4gICAgfVxuICB9KVxuXG4gIGlmICghY3JhdGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnVW5hYmxlIHRvIGZpbmQgY3JhdGUgdG8gYnVpbGQuIEl0IHNlZW1zIHlvdSBhcmUgdHJ5aW5nIHRvIGJ1aWxkIGEgY3JhdGUgaW4gYSB3b3Jrc3BhY2UsIHRyeSB1c2luZyBgLS1wYWNrYWdlYCBvcHRpb24gdG8gc3BlY2lmeSB0aGUgcGFja2FnZSB0byBidWlsZC4nLFxuICAgIClcbiAgfVxuICBjb25zdCBjb25maWcgPSBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICByZXNvbHZlUGF0aChvcHRpb25zLnBhY2thZ2VKc29uUGF0aCA/PyAncGFja2FnZS5qc29uJyksXG4gICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZVBhdGgob3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgKVxuXG4gIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQnVpbGRlcihtZXRhZGF0YSwgY3JhdGUsIGNvbmZpZywgb3B0aW9ucylcblxuICByZXR1cm4gYnVpbGRlci5idWlsZCgpXG59XG5cbmNsYXNzIEJ1aWxkZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGFyZ3M6IHN0cmluZ1tdID0gW11cbiAgcHJpdmF0ZSByZWFkb25seSBlbnZzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge31cbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXRzOiBPdXRwdXRbXSA9IFtdXG5cbiAgcHJpdmF0ZSByZWFkb25seSB0YXJnZXQ6IFRhcmdldFxuICBwcml2YXRlIHJlYWRvbmx5IGNyYXRlRGlyOiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSBvdXRwdXREaXI6IHN0cmluZ1xuICBwcml2YXRlIHJlYWRvbmx5IHRhcmdldERpcjogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgZW5hYmxlVHlwZURlZjogYm9vbGVhbiA9IGZhbHNlXG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBtZXRhZGF0YTogQ2FyZ29Xb3Jrc3BhY2VNZXRhZGF0YSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNyYXRlOiBDcmF0ZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogTmFwaUNvbmZpZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFBhcnNlZEJ1aWxkT3B0aW9ucyxcbiAgKSB7XG4gICAgdGhpcy50YXJnZXQgPSBvcHRpb25zLnRhcmdldFxuICAgICAgPyBwYXJzZVRyaXBsZShvcHRpb25zLnRhcmdldClcbiAgICAgIDogcHJvY2Vzcy5lbnYuQ0FSR09fQlVJTERfVEFSR0VUXG4gICAgICAgID8gcGFyc2VUcmlwbGUocHJvY2Vzcy5lbnYuQ0FSR09fQlVJTERfVEFSR0VUKVxuICAgICAgICA6IGdldFN5c3RlbURlZmF1bHRUYXJnZXQoKVxuICAgIHRoaXMuY3JhdGVEaXIgPSBwYXJzZShjcmF0ZS5tYW5pZmVzdF9wYXRoKS5kaXJcbiAgICB0aGlzLm91dHB1dERpciA9IHJlc29sdmUoXG4gICAgICB0aGlzLm9wdGlvbnMuY3dkLFxuICAgICAgb3B0aW9ucy5vdXRwdXREaXIgPz8gdGhpcy5jcmF0ZURpcixcbiAgICApXG4gICAgdGhpcy50YXJnZXREaXIgPVxuICAgICAgb3B0aW9ucy50YXJnZXREaXIgPz9cbiAgICAgIHByb2Nlc3MuZW52LkNBUkdPX0JVSUxEX1RBUkdFVF9ESVIgPz9cbiAgICAgIG1ldGFkYXRhLnRhcmdldF9kaXJlY3RvcnlcbiAgICB0aGlzLmVuYWJsZVR5cGVEZWYgPSB0aGlzLmNyYXRlLmRlcGVuZGVuY2llcy5zb21lKFxuICAgICAgKGRlcCkgPT5cbiAgICAgICAgZGVwLm5hbWUgPT09ICduYXBpLWRlcml2ZScgJiZcbiAgICAgICAgKGRlcC51c2VzX2RlZmF1bHRfZmVhdHVyZXMgfHwgZGVwLmZlYXR1cmVzLmluY2x1ZGVzKCd0eXBlLWRlZicpKSxcbiAgICApXG5cbiAgICBpZiAoIXRoaXMuZW5hYmxlVHlwZURlZikge1xuICAgICAgY29uc3QgcmVxdWlyZW1lbnRXYXJuaW5nID1cbiAgICAgICAgJ2BuYXBpLWRlcml2ZWAgY3JhdGUgaXMgbm90IHVzZWQgb3IgYHR5cGUtZGVmYCBmZWF0dXJlIGlzIG5vdCBlbmFibGVkIGZvciBgbmFwaS1kZXJpdmVgIGNyYXRlJ1xuICAgICAgZGVidWcud2FybihcbiAgICAgICAgYCR7cmVxdWlyZW1lbnRXYXJuaW5nfS4gV2lsbCBza2lwIGJpbmRpbmcgZ2VuZXJhdGlvbiBmb3IgXFxgLm5vZGVcXGAsIFxcYC53YXNpXFxgIGFuZCBcXGAuZC50c1xcYCBmaWxlcy5gLFxuICAgICAgKVxuXG4gICAgICBpZiAoXG4gICAgICAgIHRoaXMub3B0aW9ucy5kdHMgfHxcbiAgICAgICAgdGhpcy5vcHRpb25zLmR0c0hlYWRlciB8fFxuICAgICAgICB0aGlzLmNvbmZpZy5kdHNIZWFkZXIgfHxcbiAgICAgICAgdGhpcy5jb25maWcuZHRzSGVhZGVyRmlsZVxuICAgICAgKSB7XG4gICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgYCR7cmVxdWlyZW1lbnRXYXJuaW5nfS4gXFxgZHRzXFxgIHJlbGF0ZWQgb3B0aW9ucyBhcmUgZW5hYmxlZCBidXQgd2lsbCBiZSBpZ25vcmVkLmAsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXQgY2R5TGliTmFtZSgpIHtcbiAgICByZXR1cm4gdGhpcy5jcmF0ZS50YXJnZXRzLmZpbmQoKHQpID0+IHQuY3JhdGVfdHlwZXMuaW5jbHVkZXMoJ2NkeWxpYicpKVxuICAgICAgPy5uYW1lXG4gIH1cblxuICBnZXQgYmluTmFtZSgpIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5vcHRpb25zLmJpbiA/P1xuICAgICAgLy8gb25seSBhdmFpbGFibGUgaWYgbm90IGNkeWxpYiBvciBiaW4gbmFtZSBzcGVjaWZpZWRcbiAgICAgICh0aGlzLmNkeUxpYk5hbWVcbiAgICAgICAgPyBudWxsXG4gICAgICAgIDogdGhpcy5jcmF0ZS50YXJnZXRzLmZpbmQoKHQpID0+IHQuY3JhdGVfdHlwZXMuaW5jbHVkZXMoJ2JpbicpKT8ubmFtZSlcbiAgICApXG4gIH1cblxuICBidWlsZCgpIHtcbiAgICBpZiAoIXRoaXMuY2R5TGliTmFtZSkge1xuICAgICAgY29uc3Qgd2FybmluZyA9XG4gICAgICAgICdNaXNzaW5nIGBjcmF0ZS10eXBlID0gW1wiY2R5bGliXCJdYCBpbiBbbGliXSBjb25maWcuIFRoZSBidWlsZCByZXN1bHQgd2lsbCBub3QgYmUgYXZhaWxhYmxlIGFzIG5vZGUgYWRkb24uJ1xuXG4gICAgICBpZiAodGhpcy5iaW5OYW1lKSB7XG4gICAgICAgIGRlYnVnLndhcm4od2FybmluZylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcih3YXJuaW5nKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLnBpY2tCaW5hcnkoKVxuICAgICAgLnNldFBhY2thZ2UoKVxuICAgICAgLnNldEZlYXR1cmVzKClcbiAgICAgIC5zZXRUYXJnZXQoKVxuICAgICAgLnBpY2tDcm9zc1Rvb2xjaGFpbigpXG4gICAgICAuc2V0RW52cygpXG4gICAgICAuc2V0QnlwYXNzQXJncygpXG4gICAgICAuZXhlYygpXG4gIH1cblxuICBwcml2YXRlIHBpY2tDcm9zc1Rvb2xjaGFpbigpIHtcbiAgICBpZiAoIXRoaXMub3B0aW9ucy51c2VOYXBpQ3Jvc3MpIHtcbiAgICAgIHJldHVybiB0aGlzXG4gICAgfVxuICAgIGlmICh0aGlzLm9wdGlvbnMudXNlQ3Jvc3MpIHtcbiAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICdZb3UgYXJlIHRyeWluZyB0byB1c2UgYm90aCBgLS1jcm9zc2AgYW5kIGAtLXVzZS1uYXBpLWNyb3NzYCBvcHRpb25zLCBgLS11c2UtY3Jvc3NgIHdpbGwgYmUgaWdub3JlZC4nLFxuICAgICAgKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMuY3Jvc3NDb21waWxlKSB7XG4gICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAnWW91IGFyZSB0cnlpbmcgdG8gdXNlIGJvdGggYC0tY3Jvc3MtY29tcGlsZWAgYW5kIGAtLXVzZS1uYXBpLWNyb3NzYCBvcHRpb25zLCBgLS1jcm9zcy1jb21waWxlYCB3aWxsIGJlIGlnbm9yZWQuJyxcbiAgICAgIClcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgeyB2ZXJzaW9uLCBkb3dubG9hZCB9ID0gcmVxdWlyZSgnQG5hcGktcnMvY3Jvc3MtdG9vbGNoYWluJylcblxuICAgICAgY29uc3QgYWxpYXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgICdzMzkweC11bmtub3duLWxpbnV4LWdudSc6ICdzMzkweC1pYm0tbGludXgtZ251JyxcbiAgICAgIH1cblxuICAgICAgY29uc3QgdG9vbGNoYWluUGF0aCA9IGpvaW4oXG4gICAgICAgIGhvbWVkaXIoKSxcbiAgICAgICAgJy5uYXBpLXJzJyxcbiAgICAgICAgJ2Nyb3NzLXRvb2xjaGFpbicsXG4gICAgICAgIHZlcnNpb24sXG4gICAgICAgIHRoaXMudGFyZ2V0LnRyaXBsZSxcbiAgICAgIClcbiAgICAgIG1rZGlyU3luYyh0b29sY2hhaW5QYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICAgICAgaWYgKGV4aXN0c1N5bmMoam9pbih0b29sY2hhaW5QYXRoLCAncGFja2FnZS5qc29uJykpKSB7XG4gICAgICAgIGRlYnVnKGBUb29sY2hhaW4gJHt0b29sY2hhaW5QYXRofSBleGlzdHMsIHNraXAgZXh0cmFjdGluZ2ApXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCB0YXJBcmNoaXZlID0gZG93bmxvYWQocHJvY2Vzcy5hcmNoLCB0aGlzLnRhcmdldC50cmlwbGUpXG4gICAgICAgIHRhckFyY2hpdmUudW5wYWNrKHRvb2xjaGFpblBhdGgpXG4gICAgICB9XG4gICAgICBjb25zdCB1cHBlckNhc2VUYXJnZXQgPSB0YXJnZXRUb0VudlZhcih0aGlzLnRhcmdldC50cmlwbGUpXG4gICAgICBjb25zdCBjcm9zc1RhcmdldE5hbWUgPSBhbGlhc1t0aGlzLnRhcmdldC50cmlwbGVdID8/IHRoaXMudGFyZ2V0LnRyaXBsZVxuICAgICAgY29uc3QgbGlua2VyRW52ID0gYENBUkdPX1RBUkdFVF8ke3VwcGVyQ2FzZVRhcmdldH1fTElOS0VSYFxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgbGlua2VyRW52LFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LWdjY2ApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9TWVNST09UJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCBjcm9zc1RhcmdldE5hbWUsICdzeXNyb290JyksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0FSJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1hcmApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9SQU5MSUInLFxuICAgICAgICBqb2luKHRvb2xjaGFpblBhdGgsICdiaW4nLCBgJHtjcm9zc1RhcmdldE5hbWV9LXJhbmxpYmApLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9SRUFERUxGJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCAnYmluJywgYCR7Y3Jvc3NUYXJnZXROYW1lfS1yZWFkZWxmYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NfSU5DTFVERV9QQVRIJyxcbiAgICAgICAgam9pbih0b29sY2hhaW5QYXRoLCBjcm9zc1RhcmdldE5hbWUsICdzeXNyb290JywgJ3VzcicsICdpbmNsdWRlLycpLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DQycsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tZ2NjYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NYWCcsXG4gICAgICAgIGpvaW4odG9vbGNoYWluUGF0aCwgJ2JpbicsIGAke2Nyb3NzVGFyZ2V0TmFtZX0tZysrYCksXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnQklOREdFTl9FWFRSQV9DTEFOR19BUkdTJyxcbiAgICAgICAgYC0tc3lzcm9vdD0ke3RoaXMuZW52cy5UQVJHRVRfU1lTUk9PVH19YCxcbiAgICAgIClcblxuICAgICAgaWYgKFxuICAgICAgICBwcm9jZXNzLmVudi5UQVJHRVRfQ0M/LnN0YXJ0c1dpdGgoJ2NsYW5nJykgfHxcbiAgICAgICAgKHByb2Nlc3MuZW52LkNDPy5zdGFydHNXaXRoKCdjbGFuZycpICYmICFwcm9jZXNzLmVudi5UQVJHRVRfQ0MpXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgVEFSR0VUX0NGTEFHUyA9IHByb2Nlc3MuZW52LlRBUkdFVF9DRkxBR1MgPz8gJydcbiAgICAgICAgdGhpcy5lbnZzLlRBUkdFVF9DRkxBR1MgPSBgLS1zeXNyb290PSR7dGhpcy5lbnZzLlRBUkdFVF9TWVNST09UfSAtLWdjYy10b29sY2hhaW49JHt0b29sY2hhaW5QYXRofSAke1RBUkdFVF9DRkxBR1N9YFxuICAgICAgfVxuICAgICAgaWYgKFxuICAgICAgICAocHJvY2Vzcy5lbnYuQ1hYPy5zdGFydHNXaXRoKCdjbGFuZysrJykgJiYgIXByb2Nlc3MuZW52LlRBUkdFVF9DWFgpIHx8XG4gICAgICAgIHByb2Nlc3MuZW52LlRBUkdFVF9DWFg/LnN0YXJ0c1dpdGgoJ2NsYW5nKysnKVxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IFRBUkdFVF9DWFhGTEFHUyA9IHByb2Nlc3MuZW52LlRBUkdFVF9DWFhGTEFHUyA/PyAnJ1xuICAgICAgICB0aGlzLmVudnMuVEFSR0VUX0NYWEZMQUdTID0gYC0tc3lzcm9vdD0ke3RoaXMuZW52cy5UQVJHRVRfU1lTUk9PVH0gLS1nY2MtdG9vbGNoYWluPSR7dG9vbGNoYWluUGF0aH0gJHtUQVJHRVRfQ1hYRkxBR1N9YFxuICAgICAgfVxuICAgICAgdGhpcy5lbnZzLlBBVEggPSB0aGlzLmVudnMuUEFUSFxuICAgICAgICA/IGAke3Rvb2xjaGFpblBhdGh9L2Jpbjoke3RoaXMuZW52cy5QQVRIfToke3Byb2Nlc3MuZW52LlBBVEh9YFxuICAgICAgICA6IGAke3Rvb2xjaGFpblBhdGh9L2Jpbjoke3Byb2Nlc3MuZW52LlBBVEh9YFxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGRlYnVnLndhcm4oJ1BpY2sgY3Jvc3MgdG9vbGNoYWluIGZhaWxlZCcsIGUgYXMgRXJyb3IpXG4gICAgICAvLyBpZ25vcmUsIGRvIG5vdGhpbmdcbiAgICB9XG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgZXhlYygpIHtcbiAgICBkZWJ1ZyhgU3RhcnQgYnVpbGRpbmcgY3JhdGU6ICR7dGhpcy5jcmF0ZS5uYW1lfWApXG4gICAgZGVidWcoJyAgJWknLCBgY2FyZ28gJHt0aGlzLmFyZ3Muam9pbignICcpfWApXG5cbiAgICBjb25zdCBjb250cm9sbGVyID0gbmV3IEFib3J0Q29udHJvbGxlcigpXG5cbiAgICBjb25zdCB3YXRjaCA9IHRoaXMub3B0aW9ucy53YXRjaFxuICAgIGNvbnN0IGJ1aWxkVGFzayA9IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGlmICh0aGlzLm9wdGlvbnMudXNlQ3Jvc3MgJiYgdGhpcy5vcHRpb25zLmNyb3NzQ29tcGlsZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgJ2AtLXVzZS1jcm9zc2AgYW5kIGAtLWNyb3NzLWNvbXBpbGVgIGNhbiBub3QgYmUgdXNlZCB0b2dldGhlcicsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIGNvbnN0IGNvbW1hbmQgPVxuICAgICAgICBwcm9jZXNzLmVudi5DQVJHTyA/PyAodGhpcy5vcHRpb25zLnVzZUNyb3NzID8gJ2Nyb3NzJyA6ICdjYXJnbycpXG4gICAgICBjb25zdCBidWlsZFByb2Nlc3MgPSBzcGF3bihjb21tYW5kLCB0aGlzLmFyZ3MsIHtcbiAgICAgICAgZW52OiB7IC4uLnByb2Nlc3MuZW52LCAuLi50aGlzLmVudnMgfSxcbiAgICAgICAgc3RkaW86IHdhdGNoID8gWydpbmhlcml0JywgJ2luaGVyaXQnLCAncGlwZSddIDogJ2luaGVyaXQnLFxuICAgICAgICBjd2Q6IHRoaXMub3B0aW9ucy5jd2QsXG4gICAgICAgIHNpZ25hbDogY29udHJvbGxlci5zaWduYWwsXG4gICAgICB9KVxuXG4gICAgICBidWlsZFByb2Nlc3Mub25jZSgnZXhpdCcsIChjb2RlKSA9PiB7XG4gICAgICAgIGlmIChjb2RlID09PSAwKSB7XG4gICAgICAgICAgZGVidWcoJyVpJywgYEJ1aWxkIGNyYXRlICR7dGhpcy5jcmF0ZS5uYW1lfSBzdWNjZXNzZnVsbHkhYClcbiAgICAgICAgICByZXNvbHZlKClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKGBCdWlsZCBmYWlsZWQgd2l0aCBleGl0IGNvZGUgJHtjb2RlfWApKVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICBidWlsZFByb2Nlc3Mub25jZSgnZXJyb3InLCAoZSkgPT4ge1xuICAgICAgICByZWplY3QobmV3IEVycm9yKGBCdWlsZCBmYWlsZWQgd2l0aCBlcnJvcjogJHtlLm1lc3NhZ2V9YCwgeyBjYXVzZTogZSB9KSlcbiAgICAgIH0pXG5cbiAgICAgIC8vIHdhdGNoIG1vZGUgb25seSwgdGhleSBhcmUgcGlwZWQgdGhyb3VnaCBzdGRlcnJcbiAgICAgIGJ1aWxkUHJvY2Vzcy5zdGRlcnI/Lm9uKCdkYXRhJywgKGRhdGEpID0+IHtcbiAgICAgICAgY29uc3Qgb3V0cHV0ID0gZGF0YS50b1N0cmluZygpXG4gICAgICAgIGNvbnNvbGUuZXJyb3Iob3V0cHV0KVxuICAgICAgICBpZiAoL0ZpbmlzaGVkXFxzKGBkZXZgfGByZWxlYXNlYCkvLnRlc3Qob3V0cHV0KSkge1xuICAgICAgICAgIHRoaXMucG9zdEJ1aWxkKCkuY2F0Y2goKCkgPT4ge30pXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcblxuICAgIHJldHVybiB7XG4gICAgICB0YXNrOiBidWlsZFRhc2sudGhlbigoKSA9PiB0aGlzLnBvc3RCdWlsZCgpKSxcbiAgICAgIGFib3J0OiAoKSA9PiBjb250cm9sbGVyLmFib3J0KCksXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwaWNrQmluYXJ5KCkge1xuICAgIGxldCBzZXQgPSBmYWxzZVxuICAgIGlmICh0aGlzLm9wdGlvbnMud2F0Y2gpIHtcbiAgICAgIGlmIChwcm9jZXNzLmVudi5DSSkge1xuICAgICAgICBkZWJ1Zy53YXJuKCdXYXRjaCBtb2RlIGlzIG5vdCBzdXBwb3J0ZWQgaW4gQ0kgZW52aXJvbm1lbnQnKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVidWcoJ1VzZSAlaScsICdjYXJnby13YXRjaCcpXG4gICAgICAgIHRyeUluc3RhbGxDYXJnb0JpbmFyeSgnY2FyZ28td2F0Y2gnLCAnd2F0Y2gnKVxuICAgICAgICAvLyB5YXJuIG5hcGkgd2F0Y2ggLS10YXJnZXQgeDg2XzY0LXVua25vd24tbGludXgtZ251IFstLWNyb3NzLWNvbXBpbGVdXG4gICAgICAgIC8vID09PT5cbiAgICAgICAgLy8gY2FyZ28gd2F0Y2ggWy4uLl0gLS0gYnVpbGQgLS10YXJnZXQgeDg2XzY0LXVua25vd24tbGludXgtZ251XG4gICAgICAgIC8vIGNhcmdvIHdhdGNoIFsuLi5dIC0tIHppZ2J1aWxkIC0tdGFyZ2V0IHg4Nl82NC11bmtub3duLWxpbnV4LWdudVxuICAgICAgICB0aGlzLmFyZ3MucHVzaChcbiAgICAgICAgICAnd2F0Y2gnLFxuICAgICAgICAgICctLXdoeScsXG4gICAgICAgICAgJy1pJyxcbiAgICAgICAgICAnKi57anMsdHMsbm9kZX0nLFxuICAgICAgICAgICctdycsXG4gICAgICAgICAgdGhpcy5jcmF0ZURpcixcbiAgICAgICAgICAnLS0nLFxuICAgICAgICAgICdjYXJnbycsXG4gICAgICAgICAgJ2J1aWxkJyxcbiAgICAgICAgKVxuICAgICAgICBzZXQgPSB0cnVlXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5jcm9zc0NvbXBpbGUpIHtcbiAgICAgIGlmICh0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJykge1xuICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICAnWW91IGFyZSB0cnlpbmcgdG8gY3Jvc3MgY29tcGlsZSB0byB3aW4zMiBwbGF0Zm9ybSBvbiB3aW4zMiBwbGF0Zm9ybSB3aGljaCBpcyB1bm5lY2Vzc2FyeS4nLFxuICAgICAgICAgIClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB1c2UgY2FyZ28teHdpbiB0byBjcm9zcyBjb21waWxlIHRvIHdpbjMyIHBsYXRmb3JtXG4gICAgICAgICAgZGVidWcoJ1VzZSAlaScsICdjYXJnby14d2luJylcbiAgICAgICAgICB0cnlJbnN0YWxsQ2FyZ29CaW5hcnkoJ2NhcmdvLXh3aW4nLCAneHdpbicpXG4gICAgICAgICAgdGhpcy5hcmdzLnB1c2goJ3h3aW4nLCAnYnVpbGQnKVxuICAgICAgICAgIGlmICh0aGlzLnRhcmdldC5hcmNoID09PSAnaWEzMicpIHtcbiAgICAgICAgICAgIHRoaXMuZW52cy5YV0lOX0FSQ0ggPSAneDg2J1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZXQgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB0aGlzLnRhcmdldC5wbGF0Zm9ybSA9PT0gJ2xpbnV4JyAmJlxuICAgICAgICAgIHByb2Nlc3MucGxhdGZvcm0gPT09ICdsaW51eCcgJiZcbiAgICAgICAgICB0aGlzLnRhcmdldC5hcmNoID09PSBwcm9jZXNzLmFyY2ggJiZcbiAgICAgICAgICAoZnVuY3Rpb24gKGFiaTogc3RyaW5nIHwgbnVsbCkge1xuICAgICAgICAgICAgY29uc3QgZ2xpYmNWZXJzaW9uUnVudGltZSA9XG4gICAgICAgICAgICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICAgICAgICAgICAgcHJvY2Vzcy5yZXBvcnQ/LmdldFJlcG9ydCgpPy5oZWFkZXI/LmdsaWJjVmVyc2lvblJ1bnRpbWVcbiAgICAgICAgICAgIGNvbnN0IGxpYmMgPSBnbGliY1ZlcnNpb25SdW50aW1lID8gJ2dudScgOiAnbXVzbCdcbiAgICAgICAgICAgIHJldHVybiBhYmkgPT09IGxpYmNcbiAgICAgICAgICB9KSh0aGlzLnRhcmdldC5hYmkpXG4gICAgICAgICkge1xuICAgICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgICAnWW91IGFyZSB0cnlpbmcgdG8gY3Jvc3MgY29tcGlsZSB0byBsaW51eCB0YXJnZXQgb24gbGludXggcGxhdGZvcm0gd2hpY2ggaXMgdW5uZWNlc3NhcnkuJyxcbiAgICAgICAgICApXG4gICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICdkYXJ3aW4nICYmXG4gICAgICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbidcbiAgICAgICAgKSB7XG4gICAgICAgICAgZGVidWcud2FybihcbiAgICAgICAgICAgICdZb3UgYXJlIHRyeWluZyB0byBjcm9zcyBjb21waWxlIHRvIGRhcndpbiB0YXJnZXQgb24gZGFyd2luIHBsYXRmb3JtIHdoaWNoIGlzIHVubmVjZXNzYXJ5LicsXG4gICAgICAgICAgKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHVzZSBjYXJnby16aWdidWlsZCB0byBjcm9zcyBjb21waWxlIHRvIG90aGVyIHBsYXRmb3Jtc1xuICAgICAgICAgIGRlYnVnKCdVc2UgJWknLCAnY2FyZ28temlnYnVpbGQnKVxuICAgICAgICAgIHRyeUluc3RhbGxDYXJnb0JpbmFyeSgnY2FyZ28temlnYnVpbGQnLCAnemlnYnVpbGQnKVxuICAgICAgICAgIHRoaXMuYXJncy5wdXNoKCd6aWdidWlsZCcpXG4gICAgICAgICAgc2V0ID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFzZXQpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCdidWlsZCcpXG4gICAgfVxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIHNldFBhY2thZ2UoKSB7XG4gICAgY29uc3QgYXJncyA9IFtdXG5cbiAgICBpZiAodGhpcy5vcHRpb25zLnBhY2thZ2UpIHtcbiAgICAgIGFyZ3MucHVzaCgnLS1wYWNrYWdlJywgdGhpcy5vcHRpb25zLnBhY2thZ2UpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuYmluTmFtZSkge1xuICAgICAgYXJncy5wdXNoKCctLWJpbicsIHRoaXMuYmluTmFtZSlcbiAgICB9XG5cbiAgICBpZiAoYXJncy5sZW5ndGgpIHtcbiAgICAgIGRlYnVnKCdTZXQgcGFja2FnZSBmbGFnczogJylcbiAgICAgIGRlYnVnKCcgICVPJywgYXJncylcbiAgICAgIHRoaXMuYXJncy5wdXNoKC4uLmFyZ3MpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgc2V0VGFyZ2V0KCkge1xuICAgIGRlYnVnKCdTZXQgY29tcGlsaW5nIHRhcmdldCB0bzogJylcbiAgICBkZWJ1ZygnICAlaScsIHRoaXMudGFyZ2V0LnRyaXBsZSlcblxuICAgIHRoaXMuYXJncy5wdXNoKCctLXRhcmdldCcsIHRoaXMudGFyZ2V0LnRyaXBsZSlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIHNldEVudnMoKSB7XG4gICAgLy8gVFlQRSBERUZcbiAgICBpZiAodGhpcy5lbmFibGVUeXBlRGVmKSB7XG4gICAgICB0aGlzLmVudnMuTkFQSV9UWVBFX0RFRl9UTVBfRk9MREVSID1cbiAgICAgICAgdGhpcy5nZW5lcmF0ZUludGVybWVkaWF0ZVR5cGVEZWZGb2xkZXIoKVxuICAgICAgdGhpcy5zZXRGb3JjZUJ1aWxkRW52cyh0aGlzLmVudnMuTkFQSV9UWVBFX0RFRl9UTVBfRk9MREVSKVxuICAgIH1cblxuICAgIC8vIFJVU1RGTEFHU1xuICAgIGxldCBydXN0ZmxhZ3MgPVxuICAgICAgcHJvY2Vzcy5lbnYuUlVTVEZMQUdTID8/IHByb2Nlc3MuZW52LkNBUkdPX0JVSUxEX1JVU1RGTEFHUyA/PyAnJ1xuXG4gICAgaWYgKFxuICAgICAgdGhpcy50YXJnZXQuYWJpPy5pbmNsdWRlcygnbXVzbCcpICYmXG4gICAgICAhcnVzdGZsYWdzLmluY2x1ZGVzKCd0YXJnZXQtZmVhdHVyZT0tY3J0LXN0YXRpYycpXG4gICAgKSB7XG4gICAgICBydXN0ZmxhZ3MgKz0gJyAtQyB0YXJnZXQtZmVhdHVyZT0tY3J0LXN0YXRpYydcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLnN0cmlwICYmICFydXN0ZmxhZ3MuaW5jbHVkZXMoJ2xpbmstYXJnPS1zJykpIHtcbiAgICAgIHJ1c3RmbGFncyArPSAnIC1DIGxpbmstYXJnPS1zJ1xuICAgIH1cblxuICAgIGlmIChydXN0ZmxhZ3MubGVuZ3RoKSB7XG4gICAgICB0aGlzLmVudnMuUlVTVEZMQUdTID0gcnVzdGZsYWdzXG4gICAgfVxuICAgIC8vIEVORCBSVVNURkxBR1NcblxuICAgIC8vIExJTktFUlxuICAgIGNvbnN0IGxpbmtlciA9IHRoaXMub3B0aW9ucy5jcm9zc0NvbXBpbGVcbiAgICAgID8gdm9pZCAwXG4gICAgICA6IGdldFRhcmdldExpbmtlcih0aGlzLnRhcmdldC50cmlwbGUpXG4gICAgLy8gVE9ETzpcbiAgICAvLyAgIGRpcmVjdGx5IHNldCBDQVJHT19UQVJHRVRfPHRhcmdldD5fTElOS0VSIHdpbGwgY292ZXIgLmNhcmdvL2NvbmZpZy50b21sXG4gICAgLy8gICB3aWxsIGRldGVjdCBieSBjYXJnbyBjb25maWcgd2hlbiBpdCBiZWNvbWVzIHN0YWJsZVxuICAgIC8vICAgc2VlOiBodHRwczovL2dpdGh1Yi5jb20vcnVzdC1sYW5nL2NhcmdvL2lzc3Vlcy85MzAxXG4gICAgY29uc3QgbGlua2VyRW52ID0gYENBUkdPX1RBUkdFVF8ke3RhcmdldFRvRW52VmFyKFxuICAgICAgdGhpcy50YXJnZXQudHJpcGxlLFxuICAgICl9X0xJTktFUmBcbiAgICBpZiAobGlua2VyICYmICFwcm9jZXNzLmVudltsaW5rZXJFbnZdICYmICF0aGlzLmVudnNbbGlua2VyRW52XSkge1xuICAgICAgdGhpcy5lbnZzW2xpbmtlckVudl0gPSBsaW5rZXJcbiAgICB9XG5cbiAgICBpZiAodGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICdhbmRyb2lkJykge1xuICAgICAgdGhpcy5zZXRBbmRyb2lkRW52KClcbiAgICB9XG5cbiAgICBpZiAodGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3YXNpJykge1xuICAgICAgdGhpcy5zZXRXYXNpRW52KClcbiAgICB9XG5cbiAgICBpZiAodGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICdvcGVuaGFybW9ueScpIHtcbiAgICAgIHRoaXMuc2V0T3Blbkhhcm1vbnlFbnYoKVxuICAgIH1cblxuICAgIGRlYnVnKCdTZXQgZW52czogJylcbiAgICBPYmplY3QuZW50cmllcyh0aGlzLmVudnMpLmZvckVhY2goKFtrLCB2XSkgPT4ge1xuICAgICAgZGVidWcoJyAgJWknLCBgJHtrfT0ke3Z9YClcbiAgICB9KVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgc2V0Rm9yY2VCdWlsZEVudnModHlwZURlZlRtcEZvbGRlcjogc3RyaW5nKSB7XG4gICAgLy8gZHluYW1pY2FsbHkgY2hlY2sgYWxsIG5hcGktcnMgZGVwcyBhbmQgc2V0IGBOQVBJX0ZPUkNFX0JVSUxEX3t1cHBlcmNhc2Uoc25ha2VfY2FzZShuYW1lKSl9ID0gdGltZXN0YW1wYFxuICAgIHRoaXMubWV0YWRhdGEucGFja2FnZXMuZm9yRWFjaCgoY3JhdGUpID0+IHtcbiAgICAgIGlmIChcbiAgICAgICAgY3JhdGUuZGVwZW5kZW5jaWVzLnNvbWUoKGQpID0+IGQubmFtZSA9PT0gJ25hcGktZGVyaXZlJykgJiZcbiAgICAgICAgIWV4aXN0c1N5bmMoam9pbih0eXBlRGVmVG1wRm9sZGVyLCBjcmF0ZS5uYW1lKSlcbiAgICAgICkge1xuICAgICAgICB0aGlzLmVudnNbXG4gICAgICAgICAgYE5BUElfRk9SQ0VfQlVJTERfJHtjcmF0ZS5uYW1lLnJlcGxhY2UoLy0vZywgJ18nKS50b1VwcGVyQ2FzZSgpfWBcbiAgICAgICAgXSA9IERhdGUubm93KCkudG9TdHJpbmcoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIHNldEFuZHJvaWRFbnYoKSB7XG4gICAgY29uc3QgeyBBTkRST0lEX05ES19MQVRFU1RfSE9NRSB9ID0gcHJvY2Vzcy5lbnZcbiAgICBpZiAoIUFORFJPSURfTkRLX0xBVEVTVF9IT01FKSB7XG4gICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICBgJHtjb2xvcnMucmVkKFxuICAgICAgICAgICdBTkRST0lEX05ES19MQVRFU1RfSE9NRScsXG4gICAgICAgICl9IGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG1pc3NpbmdgLFxuICAgICAgKVxuICAgIH1cblxuICAgIC8vIHNraXAgY3Jvc3MgY29tcGlsZSBzZXR1cCBpZiBob3N0IGlzIGFuZHJvaWRcbiAgICBpZiAocHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2FuZHJvaWQnKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRBcmNoID0gdGhpcy50YXJnZXQuYXJjaCA9PT0gJ2FybScgPyAnYXJtdjdhJyA6ICdhYXJjaDY0J1xuICAgIGNvbnN0IHRhcmdldFBsYXRmb3JtID1cbiAgICAgIHRoaXMudGFyZ2V0LmFyY2ggPT09ICdhcm0nID8gJ2FuZHJvaWRlYWJpMjQnIDogJ2FuZHJvaWQyNCdcbiAgICBjb25zdCBob3N0UGxhdGZvcm0gPVxuICAgICAgcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ2RhcndpbidcbiAgICAgICAgPyAnZGFyd2luJ1xuICAgICAgICA6IHByb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMidcbiAgICAgICAgICA/ICd3aW5kb3dzJ1xuICAgICAgICAgIDogJ2xpbnV4J1xuICAgIE9iamVjdC5hc3NpZ24odGhpcy5lbnZzLCB7XG4gICAgICBDQVJHT19UQVJHRVRfQUFSQ0g2NF9MSU5VWF9BTkRST0lEX0xJTktFUjogYCR7QU5EUk9JRF9OREtfTEFURVNUX0hPTUV9L3Rvb2xjaGFpbnMvbGx2bS9wcmVidWlsdC8ke2hvc3RQbGF0Zm9ybX0teDg2XzY0L2Jpbi8ke3RhcmdldEFyY2h9LWxpbnV4LWFuZHJvaWQyNC1jbGFuZ2AsXG4gICAgICBDQVJHT19UQVJHRVRfQVJNVjdfTElOVVhfQU5EUk9JREVBQklfTElOS0VSOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluLyR7dGFyZ2V0QXJjaH0tbGludXgtYW5kcm9pZGVhYmkyNC1jbGFuZ2AsXG4gICAgICBUQVJHRVRfQ0M6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vJHt0YXJnZXRBcmNofS1saW51eC0ke3RhcmdldFBsYXRmb3JtfS1jbGFuZ2AsXG4gICAgICBUQVJHRVRfQ1hYOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluLyR7dGFyZ2V0QXJjaH0tbGludXgtJHt0YXJnZXRQbGF0Zm9ybX0tY2xhbmcrK2AsXG4gICAgICBUQVJHRVRfQVI6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4vbGx2bS1hcmAsXG4gICAgICBUQVJHRVRfUkFOTElCOiBgJHtBTkRST0lEX05ES19MQVRFU1RfSE9NRX0vdG9vbGNoYWlucy9sbHZtL3ByZWJ1aWx0LyR7aG9zdFBsYXRmb3JtfS14ODZfNjQvYmluL2xsdm0tcmFubGliYCxcbiAgICAgIEFORFJPSURfTkRLOiBBTkRST0lEX05ES19MQVRFU1RfSE9NRSxcbiAgICAgIFBBVEg6IGAke0FORFJPSURfTkRLX0xBVEVTVF9IT01FfS90b29sY2hhaW5zL2xsdm0vcHJlYnVpbHQvJHtob3N0UGxhdGZvcm19LXg4Nl82NC9iaW4ke3Byb2Nlc3MucGxhdGZvcm0gPT09ICd3aW4zMicgPyAnOycgOiAnOid9JHtwcm9jZXNzLmVudi5QQVRIfWAsXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgc2V0V2FzaUVudigpIHtcbiAgICBjb25zdCBlbW5hcGkgPSBqb2luKFxuICAgICAgcmVxdWlyZS5yZXNvbHZlKCdlbW5hcGknKSxcbiAgICAgICcuLicsXG4gICAgICAnbGliJyxcbiAgICAgICd3YXNtMzItd2FzaS10aHJlYWRzJyxcbiAgICApXG4gICAgdGhpcy5lbnZzLkVNTkFQSV9MSU5LX0RJUiA9IGVtbmFwaVxuICAgIGNvbnN0IGVtbmFwaVZlcnNpb24gPSByZXF1aXJlKCdlbW5hcGkvcGFja2FnZS5qc29uJykudmVyc2lvblxuICAgIGNvbnN0IHByb2plY3RSZXF1aXJlID0gY3JlYXRlUmVxdWlyZShqb2luKHRoaXMub3B0aW9ucy5jd2QsICdwYWNrYWdlLmpzb24nKSlcbiAgICBjb25zdCBlbW5hcGlDb3JlVmVyc2lvbiA9IHByb2plY3RSZXF1aXJlKCdAZW1uYXBpL2NvcmUnKS52ZXJzaW9uXG4gICAgY29uc3QgZW1uYXBpUnVudGltZVZlcnNpb24gPSBwcm9qZWN0UmVxdWlyZSgnQGVtbmFwaS9ydW50aW1lJykudmVyc2lvblxuXG4gICAgaWYgKFxuICAgICAgZW1uYXBpVmVyc2lvbiAhPT0gZW1uYXBpQ29yZVZlcnNpb24gfHxcbiAgICAgIGVtbmFwaVZlcnNpb24gIT09IGVtbmFwaVJ1bnRpbWVWZXJzaW9uXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBlbW5hcGkgdmVyc2lvbiBtaXNtYXRjaDogZW1uYXBpQCR7ZW1uYXBpVmVyc2lvbn0sIEBlbW5hcGkvY29yZUAke2VtbmFwaUNvcmVWZXJzaW9ufSwgQGVtbmFwaS9ydW50aW1lQCR7ZW1uYXBpUnVudGltZVZlcnNpb259LiBQbGVhc2UgZW5zdXJlIGFsbCBlbW5hcGkgcGFja2FnZXMgYXJlIHRoZSBzYW1lIHZlcnNpb24uYCxcbiAgICAgIClcbiAgICB9XG4gICAgY29uc3QgeyBXQVNJX1NES19QQVRIIH0gPSBwcm9jZXNzLmVudlxuXG4gICAgaWYgKFdBU0lfU0RLX1BBVEggJiYgZXhpc3RzU3luYyhXQVNJX1NES19QQVRIKSkge1xuICAgICAgdGhpcy5lbnZzLkNBUkdPX1RBUkdFVF9XQVNNMzJfV0FTSV9QUkVWSUVXMV9USFJFQURTX0xJTktFUiA9IGpvaW4oXG4gICAgICAgIFdBU0lfU0RLX1BBVEgsXG4gICAgICAgICdiaW4nLFxuICAgICAgICAnd2FzbS1sZCcsXG4gICAgICApXG4gICAgICB0aGlzLmVudnMuQ0FSR09fVEFSR0VUX1dBU00zMl9XQVNJUDFfTElOS0VSID0gam9pbihcbiAgICAgICAgV0FTSV9TREtfUEFUSCxcbiAgICAgICAgJ2JpbicsXG4gICAgICAgICd3YXNtLWxkJyxcbiAgICAgIClcbiAgICAgIHRoaXMuZW52cy5DQVJHT19UQVJHRVRfV0FTTTMyX1dBU0lQMV9USFJFQURTX0xJTktFUiA9IGpvaW4oXG4gICAgICAgIFdBU0lfU0RLX1BBVEgsXG4gICAgICAgICdiaW4nLFxuICAgICAgICAnd2FzbS1sZCcsXG4gICAgICApXG4gICAgICB0aGlzLmVudnMuQ0FSR09fVEFSR0VUX1dBU00zMl9XQVNJUDJfTElOS0VSID0gam9pbihcbiAgICAgICAgV0FTSV9TREtfUEFUSCxcbiAgICAgICAgJ2JpbicsXG4gICAgICAgICd3YXNtLWxkJyxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9DQycsIGpvaW4oV0FTSV9TREtfUEFUSCwgJ2JpbicsICdjbGFuZycpKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cyhcbiAgICAgICAgJ1RBUkdFVF9DWFgnLFxuICAgICAgICBqb2luKFdBU0lfU0RLX1BBVEgsICdiaW4nLCAnY2xhbmcrKycpLFxuICAgICAgKVxuICAgICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0FSJywgam9pbihXQVNJX1NES19QQVRILCAnYmluJywgJ2FyJykpXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX1JBTkxJQicsXG4gICAgICAgIGpvaW4oV0FTSV9TREtfUEFUSCwgJ2JpbicsICdyYW5saWInKSxcbiAgICAgIClcbiAgICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoXG4gICAgICAgICdUQVJHRVRfQ0ZMQUdTJyxcbiAgICAgICAgYC0tdGFyZ2V0PXdhc20zMi13YXNpLXRocmVhZHMgLS1zeXNyb290PSR7V0FTSV9TREtfUEFUSH0vc2hhcmUvd2FzaS1zeXNyb290IC1wdGhyZWFkIC1tbGx2bSAtd2FzbS1lbmFibGUtc2psamAsXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICAnVEFSR0VUX0NYWEZMQUdTJyxcbiAgICAgICAgYC0tdGFyZ2V0PXdhc20zMi13YXNpLXRocmVhZHMgLS1zeXNyb290PSR7V0FTSV9TREtfUEFUSH0vc2hhcmUvd2FzaS1zeXNyb290IC1wdGhyZWFkIC1tbGx2bSAtd2FzbS1lbmFibGUtc2psamAsXG4gICAgICApXG4gICAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKFxuICAgICAgICBgVEFSR0VUX0xERkxBR1NgLFxuICAgICAgICBgLWZ1c2UtbGQ9JHtXQVNJX1NES19QQVRIfS9iaW4vd2FzbS1sZCAtLXRhcmdldD13YXNtMzItd2FzaS10aHJlYWRzYCxcbiAgICAgIClcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNldE9wZW5IYXJtb255RW52KCkge1xuICAgIGNvbnN0IHsgT0hPU19TREtfUEFUSCwgT0hPU19TREtfTkFUSVZFIH0gPSBwcm9jZXNzLmVudlxuICAgIGNvbnN0IG5ka1BhdGggPSBPSE9TX1NES19QQVRIID8gYCR7T0hPU19TREtfUEFUSH0vbmF0aXZlYCA6IE9IT1NfU0RLX05BVElWRVxuICAgIC8vIEB0cy1leHBlY3QtZXJyb3JcbiAgICBpZiAoIW5ka1BhdGggJiYgcHJvY2Vzcy5wbGF0Zm9ybSAhPT0gJ29wZW5oYXJtb255Jykge1xuICAgICAgZGVidWcud2FybihcbiAgICAgICAgYCR7Y29sb3JzLnJlZCgnT0hPU19TREtfUEFUSCcpfSBvciAke2NvbG9ycy5yZWQoJ09IT1NfU0RLX05BVElWRScpfSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBtaXNzaW5nYCxcbiAgICAgIClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBjb25zdCBsaW5rZXJOYW1lID0gYENBUkdPX1RBUkdFVF8ke3RoaXMudGFyZ2V0LnRyaXBsZS50b1VwcGVyQ2FzZSgpLnJlcGxhY2UoLy0vZywgJ18nKX1fTElOS0VSYFxuICAgIGNvbnN0IHJhblBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLXJhbmxpYmBcbiAgICBjb25zdCBhclBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLWFyYFxuICAgIGNvbnN0IGNjUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluLyR7dGhpcy50YXJnZXQudHJpcGxlfS1jbGFuZ2BcbiAgICBjb25zdCBjeHhQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vJHt0aGlzLnRhcmdldC50cmlwbGV9LWNsYW5nKytgXG4gICAgY29uc3QgYXNQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1hc2BcbiAgICBjb25zdCBsZFBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sZC5sbGRgXG4gICAgY29uc3Qgc3RyaXBQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9iaW4vbGx2bS1zdHJpcGBcbiAgICBjb25zdCBvYmpEdW1wUGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tb2JqZHVtcGBcbiAgICBjb25zdCBvYmpDb3B5UGF0aCA9IGAke25ka1BhdGh9L2xsdm0vYmluL2xsdm0tb2JqY29weWBcbiAgICBjb25zdCBubVBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2Jpbi9sbHZtLW5tYFxuICAgIGNvbnN0IGJpblBhdGggPSBgJHtuZGtQYXRofS9sbHZtL2JpbmBcbiAgICBjb25zdCBsaWJQYXRoID0gYCR7bmRrUGF0aH0vbGx2bS9saWJgXG5cbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdMSUJDTEFOR19QQVRIJywgbGliUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdERVBfQVRPTUlDJywgJ2NsYW5nX3J0LmJ1aWx0aW5zJylcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKGxpbmtlck5hbWUsIGNjUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfQ0MnLCBjY1BhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0NYWCcsIGN4eFBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX0FSJywgYXJQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9SQU5MSUInLCByYW5QYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9BUycsIGFzUGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfTEQnLCBsZFBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX1NUUklQJywgc3RyaXBQYXRoKVxuICAgIHRoaXMuc2V0RW52SWZOb3RFeGlzdHMoJ1RBUkdFVF9PQkpEVU1QJywgb2JqRHVtcFBhdGgpXG4gICAgdGhpcy5zZXRFbnZJZk5vdEV4aXN0cygnVEFSR0VUX09CSkNPUFknLCBvYmpDb3B5UGF0aClcbiAgICB0aGlzLnNldEVudklmTm90RXhpc3RzKCdUQVJHRVRfTk0nLCBubVBhdGgpXG4gICAgdGhpcy5lbnZzLlBBVEggPSBgJHtiaW5QYXRofSR7cHJvY2Vzcy5wbGF0Zm9ybSA9PT0gJ3dpbjMyJyA/ICc7JyA6ICc6J30ke3Byb2Nlc3MuZW52LlBBVEh9YFxuICB9XG5cbiAgcHJpdmF0ZSBzZXRGZWF0dXJlcygpIHtcbiAgICBjb25zdCBhcmdzID0gW11cbiAgICBpZiAodGhpcy5vcHRpb25zLmFsbEZlYXR1cmVzICYmIHRoaXMub3B0aW9ucy5ub0RlZmF1bHRGZWF0dXJlcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnQ2Fubm90IHNwZWNpZnkgLS1hbGwtZmVhdHVyZXMgYW5kIC0tbm8tZGVmYXVsdC1mZWF0dXJlcyB0b2dldGhlcicsXG4gICAgICApXG4gICAgfVxuICAgIGlmICh0aGlzLm9wdGlvbnMuYWxsRmVhdHVyZXMpIHtcbiAgICAgIGFyZ3MucHVzaCgnLS1hbGwtZmVhdHVyZXMnKVxuICAgIH0gZWxzZSBpZiAodGhpcy5vcHRpb25zLm5vRGVmYXVsdEZlYXR1cmVzKSB7XG4gICAgICBhcmdzLnB1c2goJy0tbm8tZGVmYXVsdC1mZWF0dXJlcycpXG4gICAgfVxuICAgIGlmICh0aGlzLm9wdGlvbnMuZmVhdHVyZXMpIHtcbiAgICAgIGFyZ3MucHVzaCgnLS1mZWF0dXJlcycsIC4uLnRoaXMub3B0aW9ucy5mZWF0dXJlcylcbiAgICB9XG5cbiAgICBkZWJ1ZygnU2V0IGZlYXR1cmVzIGZsYWdzOiAnKVxuICAgIGRlYnVnKCcgICVPJywgYXJncylcbiAgICB0aGlzLmFyZ3MucHVzaCguLi5hcmdzKVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIHByaXZhdGUgc2V0QnlwYXNzQXJncygpIHtcbiAgICBpZiAodGhpcy5vcHRpb25zLnJlbGVhc2UpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCctLXJlbGVhc2UnKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMudmVyYm9zZSkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJy0tdmVyYm9zZScpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0aW9ucy50YXJnZXREaXIpIHtcbiAgICAgIHRoaXMuYXJncy5wdXNoKCctLXRhcmdldC1kaXInLCB0aGlzLm9wdGlvbnMudGFyZ2V0RGlyKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMucHJvZmlsZSkge1xuICAgICAgdGhpcy5hcmdzLnB1c2goJy0tcHJvZmlsZScsIHRoaXMub3B0aW9ucy5wcm9maWxlKVxuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdGlvbnMubWFuaWZlc3RQYXRoKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCgnLS1tYW5pZmVzdC1wYXRoJywgdGhpcy5vcHRpb25zLm1hbmlmZXN0UGF0aClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vcHRpb25zLmNhcmdvT3B0aW9ucz8ubGVuZ3RoKSB7XG4gICAgICB0aGlzLmFyZ3MucHVzaCguLi50aGlzLm9wdGlvbnMuY2FyZ29PcHRpb25zKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICBwcml2YXRlIGdlbmVyYXRlSW50ZXJtZWRpYXRlVHlwZURlZkZvbGRlcigpIHtcbiAgICBsZXQgZm9sZGVyID0gam9pbihcbiAgICAgIHRoaXMudGFyZ2V0RGlyLFxuICAgICAgJ25hcGktcnMnLFxuICAgICAgYCR7dGhpcy5jcmF0ZS5uYW1lfS0ke2NyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgIC51cGRhdGUodGhpcy5jcmF0ZS5tYW5pZmVzdF9wYXRoKVxuICAgICAgICAudXBkYXRlKENMSV9WRVJTSU9OKVxuICAgICAgICAuZGlnZXN0KCdoZXgnKVxuICAgICAgICAuc3Vic3RyaW5nKDAsIDgpfWAsXG4gICAgKVxuXG4gICAgaWYgKCF0aGlzLm9wdGlvbnMuZHRzQ2FjaGUpIHtcbiAgICAgIHJtU3luYyhmb2xkZXIsIHsgcmVjdXJzaXZlOiB0cnVlLCBmb3JjZTogdHJ1ZSB9KVxuICAgICAgZm9sZGVyICs9IGBfJHtEYXRlLm5vdygpfWBcbiAgICB9XG5cbiAgICBta2RpckFzeW5jKGZvbGRlciwgeyByZWN1cnNpdmU6IHRydWUgfSlcblxuICAgIHJldHVybiBmb2xkZXJcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcG9zdEJ1aWxkKCkge1xuICAgIHRyeSB7XG4gICAgICBkZWJ1ZyhgVHJ5IHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5OmApXG4gICAgICBkZWJ1ZygnICAlaScsIHRoaXMub3V0cHV0RGlyKVxuICAgICAgYXdhaXQgbWtkaXJBc3luYyh0aGlzLm91dHB1dERpciwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgICAgIGRlYnVnKGBPdXRwdXQgZGlyZWN0b3J5IGNyZWF0ZWRgKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5ICR7dGhpcy5vdXRwdXREaXJ9YCwge1xuICAgICAgICBjYXVzZTogZSxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgY29uc3Qgd2FzbUJpbmFyeU5hbWUgPSBhd2FpdCB0aGlzLmNvcHlBcnRpZmFjdCgpXG5cbiAgICAvLyBvbmx5IGZvciBjZHlsaWJcbiAgICBpZiAodGhpcy5jZHlMaWJOYW1lKSB7XG4gICAgICBjb25zdCBpZGVudHMgPSBhd2FpdCB0aGlzLmdlbmVyYXRlVHlwZURlZigpXG4gICAgICBjb25zdCBqc091dHB1dCA9IGF3YWl0IHRoaXMud3JpdGVKc0JpbmRpbmcoaWRlbnRzKVxuICAgICAgY29uc3Qgd2FzbUJpbmRpbmdzT3V0cHV0ID0gYXdhaXQgdGhpcy53cml0ZVdhc2lCaW5kaW5nKFxuICAgICAgICB3YXNtQmluYXJ5TmFtZSxcbiAgICAgICAgaWRlbnRzLFxuICAgICAgKVxuICAgICAgaWYgKGpzT3V0cHV0KSB7XG4gICAgICAgIHRoaXMub3V0cHV0cy5wdXNoKGpzT3V0cHV0KVxuICAgICAgfVxuICAgICAgaWYgKHdhc21CaW5kaW5nc091dHB1dCkge1xuICAgICAgICB0aGlzLm91dHB1dHMucHVzaCguLi53YXNtQmluZGluZ3NPdXRwdXQpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMub3V0cHV0c1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb3B5QXJ0aWZhY3QoKSB7XG4gICAgY29uc3QgW3NyY05hbWUsIGRlc3ROYW1lLCB3YXNtQmluYXJ5TmFtZV0gPSB0aGlzLmdldEFydGlmYWN0TmFtZXMoKVxuICAgIGlmICghc3JjTmFtZSB8fCAhZGVzdE5hbWUpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHByb2ZpbGUgPVxuICAgICAgdGhpcy5vcHRpb25zLnByb2ZpbGUgPz8gKHRoaXMub3B0aW9ucy5yZWxlYXNlID8gJ3JlbGVhc2UnIDogJ2RlYnVnJylcbiAgICBjb25zdCBzcmMgPSBqb2luKHRoaXMudGFyZ2V0RGlyLCB0aGlzLnRhcmdldC50cmlwbGUsIHByb2ZpbGUsIHNyY05hbWUpXG4gICAgZGVidWcoYENvcHkgYXJ0aWZhY3QgZnJvbTogWyR7c3JjfV1gKVxuICAgIGNvbnN0IGRlc3QgPSBqb2luKHRoaXMub3V0cHV0RGlyLCBkZXN0TmFtZSlcbiAgICBjb25zdCBpc1dhc20gPSBkZXN0LmVuZHNXaXRoKCcud2FzbScpXG5cbiAgICB0cnkge1xuICAgICAgaWYgKGF3YWl0IGZpbGVFeGlzdHMoZGVzdCkpIHtcbiAgICAgICAgZGVidWcoJ09sZCBhcnRpZmFjdCBmb3VuZCwgcmVtb3ZlIGl0IGZpcnN0JylcbiAgICAgICAgYXdhaXQgdW5saW5rQXN5bmMoZGVzdClcbiAgICAgIH1cbiAgICAgIGRlYnVnKCdDb3B5IGFydGlmYWN0IHRvOicpXG4gICAgICBkZWJ1ZygnICAlaScsIGRlc3QpXG4gICAgICBpZiAoaXNXYXNtKSB7XG4gICAgICAgIGNvbnN0IHsgTW9kdWxlQ29uZmlnIH0gPSBhd2FpdCBpbXBvcnQoJ0BuYXBpLXJzL3dhc20tdG9vbHMnKVxuICAgICAgICBkZWJ1ZygnR2VuZXJhdGUgZGVidWcgd2FzbSBtb2R1bGUnKVxuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGRlYnVnV2FzbU1vZHVsZSA9IG5ldyBNb2R1bGVDb25maWcoKVxuICAgICAgICAgICAgLmdlbmVyYXRlRHdhcmYodHJ1ZSlcbiAgICAgICAgICAgIC5nZW5lcmF0ZU5hbWVTZWN0aW9uKHRydWUpXG4gICAgICAgICAgICAuZ2VuZXJhdGVQcm9kdWNlcnNTZWN0aW9uKHRydWUpXG4gICAgICAgICAgICAucHJlc2VydmVDb2RlVHJhbnNmb3JtKHRydWUpXG4gICAgICAgICAgICAuc3RyaWN0VmFsaWRhdGUoZmFsc2UpXG4gICAgICAgICAgICAucGFyc2UoYXdhaXQgcmVhZEZpbGVBc3luYyhzcmMpKVxuICAgICAgICAgIGNvbnN0IGRlYnVnV2FzbUJpbmFyeSA9IGRlYnVnV2FzbU1vZHVsZS5lbWl0V2FzbSh0cnVlKVxuICAgICAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICAgICAgZGVzdC5yZXBsYWNlKC9cXC53YXNtJC8sICcuZGVidWcud2FzbScpLFxuICAgICAgICAgICAgZGVidWdXYXNtQmluYXJ5LFxuICAgICAgICAgIClcbiAgICAgICAgICBkZWJ1ZygnR2VuZXJhdGUgcmVsZWFzZSB3YXNtIG1vZHVsZScpXG4gICAgICAgICAgY29uc3QgcmVsZWFzZVdhc21Nb2R1bGUgPSBuZXcgTW9kdWxlQ29uZmlnKClcbiAgICAgICAgICAgIC5nZW5lcmF0ZUR3YXJmKGZhbHNlKVxuICAgICAgICAgICAgLmdlbmVyYXRlTmFtZVNlY3Rpb24oZmFsc2UpXG4gICAgICAgICAgICAuZ2VuZXJhdGVQcm9kdWNlcnNTZWN0aW9uKGZhbHNlKVxuICAgICAgICAgICAgLnByZXNlcnZlQ29kZVRyYW5zZm9ybShmYWxzZSlcbiAgICAgICAgICAgIC5zdHJpY3RWYWxpZGF0ZShmYWxzZSlcbiAgICAgICAgICAgIC5vbmx5U3RhYmxlRmVhdHVyZXMoZmFsc2UpXG4gICAgICAgICAgICAucGFyc2UoZGVidWdXYXNtQmluYXJ5KVxuICAgICAgICAgIGNvbnN0IHJlbGVhc2VXYXNtQmluYXJ5ID0gcmVsZWFzZVdhc21Nb2R1bGUuZW1pdFdhc20oZmFsc2UpXG4gICAgICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoZGVzdCwgcmVsZWFzZVdhc21CaW5hcnkpXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBkZWJ1Zy53YXJuKFxuICAgICAgICAgICAgYEZhaWxlZCB0byBnZW5lcmF0ZSBkZWJ1ZyB3YXNtIG1vZHVsZTogJHsoZSBhcyBhbnkpLm1lc3NhZ2UgPz8gZX1gLFxuICAgICAgICAgIClcbiAgICAgICAgICBhd2FpdCBjb3B5RmlsZUFzeW5jKHNyYywgZGVzdClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgY29weUZpbGVBc3luYyhzcmMsIGRlc3QpXG4gICAgICB9XG4gICAgICB0aGlzLm91dHB1dHMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGRlc3QuZW5kc1dpdGgoJy5ub2RlJykgPyAnbm9kZScgOiBpc1dhc20gPyAnd2FzbScgOiAnZXhlJyxcbiAgICAgICAgcGF0aDogZGVzdCxcbiAgICAgIH0pXG4gICAgICByZXR1cm4gd2FzbUJpbmFyeU5hbWUgPyBqb2luKHRoaXMub3V0cHV0RGlyLCB3YXNtQmluYXJ5TmFtZSkgOiBudWxsXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gY29weSBhcnRpZmFjdCcsIHsgY2F1c2U6IGUgfSlcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldEFydGlmYWN0TmFtZXMoKSB7XG4gICAgaWYgKHRoaXMuY2R5TGliTmFtZSkge1xuICAgICAgY29uc3QgY2R5TGliID0gdGhpcy5jZHlMaWJOYW1lLnJlcGxhY2UoLy0vZywgJ18nKVxuICAgICAgY29uc3Qgd2FzaVRhcmdldCA9IHRoaXMuY29uZmlnLnRhcmdldHMuZmluZCgodCkgPT4gdC5wbGF0Zm9ybSA9PT0gJ3dhc2knKVxuXG4gICAgICBjb25zdCBzcmNOYW1lID1cbiAgICAgICAgdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICdkYXJ3aW4nXG4gICAgICAgICAgPyBgbGliJHtjZHlMaWJ9LmR5bGliYFxuICAgICAgICAgIDogdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3aW4zMidcbiAgICAgICAgICAgID8gYCR7Y2R5TGlifS5kbGxgXG4gICAgICAgICAgICA6IHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2FzaScgfHwgdGhpcy50YXJnZXQucGxhdGZvcm0gPT09ICd3YXNtJ1xuICAgICAgICAgICAgICA/IGAke2NkeUxpYn0ud2FzbWBcbiAgICAgICAgICAgICAgOiBgbGliJHtjZHlMaWJ9LnNvYFxuXG4gICAgICBsZXQgZGVzdE5hbWUgPSB0aGlzLmNvbmZpZy5iaW5hcnlOYW1lXG4gICAgICAvLyBhZGQgcGxhdGZvcm0gc3VmZml4IHRvIGJpbmFyeSBuYW1lXG4gICAgICAvLyBpbmRleFsubGludXgteDY0LWdudV0ubm9kZVxuICAgICAgLy8gICAgICAgXl5eXl5eXl5eXl5eXl5cbiAgICAgIGlmICh0aGlzLm9wdGlvbnMucGxhdGZvcm0pIHtcbiAgICAgICAgZGVzdE5hbWUgKz0gYC4ke3RoaXMudGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1gXG4gICAgICB9XG4gICAgICBpZiAoc3JjTmFtZS5lbmRzV2l0aCgnLndhc20nKSkge1xuICAgICAgICBkZXN0TmFtZSArPSAnLndhc20nXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZXN0TmFtZSArPSAnLm5vZGUnXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBbXG4gICAgICAgIHNyY05hbWUsXG4gICAgICAgIGRlc3ROYW1lLFxuICAgICAgICB3YXNpVGFyZ2V0XG4gICAgICAgICAgPyBgJHt0aGlzLmNvbmZpZy5iaW5hcnlOYW1lfS4ke3dhc2lUYXJnZXQucGxhdGZvcm1BcmNoQUJJfS53YXNtYFxuICAgICAgICAgIDogbnVsbCxcbiAgICAgIF1cbiAgICB9IGVsc2UgaWYgKHRoaXMuYmluTmFtZSkge1xuICAgICAgY29uc3Qgc3JjTmFtZSA9XG4gICAgICAgIHRoaXMudGFyZ2V0LnBsYXRmb3JtID09PSAnd2luMzInID8gYCR7dGhpcy5iaW5OYW1lfS5leGVgIDogdGhpcy5iaW5OYW1lXG5cbiAgICAgIHJldHVybiBbc3JjTmFtZSwgc3JjTmFtZV1cbiAgICB9XG5cbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2VuZXJhdGVUeXBlRGVmKCkge1xuICAgIGNvbnN0IHR5cGVEZWZEaXIgPSB0aGlzLmVudnMuTkFQSV9UWVBFX0RFRl9UTVBfRk9MREVSXG4gICAgaWYgKCF0aGlzLmVuYWJsZVR5cGVEZWYpIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cblxuICAgIGNvbnN0IHsgZXhwb3J0cywgZHRzIH0gPSBhd2FpdCBnZW5lcmF0ZVR5cGVEZWYoe1xuICAgICAgdHlwZURlZkRpcixcbiAgICAgIG5vRHRzSGVhZGVyOiB0aGlzLm9wdGlvbnMubm9EdHNIZWFkZXIsXG4gICAgICBkdHNIZWFkZXI6IHRoaXMub3B0aW9ucy5kdHNIZWFkZXIsXG4gICAgICBjb25maWdEdHNIZWFkZXI6IHRoaXMuY29uZmlnLmR0c0hlYWRlcixcbiAgICAgIGNvbmZpZ0R0c0hlYWRlckZpbGU6IHRoaXMuY29uZmlnLmR0c0hlYWRlckZpbGUsXG4gICAgICBjb25zdEVudW06IHRoaXMub3B0aW9ucy5jb25zdEVudW0gPz8gdGhpcy5jb25maWcuY29uc3RFbnVtLFxuICAgICAgY3dkOiB0aGlzLm9wdGlvbnMuY3dkLFxuICAgIH0pXG5cbiAgICBjb25zdCBkZXN0ID0gam9pbih0aGlzLm91dHB1dERpciwgdGhpcy5vcHRpb25zLmR0cyA/PyAnaW5kZXguZC50cycpXG5cbiAgICB0cnkge1xuICAgICAgZGVidWcoJ1dyaXRpbmcgdHlwZSBkZWYgdG86JylcbiAgICAgIGRlYnVnKCcgICVpJywgZGVzdClcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGRlc3QsIGR0cywgJ3V0Zi04JylcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBkZWJ1Zy5lcnJvcignRmFpbGVkIHRvIHdyaXRlIHR5cGUgZGVmIGZpbGUnKVxuICAgICAgZGVidWcuZXJyb3IoZSBhcyBFcnJvcilcbiAgICB9XG5cbiAgICBpZiAoZXhwb3J0cy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBkZXN0ID0gam9pbih0aGlzLm91dHB1dERpciwgdGhpcy5vcHRpb25zLmR0cyA/PyAnaW5kZXguZC50cycpXG4gICAgICB0aGlzLm91dHB1dHMucHVzaCh7IGtpbmQ6ICdkdHMnLCBwYXRoOiBkZXN0IH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIGV4cG9ydHNcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVKc0JpbmRpbmcoaWRlbnRzOiBzdHJpbmdbXSkge1xuICAgIHJldHVybiB3cml0ZUpzQmluZGluZyh7XG4gICAgICBwbGF0Zm9ybTogdGhpcy5vcHRpb25zLnBsYXRmb3JtLFxuICAgICAgbm9Kc0JpbmRpbmc6IHRoaXMub3B0aW9ucy5ub0pzQmluZGluZyxcbiAgICAgIGlkZW50cyxcbiAgICAgIGpzQmluZGluZzogdGhpcy5vcHRpb25zLmpzQmluZGluZyxcbiAgICAgIGVzbTogdGhpcy5vcHRpb25zLmVzbSxcbiAgICAgIGJpbmFyeU5hbWU6IHRoaXMuY29uZmlnLmJpbmFyeU5hbWUsXG4gICAgICBwYWNrYWdlTmFtZTogdGhpcy5vcHRpb25zLmpzUGFja2FnZU5hbWUgPz8gdGhpcy5jb25maWcucGFja2FnZU5hbWUsXG4gICAgICB2ZXJzaW9uOiBwcm9jZXNzLmVudi5ucG1fbmV3X3ZlcnNpb24gPz8gdGhpcy5jb25maWcucGFja2FnZUpzb24udmVyc2lvbixcbiAgICAgIG91dHB1dERpcjogdGhpcy5vdXRwdXREaXIsXG4gICAgfSlcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVXYXNpQmluZGluZyhcbiAgICBkaXN0RmlsZU5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZCB8IG51bGwsXG4gICAgaWRlbnRzOiBzdHJpbmdbXSxcbiAgKSB7XG4gICAgaWYgKGRpc3RGaWxlTmFtZSkge1xuICAgICAgY29uc3QgeyBuYW1lLCBkaXIgfSA9IHBhcnNlKGRpc3RGaWxlTmFtZSlcbiAgICAgIGNvbnN0IGJpbmRpbmdQYXRoID0gam9pbihkaXIsIGAke3RoaXMuY29uZmlnLmJpbmFyeU5hbWV9Lndhc2kuY2pzYClcbiAgICAgIGNvbnN0IGJyb3dzZXJCaW5kaW5nUGF0aCA9IGpvaW4oXG4gICAgICAgIGRpcixcbiAgICAgICAgYCR7dGhpcy5jb25maWcuYmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYCxcbiAgICAgIClcbiAgICAgIGNvbnN0IHdvcmtlclBhdGggPSBqb2luKGRpciwgJ3dhc2ktd29ya2VyLm1qcycpXG4gICAgICBjb25zdCBicm93c2VyV29ya2VyUGF0aCA9IGpvaW4oZGlyLCAnd2FzaS13b3JrZXItYnJvd3Nlci5tanMnKVxuICAgICAgY29uc3QgYnJvd3NlckVudHJ5UGF0aCA9IGpvaW4oZGlyLCAnYnJvd3Nlci5qcycpXG4gICAgICBjb25zdCBleHBvcnRzQ29kZSA9XG4gICAgICAgIGBtb2R1bGUuZXhwb3J0cyA9IF9fbmFwaU1vZHVsZS5leHBvcnRzXFxuYCArXG4gICAgICAgIGlkZW50c1xuICAgICAgICAgIC5tYXAoXG4gICAgICAgICAgICAoaWRlbnQpID0+XG4gICAgICAgICAgICAgIGBtb2R1bGUuZXhwb3J0cy4ke2lkZW50fSA9IF9fbmFwaU1vZHVsZS5leHBvcnRzLiR7aWRlbnR9YCxcbiAgICAgICAgICApXG4gICAgICAgICAgLmpvaW4oJ1xcbicpXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhcbiAgICAgICAgYmluZGluZ1BhdGgsXG4gICAgICAgIGNyZWF0ZVdhc2lCaW5kaW5nKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgdGhpcy5jb25maWcucGFja2FnZU5hbWUsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uaW5pdGlhbE1lbW9yeSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5tYXhpbXVtTWVtb3J5LFxuICAgICAgICApICtcbiAgICAgICAgICBleHBvcnRzQ29kZSArXG4gICAgICAgICAgJ1xcbicsXG4gICAgICAgICd1dGY4JyxcbiAgICAgIClcbiAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICBicm93c2VyQmluZGluZ1BhdGgsXG4gICAgICAgIGNyZWF0ZVdhc2lCcm93c2VyQmluZGluZyhcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmluaXRpYWxNZW1vcnksXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8ubWF4aW11bU1lbW9yeSxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5mcyxcbiAgICAgICAgICB0aGlzLmNvbmZpZy53YXNtPy5icm93c2VyPy5hc3luY0luaXQsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uYnVmZmVyLFxuICAgICAgICAgIHRoaXMuY29uZmlnLndhc20/LmJyb3dzZXI/LmVycm9yRXZlbnQsXG4gICAgICAgICkgK1xuICAgICAgICAgIGBleHBvcnQgZGVmYXVsdCBfX25hcGlNb2R1bGUuZXhwb3J0c1xcbmAgK1xuICAgICAgICAgIGlkZW50c1xuICAgICAgICAgICAgLm1hcChcbiAgICAgICAgICAgICAgKGlkZW50KSA9PlxuICAgICAgICAgICAgICAgIGBleHBvcnQgY29uc3QgJHtpZGVudH0gPSBfX25hcGlNb2R1bGUuZXhwb3J0cy4ke2lkZW50fWAsXG4gICAgICAgICAgICApXG4gICAgICAgICAgICAuam9pbignXFxuJykgK1xuICAgICAgICAgICdcXG4nLFxuICAgICAgICAndXRmOCcsXG4gICAgICApXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyh3b3JrZXJQYXRoLCBXQVNJX1dPUktFUl9URU1QTEFURSwgJ3V0ZjgnKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgIGJyb3dzZXJXb3JrZXJQYXRoLFxuICAgICAgICBjcmVhdGVXYXNpQnJvd3NlcldvcmtlckJpbmRpbmcoXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uZnMgPz8gZmFsc2UsXG4gICAgICAgICAgdGhpcy5jb25maWcud2FzbT8uYnJvd3Nlcj8uZXJyb3JFdmVudCA/PyBmYWxzZSxcbiAgICAgICAgKSxcbiAgICAgICAgJ3V0ZjgnLFxuICAgICAgKVxuICAgICAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgICAgIGJyb3dzZXJFbnRyeVBhdGgsXG4gICAgICAgIGBleHBvcnQgKiBmcm9tICcke3RoaXMuY29uZmlnLnBhY2thZ2VOYW1lfS13YXNtMzItd2FzaSdcXG5gLFxuICAgICAgKVxuICAgICAgcmV0dXJuIFtcbiAgICAgICAgeyBraW5kOiAnanMnLCBwYXRoOiBiaW5kaW5nUGF0aCB9LFxuICAgICAgICB7IGtpbmQ6ICdqcycsIHBhdGg6IGJyb3dzZXJCaW5kaW5nUGF0aCB9LFxuICAgICAgICB7IGtpbmQ6ICdqcycsIHBhdGg6IHdvcmtlclBhdGggfSxcbiAgICAgICAgeyBraW5kOiAnanMnLCBwYXRoOiBicm93c2VyV29ya2VyUGF0aCB9LFxuICAgICAgICB7IGtpbmQ6ICdqcycsIHBhdGg6IGJyb3dzZXJFbnRyeVBhdGggfSxcbiAgICAgIF0gc2F0aXNmaWVzIE91dHB1dFtdXG4gICAgfVxuICAgIHJldHVybiBbXVxuICB9XG5cbiAgcHJpdmF0ZSBzZXRFbnZJZk5vdEV4aXN0cyhlbnY6IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICAgIGlmICghcHJvY2Vzcy5lbnZbZW52XSkge1xuICAgICAgdGhpcy5lbnZzW2Vudl0gPSB2YWx1ZVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdyaXRlSnNCaW5kaW5nT3B0aW9ucyB7XG4gIHBsYXRmb3JtPzogYm9vbGVhblxuICBub0pzQmluZGluZz86IGJvb2xlYW5cbiAgaWRlbnRzOiBzdHJpbmdbXVxuICBqc0JpbmRpbmc/OiBzdHJpbmdcbiAgZXNtPzogYm9vbGVhblxuICBiaW5hcnlOYW1lOiBzdHJpbmdcbiAgcGFja2FnZU5hbWU6IHN0cmluZ1xuICB2ZXJzaW9uOiBzdHJpbmdcbiAgb3V0cHV0RGlyOiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHdyaXRlSnNCaW5kaW5nKFxuICBvcHRpb25zOiBXcml0ZUpzQmluZGluZ09wdGlvbnMsXG4pOiBQcm9taXNlPE91dHB1dCB8IHVuZGVmaW5lZD4ge1xuICBpZiAoXG4gICAgIW9wdGlvbnMucGxhdGZvcm0gfHxcbiAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L3ByZWZlci1udWxsaXNoLWNvYWxlc2NpbmdcbiAgICBvcHRpb25zLm5vSnNCaW5kaW5nIHx8XG4gICAgb3B0aW9ucy5pZGVudHMubGVuZ3RoID09PSAwXG4gICkge1xuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgbmFtZSA9IG9wdGlvbnMuanNCaW5kaW5nID8/ICdpbmRleC5qcydcblxuICBjb25zdCBjcmVhdGVCaW5kaW5nID0gb3B0aW9ucy5lc20gPyBjcmVhdGVFc21CaW5kaW5nIDogY3JlYXRlQ2pzQmluZGluZ1xuICBjb25zdCBiaW5kaW5nID0gY3JlYXRlQmluZGluZyhcbiAgICBvcHRpb25zLmJpbmFyeU5hbWUsXG4gICAgb3B0aW9ucy5wYWNrYWdlTmFtZSxcbiAgICBvcHRpb25zLmlkZW50cyxcbiAgICAvLyBpbiBucG0gcHJldmVyc2lvbiBob29rXG4gICAgb3B0aW9ucy52ZXJzaW9uLFxuICApXG5cbiAgdHJ5IHtcbiAgICBjb25zdCBkZXN0ID0gam9pbihvcHRpb25zLm91dHB1dERpciwgbmFtZSlcbiAgICBkZWJ1ZygnV3JpdGluZyBqcyBiaW5kaW5nIHRvOicpXG4gICAgZGVidWcoJyAgJWknLCBkZXN0KVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGRlc3QsIGJpbmRpbmcsICd1dGYtOCcpXG4gICAgcmV0dXJuIHsga2luZDogJ2pzJywgcGF0aDogZGVzdCB9IHNhdGlzZmllcyBPdXRwdXRcbiAgfSBjYXRjaCAoZSkge1xuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIHdyaXRlIGpzIGJpbmRpbmcgZmlsZScsIHsgY2F1c2U6IGUgfSlcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVyYXRlVHlwZURlZk9wdGlvbnMge1xuICB0eXBlRGVmRGlyOiBzdHJpbmdcbiAgbm9EdHNIZWFkZXI/OiBib29sZWFuXG4gIGR0c0hlYWRlcj86IHN0cmluZ1xuICBkdHNIZWFkZXJGaWxlPzogc3RyaW5nXG4gIGNvbmZpZ0R0c0hlYWRlcj86IHN0cmluZ1xuICBjb25maWdEdHNIZWFkZXJGaWxlPzogc3RyaW5nXG4gIGNvbnN0RW51bT86IGJvb2xlYW5cbiAgY3dkOiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdlbmVyYXRlVHlwZURlZihcbiAgb3B0aW9uczogR2VuZXJhdGVUeXBlRGVmT3B0aW9ucyxcbik6IFByb21pc2U8eyBleHBvcnRzOiBzdHJpbmdbXTsgZHRzOiBzdHJpbmcgfT4ge1xuICBpZiAoIShhd2FpdCBkaXJFeGlzdHNBc3luYyhvcHRpb25zLnR5cGVEZWZEaXIpKSkge1xuICAgIHJldHVybiB7IGV4cG9ydHM6IFtdLCBkdHM6ICcnIH1cbiAgfVxuXG4gIGxldCBoZWFkZXIgPSAnJ1xuICBsZXQgZHRzID0gJydcbiAgbGV0IGV4cG9ydHM6IHN0cmluZ1tdID0gW11cblxuICBpZiAoIW9wdGlvbnMubm9EdHNIZWFkZXIpIHtcbiAgICBjb25zdCBkdHNIZWFkZXIgPSBvcHRpb25zLmR0c0hlYWRlciA/PyBvcHRpb25zLmNvbmZpZ0R0c0hlYWRlclxuICAgIC8vIGBkdHNIZWFkZXJGaWxlYCBpbiBjb25maWcgPiBgZHRzSGVhZGVyYCBpbiBjbGkgZmxhZyA+IGBkdHNIZWFkZXJgIGluIGNvbmZpZ1xuICAgIGlmIChvcHRpb25zLmNvbmZpZ0R0c0hlYWRlckZpbGUpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGhlYWRlciA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoXG4gICAgICAgICAgam9pbihvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdEdHNIZWFkZXJGaWxlKSxcbiAgICAgICAgICAndXRmLTgnLFxuICAgICAgICApXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGRlYnVnLndhcm4oXG4gICAgICAgICAgYEZhaWxlZCB0byByZWFkIGR0cyBoZWFkZXIgZmlsZSAke29wdGlvbnMuY29uZmlnRHRzSGVhZGVyRmlsZX1gLFxuICAgICAgICAgIGUsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGR0c0hlYWRlcikge1xuICAgICAgaGVhZGVyID0gZHRzSGVhZGVyXG4gICAgfSBlbHNlIHtcbiAgICAgIGhlYWRlciA9IERFRkFVTFRfVFlQRV9ERUZfSEVBREVSXG4gICAgfVxuICB9XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCByZWFkZGlyQXN5bmMob3B0aW9ucy50eXBlRGVmRGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSlcblxuICBpZiAoIWZpbGVzLmxlbmd0aCkge1xuICAgIGRlYnVnKCdObyB0eXBlIGRlZiBmaWxlcyBmb3VuZC4gU2tpcCBnZW5lcmF0aW5nIGR0cyBmaWxlLicpXG4gICAgcmV0dXJuIHsgZXhwb3J0czogW10sIGR0czogJycgfVxuICB9XG5cbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgaWYgKCFmaWxlLmlzRmlsZSgpKSB7XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHsgZHRzOiBmaWxlRHRzLCBleHBvcnRzOiBmaWxlRXhwb3J0cyB9ID0gYXdhaXQgcHJvY2Vzc1R5cGVEZWYoXG4gICAgICBqb2luKG9wdGlvbnMudHlwZURlZkRpciwgZmlsZS5uYW1lKSxcbiAgICAgIG9wdGlvbnMuY29uc3RFbnVtID8/IHRydWUsXG4gICAgKVxuXG4gICAgZHRzICs9IGZpbGVEdHNcbiAgICBleHBvcnRzLnB1c2goLi4uZmlsZUV4cG9ydHMpXG4gIH1cblxuICBpZiAoZHRzLmluZGV4T2YoJ0V4dGVybmFsT2JqZWN0PCcpID4gLTEpIHtcbiAgICBoZWFkZXIgKz0gYFxuZXhwb3J0IGRlY2xhcmUgY2xhc3MgRXh0ZXJuYWxPYmplY3Q8VD4ge1xuICByZWFkb25seSAnJzoge1xuICAgIHJlYWRvbmx5ICcnOiB1bmlxdWUgc3ltYm9sXG4gICAgW0s6IHN5bWJvbF06IFRcbiAgfVxufVxuYFxuICB9XG5cbiAgaWYgKGR0cy5pbmRleE9mKCdUeXBlZEFycmF5JykgPiAtMSkge1xuICAgIGhlYWRlciArPSBgXG5leHBvcnQgdHlwZSBUeXBlZEFycmF5ID0gSW50OEFycmF5IHwgVWludDhBcnJheSB8IFVpbnQ4Q2xhbXBlZEFycmF5IHwgSW50MTZBcnJheSB8IFVpbnQxNkFycmF5IHwgSW50MzJBcnJheSB8IFVpbnQzMkFycmF5IHwgRmxvYXQzMkFycmF5IHwgRmxvYXQ2NEFycmF5IHwgQmlnSW50NjRBcnJheSB8IEJpZ1VpbnQ2NEFycmF5XG5gXG4gIH1cblxuICBkdHMgPSBoZWFkZXIgKyBkdHNcblxuICByZXR1cm4ge1xuICAgIGV4cG9ydHMsXG4gICAgZHRzLFxuICB9XG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUNyZWF0ZU5wbURpcnNDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ2NyZWF0ZS1ucG0tZGlycyddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIG5wbSBwYWNrYWdlIGRpcnMgZm9yIGRpZmZlcmVudCBwbGF0Zm9ybXMnLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG5wbURpciA9IE9wdGlvbi5TdHJpbmcoJy0tbnBtLWRpcicsICducG0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXQnLFxuICB9KVxuXG4gIGRyeVJ1biA9IE9wdGlvbi5Cb29sZWFuKCctLWRyeS1ydW4nLCBmYWxzZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnRHJ5IHJ1biB3aXRob3V0IHRvdWNoaW5nIGZpbGUgc3lzdGVtJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgY29uZmlnUGF0aDogdGhpcy5jb25maWdQYXRoLFxuICAgICAgcGFja2FnZUpzb25QYXRoOiB0aGlzLnBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG5wbURpcjogdGhpcy5ucG1EaXIsXG4gICAgICBkcnlSdW46IHRoaXMuZHJ5UnVuLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIENyZWF0ZSBucG0gcGFja2FnZSBkaXJzIGZvciBkaWZmZXJlbnQgcGxhdGZvcm1zXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ3JlYXRlTnBtRGlyc09wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXRcbiAgICpcbiAgICogQGRlZmF1bHQgJ25wbSdcbiAgICovXG4gIG5wbURpcj86IHN0cmluZ1xuICAvKipcbiAgICogRHJ5IHJ1biB3aXRob3V0IHRvdWNoaW5nIGZpbGUgc3lzdGVtXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICBkcnlSdW4/OiBib29sZWFuXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcHBseURlZmF1bHRDcmVhdGVOcG1EaXJzT3B0aW9ucyhcbiAgb3B0aW9uczogQ3JlYXRlTnBtRGlyc09wdGlvbnMsXG4pIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBucG1EaXI6ICducG0nLFxuICAgIGRyeVJ1bjogZmFsc2UsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gJ25vZGU6bW9kdWxlJ1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHsgcGFyc2UgfSBmcm9tICdzZW12ZXInXG5cbmNvbnN0IHJlcXVpcmUgPSBjcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybClcblxuaW1wb3J0IHtcbiAgYXBwbHlEZWZhdWx0Q3JlYXRlTnBtRGlyc09wdGlvbnMsXG4gIHR5cGUgQ3JlYXRlTnBtRGlyc09wdGlvbnMsXG59IGZyb20gJy4uL2RlZi9jcmVhdGUtbnBtLWRpcnMuanMnXG5pbXBvcnQge1xuICBkZWJ1Z0ZhY3RvcnksXG4gIHJlYWROYXBpQ29uZmlnLFxuICBta2RpckFzeW5jIGFzIHJhd01rZGlyQXN5bmMsXG4gIHBpY2ssXG4gIHdyaXRlRmlsZUFzeW5jIGFzIHJhd1dyaXRlRmlsZUFzeW5jLFxuICB0eXBlIFRhcmdldCxcbiAgdHlwZSBDb21tb25QYWNrYWdlSnNvbkZpZWxkcyxcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCdjcmVhdGUtbnBtLWRpcnMnKVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhY2thZ2VNZXRhIHtcbiAgJ2Rpc3QtdGFncyc6IHsgW2luZGV4OiBzdHJpbmddOiBzdHJpbmcgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlTnBtRGlycyh1c2VyT3B0aW9uczogQ3JlYXRlTnBtRGlyc09wdGlvbnMpIHtcbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdENyZWF0ZU5wbURpcnNPcHRpb25zKHVzZXJPcHRpb25zKVxuXG4gIGFzeW5jIGZ1bmN0aW9uIG1rZGlyQXN5bmMoZGlyOiBzdHJpbmcpIHtcbiAgICBkZWJ1ZygnVHJ5IHRvIGNyZWF0ZSBkaXI6ICVpJywgZGlyKVxuICAgIGlmIChvcHRpb25zLmRyeVJ1bikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgYXdhaXQgcmF3TWtkaXJBc3luYyhkaXIsIHtcbiAgICAgIHJlY3Vyc2l2ZTogdHJ1ZSxcbiAgICB9KVxuICB9XG5cbiAgYXN5bmMgZnVuY3Rpb24gd3JpdGVGaWxlQXN5bmMoZmlsZTogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpIHtcbiAgICBkZWJ1ZygnV3JpdGluZyBmaWxlICVpJywgZmlsZSlcblxuICAgIGlmIChvcHRpb25zLmRyeVJ1bikge1xuICAgICAgZGVidWcoY29udGVudClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHJhd1dyaXRlRmlsZUFzeW5jKGZpbGUsIGNvbnRlbnQpXG4gIH1cblxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcbiAgY29uc3QgbnBtUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMubnBtRGlyKVxuXG4gIGRlYnVnKGBSZWFkIGNvbnRlbnQgZnJvbSBbJHtvcHRpb25zLmNvbmZpZ1BhdGggPz8gcGFja2FnZUpzb25QYXRofV1gKVxuXG4gIGNvbnN0IHsgdGFyZ2V0cywgYmluYXJ5TmFtZSwgcGFja2FnZU5hbWUsIHBhY2thZ2VKc29uIH0gPVxuICAgIGF3YWl0IHJlYWROYXBpQ29uZmlnKFxuICAgICAgcGFja2FnZUpzb25QYXRoLFxuICAgICAgb3B0aW9ucy5jb25maWdQYXRoID8gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5jb25maWdQYXRoKSA6IHVuZGVmaW5lZCxcbiAgICApXG5cbiAgZm9yIChjb25zdCB0YXJnZXQgb2YgdGFyZ2V0cykge1xuICAgIGNvbnN0IHRhcmdldERpciA9IGpvaW4obnBtUGF0aCwgYCR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX1gKVxuICAgIGF3YWl0IG1rZGlyQXN5bmModGFyZ2V0RGlyKVxuXG4gICAgY29uc3QgYmluYXJ5RmlsZU5hbWUgPVxuICAgICAgdGFyZ2V0LmFyY2ggPT09ICd3YXNtMzInXG4gICAgICAgID8gYCR7YmluYXJ5TmFtZX0uJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfS53YXNtYFxuICAgICAgICA6IGAke2JpbmFyeU5hbWV9LiR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX0ubm9kZWBcbiAgICBjb25zdCBzY29wZWRQYWNrYWdlSnNvbjogQ29tbW9uUGFja2FnZUpzb25GaWVsZHMgPSB7XG4gICAgICBuYW1lOiBgJHtwYWNrYWdlTmFtZX0tJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfWAsXG4gICAgICB2ZXJzaW9uOiBwYWNrYWdlSnNvbi52ZXJzaW9uLFxuICAgICAgY3B1OiB0YXJnZXQuYXJjaCAhPT0gJ3VuaXZlcnNhbCcgPyBbdGFyZ2V0LmFyY2hdIDogdW5kZWZpbmVkLFxuICAgICAgbWFpbjogYmluYXJ5RmlsZU5hbWUsXG4gICAgICBmaWxlczogW2JpbmFyeUZpbGVOYW1lXSxcbiAgICAgIC4uLnBpY2soXG4gICAgICAgIHBhY2thZ2VKc29uLFxuICAgICAgICAnZGVzY3JpcHRpb24nLFxuICAgICAgICAna2V5d29yZHMnLFxuICAgICAgICAnYXV0aG9yJyxcbiAgICAgICAgJ2F1dGhvcnMnLFxuICAgICAgICAnaG9tZXBhZ2UnLFxuICAgICAgICAnbGljZW5zZScsXG4gICAgICAgICdlbmdpbmVzJyxcbiAgICAgICAgJ3JlcG9zaXRvcnknLFxuICAgICAgICAnYnVncycsXG4gICAgICApLFxuICAgIH1cbiAgICBpZiAocGFja2FnZUpzb24ucHVibGlzaENvbmZpZykge1xuICAgICAgc2NvcGVkUGFja2FnZUpzb24ucHVibGlzaENvbmZpZyA9IHBpY2soXG4gICAgICAgIHBhY2thZ2VKc29uLnB1Ymxpc2hDb25maWcsXG4gICAgICAgICdyZWdpc3RyeScsXG4gICAgICAgICdhY2Nlc3MnLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAodGFyZ2V0LmFyY2ggIT09ICd3YXNtMzInKSB7XG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5vcyA9IFt0YXJnZXQucGxhdGZvcm1dXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gYCR7YmluYXJ5TmFtZX0ud2FzaS5janNgXG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5tYWluID0gZW50cnlcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmJyb3dzZXIgPSBgJHtiaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgXG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5maWxlcz8ucHVzaChcbiAgICAgICAgZW50cnksXG4gICAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmJyb3dzZXIsXG4gICAgICAgIGB3YXNpLXdvcmtlci5tanNgLFxuICAgICAgICBgd2FzaS13b3JrZXItYnJvd3Nlci5tanNgLFxuICAgICAgKVxuICAgICAgbGV0IG5lZWRSZXN0cmljdE5vZGVWZXJzaW9uID0gdHJ1ZVxuICAgICAgaWYgKHNjb3BlZFBhY2thZ2VKc29uLmVuZ2luZXM/Lm5vZGUpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCB7IG1ham9yIH0gPSBwYXJzZShzY29wZWRQYWNrYWdlSnNvbi5lbmdpbmVzLm5vZGUpID8/IHtcbiAgICAgICAgICAgIG1ham9yOiAwLFxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobWFqb3IgPj0gMTQpIHtcbiAgICAgICAgICAgIG5lZWRSZXN0cmljdE5vZGVWZXJzaW9uID0gZmFsc2VcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgIC8vIGlnbm9yZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAobmVlZFJlc3RyaWN0Tm9kZVZlcnNpb24pIHtcbiAgICAgICAgc2NvcGVkUGFja2FnZUpzb24uZW5naW5lcyA9IHtcbiAgICAgICAgICBub2RlOiAnPj0xNC4wLjAnLFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBlbW5hcGlWZXJzaW9uID0gcmVxdWlyZSgnZW1uYXBpL3BhY2thZ2UuanNvbicpLnZlcnNpb25cbiAgICAgIGNvbnN0IHdhc21SdW50aW1lID0gYXdhaXQgZmV0Y2goXG4gICAgICAgIGBodHRwczovL3JlZ2lzdHJ5Lm5wbWpzLm9yZy9AbmFwaS1ycy93YXNtLXJ1bnRpbWVgLFxuICAgICAgKS50aGVuKChyZXMpID0+IHJlcy5qc29uKCkgYXMgUHJvbWlzZTxQYWNrYWdlTWV0YT4pXG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5kZXBlbmRlbmNpZXMgPSB7XG4gICAgICAgICdAbmFwaS1ycy93YXNtLXJ1bnRpbWUnOiBgXiR7d2FzbVJ1bnRpbWVbJ2Rpc3QtdGFncyddLmxhdGVzdH1gLFxuICAgICAgICAnQGVtbmFwaS9jb3JlJzogZW1uYXBpVmVyc2lvbixcbiAgICAgICAgJ0BlbW5hcGkvcnVudGltZSc6IGVtbmFwaVZlcnNpb24sXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRhcmdldC5hYmkgPT09ICdnbnUnKSB7XG4gICAgICBzY29wZWRQYWNrYWdlSnNvbi5saWJjID0gWydnbGliYyddXG4gICAgfSBlbHNlIGlmICh0YXJnZXQuYWJpID09PSAnbXVzbCcpIHtcbiAgICAgIHNjb3BlZFBhY2thZ2VKc29uLmxpYmMgPSBbJ211c2wnXVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldFBhY2thZ2VKc29uID0gam9pbih0YXJnZXREaXIsICdwYWNrYWdlLmpzb24nKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgdGFyZ2V0UGFja2FnZUpzb24sXG4gICAgICBKU09OLnN0cmluZ2lmeShzY29wZWRQYWNrYWdlSnNvbiwgbnVsbCwgMikgKyAnXFxuJyxcbiAgICApXG4gICAgY29uc3QgdGFyZ2V0UmVhZG1lID0gam9pbih0YXJnZXREaXIsICdSRUFETUUubWQnKVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKHRhcmdldFJlYWRtZSwgcmVhZG1lKHBhY2thZ2VOYW1lLCB0YXJnZXQpKVxuXG4gICAgZGVidWcuaW5mbyhgJHtwYWNrYWdlTmFtZX0gLSR7dGFyZ2V0LnBsYXRmb3JtQXJjaEFCSX0gY3JlYXRlZGApXG4gIH1cbn1cblxuZnVuY3Rpb24gcmVhZG1lKHBhY2thZ2VOYW1lOiBzdHJpbmcsIHRhcmdldDogVGFyZ2V0KSB7XG4gIHJldHVybiBgIyBcXGAke3BhY2thZ2VOYW1lfS0ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9XFxgXG5cblRoaXMgaXMgdGhlICoqJHt0YXJnZXQudHJpcGxlfSoqIGJpbmFyeSBmb3IgXFxgJHtwYWNrYWdlTmFtZX1cXGBcbmBcbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5pbXBvcnQgKiBhcyB0eXBhbmlvbiBmcm9tICd0eXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VOZXdDb21tYW5kIGV4dGVuZHMgQ29tbWFuZCB7XG4gIHN0YXRpYyBwYXRocyA9IFtbJ25ldyddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIGEgbmV3IHByb2plY3Qgd2l0aCBwcmUtY29uZmlndXJlZCBib2lsZXJwbGF0ZScsXG4gIH0pXG5cbiAgJCRwYXRoID0gT3B0aW9uLlN0cmluZyh7IHJlcXVpcmVkOiBmYWxzZSB9KVxuXG4gICQkbmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tbmFtZSwtbicsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgbmFtZSBvZiB0aGUgcHJvamVjdCwgZGVmYXVsdCB0byB0aGUgbmFtZSBvZiB0aGUgZGlyZWN0b3J5IGlmIG5vdCBwcm92aWRlZCcsXG4gIH0pXG5cbiAgbWluTm9kZUFwaVZlcnNpb24gPSBPcHRpb24uU3RyaW5nKCctLW1pbi1ub2RlLWFwaSwtdicsICc0Jywge1xuICAgIHZhbGlkYXRvcjogdHlwYW5pb24uaXNOdW1iZXIoKSxcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBtaW5pbXVtIE5vZGUtQVBJIHZlcnNpb24gdG8gc3VwcG9ydCcsXG4gIH0pXG5cbiAgcGFja2FnZU1hbmFnZXIgPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtbWFuYWdlcicsICd5YXJuJywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIHBhY2thZ2UgbWFuYWdlciB0byB1c2UuIE9ubHkgc3VwcG9ydCB5YXJuIDQueCBmb3Igbm93LicsXG4gIH0pXG5cbiAgbGljZW5zZSA9IE9wdGlvbi5TdHJpbmcoJy0tbGljZW5zZSwtbCcsICdNSVQnLCB7XG4gICAgZGVzY3JpcHRpb246ICdMaWNlbnNlIGZvciBvcGVuLXNvdXJjZWQgcHJvamVjdCcsXG4gIH0pXG5cbiAgdGFyZ2V0cyA9IE9wdGlvbi5BcnJheSgnLS10YXJnZXRzLC10JywgW10sIHtcbiAgICBkZXNjcmlwdGlvbjogJ0FsbCB0YXJnZXRzIHRoZSBjcmF0ZSB3aWxsIGJlIGNvbXBpbGVkIGZvci4nLFxuICB9KVxuXG4gIGVuYWJsZURlZmF1bHRUYXJnZXRzID0gT3B0aW9uLkJvb2xlYW4oJy0tZW5hYmxlLWRlZmF1bHQtdGFyZ2V0cycsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgZW5hYmxlIGRlZmF1bHQgdGFyZ2V0cycsXG4gIH0pXG5cbiAgZW5hYmxlQWxsVGFyZ2V0cyA9IE9wdGlvbi5Cb29sZWFuKCctLWVuYWJsZS1hbGwtdGFyZ2V0cycsIGZhbHNlLCB7XG4gICAgZGVzY3JpcHRpb246ICdXaGV0aGVyIGVuYWJsZSBhbGwgdGFyZ2V0cycsXG4gIH0pXG5cbiAgZW5hYmxlVHlwZURlZiA9IE9wdGlvbi5Cb29sZWFuKCctLWVuYWJsZS10eXBlLWRlZicsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdXaGV0aGVyIGVuYWJsZSB0aGUgYHR5cGUtZGVmYCBmZWF0dXJlIGZvciB0eXBlc2NyaXB0IGRlZmluaXRpb25zIGF1dG8tZ2VuZXJhdGlvbicsXG4gIH0pXG5cbiAgZW5hYmxlR2l0aHViQWN0aW9ucyA9IE9wdGlvbi5Cb29sZWFuKCctLWVuYWJsZS1naXRodWItYWN0aW9ucycsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgZ2VuZXJhdGUgcHJlY29uZmlndXJlZCBHaXRIdWIgQWN0aW9ucyB3b3JrZmxvdycsXG4gIH0pXG5cbiAgdGVzdEZyYW1ld29yayA9IE9wdGlvbi5TdHJpbmcoJy0tdGVzdC1mcmFtZXdvcmsnLCAnYXZhJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSBKYXZhU2NyaXB0IHRlc3QgZnJhbWV3b3JrIHRvIHVzZSwgb25seSBzdXBwb3J0IGBhdmFgIGZvciBub3cnLFxuICB9KVxuXG4gIGRyeVJ1biA9IE9wdGlvbi5Cb29sZWFuKCctLWRyeS1ydW4nLCBmYWxzZSwge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciB0byBydW4gdGhlIGNvbW1hbmQgaW4gZHJ5LXJ1biBtb2RlJyxcbiAgfSlcblxuICBnZXRPcHRpb25zKCkge1xuICAgIHJldHVybiB7XG4gICAgICBwYXRoOiB0aGlzLiQkcGF0aCxcbiAgICAgIG5hbWU6IHRoaXMuJCRuYW1lLFxuICAgICAgbWluTm9kZUFwaVZlcnNpb246IHRoaXMubWluTm9kZUFwaVZlcnNpb24sXG4gICAgICBwYWNrYWdlTWFuYWdlcjogdGhpcy5wYWNrYWdlTWFuYWdlcixcbiAgICAgIGxpY2Vuc2U6IHRoaXMubGljZW5zZSxcbiAgICAgIHRhcmdldHM6IHRoaXMudGFyZ2V0cyxcbiAgICAgIGVuYWJsZURlZmF1bHRUYXJnZXRzOiB0aGlzLmVuYWJsZURlZmF1bHRUYXJnZXRzLFxuICAgICAgZW5hYmxlQWxsVGFyZ2V0czogdGhpcy5lbmFibGVBbGxUYXJnZXRzLFxuICAgICAgZW5hYmxlVHlwZURlZjogdGhpcy5lbmFibGVUeXBlRGVmLFxuICAgICAgZW5hYmxlR2l0aHViQWN0aW9uczogdGhpcy5lbmFibGVHaXRodWJBY3Rpb25zLFxuICAgICAgdGVzdEZyYW1ld29yazogdGhpcy50ZXN0RnJhbWV3b3JrLFxuICAgICAgZHJ5UnVuOiB0aGlzLmRyeVJ1bixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBuZXcgcHJvamVjdCB3aXRoIHByZS1jb25maWd1cmVkIGJvaWxlcnBsYXRlXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTmV3T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBUaGUgcGF0aCB3aGVyZSB0aGUgTkFQSS1SUyBwcm9qZWN0IHdpbGwgYmUgY3JlYXRlZC5cbiAgICovXG4gIHBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuYW1lIG9mIHRoZSBwcm9qZWN0LCBkZWZhdWx0IHRvIHRoZSBuYW1lIG9mIHRoZSBkaXJlY3RvcnkgaWYgbm90IHByb3ZpZGVkXG4gICAqL1xuICBuYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBUaGUgbWluaW11bSBOb2RlLUFQSSB2ZXJzaW9uIHRvIHN1cHBvcnRcbiAgICpcbiAgICogQGRlZmF1bHQgNFxuICAgKi9cbiAgbWluTm9kZUFwaVZlcnNpb24/OiBudW1iZXJcbiAgLyoqXG4gICAqIFRoZSBwYWNrYWdlIG1hbmFnZXIgdG8gdXNlLiBPbmx5IHN1cHBvcnQgeWFybiA0LnggZm9yIG5vdy5cbiAgICpcbiAgICogQGRlZmF1bHQgJ3lhcm4nXG4gICAqL1xuICBwYWNrYWdlTWFuYWdlcj86IHN0cmluZ1xuICAvKipcbiAgICogTGljZW5zZSBmb3Igb3Blbi1zb3VyY2VkIHByb2plY3RcbiAgICpcbiAgICogQGRlZmF1bHQgJ01JVCdcbiAgICovXG4gIGxpY2Vuc2U/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEFsbCB0YXJnZXRzIHRoZSBjcmF0ZSB3aWxsIGJlIGNvbXBpbGVkIGZvci5cbiAgICpcbiAgICogQGRlZmF1bHQgW11cbiAgICovXG4gIHRhcmdldHM/OiBzdHJpbmdbXVxuICAvKipcbiAgICogV2hldGhlciBlbmFibGUgZGVmYXVsdCB0YXJnZXRzXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGVuYWJsZURlZmF1bHRUYXJnZXRzPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciBlbmFibGUgYWxsIHRhcmdldHNcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIGVuYWJsZUFsbFRhcmdldHM/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGVuYWJsZSB0aGUgYHR5cGUtZGVmYCBmZWF0dXJlIGZvciB0eXBlc2NyaXB0IGRlZmluaXRpb25zIGF1dG8tZ2VuZXJhdGlvblxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICBlbmFibGVUeXBlRGVmPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciBnZW5lcmF0ZSBwcmVjb25maWd1cmVkIEdpdEh1YiBBY3Rpb25zIHdvcmtmbG93XG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGVuYWJsZUdpdGh1YkFjdGlvbnM/OiBib29sZWFuXG4gIC8qKlxuICAgKiBUaGUgSmF2YVNjcmlwdCB0ZXN0IGZyYW1ld29yayB0byB1c2UsIG9ubHkgc3VwcG9ydCBgYXZhYCBmb3Igbm93XG4gICAqXG4gICAqIEBkZWZhdWx0ICdhdmEnXG4gICAqL1xuICB0ZXN0RnJhbWV3b3JrPzogc3RyaW5nXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIHJ1biB0aGUgY29tbWFuZCBpbiBkcnktcnVuIG1vZGVcbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIGRyeVJ1bj86IGJvb2xlYW5cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdE5ld09wdGlvbnMob3B0aW9uczogTmV3T3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIG1pbk5vZGVBcGlWZXJzaW9uOiA0LFxuICAgIHBhY2thZ2VNYW5hZ2VyOiAneWFybicsXG4gICAgbGljZW5zZTogJ01JVCcsXG4gICAgdGFyZ2V0czogW10sXG4gICAgZW5hYmxlRGVmYXVsdFRhcmdldHM6IHRydWUsXG4gICAgZW5hYmxlQWxsVGFyZ2V0czogZmFsc2UsXG4gICAgZW5hYmxlVHlwZURlZjogdHJ1ZSxcbiAgICBlbmFibGVHaXRodWJBY3Rpb25zOiB0cnVlLFxuICAgIHRlc3RGcmFtZXdvcms6ICdhdmEnLFxuICAgIGRyeVJ1bjogZmFsc2UsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiLy8gQ29weXJpZ2h0IDIwMTgtMjAyNSB0aGUgRGVubyBhdXRob3JzLiBNSVQgbGljZW5zZS5cbi8vIFRoaXMgbW9kdWxlIGlzIGJyb3dzZXIgY29tcGF0aWJsZS5cbi8vIEJhcmUga2V5cyBtYXkgb25seSBjb250YWluIEFTQ0lJIGxldHRlcnMsXG4vLyBBU0NJSSBkaWdpdHMsIHVuZGVyc2NvcmVzLCBhbmQgZGFzaGVzIChBLVphLXowLTlfLSkuXG5mdW5jdGlvbiBqb2luS2V5cyhrZXlzKSB7XG4gIC8vIERvdHRlZCBrZXlzIGFyZSBhIHNlcXVlbmNlIG9mIGJhcmUgb3IgcXVvdGVkIGtleXMgam9pbmVkIHdpdGggYSBkb3QuXG4gIC8vIFRoaXMgYWxsb3dzIGZvciBncm91cGluZyBzaW1pbGFyIHByb3BlcnRpZXMgdG9nZXRoZXI6XG4gIHJldHVybiBrZXlzLm1hcCgoc3RyKT0+e1xuICAgIHJldHVybiBzdHIubGVuZ3RoID09PSAwIHx8IHN0ci5tYXRjaCgvW15BLVphLXowLTlfLV0vKSA/IEpTT04uc3RyaW5naWZ5KHN0cikgOiBzdHI7XG4gIH0pLmpvaW4oXCIuXCIpO1xufVxuY2xhc3MgRHVtcGVyIHtcbiAgbWF4UGFkID0gMDtcbiAgc3JjT2JqZWN0O1xuICBvdXRwdXQgPSBbXTtcbiAgI2FycmF5VHlwZUNhY2hlID0gbmV3IE1hcCgpO1xuICBjb25zdHJ1Y3RvcihzcmNPYmpjKXtcbiAgICB0aGlzLnNyY09iamVjdCA9IHNyY09iamM7XG4gIH1cbiAgZHVtcChmbXRPcHRpb25zID0ge30pIHtcbiAgICAvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICAgIHRoaXMub3V0cHV0ID0gdGhpcy4jcHJpbnRPYmplY3QodGhpcy5zcmNPYmplY3QpO1xuICAgIHRoaXMub3V0cHV0ID0gdGhpcy4jZm9ybWF0KGZtdE9wdGlvbnMpO1xuICAgIHJldHVybiB0aGlzLm91dHB1dDtcbiAgfVxuICAjcHJpbnRPYmplY3Qob2JqLCBrZXlzID0gW10pIHtcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBjb25zdCBwcm9wcyA9IE9iamVjdC5rZXlzKG9iaik7XG4gICAgY29uc3QgaW5saW5lUHJvcHMgPSBbXTtcbiAgICBjb25zdCBtdWx0aWxpbmVQcm9wcyA9IFtdO1xuICAgIGZvciAoY29uc3QgcHJvcCBvZiBwcm9wcyl7XG4gICAgICBpZiAodGhpcy4jaXNTaW1wbHlTZXJpYWxpemFibGUob2JqW3Byb3BdKSkge1xuICAgICAgICBpbmxpbmVQcm9wcy5wdXNoKHByb3ApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbXVsdGlsaW5lUHJvcHMucHVzaChwcm9wKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgc29ydGVkUHJvcHMgPSBpbmxpbmVQcm9wcy5jb25jYXQobXVsdGlsaW5lUHJvcHMpO1xuICAgIGZvciAoY29uc3QgcHJvcCBvZiBzb3J0ZWRQcm9wcyl7XG4gICAgICBjb25zdCB2YWx1ZSA9IG9ialtwcm9wXTtcbiAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgb3V0LnB1c2godGhpcy4jZGF0ZURlY2xhcmF0aW9uKFtcbiAgICAgICAgICBwcm9wXG4gICAgICAgIF0sIHZhbHVlKSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJzdHJpbmdcIiB8fCB2YWx1ZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgICBvdXQucHVzaCh0aGlzLiNzdHJEZWNsYXJhdGlvbihbXG4gICAgICAgICAgcHJvcFxuICAgICAgICBdLCB2YWx1ZS50b1N0cmluZygpKSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIikge1xuICAgICAgICBvdXQucHVzaCh0aGlzLiNudW1iZXJEZWNsYXJhdGlvbihbXG4gICAgICAgICAgcHJvcFxuICAgICAgICBdLCB2YWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgIG91dC5wdXNoKHRoaXMuI2Jvb2xEZWNsYXJhdGlvbihbXG4gICAgICAgICAgcHJvcFxuICAgICAgICBdLCB2YWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICAgIGNvbnN0IGFycmF5VHlwZSA9IHRoaXMuI2dldFR5cGVPZkFycmF5KHZhbHVlKTtcbiAgICAgICAgaWYgKGFycmF5VHlwZSA9PT0gXCJPTkxZX1BSSU1JVElWRVwiKSB7XG4gICAgICAgICAgb3V0LnB1c2godGhpcy4jYXJyYXlEZWNsYXJhdGlvbihbXG4gICAgICAgICAgICBwcm9wXG4gICAgICAgICAgXSwgdmFsdWUpKTtcbiAgICAgICAgfSBlbHNlIGlmIChhcnJheVR5cGUgPT09IFwiT05MWV9PQkpFQ1RfRVhDTFVESU5HX0FSUkFZXCIpIHtcbiAgICAgICAgICAvLyBhcnJheSBvZiBvYmplY3RzXG4gICAgICAgICAgZm9yKGxldCBpID0gMDsgaSA8IHZhbHVlLmxlbmd0aDsgaSsrKXtcbiAgICAgICAgICAgIG91dC5wdXNoKFwiXCIpO1xuICAgICAgICAgICAgb3V0LnB1c2godGhpcy4jaGVhZGVyR3JvdXAoW1xuICAgICAgICAgICAgICAuLi5rZXlzLFxuICAgICAgICAgICAgICBwcm9wXG4gICAgICAgICAgICBdKSk7XG4gICAgICAgICAgICBvdXQucHVzaCguLi50aGlzLiNwcmludE9iamVjdCh2YWx1ZVtpXSwgW1xuICAgICAgICAgICAgICAuLi5rZXlzLFxuICAgICAgICAgICAgICBwcm9wXG4gICAgICAgICAgICBdKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHRoaXMgaXMgYSBjb21wbGV4IGFycmF5LCB1c2UgdGhlIGlubGluZSBmb3JtYXQuXG4gICAgICAgICAgY29uc3Qgc3RyID0gdmFsdWUubWFwKCh4KT0+dGhpcy4jcHJpbnRBc0lubGluZVZhbHVlKHgpKS5qb2luKFwiLFwiKTtcbiAgICAgICAgICBvdXQucHVzaChgJHt0aGlzLiNkZWNsYXJhdGlvbihbXG4gICAgICAgICAgICBwcm9wXG4gICAgICAgICAgXSl9WyR7c3RyfV1gKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgb3V0LnB1c2goXCJcIik7XG4gICAgICAgIG91dC5wdXNoKHRoaXMuI2hlYWRlcihbXG4gICAgICAgICAgLi4ua2V5cyxcbiAgICAgICAgICBwcm9wXG4gICAgICAgIF0pKTtcbiAgICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgdG9QYXJzZSA9IHZhbHVlO1xuICAgICAgICAgIG91dC5wdXNoKC4uLnRoaXMuI3ByaW50T2JqZWN0KHRvUGFyc2UsIFtcbiAgICAgICAgICAgIC4uLmtleXMsXG4gICAgICAgICAgICBwcm9wXG4gICAgICAgICAgXSkpO1xuICAgICAgICB9XG4gICAgICAvLyBvdXQucHVzaCguLi50aGlzLl9wYXJzZSh2YWx1ZSwgYCR7cGF0aH0ke3Byb3B9LmApKTtcbiAgICAgIH1cbiAgICB9XG4gICAgb3V0LnB1c2goXCJcIik7XG4gICAgcmV0dXJuIG91dDtcbiAgfVxuICAjaXNQcmltaXRpdmUodmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgaW5zdGFuY2VvZiBEYXRlIHx8IHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwIHx8IFtcbiAgICAgIFwic3RyaW5nXCIsXG4gICAgICBcIm51bWJlclwiLFxuICAgICAgXCJib29sZWFuXCJcbiAgICBdLmluY2x1ZGVzKHR5cGVvZiB2YWx1ZSk7XG4gIH1cbiAgI2dldFR5cGVPZkFycmF5KGFycikge1xuICAgIGlmICh0aGlzLiNhcnJheVR5cGVDYWNoZS5oYXMoYXJyKSkge1xuICAgICAgcmV0dXJuIHRoaXMuI2FycmF5VHlwZUNhY2hlLmdldChhcnIpO1xuICAgIH1cbiAgICBjb25zdCB0eXBlID0gdGhpcy4jZG9HZXRUeXBlT2ZBcnJheShhcnIpO1xuICAgIHRoaXMuI2FycmF5VHlwZUNhY2hlLnNldChhcnIsIHR5cGUpO1xuICAgIHJldHVybiB0eXBlO1xuICB9XG4gICNkb0dldFR5cGVPZkFycmF5KGFycikge1xuICAgIGlmICghYXJyLmxlbmd0aCkge1xuICAgICAgLy8gYW55IHR5cGUgc2hvdWxkIGJlIGZpbmVcbiAgICAgIHJldHVybiBcIk9OTFlfUFJJTUlUSVZFXCI7XG4gICAgfVxuICAgIGNvbnN0IG9ubHlQcmltaXRpdmUgPSB0aGlzLiNpc1ByaW1pdGl2ZShhcnJbMF0pO1xuICAgIGlmIChhcnJbMF0gaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgcmV0dXJuIFwiTUlYRURcIjtcbiAgICB9XG4gICAgZm9yKGxldCBpID0gMTsgaSA8IGFyci5sZW5ndGg7IGkrKyl7XG4gICAgICBpZiAob25seVByaW1pdGl2ZSAhPT0gdGhpcy4jaXNQcmltaXRpdmUoYXJyW2ldKSB8fCBhcnJbaV0gaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgICByZXR1cm4gXCJNSVhFRFwiO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gb25seVByaW1pdGl2ZSA/IFwiT05MWV9QUklNSVRJVkVcIiA6IFwiT05MWV9PQkpFQ1RfRVhDTFVESU5HX0FSUkFZXCI7XG4gIH1cbiAgI3ByaW50QXNJbmxpbmVWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBgXCIke3RoaXMuI3ByaW50RGF0ZSh2YWx1ZSl9XCJgO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkodmFsdWUudG9TdHJpbmcoKSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdmFsdWUgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB2YWx1ZS50b1N0cmluZygpO1xuICAgIH0gZWxzZSBpZiAodmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgY29uc3Qgc3RyID0gdmFsdWUubWFwKCh4KT0+dGhpcy4jcHJpbnRBc0lubGluZVZhbHVlKHgpKS5qb2luKFwiLFwiKTtcbiAgICAgIHJldHVybiBgWyR7c3RyfV1gO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIlNob3VsZCBuZXZlciByZWFjaFwiKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN0ciA9IE9iamVjdC5rZXlzKHZhbHVlKS5tYXAoKGtleSk9PntcbiAgICAgICAgcmV0dXJuIGAke2pvaW5LZXlzKFtcbiAgICAgICAgICBrZXlcbiAgICAgICAgXSl9ID0gJHsvLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuICAgICAgICB0aGlzLiNwcmludEFzSW5saW5lVmFsdWUodmFsdWVba2V5XSl9YDtcbiAgICAgIH0pLmpvaW4oXCIsXCIpO1xuICAgICAgcmV0dXJuIGB7JHtzdHJ9fWA7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihcIlNob3VsZCBuZXZlciByZWFjaFwiKTtcbiAgfVxuICAjaXNTaW1wbHlTZXJpYWxpemFibGUodmFsdWUpIHtcbiAgICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB2YWx1ZSA9PT0gXCJudW1iZXJcIiB8fCB0eXBlb2YgdmFsdWUgPT09IFwiYm9vbGVhblwiIHx8IHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwIHx8IHZhbHVlIGluc3RhbmNlb2YgRGF0ZSB8fCB2YWx1ZSBpbnN0YW5jZW9mIEFycmF5ICYmIHRoaXMuI2dldFR5cGVPZkFycmF5KHZhbHVlKSAhPT0gXCJPTkxZX09CSkVDVF9FWENMVURJTkdfQVJSQVlcIjtcbiAgfVxuICAjaGVhZGVyKGtleXMpIHtcbiAgICByZXR1cm4gYFske2pvaW5LZXlzKGtleXMpfV1gO1xuICB9XG4gICNoZWFkZXJHcm91cChrZXlzKSB7XG4gICAgcmV0dXJuIGBbWyR7am9pbktleXMoa2V5cyl9XV1gO1xuICB9XG4gICNkZWNsYXJhdGlvbihrZXlzKSB7XG4gICAgY29uc3QgdGl0bGUgPSBqb2luS2V5cyhrZXlzKTtcbiAgICBpZiAodGl0bGUubGVuZ3RoID4gdGhpcy5tYXhQYWQpIHtcbiAgICAgIHRoaXMubWF4UGFkID0gdGl0bGUubGVuZ3RoO1xuICAgIH1cbiAgICByZXR1cm4gYCR7dGl0bGV9ID0gYDtcbiAgfVxuICAjYXJyYXlEZWNsYXJhdGlvbihrZXlzLCB2YWx1ZSkge1xuICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0ke0pTT04uc3RyaW5naWZ5KHZhbHVlKX1gO1xuICB9XG4gICNzdHJEZWNsYXJhdGlvbihrZXlzLCB2YWx1ZSkge1xuICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0ke0pTT04uc3RyaW5naWZ5KHZhbHVlKX1gO1xuICB9XG4gICNudW1iZXJEZWNsYXJhdGlvbihrZXlzLCB2YWx1ZSkge1xuICAgIGlmIChOdW1iZXIuaXNOYU4odmFsdWUpKSB7XG4gICAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9bmFuYDtcbiAgICB9XG4gICAgc3dpdGNoKHZhbHVlKXtcbiAgICAgIGNhc2UgSW5maW5pdHk6XG4gICAgICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX1pbmZgO1xuICAgICAgY2FzZSAtSW5maW5pdHk6XG4gICAgICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0taW5mYDtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0ke3ZhbHVlfWA7XG4gICAgfVxuICB9XG4gICNib29sRGVjbGFyYXRpb24oa2V5cywgdmFsdWUpIHtcbiAgICByZXR1cm4gYCR7dGhpcy4jZGVjbGFyYXRpb24oa2V5cyl9JHt2YWx1ZX1gO1xuICB9XG4gICNwcmludERhdGUodmFsdWUpIHtcbiAgICBmdW5jdGlvbiBkdFBhZCh2LCBsUGFkID0gMikge1xuICAgICAgcmV0dXJuIHYucGFkU3RhcnQobFBhZCwgXCIwXCIpO1xuICAgIH1cbiAgICBjb25zdCBtID0gZHRQYWQoKHZhbHVlLmdldFVUQ01vbnRoKCkgKyAxKS50b1N0cmluZygpKTtcbiAgICBjb25zdCBkID0gZHRQYWQodmFsdWUuZ2V0VVRDRGF0ZSgpLnRvU3RyaW5nKCkpO1xuICAgIGNvbnN0IGggPSBkdFBhZCh2YWx1ZS5nZXRVVENIb3VycygpLnRvU3RyaW5nKCkpO1xuICAgIGNvbnN0IG1pbiA9IGR0UGFkKHZhbHVlLmdldFVUQ01pbnV0ZXMoKS50b1N0cmluZygpKTtcbiAgICBjb25zdCBzID0gZHRQYWQodmFsdWUuZ2V0VVRDU2Vjb25kcygpLnRvU3RyaW5nKCkpO1xuICAgIGNvbnN0IG1zID0gZHRQYWQodmFsdWUuZ2V0VVRDTWlsbGlzZWNvbmRzKCkudG9TdHJpbmcoKSwgMyk7XG4gICAgLy8gZm9ybWF0dGVkIGRhdGVcbiAgICBjb25zdCBmRGF0YSA9IGAke3ZhbHVlLmdldFVUQ0Z1bGxZZWFyKCl9LSR7bX0tJHtkfVQke2h9OiR7bWlufToke3N9LiR7bXN9YDtcbiAgICByZXR1cm4gZkRhdGE7XG4gIH1cbiAgI2RhdGVEZWNsYXJhdGlvbihrZXlzLCB2YWx1ZSkge1xuICAgIHJldHVybiBgJHt0aGlzLiNkZWNsYXJhdGlvbihrZXlzKX0ke3RoaXMuI3ByaW50RGF0ZSh2YWx1ZSl9YDtcbiAgfVxuICAjZm9ybWF0KG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHsga2V5QWxpZ25tZW50ID0gZmFsc2UgfSA9IG9wdGlvbnM7XG4gICAgY29uc3QgckRlY2xhcmF0aW9uID0gL14oXFxcIi4qXFxcInxbXj1dKilcXHM9LztcbiAgICBjb25zdCBvdXQgPSBbXTtcbiAgICBmb3IobGV0IGkgPSAwOyBpIDwgdGhpcy5vdXRwdXQubGVuZ3RoOyBpKyspe1xuICAgICAgY29uc3QgbCA9IHRoaXMub3V0cHV0W2ldO1xuICAgICAgLy8gd2Uga2VlcCBlbXB0eSBlbnRyeSBmb3IgYXJyYXkgb2Ygb2JqZWN0c1xuICAgICAgaWYgKGxbMF0gPT09IFwiW1wiICYmIGxbMV0gIT09IFwiW1wiKSB7XG4gICAgICAgIC8vIG5vbi1lbXB0eSBvYmplY3Qgd2l0aCBvbmx5IHN1Ym9iamVjdHMgYXMgcHJvcGVydGllc1xuICAgICAgICBpZiAodGhpcy5vdXRwdXRbaSArIDFdID09PSBcIlwiICYmIHRoaXMub3V0cHV0W2kgKyAyXT8uc2xpY2UoMCwgbC5sZW5ndGgpID09PSBsLnNsaWNlKDAsIC0xKSArIFwiLlwiKSB7XG4gICAgICAgICAgaSArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIG91dC5wdXNoKGwpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGtleUFsaWdubWVudCkge1xuICAgICAgICAgIGNvbnN0IG0gPSByRGVjbGFyYXRpb24uZXhlYyhsKTtcbiAgICAgICAgICBpZiAobSAmJiBtWzFdKSB7XG4gICAgICAgICAgICBvdXQucHVzaChsLnJlcGxhY2UobVsxXSwgbVsxXS5wYWRFbmQodGhpcy5tYXhQYWQpKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG91dC5wdXNoKGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBvdXQucHVzaChsKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBDbGVhbmluZyBtdWx0aXBsZSBzcGFjZXNcbiAgICBjb25zdCBjbGVhbmVkT3V0cHV0ID0gW107XG4gICAgZm9yKGxldCBpID0gMDsgaSA8IG91dC5sZW5ndGg7IGkrKyl7XG4gICAgICBjb25zdCBsID0gb3V0W2ldO1xuICAgICAgaWYgKCEobCA9PT0gXCJcIiAmJiBvdXRbaSArIDFdID09PSBcIlwiKSkge1xuICAgICAgICBjbGVhbmVkT3V0cHV0LnB1c2gobCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBjbGVhbmVkT3V0cHV0O1xuICB9XG59XG4vKipcbiAqIENvbnZlcnRzIGFuIG9iamVjdCB0byBhIHtAbGluayBodHRwczovL3RvbWwuaW8gfCBUT01MfSBzdHJpbmcuXG4gKlxuICogQGV4YW1wbGUgVXNhZ2VcbiAqIGBgYHRzXG4gKiBpbXBvcnQgeyBzdHJpbmdpZnkgfSBmcm9tIFwiQHN0ZC90b21sL3N0cmluZ2lmeVwiO1xuICogaW1wb3J0IHsgYXNzZXJ0RXF1YWxzIH0gZnJvbSBcIkBzdGQvYXNzZXJ0XCI7XG4gKlxuICogY29uc3Qgb2JqID0ge1xuICogICB0aXRsZTogXCJUT01MIEV4YW1wbGVcIixcbiAqICAgb3duZXI6IHtcbiAqICAgICBuYW1lOiBcIkJvYlwiLFxuICogICAgIGJpbzogXCJCb2IgaXMgYSBjb29sIGd1eVwiLFxuICogIH1cbiAqIH07XG4gKiBjb25zdCB0b21sU3RyaW5nID0gc3RyaW5naWZ5KG9iaik7XG4gKiBhc3NlcnRFcXVhbHModG9tbFN0cmluZywgYHRpdGxlID0gXCJUT01MIEV4YW1wbGVcIlxcblxcbltvd25lcl1cXG5uYW1lID0gXCJCb2JcIlxcbmJpbyA9IFwiQm9iIGlzIGEgY29vbCBndXlcIlxcbmApO1xuICogYGBgXG4gKiBAcGFyYW0gb2JqIFNvdXJjZSBvYmplY3RcbiAqIEBwYXJhbSBvcHRpb25zIE9wdGlvbnMgZm9yIHN0cmluZ2lmeWluZy5cbiAqIEByZXR1cm5zIFRPTUwgc3RyaW5nXG4gKi8gZXhwb3J0IGZ1bmN0aW9uIHN0cmluZ2lmeShvYmosIG9wdGlvbnMpIHtcbiAgcmV0dXJuIG5ldyBEdW1wZXIob2JqKS5kdW1wKG9wdGlvbnMpLmpvaW4oXCJcXG5cIik7XG59XG4vLyMgc291cmNlTWFwcGluZ1VSTD1zdHJpbmdpZnkuanMubWFwIiwiLy8gQ29weXJpZ2h0IDIwMTgtMjAyNiB0aGUgRGVubyBhdXRob3JzLiBNSVQgbGljZW5zZS5cbi8vIFRoaXMgbW9kdWxlIGlzIGJyb3dzZXIgY29tcGF0aWJsZS5cbi8qKiBEZWZhdWx0IG1lcmdpbmcgb3B0aW9ucyAtIGNhY2hlZCB0byBhdm9pZCBvYmplY3QgYWxsb2NhdGlvbiBvbiBlYWNoIGNhbGwgKi8gY29uc3QgREVGQVVMVF9PUFRJT05TID0ge1xuICBhcnJheXM6IFwibWVyZ2VcIixcbiAgc2V0czogXCJtZXJnZVwiLFxuICBtYXBzOiBcIm1lcmdlXCJcbn07XG5leHBvcnQgZnVuY3Rpb24gZGVlcE1lcmdlKHJlY29yZCwgb3RoZXIsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIGRlZXBNZXJnZUludGVybmFsKHJlY29yZCwgb3RoZXIsIG5ldyBTZXQoKSwgb3B0aW9ucyA/PyBERUZBVUxUX09QVElPTlMpO1xufVxuZnVuY3Rpb24gZGVlcE1lcmdlSW50ZXJuYWwocmVjb3JkLCBvdGhlciwgc2Vlbiwgb3B0aW9ucykge1xuICBjb25zdCByZXN1bHQgPSB7fTtcbiAgY29uc3Qga2V5cyA9IG5ldyBTZXQoW1xuICAgIC4uLmdldEtleXMocmVjb3JkKSxcbiAgICAuLi5nZXRLZXlzKG90aGVyKVxuICBdKTtcbiAgLy8gSXRlcmF0ZSB0aHJvdWdoIGVhY2gga2V5IG9mIG90aGVyIG9iamVjdCBhbmQgdXNlIGNvcnJlY3QgbWVyZ2luZyBzdHJhdGVneVxuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKXtcbiAgICAvLyBTa2lwIHRvIHByZXZlbnQgT2JqZWN0LnByb3RvdHlwZS5fX3Byb3RvX18gYWNjZXNzb3IgcHJvcGVydHkgY2FsbHMgb24gbm9uLURlbm8gcGxhdGZvcm1zXG4gICAgaWYgKGtleSA9PT0gXCJfX3Byb3RvX19cIikge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGEgPSByZWNvcmRba2V5XTtcbiAgICBpZiAoIU9iamVjdC5oYXNPd24ob3RoZXIsIGtleSkpIHtcbiAgICAgIHJlc3VsdFtrZXldID0gYTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBiID0gb3RoZXJba2V5XTtcbiAgICBpZiAoaXNOb25OdWxsT2JqZWN0KGEpICYmIGlzTm9uTnVsbE9iamVjdChiKSAmJiAhc2Vlbi5oYXMoYSkgJiYgIXNlZW4uaGFzKGIpKSB7XG4gICAgICBzZWVuLmFkZChhKTtcbiAgICAgIHNlZW4uYWRkKGIpO1xuICAgICAgcmVzdWx0W2tleV0gPSBtZXJnZU9iamVjdHMoYSwgYiwgc2Vlbiwgb3B0aW9ucyk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gT3ZlcnJpZGUgdmFsdWVcbiAgICByZXN1bHRba2V5XSA9IGI7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbmZ1bmN0aW9uIG1lcmdlT2JqZWN0cyhsZWZ0LCByaWdodCwgc2Vlbiwgb3B0aW9ucykge1xuICAvLyBSZWN1cnNpdmVseSBtZXJnZSBtZXJnZWFibGUgb2JqZWN0c1xuICBpZiAoaXNNZXJnZWFibGUobGVmdCkgJiYgaXNNZXJnZWFibGUocmlnaHQpKSB7XG4gICAgcmV0dXJuIGRlZXBNZXJnZUludGVybmFsKGxlZnQsIHJpZ2h0LCBzZWVuLCBvcHRpb25zKTtcbiAgfVxuICBpZiAoaXNJdGVyYWJsZShsZWZ0KSAmJiBpc0l0ZXJhYmxlKHJpZ2h0KSkge1xuICAgIC8vIEhhbmRsZSBhcnJheXNcbiAgICBpZiAoQXJyYXkuaXNBcnJheShsZWZ0KSAmJiBBcnJheS5pc0FycmF5KHJpZ2h0KSkge1xuICAgICAgaWYgKG9wdGlvbnMuYXJyYXlzID09PSBcIm1lcmdlXCIpIHtcbiAgICAgICAgcmV0dXJuIGxlZnQuY29uY2F0KHJpZ2h0KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByaWdodDtcbiAgICB9XG4gICAgLy8gSGFuZGxlIG1hcHNcbiAgICBpZiAobGVmdCBpbnN0YW5jZW9mIE1hcCAmJiByaWdodCBpbnN0YW5jZW9mIE1hcCkge1xuICAgICAgaWYgKG9wdGlvbnMubWFwcyA9PT0gXCJtZXJnZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBNYXAobGVmdCk7XG4gICAgICAgIGZvciAoY29uc3QgW2ssIHZdIG9mIHJpZ2h0KXtcbiAgICAgICAgICByZXN1bHQuc2V0KGssIHYpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmlnaHQ7XG4gICAgfVxuICAgIC8vIEhhbmRsZSBzZXRzXG4gICAgaWYgKGxlZnQgaW5zdGFuY2VvZiBTZXQgJiYgcmlnaHQgaW5zdGFuY2VvZiBTZXQpIHtcbiAgICAgIGlmIChvcHRpb25zLnNldHMgPT09IFwibWVyZ2VcIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBuZXcgU2V0KGxlZnQpO1xuICAgICAgICBmb3IgKGNvbnN0IHYgb2YgcmlnaHQpe1xuICAgICAgICAgIHJlc3VsdC5hZGQodik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIHJldHVybiByaWdodDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJpZ2h0O1xufVxuLyoqXG4gKiBUZXN0IHdoZXRoZXIgYSB2YWx1ZSBpcyBtZXJnZWFibGUgb3Igbm90XG4gKiBCdWlsdGlucyB0aGF0IGxvb2sgbGlrZSBvYmplY3RzLCBudWxsIGFuZCB1c2VyIGRlZmluZWQgY2xhc3Nlc1xuICogYXJlIG5vdCBjb25zaWRlcmVkIG1lcmdlYWJsZSAoaXQgbWVhbnMgdGhhdCByZWZlcmVuY2Ugd2lsbCBiZSBjb3BpZWQpXG4gKi8gZnVuY3Rpb24gaXNNZXJnZWFibGUodmFsdWUpIHtcbiAgcmV0dXJuIE9iamVjdC5nZXRQcm90b3R5cGVPZih2YWx1ZSkgPT09IE9iamVjdC5wcm90b3R5cGU7XG59XG5mdW5jdGlvbiBpc0l0ZXJhYmxlKHZhbHVlKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWVbU3ltYm9sLml0ZXJhdG9yXSA9PT0gXCJmdW5jdGlvblwiO1xufVxuZnVuY3Rpb24gaXNOb25OdWxsT2JqZWN0KHZhbHVlKSB7XG4gIHJldHVybiB2YWx1ZSAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsdWUgPT09IFwib2JqZWN0XCI7XG59XG5mdW5jdGlvbiBnZXRLZXlzKHJlY29yZCkge1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMocmVjb3JkKTtcbiAgY29uc3Qgc3ltYm9scyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eVN5bWJvbHMocmVjb3JkKTtcbiAgLy8gRmFzdCBwYXRoOiBtb3N0IG9iamVjdHMgaGF2ZSBubyBzeW1ib2wga2V5c1xuICBpZiAoc3ltYm9scy5sZW5ndGggPT09IDApIHJldHVybiBrZXlzO1xuICBmb3IgKGNvbnN0IHN5bSBvZiBzeW1ib2xzKXtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5wcm9wZXJ0eUlzRW51bWVyYWJsZS5jYWxsKHJlY29yZCwgc3ltKSkge1xuICAgICAga2V5cy5wdXNoKHN5bSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBrZXlzO1xufVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZGVlcF9tZXJnZS5qcy5tYXAiLCIvLyBDb3B5cmlnaHQgMjAxOC0yMDI1IHRoZSBEZW5vIGF1dGhvcnMuIE1JVCBsaWNlbnNlLlxuLy8gVGhpcyBtb2R1bGUgaXMgYnJvd3NlciBjb21wYXRpYmxlLlxuaW1wb3J0IHsgZGVlcE1lcmdlIH0gZnJvbSBcIkBqc3Ivc3RkX19jb2xsZWN0aW9ucy9kZWVwLW1lcmdlXCI7XG4vKipcbiAqIENvcHkgb2YgYGltcG9ydCB7IGlzTGVhcCB9IGZyb20gXCJAc3RkL2RhdGV0aW1lXCI7YCBiZWNhdXNlIGl0IGNhbm5vdCBiZSBpbXBvdGVkIGFzIGxvbmcgYXMgaXQgaXMgdW5zdGFibGUuXG4gKi8gZnVuY3Rpb24gaXNMZWFwKHllYXJOdW1iZXIpIHtcbiAgcmV0dXJuIHllYXJOdW1iZXIgJSA0ID09PSAwICYmIHllYXJOdW1iZXIgJSAxMDAgIT09IDAgfHwgeWVhck51bWJlciAlIDQwMCA9PT0gMDtcbn1cbmV4cG9ydCBjbGFzcyBTY2FubmVyIHtcbiAgI3doaXRlc3BhY2UgPSAvWyBcXHRdLztcbiAgI3Bvc2l0aW9uID0gMDtcbiAgI3NvdXJjZTtcbiAgY29uc3RydWN0b3Ioc291cmNlKXtcbiAgICB0aGlzLiNzb3VyY2UgPSBzb3VyY2U7XG4gIH1cbiAgZ2V0IHBvc2l0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLiNwb3NpdGlvbjtcbiAgfVxuICBnZXQgc291cmNlKCkge1xuICAgIHJldHVybiB0aGlzLiNzb3VyY2U7XG4gIH1cbiAgLyoqXG4gICAqIEdldCBjdXJyZW50IGNoYXJhY3RlclxuICAgKiBAcGFyYW0gaW5kZXggLSByZWxhdGl2ZSBpbmRleCBmcm9tIGN1cnJlbnQgcG9zaXRpb25cbiAgICovIGNoYXIoaW5kZXggPSAwKSB7XG4gICAgcmV0dXJuIHRoaXMuI3NvdXJjZVt0aGlzLiNwb3NpdGlvbiArIGluZGV4XSA/PyBcIlwiO1xuICB9XG4gIC8qKlxuICAgKiBHZXQgc2xpY2VkIHN0cmluZ1xuICAgKiBAcGFyYW0gc3RhcnQgLSBzdGFydCBwb3NpdGlvbiByZWxhdGl2ZSBmcm9tIGN1cnJlbnQgcG9zaXRpb25cbiAgICogQHBhcmFtIGVuZCAtIGVuZCBwb3NpdGlvbiByZWxhdGl2ZSBmcm9tIGN1cnJlbnQgcG9zaXRpb25cbiAgICovIHNsaWNlKHN0YXJ0LCBlbmQpIHtcbiAgICByZXR1cm4gdGhpcy4jc291cmNlLnNsaWNlKHRoaXMuI3Bvc2l0aW9uICsgc3RhcnQsIHRoaXMuI3Bvc2l0aW9uICsgZW5kKTtcbiAgfVxuICAvKipcbiAgICogTW92ZSBwb3NpdGlvbiB0byBuZXh0XG4gICAqLyBuZXh0KGNvdW50ID0gMSkge1xuICAgIHRoaXMuI3Bvc2l0aW9uICs9IGNvdW50O1xuICB9XG4gIHNraXBXaGl0ZXNwYWNlcygpIHtcbiAgICB3aGlsZSh0aGlzLiN3aGl0ZXNwYWNlLnRlc3QodGhpcy5jaGFyKCkpICYmICF0aGlzLmVvZigpKXtcbiAgICAgIHRoaXMubmV4dCgpO1xuICAgIH1cbiAgICAvLyBJbnZhbGlkIGlmIGN1cnJlbnQgY2hhciBpcyBvdGhlciBraW5kcyBvZiB3aGl0ZXNwYWNlXG4gICAgaWYgKCF0aGlzLmlzQ3VycmVudENoYXJFT0woKSAmJiAvXFxzLy50ZXN0KHRoaXMuY2hhcigpKSkge1xuICAgICAgY29uc3QgZXNjYXBlZCA9IFwiXFxcXHVcIiArIHRoaXMuY2hhcigpLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpO1xuICAgICAgY29uc3QgcG9zaXRpb24gPSB0aGlzLiNwb3NpdGlvbjtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgQ2Fubm90IHBhcnNlIHRoZSBUT01MOiBJdCBjb250YWlucyBpbnZhbGlkIHdoaXRlc3BhY2UgYXQgcG9zaXRpb24gJyR7cG9zaXRpb259JzogXFxgJHtlc2NhcGVkfVxcYGApO1xuICAgIH1cbiAgfVxuICBuZXh0VW50aWxDaGFyKG9wdGlvbnMgPSB7XG4gICAgc2tpcENvbW1lbnRzOiB0cnVlXG4gIH0pIHtcbiAgICB3aGlsZSghdGhpcy5lb2YoKSl7XG4gICAgICBjb25zdCBjaGFyID0gdGhpcy5jaGFyKCk7XG4gICAgICBpZiAodGhpcy4jd2hpdGVzcGFjZS50ZXN0KGNoYXIpIHx8IHRoaXMuaXNDdXJyZW50Q2hhckVPTCgpKSB7XG4gICAgICAgIHRoaXMubmV4dCgpO1xuICAgICAgfSBlbHNlIGlmIChvcHRpb25zLnNraXBDb21tZW50cyAmJiB0aGlzLmNoYXIoKSA9PT0gXCIjXCIpIHtcbiAgICAgICAgLy8gZW50ZXJpbmcgY29tbWVudFxuICAgICAgICB3aGlsZSghdGhpcy5pc0N1cnJlbnRDaGFyRU9MKCkgJiYgIXRoaXMuZW9mKCkpe1xuICAgICAgICAgIHRoaXMubmV4dCgpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgLyoqXG4gICAqIFBvc2l0aW9uIHJlYWNoZWQgRU9GIG9yIG5vdFxuICAgKi8gZW9mKCkge1xuICAgIHJldHVybiB0aGlzLiNwb3NpdGlvbiA+PSB0aGlzLiNzb3VyY2UubGVuZ3RoO1xuICB9XG4gIGlzQ3VycmVudENoYXJFT0woKSB7XG4gICAgcmV0dXJuIHRoaXMuY2hhcigpID09PSBcIlxcblwiIHx8IHRoaXMuc3RhcnRzV2l0aChcIlxcclxcblwiKTtcbiAgfVxuICBzdGFydHNXaXRoKHNlYXJjaFN0cmluZykge1xuICAgIHJldHVybiB0aGlzLiNzb3VyY2Uuc3RhcnRzV2l0aChzZWFyY2hTdHJpbmcsIHRoaXMuI3Bvc2l0aW9uKTtcbiAgfVxuICBtYXRjaChyZWdFeHApIHtcbiAgICBpZiAoIXJlZ0V4cC5zdGlja3kpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUmVnRXhwICR7cmVnRXhwfSBkb2VzIG5vdCBoYXZlIGEgc3RpY2t5ICd5JyBmbGFnYCk7XG4gICAgfVxuICAgIHJlZ0V4cC5sYXN0SW5kZXggPSB0aGlzLiNwb3NpdGlvbjtcbiAgICByZXR1cm4gdGhpcy4jc291cmNlLm1hdGNoKHJlZ0V4cCk7XG4gIH1cbn1cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBVdGlsaXRpZXNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5mdW5jdGlvbiBzdWNjZXNzKGJvZHkpIHtcbiAgcmV0dXJuIHtcbiAgICBvazogdHJ1ZSxcbiAgICBib2R5XG4gIH07XG59XG5mdW5jdGlvbiBmYWlsdXJlKCkge1xuICByZXR1cm4ge1xuICAgIG9rOiBmYWxzZVxuICB9O1xufVxuLyoqXG4gKiBDcmVhdGVzIGEgbmVzdGVkIG9iamVjdCBmcm9tIHRoZSBrZXlzIGFuZCB2YWx1ZXMuXG4gKlxuICogZS5nLiBgdW5mbGF0KFtcImFcIiwgXCJiXCIsIFwiY1wiXSwgMSlgIHJldHVybnMgYHsgYTogeyBiOiB7IGM6IDEgfSB9IH1gXG4gKi8gZXhwb3J0IGZ1bmN0aW9uIHVuZmxhdChrZXlzLCB2YWx1ZXMgPSB7XG4gIF9fcHJvdG9fXzogbnVsbFxufSkge1xuICByZXR1cm4ga2V5cy5yZWR1Y2VSaWdodCgoYWNjLCBrZXkpPT4oe1xuICAgICAgW2tleV06IGFjY1xuICAgIH0pLCB2YWx1ZXMpO1xufVxuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbDtcbn1cbmZ1bmN0aW9uIGdldFRhcmdldFZhbHVlKHRhcmdldCwga2V5cykge1xuICBjb25zdCBrZXkgPSBrZXlzWzBdO1xuICBpZiAoIWtleSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBwYXJzZSB0aGUgVE9NTDoga2V5IGxlbmd0aCBpcyBub3QgYSBwb3NpdGl2ZSBudW1iZXJcIik7XG4gIH1cbiAgcmV0dXJuIHRhcmdldFtrZXldO1xufVxuZnVuY3Rpb24gZGVlcEFzc2lnblRhYmxlKHRhcmdldCwgdGFibGUpIHtcbiAgY29uc3QgeyBrZXlzLCB0eXBlLCB2YWx1ZSB9ID0gdGFibGU7XG4gIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IGdldFRhcmdldFZhbHVlKHRhcmdldCwga2V5cyk7XG4gIGlmIChjdXJyZW50VmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHRhcmdldCwgdW5mbGF0KGtleXMsIHZhbHVlKSk7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkoY3VycmVudFZhbHVlKSkge1xuICAgIGNvbnN0IGxhc3QgPSBjdXJyZW50VmFsdWUuYXQoLTEpO1xuICAgIGRlZXBBc3NpZ24obGFzdCwge1xuICAgICAgdHlwZSxcbiAgICAgIGtleXM6IGtleXMuc2xpY2UoMSksXG4gICAgICB2YWx1ZVxuICAgIH0pO1xuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgaWYgKGlzT2JqZWN0KGN1cnJlbnRWYWx1ZSkpIHtcbiAgICBkZWVwQXNzaWduKGN1cnJlbnRWYWx1ZSwge1xuICAgICAgdHlwZSxcbiAgICAgIGtleXM6IGtleXMuc2xpY2UoMSksXG4gICAgICB2YWx1ZVxuICAgIH0pO1xuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5leHBlY3RlZCBhc3NpZ25cIik7XG59XG5mdW5jdGlvbiBkZWVwQXNzaWduVGFibGVBcnJheSh0YXJnZXQsIHRhYmxlKSB7XG4gIGNvbnN0IHsgdHlwZSwga2V5cywgdmFsdWUgfSA9IHRhYmxlO1xuICBjb25zdCBjdXJyZW50VmFsdWUgPSBnZXRUYXJnZXRWYWx1ZSh0YXJnZXQsIGtleXMpO1xuICBpZiAoY3VycmVudFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbih0YXJnZXQsIHVuZmxhdChrZXlzLCBbXG4gICAgICB2YWx1ZVxuICAgIF0pKTtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShjdXJyZW50VmFsdWUpKSB7XG4gICAgaWYgKHRhYmxlLmtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICBjdXJyZW50VmFsdWUucHVzaCh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGxhc3QgPSBjdXJyZW50VmFsdWUuYXQoLTEpO1xuICAgICAgZGVlcEFzc2lnbihsYXN0LCB7XG4gICAgICAgIHR5cGU6IHRhYmxlLnR5cGUsXG4gICAgICAgIGtleXM6IHRhYmxlLmtleXMuc2xpY2UoMSksXG4gICAgICAgIHZhbHVlOiB0YWJsZS52YWx1ZVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgaWYgKGlzT2JqZWN0KGN1cnJlbnRWYWx1ZSkpIHtcbiAgICBkZWVwQXNzaWduKGN1cnJlbnRWYWx1ZSwge1xuICAgICAgdHlwZSxcbiAgICAgIGtleXM6IGtleXMuc2xpY2UoMSksXG4gICAgICB2YWx1ZVxuICAgIH0pO1xuICAgIHJldHVybiB0YXJnZXQ7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFwiVW5leHBlY3RlZCBhc3NpZ25cIik7XG59XG5leHBvcnQgZnVuY3Rpb24gZGVlcEFzc2lnbih0YXJnZXQsIGJvZHkpIHtcbiAgc3dpdGNoKGJvZHkudHlwZSl7XG4gICAgY2FzZSBcIkJsb2NrXCI6XG4gICAgICByZXR1cm4gZGVlcE1lcmdlKHRhcmdldCwgYm9keS52YWx1ZSk7XG4gICAgY2FzZSBcIlRhYmxlXCI6XG4gICAgICByZXR1cm4gZGVlcEFzc2lnblRhYmxlKHRhcmdldCwgYm9keSk7XG4gICAgY2FzZSBcIlRhYmxlQXJyYXlcIjpcbiAgICAgIHJldHVybiBkZWVwQXNzaWduVGFibGVBcnJheSh0YXJnZXQsIGJvZHkpO1xuICB9XG59XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhcnNlciBjb21iaW5hdG9ycyBhbmQgZ2VuZXJhdG9yc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBkZW5vLWxpbnQtaWdub3JlIG5vLWV4cGxpY2l0LWFueVxuZnVuY3Rpb24gb3IocGFyc2Vycykge1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgZm9yIChjb25zdCBwYXJzZSBvZiBwYXJzZXJzKXtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlKHNjYW5uZXIpO1xuICAgICAgaWYgKHJlc3VsdC5vaykgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG4gICAgcmV0dXJuIGZhaWx1cmUoKTtcbiAgfTtcbn1cbi8qKiBKb2luIHRoZSBwYXJzZSByZXN1bHRzIG9mIHRoZSBnaXZlbiBwYXJzZXIgaW50byBhbiBhcnJheS5cbiAqXG4gKiBJZiB0aGUgcGFyc2VyIGZhaWxzIGF0IHRoZSBmaXJzdCBhdHRlbXB0LCBpdCB3aWxsIHJldHVybiBhbiBlbXB0eSBhcnJheS5cbiAqLyBmdW5jdGlvbiBqb2luKHBhcnNlciwgc2VwYXJhdG9yKSB7XG4gIGNvbnN0IFNlcGFyYXRvciA9IGNoYXJhY3RlcihzZXBhcmF0b3IpO1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgY29uc3Qgb3V0ID0gW107XG4gICAgY29uc3QgZmlyc3QgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCFmaXJzdC5vaykgcmV0dXJuIHN1Y2Nlc3Mob3V0KTtcbiAgICBvdXQucHVzaChmaXJzdC5ib2R5KTtcbiAgICB3aGlsZSghc2Nhbm5lci5lb2YoKSl7XG4gICAgICBpZiAoIVNlcGFyYXRvcihzY2FubmVyKS5vaykgYnJlYWs7XG4gICAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgdG9rZW4gYWZ0ZXIgXCIke3NlcGFyYXRvcn1cImApO1xuICAgICAgfVxuICAgICAgb3V0LnB1c2gocmVzdWx0LmJvZHkpO1xuICAgIH1cbiAgICByZXR1cm4gc3VjY2VzcyhvdXQpO1xuICB9O1xufVxuLyoqIEpvaW4gdGhlIHBhcnNlIHJlc3VsdHMgb2YgdGhlIGdpdmVuIHBhcnNlciBpbnRvIGFuIGFycmF5LlxuICpcbiAqIFRoaXMgcmVxdWlyZXMgdGhlIHBhcnNlciB0byBzdWNjZWVkIGF0IGxlYXN0IG9uY2UuXG4gKi8gZnVuY3Rpb24gam9pbjEocGFyc2VyLCBzZXBhcmF0b3IpIHtcbiAgY29uc3QgU2VwYXJhdG9yID0gY2hhcmFjdGVyKHNlcGFyYXRvcik7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBjb25zdCBmaXJzdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIWZpcnN0Lm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICAgIGNvbnN0IG91dCA9IFtcbiAgICAgIGZpcnN0LmJvZHlcbiAgICBdO1xuICAgIHdoaWxlKCFzY2FubmVyLmVvZigpKXtcbiAgICAgIGlmICghU2VwYXJhdG9yKHNjYW5uZXIpLm9rKSBicmVhaztcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICAgIGlmICghcmVzdWx0Lm9rKSB7XG4gICAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgSW52YWxpZCB0b2tlbiBhZnRlciBcIiR7c2VwYXJhdG9yfVwiYCk7XG4gICAgICB9XG4gICAgICBvdXQucHVzaChyZXN1bHQuYm9keSk7XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzKG91dCk7XG4gIH07XG59XG5mdW5jdGlvbiBrdihrZXlQYXJzZXIsIHNlcGFyYXRvciwgdmFsdWVQYXJzZXIpIHtcbiAgY29uc3QgU2VwYXJhdG9yID0gY2hhcmFjdGVyKHNlcGFyYXRvcik7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBjb25zdCBwb3NpdGlvbiA9IHNjYW5uZXIucG9zaXRpb247XG4gICAgY29uc3Qga2V5ID0ga2V5UGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICgha2V5Lm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICAgIGNvbnN0IHNlcCA9IFNlcGFyYXRvcihzY2FubmVyKTtcbiAgICBpZiAoIXNlcC5vaykge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBrZXkvdmFsdWUgcGFpciBkb2Vzbid0IGhhdmUgXCIke3NlcGFyYXRvcn1cImApO1xuICAgIH1cbiAgICBjb25zdCB2YWx1ZSA9IHZhbHVlUGFyc2VyKHNjYW5uZXIpO1xuICAgIGlmICghdmFsdWUub2spIHtcbiAgICAgIGNvbnN0IGxpbmVFbmRJbmRleCA9IHNjYW5uZXIuc291cmNlLmluZGV4T2YoXCJcXG5cIiwgc2Nhbm5lci5wb3NpdGlvbik7XG4gICAgICBjb25zdCBlbmRQb3NpdGlvbiA9IGxpbmVFbmRJbmRleCA+IDAgPyBsaW5lRW5kSW5kZXggOiBzY2FubmVyLnNvdXJjZS5sZW5ndGg7XG4gICAgICBjb25zdCBsaW5lID0gc2Nhbm5lci5zb3VyY2Uuc2xpY2UocG9zaXRpb24sIGVuZFBvc2l0aW9uKTtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgQ2Fubm90IHBhcnNlIHZhbHVlIG9uIGxpbmUgJyR7bGluZX0nYCk7XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzKHVuZmxhdChrZXkuYm9keSwgdmFsdWUuYm9keSkpO1xuICB9O1xufVxuZnVuY3Rpb24gbWVyZ2UocGFyc2VyKSB7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgaWYgKCFyZXN1bHQub2spIHJldHVybiBmYWlsdXJlKCk7XG4gICAgbGV0IGJvZHkgPSB7XG4gICAgICBfX3Byb3RvX186IG51bGxcbiAgICB9O1xuICAgIGZvciAoY29uc3QgcmVjb3JkIG9mIHJlc3VsdC5ib2R5KXtcbiAgICAgIGlmICh0eXBlb2YgcmVjb3JkID09PSBcIm9iamVjdFwiICYmIHJlY29yZCAhPT0gbnVsbCkge1xuICAgICAgICBib2R5ID0gZGVlcE1lcmdlKGJvZHksIHJlY29yZCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzKGJvZHkpO1xuICB9O1xufVxuZnVuY3Rpb24gcmVwZWF0KHBhcnNlcikge1xuICByZXR1cm4gKHNjYW5uZXIpPT57XG4gICAgY29uc3QgYm9keSA9IFtdO1xuICAgIHdoaWxlKCFzY2FubmVyLmVvZigpKXtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICAgIGlmICghcmVzdWx0Lm9rKSBicmVhaztcbiAgICAgIGJvZHkucHVzaChyZXN1bHQuYm9keSk7XG4gICAgICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgICB9XG4gICAgaWYgKGJvZHkubGVuZ3RoID09PSAwKSByZXR1cm4gZmFpbHVyZSgpO1xuICAgIHJldHVybiBzdWNjZXNzKGJvZHkpO1xuICB9O1xufVxuZnVuY3Rpb24gc3Vycm91bmQobGVmdCwgcGFyc2VyLCByaWdodCkge1xuICBjb25zdCBMZWZ0ID0gY2hhcmFjdGVyKGxlZnQpO1xuICBjb25zdCBSaWdodCA9IGNoYXJhY3RlcihyaWdodCk7XG4gIHJldHVybiAoc2Nhbm5lcik9PntcbiAgICBpZiAoIUxlZnQoc2Nhbm5lcikub2spIHtcbiAgICAgIHJldHVybiBmYWlsdXJlKCk7XG4gICAgfVxuICAgIGNvbnN0IHJlc3VsdCA9IHBhcnNlcihzY2FubmVyKTtcbiAgICBpZiAoIXJlc3VsdC5vaykge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIHRva2VuIGFmdGVyIFwiJHtsZWZ0fVwiYCk7XG4gICAgfVxuICAgIGlmICghUmlnaHQoc2Nhbm5lcikub2spIHtcbiAgICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgTm90IGNsb3NlZCBieSBcIiR7cmlnaHR9XCIgYWZ0ZXIgc3RhcnRlZCB3aXRoIFwiJHtsZWZ0fVwiYCk7XG4gICAgfVxuICAgIHJldHVybiBzdWNjZXNzKHJlc3VsdC5ib2R5KTtcbiAgfTtcbn1cbmZ1bmN0aW9uIGNoYXJhY3RlcihzdHIpIHtcbiAgcmV0dXJuIChzY2FubmVyKT0+e1xuICAgIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gICAgaWYgKCFzY2FubmVyLnN0YXJ0c1dpdGgoc3RyKSkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgICBzY2FubmVyLm5leHQoc3RyLmxlbmd0aCk7XG4gICAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgICByZXR1cm4gc3VjY2Vzcyh1bmRlZmluZWQpO1xuICB9O1xufVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFBhcnNlciBjb21wb25lbnRzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY29uc3QgQkFSRV9LRVlfUkVHRVhQID0gL1tBLVphLXowLTlfLV0rL3k7XG5leHBvcnQgZnVuY3Rpb24gYmFyZUtleShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IGtleSA9IHNjYW5uZXIubWF0Y2goQkFSRV9LRVlfUkVHRVhQKT8uWzBdO1xuICBpZiAoIWtleSkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KGtleS5sZW5ndGgpO1xuICByZXR1cm4gc3VjY2VzcyhrZXkpO1xufVxuZnVuY3Rpb24gZXNjYXBlU2VxdWVuY2Uoc2Nhbm5lcikge1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09IFwiXFxcXFwiKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoKTtcbiAgLy8gU2VlIGh0dHBzOi8vdG9tbC5pby9lbi92MS4wLjAtcmMuMyNzdHJpbmdcbiAgc3dpdGNoKHNjYW5uZXIuY2hhcigpKXtcbiAgICBjYXNlIFwiYlwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcYlwiKTtcbiAgICBjYXNlIFwidFwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcdFwiKTtcbiAgICBjYXNlIFwiblwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcblwiKTtcbiAgICBjYXNlIFwiZlwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcZlwiKTtcbiAgICBjYXNlIFwiclwiOlxuICAgICAgc2Nhbm5lci5uZXh0KCk7XG4gICAgICByZXR1cm4gc3VjY2VzcyhcIlxcclwiKTtcbiAgICBjYXNlIFwidVwiOlxuICAgIGNhc2UgXCJVXCI6XG4gICAgICB7XG4gICAgICAgIC8vIFVuaWNvZGUgY2hhcmFjdGVyXG4gICAgICAgIGNvbnN0IGNvZGVQb2ludExlbiA9IHNjYW5uZXIuY2hhcigpID09PSBcInVcIiA/IDQgOiA2O1xuICAgICAgICBjb25zdCBjb2RlUG9pbnQgPSBwYXJzZUludChcIjB4XCIgKyBzY2FubmVyLnNsaWNlKDEsIDEgKyBjb2RlUG9pbnRMZW4pLCAxNik7XG4gICAgICAgIGNvbnN0IHN0ciA9IFN0cmluZy5mcm9tQ29kZVBvaW50KGNvZGVQb2ludCk7XG4gICAgICAgIHNjYW5uZXIubmV4dChjb2RlUG9pbnRMZW4gKyAxKTtcbiAgICAgICAgcmV0dXJuIHN1Y2Nlc3Moc3RyKTtcbiAgICAgIH1cbiAgICBjYXNlICdcIic6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKCdcIicpO1xuICAgIGNhc2UgXCJcXFxcXCI6XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICAgIHJldHVybiBzdWNjZXNzKFwiXFxcXFwiKTtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBJbnZhbGlkIGVzY2FwZSBzZXF1ZW5jZTogXFxcXCR7c2Nhbm5lci5jaGFyKCl9YCk7XG4gIH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBiYXNpY1N0cmluZyhzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gJ1wiJykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KCk7XG4gIGNvbnN0IGFjYyA9IFtdO1xuICB3aGlsZShzY2FubmVyLmNoYXIoKSAhPT0gJ1wiJyAmJiAhc2Nhbm5lci5lb2YoKSl7XG4gICAgaWYgKHNjYW5uZXIuY2hhcigpID09PSBcIlxcblwiKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJTaW5nbGUtbGluZSBzdHJpbmcgY2Fubm90IGNvbnRhaW4gRU9MXCIpO1xuICAgIH1cbiAgICBjb25zdCBlc2NhcGVkQ2hhciA9IGVzY2FwZVNlcXVlbmNlKHNjYW5uZXIpO1xuICAgIGlmIChlc2NhcGVkQ2hhci5vaykge1xuICAgICAgYWNjLnB1c2goZXNjYXBlZENoYXIuYm9keSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGFjYy5wdXNoKHNjYW5uZXIuY2hhcigpKTtcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgIH1cbiAgfVxuICBpZiAoc2Nhbm5lci5lb2YoKSkge1xuICAgIHRocm93IG5ldyBTeW50YXhFcnJvcihgU2luZ2xlLWxpbmUgc3RyaW5nIGlzIG5vdCBjbG9zZWQ6XFxuJHthY2Muam9pbihcIlwiKX1gKTtcbiAgfVxuICBzY2FubmVyLm5leHQoKTsgLy8gc2tpcCBsYXN0ICdcIlwiXG4gIHJldHVybiBzdWNjZXNzKGFjYy5qb2luKFwiXCIpKTtcbn1cbmV4cG9ydCBmdW5jdGlvbiBsaXRlcmFsU3RyaW5nKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgaWYgKHNjYW5uZXIuY2hhcigpICE9PSBcIidcIikgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KCk7XG4gIGNvbnN0IGFjYyA9IFtdO1xuICB3aGlsZShzY2FubmVyLmNoYXIoKSAhPT0gXCInXCIgJiYgIXNjYW5uZXIuZW9mKCkpe1xuICAgIGlmIChzY2FubmVyLmNoYXIoKSA9PT0gXCJcXG5cIikge1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKFwiU2luZ2xlLWxpbmUgc3RyaW5nIGNhbm5vdCBjb250YWluIEVPTFwiKTtcbiAgICB9XG4gICAgYWNjLnB1c2goc2Nhbm5lci5jaGFyKCkpO1xuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9XG4gIGlmIChzY2FubmVyLmVvZigpKSB7XG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBTaW5nbGUtbGluZSBzdHJpbmcgaXMgbm90IGNsb3NlZDpcXG4ke2FjYy5qb2luKFwiXCIpfWApO1xuICB9XG4gIHNjYW5uZXIubmV4dCgpOyAvLyBza2lwIGxhc3QgXCInXCJcbiAgcmV0dXJuIHN1Y2Nlc3MoYWNjLmpvaW4oXCJcIikpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIG11bHRpbGluZUJhc2ljU3RyaW5nKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgaWYgKCFzY2FubmVyLnN0YXJ0c1dpdGgoJ1wiXCJcIicpKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoMyk7XG4gIGlmIChzY2FubmVyLmNoYXIoKSA9PT0gXCJcXG5cIikge1xuICAgIC8vIFRoZSBmaXJzdCBuZXdsaW5lIChMRikgaXMgdHJpbW1lZFxuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9IGVsc2UgaWYgKHNjYW5uZXIuc3RhcnRzV2l0aChcIlxcclxcblwiKSkge1xuICAgIC8vIFRoZSBmaXJzdCBuZXdsaW5lIChDUkxGKSBpcyB0cmltbWVkXG4gICAgc2Nhbm5lci5uZXh0KDIpO1xuICB9XG4gIGNvbnN0IGFjYyA9IFtdO1xuICB3aGlsZSghc2Nhbm5lci5zdGFydHNXaXRoKCdcIlwiXCInKSAmJiAhc2Nhbm5lci5lb2YoKSl7XG4gICAgLy8gbGluZSBlbmRpbmcgYmFja3NsYXNoXG4gICAgaWYgKHNjYW5uZXIuc3RhcnRzV2l0aChcIlxcXFxcXG5cIikpIHtcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKHtcbiAgICAgICAgc2tpcENvbW1lbnRzOiBmYWxzZVxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9IGVsc2UgaWYgKHNjYW5uZXIuc3RhcnRzV2l0aChcIlxcXFxcXHJcXG5cIikpIHtcbiAgICAgIHNjYW5uZXIubmV4dCgpO1xuICAgICAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKHtcbiAgICAgICAgc2tpcENvbW1lbnRzOiBmYWxzZVxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZXNjYXBlZENoYXIgPSBlc2NhcGVTZXF1ZW5jZShzY2FubmVyKTtcbiAgICBpZiAoZXNjYXBlZENoYXIub2spIHtcbiAgICAgIGFjYy5wdXNoKGVzY2FwZWRDaGFyLmJvZHkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhY2MucHVzaChzY2FubmVyLmNoYXIoKSk7XG4gICAgICBzY2FubmVyLm5leHQoKTtcbiAgICB9XG4gIH1cbiAgaWYgKHNjYW5uZXIuZW9mKCkpIHtcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYE11bHRpLWxpbmUgc3RyaW5nIGlzIG5vdCBjbG9zZWQ6XFxuJHthY2Muam9pbihcIlwiKX1gKTtcbiAgfVxuICAvLyBpZiBlbmRzIHdpdGggNCBgXCJgLCBwdXNoIHRoZSBmaXN0IGBcImAgdG8gc3RyaW5nXG4gIGlmIChzY2FubmVyLmNoYXIoMykgPT09ICdcIicpIHtcbiAgICBhY2MucHVzaCgnXCInKTtcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfVxuICBzY2FubmVyLm5leHQoMyk7IC8vIHNraXAgbGFzdCAnXCJcIlwiXCJcbiAgcmV0dXJuIHN1Y2Nlc3MoYWNjLmpvaW4oXCJcIikpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIG11bHRpbGluZUxpdGVyYWxTdHJpbmcoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBpZiAoIXNjYW5uZXIuc3RhcnRzV2l0aChcIicnJ1wiKSkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KDMpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgPT09IFwiXFxuXCIpIHtcbiAgICAvLyBUaGUgZmlyc3QgbmV3bGluZSAoTEYpIGlzIHRyaW1tZWRcbiAgICBzY2FubmVyLm5leHQoKTtcbiAgfSBlbHNlIGlmIChzY2FubmVyLnN0YXJ0c1dpdGgoXCJcXHJcXG5cIikpIHtcbiAgICAvLyBUaGUgZmlyc3QgbmV3bGluZSAoQ1JMRikgaXMgdHJpbW1lZFxuICAgIHNjYW5uZXIubmV4dCgyKTtcbiAgfVxuICBjb25zdCBhY2MgPSBbXTtcbiAgd2hpbGUoIXNjYW5uZXIuc3RhcnRzV2l0aChcIicnJ1wiKSAmJiAhc2Nhbm5lci5lb2YoKSl7XG4gICAgYWNjLnB1c2goc2Nhbm5lci5jaGFyKCkpO1xuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9XG4gIGlmIChzY2FubmVyLmVvZigpKSB7XG4gICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGBNdWx0aS1saW5lIHN0cmluZyBpcyBub3QgY2xvc2VkOlxcbiR7YWNjLmpvaW4oXCJcIil9YCk7XG4gIH1cbiAgLy8gaWYgZW5kcyB3aXRoIDQgYCdgLCBwdXNoIHRoZSBmaXN0IGAnYCB0byBzdHJpbmdcbiAgaWYgKHNjYW5uZXIuY2hhcigzKSA9PT0gXCInXCIpIHtcbiAgICBhY2MucHVzaChcIidcIik7XG4gICAgc2Nhbm5lci5uZXh0KCk7XG4gIH1cbiAgc2Nhbm5lci5uZXh0KDMpOyAvLyBza2lwIGxhc3QgXCInJydcIlxuICByZXR1cm4gc3VjY2VzcyhhY2Muam9pbihcIlwiKSk7XG59XG5jb25zdCBCT09MRUFOX1JFR0VYUCA9IC8oPzp0cnVlfGZhbHNlKVxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGJvb2xlYW4oc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goQk9PTEVBTl9SRUdFWFApO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBjb25zdCBzdHJpbmcgPSBtYXRjaFswXTtcbiAgc2Nhbm5lci5uZXh0KHN0cmluZy5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IHN0cmluZyA9PT0gXCJ0cnVlXCI7XG4gIHJldHVybiBzdWNjZXNzKHZhbHVlKTtcbn1cbmNvbnN0IElORklOSVRZX01BUCA9IG5ldyBNYXAoW1xuICBbXG4gICAgXCJpbmZcIixcbiAgICBJbmZpbml0eVxuICBdLFxuICBbXG4gICAgXCIraW5mXCIsXG4gICAgSW5maW5pdHlcbiAgXSxcbiAgW1xuICAgIFwiLWluZlwiLFxuICAgIC1JbmZpbml0eVxuICBdXG5dKTtcbmNvbnN0IElORklOSVRZX1JFR0VYUCA9IC9bKy1dP2luZlxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGluZmluaXR5KHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKElORklOSVRZX1JFR0VYUCk7XG4gIGlmICghbWF0Y2gpIHJldHVybiBmYWlsdXJlKCk7XG4gIGNvbnN0IHN0cmluZyA9IG1hdGNoWzBdO1xuICBzY2FubmVyLm5leHQoc3RyaW5nLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gSU5GSU5JVFlfTUFQLmdldChzdHJpbmcpO1xuICByZXR1cm4gc3VjY2Vzcyh2YWx1ZSk7XG59XG5jb25zdCBOQU5fUkVHRVhQID0gL1srLV0/bmFuXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gbmFuKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKE5BTl9SRUdFWFApO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBjb25zdCBzdHJpbmcgPSBtYXRjaFswXTtcbiAgc2Nhbm5lci5uZXh0KHN0cmluZy5sZW5ndGgpO1xuICBjb25zdCB2YWx1ZSA9IE5hTjtcbiAgcmV0dXJuIHN1Y2Nlc3ModmFsdWUpO1xufVxuZXhwb3J0IGNvbnN0IGRvdHRlZEtleSA9IGpvaW4xKG9yKFtcbiAgYmFyZUtleSxcbiAgYmFzaWNTdHJpbmcsXG4gIGxpdGVyYWxTdHJpbmdcbl0pLCBcIi5cIik7XG5jb25zdCBCSU5BUllfUkVHRVhQID0gLzBiWzAxXSsoPzpfWzAxXSspKlxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGJpbmFyeShzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChCSU5BUllfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBtYXRjaC5zbGljZSgyKS5yZXBsYWNlQWxsKFwiX1wiLCBcIlwiKTtcbiAgY29uc3QgbnVtYmVyID0gcGFyc2VJbnQodmFsdWUsIDIpO1xuICByZXR1cm4gaXNOYU4obnVtYmVyKSA/IGZhaWx1cmUoKSA6IHN1Y2Nlc3MobnVtYmVyKTtcbn1cbmNvbnN0IE9DVEFMX1JFR0VYUCA9IC8wb1swLTddKyg/Ol9bMC03XSspKlxcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIG9jdGFsKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKE9DVEFMX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gbWF0Y2guc2xpY2UoMikucmVwbGFjZUFsbChcIl9cIiwgXCJcIik7XG4gIGNvbnN0IG51bWJlciA9IHBhcnNlSW50KHZhbHVlLCA4KTtcbiAgcmV0dXJuIGlzTmFOKG51bWJlcikgPyBmYWlsdXJlKCkgOiBzdWNjZXNzKG51bWJlcik7XG59XG5jb25zdCBIRVhfUkVHRVhQID0gLzB4WzAtOWEtZl0rKD86X1swLTlhLWZdKykqXFxiL3lpO1xuZXhwb3J0IGZ1bmN0aW9uIGhleChzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChIRVhfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBtYXRjaC5zbGljZSgyKS5yZXBsYWNlQWxsKFwiX1wiLCBcIlwiKTtcbiAgY29uc3QgbnVtYmVyID0gcGFyc2VJbnQodmFsdWUsIDE2KTtcbiAgcmV0dXJuIGlzTmFOKG51bWJlcikgPyBmYWlsdXJlKCkgOiBzdWNjZXNzKG51bWJlcik7XG59XG5jb25zdCBJTlRFR0VSX1JFR0VYUCA9IC9bKy1dPyg/OjB8WzEtOV1bMC05XSooPzpfWzAtOV0rKSopXFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gaW50ZWdlcihzY2FubmVyKSB7XG4gIHNjYW5uZXIuc2tpcFdoaXRlc3BhY2VzKCk7XG4gIGNvbnN0IG1hdGNoID0gc2Nhbm5lci5tYXRjaChJTlRFR0VSX1JFR0VYUCk/LlswXTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0KG1hdGNoLmxlbmd0aCk7XG4gIGNvbnN0IHZhbHVlID0gbWF0Y2gucmVwbGFjZUFsbChcIl9cIiwgXCJcIik7XG4gIGNvbnN0IGludCA9IHBhcnNlSW50KHZhbHVlLCAxMCk7XG4gIHJldHVybiBzdWNjZXNzKGludCk7XG59XG5jb25zdCBGTE9BVF9SRUdFWFAgPSAvWystXT8oPzowfFsxLTldWzAtOV0qKD86X1swLTldKykqKSg/OlxcLlswLTldKyg/Ol9bMC05XSspKik/KD86ZVsrLV0/WzAtOV0rKD86X1swLTldKykqKT9cXGIveWk7XG5leHBvcnQgZnVuY3Rpb24gZmxvYXQoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBjb25zdCBtYXRjaCA9IHNjYW5uZXIubWF0Y2goRkxPQVRfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgY29uc3QgdmFsdWUgPSBtYXRjaC5yZXBsYWNlQWxsKFwiX1wiLCBcIlwiKTtcbiAgY29uc3QgZmxvYXQgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgaWYgKGlzTmFOKGZsb2F0KSkgcmV0dXJuIGZhaWx1cmUoKTtcbiAgcmV0dXJuIHN1Y2Nlc3MoZmxvYXQpO1xufVxuY29uc3QgREFURV9USU1FX1JFR0VYUCA9IC8oPzx5ZWFyPlxcZHs0fSktKD88bW9udGg+XFxkezJ9KS0oPzxkYXk+XFxkezJ9KSg/OlsgMC05VFouOistXSspP1xcYi95O1xuZXhwb3J0IGZ1bmN0aW9uIGRhdGVUaW1lKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKERBVEVfVElNRV9SRUdFWFApO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBjb25zdCBzdHJpbmcgPSBtYXRjaFswXTtcbiAgc2Nhbm5lci5uZXh0KHN0cmluZy5sZW5ndGgpO1xuICBjb25zdCBncm91cHMgPSBtYXRjaC5ncm91cHM7XG4gIC8vIHNwZWNpYWwgY2FzZSBpZiBtb250aCBpcyBGZWJydWFyeVxuICBpZiAoZ3JvdXBzLm1vbnRoID09IFwiMDJcIikge1xuICAgIGNvbnN0IGRheXMgPSBwYXJzZUludChncm91cHMuZGF5KTtcbiAgICBpZiAoZGF5cyA+IDI5KSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgZGF0ZSBzdHJpbmcgXCIke21hdGNofVwiYCk7XG4gICAgfVxuICAgIGNvbnN0IHllYXIgPSBwYXJzZUludChncm91cHMueWVhcik7XG4gICAgaWYgKGRheXMgPiAyOCAmJiAhaXNMZWFwKHllYXIpKSB7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgZGF0ZSBzdHJpbmcgXCIke21hdGNofVwiYCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZShzdHJpbmcudHJpbSgpKTtcbiAgLy8gaW52YWxpZCBkYXRlXG4gIGlmIChpc05hTihkYXRlLmdldFRpbWUoKSkpIHtcbiAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoYEludmFsaWQgZGF0ZSBzdHJpbmcgXCIke21hdGNofVwiYCk7XG4gIH1cbiAgcmV0dXJuIHN1Y2Nlc3MoZGF0ZSk7XG59XG5jb25zdCBMT0NBTF9USU1FX1JFR0VYUCA9IC8oXFxkezJ9KTooXFxkezJ9KTooXFxkezJ9KSg/OlxcLlswLTldKyk/XFxiL3k7XG5leHBvcnQgZnVuY3Rpb24gbG9jYWxUaW1lKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5za2lwV2hpdGVzcGFjZXMoKTtcbiAgY29uc3QgbWF0Y2ggPSBzY2FubmVyLm1hdGNoKExPQ0FMX1RJTUVfUkVHRVhQKT8uWzBdO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQobWF0Y2gubGVuZ3RoKTtcbiAgcmV0dXJuIHN1Y2Nlc3MobWF0Y2gpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGFycmF5VmFsdWUoc2Nhbm5lcikge1xuICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09IFwiW1wiKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHQoKTtcbiAgY29uc3QgYXJyYXkgPSBbXTtcbiAgd2hpbGUoIXNjYW5uZXIuZW9mKCkpe1xuICAgIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICAgIGNvbnN0IHJlc3VsdCA9IHZhbHVlKHNjYW5uZXIpO1xuICAgIGlmICghcmVzdWx0Lm9rKSBicmVhaztcbiAgICBhcnJheS5wdXNoKHJlc3VsdC5ib2R5KTtcbiAgICBzY2FubmVyLnNraXBXaGl0ZXNwYWNlcygpO1xuICAgIC8vIG1heSBoYXZlIGEgbmV4dCBpdGVtLCBidXQgdHJhaWxpbmcgY29tbWEgaXMgYWxsb3dlZCBhdCBhcnJheVxuICAgIGlmIChzY2FubmVyLmNoYXIoKSAhPT0gXCIsXCIpIGJyZWFrO1xuICAgIHNjYW5uZXIubmV4dCgpO1xuICB9XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBpZiAoc2Nhbm5lci5jaGFyKCkgIT09IFwiXVwiKSB0aHJvdyBuZXcgU3ludGF4RXJyb3IoXCJBcnJheSBpcyBub3QgY2xvc2VkXCIpO1xuICBzY2FubmVyLm5leHQoKTtcbiAgcmV0dXJuIHN1Y2Nlc3MoYXJyYXkpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGlubGluZVRhYmxlKHNjYW5uZXIpIHtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGlmIChzY2FubmVyLmNoYXIoMSkgPT09IFwifVwiKSB7XG4gICAgc2Nhbm5lci5uZXh0KDIpO1xuICAgIHJldHVybiBzdWNjZXNzKHtcbiAgICAgIF9fcHJvdG9fXzogbnVsbFxuICAgIH0pO1xuICB9XG4gIGNvbnN0IHBhaXJzID0gc3Vycm91bmQoXCJ7XCIsIGpvaW4ocGFpciwgXCIsXCIpLCBcIn1cIikoc2Nhbm5lcik7XG4gIGlmICghcGFpcnMub2spIHJldHVybiBmYWlsdXJlKCk7XG4gIGxldCB0YWJsZSA9IHtcbiAgICBfX3Byb3RvX186IG51bGxcbiAgfTtcbiAgZm9yIChjb25zdCBwYWlyIG9mIHBhaXJzLmJvZHkpe1xuICAgIHRhYmxlID0gZGVlcE1lcmdlKHRhYmxlLCBwYWlyKTtcbiAgfVxuICByZXR1cm4gc3VjY2Vzcyh0YWJsZSk7XG59XG5leHBvcnQgY29uc3QgdmFsdWUgPSBvcihbXG4gIG11bHRpbGluZUJhc2ljU3RyaW5nLFxuICBtdWx0aWxpbmVMaXRlcmFsU3RyaW5nLFxuICBiYXNpY1N0cmluZyxcbiAgbGl0ZXJhbFN0cmluZyxcbiAgYm9vbGVhbixcbiAgaW5maW5pdHksXG4gIG5hbixcbiAgZGF0ZVRpbWUsXG4gIGxvY2FsVGltZSxcbiAgYmluYXJ5LFxuICBvY3RhbCxcbiAgaGV4LFxuICBmbG9hdCxcbiAgaW50ZWdlcixcbiAgYXJyYXlWYWx1ZSxcbiAgaW5saW5lVGFibGVcbl0pO1xuZXhwb3J0IGNvbnN0IHBhaXIgPSBrdihkb3R0ZWRLZXksIFwiPVwiLCB2YWx1ZSk7XG5leHBvcnQgZnVuY3Rpb24gYmxvY2soc2Nhbm5lcikge1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgY29uc3QgcmVzdWx0ID0gbWVyZ2UocmVwZWF0KHBhaXIpKShzY2FubmVyKTtcbiAgaWYgKHJlc3VsdC5vaykgcmV0dXJuIHN1Y2Nlc3Moe1xuICAgIHR5cGU6IFwiQmxvY2tcIixcbiAgICB2YWx1ZTogcmVzdWx0LmJvZHlcbiAgfSk7XG4gIHJldHVybiBmYWlsdXJlKCk7XG59XG5leHBvcnQgY29uc3QgdGFibGVIZWFkZXIgPSBzdXJyb3VuZChcIltcIiwgZG90dGVkS2V5LCBcIl1cIik7XG5leHBvcnQgZnVuY3Rpb24gdGFibGUoc2Nhbm5lcikge1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgY29uc3QgaGVhZGVyID0gdGFibGVIZWFkZXIoc2Nhbm5lcik7XG4gIGlmICghaGVhZGVyLm9rKSByZXR1cm4gZmFpbHVyZSgpO1xuICBzY2FubmVyLm5leHRVbnRpbENoYXIoKTtcbiAgY29uc3QgYiA9IGJsb2NrKHNjYW5uZXIpO1xuICByZXR1cm4gc3VjY2Vzcyh7XG4gICAgdHlwZTogXCJUYWJsZVwiLFxuICAgIGtleXM6IGhlYWRlci5ib2R5LFxuICAgIHZhbHVlOiBiLm9rID8gYi5ib2R5LnZhbHVlIDoge1xuICAgICAgX19wcm90b19fOiBudWxsXG4gICAgfVxuICB9KTtcbn1cbmV4cG9ydCBjb25zdCB0YWJsZUFycmF5SGVhZGVyID0gc3Vycm91bmQoXCJbW1wiLCBkb3R0ZWRLZXksIFwiXV1cIik7XG5leHBvcnQgZnVuY3Rpb24gdGFibGVBcnJheShzY2FubmVyKSB7XG4gIHNjYW5uZXIubmV4dFVudGlsQ2hhcigpO1xuICBjb25zdCBoZWFkZXIgPSB0YWJsZUFycmF5SGVhZGVyKHNjYW5uZXIpO1xuICBpZiAoIWhlYWRlci5vaykgcmV0dXJuIGZhaWx1cmUoKTtcbiAgc2Nhbm5lci5uZXh0VW50aWxDaGFyKCk7XG4gIGNvbnN0IGIgPSBibG9jayhzY2FubmVyKTtcbiAgcmV0dXJuIHN1Y2Nlc3Moe1xuICAgIHR5cGU6IFwiVGFibGVBcnJheVwiLFxuICAgIGtleXM6IGhlYWRlci5ib2R5LFxuICAgIHZhbHVlOiBiLm9rID8gYi5ib2R5LnZhbHVlIDoge1xuICAgICAgX19wcm90b19fOiBudWxsXG4gICAgfVxuICB9KTtcbn1cbmV4cG9ydCBmdW5jdGlvbiB0b21sKHNjYW5uZXIpIHtcbiAgY29uc3QgYmxvY2tzID0gcmVwZWF0KG9yKFtcbiAgICBibG9jayxcbiAgICB0YWJsZUFycmF5LFxuICAgIHRhYmxlXG4gIF0pKShzY2FubmVyKTtcbiAgaWYgKCFibG9ja3Mub2spIHJldHVybiBzdWNjZXNzKHtcbiAgICBfX3Byb3RvX186IG51bGxcbiAgfSk7XG4gIGNvbnN0IGJvZHkgPSBibG9ja3MuYm9keS5yZWR1Y2UoZGVlcEFzc2lnbiwge1xuICAgIF9fcHJvdG9fXzogbnVsbFxuICB9KTtcbiAgcmV0dXJuIHN1Y2Nlc3MoYm9keSk7XG59XG5mdW5jdGlvbiBjcmVhdGVQYXJzZUVycm9yTWVzc2FnZShzY2FubmVyLCBtZXNzYWdlKSB7XG4gIGNvbnN0IHN0cmluZyA9IHNjYW5uZXIuc291cmNlLnNsaWNlKDAsIHNjYW5uZXIucG9zaXRpb24pO1xuICBjb25zdCBsaW5lcyA9IHN0cmluZy5zcGxpdChcIlxcblwiKTtcbiAgY29uc3Qgcm93ID0gbGluZXMubGVuZ3RoO1xuICBjb25zdCBjb2x1bW4gPSBsaW5lcy5hdCgtMSk/Lmxlbmd0aCA/PyAwO1xuICByZXR1cm4gYFBhcnNlIGVycm9yIG9uIGxpbmUgJHtyb3d9LCBjb2x1bW4gJHtjb2x1bW59OiAke21lc3NhZ2V9YDtcbn1cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZXJGYWN0b3J5KHBhcnNlcikge1xuICByZXR1cm4gKHRvbWxTdHJpbmcpPT57XG4gICAgY29uc3Qgc2Nhbm5lciA9IG5ldyBTY2FubmVyKHRvbWxTdHJpbmcpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBwYXJzZXIoc2Nhbm5lcik7XG4gICAgICBpZiAocmVzdWx0Lm9rICYmIHNjYW5uZXIuZW9mKCkpIHJldHVybiByZXN1bHQuYm9keTtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBgVW5leHBlY3RlZCBjaGFyYWN0ZXI6IFwiJHtzY2FubmVyLmNoYXIoKX1cImA7XG4gICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoY3JlYXRlUGFyc2VFcnJvck1lc3NhZ2Uoc2Nhbm5lciwgbWVzc2FnZSkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgU3ludGF4RXJyb3IoY3JlYXRlUGFyc2VFcnJvck1lc3NhZ2Uoc2Nhbm5lciwgZXJyb3IubWVzc2FnZSkpO1xuICAgICAgfVxuICAgICAgY29uc3QgbWVzc2FnZSA9IFwiSW52YWxpZCBlcnJvciB0eXBlIGNhdWdodFwiO1xuICAgICAgdGhyb3cgbmV3IFN5bnRheEVycm9yKGNyZWF0ZVBhcnNlRXJyb3JNZXNzYWdlKHNjYW5uZXIsIG1lc3NhZ2UpKTtcbiAgICB9XG4gIH07XG59XG4vLyMgc291cmNlTWFwcGluZ1VSTD1fcGFyc2VyLmpzLm1hcCIsIi8vIENvcHlyaWdodCAyMDE4LTIwMjUgdGhlIERlbm8gYXV0aG9ycy4gTUlUIGxpY2Vuc2UuXG4vLyBUaGlzIG1vZHVsZSBpcyBicm93c2VyIGNvbXBhdGlibGUuXG5pbXBvcnQgeyBwYXJzZXJGYWN0b3J5LCB0b21sIH0gZnJvbSBcIi4vX3BhcnNlci5qc1wiO1xuLyoqXG4gKiBQYXJzZXMgYSB7QGxpbmsgaHR0cHM6Ly90b21sLmlvIHwgVE9NTH0gc3RyaW5nIGludG8gYW4gb2JqZWN0LlxuICpcbiAqIEBleGFtcGxlIFVzYWdlXG4gKiBgYGB0c1xuICogaW1wb3J0IHsgcGFyc2UgfSBmcm9tIFwiQHN0ZC90b21sL3BhcnNlXCI7XG4gKiBpbXBvcnQgeyBhc3NlcnRFcXVhbHMgfSBmcm9tIFwiQHN0ZC9hc3NlcnRcIjtcbiAqXG4gKiBjb25zdCB0b21sU3RyaW5nID0gYHRpdGxlID0gXCJUT01MIEV4YW1wbGVcIlxuICogW293bmVyXVxuICogbmFtZSA9IFwiQWxpY2VcIlxuICogYmlvID0gXCJBbGljZSBpcyBhIHByb2dyYW1tZXIuXCJgO1xuICpcbiAqIGNvbnN0IG9iaiA9IHBhcnNlKHRvbWxTdHJpbmcpO1xuICogYXNzZXJ0RXF1YWxzKG9iaiwgeyB0aXRsZTogXCJUT01MIEV4YW1wbGVcIiwgb3duZXI6IHsgbmFtZTogXCJBbGljZVwiLCBiaW86IFwiQWxpY2UgaXMgYSBwcm9ncmFtbWVyLlwiIH0gfSk7XG4gKiBgYGBcbiAqIEBwYXJhbSB0b21sU3RyaW5nIFRPTUwgc3RyaW5nIHRvIGJlIHBhcnNlZC5cbiAqIEByZXR1cm5zIFRoZSBwYXJzZWQgSlMgb2JqZWN0LlxuICovIGV4cG9ydCBmdW5jdGlvbiBwYXJzZSh0b21sU3RyaW5nKSB7XG4gIHJldHVybiBwYXJzZXJGYWN0b3J5KHRvbWwpKHRvbWxTdHJpbmcpO1xufVxuLy8jIHNvdXJjZU1hcHBpbmdVUkw9cGFyc2UuanMubWFwIiwiaW1wb3J0IHsgY3JlYXRlUmVxdWlyZSB9IGZyb20gXCJub2RlOm1vZHVsZVwiO1xuaW1wb3J0IHsgaXNBYnNvbHV0ZSwgam9pbiwgcmVzb2x2ZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwibm9kZTp1cmxcIjtcbi8qKlxuKiBSZXNvbHZlIGFuIGFic29sdXRlIHBhdGggZnJvbSB7QGxpbmsgcm9vdH0sIGJ1dCBvbmx5XG4qIGlmIHtAbGluayBpbnB1dH0gaXNuJ3QgYWxyZWFkeSBhYnNvbHV0ZS5cbipcbiogQHBhcmFtIGlucHV0IFRoZSBwYXRoIHRvIHJlc29sdmUuXG4qIEBwYXJhbSByb290IFRoZSBiYXNlIHBhdGg7IGRlZmF1bHQgPSBwcm9jZXNzLmN3ZCgpXG4qIEByZXR1cm5zIFRoZSByZXNvbHZlZCBhYnNvbHV0ZSBwYXRoLlxuKi9cbmV4cG9ydCBmdW5jdGlvbiBhYnNvbHV0ZShpbnB1dCwgcm9vdCkge1xuXHRyZXR1cm4gaXNBYnNvbHV0ZShpbnB1dCkgPyBpbnB1dCA6IHJlc29sdmUocm9vdCB8fCBcIi5cIiwgaW5wdXQpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGZyb20ocm9vdCwgaWRlbnQsIHNpbGVudCkge1xuXHR0cnkge1xuXHRcdC8vIE5PVEU6IGRpcnMgbmVlZCBhIHRyYWlsaW5nIFwiL1wiIE9SIGZpbGVuYW1lLiBXaXRoIFwiL1wiIHJvdXRlLFxuXHRcdC8vIE5vZGUgYWRkcyBcIm5vb3AuanNcIiBhcyBtYWluIGZpbGUsIHNvIGp1c3QgZG8gXCJub29wLmpzXCIgYW55d2F5LlxuXHRcdGxldCByID0gcm9vdCBpbnN0YW5jZW9mIFVSTCB8fCByb290LnN0YXJ0c1dpdGgoXCJmaWxlOi8vXCIpID8gam9pbihmaWxlVVJMVG9QYXRoKHJvb3QpLCBcIm5vb3AuanNcIikgOiBqb2luKGFic29sdXRlKHJvb3QpLCBcIm5vb3AuanNcIik7XG5cdFx0cmV0dXJuIGNyZWF0ZVJlcXVpcmUocikucmVzb2x2ZShpZGVudCk7XG5cdH0gY2F0Y2ggKGVycikge1xuXHRcdGlmICghc2lsZW50KSB0aHJvdyBlcnI7XG5cdH1cbn1cbmV4cG9ydCBmdW5jdGlvbiBjd2QoaWRlbnQsIHNpbGVudCkge1xuXHRyZXR1cm4gZnJvbShyZXNvbHZlKCksIGlkZW50LCBzaWxlbnQpO1xufVxuIiwiaW1wb3J0IHsgZGlybmFtZSB9IGZyb20gXCJub2RlOnBhdGhcIjtcbmltcG9ydCB7IGFic29sdXRlIH0gZnJvbSBcImVtcGF0aGljL3Jlc29sdmVcIjtcbi8qKlxuKiBHZXQgYWxsIHBhcmVudCBkaXJlY3RvcmllcyBvZiB7QGxpbmsgYmFzZX0uXG4qIFN0b3BzIGFmdGVyIHtAbGluayBPcHRpb25zWydsYXN0J119IGlzIHByb2Nlc3NlZC5cbipcbiogQHJldHVybnMgQW4gYXJyYXkgb2YgYWJzb2x1dGUgcGF0aHMgb2YgYWxsIHBhcmVudCBkaXJlY3Rvcmllcy5cbiovXG5leHBvcnQgZnVuY3Rpb24gdXAoYmFzZSwgb3B0aW9ucykge1xuXHRsZXQgeyBsYXN0LCBjd2QgfSA9IG9wdGlvbnMgfHwge307XG5cdGxldCB0bXAgPSBhYnNvbHV0ZShiYXNlLCBjd2QpO1xuXHRsZXQgcm9vdCA9IGFic29sdXRlKGxhc3QgfHwgXCIvXCIsIGN3ZCk7XG5cdGxldCBwcmV2LCBhcnIgPSBbXTtcblx0d2hpbGUgKHByZXYgIT09IHJvb3QpIHtcblx0XHRhcnIucHVzaCh0bXApO1xuXHRcdHRtcCA9IGRpcm5hbWUocHJldiA9IHRtcCk7XG5cdFx0aWYgKHRtcCA9PT0gcHJldikgYnJlYWs7XG5cdH1cblx0cmV0dXJuIGFycjtcbn1cbiIsImltcG9ydCB7IGpvaW4gfSBmcm9tIFwibm9kZTpwYXRoXCI7XG5pbXBvcnQgeyBleGlzdHNTeW5jLCBzdGF0U3luYyB9IGZyb20gXCJub2RlOmZzXCI7XG5pbXBvcnQgKiBhcyB3YWxrIGZyb20gXCJlbXBhdGhpYy93YWxrXCI7XG4vKipcbiogRmluZCBhbiBpdGVtIGJ5IG5hbWUsIHdhbGtpbmcgcGFyZW50IGRpcmVjdG9yaWVzIHVudGlsIGZvdW5kLlxuKlxuKiBAcGFyYW0gbmFtZSBUaGUgaXRlbSBuYW1lIHRvIGZpbmQuXG4qIEByZXR1cm5zIFRoZSBhYnNvbHV0ZSBwYXRoIHRvIHRoZSBpdGVtLCBpZiBmb3VuZC5cbiovXG5leHBvcnQgZnVuY3Rpb24gdXAobmFtZSwgb3B0aW9ucykge1xuXHRsZXQgZGlyLCB0bXA7XG5cdGxldCBzdGFydCA9IG9wdGlvbnMgJiYgb3B0aW9ucy5jd2QgfHwgXCJcIjtcblx0Zm9yIChkaXIgb2Ygd2Fsay51cChzdGFydCwgb3B0aW9ucykpIHtcblx0XHR0bXAgPSBqb2luKGRpciwgbmFtZSk7XG5cdFx0aWYgKGV4aXN0c1N5bmModG1wKSkgcmV0dXJuIHRtcDtcblx0fVxufVxuLyoqXG4qIEdldCB0aGUgZmlyc3QgcGF0aCB0aGF0IG1hdGNoZXMgYW55IG9mIHRoZSBuYW1lcyBwcm92aWRlZC5cbipcbiogPiBbTk9URV1cbiogPiBUaGUgb3JkZXIgb2Yge0BsaW5rIG5hbWVzfSBpcyByZXNwZWN0ZWQuXG4qXG4qIEBwYXJhbSBuYW1lcyBUaGUgaXRlbSBuYW1lcyB0byBmaW5kLlxuKiBAcmV0dXJucyBUaGUgYWJzb2x1dGUgcGF0aCBvZiB0aGUgZmlyc3QgaXRlbSBmb3VuZCwgaWYgYW55LlxuKi9cbmV4cG9ydCBmdW5jdGlvbiBhbnkobmFtZXMsIG9wdGlvbnMpIHtcblx0bGV0IGRpciwgc3RhcnQgPSBvcHRpb25zICYmIG9wdGlvbnMuY3dkIHx8IFwiXCI7XG5cdGxldCBqID0gMCwgbGVuID0gbmFtZXMubGVuZ3RoLCB0bXA7XG5cdGZvciAoZGlyIG9mIHdhbGsudXAoc3RhcnQsIG9wdGlvbnMpKSB7XG5cdFx0Zm9yIChqID0gMDsgaiA8IGxlbjsgaisrKSB7XG5cdFx0XHR0bXAgPSBqb2luKGRpciwgbmFtZXNbal0pO1xuXHRcdFx0aWYgKGV4aXN0c1N5bmModG1wKSkgcmV0dXJuIHRtcDtcblx0XHR9XG5cdH1cbn1cbi8qKlxuKiBGaW5kIGEgZmlsZSBieSBuYW1lLCB3YWxraW5nIHBhcmVudCBkaXJlY3RvcmllcyB1bnRpbCBmb3VuZC5cbipcbiogPiBbTk9URV1cbiogPiBUaGlzIGZ1bmN0aW9uIG9ubHkgcmV0dXJucyBhIHZhbHVlIGZvciBmaWxlIG1hdGNoZXMuXG4qID4gQSBkaXJlY3RvcnkgbWF0Y2ggd2l0aCB0aGUgc2FtZSBuYW1lIHdpbGwgYmUgaWdub3JlZC5cbipcbiogQHBhcmFtIG5hbWUgVGhlIGZpbGUgbmFtZSB0byBmaW5kLlxuKiBAcmV0dXJucyBUaGUgYWJzb2x1dGUgcGF0aCB0byB0aGUgZmlsZSwgaWYgZm91bmQuXG4qL1xuZXhwb3J0IGZ1bmN0aW9uIGZpbGUobmFtZSwgb3B0aW9ucykge1xuXHRsZXQgZGlyLCB0bXA7XG5cdGxldCBzdGFydCA9IG9wdGlvbnMgJiYgb3B0aW9ucy5jd2QgfHwgXCJcIjtcblx0Zm9yIChkaXIgb2Ygd2Fsay51cChzdGFydCwgb3B0aW9ucykpIHtcblx0XHR0cnkge1xuXHRcdFx0dG1wID0gam9pbihkaXIsIG5hbWUpO1xuXHRcdFx0aWYgKHN0YXRTeW5jKHRtcCkuaXNGaWxlKCkpIHJldHVybiB0bXA7XG5cdFx0fSBjYXRjaCB7fVxuXHR9XG59XG4vKipcbiogRmluZCBhIGRpcmVjdG9yeSBieSBuYW1lLCB3YWxraW5nIHBhcmVudCBkaXJlY3RvcmllcyB1bnRpbCBmb3VuZC5cbipcbiogPiBbTk9URV1cbiogPiBUaGlzIGZ1bmN0aW9uIG9ubHkgcmV0dXJucyBhIHZhbHVlIGZvciBkaXJlY3RvcnkgbWF0Y2hlcy5cbiogPiBBIGZpbGUgbWF0Y2ggd2l0aCB0aGUgc2FtZSBuYW1lIHdpbGwgYmUgaWdub3JlZC5cbipcbiogQHBhcmFtIG5hbWUgVGhlIGRpcmVjdG9yeSBuYW1lIHRvIGZpbmQuXG4qIEByZXR1cm5zIFRoZSBhYnNvbHV0ZSBwYXRoIHRvIHRoZSBmaWxlLCBpZiBmb3VuZC5cbiovXG5leHBvcnQgZnVuY3Rpb24gZGlyKG5hbWUsIG9wdGlvbnMpIHtcblx0bGV0IGRpciwgdG1wO1xuXHRsZXQgc3RhcnQgPSBvcHRpb25zICYmIG9wdGlvbnMuY3dkIHx8IFwiXCI7XG5cdGZvciAoZGlyIG9mIHdhbGsudXAoc3RhcnQsIG9wdGlvbnMpKSB7XG5cdFx0dHJ5IHtcblx0XHRcdHRtcCA9IGpvaW4oZGlyLCBuYW1lKTtcblx0XHRcdGlmIChzdGF0U3luYyh0bXApLmlzRGlyZWN0b3J5KCkpIHJldHVybiB0bXA7XG5cdFx0fSBjYXRjaCB7fVxuXHR9XG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVJlbmFtZUNvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1sncmVuYW1lJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdSZW5hbWUgdGhlIE5BUEktUlMgcHJvamVjdCcsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgbnBtRGlyID0gT3B0aW9uLlN0cmluZygnLS1ucG0tZGlyJywgJ25wbScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dCcsXG4gIH0pXG5cbiAgJCRuYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1uYW1lLC1uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG5ldyBuYW1lIG9mIHRoZSBwcm9qZWN0JyxcbiAgfSlcblxuICBiaW5hcnlOYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1iaW5hcnktbmFtZSwtYicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBuZXcgYmluYXJ5IG5hbWUgKi5ub2RlIGZpbGVzJyxcbiAgfSlcblxuICBwYWNrYWdlTmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1uYW1lJywge1xuICAgIGRlc2NyaXB0aW9uOiAnVGhlIG5ldyBwYWNrYWdlIG5hbWUgb2YgdGhlIHByb2plY3QnLFxuICB9KVxuXG4gIG1hbmlmZXN0UGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tbWFuaWZlc3QtcGF0aCcsICdDYXJnby50b21sJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgQ2FyZ28udG9tbGAnLFxuICB9KVxuXG4gIHJlcG9zaXRvcnk/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXJlcG9zaXRvcnknLCB7XG4gICAgZGVzY3JpcHRpb246ICdUaGUgbmV3IHJlcG9zaXRvcnkgb2YgdGhlIHByb2plY3QnLFxuICB9KVxuXG4gIGRlc2NyaXB0aW9uPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1kZXNjcmlwdGlvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1RoZSBuZXcgZGVzY3JpcHRpb24gb2YgdGhlIHByb2plY3QnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgbnBtRGlyOiB0aGlzLm5wbURpcixcbiAgICAgIG5hbWU6IHRoaXMuJCRuYW1lLFxuICAgICAgYmluYXJ5TmFtZTogdGhpcy5iaW5hcnlOYW1lLFxuICAgICAgcGFja2FnZU5hbWU6IHRoaXMucGFja2FnZU5hbWUsXG4gICAgICBtYW5pZmVzdFBhdGg6IHRoaXMubWFuaWZlc3RQYXRoLFxuICAgICAgcmVwb3NpdG9yeTogdGhpcy5yZXBvc2l0b3J5LFxuICAgICAgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmVuYW1lIHRoZSBOQVBJLVJTIHByb2plY3RcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZW5hbWVPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0XG4gICAqXG4gICAqIEBkZWZhdWx0ICducG0nXG4gICAqL1xuICBucG1EaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuZXcgbmFtZSBvZiB0aGUgcHJvamVjdFxuICAgKi9cbiAgbmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5ldyBiaW5hcnkgbmFtZSAqLm5vZGUgZmlsZXNcbiAgICovXG4gIGJpbmFyeU5hbWU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuZXcgcGFja2FnZSBuYW1lIG9mIHRoZSBwcm9qZWN0XG4gICAqL1xuICBwYWNrYWdlTmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgQ2FyZ28udG9tbGBcbiAgICpcbiAgICogQGRlZmF1bHQgJ0NhcmdvLnRvbWwnXG4gICAqL1xuICBtYW5pZmVzdFBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFRoZSBuZXcgcmVwb3NpdG9yeSBvZiB0aGUgcHJvamVjdFxuICAgKi9cbiAgcmVwb3NpdG9yeT86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIG5ldyBkZXNjcmlwdGlvbiBvZiB0aGUgcHJvamVjdFxuICAgKi9cbiAgZGVzY3JpcHRpb24/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdFJlbmFtZU9wdGlvbnMob3B0aW9uczogUmVuYW1lT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGN3ZDogcHJvY2Vzcy5jd2QoKSxcbiAgICBwYWNrYWdlSnNvblBhdGg6ICdwYWNrYWdlLmpzb24nLFxuICAgIG5wbURpcjogJ25wbScsXG4gICAgbWFuaWZlc3RQYXRoOiAnQ2FyZ28udG9tbCcsXG4gICAgLi4ub3B0aW9ucyxcbiAgfVxufVxuIiwiaW1wb3J0IHsgZXhpc3RzU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyByZW5hbWUgfSBmcm9tICdub2RlOmZzL3Byb21pc2VzJ1xuaW1wb3J0IHsgcmVzb2x2ZSwgam9pbiB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHsgcGFyc2UgYXMgcGFyc2VUb21sLCBzdHJpbmdpZnkgYXMgc3RyaW5naWZ5VG9tbCB9IGZyb20gJ0BzdGQvdG9tbCdcbmltcG9ydCB7IGxvYWQgYXMgeWFtbFBhcnNlLCBkdW1wIGFzIHlhbWxTdHJpbmdpZnkgfSBmcm9tICdqcy15YW1sJ1xuaW1wb3J0IHsgaXNOaWwsIG1lcmdlLCBvbWl0QnksIHBpY2sgfSBmcm9tICdlcy10b29sa2l0J1xuaW1wb3J0ICogYXMgZmluZCBmcm9tICdlbXBhdGhpYy9maW5kJ1xuXG5pbXBvcnQgeyBhcHBseURlZmF1bHRSZW5hbWVPcHRpb25zLCB0eXBlIFJlbmFtZU9wdGlvbnMgfSBmcm9tICcuLi9kZWYvcmVuYW1lLmpzJ1xuaW1wb3J0IHsgcmVhZENvbmZpZywgcmVhZEZpbGVBc3luYywgd3JpdGVGaWxlQXN5bmMgfSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmFtZVByb2plY3QodXNlck9wdGlvbnM6IFJlbmFtZU9wdGlvbnMpIHtcbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdFJlbmFtZU9wdGlvbnModXNlck9wdGlvbnMpXG4gIGNvbnN0IG5hcGlDb25maWcgPSBhd2FpdCByZWFkQ29uZmlnKG9wdGlvbnMpXG4gIGNvbnN0IG9sZE5hbWUgPSBuYXBpQ29uZmlnLmJpbmFyeU5hbWVcblxuICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlKG9wdGlvbnMuY3dkLCBvcHRpb25zLnBhY2thZ2VKc29uUGF0aClcbiAgY29uc3QgY2FyZ29Ub21sUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMubWFuaWZlc3RQYXRoKVxuXG4gIGNvbnN0IHBhY2thZ2VKc29uQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMocGFja2FnZUpzb25QYXRoLCAndXRmOCcpXG4gIGNvbnN0IHBhY2thZ2VKc29uRGF0YSA9IEpTT04ucGFyc2UocGFja2FnZUpzb25Db250ZW50KVxuXG4gIG1lcmdlKFxuICAgIG1lcmdlKFxuICAgICAgcGFja2FnZUpzb25EYXRhLFxuICAgICAgb21pdEJ5KFxuICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yIG1pc3NpbmcgZmllbGRzOiBhdXRob3IgYW5kIGxpY2Vuc2VcbiAgICAgICAgcGljayhvcHRpb25zLCBbJ25hbWUnLCAnZGVzY3JpcHRpb24nLCAnYXV0aG9yJywgJ2xpY2Vuc2UnXSksXG4gICAgICAgIGlzTmlsLFxuICAgICAgKSxcbiAgICApLFxuICAgIHtcbiAgICAgIG5hcGk6IG9taXRCeShcbiAgICAgICAge1xuICAgICAgICAgIGJpbmFyeU5hbWU6IG9wdGlvbnMuYmluYXJ5TmFtZSxcbiAgICAgICAgICBwYWNrYWdlTmFtZTogb3B0aW9ucy5wYWNrYWdlTmFtZSxcbiAgICAgICAgfSxcbiAgICAgICAgaXNOaWwsXG4gICAgICApLFxuICAgIH0sXG4gIClcblxuICBpZiAob3B0aW9ucy5jb25maWdQYXRoKSB7XG4gICAgY29uc3QgY29uZmlnUGF0aCA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnUGF0aClcbiAgICBjb25zdCBjb25maWdDb250ZW50ID0gYXdhaXQgcmVhZEZpbGVBc3luYyhjb25maWdQYXRoLCAndXRmOCcpXG4gICAgY29uc3QgY29uZmlnRGF0YSA9IEpTT04ucGFyc2UoY29uZmlnQ29udGVudClcbiAgICBjb25maWdEYXRhLmJpbmFyeU5hbWUgPSBvcHRpb25zLmJpbmFyeU5hbWVcbiAgICBjb25maWdEYXRhLnBhY2thZ2VOYW1lID0gb3B0aW9ucy5wYWNrYWdlTmFtZVxuICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKGNvbmZpZ1BhdGgsIEpTT04uc3RyaW5naWZ5KGNvbmZpZ0RhdGEsIG51bGwsIDIpKVxuICB9XG5cbiAgYXdhaXQgd3JpdGVGaWxlQXN5bmMoXG4gICAgcGFja2FnZUpzb25QYXRoLFxuICAgIEpTT04uc3RyaW5naWZ5KHBhY2thZ2VKc29uRGF0YSwgbnVsbCwgMiksXG4gIClcblxuICBjb25zdCB0b21sQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoY2FyZ29Ub21sUGF0aCwgJ3V0ZjgnKVxuICBjb25zdCBjYXJnb1RvbWwgPSBwYXJzZVRvbWwodG9tbENvbnRlbnQpIGFzIGFueVxuXG4gIC8vIFVwZGF0ZSB0aGUgcGFja2FnZSBuYW1lXG4gIGlmIChjYXJnb1RvbWwucGFja2FnZSAmJiBvcHRpb25zLmJpbmFyeU5hbWUpIHtcbiAgICAvLyBTYW5pdGl6ZSB0aGUgYmluYXJ5IG5hbWUgZm9yIFJ1c3QgcGFja2FnZSBuYW1pbmcgY29udmVudGlvbnNcbiAgICBjb25zdCBzYW5pdGl6ZWROYW1lID0gb3B0aW9ucy5iaW5hcnlOYW1lXG4gICAgICAucmVwbGFjZSgnQCcsICcnKVxuICAgICAgLnJlcGxhY2UoJy8nLCAnXycpXG4gICAgICAucmVwbGFjZSgvLS9nLCAnXycpXG4gICAgICAudG9Mb3dlckNhc2UoKVxuICAgIGNhcmdvVG9tbC5wYWNrYWdlLm5hbWUgPSBzYW5pdGl6ZWROYW1lXG4gIH1cblxuICAvLyBTdHJpbmdpZnkgdGhlIHVwZGF0ZWQgVE9NTFxuICBjb25zdCB1cGRhdGVkVG9tbENvbnRlbnQgPSBzdHJpbmdpZnlUb21sKGNhcmdvVG9tbClcblxuICBhd2FpdCB3cml0ZUZpbGVBc3luYyhjYXJnb1RvbWxQYXRoLCB1cGRhdGVkVG9tbENvbnRlbnQpXG4gIGlmIChvbGROYW1lICE9PSBvcHRpb25zLmJpbmFyeU5hbWUpIHtcbiAgICBjb25zdCBnaXRodWJBY3Rpb25zUGF0aCA9IGZpbmQuZGlyKCcuZ2l0aHViJywge1xuICAgICAgY3dkOiBvcHRpb25zLmN3ZCxcbiAgICB9KVxuICAgIGlmIChnaXRodWJBY3Rpb25zUGF0aCkge1xuICAgICAgY29uc3QgZ2l0aHViQWN0aW9uc0NJWW1sUGF0aCA9IGpvaW4oXG4gICAgICAgIGdpdGh1YkFjdGlvbnNQYXRoLFxuICAgICAgICAnd29ya2Zsb3dzJyxcbiAgICAgICAgJ0NJLnltbCcsXG4gICAgICApXG4gICAgICBpZiAoZXhpc3RzU3luYyhnaXRodWJBY3Rpb25zQ0lZbWxQYXRoKSkge1xuICAgICAgICBjb25zdCBnaXRodWJBY3Rpb25zQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoXG4gICAgICAgICAgZ2l0aHViQWN0aW9uc0NJWW1sUGF0aCxcbiAgICAgICAgICAndXRmOCcsXG4gICAgICAgIClcbiAgICAgICAgY29uc3QgZ2l0aHViQWN0aW9uc0RhdGEgPSB5YW1sUGFyc2UoZ2l0aHViQWN0aW9uc0NvbnRlbnQpIGFzIGFueVxuICAgICAgICBpZiAoZ2l0aHViQWN0aW9uc0RhdGEuZW52Py5BUFBfTkFNRSkge1xuICAgICAgICAgIGdpdGh1YkFjdGlvbnNEYXRhLmVudi5BUFBfTkFNRSA9IG9wdGlvbnMuYmluYXJ5TmFtZVxuICAgICAgICAgIGF3YWl0IHdyaXRlRmlsZUFzeW5jKFxuICAgICAgICAgICAgZ2l0aHViQWN0aW9uc0NJWW1sUGF0aCxcbiAgICAgICAgICAgIHlhbWxTdHJpbmdpZnkoZ2l0aHViQWN0aW9uc0RhdGEsIHtcbiAgICAgICAgICAgICAgbGluZVdpZHRoOiAtMSxcbiAgICAgICAgICAgICAgbm9SZWZzOiB0cnVlLFxuICAgICAgICAgICAgICBzb3J0S2V5czogZmFsc2UsXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3Qgb2xkV2FzaUJyb3dzZXJCaW5kaW5nUGF0aCA9IGpvaW4oXG4gICAgICBvcHRpb25zLmN3ZCxcbiAgICAgIGAke29sZE5hbWV9Lndhc2ktYnJvd3Nlci5qc2AsXG4gICAgKVxuICAgIGlmIChleGlzdHNTeW5jKG9sZFdhc2lCcm93c2VyQmluZGluZ1BhdGgpKSB7XG4gICAgICBhd2FpdCByZW5hbWUoXG4gICAgICAgIG9sZFdhc2lCcm93c2VyQmluZGluZ1BhdGgsXG4gICAgICAgIGpvaW4ob3B0aW9ucy5jd2QsIGAke29wdGlvbnMuYmluYXJ5TmFtZX0ud2FzaS1icm93c2VyLmpzYCksXG4gICAgICApXG4gICAgfVxuICAgIGNvbnN0IG9sZFdhc2lCaW5kaW5nUGF0aCA9IGpvaW4ob3B0aW9ucy5jd2QsIGAke29sZE5hbWV9Lndhc2kuY2pzYClcbiAgICBpZiAoZXhpc3RzU3luYyhvbGRXYXNpQmluZGluZ1BhdGgpKSB7XG4gICAgICBhd2FpdCByZW5hbWUoXG4gICAgICAgIG9sZFdhc2lCaW5kaW5nUGF0aCxcbiAgICAgICAgam9pbihvcHRpb25zLmN3ZCwgYCR7b3B0aW9ucy5iaW5hcnlOYW1lfS53YXNpLmNqc2ApLFxuICAgICAgKVxuICAgIH1cbiAgICBjb25zdCBnaXRBdHRyaWJ1dGVzUGF0aCA9IGpvaW4ob3B0aW9ucy5jd2QsICcuZ2l0YXR0cmlidXRlcycpXG4gICAgaWYgKGV4aXN0c1N5bmMoZ2l0QXR0cmlidXRlc1BhdGgpKSB7XG4gICAgICBjb25zdCBnaXRBdHRyaWJ1dGVzQ29udGVudCA9IGF3YWl0IHJlYWRGaWxlQXN5bmMoXG4gICAgICAgIGdpdEF0dHJpYnV0ZXNQYXRoLFxuICAgICAgICAndXRmOCcsXG4gICAgICApXG4gICAgICBjb25zdCBnaXRBdHRyaWJ1dGVzRGF0YSA9IGdpdEF0dHJpYnV0ZXNDb250ZW50XG4gICAgICAgIC5zcGxpdCgnXFxuJylcbiAgICAgICAgLm1hcCgobGluZSkgPT4ge1xuICAgICAgICAgIHJldHVybiBsaW5lXG4gICAgICAgICAgICAucmVwbGFjZShcbiAgICAgICAgICAgICAgYCR7b2xkTmFtZX0ud2FzaS1icm93c2VyLmpzYCxcbiAgICAgICAgICAgICAgYCR7b3B0aW9ucy5iaW5hcnlOYW1lfS53YXNpLWJyb3dzZXIuanNgLFxuICAgICAgICAgICAgKVxuICAgICAgICAgICAgLnJlcGxhY2UoYCR7b2xkTmFtZX0ud2FzaS5janNgLCBgJHtvcHRpb25zLmJpbmFyeU5hbWV9Lndhc2kuY2pzYClcbiAgICAgICAgfSlcbiAgICAgICAgLmpvaW4oJ1xcbicpXG4gICAgICBhd2FpdCB3cml0ZUZpbGVBc3luYyhnaXRBdHRyaWJ1dGVzUGF0aCwgZ2l0QXR0cmlidXRlc0RhdGEpXG4gICAgfVxuICB9XG59XG4iLCJpbXBvcnQgeyBleGVjLCBleGVjU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gJ25vZGU6b3MnXG5pbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgeyBwcm9taXNlcyBhcyBmcyB9IGZyb20gJ25vZGU6ZnMnXG5cbmltcG9ydCB7IGxvYWQgYXMgeWFtbExvYWQsIGR1bXAgYXMgeWFtbER1bXAgfSBmcm9tICdqcy15YW1sJ1xuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHROZXdPcHRpb25zLFxuICB0eXBlIE5ld09wdGlvbnMgYXMgUmF3TmV3T3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL25ldy5qcydcbmltcG9ydCB7XG4gIEFWQUlMQUJMRV9UQVJHRVRTLFxuICBkZWJ1Z0ZhY3RvcnksXG4gIERFRkFVTFRfVEFSR0VUUyxcbiAgbWtkaXJBc3luYyxcbiAgcmVhZGRpckFzeW5jLFxuICBzdGF0QXN5bmMsXG4gIHR5cGUgU3VwcG9ydGVkUGFja2FnZU1hbmFnZXIsXG59IGZyb20gJy4uL3V0aWxzL2luZGV4LmpzJ1xuaW1wb3J0IHsgbmFwaUVuZ2luZVJlcXVpcmVtZW50IH0gZnJvbSAnLi4vdXRpbHMvdmVyc2lvbi5qcydcbmltcG9ydCB7IHJlbmFtZVByb2plY3QgfSBmcm9tICcuL3JlbmFtZS5qcydcblxuLy8gVGVtcGxhdGUgaW1wb3J0cyByZW1vdmVkIGFzIHdlJ3JlIG5vdyB1c2luZyBleHRlcm5hbCB0ZW1wbGF0ZXNcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ25ldycpXG5cbnR5cGUgTmV3T3B0aW9ucyA9IFJlcXVpcmVkPFJhd05ld09wdGlvbnM+XG5cbmNvbnN0IFRFTVBMQVRFX1JFUE9TID0ge1xuICB5YXJuOiAnaHR0cHM6Ly9naXRodWIuY29tL25hcGktcnMvcGFja2FnZS10ZW1wbGF0ZScsXG4gIHBucG06ICdodHRwczovL2dpdGh1Yi5jb20vbmFwaS1ycy9wYWNrYWdlLXRlbXBsYXRlLXBucG0nLFxufSBhcyBjb25zdFxuXG5hc3luYyBmdW5jdGlvbiBjaGVja0dpdENvbW1hbmQoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IGNwID0gZXhlYygnZ2l0IC0tdmVyc2lvbicpXG4gICAgICBjcC5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICAgIHJlc29sdmUoZmFsc2UpXG4gICAgICB9KVxuICAgICAgY3Aub24oJ2V4aXQnLCAoY29kZSkgPT4ge1xuICAgICAgICBpZiAoY29kZSA9PT0gMCkge1xuICAgICAgICAgIHJlc29sdmUodHJ1ZSlcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH0pXG4gICAgcmV0dXJuIHRydWVcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlQ2FjaGVEaXIoXG4gIHBhY2thZ2VNYW5hZ2VyOiBTdXBwb3J0ZWRQYWNrYWdlTWFuYWdlcixcbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGNhY2hlRGlyID0gcGF0aC5qb2luKGhvbWVkaXIoKSwgJy5uYXBpLXJzJywgJ3RlbXBsYXRlJywgcGFja2FnZU1hbmFnZXIpXG4gIGF3YWl0IG1rZGlyQXN5bmMoY2FjaGVEaXIsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gIHJldHVybiBjYWNoZURpclxufVxuXG5hc3luYyBmdW5jdGlvbiBkb3dubG9hZFRlbXBsYXRlKFxuICBwYWNrYWdlTWFuYWdlcjogU3VwcG9ydGVkUGFja2FnZU1hbmFnZXIsXG4gIGNhY2hlRGlyOiBzdHJpbmcsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcmVwb1VybCA9IFRFTVBMQVRFX1JFUE9TW3BhY2thZ2VNYW5hZ2VyXVxuICBjb25zdCB0ZW1wbGF0ZVBhdGggPSBwYXRoLmpvaW4oY2FjaGVEaXIsICdyZXBvJylcblxuICBpZiAoZXhpc3RzU3luYyh0ZW1wbGF0ZVBhdGgpKSB7XG4gICAgZGVidWcoYFRlbXBsYXRlIGNhY2hlIGZvdW5kIGF0ICR7dGVtcGxhdGVQYXRofSwgdXBkYXRpbmcuLi5gKVxuICAgIHRyeSB7XG4gICAgICAvLyBGZXRjaCBsYXRlc3QgY2hhbmdlcyBhbmQgcmVzZXQgdG8gcmVtb3RlXG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGNvbnN0IGNwID0gZXhlYygnZ2l0IGZldGNoIG9yaWdpbicsIHsgY3dkOiB0ZW1wbGF0ZVBhdGggfSlcbiAgICAgICAgY3Aub24oJ2Vycm9yJywgcmVqZWN0KVxuICAgICAgICBjcC5vbignZXhpdCcsIChjb2RlKSA9PiB7XG4gICAgICAgICAgaWYgKGNvZGUgPT09IDApIHtcbiAgICAgICAgICAgIHJlc29sdmUoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgICBgRmFpbGVkIHRvIGZldGNoIGxhdGVzdCBjaGFuZ2VzLCBnaXQgcHJvY2VzcyBleGl0ZWQgd2l0aCBjb2RlICR7Y29kZX1gLFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgKVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH0pXG4gICAgICBleGVjU3luYygnZ2l0IHJlc2V0IC0taGFyZCBvcmlnaW4vbWFpbicsIHtcbiAgICAgICAgY3dkOiB0ZW1wbGF0ZVBhdGgsXG4gICAgICAgIHN0ZGlvOiAnaWdub3JlJyxcbiAgICAgIH0pXG4gICAgICBkZWJ1ZygnVGVtcGxhdGUgdXBkYXRlZCBzdWNjZXNzZnVsbHknKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBkZWJ1ZyhgRmFpbGVkIHRvIHVwZGF0ZSB0ZW1wbGF0ZTogJHtlcnJvcn1gKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gdXBkYXRlIHRlbXBsYXRlIGZyb20gJHtyZXBvVXJsfTogJHtlcnJvcn1gKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBkZWJ1ZyhgQ2xvbmluZyB0ZW1wbGF0ZSBmcm9tICR7cmVwb1VybH0uLi5gKVxuICAgIHRyeSB7XG4gICAgICBleGVjU3luYyhgZ2l0IGNsb25lICR7cmVwb1VybH0gcmVwb2AsIHsgY3dkOiBjYWNoZURpciwgc3RkaW86ICdpbmhlcml0JyB9KVxuICAgICAgZGVidWcoJ1RlbXBsYXRlIGNsb25lZCBzdWNjZXNzZnVsbHknKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjbG9uZSB0ZW1wbGF0ZSBmcm9tICR7cmVwb1VybH06ICR7ZXJyb3J9YClcbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gY29weURpcmVjdG9yeShcbiAgc3JjOiBzdHJpbmcsXG4gIGRlc3Q6IHN0cmluZyxcbiAgaW5jbHVkZVdhc2lCaW5kaW5nczogYm9vbGVhbixcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBta2RpckFzeW5jKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBmcy5yZWFkZGlyKHNyYywgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgY29uc3Qgc3JjUGF0aCA9IHBhdGguam9pbihzcmMsIGVudHJ5Lm5hbWUpXG4gICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4oZGVzdCwgZW50cnkubmFtZSlcblxuICAgIC8vIFNraXAgLmdpdCBkaXJlY3RvcnlcbiAgICBpZiAoZW50cnkubmFtZSA9PT0gJy5naXQnKSB7XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGlmIChlbnRyeS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICBhd2FpdCBjb3B5RGlyZWN0b3J5KHNyY1BhdGgsIGRlc3RQYXRoLCBpbmNsdWRlV2FzaUJpbmRpbmdzKVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXG4gICAgICAgICFpbmNsdWRlV2FzaUJpbmRpbmdzICYmXG4gICAgICAgIChlbnRyeS5uYW1lLmVuZHNXaXRoKCcud2FzaS1icm93c2VyLmpzJykgfHxcbiAgICAgICAgICBlbnRyeS5uYW1lLmVuZHNXaXRoKCcud2FzaS5janMnKSB8fFxuICAgICAgICAgIGVudHJ5Lm5hbWUuZW5kc1dpdGgoJ3dhc2ktd29ya2VyLmJyb3dzZXIubWpzICcpIHx8XG4gICAgICAgICAgZW50cnkubmFtZS5lbmRzV2l0aCgnd2FzaS13b3JrZXIubWpzJykgfHxcbiAgICAgICAgICBlbnRyeS5uYW1lLmVuZHNXaXRoKCdicm93c2VyLmpzJykpXG4gICAgICApIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cbiAgICAgIGF3YWl0IGZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKVxuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmaWx0ZXJUYXJnZXRzSW5QYWNrYWdlSnNvbihcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgZW5hYmxlZFRhcmdldHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04JylcbiAgY29uc3QgcGFja2FnZUpzb24gPSBKU09OLnBhcnNlKGNvbnRlbnQpXG5cbiAgLy8gRmlsdGVyIG5hcGkudGFyZ2V0c1xuICBpZiAocGFja2FnZUpzb24ubmFwaT8udGFyZ2V0cykge1xuICAgIHBhY2thZ2VKc29uLm5hcGkudGFyZ2V0cyA9IHBhY2thZ2VKc29uLm5hcGkudGFyZ2V0cy5maWx0ZXIoXG4gICAgICAodGFyZ2V0OiBzdHJpbmcpID0+IGVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKHRhcmdldCksXG4gICAgKVxuICB9XG5cbiAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCBKU09OLnN0cmluZ2lmeShwYWNrYWdlSnNvbiwgbnVsbCwgMikgKyAnXFxuJylcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmlsdGVyVGFyZ2V0c0luR2l0aHViQWN0aW9ucyhcbiAgZmlsZVBhdGg6IHN0cmluZyxcbiAgZW5hYmxlZFRhcmdldHM6IHN0cmluZ1tdLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCwgJ3V0Zi04JylcbiAgY29uc3QgeWFtbCA9IHlhbWxMb2FkKGNvbnRlbnQpIGFzIGFueVxuXG4gIGNvbnN0IG1hY09TQW5kV2luZG93c1RhcmdldHMgPSBuZXcgU2V0KFtcbiAgICAneDg2XzY0LXBjLXdpbmRvd3MtbXN2YycsXG4gICAgJ3g4Nl82NC1wYy13aW5kb3dzLWdudScsXG4gICAgJ2FhcmNoNjQtcGMtd2luZG93cy1tc3ZjJyxcbiAgICAneDg2XzY0LWFwcGxlLWRhcndpbicsXG4gIF0pXG5cbiAgY29uc3QgbGludXhUYXJnZXRzID0gbmV3IFNldChbXG4gICAgJ3g4Nl82NC11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ3g4Nl82NC11bmtub3duLWxpbnV4LW11c2wnLFxuICAgICdhYXJjaDY0LXVua25vd24tbGludXgtZ251JyxcbiAgICAnYWFyY2g2NC11bmtub3duLWxpbnV4LW11c2wnLFxuICAgICdhcm12Ny11bmtub3duLWxpbnV4LWdudWVhYmloZicsXG4gICAgJ2FybXY3LXVua25vd24tbGludXgtbXVzbGVhYmloZicsXG4gICAgJ2xvb25nYXJjaDY0LXVua25vd24tbGludXgtZ251JyxcbiAgICAncmlzY3Y2NGdjLXVua25vd24tbGludXgtZ251JyxcbiAgICAncG93ZXJwYzY0bGUtdW5rbm93bi1saW51eC1nbnUnLFxuICAgICdzMzkweC11bmtub3duLWxpbnV4LWdudScsXG4gICAgJ2FhcmNoNjQtbGludXgtYW5kcm9pZCcsXG4gICAgJ2FybXY3LWxpbnV4LWFuZHJvaWRlYWJpJyxcbiAgXSlcblxuICAvLyBDaGVjayBpZiBhbnkgTGludXggdGFyZ2V0cyBhcmUgZW5hYmxlZFxuICBjb25zdCBoYXNMaW51eFRhcmdldHMgPSBlbmFibGVkVGFyZ2V0cy5zb21lKCh0YXJnZXQpID0+XG4gICAgbGludXhUYXJnZXRzLmhhcyh0YXJnZXQpLFxuICApXG5cbiAgLy8gRmlsdGVyIHRoZSBtYXRyaXggY29uZmlndXJhdGlvbnMgaW4gdGhlIGJ1aWxkIGpvYlxuICBpZiAoeWFtbD8uam9icz8uYnVpbGQ/LnN0cmF0ZWd5Py5tYXRyaXg/LnNldHRpbmdzKSB7XG4gICAgeWFtbC5qb2JzLmJ1aWxkLnN0cmF0ZWd5Lm1hdHJpeC5zZXR0aW5ncyA9XG4gICAgICB5YW1sLmpvYnMuYnVpbGQuc3RyYXRlZ3kubWF0cml4LnNldHRpbmdzLmZpbHRlcigoc2V0dGluZzogYW55KSA9PiB7XG4gICAgICAgIGlmIChzZXR0aW5nLnRhcmdldCkge1xuICAgICAgICAgIHJldHVybiBlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcyhzZXR0aW5nLnRhcmdldClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSlcbiAgfVxuXG4gIGNvbnN0IGpvYnNUb1JlbW92ZTogc3RyaW5nW10gPSBbXVxuXG4gIGlmIChlbmFibGVkVGFyZ2V0cy5ldmVyeSgodGFyZ2V0KSA9PiAhbWFjT1NBbmRXaW5kb3dzVGFyZ2V0cy5oYXModGFyZ2V0KSkpIHtcbiAgICBqb2JzVG9SZW1vdmUucHVzaCgndGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcnKVxuICB9IGVsc2Uge1xuICAgIC8vIEZpbHRlciB0aGUgbWF0cml4IGNvbmZpZ3VyYXRpb25zIGluIHRoZSB0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZyBqb2JcbiAgICBpZiAoXG4gICAgICB5YW1sPy5qb2JzPy5bJ3Rlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nJ10/LnN0cmF0ZWd5Py5tYXRyaXg/LnNldHRpbmdzXG4gICAgKSB7XG4gICAgICB5YW1sLmpvYnNbJ3Rlc3QtbWFjT1Mtd2luZG93cy1iaW5kaW5nJ10uc3RyYXRlZ3kubWF0cml4LnNldHRpbmdzID1cbiAgICAgICAgeWFtbC5qb2JzWyd0ZXN0LW1hY09TLXdpbmRvd3MtYmluZGluZyddLnN0cmF0ZWd5Lm1hdHJpeC5zZXR0aW5ncy5maWx0ZXIoXG4gICAgICAgICAgKHNldHRpbmc6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKHNldHRpbmcudGFyZ2V0KSB7XG4gICAgICAgICAgICAgIHJldHVybiBlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcyhzZXR0aW5nLnRhcmdldClcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgfSxcbiAgICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIC8vIElmIG5vIExpbnV4IHRhcmdldHMgYXJlIGVuYWJsZWQsIHJlbW92ZSBMaW51eC1zcGVjaWZpYyBqb2JzXG4gIGlmICghaGFzTGludXhUYXJnZXRzKSB7XG4gICAgLy8gUmVtb3ZlIHRlc3QtbGludXgtYmluZGluZyBqb2JcbiAgICBpZiAoeWFtbD8uam9icz8uWyd0ZXN0LWxpbnV4LWJpbmRpbmcnXSkge1xuICAgICAgam9ic1RvUmVtb3ZlLnB1c2goJ3Rlc3QtbGludXgtYmluZGluZycpXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIEZpbHRlciB0aGUgbWF0cml4IGNvbmZpZ3VyYXRpb25zIGluIHRoZSB0ZXN0LWxpbnV4LXg2NC1nbnUtYmluZGluZyBqb2JcbiAgICBpZiAoeWFtbD8uam9icz8uWyd0ZXN0LWxpbnV4LWJpbmRpbmcnXT8uc3RyYXRlZ3k/Lm1hdHJpeD8udGFyZ2V0KSB7XG4gICAgICB5YW1sLmpvYnNbJ3Rlc3QtbGludXgtYmluZGluZyddLnN0cmF0ZWd5Lm1hdHJpeC50YXJnZXQgPSB5YW1sLmpvYnNbXG4gICAgICAgICd0ZXN0LWxpbnV4LWJpbmRpbmcnXG4gICAgICBdLnN0cmF0ZWd5Lm1hdHJpeC50YXJnZXQuZmlsdGVyKCh0YXJnZXQ6IHN0cmluZykgPT4ge1xuICAgICAgICBpZiAodGFyZ2V0KSB7XG4gICAgICAgICAgcmV0dXJuIGVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKHRhcmdldClcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSlcbiAgICB9XG4gIH1cblxuICBpZiAoIWVuYWJsZWRUYXJnZXRzLmluY2x1ZGVzKCd3YXNtMzItd2FzaXAxLXRocmVhZHMnKSkge1xuICAgIGpvYnNUb1JlbW92ZS5wdXNoKCd0ZXN0LXdhc2knKVxuICB9XG5cbiAgaWYgKCFlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcygneDg2XzY0LXVua25vd24tZnJlZWJzZCcpKSB7XG4gICAgam9ic1RvUmVtb3ZlLnB1c2goJ2J1aWxkLWZyZWVic2QnKVxuICB9XG5cbiAgLy8gRmlsdGVyIG90aGVyIHRlc3Qgam9icyBiYXNlZCBvbiB0YXJnZXRcbiAgZm9yIChjb25zdCBbam9iTmFtZSwgam9iQ29uZmlnXSBvZiBPYmplY3QuZW50cmllcyh5YW1sLmpvYnMgfHwge30pKSB7XG4gICAgaWYgKFxuICAgICAgam9iTmFtZS5zdGFydHNXaXRoKCd0ZXN0LScpICYmXG4gICAgICBqb2JOYW1lICE9PSAndGVzdC1tYWNPUy13aW5kb3dzLWJpbmRpbmcnICYmXG4gICAgICBqb2JOYW1lICE9PSAndGVzdC1saW51eC14NjQtZ251LWJpbmRpbmcnXG4gICAgKSB7XG4gICAgICAvLyBFeHRyYWN0IHRhcmdldCBmcm9tIGpvYiBuYW1lIG9yIGNvbmZpZ1xuICAgICAgY29uc3Qgam9iID0gam9iQ29uZmlnIGFzIGFueVxuICAgICAgaWYgKGpvYi5zdHJhdGVneT8ubWF0cml4Py5zZXR0aW5ncz8uWzBdPy50YXJnZXQpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gam9iLnN0cmF0ZWd5Lm1hdHJpeC5zZXR0aW5nc1swXS50YXJnZXRcbiAgICAgICAgaWYgKCFlbmFibGVkVGFyZ2V0cy5pbmNsdWRlcyh0YXJnZXQpKSB7XG4gICAgICAgICAgam9ic1RvUmVtb3ZlLnB1c2goam9iTmFtZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFJlbW92ZSBqb2JzIGZvciBkaXNhYmxlZCB0YXJnZXRzXG4gIGZvciAoY29uc3Qgam9iTmFtZSBvZiBqb2JzVG9SZW1vdmUpIHtcbiAgICBkZWxldGUgeWFtbC5qb2JzW2pvYk5hbWVdXG4gIH1cblxuICBpZiAoQXJyYXkuaXNBcnJheSh5YW1sLmpvYnM/LnB1Ymxpc2g/Lm5lZWRzKSkge1xuICAgIHlhbWwuam9icy5wdWJsaXNoLm5lZWRzID0geWFtbC5qb2JzLnB1Ymxpc2gubmVlZHMuZmlsdGVyKFxuICAgICAgKG5lZWQ6IHN0cmluZykgPT4gIWpvYnNUb1JlbW92ZS5pbmNsdWRlcyhuZWVkKSxcbiAgICApXG4gIH1cblxuICAvLyBXcml0ZSBiYWNrIHRoZSBmaWx0ZXJlZCBZQU1MXG4gIGNvbnN0IHVwZGF0ZWRZYW1sID0geWFtbER1bXAoeWFtbCwge1xuICAgIGxpbmVXaWR0aDogLTEsXG4gICAgbm9SZWZzOiB0cnVlLFxuICAgIHNvcnRLZXlzOiBmYWxzZSxcbiAgfSlcbiAgYXdhaXQgZnMud3JpdGVGaWxlKGZpbGVQYXRoLCB1cGRhdGVkWWFtbClcbn1cblxuZnVuY3Rpb24gcHJvY2Vzc09wdGlvbnMob3B0aW9uczogUmF3TmV3T3B0aW9ucykge1xuICBkZWJ1ZygnUHJvY2Vzc2luZyBvcHRpb25zLi4uJylcbiAgaWYgKCFvcHRpb25zLnBhdGgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBwcm92aWRlIHRoZSBwYXRoIGFzIHRoZSBhcmd1bWVudCcpXG4gIH1cbiAgb3B0aW9ucy5wYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMucGF0aClcbiAgZGVidWcoYFJlc29sdmVkIHRhcmdldCBwYXRoIHRvOiAke29wdGlvbnMucGF0aH1gKVxuXG4gIGlmICghb3B0aW9ucy5uYW1lKSB7XG4gICAgb3B0aW9ucy5uYW1lID0gcGF0aC5wYXJzZShvcHRpb25zLnBhdGgpLmJhc2VcbiAgICBkZWJ1ZyhgTm8gcHJvamVjdCBuYW1lIHByb3ZpZGVkLCBmaXggaXQgdG8gZGlyIG5hbWU6ICR7b3B0aW9ucy5uYW1lfWApXG4gIH1cblxuICBpZiAoIW9wdGlvbnMudGFyZ2V0cz8ubGVuZ3RoKSB7XG4gICAgaWYgKG9wdGlvbnMuZW5hYmxlQWxsVGFyZ2V0cykge1xuICAgICAgb3B0aW9ucy50YXJnZXRzID0gQVZBSUxBQkxFX1RBUkdFVFMuY29uY2F0KClcbiAgICAgIGRlYnVnKCdFbmFibGUgYWxsIHRhcmdldHMnKVxuICAgIH0gZWxzZSBpZiAob3B0aW9ucy5lbmFibGVEZWZhdWx0VGFyZ2V0cykge1xuICAgICAgb3B0aW9ucy50YXJnZXRzID0gREVGQVVMVF9UQVJHRVRTLmNvbmNhdCgpXG4gICAgICBkZWJ1ZygnRW5hYmxlIGRlZmF1bHQgdGFyZ2V0cycpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQXQgbGVhc3Qgb25lIHRhcmdldCBtdXN0IGJlIGVuYWJsZWQnKVxuICAgIH1cbiAgfVxuICBpZiAoXG4gICAgb3B0aW9ucy50YXJnZXRzLnNvbWUoKHRhcmdldCkgPT4gdGFyZ2V0ID09PSAnd2FzbTMyLXdhc2ktcHJldmlldzEtdGhyZWFkcycpXG4gICkge1xuICAgIGNvbnN0IG91dCA9IGV4ZWNTeW5jKGBydXN0dXAgdGFyZ2V0IGxpc3RgLCB7XG4gICAgICBlbmNvZGluZzogJ3V0ZjgnLFxuICAgIH0pXG4gICAgaWYgKG91dC5pbmNsdWRlcygnd2FzbTMyLXdhc2lwMS10aHJlYWRzJykpIHtcbiAgICAgIG9wdGlvbnMudGFyZ2V0cyA9IG9wdGlvbnMudGFyZ2V0cy5tYXAoKHRhcmdldCkgPT5cbiAgICAgICAgdGFyZ2V0ID09PSAnd2FzbTMyLXdhc2ktcHJldmlldzEtdGhyZWFkcydcbiAgICAgICAgICA/ICd3YXNtMzItd2FzaXAxLXRocmVhZHMnXG4gICAgICAgICAgOiB0YXJnZXQsXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGFwcGx5RGVmYXVsdE5ld09wdGlvbnMob3B0aW9ucykgYXMgTmV3T3B0aW9uc1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbmV3UHJvamVjdCh1c2VyT3B0aW9uczogUmF3TmV3T3B0aW9ucykge1xuICBkZWJ1ZygnV2lsbCBjcmVhdGUgbmFwaS1ycyBwcm9qZWN0IHdpdGggZ2l2ZW4gb3B0aW9uczonKVxuICBkZWJ1Zyh1c2VyT3B0aW9ucylcblxuICBjb25zdCBvcHRpb25zID0gcHJvY2Vzc09wdGlvbnModXNlck9wdGlvbnMpXG5cbiAgZGVidWcoJ1RhcmdldHMgdG8gYmUgZW5hYmxlZDonKVxuICBkZWJ1ZyhvcHRpb25zLnRhcmdldHMpXG5cbiAgLy8gQ2hlY2sgaWYgZ2l0IGlzIGF2YWlsYWJsZVxuICBpZiAoIShhd2FpdCBjaGVja0dpdENvbW1hbmQoKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnR2l0IGlzIG5vdCBpbnN0YWxsZWQgb3Igbm90IGF2YWlsYWJsZSBpbiBQQVRILiBQbGVhc2UgaW5zdGFsbCBHaXQgdG8gY29udGludWUuJyxcbiAgICApXG4gIH1cblxuICBjb25zdCBwYWNrYWdlTWFuYWdlciA9IG9wdGlvbnMucGFja2FnZU1hbmFnZXIgYXMgU3VwcG9ydGVkUGFja2FnZU1hbmFnZXJcblxuICAvLyBFbnN1cmUgdGFyZ2V0IGRpcmVjdG9yeSBleGlzdHMgYW5kIGlzIGVtcHR5XG4gIGF3YWl0IGVuc3VyZVBhdGgob3B0aW9ucy5wYXRoLCBvcHRpb25zLmRyeVJ1bilcblxuICBpZiAoIW9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIERvd25sb2FkIG9yIHVwZGF0ZSB0ZW1wbGF0ZVxuICAgICAgY29uc3QgY2FjaGVEaXIgPSBhd2FpdCBlbnN1cmVDYWNoZURpcihwYWNrYWdlTWFuYWdlcilcbiAgICAgIGF3YWl0IGRvd25sb2FkVGVtcGxhdGUocGFja2FnZU1hbmFnZXIsIGNhY2hlRGlyKVxuXG4gICAgICAvLyBDb3B5IHRlbXBsYXRlIGZpbGVzIHRvIHRhcmdldCBkaXJlY3RvcnlcbiAgICAgIGNvbnN0IHRlbXBsYXRlUGF0aCA9IHBhdGguam9pbihjYWNoZURpciwgJ3JlcG8nKVxuICAgICAgYXdhaXQgY29weURpcmVjdG9yeShcbiAgICAgICAgdGVtcGxhdGVQYXRoLFxuICAgICAgICBvcHRpb25zLnBhdGgsXG4gICAgICAgIG9wdGlvbnMudGFyZ2V0cy5pbmNsdWRlcygnd2FzbTMyLXdhc2lwMS10aHJlYWRzJyksXG4gICAgICApXG5cbiAgICAgIC8vIFJlbmFtZSBwcm9qZWN0IHVzaW5nIHRoZSByZW5hbWUgQVBJXG4gICAgICBhd2FpdCByZW5hbWVQcm9qZWN0KHtcbiAgICAgICAgY3dkOiBvcHRpb25zLnBhdGgsXG4gICAgICAgIG5hbWU6IG9wdGlvbnMubmFtZSxcbiAgICAgICAgYmluYXJ5TmFtZTogZ2V0QmluYXJ5TmFtZShvcHRpb25zLm5hbWUpLFxuICAgICAgfSlcblxuICAgICAgLy8gRmlsdGVyIHRhcmdldHMgaW4gcGFja2FnZS5qc29uXG4gICAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSBwYXRoLmpvaW4ob3B0aW9ucy5wYXRoLCAncGFja2FnZS5qc29uJylcbiAgICAgIGlmIChleGlzdHNTeW5jKHBhY2thZ2VKc29uUGF0aCkpIHtcbiAgICAgICAgYXdhaXQgZmlsdGVyVGFyZ2V0c0luUGFja2FnZUpzb24ocGFja2FnZUpzb25QYXRoLCBvcHRpb25zLnRhcmdldHMpXG4gICAgICB9XG5cbiAgICAgIC8vIEZpbHRlciB0YXJnZXRzIGluIEdpdEh1YiBBY3Rpb25zIENJXG4gICAgICBjb25zdCBjaVBhdGggPSBwYXRoLmpvaW4ob3B0aW9ucy5wYXRoLCAnLmdpdGh1YicsICd3b3JrZmxvd3MnLCAnQ0kueW1sJylcbiAgICAgIGlmIChleGlzdHNTeW5jKGNpUGF0aCkgJiYgb3B0aW9ucy5lbmFibGVHaXRodWJBY3Rpb25zKSB7XG4gICAgICAgIGF3YWl0IGZpbHRlclRhcmdldHNJbkdpdGh1YkFjdGlvbnMoY2lQYXRoLCBvcHRpb25zLnRhcmdldHMpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAhb3B0aW9ucy5lbmFibGVHaXRodWJBY3Rpb25zICYmXG4gICAgICAgIGV4aXN0c1N5bmMocGF0aC5qb2luKG9wdGlvbnMucGF0aCwgJy5naXRodWInKSlcbiAgICAgICkge1xuICAgICAgICAvLyBSZW1vdmUgLmdpdGh1YiBkaXJlY3RvcnkgaWYgR2l0SHViIEFjdGlvbnMgaXMgbm90IGVuYWJsZWRcbiAgICAgICAgYXdhaXQgZnMucm0ocGF0aC5qb2luKG9wdGlvbnMucGF0aCwgJy5naXRodWInKSwge1xuICAgICAgICAgIHJlY3Vyc2l2ZTogdHJ1ZSxcbiAgICAgICAgICBmb3JjZTogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgIH1cblxuICAgICAgLy8gVXBkYXRlIHBhY2thZ2UuanNvbiB3aXRoIGFkZGl0aW9uYWwgY29uZmlndXJhdGlvbnNcbiAgICAgIGNvbnN0IHBrZ0pzb25Db250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUocGFja2FnZUpzb25QYXRoLCAndXRmLTgnKVxuICAgICAgY29uc3QgcGtnSnNvbiA9IEpTT04ucGFyc2UocGtnSnNvbkNvbnRlbnQpXG5cbiAgICAgIC8vIFVwZGF0ZSBlbmdpbmUgcmVxdWlyZW1lbnRcbiAgICAgIGlmICghcGtnSnNvbi5lbmdpbmVzKSB7XG4gICAgICAgIHBrZ0pzb24uZW5naW5lcyA9IHt9XG4gICAgICB9XG4gICAgICBwa2dKc29uLmVuZ2luZXMubm9kZSA9IG5hcGlFbmdpbmVSZXF1aXJlbWVudChvcHRpb25zLm1pbk5vZGVBcGlWZXJzaW9uKVxuXG4gICAgICAvLyBVcGRhdGUgbGljZW5zZSBpZiBkaWZmZXJlbnQgZnJvbSB0ZW1wbGF0ZVxuICAgICAgaWYgKG9wdGlvbnMubGljZW5zZSAmJiBwa2dKc29uLmxpY2Vuc2UgIT09IG9wdGlvbnMubGljZW5zZSkge1xuICAgICAgICBwa2dKc29uLmxpY2Vuc2UgPSBvcHRpb25zLmxpY2Vuc2VcbiAgICAgIH1cblxuICAgICAgLy8gVXBkYXRlIHRlc3QgZnJhbWV3b3JrIGlmIG5lZWRlZFxuICAgICAgaWYgKG9wdGlvbnMudGVzdEZyYW1ld29yayAhPT0gJ2F2YScpIHtcbiAgICAgICAgLy8gVGhpcyB3b3VsZCByZXF1aXJlIG1vcmUgY29tcGxleCBsb2dpYyB0byB1cGRhdGUgdGVzdCBzY3JpcHRzIGFuZCBkZXBlbmRlbmNpZXNcbiAgICAgICAgZGVidWcoXG4gICAgICAgICAgYFRlc3QgZnJhbWV3b3JrICR7b3B0aW9ucy50ZXN0RnJhbWV3b3JrfSByZXF1ZXN0ZWQgYnV0IG5vdCB5ZXQgaW1wbGVtZW50ZWRgLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShcbiAgICAgICAgcGFja2FnZUpzb25QYXRoLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShwa2dKc29uLCBudWxsLCAyKSArICdcXG4nLFxuICAgICAgKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgcHJvamVjdDogJHtlcnJvcn1gKVxuICAgIH1cbiAgfVxuXG4gIGRlYnVnKGBQcm9qZWN0IGNyZWF0ZWQgYXQ6ICR7b3B0aW9ucy5wYXRofWApXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZVBhdGgocGF0aDogc3RyaW5nLCBkcnlSdW4gPSBmYWxzZSkge1xuICBjb25zdCBzdGF0ID0gYXdhaXQgc3RhdEFzeW5jKHBhdGgsIHt9KS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpXG5cbiAgLy8gZmlsZSBkZXNjcmlwdG9yIGV4aXN0c1xuICBpZiAoc3RhdCkge1xuICAgIGlmIChzdGF0LmlzRmlsZSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBQYXRoICR7cGF0aH0gZm9yIGNyZWF0aW5nIG5ldyBuYXBpLXJzIHByb2plY3QgYWxyZWFkeSBleGlzdHMgYW5kIGl0J3Mgbm90IGEgZGlyZWN0b3J5LmAsXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgcmVhZGRpckFzeW5jKHBhdGgpXG4gICAgICBpZiAoZmlsZXMubGVuZ3RoKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBgUGF0aCAke3BhdGh9IGZvciBjcmVhdGluZyBuZXcgbmFwaS1ycyBwcm9qZWN0IGFscmVhZHkgZXhpc3RzIGFuZCBpdCdzIG5vdCBlbXB0eS5gLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgaWYgKCFkcnlSdW4pIHtcbiAgICB0cnkge1xuICAgICAgZGVidWcoYFRyeSB0byBjcmVhdGUgdGFyZ2V0IGRpcmVjdG9yeTogJHtwYXRofWApXG4gICAgICBpZiAoIWRyeVJ1bikge1xuICAgICAgICBhd2FpdCBta2RpckFzeW5jKHBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIHRhcmdldCBkaXJlY3Rvcnk6ICR7cGF0aH1gLCB7XG4gICAgICAgIGNhdXNlOiBlLFxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0QmluYXJ5TmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gbmFtZS5zcGxpdCgnLycpLnBvcCgpIVxufVxuXG5leHBvcnQgdHlwZSB7IE5ld09wdGlvbnMgfVxuIiwiLy8gVGhpcyBmaWxlIGlzIGdlbmVyYXRlZCBieSBjb2RlZ2VuL2luZGV4LnRzXG4vLyBEbyBub3QgZWRpdCB0aGlzIGZpbGUgbWFudWFsbHlcbmltcG9ydCB7IENvbW1hbmQsIE9wdGlvbiB9IGZyb20gJ2NsaXBhbmlvbidcblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEJhc2VQcmVQdWJsaXNoQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWydwcmUtcHVibGlzaCddLCBbJ3ByZXB1Ymxpc2gnXV1cblxuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdVcGRhdGUgcGFja2FnZS5qc29uIGFuZCBjb3B5IGFkZG9ucyBpbnRvIHBlciBwbGF0Zm9ybSBwYWNrYWdlcycsXG4gIH0pXG5cbiAgY3dkID0gT3B0aW9uLlN0cmluZygnLS1jd2QnLCBwcm9jZXNzLmN3ZCgpLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aCA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCAncGFja2FnZS5qc29uJywge1xuICAgIGRlc2NyaXB0aW9uOiAnUGF0aCB0byBgcGFja2FnZS5qc29uYCcsXG4gIH0pXG5cbiAgbnBtRGlyID0gT3B0aW9uLlN0cmluZygnLS1ucG0tZGlyLC1wJywgJ25wbScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gdGhlIGZvbGRlciB3aGVyZSB0aGUgbnBtIHBhY2thZ2VzIHB1dCcsXG4gIH0pXG5cbiAgdGFnU3R5bGUgPSBPcHRpb24uU3RyaW5nKCctLXRhZy1zdHlsZSwtLXRhZ3N0eWxlLC10JywgJ2xlcm5hJywge1xuICAgIGRlc2NyaXB0aW9uOiAnZ2l0IHRhZyBzdHlsZSwgYG5wbWAgb3IgYGxlcm5hYCcsXG4gIH0pXG5cbiAgZ2hSZWxlYXNlID0gT3B0aW9uLkJvb2xlYW4oJy0tZ2gtcmVsZWFzZScsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgY3JlYXRlIEdpdEh1YiByZWxlYXNlJyxcbiAgfSlcblxuICBnaFJlbGVhc2VOYW1lPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1naC1yZWxlYXNlLW5hbWUnLCB7XG4gICAgZGVzY3JpcHRpb246ICdHaXRIdWIgcmVsZWFzZSBuYW1lJyxcbiAgfSlcblxuICBnaFJlbGVhc2VJZD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tZ2gtcmVsZWFzZS1pZCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0V4aXN0aW5nIEdpdEh1YiByZWxlYXNlIGlkJyxcbiAgfSlcblxuICBza2lwT3B0aW9uYWxQdWJsaXNoID0gT3B0aW9uLkJvb2xlYW4oJy0tc2tpcC1vcHRpb25hbC1wdWJsaXNoJywgZmFsc2UsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgc2tpcCBvcHRpb25hbERlcGVuZGVuY2llcyBwYWNrYWdlcyBwdWJsaXNoJyxcbiAgfSlcblxuICBkcnlSdW4gPSBPcHRpb24uQm9vbGVhbignLS1kcnktcnVuJywgZmFsc2UsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0RyeSBydW4gd2l0aG91dCB0b3VjaGluZyBmaWxlIHN5c3RlbScsXG4gIH0pXG5cbiAgZ2V0T3B0aW9ucygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgY3dkOiB0aGlzLmN3ZCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICBucG1EaXI6IHRoaXMubnBtRGlyLFxuICAgICAgdGFnU3R5bGU6IHRoaXMudGFnU3R5bGUsXG4gICAgICBnaFJlbGVhc2U6IHRoaXMuZ2hSZWxlYXNlLFxuICAgICAgZ2hSZWxlYXNlTmFtZTogdGhpcy5naFJlbGVhc2VOYW1lLFxuICAgICAgZ2hSZWxlYXNlSWQ6IHRoaXMuZ2hSZWxlYXNlSWQsXG4gICAgICBza2lwT3B0aW9uYWxQdWJsaXNoOiB0aGlzLnNraXBPcHRpb25hbFB1Ymxpc2gsXG4gICAgICBkcnlSdW46IHRoaXMuZHJ5UnVuLFxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFVwZGF0ZSBwYWNrYWdlLmpzb24gYW5kIGNvcHkgYWRkb25zIGludG8gcGVyIHBsYXRmb3JtIHBhY2thZ2VzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJlUHVibGlzaE9wdGlvbnMge1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqXG4gICAqIEBkZWZhdWx0IHByb2Nlc3MuY3dkKClcbiAgICovXG4gIGN3ZD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgbmFwaWAgY29uZmlnIGpzb24gZmlsZVxuICAgKi9cbiAgY29uZmlnUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byBgcGFja2FnZS5qc29uYFxuICAgKlxuICAgKiBAZGVmYXVsdCAncGFja2FnZS5qc29uJ1xuICAgKi9cbiAgcGFja2FnZUpzb25QYXRoPzogc3RyaW5nXG4gIC8qKlxuICAgKiBQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXRcbiAgICpcbiAgICogQGRlZmF1bHQgJ25wbSdcbiAgICovXG4gIG5wbURpcj86IHN0cmluZ1xuICAvKipcbiAgICogZ2l0IHRhZyBzdHlsZSwgYG5wbWAgb3IgYGxlcm5hYFxuICAgKlxuICAgKiBAZGVmYXVsdCAnbGVybmEnXG4gICAqL1xuICB0YWdTdHlsZT86ICducG0nIHwgJ2xlcm5hJ1xuICAvKipcbiAgICogV2hldGhlciBjcmVhdGUgR2l0SHViIHJlbGVhc2VcbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgZ2hSZWxlYXNlPzogYm9vbGVhblxuICAvKipcbiAgICogR2l0SHViIHJlbGVhc2UgbmFtZVxuICAgKi9cbiAgZ2hSZWxlYXNlTmFtZT86IHN0cmluZ1xuICAvKipcbiAgICogRXhpc3RpbmcgR2l0SHViIHJlbGVhc2UgaWRcbiAgICovXG4gIGdoUmVsZWFzZUlkPzogc3RyaW5nXG4gIC8qKlxuICAgKiBXaGV0aGVyIHNraXAgb3B0aW9uYWxEZXBlbmRlbmNpZXMgcGFja2FnZXMgcHVibGlzaFxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgc2tpcE9wdGlvbmFsUHVibGlzaD86IGJvb2xlYW5cbiAgLyoqXG4gICAqIERyeSBydW4gd2l0aG91dCB0b3VjaGluZyBmaWxlIHN5c3RlbVxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgZHJ5UnVuPzogYm9vbGVhblxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0UHJlUHVibGlzaE9wdGlvbnMob3B0aW9uczogUHJlUHVibGlzaE9wdGlvbnMpIHtcbiAgcmV0dXJuIHtcbiAgICBjd2Q6IHByb2Nlc3MuY3dkKCksXG4gICAgcGFja2FnZUpzb25QYXRoOiAncGFja2FnZS5qc29uJyxcbiAgICBucG1EaXI6ICducG0nLFxuICAgIHRhZ1N0eWxlOiAnbGVybmEnLFxuICAgIGdoUmVsZWFzZTogdHJ1ZSxcbiAgICBza2lwT3B0aW9uYWxQdWJsaXNoOiBmYWxzZSxcbiAgICBkcnlSdW46IGZhbHNlLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsIi8vIFRoaXMgZmlsZSBpcyBnZW5lcmF0ZWQgYnkgY29kZWdlbi9pbmRleC50c1xuLy8gRG8gbm90IGVkaXQgdGhpcyBmaWxlIG1hbnVhbGx5XG5pbXBvcnQgeyBDb21tYW5kLCBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBCYXNlVmVyc2lvbkNvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1sndmVyc2lvbiddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnVXBkYXRlIHZlcnNpb24gaW4gY3JlYXRlZCBucG0gcGFja2FnZXMnLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG5wbURpciA9IE9wdGlvbi5TdHJpbmcoJy0tbnBtLWRpcicsICducG0nLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgdGhlIG5wbSBwYWNrYWdlcyBwdXQnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgbnBtRGlyOiB0aGlzLm5wbURpcixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBVcGRhdGUgdmVyc2lvbiBpbiBjcmVhdGVkIG5wbSBwYWNrYWdlc1xuICovXG5leHBvcnQgaW50ZXJmYWNlIFZlcnNpb25PcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIHRoZSBucG0gcGFja2FnZXMgcHV0XG4gICAqXG4gICAqIEBkZWZhdWx0ICducG0nXG4gICAqL1xuICBucG1EaXI/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5RGVmYXVsdFZlcnNpb25PcHRpb25zKG9wdGlvbnM6IFZlcnNpb25PcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgbnBtRGlyOiAnbnBtJyxcbiAgICAuLi5vcHRpb25zLFxuICB9XG59XG4iLCJpbXBvcnQgeyBqb2luLCByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuXG5pbXBvcnQge1xuICBhcHBseURlZmF1bHRWZXJzaW9uT3B0aW9ucyxcbiAgdHlwZSBWZXJzaW9uT3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL3ZlcnNpb24uanMnXG5pbXBvcnQge1xuICByZWFkTmFwaUNvbmZpZyxcbiAgZGVidWdGYWN0b3J5LFxuICB1cGRhdGVQYWNrYWdlSnNvbixcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCd2ZXJzaW9uJylcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcnNpb24odXNlck9wdGlvbnM6IFZlcnNpb25PcHRpb25zKSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhcHBseURlZmF1bHRWZXJzaW9uT3B0aW9ucyh1c2VyT3B0aW9ucylcbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG5cbiAgY29uc3QgY29uZmlnID0gYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgcGFja2FnZUpzb25QYXRoLFxuICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gIClcblxuICBmb3IgKGNvbnN0IHRhcmdldCBvZiBjb25maWcudGFyZ2V0cykge1xuICAgIGNvbnN0IHBrZ0RpciA9IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMubnBtRGlyLCB0YXJnZXQucGxhdGZvcm1BcmNoQUJJKVxuXG4gICAgZGVidWcoYFVwZGF0ZSB2ZXJzaW9uIHRvICVpIGluIFslaV1gLCBjb25maWcucGFja2FnZUpzb24udmVyc2lvbiwgcGtnRGlyKVxuICAgIGF3YWl0IHVwZGF0ZVBhY2thZ2VKc29uKGpvaW4ocGtnRGlyLCAncGFja2FnZS5qc29uJyksIHtcbiAgICAgIHZlcnNpb246IGNvbmZpZy5wYWNrYWdlSnNvbi52ZXJzaW9uLFxuICAgIH0pXG4gIH1cbn1cbiIsImltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuaW1wb3J0IHsgZXhpc3RzU3luYywgc3RhdFN5bmMgfSBmcm9tICdub2RlOmZzJ1xuaW1wb3J0IHsgam9pbiwgcmVzb2x2ZSB9IGZyb20gJ25vZGU6cGF0aCdcblxuaW1wb3J0IHsgT2N0b2tpdCB9IGZyb20gJ0BvY3Rva2l0L3Jlc3QnXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdFByZVB1Ymxpc2hPcHRpb25zLFxuICB0eXBlIFByZVB1Ymxpc2hPcHRpb25zLFxufSBmcm9tICcuLi9kZWYvcHJlLXB1Ymxpc2guanMnXG5pbXBvcnQge1xuICByZWFkRmlsZUFzeW5jLFxuICByZWFkTmFwaUNvbmZpZyxcbiAgZGVidWdGYWN0b3J5LFxuICB1cGRhdGVQYWNrYWdlSnNvbixcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5cbmltcG9ydCB7IHZlcnNpb24gfSBmcm9tICcuL3ZlcnNpb24uanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCdwcmUtcHVibGlzaCcpXG5cbmludGVyZmFjZSBQYWNrYWdlSW5mbyB7XG4gIG5hbWU6IHN0cmluZ1xuICB2ZXJzaW9uOiBzdHJpbmdcbiAgdGFnOiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHByZVB1Ymxpc2godXNlck9wdGlvbnM6IFByZVB1Ymxpc2hPcHRpb25zKSB7XG4gIGRlYnVnKCdSZWNlaXZlIHByZS1wdWJsaXNoIG9wdGlvbnM6JylcbiAgZGVidWcoJyAgJU8nLCB1c2VyT3B0aW9ucylcblxuICBjb25zdCBvcHRpb25zID0gYXBwbHlEZWZhdWx0UHJlUHVibGlzaE9wdGlvbnModXNlck9wdGlvbnMpXG5cbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcmVzb2x2ZShvcHRpb25zLmN3ZCwgb3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG5cbiAgY29uc3QgeyBwYWNrYWdlSnNvbiwgdGFyZ2V0cywgcGFja2FnZU5hbWUsIGJpbmFyeU5hbWUsIG5wbUNsaWVudCB9ID1cbiAgICBhd2FpdCByZWFkTmFwaUNvbmZpZyhcbiAgICAgIHBhY2thZ2VKc29uUGF0aCxcbiAgICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gICAgKVxuXG4gIGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUdoUmVsZWFzZShwYWNrYWdlTmFtZTogc3RyaW5nLCB2ZXJzaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoIW9wdGlvbnMuZ2hSZWxlYXNlKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvd25lcjogbnVsbCxcbiAgICAgICAgcmVwbzogbnVsbCxcbiAgICAgICAgcGtnSW5mbzogeyBuYW1lOiBudWxsLCB2ZXJzaW9uOiBudWxsLCB0YWc6IG51bGwgfSxcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgeyByZXBvLCBvd25lciwgcGtnSW5mbywgb2N0b2tpdCB9ID0gZ2V0UmVwb0luZm8ocGFja2FnZU5hbWUsIHZlcnNpb24pXG5cbiAgICBpZiAoIXJlcG8gfHwgIW93bmVyKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvd25lcjogbnVsbCxcbiAgICAgICAgcmVwbzogbnVsbCxcbiAgICAgICAgcGtnSW5mbzogeyBuYW1lOiBudWxsLCB2ZXJzaW9uOiBudWxsLCB0YWc6IG51bGwgfSxcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW9wdGlvbnMuZHJ5UnVuKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBvY3Rva2l0LnJlcG9zLmNyZWF0ZVJlbGVhc2Uoe1xuICAgICAgICAgIG93bmVyLFxuICAgICAgICAgIHJlcG8sXG4gICAgICAgICAgdGFnX25hbWU6IHBrZ0luZm8udGFnLFxuICAgICAgICAgIG5hbWU6IG9wdGlvbnMuZ2hSZWxlYXNlTmFtZSxcbiAgICAgICAgICBwcmVyZWxlYXNlOlxuICAgICAgICAgICAgdmVyc2lvbi5pbmNsdWRlcygnYWxwaGEnKSB8fFxuICAgICAgICAgICAgdmVyc2lvbi5pbmNsdWRlcygnYmV0YScpIHx8XG4gICAgICAgICAgICB2ZXJzaW9uLmluY2x1ZGVzKCdyYycpLFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBkZWJ1ZyhcbiAgICAgICAgICBgUGFyYW1zOiAke0pTT04uc3RyaW5naWZ5KFxuICAgICAgICAgICAgeyBvd25lciwgcmVwbywgdGFnX25hbWU6IHBrZ0luZm8udGFnIH0sXG4gICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgMixcbiAgICAgICAgICApfWAsXG4gICAgICAgIClcbiAgICAgICAgY29uc29sZS5lcnJvcihlKVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBvd25lciwgcmVwbywgcGtnSW5mbywgb2N0b2tpdCB9XG4gIH1cblxuICBmdW5jdGlvbiBnZXRSZXBvSW5mbyhwYWNrYWdlTmFtZTogc3RyaW5nLCB2ZXJzaW9uOiBzdHJpbmcpIHtcbiAgICBjb25zdCBoZWFkQ29tbWl0ID0gZXhlY1N5bmMoJ2dpdCBsb2cgLTEgLS1wcmV0dHk9JUInLCB7XG4gICAgICBlbmNvZGluZzogJ3V0Zi04JyxcbiAgICB9KS50cmltKClcblxuICAgIGNvbnN0IHsgR0lUSFVCX1JFUE9TSVRPUlkgfSA9IHByb2Nlc3MuZW52XG4gICAgaWYgKCFHSVRIVUJfUkVQT1NJVE9SWSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb3duZXI6IG51bGwsXG4gICAgICAgIHJlcG86IG51bGwsXG4gICAgICAgIHBrZ0luZm86IHsgbmFtZTogbnVsbCwgdmVyc2lvbjogbnVsbCwgdGFnOiBudWxsIH0sXG4gICAgICB9XG4gICAgfVxuICAgIGRlYnVnKGBHaXRodWIgcmVwb3NpdG9yeTogJHtHSVRIVUJfUkVQT1NJVE9SWX1gKVxuICAgIGNvbnN0IFtvd25lciwgcmVwb10gPSBHSVRIVUJfUkVQT1NJVE9SWS5zcGxpdCgnLycpXG4gICAgY29uc3Qgb2N0b2tpdCA9IG5ldyBPY3Rva2l0KHtcbiAgICAgIGF1dGg6IHByb2Nlc3MuZW52LkdJVEhVQl9UT0tFTixcbiAgICB9KVxuICAgIGxldCBwa2dJbmZvOiBQYWNrYWdlSW5mbyB8IHVuZGVmaW5lZFxuICAgIGlmIChvcHRpb25zLnRhZ1N0eWxlID09PSAnbGVybmEnKSB7XG4gICAgICBjb25zdCBwYWNrYWdlc1RvUHVibGlzaCA9IGhlYWRDb21taXRcbiAgICAgICAgLnNwbGl0KCdcXG4nKVxuICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgICAgLmZpbHRlcigobGluZSwgaW5kZXgpID0+IGxpbmUubGVuZ3RoICYmIGluZGV4KVxuICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnN1YnN0cmluZygyKSlcbiAgICAgICAgLm1hcChwYXJzZVRhZylcblxuICAgICAgcGtnSW5mbyA9IHBhY2thZ2VzVG9QdWJsaXNoLmZpbmQoXG4gICAgICAgIChwa2dJbmZvKSA9PiBwa2dJbmZvLm5hbWUgPT09IHBhY2thZ2VOYW1lLFxuICAgICAgKVxuXG4gICAgICBpZiAoIXBrZ0luZm8pIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICBgTm8gcmVsZWFzZSBjb21taXQgZm91bmQgd2l0aCAke3BhY2thZ2VOYW1lfSwgb3JpZ2luYWwgY29tbWl0IGluZm86ICR7aGVhZENvbW1pdH1gLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHBrZ0luZm8gPSB7XG4gICAgICAgIHRhZzogYHYke3ZlcnNpb259YCxcbiAgICAgICAgdmVyc2lvbixcbiAgICAgICAgbmFtZTogcGFja2FnZU5hbWUsXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IG93bmVyLCByZXBvLCBwa2dJbmZvLCBvY3Rva2l0IH1cbiAgfVxuXG4gIGlmICghb3B0aW9ucy5kcnlSdW4pIHtcbiAgICBhd2FpdCB2ZXJzaW9uKHVzZXJPcHRpb25zKVxuICAgIGF3YWl0IHVwZGF0ZVBhY2thZ2VKc29uKHBhY2thZ2VKc29uUGF0aCwge1xuICAgICAgb3B0aW9uYWxEZXBlbmRlbmNpZXM6IHRhcmdldHMucmVkdWNlKFxuICAgICAgICAoZGVwcywgdGFyZ2V0KSA9PiB7XG4gICAgICAgICAgZGVwc1tgJHtwYWNrYWdlTmFtZX0tJHt0YXJnZXQucGxhdGZvcm1BcmNoQUJJfWBdID0gcGFja2FnZUpzb24udmVyc2lvblxuXG4gICAgICAgICAgcmV0dXJuIGRlcHNcbiAgICAgICAgfSxcbiAgICAgICAge30gYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICksXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IHsgb3duZXIsIHJlcG8sIHBrZ0luZm8sIG9jdG9raXQgfSA9IG9wdGlvbnMuZ2hSZWxlYXNlSWRcbiAgICA/IGdldFJlcG9JbmZvKHBhY2thZ2VOYW1lLCBwYWNrYWdlSnNvbi52ZXJzaW9uKVxuICAgIDogYXdhaXQgY3JlYXRlR2hSZWxlYXNlKHBhY2thZ2VOYW1lLCBwYWNrYWdlSnNvbi52ZXJzaW9uKVxuXG4gIGZvciAoY29uc3QgdGFyZ2V0IG9mIHRhcmdldHMpIHtcbiAgICBjb25zdCBwa2dEaXIgPSByZXNvbHZlKFxuICAgICAgb3B0aW9ucy5jd2QsXG4gICAgICBvcHRpb25zLm5wbURpcixcbiAgICAgIGAke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9YCxcbiAgICApXG4gICAgY29uc3QgZXh0ID1cbiAgICAgIHRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dhc2knIHx8IHRhcmdldC5wbGF0Zm9ybSA9PT0gJ3dhc20nID8gJ3dhc20nIDogJ25vZGUnXG4gICAgY29uc3QgZmlsZW5hbWUgPSBgJHtiaW5hcnlOYW1lfS4ke3RhcmdldC5wbGF0Zm9ybUFyY2hBQkl9LiR7ZXh0fWBcbiAgICBjb25zdCBkc3RQYXRoID0gam9pbihwa2dEaXIsIGZpbGVuYW1lKVxuXG4gICAgaWYgKCFvcHRpb25zLmRyeVJ1bikge1xuICAgICAgaWYgKCFleGlzdHNTeW5jKGRzdFBhdGgpKSB7XG4gICAgICAgIGRlYnVnLndhcm4oYCVzIGRvZXNuJ3QgZXhpc3RgLCBkc3RQYXRoKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIW9wdGlvbnMuc2tpcE9wdGlvbmFsUHVibGlzaCkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IG91dHB1dCA9IGV4ZWNTeW5jKGAke25wbUNsaWVudH0gcHVibGlzaGAsIHtcbiAgICAgICAgICAgIGN3ZDogcGtnRGlyLFxuICAgICAgICAgICAgZW52OiBwcm9jZXNzLmVudixcbiAgICAgICAgICAgIHN0ZGlvOiAncGlwZScsXG4gICAgICAgICAgfSlcbiAgICAgICAgICBwcm9jZXNzLnN0ZG91dC53cml0ZShvdXRwdXQpXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBlIGluc3RhbmNlb2YgRXJyb3IgJiZcbiAgICAgICAgICAgIGUubWVzc2FnZS5pbmNsdWRlcyhcbiAgICAgICAgICAgICAgJ1lvdSBjYW5ub3QgcHVibGlzaCBvdmVyIHRoZSBwcmV2aW91c2x5IHB1Ymxpc2hlZCB2ZXJzaW9ucycsXG4gICAgICAgICAgICApXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICBjb25zb2xlLmluZm8oZS5tZXNzYWdlKVxuICAgICAgICAgICAgZGVidWcud2FybihgJHtwa2dEaXJ9IGhhcyBiZWVuIHB1Ymxpc2hlZCwgc2tpcHBpbmdgKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChvcHRpb25zLmdoUmVsZWFzZSAmJiByZXBvICYmIG93bmVyKSB7XG4gICAgICAgIGRlYnVnLmluZm8oYENyZWF0aW5nIEdpdEh1YiByZWxlYXNlICR7cGtnSW5mby50YWd9YClcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZWxlYXNlSWQgPSBvcHRpb25zLmdoUmVsZWFzZUlkXG4gICAgICAgICAgICA/IE51bWJlcihvcHRpb25zLmdoUmVsZWFzZUlkKVxuICAgICAgICAgICAgOiAoXG4gICAgICAgICAgICAgICAgYXdhaXQgb2N0b2tpdCEucmVwb3MuZ2V0UmVsZWFzZUJ5VGFnKHtcbiAgICAgICAgICAgICAgICAgIHJlcG86IHJlcG8sXG4gICAgICAgICAgICAgICAgICBvd25lcjogb3duZXIsXG4gICAgICAgICAgICAgICAgICB0YWc6IHBrZ0luZm8udGFnLFxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICkuZGF0YS5pZFxuICAgICAgICAgIGNvbnN0IGRzdEZpbGVTdGF0cyA9IHN0YXRTeW5jKGRzdFBhdGgpXG4gICAgICAgICAgY29uc3QgYXNzZXRJbmZvID0gYXdhaXQgb2N0b2tpdCEucmVwb3MudXBsb2FkUmVsZWFzZUFzc2V0KHtcbiAgICAgICAgICAgIG93bmVyOiBvd25lcixcbiAgICAgICAgICAgIHJlcG86IHJlcG8sXG4gICAgICAgICAgICBuYW1lOiBmaWxlbmFtZSxcbiAgICAgICAgICAgIHJlbGVhc2VfaWQ6IHJlbGVhc2VJZCxcbiAgICAgICAgICAgIG1lZGlhVHlwZTogeyBmb3JtYXQ6ICdyYXcnIH0sXG4gICAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAgICdjb250ZW50LWxlbmd0aCc6IGRzdEZpbGVTdGF0cy5zaXplLFxuICAgICAgICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gQHRzLWV4cGVjdC1lcnJvciBvY3Rva2l0IHR5cGVzIGFyZSB3cm9uZ1xuICAgICAgICAgICAgZGF0YTogYXdhaXQgcmVhZEZpbGVBc3luYyhkc3RQYXRoKSxcbiAgICAgICAgICB9KVxuICAgICAgICAgIGRlYnVnLmluZm8oYEdpdEh1YiByZWxlYXNlIGNyZWF0ZWRgKVxuICAgICAgICAgIGRlYnVnLmluZm8oYERvd25sb2FkIFVSTDogJXNgLCBhc3NldEluZm8uZGF0YS5icm93c2VyX2Rvd25sb2FkX3VybClcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGRlYnVnLmVycm9yKFxuICAgICAgICAgICAgYFBhcmFtOiAke0pTT04uc3RyaW5naWZ5KFxuICAgICAgICAgICAgICB7IG93bmVyLCByZXBvLCB0YWc6IHBrZ0luZm8udGFnLCBmaWxlbmFtZTogZHN0UGF0aCB9LFxuICAgICAgICAgICAgICBudWxsLFxuICAgICAgICAgICAgICAyLFxuICAgICAgICAgICAgKX1gLFxuICAgICAgICAgIClcbiAgICAgICAgICBkZWJ1Zy5lcnJvcihlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFnKHRhZzogc3RyaW5nKSB7XG4gIGNvbnN0IHNlZ21lbnRzID0gdGFnLnNwbGl0KCdAJylcbiAgY29uc3QgdmVyc2lvbiA9IHNlZ21lbnRzLnBvcCgpIVxuICBjb25zdCBuYW1lID0gc2VnbWVudHMuam9pbignQCcpXG5cbiAgcmV0dXJuIHtcbiAgICBuYW1lLFxuICAgIHZlcnNpb24sXG4gICAgdGFnLFxuICB9XG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZVVuaXZlcnNhbGl6ZUNvbW1hbmQgZXh0ZW5kcyBDb21tYW5kIHtcbiAgc3RhdGljIHBhdGhzID0gW1sndW5pdmVyc2FsaXplJ11dXG5cbiAgc3RhdGljIHVzYWdlID0gQ29tbWFuZC5Vc2FnZSh7XG4gICAgZGVzY3JpcHRpb246ICdDb21iaWxlIGJ1aWx0IGJpbmFyaWVzIGludG8gb25lIHVuaXZlcnNhbCBiaW5hcnknLFxuICB9KVxuXG4gIGN3ZCA9IE9wdGlvbi5TdHJpbmcoJy0tY3dkJywgcHJvY2Vzcy5jd2QoKSwge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1RoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aCcsXG4gIH0pXG5cbiAgY29uZmlnUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tY29uZmlnLXBhdGgsLWMnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBuYXBpYCBjb25maWcganNvbiBmaWxlJyxcbiAgfSlcblxuICBwYWNrYWdlSnNvblBhdGggPSBPcHRpb24uU3RyaW5nKCctLXBhY2thZ2UtanNvbi1wYXRoJywgJ3BhY2thZ2UuanNvbicsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYHBhY2thZ2UuanNvbmAnLFxuICB9KVxuXG4gIG91dHB1dERpciA9IE9wdGlvbi5TdHJpbmcoJy0tb3V0cHV0LWRpciwtbycsICcuLycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIHRvIHRoZSBmb2xkZXIgd2hlcmUgYWxsIGJ1aWx0IGAubm9kZWAgZmlsZXMgcHV0LCBzYW1lIGFzIGAtLW91dHB1dC1kaXJgIG9mIGJ1aWxkIGNvbW1hbmQnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGN3ZDogdGhpcy5jd2QsXG4gICAgICBjb25maWdQYXRoOiB0aGlzLmNvbmZpZ1BhdGgsXG4gICAgICBwYWNrYWdlSnNvblBhdGg6IHRoaXMucGFja2FnZUpzb25QYXRoLFxuICAgICAgb3V0cHV0RGlyOiB0aGlzLm91dHB1dERpcixcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBDb21iaWxlIGJ1aWx0IGJpbmFyaWVzIGludG8gb25lIHVuaXZlcnNhbCBiaW5hcnlcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBVbml2ZXJzYWxpemVPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSB3b3JraW5nIGRpcmVjdG9yeSBvZiB3aGVyZSBuYXBpIGNvbW1hbmQgd2lsbCBiZSBleGVjdXRlZCBpbiwgYWxsIG90aGVyIHBhdGhzIG9wdGlvbnMgYXJlIHJlbGF0aXZlIHRvIHRoaXMgcGF0aFxuICAgKlxuICAgKiBAZGVmYXVsdCBwcm9jZXNzLmN3ZCgpXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICpcbiAgICogQGRlZmF1bHQgJ3BhY2thZ2UuanNvbidcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogUGF0aCB0byB0aGUgZm9sZGVyIHdoZXJlIGFsbCBidWlsdCBgLm5vZGVgIGZpbGVzIHB1dCwgc2FtZSBhcyBgLS1vdXRwdXQtZGlyYCBvZiBidWlsZCBjb21tYW5kXG4gICAqXG4gICAqIEBkZWZhdWx0ICcuLydcbiAgICovXG4gIG91dHB1dERpcj86IHN0cmluZ1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0VW5pdmVyc2FsaXplT3B0aW9ucyhvcHRpb25zOiBVbml2ZXJzYWxpemVPcHRpb25zKSB7XG4gIHJldHVybiB7XG4gICAgY3dkOiBwcm9jZXNzLmN3ZCgpLFxuICAgIHBhY2thZ2VKc29uUGF0aDogJ3BhY2thZ2UuanNvbicsXG4gICAgb3V0cHV0RGlyOiAnLi8nLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCB7IHNwYXduU3luYyB9IGZyb20gJ25vZGU6Y2hpbGRfcHJvY2VzcydcbmltcG9ydCB7IGpvaW4sIHJlc29sdmUgfSBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7XG4gIGFwcGx5RGVmYXVsdFVuaXZlcnNhbGl6ZU9wdGlvbnMsXG4gIHR5cGUgVW5pdmVyc2FsaXplT3B0aW9ucyxcbn0gZnJvbSAnLi4vZGVmL3VuaXZlcnNhbGl6ZS5qcydcbmltcG9ydCB7IHJlYWROYXBpQ29uZmlnIH0gZnJvbSAnLi4vdXRpbHMvY29uZmlnLmpzJ1xuaW1wb3J0IHsgZGVidWdGYWN0b3J5IH0gZnJvbSAnLi4vdXRpbHMvbG9nLmpzJ1xuaW1wb3J0IHsgZmlsZUV4aXN0cyB9IGZyb20gJy4uL3V0aWxzL21pc2MuanMnXG5pbXBvcnQgeyBVbmlBcmNoc0J5UGxhdGZvcm0gfSBmcm9tICcuLi91dGlscy90YXJnZXQuanMnXG5cbmNvbnN0IGRlYnVnID0gZGVidWdGYWN0b3J5KCd1bml2ZXJzYWxpemUnKVxuXG5jb25zdCB1bml2ZXJzYWxpemVyczogUGFydGlhbDxcbiAgUmVjb3JkPE5vZGVKUy5QbGF0Zm9ybSwgKGlucHV0czogc3RyaW5nW10sIG91dHB1dDogc3RyaW5nKSA9PiB2b2lkPlxuPiA9IHtcbiAgZGFyd2luOiAoaW5wdXRzLCBvdXRwdXQpID0+IHtcbiAgICBzcGF3blN5bmMoJ2xpcG8nLCBbJy1jcmVhdGUnLCAnLW91dHB1dCcsIG91dHB1dCwgLi4uaW5wdXRzXSwge1xuICAgICAgc3RkaW86ICdpbmhlcml0JyxcbiAgICB9KVxuICB9LFxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdW5pdmVyc2FsaXplQmluYXJpZXModXNlck9wdGlvbnM6IFVuaXZlcnNhbGl6ZU9wdGlvbnMpIHtcbiAgY29uc3Qgb3B0aW9ucyA9IGFwcGx5RGVmYXVsdFVuaXZlcnNhbGl6ZU9wdGlvbnModXNlck9wdGlvbnMpXG5cbiAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gam9pbihvcHRpb25zLmN3ZCwgb3B0aW9ucy5wYWNrYWdlSnNvblBhdGgpXG5cbiAgY29uc3QgY29uZmlnID0gYXdhaXQgcmVhZE5hcGlDb25maWcoXG4gICAgcGFja2FnZUpzb25QYXRoLFxuICAgIG9wdGlvbnMuY29uZmlnUGF0aCA/IHJlc29sdmUob3B0aW9ucy5jd2QsIG9wdGlvbnMuY29uZmlnUGF0aCkgOiB1bmRlZmluZWQsXG4gIClcblxuICBjb25zdCB0YXJnZXQgPSBjb25maWcudGFyZ2V0cy5maW5kKFxuICAgICh0KSA9PiB0LnBsYXRmb3JtID09PSBwcm9jZXNzLnBsYXRmb3JtICYmIHQuYXJjaCA9PT0gJ3VuaXZlcnNhbCcsXG4gIClcblxuICBpZiAoIXRhcmdldCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGAndW5pdmVyc2FsJyBhcmNoIGZvciBwbGF0Zm9ybSAnJHtwcm9jZXNzLnBsYXRmb3JtfScgbm90IGZvdW5kIGluIGNvbmZpZyFgLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHNyY0ZpbGVzID0gVW5pQXJjaHNCeVBsYXRmb3JtW3Byb2Nlc3MucGxhdGZvcm1dPy5tYXAoKGFyY2gpID0+XG4gICAgcmVzb2x2ZShcbiAgICAgIG9wdGlvbnMuY3dkLFxuICAgICAgb3B0aW9ucy5vdXRwdXREaXIsXG4gICAgICBgJHtjb25maWcuYmluYXJ5TmFtZX0uJHtwcm9jZXNzLnBsYXRmb3JtfS0ke2FyY2h9Lm5vZGVgLFxuICAgICksXG4gIClcblxuICBpZiAoIXNyY0ZpbGVzIHx8ICF1bml2ZXJzYWxpemVyc1twcm9jZXNzLnBsYXRmb3JtXSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGAndW5pdmVyc2FsJyBhcmNoIGZvciBwbGF0Zm9ybSAnJHtwcm9jZXNzLnBsYXRmb3JtfScgbm90IHN1cHBvcnRlZC5gLFxuICAgIClcbiAgfVxuXG4gIGRlYnVnKGBMb29raW5nIHVwIHNvdXJjZSBiaW5hcmllcyB0byBjb21iaW5lOiBgKVxuICBkZWJ1ZygnICAlTycsIHNyY0ZpbGVzKVxuXG4gIGNvbnN0IHNyY0ZpbGVMb29rdXAgPSBhd2FpdCBQcm9taXNlLmFsbChzcmNGaWxlcy5tYXAoKGYpID0+IGZpbGVFeGlzdHMoZikpKVxuXG4gIGNvbnN0IG5vdEZvdW5kRmlsZXMgPSBzcmNGaWxlcy5maWx0ZXIoKF8sIGkpID0+ICFzcmNGaWxlTG9va3VwW2ldKVxuXG4gIGlmIChub3RGb3VuZEZpbGVzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBTb21lIGJpbmFyeSBmaWxlcyB3ZXJlIG5vdCBmb3VuZDogJHtKU09OLnN0cmluZ2lmeShub3RGb3VuZEZpbGVzKX1gLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IG91dHB1dCA9IHJlc29sdmUoXG4gICAgb3B0aW9ucy5jd2QsXG4gICAgb3B0aW9ucy5vdXRwdXREaXIsXG4gICAgYCR7Y29uZmlnLmJpbmFyeU5hbWV9LiR7cHJvY2Vzcy5wbGF0Zm9ybX0tdW5pdmVyc2FsLm5vZGVgLFxuICApXG5cbiAgdW5pdmVyc2FsaXplcnNbcHJvY2Vzcy5wbGF0Zm9ybV0/LihzcmNGaWxlcywgb3V0cHV0KVxuXG4gIGRlYnVnKGBQcm9kdWNlZCB1bml2ZXJzYWwgYmluYXJ5OiAke291dHB1dH1gKVxufVxuIiwiaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gJ2NsaXBhbmlvbidcblxuaW1wb3J0IHsgY29sbGVjdEFydGlmYWN0cyB9IGZyb20gJy4uL2FwaS9hcnRpZmFjdHMuanMnXG5pbXBvcnQgeyBCYXNlQXJ0aWZhY3RzQ29tbWFuZCB9IGZyb20gJy4uL2RlZi9hcnRpZmFjdHMuanMnXG5cbmV4cG9ydCBjbGFzcyBBcnRpZmFjdHNDb21tYW5kIGV4dGVuZHMgQmFzZUFydGlmYWN0c0NvbW1hbmQge1xuICBzdGF0aWMgdXNhZ2UgPSBDb21tYW5kLlVzYWdlKHtcbiAgICBkZXNjcmlwdGlvbjogJ0NvcHkgYXJ0aWZhY3RzIGZyb20gR2l0aHViIEFjdGlvbnMgaW50byBzcGVjaWZpZWQgZGlyJyxcbiAgICBleGFtcGxlczogW1xuICAgICAgW1xuICAgICAgICAnJDAgYXJ0aWZhY3RzIC0tb3V0cHV0LWRpciAuL2FydGlmYWN0cyAtLWRpc3QgLi9ucG0nLFxuICAgICAgICBgQ29weSBbYmluYXJ5TmFtZV0uW3BsYXRmb3JtXS5ub2RlIHVuZGVyIGN1cnJlbnQgZGlyKC4pIGludG8gcGFja2FnZXMgdW5kZXIgbnBtIGRpci5cbmUuZzogaW5kZXgubGludXgteDY0LWdudS5ub2RlIC0tPiAuL25wbS9saW51eC14NjQtZ251L2luZGV4LmxpbnV4LXg2NC1nbnUubm9kZWAsXG4gICAgICBdLFxuICAgIF0sXG4gIH0pXG5cbiAgc3RhdGljIHBhdGhzID0gW1snYXJ0aWZhY3RzJ11dXG5cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCBjb2xsZWN0QXJ0aWZhY3RzKHRoaXMuZ2V0T3B0aW9ucygpKVxuICB9XG59XG4iLCIvLyBUaGlzIGZpbGUgaXMgZ2VuZXJhdGVkIGJ5IGNvZGVnZW4vaW5kZXgudHNcbi8vIERvIG5vdCBlZGl0IHRoaXMgZmlsZSBtYW51YWxseVxuaW1wb3J0IHsgQ29tbWFuZCwgT3B0aW9uIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgQmFzZUJ1aWxkQ29tbWFuZCBleHRlbmRzIENvbW1hbmQge1xuICBzdGF0aWMgcGF0aHMgPSBbWydidWlsZCddXVxuXG4gIHN0YXRpYyB1c2FnZSA9IENvbW1hbmQuVXNhZ2Uoe1xuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgdGhlIE5BUEktUlMgcHJvamVjdCcsXG4gIH0pXG5cbiAgdGFyZ2V0Pzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS10YXJnZXQsLXQnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQnVpbGQgZm9yIHRoZSB0YXJnZXQgdHJpcGxlLCBieXBhc3NlZCB0byBgY2FyZ28gYnVpbGQgLS10YXJnZXRgJyxcbiAgfSlcblxuICBjd2Q/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWN3ZCcsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdUaGUgd29ya2luZyBkaXJlY3Rvcnkgb2Ygd2hlcmUgbmFwaSBjb21tYW5kIHdpbGwgYmUgZXhlY3V0ZWQgaW4sIGFsbCBvdGhlciBwYXRocyBvcHRpb25zIGFyZSByZWxhdGl2ZSB0byB0aGlzIHBhdGgnLFxuICB9KVxuXG4gIG1hbmlmZXN0UGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tbWFuaWZlc3QtcGF0aCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYENhcmdvLnRvbWxgJyxcbiAgfSlcblxuICBjb25maWdQYXRoPzogc3RyaW5nID0gT3B0aW9uLlN0cmluZygnLS1jb25maWctcGF0aCwtYycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1BhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGUnLFxuICB9KVxuXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZS1qc29uLXBhdGgnLCB7XG4gICAgZGVzY3JpcHRpb246ICdQYXRoIHRvIGBwYWNrYWdlLmpzb25gJyxcbiAgfSlcblxuICB0YXJnZXREaXI/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLXRhcmdldC1kaXInLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnRGlyZWN0b3J5IGZvciBhbGwgY3JhdGUgZ2VuZXJhdGVkIGFydGlmYWN0cywgc2VlIGBjYXJnbyBidWlsZCAtLXRhcmdldC1kaXJgJyxcbiAgfSlcblxuICBvdXRwdXREaXI/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLW91dHB1dC1kaXIsLW8nLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnUGF0aCB0byB3aGVyZSBhbGwgdGhlIGJ1aWx0IGZpbGVzIHdvdWxkIGJlIHB1dC4gRGVmYXVsdCB0byB0aGUgY3JhdGUgZm9sZGVyJyxcbiAgfSlcblxuICBwbGF0Zm9ybT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1wbGF0Zm9ybScsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdBZGQgcGxhdGZvcm0gdHJpcGxlIHRvIHRoZSBnZW5lcmF0ZWQgbm9kZWpzIGJpbmRpbmcgZmlsZSwgZWc6IGBbbmFtZV0ubGludXgteDY0LWdudS5ub2RlYCcsXG4gIH0pXG5cbiAganNQYWNrYWdlTmFtZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tanMtcGFja2FnZS1uYW1lJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhY2thZ2UgbmFtZSBpbiBnZW5lcmF0ZWQganMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcnLFxuICB9KVxuXG4gIGNvbnN0RW51bT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1jb25zdC1lbnVtJywge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBnZW5lcmF0ZSBjb25zdCBlbnVtIGZvciB0eXBlc2NyaXB0IGJpbmRpbmdzJyxcbiAgfSlcblxuICBqc0JpbmRpbmc/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWpzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BhdGggYW5kIGZpbGVuYW1lIG9mIGdlbmVyYXRlZCBKUyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy4gUmVsYXRpdmUgdG8gYC0tb3V0cHV0LWRpcmAuJyxcbiAgfSlcblxuICBub0pzQmluZGluZz86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1uby1qcycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdXaGV0aGVyIHRvIGRpc2FibGUgdGhlIGdlbmVyYXRpb24gSlMgYmluZGluZyBmaWxlLiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuJyxcbiAgfSlcblxuICBkdHM/OiBzdHJpbmcgPSBPcHRpb24uU3RyaW5nKCctLWR0cycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdQYXRoIGFuZCBmaWxlbmFtZSBvZiBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gUmVsYXRpdmUgdG8gYC0tb3V0cHV0LWRpcmAnLFxuICB9KVxuXG4gIGR0c0hlYWRlcj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tZHRzLWhlYWRlcicsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdDdXN0b20gZmlsZSBoZWFkZXIgZm9yIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBPbmx5IHdvcmtzIHdoZW4gYHR5cGVkZWZgIGZlYXR1cmUgZW5hYmxlZC4nLFxuICB9KVxuXG4gIG5vRHRzSGVhZGVyPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLW5vLWR0cy1oZWFkZXInLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnV2hldGhlciB0byBkaXNhYmxlIHRoZSBkZWZhdWx0IGZpbGUgaGVhZGVyIGZvciBnZW5lcmF0ZWQgdHlwZSBkZWYgZmlsZS4gT25seSB3b3JrcyB3aGVuIGB0eXBlZGVmYCBmZWF0dXJlIGVuYWJsZWQuJyxcbiAgfSlcblxuICBkdHNDYWNoZSA9IE9wdGlvbi5Cb29sZWFuKCctLWR0cy1jYWNoZScsIHRydWUsIHtcbiAgICBkZXNjcmlwdGlvbjogJ1doZXRoZXIgdG8gZW5hYmxlIHRoZSBkdHMgY2FjaGUsIGRlZmF1bHQgdG8gdHJ1ZScsXG4gIH0pXG5cbiAgZXNtPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLWVzbScsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICdXaGV0aGVyIHRvIGVtaXQgYW4gRVNNIEpTIGJpbmRpbmcgZmlsZSBpbnN0ZWFkIG9mIENKUyBmb3JtYXQuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy4nLFxuICB9KVxuXG4gIHN0cmlwPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXN0cmlwLC1zJywge1xuICAgIGRlc2NyaXB0aW9uOiAnV2hldGhlciBzdHJpcCB0aGUgbGlicmFyeSB0byBhY2hpZXZlIHRoZSBtaW5pbXVtIGZpbGUgc2l6ZScsXG4gIH0pXG5cbiAgcmVsZWFzZT86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS1yZWxlYXNlLC1yJywge1xuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgaW4gcmVsZWFzZSBtb2RlJyxcbiAgfSlcblxuICB2ZXJib3NlPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLXZlcmJvc2UsLXYnLCB7XG4gICAgZGVzY3JpcHRpb246ICdWZXJib3NlbHkgbG9nIGJ1aWxkIGNvbW1hbmQgdHJhY2UnLFxuICB9KVxuXG4gIGJpbj86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tYmluJywge1xuICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgb25seSB0aGUgc3BlY2lmaWVkIGJpbmFyeScsXG4gIH0pXG5cbiAgcGFja2FnZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tcGFja2FnZSwtcCcsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIHRoZSBzcGVjaWZpZWQgbGlicmFyeSBvciB0aGUgb25lIGF0IGN3ZCcsXG4gIH0pXG5cbiAgcHJvZmlsZT86IHN0cmluZyA9IE9wdGlvbi5TdHJpbmcoJy0tcHJvZmlsZScsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0J1aWxkIGFydGlmYWN0cyB3aXRoIHRoZSBzcGVjaWZpZWQgcHJvZmlsZScsXG4gIH0pXG5cbiAgY3Jvc3NDb21waWxlPzogYm9vbGVhbiA9IE9wdGlvbi5Cb29sZWFuKCctLWNyb3NzLWNvbXBpbGUsLXgnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnW2V4cGVyaW1lbnRhbF0gY3Jvc3MtY29tcGlsZSBmb3IgdGhlIHNwZWNpZmllZCB0YXJnZXQgd2l0aCBgY2FyZ28teHdpbmAgb24gd2luZG93cyBhbmQgYGNhcmdvLXppZ2J1aWxkYCBvbiBvdGhlciBwbGF0Zm9ybScsXG4gIH0pXG5cbiAgdXNlQ3Jvc3M/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tdXNlLWNyb3NzJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1tleHBlcmltZW50YWxdIHVzZSBbY3Jvc3NdKGh0dHBzOi8vZ2l0aHViLmNvbS9jcm9zcy1ycy9jcm9zcykgaW5zdGVhZCBvZiBgY2FyZ29gJyxcbiAgfSlcblxuICB1c2VOYXBpQ3Jvc3M/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tdXNlLW5hcGktY3Jvc3MnLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnW2V4cGVyaW1lbnRhbF0gdXNlIEBuYXBpLXJzL2Nyb3NzLXRvb2xjaGFpbiB0byBjcm9zcy1jb21waWxlIExpbnV4IGFybS9hcm02NC94NjQgZ251IHRhcmdldHMuJyxcbiAgfSlcblxuICB3YXRjaD86IGJvb2xlYW4gPSBPcHRpb24uQm9vbGVhbignLS13YXRjaCwtdycsIHtcbiAgICBkZXNjcmlwdGlvbjpcbiAgICAgICd3YXRjaCB0aGUgY3JhdGUgY2hhbmdlcyBhbmQgYnVpbGQgY29udGludW91c2x5IHdpdGggYGNhcmdvLXdhdGNoYCBjcmF0ZXMnLFxuICB9KVxuXG4gIGZlYXR1cmVzPzogc3RyaW5nW10gPSBPcHRpb24uQXJyYXkoJy0tZmVhdHVyZXMsLUYnLCB7XG4gICAgZGVzY3JpcHRpb246ICdTcGFjZS1zZXBhcmF0ZWQgbGlzdCBvZiBmZWF0dXJlcyB0byBhY3RpdmF0ZScsXG4gIH0pXG5cbiAgYWxsRmVhdHVyZXM/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tYWxsLWZlYXR1cmVzJywge1xuICAgIGRlc2NyaXB0aW9uOiAnQWN0aXZhdGUgYWxsIGF2YWlsYWJsZSBmZWF0dXJlcycsXG4gIH0pXG5cbiAgbm9EZWZhdWx0RmVhdHVyZXM/OiBib29sZWFuID0gT3B0aW9uLkJvb2xlYW4oJy0tbm8tZGVmYXVsdC1mZWF0dXJlcycsIHtcbiAgICBkZXNjcmlwdGlvbjogJ0RvIG5vdCBhY3RpdmF0ZSB0aGUgYGRlZmF1bHRgIGZlYXR1cmUnLFxuICB9KVxuXG4gIGdldE9wdGlvbnMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRhcmdldDogdGhpcy50YXJnZXQsXG4gICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgbWFuaWZlc3RQYXRoOiB0aGlzLm1hbmlmZXN0UGF0aCxcbiAgICAgIGNvbmZpZ1BhdGg6IHRoaXMuY29uZmlnUGF0aCxcbiAgICAgIHBhY2thZ2VKc29uUGF0aDogdGhpcy5wYWNrYWdlSnNvblBhdGgsXG4gICAgICB0YXJnZXREaXI6IHRoaXMudGFyZ2V0RGlyLFxuICAgICAgb3V0cHV0RGlyOiB0aGlzLm91dHB1dERpcixcbiAgICAgIHBsYXRmb3JtOiB0aGlzLnBsYXRmb3JtLFxuICAgICAganNQYWNrYWdlTmFtZTogdGhpcy5qc1BhY2thZ2VOYW1lLFxuICAgICAgY29uc3RFbnVtOiB0aGlzLmNvbnN0RW51bSxcbiAgICAgIGpzQmluZGluZzogdGhpcy5qc0JpbmRpbmcsXG4gICAgICBub0pzQmluZGluZzogdGhpcy5ub0pzQmluZGluZyxcbiAgICAgIGR0czogdGhpcy5kdHMsXG4gICAgICBkdHNIZWFkZXI6IHRoaXMuZHRzSGVhZGVyLFxuICAgICAgbm9EdHNIZWFkZXI6IHRoaXMubm9EdHNIZWFkZXIsXG4gICAgICBkdHNDYWNoZTogdGhpcy5kdHNDYWNoZSxcbiAgICAgIGVzbTogdGhpcy5lc20sXG4gICAgICBzdHJpcDogdGhpcy5zdHJpcCxcbiAgICAgIHJlbGVhc2U6IHRoaXMucmVsZWFzZSxcbiAgICAgIHZlcmJvc2U6IHRoaXMudmVyYm9zZSxcbiAgICAgIGJpbjogdGhpcy5iaW4sXG4gICAgICBwYWNrYWdlOiB0aGlzLnBhY2thZ2UsXG4gICAgICBwcm9maWxlOiB0aGlzLnByb2ZpbGUsXG4gICAgICBjcm9zc0NvbXBpbGU6IHRoaXMuY3Jvc3NDb21waWxlLFxuICAgICAgdXNlQ3Jvc3M6IHRoaXMudXNlQ3Jvc3MsXG4gICAgICB1c2VOYXBpQ3Jvc3M6IHRoaXMudXNlTmFwaUNyb3NzLFxuICAgICAgd2F0Y2g6IHRoaXMud2F0Y2gsXG4gICAgICBmZWF0dXJlczogdGhpcy5mZWF0dXJlcyxcbiAgICAgIGFsbEZlYXR1cmVzOiB0aGlzLmFsbEZlYXR1cmVzLFxuICAgICAgbm9EZWZhdWx0RmVhdHVyZXM6IHRoaXMubm9EZWZhdWx0RmVhdHVyZXMsXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIE5BUEktUlMgcHJvamVjdFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEJ1aWxkT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBCdWlsZCBmb3IgdGhlIHRhcmdldCB0cmlwbGUsIGJ5cGFzc2VkIHRvIGBjYXJnbyBidWlsZCAtLXRhcmdldGBcbiAgICovXG4gIHRhcmdldD86IHN0cmluZ1xuICAvKipcbiAgICogVGhlIHdvcmtpbmcgZGlyZWN0b3J5IG9mIHdoZXJlIG5hcGkgY29tbWFuZCB3aWxsIGJlIGV4ZWN1dGVkIGluLCBhbGwgb3RoZXIgcGF0aHMgb3B0aW9ucyBhcmUgcmVsYXRpdmUgdG8gdGhpcyBwYXRoXG4gICAqL1xuICBjd2Q/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYENhcmdvLnRvbWxgXG4gICAqL1xuICBtYW5pZmVzdFBhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYG5hcGlgIGNvbmZpZyBqc29uIGZpbGVcbiAgICovXG4gIGNvbmZpZ1BhdGg/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gYHBhY2thZ2UuanNvbmBcbiAgICovXG4gIHBhY2thZ2VKc29uUGF0aD86IHN0cmluZ1xuICAvKipcbiAgICogRGlyZWN0b3J5IGZvciBhbGwgY3JhdGUgZ2VuZXJhdGVkIGFydGlmYWN0cywgc2VlIGBjYXJnbyBidWlsZCAtLXRhcmdldC1kaXJgXG4gICAqL1xuICB0YXJnZXREaXI/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFBhdGggdG8gd2hlcmUgYWxsIHRoZSBidWlsdCBmaWxlcyB3b3VsZCBiZSBwdXQuIERlZmF1bHQgdG8gdGhlIGNyYXRlIGZvbGRlclxuICAgKi9cbiAgb3V0cHV0RGlyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBBZGQgcGxhdGZvcm0gdHJpcGxlIHRvIHRoZSBnZW5lcmF0ZWQgbm9kZWpzIGJpbmRpbmcgZmlsZSwgZWc6IGBbbmFtZV0ubGludXgteDY0LWdudS5ub2RlYFxuICAgKi9cbiAgcGxhdGZvcm0/OiBib29sZWFuXG4gIC8qKlxuICAgKiBQYWNrYWdlIG5hbWUgaW4gZ2VuZXJhdGVkIGpzIGJpbmRpbmcgZmlsZS4gT25seSB3b3JrcyB3aXRoIGAtLXBsYXRmb3JtYCBmbGFnXG4gICAqL1xuICBqc1BhY2thZ2VOYW1lPzogc3RyaW5nXG4gIC8qKlxuICAgKiBXaGV0aGVyIGdlbmVyYXRlIGNvbnN0IGVudW0gZm9yIHR5cGVzY3JpcHQgYmluZGluZ3NcbiAgICovXG4gIGNvbnN0RW51bT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFBhdGggYW5kIGZpbGVuYW1lIG9mIGdlbmVyYXRlZCBKUyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy4gUmVsYXRpdmUgdG8gYC0tb3V0cHV0LWRpcmAuXG4gICAqL1xuICBqc0JpbmRpbmc/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gZGlzYWJsZSB0aGUgZ2VuZXJhdGlvbiBKUyBiaW5kaW5nIGZpbGUuIE9ubHkgd29ya3Mgd2l0aCBgLS1wbGF0Zm9ybWAgZmxhZy5cbiAgICovXG4gIG5vSnNCaW5kaW5nPzogYm9vbGVhblxuICAvKipcbiAgICogUGF0aCBhbmQgZmlsZW5hbWUgb2YgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIFJlbGF0aXZlIHRvIGAtLW91dHB1dC1kaXJgXG4gICAqL1xuICBkdHM/OiBzdHJpbmdcbiAgLyoqXG4gICAqIEN1c3RvbSBmaWxlIGhlYWRlciBmb3IgZ2VuZXJhdGVkIHR5cGUgZGVmIGZpbGUuIE9ubHkgd29ya3Mgd2hlbiBgdHlwZWRlZmAgZmVhdHVyZSBlbmFibGVkLlxuICAgKi9cbiAgZHRzSGVhZGVyPzogc3RyaW5nXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRvIGRpc2FibGUgdGhlIGRlZmF1bHQgZmlsZSBoZWFkZXIgZm9yIGdlbmVyYXRlZCB0eXBlIGRlZiBmaWxlLiBPbmx5IHdvcmtzIHdoZW4gYHR5cGVkZWZgIGZlYXR1cmUgZW5hYmxlZC5cbiAgICovXG4gIG5vRHRzSGVhZGVyPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciB0byBlbmFibGUgdGhlIGR0cyBjYWNoZSwgZGVmYXVsdCB0byB0cnVlXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIGR0c0NhY2hlPzogYm9vbGVhblxuICAvKipcbiAgICogV2hldGhlciB0byBlbWl0IGFuIEVTTSBKUyBiaW5kaW5nIGZpbGUgaW5zdGVhZCBvZiBDSlMgZm9ybWF0LiBPbmx5IHdvcmtzIHdpdGggYC0tcGxhdGZvcm1gIGZsYWcuXG4gICAqL1xuICBlc20/OiBib29sZWFuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHN0cmlwIHRoZSBsaWJyYXJ5IHRvIGFjaGlldmUgdGhlIG1pbmltdW0gZmlsZSBzaXplXG4gICAqL1xuICBzdHJpcD86IGJvb2xlYW5cbiAgLyoqXG4gICAqIEJ1aWxkIGluIHJlbGVhc2UgbW9kZVxuICAgKi9cbiAgcmVsZWFzZT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFZlcmJvc2VseSBsb2cgYnVpbGQgY29tbWFuZCB0cmFjZVxuICAgKi9cbiAgdmVyYm9zZT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIEJ1aWxkIG9ubHkgdGhlIHNwZWNpZmllZCBiaW5hcnlcbiAgICovXG4gIGJpbj86IHN0cmluZ1xuICAvKipcbiAgICogQnVpbGQgdGhlIHNwZWNpZmllZCBsaWJyYXJ5IG9yIHRoZSBvbmUgYXQgY3dkXG4gICAqL1xuICBwYWNrYWdlPzogc3RyaW5nXG4gIC8qKlxuICAgKiBCdWlsZCBhcnRpZmFjdHMgd2l0aCB0aGUgc3BlY2lmaWVkIHByb2ZpbGVcbiAgICovXG4gIHByb2ZpbGU/OiBzdHJpbmdcbiAgLyoqXG4gICAqIFtleHBlcmltZW50YWxdIGNyb3NzLWNvbXBpbGUgZm9yIHRoZSBzcGVjaWZpZWQgdGFyZ2V0IHdpdGggYGNhcmdvLXh3aW5gIG9uIHdpbmRvd3MgYW5kIGBjYXJnby16aWdidWlsZGAgb24gb3RoZXIgcGxhdGZvcm1cbiAgICovXG4gIGNyb3NzQ29tcGlsZT86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFtleHBlcmltZW50YWxdIHVzZSBbY3Jvc3NdKGh0dHBzOi8vZ2l0aHViLmNvbS9jcm9zcy1ycy9jcm9zcykgaW5zdGVhZCBvZiBgY2FyZ29gXG4gICAqL1xuICB1c2VDcm9zcz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFtleHBlcmltZW50YWxdIHVzZSBAbmFwaS1ycy9jcm9zcy10b29sY2hhaW4gdG8gY3Jvc3MtY29tcGlsZSBMaW51eCBhcm0vYXJtNjQveDY0IGdudSB0YXJnZXRzLlxuICAgKi9cbiAgdXNlTmFwaUNyb3NzPzogYm9vbGVhblxuICAvKipcbiAgICogd2F0Y2ggdGhlIGNyYXRlIGNoYW5nZXMgYW5kIGJ1aWxkIGNvbnRpbnVvdXNseSB3aXRoIGBjYXJnby13YXRjaGAgY3JhdGVzXG4gICAqL1xuICB3YXRjaD86IGJvb2xlYW5cbiAgLyoqXG4gICAqIFNwYWNlLXNlcGFyYXRlZCBsaXN0IG9mIGZlYXR1cmVzIHRvIGFjdGl2YXRlXG4gICAqL1xuICBmZWF0dXJlcz86IHN0cmluZ1tdXG4gIC8qKlxuICAgKiBBY3RpdmF0ZSBhbGwgYXZhaWxhYmxlIGZlYXR1cmVzXG4gICAqL1xuICBhbGxGZWF0dXJlcz86IGJvb2xlYW5cbiAgLyoqXG4gICAqIERvIG5vdCBhY3RpdmF0ZSB0aGUgYGRlZmF1bHRgIGZlYXR1cmVcbiAgICovXG4gIG5vRGVmYXVsdEZlYXR1cmVzPzogYm9vbGVhblxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlEZWZhdWx0QnVpbGRPcHRpb25zKG9wdGlvbnM6IEJ1aWxkT3B0aW9ucykge1xuICByZXR1cm4ge1xuICAgIGR0c0NhY2hlOiB0cnVlLFxuICAgIC4uLm9wdGlvbnMsXG4gIH1cbn1cbiIsImltcG9ydCB7IGV4ZWNTeW5jIH0gZnJvbSAnbm9kZTpjaGlsZF9wcm9jZXNzJ1xuXG5pbXBvcnQgeyBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmltcG9ydCB7IGJ1aWxkUHJvamVjdCB9IGZyb20gJy4uL2FwaS9idWlsZC5qcydcbmltcG9ydCB7IEJhc2VCdWlsZENvbW1hbmQgfSBmcm9tICcuLi9kZWYvYnVpbGQuanMnXG5pbXBvcnQgeyBkZWJ1Z0ZhY3RvcnkgfSBmcm9tICcuLi91dGlscy9pbmRleC5qcydcblxuY29uc3QgZGVidWcgPSBkZWJ1Z0ZhY3RvcnkoJ2J1aWxkJylcblxuZXhwb3J0IGNsYXNzIEJ1aWxkQ29tbWFuZCBleHRlbmRzIEJhc2VCdWlsZENvbW1hbmQge1xuICBwaXBlID0gT3B0aW9uLlN0cmluZygnLS1waXBlJywge1xuICAgIGRlc2NyaXB0aW9uOlxuICAgICAgJ1BpcGUgYWxsIG91dHB1dHMgZmlsZSB0byBnaXZlbiBjb21tYW5kLiBlLmcuIGBuYXBpIGJ1aWxkIC0tcGlwZSBcIm5weCBwcmV0dGllciAtLXdyaXRlXCJgJyxcbiAgfSlcblxuICBjYXJnb09wdGlvbnMgPSBPcHRpb24uUmVzdCgpXG5cbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBjb25zdCB7IHRhc2sgfSA9IGF3YWl0IGJ1aWxkUHJvamVjdCh7XG4gICAgICAuLi50aGlzLmdldE9wdGlvbnMoKSxcbiAgICAgIGNhcmdvT3B0aW9uczogdGhpcy5jYXJnb09wdGlvbnMsXG4gICAgfSlcblxuICAgIGNvbnN0IG91dHB1dHMgPSBhd2FpdCB0YXNrXG5cbiAgICBpZiAodGhpcy5waXBlKSB7XG4gICAgICBmb3IgKGNvbnN0IG91dHB1dCBvZiBvdXRwdXRzKSB7XG4gICAgICAgIGRlYnVnKCdQaXBpbmcgb3V0cHV0IGZpbGUgdG8gY29tbWFuZDogJXMnLCB0aGlzLnBpcGUpXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgZXhlY1N5bmMoYCR7dGhpcy5waXBlfSAke291dHB1dC5wYXRofWAsIHtcbiAgICAgICAgICAgIHN0ZGlvOiAnaW5oZXJpdCcsXG4gICAgICAgICAgICBjd2Q6IHRoaXMuY3dkLFxuICAgICAgICAgIH0pXG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICBkZWJ1Zy5lcnJvcihgRmFpbGVkIHRvIHBpcGUgb3V0cHV0IGZpbGUgJHtvdXRwdXQucGF0aH0gdG8gY29tbWFuZGApXG4gICAgICAgICAgZGVidWcuZXJyb3IoZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxufVxuIiwiaW1wb3J0IHsgQ29tbWFuZCB9IGZyb20gJ2NsaXBhbmlvbidcblxuaW1wb3J0IHsgQ0xJX1ZFUlNJT04gfSBmcm9tICcuLi91dGlscy9taXNjLmpzJ1xuXG4vKipcbiAqIEEgY29tbWFuZCB0aGF0IHByaW50cyB0aGUgdmVyc2lvbiBvZiB0aGUgQ0xJLlxuICpcbiAqIFBhdGhzOiBgLXZgLCBgLS12ZXJzaW9uYFxuICovXG5leHBvcnQgY2xhc3MgQ2xpVmVyc2lvbkNvbW1hbmQgZXh0ZW5kcyBDb21tYW5kPGFueT4ge1xuICBzdGF0aWMgcGF0aHMgPSBbW2AtdmBdLCBbYC0tdmVyc2lvbmBdXVxuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IHRoaXMuY29udGV4dC5zdGRvdXQud3JpdGUoYCR7Q0xJX1ZFUlNJT059XFxuYClcbiAgfVxufVxuIiwiaW1wb3J0IHsgY3JlYXRlTnBtRGlycyB9IGZyb20gJy4uL2FwaS9jcmVhdGUtbnBtLWRpcnMuanMnXG5pbXBvcnQgeyBCYXNlQ3JlYXRlTnBtRGlyc0NvbW1hbmQgfSBmcm9tICcuLi9kZWYvY3JlYXRlLW5wbS1kaXJzLmpzJ1xuXG5leHBvcnQgY2xhc3MgQ3JlYXRlTnBtRGlyc0NvbW1hbmQgZXh0ZW5kcyBCYXNlQ3JlYXRlTnBtRGlyc0NvbW1hbmQge1xuICBhc3luYyBleGVjdXRlKCkge1xuICAgIGF3YWl0IGNyZWF0ZU5wbURpcnModGhpcy5nZXRPcHRpb25zKCkpXG4gIH1cbn1cbiIsImltcG9ydCB7IENvbW1hbmQgfSBmcm9tICdjbGlwYW5pb24nXG5cbi8qKlxuICogQSBjb21tYW5kIHRoYXQgcHJpbnRzIHRoZSB1c2FnZSBvZiBhbGwgY29tbWFuZHMuXG4gKlxuICogUGF0aHM6IGAtaGAsIGAtLWhlbHBgXG4gKi9cbmV4cG9ydCBjbGFzcyBIZWxwQ29tbWFuZCBleHRlbmRzIENvbW1hbmQ8YW55PiB7XG4gIHN0YXRpYyBwYXRocyA9IFtbYC1oYF0sIFtgLS1oZWxwYF1dXG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgdGhpcy5jb250ZXh0LnN0ZG91dC53cml0ZSh0aGlzLmNsaS51c2FnZSgpKVxuICB9XG59XG4iLCJpbXBvcnQgcGF0aCBmcm9tICdub2RlOnBhdGgnXG5cbmltcG9ydCB7IGlucHV0LCBzZWxlY3QsIGNoZWNrYm94LCBjb25maXJtIH0gZnJvbSAnQGlucXVpcmVyL3Byb21wdHMnXG5pbXBvcnQgeyBPcHRpb24gfSBmcm9tICdjbGlwYW5pb24nXG5cbmltcG9ydCB7IG5ld1Byb2plY3QgfSBmcm9tICcuLi9hcGkvbmV3LmpzJ1xuaW1wb3J0IHsgQmFzZU5ld0NvbW1hbmQgfSBmcm9tICcuLi9kZWYvbmV3LmpzJ1xuaW1wb3J0IHtcbiAgQVZBSUxBQkxFX1RBUkdFVFMsXG4gIGRlYnVnRmFjdG9yeSxcbiAgREVGQVVMVF9UQVJHRVRTLFxuICB0eXBlIFRhcmdldFRyaXBsZSxcbn0gZnJvbSAnLi4vdXRpbHMvaW5kZXguanMnXG5pbXBvcnQgeyBuYXBpRW5naW5lUmVxdWlyZW1lbnQgfSBmcm9tICcuLi91dGlscy92ZXJzaW9uLmpzJ1xuXG5jb25zdCBkZWJ1ZyA9IGRlYnVnRmFjdG9yeSgnbmV3JylcblxuZXhwb3J0IGNsYXNzIE5ld0NvbW1hbmQgZXh0ZW5kcyBCYXNlTmV3Q29tbWFuZCB7XG4gIGludGVyYWN0aXZlID0gT3B0aW9uLkJvb2xlYW4oJy0taW50ZXJhY3RpdmUsLWknLCB0cnVlLCB7XG4gICAgZGVzY3JpcHRpb246XG4gICAgICAnQXNrIHByb2plY3QgYmFzaWMgaW5mb3JtYXRpb24gaW50ZXJhY3RpdmVseSB3aXRob3V0IGp1c3QgdXNpbmcgdGhlIGRlZmF1bHQuJyxcbiAgfSlcblxuICBhc3luYyBleGVjdXRlKCkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBvcHRpb25zID0gYXdhaXQgdGhpcy5mZXRjaE9wdGlvbnMoKVxuICAgICAgYXdhaXQgbmV3UHJvamVjdChvcHRpb25zKVxuICAgICAgcmV0dXJuIDBcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBkZWJ1ZygnRmFpbGVkIHRvIGNyZWF0ZSBuZXcgcHJvamVjdCcpXG4gICAgICBkZWJ1Zy5lcnJvcihlKVxuICAgICAgcmV0dXJuIDFcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoT3B0aW9ucygpIHtcbiAgICBjb25zdCBjbWRPcHRpb25zID0gc3VwZXIuZ2V0T3B0aW9ucygpXG5cbiAgICBpZiAodGhpcy5pbnRlcmFjdGl2ZSkge1xuICAgICAgY29uc3QgdGFyZ2V0UGF0aDogc3RyaW5nID0gY21kT3B0aW9ucy5wYXRoXG4gICAgICAgID8gY21kT3B0aW9ucy5wYXRoXG4gICAgICAgIDogYXdhaXQgaW5xdWlyZXJQcm9qZWN0UGF0aCgpXG4gICAgICBjbWRPcHRpb25zLnBhdGggPSB0YXJnZXRQYXRoXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5jbWRPcHRpb25zLFxuICAgICAgICBuYW1lOiBhd2FpdCB0aGlzLmZldGNoTmFtZShwYXRoLnBhcnNlKHRhcmdldFBhdGgpLmJhc2UpLFxuICAgICAgICBtaW5Ob2RlQXBpVmVyc2lvbjogYXdhaXQgdGhpcy5mZXRjaE5hcGlWZXJzaW9uKCksXG4gICAgICAgIHRhcmdldHM6IGF3YWl0IHRoaXMuZmV0Y2hUYXJnZXRzKCksXG4gICAgICAgIGxpY2Vuc2U6IGF3YWl0IHRoaXMuZmV0Y2hMaWNlbnNlKCksXG4gICAgICAgIGVuYWJsZVR5cGVEZWY6IGF3YWl0IHRoaXMuZmV0Y2hUeXBlRGVmKCksXG4gICAgICAgIGVuYWJsZUdpdGh1YkFjdGlvbnM6IGF3YWl0IHRoaXMuZmV0Y2hHaXRodWJBY3Rpb25zKCksXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGNtZE9wdGlvbnNcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hOYW1lKGRlZmF1bHROYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLiQkbmFtZSA/P1xuICAgICAgaW5wdXQoe1xuICAgICAgICBtZXNzYWdlOiAnUGFja2FnZSBuYW1lICh0aGUgbmFtZSBmaWVsZCBpbiB5b3VyIHBhY2thZ2UuanNvbiBmaWxlKScsXG4gICAgICAgIGRlZmF1bHQ6IGRlZmF1bHROYW1lLFxuICAgICAgfSlcbiAgICApXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTGljZW5zZSgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHJldHVybiBpbnB1dCh7XG4gICAgICBtZXNzYWdlOiAnTGljZW5zZSBmb3Igb3Blbi1zb3VyY2VkIHByb2plY3QnLFxuICAgICAgZGVmYXVsdDogdGhpcy5saWNlbnNlLFxuICAgIH0pXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTmFwaVZlcnNpb24oKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICByZXR1cm4gc2VsZWN0KHtcbiAgICAgIG1lc3NhZ2U6ICdNaW5pbXVtIG5vZGUtYXBpIHZlcnNpb24gKHdpdGggbm9kZSB2ZXJzaW9uIHJlcXVpcmVtZW50KScsXG4gICAgICBsb29wOiBmYWxzZSxcbiAgICAgIHBhZ2VTaXplOiAxMCxcbiAgICAgIGNob2ljZXM6IEFycmF5LmZyb20oeyBsZW5ndGg6IDggfSwgKF8sIGkpID0+ICh7XG4gICAgICAgIG5hbWU6IGBuYXBpJHtpICsgMX0gKCR7bmFwaUVuZ2luZVJlcXVpcmVtZW50KGkgKyAxKX0pYCxcbiAgICAgICAgdmFsdWU6IGkgKyAxLFxuICAgICAgfSkpLFxuICAgICAgLy8gY2hvaWNlIGluZGV4XG4gICAgICBkZWZhdWx0OiB0aGlzLm1pbk5vZGVBcGlWZXJzaW9uIC0gMSxcbiAgICB9KVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaFRhcmdldHMoKTogUHJvbWlzZTxUYXJnZXRUcmlwbGVbXT4ge1xuICAgIGlmICh0aGlzLmVuYWJsZUFsbFRhcmdldHMpIHtcbiAgICAgIHJldHVybiBBVkFJTEFCTEVfVEFSR0VUUy5jb25jYXQoKVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldHMgPSBhd2FpdCBjaGVja2JveCh7XG4gICAgICBsb29wOiBmYWxzZSxcbiAgICAgIG1lc3NhZ2U6ICdDaG9vc2UgdGFyZ2V0KHMpIHlvdXIgY3JhdGUgd2lsbCBiZSBjb21waWxlZCB0bycsXG4gICAgICBjaG9pY2VzOiBBVkFJTEFCTEVfVEFSR0VUUy5tYXAoKHRhcmdldCkgPT4gKHtcbiAgICAgICAgbmFtZTogdGFyZ2V0LFxuICAgICAgICB2YWx1ZTogdGFyZ2V0LFxuICAgICAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgICAgIGNoZWNrZWQ6IERFRkFVTFRfVEFSR0VUUy5pbmNsdWRlcyh0YXJnZXQpLFxuICAgICAgfSkpLFxuICAgIH0pXG5cbiAgICByZXR1cm4gdGFyZ2V0c1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBmZXRjaFR5cGVEZWYoKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZW5hYmxlVHlwZURlZiA9IGF3YWl0IGNvbmZpcm0oe1xuICAgICAgbWVzc2FnZTogJ0VuYWJsZSB0eXBlIGRlZmluaXRpb24gYXV0by1nZW5lcmF0aW9uJyxcbiAgICAgIGRlZmF1bHQ6IHRoaXMuZW5hYmxlVHlwZURlZixcbiAgICB9KVxuXG4gICAgcmV0dXJuIGVuYWJsZVR5cGVEZWZcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hHaXRodWJBY3Rpb25zKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVuYWJsZUdpdGh1YkFjdGlvbnMgPSBhd2FpdCBjb25maXJtKHtcbiAgICAgIG1lc3NhZ2U6ICdFbmFibGUgR2l0aHViIEFjdGlvbnMgQ0knLFxuICAgICAgZGVmYXVsdDogdGhpcy5lbmFibGVHaXRodWJBY3Rpb25zLFxuICAgIH0pXG5cbiAgICByZXR1cm4gZW5hYmxlR2l0aHViQWN0aW9uc1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlucXVpcmVyUHJvamVjdFBhdGgoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgcmV0dXJuIGlucHV0KHtcbiAgICBtZXNzYWdlOiAnVGFyZ2V0IHBhdGggdG8gY3JlYXRlIHRoZSBwcm9qZWN0LCByZWxhdGl2ZSB0byBjd2QuJyxcbiAgfSkudGhlbigocGF0aCkgPT4ge1xuICAgIGlmICghcGF0aCkge1xuICAgICAgcmV0dXJuIGlucXVpcmVyUHJvamVjdFBhdGgoKVxuICAgIH1cbiAgICByZXR1cm4gcGF0aFxuICB9KVxufVxuIiwiaW1wb3J0IHsgcHJlUHVibGlzaCB9IGZyb20gJy4uL2FwaS9wcmUtcHVibGlzaC5qcydcbmltcG9ydCB7IEJhc2VQcmVQdWJsaXNoQ29tbWFuZCB9IGZyb20gJy4uL2RlZi9wcmUtcHVibGlzaC5qcydcblxuZXhwb3J0IGNsYXNzIFByZVB1Ymxpc2hDb21tYW5kIGV4dGVuZHMgQmFzZVByZVB1Ymxpc2hDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yIGNvbnN0ICducG0nIHwgJ2xlcm5hJyB0byBzdHJpbmdcbiAgICBhd2FpdCBwcmVQdWJsaXNoKHRoaXMuZ2V0T3B0aW9ucygpKVxuICB9XG59XG4iLCJpbXBvcnQgeyBpbnB1dCB9IGZyb20gJ0BpbnF1aXJlci9wcm9tcHRzJ1xuXG5pbXBvcnQgeyByZW5hbWVQcm9qZWN0IH0gZnJvbSAnLi4vYXBpL3JlbmFtZS5qcydcbmltcG9ydCB7IEJhc2VSZW5hbWVDb21tYW5kIH0gZnJvbSAnLi4vZGVmL3JlbmFtZS5qcydcblxuZXhwb3J0IGNsYXNzIFJlbmFtZUNvbW1hbmQgZXh0ZW5kcyBCYXNlUmVuYW1lQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgaWYgKCFvcHRpb25zLm5hbWUpIHtcbiAgICAgIGNvbnN0IG5hbWUgPSBhd2FpdCBpbnB1dCh7XG4gICAgICAgIG1lc3NhZ2U6IGBFbnRlciB0aGUgbmV3IHBhY2thZ2UgbmFtZSBpbiB0aGUgcGFja2FnZS5qc29uYCxcbiAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICB9KVxuICAgICAgb3B0aW9ucy5uYW1lID0gbmFtZVxuICAgIH1cbiAgICBpZiAoIW9wdGlvbnMuYmluYXJ5TmFtZSkge1xuICAgICAgY29uc3QgYmluYXJ5TmFtZSA9IGF3YWl0IGlucHV0KHtcbiAgICAgICAgbWVzc2FnZTogYEVudGVyIHRoZSBuZXcgYmluYXJ5IG5hbWVgLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIH0pXG4gICAgICBvcHRpb25zLmJpbmFyeU5hbWUgPSBiaW5hcnlOYW1lXG4gICAgfVxuICAgIGF3YWl0IHJlbmFtZVByb2plY3Qob3B0aW9ucylcbiAgfVxufVxuIiwiaW1wb3J0IHsgdW5pdmVyc2FsaXplQmluYXJpZXMgfSBmcm9tICcuLi9hcGkvdW5pdmVyc2FsaXplLmpzJ1xuaW1wb3J0IHsgQmFzZVVuaXZlcnNhbGl6ZUNvbW1hbmQgfSBmcm9tICcuLi9kZWYvdW5pdmVyc2FsaXplLmpzJ1xuXG5leHBvcnQgY2xhc3MgVW5pdmVyc2FsaXplQ29tbWFuZCBleHRlbmRzIEJhc2VVbml2ZXJzYWxpemVDb21tYW5kIHtcbiAgYXN5bmMgZXhlY3V0ZSgpIHtcbiAgICBhd2FpdCB1bml2ZXJzYWxpemVCaW5hcmllcyh0aGlzLmdldE9wdGlvbnMoKSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgdmVyc2lvbiB9IGZyb20gJy4uL2FwaS92ZXJzaW9uLmpzJ1xuaW1wb3J0IHsgQmFzZVZlcnNpb25Db21tYW5kIH0gZnJvbSAnLi4vZGVmL3ZlcnNpb24uanMnXG5cbmV4cG9ydCBjbGFzcyBWZXJzaW9uQ29tbWFuZCBleHRlbmRzIEJhc2VWZXJzaW9uQ29tbWFuZCB7XG4gIGFzeW5jIGV4ZWN1dGUoKSB7XG4gICAgYXdhaXQgdmVyc2lvbih0aGlzLmdldE9wdGlvbnMoKSlcbiAgfVxufVxuIiwiaW1wb3J0IHsgQ2xpIH0gZnJvbSAnY2xpcGFuaW9uJ1xuXG5pbXBvcnQgeyBjb2xsZWN0QXJ0aWZhY3RzIH0gZnJvbSAnLi9hcGkvYXJ0aWZhY3RzLmpzJ1xuaW1wb3J0IHsgYnVpbGRQcm9qZWN0IH0gZnJvbSAnLi9hcGkvYnVpbGQuanMnXG5pbXBvcnQgeyBjcmVhdGVOcG1EaXJzIH0gZnJvbSAnLi9hcGkvY3JlYXRlLW5wbS1kaXJzLmpzJ1xuaW1wb3J0IHsgbmV3UHJvamVjdCB9IGZyb20gJy4vYXBpL25ldy5qcydcbmltcG9ydCB7IHByZVB1Ymxpc2ggfSBmcm9tICcuL2FwaS9wcmUtcHVibGlzaC5qcydcbmltcG9ydCB7IHJlbmFtZVByb2plY3QgfSBmcm9tICcuL2FwaS9yZW5hbWUuanMnXG5pbXBvcnQgeyB1bml2ZXJzYWxpemVCaW5hcmllcyB9IGZyb20gJy4vYXBpL3VuaXZlcnNhbGl6ZS5qcydcbmltcG9ydCB7IHZlcnNpb24gfSBmcm9tICcuL2FwaS92ZXJzaW9uLmpzJ1xuaW1wb3J0IHsgQXJ0aWZhY3RzQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvYXJ0aWZhY3RzLmpzJ1xuaW1wb3J0IHsgQnVpbGRDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9idWlsZC5qcydcbmltcG9ydCB7IENsaVZlcnNpb25Db21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9jbGktdmVyc2lvbi5qcydcbmltcG9ydCB7IENyZWF0ZU5wbURpcnNDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9jcmVhdGUtbnBtLWRpcnMuanMnXG5pbXBvcnQgeyBIZWxwQ29tbWFuZCB9IGZyb20gJy4vY29tbWFuZHMvaGVscC5qcydcbmltcG9ydCB7IE5ld0NvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL25ldy5qcydcbmltcG9ydCB7IFByZVB1Ymxpc2hDb21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy9wcmUtcHVibGlzaC5qcydcbmltcG9ydCB7IFJlbmFtZUNvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL3JlbmFtZS5qcydcbmltcG9ydCB7IFVuaXZlcnNhbGl6ZUNvbW1hbmQgfSBmcm9tICcuL2NvbW1hbmRzL3VuaXZlcnNhbGl6ZS5qcydcbmltcG9ydCB7IFZlcnNpb25Db21tYW5kIH0gZnJvbSAnLi9jb21tYW5kcy92ZXJzaW9uLmpzJ1xuaW1wb3J0IHsgQ0xJX1ZFUlNJT04gfSBmcm9tICcuL3V0aWxzL21pc2MuanMnXG5cbmV4cG9ydCBjb25zdCBjbGkgPSBuZXcgQ2xpKHtcbiAgYmluYXJ5TmFtZTogJ25hcGknLFxuICBiaW5hcnlWZXJzaW9uOiBDTElfVkVSU0lPTixcbn0pXG5cbmNsaS5yZWdpc3RlcihOZXdDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKEJ1aWxkQ29tbWFuZClcbmNsaS5yZWdpc3RlcihDcmVhdGVOcG1EaXJzQ29tbWFuZClcbmNsaS5yZWdpc3RlcihBcnRpZmFjdHNDb21tYW5kKVxuY2xpLnJlZ2lzdGVyKFVuaXZlcnNhbGl6ZUNvbW1hbmQpXG5jbGkucmVnaXN0ZXIoUmVuYW1lQ29tbWFuZClcbmNsaS5yZWdpc3RlcihQcmVQdWJsaXNoQ29tbWFuZClcbmNsaS5yZWdpc3RlcihWZXJzaW9uQ29tbWFuZClcbmNsaS5yZWdpc3RlcihIZWxwQ29tbWFuZClcbmNsaS5yZWdpc3RlcihDbGlWZXJzaW9uQ29tbWFuZClcblxuLyoqXG4gKlxuICogQHVzYWdlXG4gKlxuICogYGBgdHNcbiAqIGNvbnN0IGNsaSA9IG5ldyBOYXBpQ2xpKClcbiAqXG4gKiBjbGkuYnVpbGQoe1xuICogICBjd2Q6ICcvcGF0aC90by95b3VyL3Byb2plY3QnLFxuICogfSlcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgTmFwaUNsaSB7XG4gIGFydGlmYWN0cyA9IGNvbGxlY3RBcnRpZmFjdHNcbiAgbmV3ID0gbmV3UHJvamVjdFxuICBidWlsZCA9IGJ1aWxkUHJvamVjdFxuICBjcmVhdGVOcG1EaXJzID0gY3JlYXRlTnBtRGlyc1xuICBwcmVQdWJsaXNoID0gcHJlUHVibGlzaFxuICByZW5hbWUgPSByZW5hbWVQcm9qZWN0XG4gIHVuaXZlcnNhbGl6ZSA9IHVuaXZlcnNhbGl6ZUJpbmFyaWVzXG4gIHZlcnNpb24gPSB2ZXJzaW9uXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVCdWlsZENvbW1hbmQoYXJnczogc3RyaW5nW10pOiBCdWlsZENvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWydidWlsZCcsIC4uLmFyZ3NdKSBhcyBCdWlsZENvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFydGlmYWN0c0NvbW1hbmQoYXJnczogc3RyaW5nW10pOiBBcnRpZmFjdHNDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsnYXJ0aWZhY3RzJywgLi4uYXJnc10pIGFzIEFydGlmYWN0c0NvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUNyZWF0ZU5wbURpcnNDb21tYW5kKFxuICBhcmdzOiBzdHJpbmdbXSxcbik6IENyZWF0ZU5wbURpcnNDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsnY3JlYXRlLW5wbS1kaXJzJywgLi4uYXJnc10pIGFzIENyZWF0ZU5wbURpcnNDb21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQcmVQdWJsaXNoQ29tbWFuZChhcmdzOiBzdHJpbmdbXSk6IFByZVB1Ymxpc2hDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsncHJlLXB1Ymxpc2gnLCAuLi5hcmdzXSkgYXMgUHJlUHVibGlzaENvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlbmFtZUNvbW1hbmQoYXJnczogc3RyaW5nW10pOiBSZW5hbWVDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsncmVuYW1lJywgLi4uYXJnc10pIGFzIFJlbmFtZUNvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVVuaXZlcnNhbGl6ZUNvbW1hbmQoYXJnczogc3RyaW5nW10pOiBVbml2ZXJzYWxpemVDb21tYW5kIHtcbiAgcmV0dXJuIGNsaS5wcm9jZXNzKFsndW5pdmVyc2FsaXplJywgLi4uYXJnc10pIGFzIFVuaXZlcnNhbGl6ZUNvbW1hbmRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVZlcnNpb25Db21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogVmVyc2lvbkNvbW1hbmQge1xuICByZXR1cm4gY2xpLnByb2Nlc3MoWyd2ZXJzaW9uJywgLi4uYXJnc10pIGFzIFZlcnNpb25Db21tYW5kXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVOZXdDb21tYW5kKGFyZ3M6IHN0cmluZ1tdKTogTmV3Q29tbWFuZCB7XG4gIHJldHVybiBjbGkucHJvY2VzcyhbJ25ldycsIC4uLmFyZ3NdKSBhcyBOZXdDb21tYW5kXG59XG5cbmV4cG9ydCB7IHBhcnNlVHJpcGxlIH0gZnJvbSAnLi91dGlscy90YXJnZXQuanMnXG5leHBvcnQge1xuICB0eXBlIEdlbmVyYXRlVHlwZURlZk9wdGlvbnMsXG4gIHR5cGUgV3JpdGVKc0JpbmRpbmdPcHRpb25zLFxuICB3cml0ZUpzQmluZGluZyxcbiAgZ2VuZXJhdGVUeXBlRGVmLFxufSBmcm9tICcuL2FwaS9idWlsZC5qcydcbmV4cG9ydCB7IHJlYWROYXBpQ29uZmlnIH0gZnJvbSAnLi91dGlscy9jb25maWcuanMnXG4iXSwieF9nb29nbGVfaWdub3JlTGlzdCI6WzE5LDIwLDIxLDIyLDIzLDI0LDI1XSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBSUEsSUFBc0IsdUJBQXRCLGNBQW1EQSxVQUFBQSxRQUFRO0NBQ3pELE9BQU8sUUFBUSxDQUFDLENBQUMsWUFBWSxDQUFDO0NBRTlCLE9BQU8sUUFBUUEsVUFBQUEsUUFBUSxNQUFNLEVBQzNCLGFBQ0UsNkVBQ0gsQ0FBQztDQUVGLE1BQU1DLFVBQUFBLE9BQU8sT0FBTyxTQUFTLFFBQVEsS0FBSyxFQUFFLEVBQzFDLGFBQ0Usc0hBQ0gsQ0FBQztDQUVGLGFBQXNCQSxVQUFBQSxPQUFPLE9BQU8sb0JBQW9CLEVBQ3RELGFBQWEsbUNBQ2QsQ0FBQztDQUVGLGtCQUFrQkEsVUFBQUEsT0FBTyxPQUFPLHVCQUF1QixnQkFBZ0IsRUFDckUsYUFBYSwwQkFDZCxDQUFDO0NBRUYsWUFBWUEsVUFBQUEsT0FBTyxPQUFPLHNCQUFzQixlQUFlLEVBQzdELGFBQ0UsaUdBQ0gsQ0FBQztDQUVGLFNBQVNBLFVBQUFBLE9BQU8sT0FBTyxhQUFhLE9BQU8sRUFDekMsYUFBYSxpREFDZCxDQUFDO0NBRUYsaUJBQTBCQSxV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