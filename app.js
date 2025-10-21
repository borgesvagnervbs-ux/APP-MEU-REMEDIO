if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

// =========================================================================
// === IndexedDB (IDB) Wrapper: db.js ===
// Este bloco simula um arquivo db.js, adicionando funções de CRUD com IDB
// =========================================================================
const DB_NAME = 'LembretesDB';
const STORE_NAME = 'meds';
let db = null;

/**
 * Abre a conexão com o IndexedDB e cria a Store, se necessário.
 * @returns {Promise<IDBDatabase>} A conexão com o banco de dados.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = event => {
      console.error("IndexedDB error:", event.target.errorCode);
      reject("Erro ao abrir o banco de dados.");
    };

    request.onsuccess = event => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = event => {
      db = event.target.result;
      // Cria o Object Store 'meds'. O 'id' será gerado automaticamente.
      // O 'keyPath' é essencial para que o IndexedDB saiba como indexar o objeto.
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

/**
 * Salva ou atualiza um lembrete no IndexedDB.
 * @param {object} med O objeto do lembrete.
 * @returns {Promise<void>}
 */
async function saveMedIDB(med) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    // transaction 'readwrite' é necessária para salvar
    const transaction = conn.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put(med); // 'put' insere ou atualiza (se o keyPath existir)

    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Carrega todos os lembretes do IndexedDB.
 * @returns {Promise<Array<object>>} A lista de lembretes.
 */
async function loadMedsIDB() {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    // transaction 'readonly' é suficiente para leitura
    const transaction = conn.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

/**
 * Exclui um lembrete pelo ID.
 * @param {string} id O ID do lembrete a ser excluído.
 * @returns {Promise<void>}
 */
async function deleteMedIDB(id) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

// =========================================================================
// === CÓDIGO DO APP ===
// =========================================================================
const STORAGE_KEY_USER = 'username'; // Mantém o username no localStorage por ser pequeno
let meds = []; // Agora 'meds' será carregado do IndexedDB
let lastImage = null;
let lastTriggered = {}; // Variável para controlar o último alarme disparado por ID e evitar repetições

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
const takenBtn = document.getElementById('takenBtn');
const clearAllBtn = document.getElementById('clearAll');

// === INICIALIZAÇÃO ===
window.addEventListener('DOMContentLoaded', async () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const pad = n => n.toString().padStart(2, '0');
  startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  intervalInput.value = '00:30';

  // 1. Tenta carregar o username do localStorage
  usernameInput.value = localStorage.getItem(STORAGE_KEY_USER) || '';

  // 2. Carrega os lembretes do IndexedDB
  try {
    meds = await loadMedsIDB();
    renderList();
    console.log(`✅ ${meds.length} lembretes carregados do IndexedDB.`);
  } catch (err) {
    console.error('Erro ao carregar lembretes do IDB:', err);
    // Tenta carregar do localStorage antigo como fallback de migração
    const oldMeds = JSON.parse(localStorage.getItem('meds_v6') || '[]');
    if (oldMeds.length > 0) {
      console.log('⚠️ Tentando migrar lembretes do localStorage antigo...');
      meds = oldMeds;
      // Salva no IDB e limpa o localStorage
      for (const med of meds) {
          if (!med.id) med.id = Math.random().toString(36).substring(2, 9) + Date.now();
          // Adiciona 'history' se não existir para evitar erros no cálculo
          if (!med.history) med.history = []; 
          await saveMedIDB(med);
      }
      localStorage.removeItem('meds_v6');
      renderList();
    }
  }
  
  // 3. Verifica se pode pedir Armazenamento Persistente (iOS/Chrome)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(persisted => {
      if (persisted) {
        console.log("Armazenamento persistente concedido. Dados menos propensos à exclusão.");
      }
    });
  }

});

// === UTIL ===
function parseInterval(intervalString) {
  const [hours, minutes] = intervalString.split(':').map(Number);
  return hours * 60 + minutes;
}

