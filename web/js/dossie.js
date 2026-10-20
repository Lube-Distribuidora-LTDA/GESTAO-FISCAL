/* =============================================================================
 * dossie.js — o RELATÓRIO PERSONALIZADO que abre a cada clique.
 *
 * Qualquer barra, fatia, cartão, chip, célula ou linha do painel abre aqui o
 * relatório daquele recorte, já com os filtros da tela. Dentro dele, clicar abre o
 * relatório do item clicado (com "Voltar"). Abas conforme o recorte:
 *   produto : Por região (tributação, CST, ICMS, CFOP, preço e venda em cada região)
 *   região  : Resumo · Produtos da região
 *   demais  : Resumo · Produtos · Combinações produto × região
 * ent = { dim, id, f: filtros extras, titulo, aba }
 * ========================================================================== */
(function () {
"use strict";
var L = window.L;
var pilha = [], aba = "resumo";

/* ------------------------------ escopo ------------------------------ */
function escopo(ent) {
  var f = JSON.parse(JSON.stringify(L.estado.filtros));
  if (ent.f) for (var k in ent.f) { if (ent.f[k] == null) delete f[k]; else f[k] = ent.f[k].slice(); }
  if (ent.dim && L.DIM[ent.dim]) f[ent.dim] = [+ent.id];
  return { f: f, sel: L.filtrar({ f: f }) };
}
function nomeEnt(ent) { return ent.titulo || (ent.dim ? L.nomeDe(ent.dim, ent.id) : "Seleção"); }

/* ------------------------------ abrir / fechar ------------------------------ */
L.abrirDossie = function (ent, manter) {
  if (!manter) pilha = [];
  var topo = pilha[pilha.length - 1];
  if (!topo || JSON.stringify(topo) !== JSON.stringify(ent)) pilha.push(ent);
  aba = ent.aba || (ent.dim === "produto" ? "regioes" : "resumo");
  L.dica.esconder(); if (L.fecharPopover) L.fecharPopover();
  L.$("dossie").classList.add("on"); L.$("dossie-fundo").classList.add("on");
  document.body.style.overflow = "hidden";
  desenhar();
};
L.fecharDossie = function () { pilha = []; L.$("dossie").classList.remove("on"); L.$("dossie-fundo").classList.remove("on"); document.body.style.overflow = ""; };
L.dossieAberto = function () { return L.$("dossie").classList.contains("on"); };
document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && L.dossieAberto() && !document.querySelector(".pop")) L.fecharDossie(); });
document.addEventListener("click", function (ev) { if (ev.target && ev.target.id === "dossie-fundo") L.fecharDossie(); });

function desenhar() {
  var ent = pilha[pilha.length - 1], box = L.$("dossie"), es = escopo(ent);
  L.limpar(box);
  box.appendChild(cabecalho(ent, es));
  var corpo = L.h("div", { class: "dos-corpo" });
  box.appendChild(corpo);
  if (pilha.length > 1) {
    var tr = L.h("div", { class: "dos-trilha" });
    pilha.forEach(function (e, i) {
      if (i) tr.appendChild(L.h("span", { text: "›" }));
      tr.appendChild(L.h("button", { type: "button", text: nomeEnt(e), onclick: function () { pilha = pilha.slice(0, i + 1); aba = e.dim === "produto" ? "regioes" : "resumo"; desenhar(); } }));
    });
    corpo.appendChild(tr);
  }
  var abas = ent.dim === "produto" ? [["regioes", "Por região"]] : ent.dim === "regiao" ? [["resumo", "Resumo"], ["cels", "Produtos da região"]]
           : [["resumo", "Resumo"], ["produtos", "Produtos"], ["cels", "Produto × região"]];
  if (!abas.some(function (a) { return a[0] === aba; })) aba = abas[0][0];
  var barra = L.h("div", { class: "dos-abas" });
  abas.forEach(function (a) { barra.appendChild(L.h("button", { type: "button", class: aba === a[0] ? "on" : "", text: a[1], onclick: function () { aba = a[0]; desenhar(); } })); });
  corpo.appendChild(barra);
  var conteudo = L.h("div");
  corpo.appendChild(conteudo);
  try {
    var el = aba === "regioes" ? abaProduto(ent, es) : aba === "produtos" ? abaProdutos(ent, es) : aba === "cels" ? abaCelulas(ent, es) : resumo(ent, es);
    conteudo.appendChild(el);
    L.executarFila();
  } catch (e) { console.error(e); conteudo.appendChild(L.erroTela("Não foi possível montar o relatório", e.message || String(e))); }
  box.scrollTop = 0;
}

