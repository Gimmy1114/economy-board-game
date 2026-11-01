import test from 'node:test';
import assert from 'node:assert/strict';
import {ROLES,ITEMS,BOARD,PARTY_EVENTS,DECISION_OPTIONS,ITEM_CHANCE,STAR_COST,STAR_GOAL,ACQUIRE_COST,ACQUIRE_DISCOUNT_COST,REBEL_COST,START_CASH} from './data.js';
import {createGame,currentOf,movementPath,rollDie,chooseDecision,useItem,useSkill,buyStar,acquireTarget,rebel,endTurn,removePlayer,statusChips,canAcquire,canRebel,exportGame,importGame} from './engine.js';

const game=(seed=42)=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'technology'}],seed});
const fourPlayerGame=(seed=7)=>createGame({players:[
  {name:'甲',roleId:'auto'},
  {name:'乙',roleId:'electronics'},
  {name:'丙',roleId:'retail'},
  {name:'丁',roleId:'bank'}
],seed,maxRounds:10});
const avoidGhost=state=>{state.ghostPosition=20;state.ghostTrail=[]};

test('棋盤資料符合派對規格',()=>{
  assert.equal(ROLES.length,10);
  assert.equal(new Set(ROLES.map(r=>r.id)).size,10);
  assert.equal(ITEMS.length,5);
  assert.equal(new Set(ITEMS.map(i=>i.id)).size,5);
  assert.equal(ITEM_CHANCE,0.2);
  assert.equal(BOARD.length,24);
  assert.equal(BOARD[0].type,'start');
  assert.ok(BOARD.slice(1).every(t=>['blue','red','yellow','green'].includes(t.type)));
  assert.equal(PARTY_EVENTS.length,6);
  assert.equal(DECISION_OPTIONS.length,2);
  assert.equal(STAR_GOAL,3);assert.equal(STAR_COST,1000);
  assert.equal(ACQUIRE_COST,2000);assert.equal(ACQUIRE_DISCOUNT_COST,1000);assert.equal(REBEL_COST,1000);
  assert.equal(START_CASH,1200);
});

test('只能 2 至 8 位玩家，角色與名稱不可重複',()=>{
  const one=[{name:'甲',roleId:'auto'}];
  assert.throws(()=>createGame({players:one,seed:1}),/2 至 8 位玩家/);
  const nine=Array.from({length:9},(_,i)=>({name:`玩家${i+1}`,roleId:ROLES[i].id}));
  assert.throws(()=>createGame({players:nine,seed:1}),/2 至 8 位玩家/);
  assert.throws(()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'auto'}],seed:1}),/不同的企業角色/);
  assert.throws(()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'甲',roleId:'bank'}],seed:1}),/名稱不得空白或重複/);
  assert.throws(()=>createGame({players:[{name:'  ',roleId:'auto'},{name:'乙',roleId:'bank'}],seed:1}),/名稱不得空白或重複/);
  assert.throws(()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'bank'}],seed:1,maxRounds:1}),/季數上限/);
  assert.throws(()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'bank'}],seed:1,maxRounds:31}),/季數上限/);
});

test('新對局初始化總資產、星數、能量、位置與幽靈',()=>{
  const s=game();
  assert.equal(s.version,2);assert.equal(s.mode,'party');assert.equal(s.round,1);assert.equal(s.maxRounds,10);
  assert.equal(s.starGoal,3);assert.equal(s.turnIndex,0);assert.equal(s.phase,'roll');assert.equal(s.status,'playing');
  assert.deepEqual(s.players.map(p=>p.cash),[START_CASH,START_CASH]);
  assert.deepEqual(s.players.map(p=>p.stars),[0,0]);
  assert.deepEqual(s.players.map(p=>p.energy),[1,1]);
  assert.deepEqual(s.players.map(p=>p.position),[0,0]);
  assert.ok(s.players[0].items.length<=1);
  assert.ok(s.ghostPosition>=1&&s.ghostPosition<BOARD.length);
  assert.equal(currentOf(s).id,'player-1');
  const copy=game();assert.equal(copy.ghostPosition,s.ghostPosition);
  assert.equal(s.log.length,3);
  assert.match(s.log[0],/回合開始/);
  assert.match(s.log[1],/抽到道具/);
  assert.match(s.log[2],/派對開始/);
});

