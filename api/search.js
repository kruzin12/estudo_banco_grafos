// /api/search.js
const neo4j = require('neo4j-driver');

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USERNAME, process.env.NEO4J_PASSWORD),
  { disableLosslessIntegers: true }
);

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
    //Busca o peso da relação entre as duas palavras (em qualquer direção)
    const query = `
      MATCH (a:Palavra) WHERE toLower(a.nome) = $palavra
      MATCH (b:Palavra) WHERE toLower(b.nome) = $alvo
      OPTIONAL MATCH (a)-[r:SIMILAR]-(b)
      RETURN r.peso AS peso
    `;
    const result = await session.run(query, { palavra, alvo });

    //Se nenhuma correspondência for encontrada
    if (result.records.length === 0) {
      res.status(404).json({ message: `Palavra "${palavra}" não encontrada.` });
      return;
    }

    const rec = result.records[0];
    const peso = rec.get('peso');

    //Acerto exato
    if (palavra === alvo) {
      res.status(200).json({
        acertou: true,
        palavra,
        peso: 1.0,
        nivel: 1,
        mensagem: 'Parabéns! Você acertou a palavra.'
      });
      return;
    }

    //Caso não haja relação direta
    if (peso === null || peso === undefined) {
      res.status(200).json({
        acertou: false,
        palavra,
        peso: 0,
        nivel: 10,
        mensagem: 'Sem relação direta com a palavra secreta.'
      });
      return;
    }

    //Caso haja relação com peso
    const nivel = calcularNivel(peso);
    res.status(200).json({
      acertou: false,
      palavra,
      peso: Number(peso.toFixed(3))
    });

  } catch (err) {
    console.error('Erro /api/search:', err);
    res.status(500).json({ message: 'Erro interno ao buscar no Neo4j.' });
  } finally {
    await session.close();
  }
};