function cabecalho(ent, es) {
  var P = L.P, R = L.R, subs = [], chip = function (ic, t) { return L.h("span", { html: L.ic(ic) + " " + L.esc(t) }); };
  subs.push(chip("relogio", "carga de " + L.fDataHora(L.META.carga || L.META.gerado_em)));
  if (ent.dim === "produto") {
    var pi = P.i.get(+ent.id);
    if (pi != null) {
      subs.push(chip("caixa", "Cód. " + ent.id + (P.emb[pi] ? " · " + P.emb[pi] : "")));
      if (P.ncm[pi]) subs.push(chip("tabela", "NCM " + L.fNcm(P.ncm[pi])));
      subs.push(chip("camadas", L.nomeDe("depto", P.dep[pi]) + " › " + L.nomeDe("secao", P.sec[pi])));
      subs.push(chip("carteira", L.nomeDe("fornecedor", P.forn[pi])));
      subs.push(chip("verificar", P.fl[pi] ? "Fora de linha" : "Ativo"));
    }
  } else if (ent.dim === "regiao") {
    var ri = R.i.get(+ent.id);
    if (ri != null) {
      subs.push(chip("pino", R.uf[ri] + " · " + (R.fil[ri] === "99" ? "todas as filiais" : "filial " + R.fil[ri])));
      subs.push(chip("pessoas", L.fInt(R.cliA[ri]) + " clientes ativos"));
      subs.push(chip("dinheiro", R.vL[ri] ? "venda de " + L.fR(R.vV[ri]) + " em " + L.META.meses_venda + " meses" : "sem venda em " + L.META.meses_venda + " meses"));
    }
  }
  var extra = Object.keys(es.f).filter(function (k) { return es.f[k] && es.f[k].length && k !== ent.dim && !(ent.f && ent.f[k]); }).length;
  if (extra) subs.push(chip("filtro", extra + " filtro" + (extra > 1 ? "s" : "") + " da tela aplicado" + (extra > 1 ? "s" : "")));
  if (ent.f) Object.keys(ent.f).forEach(function (k) { if (L.DIM[k] && ent.f[k] && ent.f[k].length && k !== ent.dim) subs.push(chip("etiqueta", L.DIM[k].rot + ": " + ent.f[k].map(function (x) { return L.nomeDe(k, x); }).join(", "))); });
  var acoes = L.h("div", { class: "dos-acoes" });
  if (pilha.length > 1) acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("dir").replace("<svg", '<svg style="transform:rotate(180deg)"') + " Voltar", onclick: function () { pilha.pop(); var t = pilha[pilha.length - 1]; aba = t.dim === "produto" ? "regioes" : "resumo"; desenhar(); } }));
  var pag = L.paginaAtual(), filtraveis = (pag.filtros || []).concat(pag.mais || []);
  if (ent.dim && filtraveis.indexOf(ent.dim) >= 0) acoes.appendChild(L.h("button", { class: "btn ouro", type: "button", html: L.ic("filtro") + " Filtrar o painel por isso", onclick: function () { L.setFiltro(ent.dim, [ent.id]); L.fecharDossie(); L.toast("Painel filtrado: " + nomeEnt(ent), "ok"); } }));
  acoes.appendChild(L.h("button", { class: "btn", type: "button", html: L.ic("baixar") + " Imprimir / PDF", onclick: imprimir }));
  acoes.appendChild(L.h("button", { class: "btn-ic", type: "button", title: "Fechar (Esc)", html: L.ic("x"), onclick: L.fecharDossie }));
  var foto = null;
  if (ent.dim === "produto") { var pf = P.i.get(+ent.id); if (pf != null && P.foto[pf]) { var im = L.h("img", { src: L.urlFoto(pf), alt: "", loading: "lazy" }); im.addEventListener("error", function () { foto.remove(); }); foto = L.h("div", { class: "dos-foto" }, im); } }
  var rotTipo = ent.dim && L.DIM[ent.dim] ? L.DIM[ent.dim].rot : "Recorte";
  return L.h("div", { class: "dos-cab" }, foto,
    L.h("div", { style: { minWidth: 0 } },
      L.h("div", { class: "olho", html: L.ic(ent.dim && L.DIM[ent.dim] ? L.DIM[ent.dim].icone : "estrela").replace("<svg", '<svg style="width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2"') + "<span>Relatório · " + L.esc(rotTipo) + " · tributação e preço por região</span>" }),
      L.h("h2", { text: nomeEnt(ent) }), L.h("div", { class: "sub" }, subs)),
    acoes);
}
function imprimir() {
  var tema = document.documentElement.getAttribute("data-tema");
  document.documentElement.setAttribute("data-tema", "claro"); document.body.classList.add("imprimindo");
  setTimeout(function () { L.redesenharTudo(); window.print(); document.body.classList.remove("imprimindo"); document.documentElement.setAttribute("data-tema", tema); L.redesenharTudo(); }, 250);
}