test('踢除玩家時清除進行中引用、保留歷史快照並校正目前回合',()=>{
  const s=createGame({players:[
    {name:'甲',roleId:'auto'},
    {name:'乙',roleId:'electronics'},
    {name:'丙',roleId:'retail'}
  ],seed:9});
  s.turnIndex=2;
  s.players[2].parentId='player-2';
  s.turnGains['player-2']=123;
  s.net={owners:{'player-1':'host','player-2':'guest-a','player-3':'guest-b'}};
  s.ext={history:[{round:1,players:[{id:'player-2',name:'乙'}]}],auction:{currentId:'player-2',itemId:'a'}};
  const history=JSON.parse(JSON.stringify(s.ext.history));

  removePlayer(s,'player-2');

  assert.deepEqual(s.players.map(player=>player.id),['player-1','player-3']);
  assert.equal(s.turnIndex,1);
  assert.equal(s.players[1].parentId,null);
  assert.equal(s.turnGains['player-2'],undefined);
  assert.equal(s.net.owners['player-2'],undefined);
  assert.equal(s.ext.auction,undefined);
  assert.deepEqual(s.ext.history,history);
});

test('踢除只剩的對手後，由房主獲勝並結束對局',()=>{
  const s=game();
  removePlayer(s,'player-2');
  assert.equal(s.status,'finished');
  assert.equal(s.resultReason,'kicked');
  assert.deepEqual(s.winnerIds,['player-1']);
});

test('玩家狀態初始化四角記號，移動經過角落會打卡',()=>{
  const s=game();avoidGhost(s);
  const player=s.players[0];
  assert.deepEqual(player.marks,{red:false,green:false,blue:false,yellow:false});
  player.position=5;
  rollDie(s,2);
  assert.equal(player.marks.green,true);
  assert.equal(player.marks.red,false);
});

test('集齊四角記號後經過出發點領取補助並清除記號',()=>{
  const s=game();avoidGhost(s);
  const player=s.players[0];
  player.position=22;
  player.marks={red:false,green:true,blue:true,yellow:true};
  const before=player.cash;
  rollDie(s,3);
  assert.deepEqual(player.marks,{red:false,green:false,blue:false,yellow:false});
  assert.equal(player.cash,before+1300);
  assert.equal(s.cornerSubsidyEvent.playerId,player.id);
  assert.equal(s.cornerSubsidyEvent.amount,1000);
  assert.ok(s.lastRoll.effects.some(effect=>effect.text.includes('領取 1,000 元補助金')));
});

test('集滿四角記號後踩停在出發點也能領取補助並重置記號',()=>{
  const s=game();avoidGhost(s);
  const player=s.players[0];
  player.position=23;
  player.marks={red:false,green:true,blue:true,yellow:true};
  const before=player.cash;
  const roll=rollDie(s,1);
  assert.equal(player.position,0);
  assert.deepEqual(player.marks,{red:false,green:false,blue:false,yellow:false});
  assert.equal(player.cash,before+1000);
  assert.equal(s.cornerSubsidyEvent.playerId,player.id);
  assert.equal(s.cornerSubsidyEvent.amount,1000);
  assert.ok(roll.effects.some(effect=>/取得紅色角落記號/.test(effect.text)));
  assert.ok(roll.effects.some(effect=>/^集齊四角記號/.test(effect.text)));
});

test('骰子只有 1–6，固定種子可重現',()=>{
  const a=game(),b=game();
  const ra=rollDie(a,3),rb=rollDie(b,3);
  assert.equal(ra.value,3);assert.equal(rb.value,3);
  assert.throws(()=>rollDie(game(),0),/1–6/);
  assert.throws(()=>rollDie(game(),7),/1–6/);
  assert.throws(()=>rollDie(game(),2.5),/1–6/);
  const low=game();avoidGhost(low);assert.equal(rollDie(low,1).value,1);
  const high=game();avoidGhost(high);assert.equal(rollDie(high,6).value,6);
  const x=game(99),y=game(99);avoidGhost(x);avoidGhost(y);
  assert.equal(rollDie(x).value,rollDie(y).value);
  chooseDecision(x,'squeeze');chooseDecision(y,'squeeze');
  x.phase='roll';y.phase='roll';
  assert.equal(rollDie(x).value,rollDie(y).value);
});

