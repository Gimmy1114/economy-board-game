import { DEFAULT_AI_DIFFICULTY, normalizeAIDifficulty, ITEMS } from './data.js';
import { MYTHIC_ITEMS, SPECIAL_ITEMS } from './party_data.js';

// AI 決策只讀取 state，回傳可供回合流程執行的資料命令。不要在這個檔案
// 修改棋盤、玩家或 DOM，讓單機與房主權威端都能重複計算同一個決策。

const aiItemIds = new Set(ITEMS.map(item => item.id));
const aiMythicIds = new Set(MYTHIC_ITEMS.map(item => item.id));
const aiSpecialIds = new Set(SPECIAL_ITEMS.map(item => item.id));
const aiDifficultyOrder = Object.freeze({ easy: 0, normal: 1, hard: 2, expert: 3 });
const aiHazardTiles = Object.freeze(new Set(['tax', 'market', 'invest', 'insider']));
const aiDiceItems = Object.freeze(new Set(['dice123', 'dice456']));
const aiSafeMythics = Object.freeze(new Set(['totem', 'indulgence', 'truthGate', 'witchFactor', 'starBlade', 'bankai']));

const aiNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const aiInteger = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
const aiClamp = (value, min, max) => Math.max(min, Math.min(max, value));
const aiRandom = random => typeof random === 'function' ? Number(random()) || 0 : Math.random();
const aiAlive = player => Boolean(player) && !player.ext?.eliminated && !player.isGhost;
const aiCash = player => Math.max(0, aiNumber(player?.cash));
const aiStars = player => Math.max(0, aiInteger(player?.stars));

function aiCountBoardTiles(state, type) {
  return Array.isArray(state?.board) ? state.board.filter(tile => tile?.type === type).length : 0;
}

function aiBoardTileAt(state, index) {
  const board = Array.isArray(state?.board) ? state.board : [];
  if (!board.length) return null;
  return board[((index % board.length) + board.length) % board.length] || null;
}

function aiRouteTiles(state, player, distance = 6) {
  const board = Array.isArray(state?.board) ? state.board : [];
  if (!board.length || !player) return [];
  const start = aiInteger(player.position) || 0;
  const length = board.length;
  return Array.from({ length: Math.max(0, distance) }, (_, offset) => {
    const steps = offset + 1;
    const index = (start + steps) % length;
    return { steps, index, tile: board[index] || null };
  });
}

/** 讀取這一局當下真正啟用的進階設定與棋盤功能。 */
export function aiReadSettings(state) {
  const source = state?.advancedSettings && typeof state.advancedSettings === 'object'
    ? state.advancedSettings : {};
  const board = Array.isArray(state?.board) ? state.board : [];
  const marketTiles = board.filter(tile => tile?.type === 'market');
  const investTiles = board.filter(tile => tile?.type === 'invest');
  const taxTiles = board.filter(tile => tile?.type === 'tax');
  const insiderTiles = board.filter(tile => tile?.type === 'insider');
  const startingAssets = Math.max(1, aiNumber(source.startingAssets, 2000));
  const marketStartingPrice = Math.max(0, aiInteger(source.blackMarketStartingPrice, 1000));
  const marketBidIncrement = Math.max(0, aiInteger(source.blackMarketBidIncrement, 250));
  const ghostAssetFee = Math.max(0, aiInteger(source.ghostExorcismAssets, 1000));
  const ghostEnergyFee = Math.max(0, aiInteger(source.ghostExorcismEnergy, 1));
  const ghostPresent = state?.ghostPosition !== undefined && state?.ghostPosition !== null;
  const ghostEnabled = source.ghostEnabled !== false && ghostPresent;
  const mergerPrice = Math.max(0, aiInteger(source.mergerPrice, 2000));
  const insiderEnabled = insiderTiles.length > 0;
  const marketEnabled = marketTiles.length > 0 && marketStartingPrice > 0 && marketBidIncrement > 0;
  const ghostActive = ghostEnabled && (ghostAssetFee > 0 || ghostEnergyFee > 0);
  return {
    startingAssets,
    autoEnergy: source.autoEnergy === true,
    mergerPrice,
    blackMarket: {
      enabled: marketEnabled,
      tileCount: marketTiles.length,
      startingPrice: marketStartingPrice,
      bidIncrement: marketBidIncrement,
      transparent: source.blackMarketTransparent === true,
      junkEnabled: source.blackMarketJunk === true
    },
    ghost: {
      enabled: ghostActive,
      tile: aiInteger(state?.ghostPosition, -1),
      assetFee: ghostAssetFee,
      energyFee: ghostEnergyFee,
      angry: source.angryGhost === true
    },
    investment: { enabled: investTiles.length > 0, tileCount: investTiles.length },
    tax: { enabled: taxTiles.length > 0, tileCount: taxTiles.length },
    insider: { enabled: insiderEnabled, tileCount: insiderTiles.length, cost: insiderEnabled ? 100 : 0 },
    map: {
      length: board.length,
      marketTiles: marketTiles.map(tile => tile.index),
      investTiles: investTiles.map(tile => tile.index),
      taxTiles: taxTiles.map(tile => tile.index),
      insiderTiles: insiderTiles.map(tile => tile.index),
      blankTiles: board.filter(tile => tile?.type === 'blank' || tile?.type === 'white').map(tile => tile.index)
    }
  };
}

