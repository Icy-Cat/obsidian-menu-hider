import { Menu, Plugin, TFile, TFolder, TAbstractFile, Editor, MarkdownView, Notice } from 'obsidian';
import { MenuHiderSettings, DEFAULT_SETTINGS, MenuHiderSettingTab } from './settings';
import { initLocale, t } from './i18n';

export type MenuType = 'file-menu-file' | 'file-menu-folder' | 'editor-menu' | 'files-menu' | 'url-menu' | 'tab-menu';

export const ALL_MENU_TYPES: MenuType[] = [
	'file-menu-file',
	'file-menu-folder',
	'editor-menu',
	'tab-menu',
	'files-menu',
	'url-menu',
];

export interface CollectedMenuItem {
	type: 'item';
	title: string;
	icon?: string;
	children?: CollectedEntry[];
}

export interface CollectedSeparator {
	type: 'separator';
}

export type CollectedEntry = CollectedMenuItem | CollectedSeparator;

function emptyEntries(): Record<MenuType, CollectedEntry[]> {
	return {
		'file-menu-file': [],
		'file-menu-folder': [],
		'editor-menu': [],
		'files-menu': [],
		'url-menu': [],
		'tab-menu': [],
	};
}

export default class MenuHiderPlugin extends Plugin {
	settings: MenuHiderSettings;
	collectedEntries: Record<MenuType, CollectedEntry[]> = emptyEntries();

	private observer: MutationObserver | null = null;
	private lastMenuType: MenuType | null = null;
	private collectMode = false;

