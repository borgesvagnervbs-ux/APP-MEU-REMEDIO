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

// Overlay do Alarme
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const overlayImg = document.getElementById('overlayImg');

// Adiciona event listeners para os botões de adiar (ajustado para funcionar com o HTML)
if(postpone30Btn) postpone30Btn.addEventListener('click', () => handlePostpone(30));
if(postpone60Btn) postpone60Btn.addEventListener('click', () => handlePostpone(60));


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

    // Garante que o CSS para os botões Adiar está no index.html e que eles estão acessíveis
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
        
        // --- NOVO: Limpa os campos de configuração dos lembretes ---
        nameInput.value = '';
        qtyInput.value = '';
        photoInput.value = '';
        lastImage = null;
        imgPreview.innerHTML = `<span class="small">Sem foto</span>`;
        remind5.checked = false;
        remind3.checked = false;
        remind1.checked = false;
        // Limpar os inputs de hora e intervalo é opcional, mas manteremos o padrão de fábrica
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

        // Condição: Tocar se estiver entre 1 minuto atrás e 10 minutos no futuro
        if (timeToAlarm <= 60000 && timeToAlarm > -60000) {
            if (lastTriggered[alarmKey] !== nextTime) {
                // Alarme encontrado, inicia o loop de repetição
                startAlarmLoop(med, nextTime);
                lastTriggered[alarmKey] = nextTime;
                return; // Para a iteração para não verificar lembretes
            }
        }
        
        // 2. VERIFICA OS LEMBRETES (5, 3 e 1 minuto antes)
        med.remind.forEach(min => {
            const reminderTime = nextTime - (min * 60000);
            const reminderKey = `${med.id}-${min}`;

            const timeToReminder = reminderTime - now;
            
            // Condição: Tocar se estiver entre 1 minuto atrás e 1 minuto no futuro
            if (timeToReminder <= 60000 && timeToReminder > -60000) {
                if (lastTriggered[reminderKey] !== nextTime) {
                    // Lembrete encontrado, inicia o loop de repetição
                    startReminderLoop(med, min, nextTime, reminderKey);
                    lastTriggered[reminderKey] = nextTime;
                    return; // Para a iteração
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

    // Função que será repetida
    const repeatAlarm = () => {
        const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
        // Frase exata: (o nome escolhido) hora de tomar (quantidade indicada) de (remédio indicado)
        const text = `${username}, hora de tomar ${med.qty} de ${med.name}.`;
        
        // Alerta na tela (Overlay)
        overlayText.innerText = text;
        overlayImg.src = med.img || 'icons/icon-512.png';
        overlay.style.display = 'flex';
        
        // Notificação e Voz/Vibração
        sendNotification('🚨 ALARME DE MEDICAMENTO', text, { medId: med.id });
        speak(text);
        if ('vibrate' in navigator) {
            navigator.vibrate([1000, 500, 1000]);
        }
        
        // O alarme só repete se estivermos dentro da margem de 10 minutos
        if (nextTime < Date.now() - (10 * 60 * 1000)) {
             stopAlarmLoop();
        }
    };
    
    repeatAlarm(); // Toca imediatamente
    activeAlarmLoop = setInterval(repeatAlarm, 10000); // Repete a cada 10 segundos
}

/**
 * Inicia o loop de repetição do lembrete.
 */
function startReminderLoop(med, min, nextTime, reminderKey) {
    if (activeReminderLoop) clearInterval(activeReminderLoop);
    // Não seta currentActiveMed, pois o botão "Tomei" só deve aparecer no alarme principal.

    // Função que será repetida
    const repeatReminder = () => {
        const username = localStorage.getItem(STORAGE_KEY_USER) || 'Você';
        // Frase exata: (o nome escolhido) faltam (minutos selecionados) para tomar (quantidade indicada) de (remédio indicado).
        const text = `${username}, faltam ${min} minutos para tomar ${med.qty} de ${med.name}.`;
        
        // Notificação e Voz
        sendNotification('⏰ Lembrete de Medicamento', text);
        speak(text);
        
        // O lembrete para assim que o alarme principal estiver prestes a tocar
        if (nextTime < Date.now() + 60000) { // Menos de 1 minuto para o alarme
             stopReminderLoop();
        }
    };
    
    repeatReminder(); // Toca imediatamente
    activeReminderLoop = setInterval(repeatReminder, 10000); // Repete a cada 10 segundos
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
}

/**
 * Para o loop de repetição do lembrete.
 */
function stopReminderLoop() {
    if (activeReminderLoop) clearInterval(activeReminderLoop);
    activeReminderLoop = null;
    if ('vibrate' in navigator) {
        // Não vibra para o lembrete, mas para a voz se o usuário clicar
        speechSynthesis.cancel();
    }
}


// === AÇÕES DO USUÁRIO NO OVERLAY ===

// Ação de "Tomei o remédio"
takenBtn.addEventListener('click', async () => {
    stopAlarmLoop();
    stopReminderLoop(); // Garante que se um lembrete estiver ativo, ele para

    if (currentActiveMed) {
        const med = currentActiveMed;
        const now = Date.now();
        
        // Registra o tempo de tomada no histórico
        med.history.push(now);
        
        // Salva a atualização no IndexedDB
        await saveMedIDB(med);
        
        // Limpa o estado do alarme e atualiza a lista
        delete lastTriggered[med.id];
        renderList();
        alert(`✅ ${med.name} registrado como tomado!`);
    } else {
         // Caso de segurança se o botão foi clicado sem um alarme ativo
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
        
        // **ATENÇÃO: Mudar o startTime/history não é o ideal para adiar!**
        // A melhor forma é adicionar o tempo de adiamento ao próximo horário de alarme
        // e marcar o último alarme como "disparado".

        // 1. Encontra o próximo horário que deveria tocar
        const { nextTime } = getNextAlarmTime(med);
        
        // 2. Define um novo 'último disparado' para forçar o próximo alarme a tocar no tempo adiado.
        // Simulamos que o último alarme tocou no tempo 'nextTime + postponeMs'
        const newNextTime = nextTime + postponeMs;
        
        // 3. Atualiza o registro 'lastTriggered' para o novo tempo
        lastTriggered[med.id] = newNextTime - 1; // Ajuste para garantir que o checkAlarms() o veja como futuro
        
        // Reinicia o loop de checagem. O próximo ciclo de checkAlarms()
        // irá recalcular o alarme e, como o lastTriggered está no futuro,
        // ele só tocará quando o tempo adiado for atingido.
        alert(`⏰ Lembrete de ${med.name} adiado por ${minutes} minutos.`);
        
        // Força a rechecagem imediata
        checkAlarms();

    } else {
        alert('Nenhum alarme ativo para adiar.');
    }
}

// Botão Testar Agora (Mantido)
document.getElementById('testNow').addEventListener('click', () => {
    if (meds.length) {
        // Toca o primeiro lembrete encontrado como um alarme principal
        const med = meds[0];
        const nextTime = Date.now() + 1000; // Toca em 1 segundo
        lastTriggered[med.id] = nextTime - 1; // Reseta o estado
        startAlarmLoop(med, nextTime);
    } else {
        alert('Cadastre um lembrete para testar o alarme.');
    }
});

// Botão Limpar Tudo
clearAllBtn.addEventListener('click', async () => {
    // ... (Mantido o código de limpar tudo) ...
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
    }
}
