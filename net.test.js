import test from 'node:test';
import assert from 'node:assert/strict';
import {PartyNet, roomInviteLink, roomCodeFromLink, makeRoomCode, normalizeRoomCode, roomPeerId, ROOM_PREFIX} from './net.js';

class FakeConnection {
  constructor(peer) {
    this.peer = peer;
    this.handlers = new Map();
    this.sent = [];
    this.open = false;
    this.peerConnection = null;
  }
  on(event, handler) { this.handlers.set(event, handler); }
  emit(event, value) { if (event === 'open') this.open = true; this.handlers.get(event)?.(value); }
  send(message) { this.sent.push(message); }
  close() { this.open = false; }
}

class FakePeer {
  constructor(id, options) { this.id = id; this.options = options; this.handlers = new Map(); FakePeer.last = this; }
  on(event, handler) { this.handlers.set(event, handler); }
  emit(event, value) { this.handlers.get(event)?.(value); }
  connect(peerId, options) {
    this.connectTarget = peerId;
    this.connectOptions = options;
    this.connection = new FakeConnection(peerId);
    this.connection.peerConnection = FakePeer.nextPeerConnection || null;
    FakePeer.nextPeerConnection = null;
    return this.connection;
  }
  destroy() {}
}

class FakeRTCPeerConnection {
  constructor() {
    this.iceConnectionState = 'connected';
    this.oniceconnectionstatechange = null;
  }
  setIceState(state) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

test('多人房間可設定保護費抬升價，並帶入開局設定', () => {
  const previousLocation = globalThis.location;
  const previousPeer = globalThis.Peer;
  globalThis.location = {protocol: 'file:'};
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    FakePeer.last.emit('open', 'host-peer-id');
    assert.match(PartyNet.code, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(PartyNet.hostId, 'host-peer-id');
    assert.equal(PartyNet.lobby.doomStep, 500);
    PartyNet.addPlayer('peer-test', '玩家');
    PartyNet.setMode('evil');
    PartyNet.setDoomStep(750);
    assert.equal(PartyNet.lobby.doomStep, 750);

    let config = null;
    PartyNet.onStart = value => { config = value; };
    PartyNet.startGame();
    assert.equal(config.mode, 'evil');
    assert.equal(config.doomEvery, 5);
    assert.equal(config.doomPrice, 1000);
    assert.equal(config.doomStep, 750);
  } finally {
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
});

test('大廳棋子顏色只能改自己的，且會帶入開局設定', () => {
  withHost(({join, errors}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    assert.deepEqual(PartyNet.lobby.players.map(p => p.color), [0, 1, 2]);

    // 房主可以改自己的顏色；重複的顏色會被拒絕。
    assert.equal(PartyNet.setColor(8), true);
    assert.equal(PartyNet.lobby.players[0].color, 8);
    assert.equal(PartyNet.setColor(1), false);
    assert.equal(PartyNet.lobby.players[0].color, 8);
    assert.match(errors.at(-1), /已經被「小明」選走/);

    // 客機送出的訊息只會改到 fromPeer 本人，不能夾帶別人的 peerId。
    a.emit('data', {t: 'color', color: 6});
    assert.equal(PartyNet.lobby.players[1].color, 6);
    assert.ok(a.sent.some(message => message.t === 'lobby'
      && message.lobby.players.find(p => p.peerId === 'guest-a')?.color === 6));
    b.emit('data', {t: 'color', color: 6, peerId: 'guest-a'});
    assert.equal(PartyNet.lobby.players[1].color, 6);
    assert.equal(PartyNet.lobby.players[2].color, 2);
    assert.ok(b.sent.some(message => message.t === 'error'));

    let config = null;
    PartyNet.onStart = value => { config = value; };
    PartyNet.startGame();
    assert.deepEqual(config.players.map(p => p.color), [8, 6, 2]);
  });
});

test('客機 12 秒未收到合法握手 ACK 會關閉連線並回到主選單', async () => {
  const previousPeer = globalThis.Peer;
  const errors = [];
  let joinFailed = false;
  globalThis.Peer = FakePeer;
  PartyNet.onError = text => errors.push(text);
  PartyNet.onJoinFailed = () => { joinFailed = true; };
  try {
    PartyNet.joinRoom('host-peer-id', '小明');
    FakePeer.last.emit('open', 'guest-a');
    const connection = FakePeer.last.connection;
    connection.emit('open');
    assert.equal(connection.sent[0].type, 'HANDSHAKE_REQ');
    await new Promise(resolve => setTimeout(resolve, 12200));
    assert.equal(PartyNet.active, false);
    assert.equal(connection.open, false);
    assert.equal(joinFailed, true);
    assert.deepEqual(errors, ['加入失敗：無法連線至房主或房間不存在']);
  } finally {
    PartyNet.leave(false);
    PartyNet.onError = null;
    PartyNet.onJoinFailed = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('非房主或版本不符的握手回應立即中止加入', () => {
  withGuest(({connection, errors, joinFailed}) => {
    connection.emit('data', {
      type: 'HANDSHAKE_ACK',
      success: true,
      isHost: false,
      hostId: 'host-peer-id',
      clientVersion: ROOM_PREFIX,
      gameState: null,
      lobby: {players: []}
    });
    assert.equal(PartyNet.active, false);
    assert.equal(connection.open, false);
    assert.equal(joinFailed(), true);
    assert.deepEqual(errors, ['加入失敗：無法連線至房主或房間不存在']);
  }, {acknowledge: false});
});

test('玩家重新連線後恢復原 Peer ID 的座位，並取消離線狀態', () => {
  withHost(({join}) => {
    const first = join('guest-a', '小明');
    PartyNet.startGame();
    first.emit('close');
    assert.equal(PartyNet.lobby.players[1].connected, false);
    assert.ok(PartyNet.offlineSince.has('guest-a'));

    const reconnected = new FakeConnection('guest-a');
    FakePeer.last.emit('connection', reconnected);
    reconnected.emit('open');
    reconnected.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    assert.equal(reconnected.sent[0].type, 'HANDSHAKE_ACK');
    assert.equal(reconnected.sent[0].success, true);
    reconnected.emit('data', {t: 'hello', name: '小明', clientVersion: ROOM_PREFIX});

    assert.equal(PartyNet.lobby.players[1].connected, true);
    assert.equal(PartyNet.offlineSince.has('guest-a'), false);
    assert.equal(PartyNet.playerIds.get('guest-a'), 'player-2');
    assert.equal(names().filter(name => name === '小明').length, 1);
  });
});

test('房主握手驗證拒絕滿房、版本不符及已結束的對局', () => {
  withHost(({join}) => {
    for (let i = 0; i < 7; i++) join(`guest-${i}`, `玩家${i}`);
    const hostPeer = FakePeer.last;
    const overCapacity = new FakeConnection('guest-over-capacity');
    hostPeer.emit('connection', overCapacity);
    overCapacity.emit('open');
    overCapacity.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    assert.equal(overCapacity.sent[0].type, 'HANDSHAKE_REJECT');
    assert.equal(names().length, 8);

    const wrongVersion = new FakeConnection('guest-old-version');
    hostPeer.emit('connection', wrongVersion);
    wrongVersion.emit('open');
    wrongVersion.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: 'econparty-v1-'});
    assert.equal(wrongVersion.sent.at(-1).type, 'HANDSHAKE_REJECT');
    assert.match(wrongVersion.sent.at(-1).reason, /版本不相容/);

    PartyNet.lobby.status = 'playing';
    PartyNet.getGameState = () => ({status: 'finished'});
    const endedRoom = new FakeConnection('guest-0');
    hostPeer.emit('connection', endedRoom);
    endedRoom.emit('open');
    endedRoom.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    assert.equal(endedRoom.sent[0].type, 'HANDSHAKE_REJECT');
    assert.match(endedRoom.sent[0].reason, /已結束/);
  });
});

test('斷線滿 3 分鐘只觸發一次自動移除回呼', () => {
  withHost(({join}) => {
    const guest = join('guest-a', '小明');
    PartyNet.startGame();
    guest.emit('close');
    const disconnectedAt = PartyNet.offlineSince.get('guest-a');
    const kicked = [];
    PartyNet.onAutoKick = peerId => kicked.push(peerId);
    PartyNet._lastBeat = disconnectedAt;
    for (let elapsed = 3000; elapsed < 180000; elapsed += 3000) PartyNet.beat(disconnectedAt + elapsed);
    assert.deepEqual(kicked, []);
    PartyNet.beat(disconnectedAt + 180000);
    PartyNet.beat(disconnectedAt + 183000);
    assert.deepEqual(kicked, ['guest-a']);
    PartyNet.onAutoKick = null;
  });
});

test('房主踢除客機並封鎖其 Peer ID 的重新連線', () => {
  withHost(({join}) => {
    const guest = join('guest-a', '小明');
    PartyNet.startGame();

    assert.equal(PartyNet.kickPlayer('guest-a'), true);
    assert.equal(guest.sent.at(-1).t, 'kicked');
    assert.equal(PartyNet.blacklist.has('guest-a'), true);
    assert.deepEqual(names(), ['房主']);

    const retry = new FakeConnection('guest-a');
    FakePeer.last.emit('connection', retry);
    retry.emit('open');
    assert.equal(retry.sent.at(-1).t, 'kicked');
    retry.emit('data', {t: 'hello', name: '小明', clientVersion: ROOM_PREFIX});
    assert.deepEqual(names(), ['房主']);
  });
});

test('PeerJS 客機先送出握手請求，房主驗證後回覆 ACK 才接收玩家', () => {
  const previousPeer = globalThis.Peer;
  let joinReady = false;
  const lobbyUpdates = [];
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    const hostPeer = FakePeer.last;
    assert.deepEqual(hostPeer.options.config.iceServers, [
      {urls: 'stun:stun.l.google.com:19302'},
      {urls: 'stun:stun1.l.google.com:19302'},
      {urls: 'stun:stun2.l.google.com:19302'},
      {urls: 'stun:stun.cloudflare.com:3478'}
    ]);
    assert.equal(hostPeer.options.config.sdpSemantics, 'unified-plan');
    assert.equal(hostPeer.options.config.iceTransportPolicy, 'all');
    assert.equal(hostPeer.options.config.iceCandidatePoolSize, 10);
    assert.equal(hostPeer.options.debug, 1);
    hostPeer.emit('open', 'host-peer-id');
    const hostConnection = new FakeConnection('client-peer-id');
    hostPeer.emit('connection', hostConnection);
    hostConnection.emit('open');
    hostConnection.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    assert.equal(hostConnection.sent[0].type, 'HANDSHAKE_ACK');
    assert.equal(hostConnection.sent[0].success, true);
    assert.equal(hostConnection.sent[0].isHost, true);
    assert.equal(hostConnection.sent[0].hostId, 'host-peer-id');
    assert.equal(hostConnection.sent[0].gameState, null);
    hostConnection.emit('data', {t: 'hello', name: '玩家', clientVersion: ROOM_PREFIX});
    assert.equal(PartyNet.lobby.players.length, 2);

    PartyNet.leave(false);
    PartyNet.onJoinReady = () => { joinReady = true; };
    PartyNet.onLobby = lobby => lobbyUpdates.push(lobby);
    PartyNet.joinRoom('host-peer-id', '客機');
    assert.equal(lobbyUpdates.length, 0);
    const clientPeer = FakePeer.last;
    assert.equal(clientPeer.id, undefined);
    assert.deepEqual(clientPeer.options.config.iceServers, hostPeer.options.config.iceServers);
    assert.equal(clientPeer.options.debug, 1);
    clientPeer.emit('open', 'client-peer-id');
    assert.equal(clientPeer.connectTarget, 'host-peer-id');
    assert.deepEqual(clientPeer.connectOptions, {reliable: true, serialization: 'json'});
    assert.equal(clientPeer.connection.peerConnection, null);
    assert.deepEqual(clientPeer.connection.sent, []);
    for (const event of ['open', 'data', 'error']) {
      assert.equal(typeof clientPeer.connection.handlers.get(event), 'function');
    }
    assert.equal(joinReady, false);
    clientPeer.connection.emit('open');
    assert.deepEqual(clientPeer.connection.sent[0], {
      type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX, name: '客機'
    });
    clientPeer.connection.emit('data', {
      type: 'HANDSHAKE_ACK',
      success: true,
      isHost: true,
      hostId: 'host-peer-id',
      clientVersion: ROOM_PREFIX,
      gameState: null,
      lobby: {code: 'host-peer-id', hostId: 'host-peer-id', status: 'waiting', players: [{peerId: 'host-peer-id', name: '房主', host: true}]}
    });
    assert.equal(clientPeer.connection.sent.at(-1).t, 'hello');
    assert.equal(joinReady, true);
    assert.equal(lobbyUpdates.length, 1);
  } finally {
    PartyNet.leave(false);
    PartyNet.onJoinReady = null;
    PartyNet.onLobby = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('客機 ICE failed 或 disconnected 時立即關閉並顯示穿透失敗提示', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  const errors = [];
  let joinFailed = false;
  PartyNet.onError = text => errors.push(text);
  PartyNet.onJoinFailed = () => { joinFailed = true; };
  try {
    for (const state of ['failed', 'disconnected']) {
      const peerConnection = new FakeRTCPeerConnection();
      FakePeer.nextPeerConnection = peerConnection;
      PartyNet.joinRoom('host-peer-id', '客機');
      const peer = FakePeer.last;
      peer.emit('open', `guest-${state}`);
      const connection = peer.connection;
      assert.equal(typeof peerConnection.oniceconnectionstatechange, 'function');
      connection.emit('open');
      peerConnection.setIceState(state);
      assert.equal(PartyNet.active, false);
      assert.equal(connection.open, false);
      assert.equal(joinFailed, true);
      assert.equal(errors.at(-1), '【P2P 網路連線建立失敗，請重新整理網頁後再試】');
      PartyNet.leave(false);
    }
  } finally {
    FakePeer.nextPeerConnection = null;
    PartyNet.leave(false);
    PartyNet.onError = null;
    PartyNet.onJoinFailed = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('房主收到 ICE failure 或 disconnected 時通知並關閉該客機連線', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  const errors = [];
  PartyNet.onError = text => errors.push(text);
  try {
    PartyNet.createRoom({name: '房主'});
    const peer = FakePeer.last;
    peer.emit('open', 'host-peer-id');
    const connection = new FakeConnection('guest-ice-failure');
    const peerConnection = new FakeRTCPeerConnection();
    connection.peerConnection = peerConnection;
    peer.emit('connection', connection);
    connection.emit('open');
    peerConnection.setIceState('disconnected');
    assert.equal(connection.open, false);
    assert.deepEqual(errors, ['【P2P 網路連線建立失敗，請重新整理網頁後再試】']);
    assert.equal(typeof peerConnection.oniceconnectionstatechange, 'object');
  } finally {
    PartyNet.leave(false);
    PartyNet.onError = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('ICE checking 時客機不在未開啟的 DataChannel 上重送握手', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    const peerConnection = new FakeRTCPeerConnection();
    FakePeer.nextPeerConnection = peerConnection;
    PartyNet.joinRoom('host-peer-id', '客機');
    const peer = FakePeer.last;
    peer.emit('open', 'guest-checking');
    const connection = peer.connection;
    connection.emit('open');
    assert.equal(connection.sent.filter(message => message.type === 'HANDSHAKE_REQ').length, 1);

    connection.open = false;
    peerConnection.setIceState('checking');
    assert.equal(connection.sent.filter(message => message.type === 'HANDSHAKE_REQ').length, 1);
    assert.equal(Object.hasOwn(PartyNet.peers.get('host-peer-id'), 'iceCheckingTimer'), false);
  } finally {
    FakePeer.nextPeerConnection = null;
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('ICE checking 時房主不在未開啟的 DataChannel 上重送握手 ACK', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    const peer = FakePeer.last;
    peer.emit('open', 'host-peer-id');
    const connection = new FakeConnection('guest-checking');
    const peerConnection = new FakeRTCPeerConnection();
    connection.peerConnection = peerConnection;
    peer.emit('connection', connection);
    connection.emit('open');
    assert.equal(connection.sent.filter(message => message.type === 'HANDSHAKE_ACK').length, 1);

    connection.open = false;
    peerConnection.setIceState('checking');
    assert.equal(connection.sent.filter(message => message.type === 'HANDSHAKE_ACK').length, 1);
    assert.equal(Object.hasOwn(PartyNet.peers.get('guest-checking'), 'iceCheckingTimer'), false);
  } finally {
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('房主收到 connection 時先綁定 data，通道 open 後主動 ACK 並驗證客機 hello', () => {
  withHost(({join}) => {
    const connection = new FakeConnection('guest-proactive');
    FakePeer.last.emit('connection', connection);
    assert.equal(typeof connection.handlers.get('data'), 'function');
    assert.equal(connection.sent.length, 0);

    connection.emit('open');
    assert.equal(connection.sent[0].type, 'HANDSHAKE_ACK');
    assert.equal(connection.sent[0].success, true);
    assert.equal(connection.sent[0].hostId, PartyNet.peerId);
    assert.equal(PartyNet.verifiedPeers.has('guest-proactive'), false);

    connection.emit('data', {t: 'hello', name: '主動握手玩家', clientVersion: ROOM_PREFIX});
    assert.equal(PartyNet.verifiedPeers.has('guest-proactive'), true);
    assert.ok(PartyNet.lobby.players.some(player => player.peerId === 'guest-proactive'));
    assert.ok(PartyNet.pendingHandshakes.has('guest-proactive') === false);
  });
});

test('房主主動 ACK 後仍拒絕版本不符的客機 hello', () => {
  withHost(() => {
    const connection = new FakeConnection('guest-wrong-version');
    FakePeer.last.emit('connection', connection);
    connection.emit('open');
    assert.equal(connection.sent[0].type, 'HANDSHAKE_ACK');
    connection.emit('data', {t: 'hello', name: '舊版玩家', clientVersion: 'econparty-v3-'});
    assert.equal(PartyNet.lobby.players.some(player => player.peerId === 'guest-wrong-version'), false);
    assert.equal(PartyNet.verifiedPeers.has('guest-wrong-version'), false);
    assert.equal(connection.sent.at(-1).t, 'refused');
  });
});

test('房主只派發客機 Action，忽略客機狀態並向客機派發 Event', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    const hostPeer = FakePeer.last;
    hostPeer.emit('open', 'host-peer-id');
    const connection = new FakeConnection('client-peer-id');
    hostPeer.emit('connection', connection);
    connection.emit('open');
    connection.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    const actions = [];
    let receivedState = false;
    PartyNet.onAction = (action, peerId) => actions.push({action, peerId});
    PartyNet.onState = () => { receivedState = true; };
    connection.emit('data', {t: 'action', action: {type: 'ROLL_DICE', playerId: 'player-2'}});
    connection.emit('data', {t: 'state', game: {players: []}});
    assert.deepEqual(actions, [{action: {type: 'ROLL_DICE', playerId: 'player-2'}, peerId: 'client-peer-id'}]);
    assert.equal(receivedState, false);

    const events = [];
    PartyNet.onEvent = event => events.push(event);
    PartyNet.broadcastEvent({type: 'GHOST_ATTACK', target: 'player-2'});
    assert.deepEqual(events, [{type: 'GHOST_ATTACK', target: 'player-2'}]);
    assert.deepEqual(connection.sent.at(-1), {
      t: 'event', event: {type: 'GHOST_ATTACK', target: 'player-2'},
      mid: connection.sent.at(-1).mid, fromPeer: 'host-peer-id', at: connection.sent.at(-1).at
    });
  } finally {
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('重複收到相同封包時只處理一次', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    const hostPeer = FakePeer.last;
    hostPeer.emit('open', 'host-peer-id');
    const connection = new FakeConnection('client-peer-id');
    hostPeer.emit('connection', connection);
    connection.emit('open');
    connection.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
    let received = 0;
    PartyNet.onAction = () => { received++; };
    const packet = {t: 'action', action: {type: 'ROLL_DICE'}, mid: 'duplicate-roll'};
    connection.emit('data', packet);
    connection.emit('data', packet);
    assert.equal(received, 1);
  } finally {
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('大廳 QR Code 的邀請連結：線上網址加上 ?room=，本機網址不產生', () => {
  const code = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
  assert.equal(roomInviteLink('https://soymilk0211.github.io/bigdata-week7/', code), `https://soymilk0211.github.io/bigdata-week7/?room=${code}`);
  assert.equal(roomInviteLink('https://soymilk0211.github.io/bigdata-week7/index.html?room=OLD#rules', ` ${code} `), `https://soymilk0211.github.io/bigdata-week7/index.html?room=${code}`);
  assert.equal(roomInviteLink('http://192.168.1.20:4173/', 'abc'), 'http://192.168.1.20:4173/?room=abc');
  assert.equal(roomInviteLink('https://soymilk0211.github.io/bigdata-week7/', ''), '');
  for (const href of ['file:///C:/game/index.html', 'http://127.0.0.1:4173/', 'http://localhost:4173/', 'http://[::1]:4173/', 'not a url']) {
    assert.equal(roomInviteLink(href, code), '', href);
  }
});

test('掃 QR Code 打開的網址可以讀回房間代碼', () => {
  const code = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
  assert.equal(roomCodeFromLink(roomInviteLink('https://soymilk0211.github.io/bigdata-week7/', code)), code);
  assert.equal(roomCodeFromLink('https://soymilk0211.github.io/bigdata-week7/'), '');
  assert.equal(roomCodeFromLink('https://soymilk0211.github.io/bigdata-week7/?room=%20abc%20'), 'abc');
  assert.equal(roomCodeFromLink('not a url'), '');
});

// ---- 有人離開大廳／斷線 -------------------------------------------------
function withHost(run) {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  const errors = [];
  PartyNet.onError = text => errors.push(text);
  try {
    PartyNet.createRoom({name: '房主'});
    PartyNet.getGameState = () => ({status: PartyNet.lobby?.status === 'playing' ? 'playing' : 'waiting'});
    const hostPeer = FakePeer.last;
    hostPeer.emit('open', 'host-peer-id');
    const join = (peerId, name) => {
      const connection = new FakeConnection(peerId);
      hostPeer.emit('connection', connection);
      assert.equal(typeof connection.handlers.get('data'), 'function');
      assert.equal(typeof connection.handlers.get('open'), 'function');
      connection.emit('open');
      connection.emit('data', {type: 'HANDSHAKE_REQ', clientVersion: ROOM_PREFIX});
      assert.equal(connection.sent[0].type, 'HANDSHAKE_ACK');
      connection.emit('data', {t: 'hello', name, clientVersion: ROOM_PREFIX});
      return connection;
    };
    run({join, errors});
  } finally {
    PartyNet.leave(false);
    PartyNet.onError = null;
    PartyNet.onStart = null;
    PartyNet.onAutoKick = null;
    PartyNet.onKicked = null;
    PartyNet.onJoinFailed = null;
    PartyNet.getGameState = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
}
const names = () => PartyNet.lobby.players.map(p => p.name);

test('開始前客機離開或斷線，房主馬上把他移出大廳', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    assert.deepEqual(names(), ['房主', '小明', '阿華']);
    a.emit('data', {t: 'leave'});
    assert.deepEqual(names(), ['房主', '阿華']);
    b.emit('close');
    assert.deepEqual(names(), ['房主']);
    // 同一個人用新的頁面（新的 Peer ID）回來，只會有一筆
    join('guest-a2', '小明');
    assert.deepEqual(names(), ['房主', '小明']);
  });
});

test('名字重複時自動加上編號，開局不會因為名字重複而失敗', () => {
  withHost(({join}) => {
    join('guest-a', '玩家 1');
    join('guest-b', '玩家 1');
    const c = join('guest-c', ' 房主 ');
    assert.deepEqual(names(), ['房主', '玩家 1', '玩家 1 2', '房主 2']);
    c.emit('data', {t: 'rename', name: '玩家 1'});
    assert.equal(names()[3], '玩家 1 3');
    let config = null;
    PartyNet.onStart = value => { config = value; };
    PartyNet.startGame();
    assert.equal(new Set(config.players.map(p => p.name)).size, 4);
  });
});

test('大廳玩家可自行改名，但開局後名稱鎖定', () => {
  withHost(({join}) => {
    const guest = join('guest-a', '小明');
    PartyNet.renameSelf('新房主');
    guest.emit('data', {t: 'rename', name: '新玩家名'});
    assert.deepEqual(names(), ['新房主', '新玩家名']);
    PartyNet.startGame();
    guest.emit('data', {t: 'rename', name: '開局後改名'});
    assert.deepEqual(names(), ['新房主', '新玩家名']);
  });
});

test('房主 12 秒沒收到客機訊息就標成已離線，收到訊息後恢復；開始時已離線的人不加入', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    const t0 = Date.now();
    for (let t = t0 + 3000; t <= t0 + 15000; t += 3000) {
      PartyNet.lastSeen.set('guest-a', t);  // 小明每 3 秒有 ping
      PartyNet.beat(t);
    }
    assert.deepEqual(PartyNet.lobby.players.map(p => p.connected !== false), [true, true, false]);
    b.emit('data', {t: 'ping'});
    assert.equal(PartyNet.lobby.players[2].connected, true);
    PartyNet.lobby.players[2].connected = false;

    let config = null;
    PartyNet.onStart = value => { config = value; };
    PartyNet.startGame();
    assert.deepEqual(config.players.map(p => p.name), ['房主', '小明']);
    assert.deepEqual(Object.values(config.net.owners), ['host-peer-id', 'guest-a']);
    assert.deepEqual(names(), ['房主', '小明']);
    assert.equal(b.sent.at(-1).t, 'refused');
    assert.match(b.sent.at(-1).text, /你剛才離線/);
    assert.equal(b.sent.some(m => m.t === 'start'), false);
    assert.equal(a.sent.some(m => m.t === 'start'), true);
  });
});

test('房主的頁面在背景停過時，先不判斷誰離線', () => {
  withHost(({join}) => {
    join('guest-a', '小明');
    PartyNet.beat(Date.now() + 60000);
    assert.equal(PartyNet.lobby.players[1].connected, true);
  });
});

test('只剩 1 位在線玩家時不能開始；第 9 位加入會被拒絕', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    PartyNet.lobby.players[1].connected = false;
    assert.throws(() => PartyNet.startGame(), /至少需要 2 位在線玩家/);
    assert.equal(PartyNet.lobby.status, 'waiting');
    PartyNet.lobby.players[1].connected = true;
    for (let i = 2; i <= 7; i++) join(`guest-${i}`, `玩家${i}`);
    assert.equal(PartyNet.lobby.players.length, 8);
    const ninth = join('guest-9', '第九位');
    assert.equal(PartyNet.lobby.players.length, 8);
    assert.equal(ninth.sent.at(-1).t, 'refused');
    assert.match(ninth.sent.at(-1).text, /房間已滿/);
    assert.equal(a.open, true);
  });
});

test('季數限制在 3–30，避免建立棋盤失敗', () => {
  withHost(() => {
    PartyNet.setRounds(99);
    assert.equal(PartyNet.lobby.rounds, 30);
    PartyNet.setRounds(1);
    assert.equal(PartyNet.lobby.rounds, 3);
    PartyNet.setRounds('abc');
    assert.equal(PartyNet.lobby.rounds, 10);
  });
});

test('建立棋盤失敗時大家回到大廳並看到原因', () => {
  withHost(({join, errors}) => {
    const a = join('guest-a', '小明');
    PartyNet.startGame();
    assert.equal(PartyNet.lobby.status, 'playing');
    PartyNet.cancelStart('季數上限須為 2–30。');
    assert.equal(PartyNet.lobby.status, 'waiting');
    assert.deepEqual(errors, ['無法開始對局：季數上限須為 2–30。']);
    assert.equal(a.sent.at(-1).text, '無法開始對局：季數上限須為 2–30。');
    assert.equal(a.sent.findLast(m => m.t === 'lobby').lobby.status, 'waiting');
  });
});

test('對局中有人斷線只標成已離線；結算確認不用等他，回大廳時移出', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    PartyNet.startGame();
    b.emit('close');
    assert.deepEqual(names(), ['房主', '小明', '阿華']);
    assert.equal(PartyNet.lobby.players[2].connected, false);
    assert.deepEqual(PartyNet.confirmResult('player-1'), {confirmed: 1, total: 2});
    let back = false;
    PartyNet.onReturnLobby = () => { back = true; };
    a.emit('data', {t: 'confirm', playerId: 'player-2'});
    assert.equal(back, true);
    assert.equal(PartyNet.lobby.status, 'waiting');
    assert.deepEqual(names(), ['房主', '小明']);
    assert.equal(b.sent.some(m => m.t === 'refused'), false);  // 連線已經關了，不用再通知
    PartyNet.onReturnLobby = null;
  });
});

test('等確認結果時最後一位沒確認的人離開，不會卡住', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    PartyNet.startGame();
    PartyNet.confirmResult('player-1');
    a.emit('data', {t: 'confirm', playerId: 'player-2'});
    assert.equal(PartyNet.lobby.status, 'playing');
    b.emit('data', {t: 'leave'});
    assert.equal(PartyNet.lobby.status, 'waiting');
    assert.deepEqual(names(), ['房主', '小明']);
  });
});

