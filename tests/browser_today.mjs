// Browser smoke test using Edge and Node's built-in Chrome DevTools Protocol support.
// Run: node tests/browser_profile.mjs (Windows + Edge + Python required).
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import assert from 'node:assert/strict';

const temporary = await mkdtemp(join(tmpdir(), 'suru-browser-'));
const server = spawn('python', ['-m', 'suru.server', '--port', '0', '--database', join(temporary, 'test.sqlite3')], {windowsHide:true});
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', () => {});
let browser;
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {
    const result = await fn();
    if (result) return result;
    await pause(100);
  }
  throw new Error('Timed out waiting for browser or application');
}
try {
  const url = await waitFor(() => serverOutput.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]);
  browser = spawn(process.env.SURU_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--user-data-dir='+join(temporary,'edge'), 'about:blank'], {windowsHide:true, stdio:'ignore'});
  const port = await waitFor(async () => { try { return (await readFile(join(temporary,'edge','DevToolsActivePort'),'utf8')).split('\n')[0]; } catch { return null; } });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const {resolve,reject,timer} = pending.get(data.id);
      pending.delete(data.id); clearTimeout(timer);
      if (data.error) reject(new Error(data.error.message)); else resolve(data.result);
    }
  });
  function command(method, params = {}) {
    return new Promise((resolve,reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {pending.delete(id); reject(new Error('CDP timeout: '+method));},5000);
      pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params}));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async function request(path, data) {
    const response = await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal(response.ok,true,await response.clone().text());
    return response.json();
  }
  await request('/api/profile',{goal:'fitness',weekly_distance_km:25,running_days:['mon','wed','sat'],long_run_day:'sat'});
  const date = new Date();
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = localDate(date);
  date.setDate(date.getDate()-1);
  const yesterday = localDate(date);
  const checkin={date:yesterday,goal:'fitness',session_type:'easy',planned_minutes:40,available_minutes:40,sleep_hours:8,energy:'normal',fatigue:'low',soreness:'none',recent_load:'usual'};
  await request('/api/sessions',checkin);
  async function openToday() {
    await evaluate('window.navigationMarker=true');
    await command('Page.navigate',{url});
    await waitFor(()=>evaluate('!window.navigationMarker && typeof loading !== "undefined" && !loading && document.querySelector("#checkin-form button") && !document.querySelector("#checkin-form button").disabled'));
  }
  await openToday();
  assert.equal(await evaluate('document.getElementById("recommendation-empty").hidden'),false);
  assert.equal(await evaluate('document.querySelector("#history-list")'),null);
  assert.equal(await evaluate('document.getElementById("run-date").type'),'hidden');
  assert.deepEqual(await evaluate('Array.from(document.querySelector("#checkin-form [name=setting]").options).map(option=>option.value)'),['outdoor','treadmill']);
  await evaluate('document.querySelector("#checkin-form [name=setting]").value="treadmill"');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("nav a")).map(a=>a.textContent)'),['Today','History','Profile']);
  assert.equal(await evaluate('document.querySelector("nav [aria-current=page]").textContent'),'Today');
  await evaluate('document.querySelector("#checkin-form [name=sleep_hours]").value="8"; document.querySelector("#checkin-form [name=recent_load]").value="usual"; document.getElementById("checkin-form").requestSubmit()');
  await waitFor(()=>evaluate('!document.getElementById("log-card").hidden'));
  assert.ok(await evaluate('document.getElementById("recommendation-date").textContent.includes("Treadmill")'));
  assert.equal(await evaluate('document.getElementById("run-date").value'),today);
  assert.equal(await evaluate('document.querySelector("#recommendation-content details").open'),false);
  await evaluate('window.runForm=document.getElementById("log-form"); runForm.elements.minutes.value="35"; runForm.elements.distance_km.value="5.5"; runForm.elements.effort.value="4"; window.originalFetch=window.fetch; window.fetch=(...args)=>args[0]==="/api/runs" ? Promise.resolve(new Response(JSON.stringify({error:"Try saving again"}),{status:500})) : originalFetch(...args); runForm.requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("log-status").textContent==="Try saving again"'));
  assert.equal(await evaluate('runForm.elements.minutes.value'),'35');
  assert.equal(await evaluate('runForm.querySelector("button").disabled'),false);
  await evaluate('window.fetch=window.originalFetch; runForm.requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("log-card").hidden && !document.getElementById("log-complete").hidden'));
  assert.ok(await evaluate('document.getElementById("log-complete").textContent.includes("5.5 km")'));
  await openToday();
  assert.equal(await evaluate('document.getElementById("log-card").hidden'),true);
  assert.equal(await evaluate('document.getElementById("log-complete").hidden'),false);
  assert.equal(await evaluate('document.querySelector("#checkin-form [name=sleep_hours]").value'),'8');
  assert.equal(await evaluate('document.querySelector("#checkin-form [name=setting]").value'),'treadmill');
  if (process.argv.includes('--screenshots')) {
    await command('Emulation.setDeviceMetricsOverride',{width:1100,height:1050,deviceScaleFactor:1,mobile:false});
    await evaluate('scrollTo(0,0)');
    const screenshot=await command('Page.captureScreenshot',{format:'png'});
    const {writeFile}=await import('node:fs/promises');
    await writeFile(join(process.cwd(),'today-cleanup.png'),Buffer.from(screenshot.data,'base64'));
  }
  await request('/api/sessions',{...checkin,date:today,soreness:'pain'});
  await openToday();
  assert.equal(await evaluate('document.getElementById("action").textContent'),'RECOVER TODAY');
  assert.equal(await evaluate('document.getElementById("log-card").hidden'),true);
  assert.equal(await evaluate('document.getElementById("log-complete").hidden'),true);
  await command('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await command('Page.navigate',{url:url+'/history'});
  await waitFor(()=>evaluate('document.querySelectorAll(".journal-card").length===3'));
  assert.equal(await evaluate('document.querySelector(".journal-context").open'),false);
  assert.equal(await evaluate('document.querySelectorAll(".journal-log").length'),1);
  assert.equal(await evaluate('document.querySelector("nav [aria-current=page]").textContent'),'History');
  await command('Page.navigate',{url:url+'/profile'});
  await waitFor(()=>evaluate('document.querySelector("#profile-fields") && !document.querySelector("#profile-fields").disabled && !document.querySelector("nav").hidden'));
  assert.equal(await evaluate('document.querySelector("nav [aria-current=page]").textContent'),'Profile');
  console.log('Cleanup browser checks passed: daily date, yesterday isolation, no duplicate journal, shared save retry, successful logging and reload, rest state, collapsed context, consistent navigation, and mobile width.');

} finally {
  if (socket) socket.close();
  for (const child of [browser,server]) {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit',resolve)); child.kill();
      await Promise.race([exited,pause(3000)]);
    }
  }
  // Delete only this test's verified temporary directory.
  const target = resolve(temporary);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('suru-browser-')) throw new Error('Unexpected temporary path');
  await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:300});
}