	async onload() {
		await this.loadSettings();
		initLocale();

		if (this.settings.savedEntries) {
			this.collectedEntries = { ...emptyEntries(), ...this.settings.savedEntries };
		}

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile, source: string) => {
				if (this.lastMenuType === 'tab-menu') return;
				const menuType: MenuType = file instanceof TFolder ? 'file-menu-folder' : 'file-menu-file';
				this.lastMenuType = menuType;
				if (!this.collectMode) this.deferCollectFromDom(menu, menuType);
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				this.lastMenuType = 'editor-menu';
				if (!this.collectMode) this.deferCollectFromDom(menu, 'editor-menu');
			})
		);

		this.registerEvent(
			// @ts-ignore
			this.app.workspace.on('files-menu', (menu: Menu, files: TAbstractFile[], source: string) => {
				this.lastMenuType = 'files-menu';
				if (!this.collectMode) this.deferCollectFromDom(menu, 'files-menu');
			})
		);

		this.registerEvent(
			// @ts-ignore
			this.app.workspace.on('url-menu', (menu: Menu, url: string) => {
				this.lastMenuType = 'url-menu';
				if (!this.collectMode) this.deferCollectFromDom(menu, 'url-menu');
			})
		);

		this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement;
			if (target?.closest('.workspace-tab-header')) {
				this.lastMenuType = 'tab-menu';
			}
		}, true);

		this.setupDomObserver();
		this.addSettingTab(new MenuHiderSettingTab(this.app, this));
	}

	onunload() {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	private deferCollectFromDom(_menu: Menu, menuType: MenuType) {
		setTimeout(() => {
			const dom = (_menu as any).dom as HTMLElement | undefined;
			if (!dom) return;
			const entries = this.readEntriesFromDom(dom);
			if (entries.length > 0) {
				this.collectedEntries[menuType] = entries;
				this.persistEntries();
			}
		}, 0);
	}

	private addSeparator(entries: CollectedEntry[]) {
		const last = entries[entries.length - 1];
		if (entries.length > 0 && last && last.type !== 'separator') {
			entries.push({ type: 'separator' });
		}
	}

	private readEntriesFromDom(dom: HTMLElement): CollectedEntry[] {
		const scrollEl = dom.querySelector('.menu-scroll') || dom;
		const entries: CollectedEntry[] = [];

		for (const child of Array.from(scrollEl.children) as HTMLElement[]) {
			if (child.classList.contains('menu-separator')) {
				this.addSeparator(entries);
			} else if (child.classList.contains('menu-group')) {
				this.addSeparator(entries);
				for (const item of Array.from(child.children) as HTMLElement[]) {
					if (item.classList.contains('menu-item')) {
						this.collectSingleItem(item, entries);
					} else if (item.classList.contains('menu-separator')) {
						this.addSeparator(entries);
					}
				}
			} else if (child.classList.contains('menu-item')) {
				this.collectSingleItem(child, entries);
			}
		}

		while (entries.length > 0 && entries[entries.length - 1]?.type === 'separator') {
			entries.pop();
		}
		return entries;
	}

	private collectSingleItem(el: HTMLElement, entries: CollectedEntry[]) {
		const title = el.querySelector('.menu-item-title')?.textContent?.trim();
		if (!title) return;
		const icon = this.detectIconFromDom(el);
		const hasSubmenu = !!el.querySelector('.menu-item-title ~ .menu-item-icon');
		entries.push({
			type: 'item',
			title,
			icon: icon || undefined,
			children: hasSubmenu ? [] : undefined,
		});
	}

	private detectIconFromDom(itemEl: HTMLElement): string | undefined {
		const iconContainer = itemEl.querySelector('.menu-item-icon');
		if (!iconContainer) return undefined;
		const svg = iconContainer.querySelector('svg');
		if (!svg) return undefined;

		const dataIcon = svg.getAttribute('data-icon');
		if (dataIcon) return dataIcon;

		for (const cls of Array.from(svg.classList)) {
			if (cls.startsWith('lucide-')) return cls.substring(7);
		}

		const parent = svg.closest('[data-icon]');
		if (parent) return parent.getAttribute('data-icon') || undefined;

		return undefined;
	}

	async triggerCollectAll(): Promise<void> {
		const collectible: MenuType[] = ['file-menu-file', 'file-menu-folder', 'editor-menu'];
		for (const menuType of collectible) {
			await this.triggerCollect(menuType);
		}
		new Notice(t('notice.passive-hint'));
	}

	async triggerCollect(menuType: MenuType): Promise<boolean> {
		let targetEl: Element | null = null;

		switch (menuType) {
			case 'file-menu-folder': {
				const leaves = this.app.workspace.getLeavesOfType('file-explorer');
				const leaf = leaves[0];
				if (leaf && leaf.view) {
					const containerEl = (leaf.view as any).containerEl as HTMLElement | undefined;
					if (containerEl) {
						targetEl = containerEl.querySelector('.nav-folder-title');
					}
				}
				if (!targetEl) return false;
				break;
			}
			case 'file-menu-file': {
				const leaves = this.app.workspace.getLeavesOfType('file-explorer');
				const leaf = leaves[0];
				if (leaf && leaf.view) {
					const containerEl = (leaf.view as any).containerEl as HTMLElement | undefined;
					if (containerEl) {
						targetEl = containerEl.querySelector('.nav-file-title');
					}
				}
				if (!targetEl) return false;
				break;
			}
			case 'editor-menu': {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				targetEl = view.contentEl.querySelector('.cm-content') || view.contentEl;
				break;
			}
			case 'tab-menu':
			case 'files-menu':
			case 'url-menu':
				return false;
		}

		if (!targetEl) return false;
		this.collectMode = true;

		const rect = targetEl.getBoundingClientRect();
		targetEl.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: rect.left + Math.min(rect.width / 2, 20),
			clientY: rect.top + Math.min(rect.height / 2, 10),
		}));

		await new Promise<void>(r => setTimeout(r, 200));

		const menuDom = document.querySelector('.menu') as HTMLElement | null;
		if (menuDom) {
			const entries = this.readEntriesFromDom(menuDom);
			await this.collectSubmenusViaDom(menuDom, entries);

			if (entries.length > 0) {
				this.collectedEntries[menuType] = entries;
				this.persistEntries();
			}
		}

		document.querySelectorAll('.menu').forEach(m => m.remove());
		await new Promise<void>(r => setTimeout(r, 50));
		this.collectMode = false;

		return this.collectedEntries[menuType].length > 0;
	}

	private async collectSubmenusViaDom(menuDom: HTMLElement, entries: CollectedEntry[]) {
		const allItems = menuDom.querySelectorAll('.menu-item');
		for (const itemEl of Array.from(allItems) as HTMLElement[]) {
			if (!itemEl.querySelector('.menu-item-title ~ .menu-item-icon')) continue;

			const title = itemEl.querySelector('.menu-item-title')?.textContent?.trim();
			if (!title) continue;

			itemEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
			itemEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

			await new Promise<void>(r => setTimeout(r, 250));

			const allMenus = document.querySelectorAll('.menu');
			for (const m of Array.from(allMenus)) {
				if (m instanceof HTMLElement && m !== menuDom) {
					m.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
					const children = this.readEntriesFromDom(m);
					const parentEntry = entries.find(e => e.type === 'item' && e.title === title);
					if (parentEntry && parentEntry.type === 'item' && children.length > 0) {
						parentEntry.children = children;
					}
					m.remove();
					break;
				}
			}

			itemEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
			await new Promise<void>(r => setTimeout(r, 50));
		}
	}

	private setupDomObserver() {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement) || !node.classList.contains('menu')) continue;

					if (this.collectMode) {
						// Use opacity:0 instead of visibility:hidden so hover events still work for submenu collection
						node.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
						return;
					}

					const menuType = this.lastMenuType;
					if (menuType) {
						if (menuType === 'tab-menu') {
							setTimeout(() => {
								const entries = this.readEntriesFromDom(node);
								if (entries.length > 0) {
									this.collectedEntries['tab-menu'] = entries;
									this.persistEntries();
								}
							}, 0);
						}
						this.hideMenuItems(node, menuType);
						this.lastMenuType = null;
					}
				}
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	private hideMenuItems(menuEl: HTMLElement, menuType: MenuType) {
		const hiddenTitles = new Set(this.settings.hiddenItems[menuType]);
		const hiddenSeps = new Set(this.settings.hiddenSeparators[menuType]);
		if (hiddenTitles.size === 0 && hiddenSeps.size === 0) return;

		const scrollEl = menuEl.querySelector('.menu-scroll') || menuEl;

		// Build separator targets using the same dedup logic as readEntriesFromDom
		type SepTarget = { type: 'dom'; el: HTMLElement } | { type: 'group'; el: HTMLElement };
		const sepTargets: SepTarget[] = [];
		let lastWasItem = false;

		const pushSep = (target: SepTarget) => {
			if (lastWasItem) {
				sepTargets.push(target);
				lastWasItem = false;
			}
		};

		for (const child of Array.from(scrollEl.children) as HTMLElement[]) {
			if (child.classList.contains('menu-separator')) {
				pushSep({ type: 'dom', el: child });
			} else if (child.classList.contains('menu-group')) {
				pushSep({ type: 'group', el: child });

				for (const item of Array.from(child.children) as HTMLElement[]) {
					if (item.classList.contains('menu-item')) {
						lastWasItem = true;
					} else if (item.classList.contains('menu-separator')) {
						pushSep({ type: 'dom', el: item });
					}
				}
			} else if (child.classList.contains('menu-item')) {
				lastWasItem = true;
			}
		}

		// Hide items by title
		const allItems = menuEl.querySelectorAll('.menu-item');
		for (const item of Array.from(allItems)) {
			const title = item.querySelector('.menu-item-title')?.textContent?.trim();
			if (title && hiddenTitles.has(title)) {
				(item as HTMLElement).style.display = 'none';
			}
		}

		// Hide separators by index
		for (let i = 0; i < sepTargets.length; i++) {
			if (!hiddenSeps.has(i)) continue;
			const t = sepTargets[i];
			if (!t) continue;
			if (t.type === 'dom') {
				t.el.style.display = 'none';
			} else {
				t.el.classList.add('menu-hider-no-border');
			}
		}

		// Hide groups where all items are hidden
		const groups = scrollEl.querySelectorAll('.menu-group');
		for (const group of Array.from(groups) as HTMLElement[]) {
			const visible = group.querySelectorAll('.menu-item:not([style*="display: none"])');
			if (visible.length === 0) {
				group.style.display = 'none';
			}
		}
	}

	private async persistEntries() {
		this.settings.savedEntries = this.collectedEntries;
		await this.saveSettings();
	}

	async loadSettings() {
		const data = await this.loadData() as Partial<MenuHiderSettings> | null;
		const defaultHidden: Record<string, string[]> = {};
		const defaultSeps: Record<string, number[]> = {};
		for (const mt of ALL_MENU_TYPES) {
			defaultHidden[mt] = [];
			defaultSeps[mt] = [];
		}
		this.settings = {
			hiddenItems: { ...defaultHidden, ...data?.hiddenItems } as Record<MenuType, string[]>,
			hiddenSeparators: { ...defaultSeps, ...data?.hiddenSeparators } as Record<MenuType, number[]>,
			savedEntries: data?.savedEntries || undefined,
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
