import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./supabase.js";

const app = express();

app.use(cors({ origin: ["https://samguinchos.onrender.com"], credentials: true }));
app.get("/health", (req, res) => res.status(200).send("ok"));

app.use(cors());
app.use(express.json());

app.get("/orcamentos", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orcamentos")
      .select(`
        id, created_at, categoria, placa, origem, destino,
        km_total, valor_bruto, pedagio_total, combustivel_valor,
        manutencao_valor, cooperativa_valor, valor_liquido, margem_liquida_km,
        clientes ( nome ),
        bases ( nome ),
        veiculos ( nome )
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    const out = (data || []).map(o => ({
      ...o,
      cliente_nome: o.clientes?.nome ?? "",
      base_nome: o.bases?.nome ?? "",
      veiculo: o.veiculos?.nome ?? (o.veiculo ?? "")
    }));

    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Servir o frontend
app.use(express.static("public"));

/*
==============================
CLIENTES
==============================
*/

// LISTAR CLIENTES
app.get("/clientes", async (req, res) => {
  const { data, error } = await supabase
    .from("clientes")
    .select("*")
    .order("nome");

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// CRIAR CLIENTE
app.post("/cliente", async (req, res) => {
  const dados = req.body;

  const { data, error } = await supabase
    .from("clientes")
    .insert([dados])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});
/*
==============================
VEICULOS
==============================
*/

// LISTAR VEÍCULOS
app.get('/veiculos', async (req, res) => {
  const { data, error } = await supabase
    .from('veiculos')
    .select('*')
    .eq('ativo', true)
    .order('nome');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
/*
==============================
BASES
==============================
*/

// LISTAR BASES
app.get("/bases", async (req, res) => {
  const { data, error } = await supabase
    .from("bases")
    .select("*")
    .order("nome");

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

/*
==============================
VEICULOS
==============================
*/

// LISTAR VEÍCULOS
app.get('/veiculos', async (req, res) => {
  const { data, error } = await supabase
    .from('veiculos')
    .select('*')
    .eq('ativo', true)
    .order('nome');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// CRIAR VEÍCULO (opcional depois)
app.post('/veiculo', async (req, res) => {
  const dados = req.body;

  const { data, error } = await supabase
    .from('veiculos')
    .insert([dados])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});




/*
==============================
ORÇAMENTO
==============================
*/
// CRIAR ORÇAMENTO
app.post('/orcamento', async (req, res) => {
  try {
    const dados = req.body;

    if (!dados.cliente_id) return res.status(400).json({ error: "cliente_id é obrigatório" });
    if (!dados.base_id) return res.status(400).json({ error: "base_id é obrigatório" });
    if (!dados.veiculo_id) return res.status(400).json({ error: "veiculo_id é obrigatório" });

    // CLIENTE
    const { data: cliente, error: eCli } = await supabase
      .from('clientes')
      .select('id,nome,valor_saida,valor_km,tipo')
      .eq('id', dados.cliente_id)
      .single();

    if (eCli || !cliente) {
      return res.status(400).json({ error: "cliente não encontrado" });
    }

    // VEICULO
    const { data: veic, error: eV } = await supabase
      .from('veiculos')
      .select('*')
      .eq('id', dados.veiculo_id)
      .single();

    if (eV || !veic) {
      return res.status(400).json({ error: "veiculo não encontrado" });
    }

    // PARAMETROS CLIENTE
    let valor_saida = cliente.valor_saida;
    let valor_km = cliente.valor_km;

    if (dados.valor_saida) valor_saida = Number(dados.valor_saida);
    if (dados.valor_km) valor_km = Number(dados.valor_km);

    // KM TOTAL
    const km_total = Number(dados.km_total ?? dados.km ?? 0);

    // BRUTO
    const valor_bruto =
      Number(valor_saida) + (km_total * Number(valor_km));

    // CUSTOS
    const manutencao_percent = Number(dados.manutencao_percent ?? 6.5);
    const diesel_preco_litro = Number(dados.diesel_preco_litro ?? 6.17);
    const km_por_litro = Number(dados.km_por_litro ?? veic.km_por_litro);
    const pedagio_total = Number(dados.pedagio_total ?? 0);

    const manutencao_valor = valor_bruto * (manutencao_percent / 100);
    const combustivel_valor =
      km_por_litro > 0 ? (km_total / km_por_litro) * diesel_preco_litro : 0;

    const cooperativa_percent = (cliente.tipo === "cooperativa") ? 20 : 0;
    const cooperativa_valor = valor_bruto * (cooperativa_percent / 100);

    const valor_liquido =
      valor_bruto
      - pedagio_total
      - manutencao_valor
      - combustivel_valor
      - cooperativa_valor;

    const margem_liquida_km =
      km_total > 0 ? (valor_liquido / km_total) : 0;

    const novo = {
      cliente_id: cliente.id,
      base_id: dados.base_id,
      veiculo_id: veic.id,

      cliente: cliente.nome,
      veiculo: veic.nome,

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
      .from('orcamentos')
      .insert([novo])
      .select()
      .single();

    if (error) {
      console.log(error);
      return res.status(400).json({ error: error.message });
    }

    res.json(data);

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: String(e) });
  }
});

/*
==============================
HISTÓRICO
==============================
*/

// LISTAR ORÇAMENTOS (histórico)
app.get("/orcamentos", async (req, res) => {
  const { data, error } = await supabase
    .from("orcamentos")
    .select("*")
    .order("id", { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});


// ========================================
// CALCULO DE ROTA GOOGLE (SEGURO)
// ========================================
app.post("/rota", async (req, res) => {
  const startedAt = Date.now();



  try {
    const { origem, destino, base_id } = req.body || {};

          function isUUID(v) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(String(v || ""));
      }

      if (!isUUID(base_id)) {
        return res.status(400).json({
          erro: "base_id inválido (esperado UUID)",
          recebido: base_id
        });
      }
    // 1) validação simples e objetiva
    if (typeof origem !== "string" || !origem.trim()) {
      return res.status(400).json({ erro: "Informe 'origem' (string)" });
    }
    if (typeof destino !== "string" || !destino.trim()) {
      return res.status(400).json({ erro: "Informe 'destino' (string)" });
    }
    if (typeof base_id !== "string" || !base_id.trim()) {
      return res.status(400).json({ erro: "Informe 'base_id' (UUID/string)" });
    }

    // 2) buscar base no Supabase
    const { data: base, error: baseErr } = await supabase
      .from("bases")
      .select("id,nome,endereco")
      .eq("id", base_id)
      .single();

    if (baseErr || !base) {
      return res.status(400).json({
        erro: "Base não encontrada",
        detalhes: baseErr?.message || "base null"
      });
    }
    if (!base.endereco || !String(base.endereco).trim()) {
      return res.status(400).json({ erro: "Base sem endereco cadastrado" });
    }

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      return res.status(500).json({ erro: "GOOGLE_MAPS_KEY não configurada no .env" });
    }

    // 3) helper: chama Directions API com timeout + parsing seguro
    async function directions(from, to) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15s

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
          return {
            ok: false,
            status: j.status || "NO_STATUS",
            error_message: j.error_message || null,
            from,
            to
          };
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
        return {
          ok: false,
          status: aborted ? "TIMEOUT" : "FETCH_ERROR",
          error_message: aborted ? "Request timeout" : String(err),
          from,
          to
        };
      } finally {
        clearTimeout(timeout);
      }
    }

    const baseEnd = base.endereco.trim();
    const orig = origem.trim();
    const dest = destino.trim();

    // 4) calcula pernas:
    // - p1 (base -> origem)
    // - p2 (origem -> destino)
    // - p3 (destino -> base)
    //
    // Observação: p2 independe das demais, então pode ir em paralelo com p1.
    const [p1, p2] = await Promise.all([
      directions(baseEnd, orig),
      directions(orig, dest)
    ]);

    if (!p1.ok) {
      return res.status(400).json({ erro: "Directions falhou Base→Origem", ...p1 });
    }
    if (!p2.ok) {
      return res.status(400).json({ erro: "Directions falhou Origem→Destino", ...p2 });
    }

    // p3 depende só do destino/base (pode ser após validar p1/p2)
    const p3 = await directions(dest, baseEnd);
    if (!p3.ok) {
      return res.status(400).json({ erro: "Directions falhou Destino→Base", ...p3 });
    }

    // 5) totais
    const km_total = p1.km + p2.km + p3.km;
    const dur_total_min = p1.duration_min + p2.duration_min + p3.duration_min;

    // 6) resposta padronizada p/ frontend + histórico
    return res.json({
      km_total: Number(km_total.toFixed(1)),
      duracao_total_min: Number(dur_total_min.toFixed(0)),
      pernas: [
        {
          trecho: "BASE_ORIGEM",
          from: p1.start_address,
          to: p1.end_address,
          km: Number(p1.km.toFixed(1)),
          duracao_min: Number(p1.duration_min.toFixed(0))
        },
        {
          trecho: "ORIGEM_DESTINO",
          from: p2.start_address,
          to: p2.end_address,
          km: Number(p2.km.toFixed(1)),
          duracao_min: Number(p2.duration_min.toFixed(0))
        },
        {
          trecho: "DESTINO_BASE",
          from: p3.start_address,
          to: p3.end_address,
          km: Number(p3.km.toFixed(1)),
          duracao_min: Number(p3.duration_min.toFixed(0))
        }
      ],
      base: { id: base.id, nome: base.nome, endereco: baseEnd },
      input: { origem: orig, destino: dest, base_id },
      meta: { ms: Date.now() - startedAt }
    });
  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhes: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => { console.log(`Servidor rodando na porta ${PORT}`);

});