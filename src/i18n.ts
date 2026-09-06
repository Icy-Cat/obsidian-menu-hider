import { getLanguage } from 'obsidian';

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
	| 'notice.passive-hint'
	| 'notice.path-copied'
	| 'setting.copy-path'
	| 'setting.copy-path-desc';

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
	'notice.path-copied': 'Path copied',
	'setting.copy-path': 'Copy absolute path with Ctrl/Cmd+C',
	'setting.copy-path-desc': 'In the file explorer, press Ctrl/Cmd+C to copy the absolute paths of the selected files to the clipboard.',
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
	'notice.path-copied': '已复制路径到剪贴板',
	'setting.copy-path': 'Ctrl/Cmd+C 复制绝对路径',
	'setting.copy-path-desc': '在文件列表中选中文件后，按 Ctrl/Cmd+C 将其绝对路径复制到剪贴板。',
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
	'notice.path-copied': '已複製路徑到剪貼簿',
	'setting.copy-path': 'Ctrl/Cmd+C 複製絕對路徑',
	'setting.copy-path-desc': '在檔案列表中選取檔案後，按 Ctrl/Cmd+C 將其絕對路徑複製到剪貼簿。',
};

let currentLocale: Record<TranslationKey, string> = en;

/** Follow the app language; getLanguage() returns an ISO code such as 'en' or 'zh'. */
export function initLocale() {
	const lang = getLanguage().toLowerCase();
	if (lang.startsWith('zh')) {
		currentLocale = /tw|hk|mo|hant/.test(lang) ? zhTW : zh;
	} else {
		currentLocale = en;
	}
}

/** Menu labels are persisted in data.json — resolve known signatures live so they follow the UI language. */
const SIG_LABEL_KEYS: Record<string, TranslationKey> = {
	'event:file-menu-file': 'label.file-menu-file',
	'event:file-menu-folder': 'label.file-menu-folder',
	'event:editor-menu': 'label.editor-menu',
	'event:files-menu': 'label.files-menu',
	'event:url-menu': 'label.url-menu',
	'dom:nav-file': 'label.file-menu-file',
	'dom:nav-folder': 'label.file-menu-folder',
	'dom:editor': 'label.editor-menu',
	'dom:tab-header': 'label.tab-menu',
	'dom:unknown': 'label.unknown',
};

export function labelForSig(sig: string, fallback: string): string {
	const key = SIG_LABEL_KEYS[sig];
	return key ? t(key) : fallback;
}

export function t(key: TranslationKey): string {
	return currentLocale[key] || en[key] || key;
}
