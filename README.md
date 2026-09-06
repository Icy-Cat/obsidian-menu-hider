# Menu Hider

Trim Obsidian's context menus down to what you actually use: hide entries and
separators, reorder them, and pull a submenu entry up into the top level.

## Features

- **Automatic discovery** — right-click anywhere and the menu you opened is
  registered as its own tab in settings, entries and icons included. Nothing is
  hardcoded, so menu entries added by other plugins show up too.
- **Hide entries and separators** — click the eye next to a row. Groups that end
  up empty are hidden along with their divider.
- **Reorder** — drag rows within a separator-bounded segment.
- **Promote submenu entries** — drag an entry out of a submenu to clone it into
  the top-level menu, placed right after its parent; drag it back to undo.
- **Copy absolute paths** (opt-in) — select files in the file explorer and press
  `Ctrl`/`Cmd`+`C` to copy their absolute paths to the clipboard.
- English, 简体中文 and 繁體中文, following the app language.

## Usage

1. Right-click the element whose menu you want to trim (a file, a folder, a tab,
   the editor…). This registers the menu.
2. Open **Settings → Menu Hider**, pick the menu's tab, and click the eye icon
   next to the entries you want gone.
3. Drag the grip handle to reorder, or drag an entry out of a submenu to promote
   it.

The refresh button re-collects a menu without leaving settings; for menus that
can't be synthesized (multi-file selection, URL menus) right-click the real
element instead.

## How it works, and what that costs

Obsidian exposes no API for reading or filtering the entries of a context menu,
so the plugin wraps `Menu.prototype.showAtPosition` — the single method every
`Menu.show*` path ends in. Wrapping it lets the plugin read the entries just
before the menu is measured and painted, which is what makes hiding flicker-free
and keyboard navigation correct.

Consequences worth knowing:

- The wrapper is installed on load and removed on unload; nothing is patched
  permanently.
- Every call is wrapped in `try`/`catch`, so a failure inside the plugin logs to
  the console and lets the original method run untouched.
- `showAtPosition` is not part of the public API. If Obsidian changes it, menus
  keep working and the plugin simply stops trimming them.

Entries are matched by their visible title, so a menu entry that changes its
label (localization, a plugin update) needs to be hidden again.

## Installation

**Manual** — download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/Icy-Cat/obsidian-menu-hider/releases/latest)
into `<vault>/.obsidian/plugins/menu-hider/`, then enable the plugin in
**Settings → Community plugins**.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
npm run lint
```

Desktop only: absolute paths require a filesystem vault.

## License

[0BSD](LICENSE)
