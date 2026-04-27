import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const MARKER_START = "/*ROBBYDEV-NEON-START*/";
const MARKER_END = "/*ROBBYDEV-NEON-END*/";

function getWorkbenchPath(): string | null {
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
			return full;
		}
	}
	return null;
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
	const workbenchPath = getWorkbenchPath();
	if (!workbenchPath) {
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

	const injection =
		`${MARKER_START}<script>(function(){var s=document.createElement('style');` +
		`s.id='robbydev-neon-dreams';s.textContent=${JSON.stringify(css)};` +
		`document.head.appendChild(s);})();</script>${MARKER_END}`;

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

	await promptRestart("RobbyDev Neon Dreams enabled. Restart the editor to see the glow.");
}

async function disableNeonDreams(): Promise<void> {
	const workbenchPath = getWorkbenchPath();
	if (!workbenchPath) {
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
