import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const MARKER_START = "/*ROBBYDEV-NEON-START*/";
const MARKER_END = "/*ROBBYDEV-NEON-END*/";

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

function getWorkbenchPath(): string | null {
	const rel = getWorkbenchRelativePath();
	return rel ? path.join(vscode.env.appRoot, rel) : null;
}

/** Recalculate the SHA256 checksum of the workbench file and update product.json
 *  so the editor doesn't show a "corrupted installation" warning at startup. */
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
	if (!product.checksums || !(workbenchRelativePath in product.checksums)) {
		return false;
	}
	const fullPath = path.join(vscode.env.appRoot, workbenchRelativePath);
	const content = fs.readFileSync(fullPath);
	const hash = crypto.createHash("sha256").update(content).digest("base64").replace(/=+$/, "");
	product.checksums[workbenchRelativePath] = hash;
	try {
		fs.writeFileSync(productPath, JSON.stringify(product, null, "\t"), "utf8");
		return true;
	} catch {
		return false;
	}
}

function readCss(context: vscode.ExtensionContext, brightness: number, disableGlow: boolean): string {
	const cssPath = path.join(context.extensionPath, "css", "editor_chrome.css");
	let css = fs.readFileSync(cssPath, "utf8");
	css = css.replace(/__BRIGHTNESS__/g, String(brightness));
	if (disableGlow) {
		css = css.replace("/* GLOW_BLOCK_START */", "/* GLOW_BLOCK_START */ /*").replace("/* GLOW_BLOCK_END */", "*/ /* GLOW_BLOCK_END */");
	}
	return css;
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

async function enableNeonDreams(context: vscode.ExtensionContext): Promise<void> {
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

	const css = readCss(context, brightness, disableGlow);

	// CSP in modern editors blocks inline <script> (script-src lacks 'unsafe-inline'),
	// but allows inline <style> via 'unsafe-inline' in style-src. Inject <style> directly.
	const injection = `${MARKER_START}<style id="robbydev-neon-dreams">\n${css}\n</style>${MARKER_END}`;

	html = html.replace("</html>", `${injection}\n</html>`);

	try {
		fs.writeFileSync(workbenchPath, html, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		vscode.window.showErrorMessage(
			`RobbyDev: failed to write workbench file. On macOS/Linux you may need write permissions on the install directory; on Windows run the editor as administrator. ${msg}`
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