function withGuest(run, {acknowledge = true} = {}) {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  const errors = [];
  let lost = null;
  let joinFailed = false;
  PartyNet.onError = text => errors.push(text);
  PartyNet.onHostLost = (code, name) => { lost = `${code}/${name}`; };
  PartyNet.onJoinFailed = () => { joinFailed = true; };
  try {
    PartyNet.joinRoom('  host-peer-id \n', '小明');
    assert.equal(PartyNet.hostId, 'host-peer-id');
    FakePeer.last.emit('open', 'guest-a');
    const connection = FakePeer.last.connection;
    connection.emit('open');
    if (acknowledge) connection.emit('data', {
      type: 'HANDSHAKE_ACK',
      success: true,
      isHost: true,
      hostId: 'host-peer-id',
      clientVersion: ROOM_PREFIX,
      gameState: null,
      lobby: {
        code: 'host-peer-id', hostId: 'host-peer-id', status: 'waiting',
        players: [{peerId: 'host-peer-id', name: '房主', host: true}, {peerId: 'guest-a', name: '小明'}]
      }
    });
    run({connection, errors, lost: () => lost, joinFailed: () => joinFailed});
  } finally {
    PartyNet.leave(false);
    PartyNet.onError = null;
    PartyNet.onHostLost = null;
    PartyNet.onKicked = null;
    PartyNet.onJoinFailed = null;
    PartyNet.getGameState = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
}

test('客機離開時先通知房主，並定時送 ping', () => {
  withGuest(({connection}) => {
    assert.equal(connection.sent[0].type, 'HANDSHAKE_REQ');
    assert.equal(connection.sent[1].t, 'hello');
    PartyNet.beat();
    assert.equal(connection.sent.at(-1).t, 'ping');
    PartyNet.leave(false);
    assert.equal(connection.sent.at(-1).t, 'leave');
    assert.equal(PartyNet.active, false);
  });

  test('被踢客機收到 KICKED 後關閉 PeerJS 連線', () => {
    withGuest(({connection}) => {
      let message = '';
      PartyNet.onKicked = text => { message = text; };
      connection.emit('data', {t: 'kicked', text: '已移出', fromPeer: 'host-peer-id'});
      assert.equal(message, '已移出');
      assert.equal(PartyNet.active, false);
      assert.equal(connection.open, false);
      PartyNet.onKicked = null;
    });
  });
});

test('開始前和房主斷線：回到加入畫面並帶著代碼', () => {
  withGuest(({connection, errors, lost}) => {
    connection.emit('close');
    assert.equal(PartyNet.active, false);
    assert.equal(lost(), 'host-peer-id/小明');
    assert.deepEqual(errors, ['和房主的連線中斷了，請重新加入。']);
  });
});

test('房主關閉房間或拒絕加入時，客機離開房間並看到原因', () => {
  withGuest(({connection, errors, lost}) => {
    connection.emit('data', {t: 'closed'});
    assert.equal(PartyNet.active, false);
    assert.equal(lost(), null);
    assert.deepEqual(errors, ['房主已關閉房間。']);
  });
  withGuest(({connection, errors}) => {
    connection.emit('data', {t: 'refused', text: '對局已開始，暫時無法加入。'});
    assert.equal(PartyNet.active, false);
    assert.deepEqual(errors, ['對局已開始，暫時無法加入。']);
  });
});

test('5 碼房間代碼：不含 0／O／1／I，輸入時不分大小寫、可以有空白', () => {
  for (let i = 0; i < 200; i++) assert.match(makeRoomCode(), /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(makeRoomCode(() => 0), 'AAAAA');
  assert.equal(normalizeRoomCode(' k7m-2q '), 'K7M2Q');
  assert.equal(normalizeRoomCode('K7M2'), '');
  assert.equal(normalizeRoomCode('K0M2Q'), '');
  assert.equal(normalizeRoomCode('3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f'), '');
  assert.equal(roomPeerId('K7M2Q'), `${ROOM_PREFIX}K7M2Q`);
});

test('房主用「前綴 + 5 碼」登記，畫面只顯示 5 碼；代碼被用走時自動換一個', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  try {
    PartyNet.createRoom({name: '房主'});
    const first = FakePeer.last;
    assert.ok(first.id.startsWith(ROOM_PREFIX));
    first.emit('error', {type: 'unavailable-id', message: 'ID is taken'});
    const second = FakePeer.last;
    assert.notEqual(second, first);
    assert.ok(second.id.startsWith(ROOM_PREFIX));
    second.emit('open', second.id);
    const code = second.id.slice(ROOM_PREFIX.length);
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.equal(PartyNet.code, code);
    assert.equal(PartyNet.lobby.code, code);
    assert.equal(PartyNet.hostId, second.id);
  } finally {
    PartyNet.leave(false);
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('客機輸入 5 碼（大小寫都可以）就連到房主；找不到房間時回到加入畫面', () => {
  const previousPeer = globalThis.Peer;
  globalThis.Peer = FakePeer;
  const errors = [];
  let lost = null;
  PartyNet.onError = text => errors.push(text);
  PartyNet.onHostLost = (code, name) => { lost = `${code}/${name}`; };
  try {
    PartyNet.joinRoom(' k7m2q ', '小明');
    assert.equal(PartyNet.code, 'K7M2Q');
    const guestPeer = FakePeer.last;
    guestPeer.emit('open', 'guest-a');
    assert.equal(guestPeer.connectTarget, `${ROOM_PREFIX}K7M2Q`);
    guestPeer.emit('error', {type: 'peer-unavailable', message: 'Could not connect'});
    assert.equal(PartyNet.active, false);
    assert.equal(lost, null);
    assert.match(errors[0], /加入失敗：無法連線至房主或房間不存在/);
    assert.throws(() => PartyNet.joinRoom('  ', '小明'), /5 碼房間代碼/);
  } finally {
    PartyNet.leave(false);
    PartyNet.onError = null;
    PartyNet.onHostLost = null;
    if (previousPeer === undefined) delete globalThis.Peer;
    else globalThis.Peer = previousPeer;
  }
});

test('企業不能重複：別人選走的企業會被房主拒絕，未定新創集團可以多人選', () => {
  withHost(({join, errors}) => {
    const a = join('guest-a', '小明');
    const b = join('guest-b', '阿華');
    a.emit('data', {t: 'role', roleId: 'bank'});
    assert.equal(PartyNet.lobby.players[1].roleId, 'bank');
    b.emit('data', {t: 'role', roleId: 'bank'});
    assert.equal(PartyNet.lobby.players[2].roleId, 'random');
    const sentToB = b.sent.slice(-2);
    assert.equal(sentToB[0].t, 'error');
    assert.match(sentToB[0].text, /已經被「小明」選走/);
    assert.equal(sentToB[1].t, 'lobby');
    assert.throws(() => PartyNet.selectRole('bank'), /已經被「小明」選走/);
    assert.equal(PartyNet.assignRole('guest-b', 'bank'), '這家企業已經被「小明」選走了，請選別家。');
    PartyNet.selectRole('random');
    b.emit('data', {t: 'role', roleId: 'random'});
    assert.deepEqual(PartyNet.lobby.players.map(p => p.roleId), ['random', 'bank', 'random']);
    a.emit('data', {t: 'role', roleId: 'cloud'});
    b.emit('data', {t: 'role', roleId: 'bank'});
    assert.deepEqual(PartyNet.lobby.players.map(p => p.roleId), ['random', 'cloud', 'bank']);
    assert.deepEqual(errors, []);
  });
});

test('對局開始後不能換企業', () => {
  withHost(({join}) => {
    const a = join('guest-a', '小明');
    PartyNet.startGame();
    a.emit('data', {t: 'role', roleId: 'bank'});
    assert.equal(PartyNet.lobby.players[1].roleId, 'random');
    assert.match(a.sent.findLast(m => m.t === 'error').text, /對局已開始/);
  });
});
