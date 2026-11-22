import express from "express";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Habilitar CORS para todas as origens
  app.use((req, res, next) => {
    // Obter origem da requisição ou permitir todas
    const origin = req.headers.origin;
    
    // Permitir todas as origens (ou origem específica se fornecida)
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    
    // Permitir métodos HTTP
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    
    // Permitir headers
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    // Cache preflight requests por 24 horas
    res.header('Access-Control-Max-Age', '86400');
    
    // Responder imediatamente a requisições OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    
    next();
  });

  // Parse JSON bodies
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  // Injetar variáveis de ambiente no HTML
  const getEnvScript = () => {
    const env = {
      API_URL: process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:3001/api/v1',
      APP_TITLE: process.env.VITE_APP_TITLE || 'Monitoring System Dashboard',
      APP_LOGO: process.env.VITE_APP_LOGO || '/logo.svg',
      ANALYTICS_ENDPOINT: process.env.VITE_ANALYTICS_ENDPOINT || '',
      ANALYTICS_WEBSITE_ID: process.env.VITE_ANALYTICS_WEBSITE_ID || '',
    };
    return `<script>window.__ENV__ = ${JSON.stringify(env)};</script>`;
  };

  // Middleware para injetar variáveis no index.html
  app.get("/", (req, res, next) => {
    const indexPath = path.join(staticPath, "index.html");
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        return next(err);
      }
      const html = data.replace('</head>', `${getEnvScript()}</head>`);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  });

  // Serve static files (mas não index.html na raiz, que já foi tratado acima)
  app.use(express.static(staticPath, { index: false }));

  // Handle client-side routing - serve index.html for all other routes
  app.get("*", (req, res) => {
    const indexPath = path.join(staticPath, "index.html");
    fs.readFile(indexPath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).send('Error loading index.html');
      }
      const html = data.replace('</head>', `${getEnvScript()}</head>`);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    });
  });

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(console.error);
