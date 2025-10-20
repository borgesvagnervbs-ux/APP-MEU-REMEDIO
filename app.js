// === SERVICE WORKER ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('✅ SW registrado'))
    .catch(err => console.error('Erro SW:', err));
}

// === ELEMENTOS ===
const STORAGE_KEY = 'meds_v4';
let meds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let timers = {};
let currentAlarmMed = null;
let speakInterval = null;
let lastImage = null;

// ELEMENTOS DO FORMULÁRIO
const usernameInput = document.getElementById('username');
const nameInput = document.getElementById('name');
const qtyInput = document.getElementById('quantity');
const startInput = document.getElementById('startTime');
const intervalInput = document.getElementById('intervalTime');
const photoInput = document.getElementById('photo');
const imgPreview = document.getElementById('imgPreview');
const remind5 = document.getElementById('remind5');
const remind3 = document.getElementById('remind3');
const remind1 = document.getElementById('remind1');
const saveBtn = document.getElementById('saveBtn');
const medList = document.getElementById('medList');

// === CONFIGURAÇÕES INICIAIS ===
window.addEventListener('DOMContentLoaded', () => {
  // Define hora atual + 1 minuto como padrão
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2, '0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // Define intervalo padrão de 30 minutos
  intervalInput.value = '00:30';
  renderList();
  scheduleAll();
});

// === FUNÇÕES ===
function parseIntervalToMinutes(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// === FOTO ===
photoInput.addEventListener('change', e => {
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
  let start = startInput.value;
  let intervalMinutes = parseIntervalToMinutes(intervalInput.value);
  const img = imgPreview.dataset.img || lastImage || 'icons/icon-192.png';
  const user = usernameInput.value.trim() || 'amigo';
  const remindBefore = [];
  if (remind5.checked) remindBefore.push(5);
  if (remind3.checked) remindBefore.push(3);
  if (remind1.checked) remindBefore.push(1);

  // Corrige campos vazios
  if (!start) {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    start = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  if (!intervalMinutes || intervalMinutes <= 0) intervalMinutes = 30;

  if (!name || !qty) {
    alert('Preencha o nome e a quantidade do remédio.');
    return;
  }

  const med = {
    id: Date.now().toString(),
    user, name, qty, start, intervalMinutes, img, remindBefore, history: []
  };

  console.log('💾 Salvando medicamento:', med);
  meds.push(med);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));

  scheduleMedication(med);
  renderList();
  alert('Lembrete salvo com sucesso!');
};

// === RENDERIZA LISTA ===
function renderList() {
  medList.innerHTML = '';
  if (!meds.length) {
    medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado.</div>';
    return;
  }
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
      renderList();
    };
  });
}

// === AGENDAMENTO ===
function scheduleAll() { meds.forEach(scheduleMedication); }

function scheduleMedication(med) {
  const start = new Date(med.start).getTime();
  const intervalMs = med.intervalMinutes * 60000;
  const now = Date.now();
  let next = start <= now ? start + intervalMs : start;
  const delay = next - now;
  setTimeout(() => {
    triggerAlarm(med);
    setInterval(() => triggerAlarm(med), intervalMs);
  }, delay);
}

// === ALARME ===
function triggerAlarm(med) {
  console.log('🔔 Alarme disparado para', med.name);
  alert(`Hora de tomar ${med.qty} de ${med.name}, ${med.user}!`);
  navigator.vibrate?.([300,200,300]);
  const msg = new SpeechSynthesisUtterance(`Ei ${med.user}, hora de tomar ${med.qty} de ${med.name}!`);
  msg.lang = 'pt-BR';
  speechSynthesis.speak(msg);
}
