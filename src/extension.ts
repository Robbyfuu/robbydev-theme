import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const MARKER_START = "/*ROBBYDEV-NEON-START*/";
const MARKER_END = "/*ROBBYDEV-NEON-END*/";
const SCRIPT_FILE = "robbydev-neondreams.js";

type ChecksumResult = { ok: true } | { ok: false; reason: string };

function getWorkbenchRelativePath(): string | null {
	const appRoot = vscode.env.appRoot;
	const candidates = [
		"out/vs/code/electron-sandbox/workbench/workbench.esm.html",
		"out/vs/code/electron-sandbox/workbench/workbench.html",
		"out/vs/workbench/workbench.desktop.main.html",
		"out/vs/workbench/workbench.web.main.html",
	];
	for (const candidate of candidates) {
		const full = path.join(appRoot, candidate);
		if (fs.existsSync(full)) {
			return candidate;
		}
	}
	return null;
}

/** Recalculate the SHA256 checksum of the workbench file and update product.json
 *  so the editor doesn't show a "corrupted installation" warning at startup.
 *
 *  product.json checksum keys are relative to the `out/` directory, so we strip
 *  the leading `out/` segment from the filesystem path before lookup. */
function updateProductChecksum(workbenchRelativePath: string): ChecksumResult {
	const productPath = path.join(vscode.env.appRoot, "product.json");
	if (!fs.existsSync(productPath)) {
		return { ok: false, reason: `product.json not found at ${productPath}` };
	}
	let product: { checksums?: Record<string, string> };
	try {
		product = JSON.parse(fs.readFileSync(productPath, "utf8"));
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `failed to parse product.json: ${msg}` };
	}
	const checksumKey = workbenchRelativePath.replace(/^out\//, "");
	if (!product.checksums) {
		return { ok: false, reason: "product.json has no `checksums` field" };
	}
	if (!(checksumKey in product.checksums)) {
		const sample = Object.keys(product.checksums).slice(0, 3).join(", ");
		return { ok: false, reason: `no checksum entry for ${checksumKey} (available: ${sample}…)` };
	}
	const fullPath = path.join(vscode.env.appRoot, workbenchRelativePath);
	const content = fs.readFileSync(fullPath);
	const hash = crypto.createHash("sha256").update(content).digest("base64").replace(/=+$/, "");
	product.checksums[checksumKey] = hash;
	try {
		fs.writeFileSync(productPath, JSON.stringify(product, null, "\t"), "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, reason: `failed to write product.json (likely a permission issue): ${msg}` };
	}
	return { ok: true };
}

/** Build the runtime script that injects per-token glow.
 *
 *  Strategy: emit ADDITIONAL CSS rules scoped under `.monaco-editor .view-lines`.
 *  The original token color rules in `.vscode-tokens-styles` are left untouched,
 *  and we never add a blanket text-shadow to every span. text-shadow is therefore
 *  physically incapable of applying to chrome elements (status bar, activity bar,
 *  tabs, etc.) — that was the cause of the items-disappearing bug in v2.0.6 / v2.0.7. */
function buildNeonScript(brightness: number, disableGlow: boolean): string {
	const safeBrightness = Math.max(0, Math.min(1, brightness));
	return `(function () {
	var BRIGHTNESS = ${safeBrightness};
	var ACCENT = "#ff4be9";
	var DISABLE_GLOW = ${disableGlow};
	var BLUR = (6 * BRIGHTNESS).toFixed(2) + "px";

	function buildShadowRules(sourceCss) {
		var rules = [];
		var ruleRe = /([^{}]+?)\\s*\\{\\s*([^{}]*?)\\s*\\}/g;
		var colorRe = /color:\\s*(#[0-9a-fA-F]{6,8})/i;
		var m;
		while ((m = ruleRe.exec(sourceCss)) !== null) {
			var selectorList = m[1].trim();
			var body = m[2];
			var colorMatch = body.match(colorRe);
			if (!colorMatch || !selectorList) continue;
			var color = colorMatch[1];
			var prefixed = selectorList.split(",").map(function (s) {
				return ".monaco-editor .view-lines " + s.trim();
			}).join(", ");
			rules.push(prefixed + " { text-shadow: 0 0 " + BLUR + " " + color + "; }");
		}
		return rules;
	}

	function buildCss(sourceCss) {
		var parts = DISABLE_GLOW ? [] : buildShadowRules(sourceCss);
		parts.push(
			".monaco-editor .cursors-layer .cursor {" +
			" background-color: " + ACCENT + " !important;" +
			" border-color: " + ACCENT + " !important;" +
			" box-shadow: 0 0 " + (4 * BRIGHTNESS).toFixed(2) + "px " + ACCENT + "," +
			" 0 0 " + (12 * BRIGHTNESS).toFixed(2) + "px " + ACCENT + ";" +
			" }"
		);
		return parts.join("\\n");
	}

	function ensureBodyFontSize() {
		// Some Cursor versions ship a workbench.main.css where the body has a
		// non-zero font-size, which breaks the status bar / chrome layout once
		// glow rules force a recompute. Fix it defensively at runtime — only if
		// it's actually wrong, so we don't disturb editors that already have 0px.
		try {
			var current = window.getComputedStyle(document.body).fontSize;
			if (current && current !== "0px") {
				document.body.style.fontSize = "0px";
				console.log("[RobbyDev] forced body font-size 0px (was " + current + ")");
			}
		} catch (_e) {}
	}

	function apply() {
		var el = document.querySelector(".vscode-tokens-styles");
		if (!el || !el.innerText || el.innerText.indexOf("color:") === -1) return false;
		var existing = document.getElementById("robbydev-neon-dreams");
		if (existing) existing.parentNode.removeChild(existing);
		var style = document.createElement("style");
		style.id = "robbydev-neon-dreams";
		style.textContent = buildCss(el.innerText);
		document.body.appendChild(style);
		ensureBodyFontSize();
		try {
			var n = (style.textContent.match(/text-shadow/g) || []).length;
			console.log("[RobbyDev] Neon Dreams applied — " + n + " token rules + cursor");
		} catch (_e) {}
		return true;
	}

	function bootstrap() {
		if (apply()) return;
		var attempts = 0;
		var observer = new MutationObserver(function () {
			attempts++;
			if (apply() || attempts > 200) observer.disconnect();
		});
		observer.observe(document.body, { childList: true, subtree: true, attributes: true });
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bootstrap);
	} else {
		bootstrap();
	}
})();
`;
}

function stripPatch(html: string): string {
	const startIdx = html.indexOf(MARKER_START);
	const endIdx = html.indexOf(MARKER_END);
	if (startIdx === -1 || endIdx === -1) {
		return html;
	}
	return html.slice(0, startIdx) + html.slice(endIdx + MARKER_END.length);
}

async function promptRestart(message: string): Promise<void> {
	const choice = await vscode.window.showInformationMessage(message, "Restart editor");
	if (choice === "Restart editor") {
		await vscode.commands.executeCommand("workbench.action.reloadWindow");
	}
}

async function enableNeonDreams(_context: vscode.ExtensionContext): Promise<void> {
	const workbenchRel = getWorkbenchRelativePath();
	const workbenchPath = workbenchRel ? path.join(vscode.env.appRoot, workbenchRel) : null;
	if (!workbenchPath || !workbenchRel) {
		vscode.window.showErrorMessage(
			"RobbyDev: could not locate the workbench HTML file. Your editor build may not be supported."
		);
		return;
	}

	let html: string;
	try {
		html = fs.readFileSync(workbenchPath, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`RobbyDev: cannot read workbench file. ${msg}`);
		return;
	}

	html = stripPatch(html);

	const config = vscode.workspace.getConfiguration("robbydev");
	const brightnessRaw = config.get<number>("neonBrightness", 0.45);
	const brightness = Math.max(0, Math.min(1, brightnessRaw));
	const disableGlow = config.get<boolean>("disableGlow", false);

	// Write the script next to workbench.html. Same-origin script src is allowed by
	// the CSP `script-src` directive (which permits `'self'`), unlike inline scripts.
	const scriptPath = path.join(path.dirname(workbenchPath), SCRIPT_FILE);
	try {
		fs.writeFileSync(scriptPath, buildNeonScript(brightness, disableGlow), "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(
			`RobbyDev: failed to write Neon Dreams script. On macOS/Linux you may need write permission on the install directory; on Windows run the editor as administrator. ${msg}`
		);
		return;
	}

	const injection = `${MARKER_START}<script src="${SCRIPT_FILE}"></script>${MARKER_END}`;
	html = html.replace("</html>", `${injection}\n</html>`);

	try {
		fs.writeFileSync(workbenchPath, html, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(
			`RobbyDev: failed to write workbench file. On macOS/Linux you may need write permission on the install directory; on Windows run the editor as administrator. ${msg}`
		);
		return;
	}

	const checksumResult = updateProductChecksum(workbenchRel);
	if (!checksumResult.ok) {
		vscode.window.showWarningMessage(
			`RobbyDev: glow enabled, but the corruption warning could not be silenced. ${checksumResult.reason}`
		);
	}

	await promptRestart("RobbyDev Neon Dreams enabled. Restart the editor to see the glow.");
}

async function disableNeonDreams(): Promise<void> {
	const workbenchRel = getWorkbenchRelativePath();
	const workbenchPath = workbenchRel ? path.join(vscode.env.appRoot, workbenchRel) : null;
	if (!workbenchPath || !workbenchRel) {
		vscode.window.showErrorMessage("RobbyDev: could not locate the workbench HTML file.");
		return;
	}

	let html: string;
	try {
		html = fs.readFileSync(workbenchPath, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`RobbyDev: cannot read workbench file. ${msg}`);
		return;
	}

	if (!html.includes(MARKER_START)) {
		vscode.window.showInformationMessage("RobbyDev: glow is not currently active.");
		return;
	}

	html = stripPatch(html);

	try {
		fs.writeFileSync(workbenchPath, html, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(`RobbyDev: failed to write workbench file. ${msg}`);
		return;
	}

	// Best-effort cleanup of the script file. Failure here is non-fatal.
	const scriptPath = path.join(path.dirname(workbenchPath), SCRIPT_FILE);
	try {
		if (fs.existsSync(scriptPath)) {
			fs.unlinkSync(scriptPath);
		}
	} catch {
		// ignore — disabling already removed the script reference
	}

	updateProductChecksum(workbenchRel);

	await promptRestart("RobbyDev Neon Dreams disabled. Restart the editor.");
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("robbydev.enableNeonDreams", () => enableNeonDreams(context)),
		vscode.commands.registerCommand("robbydev.disableNeonDreams", () => disableNeonDreams())
	);
}

export function deactivate(): void {
	// no-op — we intentionally leave the workbench patch in place across reloads
}