function speak(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    speechSynthesis.speak(utterance);
  }
}

// === HANDLERS ===
usernameInput.addEventListener('input', () => {
  localStorage.setItem(STORAGE_KEY_USER, usernameInput.value.trim());
});

photoInput.addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      lastImage = e.target.result;
      imgPreview.innerHTML = `<img src="${lastImage}" alt="Prévia do medicamento" />`;
    };
    reader.readAsDataURL(file); // Converte para Base64
  } else {
    lastImage = null;
    imgPreview.innerHTML = `<span class="small">Sem foto</span>`;
  }
});

saveBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const qty = qtyInput.value.trim();
  const startTime = startInput.value;
  const intervalTime = intervalInput.value;
  const username = usernameInput.value.trim() || 'Você';
  const remind = [];
  if (remind5.checked) remind.push(5);
  if (remind3.checked) remind.push(3);
  if (remind1.checked) remind.push(1);

  if (!name || !qty || !startTime || !intervalTime) {
    alert('Preencha todos os campos obrigatórios.');
    return;
  }

  try {
    const intervalMinutes = parseInterval(intervalTime);
    const id = Math.random().toString(36).substring(2, 9) + Date.now(); // ID único

    const med = {
      id,
      name,
      qty,
      startTime: new Date(startTime).getTime(),
      intervalMinutes,
      img: lastImage, // Base64 da imagem
      remind,
      history: [] // Garante que o histórico exista
    };

    // Salva no IndexedDB
    await saveMedIDB(med);

    meds.push(med); // Adiciona na lista em memória para renderizar
    renderList();
    
    // Limpa o formulário e a imagem
    nameInput.value = '';
    qtyInput.value = '';
    photoInput.value = '';
    lastImage = null;
    imgPreview.innerHTML = `<span class="small">Sem foto</span>`;
    remind5.checked = false;
    remind3.checked = false;
    remind1.checked = false;

    alert('💾 Lembrete salvo com sucesso! (Armazenado no IndexedDB)');
  } catch (err) {
    console.error('Erro ao salvar no IndexedDB:', err);
    alert('Erro ao salvar o lembrete. Tente novamente ou verifique o espaço do dispositivo.');
  }
});

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
    
    // Calcula o próximo horário
    let nextTime = getNextAlarmTime(m).nextTime;
    const nextTimeStr = new Date(nextTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    
    el.innerHTML = `
      <img src="${m.img || 'icons/icon-192.png'}">
      <div class="med-meta">
        <div style="font-weight:700">${m.name}</div>
        <div class="small">${m.qty}</div>
        <div class="small">Intervalo: ${m.intervalMinutes} min</div>
        <div class="small">Próximo: ${nextTimeStr}</div>
      </div>
      <div class="actions">
          <button data-id="${m.id}" class="deleteBtn small secondary">Excluir</button>
      </div>
    `;
    medList.appendChild(el);
  });
}

// === EXCLUIR LEMBRETE ===
medList.addEventListener('click', async event => {
    if (event.target.classList.contains('deleteBtn')) {
        const id = event.target.dataset.id;
        if (confirm('Tem certeza que deseja excluir este lembrete?')) {
            try {
                // Exclui do IndexedDB
                await deleteMedIDB(id);
                
                // Exclui do array em memória e renderiza
                meds = meds.filter(m => m.id !== id);
                renderList();
                alert('🗑️ Lembrete excluído com sucesso!');
            } catch (err) {
                console.error('Erro ao excluir do IDB:', err);
                alert('Erro ao excluir o lembrete.');
            }
        }
    }
});

// === LÓGICA DE ALARME E NOTIFICAÇÃO ===

/**
 * Calcula o próximo horário de alarme.
 * Se o histórico estiver vazio, a prioridade é o startTime.
 */
