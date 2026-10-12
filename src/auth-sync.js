/* ===================================================================
   Bunpou Lab — autenticação (Netlify Identity / Google) e sincronização.

   O motor pedagógico não conhece este módulo: ele apenas chama
   window.BunpouSync.notifyLocalChange() depois de gravar no localStorage.
   Se este arquivo falhar ou a rede cair, o site continua inteiro —
   o cache local é sempre a garantia primária.
   =================================================================== */
import {
  getUser, oauthLogin, handleAuthCallback, logout as identityLogout, onAuthChange, AUTH_EVENTS
} from '@netlify/identity';
/* Namespace ao lado dos imports nomeados: refreshSession é API pública, mas um
   import nomeado que sumisse numa versão futura quebraria o BUILD inteiro.
   Aqui a ausência apenas desliga a restauração automática. */
import * as Identity from '@netlify/identity';

const ENDPOINT   = '/.netlify/functions/progress';
const META_KEY   = 'bunpou-lab-sync-v1:';   // + user.id  (só metadados técnicos)
const ANON_KEY   = 'bunpou-lab-v2';
/* Chave em que o próprio GoTrue guarda a sessão do navegador (inclui o
   refresh token). Nunca escrevemos conteúdo novo aqui: só devolvemos, sem
   alterar um byte, o que o SDK apagou por engano. */
const GOTRUE_KEY = 'gotrue.user';
const DEBOUNCE   = 2000;
const MAX_BYTES  = 1024 * 1024;

const App = () => window.BunpouApp;

/* Estado técnico, deliberadamente fora de S: S guarda só o progresso
   pedagógico e nunca deve conter dados de autenticação. */
const sync = {
  user: null,
  // anonymous|loading|synced|dirty|offline|conflict|error|auth-required
  status: 'anonymous',
  /* Enquanto false, "sem usuário" ainda não significa "deslogado": é só a
     restauração da sessão em andamento. A UI não pode concluir nada antes. */
  authReady: false,
  revision: 0,
  lastSyncedAt: null,
  inFlight: false
};
let pendingPush = false;
let debounceTimer = null;
let conflictSnapshot = null;   // versão do servidor aguardando decisão
let recovering = false;        // uma tentativa de renovação por vez

/* Só é usuário quem tem um id string não vazio. Um evento de autenticação
   jamais pode virar um "perfil" — daí a checagem antes de tocar em PROFILE. */
const isValidUser = u =>
  !!u && typeof u === 'object' && typeof u.id === 'string' && u.id.length > 0;

/* Estados que suspendem qualquer envio automático e só saem por ação
   explícita (reautenticar, resolver conflito). Nada de rede os altera. */
const isBlocking = () => sync.status === 'auth-required' || sync.status === 'conflict';

/* ---------------- restauração da sessão ----------------
   O SDK grava a sessão do navegador em localStorage['gotrue.user'] (que
   contém o refresh token) e escreve nf_jwt/nf_refresh SEM expires — ou seja,
   como cookies de sessão, que o navegador descarta ao fechar. No retorno,
   getUser() encontra a sessão no localStorage, não encontra o cookie e chama
   currentUser.clearSession(): destrói o refresh token e devolve null. Daí o
   logout "entre dias".

   refreshSession() é o caminho suportado de volta: lê a sessão do
   localStorage (não depende do cookie), troca o refresh token por um access
   token novo e REESCREVE nf_jwt. Por isso ela roda ANTES de getUser(). */
const refreshFn = () =>
  (Identity && typeof Identity.refreshSession === 'function') ? Identity.refreshSession : null;

async function refreshIdentitySession() {
  const fn = refreshFn();
  if (!fn) return null;
  try { return await fn(); }
  catch (e) { console.warn('[bunpou] renovação de sessão falhou:', e && e.message); return null; }
}

const readGotrue  = () => { try { return localStorage.getItem(GOTRUE_KEY); } catch { return null; } };
const writeGotrue = v => { try { if (v != null) localStorage.setItem(GOTRUE_KEY, v); } catch {} };

