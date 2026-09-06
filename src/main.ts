import { Menu, Plugin, TFolder, TAbstractFile, MarkdownView } from 'obsidian';
import { MenuHiderSettings, MenuHiderSettingTab, MenuRecord, PromotedRef } from './settings';
import { initLocale, t } from './i18n';

export interface CollectedMenuItem {
	type: 'item';
	title: string;
	icon?: string;
	children?: CollectedEntry[];
	/** Display-only: this top-level row was promoted out of the named submenu. */
	promotedFrom?: string;
}

export interface CollectedSeparator {
	type: 'separator';
}

export type CollectedEntry = CollectedMenuItem | CollectedSeparator;

interface PendingSig {
	sig: string;
	label: string;
	priority: number; // higher overrides lower within the same tick
}

const SIG_PRIORITY = {
	dom: 1,
	event: 2,
	urlOverride: 3,
} as const;

// Runtime shape of obsidian's Menu / MenuItem (not in the public d.ts, stable for years).
interface RtMenuItem {
	dom: HTMLElement;
	titleEl?: HTMLElement;
	submenu?: RtMenu;
}
interface RtMenu extends Menu {
	dom: HTMLElement;
	items: RtMenuItem[];
	parentMenu?: RtMenu;
}

const PROMOTED_CLASS = 'menu-hider-promoted';

export default class MenuHiderPlugin extends Plugin {
	settings: MenuHiderSettings;
	private menuMeta = new WeakMap<Menu, PendingSig>();
	private lastTopMenu: RtMenu | null = null;

	private pending: PendingSig | null = null;
	private pendingExpiresAt = 0;
	private forcedSig: string | null = null;
	private collectMode = false;

