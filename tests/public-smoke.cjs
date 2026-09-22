// Optional online smoke: real public signaling + real MediaPipe, synthetic camera.
const {chromium, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://finger-lab.test';
(async () => {
  const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
  const proxy = proxyUrl ? {server: proxyUrl.origin,
    ...(proxyUrl.username ? {username:decodeURIComponent(proxyUrl.username),password:decodeURIComponent(proxyUrl.password)} : {})} : undefined;
  const browser = await chromium.launch({headless:true, proxy,
    executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const desktop = await browser.newContext({viewport:{width:1280,height:1000}});
    const phone = await browser.newContext({viewport:{width:390,height:844}});
    for (const context of [desktop, phone]) {
      await context.route(origin + '/**', route => {
        const name = new URL(route.request().url()).pathname;
        const file = path.join(root, name === '/' ? 'index.html' : name);
        return route.fulfill({path:file, contentType:name.endsWith('.js') ? 'application/javascript' : 'text/html'});
      });
    }
    await phone.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        const ctx=canvas.getContext('2d');let n=0;
        const paint=()=>{ctx.fillStyle='#294936';ctx.fillRect(0,0,640,480);ctx.fillStyle='#cbf36a';ctx.fillRect((n++*4)%550,180,50,100);};
        paint();const timer=setInterval(paint,50);
        const stream=canvas.captureStream(20),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);
        track.stop=()=>{clearInterval(timer);stop();};window.smokeStream=stream;
        return stream;
      };
    });
    const receiver=await desktop.newPage(), sender=await phone.newPage();
    await receiver.goto(origin);
    await receiver.getByRole('button',{name:'电脑：创建手机连接'}).click();
    await expect(receiver.locator('#invite-link')).toHaveValue(/#room=/,{timeout:25000});
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await receiver.screenshot({path:path.join(root,'test-results/desktop-pairing.png'),fullPage:true});
    const invite=await receiver.locator('#invite-link').inputValue();
    await sender.goto(invite);
    await sender.getByRole('button',{name:'开启摄像头并发送'}).click();
    try {
      await expect(receiver.locator('#stage')).toHaveAttribute('data-mode','live',{timeout:90000});
      await expect(receiver.locator('#points')).toHaveText('0',{timeout:15000});
      await expect(receiver.locator('#fps')).not.toHaveText('—',{timeout:15000});
      const dimensions=await receiver.locator('#camera').evaluate(v=>({width:v.videoWidth,height:v.videoHeight}));
      await receiver.screenshot({path:path.join(root,'test-results/desktop-receiving.png'),fullPage:true});
      await sender.screenshot({path:path.join(root,'test-results/phone-sending.png'),fullPage:true});
      await receiver.getByRole('button',{name:'停止连接',exact:true}).click();
      await expect.poll(()=>sender.evaluate(()=>smokeStream.getTracks()[0].readyState)).toBe('ended');
      console.log(JSON.stringify({publicSignaling:'PASS',realInferenceNoHand:'PASS',video:dimensions,stop:'PASS'}));
    } catch (error) {
      console.log(JSON.stringify({receiverStatus:await receiver.locator('#remote-status').textContent(),senderStatus:await sender.locator('#remote-status').textContent(),modelError:await receiver.locator('#error').textContent()}));
      throw error;
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
