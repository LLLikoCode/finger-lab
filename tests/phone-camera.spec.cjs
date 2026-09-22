const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://finger-lab.test';

async function setup(context, {modelDelay = 0, permission = 'granted'} = {}) {
  context.on('page', page => {
    page.on('console', msg => { if(msg.type()==='error') console.log('browser:', msg.text()); });
    page.on('pageerror', error => console.log('page error:', error.message));
  });
  await context.route(origin + '/**', async route => {
    const name = new URL(route.request().url()).pathname;
    const file = path.join(root, name === '/' ? 'index.html' : name);
    if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
    let body = fs.readFileSync(file, 'utf8');
    if (name.endsWith('peerjs.min.js')) body += `\nwindow.OriginalPeer = window.Peer; window.Peer = class extends window.OriginalPeer { constructor(id, options) { super(id, {...options, host:'127.0.0.1', port:9000, path:'/', secure:false}); (window.testPeers ||= []).push(this); } };`;
    await route.fulfill({contentType: name.endsWith('.js') ? 'application/javascript' : 'text/html', body});
  });
  // Mock inference only. MediaStreams, PeerJS, signaling and WebRTC remain real.
  await context.route('**/vision_bundle.mjs', async route => {
    if (modelDelay) await new Promise(resolve => setTimeout(resolve, modelDelay));
    await route.fulfill({contentType:'application/javascript', body:`
      export const FilesetResolver = {forVisionTasks: async () => ({})};
      export const HandLandmarker = {createFromOptions: async () => ({
        close() {}, detectForVideo() { return {landmarks:[Array.from({length:21},(_,i)=>({x:.2+(i%5)*.1,y:.2+Math.floor(i/5)*.1,z:0}))]}; }
      })};`});
  });
  await context.route('**/hand_landmarker.task', route => route.fulfill({body:'mock model'}));
  await context.addInitScript(({permission}) => {
    window.Worker = undefined; // Exercise the supported main-thread inference path.
    window.testStreams = [];
    if (!navigator.mediaDevices) return; // Initial about:blank is not a camera context.
    navigator.mediaDevices.getUserMedia = async options => {
      window.captureOptions = options;
      if (permission === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      if (permission === 'pending') await new Promise(resolve => window.allowCapture = resolve);
      const canvas = document.createElement('canvas'); canvas.width=640; canvas.height=480;
      const ctx = canvas.getContext('2d'); let frame=0;
      const paint = () => {ctx.fillStyle=frame++%2 ? '#ccff66' : '#4499cc';ctx.fillRect(0,0,640,480);};
      paint(); const timer = setInterval(paint, 50);
      const stream = canvas.captureStream(20);
      const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => {clearInterval(timer);stop();};
      window.testStreams.push(stream);
      return stream;
    };
  }, {permission});
}

async function receiver(browser, options) {
  const context = await browser.newContext(); await setup(context, options);
  const page = await context.newPage(); await page.goto(origin);
  await page.getByRole('button', {name:'电脑：创建手机连接'}).click();
  await expect(page.locator('#invite-link')).toHaveValue(/#room=fl-.*&key=/);
  return {context, page, invite:await page.locator('#invite-link').inputValue()};
}

async function sender(browser, invite, options) {
  const context = await browser.newContext(); await setup(context, options);
  const page = await context.newPage(); await page.goto(invite);
  return {context, page};
}

test('phone video arrives; receiver tracks; front mirror and stop release both ends', async ({browser}) => {
  const desktop = await receiver(browser);
  const phone = await sender(browser, desktop.invite);
  await phone.page.locator('#phone-facing').selectOption('user');
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(desktop.page.locator('#points')).toHaveText('21');
  await expect(desktop.page.locator('#camera')).toHaveClass('mirrored');
  expect(await desktop.page.locator('#camera').evaluate(v => v.videoWidth)).toBe(640);
  expect(await phone.page.evaluate(() => captureOptions.audio)).toBe(false);
  await expect(phone.page.locator('#points')).toHaveText('—');
  await expect(phone.page.locator('#remote-status')).toContainText('正在发送');
  await desktop.page.getByRole('button',{name:'停止连接',exact:true}).click();
  await expect.poll(() => phone.page.evaluate(() => testStreams[0].getTracks()[0].readyState)).toBe('ended');
  expect(await desktop.page.locator('#camera').evaluate(v => v.srcObject)).toBeNull();
  await expect(desktop.page.locator('#points')).toHaveText('—');
  await desktop.context.close(); await phone.context.close();
});

test('phone permission rejection stops session with actionable error', async ({browser}) => {
  const desktop = await receiver(browser);
  const phone = await sender(browser, desktop.invite, {permission:'denied'});
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(phone.page.locator('#remote-status')).toContainText('未获得摄像头权限');
  await expect(desktop.page.locator('#remote-stop')).toBeHidden();
  await desktop.context.close(); await phone.context.close();
});

test('late camera permission cannot revive a cancelled session', async ({browser}) => {
  const desktop = await receiver(browser);
  const phone = await sender(browser, desktop.invite, {permission:'pending'});
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect.poll(() => phone.page.evaluate(() => typeof window.allowCapture)).toBe('function');
  await phone.page.getByRole('button',{name:'停止连接',exact:true}).click();
  await phone.page.evaluate(() => window.allowCapture());
  await expect.poll(() => phone.page.evaluate(() => testStreams[0]?.getTracks()[0].readyState)).toBe('ended');
  expect(await phone.page.locator('#camera').evaluate(v => v.srcObject)).toBeNull();
  await desktop.context.close(); await phone.context.close();
});

test('wrong token cannot take receiver; valid phone can still pair', async ({browser}) => {
  const desktop = await receiver(browser);
  const wrong = await sender(browser, desktop.invite.replace(/key=[a-f0-9]+/, 'key='+'0'.repeat(32)));
  await wrong.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(wrong.page.locator('#remote-stop')).toBeHidden();
  expect(await wrong.page.evaluate(() => testStreams.length)).toBe(0);
  const phone = await sender(browser, desktop.invite);
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(desktop.page.locator('#points')).toHaveText('21');
  await desktop.context.close(); await phone.context.close(); await wrong.context.close();
});

test('second phone rejected; peer leaving ends first phone capture', async ({browser}) => {
  const desktop = await receiver(browser);
  const phone = await sender(browser, desktop.invite);
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(desktop.page.locator('#points')).toHaveText('21');
  const second = await sender(browser, desktop.invite);
  await second.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(second.page.locator('#remote-stop')).toBeHidden();
  expect(await second.page.evaluate(() => testStreams.length)).toBe(0);
  await desktop.page.goto('about:blank');
  await expect.poll(() => phone.page.evaluate(() => testStreams[0].getTracks()[0].readyState)).toBe('ended');
  await desktop.context.close(); await phone.context.close(); await second.context.close();
});

test('switch to demo while model loads cannot resume remote video', async ({browser}) => {
  const desktop = await receiver(browser, {modelDelay:2500});
  const phone = await sender(browser, desktop.invite);
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(desktop.page.locator('#loader')).toBeVisible();
  await desktop.page.getByRole('button',{name:'先看演示',exact:true}).click();
  await expect.poll(() => phone.page.evaluate(() => testStreams[0].getTracks()[0].readyState)).toBe('ended');
  await desktop.page.waitForTimeout(3000);
  await expect(desktop.page.locator('#stage')).toHaveAttribute('data-mode','demo');
  await expect(desktop.page.locator('#remote-status')).toContainText('连接已结束');
  expect(await desktop.page.locator('#camera').evaluate(v => v.srcObject)).toBeNull();
  await desktop.context.close(); await phone.context.close();
});

test('local camera and demo remain usable; narrow page has no overflow', async ({browser}) => {
  const context = await browser.newContext({viewport:{width:390,height:844}}); await setup(context);
  const page = await context.newPage(); await page.goto(origin);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'开启摄像头',exact:true}).click();
  await expect(page.locator('#points')).toHaveText('21');
  await page.getByRole('button',{name:'停止摄像头',exact:true}).click();
  expect(await page.evaluate(() => testStreams[0].getTracks()[0].readyState)).toBe('ended');
  await page.getByRole('button',{name:'先看演示',exact:true}).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-mode','demo');
  await expect(page.locator('#fps')).toHaveText('—');
  await context.close();
});