/* ------------------------------ cartões ------------------------------ */
L.kpisFiscais = function (r, aoClicar) {
  var clique = function (pend) { return aoClicar ? function () { aoClicar(pend); } : null; };
  return L.kpis(
    L.kpi({ icone: "caixa", rot: "Produtos analisados", valor: r.prod, fmt: L.fInt, classe: "heroi", leg: L.h("span", { text: "× " + r.reg + (r.reg === 1 ? " região = " : " regiões = ") + L.fInt(r.cel) + (r.cel === 1 ? " combinação" : " combinações") }) }),
    L.kpi({ icone: "percent", rot: "Com região sem tributação", valor: r.prodSemTrib, fmt: L.fInt, classe: r.prodSemTrib ? "perigo" : "zero", aoClicar: clique([1, 3, 4]),
            leg: L.h("span", { text: L.fInt(r.celSemTrib) + " regiões no total · " + L.fInt(r.porSit[1]) + " delas com preço" }) }),
    L.kpi({ icone: "etiqueta", rot: "Com região sem preço de venda", valor: r.prodSemPreco, fmt: L.fInt, classe: r.prodSemPreco ? "atencao" : "zero", aoClicar: clique([2, 3, 4]),
            leg: L.h("span", { text: L.fInt(r.celSemPreco) + " regiões no total · " + L.fInt(r.porSit[2]) + " delas com tributação" }) }),
    L.kpi({ icone: "alerta", rot: "Têm preço e falta a tributação", valor: r.porSit[1], fmt: L.fInt, classe: r.porSit[1] ? "perigo" : "zero", aoClicar: clique([1]),
            leg: L.h("span", { text: L.fInt(r.prodSit[1]) + " produtos · produto × região" }) }),
    L.kpi({ icone: "dinheiro", rot: "Venderam e hoje têm pendência", valor: r.celVendPend, fmt: L.fInt, classe: r.celVendPend ? "atencao" : "zero", aoClicar: aoClicar ? function () { aoClicar([1, 2, 3, 4], true); } : null,
            leg: L.h("span", { text: L.fInt(r.prodVendPend) + " produtos · " + L.fR(r.vVendPend) + " vendidos em " + L.META.meses_venda + " meses" }),
            ajuda: "Produto × região que vendeu nos últimos meses e hoje está sem tributação ou sem preço na 201" }),
    L.kpi({ icone: "verificar", rot: "Cobertura completa", valor: r.cobertura, fmt: function (v) { return L.fPct(v, 1); }, classe: r.cobertura >= 0.999 ? "ok" : "",
            leg: L.h("span", { text: L.fInt(r.porSit[0]) + " de " + L.fInt(r.cel) + " com tributação e preço" }) }));
};

