const ids = ['step-window', 'step-store', 'publish-step', 'discord-step'];
const panels = ids.map(id => document.getElementById(id));
const host = document.querySelector('#watcher .steps');
const nav = document.createElement('nav');
nav.className = 'watcher-guide';
nav.setAttribute('aria-label', 'Shop watcher setup');
const prompt = document.createElement('section');
prompt.className = 'watcher-prompt';
prompt.setAttribute('aria-label', 'Current setup step');
const heading = document.createElement('h3');
const description = document.createElement('p');
const checklist = document.createElement('ol');
const status = document.createElement('p');
status.className = 'watcher-guide-status';
status.setAttribute('role', 'status');
prompt.append(heading, description, checklist, status);
const steps = [
  {label: 'Share game window', caption: 'Choose what to capture', title: 'Share your MapleStory window', description: 'Get your shop ready, then connect the game window.', tasks: ['In MapleStory, open your shop and the Sold Items window.', 'Click “Choose MapleStory window” below and select the game window.', 'Keep the game visible and unminimized while watching.']},
  {label: 'Check your shop', caption: 'Confirm the captured areas', title: 'Check that your shop is being read correctly', description: 'Auto Select finds your shop, mesos balance and chat.', tasks: ['Keep your shop, Sold Items and mesos balance visible.', 'Use “Auto Select again” if an area was missed.', 'Click “Check reading” and compare the results with your game.']},
  {label: 'Read location', caption: 'Required · map and channel', title: 'Read your map from the top-left minimap', description: 'Your current map or FM room, world and channel must be read before watching starts.', tasks: ['Expand the minimap and move it to the top-left corner of the game window.', 'Click “Read map / store location” and check the detected location.', 'Open the Change Channel menu, click “Read channel”, then check the world and channel.']},
  {label: 'Connect Discord', caption: 'Test your sale alerts', title: 'Send a test alert to Discord', description: 'Connect the channel where you want sale and shop-chat alerts.', tasks: ['In your Discord channel, open Settings → Integrations → Webhooks.', 'Create a webhook, copy its URL and paste it below.', 'Click “Send test (latest sale)”. Once it succeeds, click “Start watching”.']}
];
let active = 0;
let progress = {connected: false, storeReady: false, locationReady: false, discordReady: false, watching: false};
const buttons = steps.map((step, i) => {
  const button = document.createElement('button');
  button.type = 'button';
  const badge = document.createElement('span'); badge.className = 'guide-number'; badge.textContent = String(i + 1);
  const copy = document.createElement('span'); copy.className = 'guide-copy';
  const label = document.createElement('strong'); label.textContent = step.label;
  const caption = document.createElement('small'); caption.textContent = step.caption;
  copy.append(label, caption); button.append(badge, copy);
  button.setAttribute('aria-controls', ids[i]);
  button.onclick = () => show(i, true);
  nav.append(button); return button;
});
host.before(nav, prompt);
function show(index, focus = false) {
  active = index;
  const done = [progress.connected, progress.storeReady, progress.locationReady, progress.discordReady];
  panels.forEach((panel, i) => {panel.hidden = i !== index; panel.open = i === index;});
  buttons.forEach((button, i) => {
    // Reading the location only requires capture. The Start button still checks every setup step.
    const locked = i === 2 ? !progress.connected : i > 0 && !done.slice(0, i).every(Boolean);
    button.setAttribute('aria-current', i === index ? 'step' : 'false');
    button.disabled = locked;
    button.classList.toggle('is-complete', !!done[i]);
    button.querySelector('.guide-number').textContent = done[i] ? '✓' : String(i + 1);
    button.title = locked ? 'Complete the preceding setup steps first' : '';
  });
  heading.textContent = `Step ${index + 1} of 4 · ` + steps[index].title;
  description.textContent = steps[index].description;
  checklist.replaceChildren(...steps[index].tasks.map(task => {const li = document.createElement('li'); li.textContent = task; return li;}));
  status.textContent = progress.watching ? 'Watching your shop — sale and shop-chat alerts are sent to Discord.' : done.every(Boolean) ? 'You’re ready! Click “Start watching” below.' : `${done.filter(Boolean).length} of 4 setup steps complete`;
  if (focus) {heading.tabIndex = -1; heading.focus({preventScroll: true});}
}
window.addEventListener('mesoswatch:setup-progress', event => {
  const p = event.detail;
  let next = active;
  if (!p.connected) next = 0;
  else if (!progress.connected || !p.storeReady && progress.storeReady) next = 1;
  else if (p.storeReady && !progress.storeReady) next = 2;
  else if (!p.locationReady && progress.locationReady) next = 2;
  else if (p.storeReady && p.locationReady && (!progress.locationReady || !p.discordReady && progress.discordReady)) next = 3;
  progress = p; show(next);
});
show(0);
