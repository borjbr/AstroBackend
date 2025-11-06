import fs from 'fs';

// Lee el contexto de la web (igual que en Astro)
const siteInfo = fs.readFileSync('./public/site-info.txt', 'utf-8');

// API key desde Vercel
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error('🔴 FATAL: La variable de entorno OPENAI_API_KEY no está definida.');
} else {
  console.log('✅ OPENAI_API_KEY cargada correctamente para el chatbot.');
}

export default async function handler(req, res) {
  // CORS (puedes sustituir * por tu dominio cuando quieras)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed', hint: 'Use POST' });
    return;
  }

  try {
    // Vercel ya parsea JSON si el Content-Type es application/json,
    // pero por si acaso controlamos ambos casos:
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    const messages = body.messages;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: '"messages" debe ser un array válido' });
      return;
    }

    const siteContext = `
Eres el asistente oficial de esta web.
Solo puedes responder basándote en la siguiente información:
${siteInfo}
`;

    console.log('🚀 Llamando a OpenAI con messages:', messages);

    // Llamada a OpenAI vía fetch
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: siteContext },
          ...messages,
        ],
      }),
    });

    const completion = await openaiRes.json();

    if (!openaiRes.ok) {
      console.error('🔥 Error desde OpenAI:', completion);
      res
        .status(500)
        .json({ error: 'Error al comunicarse con OpenAI (ver logs)' });
      return;
    }

    const answer = completion.choices?.[0]?.message?.content ?? '';
    console.log('✅ Respuesta generada:', answer);

    res.status(200).json({ answer });
  } catch (error) {
    console.error('🔥 Error detallado al llamar a OpenAI:', error);

    let errorMessage = 'Error al comunicarse con OpenAI';
    if (error instanceof Error) {
      errorMessage = `Error: ${error.message}`;
    }

    res.status(500).json({ error: errorMessage });
  }
}
