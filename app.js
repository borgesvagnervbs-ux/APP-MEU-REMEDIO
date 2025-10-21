if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js');
}

// =========================================================================
// === IndexedDB (IDB) Wrapper: db.js (MANUTENÇÃO DE DADOS GRANDES) ===
// =========================================================================
const DB_NAME = 'LembretesDB';
const STORE_NAME = 'meds';
let db = null;

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
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}

async function saveMedIDB(med) {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(med);
    request.onsuccess = () => resolve();
    request.onerror = event => reject(event.target.error);
  });
}

async function loadMedsIDB() {
  const conn = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = conn.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = event => resolve(event.target.result);
    request.onerror = event => reject(event.target.error);
  });
}

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
// === CÓDIGO DO APP (LÓGICA DE ALARME) ===
// =========================================================================
const STORAGE_KEY_USER = 'username';
let meds = [];
let lastImage = null;
let lastTriggered = {}; // {medId: nextTime} - Controla o último alarme disparado
let activeAlarmLoop = null; // Controla o loop de repetição do alarme
let activeReminderLoop = null; // Controla o loop de repetição do lembrete

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
const postpone30Btn = document.getElementById('postpone30');
const postpone60Btn = document.getElementById('postpone60');
const clearAllBtn = document.getElementById('clearAll');

// Botões de voz
const voiceUsernameBtn = document.getElementById('voiceUsername');
const voiceNameBtn = document.getElementById('voiceName');
const voiceQuantityBtn = document.getElementById('voiceQuantity');

// Overlay do Alarme
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const overlayImg = document.getElementById('overlayImg');

// Adiciona event listeners para os botões de adiar
if(postpone30Btn) postpone30Btn.addEventListener('click', () => handlePostpone(30));
if(postpone60Btn) postpone60Btn.addEventListener('click', () => handlePostpone(60));

// === RECONHECIMENTO DE VOZ ===
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;
}

function startVoiceRecognition(inputElement) {
  if (!recognition) {
    alert('Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.');
    return;
  }

  recognition.onstart = () => {
    console.log('🎤 Reconhecimento de voz iniciado...');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    inputElement.value = transcript;
    console.log('✅ Reconhecido:', transcript);
  };

  recognition.onerror = (event) => {
    console.error('❌ Erro no reconhecimento de voz:', event.error);
    alert('Erro ao reconhecer a voz. Tente novamente.');
  };

  recognition.onend = () => {
    console.log('🎤 Reconhecimento de voz finalizado.');
  };

  recognition.start();
}

// Event listeners para os botões de voz
if (voiceUsernameBtn) {
  voiceUsernameBtn.addEventListener('click', () => startVoiceRecognition(usernameInput));
}
if (voiceNameBtn) {
  voiceNameBtn.addEventListener('click', () => startVoiceRecognition(nameInput));
}
if (voiceQuantityBtn) {
  voiceQuantityBtn.addEventListener('click', () => startVoiceRecognition(qtyInput));
}

// === INICIALIZAÇÃO ===
window.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1);
    const pad = n => n.toString().padStart(2, '0');
    startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    intervalInput.value = '00:30';

    usernameInput.value = localStorage.getItem(STORAGE_KEY_USER) || '';

    try {
        meds = await loadMedsIDB();
        renderList();
        console.log(`✅ ${meds.length} lembretes carregados do IndexedDB.`);
    } catch (err) {
        console.error('Erro ao carregar lembretes do IDB:', err);
    }
    
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().then(persisted => {
            if (persisted) console.log("Armazenamento persistente concedido.");
        });
    }

    console.log('Botões de adiar carregados:', !!postpone30Btn, !!postpone60Btn);
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
        reader.readAsDataURL(file);
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
        const id = Math.random().toString(36).substring(2, 9) + Date.now();

        const med = {
            id,
            name,
            qty,
            startTime: new Date(startTime).getTime(),
            intervalMinutes,
            img: lastImage,
            remind,
            history: []
        };

        await saveMedIDB(med);

        meds.push(med);
        renderList();
        
        // Limpa os campos de configuração dos lembretes
        nameInput.value = '';
        qtyInput.value = '';
        photoInput.value = '';
        lastImage = null;
        imgPreview.innerHTML = `<span class="small">Sem foto</span>`;
        remind5.checked = false;
        remind3.checked = false;
        remind1.checked = false;
        
        const now = new Date();
        now.setMinutes(now.getMinutes() + 1);
        const pad = n => n.toString().padStart(2, '0');
        startInput.value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        intervalInput.value = '00:30';

        alert('💾 Lembrete salvo com sucesso! (Armazenado no IndexedDB)');
    } catch (err) {
        console.error('Erro ao salvar no IndexedDB:', err);
        alert('Erro ao salvar o lembrete.');
    }
});