test('藍格發財 +300、紅格蕭條 −150、黃格能量 +1',()=>{
  const blue=game();avoidGhost(blue);blue.players[0].position=0;
  rollDie(blue,1);
  assert.equal(blue.players[0].position,1);assert.equal(blue.players[0].cash,1500);
  assert.equal(blue.turnGains['player-1'],300);assert.equal(blue.phase,'decision');
  const red=game();avoidGhost(red);red.players[0].position=1;
  rollDie(red,1);
  assert.equal(red.players[0].position,2);assert.equal(red.players[0].cash,1050);
  assert.match(red.lastRoll.effects[0].text,/150/);
  const yellow=game();avoidGhost(yellow);yellow.players[0].position=2;yellow.players[0].energy=1;
  rollDie(yellow,1);
  assert.equal(yellow.players[0].position,3);assert.equal(yellow.players[0].energy,2);
});

test('綠格抽即時事件，未集齊記號停在出發點不發補助',()=>{
  const s=game();avoidGhost(s);s.players[0].position=3;
  const roll=rollDie(s,1);
  assert.equal(s.players[0].position,4);
  assert.equal(roll.effects.length,1);assert.equal(roll.effects[0].tone,'event');
  assert.ok(PARTY_EVENTS.some(e=>roll.effects[0].text.includes(e.name)));
  assert.equal(s.phase,'decision');
  const start=game();avoidGhost(start);start.players[0].position=23;
  const passed=rollDie(start,1);
  assert.equal(start.players[0].position,0);
  assert.equal(start.players[0].cash,START_CASH);
  assert.equal(start.players[0].marks.red,true);
  assert.equal(start.cornerSubsidyEvent,null);
  assert.ok(passed.effects.some(e=>/集齊四角記號/.test(e.text)));
});

test('只有停在幽靈格才觸發扣 150，路過不算，槓桿加倍',()=>{
  const pass=game();pass.players[0].position=0;pass.ghostPosition=2;pass.ghostTrail=[];
  const walk=rollDie(pass,4);
  assert.equal(walk.struck,false);assert.equal(walk.value,4);
  assert.deepEqual(walk.path,[1,2,3,4]);
  assert.equal(pass.players[0].position,4);
  assert.ok(!walk.effects.some(e=>/幽靈/.test(e.text)));
  const s=game();s.players[0].position=0;s.ghostPosition=4;s.ghostTrail=[];
  const roll=rollDie(s,4);
  assert.equal(roll.struck,true);assert.equal(roll.value,4);
  assert.deepEqual(roll.path,[1,2,3,4]);
  assert.equal(s.players[0].position,4);
  assert.equal(s.players[0].cash,1050);
  assert.equal(s.phase,'resolve');
  assert.match(s.log[0],/幽靈/);
  const leveraged=game();leveraged.players[0].position=0;leveraged.ghostPosition=4;leveraged.players[0].items=['leverage'];
  useItem(leveraged,'leverage');
  rollDie(leveraged,4);
  assert.equal(leveraged.players[0].cash,900);
});

test('決策二選一：投資研發與壓榨勞工',()=>{
  const s=game();avoidGhost(s);
  rollDie(s,1);
  assert.equal(chooseDecision(s,'invest').id,'invest');
  assert.equal(s.players[0].cash,1200);assert.equal(s.players[0].energy,3);assert.equal(s.phase,'resolve');
  const poor=game();avoidGhost(poor);rollDie(poor,1);
  poor.players[0].cash=200;
  assert.throws(()=>chooseDecision(poor,'invest'),/總資產不足 300/);
  chooseDecision(poor,'squeeze');
  assert.equal(poor.players[0].cash,400);assert.equal(poor.players[0].energy,0);
  assert.throws(()=>chooseDecision(poor,'invest'),/沒有待決定/);
});

test('道具最多 3 格，使用後移除，且只在擲骰前可用',()=>{
  const s=game();
  const imported=JSON.parse(exportGame(s));
  imported.players[0].items=['shield','shield','shield','swap'];
  assert.deepEqual(importGame(imported).players[0].items,['shield','shield','shield']);
  const use=game();use.players[0].items=['shield','dice123'];
  useItem(use,'shield');
  assert.equal(use.players[0].shields,1);
  assert.deepEqual(use.players[0].items,['dice123']);
  assert.equal(use.phase,'roll');
  assert.throws(()=>useItem(use,'shield'),/沒有這個道具/);
  const after=game();avoidGhost(after);rollDie(after,1);
  after.players[0].items=['leverage'];
  assert.throws(()=>useItem(after,'leverage'),/擲骰前/);
});

