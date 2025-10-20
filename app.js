// === SERVICE WORKER ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('✅ SW registrado'))
    .catch(err => console.error('Erro SW:', err));
}

// === ELEMENTOS ===
const STORAGE_KEY = 'meds_v3';
let meds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let timers = {};
let currentAlarmMed = null;
let speakInterval = null;
let lastImage = null;

const usernameInput = document.getElementById('username');
const micUser = document.getElementById('micUser');
const nameInput = document.getElementById('name');
const qtyInput = document.getElementById('quantity');
const startInput = document.getElementById('startTime');
const intervalInput = document.getElementById('intervalTime');
const micName = document.getElementById('micName');
const micQty = document.getElementById('micQty');
const micInterval = document.getElementById('micInterval');
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
const snoozeBtn = document.getElementById('snoozeBtn');
const snooze1hBtn = document.getElementById('snooze1hBtn');
const remind5 = document.getElementById('remind5');
const remind3 = document.getElementById('remind3');
const remind1 = document.getElementById('remind1');

// === RECONHECIMENTO DE VOZ ===
let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
function startRecognition(onResult) {
  if (!SpeechRecognition) return alert('Reconhecimento de voz não suportado.');
  const rec = new SpeechRecognition();
  rec.lang = 'pt-BR';
  rec.onresult = e => onResult(e.results[0][0].transcript);
  rec.start();
}
micUser.onclick = () => startRecognition(text => usernameInput.value = text);
micName.onclick = () => startRecognition(text => nameInput.value = text);
micQty.onclick = () => startRecognition(text => qtyInput.value = text);
micInterval.onclick = () => startRecognition(text => intervalInput.value = interpretTimeSpeech(text));

// === INTERVALO (HH:MM) ===
function parseIntervalToMinutes(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function interpretTimeSpeech(text) {
  const hMatch = text.match(/(\d+)\s*(hora|horas)/i);
  const mMatch = text.match(/(\d+)\s*(minuto|minutos)/i);
  const h = hMatch ? parseInt(hMatch[1]) : 0;
  const m = mMatch ? parseInt(mMatch[1]) : 0;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// === FOTO ===
photoInput.addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    const dataUrl = fr.result;
    imgPreview.innerHTML = `<img src="${dataUrl}">`;
    imgPreview.dataset.img = dataUrl;
    lastImage = dataUrl;
  };
  fr.readAsDataURL(f);
});

// === SALVAR ===
saveBtn.onclick = () => {
  const name = nameInput.value.trim();
  const qty = qtyInput.value.trim();
  const start = startInput.value;
  const intervalMinutes = parseIntervalToMinutes(intervalInput.value);
  const img = imgPreview.dataset.img || lastImage || 'icons/icon-192.png';
  const user = usernameInput.value.trim() || 'amigo';
  const remindBefore = [];
  if (remind5.checked) remindBefore.push(5);
  if (remind3.checked) remindBefore.push(3);
  if (remind1.checked) remindBefore.push(1);

  if (!name || !qty || !start || intervalMinutes <= 0)
    return alert('Preencha todos os campos corretamente.');

  const med = {
    id: Date.now().toString(),
    user, name, qty, start, intervalMinutes, img, remindBefore, history: []
  };
  meds.push(med);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
  scheduleMedication(med);
  renderList();
  requestNotificationPermission();
  alert('Lembrete salvo com sucesso!');
  clearForm();
};

// === LIMPAR TUDO ===
clearAllBtn.onclick = () => {
  if (!confirm('Excluir todos os lembretes?')) return;
  Object.values(timers).forEach(t => {
    clearTimeout(t.timeout);
    clearInterval(t.interval);
  });
  meds = [];
  timers = {};
  localStorage.removeItem(STORAGE_KEY);
  renderList();
};

// === TESTE ===
testNowBtn.onclick = () => {
  const med = {
    id: 'test', user: usernameInput.value || 'amigo',
    name: nameInput.value || 'Medicamento',
    qty: qtyInput.value || '1 unidade',
    img: imgPreview.dataset.img || 'icons/icon-192.png'
  };
  triggerAlarm(med);
};

