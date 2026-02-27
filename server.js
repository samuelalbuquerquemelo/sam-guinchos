import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./supabase.js";

const app = express();

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
  try {
    const { origem, destino, base_id } = req.body || {};

    if (!origem || !destino || !base_id) {
      return res.status(400).json({ erro: "Informe base_id, origem e destino" });
    }

    // buscar base (UUID)
    const { data: base, error: baseErr } = await supabase
      .from("bases")
      .select("id,nome,endereco")
      .eq("id", base_id)
      .single();

    if (baseErr) return res.status(400).json({ erro: "Base não encontrada", detalhes: baseErr.message });
    if (!base?.endereco) return res.status(400).json({ erro: "base sem endereco" });

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) return res.status(500).json({ erro: "GOOGLE_MAPS_KEY não configurada no .env" });

    async function directions(from, to) {
      const url =
        `https://maps.googleapis.com/maps/api/directions/json?` +
        `origin=${encodeURIComponent(from)}` +
        `&destination=${encodeURIComponent(to)}` +
        `&mode=driving&units=metric` +
        `&key=${encodeURIComponent(key)}`;

      const r = await fetch(url);
      const j = await r.json();

      // validações
      if (j.status !== "OK" || !j.routes?.length || !j.routes[0]?.legs?.length) {
        return {
          ok: false,
          status: j.status,
          error_message: j.error_message || null,
          from,
          to
        };
      }

      const leg = j.routes[0].legs[0];
      const km = (leg.distance?.value || 0) / 1000;

      return { ok: true, km };
    }

    const baseEnd = base.endereco;

    const p1 = await directions(baseEnd, origem);
    if (!p1.ok) return res.status(400).json({ erro: "Directions falhou Base→Origem", ...p1 });

    const p2 = await directions(origem, destino);
    if (!p2.ok) return res.status(400).json({ erro: "Directions falhou Origem→Destino", ...p2 });

    const p3 = await directions(destino, baseEnd);
    if (!p3.ok) return res.status(400).json({ erro: "Directions falhou Destino→Base", ...p3 });

    const total = p1.km + p2.km + p3.km;

    return res.json({
      km_total: Number(total.toFixed(1)),
      partes: {
        base_origem: Number(p1.km.toFixed(1)),
        origem_destino: Number(p2.km.toFixed(1)),
        destino_base: Number(p3.km.toFixed(1))
      },
      base: { id: base.id, nome: base.nome, endereco: baseEnd }
    });
  } catch (e) {
    return res.status(500).json({ erro: String(e) });
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);

});