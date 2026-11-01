import {ROLES,ITEMS,BOARD,PARTY_EVENTS,DECISION_OPTIONS,SECTORS,ITEM_CHANCE,STAR_COST,STAR_GOAL,ACQUIRE_COST,ACQUIRE_DISCOUNT_COST,REBEL_COST,START_CASH} from './data.js';

// 擴充掛鉤：party_engine.js 會註冊這些回呼，原始規則完全保留。
export const engineHooks={};
export function boardOf(state){return Array.isArray(state?.board)&&state.board.length?state.board:BOARD}

// 玩家看到的格子編號一律從 1 起算（棋盤內部索引仍為 0 起算）。
export const tileNo=index=>Number(index)+1;
export const tileNoText=(list=[])=>list.map(tileNo).join('、');
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const round2=n=>Math.round((n+Number.EPSILON)*100)/100;
export const roleById=id=>ROLES.find(r=>r.id===id);
export const itemById=id=>ITEMS.find(x=>x.id===id);
const eventById=id=>PARTY_EVENTS.find(e=>e.id===id);
export const nextRandom=state=>{let x=state.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;state.rng=x|0;return (x>>>0)/4294967296};
export const pick=(state,items)=>items[Math.floor(nextRandom(state)*items.length)];
const ghostSeed=seed=>((Number(seed)|0)^0x6d2b79f5)||1;
const nextGhostRandom=state=>{let x=state.ghostRng|0;x^=x<<13;x^=x>>>17;x^=x<<5;state.ghostRng=x|0;return (x>>>0)/4294967296};
const currentPlayer=state=>state.players[state.turnIndex];

export function log(state,text){state.log.unshift(`第 ${state.round} 季｜${text}`);if(state.log.length>200)state.log.length=200}

export function ensureGhostState(state){
  if(!Number.isInteger(state.ghostRng)||state.ghostRng===0)state.ghostRng=ghostSeed(state.seed);
  const length=boardOf(state).length;
  if(!Number.isInteger(state.ghostPosition)||state.ghostPosition<0||state.ghostPosition>=length)state.ghostPosition=1+Math.floor(nextGhostRandom(state)*(length-1));
  if(!Array.isArray(state.ghostTrail))state.ghostTrail=[];
}

export function cornerMarksForBoard(length=BOARD.length){
  const rows=Math.ceil((length+4)/4),cols=Math.ceil((length+4)/2-rows);
  return {0:'red',[cols-1]:'green',[cols+rows-2]:'yellow',[2*cols+rows-3]:'blue'};
}
export const CORNER_MARKS=cornerMarksForBoard(BOARD.length);
const EMPTY_CORNER_MARKS=()=>({red:false,green:false,blue:false,yellow:false});

export function applyCornerProgress(state,player,path,{passedStart=false,effects=null}={}){
  if(!player)return null;
  const marks=player.marks&&typeof player.marks==='object'?player.marks:{};
  player.marks={red:marks.red===true,green:marks.green===true,blue:marks.blue===true,yellow:marks.yellow===true};
  const colors=[];
  for(const index of path||[]){
    const color=cornerMarksForBoard(boardOf(state).length)[index];
    if(color&&!player.marks[color]){
      player.marks[color]=true;
      colors.push(color);
      log(state,`📍 ${player.name} 取得${color==='red'?'紅色':color==='green'?'綠色':color==='blue'?'藍色':'黃色'}角落記號。`);
      effects?.push({icon:'📍',text:`取得${color==='red'?'紅色':color==='green'?'綠色':color==='blue'?'藍色':'黃色'}角落記號`,tone:'good'});
    }
  }
  // 經過或踩中出發點都算：只要路徑含出發格，集滿四色記號就發補助並重置。
  if(!passedStart||!Object.values(player.marks).every(Boolean))return null;
  const previousNoInflation=state.ext?.noInflation;
  if(state.ext)state.ext.noInflation=true;
  let amount;
  try{amount=addCash(state,player,1000)}finally{if(state.ext)state.ext.noInflation=previousNoInflation}
  player.marks=EMPTY_CORNER_MARKS();
  const event={type:'cornerSubsidy',playerId:player.id,playerName:player.name,amount,at:Date.now()};
  state.cornerSubsidyEvent=event;
  log(state,`🚩 ${player.name} 集齊四角記號，經過出發點領取 1,000 元補助金，記號已清除。`);
  effects?.push({icon:'🚩',text:'集齊四角記號，領取 1,000 元補助金',tone:'good'});
  return event;
}

