import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { supabase } from "./supabase.js";

const app = express();

// ==============================
// CONFIG
// ==============================
const AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";

// ==============================
// MIDDLEWARES
// ==============================
app.use(cors({
  origin: [
    "https://samguinchos.onrender.com",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000"
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.static("public"));

app.get("/health", (req, res) => res.status(200).send("ok"));

// ==============================
// HELPERS
// ==============================
function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(v || ""));
}

function normTel(v) {
  return String(v || "").replace(/\D/g, "");
}

// Token simples assinado (HMAC)
// token = base64url(payload).base64url(sig)
function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signToken(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const sig = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const expected = b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest());
    if (expected !== sig) return null;
    const obj = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!obj?.id || !obj?.usuario) return null;
    // exp opcional
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  // libera health e login e assets
  if (req.path === "/health") return next();
  if (req.path.startsWith("/auth/")) return next();

  // assets (js, css, imagens, html) podem carregar para mostrar login
  // mas as APIs precisam de token
  const isApi =
    req.path.startsWith("/clientes") ||
    req.path.startsWith("/cliente") ||
    req.path.startsWith("/bases") ||
    req.path.startsWith("/veiculos") ||
    req.path.startsWith("/orcamentos") ||
    req.path.startsWith("/orcamento") ||
    req.path.startsWith("/rota");

  if (!isApi) return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Não autenticado" });

  req.user = user;
  return next();
}

app.use(requireAuth);

