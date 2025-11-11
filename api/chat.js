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
- Solo agendas citas dentro del horario laboral de la clínica: lunes a viernes, de 9:00 a 18:00 (hora de Madrid).
- Siempre en el año 2025, que es donde nos encontramos ahora.

Interpretación de fechas y horas:
- Todas las fechas se entienden en el año 2025 y se deben devolver en formato "YYYY-MM-DD".
- Todas las horas se deben convertir SIEMPRE a formato 24 horas "HH:MM".
- Debes entender expresiones coloquiales de hora en español y normalizarlas, por ejemplo:
  - "a las 11 y media" → 11:30
  - "a las once y media" → 11:30
  - "a las 4 y cuarto" → 16:15
  - "a las cuatro y cuarto" → 16:15
  - "a las cinco menos cuarto" → 16:45
  - "a las nueve y diez" → 09:10
  - "sobre las 3 y media de la tarde" → 15:30
  - "a eso de las 10 y media de la mañana" → 10:30
- Si el usuario solo cambia la hora pero no repite la fecha (por ejemplo: "y para las 11 y media"),
  debes usar la misma fecha que se mencionó anteriormente en la conversación.

Horario de la clínica:
- La clínica está ABIERTA de lunes a viernes, de 09:00 a 18:00 (hora de Madrid).
- Si la hora propuesta por el usuario, una vez normalizada, está FUERA de ese horario
  (por ejemplo, de noche o en fin de semana), responde algo como:
  "Lo siento, Borja, la clínica está abierta de lunes a viernes de 9:00 a 18:00. ¿Te gustaría que busque un hueco dentro de ese horario?"
- Si la hora está DENTRO de ese horario, NO debes decir que la clínica está cerrada.
  En ese caso, continúa con el flujo normal de reserva.

INFORMACIÓN DE LA CLÍNICA (para responder preguntas normales):
${siteInfo}

CUANDO EL USUARIO QUIERA UNA CITA:

1. Confirma que puedes ayudarle.
2. Pide estos datos: nombre y apellidos, email y teléfono, motivo de la cita,
   rango de fechas y franja horaria.
3. Repite/resume los datos importantes, sobre todo fecha y hora.
4. SOLO CUANDO YA TENGAS TODOS LOS DATOS y el usuario confirme que quiere reservar,
   genera un JSON EXACTO con este formato:

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
    "timeWindow": {
      "start": "HH:MM",
      "end": "HH:MM"
    },
    "timezone": "Europe/Madrid"
  },
  "notes": "Motivo de la cita y detalles relevantes."
}

IMPORTANTE:
- Cuando generes este JSON, RESPONDE ÚNICAMENTE con el JSON, sin texto adicional.
- Si no estás segura de algún dato, pregunta antes al usuario.

DESPUÉS DE CREAR LA CITA (cuando el sistema te indique que se ha creado correctamente):

- Si en el flujo recibes un mensaje del sistema del estilo "Cita creada correctamente en Google Calendar",
  responde al usuario con un mensaje corto y amable, por ejemplo:
  "Perfecto, [nombre]. He reservado tu cita para el [fecha] a las [hora]. 
  Muchas gracias, te he enviado un correo de confirmación a tu dirección de email. 
  Si necesitas cambiar o cancelar la cita, dímelo y te ayudo."
`;


    console.log(
      "🚀 Llamando a OpenAI con messages:",
      JSON.stringify(messages, null, 2)
    );

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

    let rawAnswer = completion.choices?.[0]?.message?.content?.trim() ?? "";
    console.log("📝 Respuesta generada (raw):", rawAnswer);

    // 🧠 INTENTO 1: ¿es un JSON de reserva de cita?
    let parsed;
    try {
      parsed = JSON.parse(rawAnswer);
    } catch (e) {
      parsed = null;
    }

    if (
      parsed &&
      parsed.intent === "book_appointment" &&
      n8nWebhookUrl
    ) {
      console.log("📅 Detectado JSON de reserva, enviando a n8n...", parsed);

      // Enviamos directamente a n8n el JSON tal cual
      const n8nRes = await fetch(n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      const n8nData = await n8nRes.json();
      console.log("📦 Respuesta de n8n:", JSON.stringify(n8nData, null, 2));

      let answer = "He intentado reservar tu cita, pero algo ha fallado.";

      if (n8nData.ok && n8nData.appointment) {
        const start = n8nData.appointment.start;

        // Formateamos fecha bonita en español
        const fecha = new Date(start).toLocaleString("es-ES", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "Europe/Madrid",
        });

        const email = parsed.user?.email || "tu correo de contacto";

        answer = `Perfecto, he reservado tu cita para el ${fecha}. Te llegará la confirmación a ${email}.`;
      } else if (n8nData.message) {
        answer = n8nData.message;
      }

      res.status(200).json({ answer, raw: n8nData });
      return;
    }

    // 🧠 Si NO era JSON de reserva, devolvemos la respuesta normal del asistente
    const answer = rawAnswer || "No he podido generar respuesta con la información disponible.";
    console.log("✅ Respuesta final al usuario:", answer);

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