/* Devolve o usuário autenticado sem jamais deixar uma sessão recuperável ser
   descartada. Se getUser() apagar a chave do GoTrue, os MESMOS bytes voltam
   ao MESMO lugar — nenhum token é criado, copiado para outro storage ou
   prolongado — e a renovação é tentada uma vez. Fora esse caso o fluxo é o
   normal do SDK. */
async function restoreSession() {
  const before = readGotrue();
  await refreshIdentitySession();
  let user = null;
  try { user = await getUser(); } catch (e) { console.warn('Identity indisponível:', e && e.message); }
  if (user || !before) return user;

  if (readGotrue() !== before) {
    writeGotrue(before);
    if (await refreshIdentitySession()) {
      try { user = await getUser(); } catch {}
    }
    /* Sem sucesso agora (offline, ou token ainda longe de expirar e sem
       cookie), o refresh token continua no lugar para a próxima visita —
       melhor um login a mais hoje do que uma sessão destruída para sempre. */
    if (!user) writeGotrue(before);
  }
  return user;
}

/* ---------------- metadados de sincronização por conta ---------------- */
const metaKey = id => META_KEY + id;
function readMeta(id) {
  try {
    const raw = localStorage.getItem(metaKey(id));
    if (!raw) return { revision: 0, lastSyncedAt: 0, dirty: false };
    const m = JSON.parse(raw);
    return {
      revision: Number.isFinite(m.revision) ? m.revision : 0,
      lastSyncedAt: Number.isFinite(m.lastSyncedAt) ? m.lastSyncedAt : 0,
      dirty: !!m.dirty
    };
  } catch { return { revision: 0, lastSyncedAt: 0, dirty: false }; }
}
function writeMeta(id, m) {
  try { localStorage.setItem(metaKey(id), JSON.stringify(m)); } catch {}
}
function patchMeta(id, patch) {
  const m = { ...readMeta(id), ...patch };
  writeMeta(id, m);
  sync.revision = m.revision;
  sync.lastSyncedAt = m.lastSyncedAt || null;
  return m;
}

/* ---------------- UI ---------------- */
let uiQueued = false;
function setStatus(next) {
  if (sync.status === next) return;
  sync.status = next;
  if (uiQueued) return;
  uiQueued = true;
  queueMicrotask(() => { uiQueued = false; try { App().render(); } catch {} });
}

function choiceModal(title, body, buttons) {
  const ov = document.createElement('div');
  ov.className = 'overlay show';
  ov.innerHTML =
    `<div class="modal"><h3></h3><p></p>
       <div class="row" style="justify-content:flex-end"></div></div>`;
  ov.querySelector('h3').textContent = title;
  ov.querySelector('p').textContent = body;
  const row = ov.querySelector('.row');
  buttons.forEach(b => {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.kind || 'btn-ghost');
    el.textContent = b.label;
    /* O relógio de sessão fica pausado enquanto existe um `.overlay.show`.
       Ao fechar, a reconciliação tem de ser síncrona: um botão sem `run`
       (Cancelar) não dispara setStatus, e mesmo os que disparam só renderizam
       num microtask — se o usuário trocasse de app antes disso, o intervalo
       ficaria pausado sem modal nenhum na tela.

       A ordem é deliberada: `b.run()` PRIMEIRO, reconciliação DEPOIS. Alguns
       botões (keepLocal) abrem um segundo modal, e reconciliar antes disso
       religaria a contagem justo quando outro overlay vai aparecer. Rodando
       por último, render() lê o DOM já definitivo e acerta os dois casos.

       Não chamamos clockPulse() daqui: render() já começa por ele, e assim
       esta camada continua sem conhecer o relógio. */
    el.onclick = () => {
      ov.remove();
      try { b.run && b.run(); } catch (e) { console.error(e); }
      try { App().render(); } catch {}
    };
    row.appendChild(el);
  });
  document.body.appendChild(ov);
}

/* ---------------- transporte ---------------- */
async function getRemote() {
  const res = await fetch(ENDPOINT, { method: 'GET', credentials: 'same-origin' });
  if (!res.ok) { const e = new Error('GET ' + res.status); e.status = res.status; throw e; }
  return res.json();
}

