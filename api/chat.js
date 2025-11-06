export default async function handler(req, res) {
  // CORS (de momento dejamos * para no liarnos)
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
    const { message, extraContext } = req.body || {};

    if (!message) {
      res.status(400).json({ error: 'Falta el campo "message"' });
      return;
    }

    // 🔑 LLAMADA A OPENAI DESDE EL SERVIDOR
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // cambia aquí al modelo que quieras
        messages: [
          {
            role: 'system',
            content: `Responde usando el siguiente contexto (texto de la web):\n${extraContext || ''}`,
          },
          {
            role: 'user',
            content: message,
          },
        ],
      }),
    });

    const data = await openaiRes.json();

    const reply = data?.choices?.[0]?.message?.content ?? 'No he podido generar respuesta.';

    res.status(200).json({ reply });
  } catch (error) {
    console.error('Error en /api/chat:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
}