test('123／456 骰子限制本回合點數範圍，槓桿讓藍格與紅格加倍',()=>{
  for(let i=0;i<12;i++){
    const s=game();avoidGhost(s);s.players[0].items=['dice123'];useItem(s,'dice123');
    const value=rollDie(s).value;assert.ok(value>=1&&value<=3,`123 骰擲出 ${value}`);
  }
  for(let i=0;i<12;i++){
    const s=game();avoidGhost(s);s.players[0].items=['dice456'];useItem(s,'dice456');
    const value=rollDie(s).value;assert.ok(value>=4&&value<=6,`456 骰擲出 ${value}`);
  }
  const blue=game();avoidGhost(blue);blue.players[0].items=['leverage'];useItem(blue,'leverage');
  rollDie(blue,1);
  assert.equal(blue.players[0].cash,1800);
  const red=game();avoidGhost(red);red.players[0].position=1;red.players[0].items=['leverage'];useItem(red,'leverage');
  rollDie(red,1);
  assert.equal(red.players[0].cash,900);
});

test('護盾可抵擋一次負面技能，並在下次自己回合開始時到期',()=>{
  const s=game();s.turnIndex=1;s.phase='roll';s.players[0].items=['shield'];s.players[0].shields=1;
  useSkill(s,'player-1');
  assert.equal(s.players[0].shields,0);assert.equal(s.players[0].cash,START_CASH);
  assert.equal(s.players[1].energy,0);
  assert.equal(s.players[1].cash,START_CASH);
  assert.ok(s.log.some(line=>/護盾擋下/.test(line)));
  const expire=game();expire.turnIndex=1;expire.players[0].shields=2;expire.phase='resolve';
  endTurn(expire);
  assert.equal(expire.players[0].shields,0);
});

test('銀行緊縮銀根：下回合只能前進 1 格且沒有格子獎勵',()=>{
  const s=createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'bank'}],seed:5});
  s.turnIndex=1;s.phase='roll';avoidGhost(s);
  useSkill(s,'player-1');
  assert.equal(s.players[0].bankLock,true);assert.equal(s.players[0].noReward,true);
  assert.equal(s.players[1].energy,0);
  s.phase='resolve';endTurn(s);
  avoidGhost(s);
  assert.equal(currentOf(s).id,'player-1');
  rollDie(s,5);
  assert.equal(s.players[0].position,1);
  assert.equal(s.players[0].cash,START_CASH);
  assert.equal(s.lastRoll.value,1);
  assert.ok(s.log.some(line=>/只能前進 1 格/.test(line)));
});

test('電子製造商專利訴訟：暫停一回合並轉移 200',()=>{
  const s=createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'electronics'}],seed:5});
  s.turnIndex=1;s.phase='roll';
  useSkill(s,'player-1');
  assert.equal(s.players[0].skipTurns,1);
  assert.equal(s.players[0].cash,1000);
  assert.equal(s.players[1].cash,1400);
  s.phase='resolve';endTurn(s);
  assert.equal(s.phase,'skipped');assert.equal(s.turnIndex,0);
  assert.equal(s.players[0].skipTurns,0);
  assert.match(s.log[0],/暫停行動/);
});

test('技能需要 1 點能量，且目標型技能必須指定對手',()=>{
  const s=game();s.players[0].energy=0;
  assert.throws(()=>useSkill(s),/能量不足/);
  const electronics=createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'electronics'}],seed:5});
  electronics.turnIndex=1;
  assert.throws(()=>useSkill(electronics),/選擇一位對手/);
  const sector=createGame({players:[{name:'甲',roleId:'energy'},{name:'乙',roleId:'auto'}],seed:5});
  assert.throws(()=>useSkill(sector),/選擇一個產業/);
  useSkill(sector,null,'能源與運輸');
  assert.equal(sector.players[0].energy,0);
  assert.equal(sector.players[0].forcedRed,true);assert.equal(sector.players[1].forcedRed,false);
  assert.equal(sector.effects.lockdown.sector,'能源與運輸');
  assert.throws(()=>useSkill(sector,null,'能源與運輸'),/限電危機/);
});

