import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './engine.js';
import { extInitGame } from './party_engine.js';
import {
  aiReadSettings, aiAnalyzeBoard, aiChooseDiscard, aiChoosePreRollAction,
  aiPredictRoll, aiChooseAuctionAction, aiChooseInvestAction, aiChooseTaxAction,
  aiChooseInsiderAction, aiChooseDecisionAction, aiPlanTurn
} from './ai_engine.js';

const make = (settings = {}) => {
  const state = createGame({
    players: [
      { name: '人類', roleId: 'auto' },
      { name: '電腦', roleId: 'technology', isAI: true, aiDifficulty: 'normal' }
    ], seed: 13, maxRounds: 10
  });
  state.advancedSettings = {
    startingAssets: 2000, blackMarketStartingPrice: 1000, blackMarketBidIncrement: 250,
    blackMarketTransparent: false, blackMarketJunk: false, angryGhost: false,
    ghostExorcismAssets: 1000, ghostExorcismEnergy: 1, insiderTradeStable: false,
    mergerPrice: 2000, autoEnergy: false, ...settings
  };
  extInitGame(state, { mode: 'star', debug: true, startingCash: 2000 });
  return state;
};

test('AI 讀取實際棋盤與進階設定開關', () => {
  const state = make({ blackMarketStartingPrice: 0, blackMarketBidIncrement: 0, ghostExorcismAssets: 0, ghostExorcismEnergy: 0 });
  const settings = aiReadSettings(state);
  assert.equal(settings.blackMarket.enabled, false);
  assert.equal(settings.ghost.enabled, false);
  assert.equal(settings.investment.enabled, true);
  assert.equal(settings.tax.enabled, true);
  assert.equal(settings.insider.enabled, true);
  assert.equal(settings.map.length, state.board.length);
  assert.equal(aiAnalyzeBoard(state, state.players[1]).route.length, 6);
});

test('黑市格或價格關閉時不保留拍賣預算', () => {
  const state = make({ blackMarketStartingPrice: 0 });
  state.ext.auction = { currentPrice: 1000, bidIncrement: 250, junk: false };
  const result = aiChooseAuctionAction(state, state.players[1]);
  assert.equal(result.action, 'pass');
  assert.equal(result.reason, 'black-market-disabled');
  assert.equal(result.maxBid, state.players[1].cash);
});

test('爛貨開關只在開啟且未揭露時影響高難度 AI', () => {
  const state = make({ blackMarketJunk: false });
  const player = state.players[1];
  player.aiDifficulty = 'expert';
  state.ext.auction = { currentPrice: 1000, bidIncrement: 250, junk: true };
  assert.equal(aiChooseAuctionAction(state, player).action, 'bid');
  state.advancedSettings.blackMarketJunk = true;
  assert.equal(aiChooseAuctionAction(state, player).action, 'pass');
  state.advancedSettings.blackMarketTransparent = true;
  assert.equal(aiChooseAuctionAction(state, player).action, 'bid');
});

test('四種難度的背包與骰前行為有可觀察差異', () => {
  const state = make();
  const player = state.players[1];
  player.items = ['shield', 'dice123', 'dice123'];
  player.mythics = [{ id: 'totem' }];
  player.aiDifficulty = 'easy';
  assert.equal(aiChooseDiscard(state, player).id, 'shield');
  player.aiDifficulty = 'normal';
  assert.equal(aiChooseDiscard(state, player).id, 'dice123');
  player.items = ['swap'];
  state.players[0].detainedTurns = 2;
  player.aiDifficulty = 'hard';
  assert.equal(aiChoosePreRollAction(state, player).reason, 'escape-trap');
});

test('普通以上 AI 依自動回能設定調整能量政策', () => {
  const state = make({ autoEnergy: false });
  const player = state.players[1];
  player.aiDifficulty = 'expert';
  player.energy = 2;
  assert.equal(aiPlanTurn(state, player).energyPolicy, 'reserve');
  state.advancedSettings.autoEnergy = true;
  assert.equal(aiPlanTurn(state, player).energyPolicy, 'spend');
});

test('查稅局、投資格與內線交易使用初始資產比例及開關', () => {
  const state = make({ startingAssets: 4000 });
  const player = state.players[1];
  player.aiDifficulty = 'normal';
  player.cash = 7000;
  state.ext.taxChoice = { playerId: player.id, tileIndex: 1 };
  assert.equal(aiChooseTaxAction(state, player).action, 'detain');
  state.ext.investOffer = { playerId: player.id, cost: 3500 };
  state.players[0].cash = 1000;
  assert.equal(aiChooseInvestAction(state, player).action, 'invest');
  state.ext.insiderOffer = { playerId: player.id, tileIndex: 2 };
  assert.equal(aiChooseInsiderAction(state, player).action, 'pay');
  state.board = state.board.filter(tile => tile.type !== 'insider');
  assert.equal(aiChooseInsiderAction(state, player).action, 'skip');
  assert.equal(aiChooseInsiderAction(state, player).budget, 0);
});

test('專家 AI 支援 70% 預知與 30% 期望值分支', () => {
  const state = make();
  const player = state.players[1];
  player.aiDifficulty = 'expert';
  const known = aiPredictRoll(state, player, { random: () => 0.1, predictedRoll: 4 });
  assert.equal(known.mode, 'known');
  assert.equal(known.value, 4);
  const expected = aiPredictRoll(state, player, { random: () => 0.9 });
  assert.equal(expected.mode, 'expected');
  assert.equal(expected.value, null);
  assert.equal(expected.outcomes.length, 6);
});

test('完整回合計畫在每次呼叫時重新讀取 state', () => {
  const state = make({ mergerPrice: 9000 });
  const player = state.players[1];
  player.aiDifficulty = 'hard';
  player.cash = 3000;
  let plan = aiPlanTurn(state, player);
  assert.equal(plan.merger.action, 'skip');
  state.advancedSettings.mergerPrice = 2000;
  plan = aiPlanTurn(state, player);
  assert.equal(plan.merger.action, 'acquire');
  assert.equal(plan.settings.mergerPrice, 2000);
});

test('快速決策會依難度選擇可用選項且不會替訪客改寫 state', () => {
  const state = make();
  const player = state.players[1];
  state.pendingDecision = {
    playerId: player.id,
    options: [
      { id: 'safe', cash: 100, energy: 0, available: true },
      { id: 'risky', cash: 300, energy: 0, available: false },
      { id: 'energy', cash: 0, energy: 1, available: true }
    ]
  };
  player.aiDifficulty = 'normal';
  assert.equal(aiChooseDecisionAction(state, player).optionId, 'safe');
  player.aiDifficulty = 'easy';
  assert.equal(aiChooseDecisionAction(state, player, { random: () => .99 }).optionId, 'energy');
  assert.equal(state.pendingDecision.playerId, player.id);
});
