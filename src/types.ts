/** Types shared by the plugin and its settings tab. Kept import-free on purpose. */

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

/** Shape of data.json: the current format plus the pre-signature legacy keys. */
export interface PersistedData {
	menus?: Record<string, Partial<MenuRecord>>;
	copyAbsolutePath?: boolean;
	hiddenItems?: Record<string, string[]>;
	hiddenSeparators?: Record<string, number[]>;
	savedEntries?: Record<string, CollectedEntry[]>;
}

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
