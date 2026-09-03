require('dotenv').config();

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');

const port = Number(process.env.PORT || 3000);
const databasePath = path.join(__dirname, 'shopmart.db');
const jwtSecret = process.env.JWT_SECRET || 'development-only-secret';

function rows(database, sql, values = []) {
    const statement = database.prepare(sql);
    statement.bind(values);
    const result = [];
    while (statement.step()) result.push(statement.getAsObject());
    statement.free();
    return result;
}

function saveDatabase(database) {
    fs.writeFileSync(databasePath, Buffer.from(database.export()));
}

function readFrontendProducts() {
    const frontendPath = path.join(__dirname, '..', 'frontend', 'index.html');
    const source = fs.readFileSync(frontendPath, 'utf8');
    const match = source.match(/const products\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return [];
    return vm.runInNewContext(`products = ${match[1]}`, Object.create(null));
}

async function start() {
    const SQL = await initSqlJs({ locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file) });
    const database = fs.existsSync(databasePath) ? new SQL.Database(fs.readFileSync(databasePath)) : new SQL.Database();
    database.run(`
        CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT);
        CREATE TABLE IF NOT EXISTS owner_login_events (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, username TEXT NOT NULL, ip_address TEXT, user_agent TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, price_fcfa INTEGER NOT NULL, original_price_fcfa INTEGER NOT NULL, image TEXT NOT NULL, description TEXT NOT NULL, rating REAL NOT NULL DEFAULT 5, reviews INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS contact_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, total_fcfa INTEGER NOT NULL, operator TEXT NOT NULL, payment_phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    `);
    const orderColumns = rows(database, 'PRAGMA table_info(orders)');
    if (!orderColumns.some((column) => column.name === 'user_id')) database.run('ALTER TABLE orders ADD COLUMN user_id INTEGER');

    const ownerUsername = process.env.OWNER_USERNAME || 'proprietaire';
    const ownerPassword = process.env.OWNER_PASSWORD || 'changez-ce-mot-de-passe';
    const existingOwner = rows(database, 'SELECT id, password_hash AS passwordHash FROM owners WHERE username = ?', [ownerUsername])[0];
    if (!existingOwner) {
        database.run('INSERT INTO owners (username, password_hash) VALUES (?, ?)', [ownerUsername, bcrypt.hashSync(ownerPassword, 12)]);
        saveDatabase(database);
    } else if (!bcrypt.compareSync(ownerPassword, existingOwner.passwordHash)) {
        database.run('UPDATE owners SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(ownerPassword, 12), existingOwner.id]);
        saveDatabase(database);
    }

    const frontendProducts = readFrontendProducts();
    const storedProductCount = rows(database, 'SELECT COUNT(*) AS count FROM products')[0].count;
    if (storedProductCount < frontendProducts.length) {
        const insertProduct = database.prepare('INSERT OR IGNORE INTO products (id, name, category, price_fcfa, original_price_fcfa, image, description, rating, reviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        frontendProducts.forEach((product) => insertProduct.run([product.id, product.name, product.category, Math.round(product.price * 655.957), Math.round(product.originalPrice * 655.957), product.image, product.description, product.rating, product.reviews]));
        saveDatabase(database);
    }

    const app = express();
    const configuredOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5500';
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || origin === configuredOrigin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
            callback(new Error('Origine frontend non autorisée par le backend.'));
        }
    }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(path.join(__dirname, '..', 'frontend')));

    function requireOwner(req, res, next) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        try { req.owner = jwt.verify(token, jwtSecret); next(); } catch { res.status(401).json({ error: 'Authentification propriétaire requise.' }); }
    }

    app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'shopmart-backend' }));
    app.post('/api/auth/owner/login', (req, res) => {
        const account = rows(database, 'SELECT * FROM owners WHERE username = ?', [req.body?.username])[0];
        if (!account || !bcrypt.compareSync(req.body?.password || '', account.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects.' });
        database.run('INSERT INTO owner_login_events (owner_id, username, ip_address, user_agent) VALUES (?, ?, ?, ?)', [account.id, account.username, req.ip, req.get('user-agent') || '']);
        saveDatabase(database);
        res.json({ token: jwt.sign({ ownerId: account.id, username: account.username }, jwtSecret, { expiresIn: '8h' }), owner: { username: account.username } });
    });

    app.post('/api/auth/register', (req, res) => {
        const { firstName, lastName, email, password } = req.body || {};
        if (![firstName, lastName, email, password].every((value) => typeof value === 'string' && value.trim()) || password.length < 6) return res.status(400).json({ error: 'Informations invalides. Le mot de passe doit contenir 6 caractères minimum.' });
        try {
            database.run('INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)', [firstName.trim(), lastName.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 12)]);
            saveDatabase(database);
            res.status(201).json({ message: 'Compte créé avec succès.' });
        } catch { res.status(409).json({ error: 'Cette adresse email est déjà utilisée.' }); }
    });

    app.post('/api/auth/login', (req, res) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const account = rows(database, 'SELECT * FROM users WHERE email = ?', [email])[0];
        if (!account || !bcrypt.compareSync(req.body?.password || '', account.password_hash)) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        database.run('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [account.id]);
        saveDatabase(database);
        res.json({ token: jwt.sign({ userId: account.id, email: account.email }, jwtSecret, { expiresIn: '8h' }), user: { firstName: account.first_name, lastName: account.last_name, email: account.email } });
    });

    function requireUser(req, res, next) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        try { const payload = jwt.verify(token, jwtSecret); if (!payload.userId) throw new Error(); req.user = payload; next(); } catch { res.status(401).json({ error: 'Connexion client requise pour commander.' }); }
    }

    app.get('/api/users', requireOwner, (req, res) => res.json(rows(database, 'SELECT id, first_name AS firstName, last_name AS lastName, email, created_at AS createdAt, last_login_at AS lastLoginAt FROM users ORDER BY id DESC')));
    app.delete('/api/users/:id', requireOwner, (req, res) => { database.run('DELETE FROM users WHERE id = ?', [Number(req.params.id)]); saveDatabase(database); res.status(204).end(); });

    app.get('/api/owner/login-events', requireOwner, (req, res) => res.json(rows(database, 'SELECT id, username, ip_address AS ipAddress, user_agent AS userAgent, created_at AS createdAt FROM owner_login_events ORDER BY id DESC LIMIT 50')));

    app.get('/api/products', (req, res) => res.json(rows(database, 'SELECT id, name, category, price_fcfa AS priceFcfa, original_price_fcfa AS originalPriceFcfa, image, description, rating, reviews FROM products ORDER BY id DESC')));
    app.post('/api/products', requireOwner, (req, res) => {
        const body = req.body || {};
        if (!['name', 'category', 'image', 'description'].every((field) => typeof body[field] === 'string' && body[field].trim()) || !Number.isFinite(Number(body.priceFcfa)) || !Number.isFinite(Number(body.originalPriceFcfa))) return res.status(400).json({ error: 'Informations produit invalides.' });
        database.run('INSERT INTO products (name, category, price_fcfa, original_price_fcfa, image, description, rating, reviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [body.name.trim(), body.category.trim(), Math.round(Number(body.priceFcfa)), Math.round(Number(body.originalPriceFcfa)), body.image.trim(), body.description.trim(), Number(body.rating || 5), Number(body.reviews || 0)]);
        const productId = rows(database, 'SELECT last_insert_rowid() AS id')[0].id;
        saveDatabase(database);
        res.status(201).json({ id: productId, message: 'Produit ajouté.' });
    });
    app.put('/api/products/:id', requireOwner, (req, res) => {
        const body = req.body || {};
        if (!['name', 'category', 'image', 'description'].every((field) => typeof body[field] === 'string' && body[field].trim()) || !Number.isFinite(Number(body.priceFcfa)) || !Number.isFinite(Number(body.originalPriceFcfa))) return res.status(400).json({ error: 'Informations produit invalides.' });
        const productId = Number(req.params.id);
        const product = rows(database, 'SELECT id FROM products WHERE id = ?', [productId])[0];
        if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
        database.run('UPDATE products SET name = ?, category = ?, price_fcfa = ?, original_price_fcfa = ?, image = ?, description = ? WHERE id = ?', [body.name.trim(), body.category.trim(), Math.round(Number(body.priceFcfa)), Math.round(Number(body.originalPriceFcfa)), body.image.trim(), body.description.trim(), productId]);
        saveDatabase(database);
        res.json({ message: 'Produit mis à jour.' });
    });
    app.delete('/api/products/:id', requireOwner, (req, res) => { database.run('DELETE FROM products WHERE id = ?', [Number(req.params.id)]); saveDatabase(database); res.status(204).end(); });

    app.post('/api/contact', (req, res) => {
        const { name, email, message } = req.body || {};
        if (![name, email, message].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'Nom, email et message sont obligatoires.' });
        database.run('INSERT INTO contact_messages (name, email, message) VALUES (?, ?, ?)', [name.trim(), email.trim(), message.trim()]); saveDatabase(database); res.status(201).json({ message: 'Message enregistré.' });
    });
    app.get('/api/contact', requireOwner, (req, res) => res.json(rows(database, 'SELECT id, name, email, message, created_at AS createdAt FROM contact_messages ORDER BY id DESC')));

    app.post('/api/orders', requireUser, (req, res) => {
        const { totalFcfa, operator, paymentPhone } = req.body || {};
        if (!['Orange Money', 'MTN Mobile Money', 'Wave', 'Moov Money'].includes(operator) || !Number.isFinite(Number(totalFcfa)) || !/^\d{8,14}$/.test(String(paymentPhone || '').replace(/\s/g, ''))) return res.status(400).json({ error: 'Informations de paiement invalides.' });
        database.run('INSERT INTO orders (total_fcfa, operator, payment_phone, user_id) VALUES (?, ?, ?, ?)', [Math.round(Number(totalFcfa)), operator, String(paymentPhone).replace(/\s/g, ''), req.user.userId]); saveDatabase(database); res.status(201).json({ status: 'pending', message: 'Commande enregistrée en attente de paiement.' });
    });
    app.get('/api/orders', requireOwner, (req, res) => res.json(rows(database, 'SELECT id, total_fcfa AS totalFcfa, operator, payment_phone AS paymentPhone, status, created_at AS createdAt FROM orders ORDER BY id DESC')));
    app.delete('/api/orders/:id', requireOwner, (req, res) => { database.run('DELETE FROM orders WHERE id = ?', [Number(req.params.id)]); saveDatabase(database); res.status(204).end(); });

    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    });

    app.listen(port, () => console.log(`ShopMart API running on http://localhost:${port}`));
}

start().catch((error) => { console.error(error); process.exit(1); });
