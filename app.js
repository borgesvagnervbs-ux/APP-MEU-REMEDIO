// === Registra o service worker ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('✅ Service Worker registrado'))
    .catch(err => console.error('Erro SW:', err));
}

// === Elementos principais ===
const STORAGE_KEY = 'meds_v1';
const USER_KEY = 'user_name';
let meds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let timers = {}; // timers[med.id] = { timeout:..., interval:..., reminders: [ids...] }
let currentAlarmMed = null;
let speakInterval = null;

// form elements
const userNameInput = document.getElementById('userName');
const micUserBtn = document.getElementById('micUser');
const nameInput = document.getElementById('name');
const qtyInput = document.getElementById('quantity');
const startInput = document.getElementById('startTime');
const intervalInput = document.getElementById('interval');
const rem5 = document.getElementById('rem5');
const rem3 = document.getElementById('rem3');
const rem1 = document.getElementById('rem1');

const photoInput = document.getElementById('photo');
const imgPreview = document.getElementById('imgPreview');

const saveBtn = document.getElementById('saveBtn');
const testNowBtn = document.getElementById('testNow');
const clearAllBtn = document.getElementById('clearAll');

const medList = document.getElementById('medList');

const overlay = document.getElementById('overlay');
const overlayImg = document.getElementById('overlayImg');
const overlayText = document.getElementById('overlayText');
const takenBtn = document.getElementById('takenBtn');
const snooze30Btn = document.getElementById('snooze30');
const snooze60Btn = document.getElementById('snooze60');

const micName = document.getElementById('micName');
const micQty = document.getElementById('micQty');

// === Reconhecimento de voz ===
let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
function startRecognition(onResult){
  if(!SpeechRecognition) {
    alert('Reconhecimento de voz não suportado nesse navegador.');
    return;
  }
  const r = new SpeechRecognition();
  r.lang = 'pt-BR';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => onResult(e.results[0][0].transcript);
  r.onerror = (e) => { console.error('Speech error', e); alert('Erro no reconhecimento de voz: ' + (e.error||'')); };
  r.start();
}

// voice buttons
micName.onclick = () => startRecognition(text => nameInput.value = text);
micQty.onclick = () => startRecognition(text => qtyInput.value = text);
micUserBtn.onclick = () => startRecognition(text => { userNameInput.value = text; saveUserName(); });

// === user name persistence ===
function loadUserName(){
  const n = localStorage.getItem(USER_KEY) || '';
  userNameInput.value = n;
}
function saveUserName(){
  const n = userNameInput.value.trim();
  if(n) localStorage.setItem(USER_KEY, n);
  else localStorage.removeItem(USER_KEY);
}
userNameInput.addEventListener('blur', saveUserName);
loadUserName();

