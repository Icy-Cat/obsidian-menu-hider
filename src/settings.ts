import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import Sortable from 'sortablejs';
import MenuHiderPlugin, { CollectedEntry } from './main';
import { labelForSig, t } from './i18n';

export interface MenuRecord {
	signature: string;
	label: string;
	entries: CollectedEntry[];
	hiddenItems: string[];
	hiddenSeparators: number[];
	/** User-defined order of item titles. Items not listed keep their original position. */
	order?: string[];
	/** Submenu items lifted into the top-level menu, placed after their parent. */
	promoted?: PromotedRef[];
	lastSeenAt: number;
}

export interface PromotedRef {
	parent: string;
	title: string;
}

export interface MenuHiderSettings {
	menus: Record<string, MenuRecord>;
	/** Ctrl/Cmd+C in the file explorer copies absolute paths instead of doing nothing. */
	copyAbsolutePath: boolean;
}

/** DOM/Sortable callbacks must return void, not a promise. */
function voidHandler<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => void {
	return (...args: A) => { void fn(...args); };
}

const TRIGGERABLE_SIGS = new Set([
	'event:file-menu-file',
	'event:file-menu-folder',
	'event:editor-menu',
	'dom:nav-file',
	'dom:nav-folder',
	'dom:editor',
]);

export class MenuHiderSettingTab extends PluginSettingTab {
	plugin: MenuHiderPlugin;
	activeSig: string | null = null;

	constructor(app: App, plugin: MenuHiderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('menu-hider-settings');

		new Setting(containerEl)
			.setName(t('setting.copy-path'))
			.setDesc(t('setting.copy-path-desc'))
			.addToggle(tg => tg
				.setValue(this.plugin.settings.copyAbsolutePath)
				.onChange(async v => {
					this.plugin.settings.copyAbsolutePath = v;
					await this.plugin.saveSettings();
				}));

		const sigs = Object.keys(this.plugin.settings.menus).sort((a, b) => {
			const ra = this.plugin.settings.menus[a];
			const rb = this.plugin.settings.menus[b];
			return (rb?.lastSeenAt ?? 0) - (ra?.lastSeenAt ?? 0);
		});

		if (this.activeSig === null || !sigs.includes(this.activeSig)) {
			this.activeSig = sigs[0] ?? null;
		}

		const header = containerEl.createDiv({ cls: 'menu-hider-header' });
		const tabBar = header.createDiv({ cls: 'menu-hider-tabs' });

		if (sigs.length === 0) {
			tabBar.createSpan({ cls: 'menu-hider-empty-tabs', text: t('empty.no-menus') });
		} else {
			for (const sig of sigs) {
				const rec = this.plugin.settings.menus[sig];
				if (!rec) continue;
				const tab = tabBar.createEl('button', {
					text: labelForSig(sig, rec.label || sig),
					cls: 'menu-hider-tab',
					attr: { title: sig },
				});
				if (sig === this.activeSig) tab.addClass('is-active');
				tab.addEventListener('click', () => {
					this.activeSig = sig;
					this.display();
				});
			}
		}

		if (this.activeSig && TRIGGERABLE_SIGS.has(this.activeSig)) {
			const refreshBtn = header.createEl('button', {
				cls: 'menu-hider-refresh-btn',
				attr: { 'aria-label': t('refresh') },
			});
			setIcon(refreshBtn, 'refresh-cw');
			refreshBtn.addEventListener('click', voidHandler(async () => {
				if (!this.activeSig) return;
				refreshBtn.disabled = true;
				refreshBtn.addClass('is-spinning');
				const ok = await this.plugin.triggerCollect(this.activeSig);
				refreshBtn.disabled = false;
				refreshBtn.removeClass('is-spinning');
				if (ok) this.display();
				else new Notice(t('notice.passive-hint'));
			}));
		}

		if (this.activeSig) {
			const rec = this.plugin.settings.menus[this.activeSig];
			if (rec) {
				const meta = containerEl.createDiv({ cls: 'menu-hider-meta' });
				meta.createSpan({ text: rec.signature, cls: 'menu-hider-sig' });
				if (rec.order && rec.order.length > 0) {
					const resetBtn = meta.createEl('button', {
						cls: 'menu-hider-delete-btn',
						text: t('reset-order'),
					});
					resetBtn.addEventListener('click', voidHandler(async () => {
						await this.plugin.resetOrder(rec.signature);
						this.display();
					}));
				}
				const delBtn = meta.createEl('button', {
					cls: 'menu-hider-delete-btn',
					attr: { 'aria-label': t('delete') },
					text: t('delete'),
				});
				delBtn.addEventListener('click', voidHandler(async () => {
					await this.plugin.deleteMenu(rec.signature);
					this.activeSig = null;
					this.display();
				}));

				const menuList = containerEl.createDiv({ cls: 'menu-hider-menu-list' });
				this.renderEntries(menuList, rec, this.plugin.applyOrderToEntries(rec, this.plugin.effectiveEntries(rec)), 0);
			}
		} else {
			const empty = containerEl.createDiv({ cls: 'menu-hider-empty' });
			empty.createSpan({ text: t('empty.title') });
			empty.createEl('br');
			empty.createSpan({ text: t('empty.hint') });
		}
	}