/** 直接掃描 state.board，適用隨機地圖、自訂地圖與純白空白格。 */
export function aiAnalyzeBoard(state, player, { lookahead = 6 } = {}) {
  const settings = aiReadSettings(state);
  const route = aiRouteTiles(state, player, lookahead);
  const ghostIndex = settings.ghost.tile;
  const ghostTrail = Array.isArray(state?.ghostTrail) ? state.ghostTrail : [];
  const ghostIndexes = new Set([ghostIndex, ...ghostTrail].filter(Number.isInteger));
  let redRun = 0;
  const risks = route.map(entry => {
    const type = entry.tile?.type || 'blank';
    redRun = type === 'red' ? redRun + 1 : 0;
    const ghost = settings.ghost.enabled && ghostIndexes.has(entry.index);
    const tax = type === 'tax';
    const market = type === 'market';
    const invest = type === 'invest';
    const insider = type === 'insider';
    return {
      ...entry,
      type,
      ghost,
      tax,
      market,
      invest,
      insider,
      redRun,
      highRisk: ghost || tax || redRun >= 2,
      safe: !ghost && !tax && type !== 'red'
    };
  });
  return {
    ...settings,
    route: risks,
    riskSteps: risks.filter(tile => tile.highRisk).map(tile => tile.steps),
    rewardSteps: risks.filter(tile => tile.type === 'blue' || tile.type === 'yellow').map(tile => tile.steps),
    whiteSteps: risks.filter(tile => tile.type === 'blank' || tile.type === 'white').map(tile => tile.steps),
    hasGhostRisk: risks.some(tile => tile.ghost),
    hasTaxRisk: risks.some(tile => tile.tax),
    hasSpecialRisk: risks.some(tile => aiHazardTiles.has(tile.type))
  };
}

function aiInventory(player) {
  const normal = Array.isArray(player?.items) ? player.items : [];
  const mythic = Array.isArray(player?.mythics) ? player.mythics.map(entry => typeof entry === 'string' ? { id: entry } : entry).filter(Boolean) : [];
  const special = Array.isArray(player?.specials) ? player.specials.map(id => ({ id })) : [];
  return [
    ...normal.map((id, index) => ({ kind: 'normal', id, index })),
    ...mythic.map((entry, index) => ({ kind: 'mythic', id: entry.id, index })),
    ...special.map((entry, index) => ({ kind: 'special', id: entry.id, index }))
  ];
}

function aiThreatLevel(state, player) {
  const rivals = (state?.players || []).filter(other => other?.id !== player?.id && aiAlive(other));
  return rivals.reduce((score, rival) => score + (
    (rival.mythics || []).some(entry => (entry?.id || entry) === 'iceMushroom') ? 2 : 0
  ) + ((rival.mythics || []).some(entry => (entry?.id || entry) === 'vector') ? 1 : 0)
    + (aiInteger(rival.energy) >= 3 ? 1 : 0), 0);
}