function ensurePartyState(state){
  state.version=2;
  state.mode='party';
  if(!Array.isArray(state.board)||state.board.length<8)state.board=BOARD.map(t=>({...t}));
  if(!Number.isInteger(state.round)||state.round<1)state.round=1;
  if(!Number.isInteger(state.maxRounds)||state.maxRounds<2)state.maxRounds=10;
  state.starGoal=STAR_GOAL;
  if(!Array.isArray(state.players))throw Error('存檔缺少玩家資料。');
  state.turnIndex=clamp(Number(state.turnIndex)||0,0,state.players.length-1);
  state.rng=Number.isInteger(state.rng)&&state.rng!==0?state.rng:(Number(state.seed)|0)||1;
  state.effects=state.effects&&typeof state.effects==='object'?state.effects:{};
  if(!Array.isArray(state.log))state.log=[];
  if(!state.turnGains||typeof state.turnGains!=='object')state.turnGains={};
  if(!Array.isArray(state.winnerIds))state.winnerIds=[];
  if(!state.status)state.status='playing';
  if(!state.phase)state.phase=state.status==='finished'?'finished':'roll';
  if(state.status==='finished')state.phase='finished';
  if(!state.lastRoll)state.lastRoll=null;
  if(!state.pendingDecision)state.pendingDecision=null;
  if(!state.pendingLanding||typeof state.pendingLanding!=='object')state.pendingLanding=null;
  if(!state.cornerSubsidyEvent||typeof state.cornerSubsidyEvent!=='object')state.cornerSubsidyEvent=null;
  for(const p of state.players){
    p.cash=Number.isFinite(p.cash)?round2(p.cash):START_CASH;
    p.stars=Number.isInteger(p.stars)?p.stars:0;
    p.energy=Number.isInteger(p.energy)?clamp(p.energy,0,9):1;
    p.shields=Number.isInteger(p.shields)?p.shields:0;
    p.items=Array.isArray(p.items)?p.items.filter(id=>itemById(id)).slice(0,3):[];
    const marks=p.marks&&typeof p.marks==='object'?p.marks:{};
    p.marks={red:marks.red===true,green:marks.green===true,blue:marks.blue===true,yellow:marks.yellow===true};
    p.position=Number.isInteger(p.position)?p.position:0;
    p.skipTurns=Number.isInteger(p.skipTurns)?p.skipTurns:0;
    p.rentTurns=Number.isInteger(p.rentTurns)?p.rentTurns:0;
    p.rentTo=p.rentTo||null;
    p.parentId=p.parentId||null;
    p.leverage=Boolean(p.leverage);
    p.bankLock=Boolean(p.bankLock);
    p.noReward=Boolean(p.noReward);
    p.forcedRed=Boolean(p.forcedRed);
    p.forcedSteps=['low','high'].includes(p.forcedSteps)?p.forcedSteps:null;
    if(!Number.isInteger(p.color))p.color=state.players.indexOf(p);
  }
  ensureGhostState(state);
  for(const p of state.players)if(!Number.isFinite(state.turnGains[p.id]))state.turnGains[p.id]=0;
  return state;
}

export function createGame({players,seed=Date.now(),maxRounds=10,startingCash=START_CASH}){
  if(!Array.isArray(players)||players.length<2||players.length>8)throw Error('請選擇 2 至 8 位玩家。');
  const validRole=id=>engineHooks.roleExists?engineHooks.roleExists(id):Boolean(roleById(id));
  if(new Set(players.map(p=>p.roleId)).size!==players.length||players.some(p=>!validRole(p.roleId)))throw Error('每位玩家需要不同的企業角色。');
  const names=players.map(p=>String(p.name||'').trim());
  if(names.some(n=>!n)||new Set(names).size!==names.length)throw Error('玩家名稱不得空白或重複。');
  const n=Number(seed),limit=Number(maxRounds),cash=Number(startingCash);
  if(!Number.isInteger(n))throw Error('亂數種子無效。');
  if(!Number.isInteger(limit)||limit<2||limit>30)throw Error('季數上限須為 2–30。');
  if(!Number.isFinite(cash)||cash<0)throw Error('玩家初始總資產須為 0 以上。');
  const state={version:2,mode:'party',board:BOARD.map(t=>({...t})),net:null,round:1,maxRounds:limit,starGoal:STAR_GOAL,turnIndex:0,phase:'roll',rng:n|0||1,seed:n,
    players:players.map((p,i)=>({id:`player-${i+1}`,name:names[i],roleId:p.roleId,position:0,color:i,cash:round2(cash),stars:0,energy:1,items:[],marks:EMPTY_CORNER_MARKS(),shields:0,skipTurns:0,rentTo:null,rentTurns:0,parentId:null,leverage:false,bankLock:false,noReward:false,forcedRed:false,forcedSteps:null})),
    ghostRng:ghostSeed(n),ghostPosition:0,ghostTrail:[],
    effects:{},turnGains:{},lastRoll:null,pendingDecision:null,pendingLanding:null,
    log:[],status:'playing',resultReason:null,winnerIds:[],sync:null,ext:null,cornerSubsidyEvent:null};
  ensureGhostState(state);
  state.ghostPosition=1+Math.floor(nextGhostRandom(state)*(BOARD.length-1));
  state.log.unshift(`第 1 季｜派對開始！率先拿下 ${STAR_GOAL} 顆併購星就獲勝。`);
  startTurn(state);
  return state;
}

export function addCash(state,player,amount){
  if(!amount)return 0;
  if(engineHooks.adjustCash)amount=engineHooks.adjustCash(state,player,amount);
  // 全域扣款攔截：贖罪券等被動防禦必須在現金變動前生效，避免先觸發負債淘汰。
  if(amount<0&&engineHooks.beforeCash){
    const adjusted=engineHooks.beforeCash(state,player,amount);
    if(adjusted===false)return 0;
    if(Number.isFinite(adjusted))amount=adjusted;
    if(!amount)return 0;
  }
  player.cash=round2(player.cash+amount);
  if(amount>0&&state.turnGains)state.turnGains[player.id]=round2((state.turnGains[player.id]||0)+amount);
  if(engineHooks.afterCash)engineHooks.afterCash(state,player,amount);
  return amount;
}

export function consumeShield(state,target,label){
  if(target.shields>0){
    target.shields--;
    log(state,`🛡️ ${target.name} 的護盾擋下了「${label}」。`);
    return true;
  }
  return false;
}

export function drawItem(state,player){
  if(engineHooks.canDrawItem&&!engineHooks.canDrawItem(state,player))return null;
  if(player.items.length>=3)return null;
  const item=pick(state,ITEMS);
  player.items.push(item.id);
  if(engineHooks.itemAcquired)engineHooks.itemAcquired(state,player,item.id);
  log(state,`${player.name} 在回合開始抽到道具「${item.icon} ${item.name}」。`);
  return item;
}

export function finish(state,reason,winners){
  if(engineHooks.beforeFinish)engineHooks.beforeFinish(state,reason,winners);
  state.status='finished';
  state.phase='finished';
  state.resultReason=reason;
  state.winnerIds=winners.map(p=>p.id);
  state.pendingDecision=null;
  state.pendingLanding=null;
  log(state,`🏁 對局結束｜${winners.length?winners.map(p=>p.name).join('、'):'無人'}勝出。`);
}

