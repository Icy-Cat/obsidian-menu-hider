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

	constructor(app: App, plugin: MenuHiderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('menu-hider-settings');

		const header = containerEl.createDiv({ cls: 'menu-hider-header' });

		const tabBar = header.createDiv({ cls: 'menu-hider-tabs' });
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

		const refreshBtn = header.createEl('button', {
			cls: 'menu-hider-refresh-btn',
			attr: { 'aria-label': t('refresh') },
		});
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.addEventListener('click', async () => {
			refreshBtn.disabled = true;
			refreshBtn.addClass('is-spinning');
			await this.plugin.triggerCollectAll();
			refreshBtn.disabled = false;
			refreshBtn.removeClass('is-spinning');
			this.display();
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
				const row = containerEl.createDiv({
					cls: `menu-hider-row menu-hider-item-row${isHidden ? ' is-hidden-entry' : ''}${depth > 0 ? ' menu-hider-child' : ''}`,
				});
				if (depth > 0) {
					row.style.paddingLeft = `${6 + depth * 16}px`;
				}

				const left = row.createDiv({ cls: 'menu-hider-item-left' });
				const iconEl = left.createDiv({ cls: 'menu-hider-item-icon' });
				if (entry.icon) {
					try { setIcon(iconEl, entry.icon); } catch { /* icon not found */ }
				}
				left.createSpan({ text: entry.title, cls: 'menu-hider-item-title' });

				if (hasChildren) {
					const chevron = row.createDiv({ cls: 'menu-hider-chevron' });
					setIcon(chevron, 'chevron-down');
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

				if (hasChildren) {
					this.renderEntries(containerEl, menuType, entry.children!, depth + 1);
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