// === LISTA ===
function renderList() {
  medList.innerHTML = '';
  if (!meds.length) return medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado.</div>';
  meds.forEach(m => {
    const hist = m.history.map(h => `<div class="small">✅ ${new Date(h).toLocaleString()}</div>`).join('');
    const el = document.createElement('div');
    el.className = 'med-item';
    el.innerHTML = `
      <img src="${m.img}">
      <div class="med-meta">
        <div style="font-weight:700">${m.name}</div>
        <div class="small">${m.qty}</div>
        <div class="small">Intervalo: ${m.intervalMinutes} min</div>
        ${hist}
      </div>
      <div class="actions">
        <button data-id="${m.id}" class="secondary delBtn">Excluir</button>
      </div>`;
    medList.appendChild(el);
  });
  document.querySelectorAll('.delBtn').forEach(b => {
    b.onclick = e => {
      const id = e.target.dataset.id;
      meds = meds.filter(x => x.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
      if (timers[id]) {
        clearTimeout(timers[id].timeout);
        clearInterval(timers[id].interval);
        delete timers[id];
      }
      renderList();
    };
  });
}

// === AGENDAMENTO ===
function scheduleAll() { meds.forEach(scheduleMedication); }
function scheduleMedication(med) {
  if (timers[med.id]) {
    clearTimeout(timers[med.id].timeout);
    clearInterval(timers[med.id].interval);
  }
  const start = new Date(med.start).getTime();
  const intervalMs = med.intervalMinutes * 60000;
  const now = Date.now();
  let next = start <= now ? start + intervalMs : start;
  const delay = next - now;
  timers[med.id] = {};
  timers[med.id].timeout = setTimeout(() => {
    triggerAlarm(med);
    timers[med.id].interval = setInterval(() => triggerAlarm(med), intervalMs);
  }, delay);
}

// === ALARME ===
function triggerAlarm(med) {
  currentAlarmMed = med;
  overlay.style.display = 'flex';
  overlayImg.src = med.img;
  overlayText.textContent = `Hora de tomar ${med.qty} de ${med.name}, ${med.user}.`;
  navigator.vibrate?.([400,200,400]);
  const msg = new SpeechSynthesisUtterance(`Ei ${med.user}! Hora de tomar ${med.qty} de ${med.name}.`);
  msg.lang = 'pt-BR'; msg.rate = 0.95;
  speechSynthesis.speak(msg);
  speakInterval = setInterval(() => speechSynthesis.speak(msg), 6000);
  navigator.serviceWorker.controller?.postMessage({
    type: 'SHOW_NOTIFICATION',
    title: 'Hora do remédio',
    body: `Ei ${med.user}! Tome ${med.qty} de ${med.name}`,
    icon: med.img
  });
}

// === OVERLAY ===
takenBtn.onclick = () => {
  if (currentAlarmMed) {
    currentAlarmMed.history.push(Date.now());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
    renderList();
  }
  stopAlarm();
};
snoozeBtn.onclick = () => { stopAlarm(); setTimeout(() => triggerAlarm(currentAlarmMed), 30*60000); };
snooze1hBtn.onclick = () => { stopAlarm(); setTimeout(() => triggerAlarm(currentAlarmMed), 60*60000); };

function stopAlarm() {
  overlay.style.display = 'none';
  navigator.vibrate?.(0);
  speechSynthesis.cancel();
  if (speakInterval) clearInterval(speakInterval);
}

// === UTIL ===
function clearForm() {
  [nameInput, qtyInput, startInput, intervalInput].forEach(i => i.value = '');
  [remind5, remind3, remind1].forEach(c => c.checked = false);
  imgPreview.innerHTML = '<span class="small">Sem foto</span>';
  delete imgPreview.dataset.img;
}
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default')
    Notification.requestPermission();
}

// === INÍCIO ===
renderList();
scheduleAll();
requestNotificationPermission();
const now = new Date(); now.setMinutes(now.getMinutes() + 1);
const pad = n => n.toString().padStart(2, '0');
startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