export function checkStarWin(state){
  const leaders=state.players.filter(p=>p.stars>=STAR_GOAL);
  if(!leaders.length)return false;
  finish(state,'stars',leaders);
  return true;
}

export function moveGhost(state){
  if(engineHooks.moveGhost)return engineHooks.moveGhost(state);
  const steps=1+Math.floor(nextGhostRandom(state)*3),direction=nextGhostRandom(state)<.5?-1:1;
  const from=state.ghostPosition;
  state.ghostTrail=[from,...Array.from({length:steps},(_,i)=>(from+direction*(i+1)+BOARD.length)%BOARD.length)];
  state.ghostPosition=state.ghostTrail.at(-1);
}

export function startTurn(state){
  if(state.status!=='playing')return;
  const p=currentPlayer(state);
  state.turnGains[p.id]=0;
  p.leverage=false;
  p.forcedSteps=null;
  state.lastRoll=null;
  state.pendingDecision=null;
  state.pendingLanding=null;
  if(p.shields>0){
    log(state,`🛡️ ${p.name} 的 ${p.shields} 層護盾在回合開始時到期。`);
    p.shields=0;
  }
  if(engineHooks.startTurn)engineHooks.startTurn(state,p);
  drawItem(state,p);
  if(p.rentTo&&p.rentTurns>0){
    const owner=state.players.find(x=>x.id===p.rentTo);
    if(owner&&!consumeShield(state,p,'炒地皮租金')){
      addCash(state,p,-100);
      addCash(state,owner,100);
      log(state,`🏗️ ${p.name} 支付 ${owner.name} 100 租金（剩 ${p.rentTurns-1} 回合）。`);
    }
    p.rentTurns--;
    if(p.rentTurns<=0){p.rentTo=null;p.rentTurns=0}
  }
  if(p.skipTurns>0){
    p.skipTurns--;
    state.phase='skipped';
    log(state,`⏸️ ${p.name} 的企業暫停行動，這回合直接跳過。`);
    return;
  }
  state.phase='roll';
  log(state,`${p.name} 的回合開始，請在擲骰前使用道具或企業技能。`);
}

export function currentOf(state){return currentPlayer(state)}
export function movementPath(from,steps,length=BOARD.length){
  if(!Number.isInteger(from)||!Number.isInteger(steps)||!Number.isInteger(length)||from<0||from>=length||steps<0||steps>length||length<2)throw Error('棋盤移動參數無效。');
  return Array.from({length:steps},(_,i)=>(from+i+1)%length);
}

function tileEffect(state,player,{leverage=false,noReward=false,forcedRed=false}={}){
  const board=boardOf(state);
  const tile=board[player.position];
  const effects=[];
  const push=(icon,text,tone='neutral')=>effects.push({icon,text,tone});
  // 派對擴充：電商「購物節狂歡」的無敵狀態可讓本回合所有踩格效果失效。
  if(player.ext?.immune){
    push('✨','無敵狀態：本回合所有踩格效果無效化','good');
    return effects;
  }
  let type=forcedRed?'red':tile.type;
  if(forcedRed&&tile.type!=='red')push('🔌','限電危機生效，本次落地強制視為蕭條格','bad');
  if(!['start','blue','red','yellow','green'].includes(type)){
    if(engineHooks.resolveTile)engineHooks.resolveTile(state,player,{leverage,noReward,forcedRed},effects);
    return effects;
  }
  const mult=leverage?2:1;
  if(type==='blue'){
    const base=tile.value||300,amount=base*mult;
    if(noReward){
      push('🚫','銀根緊縮：發財格獎勵被沒收','bad');
    }else{
      const anniversary=state.effects.anniversary;
      if(anniversary&&anniversary.round===state.round&&anniversary.ownerId!==player.id){
        const owner=state.players.find(p=>p.id===anniversary.ownerId);
        if(owner){
          addCash(state,owner,amount);
          push('🎊',`${owner.name} 的瘋狂週年慶截走 ${amount} 總資產`,'good');
        }
      }else{
        addCash(state,player,amount);
        push('💰',`發財格：獲得 ${amount} 總資產`,'good');
      }
    }
  }else if(type==='red'){
    const tariff=state.effects.tariff;
    const doubled=!leverage&&tariff&&tariff.rounds>0&&tariff.sourceId!==player.id;
    const base=tile.type==='red'?(tile.value||150):150;
    let amount=base*mult*(doubled?2:1);
    if(engineHooks.tileDamageMultiplier)amount=Math.round(amount*engineHooks.tileDamageMultiplier(state,player,'red',amount));
    if(engineHooks.tileDamageBlocked&&engineHooks.tileDamageBlocked(state,player,'red')){
      push('✨','無敵／卍解狀態無效化本次扣款','good');
    }else{
      addCash(state,player,-amount);
      push('📉',`蕭條格：扣除 ${amount} 營運費${doubled?'（關稅壁壘加倍）':leverage?'（槓桿加倍）':''}`,'bad');
    }
  }else if(type==='yellow'){
    if(noReward){
      push('🚫','銀根緊縮：技能能量被沒收','bad');
    }else{
      const amount=(tile.value||1)*mult;
      player.energy=clamp(player.energy+amount,0,9);
      push('⚡',`技能格：獲得 ${amount} 點技能能量`,'good');
    }
  }else if(type==='green'){
    const event=eventById(pick(state,PARTY_EVENTS).id);
    push(event.icon,`${event.name}：${event.text}`,'event');
    if(engineHooks.tileEvent)engineHooks.tileEvent(state,player,event,effects);
    if(event.kind==='allCash'){
      for(const target of state.players)addCash(state,target,event.amount);
    }else if(event.kind==='selfCash'){
      addCash(state,player,event.amount);
    }else if(event.kind==='selfEnergy'){
      player.energy=clamp(player.energy+event.amount,0,9);
    }else if(event.kind==='allEnergy'){
      for(const target of state.players)target.energy=clamp(target.energy+event.amount,0,9);
    }
  }else if(type==='start'){
    push('🚩','出發點：集齊四角記號並經過此處可領取 1,000 元補助金','neutral');
  }
  return effects;
}

