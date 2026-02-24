import "dotenv/config";
import express from "express";
import cors from "cors";
import { supabase } from "./supabase.js";

const app = express();

app.use(cors());
app.use(express.json());

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
ORÇAMENTO
==============================
*/

// CRIAR ORÇAMENTO
app.post("/orcamento", async (req, res) => {
  try {
    const dados = req.body || {};

    if (!dados.cliente_id) {
      return res.status(400).json({ error: "cliente_id é obrigatório" });
    }

    // Buscar cliente (pega parâmetros padrão)
    const { data: cliente, error: errCliente } = await supabase
      .from("clientes")
      .select("*")
      .eq("id", dados.cliente_id)
      .single();

    if (errCliente) {
      return res.status(400).json({ error: "Cliente não encontrado", details: errCliente.message });
    }

    // parâmetros (permite sobrescrever pelo formulário)
    let valor_saida = cliente.valor_saida ?? 0;
    let valor_km = cliente.valor_km ?? 0;

    if (dados.valor_saida !== undefined && dados.valor_saida !== "") {
      valor_saida = Number(dados.valor_saida);
    }
    if (dados.valor_km !== undefined && dados.valor_km !== "") {
      valor_km = Number(dados.valor_km);
    }

    const km = dados.km !== undefined && dados.km !== "" ? Number(dados.km) : 0;

    // cálculo
    const valor_total = Number(valor_saida) + (Number(km) * Number(valor_km));

    // OBS: sua tabela atual tem "valor" (e você mostrou "data" e "status").
    // Não vou mandar base_id por enquanto, porque provavelmente não existe na tabela e quebra insert.
    const novo = {
   
      cliente_id: Number(dados.cliente_id),
      cliente: cliente.nome ?? null,
      telefone: cliente.telefone ?? null,

      veiculo: dados.veiculo ?? null,
      categoria: dados.categoria ?? null,
      placa: dados.placa ?? null,

      origem: dados.origem ?? null,
      destino: dados.destino ?? null,

      km: km,

      valor_saida: valor_saida,
      valor_km: valor_km,

      valor: valor_total,     // coluna existente
      valor_total: valor_total, // se existir, preenche também (se não existir, remova esta linha)

      data: new Date().toISOString().slice(0, 10), // YYYY-MM-DD (se a coluna existir)
      status: "novo"
    };

    const { data, error } = await supabase
      .from("orcamentos")
      .insert([novo])
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message, details: error });
    }

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
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

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});