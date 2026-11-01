// ============================================================================
// 派對擴充資料層（非破壞性新增）
// 所有新模式、神話道具、特殊格、輪盤與決策都集中在這個檔案。
// ============================================================================

// 玩家棋子顏色：索引會存進 player.color，顏色本身與棋子上的文字色分開定義。
export const PLAYER_COLORS = [
  { id: 'red', name: '亮紅', hex: '#e11d48', ink: '#ffffff' },
  { id: 'blue', name: '寶石藍', hex: '#2563eb', ink: '#ffffff' },
  { id: 'green', name: '翠綠', hex: '#16a34a', ink: '#ffffff' },
  { id: 'yellow', name: '明黃', hex: '#facc15', ink: '#17212b' },
  { id: 'purple', name: '尊爵紫', hex: '#7c3aed', ink: '#ffffff' },
  { id: 'orange', name: '活力橘', hex: '#ea580c', ink: '#ffffff' },
  { id: 'pink', name: '粉紅', hex: '#db2777', ink: '#ffffff' },
  { id: 'cyan', name: '青藍', hex: '#0891b2', ink: '#ffffff' },
  { id: 'black', name: '型格黑', hex: '#374151', ink: '#ffffff' },
  { id: 'lime', name: '檸檬綠', hex: '#84cc16', ink: '#17212b' }
];

export const GAME_MODES = {
  star: {
    id: 'star',
    name: '企業之星',
    short: '企業之星',
    icon: '🌟',
    cup: '企業之星盃',
    color: '#ca9451',
    desc: '起步後每次經過或踩到起始格都能購買星星，只有「在起始格買星」會讓星價上漲；達到房間設定的勝利星數後，當季結算星數最高的獲勝！',
    win: '先拿到房間設定的勝利星數；或當季結算時星數最高。',
    defaultRounds: 20,
    defaultTarget: 3,
    starGoal: 3
  },
  tycoon: {
    id: 'tycoon',
    name: '首富競爭',
    short: '首富競爭',
    icon: '💰',
    cup: '首富競爭盃',
    color: '#c55d5d',
    desc: '達到房間設定的總資產目標即獲勝。季數過半通膨 2 倍，倒數兩季通膨 4 倍，總資產瞬間變薄也瞬間暴漲。',
    win: '總資產率先達到房間設定的目標；季末比較總資產。',
    defaultRounds: 30,
    defaultTarget: 8000,
    starGoal: 3
  },
  evil: {
    id: 'evil',
    name: '邪惡企業',
    short: '邪惡企業',
    icon: '💀',
    cup: '邪惡企業盃',
    color: '#7a60ad',
    desc: '生存模式。每 5 季杜芬舒斯大樓發射雷射收保護費，付不出來就變成藍色幽靈，直到只剩唯一的倖存者。',
    win: '成為唯一的倖存者；季末比較生還季數。',
    defaultRounds: 20,
    defaultTarget: 0,
    starGoal: 3
  },
  random: {
    id: 'random',
    name: '隨機模式',
    short: '隨機',
    icon: '🎲',
    cup: '命運隨機盃',
    color: '#5979b0',
    desc: '開局時從企業之星、首富競爭、邪惡企業中隨機抽一種模式，抽到什麼就玩什麼。',
    win: '依隨機抽到的模式決定。',
    defaultRounds: 12,
    defaultTarget: 0,
    starGoal: 3
  }
};

export const MODE_IDS = ['star', 'tycoon', 'evil'];

export const RANDOM_ROLE_ID = 'random';