test('十種企業技能都能改變對應狀態',()=>{
  const invest=createGame({players:[{name:'甲',roleId:'investment'},{name:'乙',roleId:'auto'}],seed:5});
  invest.turnIndex=0;invest.players[1].cash=2000;
  useSkill(invest,'player-2');
  assert.equal(invest.players[0].cash,1700);assert.equal(invest.players[1].cash,1500);

  const retail=createGame({players:[{name:'甲',roleId:'retail'},{name:'乙',roleId:'auto'}],seed:5});
  retail.turnIndex=0;useSkill(retail);
  retail.turnIndex=1;retail.phase='roll';avoidGhost(retail);retail.players[1].position=0;
  rollDie(retail,1);
  assert.equal(retail.players[0].cash,1500);assert.equal(retail.players[1].cash,1200);

  const logistics=createGame({players:[{name:'甲',roleId:'logistics'},{name:'乙',roleId:'auto'}],seed:5});
  logistics.turnIndex=0;logistics.players[1].position=5;logistics.ghostPosition=20;
  useSkill(logistics,'player-2');
  const distance=(logistics.ghostPosition-5+BOARD.length)%BOARD.length;
  assert.ok(distance>=1&&distance<=3);
  assert.deepEqual(logistics.ghostTrail,[5,...Array.from({length:distance},(_,i)=>5+i+1)]);

  const property=createGame({players:[{name:'甲',roleId:'property'},{name:'乙',roleId:'auto'}],seed:5});
  property.turnIndex=0;useSkill(property,'player-2');
  assert.equal(property.players[1].rentTo,'player-1');assert.equal(property.players[1].rentTurns,2);
  property.phase='resolve';endTurn(property);
  assert.equal(property.players[1].cash,1100);assert.equal(property.players[0].cash,1300);
  assert.equal(property.players[1].rentTurns,1);

  const agri=createGame({players:[{name:'甲',roleId:'agriculture'},{name:'乙',roleId:'auto'}],seed:5});
  useSkill(agri);
  assert.equal(agri.players[0].cash,1275);assert.equal(agri.players[1].cash,1050);

  const tech=createGame({players:[{name:'甲',roleId:'technology'},{name:'乙',roleId:'auto'}],seed:5});
  tech.players[1].energy=3;tech.players[1].cash=2000;
  useSkill(tech,'player-2');
  assert.ok(tech.players[1].energy<3||tech.players[1].cash<2000);
});

test('關稅壁壘讓其他玩家紅格扣款加倍兩回合',()=>{
  const s=createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'retail'}],seed:5});
  s.players[0].energy=1;
  useSkill(s);
  s.turnIndex=1;s.phase='roll';avoidGhost(s);s.players[1].position=1;
  rollDie(s,1);
  assert.equal(s.players[1].cash,900);
  assert.match(s.lastRoll.effects[0].text,/關稅壁壘加倍/);
  s.phase='resolve';endTurn(s);
  assert.equal(s.effects.tariff.rounds,1);
  s.phase='resolve';endTurn(s);
  s.phase='resolve';endTurn(s);
  assert.equal(s.effects.tariff,undefined);
});

test('買星：1000 總資產換 1 顆星，3 顆星立刻獲勝',()=>{
  const s=game();s.players[0].cash=1200;
  assert.equal(buyStar(s),1);
  assert.equal(s.players[0].cash,200);
  assert.equal(s.players[0].stars,1);
  assert.throws(()=>buyStar(s),/需要 1000 總資產/);
  s.players[0].cash=1000;s.players[0].stars=2;
  assert.equal(buyStar(s),3);
  assert.equal(s.status,'finished');assert.equal(s.phase,'finished');assert.equal(s.resultReason,'stars');
  assert.deepEqual(s.winnerIds,['player-1']);
  assert.throws(()=>buyStar(s),/遊戲已結束/);
});

test('併購：2000 總資產、負總資產折扣 1000、雙方負值 0 元代價',()=>{
  const s=game();avoidGhost(s);
  assert.equal(canAcquire(s,s.players[0],s.players[1]),false);
  s.players[0].cash=2100;s.players[1].cash=800;
  assert.equal(canAcquire(s,s.players[0],s.players[1]),true);
  const deal=acquireTarget(s,'player-2');
  assert.equal(deal.cost,2000);
  assert.equal(s.players[0].cash,100);assert.equal(s.players[1].cash,1300);
  assert.equal(s.players[1].parentId,'player-1');
  assert.throws(()=>acquireTarget(s,'player-2'),/子公司/);
  assert.equal(canAcquire(s,s.players[0],s.players[1]),false);

  const discount=game();discount.players[0].cash=2000;discount.players[1].cash=-100;
  assert.equal(acquireTarget(discount,'player-2').cost,1000);
  assert.equal(discount.players[0].cash,1000);assert.equal(discount.players[1].cash,150);

  const zero=game();zero.players[0].cash=-100;zero.players[1].cash=-100;
  assert.equal(canAcquire(zero,zero.players[0],zero.players[1]),true);
  assert.equal(acquireTarget(zero,'player-2').cost,0);
  assert.equal(zero.players[0].cash,-100);assert.equal(zero.players[1].cash,-100);

  const rich=game();rich.players[0].cash=5000;rich.players[1].stars=3;
  assert.equal(canAcquire(rich,rich.players[0],rich.players[1]),false);
  assert.throws(()=>acquireTarget(rich,'player-2'),/勝利星數/);
});

