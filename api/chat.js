import fs from "fs";
import path from "path";

// ---- Carga site-info.txt
const siteInfoPath = path.join(process.cwd(), "public", "site-info.txt");
let siteInfo = "";
try {
  siteInfo = fs.readFileSync(siteInfoPath, "utf-8");
  console.log("✅ site-info.txt cargado:", siteInfoPath);
} catch (err) {
  console.error("🔴 No se ha podido leer site-info.txt:", err);
}

// ---- Env vars
const apiKey = process.env.OPENAI_API_KEY;
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;

if (!apiKey) console.error("🔴 FATAL: OPENAI_API_KEY no definida.");
else console.log("✅ OPENAI_API_KEY cargada.");

export default async function handler(req, res) {
  // ---- CORS
  const origin = req.headers.origin || "";
  const allowedOrigins = ["https://aquamarine-chaja-6ed417.netlify.app"];
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", hint: "Use POST" });
  }

  try {
    // ---- Body
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const messages = body.messages;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: '"messages" debe ser un array válido' });
    }

    // ---- System prompt
    const siteContext = `
Eres Carmen Aguirre Ruigomez, la recepcionista virtual de la clínica dental SonrisaPerfecta.
Hablas en tono cercano, educado y profesional.

TU OBJETIVO:
- Informar y, si el usuario quiere cita, guiarle para obtener datos completos y generar un JSON de reserva.
- Nunca inventes mes/año/hora si faltan: pregunta antes.
- Horario de la clínica: L-V de 09:00 a 18:00 (Europe/Madrid).

Formatea fechas como "YYYY-MM-DD" y horas "HH:MM".
Entiende expresiones como "once y media" -> "11:30".

Info de la clínica:
${siteInfo}

Cuando tengas todos los datos CONFIRMADOS, responde SOLO con este JSON (sin texto extra):
{
  "intent": "book_appointment",
  "user": { "name": "Nombre Apellidos", "email": "correo@ejemplo.com", "phone": "666777888" },
  "constraints": {
    "durationMinutes": 30,
    "fromDate": "YYYY-MM-DD",
    "toDate": "YYYY-MM-DD",
    "timeWindow": { "start": "HH:MM", "end": "HH:MM" },
    "timezone": "Europe/Madrid"
  },
  "notes": "Motivo de la cita..."
}

Tras recibir confirmación DEL SISTEMA de que la cita se creó, ya puedes comunicarlo al usuario.`;

    console.log("🚀 Llamando a OpenAI con messages:", JSON.stringify(messages, null, 2));

    // ---- OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: siteContext }, ...messages],
      }),
    });

    const completionText = await openaiRes.text(); // tolerante
    let completion;
    try { completion = JSON.parse(completionText); } catch { completion = {}; }

    if (!openaiRes.ok) {
      console.error("🔥 Error desde OpenAI:", completion || completionText);
      return res.status(500).json({ error: "Error al comunicarse con OpenAI (ver logs)" });
    }

    const rawAnswer = completion?.choices?.[0]?.message?.content?.trim() ?? "";
    console.log("📝 Respuesta generada (raw):", rawAnswer);

    // ---- ¿Es JSON de reserva?
    let parsed = null;
    try { parsed = JSON.parse(rawAnswer); } catch {}

    if (parsed && parsed.intent === "book_appointment" && n8nWebhookUrl) {
      console.log("📅 JSON de reserva detectado, enviando a n8n…", parsed);

      // ---- Llamada a n8n
      const n8nRes = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      const raw = await n8nRes.text(); // puede venir vacío o texto
      let n8nData;
      try {
        n8nData = raw ? JSON.parse(raw) : null;
      } catch {
        n8nData = null;
      }

      // Si n8n no devolvió JSON, devolvemos mensaje claro (pero sin romper 500)
      if (!n8nData || typeof n8nData !== "object") {
        const payload = { ok: false, code: "BAD_GATEWAY", message: "Respuesta no JSON desde n8n", raw: raw ?? "" };
        console.warn("⚠️ Respuesta no JSON desde n8n:", payload);
        return res.status(200).json({ answer: payload.message, raw: payload });
      }

      console.log("📦 Respuesta de n8n (objeto):", JSON.stringify(n8nData, null, 2));

      // ---- Normalización de campos
      const ok = !!n8nData.ok;
      const eventId = n8nData.eventId || n8nData.id || null;
      const appointment = n8nData.appointment || null;
      const code = n8nData.code || null;
      const msg = n8nData.message || null;

      const prettyDate = (iso) => {
        try {
          return new Date(iso).toLocaleString("es-ES", {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: "Europe/Madrid",
          });
        } catch {
          return iso;
        }
      };

      // ✅ Éxito real SOLO con eventId
      if (ok && eventId && appointment?.start) {
        const fecha = prettyDate(appointment.start);
        const email = parsed.user?.email || "tu correo";
        const answer = `Perfecto, he reservado tu cita para el ${fecha}. Te llegará la confirmación a ${email}.`;
        return res.status(200).json({ answer, raw: n8nData });
      }

      // Casos de negocio controlados
      if (!ok && code === "NO_AVAIL") {
        return res.status(200).json({ answer: (msg || "No hay huecos libres en ese rango."), raw: n8nData });
      }
      if (!ok && code === "CAL_CREATE_ERROR") {
        return res.status(200).json({ answer: (msg || "No he podido crear el evento en la agenda. Inténtalo de nuevo."), raw: n8nData });
      }
      if (!ok && code === "BAD_PAYLOAD") {
        return res.status(200).json({ answer: (msg || "Los datos de la solicitud están incompletos o no son válidos."), raw: n8nData });
      }

      // Fallback genérico
      return res.status(200).json({
        answer: (msg || "He intentado reservar tu cita, pero algo ha fallado."),
        raw: n8nData,
      });
    }

    // ---- No era JSON de reserva: devuelve respuesta normal del asistente
    const answer = rawAnswer || "No he podido generar respuesta con la información disponible.";
    console.log("✅ Respuesta final al usuario:", answer);
    return res.status(200).json({ answer });

  } catch (error) {
    console.error("🔥 Error detallado en /api/chat:", error);
    const msg = error instanceof Error ? `Error: ${error.message}` : "Error al comunicarse con OpenAI";
    return res.status(500).json({ error: msg });
  }
}
