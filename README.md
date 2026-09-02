# ShopMart

## Publication

Le dossier `frontend/` est publiable sur GitHub Pages. Le workflow `.github/workflows/deploy-pages.yml` le déploie automatiquement à chaque push sur `main`.

Le dossier `backend/` ne peut pas fonctionner sur GitHub Pages : il doit être déployé séparément sur un hébergeur Node.js avec une base persistante. Après déploiement, renseignez son URL publique dans `frontend/api.js` avec `window.SHOPMART_API_URL` avant le chargement de `api.js`.

## Local

```powershell
cd backend
npm install
npm start
```

Puis ouvrez `http://localhost:3000/`.

## GitHub

```powershell
git init
git add .
git commit -m "Initial ShopMart application"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/ShopMart.git
git push -u origin main
```

Dans GitHub : `Settings > Pages > Source`, choisissez `GitHub Actions`. Le site sera ensuite disponible à l'adresse `https://VOTRE-COMPTE.github.io/ShopMart/`.

Ne publiez jamais `backend/.env` ni `backend/shopmart.db` dans GitHub.
