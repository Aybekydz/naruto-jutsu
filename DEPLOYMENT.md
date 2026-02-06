# 忍 NINJUTSU ARENA — Guide de Déploiement Complet

## Architecture Production

```
┌─────────────────────────┐          ┌─────────────────────────┐
│     VERCEL (Frontend)   │          │    RENDER (Backend)     │
│                         │          │                         │
│  React + Vite           │◄────────►│  Node.js + Socket.io    │
│  MediaPipe (client)     │  WSS://  │  Game Rooms             │
│  Three.js VFX           │          │  State Sync             │
│  SignValidator.js        │          │                         │
│                         │          │  URL:                   │
│  URL:                   │          │  ninjutsu-server.       │
│  ninjutsu-arena.        │          │    onrender.com         │
│    vercel.app           │          │                         │
└─────────────────────────┘          └─────────────────────────┘
```

---

## PHASE 1 : Préparer le Projet

### 1.1 — Structure des fichiers

```bash
mkdir ninjutsu-arena && cd ninjutsu-arena
mkdir client server
```

### 1.2 — Initialiser le Client (React + Vite)

```bash
cd client
npm create vite@latest . -- --template react
npm install
npm install socket.io-client three
```

### 1.3 — Copier les fichiers du jeu

```
client/
├── src/
│   ├── App.jsx                  # (votre composant React principal)
│   ├── engine/
│   │   └── SignValidator.js     # Le nouveau validateur vectoriel
│   ├── data/
│   │   └── ref_signs.json       # Données de référence des 12 signes
│   └── ...
├── vite.config.js               # Voir ci-dessous
└── package.json
```

### 1.4 — Configurer `vite.config.js` (CORS + Proxy)

```javascript
// client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  
  // Dev: proxy les requêtes Socket vers le serveur local
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  
  // Build: optimisations production
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          socketio: ['socket.io-client'],
        },
      },
    },
  },
  
  // Important: permet d'importer les JSON
  json: {
    stringify: true,
  },
})
```

### 1.5 — Configurer la connexion Socket côté Client

Créez `client/src/network/socket.js` :

```javascript
// client/src/network/socket.js
import { io } from "socket.io-client";

// En production, la variable d'environnement pointe vers Render.
// En dev, le proxy de Vite redirige automatiquement.
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "";

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});

socket.on("connect", () => console.log("[WS] Connecté:", socket.id));
socket.on("disconnect", (reason) => console.log("[WS] Déconnecté:", reason));
socket.on("connect_error", (err) => console.error("[WS] Erreur:", err.message));

export default socket;
```

### 1.6 — Ajouter `.env` pour le développement local

```bash
# client/.env
VITE_SERVER_URL=http://localhost:3001
```

### 1.7 — Initialiser le Serveur

```bash
cd ../server
npm init -y
npm install express socket.io
```

Copiez `server.production.js` → `server/index.js`

Modifiez `server/package.json` :

```json
{
  "name": "ninjutsu-arena-server",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## PHASE 2 : Déployer le Backend sur Render

### 2.1 — Préparer le repo Git

```bash
cd ../
git init
git add .
git commit -m "Initial: Ninjutsu Arena"
```

Poussez sur GitHub :

```bash
gh repo create ninjutsu-arena --public --push --source=.
```

### 2.2 — Créer le service sur Render

1. Allez sur **https://render.com** → Sign In avec GitHub
2. **New +** → **Web Service**
3. Connectez votre repo GitHub `ninjutsu-arena`
4. Configurez :

| Paramètre          | Valeur                                |
|---------------------|---------------------------------------|
| **Name**           | `ninjutsu-arena-server`               |
| **Root Directory** | `server`                              |
| **Runtime**        | `Node`                                |
| **Build Command**  | `npm install`                         |
| **Start Command**  | `npm start`                           |
| **Instance Type**  | `Free` (ou Starter pour production)   |

5. **Variables d'environnement** (Environment → Add) :

| Clé            | Valeur                                       |
|----------------|----------------------------------------------|
| `CLIENT_URL`   | `https://ninjutsu-arena.vercel.app`          |
| `NODE_ENV`     | `production`                                 |

6. Cliquez **Create Web Service**
7. Attendez le déploiement (~2-3 minutes)
8. Notez l'URL : `https://ninjutsu-arena-server.onrender.com`

### 2.3 — Tester le serveur