/* Concorrência otimista: o PUT carrega a revisão em que este dispositivo se
   baseou. O servidor só grava se ela ainda for a atual; caso contrário
   devolve 409 e nenhum dos lados é descartado. */
async function push(baseRevision) {
  const id = sync.user && sync.user.id;
  if (!id) return;
  if (sync.inFlight) { pendingPush = true; return; }   // fila: um PUT por vez

  const progress = App().getState();
  const body = JSON.stringify({ progress, baseRevision });
  if (body.length > MAX_BYTES) { setStatus('error'); console.error('Snapshot grande demais'); return; }

  sync.inFlight = true;
  setStatus('loading');
  try {
    const res = await fetch(ENDPOINT, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body
    });
    if (res.status === 409) {
      const cur = await res.json().catch(() => null);
      enterConflict(cur);
      return;
    }
    if (res.status === 401) { enterAuthRequired(); return; }
    if (!res.ok) throw new Error('PUT ' + res.status);
    const j = await res.json();
    patchMeta(id, { revision: j.revision, lastSyncedAt: Date.now(), dirty: false });
    setStatus('synced');
  } catch (err) {
    patchMeta(id, { dirty: true });
    setStatus(navigator.onLine === false ? 'offline' : 'dirty');
    console.warn('Sincronização adiada:', err && err.message);
  } finally {
    sync.inFlight = false;
    if (pendingPush) { pendingPush = false; schedulePush(0); }
  }
}

function schedulePush(delay) {
  const id = sync.user && sync.user.id;
  if (!id || isBlocking()) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => push(readMeta(id).revision), delay === undefined ? DEBOUNCE : delay);
}

/* 401 = a sessão do Identity expirou. Isso NÃO é logout: o contexto da conta
   é integralmente preservado (cache, revisão, pendências) e os envios param
   até haver nova autenticação — do contrário entraríamos no ciclo
   401 -> dirty -> PUT -> 401. Estudar localmente continua funcionando. */
async function enterAuthRequired() {
  const id = sync.user && sync.user.id;
  if (id) patchMeta(id, { dirty: true });   // o que estava pendente continua pendente
  clearTimeout(debounceTimer); debounceTimer = null;
  pendingPush = false;
  setStatus('auth-required');

  /* Antes de exigir um login manual, tenta o caminho suportado: renovar a
     sessão e refazer a reconciliação. Só pede Google de novo se isso falhar.
     `recovering` impede que o 401 da própria retentativa reabra o ciclo. */
  if (!id || recovering) return;
  recovering = true;
  try {
    if (!await refreshIdentitySession()) return;
    let user = null;
    try { user = await getUser(); } catch {}
    if (isValidUser(user) && user.id === id) await enterAccount(user);
  } finally { recovering = false; }
}

/* ---------------- conflito ---------------- */
function enterConflict(remote) {
  conflictSnapshot = remote || null;
  setStatus('conflict');
  const rev = remote && remote.revision;
  choiceModal(
    'Há mudanças mais recentes em outro dispositivo',
    'Este dispositivo tem alterações que não foram enviadas, e a nuvem já mudou' +
    (rev ? ` (revisão ${rev})` : '') + '. Nada foi descartado — escolha qual versão manter.',
    [
      { label: 'Cancelar' },
      { label: 'Manter deste dispositivo', run: keepLocal },
      { label: 'Usar versão da nuvem', kind: 'btn-primary', run: adoptConflictRemote }
    ]
  );
}
function adoptConflictRemote() {
  const id = sync.user && sync.user.id;
  if (!conflictSnapshot || !id) return;
  App().replaceState(conflictSnapshot.progress);
  patchMeta(id, { revision: conflictSnapshot.revision, lastSyncedAt: Date.now(), dirty: false });
  conflictSnapshot = null;
  setStatus('synced');
}
function keepLocal() {
  const id = sync.user && sync.user.id;
  if (!conflictSnapshot || !id) return;
  choiceModal('Substituir a versão da nuvem?',
    'O progresso do outro dispositivo será substituído pelo deste. Isso não pode ser desfeito.',
    [{ label: 'Cancelar' },
     { label: 'Substituir', kind: 'btn-shu', run: () => {
        const base = conflictSnapshot.revision;
        conflictSnapshot = null;
        sync.status = 'dirty';           // sai do bloqueio de conflito
        push(base);
     } }]);
}

