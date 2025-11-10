import fs from "fs";
import path from "path";

// Ruta robusta al site-info.txt
const siteInfoPath = path.join(process.cwd(), "public", "site-info.txt");
let siteInfo = "";

try {
  siteInfo = fs.readFileSync(siteInfoPath, "utf-8");
  console.log("✅ site-info.txt cargado desde:", siteInfoPath);
} catch (err) {
  console.error("🔴 No se ha podido leer site-info.txt:", err);
}

// API key desde Vercel
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.error(
    "🔴 FATAL: La variable de entorno OPENAI_API_KEY no está definida."
  );
} else {
  console.log("✅ OPENAI_API_KEY cargada correctamente para el chatbot.");
}

// 🆕 URL del webhook de n8n desde env
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
console.log("🌍 N8N_WEBHOOK_URL:", n8nWebhookUrl);

export default async function handler(req, res) {
  // 🔐 CORS
  const origin = req.headers.origin || "";
  

  const allowedOrigins = [
    "https://aquamarine-chaja-6ed417.netlify.app",
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed", hint: "Use POST" });
    return;
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const messages = body.messages;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: '"messages" debe ser un array válido' });
      return;
    }

    // 🆕 1. Detectar el último mensaje del usuario
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";

    console.log("🧠 Último mensaje del usuario:", lastUserMessage);

    // 🆕 2. Si el usuario pide una cita → vamos a n8n en lugar de ir a OpenAI
    const quiereCita = /cita/i.test(lastUserMessage); // puedes afinar este regex

    if (quiereCita && n8nWebhookUrl) {
      console.log("📅 Detectada intención de cita. Enviando a n8n...");

      // Aquí podrías sacar name/email del body si los tienes
      const userName = body.name || "Invitado";
      const userEmail = body.email || "invitado@example.com";

      const payload = {
        intent: "book_appointment",
        user: {
          name: userName,
          email: userEmail,
        },
        constraints: {
          durationMinutes: 30,
          // Para simplificar, hoy y próximos 7 días
          fromDate: new Date().toISOString().slice(0, 10),
          toDate: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          )
            .toISOString()
            .slice(0, 10),
          timeWindow: {
            start: "10:00",
            end: "14:00",
          },
          timezone: "Europe/Madrid",
        },
        // Podemos mandar el propio mensaje como nota
        notes: lastUserMessage,
      };

      const n8nRes = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const n8nData = await n8nRes.json();
      console.log("📦 Respuesta de n8n:", JSON.stringify(n8nData, null, 2));

      let answer = "He intentado reservar tu cita, pero algo ha fallado.";

      // Asumimos que el workflow de n8n devuelve algo tipo:
      // { ok: true, message: '...', appointment: { start, end, ... } 
      if (n8nData.ok && n8nData.appointment) {
        const start = n8nData.appointment.start;
        const end = n8nData.appointment.end;

        answer = `He reservado tu cita para el ${start}. Te llegará la confirmación al correo ${userEmail}.`;
      } else if (n8nData.message) {
        answer = n8nData.message;
      }

      // Devolvemos al front en el mismo formato que ya usas
      res.status(200).json({ answer, raw: n8nData });
      return; // 👈 importante: no seguimos a OpenAI en este caso
    }

    // 🧠 Si NO es cita, seguimos con tu flujo normal de OpenAI
    const siteContext = `
Eres el asistente oficial de esta web.
Solo puedes responder basándote en la siguiente información:
${siteInfo}
`;

    console.log(
      "🚀 Llamando a OpenAI con messages:",
      JSON.stringify(messages, null, 2)
    );

    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{ role: "system", content: siteContext }, ...messages],
        }),
      }
    );

    const completion = await openaiRes.json();
    console.log(
      "📦 Respuesta completa de OpenAI:",
      JSON.stringify(completion, null, 2)
    );

    if (!openaiRes.ok) {
      console.error("🔥 Error desde OpenAI:", completion);
      res
        .status(500)
        .json({ error: "Error al comunicarse con OpenAI (ver logs)" });
      return;
    }

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    console.log("✅ Respuesta generada:", answer);

    if (!answer) {
      res.status(200).json({
        answer: "No he podido generar respuesta con la información disponible.",
      });
      return;
    }

    // 👈 FRONT lee `data.answer`
    res.status(200).json({ answer });
  } catch (error) {
    console.error("🔥 Error detallado al llamar a OpenAI:", error);

    let errorMessage = "Error al comunicarse con OpenAI";
    if (error instanceof Error) {
      errorMessage = `Error: ${error.message}`;
    }

    res.status(500).json({ error: errorMessage });
  }
}
