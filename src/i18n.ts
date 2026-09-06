type TranslationKey =
	| 'label.file-menu-file'
	| 'label.file-menu-folder'
	| 'label.editor-menu'
	| 'label.tab-menu'
	| 'label.files-menu'
	| 'label.url-menu'
	| 'label.unknown'
	| 'empty.title'
	| 'empty.hint'
	| 'empty.no-menus'
	| 'eye.hide'
	| 'eye.show'
	| 'refresh'
	| 'delete'
	| 'move-up'
	| 'move-down'
	| 'reset-order'
	| 'drag-to-reorder'
	| 'drag-to-promote'
	| 'demote'
	| 'notice.passive-hint';

const en: Record<TranslationKey, string> = {
	'label.file-menu-file': 'File',
	'label.file-menu-folder': 'Folder',
	'label.editor-menu': 'Editor',
	'label.tab-menu': 'Tab',
	'label.files-menu': 'Multi-file',
	'label.url-menu': 'URL',
	'label.unknown': 'Unknown menu',
	'empty.title': 'No items collected yet.',
	'empty.hint': 'Right-click in Obsidian to auto-discover menus.',
	'empty.no-menus': 'No menus discovered yet — right-click anywhere in Obsidian.',
	'eye.hide': 'Click to hide',
	'eye.show': 'Click to show',
	'refresh': 'Refresh',
	'delete': 'Delete',
	'move-up': 'Move up',
	'move-down': 'Move down',
	'reset-order': 'Reset order',
	'drag-to-reorder': 'Drag to reorder',
	'drag-to-promote': 'Drag into the top-level menu',
	'demote': 'Move back into submenu',
	'notice.passive-hint': 'Right-click the corresponding element to collect this menu',
};

const zh: Record<TranslationKey, string> = {
	'label.file-menu-file': '文件',
	'label.file-menu-folder': '文件夹',
	'label.editor-menu': '编辑器',
	'label.tab-menu': '标签页',
	'label.files-menu': '多文件',
	'label.url-menu': 'URL',
	'label.unknown': '未知菜单',
	'empty.title': '尚未收集到菜单项',
	'empty.hint': '在 Obsidian 中右键即可自动发现菜单。',
	'empty.no-menus': '尚未发现任何菜单 —— 在 Obsidian 中任意位置右键试试。',
	'eye.hide': '点击隐藏',
	'eye.show': '点击显示',
	'refresh': '刷新',
	'delete': '删除',
	'move-up': '上移',
	'move-down': '下移',
	'reset-order': '重置排序',
	'drag-to-reorder': '拖动以排序',
	'drag-to-promote': '拖到一级菜单',
	'demote': '放回子菜单',
	'notice.passive-hint': '请右键对应元素以收集此菜单',
};

const zhTW: Record<TranslationKey, string> = {
	'label.file-menu-file': '檔案',
	'label.file-menu-folder': '資料夾',
	'label.editor-menu': '編輯器',
	'label.tab-menu': '標籤頁',
	'label.files-menu': '多檔案',
	'label.url-menu': 'URL',
	'label.unknown': '未知選單',
	'empty.title': '尚未收集到選單項',
	'empty.hint': '在 Obsidian 中右鍵即可自動探索選單。',
	'empty.no-menus': '尚未探索到任何選單 —— 在 Obsidian 中任意位置右鍵試試。',
	'eye.hide': '點選隱藏',
	'eye.show': '點選顯示',
	'refresh': '重新整理',
	'delete': '刪除',
	'move-up': '上移',
	'move-down': '下移',
	'reset-order': '重設排序',
	'drag-to-reorder': '拖曳以排序',
	'drag-to-promote': '拖到一級選單',
	'demote': '放回子選單',
	'notice.passive-hint': '請右鍵對應元素以收集此選單',
};

const locales: Record<string, Record<TranslationKey, string>> = {
	en, zh, 'zh-TW': zhTW,
};

let currentLocale: Record<TranslationKey, string> = en;

export function initLocale() {
	const lang = window.localStorage.getItem('language') || 'en';
	const base = lang.split('-')[0];
	currentLocale = locales[lang] || (base ? locales[base] : undefined) || en;
}

export function t(key: TranslationKey): string {
	return currentLocale[key] || en[key] || key;
}