// 十大企業翻新：保留原本十個角色欄位與顏色，全面換成派對化技能。
export const PARTY_ROLES = [
  {
    id: 'social', name: '社群媒體巨頭', sector: '科技業', icon: '📱',
    skill: {
      id: 'burn', name: '炎上商法', icon: '🔥', target: 'opponent',
      desc: '指定對手下回合套用 123 骰子，且踩紅格扣款翻倍。'
    }
  },
  {
    id: 'hardware', name: '智慧硬體大廠', sector: '製造業', icon: '⌚',
    skill: {
      id: 'obsolete', name: '計畫性報廢', icon: '🧨', target: 'opponent',
      desc: '摧毀對手 1 個道具，並轉化為自己 200 總資產。'
    }
  },
  {
    id: 'ecommerce', name: '電商平台寡頭', sector: '消費業', icon: '🛒',
    skill: {
      id: 'shopping', name: '購物節狂歡', icon: '🎁', target: 'none',
      desc: '立刻吸取全場對手各 80 元，且本回合自己踩格效果無效化（無敵）。'
    }
  },
  {
    id: 'investment', name: '吸血投資集團', sector: '金融業', icon: '🩸',
    skill: {
      id: 'short', name: '惡意做空', icon: '📉', target: 'opponent',
      desc: '偷取 150 元；若對方總資產低於你，額外偷 1 個道具。'
    }
  },
  {
    id: 'fastfood', name: '跨國速食連鎖', sector: '消費業', icon: '🍔',
    skill: {
      id: 'junk', name: '垃圾食物成癮', icon: '🍟', target: 'none',
      desc: '全場對手扣 100 元，每扣成功一人自己回饋 50 元。'
    }
  },
  {
    id: 'delivery', name: '外送平台巨頭', sector: '能源與運輸', icon: '🛵',
    skill: {
      id: 'ghostOrder', name: '幽靈派單', icon: '👻', target: 'tile',
      desc: '將罷工幽靈隨意放置在地圖上任意格（出發格除外）。'
    }
  },
  {
    id: 'bank', name: '傳統金控銀行', sector: '金融業', icon: '🏦',
    skill: {
      id: 'freeze', name: '凍結帳戶', icon: '❄️', target: 'opponent',
      desc: '指定對手下回合經過出發格絕對無法買星，且禁用道具。'
    }
  },
  {
    id: 'property', name: '炒房地產集團', sector: '民生業', icon: '🏗️',
    skill: {
      id: 'seize', name: '強制徵收', icon: '🚜', target: 'opponent',
      desc: '與對手同格或經過時，強制將對方擊退 3 格並搶奪 200 元。'
    }
  },
  {
    id: 'green', name: '綠能生技集團', sector: '能源與運輸', icon: '🌱',
    skill: {
      id: 'carbon', name: '碳稅制裁', icon: '🌫️', target: 'none',
      desc: '自動鎖定全場總資產最高者，強制扣 300 元。'
    }
  },
  {
    id: 'cloud', name: '雲端駭客組織', sector: '科技業', icon: '🕶️',
    skill: {
      id: 'zeroDay', name: '零日漏洞', icon: '💻', target: 'opponent',
      desc: '無視護盾，隨機竊取對方 1 點技能能量或 1 個道具。'
    }
  }
];

export const UNDECIDED_ROLE = {
  id: RANDOM_ROLE_ID,
  name: '未定新創集團',
  sector: '尚未決定',
  icon: '🎲',
  skill: {
    id: 'randomize', name: '命運未定', icon: '🎲', target: 'none',
    desc: '進入遊戲後隨機分配一家企業與其專屬技能。'
  }
};

export const LOBBY_ROLES = [...PARTY_ROLES, UNDECIDED_ROLE];

export const MYTHIC_ITEMS = [
  {
    id: 'totem', name: '不死圖騰', icon: '🗿', mode: 'evil', kind: 'passive',
    desc: '抵禦一次雷射處決，觸發後銷毀。'
  },
  {
    id: 'indulgence', name: '贖罪券', icon: '🎫', kind: 'passive', charges: 5,
    desc: '被動絕對防禦。自動銷毀並抵銷 5 次扣總資產效果（移形換位代價除外）。'
  },
  {
    id: 'vector', name: '矢量操作', icon: '⬆️', kind: 'active',
    desc: '擲骰前在地圖上指定 1 個格子。本回合自己移動時，出發格、沿途與最後停留格上的其他玩家，會立刻被傳送到該格並強制觸發格子效果；使用一次即消耗。'
  },
  {
    id: 'truthGate', name: '真理之門', icon: '🚪', kind: 'active', charges: 3,
    desc: '可使用3次。可將 1,000 總資產變成指定普通道具，或把 1 個道具煉成 1,000 總資產。'
  },
  {
    id: 'starBlade', name: '斬魄刀', icon: '🗡️', mode: 'star', kind: 'passive',
    desc: '基礎型態，沒有特殊效果。持有者獲得星星後自動進化為「卍解」；若星星失去則退化回斬魄刀。'
  },
  {
    id: 'bankai', name: '卍解', icon: '🌀', mode: 'star', kind: 'passive', hidden: true,
    desc: '斬魄刀進化型態：收益 +100、免疫負面效果，但禁止獲取新道具。星星被偷走時退化回斬魄刀。'
  },
  {
    id: 'iceMushroom', name: '寒冰蘑菇', icon: '❄️', kind: 'active',
    desc: '凍結其餘玩家 1 回合，並在 3 回合期間禁用他們的技能與道具。'
  },
  {
    id: 'witchFactor', name: '魔女因子', icon: '🦠', kind: 'passive',
    desc: '被動持有。碰觸幽靈即觸發「死亡回歸」，全場狀態回溯至本次擲骰前。'
  },
  {
    id: 'weakDomain', name: '弱者的領域', icon: '🌐', kind: 'active',
    desc: '展開 3 格藍框領域一回合，進入者扣 100；範圍內他人禁用技能／道具。代價：下回合只能走 1 步且禁用換骰道具。'
  }
];

