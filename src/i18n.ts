type TranslationKey =
	| 'tab.file-menu-file'
	| 'tab.file-menu-folder'
	| 'tab.editor-menu'
	| 'tab.tab-menu'
	| 'tab.files-menu'
	| 'tab.url-menu'
	| 'empty.title'
	| 'empty.hint'
	| 'eye.hide'
	| 'eye.show'
	| 'refresh'
	| 'notice.open-explorer'
	| 'notice.open-file'
	| 'notice.right-click-url';

const en: Record<TranslationKey, string> = {
	'tab.file-menu-file': 'File',
	'tab.file-menu-folder': 'Folder',
	'tab.editor-menu': 'Editor',
	'tab.tab-menu': 'Tab',
	'tab.files-menu': 'Multi-file',
	'tab.url-menu': 'URL',
	'empty.title': 'No items collected yet.',
	'empty.hint': 'Click the refresh button, or right-click in Obsidian to collect.',
	'eye.hide': 'Click to hide',
	'eye.show': 'Click to show',
	'refresh': 'Refresh',
	'notice.open-explorer': 'Please open the file explorer first',
	'notice.open-file': 'Please open a markdown file first',
	'notice.right-click-url': 'Right-click a URL in the editor to collect',
};

const zh: Record<TranslationKey, string> = {
	'tab.file-menu-file': '文件',
	'tab.file-menu-folder': '文件夹',
	'tab.editor-menu': '编辑器',
	'tab.tab-menu': '标签页',
	'tab.files-menu': '多文件',
	'tab.url-menu': 'URL',
	'empty.title': '尚未收集到菜单项',
	'empty.hint': '点击刷新按钮，或在 Obsidian 中右键以收集。',
	'eye.hide': '点击隐藏',
	'eye.show': '点击显示',
	'refresh': '刷新',
	'notice.open-explorer': '请先打开文件管理器',
	'notice.open-file': '请先打开一个 Markdown 文件',
	'notice.right-click-url': '在编辑器中右键点击链接以收集',
};

const zhTW: Record<TranslationKey, string> = {
	'tab.file-menu-file': '檔案',
	'tab.file-menu-folder': '資料夾',
	'tab.editor-menu': '編輯器',
	'tab.tab-menu': '標籤頁',
	'tab.files-menu': '多檔案',
	'tab.url-menu': 'URL',
	'empty.title': '尚未收集到選單項',
	'empty.hint': '點選重新整理按鈕，或在 Obsidian 中右鍵以收集。',
	'eye.hide': '點選隱藏',
	'eye.show': '點選顯示',
	'refresh': '重新整理',
	'notice.open-explorer': '請先開啟檔案總管',
	'notice.open-file': '請先開啟一個 Markdown 檔案',
	'notice.right-click-url': '在編輯器中右鍵點選連結以收集',
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
