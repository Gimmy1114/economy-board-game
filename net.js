// 多人房間 / PeerJS P2P 連線層

import { PLAYER_COLORS } from './party_data.js';

// ---- 5 碼房間代碼 ----------------------------------------------------------
// 房主用「前綴 + 5 碼」向 PeerJS 配對伺服器登記，畫面上只顯示 5 碼（去掉容易看錯的 0/O/1/I）。
// 改了房間訊息或對局格式時，把前綴的版本號往上加，新舊版本就進不了同一個房間。
export const ROOM_PREFIX = 'econparty-v6-';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode(random = Math.random) {
  let code = '';
  for (let i = 0; i < 5; i++) code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  return code;
}
// 使用者輸入的代碼：去掉空白和連字號、轉大寫；不是 5 碼時回傳空字串。
export function normalizeRoomCode(input) {
  const code = String(input ?? '').replace(/[\s-]/g, '').toUpperCase();
  return code.length === 5 && [...code].every(c => ROOM_ALPHABET.includes(c)) ? code : '';
}
export const roomPeerId = code => ROOM_PREFIX + code;

export const PartyNet = (() => {
  const rid = () => (globalThis.crypto?.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  // 客機每 3 秒送一次 ping；房主 12 秒沒收到任何訊息就把該玩家標成「已離線」（手機鎖螢幕或直接關頁時 PeerJS 常常不會發出 close）。
  const PING_MS = 3000;
  const OFFLINE_MS = 12000;
  const OFFLINE_KICK_MS = 180000;
  const HANDSHAKE_TIMEOUT_MS = 12000;
  const CLIENT_VERSION = ROOM_PREFIX;
  const MAX_PLAYERS = 8;
  const createPeerOptions = () => ({
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' }
      ],
      sdpSemantics: 'unified-plan',
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10
    },
    debug: 1
  });
  const cleanName = (name, fallback) => String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || fallback;
  const isOnline = p => p.host || p.connected !== false;
  // 預設棋子顏色：優先挑還沒有人使用的索引，顏色在同一局內不重複。
  const freeColor = players => {
    const used = new Set((players || []).map(p => Number(p.color)).filter(Number.isInteger));
    for (let i = 0; i < PLAYER_COLORS.length; i++) if (!used.has(i)) return i;
    return (players?.length || 0) % PLAYER_COLORS.length;
  };

  class Net {
    constructor() {
      this.code = '';
      this.peerId = '';
      this.hostId = '';
      this.host = false;
      this.name = '';
      this.lobby = null;
      this.active = false;
      this.connectedPeers = new Set();
      this.peers = new Map();
      this.verifiedPeers = new Set();
      this.pendingHandshakes = new Map();
      this.seen = new Set();
      this.lastSeen = new Map();
      this.offlineSince = new Map();
      this.autoKickPending = new Set();
      this.blacklist = new Set();
      this.playerIds = new Map();
      this._reconnect = null;
      this._peer = null;
      this._beat = null;
      this._connectTimeout = null;
      this._handshakeTimeout = null;
      this._lastBeat = 0;
      this._lastHostSeen = 0;
      this.onLobby = null;
      this.onStart = null;
      this.onState = null;
      this.onAction = null;
      this.onEvent = null;
      this.onReturnLobby = null;
      this.onStatus = null;
      this.onError = null;
      this.onHostLost = null;
      this.onAutoKick = null;
      this.onKicked = null;
      this.onJoinFailed = null;
      this.onJoinReady = null;
      this.getGameState = null;
    }

    get isHost() { return this.host; }
    get isClient() { return this.active && !this.host; }
    get myIndex() { return this.lobby?.players?.findIndex(p => p.peerId === this.peerId) ?? -1; }
    get myPlayerId() { return this.playerIds.get(this.peerId) || (this.myIndex >= 0 ? `player-${this.myIndex + 1}` : null); }
    get myPlayer() { return this.lobby?.players?.[this.myIndex] || null; }

    status(text) { try { this.onStatus?.(text); } catch { } }
    error(text) { try { this.onError?.(text); } catch { } }

    createRoom({ name, roleId = 'random' } = {}) {
      this.leave(false);
      const PeerConstructor = globalThis.Peer;
      if (typeof PeerConstructor !== 'function') throw Error('PeerJS 尚未載入，請確認網路連線後重新整理。');
      this.host = true;
      this.active = true;
      this.name = cleanName(name, '房主');
      this.lobby = {
        code: '', hostId: '', status: 'waiting', mode: 'star', rounds: 10, target: 0,
        starGoal: 3, doomEvery: 5, doomPrice: 1000, doomStep: 500, debug: false,
        confirms: [], createdAt: Date.now(),
        players: []
      };
      this.openHostPeer(PeerConstructor, roleId, 0);
      this.emitLobby();
      this.status('正在建立 PeerJS 房間…');
      return this.lobby;
    }

    // 用新的 5 碼登記；代碼剛好被別的房間用走（unavailable-id）就換一個再試。
    openHostPeer(PeerConstructor, roleId, attempt) {
      const code = makeRoomCode();
      const peerId = roomPeerId(code);
      console.log('[PeerJS] 建立房主 Peer', { peerId, attempt });
      const peer = new PeerConstructor(peerId, createPeerOptions());
      this._peer = peer;
      let opened = false;
      peer.on('open', peerId => {
        if (!this.active || this._peer !== peer) return;
        opened = true;
        console.log('[PeerJS] 房主 Peer 已開啟', peerId);
        this.peerId = peerId;
        this.hostId = peerId;
        this.code = code;
        this.lobby.code = code;
        this.lobby.hostId = peerId;
        this.lobby.players = [{ peerId, name: this.name, roleId, color: 0, host: true, connected: true }];
        this.emitLobby();
        this.broadcastLobby();
        this.startBeat();
        this.status(`房間 ${this.code} 已建立，等待玩家加入。`);
      });
      peer.on('connection', conn => {
        console.log('[PeerJS] 房主收到 DataConnection', conn?.peer);
        this.wireConnection(conn);
      });
      peer.on('error', error => {
        if (this._peer !== peer) return;
        console.error('[PeerJS 錯誤]', error?.type, error);
        if (error?.type === 'unavailable-id' && !opened && attempt < 5) {
          try { peer.destroy(); } catch { }
          this.openHostPeer(PeerConstructor, roleId, attempt + 1);
          return;
        }
        this.error(error?.message || 'PeerJS 連線錯誤');
      });
      peer.on('disconnected', () => console.warn('[PeerJS] 房主 Peer 與訊號伺服器中斷'));
      peer.on('close', () => console.log('[PeerJS] 房主 Peer 已關閉', peerId));
    }

    joinRoom(code, name) {
      this.leave(false);
      // 5 碼代碼轉成房主登記的 ID；不是 5 碼時當成完整的 Peer ID（舊的連結）。
      const shortCode = normalizeRoomCode(code);
      const input = String(code ?? '').trim();
      this.code = shortCode || input;
      if (!this.code || this.code.length > 128) throw Error('請輸入 5 碼房間代碼。');
      const PeerConstructor = globalThis.Peer;
      if (typeof PeerConstructor !== 'function') throw Error('PeerJS 尚未載入，請確認網路連線後重新整理。');
      this.host = false;
      this.hostId = shortCode ? roomPeerId(shortCode) : this.code;
      this.active = true;
      this.name = cleanName(name, '玩家');
      this.lobby = {
        code: this.code, hostId: this.hostId, status: 'waiting', mode: 'star', rounds: 10, target: 0,
        starGoal: 3, doomEvery: 5, doomPrice: 1000, doomStep: 500, debug: false,
        confirms: [], players: [{ peerId: this.peerId, name: this.name, roleId: 'random', color: 0, connected: true }]
      };
      this._connectTimeout = setTimeout(() => {
        this._connectTimeout = null;
        if (!this.active || this.host || this.verifiedPeers.has(this.hostId)) return;
        console.error('[PeerJS] 客機連線／握手逾時，關閉連線', { hostId: this.hostId });
        this.failJoin(this.peers.get(this.hostId)?.conn);
      }, HANDSHAKE_TIMEOUT_MS);
      this._connectTimeout?.unref?.();
      console.log('[PeerJS] 建立客機 Peer', { hostId: this.hostId });
      const peer = new PeerConstructor(undefined, createPeerOptions());
      this._peer = peer;
      peer.on('open', peerId => {
        if (!this.active || this._peer !== peer) return;
        const reconnecting = Boolean(this.peerId);
        this.peerId = peerId;
        if (reconnecting && this.lobby?.status === 'playing') {
          this.connectToHost();
          return;
        }
        this.lobby.players[0].peerId = peerId;
        console.log('[PeerJS] 客機 Peer 已開啟', { peerId, hostId: this.hostId });
        const conn = peer.connect(this.hostId, { reliable: true, serialization: 'json' });
        this.wireConnection(conn);
        console.log('[PeerJS] 客機發起 DataConnection', this.hostId);
      });
      peer.on('error', error => {
        if (this._peer !== peer) return;
        console.error('[PeerJS 錯誤]', error?.type, error);
        if (this.lobby?.status !== 'playing') {
          this.failJoin(this.peers.get(this.hostId)?.conn);
          return;
        }
        if (this.lobby?.status === 'playing') {
          this.hostGone();
          return;
        }
        this.error(error?.message || 'PeerJS 連線錯誤');
      });
      peer.on('disconnected', () => {
        if (!this.active || this.host) return;
        console.warn('[PeerJS] 客機 Peer 與訊號伺服器中斷');
        if (this.lobby?.status === 'playing') this.hostGone();
        else this.failJoin(this.peers.get(this.hostId)?.conn);
      });
      peer.on('close', () => console.log('[PeerJS] 客機 Peer 已關閉', this.peerId));
      this.status(`正在加入房間 ${this.code}…`);
      return this.lobby;
    }

    leave(notify = true) {
      // 先告訴對方：客機離開大廳，或房主關閉房間（直接斷線時對方可能很久才發現）。
      if (this.active) this.sendData({ t: this.host ? 'closed' : 'leave' }, this.host ? 'all' : this.hostId);
      this.active = false;
      clearInterval(this._beat);
      this._beat = null;
      for (const rec of this.peers.values()) {
        this.clearIceConnectionWatch(rec);
        try { rec.conn?.close(); } catch { }
      }
      try { this._peer?.destroy(); } catch { }
      this.peers.clear();
      this.verifiedPeers.clear();
      for (const pending of this.pendingHandshakes.values()) clearTimeout(pending.timer);
      this.pendingHandshakes.clear();
      this.connectedPeers.clear();
      this.lastSeen.clear();
      this.offlineSince.clear();
      this.autoKickPending.clear();
      this.blacklist.clear();
      this.playerIds.clear();
      clearTimeout(this._reconnect);
      this._reconnect = null;
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
      this._peer = null;
      this.host = false;
      this.code = '';
      this.hostId = '';
      this.lobby = null;
      this.seen.clear();
      if (notify) this.emitLobby();
    }

    wireConnection(conn) {
      if (!conn?.peer) return;
      const peerId = conn.peer;
      const record = {
        conn, icePoll: null, icePollTimeout: null, iceDispose: null, iceFailureHandled: false
      };
      this.peers.set(peerId, record);
      const current = () => this.active && this.peers.get(peerId)?.conn === conn;
      this.watchIceConnection(conn, peerId);
      if (this.host) console.log('[PeerJS 房主] 掛載 conn 數據監聽器', conn.peer);

      // Bind data before open so an immediate handshake packet cannot arrive unobserved.
      conn.on('data', data => {
        if (!current()) return;
        if (this.host) console.log('[PeerJS 房主] 收到客機數據:', data);
        let message = data;
        if (typeof message === 'string') {
          try { message = JSON.parse(message); }
          catch { return; }
        }
        if (!this.host || this.verifiedPeers.has(peerId)) this.heard(peerId);
        if (message?.type === 'HANDSHAKE_REQ' || message?.type === 'HANDSHAKE_ACK'
          || message?.type === 'HANDSHAKE_REJECT') {
          console.log('[PeerJS] 握手封包', { direction: this.host ? '收到' : '接收', peerId, type: message.type });
        }
        if (this.host && message?.type === 'HANDSHAKE_REQ') {
          console.log('[PeerJS] 房主收到 HANDSHAKE_REQ', { peerId });
        } else if (!this.host && message?.type === 'HANDSHAKE_ACK') {
          console.log('[PeerJS] 客機收到 HANDSHAKE_ACK', { peerId, success: message.success });
        }
        this.handleData(message, peerId);
      });
      conn.on('open', () => {
        if (!current()) return;
        this.watchIceConnection(conn, peerId);
        console.log('[PeerJS] DataConnection 已開啟', { peerId, isHost: this.host });
        if (this.host && this.blacklist.has(peerId)) {
          try { conn.send({ t: 'kicked', text: '你已被房主移出房間，無法重新加入。' }); }
          catch (error) { this.error(error?.message || '無法傳送踢除通知。'); }
          this.clearIceConnectionWatch(this.peers.get(peerId));
          this.peers.delete(peerId);
          this.connectedPeers.delete(peerId);
          this.lastSeen.delete(peerId);
          conn.close();
          return;
        }
        clearTimeout(this._reconnect);
        this._reconnect = null;
        if (this.host) {
          console.log('[PeerJS 房主] DataChannel 通道 open 成功！');
          this.sendProactiveHandshakeAck(conn, peerId);
          return;
        }
        if (peerId !== this.hostId) {
          this.failJoin(conn);
          return;
        }
        console.log('[PeerJS 客機] DataChannel 通道 open 成功！');
        this.requestHandshake(conn);
      });
      conn.on('close', () => {
        if (!current()) return;
        console.log('[PeerJS] DataConnection 已關閉', { peerId, isHost: this.host });
        this.clearIceConnectionWatch(record);
        const wasVerified = this.verifiedPeers.has(peerId);
        this.clearPendingHandshake(peerId);
        this.verifiedPeers.delete(peerId);
        this.connectedPeers.delete(peerId);
        this.peers.delete(peerId);
        this.lastSeen.delete(peerId);
        if (this.host) {
          if (wasVerified) this.playerGone(peerId);
        } else if (peerId === this.hostId) {
          clearTimeout(this._handshakeTimeout);
          this._handshakeTimeout = null;
          if (record.iceFailureHandled) return;
          if (!wasVerified && this.lobby?.status !== 'playing') this.failJoin(conn);
          else this.hostGone();
        }
      });
      conn.on('error', error => {
        if (!current()) return;
        console.error('[PeerJS Connection 錯誤]', error?.type, peerId, error);
        if (!this.host && peerId === this.hostId && !this.verifiedPeers.has(peerId)
          && this.lobby?.status !== 'playing') {
          this.failJoin(conn);
          return;
        }
        this.error(error?.message || 'PeerJS 資料連線錯誤');
        if (!this.host && peerId === this.hostId && this.lobby?.status === 'playing') {
          try { conn.close(); } catch { }
          this.hostGone();
        }
      });
    }

    watchIceConnection(conn, peerId) {
      const record = this.peers.get(peerId);
      if (!record || record.conn !== conn || record.iceDispose) return;

      const attach = () => {
        if (this.peers.get(peerId) !== record) {
          this.clearIceConnectionWatch(record);
          return true;
        }
        const peerConnection = conn.peerConnection;
        if (!peerConnection) return false;

        clearInterval(record.icePoll);
        record.icePoll = null;
        clearTimeout(record.icePollTimeout);
        record.icePollTimeout = null;
        const onIceStateChange = () => {
          const state = peerConnection.iceConnectionState;
          console.log('[WebRTC ICE 狀態]', state);
          if (state === 'connected' || state === 'completed') {
            console.log('[WebRTC] ICE 網路穿透成功！');
          }
          if (state === 'failed' || state === 'disconnected') {
            this.handleIceFailure(conn, peerId, state);
          }
        };
        const previousHandler = peerConnection.oniceconnectionstatechange;
        const handler = event => {
          if (typeof previousHandler === 'function') previousHandler.call(peerConnection, event);
          onIceStateChange();
        };
        peerConnection.oniceconnectionstatechange = handler;
        record.iceDispose = () => {
          if (peerConnection.oniceconnectionstatechange === handler) {
            peerConnection.oniceconnectionstatechange = previousHandler || null;
          }
        };
        onIceStateChange();
        return true;
      };

      if (attach()) return;
      record.icePoll = setInterval(attach, 100);
      record.icePollTimeout = setTimeout(() => this.clearIceConnectionWatch(record), HANDSHAKE_TIMEOUT_MS);
      record.icePoll?.unref?.();
    }

    clearIceConnectionWatch(record) {
      if (!record) return;
      clearInterval(record.icePoll);
      record.icePoll = null;
      clearTimeout(record.icePollTimeout);
      record.icePollTimeout = null;
      record.iceDispose?.();
      record.iceDispose = null;
    }

    handleIceFailure(conn, peerId, state) {
      const record = this.peers.get(peerId);
      if (!record || record.conn !== conn || record.iceFailureHandled) return;
      record.iceFailureHandled = true;
      const message = '【P2P 網路連線建立失敗，請重新整理網頁後再試】';
      console.error('[WebRTC ICE 連線失敗]', { peerId, state });
      this.clearIceConnectionWatch(record);

      if (!this.host && this.lobby?.status !== 'playing') {
        this.failJoin(conn, message);
        return;
      }

      if (this.host) this.error(message);
      try { conn.close(); }
      catch (error) { console.error('[WebRTC] 關閉失敗的 DataConnection 時發生錯誤', error); }
      if (!this.host && this.lobby?.status === 'playing') this.hostGone(message);
    }

    sendProactiveHandshakeAck(conn, peerId) {
      if (!this.host || !this.active || !conn?.open || this.blacklist.has(peerId)) return;
      const current = this.peers.get(peerId);
      if (!current || current.conn !== conn || current.proactiveAckSent) return;

      const existing = this.lobby?.players.find(player => player.peerId === peerId);
      const gameState = this.getGameState?.() || null;
      const ended = this.lobby?.status === 'ended' || this.lobby?.status === 'finished'
        || (this.lobby?.status === 'playing' && gameState?.status !== 'playing');
      const roomOpen = this.lobby?.status === 'waiting'
        || (this.lobby?.status === 'playing' && Boolean(existing) && !ended);
      const pendingNewPlayers = [...this.pendingHandshakes.keys()]
        .filter(id => id !== peerId && !this.lobby?.players.some(player => player.peerId === id)).length;
      const hasCapacity = Boolean(existing)
        || (this.lobby?.players.length + pendingNewPlayers < MAX_PLAYERS);

      if (!roomOpen || !hasCapacity) {
        this.respondHandshake(conn, {
          type: 'HANDSHAKE_REJECT',
          isHost: true,
          hostId: this.peerId,
          reason: '房間不存在、已滿或對局已結束。'
        });
        return;
      }

      const ack = {
        type: 'HANDSHAKE_ACK',
        success: true,
        isHost: true,
        hostId: this.peerId,
        clientVersion: CLIENT_VERSION,
        gameState,
        advancedSettings: gameState?.advancedSettings || null,
        lobby: this.lobby
      };
      if (!this.respondHandshake(conn, ack)) return;
      current.proactiveAckSent = true;
      console.log('[PeerJS 房主] 已回傳 HANDSHAKE_ACK 給客機:', conn.peer);

      if (!this.pendingHandshakes.has(peerId)) {
        const pending = { conn, timer: null };
        pending.timer = setTimeout(() => {
          if (this.pendingHandshakes.get(peerId) !== pending) return;
          this.pendingHandshakes.delete(peerId);
          this.verifiedPeers.delete(peerId);
          this.connectedPeers.delete(peerId);
          this.peers.delete(peerId);
          conn.close();
        }, HANDSHAKE_TIMEOUT_MS);
        pending.timer?.unref?.();
        this.pendingHandshakes.set(peerId, pending);
      }
    }

    requestHandshake(conn) {
      if (!this.active || this.host || !conn?.open) return;
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
      if (!this._connectTimeout) {
        this._handshakeTimeout = setTimeout(() => {
          this._handshakeTimeout = null;
          if (!this.active || this.verifiedPeers.has(this.hostId)) return;
          console.error('[PeerJS] 客機重新握手逾時，關閉連線', { hostId: this.hostId });
          if (this.lobby?.status === 'playing') {
            try { conn.close(); } catch { }
            this.hostGone();
            return;
          }
          this.failJoin(conn);
        }, HANDSHAKE_TIMEOUT_MS);
        this._handshakeTimeout?.unref?.();
      }
      try {
        conn.send({ type: 'HANDSHAKE_REQ', clientVersion: CLIENT_VERSION, name: this.name });
        console.log('[PeerJS] 已送出 HANDSHAKE_REQ', { hostId: this.hostId, clientVersion: CLIENT_VERSION });
      } catch {
        this.failJoin(conn);
      }
    }

    clearPendingHandshake(peerId) {
      const pending = this.pendingHandshakes.get(peerId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingHandshakes.delete(peerId);
    }

    respondHandshake(conn, response) {
      try {
        conn.send(response);
        return true;
      } catch (error) {
        this.error(error?.message || '無法完成房主握手。');
        return false;
      }
    }

    acceptHandshake(message, peerId) {
      const conn = this.peers.get(peerId)?.conn;
      if (!this.host || !conn?.open) return;
      const existing = this.lobby?.players.find(player => player.peerId === peerId);
      const gameState = this.getGameState?.() || null;
      const ended = this.lobby?.status === 'ended' || this.lobby?.status === 'finished'
        || (this.lobby?.status === 'playing' && gameState?.status !== 'playing');
      const roomOpen = this.lobby?.status === 'waiting'
        || (this.lobby?.status === 'playing' && Boolean(existing) && !ended);
      const pendingNewPlayers = [...this.pendingHandshakes.keys()]
        .filter(id => id !== peerId && !this.lobby?.players.some(player => player.peerId === id)).length;
      const hasCapacity = Boolean(existing)
        || (this.lobby?.players.length + pendingNewPlayers < MAX_PLAYERS);

      if (message.clientVersion !== CLIENT_VERSION || !roomOpen || !hasCapacity) {
        this.respondHandshake(conn, {
          type: 'HANDSHAKE_REJECT',
          isHost: true,
          hostId: this.peerId,
          reason: message.clientVersion !== CLIENT_VERSION ? '版本不相容。' : '房間不存在、已滿或對局已結束。'
        });
        setTimeout(() => {
          if (this.peers.get(peerId)?.conn !== conn) return;
          this.peers.delete(peerId);
          this.connectedPeers.delete(peerId);
          conn.close();
        }, 100)?.unref?.();
        return;
      }

      this.clearPendingHandshake(peerId);
      const peerConnection = this.peers.get(peerId);
      if (!peerConnection?.proactiveAckSent) {
        const ack = {
          type: 'HANDSHAKE_ACK',
          success: true,
          isHost: true,
          hostId: this.peerId,
          clientVersion: CLIENT_VERSION,
          gameState,
          advancedSettings: gameState?.advancedSettings || null,
          lobby: this.lobby
        };
        if (!this.respondHandshake(conn, ack)) return;
        console.log('[PeerJS 房主] 已回傳 HANDSHAKE_ACK 給客機:', conn.peer);
      }

      this.verifiedPeers.add(peerId);
      this.connectedPeers.add(peerId);
      this.lastSeen.set(peerId, Date.now());
      this.offlineSince.delete(peerId);
      this.autoKickPending.delete(peerId);
      if (!existing) {
        this.addPlayer(peerId, cleanName(message.name, '玩家'));
      }
      const player = this.lobby?.players.find(entry => entry.peerId === peerId);
      if (player) {
        player.connected = true;
        player.offlineSince = null;
      }
      this.broadcastLobby();
      console.log('[PeerJS] 雙向握手完成，進入對局大廳');
      this.status(`${peerId} 已完成房主握手。`);
    }

    completeHandshake(message, peerId) {
      if (this.host || peerId !== this.hostId) {
        if (!this.host && this.lobby?.status !== 'playing') this.failJoin(this.peers.get(peerId)?.conn);
        return;
      }
      const lobby = message.lobby;
      const validLobby = lobby && ['waiting', 'playing'].includes(lobby.status)
        && lobby.hostId === this.hostId
        && Array.isArray(lobby.players)
        && lobby.players.some(player => player.peerId === this.hostId);
      const validGameState = lobby?.status !== 'playing'
        || (message.gameState && message.gameState.status === 'playing'
          && JSON.stringify(message.advancedSettings || null) === JSON.stringify(message.gameState.advancedSettings || null));
      if (message.type !== 'HANDSHAKE_ACK' || message.success !== true || message.isHost !== true
        || message.hostId !== this.hostId || message.clientVersion !== CLIENT_VERSION
        || !Object.prototype.hasOwnProperty.call(message, 'gameState')
        || !validLobby || !validGameState) {
        if (this.lobby?.status !== 'playing') this.failJoin(this.peers.get(peerId)?.conn);
        else {
          try { this.peers.get(peerId)?.conn?.close(); } catch { }
          this.hostGone();
        }
        return;
      }
      const alreadyVerified = this.verifiedPeers.has(peerId);
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
      this.verifiedPeers.add(peerId);
      this.connectedPeers.add(peerId);
      this.lastSeen.set(peerId, Date.now());
      this.lobby = message.lobby;
      this.code = message.lobby.code || this.code;
      this._lastHostSeen = Date.now();
      if (!alreadyVerified) {
        try { this.onJoinReady?.(this.lobby); } catch (error) { console.error(error); }
        this.emitLobby();
        if (message.gameState) {
          if (message.advancedSettings && !message.gameState.advancedSettings) message.gameState.advancedSettings = message.advancedSettings;
          this.onState?.(message.gameState, peerId);
        }
        this.sendData({ t: 'hello', name: this.name, clientVersion: CLIENT_VERSION }, peerId);
        this.startBeat();
        console.log('[PeerJS] 雙向握手完成，進入對局大廳');
      }
      console.log('[PeerJS] 客機收到有效 HANDSHAKE_ACK，房間狀態正常', { hostId: peerId, roomCode: this.code });
      this.status('已驗證房主並完成 PeerJS 連線。');
    }

    failJoin(conn, reason = '加入失敗：無法連線至房主或房間不存在') {
      if (!this.active || this.host || this.lobby?.status === 'playing') return;
      const code = this.code;
      const name = this.name;
      const peerId = conn?.peer || this.hostId;
      clearTimeout(this._connectTimeout);
      this._connectTimeout = null;
      clearTimeout(this._handshakeTimeout);
      this._handshakeTimeout = null;
      this.clearPendingHandshake(peerId);
      this.clearIceConnectionWatch(this.peers.get(peerId));
      this.peers.delete(peerId);
      this.verifiedPeers.delete(peerId);
      this.connectedPeers.delete(peerId);
      try { conn?.close(); } catch { }
      this.leave(false);
      this.error(reason);
      this.onJoinFailed?.(code, name);
    }

    addPlayer(peerId, name) {
      if (!this.host || !this.lobby) return;
      let player = this.lobby.players.find(p => p.peerId === peerId);
      if (!player) {
        if (this.lobby.status !== 'waiting') { this.refuse(peerId, '對局已開始，暫時無法加入。'); return; }
        if (this.lobby.players.length >= MAX_PLAYERS) { this.refuse(peerId, `房間已滿（最多 ${MAX_PLAYERS} 人）。`); return; }
        player = { peerId, name: this.uniqueName(cleanName(name, '玩家'), peerId), roleId: 'random', color: freeColor(this.lobby.players), host: false, connected: true };
        this.lobby.players.push(player);
      } else if (name) player.name = this.uniqueName(cleanName(name, player.name), peerId);
      this.emitLobby();
    }

    // 名字重複時加上編號（開局時名字不能重複）。
    uniqueName(name, peerId) {
      const taken = new Set((this.lobby?.players || []).filter(p => p.peerId !== peerId).map(p => p.name));
      if (!taken.has(name)) return name;
      for (let n = 2; ; n++) {
        const next = `${name.slice(0, 13)} ${n}`;
        if (!taken.has(next)) return next;
      }
    }

    // 房主拒絕加入：通知對方後不再廣播給他，對方收到後會自己斷線。
    refuse(peerId, text) {
      this.clearPendingHandshake(peerId);
      this.verifiedPeers.delete(peerId);
      this.sendData({ t: 'refused', text }, peerId);
      const rec = this.peers.get(peerId);
      this.peers.delete(peerId);
      this.connectedPeers.delete(peerId);
      this.lastSeen.delete(peerId);
      setTimeout(() => { try { rec?.conn?.close(); } catch { } }, 1000)?.unref?.();
    }

    // 房主：玩家離開或斷線。開始前直接移出大廳；對局中只標成已離線（座位還在）。
    playerGone(peerId) {
      const player = this.lobby?.players.find(p => p.peerId === peerId);
      if (!player || player.host) return;
      if (this.lobby.status === 'waiting') this.dropPlayer(peerId);
      else {
        player.connected = false;
        if (!this.offlineSince.has(peerId)) this.offlineSince.set(peerId, Date.now());
        player.offlineSince = this.offlineSince.get(peerId);
      }
      this.broadcastLobby();
      this.recheckConfirms();
    }

    dropPlayer(peerId, closeDelay = 0) {
      const rec = this.peers.get(peerId);
      this.clearIceConnectionWatch(rec);
      this.clearPendingHandshake(peerId);
      this.verifiedPeers.delete(peerId);
      this.peers.delete(peerId);
      this.connectedPeers.delete(peerId);
      this.lastSeen.delete(peerId);
      this.offlineSince.delete(peerId);
      this.autoKickPending.delete(peerId);
      if (this.lobby) this.lobby.players = this.lobby.players.filter(p => p.host || p.peerId !== peerId);
      const close = () => { try { rec?.conn?.close(); } catch { } };
      if (closeDelay) setTimeout(close, closeDelay)?.unref?.();
      else close();
    }

    // 客機：和房主的連線沒了。開始前回到加入畫面（帶著代碼）；對局中只提示。
    hostGone(reason = '') {
      if (this.lobby?.status === 'playing') {
        this.error(reason || '和房主的連線中斷，正在嘗試重新連線…');
        if (this._peer?.disconnected) {
          try { this._peer.reconnect(); }
          catch (error) { this.error(error?.message || 'PeerJS 訊號連線恢復失敗。'); }
        }
        this.scheduleHostReconnect();
        return;
      }
      const code = this.code, name = this.name;
      this.leave();
      this.error(reason || '和房主的連線中斷了，請重新加入。');
      this.onHostLost?.(code, name);
    }

    heard(peerId) {
      this.lastSeen.set(peerId, Date.now());
      if (!this.host) {
        if (peerId === this.hostId) this._lastHostSeen = Date.now();
        return;
      }
      const player = this.lobby?.players.find(p => p.peerId === peerId);
      if (player && player.connected === false) {
        player.connected = true;
        player.offlineSince = null;
        this.offlineSince.delete(peerId);
        this.broadcastLobby();
      }
    }

    scheduleHostReconnect() {
      if (!this.active || this.host || this._reconnect || !this._peer) return;
      this._reconnect = setTimeout(() => {
        this._reconnect = null;
        if (!this.active || this.host || this.peers.get(this.hostId)?.conn?.open) return;
        try {
          if (this._peer.disconnected) {
            this._peer.reconnect();
            return;
          }
          this.connectToHost();
        } catch (error) {
          this.error(error?.message || '重新連線失敗，稍後會再試。');
          this.scheduleHostReconnect();
        }
      }, PING_MS);
      this._reconnect?.unref?.();
    }

    connectToHost() {
      if (!this.active || this.host || !this._peer || this.peers.get(this.hostId)?.conn?.open) return;
      console.log('[PeerJS] 重新連線至房主', this.hostId);
      const conn = this._peer.connect(this.hostId, { reliable: true, serialization: 'json' });
      this.wireConnection(conn);
      clearTimeout(this._connectTimeout);
      this._connectTimeout = setTimeout(() => {
        this._connectTimeout = null;
        if (!this.active || this.host || conn.open) return;
        try { conn.close(); } catch { }
        this.scheduleHostReconnect();
      }, OFFLINE_MS);
      this._connectTimeout?.unref?.();
    }

    startBeat() {
      clearInterval(this._beat);
      this._lastBeat = Date.now();
      this._beat = setInterval(() => this.beat(), PING_MS);
      this._beat?.unref?.();
    }

    beat(now = Date.now()) {
      if (!this.active) return;
      const paused = now - this._lastBeat > PING_MS * 3;
      this._lastBeat = now;
      if (!this.host) {
        const connection = this.peers.get(this.hostId)?.conn;
        if (this.lobby?.status === 'playing' && connection?.open && now - this._lastHostSeen > OFFLINE_MS) {
          connection.close();
          this.hostGone();
          return;
        }
        this.sendData({ t: 'ping' }, this.hostId);
        return;
      }
      // 房主頁面剛從背景回來時計時器停過，先不判斷，等下一輪。
      if (paused) return;
      let changed = false;
      for (const p of this.lobby?.players || []) {
        if (!isOnline(p)) continue;
        if (now - (this.lastSeen.get(p.peerId) ?? now) > OFFLINE_MS) {
          p.connected = false;
          if (!this.offlineSince.has(p.peerId)) {
            this.offlineSince.set(p.peerId, now);
            p.offlineSince = now;
          }
          changed = true;
        }
      }
      if (changed) { this.broadcastLobby(); this.recheckConfirms(); }
      for (const [peerId, disconnectedAt] of this.offlineSince) {
        if (now - disconnectedAt < OFFLINE_KICK_MS || this.autoKickPending.has(peerId)) continue;
        this.autoKickPending.add(peerId);
        if (this.onAutoKick) this.onAutoKick(peerId);
        else this.kickPlayer(peerId, '連線逾時，已由房主移出對局。');
      }
    }

    setMode(mode) {
      if (!this.host || !this.lobby) return;
      this.lobby.mode = mode;
      this.broadcastLobby();
    }
    setRounds(rounds) { if (!this.host || !this.lobby) return; this.lobby.rounds = Math.min(30, Math.max(3, Math.round(Number(rounds)) || 10)); this.broadcastLobby(); }
    setDebug(debug) { if (!this.host || !this.lobby) return; this.lobby.debug = Boolean(debug); this.broadcastLobby(); }
    setTarget(target) { if (!this.host || !this.lobby) return; this.lobby.target = Number(target) || 0; this.broadcastLobby(); }
    setStarGoal(goal) { if (!this.host || !this.lobby) return; this.lobby.starGoal = Math.max(1, Number(goal) || 3); this.broadcastLobby(); }
    setDoomEvery(every) { if (!this.host || !this.lobby) return; this.lobby.doomEvery = Math.max(1, Number(every) || 5); this.broadcastLobby(); }
    setDoomPrice(price) { if (!this.host || !this.lobby) return; this.lobby.doomPrice = Math.max(100, Number(price) || 1000); this.broadcastLobby(); }
    setDoomStep(step) { if (!this.host || !this.lobby) return; this.lobby.doomStep = Math.max(100, Number(step) || 500); this.broadcastLobby(); }

    selectRole(roleId) {
      if (!this.active) return;
      if (this.host) {
        const error = this.assignRole(this.peerId, roleId);
        if (error) throw Error(error);
      } else if (this.hostId) {
        this.sendData({ t: 'role', roleId }, this.hostId);
      }
    }

    // 房主分配企業：同一家只能一個人選（未定新創集團可以多人）。回傳錯誤訊息，成功時回傳 null。
    assignRole(peerId, roleId) {
      if (!this.host || !this.lobby) return '只有房主可以分配企業。';
      if (this.lobby.status !== 'waiting') return '對局已開始，不能換企業。';
      const player = this.lobby.players.find(p => p.peerId === peerId);
      if (!player || typeof roleId !== 'string' || !roleId || roleId.length > 40) return '找不到這位玩家或企業。';
      const taker = roleId !== 'random' && this.lobby.players.find(p => p.peerId !== peerId && p.roleId === roleId);
      if (taker) return `這家企業已經被「${taker.name}」選走了，請選別家。`;
      player.roleId = roleId;
      this.broadcastLobby();
      return null;
    }

    // 更改自己的棋子顏色。房主直接處理；客機只送出「自己的」顏色，由房主驗證後廣播。
    setColor(color) {
      if (!this.active || !this.lobby) return false;
      const index = Number(color);
      if (!Number.isInteger(index) || index < 0 || index >= PLAYER_COLORS.length) return false;
      if (this.host) {
        const error = this.assignColor(this.peerId, index);
        if (error) { this.error(error); return false; }
        return true;
      }
      if (this.lobby.status !== 'waiting' || !this.hostId) return false;
      if (this.myPlayer) {
        this.myPlayer.color = index;
        this.emitLobby();
      }
      this.sendData({ t: 'color', color: index }, this.hostId);
      return true;
    }

    // 房主驗證：只能改 peerId 本人的顏色，且不能和別人重複。回傳錯誤訊息，成功時回傳 null。
    assignColor(peerId, color) {
      if (!this.host || !this.lobby) return '只有房主可以更改棋子顏色。';
      if (this.lobby.status !== 'waiting') return '對局已開始，不能更改棋子顏色。';
      const index = Number(color);
      if (!Number.isInteger(index) || index < 0 || index >= PLAYER_COLORS.length) return '顏色選項無效。';
      const player = this.lobby.players.find(p => p.peerId === peerId);
      if (!player) return '找不到這位玩家。';
      const taker = this.lobby.players.find(p => p.peerId !== peerId && p.color === index);
      if (taker) return `這個顏色已經被「${taker.name}」選走了，請選別的顏色。`;
      player.color = index;
      this.broadcastLobby();
      return null;
    }

    renameSelf(name) {
      if (!this.active || this.lobby?.status !== 'waiting') return;
      const clean = cleanName(name, this.name || '玩家');
      if (this.host) {
        const player = this.myPlayer;
        if (!player) return;
        player.name = this.uniqueName(clean, player.peerId);
        this.name = player.name;
        this.broadcastLobby();
      } else if (this.hostId) {
        this.name = clean;
        this.sendData({ t: 'rename', name: clean }, this.hostId);
      }
    }

    startGame() {
      if (!this.host || !this.lobby) throw Error('只有房主可以開始對局。');
      if (this.pendingHandshakes.size) throw Error('有玩家正在連線，請稍後再開始。');
      const online = this.lobby.players.filter(isOnline);
      if (online.length < 2) throw Error('至少需要 2 位在線玩家。');
      if (online.length > MAX_PLAYERS) throw Error(`最多 ${MAX_PLAYERS} 位玩家。`);
      const fixed = online.filter(p => p.roleId !== 'random').map(p => p.roleId);
      if (new Set(fixed).size !== fixed.length) throw Error('企業角色不可重複（未定新創集團除外）。');
      // 已離線的玩家不加入這局，否則輪到他時整局會卡住；他回來時會看到原因。
      for (const p of this.lobby.players) if (!isOnline(p)) this.refuse(p.peerId, '對局已經開始；你剛才離線，沒有加入這局。');
      this.lobby.players = online;
      this.lobby.status = 'playing';
      this.lobby.confirms = [];
      const config = {
        seed: Date.now(),
        players: this.lobby.players.map(p => ({ name: p.name, roleId: p.roleId, color: p.color })),
        mode: this.lobby.mode,
        rounds: this.lobby.rounds,
        target: this.lobby.target,
        starGoal: this.lobby.starGoal,
        doomEvery: this.lobby.doomEvery,
        doomPrice: this.lobby.doomPrice,
        doomStep: this.lobby.doomStep,
        advancedSettings: globalThis.PartyUI?.getAdvancedSettings?.() || {},
        debug: this.lobby.debug,
        net: {
          roomCode: this.code, hostId: this.hostId,
          owners: Object.fromEntries(this.lobby.players.map((p, i) => [`player-${i + 1}`, p.peerId])),
          peerNames: Object.fromEntries(this.lobby.players.map((p, i) => [p.peerId, p.name]))
        }
      };
      this.broadcastData({ t: 'start', config });
      this.playerIds = new Map(Object.entries(config.net.owners).map(([playerId, peerId]) => [peerId, playerId]));
      this.broadcastLobby();
      this.onStart?.(config);
    }

    // 房主建立棋盤失敗時，讓大家回到大廳並顯示原因（不然客機會一直停在「初始化中」）。
    cancelStart(reason) {
      if (!this.host || !this.lobby) return;
      this.lobby.status = 'waiting';
      this.broadcastLobby();
      const text = `無法開始對局：${reason}`;
      this.broadcastData({ t: 'error', text });
      this.error(text);
    }

    publish(state) {
      if (!this.active || !this.host || !state) return;
      this.broadcastState(state);
    }

    sendAction(action) {
      if (!this.active || this.host || !this.hostId || !action?.type) return false;
      this.sendData({ t: 'action', action }, this.hostId);
      return true;
    }

    broadcastState(game) {
      if (!this.active || !this.host || !game) return;
      this.broadcastData({ t: 'state', game });
    }

    broadcastEvent(event) {
      if (!this.active || !this.host || !event?.type) return;
      this.onEvent?.(event, this.peerId);
      this.broadcastData({ t: 'event', event });
    }

    kickPlayer(peerId, text = '房主已將你移出對局。') {
      if (!this.host || !this.active || !peerId) return false;
      const player = this.lobby?.players.find(entry => entry.peerId === peerId);
      if (!player || player.host) return false;
      this.blacklist.add(peerId);
      this.sendData({ t: 'kicked', text }, peerId);
      this.autoKickPending.delete(peerId);
      this.dropPlayer(peerId, 500);
      this.playerIds.delete(peerId);
      this.broadcastLobby();
      return true;
    }

    broadcastData(msg) {
      this.sendData(msg, 'all');
    }

    sendData(msg, target = 'all') {
      if (!this.active) return;
      const packet = { ...msg, mid: rid(), fromPeer: this.peerId, at: Date.now() };
      if (target === 'all') {
        for (const [peerId, rec] of this.peers) {
          if (peerId !== this.peerId && rec.conn?.open) { try { rec.conn.send(packet); } catch { } }
        }
      } else {
        const rec = this.peers.get(target);
        if (rec?.conn?.open) { try { rec.conn.send(packet); } catch { } }
      }
    }

    _markSeen(mid) {
      if (!mid) return false;
      if (this.seen.has(mid)) return true;
      this.seen.add(mid);
      if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
      return false;
    }

    handleData(msg, fromPeer) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'HANDSHAKE_REQ' && this.host) {
        this.acceptHandshake(msg, fromPeer);
        return;
      }
      if (msg.type === 'HANDSHAKE_ACK' || msg.type === 'HANDSHAKE_REJECT') {
        if (!this.host) {
          if (msg.type === 'HANDSHAKE_REJECT') this.failJoin(this.peers.get(fromPeer)?.conn);
          else this.completeHandshake(msg, fromPeer);
        }
        return;
      }
      if (msg.type === 'SYSTEM') {
        if (!this.host && fromPeer === this.hostId && !this.verifiedPeers.has(fromPeer)) {
          this.failJoin(this.peers.get(fromPeer)?.conn);
        }
        return;
      }
      if (msg.fromPeer === this.peerId) return;
      if (this.host && !this.verifiedPeers.has(fromPeer)
        && !(msg.t === 'hello' && this.pendingHandshakes.has(fromPeer))) return;
      if (!this.host && fromPeer === this.hostId && !this.verifiedPeers.has(fromPeer)) {
        this.failJoin(this.peers.get(fromPeer)?.conn);
        return;
      }
      if (msg.t === 'ping') {
        if (this.host) this.sendData({ t: 'pong' }, fromPeer);
        return;
      }
      if (msg.t === 'pong') return;
      if (this._markSeen(msg.mid)) return;
      if (msg.t === 'kicked' && !this.host && fromPeer === this.hostId) {
        this.onKicked?.(msg.text || '你已被房主移出對局。');
        this.leave(false);
        return;
      }
      if (msg.t === 'lobby' && msg.lobby) {
        this.lobby = msg.lobby;
        if (msg.lobby.hostId) this.hostId = msg.lobby.hostId;
        if (msg.lobby.code) this.code = msg.lobby.code;
        this.emitLobby();
        return;
      }
      if (msg.t === 'hello') {
        if (this.host) {
          this.clearPendingHandshake(fromPeer);
          if (msg.clientVersion !== CLIENT_VERSION) {
            this.sendData({ t: 'refused', text: '房間版本不相容，請更新遊戲後重新加入。' }, fromPeer);
            this.peers.get(fromPeer)?.conn?.close();
            return;
          }
          this.verifiedPeers.add(fromPeer);
          this.connectedPeers.add(fromPeer);
          this.lastSeen.set(fromPeer, Date.now());
          if (this.blacklist.has(fromPeer)) {
            this.sendData({ t: 'kicked', text: '你已被房主移出房間，無法重新加入。' }, fromPeer);
            return;
          }
          this.addPlayer(fromPeer, msg.name);
          const p = this.lobby.players.find(x => x.peerId === fromPeer);
          if (p) p.connected = true;
          this.connectedPeers.add(fromPeer);
          this.broadcastLobby();
          this.sendData({ t: 'lobby', lobby: this.lobby }, fromPeer);
        }
        return;
      }
      if (msg.t === 'state' && msg.game) {
        if (!this.host && fromPeer === this.hostId) {
          const owners = msg.game.net?.owners;
          if (owners && typeof owners === 'object') this.playerIds = new Map(Object.entries(owners).map(([id, peer]) => [peer, id]));
          this.onState?.(msg.game, fromPeer);
        }
        return;
      }
      if (msg.t === 'action' && this.host) {
        this.onAction?.(msg.action, fromPeer);
        return;
      }
      if (msg.t === 'event' && !this.host && fromPeer === this.hostId) {
        this.onEvent?.(msg.event, fromPeer);
        return;
      }
      if (msg.t === 'start' && msg.config) {
        if (this.lobby) this.lobby.status = 'playing';
        const owners = msg.config.net?.owners;
        if (owners && typeof owners === 'object') this.playerIds = new Map(Object.entries(owners).map(([id, peer]) => [peer, id]));
        this.onStart?.(msg.config);
        return;
      }
      if (msg.t === 'role' && this.host) {
        const error = this.assignRole(fromPeer, msg.roleId);
        if (error) { this.sendData({ t: 'error', text: error }, fromPeer); this.sendData({ t: 'lobby', lobby: this.lobby }, fromPeer); }
        return;
      }
      if (msg.t === 'color' && this.host) {
        const error = this.assignColor(fromPeer, msg.color);
        if (error) { this.sendData({ t: 'error', text: error }, fromPeer); this.sendData({ t: 'lobby', lobby: this.lobby }, fromPeer); }
        return;
      }
      if (msg.t === 'rename' && this.host) {
        if (this.lobby?.status !== 'waiting') return;
        const p = this.lobby.players.find(x => x.peerId === fromPeer);
        if (p && msg.name) { p.name = this.uniqueName(cleanName(msg.name, p.name), p.peerId); this.broadcastLobby(); }
        return;
      }
      if (msg.t === 'confirm' && this.host) {
        this.confirmResult(this.playerIds.get(fromPeer) || msg.playerId || '');
        return;
      }
      if (msg.t === 'confirm-update' && msg.lobby) {
        this.lobby = msg.lobby; this.emitLobby(); return;
      }
      if (msg.t === 'return-lobby') {
        if (this.lobby) this.lobby.status = 'waiting';
        this.onReturnLobby?.(this.lobby);
        return;
      }
      if (msg.t === 'leave' && this.host) { this.playerGone(fromPeer); return; }
      if (msg.t === 'closed' && !this.host && fromPeer === this.hostId) {
        const playing = this.lobby?.status === 'playing';
        this.leave();
        this.error(playing ? '房主已關閉房間，對局結束。' : '房主已關閉房間。');
        return;
      }
      if (msg.t === 'refused' && !this.host && fromPeer === this.hostId) { this.leave(); this.error(msg.text || '無法加入房間。'); return; }
      if (msg.t === 'error') { this.error(msg.text || '連線錯誤'); return; }
    }

    broadcastLobby() {
      if (!this.lobby) return;
      this.emitLobby();
      this.broadcastData({ t: 'lobby', lobby: this.lobby });
    }

    emitLobby() {
      try { this.onLobby?.(this.lobby); } catch (e) { console.error(e); }
    }

    confirmResult(playerId) {
      if (!this.active) return { confirmed: 0, total: 0 };
      if (!this.host) {
        if (this.hostId) this.sendData({ t: 'confirm', playerId: playerId || this.myPlayerId }, this.hostId);
        return null;
      }
      if (!this.lobby) return null;
      if (playerId && !this.lobby.confirms.includes(playerId)) this.lobby.confirms.push(playerId);
      // 已離線的玩家不用確認；回到大廳時把他們移出。
      const online = this.lobby.players.filter(isOnline);
      const total = online.length;
      const confirmed = online.filter(p => {
        const i = this.lobby.players.indexOf(p);
        const playerId = this.playerIds.get(p.peerId);
        return this.lobby.confirms.includes(`player-${i + 1}`) || this.lobby.confirms.includes(playerId) || this.lobby.confirms.includes(p.peerId);
      }).length;
      this.lobby.confirmRatio = { confirmed, total };
      if (confirmed >= total) {
        for (const p of this.lobby.players) if (!isOnline(p)) this.refuse(p.peerId, '你剛才離線，已移出房間；要再玩請重新加入。');
        this.lobby.players = online;
        this.lobby.status = 'waiting';
        this.lobby.confirms = [];
        this.lobby.confirmRatio = { confirmed: 0, total };
        this.broadcastLobby();
        this.broadcastData({ t: 'return-lobby' });
        this.onReturnLobby?.(this.lobby);
      } else {
        this.broadcastLobby();
      }
      return this.lobby.confirmRatio;
    }

    // 等待確認結果時有人離線，重新計算（最後一位沒確認的人離開時不會卡住）。
    recheckConfirms() {
      if (this.host && this.lobby?.status === 'playing' && this.lobby.confirms?.length) this.confirmResult('');
    }

    // ---- 權限 -----------------------------------------------------------
    canAct(state) {
      if (!this.active || !state) return true;
      const owners = state.net?.owners;
      if (!owners) return true;
      const active = state.players?.[state.turnIndex];
      if (!active) return true;
      const owner = owners[active.id];
      return !owner || owner === this.peerId;
    }

    ownerName(state) {
      const active = state?.players?.[state?.turnIndex];
      const owner = state?.net?.owners?.[active?.id];
      return state?.net?.peerNames?.[owner] || '';
    }
  }

  return new Net();
})();

// ---- 邀請連結（大廳 QR Code 的內容） ------------------------------------
// 目前網址加上 ?room=代碼；file:// 或 localhost 的網址別的裝置打不開，回傳空字串。
export function roomInviteLink(href, code) {
  const roomCode = String(code || '').trim();
  if (!roomCode) return '';
  let url;
  try { url = new URL(href); } catch { return ''; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (/^(localhost|127(\.\d+){3}|\[::1\])$/i.test(url.hostname)) return '';
  url.hash = '';
  url.searchParams.set('room', roomCode);
  return url.href;
}

// 從網址讀出 ?room=代碼，沒有時回傳空字串。
export function roomCodeFromLink(href) {
  try { return (new URL(href).searchParams.get('room') || '').trim(); } catch { return ''; }
}

globalThis.PartyNet = PartyNet;