	private renderEntries(containerEl: HTMLElement, rec: MenuRecord, entries: CollectedEntry[], depth: number, parentTitle?: string) {
		const hiddenItems = new Set(rec.hiddenItems);
		const hiddenSeps = new Set(rec.hiddenSeparators);

		if (entries.length === 0) {
			const empty = containerEl.createDiv({ cls: 'menu-hider-empty' });
			empty.createSpan({ text: t('empty.title') });
			empty.createEl('br');
			empty.createSpan({ text: t('empty.hint') });
			return;
		}

		// At depth 0 we wrap consecutive items into segment containers so Sortable
		// can govern reordering within each segment (no cross-segment drags).
		const segmentEls: HTMLElement[] = [];
		let currentSegment: HTMLElement | null = null;

		const openSegment = () => {
			if (!currentSegment && depth === 0) {
				currentSegment = containerEl.createDiv({ cls: 'menu-hider-segment' });
				segmentEls.push(currentSegment);
			}
		};
		const closeSegment = () => { currentSegment = null; };

		let sepIndex = 0;
		for (const entry of entries) {
			if (entry.type === 'separator') {
				if (depth === 0) {
					closeSegment();
					const idx = sepIndex;
					const isHidden = hiddenSeps.has(idx);
					const row = containerEl.createDiv({
						cls: `menu-hider-row menu-hider-separator-row${isHidden ? ' is-hidden-entry' : ''}`,
					});
					row.createDiv({ cls: 'menu-hider-separator-line' });
					this.addEyeToggle(row, !isHidden, async (visible) => {
						const list = rec.hiddenSeparators;
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
				if (parentTitle && this.plugin.isPromoted(rec, parentTitle, entry.title)) continue;
				const isHidden = hiddenItems.has(entry.title);
				const hasChildren = entry.children && entry.children.length > 0;
				openSegment();
				const parent = (depth === 0 && currentSegment) ? currentSegment : containerEl;
				const row = parent.createDiv({
					cls: `menu-hider-row menu-hider-item-row${isHidden ? ' is-hidden-entry' : ''}${depth > 0 ? ' menu-hider-child' : ''}`,
				});
				row.dataset.title = entry.title;
				if (parentTitle) row.dataset.parent = parentTitle;
				if (entry.promotedFrom) row.addClass('is-promoted');
				if (depth > 0) {
					row.style.paddingLeft = `${6 + depth * 16}px`;
				}

				if (depth === 0 || parentTitle) {
					const handle = row.createDiv({
						cls: 'menu-hider-drag-handle',
						attr: { 'aria-label': t(parentTitle ? 'drag-to-promote' : 'drag-to-reorder') },
					});
					setIcon(handle, 'grip-vertical');
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

				if (entry.promotedFrom) {
					const from = entry.promotedFrom;
					const back = row.createDiv({ cls: 'menu-hider-demote', attr: { 'aria-label': t('demote') } });
					setIcon(back, 'corner-down-left');
					back.addEventListener('click', voidHandler(async (e: MouseEvent) => {
						e.stopPropagation();
						await this.plugin.demote(rec.signature, { parent: from, title: entry.title });
						this.display();
					}));
				}

				this.addEyeToggle(row, !isHidden, async (visible) => {
					const list = rec.hiddenItems;
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
					closeSegment();
					const childList = containerEl.createDiv({ cls: 'menu-hider-children' });
					this.renderEntries(childList, rec, entry.children!, depth + 1, entry.title);
					Sortable.create(childList, {
						group: { name: 'menu-hider', pull: true, put: false },
						sort: false,
						handle: '.menu-hider-drag-handle',
						animation: 150,
						ghostClass: 'menu-hider-row-ghost',
						chosenClass: 'menu-hider-row-chosen',
						dragClass: 'menu-hider-row-drag',
					});
				}
			}
		}

		if (depth === 0) {
			for (const seg of segmentEls) {
				const readOrder = () => {
					const newOrder: string[] = [];
					for (const s of segmentEls) {
						for (const row of Array.from(s.children) as HTMLElement[]) {
							const tt = row.dataset.title;
							if (tt) newOrder.push(tt);
						}
					}
					return newOrder;
				};
				Sortable.create(seg, {
					group: { name: 'menu-hider', put: true },
					handle: '.menu-hider-drag-handle',
					animation: 150,
					ghostClass: 'menu-hider-row-ghost',
					chosenClass: 'menu-hider-row-chosen',
					dragClass: 'menu-hider-row-drag',
					onEnd: voidHandler(async () => {
						await this.plugin.setOrder(rec.signature, readOrder());
						this.display();
					}),
					// Dropped in from a submenu list: promote, then persist the resulting order.
					onAdd: voidHandler(async (evt: Sortable.SortableEvent) => {
						const { parent, title } = evt.item.dataset;
						if (!parent || !title) return;
						await this.plugin.promote(rec.signature, { parent, title });
						await this.plugin.setOrder(rec.signature, readOrder());
						this.display();
					}),
				});
			}
		}
	}

	private addEyeToggle(parent: HTMLElement, visible: boolean, onChange: (visible: boolean) => void | Promise<void>) {
		const btn = parent.createDiv({
			cls: `menu-hider-eye${visible ? '' : ' is-off'}`,
			attr: { 'aria-label': visible ? t('eye.hide') : t('eye.show') },
		});
		setIcon(btn, visible ? 'eye' : 'eye-off');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			void onChange(!visible);
		});
	}
}