/* ---------------- reconciliação de entrada ---------------- */
function readAnonymous() {
  try {
    const raw = localStorage.getItem(ANON_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function reconcile() {
  const id = sync.user.id;
  const meta = readMeta(id);
  let remote;
  try {
    remote = await getRemote();
  } catch (err) {
    if (err.status === 401) { enterAuthRequired(); return; }
    setStatus('offline');
    return;
  }

  if (!remote.exists) {
    // Conta nova na nuvem.
    if (App().isSignificant(App().getState())) { await push(0); return; }
    const anon = readAnonymous();
    if (anon && App().isSignificant(App().hydrate(anon))) {
      // Caso A: só o perfil anônimo tem progresso — a decisão é do usuário.
      choiceModal('Encontramos progresso salvo neste dispositivo',
        'Deseja usar esse progresso nesta conta? O perfil sem login continuará existindo de qualquer forma.',
        [{ label: 'Cancelar', run: () => setStatus('dirty') },
         { label: 'Começar esta conta sem importar', run: () => push(0) },
         { label: 'Usar este progresso', kind: 'btn-primary', run: () => {
             App().replaceState(anon);
             push(0);
         } }]);
      return;
    }
    await push(0);   // Caso B: conta e dispositivo novos
    return;
  }

  // Já existe snapshot na nuvem.
  if (meta.dirty) {
    if (meta.revision === remote.revision) { await push(meta.revision); return; }
    enterConflict(remote);   // ambos mudaram
    return;
  }
  if (!remote.progress || typeof remote.progress !== 'object') {
    console.error('progress_json remoto inválido; mantendo cache local.');
    setStatus('error');
    return;
  }
  App().replaceState(remote.progress);
  patchMeta(id, { revision: remote.revision, lastSyncedAt: Date.now(), dirty: false });
  setStatus('synced');
}

async function enterAccount(user) {
  /* Sem id válido não se troca de perfil, não se escreve em lugar nenhum e,
     sobretudo, não se cai no perfil anônimo por acidente. */
  if (!isValidUser(user)) {
    console.error('[bunpou] evento de autenticação sem user.id válido; perfil mantido.', user);
    setStatus('error');
    return;
  }
  if (!App().useProfile(user.id)) {   // troca para o cache daquela conta
    console.error('[bunpou] troca de perfil recusada para o id', user.id);
    setStatus('error');
    return;
  }
  sync.user = user;
  const meta = readMeta(user.id);
  sync.revision = meta.revision;
  sync.lastSyncedAt = meta.lastSyncedAt || null;
  setStatus('loading');
  await reconcile();
}

/* Logout observado por evento (outra aba, sessão encerrada pelo Identity).
   Limpa apenas memória: o cache da conta e a linha do banco permanecem. */
function handleExternalLogout() {
  clearTimeout(debounceTimer); debounceTimer = null;
  pendingPush = false; conflictSnapshot = null;
  sync.user = null; sync.revision = 0; sync.lastSyncedAt = null;
  sync.status = 'anonymous';
  App().useProfile(null);             // anônimo deliberado
}

/* ---------------- API pública ---------------- */
const api = {
  getState: () => ({ ...sync }),
  login() { try { oauthLogin('google'); } catch (e) { console.error(e); App().toast('Não foi possível iniciar o login.'); } },
  /* Logout VOLUNTÁRIO: aqui a volta ao perfil anônimo é intencional.
     Diferente de 401, que preserva o contexto da conta para reautenticação. */
  async logout() {
    const id = sync.user && sync.user.id;
    /* Tenta enviar o pendente, mas falha de rede não pode prender o logout.
       Em estado bloqueante não se envia nada: com a sessão expirada o PUT
       seria rejeitado, e em conflito ele levaria 409 e reabriria a modal
       no meio do logout. O pendente fica no cache da conta para o próximo
       login, quando a reconciliação normal decide o que fazer. */
    if (id && !isBlocking() && readMeta(id).dirty) {
      try { await push(readMeta(id).revision); } catch {}
    }
    try { await identityLogout(); } catch (e) { console.warn(e); }
    // o cache da conta e a linha do banco permanecem intactos
    clearTimeout(debounceTimer); debounceTimer = null;
    pendingPush = false; conflictSnapshot = null;
    sync.user = null; sync.revision = 0; sync.lastSyncedAt = null;
    sync.status = 'anonymous';
    App().useProfile(null);           // volta ao perfil anônimo
  },
  syncNow() {
    const id = sync.user && sync.user.id;
    if (!id) return;
    if (sync.status === 'auth-required') { api.login(); return; }   // reautenticar antes
    if (sync.status === 'conflict') { enterConflict(conflictSnapshot); return; }
    schedulePush(0);
  },
  resolveConflict() { if (conflictSnapshot) enterConflict(conflictSnapshot); },
  /* chamado por save() do app depois de gravar no localStorage */
  notifyLocalChange() {
    const id = sync.user && sync.user.id;
    if (!id) return;
    patchMeta(id, { dirty: true });   // pendência é registrada em qualquer estado
    if (isBlocking()) return;         // mas nada é enviado enquanto bloqueado
    setStatus('dirty'); schedulePush();
  }
};
window.BunpouSync = api;

/* ---------------- inicialização ---------------- */
async function boot() {
  try { App().render(); } catch {}          // pinta "Verificando…" enquanto authReady é false
  try { await handleAuthCallback(); } catch (e) { console.warn('Callback de login:', e && e.message); }
  const user = await restoreSession();
  /* A restauração terminou: só a partir daqui "sem usuário" quer dizer
     deslogado, e a UI pode dizer isso. */
  sync.authReady = true;
  if (user) await enterAccount(user);
  else { sync.status = 'anonymous'; try { App().render(); } catch {} }

  /* A assinatura é (event, user) — o primeiro argumento é uma string como
     'login'/'logout'. Tratá-lo como usuário faria useProfile('login'.id),
     ou seja, undefined, e a conta passaria a gravar na chave anônima. */
  try {
    onAuthChange((event, user) => {
      if (isValidUser(user)) {
        if (recovering) { sync.user = user; return; }   // a recuperação em curso conclui sozinha
        /* Reautenticar a MESMA conta é justamente a saída de auth-required:
           tratar como no-op deixaria a sincronização suspensa para sempre. */
        if (!sync.user || sync.user.id !== user.id || sync.status === 'auth-required') {
          enterAccount(user);
        } else {
          sync.user = user;           // token_refresh/user_updated: só atualiza os dados
        }
        return;
      }
      /* Só LOGOUT encerra a conta. O SDK também emite LOGIN com user null
         (outra aba gravou gotrue.user antes de o cliente montar o usuário);
         tratar isso como logout trocaria o perfil no meio de uma sessão de
         estudo e passaria a gravar sobre o perfil anônimo. */
      if (event === AUTH_EVENTS.LOGOUT) {
        if (sync.user) handleExternalLogout();
        return;
      }
      console.warn('[bunpou] evento de autenticação sem usuário, ignorado:', event);
    });
  } catch (e) { console.warn('onAuthChange indisponível:', e && e.message); }

  window.addEventListener('online', () => {
    const id = sync.user && sync.user.id;
    if (!id || !readMeta(id).dirty) return;
    if (isBlocking()) return;
    schedulePush(0);
  });
  /* Perder a conexão não pode apagar um estado bloqueante: se 'offline'
     substituísse 'auth-required' ou 'conflict', a proteção contra novos PUTs
     sumiria assim que a rede voltasse. Estar offline é secundário aqui —
     nesses dois estados já não se envia nada de qualquer forma. */
  window.addEventListener('offline', () => {
    if (!sync.user || isBlocking()) return;
    setStatus('offline');
  });
}

if (window.BunpouApp) boot();
else window.addEventListener('bunpou-app-ready', boot, { once: true });