/** 背包滿格時選擇要丟掉的欄位。 */
export function aiChooseDiscard(state, player, { random = Math.random } = {}) {
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const inventory = aiInventory(player);
  if (inventory.length < 3) return null;
  let chosen;
  if (difficulty === 'easy') {
    chosen = inventory[0];
  } else {
    const duplicateDice = inventory.filter(item => aiDiceItems.has(item.id));
      const duplicateIds = new Set(duplicateDice.map(item => item.id));
    const duplicate = duplicateDice.find(item => duplicateDice.some(other => other !== item && other.id === item.id));
    const disposable = inventory.filter(item => !aiSafeMythics.has(item.id));
    chosen = duplicate || disposable.sort((a, b) => {
      const value = item => item.kind === 'normal' ? (item.id === 'shield' ? 4 : item.id === 'swap' ? 2 : item.id === 'leverage' ? 1 : 0) : 5;
      return value(a) - value(b);
    })[0] || inventory[0];
    if (difficulty === 'hard' || difficulty === 'expert') {
      const weak = inventory.filter(item => item.kind === 'normal' && ['dice123', 'dice456'].includes(item.id));
      chosen = weak.find(item => duplicateIds.has(item.id)) || chosen;
    }
  }
  // Keep the random argument meaningful for callers that want a tie break while
  // keeping the simple difficulty's leftmost discard rule deterministic.
  if (difficulty !== 'easy' && inventory.filter(item => item.id === chosen?.id).length > 1 && aiRandom(random) < 0.5) {
    chosen = inventory.find(item => item.id === chosen.id) || chosen;
  }
  return chosen ? { type: 'DISCARD_ITEM', kind: chosen.kind, id: chosen.id, index: chosen.index } : null;
}

function aiTargetLeader(state, player) {
  return (state?.players || []).filter(other => other?.id !== player?.id && aiAlive(other))
    .sort((a, b) => (aiStars(b) - aiStars(a)) || (aiCash(b) - aiCash(a)))[0] || null;
}

function aiHasItem(player, id) {
  return (player?.items || []).includes(id) || (player?.mythics || []).some(entry => (entry?.id || entry) === id) || (player?.specials || []).includes(id);
}

function aiPropertySeizeOpportunity(state, player, analysis) {
  if (player?.roleId !== 'property' || aiInteger(player.energy) < 1) return null;
  const rivals = (state?.players || []).filter(other => other.id !== player.id && aiAlive(other));
  const sameTile = rivals.filter(other => other.position === player.position);
  const routeIndexes = new Set((analysis?.route || []).slice(0, 6).map(entry => entry.index));
  const alongPath = rivals.filter(other => routeIndexes.has(other.position));
  const candidates = [...sameTile, ...alongPath];
  if (!candidates.length) return null;
  const leader = aiTargetLeader(state, player);
  candidates.sort((a, b) => {
    const priority = rival => (rival.detainedTurns > 0 ? 2 : rival.id === leader?.id ? 1 : 0);
    return priority(b) - priority(a) || aiCash(b) - aiCash(a);
  });
  return { target: candidates[0], sameTile: sameTile.length > 0, route: alongPath.length > 0 };
}

