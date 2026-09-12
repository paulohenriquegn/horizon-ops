/**
 * Horizon Ops — Servidor Cloud
 * Banco de dados: SQLite (persiste no Railway/Render com volume)
 * Acesse de qualquer dispositivo, inclusive iPhone
 */

const express = require("express");
const path    = require("path");
const cors    = require("cors");
const fs      = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── BANCO DE DADOS SQLite ──────────────────────────────────────────────────
const Database = require("better-sqlite3");

// Pasta de dados — usa volume persistente no Railway, ou pasta local
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "horizonops.db"));
db.pragma("journal_mode = WAL");

// ── CRIAR TABELAS ──────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS entradas (
    id TEXT PRIMARY KEY,
    data TEXT,
    dinheiro REAL DEFAULT 0,
    pix REAL DEFAULT 0,
    cartao REAL DEFAULT 0,
    convenio REAL DEFAULT 0,
    total REAL DEFAULT 0,
    obs TEXT DEFAULT '',
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS receber (
    id TEXT PRIMARY KEY,
    cliente TEXT,
    descricao TEXT,
    valor REAL DEFAULT 0,
    vencimento TEXT,
    status TEXT DEFAULT 'Pendente',
    dataPagto TEXT DEFAULT '',
    obs TEXT DEFAULT '',
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS pagar (
    id TEXT PRIMARY KEY,
    categoria TEXT,
    descricao TEXT,
    valor REAL DEFAULT 0,
    vencimento TEXT,
    status TEXT DEFAULT 'Pendente',
    dataPagto TEXT DEFAULT '',
    obs TEXT DEFAULT '',
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS cartao (
    id TEXT PRIMARY KEY,
    data TEXT,
    operadora TEXT,
    valorBruto REAL DEFAULT 0,
    taxaPct REAL DEFAULT 0,
    taxaReais REAL DEFAULT 0,
    valorLiq REAL DEFAULT 0,
    recebido TEXT DEFAULT 'Nao',
    obs TEXT DEFAULT '',
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS caixa_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    saldoInicial REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS caixa_movimentos (
    id TEXT PRIMARY KEY,
    data TEXT,
    descricao TEXT,
    entrada REAL DEFAULT 0,
    saida REAL DEFAULT 0,
    obs TEXT DEFAULT '',
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS fixas (
    id TEXT PRIMARY KEY,
    nome TEXT,
    categoria TEXT,
    valor REAL DEFAULT 0,
    diaVenc INTEGER DEFAULT 1,
    prioridade TEXT DEFAULT 'normal',
    obs TEXT DEFAULT '',
    ativa INTEGER DEFAULT 1,
    criadoEm TEXT
  );

  CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY,
    nome TEXT,
    descricao TEXT DEFAULT '',
    meta REAL DEFAULT 0,
    prazoDias INTEGER DEFAULT 90,
    icone TEXT DEFAULT '🪣',
    criadoEm TEXT,
    ultimoUso TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS reserva_depositos (
    id TEXT PRIMARY KEY,
    reservaId TEXT,
    valor REAL DEFAULT 0,
    data TEXT,
    obs TEXT DEFAULT '',
    FOREIGN KEY (reservaId) REFERENCES reservas(id)
  );

  CREATE TABLE IF NOT EXISTS util_lancamentos (
    id TEXT PRIMARY KEY,
    catId TEXT,
    valor REAL DEFAULT 0,
    mes TEXT,
    obs TEXT DEFAULT '',
    data TEXT,
    diaVenc INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS util_config (
    id TEXT PRIMARY KEY,
    nome TEXT,
    icone TEXT,
    diaVenc INTEGER DEFAULT 0
  );

  INSERT OR IGNORE INTO caixa_config (id, saldoInicial) VALUES (1, 0);
  INSERT OR IGNORE INTO util_config VALUES ('energia', 'Energia Elétrica', '⚡', 10);
  INSERT OR IGNORE INTO util_config VALUES ('agua',    'Água',             '💧', 15);
  INSERT OR IGNORE INTO util_config VALUES ('internet','Internet',         '📶', 15);
  INSERT OR IGNORE INTO util_config VALUES ('gas',     'Gás',              '🔥', 0);
`);

// ── MIDDLEWARE ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── ROTA RAIZ ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── DASHBOARD ──────────────────────────────────────────────────────────────
app.get("/api/dashboard", (req, res) => {
  const { mes } = req.query;
  const filtroMes = mes ? `AND data LIKE '${mes}%'` : "";
  const filtroMesPag = mes ? `AND dataPagto LIKE '${mes}%'` : "";

  const receita    = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;
  const recDin     = db.prepare(`SELECT COALESCE(SUM(dinheiro),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;
  const recPix     = db.prepare(`SELECT COALESCE(SUM(pix),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;
  const recCart    = db.prepare(`SELECT COALESCE(SUM(cartao),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;
  const recConv    = db.prepare(`SELECT COALESCE(SUM(convenio),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;

  const despesas   = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status != 'Pago'`).get().v;
  const pagoMes    = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status = 'Pago' ${filtroMesPag}`).get().v;
  const vencidoPag = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status = 'Vencido'`).get().v;

  const areceber   = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status != 'Pago'`).get().v;
  const emAtraso   = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status = 'Atrasado'`).get().v;
  const recebido   = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status = 'Pago' ${filtroMesPag}`).get().v;

  const taxasCart  = db.prepare(`SELECT COALESCE(SUM(taxaReais),0) as v FROM cartao WHERE 1=1 ${filtroMes}`).get().v;
  const liqCart    = db.prepare(`SELECT COALESCE(SUM(valorLiq),0) as v FROM cartao WHERE 1=1 ${filtroMes}`).get().v;

  const saldoIni   = db.prepare(`SELECT saldoInicial FROM caixa_config WHERE id=1`).get()?.saldoInicial || 0;
  const cxEnt      = db.prepare(`SELECT COALESCE(SUM(entrada),0) as v FROM caixa_movimentos WHERE 1=1 ${filtroMes}`).get().v;
  const cxSai      = db.prepare(`SELECT COALESCE(SUM(saida),0) as v FROM caixa_movimentos WHERE 1=1 ${filtroMes}`).get().v;
  const saldo      = saldoIni + cxEnt - cxSai;

  const entradas7  = db.prepare(`SELECT * FROM entradas ORDER BY data DESC LIMIT 7`).all();
  const canais     = { Dinheiro: recDin, PIX: recPix, Cartao: recCart, ConvFiado: recConv };

  res.json({
    receita, despesas, pagoMes, areceber, emAtraso, recebido,
    vencidoPag, taxasCart, liqCart, saldo,
    lucro: receita - despesas,
    entradas7, canais,
    saldoInicial: saldoIni,
  });
});

// ── ENTRADAS ───────────────────────────────────────────────────────────────
app.get("/api/entradas", (req, res) => {
  const { mes } = req.query;
  const rows = mes
    ? db.prepare(`SELECT * FROM entradas WHERE data LIKE ? ORDER BY data DESC`).all(`${mes}%`)
    : db.prepare(`SELECT * FROM entradas ORDER BY data DESC`).all();
  res.json(rows);
});

app.post("/api/entradas", (req, res) => {
  const id = gerarId();
  const { data, dinheiro=0, pix=0, cartao=0, convenio=0, total=0, obs='' } = req.body;
  db.prepare(`INSERT INTO entradas VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, data, +dinheiro, +pix, +cartao, +convenio, +total, obs, new Date().toISOString()
  );
  console.log("  [ENTRADA]", data, "R$", total);
  res.json({ ok: true, item: { id, data, dinheiro:+dinheiro, pix:+pix, cartao:+cartao, convenio:+convenio, total:+total, obs } });
});

app.delete("/api/entradas/:id", (req, res) => {
  db.prepare(`DELETE FROM entradas WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── RECEBER ────────────────────────────────────────────────────────────────
app.get("/api/receber", (req, res) => {
  res.json(db.prepare(`SELECT * FROM receber ORDER BY vencimento ASC`).all());
});

app.post("/api/receber", (req, res) => {
  const id   = gerarId();
  const hoje = new Date().toISOString().slice(0,10);
  const { cliente, descricao='', valor=0, vencimento='', obs='' } = req.body;
  let status = req.body.status || 'auto';
  if (status === 'auto') status = vencimento && vencimento < hoje ? 'Atrasado' : 'Pendente';
  db.prepare(`INSERT INTO receber VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, cliente, descricao, +valor, vencimento, status, req.body.dataPagto||'', obs, new Date().toISOString()
  );
  res.json({ ok: true, item: { id, cliente, descricao, valor:+valor, vencimento, status } });
});

app.put("/api/receber/:id", (req, res) => {
  const { status, dataPagto } = req.body;
  db.prepare(`UPDATE receber SET status=?, dataPagto=? WHERE id=?`).run(status, dataPagto||'', req.params.id);
  res.json({ ok: true });
});

app.delete("/api/receber/:id", (req, res) => {
  db.prepare(`DELETE FROM receber WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── PAGAR ──────────────────────────────────────────────────────────────────
app.get("/api/pagar", (req, res) => {
  res.json(db.prepare(`SELECT * FROM pagar ORDER BY vencimento ASC`).all());
});

app.post("/api/pagar", (req, res) => {
  const id   = gerarId();
  const hoje = new Date().toISOString().slice(0,10);
  const { categoria, descricao='', valor=0, vencimento='', obs='' } = req.body;
  let status = req.body.status || 'auto';
  if (status === 'auto') status = vencimento && vencimento < hoje ? 'Vencido' : 'Pendente';
  db.prepare(`INSERT INTO pagar VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, categoria, descricao, +valor, vencimento, status, req.body.dataPagto||'', obs, new Date().toISOString()
  );
  res.json({ ok: true, item: { id, categoria, descricao, valor:+valor, vencimento, status } });
});

app.put("/api/pagar/:id", (req, res) => {
  const { status, dataPagto } = req.body;
  db.prepare(`UPDATE pagar SET status=?, dataPagto=? WHERE id=?`).run(status, dataPagto||'', req.params.id);
  res.json({ ok: true });
});

app.delete("/api/pagar/:id", (req, res) => {
  db.prepare(`DELETE FROM pagar WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── CARTÃO ─────────────────────────────────────────────────────────────────
app.get("/api/cartao", (req, res) => {
  const { mes } = req.query;
  const rows = mes
    ? db.prepare(`SELECT * FROM cartao WHERE data LIKE ? ORDER BY data DESC`).all(`${mes}%`)
    : db.prepare(`SELECT * FROM cartao ORDER BY data DESC`).all();
  res.json(rows);
});

app.post("/api/cartao", (req, res) => {
  const id      = gerarId();
  const bruto   = +req.body.valorBruto || 0;
  const taxaPct = +req.body.taxaPct    || 0;
  const taxaR   = bruto * (taxaPct / 100);
  db.prepare(`INSERT INTO cartao VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, req.body.data, req.body.operadora, bruto, taxaPct, taxaR, bruto-taxaR,
    req.body.recebido||'Nao', req.body.obs||'', new Date().toISOString()
  );
  res.json({ ok: true });
});

app.put("/api/cartao/:id", (req, res) => {
  db.prepare(`UPDATE cartao SET recebido=? WHERE id=?`).run(req.body.recebido||'Sim', req.params.id);
  res.json({ ok: true });
});

app.delete("/api/cartao/:id", (req, res) => {
  db.prepare(`DELETE FROM cartao WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── CAIXA ──────────────────────────────────────────────────────────────────
app.get("/api/caixa", (req, res) => {
  const { mes } = req.query;
  const saldoInicial = db.prepare(`SELECT saldoInicial FROM caixa_config WHERE id=1`).get()?.saldoInicial || 0;
  const movimentos   = mes
    ? db.prepare(`SELECT * FROM caixa_movimentos WHERE data LIKE ? ORDER BY data DESC`).all(`${mes}%`)
    : db.prepare(`SELECT * FROM caixa_movimentos ORDER BY data DESC`).all();
  res.json({ saldoInicial, movimentos });
});

app.put("/api/caixa/saldo", (req, res) => {
  db.prepare(`UPDATE caixa_config SET saldoInicial=? WHERE id=1`).run(+req.body.saldoInicial||0);
  res.json({ ok: true });
});

app.post("/api/caixa", (req, res) => {
  const id = gerarId();
  db.prepare(`INSERT INTO caixa_movimentos VALUES (?,?,?,?,?,?,?)`).run(
    id, req.body.data, req.body.descricao, +req.body.entrada||0, +req.body.saida||0,
    req.body.obs||'', new Date().toISOString()
  );
  res.json({ ok: true });
});

app.delete("/api/caixa/:id", (req, res) => {
  db.prepare(`DELETE FROM caixa_movimentos WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── CONTAS FIXAS ───────────────────────────────────────────────────────────
app.get("/api/fixas", (req, res) => {
  res.json(db.prepare(`SELECT * FROM fixas WHERE ativa=1 ORDER BY diaVenc ASC`).all());
});

app.post("/api/fixas", (req, res) => {
  const id = gerarId();
  db.prepare(`INSERT INTO fixas VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, req.body.nome, req.body.categoria, +req.body.valor||0,
    +req.body.diaVenc||1, req.body.prioridade||'normal',
    req.body.obs||'', 1, new Date().toISOString()
  );
  res.json({ ok: true });
});

app.delete("/api/fixas/:id", (req, res) => {
  db.prepare(`DELETE FROM fixas WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── RESERVAS ───────────────────────────────────────────────────────────────
app.get("/api/reservas", (req, res) => {
  const reservas = db.prepare(`SELECT * FROM reservas ORDER BY criadoEm ASC`).all();
  const hoje     = new Date();
  const result   = reservas.map(r => {
    const deps     = db.prepare(`SELECT * FROM reserva_depositos WHERE reservaId=? ORDER BY data ASC`).all(r.id);
    const guardado = deps.reduce((s,d) => s+d.valor, 0);
    const falta    = Math.max(0, r.meta - guardado);
    const pct      = Math.min(100, Math.round((guardado/r.meta)*100));
    const porMes   = r.meta / (r.prazoDias/30);
    const ultimoRef= deps.length ? new Date(deps[deps.length-1].data) : new Date(r.criadoEm);
    const diasDesde= Math.floor((hoje-ultimoRef)/(1000*60*60*24));
    const statusCiclo = guardado>=r.meta ? "pronto" : diasDesde>r.prazoDias ? "atrasado" : "guardando";
    return { ...r, depositos:deps, guardado, falta, pct, porMes, diasDesde, statusCiclo };
  });
  res.json(result);
});

app.post("/api/reservas", (req, res) => {
  const id = gerarId();
  db.prepare(`INSERT INTO reservas VALUES (?,?,?,?,?,?,?,?)`).run(
    id, req.body.nome, req.body.descricao||'', +req.body.meta||0,
    +req.body.prazoDias||90, req.body.icone||'🪣', new Date().toISOString(), ''
  );
  res.json({ ok: true });
});

app.post("/api/reservas/:id/depositar", (req, res) => {
  const depId = gerarId();
  const valor = +req.body.valor || 0;
  db.prepare(`INSERT INTO reserva_depositos VALUES (?,?,?,?,?)`).run(
    depId, req.params.id, valor, req.body.data||new Date().toISOString().slice(0,10), req.body.obs||''
  );
  const guardado = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM reserva_depositos WHERE reservaId=?`).get(req.params.id).v;
  const meta     = db.prepare(`SELECT meta FROM reservas WHERE id=?`).get(req.params.id)?.meta || 0;
  if (guardado >= meta) {
    db.prepare(`DELETE FROM reserva_depositos WHERE reservaId=?`).run(req.params.id);
    db.prepare(`UPDATE reservas SET ultimoUso=? WHERE id=?`).run(new Date().toISOString().slice(0,10), req.params.id);
  }
  res.json({ ok: true, guardado, meta });
});

app.post("/api/reservas/:id/usar", (req, res) => {
  db.prepare(`DELETE FROM reserva_depositos WHERE reservaId=?`).run(req.params.id);
  db.prepare(`UPDATE reservas SET ultimoUso=? WHERE id=?`).run(new Date().toISOString().slice(0,10), req.params.id);
  res.json({ ok: true });
});

app.delete("/api/reservas/:id", (req, res) => {
  db.prepare(`DELETE FROM reserva_depositos WHERE reservaId=?`).run(req.params.id);
  db.prepare(`DELETE FROM reservas WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// ── UTILIDADES ─────────────────────────────────────────────────────────────
app.get("/api/utilidades", (req, res) => {
  const cats = db.prepare(`SELECT * FROM util_config ORDER BY id ASC`).all();
  const result = cats.map(cat => {
    const lancs   = db.prepare(`SELECT * FROM util_lancamentos WHERE catId=? ORDER BY mes DESC LIMIT 6`).all(cat.id);
    const media   = lancs.length ? lancs.reduce((s,l)=>s+l.valor,0)/lancs.length : 0;
    return { ...cat, lancamentos: lancs.reverse(), media: Math.round(media*100)/100 };
  });
  res.json(result);
});

app.post("/api/utilidades/:id/lancar", (req, res) => {
  const id = gerarId();
  db.prepare(`INSERT INTO util_lancamentos VALUES (?,?,?,?,?,?,?)`).run(
    id, req.params.id, +req.body.valor||0, req.body.mes||'',
    req.body.obs||'', new Date().toISOString().slice(0,10), +req.body.diaVenc||0
  );
  if (req.body.diaVenc) {
    db.prepare(`UPDATE util_config SET diaVenc=? WHERE id=?`).run(+req.body.diaVenc, req.params.id);
  }
  res.json({ ok: true });
});

// ── ATUALIZAR STATUS ───────────────────────────────────────────────────────
app.post("/api/atualizar-status", (req, res) => {
  const hoje = new Date().toISOString().slice(0,10);
  const r1 = db.prepare(`UPDATE receber SET status='Atrasado' WHERE status='Pendente' AND vencimento < ? AND vencimento != ''`).run(hoje);
  const r2 = db.prepare(`UPDATE pagar SET status='Vencido' WHERE status='Pendente' AND vencimento < ? AND vencimento != ''`).run(hoje);
  res.json({ ok: true, atualizados: r1.changes + r2.changes });
});

// ── SALDO LIVRE ────────────────────────────────────────────────────────────
app.get("/api/saldo-livre", (req, res) => {
  const { mes } = req.query;
  const filtroMes = mes ? `AND data LIKE '${mes}%'` : "";

  const receita    = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM entradas WHERE 1=1 ${filtroMes}`).get().v;
  const totalPagar = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status != 'Pago'`).get().v;
  const totalFixas = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM fixas WHERE ativa=1`).get().v;

  const reservas   = db.prepare(`SELECT meta, prazoDias FROM reservas`).all();
  const totalResv  = reservas.reduce((s,r) => s + r.meta/(r.prazoDias/30), 0);

  const cats       = db.prepare(`SELECT id FROM util_config`).all();
  let totalUtil    = 0;
  cats.forEach(cat => {
    const med = db.prepare(`SELECT COALESCE(AVG(valor),0) as v FROM (SELECT valor FROM util_lancamentos WHERE catId=? ORDER BY mes DESC LIMIT 6)`).get(cat.id).v;
    totalUtil += med;
  });

  const totalComp  = totalPagar + totalFixas + totalResv + totalUtil;
  const saldoLivre = receita - totalComp;
  const pctUsado   = receita > 0 ? Math.min(100, Math.round((totalComp/receita)*100)) : 0;
  const pctLivre   = 100 - pctUsado;
  let semaforo     = "verde";
  if (pctLivre < 0)   semaforo = "negativo";
  else if (pctLivre < 15) semaforo = "vermelho";
  else if (pctLivre < 30) semaforo = "amarelo";

  res.json({
    receita, totalPagar, totalFixas,
    totalReservas: Math.round(totalResv*100)/100,
    totalUtil:     Math.round(totalUtil*100)/100,
    totalComprometido: Math.round(totalComp*100)/100,
    saldoLivre:    Math.round(saldoLivre*100)/100,
    pctUsado, pctLivre, semaforo,
  });
});

// ── INTELIGENTE ────────────────────────────────────────────────────────────
app.get("/api/inteligente", (req, res) => {
  const { mes } = req.query;
  const hoje    = new Date();
  const diaHoje = hoje.getDate();
  const [anoM, mesM] = (mes || `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,"0")}`).split("-");

  const saldoIni  = db.prepare(`SELECT saldoInicial FROM caixa_config WHERE id=1`).get()?.saldoInicial || 0;
  const receita   = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM entradas WHERE data LIKE ?`).get(`${anoM}-${mesM}%`).v;
  const saldoReal = saldoIni + receita;

  const pendPagar = db.prepare(`SELECT * FROM pagar WHERE status != 'Pago'`).all();
  const fixas     = db.prepare(`SELECT * FROM fixas WHERE ativa=1`).all();
  const contasMes = [];

  pendPagar.forEach(p => {
    const diaVenc = p.vencimento ? Number(p.vencimento.split("-")[2]) : 99;
    contasMes.push({
      id: p.id, nome: p.descricao, categoria: p.categoria,
      valor: p.valor, diaVenc, vencimento: p.vencimento,
      status: p.status, tipo: "avulsa",
      prioridade: p.status === "Vencido" ? "critica" : "normal",
    });
  });

  fixas.forEach(f => {
    const diaVenc  = f.diaVenc;
    const dataVenc = `${anoM}-${mesM}-${String(diaVenc).padStart(2,"0")}`;
    contasMes.push({
      id: f.id, nome: f.nome, categoria: f.categoria,
      valor: f.valor, diaVenc, vencimento: dataVenc,
      status: diaVenc < diaHoje ? "Vencido" : "Pendente",
      tipo: "fixa", prioridade: f.prioridade,
    });
  });

  const ordemPrior = { critica:0, alta:1, normal:2, baixa:3 };
  contasMes.sort((a,b) => {
    const pa = ordemPrior[a.prioridade]??2, pb = ordemPrior[b.prioridade]??2;
    return pa !== pb ? pa - pb : a.diaVenc - b.diaVenc;
  });

  let saldoSim = saldoReal;
  const simulacao = contasMes.map(c => {
    const antes = saldoSim;
    saldoSim -= c.valor;
    return { ...c, saldoApos: saldoSim, conseguePagar: antes >= c.valor };
  });

  const totalComprometido = contasMes.reduce((s,c)=>s+c.valor,0);
  const proximosAlerta    = contasMes
    .filter(c => c.diaVenc >= diaHoje && c.diaVenc <= diaHoje+7)
    .map(c => ({ nome:c.nome, diaVenc:c.diaVenc, valor:c.valor, diasRestantes:c.diaVenc-diaHoje }));

  res.json({
    saldoReal, saldoLivre: saldoReal-totalComprometido,
    totalComprometido, receitaMes: receita, diaHoje,
    simulacao, proximosAlerta, totalContas: contasMes.length,
    totalVencidas: contasMes.filter(c=>c.status==="Vencido").reduce((s,c)=>s+c.valor,0),
  });
});

// ── RELATÓRIO MENSAL ───────────────────────────────────────────────────────
app.get("/api/relatorio/mensal", (req, res) => {
  const { mes } = req.query;
  if (!mes) return res.status(400).json({ error: "Informe o mês" });

  const [ano, mesN] = mes.split("-");
  const nomeMes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"][Number(mesN)-1];

  const receita    = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;
  const recDin     = db.prepare(`SELECT COALESCE(SUM(dinheiro),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;
  const recPix     = db.prepare(`SELECT COALESCE(SUM(pix),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;
  const recCart    = db.prepare(`SELECT COALESCE(SUM(cartao),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;
  const recConv    = db.prepare(`SELECT COALESCE(SUM(convenio),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;

  const totalPago  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status='Pago' AND dataPagto LIKE ?`).get(`${mes}%`).v;
  const totalPend  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status!='Pago'`).get().v;
  const totalVenc  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status='Vencido'`).get().v;
  const qtdPagas   = db.prepare(`SELECT COUNT(*) as v FROM pagar WHERE status='Pago' AND dataPagto LIKE ?`).get(`${mes}%`).v;
  const qtdPend    = db.prepare(`SELECT COUNT(*) as v FROM pagar WHERE status!='Pago'`).get().v;
  const qtdVenc    = db.prepare(`SELECT COUNT(*) as v FROM pagar WHERE status='Vencido'`).get().v;
  const qtdEnt     = db.prepare(`SELECT COUNT(*) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;

  const catRows    = db.prepare(`SELECT categoria, SUM(CASE WHEN status='Pago' THEN valor ELSE 0 END) as pago, SUM(CASE WHEN status!='Pago' THEN valor ELSE 0 END) as pendente FROM pagar GROUP BY categoria`).all();
  const porCategoria = {};
  catRows.forEach(r => { porCategoria[r.categoria] = { pago: r.pago, pendente: r.pendente }; });

  const recRec     = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status='Pago'`).get().v;
  const recPend    = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status='Pendente'`).get().v;
  const recAtras   = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status='Atrasado'`).get().v;

  const cartBruto  = db.prepare(`SELECT COALESCE(SUM(valorBruto),0) as v FROM cartao WHERE data LIKE ?`).get(`${mes}%`).v;
  const cartTaxas  = db.prepare(`SELECT COALESCE(SUM(taxaReais),0) as v FROM cartao WHERE data LIKE ?`).get(`${mes}%`).v;
  const cartLiq    = db.prepare(`SELECT COALESCE(SUM(valorLiq),0) as v FROM cartao WHERE data LIKE ?`).get(`${mes}%`).v;

  const totalFixas = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM fixas WHERE ativa=1`).get().v;
  const reservas   = db.prepare(`SELECT meta, prazoDias FROM reservas`).all();
  const totalResv  = reservas.reduce((s,r)=>s+r.meta/(r.prazoDias/30),0);
  const totalComp  = totalPend + totalFixas + totalResv;
  const saldoLivre = receita - totalComp;

  const entDet     = db.prepare(`SELECT * FROM entradas WHERE data LIKE ? ORDER BY data DESC LIMIT 10`).all(`${mes}%`);

  res.json({
    mes, nomeMes, ano, receita,
    recDinheiro:recDin, recPix, recCartao:recCart, recConv,
    totalPago, totalPend, totalVenc,
    qtdEntradas:qtdEnt, qtdPagas, qtdPendentes:qtdPend, qtdVencidas:qtdVenc,
    porCategoria,
    recRecebido:recRec, recPendente:recPend, recAtrasado:recAtras,
    cartBruto, cartTaxas, cartLiq,
    totalFixas, totalResv: Math.round(totalResv*100)/100,
    totalComp: Math.round(totalComp*100)/100,
    saldoLivre: Math.round(saldoLivre*100)/100,
    lucro: receita - totalPago,
    entradasDetalhes: entDet,
  });
});

app.get("/api/relatorio/comparativo", (req, res) => {
  const { mes1, mes2 } = req.query;
  function resumo(mes) {
    const nomeMes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][Number(mes.split("-")[1])-1];
    const rec   = db.prepare(`SELECT COALESCE(SUM(total),0) as v FROM entradas WHERE data LIKE ?`).get(`${mes}%`).v;
    const pago  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status='Pago' AND dataPagto LIKE ?`).get(`${mes}%`).v;
    const desp  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM pagar WHERE status!='Pago'`).get().v;
    const aRec  = db.prepare(`SELECT COALESCE(SUM(valor),0) as v FROM receber WHERE status!='Pago'`).get().v;
    const taxas = db.prepare(`SELECT COALESCE(SUM(taxaReais),0) as v FROM cartao WHERE data LIKE ?`).get(`${mes}%`).v;
    const sIni  = db.prepare(`SELECT saldoInicial FROM caixa_config WHERE id=1`).get()?.saldoInicial||0;
    const cEnt  = db.prepare(`SELECT COALESCE(SUM(entrada),0) as v FROM caixa_movimentos WHERE data LIKE ?`).get(`${mes}%`).v;
    const cSai  = db.prepare(`SELECT COALESCE(SUM(saida),0) as v FROM caixa_movimentos WHERE data LIKE ?`).get(`${mes}%`).v;
    return { mes, nomeMes, receita:rec, despesas:desp, pago, aReceber:aRec, taxasCartao:taxas, saldo:sIni+cEnt-cSai, lucro:rec-pago };
  }
  res.json({ m1: resumo(mes1), m2: resumo(mes2) });
});

// ── START ──────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("\n  ============================================");
  console.log("     HORIZON OPS — Online!");
  console.log("  ============================================");
  console.log("  Porta:", PORT);
  console.log("  Dados:", path.join(DATA_DIR, "horizonops.db"));
  console.log("  ============================================\n");
});
