import express from 'express'
import supabase from './supabase.js'

const app = express()

app.use(express.json())

// TESTE

app.use(express.static('public'))


/*
==============================
CLIENTES
==============================
*/


// LISTAR CLIENTES
app.get('/clientes', async (req,res)=>{

const { data, error } = await supabase
.from('clientes')
.select('*')
.order('nome')

if(error){
return res.send(error)
}

res.send(data)

})



// CRIAR CLIENTE
app.post('/cliente', async (req,res)=>{

const dados = req.body

const { data, error } = await supabase
.from('clientes')
.insert([dados])
.select()

if(error){
return res.send(error)
}

res.send(data)

})



/*
==============================
ORÇAMENTO
==============================
*/


app.post('/orcamento', async (req,res)=>{

try{

const dados = req.body


// BUSCAR CLIENTE

const { data:cliente } = await supabase
.from('clientes')
.select('*')
.eq('id',dados.cliente_id)
.single()


// PARAMETROS

let valor_saida = cliente.valor_saida
let valor_km = cliente.valor_km


// PERMITIR ALTERAÇÃO MANUAL

if(dados.valor_saida){
valor_saida = dados.valor_saida
}

if(dados.valor_km){
valor_km = dados.valor_km
}


// CALCULO

const valor_total =
Number(valor_saida) + (Number(dados.km) * Number(valor_km))



const novo = {

cliente_id: dados.cliente_id,
cliente: cliente.nome,
telefone: dados.telefone,

veiculo: dados.veiculo,
categoria: dados.categoria,
placa: dados.placa,

origem: dados.origem,
destino: dados.destino,

km: dados.km,

valor_saida: valor_saida,
valor_km: valor_km,

valor: valor_total,

status:"novo"

}



const { data, error } = await supabase
.from('orcamentos')
.insert([novo])
.select()

if(error){
return res.send(error)
}

res.send(data)

}catch(e){

res.send(e)

}

})



/*
==============================
LISTAR ORÇAMENTOS
==============================
*/


app.get('/orcamentos', async (req,res)=>{

const { data, error } = await supabase
.from('orcamentos')
.select('*')
.order('id',{ascending:false})

if(error){
return res.send(error)
}

res.send(data)

})


app.use(express.static('.'))
app.listen(3000, ()=>{
console.log('Servidor rodando na porta 3000')
})