export const MYTHIC_BY_ID = Object.fromEntries(MYTHIC_ITEMS.map(x => [x.id, x]));

// 系統特殊道具：獨立於普通道具與黑市神話道具，不列入遊戲規則說明書。
export const SPECIAL_ITEMS = [
  {
    id: 'fateDice', name: '命運骰子', icon: '🎲', kind: 'active', special: true,
    desc: '使用後展開 2×3 骰面，自選 1–6 步強制前進；使用一次後消失。'
  }
];

export const SPECIAL_ITEM_BY_ID = Object.fromEntries(SPECIAL_ITEMS.map(x => [x.id, x]));

export const FATE_DICE_ID = 'fateDice';
export const TYCOON_BLUE_REWARD = 500;
export const TYCOON_COMEBACK_SEASONS = 3;

export const SPECIAL_TILE_META = {
  market: { label: '黑市', icon: '🛒', color: 'purple', desc: '隱藏神話道具拍賣：起標 1,000，每次抬價 250。' },
  invest: { label: '投資', icon: '📈', color: 'orange', desc: '投入 50% 總資產換取股票憑證，季末結算暴漲或歸零。' },
  tax: { label: '查稅局', icon: '🏛️', color: 'black', desc: '二選一：繳 50% 總資產，或強制羈押 2 回合。' },
  insider: { label: '內線交易', icon: '🌈', color: 'rainbow', desc: '花 100 啟動命運輪盤，用完後轉為普通格並在別處重生。' }
};

export const SPECIAL_COUNTS = { market: 3, invest: 2, tax: 1, insider: 1 };

export const NORMAL_TILE_TYPES = ['blue', 'red', 'yellow', 'green'];

export const WHEEL_EFFECTS = [
  { id: 'stealStar', name: '偷星', icon: '🌟', tone: 'star', mode: 'star', desc: '隨機偷走一位對手 1 顆星。' },
  { id: 'earlyDoom', name: '提早末日', icon: '💀', tone: 'evil', mode: 'evil', desc: '立刻提前觸發一次毀滅日收保護費。' },
  { id: 'windfall', name: '天降橫財', icon: '💸', tone: 'good', desc: '立刻獲得 5,000 總資產。' },
  { id: 'halve', name: '資產腰斬', icon: '✂️', tone: 'bad', desc: '自己的總資產立刻減半。' },
  { id: 'supply', name: '道具補給 x2', icon: '🎒', tone: 'good', desc: '立刻抽 2 個道具。' },
  { id: 'darkweb', name: '暗網走私', icon: '🕶️', tone: 'good', desc: '獲得 1 個隨機隱藏神話道具。' },
  { id: 'overnight', name: '一夜暴富', icon: '🤑', tone: 'good', desc: '立刻獲得 2,000 總資產。' },
  { id: 'haunt', name: '幽靈纏身', icon: '👻', tone: 'bad', desc: '指定一位玩家立刻撞上罷工幽靈。' },
  { id: 'discountStar', name: '特價星', icon: '⭐', tone: 'star', mode: 'star', desc: '立刻以 500 總資產買下 1 顆星。' },
  { id: 'redistribute', name: '財富重分配', icon: '💱', tone: 'special', desc: '與總資產第一名交換總資產；自己第一名則無效。' },
  { id: 'robinHood', name: '劫富濟貧', icon: '🥣', tone: 'special', mode: 'tycoon', desc: '（首富限定）與最後一名交換總資產。' },
  { id: 'sucker', name: '含淚當盤子', icon: '🤡', tone: 'special', mode: 'star', desc: '（企業之星限定）強迫送 1 顆星給星數最少的玩家；自己無星則無效。' }
];