test('進階併吞價格以目標總資產是否為零或負值選擇金額',()=>{
  const s=game();
  s.advancedSettings={mergerPrice:2400,mergerStrongPrice:700};
  s.players[0].cash=3000;s.players[1].cash=0;
  assert.equal(canAcquire(s,s.players[0],s.players[1]),true);
  assert.equal(acquireTarget(s,'player-2').cost,700);
  const ordinary=game();
  ordinary.advancedSettings={mergerPrice:2400,mergerStrongPrice:700};
  ordinary.players[0].cash=3000;ordinary.players[1].cash=1;
  assert.equal(acquireTarget(ordinary,'player-2').cost,2400);
});

test('子公司每回合上繳 40% 收益，支付 1000 可獨立反撲',()=>{
  const s=game();s.turnIndex=1;s.phase='resolve';
  s.players[1].parentId='player-1';s.turnGains['player-2']=1000;
  assert.equal(canRebel(s.players[1]),true);
  endTurn(s);
  assert.equal(s.players[1].cash,800);assert.equal(s.players[0].cash,1600);
  assert.match(s.log.find(line=>/上繳 40%/.test(line))||'',/400/);

  const r=game();r.turnIndex=1;r.phase='resolve';r.players[1].parentId='player-1';r.players[1].cash=1000;
  assert.equal(rebel(r),true);
  assert.equal(r.players[1].parentId,null);assert.equal(r.players[1].cash,0);
  assert.throws(()=>rebel(r),/不是任何公司的子公司/);
  const poor=game();poor.turnIndex=1;poor.players[1].parentId='player-1';poor.players[1].cash=999;
  assert.equal(canRebel(poor.players[1]),false);
  assert.throws(()=>rebel(poor),/需要 1000 總資產/);
});

test('回合流程：每季一輪，結束回合時幽靈移動',()=>{
  const s=game();avoidGhost(s);s.ghostPosition=5;
  rollDie(s,1);chooseDecision(s,'squeeze');
  assert.equal(endTurn(s),null);
  assert.equal(s.turnIndex,1);assert.equal(s.round,1);
  assert.ok(s.ghostTrail.length>=2&&s.ghostTrail.length<=4);
  assert.equal(s.ghostTrail[0],5);assert.equal(s.ghostTrail.at(-1),s.ghostPosition);
  assert.equal(s.players[1].items.length,1);
  avoidGhost(s);rollDie(s,1);chooseDecision(s,'squeeze');
  const result=endTurn(s);
  assert.equal(result.finished,false);assert.equal(result.round,1);
  assert.equal(s.round,2);assert.equal(s.turnIndex,0);
  assert.equal(s.lastRoll,null);
});

test('季數上限時依星數、再依總資產判定勝負',()=>{
  const s=game();s.round=2;s.maxRounds=2;s.turnIndex=1;s.phase='resolve';
  s.players[0].stars=1;s.players[1].stars=1;
  s.players[0].cash=1500;s.players[1].cash=1200;
  const result=endTurn(s);
  assert.equal(result.finished,true);assert.equal(result.reason,'rounds');
  assert.deepEqual(result.winners,['甲']);
  assert.equal(s.status,'finished');assert.equal(s.resultReason,'rounds');
  assert.deepEqual(s.winnerIds,['player-1']);
  const tie=game();tie.round=2;tie.maxRounds=2;tie.turnIndex=1;tie.phase='resolve';
  tie.players[0].stars=2;tie.players[1].stars=2;tie.players[0].cash=900;tie.players[1].cash=900;
  const shared=endTurn(tie);
  assert.deepEqual(shared.winners.sort(),['乙','甲'].sort());
});