// 供交換位置、矢量操作等「非目前回合玩家」立即結算所在格效果使用。
// 只處理該格的停留效果，不另外發放通過起點獎金。
export function resolveTileFor(state,player,opts={}){
  const effects=[];
  if(!state||!player)return effects;
  if(state.ghostPosition===player.position){
    if(engineHooks.ghostStrike)engineHooks.ghostStrike(state,player,effects);
    else{
      const amount=150;
      addCash(state,player,-amount);
      effects.push({icon:'👻',text:`撞上罷工幽靈，扣除 ${amount} 營運費`,tone:'bad'});
    }
    return effects;
  }
  for(const e of tileEffect(state,player,opts))effects.push(e);
  return effects;
}

function landingForSwap(state,player,other){
  return resolveTileFor(state,player,{leverage:player===other?false:player.leverage})
    .map(e=>({...e,text:`${player.name}：${e.text}`}));
}

export function rollDie(state,forced,options={}){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(state.phase!=='roll')throw Error('現在無法擲骰。');
  const player=currentPlayer(state);
  // 魔女因子等擲骰前快照：每次擲骰都重新覆蓋，回溯點才會精準落在本次擲骰前。
  if(engineHooks.beforeRoll)engineHooks.beforeRoll(state,player);
  let value;
  if(player.ext?.oneStepLock||player.forcedSteps==='one'){
    value=1;
  }else if(forced!==undefined&&forced!==null){
    if(!Number.isInteger(forced)||forced<1||forced>6)throw Error('骰子只能是 1–6。');
    value=forced;
  }else if(player.forcedSteps==='low'){
    value=1+Math.floor(nextRandom(state)*3);
  }else if(player.forcedSteps==='high'){
    value=4+Math.floor(nextRandom(state)*3);
  }else{
    value=1+Math.floor(nextRandom(state)*6);
  }
  let noReward=player.noReward;
  if(player.bankLock){
    value=1;
    noReward=true;
    player.bankLock=false;
    log(state,`🔒 ${player.name} 受到緊縮銀根影響，本回合只能前進 1 格。`);
  }
  const board=boardOf(state);
  const leverage=Boolean(player.leverage);
  const from=player.position,fullPath=movementPath(from,value,board.length);
  const adjusted=engineHooks.adjustMovePath?.(state,player,fullPath,{from,value});
  let path=Array.isArray(adjusted)?adjusted:(adjusted?.path||fullPath);
  let roadblocked=false;
  if(state.advancedSettings?.roadblockGhost===true){
    const ghostIndex=path.findIndex(index=>index===state.ghostPosition);
    if(ghostIndex>=0){path=path.slice(0,ghostIndex+1);roadblocked=true;}
  }
  const moveMeta=adjusted?.meta||null;
  player.position=path.at(-1)??from;
  // 先把棋子移到終點；所有格子效果都延後到 resolveLanding()，
  // 確保 UI 播完移動動畫、棋子真正停下後才結算與彈窗。
  state.lastRoll={playerId:player.id,value,from,path,tileIndex:player.position,tileType:board[player.position]?.type,struck:false,roadblocked,passedStart:path.includes(0),effects:[],resolved:false,vector:moveMeta?.vector||null};
  if(options.defer){
    state.pendingLanding={playerId:player.id,from,value,path,leverage,noReward,forcedRed:Boolean(player.forcedRed)};
    state.pendingDecision=null;
    state.phase='moving';
    return state.lastRoll;
  }
  resolveLanding(state);
  return state.lastRoll;
}

// 棋子停止後才發動格子效果（發財／蕭條／技能／事件／幽靈／特殊格）。
export function resolveLanding(state,options={}){
  if(!state||state.status!=='playing')return state?.lastRoll||null;
  const roll=state.lastRoll;
  if(!roll||roll.resolved)return roll||null;
  const player=state.players.find(p=>p.id===roll.playerId);
  if(!player)return roll;
  const pending=state.pendingLanding&&state.pendingLanding.playerId===player.id?state.pendingLanding:null;
  const board=boardOf(state);
  const leverage=pending?Boolean(pending.leverage):Boolean(player.leverage);
  const noReward=pending?Boolean(pending.noReward):Boolean(player.noReward);
  const forcedRed=pending?Boolean(pending.forcedRed):Boolean(player.forcedRed);
  const effects=Array.isArray(roll.effects)?roll.effects:[];
  roll.effects=effects;
  applyCornerProgress(state,player,roll.path,{passedStart:Boolean(roll.passedStart),effects});
  // 新版規則：只有「踩在幽靈格」才觸發，路過不算。
  const struck=player.position===state.ghostPosition;
  roll.struck=struck;
  roll.tileIndex=player.position;
  roll.tileType=board[player.position]?.type;
  if(struck){
    if(engineHooks.ghostStrike)engineHooks.ghostStrike(state,player,effects);
    else{
      const penalty=150*(leverage?2:1);
      addCash(state,player,-penalty);
      effects.push({icon:'👻',text:`踩中罷工幽靈，扣除 ${penalty} 營運費`,tone:'bad'});
    }
    log(state,`${player.name} 擲出 ${roll.value}，在第 ${tileNo(player.position)} 格踩中罷工幽靈。`);
  }else{
    for(const e of tileEffect(state,player,{leverage,noReward,forcedRed}))effects.push(e);
    log(state,`${player.name} 擲出 ${roll.value}，停在「${board[player.position].label}」格${effects.length?`：${effects.map(e=>e.text.replace(/。$/,'')).join('；')}`:''}。`);
  }
  player.forcedSteps=null;
  if(player.ext)player.ext.oneStepLock=false;
  player.leverage=false;
  player.forcedRed=false;
  player.noReward=false;
  roll.resolved=true;
  state.pendingLanding=null;
  if(engineHooks.afterRoll)engineHooks.afterRoll(state,player,roll,options);
  if(state.status==='playing'&&state.phase==='roll'){
    if(!struck){
      const decision={playerId:player.id,kind:'landing',options:DECISION_OPTIONS.map(x=>({...x,available:x.id!=='invest'||player.cash>=300}))};
      state.pendingDecision=engineHooks.prepareDecision?engineHooks.prepareDecision(state,decision,player)||decision:decision;
      state.phase='decision';
    }else{
      state.phase='resolve';
    }
  }else if(state.status==='playing'&&state.phase==='moving'){
    state.phase=struck?'resolve':'resolve';
  }
  return roll;
}

