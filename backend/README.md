# ShopMart Backend

API Express avec base SQLite persistante dans `shopmart.db`.

## Démarrer

```powershell
cd backend
npm install
npm start
```

API disponible sur `http://localhost:3000`.

Le serveur sert aussi directement le frontend. Ouvrez `http://localhost:3000/` pour la boutique ou `http://localhost:3000/dashboard.html` pour l'espace propriétaire. Aucun Live Server n'est nécessaire.

## Connexion du frontend

En local, `frontend/api.js` utilise automatiquement `http://localhost:3000/api`.
En production, définissez l'URL de l'API avant de charger `api.js` :

```html
<script>window.SHOPMART_API_URL = 'https://api.votre-domaine.com/api';</script>
<script src="api.js"></script>
```

Le frontend utilise alors l'API pour les produits, l'authentification propriétaire, les messages et les commandes.

## Accès propriétaire local

- Identifiant : `proprietaire`
- Mot de passe : `ShopMart@2026`

Ces valeurs sont configurées dans `.env`. En production, remplacez-les par des valeurs privées et changez `JWT_SECRET`.

## Routes principales

- `GET /api/health` : vérifier l'API
- `POST /api/auth/owner/login` : obtenir un token propriétaire
- `GET /api/products` : lister les produits
- `POST /api/products` : ajouter un produit, token propriétaire requis
- `DELETE /api/products/:id` : supprimer un produit, token propriétaire requis
- `POST /api/contact` : enregistrer un message
- `GET /api/contact` : lire les messages, token propriétaire requis
- `POST /api/orders` : enregistrer une commande mobile
- `GET /api/orders` : lire les commandes, token propriétaire requis

Le frontend HTML devra ensuite appeler ces routes au lieu de `localStorage` pour obtenir une synchronisation entre appareils.
