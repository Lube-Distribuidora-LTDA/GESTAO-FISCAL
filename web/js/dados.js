/* =============================================================================
 * dados.js — o motor do navegador (Gestão Fiscal · tributação e preço por região).
 *
 * O pacote do painel (fiscal.painel_dados(), comprimido pela carga) chega uma vez,
 * fica guardado no navegador (IndexedDB) e daí em diante TODO filtro e soma é feito
 * aqui. Abre na hora: se a versão guardada é a mesma do banco, nem baixa.
 *
 * Estruturas (todas em L):
 *   L.R   regiões escolhidas (as do ENV FISCAL_REGIOES)
 *   L.P   produtos de revenda não excluídos
 *   L.C   a matriz produto × região: célula c = pi * L.R.n + ri
 *         s  situação (0 completo, 1 sem tributação, 2 sem preço, 3 sem os dois, 4 fora da tabela)
 *         st CODST da região (0 = sem) · pv preço de venda (0 = sem)
 *         vv venda dos últimos meses na região (R$) · vn linhas · vd dia da última venda
 *   L.T   tipos de tributação (PCTRIBUT) por CODST
 * Filtros guardam CÓDIGOS (codprod, nº da região, CODST...), nunca índices: um link
 * copiado continua valendo depois de uma carga nova.
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;

/* ------------------------------ situações ------------------------------ */
/* "Região sem tributação" = 1, 3 e 4. "Região sem preço de venda" = 2, 3 e 4. */
L.SITUACOES = [
  { id: 0, nome: "Completo",                   curto: "Completo",    sigla: "✓", cor: "--ok",      dica: "tem tributação e preço de venda na região" },
  { id: 1, nome: "Sem tributação",             curto: "Sem trib.",   sigla: "T", cor: "--perigo",  dica: "tem preço de venda e falta a tributação (CODST) na região" },
  { id: 2, nome: "Sem preço de venda",         curto: "Sem preço",   sigla: "P", cor: "--atencao", dica: "tem tributação e falta o preço de venda na região" },
  { id: 3, nome: "Sem tributação e sem preço", curto: "Sem os dois", sigla: "—", cor: "--d3",      dica: "a linha existe na 201, mas sem tributação e sem preço" },
  { id: 4, nome: "Fora da tabela da região",   curto: "Fora da 201", sigla: "×", cor: "--d8",      dica: "o produto não tem linha na tabela de preço da região (nunca foi precificado nela)" },
];
L.SEM_TRIB = [false, true, false, true, true];
L.SEM_PRECO = [false, false, true, true, true];
L.corSit = function (s) { return L.cssVar(L.SITUACOES[s].cor); };
L.tagSit = function (s) { var x = L.SITUACOES[s]; return '<span class="tag sit" style="--c:var(' + x.cor + ')">' + L.esc(x.curto) + "</span>"; };
L.FAIXAS_CAD = [
  { id: 0, nome: "Cadastrado nos últimos 30 dias", ate: 30 }, { id: 1, nome: "Cadastrado há 31 a 90 dias", ate: 90 },
  { id: 2, nome: "Cadastrado há 91 dias a 1 ano", ate: 365 }, { id: 3, nome: "Cadastrado há mais de 1 ano", ate: 1e9 },
  { id: 4, nome: "Sem data de cadastro", ate: null },
];

/* ------------------------------ datas (sem fuso: tudo em UTC) ------------------------------ */
L.diaDeIso = function (iso) { return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5); };
L.isoDeDia = function (d) { return new Date(d * 864e5).toISOString().slice(0, 10); };
L.fDia = function (d) { return d == null || d < 0 ? "" : L.fData(L.isoDeDia(d)); };
L.hojeDia = function () { var n = new Date(); return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / 864e5); };