export function chooseDecision(state,optionId){
  if(state.status!=='playing'||state.phase!=='decision'||!state.pendingDecision)throw Error('目前沒有待決定事項。');
  const p=state.players.find(x=>x.id===state.pendingDecision.playerId);
  const option=(state.pendingDecision.options||[]).find(x=>x.id===optionId)||DECISION_OPTIONS.find(x=>x.id===optionId);
  if(!option||!p)throw Error('決策選項無效。');
  if(option.available===false)throw Error('這個選項目前不可用。');
  const cash=Number(option.cash)||0,energy=Number(option.energy)||0,shields=Number(option.shields)||0;
  if(cash<0&&p.cash< -cash&&!option.allowDebt)throw Error(`總資產不足 ${Math.abs(cash)}，無法執行這個選項。`);
  if(cash)addCash(state,p,cash);
  // 允許負債的決策可能直接觸發破產／終局，不能再把已結束的階段覆寫回 resolve。
  if(state.status!=='playing'||p.ext?.eliminated){state.pendingDecision=null;return option;}
  if(energy)p.energy=clamp(p.energy+energy,0,9);
  if(shields)p.shields+=shields;
  if(option.certificate&&engineHooks.grantCertificate)engineHooks.grantCertificate(state,p,option.certificate);
  log(state,`${option.icon||'🤔'} ${p.name} 做出決策「${option.label||option.name||optionId}」${cash?`：${cash>0?'獲得':'支付'} ${Math.abs(cash)} 總資產`:''}${energy?`、${energy>0?'獲得':'失去'} ${Math.abs(energy)} 能量`:''}。`);
  state.pendingDecision=null;
  state.phase='resolve';
  return option;
}

export function useItem(state,itemId,targetId){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(state.phase!=='roll')throw Error('道具只能在擲骰前使用。');
  const p=currentPlayer(state),index=p.items.indexOf(itemId);
  if(engineHooks.canUse&&!engineHooks.canUse(state,p,'item',itemId))throw Error(engineHooks.blockedReason?.(state,p,'item',itemId)||'目前無法使用道具。');
  if(index===-1)throw Error('你沒有這個道具。');
  const item=itemById(itemId),target=state.players.find(x=>x.id===targetId);
  if(!item)throw Error('道具不存在。');
  const opponents=state.players.filter(x=>x.id!==p.id);
  if(itemId==='swap'){
    if(!target||target.id===p.id)throw Error('請選擇一位對手交換位置。');
    const from=p.position,to=target.position;
    p.position=to;target.position=from;
    applyCornerProgress(state,p,[to]);
    applyCornerProgress(state,target,[from]);
    log(state,`🔄 ${p.name} 與 ${target.name} 交換位置。`);
    const effects=[...landingForSwap(state,p,target),...landingForSwap(state,target,p)];
    p.items.splice(index,1);
    state.lastRoll={playerId:p.id,value:0,from,path:[to],tileIndex:to,tileType:boardOf(state)[to].type,struck:false,effects,swap:{targetId:target.id,from,to}};
    if(state.phase==='roll')state.phase='roll';
    return {item,effects};
  }
  if(itemId==='shield'){
    p.shields+=1;
    log(state,`🛡️ ${p.name} 使用買保險，獲得 1 層護盾（共 ${p.shields} 層）。`);
  }else if(itemId==='dice123'){
    p.forcedSteps='low';
    log(state,`🎲 ${p.name} 使用 123 骰子，本回合點數必定為 1–3。`);
  }else if(itemId==='dice456'){
    p.forcedSteps='high';
    log(state,`🎲 ${p.name} 使用 456 骰子，本回合點數必定為 4–6。`);
  }else if(itemId==='leverage'){
    p.leverage=true;
    log(state,`📈 ${p.name} 使用開槓桿，本回合踩格效果 ×2。`);
  }
  p.items.splice(index,1);
  return {item,effects:[]};
}

function skillBlocked(state,p){
  const lock=state.effects.lockdown;
  return lock&&lock.round===state.round&&roleById(p.roleId)?.sector===lock.sector;
}