test('waiting QR expires and clears the session', async ({browser}) => {
  const desktop = await receiver(browser);
  await desktop.page.clock.install();
  // Recreate after installing the clock so the expiry timer is controlled.
  await desktop.page.getByRole('button',{name:'停止连接',exact:true}).click();
  await desktop.page.getByRole('button',{name:'电脑：创建手机连接'}).click();
  await expect(desktop.page.locator('#invite-link')).toHaveValue(/#room=/);
  await desktop.page.clock.fastForward(600001);
  await expect(desktop.page.locator('#remote-status')).toContainText('配对已过期');
  await expect(desktop.page.locator('#pairing')).toBeHidden();
  await expect(desktop.page.locator('#invite-link')).toHaveValue('');
  await desktop.context.close();
});

test('phone hidden stops capture and clears desktop video', async ({browser}) => {
  const desktop = await receiver(browser);
  const phone = await sender(browser, desktop.invite);
  await phone.page.getByRole('button',{name:'开启摄像头并发送'}).click();
  await expect(desktop.page.locator('#points')).toHaveText('21');
  await phone.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:true, configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await phone.page.evaluate(() => testStreams[0].getTracks()[0].readyState)).toBe('ended');
  await expect(phone.page.locator('#remote-status')).not.toContainText('正在发送');
  await expect(desktop.page.locator('#remote-stop')).toBeHidden();
  expect(await desktop.page.locator('#camera').evaluate(v => v.srcObject)).toBeNull();
  await desktop.context.close(); await phone.context.close();
});

test('signaling timeout is recoverable without camera access', async ({browser}) => {
  const context = await browser.newContext(); await setup(context);
  await context.routeWebSocket('ws://127.0.0.1:9000/**', () => {});
  const page = await context.newPage(); await page.goto(origin);
  await page.clock.install();
  await page.getByRole('button',{name:'电脑：创建手机连接'}).click();
  await page.clock.fastForward(20001);
  await expect(page.locator('#remote-status')).toContainText('配对服务连接超时');
  await expect(page.locator('#remote-start')).toBeEnabled();
  expect(await page.evaluate(() => testStreams.length)).toBe(0);
  await context.close();
});