	async onload() {
		await this.loadSettings();
		initLocale();

		// Capture-phase contextmenu — runs before Obsidian's internal handlers.
		// Sets a low-priority DOM-based signature; semantic events override it.
		this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			const dom = this.computeDomSignature(target);
			if (dom) this.setPending(dom.sig, dom.label, SIG_PRIORITY.dom);
		}, true);

		this.registerEvent(this.app.workspace.on('file-menu', (_menu: Menu, file: TAbstractFile) => {
			const isFolder = file instanceof TFolder;
			this.setPending(
				isFolder ? 'event:file-menu-folder' : 'event:file-menu-file',
				t(isFolder ? 'label.file-menu-folder' : 'label.file-menu-file'),
				SIG_PRIORITY.event,
			);
		}));

		this.registerEvent(this.app.workspace.on('editor-menu', () => {
			this.setPending('event:editor-menu', t('label.editor-menu'), SIG_PRIORITY.event);
		}));

		// @ts-ignore — files-menu exists at runtime
		this.registerEvent(this.app.workspace.on('files-menu', () => {
			this.setPending('event:files-menu', t('label.files-menu'), SIG_PRIORITY.event);
		}));

		// @ts-ignore — url-menu exists at runtime; fires after editor-menu, must override
		this.registerEvent(this.app.workspace.on('url-menu', () => {
			this.setPending('event:url-menu', t('label.url-menu'), SIG_PRIORITY.urlOverride);
		}));

		this.patchMenu();
		this.addSettingTab(new MenuHiderSettingTab(this.app, this));
	}

	/** Every Menu.show* path ends in showAtPosition — hook it to get the Menu instance. */
	private patchMenu() {
		const proto = Menu.prototype as unknown as { showAtPosition: (...args: unknown[]) => Menu };
		const orig = proto.showAtPosition;
		const self = this;
		proto.showAtPosition = function (this: RtMenu, ...args: unknown[]) {
			try { self.beforeShow(this); } catch (e) { console.error('[menu-hider] beforeShow', e); }
			const result = orig.apply(this, args);
			try { self.afterShow(this); } catch (e) { console.error('[menu-hider] afterShow', e); }
			return result;
		};
		this.register(() => { proto.showAtPosition = orig; });
	}

	private parentOf(menu: RtMenu): RtMenu | null {
		if (menu.parentMenu) return menu.parentMenu;
		const top = this.lastTopMenu;
		if (top && top !== menu && top.dom.isConnected) return top;
		return null;
	}

	private beforeShow(menu: RtMenu) {
		const parent = this.parentOf(menu);
		let meta: PendingSig | undefined;
		if (parent) {
			meta = this.menuMeta.get(parent);
			if (!meta) return;
		} else {
			const pending = this.consumePending();
			const sig = this.forcedSig ?? pending?.sig ?? 'dom:unknown';
			const label = pending?.label ?? this.settings.menus[sig]?.label ?? t('label.unknown');
			meta = { sig, label, priority: pending?.priority ?? SIG_PRIORITY.dom };
			this.lastTopMenu = menu;
		}
		this.menuMeta.set(menu, meta);

		const rec = this.settings.menus[meta.sig];
		if (!rec) return;
		// Hide before Obsidian positions the menu so the measured size is already correct.
		this.hideItems(menu, rec);
		if (!parent) this.promoteItems(menu, rec);
	}

	private afterShow(menu: RtMenu) {
		const meta = this.menuMeta.get(menu);
		if (!meta) return;
		const rec = this.settings.menus[meta.sig];
		const isTop = !this.parentOf(menu);
		if (rec) {
			this.hideSeparators(menu.dom, rec);
			if (isTop) {
				this.placePromoted(menu);
				this.applyOrdering(menu.dom, rec);
			}
		}
		if (isTop) this.collectIntoRegistry(menu, meta);
		if (this.collectMode) {
			menu.dom.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
		}
	}

	private setPending(sig: string, label: string, priority: number) {
		const now = Date.now();
		if (this.pending && now <= this.pendingExpiresAt && priority < this.pending.priority) return;
		this.pending = { sig, label, priority };
		this.pendingExpiresAt = now + 1000;
	}

	private consumePending(): PendingSig | null {
		if (!this.pending) return null;
		if (Date.now() > this.pendingExpiresAt) { this.pending = null; return null; }
		const p = this.pending;
		this.pending = null;
		return p;
	}

	private computeDomSignature(target: HTMLElement): { sig: string; label: string } | null {
		const known: Array<{ selector: string; sig: string; labelKey: 'label.tab-menu' | 'label.file-menu-folder' | 'label.file-menu-file' | 'label.editor-menu' }> = [
			{ selector: '.workspace-tab-header', sig: 'dom:tab-header', labelKey: 'label.tab-menu' },
			{ selector: '.nav-folder-title', sig: 'dom:nav-folder', labelKey: 'label.file-menu-folder' },
			{ selector: '.nav-file-title', sig: 'dom:nav-file', labelKey: 'label.file-menu-file' },
			{ selector: '.cm-content', sig: 'dom:editor', labelKey: 'label.editor-menu' },
		];
		for (const k of known) {
			if (target.closest(k.selector)) return { sig: k.sig, label: t(k.labelKey) };
		}
		const leaf = target.closest('[data-type]') as HTMLElement | null;
		if (leaf) {
			const dt = leaf.getAttribute('data-type');
			if (dt) return { sig: `view:${dt}`, label: dt };
		}
		// Last resort: nearest tagname.first-class
		const cls = (target.className && typeof target.className === 'string')
			? target.className.split(/\s+/).find(c => c.length > 0)
			: null;
		const tag = target.tagName.toLowerCase();
		const sig = cls ? `dom:${tag}.${cls}` : `dom:${tag}`;
		return { sig, label: sig };
	}

	// ---------- collection ----------

	private collectIntoRegistry(menu: RtMenu, meta: PendingSig) {
		const entries = this.readEntriesFromDom(menu.dom);
		if (entries.length === 0) return;
		// Submenu items exist before the submenu is ever shown — read them directly.
		for (const item of menu.items) {
			if (!item.submenu) continue;
			const title = this.getMenuItemTitle(item.dom);
			const entry = entries.find(e => e.type === 'item' && e.title === title);
			if (entry && entry.type === 'item') entry.children = this.readEntriesFromDom(item.submenu.dom);
		}
		const existing = this.settings.menus[meta.sig];
		if (existing) {
			existing.entries = entries;
			existing.lastSeenAt = Date.now();
			if (!existing.label) existing.label = meta.label;
		} else {
			this.settings.menus[meta.sig] = {
				signature: meta.sig,
				label: meta.label,
				entries,
				hiddenItems: [],
				hiddenSeparators: [],
				order: [],
				lastSeenAt: Date.now(),
			};
		}
		void this.saveSettings();
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
		if (el.classList.contains(PROMOTED_CLASS)) return;
		const title = this.getMenuItemTitle(el);
		if (!title) return;
		const icon = this.detectIconFromDom(el);
		entries.push({ type: 'item', title, icon: icon || undefined });
	}

	private getMenuItemTitle(el: HTMLElement): string | null {
		return el.querySelector('.menu-item-title')?.textContent?.trim() || null;
	}

	private detectIconFromDom(itemEl: HTMLElement): string | undefined {
		const svg = itemEl.querySelector('.menu-item-icon svg');
		if (!svg) return undefined;
		const dataIcon = svg.getAttribute('data-icon');
		if (dataIcon) return dataIcon;
		for (const cls of Array.from(svg.classList)) {
			if (cls.startsWith('lucide-')) return cls.substring(7);
		}
		return svg.closest('[data-icon]')?.getAttribute('data-icon') || undefined;
	}

	/**
	 * Synthesize a contextmenu on a known target to populate a menu signature.
	 * Returns true if the signature now has entries.
	 */
	async triggerCollect(sig: string): Promise<boolean> {
		let targetEl: Element | null = null;

		switch (sig) {
			case 'event:file-menu-folder':
			case 'dom:nav-folder': {
				const leaves = this.app.workspace.getLeavesOfType('file-explorer');
				const containerEl = (leaves[0]?.view as any)?.containerEl as HTMLElement | undefined;
				targetEl = containerEl?.querySelector('.nav-folder-title') ?? null;
				break;
			}
			case 'event:file-menu-file':
			case 'dom:nav-file': {
				const leaves = this.app.workspace.getLeavesOfType('file-explorer');
				const containerEl = (leaves[0]?.view as any)?.containerEl as HTMLElement | undefined;
				targetEl = containerEl?.querySelector('.nav-file-title') ?? null;
				break;
			}
			case 'event:editor-menu':
			case 'dom:editor': {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				targetEl = view.contentEl.querySelector('.cm-content') || view.contentEl;
				break;
			}
			default:
				return false;
		}

		if (!targetEl) return false;
		this.collectMode = true;
		this.forcedSig = sig;

		const rect = targetEl.getBoundingClientRect();
		targetEl.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: rect.left + Math.min(rect.width / 2, 20),
			clientY: rect.top + Math.min(rect.height / 2, 10),
		}));

		await new Promise<void>(r => setTimeout(r, 200));
		this.lastTopMenu?.hide();
		document.querySelectorAll('.menu').forEach(m => m.remove());
		this.forcedSig = null;
		this.collectMode = false;

		return (this.settings.menus[sig]?.entries.length ?? 0) > 0;
	}

	// ---------- runtime: hide / promote / order ----------

	private hideItems(menu: RtMenu, rec: MenuRecord) {
		if (rec.hiddenItems.length === 0) return;
		const hidden = new Set(rec.hiddenItems);
		for (const item of menu.items) {
			const title = this.getMenuItemTitle(item.dom);
			if (title && hidden.has(title)) item.dom.style.display = 'none';
		}
	}

	/** Separator indices are counted over the shown DOM (groups exist only after show). */
	private hideSeparators(menuEl: HTMLElement, rec: MenuRecord) {
		const hiddenSeps = new Set(rec.hiddenSeparators);
		const scrollEl = menuEl.querySelector('.menu-scroll') || menuEl;

		if (hiddenSeps.size > 0) {
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
						if (item.classList.contains('menu-item')) lastWasItem = true;
						else if (item.classList.contains('menu-separator')) pushSep({ type: 'dom', el: item });
					}
				} else if (child.classList.contains('menu-item')) {
					lastWasItem = true;
				}
			}
			sepTargets.forEach((tgt, i) => {
				if (!hiddenSeps.has(i)) return;
				if (tgt.type === 'dom') tgt.el.style.display = 'none';
				else tgt.el.classList.add('menu-hider-no-border');
			});
		}

		if (rec.hiddenItems.length === 0) return;
		for (const group of Array.from(scrollEl.querySelectorAll('.menu-group')) as HTMLElement[]) {
			if (group.querySelectorAll('.menu-item:not([style*="display: none"])').length === 0) {
				group.style.display = 'none';
			}
		}
	}

	private promotedDoms = new WeakMap<Menu, Array<[item: HTMLElement, parent: HTMLElement]>>();

	/** Clone submenu items into the top-level menu (before show so keyboard nav + sizing include them). */
	private promoteItems(menu: RtMenu, rec: MenuRecord) {
		if (!rec.promoted || rec.promoted.length === 0) return;
		const hidden = new Set(rec.hiddenItems);
		const placed: Array<[HTMLElement, HTMLElement]> = [];
		for (const p of rec.promoted) {
			const parent = menu.items.find(i => i.submenu && this.getMenuItemTitle(i.dom) === p.parent);
			const child = parent?.submenu?.items.find(i => this.getMenuItemTitle(i.dom) === p.title);
			if (!parent || !child) continue;
			child.dom.style.display = 'none';
			if (hidden.has(p.title)) continue;
			menu.addItem(it => {
				it.setTitle(p.title).onClick(() => child.dom.click());
				const icon = this.detectIconFromDom(child.dom);
				if (icon) it.setIcon(icon);
				const dom = (it as unknown as RtMenuItem).dom;
				dom.classList.add(PROMOTED_CLASS);
				placed.push([dom, parent.dom]);
			});
		}
		this.promotedDoms.set(menu, placed);
	}

	/** After show (Obsidian re-sorts DOM by section), park each promoted item right after its parent. */
	private placePromoted(menu: RtMenu) {
		for (const [dom, parentDom] of this.promotedDoms.get(menu) ?? []) {
			parentDom.after(dom);
		}
	}

	private applyOrdering(menuEl: HTMLElement, rec: MenuRecord) {
		const order = rec.order;
		if (!order || order.length === 0) return;

		const rank = new Map<string, number>();
		order.forEach((title, i) => rank.set(title, i));

		const scrollEl = (menuEl.querySelector('.menu-scroll') || menuEl) as HTMLElement;
		// Reorder within each container (groups + scroll root) to preserve grouping.
		const containers: HTMLElement[] = [scrollEl, ...Array.from(scrollEl.querySelectorAll('.menu-group')) as HTMLElement[]];

		for (const container of containers) {
			const items = Array.from(container.children).filter(
				(c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('menu-item'),
			);
			if (items.length < 2) continue;

			const indexed = items.map((el, origIdx) => {
				const title = this.getMenuItemTitle(el) ?? '';
				const r = rank.get(title);
				return { el, origIdx, rank: r === undefined ? Infinity : r };
			});
			const sorted = [...indexed].sort((a, b) => {
				if (a.rank !== b.rank) return a.rank - b.rank;
				return a.origIdx - b.origIdx;
			});

			if (!sorted.some((s, i) => s.el !== items[i])) continue;
			for (const s of sorted) container.appendChild(s.el);
		}
	}

	// ---------- settings persistence ----------

	async loadSettings() {
		const data = await this.loadData() as any;
		this.settings = { menus: {} };

		// New-format data
		if (data && typeof data === 'object' && data.menus && typeof data.menus === 'object') {
			for (const [sig, rec] of Object.entries(data.menus)) {
				const r = rec as Partial<MenuRecord>;
				this.settings.menus[sig] = {
					signature: sig,
					label: r.label || sig,
					entries: r.entries || [],
					hiddenItems: r.hiddenItems || [],
					hiddenSeparators: r.hiddenSeparators || [],
					order: r.order || [],
					promoted: r.promoted || [],
					lastSeenAt: r.lastSeenAt || 0,
				};
			}
			return;
		}

		// Legacy migration
		if (data && typeof data === 'object') {
			const legacyMap: Record<string, { sig: string; labelKey: 'label.file-menu-file' | 'label.file-menu-folder' | 'label.editor-menu' | 'label.tab-menu' | 'label.files-menu' | 'label.url-menu' }> = {
				'file-menu-file': { sig: 'event:file-menu-file', labelKey: 'label.file-menu-file' },
				'file-menu-folder': { sig: 'event:file-menu-folder', labelKey: 'label.file-menu-folder' },
				'editor-menu': { sig: 'event:editor-menu', labelKey: 'label.editor-menu' },
				'tab-menu': { sig: 'dom:tab-header', labelKey: 'label.tab-menu' },
				'files-menu': { sig: 'event:files-menu', labelKey: 'label.files-menu' },
				'url-menu': { sig: 'event:url-menu', labelKey: 'label.url-menu' },
			};
			const hiddenItems = data.hiddenItems || {};
			const hiddenSeps = data.hiddenSeparators || {};
			const savedEntries = data.savedEntries || {};
			for (const [legacyKey, m] of Object.entries(legacyMap)) {
				const items = hiddenItems[legacyKey] || [];
				const seps = hiddenSeps[legacyKey] || [];
				const entries = savedEntries[legacyKey] || [];
				if (items.length === 0 && seps.length === 0 && entries.length === 0) continue;
				this.settings.menus[m.sig] = {
					signature: m.sig,
					label: t(m.labelKey),
					entries,
					hiddenItems: items,
					hiddenSeparators: seps,
					lastSeenAt: 0,
				};
			}
			if (Object.keys(this.settings.menus).length > 0) {
				await this.saveSettings();
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async deleteMenu(sig: string) {
		delete this.settings.menus[sig];
		await this.saveSettings();
	}

	// ---------- settings-page model ----------

	/** Top-level entries with promoted submenu items inserted after their parent. */
	effectiveEntries(rec: MenuRecord): CollectedEntry[] {
		const result: CollectedEntry[] = [...rec.entries];
		for (const p of rec.promoted ?? []) {
			const parentIdx = result.findIndex(e => e.type === 'item' && e.title === p.parent);
			if (parentIdx < 0) continue;
			const parent = result[parentIdx] as CollectedMenuItem;
			const child = parent.children?.find(c => c.type === 'item' && c.title === p.title) as CollectedMenuItem | undefined;
			// Insert after the parent and after any earlier promotions from the same parent.
			let at = parentIdx + 1;
			while (at < result.length) {
				const e = result[at];
				if (e && e.type === 'item' && e.promotedFrom === p.parent) at++;
				else break;
			}
			result.splice(at, 0, { type: 'item', title: p.title, icon: child?.icon, promotedFrom: p.parent });
		}
		return result;
	}

	isPromoted(rec: MenuRecord, parent: string, title: string): boolean {
		return (rec.promoted ?? []).some(p => p.parent === parent && p.title === title);
	}

	async promote(sig: string, ref: PromotedRef) {
		const rec = this.settings.menus[sig];
		if (!rec || this.isPromoted(rec, ref.parent, ref.title)) return;
		(rec.promoted ??= []).push(ref);
		await this.saveSettings();
	}

	async demote(sig: string, ref: PromotedRef) {
		const rec = this.settings.menus[sig];
		if (!rec) return;
		rec.promoted = (rec.promoted ?? []).filter(p => !(p.parent === ref.parent && p.title === ref.title));
		if (rec.order) rec.order = rec.order.filter(tt => tt !== ref.title);
		await this.saveSettings();
	}

	/** Sort items within each separator-bounded segment by user-defined rank. */
	applyOrderToEntries(rec: { order?: string[] }, entries: CollectedEntry[]): CollectedEntry[] {
		const order = rec.order;
		if (!order || order.length === 0) return entries;
		const rank = new Map<string, number>();
		order.forEach((t, i) => rank.set(t, i));

		const result: CollectedEntry[] = [];
		let bucket: CollectedMenuItem[] = [];
		const flushBucket = () => {
			bucket.sort((a, b) => {
				const ra = rank.get(a.title) ?? Infinity;
				const rb = rank.get(b.title) ?? Infinity;
				return ra - rb;
			});
			result.push(...bucket);
			bucket = [];
		};
		for (const e of entries) {
			if (e.type === 'separator') {
				flushBucket();
				result.push(e);
			} else {
				bucket.push(e);
			}
		}
		flushBucket();
		return result;
	}

	/**
	 * Persist a new top-level title order. Titles not in the list are appended in their
	 * natural sequence; titles that no longer exist in entries are dropped.
	 */
	async setOrder(sig: string, titles: string[]) {
		const rec = this.settings.menus[sig];
		if (!rec) return;
		const allTitles = this.effectiveEntries(rec)
			.filter((e): e is CollectedMenuItem => e.type === 'item')
			.map(e => e.title);
		const seen = new Set<string>();
		const next: string[] = [];
		for (const tt of titles) {
			if (allTitles.includes(tt) && !seen.has(tt)) {
				next.push(tt);
				seen.add(tt);
			}
		}
		for (const tt of allTitles) {
			if (!seen.has(tt)) next.push(tt);
		}
		rec.order = next;
		await this.saveSettings();
	}

	/** Reset user-defined order back to natural order. */
	async resetOrder(sig: string) {
		const rec = this.settings.menus[sig];
		if (!rec) return;
		rec.order = [];
		await this.saveSettings();
	}
}
