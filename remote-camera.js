/* Phone video travels directly to the receiver. The broker handles signaling only. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const NETWORK_HELP = '请确认两台设备连接同一 Wi-Fi，关闭 VPN，并避免访客网络或设备隔离；然后在电脑重新创建连接。';
  const token = () => crypto.randomUUID().replaceAll('-', '');

  class RemoteCamera {
    constructor(hooks) {
      this.hooks = hooks;
      this.epoch = 0;
      this.active = false;
      this.timers = new Set();
      this.rejected = new Set();
      const params = new URLSearchParams(location.hash.slice(1));
      const room = params.get('room'), key = params.get('key');
      this.invite = room && /^fl-[a-f0-9]{32}$/.test(room) && /^[a-f0-9]{32}$/.test(key || '') ? {room, key} : null;
      $('phone-controls').hidden = !this.invite;
      $('receiver-controls').hidden = !!this.invite;
      $('remote-title').textContent = this.invite ? '将手机摄像头传到电脑' : '用手机当摄像头';
      $('remote-help').textContent = this.invite
        ? '手机和电脑连接同一 Wi-Fi。选择镜头后开始发送，请保持页面前台和屏幕亮着。'
        : '电脑创建连接，手机扫码并允许摄像头。视频在电脑显示并识别手指。';
      $('remote-start').addEventListener('click', () => this.listen());
      $('phone-start').addEventListener('click', () => this.send());
      $('remote-stop').addEventListener('click', () => this.stop('连接已结束，请在电脑重新创建连接。'));
      $('copy-invite').addEventListener('click', async () => {
        const url = $('invite-link').value;
        try { await navigator.clipboard.writeText(url); this.message('链接已复制，请用手机浏览器打开。'); }
        catch { $('invite-link').focus(); $('invite-link').select(); this.message('请复制选中的链接，在手机浏览器打开。'); }
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.active) this.stop('已暂停：页面进入后台。请在电脑重新创建连接。');
      });
      window.addEventListener('pagehide', () => this.stop());
      if (room && !this.invite) this.message('配对链接不完整，请重新扫描电脑上的二维码。', true);
      this.render();
    }

    message(text, failed = false) {
      $('remote-status').textContent = text;
      $('remote-status').dataset.error = String(failed);
    }

    render() {
      $('remote-start').disabled = this.active;
      $('phone-start').disabled = this.active;
      $('phone-facing').disabled = this.active;
      $('remote-stop').hidden = !this.active;
    }

    later(fn, ms) {
      const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
      this.timers.add(id);
      return id;
    }

    clear(id) { clearTimeout(id); this.timers.delete(id); }

    begin(role) {
      this.stop();
      this.hooks.reset();
      if (!window.isSecureContext || !window.RTCPeerConnection || !window.Peer) {
        this.message('连接需要支持 WebRTC 的浏览器和 HTTPS 页面；请检查页面文件是否加载完整。', true);
        return null;
      }
      this.active = true;
      this.role = role;
      this.hooks.mode(role);
      this.render();
      this.message('正在连接配对服务…');
      return this.epoch;
    }

    current(epoch) { return this.active && this.epoch === epoch; }

    makePeer(epoch) {
      // No STUN or TURN: only direct local-network connectivity is supported.
      const peer = new window.Peer('fl-' + token(), {debug: 0, config: {iceServers: []}});
      this.peer = peer;
      const timeout = this.later(() => this.fail('配对服务连接超时，请检查互联网连接后重试。'), 20000);
      peer.on('open', () => this.clear(timeout));
      peer.on('error', e => {
        if (!this.current(epoch)) return;
        this.fail(e.type === 'peer-unavailable'
          ? '电脑连接已失效，请在电脑重新创建连接并扫码。'
          : '连接服务或设备连接失败。' + NETWORK_HELP);
      });
      peer.on('disconnected', () => {
        if (this.current(epoch)) this.fail('配对服务连接已断开，请检查网络后重新创建连接。');
      });
      return peer;
    }

    listen() {
      if (location.protocol !== 'https:') {
        this.message('请在电脑打开已部署的 HTTPS 网站，再创建手机连接。本机 localhost 地址无法供手机扫码访问。', true);
        return;
      }
      const epoch = this.begin('receiver');
      if (epoch === null) return;
      this.key = token();
      try {
        const peer = this.makePeer(epoch);
        peer.on('open', id => {
          if (!this.current(epoch)) return;
          const url = new URL(location.href);
          url.search = '';
          url.hash = new URLSearchParams({room: id, key: this.key}).toString();
          $('invite-link').value = url.href;
          $('pair-code').replaceChildren();
          if (window.qrcode) {
            const qr = window.qrcode(0, 'M');
            qr.addData(url.href); qr.make();
            $('pair-code').innerHTML = qr.createSvgTag({cellSize: 4, margin: 16, scalable: true});
          }
          $('pairing').hidden = false;
          this.message('等待手机扫码 · 链接 10 分钟内有效，请勿分享给他人。');
          this.expiry = this.later(() => this.fail('配对已过期，请重新创建连接。'), 10 * 60 * 1000);
        });
        peer.on('connection', connection => {
          if (!this.current(epoch) || connection.metadata?.key !== this.key || this.channel) {
            // Wait for the data channel to open so the other end receives rejection.
            // Closing before negotiation completes leaves it waiting until timeout.
            this.rejected.add(connection);
            const cleanup = () => { this.rejected.delete(connection); connection.close(); };
            const timeout = this.later(cleanup, 5000);
            connection.on('error', cleanup);
            connection.on('open', () => {
              connection.send({type:'rejected'});
              this.clear(timeout); this.later(cleanup, 250);
            });
            return;
          }
          this.channel = connection;
          this.watchChannel(connection, epoch);
          this.connectTimeout = this.later(() => this.fail('未收到手机视频。' + NETWORK_HELP), 60000);
          connection.on('open', () => {
            if (!this.current(epoch)) return;
            connection.send({type: 'ready'});
            this.message('手机已配对，等待手机允许摄像头…');
          });
        });
        peer.on('call', call => {
          if (!this.current(epoch) || this.call || !this.channel?.open || call.peer !== this.channel.peer || call.metadata?.key !== this.key) {
            call.close(); return;
          }
          this.call = call;
          this.watchCall(call, epoch);
          call.on('stream', stream => {
            if (!this.current(epoch)) { stream.getTracks().forEach(t => t.stop()); return; }
            this.clear(this.connectTimeout); this.clear(this.expiry);
            this.stream = stream;
            $('pairing').hidden = true;
            this.message('已连接手机 · 视频在电脑上识别');
            for (const track of stream.getTracks()) track.addEventListener('ended', () => {
              if (this.current(epoch)) this.fail('手机视频已结束，请重新创建连接。');
            });
            Promise.resolve(this.hooks.stream(stream, call.metadata.mirrored === true)).catch(e => {
              if (this.current(epoch)) this.fail(e.userMessage || '电脑识别模型加载失败，请检查网络并重新连接。');
            });
          });
          call.answer();
        });
      } catch { this.fail('连接组件启动失败，请刷新页面后重试。'); }
    }

    send() {
      if (!this.invite) return;
      const epoch = this.begin('sender');
      if (epoch === null) return;
      try {
        const peer = this.makePeer(epoch);
        peer.on('call', call => call.close());
        peer.on('connection', connection => connection.close());
        peer.on('open', () => {
          if (!this.current(epoch)) return;
          const connection = peer.connect(this.invite.room, {reliable: true, serialization: 'json', metadata: {key: this.invite.key}});
          this.channel = connection;
          this.watchChannel(connection, epoch);
          this.connectTimeout = this.later(() => this.fail('无法连接电脑。' + NETWORK_HELP), 30000);
          let ready = false;
          connection.on('data', async data => {
            if (data?.type !== 'ready' || ready || !this.current(epoch)) return;
            ready = true;
            this.clear(this.connectTimeout);
            this.message('请允许摄像头，画面将发送到配对电脑。');
            let stream;
            const captureTimeout = this.later(() => this.fail('等待摄像头授权超时，请重新扫码连接。'), 55000);
            try {
              const facing = $('phone-facing').value;
              stream = await navigator.mediaDevices.getUserMedia({audio: false, video: {
                facingMode: {ideal: facing}, width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 24, max: 30}
              }});
              this.clear(captureTimeout);
              if (!this.current(epoch)) { stream.getTracks().forEach(t => t.stop()); return; }
              this.stream = stream;
              const track = stream.getVideoTracks()[0];
              const mirrored = (track.getSettings().facingMode || facing) === 'user';
              track.addEventListener('ended', () => { if (this.current(epoch)) this.fail('摄像头已中断，请重新扫码连接。'); });
              await this.hooks.preview(stream, mirrored);
              if (!this.current(epoch)) return;
              const call = peer.call(this.invite.room, stream, {metadata: {key: this.invite.key, mirrored}});
              if (!call) throw new Error('call unavailable');
              this.call = call;
              this.watchCall(call, epoch);
              this.connectTimeout = this.later(() => this.fail('视频连接超时。' + NETWORK_HELP), 30000);
              call.peerConnection.addEventListener('connectionstatechange', () => {
                if (this.current(epoch) && call.peerConnection?.connectionState === 'connected') {
                  this.clear(this.connectTimeout);
                  this.message('正在发送到电脑 · 保持此页面前台和屏幕亮着');
                }
              });
            } catch (e) {
              this.clear(captureTimeout);
              if (!this.current(epoch)) return;
              this.fail(e.name === 'NotAllowedError'
                ? '未获得摄像头权限，请在浏览器设置中允许摄像头，再让电脑重新创建连接。'
                : '手机摄像头无法启动，请关闭占用摄像头的应用后重新连接。');
            }
          });
        });
      } catch { this.fail('发送组件启动失败，请刷新页面并重新扫码。'); }
    }

    watchChannel(channel, epoch) {
      let lastSeen = Date.now();
      const heartbeat = () => {
        if (!this.current(epoch)) return;
        if (Date.now() - lastSeen > 10000) { this.fail('对端已失去连接。' + NETWORK_HELP); return; }
        if (channel.open) channel.send({type: 'ping'});
        this.later(heartbeat, 2500);
      };
      channel.on('open', () => { if (this.current(epoch)) { lastSeen = Date.now(); heartbeat(); } });
      channel.on('data', data => {
        if (!this.current(epoch)) return;
        if (data?.type === 'ping' || data?.type === 'pong') {
          lastSeen = Date.now();
          if (data.type === 'ping' && channel.open) channel.send({type: 'pong'});
        }
        if (data?.type === 'stop') this.stop('对端已停止连接，请在电脑重新创建连接。');
        if (data?.type === 'rejected') this.fail('配对链接无效或电脑已连接其他手机，请在电脑重新创建连接。');
      });
      channel.on('close', () => { if (this.current(epoch)) this.stop('对端已断开，请在电脑重新创建连接。'); });
      channel.on('error', () => { if (this.current(epoch)) this.fail('控制连接失败。' + NETWORK_HELP); });
    }

    watchCall(call, epoch) {
      call.on('close', () => { if (this.current(epoch)) this.stop('视频已断开，请在电脑重新创建连接。'); });
      call.on('error', () => { if (this.current(epoch)) this.fail('视频连接失败。' + NETWORK_HELP); });
      // PeerJS creates the receiver's RTCPeerConnection when answer() is called.
      this.later(() => {
        if (!this.current(epoch)) return;
        const pc = call.peerConnection;
        pc?.addEventListener('connectionstatechange', () => {
          if (this.current(epoch) && ['failed', 'disconnected'].includes(pc.connectionState)) this.fail('视频连接已中断。' + NETWORK_HELP);
        });
      }, 0);
    }

    fail(message) { this.stop(message); this.message(message, true); }

    stop(message) {
      const wasActive = this.active;
      this.active = false;
      this.epoch++;
      for (const id of this.timers) clearTimeout(id);
      this.timers.clear();
      for (const connection of this.rejected) connection.close();
      this.rejected.clear();
      if (this.channel?.open) { try { this.channel.send({type: 'stop'}); } catch {} }
      this.stream?.getTracks().forEach(t => t.stop());
      this.stream = null;
      this.call?.close(); this.call = null;
      this.channel?.close(); this.channel = null;
      this.peer?.destroy(); this.peer = null;
      this.key = null;
      $('pairing').hidden = true;
      $('pair-code').replaceChildren();
      $('invite-link').value = '';
      this.render();
      if (wasActive) this.hooks.reset();
      if (message) this.message(message);
    }
  }
  window.RemoteCamera = RemoteCamera;
})();