export const QUICK_DECISIONS = [
  {
    id: 'labor', name: '勞資關係', icon: '🤝',
    text: '工會代表把一份連署書放在你桌上，要求改善輪班與加班費。',
    options: [
      { id: 'invest', label: 'A · 加薪留才', icon: '🧑‍🏭', desc: '支付 200，換取 1 點技能能量。', cash: -200, energy: 1 },
      { id: 'squeeze', label: 'B · 裁員節流', icon: '📋', desc: '獲得 300，但失去 1 點技能能量。', cash: 300, energy: -1 }
    ]
  },
  {
    id: 'rnd', name: '研發與變現', icon: '🔬',
    text: '實驗室做出一個能改變市場的原型，但量產需要總資產。',
    options: [
      { id: 'invest', label: 'A · 投入研發', icon: '🧪', desc: '支付 400，獲得 2 點技能能量。', cash: -400, energy: 2 },
      { id: 'squeeze', label: 'B · 出售專利', icon: '💼', desc: '獲得 600，但失去 1 點技能能量。', cash: 600, energy: -1 }
    ]
  },
  {
    id: 'supply', name: '供應鏈決策', icon: '🚚',
    text: '關鍵零件突然缺貨，供應商給你兩個方案。',
    options: [
      { id: 'invest', label: 'A · 簽長約鎖價', icon: '📦', desc: '支付 300，獲得 1 點能量與 1 層護盾。', cash: -300, energy: 1, shields: 1 },
      { id: 'squeeze', label: 'B · 現貨掃貨', icon: '🏷️', desc: '獲得 200，但失去 1 點技能能量。', cash: 200, energy: -1 }
    ]
  },
  {
    id: 'pr', name: '公關危機', icon: '📰',
    text: '一篇爆料文在深夜衝上熱搜，董事會等你表態。',
    options: [
      { id: 'invest', label: 'A · 道歉捐款', icon: '🙇', desc: '支付 250，獲得 1 層護盾。', cash: -250, shields: 1 },
      { id: 'squeeze', label: 'B · 硬拗到底', icon: '📢', desc: '獲得 150，但失去 1 點技能能量。', cash: 150, energy: -1 }
    ]
  },
  {
    id: 'spy', name: '商業間諜', icon: '🕵️',
    text: '對手的研究員願意用一個隨身碟換一筆錢。',
    options: [
      { id: 'invest', label: 'A · 買下情報', icon: '💾', desc: '支付 350，獲得 2 點技能能量。', cash: -350, energy: 2 },
      { id: 'squeeze', label: 'B · 反向操作', icon: '📉', desc: '獲得 250，但失去 1 點技能能量。', cash: 250, energy: -1 }
    ]
  },
  {
    id: 'market', name: '市場投資', icon: '📊',
    text: '分析師遞來兩份報告，一份保守、一份激進。',
    options: [
      { id: 'invest', label: 'A · 加碼布局', icon: '🚀', desc: '支付 500，獲得 250 的股票憑證與 1 點技能能量。', cash: -500, energy: 1, certificate: 250 },
      { id: 'squeeze', label: 'B · 落袋為安', icon: '💵', desc: '獲得 200 並保留總資產。', cash: 200 }
    ]
  }
];

export const QUICK_DECISION_FALLBACK = {
  id: 'nothing', label: 'C · 什麼都不做', icon: '🚪',
  desc: '不採取任何行動，但扣除 100 總資產（可負債，最低常駐可選）。', cash: -100, allowDebt: true
};

export const STAR_PRICE_START = 500;
export const STAR_PRICE_STEP = 500;
export const FORCED_STAR_PREMIUM = 300;
export const TYCOON_TARGET = 8000;
export const DOOM_START = 1000;
export const DOOM_STEP = 500;
export const DOOM_EVERY = 5;
export const MAX_PLAYERS = 8;

export const SPECIAL_TILE_KEYS = Object.keys(SPECIAL_TILE_META);
