export const zh = {
  brand: "TrayClip",

  // 通用
  home: "首页",
  confirm: "确认",
  cancel: "取消",
  delete: "删除",
  search: "搜索",
  settings: "设置",
  about: "关于",
  all: "全部",
  copy: "复制",
  apply: "应用",
  pin: "置顶",
  unpin: "取消置顶",

  // 窗口栏
  toggleTheme: "切换主题",
  toggleLang: "切换语言",
  closeWindow: "关闭窗口",

  // 剪贴记录
  searchPlaceholder: "搜索",
  groupNamePlaceholder: "分组名",
  createGroup: "新建分组",
  recordsCount: (n: number) => `${n} 条记录`,
  renameGroupHint: (name: string) => `双击重命名，右键删除「${name}」`,

  // 内容类型
  contentType: {
    plain_text: "纯文本",
    rich_text: "富文本",
    image: "图片",
    file_paths: "文件路径",
  } as Record<string, string>,

  // ClipCard
  moreFiles: (n: number) => `及其他 ${n} 个文件`,
  emptyRecords: "暂无记录",

  // 分组选择
  searchGroup: "搜索分组",
  ungrouped: "全部",
  noMatchGroup: "无匹配分组",

  // 确认对话框
  confirmClose: "关闭窗口将隐藏到托盘继续运行，还是直接退出？",
  hideToTray: "隐藏到托盘",
  exitApp: "退出",
  confirmDeleteGroup: (name: string) => `确定删除分组「${name}」？组内记录不会被删除，将恢复为未分组状态。`,
  confirmClearHistory: "确定清空所有普通历史记录？置顶记录不会被删除。此操作不可撤销。",
  confirmDeleteClip: "确定删除这条记录？此操作不可撤销。",
  copiedToClipboard: "已复制到剪贴板",

  // 关于页
  aboutTitle: "关于 TrayClip",
  aboutDesc: "TrayClip 是一款纯本地剪贴板工具，专注历史记录、分组、置顶和快捷操作。",
  aboutVersion: (v: string) => `当前版本：${v}`,
  aboutStorage: "数据存储：本机本地",
  aboutPlatform: "支持平台：Windows / macOS / Linux",
  aboutLicense: "开源协议：MIT",
  checking: "检查中...",
  checkUpdate: "检查更新",
  newVersion: (v: string) => `发现新版本 v${v}`,
  goToDownload: "前往下载",
  upToDate: "已是最新版本",
  checkFailed: (err: string) => `检查失败：${err}`,

  // 设置页
  dataManagement: "数据管理",
  retentionLimit: "历史记录保留条数",
  pauseCapture: "暂停采集剪贴板",
  copyAfterBehavior: "复制后行为",
  copyAfterNone: "无",
  copyAfterQuickPaste: "快捷粘贴",
  copyAfterHideWindow: "隐藏窗口",
  urlToast: "链接提示",
  openLink: "打开",
  backup: "备份",
  restore: "还原",
  confirmRestore: "还原将替换所有数据（记录、分组、设置），应用会自动重启。确定继续？",
  backupData: "数据备份",
  clearHistory: "清空历史记录",
  clear: "清空",
  systemBehavior: "系统行为",
  launchOnStartup: "开机自动启动",
  closeBehavior: "关闭窗口时",
  hideToTrayRecommended: "隐藏到托盘（推荐）",
  exitDirectly: "直接退出",
  askEveryTime: "每次询问",
  panelPosition: "窗口呼出位置",
  centerScreen: "屏幕中间",
  followMouse: "跟随鼠标",
  hotkeys: "快捷键",
  openMainWindow: "打开列表窗口",
  restoreDefault: "恢复默认",
  pressHotkey: "按下快捷键...",

  // AI 增强
  enableAi: "启用 AI 增强",
  aiEnhancement: "AI 增强",
  llmApiUrl: "API 地址",
  llmApiUrlHint: "需兼容 OpenAI API 格式",
  llmApiKey: "API Key",
  llmModel: "模型名称",
  aiTranslate: "AI 翻译",
  extractKeywords: "AI提取关键词",

  aiSummarize: "AI摘要",
  aiProcessing: "AI 处理中...",
  aiResult: "AI 结果",
  copyResult: "复制",
  aiFailed: "AI 请求失败，请检查配置",
  aiDisclaimer: "以上内容由 AI 生成，请仔细甄别后使用",

  // 翻译
  translate: "翻译",
  translateBtn: "翻译",
  translating: "翻译中...",
  translateFailed: "翻译失败",
  bingSource: "翻译来源：Bing 翻译",

  // 右键菜单
  jsonCopy: "JSON 格式化复制",
};
