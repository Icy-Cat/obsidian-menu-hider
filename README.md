# Menu Hider

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md)

Menu Hider works on the menu itself, not on commands. It reads the entries of
whatever context menu you open — including ones no command registers, in menus
other plugins never touch — so it can hide, reorder, and lift them out of
submenus.

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

## Compared to Commander

[Commander](https://github.com/phibr0/obsidian-commander) can hide menu entries
too, and if that's all you need it's the safer bet — it does a dozen other
things and it's what most vaults already have installed.

The difference is what each plugin can see. Commander matches registered
commands in two hardcoded scopes (`editor-menu` and `file-menu`); entries that
aren't commands, and every other menu, are out of its reach. Menu Hider reads
the menu that actually opened, whatever it is.

|                          | Commander                      | Menu Hider                          |
| ------------------------ | ------------------------------ | ----------------------------------- |
| Menus covered            | editor + file, hardcoded       | any menu, discovered on right-click |
| Granularity              | one list per scope             | per menu                            |
| Matching                 | exact / regex                  | exact title                         |
| Reordering               | its own commands               | any entry                           |
| Promote out of a submenu | —                              | yes                                 |
| Native menus             | supported                      | hiding only (see below)             |

## Native menus

With **Appearance → Native menus** enabled, context menus are drawn by the OS
and there is no menu DOM to work with. Hiding still applies — entries are
dropped before the menu is built — but reordering and promotion don't, because
both need the rendered menu. Turn native menus off to use them.

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

[MIT](LICENSE)