// ==============================
// AUTH
// ==============================
app.post("/auth/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) return res.status(400).json({ error: "Informe usuário e senha" });

    // usa RPC criada no SQL: validar_operador
    const { data, error } = await supabase.rpc("validar_operador", {
      p_usuario: String(usuario),
      p_senha: String(senha)
    });

    if (error) return res.status(500).json({ error: error.message });

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.id) return res.status(401).json({ error: "Usuário ou senha inválidos" });

    const token = signToken({
      id: row.id,
      usuario: row.usuario,
      nome: row.nome,
      exp: Date.now() + (1000 * 60 * 60 * 12) // 12h
    });

    return res.json({
      ok: true,
      token,
      operador: { id: row.id, usuario: row.usuario, nome: row.nome }
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get("/auth/me", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Não autenticado" });
  return res.json({ ok: true, user });
});

// ==============================
// CLIENTES
// ==============================
app.get("/clientes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .order("nome");

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Buscar cliente por telefone (chave)
app.get("/cliente_por_telefone", async (req, res) => {
  try {
    const tel = normTel(req.query.telefone);
    if (!tel || tel.length < 10) {
      return res.status(400).json({ error: "telefone inválido" });
    }

    const { data, error } = await supabase
      .from("clientes")
      .select("*")
      .eq("telefone_norm", tel)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    if (!data) return res.status(404).json({ error: "não encontrado" });

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.post("/cliente", async (req, res) => {
  try {
    const dados = req.body || {};
    if (!dados.nome) return res.status(400).json({ error: "nome é obrigatório" });
    if (!dados.telefone) return res.status(400).json({ error: "telefone é obrigatório" });

    const tel = normTel(dados.telefone);
    if (!tel || tel.length < 10) return res.status(400).json({ error: "telefone inválido" });

    // se já existe, devolve ele
    const { data: existing } = await supabase
      .from("clientes")
      .select("*")
      .eq("telefone_norm", tel)
      .maybeSingle();

    if (existing?.id) return res.json(existing);

    // cria novo
    const payload = {
      nome: String(dados.nome).trim(),
      telefone: String(dados.telefone).trim(),
      // defaults de preço, se vierem do front
      valor_saida: dados.valor_saida != null ? Number(dados.valor_saida) : null,
      valor_km: dados.valor_km != null ? Number(dados.valor_km) : null,
      tipo: dados.tipo || "particular"
    };

    const { data, error } = await supabase
      .from("clientes")
      .insert([payload])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ==============================
// BASES
// ==============================
app.get("/bases", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bases")
      .select("*")
      .order("nome");

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ==============================
// VEICULOS
// ==============================
app.get("/veiculos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("veiculos")
      .select("*")
      .eq("ativo", true)
      .order("nome");

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ==============================
// ORÇAMENTO (CRIAR)
// ==============================
app.post("/orcamento", async (req, res) => {
  try {
    const dados = req.body || {};

    if (!dados.base_id) return res.status(400).json({ error: "base_id é obrigatório" });
    if (!dados.veiculo_id) return res.status(400).json({ error: "veiculo_id é obrigatório" });

    // VEICULO
    const { data: veic, error: eV } = await supabase
      .from("veiculos")
      .select("*")
      .eq("id", dados.veiculo_id)
      .single();

    if (eV || !veic) return res.status(400).json({ error: "veiculo não encontrado" });

    // CLIENTE (opcional) - pelo cliente_id ou pelo telefone
    let cliente = null;
    if (dados.cliente_id && isUUID(dados.cliente_id)) {
      const { data: cli } = await supabase
        .from("clientes")
        .select("id,nome,valor_saida,valor_km,tipo,telefone,telefone_norm")
        .eq("id", dados.cliente_id)
        .maybeSingle();
      if (cli?.id) cliente = cli;
    } else if (dados.cliente_telefone) {
      const tel = normTel(dados.cliente_telefone);
      if (tel.length >= 10) {
        const { data: cli } = await supabase
          .from("clientes")
          .select("id,nome,valor_saida,valor_km,tipo,telefone,telefone_norm")
          .eq("telefone_norm", tel)
          .maybeSingle();
        if (cli?.id) cliente = cli;
      }
    }

    // PARAMETROS
    // se cliente existe e não vier override, usa tabela
    let valor_saida = cliente?.valor_saida ?? 0;
    let valor_km = cliente?.valor_km ?? 0;

    if (dados.valor_saida != null && dados.valor_saida !== "") valor_saida = Number(dados.valor_saida);
    if (dados.valor_km != null && dados.valor_km !== "") valor_km = Number(dados.valor_km);

    const km_total = Number(dados.km_total ?? dados.km ?? 0);

    // BRUTO
    const valor_bruto = Number(valor_saida) + (km_total * Number(valor_km));

    // CUSTOS
    const manutencao_percent = Number(dados.manutencao_percent ?? 6.5);
    const diesel_preco_litro = Number(dados.diesel_preco_litro ?? 6.17);
    const km_por_litro = Number(dados.km_por_litro ?? veic.km_por_litro);
    const pedagio_total = Number(dados.pedagio_total ?? 0);

    const manutencao_valor = valor_bruto * (manutencao_percent / 100);
    const combustivel_valor = km_por_litro > 0 ? (km_total / km_por_litro) * diesel_preco_litro : 0;

    const cooperativa_percent =
      (cliente?.tipo === "cooperativa") ? 20 : 0;

    const cooperativa_valor = valor_bruto * (cooperativa_percent / 100);

    const valor_liquido =
      valor_bruto
      - pedagio_total
      - manutencao_valor
      - combustivel_valor
      - cooperativa_valor;

    const margem_liquida_km = km_total > 0 ? (valor_liquido / km_total) : 0;

    // SNAPSHOT (histórico visível)
    const snapNome = String(dados.cliente_nome || cliente?.nome || "").trim();
    const snapTel = String(dados.cliente_telefone || cliente?.telefone || "").trim();
    const tipo_contato = String(dados.tipo_contato || "").trim();

    const novo = {
      cliente_id: cliente?.id ?? null,
      base_id: dados.base_id,
      veiculo_id: veic.id,

      // legado que você já tinha
      cliente: cliente?.nome ?? snapNome,
      veiculo: veic.nome,

      // NOVOS snapshots
      tipo_contato,
      cliente_nome: snapNome,
      cliente_telefone: snapTel,

      categoria: dados.categoria,
      placa: dados.placa,
      origem: dados.origem,
      destino: dados.destino,

      km_total,
      valor_saida,
      valor_km,
      valor_bruto,
      pedagio_total,

      manutencao_percent,
      manutencao_valor,
      diesel_preco_litro,
      km_por_litro,
      combustivel_valor,
      cooperativa_percent,
      cooperativa_valor,

      valor_liquido,
      margem_liquida_km,

      status: "novo"
    };

    const { data, error } = await supabase
      .from("orcamentos")
      .insert([novo])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    return res.json(data);
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: String(e) });
  }
});

// ==============================
// ORÇAMENTOS (HISTÓRICO)
// ==============================
app.get("/orcamentos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orcamentos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ==============================
// ROTA (KM total via Directions REST)
// ==============================
app.post("/rota", async (req, res) => {
  const startedAt = Date.now();

  try {
    const { origem, destino, base_id } = req.body || {};

    if (typeof origem !== "string" || !origem.trim()) {
      return res.status(400).json({ erro: "Informe 'origem' (string)" });
    }
    if (typeof destino !== "string" || !destino.trim()) {
      return res.status(400).json({ erro: "Informe 'destino' (string)" });
    }
    if (!isUUID(base_id)) {
      return res.status(400).json({ erro: "base_id inválido (UUID)", recebido: base_id });
    }

    const { data: base, error: baseErr } = await supabase
      .from("bases")
      .select("id,nome,endereco")
      .eq("id", base_id)
      .single();

    if (baseErr || !base) {
      return res.status(400).json({ erro: "Base não encontrada", detalhes: baseErr?.message || "base null" });
    }
    if (!base.endereco || !String(base.endereco).trim()) {
      return res.status(400).json({ erro: "Base sem endereco cadastrado" });
    }

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      return res.status(500).json({ erro: "GOOGLE_MAPS_KEY não configurada no Render" });
    }

    async function directions(from, to) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const url =
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${encodeURIComponent(from)}` +
          `&destination=${encodeURIComponent(to)}` +
          `&mode=driving&units=metric` +
          `&key=${encodeURIComponent(key)}`;

        const r = await fetch(url, { signal: controller.signal });
        const j = await r.json().catch(() => ({}));

        if (j.status !== "OK" || !j.routes?.length || !j.routes[0]?.legs?.length) {
          return { ok: false, status: j.status || "NO_STATUS", error_message: j.error_message || null, from, to };
        }

        const leg = j.routes[0].legs[0];
        const distance_m = Number(leg.distance?.value || 0);
        const duration_s = Number(leg.duration?.value || 0);

        return {
          ok: true,
          km: distance_m / 1000,
          duration_min: duration_s / 60,
          start_address: leg.start_address || from,
          end_address: leg.end_address || to
        };
      } catch (err) {
        const aborted = String(err?.name || "").toLowerCase().includes("abort");
        return { ok: false, status: aborted ? "TIMEOUT" : "FETCH_ERROR", error_message: aborted ? "Request timeout" : String(err), from, to };
      } finally {
        clearTimeout(timeout);
      }
    }

    const baseEnd = base.endereco.trim();
    const orig = origem.trim();
    const dest = destino.trim();

    const [p1, p2] = await Promise.all([
      directions(baseEnd, orig),
      directions(orig, dest)
    ]);

    if (!p1.ok) return res.status(400).json({ erro: "Directions falhou Base→Origem", ...p1 });
    if (!p2.ok) return res.status(400).json({ erro: "Directions falhou Origem→Destino", ...p2 });

    const p3 = await directions(dest, baseEnd);
    if (!p3.ok) return res.status(400).json({ erro: "Directions falhou Destino→Base", ...p3 });

    const km_total = p1.km + p2.km + p3.km;
    const dur_total_min = p1.duration_min + p2.duration_min + p3.duration_min;

    return res.json({
      km_total: Number(km_total.toFixed(1)),
      duracao_total_min: Number(dur_total_min.toFixed(0)),
      pernas: [
        { trecho: "BASE_ORIGEM", from: p1.start_address, to: p1.end_address, km: Number(p1.km.toFixed(1)), duracao_min: Number(p1.duration_min.toFixed(0)) },
        { trecho: "ORIGEM_DESTINO", from: p2.start_address, to: p2.end_address, km: Number(p2.km.toFixed(1)), duracao_min: Number(p2.duration_min.toFixed(0)) },
        { trecho: "DESTINO_BASE", from: p3.start_address, to: p3.end_address, km: Number(p3.km.toFixed(1)), duracao_min: Number(p3.duration_min.toFixed(0)) }
      ],
      base: { id: base.id, nome: base.nome, endereco: baseEnd },
      input: { origem: orig, destino: dest, base_id },
      meta: { ms: Date.now() - startedAt }
    });
  } catch (e) {
    console.error("[/rota] ERRO:", e);
    return res.status(500).json({ erro: "Erro interno", detalhes: String(e) });
  }
});

// ==============================
// START
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});