```bash
curl https://ninjutsu-arena-server.onrender.com/
# Réponse attendue :
# {"service":"Ninjutsu Arena","status":"online","rooms":0,...}

curl https://ninjutsu-arena-server.onrender.com/health
# OK
```

---

## PHASE 3 : Déployer le Frontend sur Vercel

### 3.1 — Installer Vercel CLI

```bash
npm install -g vercel
vercel login
```

### 3.2 — Configurer pour Vercel

Créez `client/vercel.json` :

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Permissions-Policy", "value": "camera=self" }
      ]
    }
  ]
}
```

### 3.3 — Déployer

```bash
cd client

# Premier déploiement (configure le projet)
vercel

# Répondez aux questions :
#   Set up and deploy? → Y
#   Which scope? → (votre compte)
#   Link to existing project? → N
#   Project name? → ninjutsu-arena
#   Directory? → ./
#   Override settings? → N
```

### 3.4 — Ajouter les variables d'environnement

```bash
# URL de votre serveur Render
vercel env add VITE_SERVER_URL production
# Entrez : https://ninjutsu-arena-server.onrender.com

# Puis redéployez pour appliquer
vercel --prod
```

### 3.5 — Vérifier la connexion

Ouvrez `https://ninjutsu-arena.vercel.app` dans Chrome.
Ouvrez la Console (F12) → vous devez voir :
```
[WS] Connecté: abc123xyz
```

---

## PHASE 4 : Configurer le CORS Final

### 4.1 — Mettre à jour Render

Retournez dans le Dashboard Render → votre service → Environment :

```
CLIENT_URL = https://ninjutsu-arena.vercel.app
```

> Si vous avez un domaine custom, ajoutez-le dans le tableau `ALLOWED_ORIGINS`
> de `server.production.js` et redéployez.

### 4.2 — Vérification finale

```bash
# Tester le WebSocket depuis le navigateur (Console) :
const ws = new WebSocket("wss://ninjutsu-arena-server.onrender.com/socket.io/?EIO=4&transport=websocket");
ws.onopen = () => console.log("WS connecté !");
ws.onmessage = (e) => console.log("MSG:", e.data);
```

---

## PHASE 5 : Alternative Railway (si Render ne convient pas)

```bash
# Installer Railway CLI
npm install -g @railway/cli
railway login

# Initialiser
cd server
railway init

# Ajouter les variables
railway variables set CLIENT_URL=https://ninjutsu-arena.vercel.app
railway variables set NODE_ENV=production

# Déployer
railway up

# Récupérer l'URL
railway domain
# → ninjutsu-arena-server.up.railway.app
```

Puis mettez à jour la variable Vercel :
```bash
cd ../client
vercel env rm VITE_SERVER_URL production
vercel env add VITE_SERVER_URL production
# Entrez l'URL Railway
vercel --prod
```

---

## Checklist Pré-lancement

```
□  Serveur Render déployé et répond sur /health
□  Variable CLIENT_URL correcte sur Render
□  Variable VITE_SERVER_URL correcte sur Vercel
□  WebSocket se connecte (vérifier Console navigateur)
□  Webcam fonctionne (HTTPS obligatoire = OK sur Vercel)
□  Test avec 2 navigateurs : créer salon + rejoindre
□  Aucune erreur CORS dans la Console
□  Performance : MediaPipe tourne à 20+ FPS
```

---

## Commandes Utiles en Production

```bash
# Voir les logs Render en temps réel
# → Dashboard Render → Logs

# Redéployer le frontend
cd client && vercel --prod

# Redéployer le backend (auto si GitHub push)
git add . && git commit -m "fix" && git push

# Voir les salons actifs
curl https://ninjutsu-arena-server.onrender.com/

# Tester en local (2 terminaux)
# Terminal 1:
cd server && npm run dev
# Terminal 2:
cd client && npm run dev
# Ouvrir http://localhost:5173 dans 2 onglets
```

---

## Dépannage

| Problème | Solution |
|----------|----------|
| CORS bloqué | Vérifiez `CLIENT_URL` sur Render correspond exactement à l'URL Vercel |
| WebSocket timeout | Render Free s'endort après 15min. Premier appel = ~30s de réveil |
| Caméra refusée | HTTPS obligatoire (Vercel = OK). En local: `localhost` suffit |
| MediaPipe ne charge pas | Vérifiez que le CDN jsdelivr est accessible (pas de VPN bloquant) |
| Socket déconnecte souvent | Augmentez `pingTimeout` dans server.js (ex: 60000) |
