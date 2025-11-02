// api/search.js
const neo4j = require('neo4j-driver');

// Ler variáveis de ambiente (defina no Vercel)
const {
  NEO4J_URI,
  NEO4J_USERNAME,
  NEO4J_PASSWORD,
  NEO4J_DATABASE
} = process.env;

if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  // se estiver em ambiente de build sem vars, não falha aqui; falhará em runtime com mensagem útil
  console.warn('AVISO: variáveis de ambiente do Neo4j não configuradas.');
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
  { disableLosslessIntegers: true } // para que números venham como JS number
);

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = async function (req, res) {
  try {
    if (req.method !== 'GET') {
      res.status(405).json({ message: 'Método não permitido' });
      return;
    }

    const palavra = (req.query.palavra || '').trim();
    if (!palavra) {
      res.status(400).json({ message: 'Parâmetro "palavra" é obrigatório.' });
      return;
    }

    const session = driver.session({ database: NEO4J_DATABASE || undefined });

    // 1) Tentar obter nós e relações SIMILAR (com peso salvo)
    const q1 = `
      MATCH (n:Palavra {nome: $nome})
      OPTIONAL MATCH (n)-[r:SIMILAR]->(m:Palavra)
      RETURN n.embedding AS emb, collect({nome: m.nome, peso: r.peso}) AS edges
    `;
    const result = await session.run(q1, { nome: palavra });

    if (result.records.length === 0) {
      await session.close();
      res.status(404).json({ message: `Palavra "${palavra}" não encontrada no banco.` });
      return;
    }

    const rec = result.records[0];
    const emb = rec.get('emb') || null;
    const edges = rec.get('edges') || [];

    let results = [];

    // Filtrar edges que têm nome (pode haver nulls na collection)
    const validEdges = edges.filter(e => e && e.nome).map(e => ({ nome: e.nome, peso: Number(e.peso) || 0 }));

    if (validEdges.length > 0) {
      // se já há arestas com peso, ordenar e retornar
      validEdges.sort((a,b)=>b.peso - a.peso);
      results = validEdges.slice(0, 50);
      await session.close();
      res.status(200).json({ source: 'relations', results });
      return;
    }

    // 2) Se não houver arestas, usar embeddings para calcular similaridade (no servidor).
    if (!emb) {
      await session.close();
      res.status(404).json({ message: `Palavra "${palavra}" existe, mas não possui embedding armazenado.` });
      return;
    }

    // Buscar embeddings dos outros nós (limitar para evitar cargas muito grandes)
    // Ajuste o LIMIT conforme sua base (aqui usamos 5000 para segurança)
    const q2 = `
      MATCH (m:Palavra)
      WHERE m.nome <> $nome AND exists(m.embedding)
      RETURN m.nome AS nome, m.embedding AS emb
      LIMIT 5000
    `;
    const all = await session.run(q2, { nome: palavra });

    const candidates = all.records.map(r => {
      return { nome: r.get('nome'), emb: r.get('emb') };
    });

    // Calcular cosine para cada candidato
    const scores = candidates.map(c => {
      const s = cosine(emb, c.emb);
      return { nome: c.nome, peso: s };
    });

    scores.sort((a,b)=>b.peso - a.peso);
    results = scores.slice(0, 50);

    await session.close();
    res.status(200).json({ source: 'computed', results });
  } catch (err) {
    console.error('Erro no API /api/search:', err);
    res.status(500).json({ message: 'Erro interno ao buscar dados.' });
  }
};