/** 擲骰前使用道具、技能或保留能量的決策。 */
export function aiChoosePreRollAction(state, player, { random = Math.random } = {}) {
  if (!player || !aiAlive(player)) return null;
  const difficulty = normalizeAIDifficulty(player.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const settings = aiReadSettings(state);
  const analysis = aiAnalyzeBoard(state, player, { lookahead: difficulty === 'easy' ? 4 : 6 });
  const inventory = aiInventory(player);
  const has = id => inventory.some(item => item.id === id);
  const seize = aiPropertySeizeOpportunity(state, player, analysis);
  if (seize) return { type: 'USE_SKILL', reason: seize.sameTile ? 'seize-same-tile' : 'seize-path' };
  if (difficulty === 'easy') {
    const quick = inventory.find(item => ['shield', 'dice123', 'dice456', 'leverage'].includes(item.id));
    if (quick) return { type: 'USE_ITEM', id: quick.id, reason: 'easy-random-use' };
    const swap = inventory.find(item => item.id === 'swap');
    const target = (state?.players || []).find(other => other.id !== player.id && aiAlive(other));
    if (swap && target && !(analysis.route[0]?.ghost)) return { type: 'USE_ITEM', id: 'swap', targetId: target.id, reason: 'safe-random-swap' };
    if (aiInteger(player.energy) >= 1 && aiRandom(random) < 0.5) return { type: 'USE_SKILL', targetId: aiTargetLeader(state, player)?.id || null, reason: 'easy-half-chance' };
    return null;
  }
  const threat = aiThreatLevel(state, player);
  const fullEnergy = aiInteger(player.energy) >= 3;
  if (has('iceMushroom') || has('vector') || fullEnergy || threat > 0) {
    if (has('shield') && (threat > 0 || fullEnergy)) return { type: 'USE_ITEM', id: 'shield', reason: 'defense' };
    if (analysis.riskSteps.length && has('dice123')) return { type: 'USE_ITEM', id: 'dice123', reason: 'avoid-risk' };
    if (analysis.riskSteps.length && has('swap') && !analysis.route[0]?.ghost) {
      const leader = aiTargetLeader(state, player);
      if (leader) return { type: 'USE_ITEM', id: 'swap', targetId: leader.id, reason: 'avoid-risk' };
    }
  }
  if ((difficulty === 'hard' || difficulty === 'expert') && aiInteger(player.energy) > 0) {
    const detained = (state?.players || []).find(other => other.id !== player.id && aiAlive(other) && aiInteger(other.detainedTurns) > 0);
    if (detained && has('swap')) return { type: 'USE_ITEM', id: 'swap', targetId: detained.id, reason: 'escape-trap' };
    const leader = aiTargetLeader(state, player);
    if (leader && player.shields && has('iceMushroom')) return { type: 'USE_MYTHIC', id: 'iceMushroom', targetId: leader.id, reason: 'lock-leader' };
    if (leader && leader.shields > 0 && aiInteger(player.energy) > 0) return { type: 'USE_SKILL', targetId: leader.id, reason: 'break-shield' };
    if (leader && aiInteger(player.energy) > 0 && aiRandom(random) < (difficulty === 'expert' ? 0.85 : 0.65)) return { type: 'USE_SKILL', targetId: leader.id, reason: 'lock-leader' };
  }
  if (settings.autoEnergy && aiInteger(player.energy) > 0) {
    const leader = aiTargetLeader(state, player);
    if (leader && aiRandom(random) < (difficulty === 'expert' ? 1 : 0.8)) return { type: 'USE_SKILL', targetId: leader.id, reason: 'auto-energy-regenerates' };
  }
  if (difficulty === 'expert' && settings.autoEnergy === false && aiInteger(player.energy) < 4 && analysis.rewardSteps.some(step => step <= 4)) return { type: 'HOLD_ENERGY', reason: 'yellow-route' };
  if (has('leverage') && !analysis.hasGhostRisk && (analysis.rewardSteps.length > 0 || difficulty === 'easy')) return { type: 'USE_ITEM', id: 'leverage', reason: 'amplify-reward' };
  return null;
}

/** 70% 預知骰點；其餘回傳 1–6 的期望值評估。 */
export function aiPredictRoll(state, player, { random = Math.random, predictedRoll, roll } = {}) {
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const analysis = aiAnalyzeBoard(state, player, { lookahead: 6 });
  const rng = aiRandom(random);
  if (difficulty !== 'expert') {
    const value = Number.isInteger(Number(roll)) ? aiClamp(Number(roll), 1, 6) : null;
    return { mode: value ? 'observed' : 'unknown', value, probability: value ? 1 : 0, analysis };
  }
  if (rng < 0.7) {
    const value = Number.isInteger(Number(predictedRoll)) ? aiClamp(Number(predictedRoll), 1, 6) : (1 + Math.floor((rng / 0.7) * 6));
    const target = analysis.route.find(entry => entry.steps === value);
    return { mode: 'known', value, probability: 0.7, hazard: target?.highRisk || false, reward: target?.type === 'blue' || target?.type === 'yellow', analysis };
  }
  const outcomes = Array.from({ length: 6 }, (_, index) => {
    const steps = index + 1;
    const target = analysis.route.find(entry => entry.steps === steps);
    const utility = target?.ghost ? -analysis.ghost.assetFee - analysis.ghost.energyFee * 200
      : target?.tax ? -analysis.startingAssets * 0.25
        : target?.type === 'blue' ? 300 : target?.type === 'yellow' ? 200 : target?.type === 'red' ? -150 : 0;
    return { steps, utility, hazard: Boolean(target?.highRisk), type: target?.type || 'blank' };
  });
  const expected = outcomes.reduce((sum, outcome) => sum + outcome.utility, 0) / outcomes.length;
  return { mode: 'expected', value: null, probability: 0.3, expected, outcomes, analysis };
}

/** 黑市出價：回傳 bid/pass 與本次可接受的最高總價。 */
export function aiChooseAuctionAction(state, player, { random = Math.random } = {}) {
  const settings = aiReadSettings(state);
  const auction = state?.ext?.auction || state?.auction;
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const cash = aiCash(player);
  if (!auction || !settings.blackMarket.enabled) return { action: 'pass', maxBid: cash, reason: 'black-market-disabled' };
  const current = Math.max(0, aiNumber(auction.currentPrice, settings.blackMarket.startingPrice));
  const increment = Math.max(0, aiNumber(auction.bidIncrement, settings.blackMarket.bidIncrement));
  if (difficulty === 'expert' && settings.blackMarket.junkEnabled && !settings.blackMarket.transparent && auction.junk === true) {
    return { action: 'pass', maxBid: 0, reason: 'expert-predicted-junk' };
  }
  let maxBid = cash;
  if (difficulty === 'easy') maxBid = settings.blackMarket.startingPrice + increment;
  else if (difficulty === 'normal') maxBid = Math.floor(cash * 0.5);
  else {
    const leader = aiTargetLeader(state, player);
    const leading = leader && (aiCash(player) > aiCash(leader) || aiStars(player) > aiStars(leader));
    const reserve = Math.max(settings.startingAssets * 0.25, settings.mergerPrice);
    maxBid = Math.max(0, cash - (leading ? reserve : settings.startingAssets * 0.1));
    if (difficulty === 'hard' && !leading && auction.highestBidder && auction.highestBidder !== player.id) {
      maxBid = Math.min(cash, current + increment * (1 + (aiRandom(random) < 0.5 ? 0 : 1)));
    }
    if (settings.blackMarket.junkEnabled && !settings.blackMarket.transparent) maxBid = Math.floor(maxBid * 0.8);
  }
  maxBid = Math.max(0, Math.floor(maxBid));
  const canBid = current <= maxBid && cash >= current;
  return {
    action: canBid ? 'bid' : 'pass', maxBid, currentPrice: current, nextPrice: current + increment,
    followCount: difficulty === 'easy' && canBid ? 1 : 0,
    willPassAfterBid: difficulty === 'easy' && canBid,
    reason: canBid ? 'within-budget' : 'over-budget'
  };
}

/** 黑市 AI watchdog 使用的安全動作；保持與一般 AI 決策相同的資料形狀。 */
export function aiAuctionPassAction(reason = 'watchdog') {
  return { action: 'pass', maxBid: 0, reason };
}

/** 投資格判斷；資產門檻永遠以當局初始資產比例計算。 */
export function aiChooseInvestAction(state, player) {
  const settings = aiReadSettings(state);
  const offer = state?.ext?.investOffer || state?.investOffer;
  if (!settings.investment.enabled || !offer || offer.playerId && offer.playerId !== player?.id) return { action: 'skip', reason: 'investment-disabled' };
  const cost = Math.max(0, aiInteger(offer.cost, Math.floor(aiCash(player) * 0.5)));
  if (cost <= 0 || aiCash(player) < cost) return { action: 'skip', reason: 'insufficient-cash', cost };
  const rivals = (state?.players || []).filter(other => other.id !== player?.id && aiAlive(other));
  const second = rivals.sort((a, b) => aiCash(b) - aiCash(a))[0];
  const lead = aiCash(player) - aiCash(second);
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const doomNear = state?.ext?.mode === 'evil' && aiInteger(state?.ext?.doomEvery) > 0 && ((aiInteger(state?.round) % aiInteger(state.ext.doomEvery)) === aiInteger(state.ext.doomEvery) - 1);
  const should = difficulty === 'easy' ? true
    : difficulty === 'normal' ? lead > settings.startingAssets * 0.8 && !doomNear
      : difficulty === 'hard' ? !doomNear && (lead > 0 || aiCash(player) > settings.startingAssets * 2)
        : !doomNear && (lead > settings.startingAssets * 0.4 || aiCash(player) > settings.startingAssets * 2);
  return { action: should ? 'invest' : 'skip', cost, reason: should ? 'asset-lead' : 'preserve-assets' };
}

/** 查稅局二選一，依難度與模式狀態決定付錢或拘留。 */
export function aiChooseTaxAction(state, player, { random = Math.random } = {}) {
  const settings = aiReadSettings(state);
  const offer = state?.ext?.taxChoice || state?.taxChoice;
  if (!settings.tax.enabled || !offer || (offer.playerId && offer.playerId !== player?.id)) return { action: 'skip', reason: 'tax-disabled' };
  const terms = typeof state?.ext?.taxTerms === 'function' ? state.ext.taxTerms : null;
  const wanted = aiInteger(player?.wantedLevel);
  const tax = wanted >= 3 ? aiCash(player) : Math.floor(aiCash(player) * 0.5);
  const hasIndulgence = aiHasItem(player, 'indulgence');
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const doomNear = state?.ext?.mode === 'evil' && aiInteger(state?.ext?.doomEvery) > 0 && ((aiInteger(state?.round) % aiInteger(state.ext.doomEvery)) === aiInteger(state.ext.doomEvery) - 1);
  if (difficulty === 'easy') return { action: aiRandom(random) < 0.5 ? 'pay' : 'detain', amount: tax, reason: 'easy-random' };
  if (hasIndulgence) return { action: 'pay', amount: tax, reason: 'use-indulgence' };
  if ((difficulty === 'hard' || difficulty === 'expert') && doomNear) return { action: 'detain', amount: tax, reason: 'protect-before-doom' };
  const starNear = state?.ext?.mode === 'star' && aiInteger(state.starGoal || state.ext?.targetStars, 3) - aiStars(player) <= 1;
  if ((difficulty === 'hard' || difficulty === 'expert') && starNear && aiCash(player) >= tax + 300) return { action: 'pay', amount: tax, reason: 'star-sprint' };
  if (difficulty === 'normal') return { action: aiCash(player) > settings.startingAssets * 1.5 ? 'detain' : 'pay', amount: tax, reason: 'asset-threshold' };
  return { action: aiCash(player) > settings.startingAssets ? 'detain' : 'pay', amount: tax, reason: terms ? 'dynamic-terms' : 'asset-threshold' };
}

/** 內線交易是否支付 100 元啟動輪盤。 */
export function aiChooseInsiderAction(state, player) {
  const settings = aiReadSettings(state);
  const offer = state?.ext?.insiderOffer || state?.insiderOffer;
  if (!settings.insider.enabled || !offer || (offer.playerId && offer.playerId !== player?.id)) return { action: 'skip', budget: 0, reason: 'insider-disabled' };
  const cash = aiCash(player);
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const reserve = difficulty === 'easy' ? 0 : settings.startingAssets * (difficulty === 'normal' ? 0.1 : 0.05);
  const should = cash > 100 + reserve && (difficulty === 'easy' || cash > 500 || difficulty === 'expert');
  return { action: should ? 'pay' : 'skip', budget: should ? 100 : 0, reason: should ? 'cash-available' : 'preserve-cash' };
}

/** 快速二選一：簡單難度偏向隨機，其餘難度選擇可用效益較高的選項。 */
export function aiChooseDecisionAction(state, player, { random = Math.random } = {}) {
  const decision = state?.pendingDecision;
  if (!decision || (decision.playerId && decision.playerId !== player?.id)) return null;
  const available = (decision.options || []).filter(option => option.hidden !== true && option.available !== false);
  if (!available.length) return null;
  const difficulty = normalizeAIDifficulty(player?.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const selected = difficulty === 'easy'
    ? available[Math.min(available.length - 1, Math.floor(aiRandom(random) * available.length))]
    : [...available].sort((a, b) => ((Number(b.cash) || 0) + (Number(b.energy) || 0) * 80) - ((Number(a.cash) || 0) + (Number(a.energy) || 0) * 80))[0];
  return { type: 'DECISION', optionId: selected.id, reason: difficulty === 'easy' ? 'easy-random' : 'best-utility' };
}

/** 併購、買星與結束回合的高階策略摘要。 */
export function aiPlanTurn(state, playerOrId, options = {}) {
  const player = typeof playerOrId === 'string' ? (state?.players || []).find(entry => entry.id === playerOrId) : playerOrId;
  if (!player) return { action: 'wait', reason: 'player-not-found' };
  const settings = aiReadSettings(state);
  const difficulty = normalizeAIDifficulty(player.aiDifficulty || DEFAULT_AI_DIFFICULTY);
  const analysis = aiAnalyzeBoard(state, player, { lookahead: difficulty === 'easy' ? 4 : 6 });
  const discard = aiChooseDiscard(state, player, options);
  const preRoll = aiChoosePreRollAction(state, player, options);
  const roll = aiPredictRoll(state, player, options);
  const leader = aiTargetLeader(state, player);
  const mergerReady = aiCash(player) >= settings.mergerPrice && leader && leader.id !== player.id;
  const starReady = state?.ext?.mode === 'star' && aiCash(player) >= aiInteger(state.ext.starPrice, 1000) && (analysis.route.some(entry => entry.steps <= 2 && entry.index === 0) || aiStars(player) >= aiInteger(state.starGoal, 3) - 1);
  return {
    playerId: player.id,
    difficulty,
    settings,
    analysis,
    discard,
    preRoll,
    roll,
    auction: aiChooseAuctionAction(state, player, options),
    investment: aiChooseInvestAction(state, player),
    tax: aiChooseTaxAction(state, player, options),
    insider: aiChooseInsiderAction(state, player),
    merger: mergerReady ? { action: 'acquire', targetId: leader.id, cost: settings.mergerPrice } : { action: 'skip', reason: 'not-ready' },
    mythic: aiHasItem(player, 'truthGate') && aiCash(player) < settings.startingAssets * 0.5
      ? { action: 'USE_MYTHIC', id: 'truthGate', reason: 'need-cash' }
      : aiHasItem(player, 'truthGate') && aiCash(player) > settings.startingAssets * 1.5 && aiInventory(player).length < 3
        ? { action: 'USE_MYTHIC', id: 'truthGate', reason: 'forge-item' }
        : aiHasItem(player, 'starBlade') && state?.ext?.mode === 'star'
          ? { action: 'RUSH_START', reason: 'star-blade' } : { action: 'skip' },
    ghostMove: difficulty === 'expert' && (player.isGhost || player.ext?.ghostRole)
      ? (() => { const target = [...(state?.players || [])].filter(other => other.id !== player.id && aiAlive(other)).sort((a, b) => aiCash(b) - aiCash(a))[0]; return target ? { action: 'CHASE', targetId: target.id, targetIndex: aiInteger(target.position) } : { action: 'wait' }; })()
      : { action: 'skip' },
    star: starReady ? { action: 'buy-star', reason: 'near-start' } : { action: 'skip' },
    energyPolicy: settings.autoEnergy ? 'spend' : (difficulty === 'easy' ? 'spend' : 'reserve')
  };
}

// 常用別名，讓未來回合排程可以用語意化名稱接入而不複製決策規則。
export const aiDecideTurn = aiPlanTurn;
export const aiEvaluateState = aiAnalyzeBoard;
export const aiChooseAction = aiChoosePreRollAction;
export const aiNormalizeDifficulty = value => normalizeAIDifficulty(value);

export const aiEngineVersion = '1.0.0';
