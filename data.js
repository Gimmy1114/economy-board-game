// 派對棋盤資料：企業技能、道具、格子與即時事件。
export const SECTORS=['製造業','消費業','金融業','能源與運輸','民生業','科技業'];

export const ROLES=[
  {id:'auto',name:'汽車製造商',sector:'製造業',icon:'🚘',skill:{name:'關稅壁壘',icon:'🧱',desc:'接下來 2 回合，其他玩家踩紅格扣款翻倍。',target:'none'}},
  {id:'electronics',name:'電子製造商',sector:'製造業',icon:'💻',skill:{name:'專利訴訟',icon:'⚖️',desc:'指定玩家下回合暫停行動，並轉移 200 總資產給你。',target:'opponent'}},
  {id:'retail',name:'百貨零售商',sector:'消費業',icon:'🛍️',skill:{name:'瘋狂週年慶',icon:'🎊',desc:'本回合其他玩家踩藍格賺的總資產，全部存入你的帳戶。',target:'none'}},
  {id:'bank',name:'銀行',sector:'金融業',icon:'🏦',skill:{name:'緊縮銀根',icon:'🔒',desc:'指定玩家下回合只能前進 1 格，且踩格拿不到獎勵。',target:'opponent'}},
  {id:'investment',name:'投資公司',sector:'金融業',icon:'📈',skill:{name:'惡意做空',icon:'🔻',desc:'竊取指定玩家 25% 總資產（最多 500），壯大自己的總資產池。',target:'opponent'}},
  {id:'energy',name:'能源公司',sector:'能源與運輸',icon:'⚡',skill:{name:'限電危機',icon:'🔌',desc:'指定一個產業：該產業玩家本回合禁用技能，且下次踩格強制視為紅格。',target:'sector'}},
  {id:'logistics',name:'物流運輸公司',sector:'能源與運輸',icon:'🚚',skill:{name:'扣留貨物',icon:'📦',desc:'把罷工幽靈移到指定玩家前方 1–3 格，擋住他的去路。',target:'opponent'}},
  {id:'property',name:'房地產公司',sector:'民生業',icon:'🏙️',skill:{name:'炒地皮',icon:'🏗️',desc:'指定玩家接下來 2 個回合，每回合付你 100 租金。',target:'opponent'}},
  {id:'agriculture',name:'農業食品公司',sector:'民生業',icon:'🌾',skill:{name:'糧食霸權',icon:'🍚',desc:'所有對手損失 150 總資產，其中半數轉給你。',target:'none'}},
  {id:'technology',name:'科技服務公司',sector:'科技業',icon:'🧪',skill:{name:'駭客攻擊',icon:'🕶️',desc:'隨機刪除指定玩家 1 點技能能量，或偷取 300 總資產。',target:'opponent'}}
];

export const ITEMS=[
  {id:'shield',name:'買保險',icon:'🛡️',desc:'獲得 1 層護盾，維持到下次自己回合開始，可疊加並抵擋 1 次其他玩家的負面干擾。'},
  {id:'dice123',name:'123 骰子',icon:'🎲',desc:'本回合擲骰必定落在 1、2 或 3，覆蓋先前的變骰效果。'},
  {id:'dice456',name:'456 骰子',icon:'🎲',desc:'本回合擲骰必定落在 4、5 或 6，覆蓋先前的變骰效果。'},
  {id:'swap',name:'移形換位',icon:'🔄',desc:'選擇一位對手互換位置，雙方立刻觸發落地格效果；擲骰前可重複使用。'},
  {id:'leverage',name:'開槓桿',icon:'📈',desc:'本回合踩格效果 ×2，包含獲利、扣款、技能能量與幽靈格扣款。'}
];

const TILE_COLORS={start:'出發',blue:'發財',red:'蕭條',yellow:'技能',green:'事件'};
const TILE_ICONS={start:'🚩',blue:'💰',red:'📉',yellow:'⚡',green:'❓'};
const TILE_VALUES={blue:300,red:150,yellow:1,green:0,start:0};
const TILE_ORDER=['start','blue','red','yellow','green','blue','blue','red','yellow','green','blue','red','yellow','green','blue','red','yellow','green','blue','blue','red','yellow','green','blue'];
export const BOARD=TILE_ORDER.map((type,index)=>({
  index,
  type,
  label:TILE_COLORS[type],
  icon:TILE_ICONS[type],
  value:TILE_VALUES[type],
  stay:type==='start'?'在地圖四個角落取得紅、綠、藍、黃四種記號後，經過出發點可領取1000元補助金，領取後記號重置':type==='blue'?'發財格：獲得總資產':type==='red'?'蕭條格：扣除營運費':type==='yellow'?'技能格：補充技能能量':type==='green'?'事件格：抽一張即時事件':'出發格'
}));

export const PARTY_EVENTS=[
  {id:'G01',name:'全體股東紅利',icon:'🎉',kind:'allCash',amount:400,text:'景氣大好，全體玩家各獲得 400 總資產。'},
  {id:'G02',name:'市場恐慌拋售',icon:'🌪️',kind:'allCash',amount:-200,text:'市場信心崩跌，全體玩家各損失 200 總資產。'},
  {id:'G03',name:'政府紓困案',icon:'🏛️',kind:'selfCash',amount:500,text:'政府點名補助，你獲得 500 總資產。'},
  {id:'G04',name:'同業搶單',icon:'🥊',kind:'selfCash',amount:-250,text:'競爭對手截走訂單，你損失 250 總資產。'},
  {id:'G05',name:'技術突破',icon:'💡',kind:'selfEnergy',amount:2,text:'研發團隊傳來好消息，你獲得 2 點技能能量。'},
  {id:'G06',name:'幽靈騷動',icon:'👻',kind:'allEnergy',amount:-1,text:'罷工幽靈四處作亂，全體玩家失去 1 點技能能量。'}
];

export const DECISION_OPTIONS=[
  {id:'invest',label:'A · 投資研發',icon:'🔬',desc:'支付 300 總資產，立刻獲得 2 點技能能量。',cash:-300,energy:2},
  {id:'squeeze',label:'B · 壓榨勞工',icon:'🏭',desc:'立刻獲得 200 總資產，但失去 1 點技能能量。',cash:200,energy:-1}
];

export const ITEM_CHANCE=0.2;
export const STAR_COST=1000;
export const STAR_GOAL=3;
export const ACQUIRE_COST=2000;
export const ACQUIRE_DISCOUNT_COST=1000;
export const REBEL_COST=1000;
export const START_CASH=2000;
