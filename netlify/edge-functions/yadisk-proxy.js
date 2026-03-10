// netlify/edge-functions/yadisk-proxy.js
//
// Серверный стриминг-прокси для Яндекс.Диска.
// Зачем нужен: Яндекс привязывает download-URL к IP запросившего клиента.
// Третьи-сторонние CORS-прокси (corsproxy.io и др.) идут с другого IP → 403.
// Edge Function: получает URL И сразу скачивает файл с ОДНОГО сервера → OK.
// Стриминг: файлы любого размера, без буферизации.

export default async (request) => {
    // CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin':  '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Max-Age':       '86400',
            },
        });
    }

    const url       = new URL(request.url);
    const publicKey = url.searchParams.get('public_key');

    if (!publicKey) {
        return new Response(JSON.stringify({ error: 'Нет параметра public_key' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    try {
        // Шаг 1: Получаем прямую ссылку на файл через Yandex API.
        // ВАЖНО: запрос идёт с сервера (Edge node) — фиксируем его IP для download URL.
        const apiUrl  = 'https://cloud-api.yandex.net/v1/disk/public/resources/download'
                      + '?public_key=' + encodeURIComponent(publicKey);
        const apiResp = await fetch(apiUrl);
        if (!apiResp.ok) {
            return new Response(JSON.stringify({ error: 'Yandex API: ' + apiResp.status }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }
        const { href: directUrl } = await apiResp.json();
        if (!directUrl) {
            return new Response(JSON.stringify({ error: 'Yandex не вернул ссылку' }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // Шаг 2: Скачиваем файл с ТОЙ ЖЕ Edge node (тот же IP, что запросил URL выше).
        // Яндекс принимает запрос → нет 403.
        const imgResp = await fetch(directUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanoramaProxy/1.0)' },
        });
        if (!imgResp.ok) {
            return new Response(JSON.stringify({ error: 'Яндекс вернул ' + imgResp.status }), {
                status: 502,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
        }

        // Стримим тело ответа — без буферизации, любой размер файла
        const headers = new Headers({
            'Content-Type':                imgResp.headers.get('content-type') || 'image/jpeg',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               'public, max-age=3600',
        });
        if (imgResp.headers.get('content-length')) {
            headers.set('Content-Length', imgResp.headers.get('content-length'));
        }

        return new Response(imgResp.body, { status: 200, headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
};

// Роутинг без netlify.toml (файловая конфигурация Netlify Edge Functions)
export const config = { path: '/yadisk-proxy' };