/* ------------------------------ carga do pacote ------------------------------ */
var IDB = "fiscal-lube", LOJA = "pacote";
function idbAbrir() {
  return new Promise(function (ok, erro) {
    if (!window.indexedDB) return erro(new Error("sem IndexedDB"));
    var r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = function () { r.result.createObjectStore(LOJA); };
    r.onsuccess = function () { ok(r.result); }; r.onerror = function () { erro(r.error); };
  });
}
function idbLer() {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var q = db.transaction(LOJA, "readonly").objectStore(LOJA).get("atual");
    q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { ok(null); };
  }); }).catch(function () { return null; });
}
function idbGravar(obj) {
  return idbAbrir().then(function (db) { return new Promise(function (ok) {
    var tx = db.transaction(LOJA, "readwrite"); tx.objectStore(LOJA).put(obj, "atual");
    tx.oncomplete = function () { ok(true); }; tx.onerror = function () { ok(false); };
  }); }).catch(function () { return false; });
}
function erroHttp(r, oque) {
  return r.json().catch(function () { return {}; }).then(function (j) {
    if (r.status === 401) throw new Error("Sua sessão do Painel Lube expirou. Entre de novo pelo portal.");
    throw new Error("Não foi possível ler " + oque + " (" + r.status + (j && j.mensagem ? ": " + j.mensagem : j && j.erro ? ": " + j.erro : "") + ").");
  });
}
function baixarPacote(versao, aoProgresso) {
  return fetch("api/dados?v=" + encodeURIComponent(versao || "x"), { cache: "no-store" }).then(function (r) {
    if (!r.ok) return erroHttp(r, "o pacote de dados");
    var total = +(r.headers.get("Content-Length") || 0), lido = 0, corpo = r.body;
    if (aoProgresso && corpo && corpo.getReader) {
      corpo = corpo.pipeThrough(new TransformStream({ transform: function (ch, ctl) { lido += ch.byteLength; aoProgresso(lido, total); ctl.enqueue(ch); } }));
    }
    if (r.headers.get("X-Pacote") === "gzip" && window.DecompressionStream) corpo = corpo.pipeThrough(new DecompressionStream("gzip"));
    return new Response(corpo).text();
  }).then(function (txt) { return JSON.parse(txt); });
}

/* Abre o painel. Com cópia guardada neste computador, a tela abre NA HORA com ela e a
   versão do banco é conferida por trás (o banco pode levar 20 s para responder; quem abre
   não espera por isso). Chegou carga nova: baixa por trás, guarda, e o botão Atualizar
   acende. Sem cópia (primeira vez), aí sim espera o banco. */