test('狀態徽章反映護盾、槓桿、骰子、租金與子公司',()=>{
  const s=game();const p=s.players[0];
  p.shields=2;p.leverage=true;p.forcedSteps='high';p.bankLock=true;p.skipTurns=1;p.forcedRed=true;
  p.rentTo='player-2';p.rentTurns=2;p.parentId='player-2';
  const labels=statusChips(s,p).map(c=>c.label);
  assert.ok(labels.some(l=>l.includes('護盾')));
  assert.ok(labels.some(l=>l.includes('槓桿')));
  assert.ok(labels.some(l=>l.includes('456')));
  assert.ok(labels.some(l=>l.includes('銀根')));
  assert.ok(labels.some(l=>l.includes('暫停')));
  assert.ok(labels.some(l=>l.includes('強制紅格')));
  assert.ok(labels.some(l=>l.includes('租金')));
  assert.ok(labels.some(l=>l.includes('子公司')));
});

test('移動路徑會繞回起點且拒絕無效參數',()=>{
  assert.deepEqual(movementPath(22,5),[23,0,1,2,3]);
  assert.deepEqual(movementPath(0,1),[1]);
  assert.throws(()=>movementPath(0,25),/移動參數/);
  assert.throws(()=>movementPath(24,1),/移動參數/);
  assert.throws(()=>movementPath(-1,1),/移動參數/);
});

test('匯出與匯入完整保留星數、道具、護盾與子公司',()=>{
  const s=fourPlayerGame();
  s.players[0].stars=2;s.players[0].shields=2;s.players[0].items=['shield','swap','leverage'];
  s.players[2].parentId='player-1';s.players[2].cash=4321;
  s.players[1].energy=4;s.players[2].forcedRed=true;
  const restored=importGame(exportGame(s));
  assert.equal(restored.version,2);assert.equal(restored.round,s.round);assert.equal(restored.turnIndex,s.turnIndex);
  assert.deepEqual(restored.players.map(p=>p.stars),s.players.map(p=>p.stars));
  assert.deepEqual(restored.players.map(p=>p.items),s.players.map(p=>p.items));
  assert.deepEqual(restored.players.map(p=>p.shields),s.players.map(p=>p.shields));
  assert.deepEqual(restored.players.map(p=>p.parentId),s.players.map(p=>p.parentId));
  assert.equal(restored.players[2].cash,4321);
  assert.equal(restored.players[1].energy,4);
  assert.equal(restored.players[2].forcedRed,true);
  assert.equal(restored.ghostPosition,s.ghostPosition);
  assert.ok(Array.isArray(restored.log));
  assert.throws(()=>importGame('{"version":3,"players":[]}'),/存檔版本/);
});

test('第 1 版財務存檔會遷移成派對存檔並保留總資產',()=>{
  const legacy={
    version:1,seed:42,round:3,maxRounds:12,turnIndex:1,status:'playing',
    players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'technology'}],
    companies:{auto:{cash:1750},technology:{cash:640}},
    log:['舊版記錄']
  };
  const s=importGame(JSON.stringify(legacy));
  assert.equal(s.version,2);assert.equal(s.mode,'party');
  assert.equal(s.round,3);assert.equal(s.maxRounds,12);
  assert.deepEqual(s.players.map(p=>p.cash),[1750,640]);
  assert.deepEqual(s.players.map(p=>p.stars),[0,0]);
  assert.deepEqual(s.players.map(p=>p.energy),[1,1]);
  assert.deepEqual(s.players.map(p=>p.items),[[],[]]);
  assert.equal(s.phase,'roll');
  assert.match(s.log[0],/第 1 版財務存檔/);
  const finished=importGame(JSON.stringify({...legacy,status:'finished',winnerIds:['player-2']}));
  assert.equal(finished.status,'finished');assert.equal(finished.phase,'finished');
  assert.equal(finished.resultReason,'legacy');
  assert.deepEqual(finished.winnerIds,['player-2']);
});

test('缺漏幽靈狀態的存檔會自動補齊',()=>{
  const raw=JSON.parse(exportGame(game()));
  delete raw.ghostPosition;delete raw.ghostRng;delete raw.ghostTrail;
  const s=importGame(raw);
  assert.ok(s.ghostPosition>=1&&s.ghostPosition<BOARD.length);
  assert.deepEqual(s.ghostTrail,[]);
  assert.ok(Number.isInteger(s.ghostRng)&&s.ghostRng!==0);
});
