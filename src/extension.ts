import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const MARKER_START = "/*ROBBYDEV-NEON-START*/";
const MARKER_END = "/*ROBBYDEV-NEON-END*/";
const SCRIPT_FILE = "robbydev-neondreams.js";

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
function updateProductChecksum(workbenchRelativePath: string): boolean {
	const productPath = path.join(vscode.env.appRoot, "product.json");
	if (!fs.existsSync(productPath)) {
		return false;
	}
	let product: { checksums?: Record<string, string> };
	try {
		product = JSON.parse(fs.readFileSync(productPath, "utf8"));
	} catch {
		return false;
	}
	const checksumKey = workbenchRelativePath.replace(/^out\//, "");
	if (!product.checksums || !(checksumKey in product.checksums)) {
		return false;
	}
	const fullPath = path.join(vscode.env.appRoot, workbenchRelativePath);
	const content = fs.readFileSync(fullPath);
	const hash = crypto.createHash("sha256").update(content).digest("base64").replace(/=+$/, "");
	product.checksums[checksumKey] = hash;
	try {
		fs.writeFileSync(productPath, JSON.stringify(product, null, "\t"), "utf8");
		return true;
	} catch {
		return false;
	}
}

/** Build the runtime script that injects per-token glow.
 *
 *  Strategy (ported from SynthWave '84): wait for Monaco's `.vscode-tokens-styles`
 *  element to populate, then create a NEW <style> tag that mirrors its rules with
 *  text-shadow added to each `color: #xxx;` declaration. This scopes the glow to
 *  actual token color rules (`.mtk1`, `.mtk2`, …) instead of every span in the
 *  editor — which avoids the chrome-bar layout glitches caused by broad text-shadow
 *  selectors. */
function buildNeonScript(brightness: number, disableGlow: boolean): string {
	const safeBrightness = Math.max(0, Math.min(1, brightness));
	return `(function () {
	var BRIGHTNESS = ${safeBrightness};
	var ACCENT = "#ff4be9";
	var DISABLE_GLOW = ${disableGlow};

	function buildAugmentedCss(sourceCss) {
		var augmented = DISABLE_GLOW
			? sourceCss
			: sourceCss.replace(/color:\\s*(#[0-9a-fA-F]{6,8});/g, function (_m, color) {
				return "color: " + color
					+ "; text-shadow: 0 0 " + (6 * BRIGHTNESS).toFixed(2) + "px " + color
					+ "; backface-visibility: hidden;";
			});
		augmented += "\\n.monaco-editor .cursors-layer .cursor {"
			+ " background-color: " + ACCENT + " !important;"
			+ " border-color: " + ACCENT + " !important;"
			+ " box-shadow: 0 0 " + (4 * BRIGHTNESS).toFixed(2) + "px " + ACCENT + ","
			+ " 0 0 " + (12 * BRIGHTNESS).toFixed(2) + "px " + ACCENT + ";"
			+ " }";
		return augmented;
	}

	function apply() {
		var el = document.querySelector(".vscode-tokens-styles");
		if (!el || !el.innerText || el.innerText.indexOf("color:") === -1) {
			return false;
		}
		var existing = document.getElementById("robbydev-neon-dreams");
		if (existing) {
			existing.parentNode.removeChild(existing);
		}
		var style = document.createElement("style");
		style.id = "robbydev-neon-dreams";
		style.textContent = buildAugmentedCss(el.innerText);
		document.body.appendChild(style);
		return true;
	}

	function bootstrap() {
		if (apply()) {
			return;
		}
		var attempts = 0;
		var observer = new MutationObserver(function () {
			attempts++;
			if (apply() || attempts > 200) {
				observer.disconnect();
			}
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

	const checksumFixed = updateProductChecksum(workbenchRel);
	const checksumNote = checksumFixed
		? ""
		: " (Note: could not silence the corruption warning automatically — dismiss it on startup.)";

	await promptRestart(
		`RobbyDev Neon Dreams enabled. Restart the editor to see the glow.${checksumNote}`
	);
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
