import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './engine.js';
import {isNewerGame} from './sync.js';

const game=()=>createGame({players:[{name:'甲',roleId:'auto'},{name:'乙',roleId:'electronics'}]});
test('其他頁籤只採用較新的同場對局修訂版',()=>{
  const tabA=game();tabA.sync={gameId:'match-a',revision:2,updatedAt:100,writerId:'A'};
  const tabB=structuredClone(tabA);tabB.sync={...tabB.sync,revision:3,updatedAt:101,writerId:'B'};
  assert.equal(isNewerGame(tabB,tabA),true);
  assert.equal(isNewerGame(tabA,tabB),false);
  assert.equal(isNewerGame(structuredClone(tabB),tabB),false);
});
test('新對局取代舊對局，舊頁籤不能覆寫新對局',()=>{
  const oldGame=game();oldGame.sync={gameId:'match-old',revision:80,updatedAt:100,writerId:'A'};
  const newGame=game();newGame.sync={gameId:'match-new',revision:1,updatedAt:101,writerId:'B'};
  assert.equal(isNewerGame(newGame,oldGame),true);
  assert.equal(isNewerGame(oldGame,newGame),false);
});
