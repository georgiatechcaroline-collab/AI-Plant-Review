import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase config safely
let firebaseConfig: any = {};
const configPath = path.join(__dirname, 'firebase-applet-config.json');
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.warn('Could not parse firebase-applet-config.json');
  }
}

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  });
}

// Connect to the specific database instance
const db = getFirestore(process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)');
const snapshotsCol = db.collection('snapshots');

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  let latestImage: string | null = null;
  let lastUploadTime: number | null = null;

  // Debug logging for reverse proxy issues
  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url} - ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
    next();
  });

  // API Route for receiving images from Raspberry Pi
  app.post('/api/upload-image', async (req, res) => {
    const { image, secret, score, analysis } = req.body;
    
    const expectedSecret = process.env.UPLOAD_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      console.log(`[POST] /api/upload-image: Unauthorized access attempt`);
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing secret' });
    }

    if (!image) return res.status(400).json({ error: 'No image data provided' });
    
    const timestamp = Date.now();
    latestImage = image;
    lastUploadTime = timestamp;

    try {
      // Save to Firestore
      await snapshotsCol.add({
        image,
        timestamp,
        score: score || null,
        analysis: analysis || null
      });

      console.log(`[POST] /api/upload-image: Received and saved new snapshot`);
      res.json({ status: 'ok', timestamp });
    } catch (err: any) {
      console.error('Error saving snapshot to Firestore:', err);
      res.status(500).json({ error: 'Failed to persist snapshot' });
    }
  });

  // Dummy GET to test if internal routing works
  app.get('/api/upload-image', (req, res) => {
    res.json({ status: 'ready', method: 'Use POST to upload' });
  });

  // API Route to fetch history (DEPRECATED - App now uses Client SDK)
  app.get('/api/history', async (req, res) => {
    res.json({ info: "Use Firebase Client SDK for history" });
  });

  // API Route to fetch latest image
  app.get('/api/latest-image', (req, res) => {
    if (!latestImage) return res.status(404).json({ error: 'No image available' });
    res.json({ 
      image: latestImage,
      timestamp: lastUploadTime
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  });
}

startServer();
