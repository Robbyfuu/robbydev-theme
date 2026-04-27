# Changelog

All notable changes to the RobbyDev theme are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] — 2026-04-27

### Fixed
- Neon Dreams glow now actually applies. Previous version injected an inline `<script>` which is blocked by the editor's Content Security Policy (`script-src` lacks `'unsafe-inline'`). Switched to a direct `<style>` element injection, which `style-src 'unsafe-inline'` permits. After updating, run **RobbyDev: Enable Neon Dreams** again and restart.

## [2.0.0] — 2026-04-26

### Added
- **Neon Dreams** optional glow effect — each token glows in its own RobbyDev color, cursor pulses in signature magenta
- Commands: `RobbyDev: Enable Neon Dreams` / `RobbyDev: Disable Neon Dreams`
- Settings: `robbydev.neonBrightness` (0–1, default 0.45), `robbydev.disableGlow` (boolean)
- TypeScript extension scaffolding (esbuild bundle, tsconfig, types)

### Changed
- **BREAKING (mechanism, not user-facing):** extension now ships with a `main` entry. Theme-only users are unaffected; the glow is opt-in via command.
- Description updated to mention glow capability

### Notes
- Glow patches `workbench.html` in the editor install directory. Editor updates revert the patch — re-run the enable command.
- macOS/Linux require write permission on the install dir; Windows may need administrator privileges.

## [1.2.0] — 2026-04-26

### Added
- README with screenshots, color reference, and language support
- Extension icon (128×128)
- `gallery banner` for marketplace listing
- Repository / homepage / bugs links in `package.json`
- More keywords for marketplace discoverability
- `.vscodeignore` to slim down published package

### Changed
- **RobbyDev Mirage**: brighter, more vivid palette (Ayu Dark inspired)
  - Keywords / modifiers / numbers: `#c3a6ff` → `#d2a6ff`
  - Functions / methods: `#ffd580` → `#ffb454`
  - Operators / constants: `#ffae57` → `#ff8f40`
  - Strings / regex: `#bae67e` → `#aad94c`
  - Types / classes: `#5ccfe6` → `#59c2ff`
  - Variables / text: `#a2aabc` / `#d7dce2` → `#cbccc6`
  - Errors: `#ef6b73` → `#f26d78`

## [1.1.0] — 2026-04-26

### Added
- **RobbyDev Mirage** variant — black background with Ayu Mirage-inspired syntax palette

## [1.0.3] — 2026-04-26

### Fixed
- Publisher namespace lowercased (`robbyfuu`) for marketplace compatibility
- Removed leftover install metadata from `package.json`
- Repository field added

## [1.0.2] — Initial public release

### Added
- **RobbyDev** — deep navy-black theme with neon magenta accents
- **RobbyDev Black** — pure black variant
- Syntax support for 20+ languages
- Semantic token highlighting
