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
    const response = await fetch(url + path, data ? {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)} : {});
    assert.equal(response.ok, true, await response.clone().text());
    return response.json();
  }
  await command('Page.navigate', {url:url+'/history'});
  await waitFor(() => evaluate('document.querySelector("#journal")?.getAttribute("aria-busy") === "false"'));
  assert.ok(await evaluate('document.querySelector(".history-empty")?.textContent.includes("first check-in")'));
  const input = {date:'2026-10-17',goal:'fitness',session_type:'tempo',planned_minutes:45,available_minutes:30,sleep_hours:8,energy:'normal',fatigue:'low',soreness:'none',recent_load:'usual',hrv:'',notes:'<img src=x onerror=alert(1)> Notes stay text.'};
  const pendingRun = await request('/api/sessions', input);
  const completed = await request('/api/sessions', {...input,date:'2026-10-16'});
  await request('/api/runs', {session_id:completed.id, minutes:30, distance_km:5.25, effort:4, choice:'recommendation', notes:'Felt comfortable.'});
  const rest = await request('/api/sessions', {...input,date:'2026-10-15',soreness:'pain'});
  await request('/api/sessions', {...input,date:'2026-09-30'});
  await request('/api/sessions', {...input,date:'2026-10-17',session_type:'easy'});
  await command('Page.navigate', {url:url+'/history'});
  await waitFor(() => evaluate('document.querySelectorAll(".journal-card").length === 5'));
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".journal-month-title")).map(x=>x.textContent)'), ['October 2026','September 2026']);
  assert.equal(await evaluate('document.querySelectorAll(".journal-day").length'), 4);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".journal-card")).map(x=>Number(x.dataset.sessionId))'), [5,1,2,3,4]);
  assert.equal(await evaluate('document.querySelectorAll(".journal-notes img").length'), 0);
  assert.ok(await evaluate('document.querySelector(".journal-notes").textContent.includes("<img")'));
  assert.ok(await evaluate(`document.querySelector('[data-session-id="${completed.id}"] summary').textContent.includes('5.25 km')`));
  assert.equal(await evaluate(`document.querySelector('[data-session-id="${rest.id}"] form') === null`), true);
  assert.ok(await evaluate(`document.querySelector('[data-session-id="${rest.id}"] summary').textContent.includes('No run log needed')`));
  await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"] summary').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"]').open`), true);
  // Native form validation blocks incomplete submissions.
  assert.equal(await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"] form').checkValidity()`), false);
  await evaluate(`window.testForm=document.querySelector('[data-session-id="${pendingRun.id}"] form'); testForm.elements.minutes.value='32'; testForm.elements.distance_km.value='5.6'; testForm.elements.effort.value='5'; testForm.elements.notes.value='Good run'; testForm.elements.choice.value='original'; window.originalFetch=window.fetch; window.fetch=(...args)=>args[1]?.method==='POST' ? Promise.resolve(new Response(JSON.stringify({error:'Please retry saving'}),{status:500})) : originalFetch(...args); testForm.requestSubmit()`);
  await waitFor(() => evaluate('testForm.querySelector(".status").textContent === "Please retry saving"'));
  assert.equal(await evaluate('testForm.elements.minutes.value'), '32');
  assert.equal(await evaluate('testForm.querySelector("button").disabled'), false);
  await evaluate('window.fetch=window.originalFetch; testForm.requestSubmit()');
  await waitFor(() => evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"] .journal-status').textContent === 'Completed'`));
  assert.equal(await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"] form') === null`), true);
  assert.equal(await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"]').open`), true);
  assert.ok(await evaluate(`document.querySelector('[data-session-id="${pendingRun.id}"]').textContent.includes('Followed original plan')`));
  const saved = await request('/api/history');
  assert.equal(saved.runs.find(run=>run.session_id===pendingRun.id).distance_km,5.6);
  await command('Page.navigate', {url:url+'/history'});
  await waitFor(() => evaluate('document.querySelectorAll(".is-complete").length === 2'));
  // Keyboard activation and mobile widths, including open forms.
  await evaluate('document.querySelector(".journal-summary").focus()');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor(() => evaluate('document.querySelector(".journal-card").open'));
  for (const width of [390,320]) {
    await command('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  }
  await command('Emulation.clearDeviceMetricsOverride');
  await evaluate('document.querySelector(".journal-card").open=false');
  // A failed history request offers a working retry without losing the page.
  await evaluate('window.originalFetch=window.fetch; window.fetch=()=>Promise.resolve(new Response("",{status:500})); loadHistory()');
  await waitFor(() => evaluate('!document.getElementById("history-retry").hidden'));
  await evaluate('window.fetch=window.originalFetch; document.getElementById("history-retry").click()');
  await waitFor(() => evaluate('document.getElementById("history-retry").hidden && document.querySelector("#journal").getAttribute("aria-busy")==="false"'));
  // Add a completed activity without a check-in and preserve answers after failure.
  await evaluate('document.getElementById("add-activity").click()');
  assert.equal(await evaluate('document.getElementById("past-activity-panel").hidden'),false);
  assert.equal(await evaluate('document.getElementById("past-activity-form").checkValidity()'),false);
  await evaluate(`window.pastForm=document.getElementById('past-activity-form'); pastForm.elements.date.value='2999-01-01'`);
  assert.equal(await evaluate('pastForm.elements.date.validity.rangeOverflow'),true);
  await evaluate(`pastForm.elements.date.value='2026-10-14'; pastForm.elements.session_type.value='long'; pastForm.elements.minutes.value='65'; pastForm.elements.distance_km.value='10.5'; pastForm.elements.effort.value='6'; pastForm.elements.notes.value='Evening run by the river. Felt strong.'`);
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true);
  await command('Emulation.setDeviceMetricsOverride',{width:1100,height:1050,deviceScaleFactor:1,mobile:false});
  await evaluate('scrollTo(0,0)');
  async function screenshot(name) {
    if (!process.argv.includes('--screenshots')) return;
    const result = await command('Page.captureScreenshot',{format:'png'});
    const {writeFile} = await import('node:fs/promises');
    await writeFile(join(process.cwd(),name),Buffer.from(result.data,'base64'));
  }
  await screenshot('past-run-form.png');
  await evaluate(`window.originalFetch=window.fetch; window.fetch=(...args)=>args[0]==='/api/activities' ? Promise.resolve(new Response(JSON.stringify({error:'Run could not be saved. Try again.'}),{status:500})) : originalFetch(...args); pastForm.requestSubmit()`);
  await waitFor(() => evaluate('document.getElementById("past-activity-status").textContent.includes("Try again")'));
  assert.equal(await evaluate('pastForm.elements.distance_km.value'),'10.5');
  assert.equal(await evaluate('pastForm.querySelector("button").disabled'),false);
  await evaluate('window.fetch=window.originalFetch; pastForm.requestSubmit()');
  await waitFor(() => evaluate('document.querySelectorAll("[data-activity-id]").length===1'));
  assert.equal(await evaluate('document.getElementById("past-activity-panel").hidden'),true);
  assert.ok(await evaluate('document.querySelector("[data-activity-id]").textContent.includes("10.5 km")'));
  assert.ok(await evaluate('document.querySelector("[data-activity-id]").textContent.includes("No check-in or suggestion")'));
  assert.equal(await evaluate('document.querySelectorAll(".journal-day").length'),5);
  assert.equal(await evaluate('document.querySelectorAll("[data-session-id] .is-complete").length'),2);
  await command('Page.navigate',{url:url+'/history'});
  await waitFor(() => evaluate('document.querySelectorAll("[data-activity-id]").length===1'));
  await evaluate('document.querySelector("[data-activity-id]").open=true; document.querySelector("[data-activity-id]").scrollIntoView({block:"center"})');
  await screenshot('past-run-timeline.png');
  const afterActivity = await request('/api/history');
  assert.equal(afterActivity.activities[0].date,'2026-10-14');
  assert.equal(afterActivity.sessions.length,5);
  assert.equal(afterActivity.runs.length,2);
  console.log('Past-run checks passed: future-date validation, mobile form, failed-save retry, independent activity logging, correct date grouping, reload persistence, and preservation of check-in run logs.');
  console.log('History browser checks passed: empty state, date/month ordering, same-day grouping, text safety, details, rest state, validation, failed-save retry, logging, persistence, keyboard, mobile widths, and load retry.');

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
