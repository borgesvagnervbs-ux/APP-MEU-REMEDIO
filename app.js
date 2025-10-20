if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

const STORAGE_KEY = 'meds_v6';
let meds = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let lastImage = null;

// ELEMENTOS
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

// === INICIALIZAÇÃO ===
window.addEventListener('DOMContentLoaded', () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2, '0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  intervalInput.value = '00:30';
  renderList();
});

// === UTIL ===
function parseIntervalToMinutes(value) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// === COMPACTAR IMAGEM ===
async function compressImage(file, maxW = 320, maxH = 320) {
  return new Promise(resolve => {
    const img = new Image();
    const fr = new FileReader();
    fr.onload = e => {
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) {
          if (width > maxW) { height *= maxW / width; width = maxW; }
        } else {
          if (height > maxH) { width *= maxH / height; height = maxH; }
        }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
    };
    fr.readAsDataURL(file);
  });
}

// === FOTO ===
photoInput.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const dataUrl = await compressImage(file);
  imgPreview.innerHTML = `<img src="${dataUrl}">`;
  imgPreview.dataset.img = dataUrl;
  lastImage = dataUrl;
});

// === SALVAR ===
saveBtn.onclick = async () => {
  try {
    const name = nameInput.value.trim();
    const qty = qtyInput.value.trim();
    const user = usernameInput.value.trim() || 'amigo';
    const start = startInput.value || new Date().toISOString();
    const intervalMinutes = parseIntervalToMinutes(intervalInput.value) || 30;
    const img = imgPreview.dataset.img || lastImage || 'icons/icon-192.png';
    const remindBefore = [];
    if (remind5.checked) remindBefore.push(5);
    if (remind3.checked) remindBefore.push(3);
    if (remind1.checked) remindBefore.push(1);

    if (!name || !qty) return alert('Preencha o nome e a quantidade.');

    const med = {
      id: Date.now().toString(),
      user, name, qty, start, intervalMinutes, img, remindBefore, history: []
    };

    // Verifica espaço disponível
    const quota = await navigator.storage?.estimate?.();
    const usado = quota?.usage || 0;
    const limite = quota?.quota || 5 * 1024 * 1024;
    if (usado > limite * 0.9) {
      alert('Memória quase cheia. Exclua alguns lembretes.');
      return;
    }

    meds.push(med);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
    renderList();
    alert('💾 Lembrete salvo com sucesso!');
  } catch (err) {
    console.error('Erro ao salvar:', err);
    alert('Erro ao salvar o lembrete.');
  }
};

// === RENDERIZAR LISTA ===
function renderList() {
  medList.innerHTML = '';
  if (!meds.length) {
    medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado.</div>';
    return;
  }
  meds.forEach(m => {
    const el = document.createElement('div');
    el.className = 'med-item';
    el.innerHTML = `
      <img src="${m.img}">
      <div class="med-meta">
        <div style="font-weight:700">${m.name}</div>
        <div class="small">${m.qty}</div>
        <div class="small">Intervalo: ${m.intervalMinutes} min</div>
      </div>
      <div class="actions">
        <button data-id="${m.id}" class="secondary delBtn">Excluir</button>
      </div>`;
    medList.appendChild(el);
  });
  document.querySelectorAll('.delBtn').forEach(btn => {
    btn.onclick = e => {
      const id = e.target.dataset.id;
      meds = meds.filter(m => m.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meds));
      renderList();
    };
  });
}