// === LÓGICA DE ALARME E NOTIFICAÇÃO ===

// Referência do medicamento que está atualmente em alarme (para adiar/tomar)
let currentActiveMed = null; 

/**
 * Calcula o próximo horário de alarme.
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
        if (startTime < now - (10 * 60 * 1000)) { // Se já passou de uma margem de 10 minutos
            const timeElapsed = now - startTime;
            const intervalsPassed = Math.floor(timeElapsed / intervalMs);
            const nextTime = startTime + (intervalsPassed + 1) * intervalMs;
            return { nextTime, isFirst: false };
        } else {
            return { nextTime: startTime, isFirst: true };
        }
    }
    
    // Se já foi tomado, calcula o próximo a partir do último registro
    const lastTakenTime = med.history[med.history.length - 1];
    const nextTime = lastTakenTime + intervalMs;
    
    // Se nextTime for no passado, avançamos para o próximo múltiplo a partir do lastTakenTime.
    if (nextTime < now - (10 * 60 * 1000)) {
         const timeElapsed = now - lastTakenTime;
         const intervalsPassed = Math.floor(timeElapsed / intervalMs);
         return { nextTime: lastTakenTime + (intervalsPassed + 1) * intervalMs, isFirst: false };
    }

    return { nextTime, isFirst: false };
}

function checkAlarms() {
    const now = Date.now();
    
    // Se já tivermos um alarme principal ou lembrete ativo, não checamos novos.
    if (activeAlarmLoop !== null || activeReminderLoop !== null) {
        return; 
    }
    
    meds.forEach(med => {
        const { nextTime } = getNextAlarmTime(med);
        const alarmKey = med.id;
        
        // 1. VERIFICA O ALARME PRINCIPAL (Tempo exato)
        const timeToAlarm = nextTime - now;

        // CORREÇÃO: Condição para tocar se estiver entre 1 minuto no futuro e 1 minuto no passado
        if (timeToAlarm <= 60000 && timeToAlarm > -60000) {
            if (lastTriggered[alarmKey] !== nextTime) {
                startAlarmLoop(med, nextTime);
                lastTriggered[alarmKey] = nextTime;
                return;
            }
        }
        
        // 2. VERIFICA OS LEMBRETES (5, 3 e 1 minuto antes)
        med.remind.forEach(min => {
            const reminderTime = nextTime - (min * 60000);
            const reminderKey = `${med.id}-${min}`;

            const timeToReminder = reminderTime - now;
            
            // CORREÇÃO: Condição para tocar lembretes entre 1 minuto no futuro e 1 minuto no passado
            if (timeToReminder <= 60000 && timeToReminder > -60000) {
                if (lastTriggered[reminderKey] !== nextTime) {
                    startReminderLoop(med, min, nextTime, reminderKey);
                    lastTriggered[reminderKey] = nextTime;
                    return;
                }
            }
        });
    });
}

// === FUNÇÕES DE LOOP DE ALARME/LEMBRETE ===

/**
 * Inicia o loop de repetição do alarme principal.
 */
function startAlarmLoop(med, nextTime) {
    if (activeAlarmLoop) clearInterval(activeAlarmLoop);
    currentActiveMed = med;

    const repeatAlarm = () => {
        const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
        const text = `${username}, hora de tomar ${med.qty} de ${med.name}.`;
        
        overlayText.innerText = text;
        overlayImg.src = med.img || 'icons/icon-512.png';
        overlay.style.display = 'flex';
        
        sendNotification('🚨 ALARME DE MEDICAMENTO', text, { medId: med.id });
        speak(text);
        if ('vibrate' in navigator) {
            navigator.vibrate([1000, 500, 1000]);
        }
        
        if (nextTime < Date.now() - (10 * 60 * 1000)) {
             stopAlarmLoop();
        }
    };
    
    repeatAlarm();
    activeAlarmLoop = setInterval(repeatAlarm, 10000);
}

/**
 * Inicia o loop de repetição do lembrete.
 */
function startReminderLoop(med, min, nextTime, reminderKey) {
    if (activeReminderLoop) clearInterval(activeReminderLoop);

    const repeatReminder = () => {
        const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
        const text = `${username}, faltam ${min} minutos para tomar ${med.qty} de ${med.name}.`;
        
        sendNotification('⏰ Lembrete de Medicamento', text);
        speak(text);
        
        if (nextTime < Date.now() + 60000) {
             stopReminderLoop();
        }
    };
    
    repeatReminder();
    activeReminderLoop = setInterval(repeatReminder, 10000);
}

/**
 * Para o loop de repetição do alarme principal.
 */