// === Foto handling ===
photoInput.addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  if(!f) return;
  const dataUrl = await fileToDataUrl(f);
  imgPreview.innerHTML = `<img src="${dataUrl}">`;
  imgPreview.dataset.img = dataUrl;
});
async function fileToDataUrl(file){
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// === Salvar lembrete ===
saveBtn.addEventListener('click', () => {
  const medName = nameInput.value.trim();
  const qty = qtyInput.value.trim();
  const start = startInput.value;
  const interval = parseInt(intervalInput.value, 10);
  const img = imgPreview.dataset.img || null;
  if(!medName || !qty || !start || !interval || !img) {
    alert('Preencha todos os campos (incluindo foto).');
    return;
  }

  const reminders = [];
  if(rem5.checked) reminders.push(5);
  if(rem3.checked) reminders.push(3);
  if(rem1.checked) reminders.push(1);

  const med = {
    id: Date.now().toString(),
    name: medName,
    qty,
    start,
    intervalMinutes: interval,
    img,
    reminders,      // array de minutos antes
    history: []     // array de timestamps ISO quando usuário confirmou que tomou
  };

  meds.push(med);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
  scheduleMedication(med);
  renderList();
  clearForm();
  requestNotificationPermission();
  alert('Lembrete salvo!');
});

// === Limpar todos ===
clearAllBtn.addEventListener('click', () => {
  if(!confirm('Remover todos os lembretes?')) return;
  for(const id in timers){
    // clear all timers and reminders
    if(timers[id].timeout) clearTimeout(timers[id].timeout);
    if(timers[id].interval) clearInterval(timers[id].interval);
    if(timers[id].reminders) timers[id].reminders.forEach(x=>clearTimeout(x));
  }
  timers = {};
  meds = [];
  localStorage.removeItem(STORAGE_KEY);
  renderList();
});

// === Testar agora ===
testNowBtn.addEventListener('click', () => {
  const med = {
    id: 'test-' + Date.now(),
    name: nameInput.value.trim() || 'Medicamento',
    qty: qtyInput.value.trim() || '1 unidade',
    img: imgPreview.dataset.img || '',
    intervalMinutes: parseInt(intervalInput.value,10) || 0
  };
  triggerAlarm(med);
});

// === Renderizar lista com histórico e ações ===
function renderList(){
  medList.innerHTML = '';
  if(meds.length === 0){
    medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado.</div>';
    return;
  }

  meds.forEach(m => {
    const el = document.createElement('div');
    el.className = 'med-item';

    // create history preview (count)
    const histCount = (m.history && m.history.length) ? ` • histórico: ${m.history.length}` : '';

    el.innerHTML = `
      <img src="${m.img}" alt="">
      <div class="med-meta">
        <div style="font-weight:700">${m.name}${histCount}</div>
        <div class="small">${m.qty}</div>
        <div class="small">Inicia: ${new Date(m.start).toLocaleString()}</div>
        <div class="small">Intervalo: ${m.intervalMinutes} min</div>
        <div class="small">Pré-lembretes: ${ (m.reminders && m.reminders.length) ? m.reminders.join(', ') + ' min antes' : 'nenhum' }</div>
        <div class="history-list" id="hist-${m.id}" style="display:none"></div>
      </div>
      <div class="actions">
        <button data-id="${m.id}" class="secondary showHistBtn">Histórico</button>
        <button data-id="${m.id}" class="secondary editBtn">Editar</button>
        <button data-id="${m.id}" class="secondary delBtn">Excluir</button>
      </div>
    `;
    medList.appendChild(el);
  });

  // eventos
  document.querySelectorAll('.delBtn').forEach(b=>{
    b.addEventListener('click', (ev)=>{
      const id = ev.currentTarget.dataset.id;
      if(!confirm('Excluir lembrete?')) return;
      // clear timers
      if(timers[id]){
        if(timers[id].timeout) clearTimeout(timers[id].timeout);
        if(timers[id].interval) clearInterval(timers[id].interval);
        if(timers[id].reminders) timers[id].reminders.forEach(r=>clearTimeout(r));
        delete timers[id];
      }
      meds = meds.filter(x=>x.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
      renderList();
    });
  });

  document.querySelectorAll('.showHistBtn').forEach(b=>{
    b.addEventListener('click', (ev)=>{
      const id = ev.currentTarget.dataset.id;
      const m = meds.find(x=>x.id===id);
      const histEl = document.getElementById(`hist-${id}`);
      if(!histEl) return;
      if(histEl.style.display === 'none'){
        // render history lines
        if(!m.history || m.history.length === 0){
          histEl.innerHTML = '<div class="small">Sem registros</div>';
        } else {
          histEl.innerHTML = m.history.map(h => `<div>${new Date(h).toLocaleString()}</div>`).join('');
        }
        histEl.style.display = 'block';
      } else {
        histEl.style.display = 'none';
      }
    });
  });

  document.querySelectorAll('.editBtn').forEach(b=>{
    b.addEventListener('click', (ev)=>{
      const id = ev.currentTarget.dataset.id;
      const m = meds.find(x=>x.id===id);
      if(!m) return;
      // populate form
      nameInput.value = m.name;
      qtyInput.value = m.qty;
      startInput.value = m.start;
      intervalInput.value = m.intervalMinutes;
      imgPreview.innerHTML = `<img src="${m.img}">`;
      imgPreview.dataset.img = m.img;
      // reminders
      rem5.checked = m.reminders && m.reminders.includes(5);
      rem3.checked = m.reminders && m.reminders.includes(3);
      rem1.checked = m.reminders && m.reminders.includes(1);
      // remove old med and timers to replace on save
      if(timers[id]){
        if(timers[id].timeout) clearTimeout(timers[id].timeout);
        if(timers[id].interval) clearInterval(timers[id].interval);
        if(timers[id].reminders) timers[id].reminders.forEach(r=>clearTimeout(r));
        delete timers[id];
      }
      meds = meds.filter(x=>x.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
      renderList();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// === Scheduling: main alarm + pre-reminders ===
function scheduleAll(){ meds.forEach(scheduleMedication); }

function scheduleMedication(med){
  // clean old timers
  if(timers[med.id]){
    if(timers[med.id].timeout) clearTimeout(timers[med.id].timeout);
    if(timers[med.id].interval) clearInterval(timers[med.id].interval);
    if(timers[med.id].reminders) timers[med.id].reminders.forEach(x=>clearTimeout(x));
  }
  timers[med.id] = { timeout: null, interval: null, reminders: [] };

  const start = new Date(med.start).getTime();
  const intervalMs = med.intervalMinutes * 60 * 1000;
  const now = Date.now();

  // compute next main trigger >= now
  let next = start;
  if(next <= now){
    const diff = now - start;
    const cycles = Math.floor(diff / intervalMs) + 1;
    next = start + cycles * intervalMs;
  }
  const delay = Math.max(0, next - now);

  // main alarm
  timers[med.id].timeout = setTimeout(() => {
    triggerAlarm(med);
    // after first, schedule periodic repeats
    timers[med.id].interval = setInterval(()=> triggerAlarm(med), intervalMs);
  }, delay);

  // schedule pre-reminders for next occurrence only (for each chosen minutes)
  if(med.reminders && med.reminders.length){
    med.reminders.forEach(minBefore => {
      const preTime = next - (minBefore * 60 * 1000);
      const preDelay = preTime - now;
      if(preDelay > 0){
        const preId = setTimeout(() => {
          triggerPreReminder(med, minBefore);
          // also schedule repeats at intervalMs (so pre-reminder recurs together with main)
          const rep = setInterval(()=> triggerPreReminder(med, minBefore), intervalMs);
          // store rep so we can clear on delete (we'll also keep rep in timers[med.id].reminders to clear later)
          timers[med.id].reminders.push(rep);
        }, preDelay);
        timers[med.id].reminders.push(preId);
      }
    });
  }
}

// Pre-reminder: simpler notification + TTS but not overlay
function triggerPreReminder(med, minutesBefore){
  const userName = localStorage.getItem(USER_KEY) || '';
  const text = `Em ${minutesBefore} minutos será a hora de tomar ${med.qty} de ${med.name}` + (userName ? `, ${userName}` : '');
  // tts
  if(window.speechSynthesis){
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }
  // vibrate briefly
  if(navigator.vibrate) navigator.vibrate([200,100,200]);
  // show notification via SW
  if(navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({
      type:'SHOW_NOTIFICATION',
      title:'Lembrete (pré)',
      body: text,
      icon: med.img
    });
  } else if(window.Notification && Notification.permission === 'granted'){
    new Notification('Lembrete (pré)', { body: text, icon: med.img });
  }
}

// === triggerAlarm: overlay, vibrar, tts, SW notify ===
function triggerAlarm(med){
  currentAlarmMed = med;

  overlayImg.src = med.img;
  const userName = localStorage.getItem(USER_KEY) || '';
  const speakText = `Hora de tomar ${med.qty} de ${med.name}` + (userName ? `, ${userName}` : '');
  overlayText.textContent = speakText;
  overlay.style.display = 'flex';

  // vibrate pattern loop
  if(navigator.vibrate){
    try {
      navigator.vibrate([500,200,500,200]);
      const vRepeater = setInterval(()=> navigator.vibrate([500,200,500,200]), 1500);
      overlay.dataset.vRepeater = vRepeater;
    } catch(e){}
  }

  if(window.speechSynthesis){
    const u = new SpeechSynthesisUtterance(speakText);
    u.lang = 'pt-BR'; u.rate = 0.95;
    window.speechSynthesis.speak(u);
    speakInterval = setInterval(() => {
      if(window.speechSynthesis.speaking) window.speechSynthesis.cancel();
      const u2 = new SpeechSynthesisUtterance(speakText);
      u2.lang = 'pt-BR'; u2.rate = 0.95;
      window.speechSynthesis.speak(u2);
    }, 6000);
  }

  // send message to SW to show persistent notification (requireInteraction)
  if(navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({
      type:'SHOW_NOTIFICATION',
      title:'Hora do remédio',
      body: speakText,
      icon: med.img,
      data: { medId: med.id }
    });
  } else if(window.Notification && Notification.permission === 'granted'){
    new Notification('Hora do remédio', { body: speakText, icon: med.img, requireInteraction:true });
  }
}

// === Overlay controls: TOMEI & snooze 30/60 ===
takenBtn.addEventListener('click', () => {
  // record history for currentAlarmMed (find in meds array by id)
  if(currentAlarmMed){
    const med = meds.find(m=>m.id === currentAlarmMed.id);
    const ts = new Date().toISOString();
    if(med){
      med.history = med.history || [];
      med.history.push(ts);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
      renderList();
    }
  }
  stopAlarmUI();
});

snooze30Btn.addEventListener('click', () => {
  snoozeMinutes(30);
});
snooze60Btn.addEventListener('click', () => {
  snoozeMinutes(60);
});

function snoozeMinutes(mins){
  if(!currentAlarmMed) return;
  stopAlarmUI();
  // schedule single timeout after mins minutes
  const med = currentAlarmMed;
  const id = med.id + '_snooze_' + Date.now();
  const timeout = setTimeout(()=> {
    triggerAlarm(med);
    delete timers[id];
  }, mins * 60 * 1000);
  // keep track to clear if needed
  timers[id] = { timeout, interval: null, reminders: [] };
  alert(`Adiado ${mins} minutos`);
}

// stop overlay and stop tts/vibration
function stopAlarmUI(){
  overlay.style.display = 'none';
  if(navigator.vibrate) navigator.vibrate(0);
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  if(speakInterval){ clearInterval(speakInterval); speakInterval = null; }
  const vr = overlay.dataset.vRepeater;
  if(vr) clearInterval(vr);
  overlay.dataset.vRepeater = '';
  currentAlarmMed = null;
}

// === Utils ===
function clearForm(){
  nameInput.value = '';
  qtyInput.value = '';
  startInput.value = '';
  intervalInput.value = '';
  imgPreview.innerHTML = '<span class="small">Sem foto</span>';
  delete imgPreview.dataset.img;
  rem5.checked = rem3.checked = rem1.checked = false;
}

function requestNotificationPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission().then(p => console.log('Notification permission', p));
  }
}

// === Inicialização ===
renderList();
scheduleAll();
requestNotificationPermission();
loadUserNameFromStorage();

function loadUserNameFromStorage(){
  const n = localStorage.getItem(USER_KEY) || '';
  userNameInput.value = n;
}

// define horário padrão (1 min à frente)
(function setDefaultStart(){
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2,'0');
  const val = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if(!startInput.value) startInput.value = val;
})();

// quando tab volta a visibilidade, re-schedule para corrigir timers
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){
    for(const id in timers){
      if(timers[id].timeout) clearTimeout(timers[id].timeout);
      if(timers[id].interval) clearInterval(timers[id].interval);
      if(timers[id].reminders) timers[id].reminders.forEach(x=>clearTimeout(x));
    }
    timers = {};
    scheduleAll();
  }
});