export function useSkill(state,targetId,sector){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(state.phase!=='roll')throw Error('企業技能只能在擲骰前使用。');
  const p=currentPlayer(state),target=state.players.find(x=>x.id===targetId);
  if(engineHooks.canUse&&!engineHooks.canUse(state,p,'skill'))throw Error(engineHooks.blockedReason?.(state,p,'skill')||'目前無法使用技能。');
  if(skillBlocked(state,p))throw Error('限電危機生效中，本回合無法使用技能。');
  if(p.energy<1)throw Error('技能能量不足，請先踩技能格或使用道具補充。');
  const role=roleById(p.roleId);
  if(!role)throw Error('企業角色無效。');
  const others=state.players.filter(x=>x.id!==p.id);
  const needTarget=role.skill.target==='opponent';
  if(needTarget&&(!target||target.id===p.id))throw Error('請選擇一位對手作為技能目標。');
  if(role.skill.target==='sector'&&!SECTORS.includes(sector))throw Error('請選擇一個產業。');
  const result=[];
  switch(p.roleId){
    case 'investment':{
      if(consumeShield(state,target,role.skill.name))break;
      const amount=Math.min(500,Math.max(0,Math.floor(target.cash*.25)));
      if(!amount)throw Error('目標總資產不足，無法做空。');
      addCash(state,target,-amount);addCash(state,p,amount);
      result.push(`從 ${target.name} 竊取 ${amount} 總資產`);
      break;
    }
    case 'bank':{
      if(consumeShield(state,target,role.skill.name))break;
      target.bankLock=true;target.noReward=true;
      result.push(`${target.name} 下回合只能前進 1 格且沒有踩格獎勵`);
      break;
    }
    case 'electronics':{
      if(consumeShield(state,target,role.skill.name))break;
      target.skipTurns=(target.skipTurns||0)+1;
      addCash(state,target,-200);addCash(state,p,200);
      result.push(`${target.name} 下回合暫停行動，並轉移 200 總資產`);
      break;
    }
    case 'auto':{
      state.effects.tariff={rounds:2,sourceId:p.id};
      result.push('未來 2 回合其他玩家踩紅格扣款翻倍');
      break;
    }
    case 'retail':{
      state.effects.anniversary={round:state.round,ownerId:p.id};
      result.push('本回合其他玩家的藍格總資產全部歸你');
      break;
    }
    case 'agriculture':{
      let collected=0;
      for(const other of others){
        if(consumeShield(state,other,role.skill.name))continue;
        addCash(state,other,-150);
        collected+=150;
      }
      const half=Math.floor(collected/2);
      addCash(state,p,half);
      result.push(`所有對手損失 150，你收到 ${half} 總資產`);
      break;
    }
    case 'energy':{
      state.effects.lockdown={round:state.round,sector};
      let count=0;
      for(const other of state.players){
        if(roleById(other.roleId)?.sector===sector){other.forcedRed=true;count++}
      }
      result.push(`${sector} 共 ${count} 位玩家本回合禁用技能，下次踩格強制紅格`);
      break;
    }
    case 'logistics':{
      if(consumeShield(state,target,role.skill.name))break;
      const offset=1+Math.floor(nextRandom(state)*3);
      const from=target.position;
      state.ghostTrail=[from,...Array.from({length:offset},(_,i)=>(from+i+1)%BOARD.length)];
      state.ghostPosition=(from+offset)%BOARD.length;
      result.push(`罷工幽靈被移到 ${target.name} 前方 ${offset} 格`);
      break;
    }
    case 'property':{
      if(consumeShield(state,target,role.skill.name))break;
      target.rentTo=p.id;target.rentTurns=(target.rentTurns||0)+2;
      result.push(`${target.name} 接下來 2 個回合每回合付你 100 租金`);
      break;
    }
    case 'technology':{
      if(consumeShield(state,target,role.skill.name))break;
      const canSteal=target.cash>0;
      if(target.energy>0&&(!canSteal||nextRandom(state)<.5)){
        target.energy--;
        result.push(`刪除 ${target.name} 1 點技能能量`);
      }else if(canSteal){
        const amount=Math.min(300,Math.max(0,target.cash));
        addCash(state,target,-amount);addCash(state,p,amount);
        result.push(`偷取 ${target.name} ${amount} 總資產`);
      }else{
        target.energy=Math.max(0,target.energy-1);
        result.push(`刪除 ${target.name} 1 點技能能量`);
      }
      break;
    }
    default:throw Error('此企業沒有可用技能。');
  }
  p.energy-=1;
  log(state,`${role.skill.icon} ${p.name} 發動「${role.skill.name}」：${result.join('；')}。`);
  return {skill:role.skill,result};
}

export function buyStar(state){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(!['roll','resolve'].includes(state.phase))throw Error('現在無法購買星星。');
  const p=currentPlayer(state);
  if(p.stars>=STAR_GOAL)throw Error('已經達成勝利星數。');
  if(p.cash<STAR_COST)throw Error(`購買併購星需要 ${STAR_COST} 總資產。`);
  addCash(state,p,-STAR_COST);
  p.stars+=1;
  log(state,`⭐ ${p.name} 以 ${STAR_COST} 總資產買下第 ${p.stars} 顆併購星。`);
  checkStarWin(state);
  return p.stars;
}

export function acquisitionCost(state,acquirer,target){
  const advanced=state?.advancedSettings;
  if(!advanced||(!Object.prototype.hasOwnProperty.call(advanced,'mergerPrice')&&!Object.prototype.hasOwnProperty.call(advanced,'mergerStrongPrice'))){
    if(acquirer.cash<0&&target.cash<0)return 0;
    if(acquirer.cash<ACQUIRE_COST)throw Error(`發動併購需要 ${ACQUIRE_COST} 總資產，或雙方總資產皆為負值。`);
    return target.cash<0?ACQUIRE_DISCOUNT_COST:ACQUIRE_COST;
  }
  const ordinary=Number.isFinite(Number(advanced?.mergerPrice))?Math.max(0,Math.round(Number(advanced.mergerPrice))):ACQUIRE_COST;
  const strong=Number.isFinite(Number(advanced?.mergerStrongPrice))?Math.max(0,Math.round(Number(advanced.mergerStrongPrice))):ACQUIRE_DISCOUNT_COST;
  const cost=target.cash<=0?strong:ordinary;
  if(acquirer.cash<cost)throw Error(`發動併購需要 ${cost} 總資產。`);
  return cost;
}

