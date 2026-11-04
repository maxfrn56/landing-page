const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_TO = process.env.MAIL_TO || "contact@maximefarineau.com";
const MAIL_FROM = process.env.MAIL_FROM || "Farineau <bonjour@maximefarineau.com>";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(Object.assign(new Error("too-large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function oneLine(value, max) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleContact(req, res) {
  if (!RESEND_API_KEY) {
    send(res, 503, JSON.stringify({ error: "L’envoi n’est pas encore configuré." }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    const status = error.status || 400;
    send(res, status, JSON.stringify({ error: "La demande n’a pas pu être lue." }));
    return;
  }

  const nom = oneLine(payload.nom, 120);
  const email = oneLine(payload.email, 180);
  const tel = oneLine(payload.tel, 40);
  const format = payload.format === "Site vitrine" ? "Site vitrine" : "Landing page";
  const activite = oneLine(payload.activite, 200);
  const site = oneLine(payload.site, 300);
  const message = String(payload.message || "").trim().slice(0, 4000);
  const contenus = payload.contenus ? "oui" : "non";

  if (!nom || !activite || !message || !validEmail(email)) {
    send(res, 400, JSON.stringify({
      error: "Indiquez votre nom, un email valide, votre activité et ce que le site doit obtenir.",
    }));
    return;
  }

  const prix = format === "Site vitrine" ? "600 €" : "400 €";
  const text = [
    "Nouvelle commande, à livrer dans la journée.",
    "",
    `Nom : ${nom}`,
    `Email : ${email}`,
    `Téléphone : ${tel || "—"}`,
    `Format : ${format}`,
    `Forfait : ${prix}, réglé à la livraison.`,
    `Activité : ${activite}`,
    `Site actuel : ${site || "—"}`,
    `Contenus prêts aujourd’hui : ${contenus}`,
    "",
    message,
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [MAIL_TO],
      reply_to: email,
      subject: `Commande — ${format} — ${nom}`,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Resend", response.status, detail);
    send(res, 502, JSON.stringify({ error: "L’envoi a échoué. Réessayez dans un instant." }));
    return;
  }

  send(res, 200, JSON.stringify({ ok: true }));
}

function serveFile(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!relative || relative.includes("\0") || relative.split(/[/\\]/).includes("..")) {
    send(res, 403, "Interdit", "text/plain; charset=utf-8");
    return;
  }
  const full = path.resolve(__dirname, relative);
  if (full !== __dirname && !full.startsWith(__dirname + path.sep)) {
    send(res, 403, "Interdit", "text/plain; charset=utf-8");
    return;
  }
  if (path.basename(full).startsWith(".")) {
    send(res, 404, "Introuvable", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(full, (error, data) => {
    if (error) {
      send(res, 404, "Introuvable", "text/plain; charset=utf-8");
      return;
    }
    const type = TYPES[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/contact") {
    try {
      await handleContact(req, res);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ error: "L’envoi a échoué. Réessayez dans un instant." }));
      }
    }
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveFile(req, res, decodeURIComponent(url.pathname));
    return;
  }
  send(res, 405, "Méthode refusée", "text/plain; charset=utf-8");
});

server.listen(PORT, () => {
  console.log(`Page en écoute sur le port ${PORT}`);
});
