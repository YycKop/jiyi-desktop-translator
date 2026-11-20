'use strict';
/**
 * 配置默认值与结构定义（core/config/defaults.js）
 *
 * 结构依据 M4.3 数据模型 + M1~M5 细节书，字段名与 IPC 契约（开发文档/V1-IPC契约说明书）保持一致。
 */

const DEFAULTS = {
  version: 1,
  /** 首次启动引导是否已完成（M5-T4） */
  onboarded: false,
  general: {
    uiLanguage: 'zh-CN',
    /** 目标语言，F-07 */
    targetLang: 'zh',
    /** 源语言，'auto' 为自动检测 */
    sourceLang: 'auto',
    /** 是否启用翻译结果去重（OCR 文本未变化时跳过重复翻译） */
    dedupeEnabled: true,
    /** 无变化时的最短翻译间隔（毫秒），降低模型空转 */
    minRetranslateMs: 0,
    /**
     * 翻译通道优先级（第十八轮需求 1/2）：
     *  'online'  先联网 API，全部失败再降级离线（默认，F-05a/F-06 原行为）
     *  'offline' 先离线模型，失败再走联网 API
     */
    priority: 'online',
    /** 点击 exe / 托盘左键时打开哪个窗口（第十二轮需求） */
    launchAction: 'settings',
    /**
     * 常驻悬浮球（第十九轮需求 4）：
     * 本机通知区域拒绝注册新图标，悬浮球是唯一稳定的常驻入口，因此默认开启；
     * 鼠标移上去会展开「设置 / 输入 / 浮窗 / 退出」四个快捷项。
     */
    ballEnabled: true,
  },
  capture: {
    /** 框选区域（物理屏幕坐标，多显示器为全局坐标，M2-T4 持久化） */
    lastSelection: null,
    /** 'manual' | 'interval'（F-11） */
    mode: 'interval',
    intervalMs: 2000,
  },
  /** 外观自定义（F-12/F-13 增强：主题色、透明度、背景图，浮窗与设置页共用） */
  appearance: {
    /** 主题色（十六进制），用于强调色、徽章、按钮 */
    accent: '#4c8dff',
    /** 卡片背景基色 */
    background: '#12151c',
    /** 卡片不透明度 0.3–1 */
    opacity: 0.84,
    /** 背景模糊半径 px（0 = 关闭毛玻璃） */
    blur: 12,
    /** 圆角 px */
    radius: 12,
    /** 浮窗背景图绝对路径（存于数据目录 theme/ 下，空串表示无） */
    bgImage: '',
    /** 浮窗背景图不透明度 0–1 */
    bgImageOpacity: 0.35,
    /** 设置页背景图绝对路径（空串 = 沿用浮窗那张） */
    settingsBgImage: '',
    /** 设置页背景图不透明度 0–1 */
    settingsBgImageOpacity: 0.35,
    /** 背景图填充方式：cover | contain | tile（两处共用） */
    bgImageFit: 'cover',
    /** 字体颜色（空串 = 跟随背景自动对比度：深底浅字 / 浅底深字） */
    textColor: '',
  },
  hud: {
    opacity: 0.84,
    fontSize: 14,
    maxWidth: 420,
    /**
     * 浮窗呈现模式（第十八轮需求 3）：
     *  'card'     半透明卡片，带标题栏与底部信息（默认）
     *  'subtitle' 视频/游戏字幕条：细长、整条透明，只留描边文字
     */
    mode: 'card',
    /** 字幕模式字号（px），比卡片模式大，隔着游戏画面也能看清 */
    subtitleFontSize: 24,
    /** 字幕模式是否加一层极淡底衬（默认不加，靠文字描边保证可读） */
    subtitleBackdrop: false,
    /** 字幕条尺寸（0 = 自动：宽取工作区 86%，高 96） */
    subtitleWidth: 0,
    subtitleHeight: 0,
    /** 字幕条位置（null = 底部居中；用户拖动后记录坐标） */
    subtitlePoint: null,
    /** 浮窗尺寸（用户可拖动边缘调整，D 需求 3） */
    width: 460,
    height: 240,
    /** 高度随译文内容自适应 */
    autoHeight: true,
    /** 自动位置：'auto' | 'right' | 'left' | 'below' | 'above' | 'fixed' */
    position: 'auto',
    fixedPoint: null,
    collapsed: false,
    /** 悬浮球位置（屏幕坐标） */
    ballPoint: null,
    /** 是否显示引擎标识（M4-T5） */
    showEngine: true,
    /** 历史译文保留条数（F-12 滚动查看历史） */
    historySize: 20,
  },
  hotkeys: {
    /** 框选（F-09） */
    select: 'CommandOrControl+Shift+T',
    /** 手动刷新（F-11） */
    refresh: 'CommandOrControl+Shift+R',
    /** 暂停/继续定时翻译（F-11，一键停止，不必进设置） */
    pause: 'CommandOrControl+Alt+S',
    /** 显示/隐藏浮窗 */
    toggleHud: 'CommandOrControl+Shift+Y',
    /** 收起/展开 */
    collapse: 'CommandOrControl+Shift+U',
  },
  /** 联网 API 列表，按 order 升序构成主用→备用链（F-05a） */
  apis: [],
  offline: {
    /** llama.cpp 可执行文件路径（llama-server） */
    serverPath: '',
    /** GGUF 模型路径 */
    modelPath: '',
    port: 8081,
    host: '127.0.0.1',
    contextSize: 4096,
    /**
     * 启动宿主壳时自动拉起 llama-server。
     * 第二十二轮改为默认关闭：Q4_K_M 常驻要 1.9–2.2 GB 内存，
     * 而多数用户以在线 API 为主，没必要一开机就占着。真正需要时
     * （离线优先 / 在线全失败）由 ensureOfflineReady() 现拉，等 10 秒换 2 GB 值得。
     */
    autostart: false,
    /**
     * 空闲多久自动卸载模型（毫秒，0 = 不自动卸载）。
     * 卸载只是停掉 llama-server 进程，下次用到会重新拉起。
     */
    idleStopMs: 600000,
    /** SEC-CORS-01：CORS 允许来源，必须限定本机 */
    corsOrigins: 'localhost',
    /** 语音/翻译提示词使用的模型名标识 */
    modelName: 'hy-mt',
    /** 单次离线请求超时（首次推理可能较慢，M1-T4 规定 10s） */
    timeoutMs: 10000,
    threads: 0,
    gpuLayers: 0,
  },
  network: {
    /** 主用 API 超时（F-05a） */
    primaryTimeoutMs: 5000,
    /** 备用 API 超时（F-05a） */
    backupTimeoutMs: 3000,
    /** 最多串行尝试的 API 数（F-05a） */
    maxApiAttempts: 2,
  },
  /** 识别引擎：auto = ONNX 优先、其次系统 OCR；也可固定为 rapid / winrt / tesseract */
  ocr: {
    engine: 'auto',
    /** 识别语言：auto = 中英优先、置信度低时自动试日/韩；也可固定 ch / japan / korean */
    lang: 'auto',
  },
  advanced: {
    logLevel: 'info',
    /** 宿主桥端口，0 表示自动选择 */
    bridgePort: 0,
  },
  /** 内部使用：加密盐与密文索引（不含任何明文密钥，KEY-02） */
  secrets: {
    salt: '',
    items: {},
  },
};

/** M4-T2 预置模板 */
const API_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    docs: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    docs: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-20241022',
    docs: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-1.5-flash',
    docs: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    docs: '',
  },
];

const DEFAULT_SYSTEM_PROMPT =
  'You are a professional translator. Translate the user text into {target}. '
  + 'Preserve line breaks. Output only the translated text, without explanation, quotes or notes.';

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function defaults() {
  return deepClone(DEFAULTS);
}

module.exports = { DEFAULTS, API_PRESETS, DEFAULT_SYSTEM_PROMPT, defaults, deepClone };