L.carregarTudo = function (aoAviso) {
  var aviso = aoAviso || function () {};
  return idbLer().then(function (copia) {
    if (copia && copia.pacote) {
      L.ORIGEM = "copia";
      setTimeout(function () { conferirPorTras(copia.versao); }, 400);
      return preparar(copia.pacote, copia.versao);
    }
    aviso("Baixando os dados (só na primeira vez)…");
    return L.versaoNoBanco().then(function (ver) {
      return baixarPacote(ver.versao, function (l, t) { aviso("Baixando os dados… " + (t ? Math.round(l / t * 100) + "%" : L.fNum(l / 1048576, 1) + " MB")); })
        .then(function (pac) { L.ORIGEM = "banco"; idbGravar({ versao: ver.versao, pacote: pac }); return preparar(pac, ver.versao); });
    });
  });
};
function conferirPorTras(versaoCopia) {
  L.versaoNoBanco().then(function (ver) {
    if (!ver || ver.versao === versaoCopia || ver.versao === "calculado") { L.ORIGEM = "copia-ok"; L.emitir("origem"); return; }
    return baixarPacote(ver.versao).then(function (pac) { return idbGravar({ versao: ver.versao, pacote: pac }); }).then(function () {
      L.NOVA_CARGA = ver; L.emitir("origem");
      L.toast("Chegou a carga das " + L.fDataHora(ver.gerado_em) + ": clique em Atualizar (o relógio, no alto) para ver", "ok");
    });
  }).catch(function () { L.ORIGEM = "offline"; L.emitir("origem"); L.toast("Sem conexão com o servidor agora: mostrando os dados guardados neste computador", "erro"); });
}
L.versaoNoBanco = function () { return fetch("api/versao?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : erroHttp(r, "a versão dos dados"); }); };

/* ------------------------------ preparo das estruturas ------------------------------ */
function idx(lista) { var m = new Map(); lista.forEach(function (x, i) { m.set(x[0], i); }); return m; }

function preparar(J, versao) {
  var M = L.META = J.meta; M.versao = versao;
  var hoje = L.hojeDia();

  var D = L.D = { fornecedores: J.fornecedores, deptos: J.deptos, secoes: J.secoes };
  D.iFor = idx(J.fornecedores); D.iDep = idx(J.deptos); D.iSec = idx(J.secoes);

  // ---- tributações
  var T = L.T = new Map();
  J.trib.forEach(function (t) { T.set(t[0], { cod: t[0], msg: (t[1] || "").trim(), cst: t[2] || "", aliq: t[3], cfop: t[4], cfopi: t[5], obs: (t[6] || "").trim(), iva: t[7], red: t[8] }); });

  // ---- regiões
  var nR = J.regioes.length;
  var R = L.R = { n: nR, num: new Int32Array(nR), nome: new Array(nR), uf: new Array(nR), fil: new Array(nR), ativa: new Uint8Array(nR),
                  cliA: new Int32Array(nR), cli12: new Int32Array(nR), vL: new Int32Array(nR), vV: new Float64Array(nR), vP: new Int32Array(nR), ult: new Int32Array(nR).fill(-1), i: new Map() };
  J.regioes.forEach(function (r, i) {
    R.num[i] = r[0]; R.nome[i] = L.titulo(r[1] || "Região " + r[0]); R.uf[i] = r[2] || ""; R.fil[i] = r[3] == null ? "" : String(r[3]); R.ativa[i] = r[4];
    R.cliA[i] = r[5] || 0; R.cli12[i] = r[6] || 0; R.vL[i] = r[7] || 0; R.vV[i] = r[8] || 0; R.vP[i] = r[9] || 0; R.ult[i] = r[10] ? L.diaDeIso(r[10]) : -1; R.i.set(r[0], i);
  });
  var ufs = []; R.uf.forEach(function (u) { if (u && ufs.indexOf(u) < 0) ufs.push(u); }); ufs.sort();
  L.UFS = ufs;

  // ---- produtos
  var fotos = new Set(J.fotos || []), nP = J.produtos.length;
  var P = L.P = { n: nP, cod: new Int32Array(nP), desc: new Array(nP), emb: new Array(nP), un: new Array(nP), forn: new Int32Array(nP), dep: new Int32Array(nP), sec: new Int32Array(nP),
                  fl: new Uint8Array(nP), ncm: new Array(nP), est: new Float64Array(nP), cad: new Int32Array(nP).fill(-1), faixaCad: new Uint8Array(nP), foto: new Uint8Array(nP),
                  vV: new Float64Array(nP), vL: new Int32Array(nP), i: new Map() };
  J.produtos.forEach(function (r, i) {
    P.cod[i] = r[0]; P.desc[i] = r[1] || ("Produto " + r[0]); P.emb[i] = r[2] || ""; P.un[i] = r[3] || "";
    P.forn[i] = r[4] == null ? -1 : r[4]; P.dep[i] = r[5] == null ? -1 : r[5]; P.sec[i] = r[6] == null ? -1 : r[6];
    P.fl[i] = r[7]; P.ncm[i] = r[9] || ""; P.est[i] = r[10] || 0; P.foto[i] = fotos.has(r[0]) ? 1 : 0; P.i.set(r[0], i);
    if (r[11]) { P.cad[i] = L.diaDeIso(r[11]); var dias = hoje - P.cad[i]; P.faixaCad[i] = dias <= 30 ? 0 : dias <= 90 ? 1 : dias <= 365 ? 2 : 3; } else P.faixaCad[i] = 4;
  });

  // ---- matriz produto × região
  var n = nP * nR;
  if (J.m.length !== nP || J.st.length !== n || J.pv.length !== n) throw new Error("Pacote incompleto: a matriz não fecha com " + nP + " produtos × " + nR + " regiões. Avise o TI.");
  var C = L.C = { n: n, s: new Uint8Array(n), st: Int32Array.from(J.st), pv: Float64Array.from(J.pv), vv: new Float64Array(n), vn: new Int32Array(n), vd: new Int32Array(n).fill(-1) };
  for (var p = 0; p < nP; p++) { var linha = J.m[p]; for (var k = 0; k < nR; k++) C.s[p * nR + k] = linha.charCodeAt(k) - 48; }
  var V = J.vd || { p: [] }, semCel = 0;
  for (var j = 0; j < V.p.length; j++) {
    var pi = P.i.get(V.p[j]), ri = R.i.get(V.r[j]);
    if (pi == null || ri == null) { semCel++; continue; }
    var c = pi * nR + ri;
    C.vv[c] = V.v[j] || 0; C.vn[c] = V.n[j] || 0; C.vd[c] = V.d[j] ? L.diaDeIso(V.d[j]) : -1;
    P.vV[pi] += C.vv[c]; P.vL[pi] += C.vn[c];
  }
  L.TRIB_INEXISTENTE = 0;
  for (var q = 0; q < n; q++) if (C.st[q] && !T.has(C.st[q])) L.TRIB_INEXISTENTE++;

  construirRegistro();
  cacheFiltro.clear();
  return J;
}

/* ------------------------------ registro de dimensões ------------------------------ */
/* Cada dimensão sabe: listar opções (código + nome), dar o nome de um código e em que
   nível ela filtra: região (r), produto (p) ou célula (c). */
var MIN = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1, a: 1, o: 1, p: 1, para: 1, com: 1 };
function titulo(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().split(" ").map(function (w, i) {
    if (!w) return w; if (i && MIN[w]) return w;
    if (/^(wms|nf|rca|sac|cd|ltda|me|ba|rj|es|sp|mg|mei|icms|pis|st|ion|cofins|p\/c|zfm)$/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}
L.titulo = titulo;
L.nomeRegiao = function (ri) { return L.R.num[ri] + " · " + L.R.nome[ri]; };
L.descTrib = function (cod) { var t = L.T.get(+cod); return t ? t.msg || "Tributação " + cod : "CODST " + cod + " (não existe na 514)"; };

function construirRegistro() {
  var D = L.D, P = L.P, R = L.R;
  var X = L.DIM = {};
  function def(k, rot, icone, nivel, cfg) { X[k] = Object.assign({ chave: k, rot: rot, icone: icone, nivel: nivel }, cfg); }
  def("regiao", "Região", "pino", "r", {
    todos: function () { var o = []; for (var i = 0; i < R.n; i++) o.push({ id: R.num[i], t: L.nomeRegiao(i), s: R.uf[i] + (R.vL[i] ? "" : " · sem venda") }); return o; },
    nome: function (c) { var i = R.i.get(+c); return i == null ? "Região " + c : L.nomeRegiao(i); },
    curto: function (c) { return String(c); }, de: function (ri) { return R.num[ri]; } });
  def("uf", "UF da região", "pino", "r", {
    todos: function () { return L.UFS.map(function (u, i) { return { id: i, t: u, s: R.uf.filter(function (x) { return x === u; }).length + " regiões" }; }); },
    nome: function (c) { return L.UFS[+c] || "—"; }, de: function (ri) { return L.UFS.indexOf(R.uf[ri]); } });
  def("filialReg", "Filial da região", "loja", "r", {
    todos: function () { var vis = {}, o = []; for (var i = 0; i < R.n; i++) { var f = +R.fil[i] || 0; if (!vis[f]) { vis[f] = 1; o.push({ id: f, t: f === 99 ? "Filial 99 · todas" : "Filial " + f }); } } return o.sort(function (a, b) { return a.id - b.id; }); },
    nome: function (c) { return +c === 99 ? "Filial 99 · todas" : "Filial " + c; }, de: function (ri) { return +R.fil[ri] || 0; } });
  def("produto", "Produto", "caixa", "p", {
    todos: function () { var o = new Array(P.n); for (var i = 0; i < P.n; i++) o[i] = { id: P.cod[i], t: P.desc[i], s: P.cod[i] + (P.emb[i] ? " · " + P.emb[i] : "") }; return o; },
    nome: function (c) { var i = P.i.get(+c); return i == null ? "Produto " + c : P.desc[i]; },
    sub: function (c) { var i = P.i.get(+c); return i == null ? "" : "cód. " + c + (P.emb[i] ? " · " + P.emb[i] : ""); },
    de: function (pi) { return P.cod[pi]; } });
  def("fornecedor", "Fornecedor", "caixa", "p", {
    todos: function () { return D.fornecedores.map(function (f) { return { id: f[0], t: titulo(f[1] || "Fornecedor " + f[0]), s: "cód. " + f[0] }; }); },
    nome: function (c) { var i = D.iFor.get(+c); return i == null ? "Sem fornecedor" : titulo(D.fornecedores[i][1] || "Fornecedor " + c); },
    de: function (pi) { return P.forn[pi]; } });
  def("depto", "Departamento", "camadas", "p", {
    todos: function () { return D.deptos.map(function (d) { return { id: d[0], t: titulo(d[1] || "Depto " + d[0]) }; }); },
    nome: function (c) { var i = D.iDep.get(+c); return i == null ? "Sem departamento" : titulo(D.deptos[i][1] || "Depto " + c); },
    de: function (pi) { return P.dep[pi]; } });
  def("secao", "Seção", "etiqueta", "p", {
    todos: function () { return D.secoes.map(function (s) { var di = D.iDep.get(s[2]); return { id: s[0], t: titulo(s[1] || "Seção " + s[0]), s: di == null ? "" : titulo(D.deptos[di][1]) }; }); },
    nome: function (c) { var i = D.iSec.get(+c); return i == null ? "Sem seção" : titulo(D.secoes[i][1] || "Seção " + c); },
    de: function (pi) { return P.sec[pi]; } });
  def("ncm", "NCM", "tabela", "p", {
    todos: function () { var cont = new Map(); for (var i = 0; i < P.n; i++) { var k = +P.ncm[i] || 0; cont.set(k, (cont.get(k) || 0) + 1); }
      return Array.from(cont.keys()).sort(function (a, b) { return a - b; }).map(function (k) { return { id: k, t: k ? fNcm(k) : "Sem NCM", s: L.fInt(cont.get(k)) + " produtos" }; }); },
    nome: function (c) { return +c ? "NCM " + fNcm(+c) : "Sem NCM"; }, de: function (pi) { return +P.ncm[pi] || 0; } });
  def("situacaoProd", "Situação do produto", "verificar", "p", {
    todos: function () { return [{ id: 0, t: "Ativo" }, { id: 1, t: "Fora de linha" }]; },
    nome: function (c) { return +c ? "Fora de linha" : "Ativo"; }, de: function (pi) { return P.fl[pi]; } });
  def("estoque", "Estoque", "armazem", "p", {
    todos: function () { return [{ id: 1, t: "Com estoque" }, { id: 0, t: "Sem estoque" }]; },
    nome: function (c) { return +c ? "Com estoque" : "Sem estoque"; }, de: function (pi) { return P.est[pi] > 0 ? 1 : 0; } });
  def("venda", "Venda do produto", "dinheiro", "p", {
    todos: function () { return [{ id: 1, t: "Vendeu nos últimos " + L.META.meses_venda + " meses" }, { id: 0, t: "Não vendeu nos últimos " + L.META.meses_venda + " meses" }]; },
    nome: function (c) { return +c ? "Vendeu (" + L.META.meses_venda + " meses)" : "Não vendeu (" + L.META.meses_venda + " meses)"; }, de: function (pi) { return P.vL[pi] > 0 ? 1 : 0; } });
  def("cadastro", "Cadastro do produto", "calendario", "p", {
    todos: function () { return L.FAIXAS_CAD.map(function (f) { return { id: f.id, t: f.nome }; }); },
    nome: function (c) { return L.FAIXAS_CAD[+c] ? L.FAIXAS_CAD[+c].nome : "—"; }, de: function (pi) { return P.faixaCad[pi]; } });
  def("pendencia", "Situação na região", "alerta", "c", {
    todos: function () { return L.SITUACOES.map(function (s) { return { id: s.id, t: s.nome, s: s.dica }; }); },
    nome: function (c) { return L.SITUACOES[+c] ? L.SITUACOES[+c].nome : "—"; }, de: function (c) { return L.C.s[c]; } });
  def("trib", "Tributação (CODST)", "percent", "c", {
    todos: function () { var cont = new Map(), C = L.C; for (var c = 0; c < C.n; c++) if (C.st[c]) cont.set(C.st[c], (cont.get(C.st[c]) || 0) + 1);
      var o = Array.from(cont.keys()).sort(function (a, b) { return cont.get(b) - cont.get(a); }).map(function (k) { return { id: k, t: k + " · " + L.descTrib(k), s: L.fInt(cont.get(k)) + "×" }; });
      o.push({ id: 0, t: "Sem tributação" }); return o; },
    nome: function (c) { return +c ? +c + " · " + L.descTrib(+c) : "Sem tributação"; }, de: function (c) { return L.C.st[c]; } });
  def("vendaReg", "Venda na região", "dinheiro", "c", {
    todos: function () { return [{ id: 1, t: "Vendeu na região (" + L.META.meses_venda + " meses)" }, { id: 0, t: "Não vendeu na região" }]; },
    nome: function (c) { return +c ? "Vendeu na região" : "Não vendeu na região"; }, de: function (c) { return L.C.vn[c] > 0 ? 1 : 0; } });

  Object.keys(X).forEach(function (k) {
    var d = X[k]; d.cache = null;
    d.itens = function () { if (!d.cache) { d.cache = d.todos().map(function (x) { x.n = L.norm(x.t + " " + (x.s || "") + " " + x.id); return x; }); } return d.cache; };
  });
}
function fNcm(k) { var s = String(k); while (s.length < 8) s = "0" + s; return s.slice(0, 4) + "." + s.slice(4, 6) + "." + s.slice(6); }
L.fNcm = function (v) { return +v ? fNcm(+v) : ""; };
L.nomeDe = function (dim, id) { var d = L.DIM[dim]; return d ? d.nome(id) : String(id); };

/* ------------------------------ filtragem ------------------------------ */
/* spec = { f: filtros, pend: "com"|"todos" }. Devolve a seleção:
     regs   índices das regiões que passam
     prods  índices dos produtos que passam (e, havendo filtro de célula, que têm ao menos uma célula que passa)
     ok(c)  a célula passa nos filtros de célula?
   As contas (por situação, por produto, por região) saem de L.resumo / L.porProduto / L.porRegiao. */
var cacheFiltro = new Map();
function conj(a) { var s = new Set(); (a || []).forEach(function (x) { s.add(+x); }); return s; }
L.spec = function (extra) {
  var f = JSON.parse(JSON.stringify(L.estado.filtros || {}));
  if (extra && extra.f) for (var k in extra.f) { if (extra.f[k] == null) delete f[k]; else f[k] = extra.f[k].slice(); }
  return { f: f };
};
L.filtrar = function (spec) {
  var chave = JSON.stringify(spec.f);
  var hit = cacheFiltro.get(chave); if (hit) return hit;
  var R = L.R, P = L.P, C = L.C, f = spec.f, nR = R.n, X = L.DIM;
  var dimsR = [], dimsP = [], dimsC = [];
  Object.keys(f).forEach(function (k) { var d = X[k]; if (!d || !f[k] || !f[k].length) return; (d.nivel === "r" ? dimsR : d.nivel === "p" ? dimsP : dimsC).push([d, conj(f[k])]); });
  var regs = [];
  for (var ri = 0; ri < nR; ri++) { var okR = true; for (var a = 0; a < dimsR.length && okR; a++) okR = dimsR[a][1].has(dimsR[a][0].de(ri)); if (okR) regs.push(ri); }
  var ok = dimsC.length ? function (c) { for (var b = 0; b < dimsC.length; b++) if (!dimsC[b][1].has(dimsC[b][0].de(c))) return false; return true; } : function () { return true; };
  var prods = [];
  for (var pi = 0; pi < P.n; pi++) {
    var okP = true; for (var e = 0; e < dimsP.length && okP; e++) okP = dimsP[e][1].has(dimsP[e][0].de(pi));
    if (!okP) continue;
    if (dimsC.length) { var algum = false; for (var j = 0; j < regs.length && !algum; j++) algum = ok(pi * nR + regs[j]); if (!algum) continue; }
    prods.push(pi);
  }
  var sel = { regs: Int32Array.from(regs), prods: Int32Array.from(prods), ok: ok, temCel: dimsC.length > 0, f: f };
  cacheFiltro.set(chave, sel); if (cacheFiltro.size > 60) cacheFiltro.delete(cacheFiltro.keys().next().value);
  return sel;
};

/* ------------------------------ contas ------------------------------ */
/* resumo de uma seleção: combinações e produtos por situação */
L.resumo = function (sel) {
  var C = L.C, nR = L.R.n, r = { prod: 0, reg: sel.regs.length, cel: 0, porSit: [0, 0, 0, 0, 0], prodSit: [0, 0, 0, 0, 0],
    prodSemTrib: 0, prodSemPreco: 0, prodCompleto: 0, celSemTrib: 0, celSemPreco: 0, celVendPend: 0, prodVendPend: 0, vVendPend: 0 };
  for (var a = 0; a < sel.prods.length; a++) {
    var pi = sel.prods[a], tem = [0, 0, 0, 0, 0], st = 0, sp = 0, vp = 0, n = 0;
    for (var b = 0; b < sel.regs.length; b++) {
      var c = pi * nR + sel.regs[b]; if (!sel.ok(c)) continue;
      var s = C.s[c]; n++; r.cel++; r.porSit[s]++; tem[s] = 1;
      if (L.SEM_TRIB[s]) { st = 1; r.celSemTrib++; }
      if (L.SEM_PRECO[s]) { sp = 1; r.celSemPreco++; }
      if (s && C.vn[c] > 0) { vp = 1; r.celVendPend++; r.vVendPend += C.vv[c]; }
    }
    if (!n) continue;
    r.prod++;
    for (var k = 0; k < 5; k++) r.prodSit[k] += tem[k];
    r.prodSemTrib += st; r.prodSemPreco += sp; r.prodVendPend += vp;
    if (!st && !sp) r.prodCompleto++;
  }
  r.cobertura = r.cel ? r.porSit[0] / r.cel : null;
  return r;
};
/* uma linha por produto, com as regiões de cada pendência */
L.porProduto = function (sel, soPendentes) {
  var C = L.C, P = L.P, nR = L.R.n, out = [];
  for (var a = 0; a < sel.prods.length; a++) {
    var pi = sel.prods[a], x = { pi: pi, n: 0, sit: [0, 0, 0, 0, 0], semTrib: [], semPreco: [], soTrib: 0, vendPend: 0, vv: 0, vn: 0 };
    for (var b = 0; b < sel.regs.length; b++) {
      var ri = sel.regs[b], c = pi * nR + ri; if (!sel.ok(c)) continue;
      var s = C.s[c]; x.n++; x.sit[s]++; x.vv += C.vv[c]; x.vn += C.vn[c];
      if (L.SEM_TRIB[s]) x.semTrib.push(ri);
      if (L.SEM_PRECO[s]) x.semPreco.push(ri);
      if (s && C.vn[c] > 0) x.vendPend++;
    }
    if (!x.n) continue;
    x.pend = x.n - x.sit[0];
    if (soPendentes && !x.pend) continue;
    out.push(x);
  }
  return out;
};
/* uma linha por região */
L.porRegiao = function (sel) {
  var C = L.C, nR = L.R.n, out = [];
  for (var b = 0; b < sel.regs.length; b++) {
    var ri = sel.regs[b], x = { ri: ri, n: 0, sit: [0, 0, 0, 0, 0], semTrib: 0, semPreco: 0, vendPend: 0, vv: 0, prodVend: 0 };
    for (var a = 0; a < sel.prods.length; a++) {
      var c = sel.prods[a] * nR + ri; if (!sel.ok(c)) continue;
      var s = C.s[c]; x.n++; x.sit[s]++; if (L.SEM_TRIB[s]) x.semTrib++; if (L.SEM_PRECO[s]) x.semPreco++;
      if (C.vn[c] > 0) { x.vv += C.vv[c]; x.prodVend++; if (s) x.vendPend++; }
    }
    x.pend = x.n - x.sit[0]; x.cobertura = x.n ? x.sit[0] / x.n : null;
    out.push(x);
  }
  return out;
};
/* produtos com pendência agrupados por uma dimensão de produto */
L.agruparProd = function (sel, dim) {
  var d = L.DIM[dim], m = new Map(), linhas = L.porProduto(sel, false);
  linhas.forEach(function (x) {
    var k = d.de(x.pi), g = m.get(k);
    if (!g) { g = { k: k, prod: 0, pend: 0, semTrib: 0, semPreco: 0, cel: 0, celPend: 0 }; m.set(k, g); }
    g.prod++; g.cel += x.n; g.celPend += x.pend;
    if (x.pend) g.pend++; if (x.semTrib.length) g.semTrib++; if (x.semPreco.length) g.semPreco++;
  });
  return Array.from(m.values()).sort(function (a, b) { return b.pend - a.pend || b.celPend - a.celPend; });
};
/* células (produto × região) que passam, para listas de combinação */
L.celulas = function (sel, filtro) {
  var nR = L.R.n, out = [];
  for (var a = 0; a < sel.prods.length; a++) for (var b = 0; b < sel.regs.length; b++) {
    var c = sel.prods[a] * nR + sel.regs[b];
    if (sel.ok(c) && (!filtro || filtro(c))) out.push(c);
  }
  return out;
};
L.celPi = function (c) { return Math.floor(c / L.R.n); };
L.celRi = function (c) { return c % L.R.n; };

/* texto dos filtros aplicados (planilha e cabeçalho dos relatórios) */
L.descricaoFiltros = function (extra) {
  var out = [], f = L.estado.filtros;
  out.push(["Posição", "preço e tributação da carga de " + L.fDataHora(L.META.carga || L.META.gerado_em)]);
  out.push(["Universo", "produtos de revenda não excluídos × " + L.R.n + " regiões escolhidas"]);
  Object.keys(f).forEach(function (k) {
    var a = f[k]; if (!a || !a.length || !L.DIM[k]) return;
    var nomes = a.map(function (id) { return L.nomeDe(k, id); });
    out.push([L.DIM[k].rot, nomes.length > 6 ? nomes.slice(0, 6).join("; ") + " e mais " + (nomes.length - 6) : nomes.join("; ")]);
  });
  if (extra) extra.forEach(function (x) { out.push(x); });
  return out;
};

})();
