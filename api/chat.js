export default async function handler(req, res) {
  // 👇 CORS para permitir peticiones desde tu dominio
  res.setHeader('Access-Control-Allow-Origin', 'https://TU-DOMINIO.COM'); // cámbialo por tu dominio real
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    // Respuesta al preflight CORS
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;

    // Puedes adaptar esto a cómo envías los datos desde el frontend
    const userMessage = body.message || '';
    const extraContext = body.extraContext || ''; // por si le mandas el contenido del .txt o similar

    // ==== LLAMADA A OPENAI DESDE EL SERVIDOR ====
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // o el modelo que estés usando
        messages: [
          {
            role: 'system',
            content: `Eres un asistente que responde usando la información de este contexto:\n${extraContext}`,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
    });

    const data = await openaiRes.json();

    // Devuelves la respuesta al frontend
    res.status(200).json({
      reply: data.choices?.[0]?.message?.content ?? 'No he podido generar respuesta',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
}
