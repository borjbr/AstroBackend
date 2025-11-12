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
const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;

if (!apiKey) {
  console.error("🔴 FATAL: La variable de entorno OPENAI_API_KEY no está definida.");
} else {
  console.log("✅ OPENAI_API_KEY cargada correctamente para el chatbot.");
}

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
Eres Carmen Aguirre Ruigomez, la recepcionista virtual de la clínica dental SonrisaPerfecta.
Hablas siempre en tono cercano, educado y profesional, como una recepcionista real.

TU OBJETIVO PRINCIPAL:
- Ayudar al usuario a INFORMARSE sobre la clínica y,
- si quiere pedir una cita, GUIARLE paso a paso para conseguir todos los datos necesarios
  y luego generar una solicitud de reserva estructurada.
- Trabajamos normalmente con citas en el año 2025 (año actual), pero NUNCA debes inventar un año si el usuario no lo ha confirmado.
- Solo agendas citas dentro del horario laboral de la clínica: lunes a viernes, de 9:00 a 18:00 (hora de Madrid).

Interpretación de fechas y horas:
- Todas las fechas que pongas en el JSON deben ir en formato "YYYY-MM-DD".
- Todas las horas se deben convertir SIEMPRE a formato 24 horas "HH:MM".
- Debes entender expresiones coloquiales de hora en español y normalizarlas (11 y media → 11:30, etc.)
- Si falta mes/año/hora exacta, PREGUNTA antes de generar el JSON. No inventes.

INFORMACIÓN DE LA CLÍNICA:
${siteInfo}

CUANDO EL USUARIO QUIERA UNA CITA:
1) Pide nombre, email, teléfono, motivo, fecha(s) y franja.
2) Normaliza a "YYYY-MM-DD" y "HH:MM".
3) Pide confirmación.
4) SOLO entonces genera exactamente este JSON (sin texto adicional):

{
  "intent": "book_appointment",
  "user": {
    "name": "Nombre Apellidos",
    "email": "correo@ejemplo.com",
    "phone": "666777888"
  },
  "constraints": {
    "durationMinutes": 30,
    "fromDate": "YYYY-MM-DD",
    "toDate": "YYYY-MM-DD",
    "timeWindow": { "start": "HH:MM", "end": "HH:MM" },
    "timezone": "Europe/Madrid"
  },
  "notes": "Motivo de la cita y detalles relevantes."
}

DESPUÉS DE CREAR LA CITA (solo si el sistema te lo confirma):
- Da un mensaje corto con fecha y hora y confirma que se ha enviado el email.
`;

    console.log("🚀 Llamando a OpenAI con messages:", JSON.stringify(messages, null, 2));

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

    const completion = await openaiRes.json();
    console.log("📦 Respuesta completa de OpenAI:", JSON.stringify(completion, null, 2));

    if (!openaiRes.ok) {
      console.error("🔥 Error desde OpenAI:", completion);
      res.status(500).json({ error: "Error al comunicarse con OpenAI (ver logs)" });
      return;
    }

    let rawAnswer = completion.choices?.[0]?.message?.content?.trim() ?? "";
    console.log("📝 Respuesta generada (raw):", rawAnswer);

    // 🧠 INTENTO 1: ¿es un JSON de reserva de cita?
    let parsed;
    try {
      parsed = JSON.parse(rawAnswer);
    } catch {
      parsed = null;
    }

    if (parsed && parsed.intent === "book_appointment" && n8nWebhookUrl) {
      console.log("📅 Detectado JSON de reserva, enviando a n8n...", parsed);

      // Enviar a n8n
      const n8nRes = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      let n8nData;
      const raw = await n8nRes.text();
      try {
        n8nData = JSON.parse(raw);
      } catch {
        n8nData = { ok: false, code: "BAD_GATEWAY", message: "Respuesta no JSON desde n8n", raw };
      }
      console.log("📦 Respuesta de n8n:", JSON.stringify(n8nData, null, 2));

      // 🔎 Normalizamos lectura de campos
      const ok = !!n8nData.ok;
      const eventId = n8nData.eventId || n8nData.id || null;
      const appointment = n8nData.appointment || null;
      const code = n8nData.code || null;
      const msg = n8nData.message || null;

      // 🗓️ formateador seguro
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

      // 🟩 ÉXITO REAL: solo si hay eventId
      if (ok && eventId && appointment?.start) {
        const fecha = prettyDate(appointment.start);
        const email = parsed.user?.email || "tu correo";
        const answer = `Perfecto, he reservado tu cita para el ${fecha}. Te llegará la confirmación a ${email}.`;
        res.status(200).json({ answer, raw: n8nData });
        return;
      }

      // 🟨 CASOS DE NEGOCIO CONTROLADOS
      if (!ok && code === "NO_AVAIL") {
        const answer = msg || "No hay huecos libres en ese rango.";
        res.status(200).json({ answer, raw: n8nData });
        return;
      }

      if (!ok && code === "CAL_CREATE_ERROR") {
        const answer = msg || "No he podido crear el evento en la agenda. Inténtalo de nuevo.";
        res.status(200).json({ answer, raw: n8nData });
        return;
      }

      if (!ok && code === "BAD_PAYLOAD") {
        const answer = msg || "Los datos de la solicitud están incompletos o son inválidos.";
        res.status(200).json({ answer, raw: n8nData });
        return;
      }

      // 🟥 FALLO GENÉRICO
      const fallback = msg || "He intentado reservar tu cita, pero algo ha fallado.";
      res.status(200).json({ answer: fallback, raw: n8nData });
      return;
    }

    // 🧠 Si NO era JSON de reserva, devolvemos la respuesta normal del asistente
    const answer = rawAnswer || "No he podido generar respuesta con la información disponible.";
    console.log("✅ Respuesta final al usuario:", answer);
    res.status(200).json({ answer });
  } catch (error) {
    console.error("🔥 Error detallado al llamar a OpenAI:", error);
    let errorMessage = "Error al comunicarse con OpenAI";
    if (error instanceof Error) errorMessage = `Error: ${error.message}`;
    res.status(500).json({ error: errorMessage });
  }
}
