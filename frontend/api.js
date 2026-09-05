const SHOPMART_API_URL = window.SHOPMART_API_URL || (
    window.location.protocol === 'file:' ||
    ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000')
        ? 'http://localhost:3000/api'
        : `${window.location.origin}/api`
);

async function shopmartApi(path, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const token = path.startsWith('/auth/owner') || path.startsWith('/products') || path.startsWith('/users') || path.startsWith('/owner/') || path.startsWith('/contact')
        ? sessionStorage.getItem('shopmartOwnerToken')
        : sessionStorage.getItem('shopmartUserToken');
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${SHOPMART_API_URL}${path}`, { ...options, headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erreur serveur.' }));
        throw new Error(error.error || 'Erreur serveur.');
    }
    return response.status === 204 ? null : response.json();
}

function shopmartProductFromApi(product) {
    return {
        ...product,
        price: Number(product.priceFcfa) / 655.957,
        originalPrice: Number(product.originalPriceFcfa) / 655.957
    };
}