function stopAlarmLoop() {
    if (activeAlarmLoop) clearInterval(activeAlarmLoop);
    activeAlarmLoop = null;
    currentActiveMed = null;
    overlay.style.display = 'none';
    if ('vibrate' in navigator) {
        navigator.vibrate(0);
    }
    if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
    }
}

/**
 * Para o loop de repetição do lembrete.
 */
function stopReminderLoop() {
    if (activeReminderLoop) clearInterval(activeReminderLoop);
    activeReminderLoop = null;
    if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
    }
}

// === AÇÕES DO USUÁRIO NO OVERLAY ===

// Ação de "Tomei o remédio"
takenBtn.addEventListener('click', async () => {
    stopAlarmLoop();
    stopReminderLoop();

    if (currentActiveMed) {
        const med = meds.find(m => m.id === currentActiveMed.id);
        if (med) {
            const now = Date.now();
            
            // Registra o tempo de tomada no histórico
            med.history.push(now);
            
            // Salva a atualização no IndexedDB
            await saveMedIDB(med);
            
            // Limpa o estado do alarme e atualiza a lista
            delete lastTriggered[med.id];
            renderList();
            
            const horarioTomada = new Date(now).toLocaleString('pt-BR');
            alert(`✅ ${med.name} registrado como tomado às ${horarioTomada}!`);
        }
    } else {
         alert('Nenhum alarme ativo para registrar a tomada.');
    }
});

/**
 * Ação de "Adiar" (30 ou 60 minutos).
 */
async function handlePostpone(minutes) {
    stopAlarmLoop();
    stopReminderLoop();

    if (currentActiveMed) {
        const med = currentActiveMed;
        const postponeMs = minutes * 60 * 1000;
        
        const { nextTime } = getNextAlarmTime(med);
        const newNextTime = nextTime + postponeMs;
        
        lastTriggered[med.id] = newNextTime - 1;
        
        alert(`⏰ Lembrete de ${med.name} adiado por ${minutes} minutos.`);
        
        checkAlarms();
    } else {
        alert('Nenhum alarme ativo para adiar.');
    }
}

// Botão Testar Agora
document.getElementById('testNow').addEventListener('click', () => {
    if (meds.length) {
        const med = meds[0];
        const nextTime = Date.now() + 1000;
        lastTriggered[med.id] = nextTime - 1;
        startAlarmLoop(med, nextTime);
    } else {
        alert('Cadastre um lembrete para testar o alarme.');
    }
});

// Botão Limpar Tudo
clearAllBtn.addEventListener('click', async () => {
    if (confirm('ATENÇÃO: Isso excluirá TODOS os seus lembretes e dados. Tem certeza?')) {
        try {
            const conn = await openDB();
            const transaction = conn.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.clear();

            meds = [];
            lastTriggered = {};
            stopAlarmLoop();
            stopReminderLoop();
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

// === RENDERIZAR LISTA DE LEMBRETES ===
function renderList() {
    if (meds.length === 0) {
        medList.innerHTML = '<div class="small">Nenhum lembrete cadastrado ainda.</div>';
        return;
    }

    medList.innerHTML = meds.map(med => {
        const { nextTime } = getNextAlarmTime(med);
        const nextDate = new Date(nextTime);
        const nextStr = nextDate.toLocaleString('pt-BR');
        
        const historyHTML = med.history.length > 0
            ? `<div class="history-list"><strong>Histórico de tomadas:</strong><br>${
                med.history.map(t => new Date(t).toLocaleString('pt-BR')).join('<br>')
              }</div>`
            : '<div class="small">Ainda não foi tomado</div>';

        return `
            <div class="med-item">
                ${med.img ? `<img src="${med.img}" alt="${med.name}" />` : ''}
                <div class="med-meta">
                    <strong>${med.name}</strong> - ${med.qty}
                    <div class="small">Próximo alarme: ${nextStr}</div>
                    ${historyHTML}
                </div>
                <div class="actions">
                    <button class="danger-btn" onclick="deleteMed('${med.id}')">Excluir</button>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteMed(id) {
    if (confirm('Excluir este lembrete?')) {
        await deleteMedIDB(id);
        meds = meds.filter(m => m.id !== id);
        delete lastTriggered[id];
        renderList();
        alert('🗑️ Lembrete excluído com sucesso!');
    }
}

// Envia notificação via Service Worker
function sendNotification(title, body, data) {
    if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            body: body,
            data: data
        });
    } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted' && navigator.serviceWorker.controller) {
                sendNotification(title, body, data);
            }
        });
    }
}

// Checa alarmes a cada 10 segundos
setInterval(checkAlarms, 10000);

// Executa a primeira checagem imediatamente
checkAlarms();
