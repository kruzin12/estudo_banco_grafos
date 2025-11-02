// /api/search.js
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
  { disableLosslessIntegers: true }
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

//Calcular valor do peso
function calcularNivel(peso) {
  const K = 10;
  const nivel = 1 + Math.round((1 - peso) * K);
  return nivel < 1 ? 1 : nivel;
}

module.exports = async function (req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Método não permitido' });
    return;
  }

  const palavra = (req.query.palavra || '').trim().toLowerCase();
  const alvo = (process.env.PALAVRA_SECRETA || '').trim().toLowerCase();

  if (!palavra) {
    res.status(400).json({ message: 'Informe uma palavra.' });
    return;
  }

  if (!alvo) {
    res.status(500).json({ message: 'Nenhuma palavra secreta definida.' });
    return;
  }

  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });

  try {
    //Buscar embeddings das duas palavras
    const query = `
      MATCH (a:Palavra) WHERE toLower(a.nome) = $palavra
      OPTIONAL MATCH (b:Palavra) WHERE toLower(b.nome) = $alvo
      RETURN a.embedding AS embA, b.embedding AS embB
    `;
    const result = await session.run(query, { palavra, alvo });

    if (result.records.length === 0) {
      res.status(404).json({ message: `Palavra "${palavra}" não encontrada.` });
      return;
    }

    const rec = result.records[0];
    const embA = rec.get('embA');
    const embB = rec.get('embB');

    if (!embA) {
      res.status(404).json({ message: `A palavra "${palavra}" não foi encontrada no banco.` });
      return;
    }
    if (!embB) {
      res.status(500).json({ message: 'A palavra não está cadastrada no banco.' });
      return;
    }

    //Calcular similaridade
    const peso = cosine(embA, embB);

    //Calcular valor do peso para usuario
    const nivel = calcularNivel(peso);

    if (palavra === alvo) {
      res.status(200).json({
        acertou: true,
        palavra,
        peso: 1.0,
        mensagem: 'Parabéns! Você acertou a palavra.'
      });
    } else {
      res.status(200).json({
        acertou: false,
        palavra,
        peso: Number(peso.toFixed(6))
      });
    }
  } catch (err) {
    console.error('Erro /api/search:', err);
    res.status(500).json({ message: 'Erro interno ao buscar no Neo4j.' });
  } finally {
    await session.close();
  }
};