export function acquireTarget(state,targetId){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(!['roll','resolve'].includes(state.phase))throw Error('現在無法發動併購。');
  const p=currentPlayer(state),target=state.players.find(x=>x.id===targetId);
  if(!target||target.id===p.id)throw Error('請選擇一位對手。');
  if(target.parentId)throw Error('該玩家已是其他公司的子公司。');
  if(state.players.some(x=>x.parentId===p.id))throw Error('你已有一家子公司，無法再併購。');
  if(target.stars>=STAR_GOAL)throw Error('已達勝利星數的玩家無法被併購。');
  const cost=acquisitionCost(state,p,target);
  if(cost>0&&p.cash<cost)throw Error(`併購需要 ${cost} 總資產。`);
  addCash(state,p,-cost);
  if(cost)addCash(state,target,Math.floor(cost*.25));
  target.parentId=p.id;
  log(state,`🤝 ${p.name} 以 ${cost} 總資產併購 ${target.name}，${target.name} 成為子公司（每回合上繳 40% 收益）。`);
  return {cost,target};
}

export function rebel(state){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(!['roll','resolve'].includes(state.phase))throw Error('現在無法發動獨立反撲。');
  const p=currentPlayer(state);
  if(!p.parentId)throw Error('你不是任何公司的子公司。');
  if(p.cash<REBEL_COST)throw Error(`獨立反撲需要 ${REBEL_COST} 總資產。`);
  const parent=state.players.find(x=>x.id===p.parentId);
  addCash(state,p,-REBEL_COST);
  p.parentId=null;
  log(state,`🕊️ ${p.name} 支付 ${REBEL_COST} 總資產，成功脫離 ${parent?.name||'母公司'} 獨立。`);
  return true;
}

export function endTurn(state){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  if(state.phase==='decision'||state.phase==='roll')throw Error('請先完成擲骰與決策。');
  if(!['resolve','skipped'].includes(state.phase))throw Error('現在無法結束回合。');
  const p=currentPlayer(state);
  if(engineHooks.beforeEndTurn)engineHooks.beforeEndTurn(state,p);
  const gain=Math.max(0,state.turnGains[p.id]||0);
  if(p.parentId&&gain>0){
    const parent=state.players.find(x=>x.id===p.parentId);
    if(parent){
      const transfer=Math.round(gain*.4);
      addCash(state,p,-transfer);addCash(state,parent,transfer);
      log(state,`🏢 ${p.name} 上繳 40% 收益 ${transfer} 總資產給母公司 ${parent.name}。`);
    }
  }
  moveGhost(state);
  if(state.turnIndex>=state.players.length-1){
    const result=settleRound(state);
    return result;
  }
  state.turnIndex++;
  state.dice=null;
  startTurn(state);
  return null;
}

export function removePlayer(state,playerId){
  const index=state?.players?.findIndex(player=>player.id===playerId)??-1;
  if(index<0)throw Error('找不到要移除的玩家。');
  const activeId=state.players[state.turnIndex]?.id;
  const [removed]=state.players.splice(index,1);
  for(const player of state.players){
    if(player.parentId===playerId)player.parentId=null;
    if(player.rentTo===playerId)player.rentTo=null;
  }
  const linkKeys=new Set(['playerId','ownerId','currentId','initiatorId','targetId','sourceId','actorId']);
  const prune=(value,key='')=>{
    if(!value||typeof value!=='object'||key==='history'||key==='log')return;
    if(Array.isArray(value)){
      for(let i=value.length-1;i>=0;i--){
        if(value[i]===playerId)value.splice(i,1);
        else if(prune(value[i])===null)value.splice(i,1);
      }
      return;
    }
    if(Object.entries(value).some(([field,child])=>linkKeys.has(field)&&child===playerId))return null;
    for(const [childKey,child] of Object.entries(value)){
      if(child===playerId||childKey===playerId)delete value[childKey];
      else if(prune(child,childKey)===null)delete value[childKey];
    }
  };
  prune(state);
  if(state.players.length){
    const activeIndex=state.players.findIndex(player=>player.id===activeId);
    state.turnIndex=activeIndex>=0?activeIndex:Math.min(index,state.players.length-1);
  }else{
    state.turnIndex=0;
  }
  if(state.status==='playing'&&state.players.length===1){
    finish(state,'kicked',[state.players[0]]);
    log(state,`${removed.name} 已離開對局，剩餘玩家獲勝。`);
  }
  return removed;
}

export function settleRound(state){
  if(state.status!=='playing')throw Error('遊戲已結束。');
  const finishedRound=state.round;
  if(state.effects.tariff){
    state.effects.tariff.rounds-=1;
    if(state.effects.tariff.rounds<=0){
      log(state,`🧱 ${state.players.find(p=>p.id===state.effects.tariff.sourceId)?.name||''} 的關稅壁壘結束。`);
      delete state.effects.tariff;
    }
  }
  delete state.effects.anniversary;
  delete state.effects.lockdown;
  state.ghostTrail=[];
  if(engineHooks.afterRound)engineHooks.afterRound(state,finishedRound,{final:state.round>=state.maxRounds});
  if(state.status!=='playing')return {round:finishedRound,finished:true,reason:state.resultReason||'ext',winners:state.players.filter(p=>state.winnerIds.includes(p.id)).map(p=>p.name)};
  if(state.ext?.doomPending){state.phase='doom';return {round:finishedRound,finished:false,pendingDoom:true}}
  return continueAfterRound(state,finishedRound);
}

export function resumeRoundAfterDoom(state,finishedRound=state.round){
  if(state.status!=='playing')return {round:finishedRound,finished:true,reason:state.resultReason||'ext',winners:state.players.filter(p=>state.winnerIds.includes(p.id)).map(p=>p.name)};
  return continueAfterRound(state,finishedRound);
}

function continueAfterRound(state,finishedRound){
  if(state.round>=state.maxRounds){
    const ranked=[...state.players].sort((a,b)=>b.stars-a.stars||b.cash-a.cash);
    const top=ranked[0];
    const winners=ranked.filter(p=>p.stars===top.stars&&p.cash===top.cash);
    const override=engineHooks.beforeFinal?.(state,winners,ranked);
    if(override&&override.continue){
      state.round++;
      state.turnIndex=0;
      log(state,`⚡ 驟死賽開始｜第 ${state.round} 季，憤怒幽靈全面出動。`);
      startTurn(state);
      return {round:finishedRound,finished:false,suddenDeath:true};
    }
    finish(state,'rounds',winners);
    return {round:finishedRound,finished:true,reason:'rounds',winners:winners.map(p=>p.name)};
  }
  state.round++;
  state.turnIndex=0;
  log(state,`第 ${state.round} 季開始｜市場重新洗牌，罷工幽靈繼續遊蕩。`);
  startTurn(state);
  return {round:finishedRound,finished:false};
}

