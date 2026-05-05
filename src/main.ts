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
	private pendingMenu: Menu | null = null;

	async onload() {
		await this.loadSettings();
		initLocale();

		if (this.settings.savedEntries) {
			this.collectedEntries = { ...emptyEntries(), ...this.settings.savedEntries };
		}

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile, source: string) => {
				const menuType: MenuType = file instanceof TFolder ? 'file-menu-folder' : 'file-menu-file';
				this.lastMenuType = menuType;
				if (this.collectMode) {
					this.pendingMenu = menu;
				} else {
					this.deferCollectFromDom(menu, menuType);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
				this.lastMenuType = 'editor-menu';
				if (this.collectMode) {
					this.pendingMenu = menu;
				} else {
					this.deferCollectFromDom(menu, 'editor-menu');
				}
			})
		);

		this.registerEvent(
			// @ts-ignore
			this.app.workspace.on('files-menu', (menu: Menu, files: TAbstractFile[], source: string) => {
				this.lastMenuType = 'files-menu';
				if (this.collectMode) {
					this.pendingMenu = menu;
				} else {
					this.deferCollectFromDom(menu, 'files-menu');
				}
			})
		);

		this.registerEvent(
			// @ts-ignore
			this.app.workspace.on('url-menu', (menu: Menu, url: string) => {
				this.lastMenuType = 'url-menu';
				if (this.collectMode) {
					this.pendingMenu = menu;
				} else {
					this.deferCollectFromDom(menu, 'url-menu');
				}
			})
		);

		// Tab header context menu — no workspace event, detect via DOM
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

	private deferCollectFromDom(menu: Menu, menuType: MenuType) {
		setTimeout(() => {
			const dom = (menu as any).dom as HTMLElement | undefined;
			if (!dom) return;
			const entries = this.readEntriesFromDom(dom);
			this.attachSubmenusFromMenu(entries, menu);
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

	private getItemIcon(item: any): string | undefined {
		if (typeof item.icon === 'string' && item.icon) return item.icon;
		if (item.iconEl) {
			const svg = item.iconEl.querySelector('svg');
			if (svg) {
				const dataIcon = svg.getAttribute('data-icon');
				if (dataIcon) return dataIcon;
				for (const cls of Array.from(svg.classList) as string[]) {
					if (cls.startsWith('lucide-')) return cls.substring(7);
				}
			}
		}
		if (item.dom) {
			return this.detectIconFromDom(item.dom);
		}
		return undefined;
	}

	async triggerCollectAll(): Promise<void> {
		const collectible: MenuType[] = ['file-menu-file', 'file-menu-folder', 'editor-menu', 'tab-menu'];
		for (const menuType of collectible) {
			await this.triggerCollect(menuType);
		}
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
			case 'tab-menu': {
				targetEl = document.querySelector('.workspace-tab-header.is-active');
				if (!targetEl) targetEl = document.querySelector('.workspace-tab-header');
				if (!targetEl) return false;
				break;
			}
			case 'url-menu': {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				targetEl = view.contentEl.querySelector('a.external-link')
					|| view.contentEl.querySelector('.cm-url')
					|| view.contentEl.querySelector('a[href]');
				if (!targetEl) {
					new Notice(t('notice.right-click-url'));
					return false;
				}
				break;
			}
			case 'files-menu':
				return false;
		}

		if (!targetEl) return false;
		this.collectMode = true;
		this.pendingMenu = null;

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

			if (this.pendingMenu) {
				this.attachSubmenusFromMenu(entries, this.pendingMenu);
			}

			if (entries.length > 0) {
				this.collectedEntries[menuType] = entries;
				this.persistEntries();
			}
		}

		document.querySelectorAll('.menu').forEach(m => m.remove());
		await new Promise<void>(r => setTimeout(r, 50));
		this.collectMode = false;
		this.pendingMenu = null;

		return this.collectedEntries[menuType].length > 0;
	}

	private attachSubmenusFromMenu(entries: CollectedEntry[], menu: Menu) {
		const internalItems = (menu as any).items as any[] | undefined;
		if (!internalItems) return;

		for (const item of internalItems) {
			const submenu = item.submenu as Menu | null | undefined;
			if (!submenu) continue;

			const title = this.getItemTitle(item);
			if (!title) continue;

			const parentEntry = entries.find(e => e.type === 'item' && e.title === title);
			if (!parentEntry || parentEntry.type !== 'item') continue;

			const submenuItems = (submenu as any).items as any[] | undefined;
			if (!submenuItems || submenuItems.length === 0) continue;

			const children: CollectedEntry[] = [];
			for (const si of submenuItems) {
				const siTitle = this.getItemTitle(si);
				if (siTitle) {
					children.push({
						type: 'item',
						title: siTitle,
						icon: this.getItemIcon(si),
					});
				}
			}
			if (children.length > 0) {
				parentEntry.children = children;
			}
		}
	}

	private getItemTitle(item: any): string | undefined {
		if (item.title) return item.title;
		if (item.titleEl) return item.titleEl.textContent?.trim();
		if (item.dom) return item.dom.querySelector('.menu-item-title')?.textContent?.trim();
		return undefined;
	}

	private setupDomObserver() {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement) || !node.classList.contains('menu')) continue;

					if (this.collectMode) {
						node.style.cssText = 'visibility:hidden!important;pointer-events:none!important;position:fixed;left:-9999px;top:-9999px;';
						return;
					}

					const menuType = this.lastMenuType;
					if (menuType) {
						// For tab-menu, also collect passively from DOM
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

		const items = menuEl.querySelectorAll('.menu-item');
		for (const item of Array.from(items)) {
			const title = item.querySelector('.menu-item-title')?.textContent?.trim();
			if (title && hiddenTitles.has(title)) {
				(item as HTMLElement).style.display = 'none';
			}
		}

		const scrollEl = menuEl.querySelector('.menu-scroll') || menuEl;
		let sepIndex = 0;
		for (const child of Array.from(scrollEl.children) as HTMLElement[]) {
			if (child.classList.contains('menu-separator')) {
				if (hiddenSeps.has(sepIndex)) {
					child.style.display = 'none';
				}
				sepIndex++;
			} else if (child.classList.contains('menu-group') && sepIndex > 0) {
				sepIndex++;
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
