require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || 'development-only-secret';
const database = new Database(path.join(__dirname, 'shopmart.db'));

database.pragma('journal_mode = WAL');
database.exec(`
    CREATE TABLE IF NOT EXISTS owners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price_fcfa INTEGER NOT NULL CHECK (price_fcfa >= 0),
        original_price_fcfa INTEGER NOT NULL CHECK (original_price_fcfa >= 0),
        image TEXT NOT NULL,
        description TEXT NOT NULL,
        rating REAL NOT NULL DEFAULT 5,
        reviews INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_fcfa INTEGER NOT NULL CHECK (total_fcfa >= 0),
        operator TEXT NOT NULL CHECK (operator IN ('Orange Money', 'MTN Mobile Money', 'Wave', 'Moov Money')),
        payment_phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

const ownerUsername = process.env.OWNER_USERNAME || 'proprietaire';
const ownerPassword = process.env.OWNER_PASSWORD || 'changez-ce-mot-de-passe';
const owner = database.prepare('SELECT id FROM owners WHERE username = ?').get(ownerUsername);
if (!owner) {
    database.prepare('INSERT INTO owners (username, password_hash) VALUES (?, ?)').run(ownerUsername, bcrypt.hashSync(ownerPassword, 12));
}

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '10mb' }));

function requireOwner(req, res, next) {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    try {
        req.owner = jwt.verify(token, jwtSecret);
        next();
    } catch {
        res.status(401).json({ error: 'Authentification propriétaire requise.' });
    }
}

function validateProduct(body) {
    const required = ['name', 'category', 'image', 'description'];
    if (required.some((field) => typeof body[field] !== 'string' || !body[field].trim())) return 'Les champs produit sont obligatoires.';
    if (!Number.isFinite(Number(body.priceFcfa)) || Number(body.priceFcfa) < 0) return 'Le prix doit être un montant FCFA valide.';
    if (!Number.isFinite(Number(body.originalPriceFcfa)) || Number(body.originalPriceFcfa) < 0) return 'Le prix original doit être un montant FCFA valide.';
    return null;
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'shopmart-backend' }));

app.post('/api/auth/owner/login', (req, res) => {
    const { username, password } = req.body || {};
    const account = database.prepare('SELECT * FROM owners WHERE username = ?').get(username);
    if (!account || !bcrypt.compareSync(password || '', account.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects.' });
    const token = jwt.sign({ ownerId: account.id, username: account.username }, jwtSecret, { expiresIn: '8h' });
    res.json({ token, owner: { username: account.username } });
});

app.get('/api/products', (req, res) => {
    res.json(database.prepare('SELECT id, name, category, price_fcfa AS priceFcfa, original_price_fcfa AS originalPriceFcfa, image, description, rating, reviews FROM products ORDER BY created_at DESC').all());
});

app.post('/api/products', requireOwner, (req, res) => {
    const error = validateProduct(req.body || {});
    if (error) return res.status(400).json({ error });
    const body = req.body;
    const result = database.prepare('INSERT INTO products (name, category, price_fcfa, original_price_fcfa, image, description, rating, reviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(body.name.trim(), body.category.trim(), Math.round(Number(body.priceFcfa)), Math.round(Number(body.originalPriceFcfa)), body.image.trim(), body.description.trim(), Number(body.rating || 5), Number(body.reviews || 0));
    res.status(201).json(database.prepare('SELECT id, name, category, price_fcfa AS priceFcfa, original_price_fcfa AS originalPriceFcfa, image, description, rating, reviews FROM products WHERE id = ?').get(result.lastInsertRowid));
});

app.delete('/api/products/:id', requireOwner, (req, res) => {
    const result = database.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Produit introuvable.' });
    res.status(204).end();
});

app.post('/api/contact', (req, res) => {
    const { name, email, message } = req.body || {};
    if (![name, email, message].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'Nom, email et message sont obligatoires.' });
    const result = database.prepare('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)').run(name.trim(), email.trim(), message.trim());
    res.status(201).json({ id: result.lastInsertRowid, message: 'Message enregistré.' });
});

app.get('/api/contact', requireOwner, (req, res) => {
    res.json(database.prepare('SELECT id, name, email, message, created_at AS createdAt FROM contact_messages ORDER BY created_at DESC').all());
});

app.post('/api/orders', (req, res) => {
    const { totalFcfa, operator, paymentPhone } = req.body || {};
    const operators = ['Orange Money', 'MTN Mobile Money', 'Wave', 'Moov Money'];
    if (!operators.includes(operator) || !Number.isFinite(Number(totalFcfa)) || !/^\d{8,14}$/.test(String(paymentPhone || '').replace(/\s/g, ''))) return res.status(400).json({ error: 'Informations de paiement invalides.' });
    const result = database.prepare('INSERT INTO orders (total_fcfa, operator, payment_phone) VALUES (?, ?, ?)').run(Math.round(Number(totalFcfa)), operator, String(paymentPhone).replace(/\s/g, ''));
    res.status(201).json({ id: result.lastInsertRowid, status: 'pending', message: 'Commande enregistrée en attente de paiement.' });
});

app.get('/api/orders', requireOwner, (req, res) => {
    res.json(database.prepare('SELECT id, total_fcfa AS totalFcfa, operator, payment_phone AS paymentPhone, status, created_at AS createdAt FROM orders ORDER BY created_at DESC').all());
});

app.listen(port, () => console.log(`ShopMart API running on http://localhost:${port}`));
