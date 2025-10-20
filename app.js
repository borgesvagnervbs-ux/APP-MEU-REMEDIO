// === SERVICE WORKER ===
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('✅ Service Worker registrado'))
    .catch(err => console.error('Erro SW:', err));
}

// === ELEMENTOS ===
const STORAGE_KEY = 'meds_v5';
let meds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let lastImage = null;

// CAMPOS
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

// === AJUSTES INICIAIS ===
window.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2, '0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  intervalInput.value = '00:30';
  renderList();
});

// === FUNÇÃO AUXILIAR ===
function parseIntervalToMinutes(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// === LEITURA DE FOTO ===
photoInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    imgPreview.innerHTML = `<img src="${fr.result}">`;
    imgPreview.dataset.img = fr.result;
    lastImage = fr.result;
  };
  fr.readAsDataURL(f);
});

// === SALVAR ===
saveBtn.onclick = async () => {
  try {
    const name = nameInput.value.trim();
    const qty = qtyInput.value.trim();
    const user = usernameInput.value.trim() || 'amigo';
    let start = startInput.value;
    const intervalMinutes = parseIntervalToMinutes(intervalInput.value) || 30;
    const img = imgPreview.dataset.img || lastImage || 'icons/icon-192.png';
    const remindBefore = [];
    if (remind5.checked) remindBefore.push(5);
    if (remind3.checked) remindBefore.push(3);
    if (remind1.checked) remindBefore.push(1);

    if (!name || !qty) {
      alert('Preencha o nome e a quantidade.');
      return;
    }

    // Se data estiver vazia, usa a atual
    if (!start) {
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      start = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    const med = {
      id: Date.now().toString(),
      user, name, qty, start, intervalMinutes, img, remindBefore, history: []
    };

    // grava sincronicamente
    meds.push(med);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
    localStorage.setItem('last_save', new Date().toISOString());

    renderList();
    alert('💾 Lembrete salvo com sucesso!');
  } catch (err) {
    console.error('Erro ao salvar:', err);
    alert('Erro ao salvar o lembrete.');
  }
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