function getNextAlarmTime(med) {
    const now = Date.now();
    const startTime = med.startTime;
    const intervalMs = med.intervalMinutes * 60 * 1000;
    
    // 1. Caso de uso único (intervalo 0)
    if (intervalMs === 0 || med.intervalMinutes === 0) {
        return { nextTime: startTime, isFirst: true };
    }
    
    // 2. Caso de uso repetitivo:
    
    // Se nunca foi tomado (histórico vazio), o primeiro alarme é o startTime.
    if (med.history.length === 0) {
        // Se o startTime já passou de uma margem de 10 minutos, calculamos o próximo ciclo.
        if (startTime < now - (10 * 60 * 1000)) {
            // Se já passou, usamos a lógica de múltiplos para achar o próximo.
            const timeElapsed = now - startTime;
            const intervalsPassed = Math.floor(timeElapsed / intervalMs);
            const nextTime = startTime + (intervalsPassed + 1) * intervalMs;
            return { nextTime, isFirst: false };
        } else {
            // Se o startTime ainda está por vir, ou acabou de passar, usamos ele.
            return { nextTime: startTime, isFirst: true };
        }
    }
    
    // Se já foi tomado, calcula o próximo a partir do último registro
    const lastTakenTime = med.history[med.history.length - 1];
    
    // O próximo alarme é o último tomado + o intervalo
    const nextTime = lastTakenTime + intervalMs;
    
    // Se nextTime for no passado, avançamos para o próximo múltiplo a partir do lastTakenTime.
    if (nextTime < now - (10 * 60 * 1000)) { // Se passou de 10 minutos
         const timeElapsed = now - lastTakenTime;
         const intervalsPassed = Math.floor(timeElapsed / intervalMs);
         return { nextTime: lastTakenTime + (intervalsPassed + 1) * intervalMs, isFirst: false };
    }

    return { nextTime, isFirst: false };
}


function checkAlarms() {
    const now = Date.now();
    
    meds.forEach(med => {
        // Usa a nova função para calcular o próximo alarme
        const { nextTime } = getNextAlarmTime(med);
        const alarmKey = med.id;
        
        // 1. VERIFICA SE O ALARME PRINCIPAL DEVE TOCAR:
        // Margem de 1 minuto no passado (-60000ms) até 10 minutos no futuro (600000ms).
        const timeToAlarm = nextTime - now;

        if (timeToAlarm <= 600000 && timeToAlarm > -60000) {
            // Verifica se o alarme para este 'nextTime' já foi disparado
            if (lastTriggered[alarmKey] !== nextTime) {
                triggerAlarm(med);
                lastTriggered[alarmKey] = nextTime; // Marca o timestamp exato que disparou
            }
        } else if (timeToAlarm < -60000) {
             // Limpa o estado se o alarme já tiver passado muito (para o próximo ciclo)
             delete lastTriggered[alarmKey];
        }

        // 2. VERIFICA OS LEMBRETES (5, 3 e 1 minuto antes)
        med.remind.forEach(min => {
            const reminderTime = nextTime - (min * 60000);
            const reminderKey = `${med.id}-${min}`;

            // Condição para LEMBRETE (Tempo entre 1 minuto atrás e 1 minuto no futuro)
            const timeToReminder = reminderTime - now;
            
            if (timeToReminder <= 60000 && timeToReminder > -60000) {
                // O lembrete deve ser disparado se o alarme principal (nextTime) ainda não tiver sido.
                if (lastTriggered[reminderKey] !== nextTime) {
                    triggerReminder(med, min);
                    lastTriggered[reminderKey] = nextTime; // Marca para o ciclo do nextTime
                }
            } else if (timeToReminder < -60000) {
                 // Limpa o estado se o lembrete já tiver passado muito
                 delete lastTriggered[reminderKey];
            }
        });
    });
}

