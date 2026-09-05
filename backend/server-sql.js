require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const port = Number(process.env.PORT || 3000);
const jwtSecret = process.env.JWT_SECRET || 'development-only-secret';

// ---------- Schémas ----------
const ownerSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    lastLoginAt: { type: Date, default: null },
    lastLogoutAt: { type: Date, default: null },
    isOnline: { type: Boolean, default: false }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const ownerLoginEventSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    username: { type: String, required: true },
    ipAddress: { type: String },
    userAgent: { type: String }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: String, required: true },
    priceFcfa: { type: Number, required: true, min: 0 },
    originalPriceFcfa: { type: Number, required: true, min: 0 },
    image: { type: String, required: true },
    description: { type: String, required: true },
    rating: { type: Number, default: 5 },
    reviews: { type: Number, default: 0 }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const contactMessageSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    message: { type: String, required: true }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const orderSchema = new mongoose.Schema({
    totalFcfa: { type: Number, required: true, min: 0 },
    operator: { type: String, required: true, enum: ['Orange Money', 'MTN Mobile Money', 'Wave', 'Moov Money'] },
    paymentPhone: { type: String, required: true },
    status: { type: String, default: 'pending' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

const Owner = mongoose.model('Owner', ownerSchema);
const User = mongoose.model('User', userSchema);
const OwnerLoginEvent = mongoose.model('OwnerLoginEvent', ownerLoginEventSchema);
const Product = mongoose.model('Product', productSchema);
const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
const Order = mongoose.model('Order', orderSchema);

// ---------- Sérialisation (mêmes noms de champs que l'API d'origine) ----------
const serializeProduct = (doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    category: doc.category,
    priceFcfa: doc.priceFcfa,
    originalPriceFcfa: doc.originalPriceFcfa,
    image: doc.image,
    description: doc.description,
    rating: doc.rating,
    reviews: doc.reviews
});

const serializeUser = (doc) => ({
    id: doc._id.toString(),
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    createdAt: doc.createdAt,
    lastLoginAt: doc.lastLoginAt,
    lastLogoutAt: doc.lastLogoutAt,
    isOnline: doc.isOnline
});

const serializeLoginEvent = (doc) => ({
    id: doc._id.toString(),
    username: doc.username,
    ipAddress: doc.ipAddress,
    userAgent: doc.userAgent,
    createdAt: doc.createdAt
});

const serializeContact = (doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    message: doc.message,
    createdAt: doc.createdAt
});

const serializeOrder = (doc) => ({
    id: doc._id.toString(),
    totalFcfa: doc.totalFcfa,
    operator: doc.operator,
    paymentPhone: doc.paymentPhone,
    status: doc.status,
    createdAt: doc.createdAt
});

// ---------- Création / mise à jour du compte propriétaire ----------
async function ensureOwnerAccount() {
    const ownerUsername = process.env.OWNER_USERNAME || 'proprietaire';
    const ownerPassword = process.env.OWNER_PASSWORD || 'changez-ce-mot-de-passe';
    const existing = await Owner.findOne({ username: ownerUsername });
    if (!existing) {
        await Owner.create({ username: ownerUsername, passwordHash: bcrypt.hashSync(ownerPassword, 12) });
        console.log(`Compte propriétaire créé : ${ownerUsername}`);
    } else if (!bcrypt.compareSync(ownerPassword, existing.passwordHash)) {
        existing.passwordHash = bcrypt.hashSync(ownerPassword, 12);
        await existing.save();
        console.log(`Mot de passe propriétaire mis à jour : ${ownerUsername}`);
    }
}

async function start() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connecté à MongoDB');
    await ensureOwnerAccount();

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

    function requireUser(req, res, next) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        try {
            const payload = jwt.verify(token, jwtSecret);
            if (!payload.userId) throw new Error();
            req.user = payload;
            next();
        } catch { res.status(401).json({ error: 'Connexion client requise pour commander.' }); }
    }

    // ---------- Santé ----------
    app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'shopmart-backend' }));

    // ---------- Auth propriétaire ----------
    app.post('/api/auth/owner/login', async (req, res) => {
        const account = await Owner.findOne({ username: req.body?.username });
        if (!account || !bcrypt.compareSync(req.body?.password || '', account.passwordHash)) return res.status(401).json({ error: 'Identifiants incorrects.' });
        await OwnerLoginEvent.create({ ownerId: account._id, username: account.username, ipAddress: req.ip, userAgent: req.get('user-agent') || '' });
        res.json({ token: jwt.sign({ ownerId: account._id.toString(), username: account.username }, jwtSecret, { expiresIn: '8h' }), owner: { username: account.username } });
    });

    // ---------- Auth clients ----------
    app.post('/api/auth/register', async (req, res) => {
        const { firstName, lastName, email, password } = req.body || {};
        if (![firstName, lastName, email, password].every((value) => typeof value === 'string' && value.trim()) || password.length < 6) return res.status(400).json({ error: 'Informations invalides. Le mot de passe doit contenir 6 caractères minimum.' });
        try {
            await User.create({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), passwordHash: bcrypt.hashSync(password, 12) });
            res.status(201).json({ message: 'Compte créé avec succès.' });
        } catch { res.status(409).json({ error: 'Cette adresse email est déjà utilisée.' }); }
    });

    app.post('/api/auth/login', async (req, res) => {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const account = await User.findOne({ email });
        if (!account || !bcrypt.compareSync(req.body?.password || '', account.passwordHash)) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
        account.lastLoginAt = new Date();
        account.lastLogoutAt = null;
        account.isOnline = true;
        await account.save();
        res.json({ token: jwt.sign({ userId: account._id.toString(), email: account.email }, jwtSecret, { expiresIn: '8h' }), user: { firstName: account.firstName, lastName: account.lastName, email: account.email } });
    });

    app.post('/api/auth/logout', requireUser, async (req, res) => {
        await User.findByIdAndUpdate(req.user.userId, { isOnline: false, lastLogoutAt: new Date() });
        res.status(204).end();
    });

    // ---------- Gestion utilisateurs (admin) ----------
    app.get('/api/users', requireOwner, async (req, res) => {
        const users = await User.find().sort({ _id: -1 });
        res.json(users.map(serializeUser));
    });
    app.delete('/api/users/:id', requireOwner, async (req, res) => {
        await User.findByIdAndDelete(req.params.id).catch(() => null);
        res.status(204).end();
    });

    // ---------- Historique connexions admin ----------
    app.get('/api/owner/login-events', requireOwner, async (req, res) => {
        const events = await OwnerLoginEvent.find().sort({ _id: -1 }).limit(50);
        res.json(events.map(serializeLoginEvent));
    });

    // ---------- Produits ----------
    app.get('/api/products', async (req, res) => {
        const products = await Product.find().sort({ _id: -1 });
        res.json(products.map(serializeProduct));
    });

    app.post('/api/products', requireOwner, async (req, res) => {
        const body = req.body || {};
        if (!['name', 'category', 'image', 'description'].every((field) => typeof body[field] === 'string' && body[field].trim()) || !Number.isFinite(Number(body.priceFcfa)) || !Number.isFinite(Number(body.originalPriceFcfa))) return res.status(400).json({ error: 'Informations produit invalides.' });
        const created = await Product.create({
            name: body.name.trim(),
            category: body.category.trim(),
            priceFcfa: Math.round(Number(body.priceFcfa)),
            originalPriceFcfa: Math.round(Number(body.originalPriceFcfa)),
            image: body.image.trim(),
            description: body.description.trim(),
            rating: Number(body.rating || 5),
            reviews: Number(body.reviews || 0)
        });
        res.status(201).json({ id: created._id.toString(), message: 'Produit ajouté.' });
    });

    app.put('/api/products/:id', requireOwner, async (req, res) => {
        const body = req.body || {};
        if (!['name', 'category', 'image', 'description'].every((field) => typeof body[field] === 'string' && body[field].trim()) || !Number.isFinite(Number(body.priceFcfa)) || !Number.isFinite(Number(body.originalPriceFcfa))) return res.status(400).json({ error: 'Informations produit invalides.' });
        const product = await Product.findById(req.params.id).catch(() => null);
        if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
        product.set({
            name: body.name.trim(),
            category: body.category.trim(),
            priceFcfa: Math.round(Number(body.priceFcfa)),
            originalPriceFcfa: Math.round(Number(body.originalPriceFcfa)),
            image: body.image.trim(),
            description: body.description.trim()
        });
        await product.save();
        res.json({ message: 'Produit mis à jour.' });
    });

    app.delete('/api/products/:id', requireOwner, async (req, res) => {
        await Product.findByIdAndDelete(req.params.id).catch(() => null);
        res.status(204).end();
    });

    // ---------- Contact ----------
    app.post('/api/contact', async (req, res) => {
        const { name, email, message } = req.body || {};
        if (![name, email, message].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ error: 'Nom, email et message sont obligatoires.' });
        await ContactMessage.create({ name: name.trim(), email: email.trim(), message: message.trim() });
        res.status(201).json({ message: 'Message enregistré.' });
    });
    app.get('/api/contact', requireOwner, async (req, res) => {
        const messages = await ContactMessage.find().sort({ _id: -1 });
        res.json(messages.map(serializeContact));
    });

    // ---------- Commandes ----------
    app.post('/api/orders', requireUser, async (req, res) => {
        const { totalFcfa, operator, paymentPhone } = req.body || {};
        if (!['Orange Money', 'MTN Mobile Money', 'Wave', 'Moov Money'].includes(operator) || !Number.isFinite(Number(totalFcfa)) || !/^\d{8,14}$/.test(String(paymentPhone || '').replace(/\s/g, ''))) return res.status(400).json({ error: 'Informations de paiement invalides.' });
        await Order.create({
            totalFcfa: Math.round(Number(totalFcfa)),
            operator,
            paymentPhone: String(paymentPhone).replace(/\s/g, ''),
            userId: req.user.userId
        });
        res.status(201).json({ status: 'pending', message: 'Commande enregistrée en attente de paiement.' });
    });
    app.get('/api/orders', requireOwner, async (req, res) => {
        const orders = await Order.find().sort({ _id: -1 });
        res.json(orders.map(serializeOrder));
    });
    app.delete('/api/orders/:id', requireOwner, async (req, res) => {
        await Order.findByIdAndDelete(req.params.id).catch(() => null);
        res.status(204).end();
    });

    // ---------- Fallback frontend ----------
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    });

    app.listen(port, () => console.log(`ShopMart API running on http://localhost:${port}`));
}

start().catch((error) => { console.error(error); process.exit(1); });