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
  const visible = () => evaluate('Array.from(document.querySelectorAll(".question-panel")).filter(p=>!p.hidden).map(p=>p.dataset.step)');
  await command('Page.navigate',{url});
  await waitFor(() => evaluate('location.pathname === "/profile" && document.getElementById("profile-fields") && !document.getElementById("profile-fields").disabled'));
  assert.deepEqual(await visible(),['0']);
  await evaluate('document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['0']); // Required goal blocks progress.
  await evaluate('document.querySelector("input[value=race]").click(); document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['1']);
  await evaluate('document.querySelector("input[name=weekly_distance_km]").value="-1"; document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['1']);
  await evaluate('document.querySelector("input[name=weekly_distance_km]").value="35"; document.getElementById("next-question").click(); document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['2']); // Empty days block progress.
  await evaluate('document.querySelector("input[value=tue]").click(); document.querySelector("input[value=sun]").click(); document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['3']);
  assert.deepEqual(await evaluate('Array.from(document.getElementById("long-run-day").options).map(o=>o.value)'),['','tue','sun']);
  await evaluate('document.getElementById("long-run-day").value="sun"; document.getElementById("previous-question").click(); document.querySelector("input[value=sun]").click(); document.getElementById("next-question").click()');
  assert.equal(await evaluate('document.getElementById("long-run-day").value'),''); // Removed day clears preference.
  await evaluate('document.getElementById("previous-question").click(); document.querySelector("input[value=sun]").click(); document.getElementById("next-question").click(); document.getElementById("long-run-day").value="sun"; document.getElementById("next-question").click()');
  assert.deepEqual(await visible(),['4']);
  assert.ok((await evaluate('document.getElementById("profile-review").textContent')).includes('35 km'));
  await evaluate('document.querySelector("#profile-review button").click()');
  assert.equal(await evaluate('document.getElementById("profile-form").elements.goal.value'),'race');
  for(let i=0;i<4;i++) await evaluate('document.getElementById("next-question").click()');
  // A failed save keeps the review and answers available for retry.
  await evaluate('window.originalFetch=window.fetch; window.fetch=(...args)=>args[1]?.method==="POST" ? Promise.resolve(new Response(JSON.stringify({error:"Test save error"}),{status:400})) : window.originalFetch(...args); document.getElementById("save-profile").click()');
  await waitFor(() => evaluate('document.getElementById("profile-status").textContent === "Test save error"'));
  assert.deepEqual(await visible(),['4']);
  assert.equal(await evaluate('document.getElementById("profile-fields").disabled'),false);
  await evaluate('window.fetch=window.originalFetch; document.getElementById("save-profile").click()');
  await waitFor(() => evaluate('location.pathname === "/" && document.getElementById("profile-summary")?.textContent.includes("35 km/week")'));
  const saved = await (await fetch(url+'/api/profile')).json();
  assert.deepEqual(saved.profile,{goal:'race',weekly_distance_km:35,running_days:['tue','sun'],long_run_day:'sun'});
  await command('Page.navigate',{url:url+'/profile'});
  await waitFor(() => evaluate('document.getElementById("profile-fields") && !document.getElementById("profile-fields").disabled'));
  assert.equal(await evaluate('document.getElementById("profile-form").elements.goal.value'),'race');
  // Mobile layout should fit without horizontal scrolling.
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  console.log('Browser checks passed: new-user redirect, required inputs, navigation, preserved answers, dependent days, review, failed-save retry, save, edit, and mobile width.');
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
