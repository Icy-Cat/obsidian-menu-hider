import { Menu, Plugin, TFile, TFolder, TAbstractFile, Editor, MarkdownView, Notice } from 'obsidian';
import { MenuHiderSettings, MenuHiderSettingTab, MenuRecord } from './settings';
import { initLocale, t } from './i18n';

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

export default class MenuHiderPlugin extends Plugin {
	settings: MenuHiderSettings;
	private observer: MutationObserver | null = null;

	private pending: PendingSig | null = null;
	private pendingExpiresAt = 0;
	private pendingCoords: { x: number; y: number; expiresAt: number } | null = null;
	private collectMode = false;

	async onload() {
		await this.loadSettings();
		initLocale();

		// Capture-phase contextmenu — runs before Obsidian's internal handlers.
		// Sets a low-priority DOM-based signature; semantic events override it.
		this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
			const target = evt.target as HTMLElement | null;
			if (!target) return;
			this.pendingCoords = { x: evt.clientX, y: evt.clientY, expiresAt: Date.now() + 1000 };
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

		this.setupDomObserver();
		this.addSettingTab(new MenuHiderSettingTab(this.app, this));
	}

	onunload() {
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
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

	private setupDomObserver() {
		this.observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					if (!(node instanceof HTMLElement) || !node.classList.contains('menu')) continue;

					if (this.collectMode) {
						node.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
						return;
					}

					// Submenu detection: another .menu already open → leave it alone.
					const openMenus = document.querySelectorAll('.menu');
					if (openMenus.length > 1) continue;

					const pending = this.consumePending();
					const sig = pending?.sig ?? 'dom:unknown';
					const label = pending?.label ?? t('label.unknown');

					const hidAny = this.applyHiding(node, sig);
					this.applyOrdering(node, sig);
					if (hidAny) this.repositionMenu(node);
					setTimeout(() => this.collectIntoRegistry(node, sig, label), 0);
				}
			}
		});
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	private collectIntoRegistry(node: HTMLElement, sig: string, label: string) {
		const entries = this.readEntriesFromDom(node);
		if (entries.length === 0) return;
		const existing = this.settings.menus[sig];
		if (existing) {
			existing.entries = entries;
			existing.lastSeenAt = Date.now();
			if (!existing.label) existing.label = label;
		} else {
			this.settings.menus[sig] = {
				signature: sig,
				label,
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
				const existing = this.settings.menus[sig];
				const label = existing?.label ?? t('label.unknown');
				this.settings.menus[sig] = {
					signature: sig,
					label,
					entries,
					hiddenItems: existing?.hiddenItems ?? [],
					hiddenSeparators: existing?.hiddenSeparators ?? [],
					lastSeenAt: Date.now(),
				};
				await this.saveSettings();
			}
		}

		document.querySelectorAll('.menu').forEach(m => m.remove());
		await new Promise<void>(r => setTimeout(r, 50));
		this.collectMode = false;

		return (this.settings.menus[sig]?.entries.length ?? 0) > 0;
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

	private applyHiding(menuEl: HTMLElement, sig: string): boolean {
		const rec = this.settings.menus[sig];
		if (!rec) return false;

		const hiddenTitles = new Set(rec.hiddenItems);
		const hiddenSeps = new Set(rec.hiddenSeparators);
		if (hiddenTitles.size === 0 && hiddenSeps.size === 0) return false;

		const scrollEl = menuEl.querySelector('.menu-scroll') || menuEl;

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

		const allItems = menuEl.querySelectorAll('.menu-item');
		for (const item of Array.from(allItems)) {
			const title = item.querySelector('.menu-item-title')?.textContent?.trim();
			if (title && hiddenTitles.has(title)) {
				(item as HTMLElement).style.display = 'none';
			}
		}

		for (let i = 0; i < sepTargets.length; i++) {
			if (!hiddenSeps.has(i)) continue;
			const tgt = sepTargets[i];
			if (!tgt) continue;
			if (tgt.type === 'dom') {
				tgt.el.style.display = 'none';
			} else {
				tgt.el.classList.add('menu-hider-no-border');
			}
		}

		const groups = scrollEl.querySelectorAll('.menu-group');
		for (const group of Array.from(groups) as HTMLElement[]) {
			const visible = group.querySelectorAll('.menu-item:not([style*="display: none"])');
			if (visible.length === 0) {
				group.style.display = 'none';
			}
		}
		return true;
	}

	private applyOrdering(menuEl: HTMLElement, sig: string) {
		const rec = this.settings.menus[sig];
		const order = rec?.order;
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
				const title = el.querySelector('.menu-item-title')?.textContent?.trim() ?? '';
				const r = rank.get(title);
				return { el, origIdx, rank: r === undefined ? Infinity : r };
			});
			const sorted = [...indexed].sort((a, b) => {
				if (a.rank !== b.rank) return a.rank - b.rank;
				return a.origIdx - b.origIdx;
			});

			// Only reflow if order actually changed.
			const changed = sorted.some((s, i) => s.el !== items[i]);
			if (!changed) continue;

			for (const s of sorted) {
				container.appendChild(s.el);
			}
		}
	}

	private repositionMenu(menuEl: HTMLElement) {
		const coords = this.pendingCoords;
		if (!coords || Date.now() > coords.expiresAt) return;
		// Consume so submenus opened later don't snap back to the cursor.
		this.pendingCoords = null;

		// Defer one frame so layout reflects the just-applied display:none.
		requestAnimationFrame(() => {
			const rect = menuEl.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const margin = 4;

			let x = coords.x;
			let y = coords.y;
			if (x + rect.width + margin > vw) x = Math.max(margin, vw - rect.width - margin);
			if (y + rect.height + margin > vh) y = Math.max(margin, vh - rect.height - margin);

			menuEl.style.left = `${x}px`;
			menuEl.style.top = `${y}px`;
			menuEl.style.right = 'auto';
			menuEl.style.bottom = 'auto';
		});
	}

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
		const allTitles = rec.entries
			.filter(e => e.type === 'item')
			.map(e => (e as CollectedMenuItem).title);
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

	/**
	 * Move a top-level item up (-1) or down (+1) within its separator-bounded segment.
	 * Operates on the flat sequence of top-level items as they appear in entries
	 * (separators are skipped — items "jump over" separators).
	 */
	async moveItem(sig: string, title: string, direction: -1 | 1) {
		const rec = this.settings.menus[sig];
		if (!rec) return;

		// Determine neighbor in the currently displayed (ordered) entries, within the same segment.
		const displayed = this.applyOrderToEntries(rec, rec.entries);
		const idx = displayed.findIndex(e => e.type === 'item' && (e as CollectedMenuItem).title === title);
		if (idx < 0) return;
		const neighborIdx = idx + direction;
		if (neighborIdx < 0 || neighborIdx >= displayed.length) return;
		const neighbor = displayed[neighborIdx];
		if (!neighbor || neighbor.type !== 'item') return;
		const neighborTitle = (neighbor as CollectedMenuItem).title;

		const allTitles = rec.entries
			.filter(e => e.type === 'item')
			.map(e => (e as CollectedMenuItem).title);

		let order = rec.order && rec.order.length > 0 ? [...rec.order] : [...allTitles];
		for (const tt of allTitles) {
			if (!order.includes(tt)) order.push(tt);
		}
		order = order.filter(tt => allTitles.includes(tt));

		const a = order.indexOf(title);
		const b = order.indexOf(neighborTitle);
		if (a < 0 || b < 0) return;
		[order[a], order[b]] = [order[b]!, order[a]!];
		rec.order = order;
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
