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

export default async function handler(req, res) {
  // 🔐 CORS
  const origin = req.headers.origin || "";

  const allowedOrigins = [
    "https://aquamarine-chaja-6ed417.netlify.app",
    "http://localhost:4321", // Astro en local (ajusta si usas otro puerto)
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