export function statusChips(state,player){
  const chips=[];
  if(player.shields>0)chips.push({icon:'🛡️',label:`護盾 ×${player.shields}`,tone:'shield'});
  if(player.leverage)chips.push({icon:'📈',label:'槓桿 ×2',tone:'leverage'});
  if(player.forcedSteps==='low')chips.push({icon:'🎲',label:'123 骰',tone:'dice'});
  if(player.forcedSteps==='high')chips.push({icon:'🎲',label:'456 骰',tone:'dice'});
  if(player.bankLock)chips.push({icon:'🔒',label:'銀根緊縮',tone:'bad'});
  if(player.skipTurns>0)chips.push({icon:'⏸️',label:'下回合暫停',tone:'bad'});
  if(player.forcedRed)chips.push({icon:'📉',label:'下次強制紅格',tone:'bad'});
  if(player.rentTo&&player.rentTurns>0)chips.push({icon:'🏗️',label:`租金 ×${player.rentTurns}`,tone:'bad'});
  if(player.parentId)chips.push({icon:'🏢',label:`子公司 · ${state.players.find(p=>p.id===player.parentId)?.name||'母公司'}`,tone:'subsidiary'});
  if(player.stars>=STAR_GOAL)chips.push({icon:'⭐',label:'已達勝星',tone:'star'});
  const lock=state.effects.lockdown;
  if(lock&&lock.round===state.round&&roleById(player.roleId)?.sector===lock.sector)chips.push({icon:'🔌',label:'限電禁技',tone:'bad'});
  if(engineHooks.extraStatusChips)chips.push(...(engineHooks.extraStatusChips(state,player)||[]));
  return chips;
}

export function canAcquire(state,player,target){
  if(!player||!target||player.id===target.id)return false;
  if(target.parentId||state.players.some(x=>x.parentId===player.id))return false;
  if(target.stars>=STAR_GOAL)return false;
  if(!state?.advancedSettings||(!Object.prototype.hasOwnProperty.call(state.advancedSettings,'mergerPrice')&&!Object.prototype.hasOwnProperty.call(state.advancedSettings,'mergerStrongPrice'))){
    if(player.cash<0&&target.cash<0)return true;
    return player.cash>=ACQUIRE_COST;
  }
  const cost=target.cash<=0
    ? Math.max(0,Math.round(Number(state?.advancedSettings?.mergerStrongPrice??ACQUIRE_DISCOUNT_COST)))
    : Math.max(0,Math.round(Number(state?.advancedSettings?.mergerPrice??ACQUIRE_COST)));
  return player.cash>=cost;
}

export function canRebel(player){return Boolean(player&&player.parentId&&player.cash>=REBEL_COST)}

export function exportGame(state){return JSON.stringify(state,null,2)}

function migrateLegacy(s){
  const players=s.players.map((p,i)=>({
    id:p.id||`player-${i+1}`,name:p.name,roleId:p.roleId,position:Number.isInteger(p.position)?p.position:0,color:Number.isInteger(p.color)?p.color:i,
    cash:Number.isFinite(s.companies?.[p.roleId]?.cash)?s.companies[p.roleId].cash:START_CASH,stars:0,energy:1,items:[],shields:0,skipTurns:0,rentTo:null,rentTurns:0,parentId:null,leverage:false,bankLock:false,noReward:false,forcedRed:false,forcedSteps:null
  }));
  const legacyFinished=s.status&&s.status!=='playing';
  const state={version:2,mode:'party',round:legacyFinished?s.maxRounds||1:s.round||1,maxRounds:s.maxRounds||10,starGoal:STAR_GOAL,turnIndex:legacyFinished?0:clamp(Number(s.turnIndex)||0,0,players.length-1),phase:legacyFinished?'finished':'roll',rng:Number.isInteger(s.rng)&&s.rng!==0?s.rng:(Number(s.seed)|0)||1,seed:Number(s.seed)||Date.now(),players,ghostRng:s.ghostRng||ghostSeed(s.seed||Date.now()),ghostPosition:s.ghostPosition,ghostTrail:[],effects:{},turnGains:{},lastRoll:null,pendingDecision:null,log:Array.isArray(s.log)?s.log.slice(0,160):[],status:legacyFinished?'finished':'playing',resultReason:legacyFinished?'legacy':null,winnerIds:legacyFinished&&Array.isArray(s.winnerIds)?s.winnerIds:[],sync:s.sync||null};
  ensurePartyState(state);
  state.log.unshift('📥 已將第 1 版財務存檔轉換為派對棋盤，總資產與企業角色完整保留。');
  return state;
}

export function importGame(json){
  const s=typeof json==='string'?JSON.parse(json):json;
  if(!s||typeof s!=='object')throw Error('存檔格式不正確。');
  if(s.version!==1&&s.version!==2)throw Error('存檔版本不支援。');
  if(s.version===1)return migrateLegacy(s);
  if(!Array.isArray(s.players)||s.players.length<2||s.players.length>8)throw Error('存檔玩家數量必須為 2 至 8 人。');
  const validRole=id=>engineHooks.roleExists?engineHooks.roleExists(id):Boolean(roleById(id));
  for(const p of s.players)if(!p||!validRole(p.roleId)||!String(p.name||'').trim())throw Error('存檔中的玩家或企業資料不正確。');
  if(!Array.isArray(s.log))s.log=[];
  return ensurePartyState(s);
}
