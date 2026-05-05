import { App, PluginSettingTab, setIcon } from 'obsidian';
import MenuHiderPlugin, { MenuType, CollectedEntry, ALL_MENU_TYPES } from './main';
import { t } from './i18n';

export interface MenuHiderSettings {
	hiddenItems: Record<MenuType, string[]>;
	hiddenSeparators: Record<MenuType, number[]>;
	savedEntries?: Record<MenuType, CollectedEntry[]>;
}

export const DEFAULT_SETTINGS: MenuHiderSettings = {
	hiddenItems: {
		'file-menu-file': [],
		'file-menu-folder': [],
		'editor-menu': [],
		'files-menu': [],
		'url-menu': [],
	},
	hiddenSeparators: {
		'file-menu-file': [],
		'file-menu-folder': [],
		'editor-menu': [],
		'files-menu': [],
		'url-menu': [],
	},
};

export class MenuHiderSettingTab extends PluginSettingTab {
	plugin: MenuHiderPlugin;
	activeTab: MenuType = 'file-menu-file';
	expandedItems: Set<string> = new Set();

	constructor(app: App, plugin: MenuHiderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('menu-hider-settings');

		const tabBar = containerEl.createDiv({ cls: 'menu-hider-tabs' });

		for (const menuType of ALL_MENU_TYPES) {
			const tab = tabBar.createEl('button', {
				text: t(`tab.${menuType}`),
				cls: 'menu-hider-tab',
			});
			if (menuType === this.activeTab) tab.addClass('is-active');
			tab.addEventListener('click', () => {
				this.activeTab = menuType;
				this.display();
			});
		}

		const toolbar = containerEl.createDiv({ cls: 'menu-hider-toolbar' });
		const refreshBtn = toolbar.createEl('button', {
			cls: 'menu-hider-refresh-btn',
			attr: { 'aria-label': t('refresh') },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true;
			refreshBtn.addClass('is-spinning');
			const ok = await this.plugin.triggerCollect(this.activeTab);
			refreshBtn.disabled = false;
			refreshBtn.removeClass('is-spinning');
			if (ok) this.display();
		});

		const menuList = containerEl.createDiv({ cls: 'menu-hider-menu-list' });
		this.renderEntries(menuList, this.activeTab, this.plugin.collectedEntries[this.activeTab], 0);
	}

	private renderEntries(containerEl: HTMLElement, menuType: MenuType, entries: CollectedEntry[], depth: number) {
		const hiddenItems = new Set(this.plugin.settings.hiddenItems[menuType]);
		const hiddenSeps = new Set(this.plugin.settings.hiddenSeparators[menuType]);

		if (entries.length === 0) {
			const empty = containerEl.createDiv({ cls: 'menu-hider-empty' });
			empty.createSpan({ text: t('empty.title') });
			empty.createEl('br');
			empty.createSpan({ text: t('empty.hint') });
			return;
		}

		let sepIndex = 0;
		for (const entry of entries) {
			if (entry.type === 'separator') {
				if (depth === 0) {
					const idx = sepIndex;
					const isHidden = hiddenSeps.has(idx);
					const row = containerEl.createDiv({
						cls: `menu-hider-row menu-hider-separator-row${isHidden ? ' is-hidden-entry' : ''}`,
					});
					row.createDiv({ cls: 'menu-hider-separator-line' });
					this.addEyeToggle(row, !isHidden, async (visible) => {
						const list = this.plugin.settings.hiddenSeparators[menuType];
						if (visible) {
							const i = list.indexOf(idx);
							if (i >= 0) list.splice(i, 1);
						} else {
							if (!list.includes(idx)) list.push(idx);
						}
						await this.plugin.saveSettings();
						this.display();
					});
				}
				sepIndex++;
			} else {
				const isHidden = hiddenItems.has(entry.title);
				const hasChildren = entry.children && entry.children.length > 0;
				const isExpanded = this.expandedItems.has(`${menuType}::${entry.title}`);
				const row = containerEl.createDiv({
					cls: `menu-hider-row menu-hider-item-row${isHidden ? ' is-hidden-entry' : ''}${depth > 0 ? ' menu-hider-child' : ''}`,
				});
				if (depth > 0) {
					row.style.paddingLeft = `${12 + depth * 20}px`;
				}

				const left = row.createDiv({ cls: 'menu-hider-item-left' });

				const iconEl = left.createDiv({ cls: 'menu-hider-item-icon' });
				if (entry.icon) {
					try { setIcon(iconEl, entry.icon); } catch { /* icon not found */ }
				}

				left.createSpan({ text: entry.title, cls: 'menu-hider-item-title' });

				if (hasChildren) {
					const expandBtn = row.createDiv({ cls: 'menu-hider-expand-btn' });
					setIcon(expandBtn, isExpanded ? 'chevron-down' : 'chevron-right');
					expandBtn.addEventListener('click', (e) => {
						e.stopPropagation();
						const key = `${menuType}::${entry.title}`;
						if (this.expandedItems.has(key)) {
							this.expandedItems.delete(key);
						} else {
							this.expandedItems.add(key);
						}
						this.display();
					});
				}

				this.addEyeToggle(row, !isHidden, async (visible) => {
					const list = this.plugin.settings.hiddenItems[menuType];
					if (visible) {
						const i = list.indexOf(entry.title);
						if (i >= 0) list.splice(i, 1);
					} else {
						if (!list.includes(entry.title)) list.push(entry.title);
					}
					await this.plugin.saveSettings();
					this.display();
				});

				if (hasChildren && isExpanded) {
					const childContainer = containerEl.createDiv({ cls: 'menu-hider-children' });
					this.renderEntries(childContainer, menuType, entry.children!, depth + 1);
				}
			}
		}
	}

	private addEyeToggle(parent: HTMLElement, visible: boolean, onChange: (visible: boolean) => void) {
		const btn = parent.createDiv({
			cls: `menu-hider-eye${visible ? '' : ' is-off'}`,
			attr: { 'aria-label': visible ? t('eye.hide') : t('eye.show') },
		});
		setIcon(btn, visible ? 'eye' : 'eye-off');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onChange(!visible);
		});
	}
}