// Envia notificação via Service Worker
function sendNotification(title, body, data) {
    // Verifica se o Service Worker (SW) tem permissão de notificação e está ativo
    if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            body: body,
            data: data
        });
    } else if (Notification.permission === 'default') {
        // Se a permissão não foi pedida, pede ao usuário
        Notification.requestPermission().then(permission => {
            if (permission === 'granted' && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    title: title,
                    body: body,
                    data: data
                });
            }
        });
    } else {
        console.warn('Permissão de notificação negada ou Service Worker indisponível.');
    }
}

const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const overlayImg = document.getElementById('overlayImg');

function triggerAlarm(med) {
    const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
    const text = `🚨 ${username}, hora de tomar ${med.qty} de ${med.name}!`;
    
    // Alerta na tela
    overlayText.innerText = text;
    overlayImg.src = med.img || 'icons/icon-512.png';
    overlay.style.display = 'flex';
    
    // Notificação
    sendNotification('🚨 ALARME DE MEDICAMENTO', text, { medId: med.id });
    
    // Voz e Vibração
    speak(text);
    if ('vibrate' in navigator) {
        navigator.vibrate([1000, 500, 1000]);
    }
}

function triggerReminder(med, min) {
    const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
    const text = `Lembrete: Daqui a ${min} minutos você deve tomar ${med.qty} de ${med.name}.`;
    
    // Notificação de lembrete
    sendNotification('⏰ Lembrete de Medicamento', text);
    
    // Voz
    speak(text);
}

// Ação de Tomado
takenBtn.addEventListener('click', async () => {
    // Identifica o medId baseado no último alarme disparado (poderia ser melhor se fosse passado por parâmetro no Overlay)
    // Para simplificar, vamos limpar o overlay e registrar a tomada na lista de histórico do primeiro alarme ativo.
    
    let activeMed = null;
    const now = Date.now();

    // Tenta encontrar o medicamento que acabou de disparar
    for (const med of meds) {
        const { nextTime } = getNextAlarmTime(med);
        // Se o alarme principal tiver tocado recentemente
        if (lastTriggered[med.id] === nextTime) {
            activeMed = med;
            break;
        }
    }

    if (activeMed) {
        // Registra o tempo de tomada no histórico
        activeMed.history.push(now);
        // Remove entradas de histórico antigas (mantém apenas as últimas 10)
        if (activeMed.history.length > 10) {
            activeMed.history.shift();
        }
        
        // Salva a atualização no IndexedDB
        await saveMedIDB(activeMed);
        
        // Limpa o estado do alarme e a tela
        delete lastTriggered[activeMed.id];
        overlay.style.display = 'none';
        if ('vibrate' in navigator) {
            navigator.vibrate(0); // Para a vibração
        }
        renderList(); // Atualiza a lista com o novo 'Próximo' horário
        alert(`✅ ${activeMed.name} registrado como tomado!`);
    } else {
        overlay.style.display = 'none';
        if ('vibrate' in navigator) {
            navigator.vibrate(0);
        }
    }
});

// Botão Testar Agora (Mantido)
document.getElementById('testNow').addEventListener('click', () => {
    if (meds.length) {
        triggerAlarm(meds[0]);
    } else {
        alert('Cadastre um lembrete para testar o alarme.');
    }
});

// Botão Limpar Tudo
clearAllBtn.addEventListener('click', async () => {
    if (confirm('ATENÇÃO: Isso excluirá TODOS os seus lembretes e dados. Tem certeza?')) {
        try {
            // Exclui todos os dados do IDB
            const conn = await openDB();
            const transaction = conn.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.clear();

            // Limpa o array e a tela
            meds = [];
            lastTriggered = {};
            renderList();
            localStorage.removeItem(STORAGE_KEY_USER);
            usernameInput.value = '';

            alert('🔥 Todos os lembretes foram excluídos!');
        } catch (e) {
            console.error('Erro ao limpar o IDB:', e);
            alert('Erro ao limpar os lembretes.');
        }
    }
});

// Checa alarmes a cada 10 segundos
setInterval(checkAlarms, 10000);

// Executa a primeira checagem imediatamente
checkAlarms();