/* ============================ RESUMO (região e demais recortes) ============================ */
function resumo(ent, es) {
  var raiz = L.h("div"), r = L.resumo(es.sel);
  var dimEnt = ent.dim, f0 = JSON.parse(JSON.stringify(ent.f || {}));
  if (dimEnt && L.DIM[dimEnt]) f0[dimEnt] = [+ent.id];
  raiz.appendChild(L.kpisFiscais(r, function (pend, vendeu) {
    var f2 = JSON.parse(JSON.stringify(f0)); f2.pendencia = pend; if (vendeu) f2.vendaReg = [1];
    L.abrirDossie({ titulo: nomeEnt(ent) + " · " + (vendeu ? "vendeu e tem pendência" : pend.map(function (s) { return L.SITUACOES[s].curto; }).join(" + ")), f: f2, aba: "cels" }, true);
  }));
  if (!r.cel) { raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Nada neste recorte</b>Nenhum produto × região com os filtros atuais." })); return raiz; }

  var g = L.h("div", { class: "grade" });
  // situação (rosca)
  var pR = L.painel({ titulo: "Situação das combinações", sub: "produto × região · clique para abrir", classe: "c-5" });
  var bR = L.h("div"); pR.corpo.appendChild(bR);
  var fat = L.SITUACOES.map(function (s) { return { rot: s.nome, valor: r.porSit[s.id], cor: L.corSit(s.id), corTexto: s.id === 0 || s.id === 2 ? "#0b1533" : "#fff", idxOriginal: s.id }; });
  L.graf.rosca(bR, { fatias: fat, altura: 240, fmt: L.fInt, centro: { valor: L.fPct(r.cobertura, 0), titulo: "completas" },
    dica: function (i) { var s = L.SITUACOES[i]; return { titulo: s.nome, linhas: [{ rot: "Combinações", val: L.fInt(r.porSit[i]) }, { rot: "Produtos", val: L.fInt(r.prodSit[i]) }], extra: '<div class="dica-sub">' + L.esc(s.dica) + "</div>" }; },
    aoClicar: function (i) { var f2 = JSON.parse(JSON.stringify(f0)); f2.pendencia = [i]; L.abrirDossie({ titulo: nomeEnt(ent) + " · " + L.SITUACOES[i].nome, f: f2, aba: "cels" }, true); } });
  pR.corpo.appendChild(L.graf.legendaLista(fat, L.fInt, function (i) { var f2 = JSON.parse(JSON.stringify(f0)); f2.pendencia = [i]; L.abrirDossie({ titulo: nomeEnt(ent) + " · " + L.SITUACOES[i].nome, f: f2, aba: "cels" }, true); }));
  g.appendChild(pR);
  // por região (se o recorte não é uma região) ou por departamento
  if (dimEnt !== "regiao") {
    var pG = L.painel({ titulo: "Situação por região", sub: "clique para abrir a região neste recorte", classe: "c-7" });
    var bG = L.h("div"); pG.corpo.appendChild(bG);
    L.graficoSituacaoRegiao(bG, es.sel, function (x, s) { var f2 = JSON.parse(JSON.stringify(f0)); if (s != null) f2.pendencia = [s]; L.abrirDossie({ dim: "regiao", id: L.R.num[x.ri], f: f2 }, true); });
    pG.corpo.appendChild(L.legendaSituacoes());
    g.appendChild(pG);
  } else {
    var pD = L.painel({ titulo: "Departamentos com pendência", sub: "produtos sem tributação ou sem preço nesta região · clique para abrir", classe: "c-7" });
    barrasProd(pD.corpo, es.sel, "depto", f0, 9);
    g.appendChild(pD);
  }
  raiz.appendChild(g);
  var g2 = L.h("div", { class: "grade", style: { marginTop: "16px" } });
  [["fornecedor", "Fornecedores com pendência"], ["depto", "Departamentos com pendência"], ["secao", "Seções com pendência"]].filter(function (q) { return q[0] !== dimEnt && !(dimEnt === "regiao" && q[0] === "depto"); }).slice(0, 2).forEach(function (q) {
    var p = L.painel({ titulo: q[1], sub: "produtos com alguma região sem tributação ou sem preço · clique para abrir", classe: "c-6" });
    barrasProd(p.corpo, es.sel, q[0], f0, 8);
    g2.appendChild(p);
  });
  raiz.appendChild(g2);
  raiz.appendChild(L.nota("Situação de hoje na rotina 201 (PCTABPR), carga de " + L.fDataHora(L.META.carga || L.META.gerado_em) + ". \"Sem tributação\" = sem CODST na região; \"sem preço\" = preço de venda zero ou vazio. Clique em qualquer barra para abrir o relatório dela (Voltar retorna)."));
  return raiz;
}
function barrasProd(corpo, sel, dim, f0, n) {
  var gr = L.agruparProd(sel, dim).filter(function (x) { return x.pend; }), top = gr.slice(0, n), tot = gr.reduce(function (s, x) { return s + x.pend; }, 0), box = L.h("div");
  corpo.appendChild(box);
  if (!top.length) { box.appendChild(L.h("div", { class: "vazio", html: "<b>Nenhuma pendência</b>Todos os produtos deste recorte estão completos." })); return; }
  L.graf.barras(box, {
    itens: top.map(function (x) { return { rot: L.nomeDe(dim, x.k), valor: x.pend }; }), total: tot, fmt: L.fInt, linhaH: 27,
    cor: function (i) { return i === 0 ? L.cores().ouro : L.cores().d[0]; },
    dica: function (i) { var x = top[i]; return { titulo: L.nomeDe(dim, x.k), linhas: [{ rot: "Produtos com pendência", val: L.fInt(x.pend) + " de " + L.fInt(x.prod) }, { rot: "Com região sem tributação", val: L.fInt(x.semTrib) }, { rot: "Com região sem preço", val: L.fInt(x.semPreco) }, { rot: "Combinações pendentes", val: L.fInt(x.celPend) }] }; },
    aoClicar: function (i) { L.abrirDossie({ dim: dim, id: top[i].k, f: f0 }, true); },
  });
}

/* ============================ PRODUTO: por região ============================ */
function abaProduto(ent, es) {
  var raiz = L.h("div"), P = L.P, R = L.R, C = L.C, T = L.T, pi = P.i.get(+ent.id);
  if (pi == null) { raiz.appendChild(L.h("div", { class: "vazio", html: "<b>Produto fora do painel</b>O painel mostra só produtos ativos: em linha, de revenda, fora do fornecedor INATIVOS e sem itens de consumo." })); return raiz; }
  // regiões da tela (os filtros de região valem; os de célula não: o relatório do produto mostra todas as regiões dele)
  var fR = {}; ["regiao", "uf", "filialReg"].forEach(function (k) { if (es.f[k]) fR[k] = es.f[k]; });
  var regs = L.filtrar({ f: fR }).regs, cels = Array.prototype.map.call(regs, function (ri) { return pi * R.n + ri; });
  var cont = [0, 0, 0, 0, 0], semT = 0, semP = 0, vend = 0;
  cels.forEach(function (c) { cont[C.s[c]]++; if (L.SEM_TRIB[C.s[c]]) semT++; if (L.SEM_PRECO[C.s[c]]) semP++; if (C.s[c] && C.vn[c]) vend++; });
  raiz.appendChild(L.kpis(
    L.kpi({ icone: "verificar", rot: "Regiões completas", valor: cont[0], fmt: L.fInt, classe: cont[0] === cels.length ? "ok" : "heroi", leg: L.h("span", { text: "de " + cels.length + " regiões da tela" }) }),
    L.kpi({ icone: "percent", rot: "Regiões sem tributação", valor: semT, fmt: L.fInt, classe: semT ? "perigo" : "zero", leg: L.h("span", { text: cont[1] + " com preço · " + (cont[3] + cont[4]) + " sem os dois" }) }),
    L.kpi({ icone: "etiqueta", rot: "Regiões sem preço de venda", valor: semP, fmt: L.fInt, classe: semP ? "atencao" : "zero", leg: L.h("span", { text: cont[2] + " com tributação · " + (cont[3] + cont[4]) + " sem os dois" }) }),
    L.kpi({ icone: "dinheiro", rot: "Vendeu e tem pendência", valor: vend, fmt: L.fInt, classe: vend ? "atencao" : "zero", leg: L.h("span", { text: "regiões com venda em " + L.META.meses_venda + " meses" }) }),
    L.kpi({ icone: "armazem", rot: "Estoque hoje", valor: P.est[pi], fmt: L.fQ, leg: L.h("span", { text: "filiais de distribuição" + (P.un[pi] ? " · " + P.un[pi] : "") }) })));
  var t = L.tabela({
    titulo: "Tributação e preço por região — " + P.desc[pi] + " (cód. " + P.cod[pi] + ")", arquivo: "fiscal-produto-" + P.cod[pi], aba: "Por região", porPagina: 0, linhas: cels, ordem: { id: "reg", desc: false },
    filtrosTexto: function () { return L.descricaoFiltros([["Produto", P.cod[pi] + " · " + P.desc[pi]]]); }, busca: false,
    colunas: [
      { id: "reg", titulo: "Região", tipo: "texto", valor: function (c) { return L.nomeRegiao(L.celRi(c)); }, ordVal: function (c) { return R.num[L.celRi(c)]; } },
      { id: "uf", titulo: "UF", tipo: "texto", valor: function (c) { return R.uf[L.celRi(c)]; } },
      { id: "sit", titulo: "Situação", tipo: "tag", valor: function (c) { return L.SITUACOES[C.s[c]].nome; }, fmt: function (v, c) { return { html: L.tagSit(C.s[c]) }; }, ordVal: function (c) { return C.s[c]; } },
      { id: "cst", titulo: "CODST", tipo: "inteiro", valor: function (c) { return C.st[c] || null; }, fmt: function (v) { return v ? String(v) : "—"; }, somar: false },
      { id: "trib", titulo: "Tributação", tipo: "texto", valor: function (c) { return C.st[c] ? L.descTrib(C.st[c]) : ""; } },
      { id: "sit2", titulo: "CST", tipo: "texto", valor: function (c) { var x = T.get(C.st[c]); return x ? x.cst : ""; } },
      { id: "icm", titulo: "ICMS", tipo: "num", valor: function (c) { var x = T.get(C.st[c]); return x ? x.aliq : null; }, fmt: function (v) { return L.fAliq(v); }, exportarTipo: "moeda", somar: false },
      { id: "cfop", titulo: "CFOP", tipo: "texto", valor: function (c) { var x = T.get(C.st[c]); return x ? (x.cfop || "") + (x.cfopi ? " / " + x.cfopi : "") : ""; } },
      { id: "pv", titulo: "Preço de venda", tipo: "num2", valor: function (c) { return C.pv[c] || null; }, fmt: function (v) { return L.fPreco(v); }, exportarTipo: "moeda", somar: false },
      { id: "vv", titulo: "Venda na região (R$)", tipo: "moedaInt", valor: function (c) { return C.vv[c] || null; }, fmt: function (v) { return v ? L.fR(v) : ""; }, exportarTipo: "moeda" },
      { id: "vd", titulo: "Última venda", tipo: "texto", valor: function (c) { return C.vd[c]; }, fmt: function (v) { return v >= 0 ? L.fDia(v) : ""; }, exp: function (c) { return C.vd[c] >= 0 ? L.fDia(C.vd[c]) : ""; } },
    ],
    totais: function () { return [{ rot: "Regiões", valor: String(cels.length), pri: true }, { rot: "Completas", valor: String(cont[0]) }, { rot: "Sem tributação", valor: String(semT) }, { rot: "Sem preço", valor: String(semP) }]; },
    aoClicar: function (c, ev) { L.clique("regiao", R.num[L.celRi(c)], ev); },
  });
  raiz.appendChild(L.grade(L.painel({ titulo: "Cada região deste produto", sub: "tributação de saída (CODST da 201 → PCTRIBUT), preço de venda e venda dos últimos " + L.META.meses_venda + " meses · clique para abrir a região", classe: "c-12", semPad: true, corpo: t })));
  if (cels.some(function (c) { return C.st[c] && !T.has(C.st[c]); })) raiz.appendChild(L.nota("Há CODST nesta lista que não existe no cadastro de tributações (rotina 514): a região conta como sem tributação."));
  return raiz;
}

/* ============================ PRODUTOS e COMBINAÇÕES ============================ */
function abaProdutos(ent, es) {
  var linhas = L.porProduto(es.sel, false);
  var t = L.tabelaProdutos(linhas, { titulo: "Produtos — " + nomeEnt(ent), filtrosTexto: function () { return L.descricaoFiltros([["Relatório", nomeEnt(ent)]]); },
    aoClicar: function (x) { L.abrirDossie({ dim: "produto", id: L.P.cod[x.pi] }, true); } });
  return L.grade(L.painel({ titulo: "Produtos do recorte", sub: L.fInt(linhas.length) + " produtos · regiões sem tributação e sem preço de venda de cada um", classe: "c-12", semPad: true, corpo: t }));
}
function abaCelulas(ent, es) {
  var cels = L.celulas(es.sel, ent.dim === "regiao" && !(es.f.pendencia && es.f.pendencia.length) ? function (c) { return L.C.s[c] !== 0; } : null);
  var t = L.tabelaCelulas(cels, { titulo: "Produto × região — " + nomeEnt(ent), filtrosTexto: function () { return L.descricaoFiltros([["Relatório", nomeEnt(ent)]]); },
    aoClicar: function (c) { L.abrirDossie({ dim: "produto", id: L.P.cod[L.celPi(c)] }, true); } });
  var sub = ent.dim === "regiao" && !(es.f.pendencia && es.f.pendencia.length) ? "produtos com pendência nesta região (os completos ficam de fora) · clique para abrir o produto" : L.fInt(cels.length) + " combinações · clique para abrir o produto";
  return L.grade(L.painel({ titulo: ent.dim === "regiao" ? "Produtos com pendência na região" : "Combinações produto × região", sub: sub, classe: "c-12", semPad: true, corpo: t }));
}

})();
