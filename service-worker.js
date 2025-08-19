const CACHE_NAME = 'warehouse-pwa-v2.1';
const STATIC_CACHE = 'warehouse-static-v2.1';
const DYNAMIC_CACHE = 'warehouse-dynamic-v2.1';
const API_CACHE = 'warehouse-api-v2.1';

// 核心靜態資源
const CORE_FILES = [
  './index.html',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// 可選資源（網路優先）
const OPTIONAL_FILES = [
  'https://cdn-icons-png.flaticon.com/512/833/833314.png',
  'https://cdn-icons-png.flaticon.com/192/833/833314.png',
  'https://cdn-icons-png.flaticon.com/256/833/833314.png'
];

// API 端點
const API_URL = 'https://script.google.com/macros/s/AKfycbyB4TTvjshkq3nb5eWlfHMLiyeDQga9ItJGq_HFM_BXEDdxzmcPWN2CHburipqZv4QS/exec';

// Service Worker 安裝
self.addEventListener('install', event => {
  console.log('[SW] 正在安裝 Service Worker');
  
  event.waitUntil(
    Promise.all([
      // 快取核心資源
      caches.open(STATIC_CACHE).then(cache => {
        console.log('[SW] 正在快取核心資源');
        return cache.addAll(CORE_FILES);
      }),
      // 嘗試快取可選資源（失敗不影響安裝）
      caches.open(STATIC_CACHE).then(cache => {
        console.log('[SW] 正在快取可選資源');
        return Promise.allSettled(
          OPTIONAL_FILES.map(url => 
            fetch(url).then(response => {
              if (response.ok) {
                return cache.put(url, response);
              }
            }).catch(() => console.log(`[SW] 無法快取可選資源: ${url}`))
          )
        );
      })
    ]).then(() => {
      console.log('[SW] 安裝完成，跳過等待');
      self.skipWaiting();
    })
  );
});

// Service Worker 啟用
self.addEventListener('activate', event => {
  console.log('[SW] 正在啟用 Service Worker');
  
  event.waitUntil(
    Promise.all([
      // 清理舊快取
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => 
              cacheName.startsWith('warehouse-') && 
              ![STATIC_CACHE, DYNAMIC_CACHE, API_CACHE].includes(cacheName)
            )
            .map(cacheName => {
              console.log(`[SW] 刪除舊快取: ${cacheName}`);
              return caches.delete(cacheName);
            })
        );
      }),
      // 立即控制所有客戶端
      self.clients.claim()
    ]).then(() => {
      console.log('[SW] 啟用完成');
    })
  );
});

// 網路請求處理
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // 跳過非 GET 請求和 Chrome 擴展請求
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
    return;
  }
  
  // API 請求策略：網路優先，失敗時返回離線提示
  if (url.href.includes('script.google.com')) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  
  // 靜態資源策略：快取優先
  if (isStaticResource(url)) {
    event.respondWith(handleStaticRequest(request));
    return;
  }
  
  // HTML 頁面策略：網路優先，失敗時返回快取
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }
  
  // 其他請求：網路優先，快取作為備份
  event.respondWith(handleDynamicRequest(request));
});

// API 請求處理
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  try {
    // 嘗試網路請求
    const response = await fetch(request);
    
    if (response.ok) {
      // GET 請求且成功時，快取回應（有效期 5 分鐘）
      if (request.method === 'GET') {
        const cache = await caches.open(API_CACHE);
        const responseClone = response.clone();
        
        // 添加時間戳以實現過期機制
        const headers = new Headers(responseClone.headers);
        headers.set('sw-cached-time', Date.now().toString());
        
        const cachedResponse = new Response(responseClone.body, {
          status: responseClone.status,
          statusText: responseClone.statusText,
          headers: headers
        });
        
        cache.put(request, cachedResponse);
      }
      
      return response;
    }
    
    throw new Error(`API 請求失敗: ${response.status}`);
    
  } catch (error) {
    console.warn('[SW] API 請求失敗:', error);
    
    // GET 請求失敗時，嘗試返回快取
    if (request.method === 'GET') {
      const cache = await caches.open(API_CACHE);
      const cachedResponse = await cache.match(request);
      
      if (cachedResponse) {
        const cachedTime = cachedResponse.headers.get('sw-cached-time');
        const now = Date.now();
        const cacheAge = cachedTime ? now - parseInt(cachedTime) : Infinity;
        
        // 快取有效期 5 分鐘
        if (cacheAge < 5 * 60 * 1000) {
          console.log('[SW] 返回快取的 API 資料');
          return cachedResponse;
        }
      }
    }
    
    // 返回離線提示
    return new Response(
      JSON.stringify({ 
        error: '網路連線異常', 
        message: '請檢查網路連線並重試',
        offline: true,
        timestamp: new Date().toISOString()
      }), 
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// 靜態資源請求處理
async function handleStaticRequest(request) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 快取中沒有，嘗試網路請求
    const response = await fetch(request);
    
    if (response.ok) {
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.warn('[SW] 靜態資源請求失敗:', error);
    
    // 返回離線頁面或預設回應
    if (request.url.includes('.html')) {
      const cache = await caches.open(STATIC_CACHE);
      return await cache.match('./index.html') || createOfflineResponse();
    }
    
    return createOfflineResponse();
  }
}

// 頁面請求處理
async function handlePageRequest(request) {
  try {
    // 嘗試網路請求
    const response = await fetch(request);
    
    if (response.ok) {
      // 快取成功的頁面回應
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    
    throw new Error(`頁面請求失敗: ${response.status}`);
    
  } catch (error) {
    console.warn('[SW] 頁面請求失敗:', error);
    
    // 嘗試返回快取的頁面
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // 返回主頁面作為後備
    const staticCache = await caches.open(STATIC_CACHE);
    const fallback = await staticCache.match('./index.html');
    
    return fallback || createOfflineResponse();
  }
}

// 動態請求處理
async function handleDynamicRequest(request) {
  try {
    const response = await fetch(request);
    
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.warn('[SW] 動態請求失敗:', error);
    
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    return cachedResponse || createOfflineResponse();
  }
}

// 判斷是否為靜態資源
function isStaticResource(url) {
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf'];
  const cdnHosts = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'cdn-icons-png.flaticon.com'];
  
  return staticExtensions.some(ext => url.pathname.includes(ext)) || 
         cdnHosts.some(host => url.hostname.includes(host));
}

// 創建離線回應
function createOfflineResponse() {
  const offlineHtml = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>離線模式 - 倉庫管理系統</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0;
                color: white;
            }
            .offline-container {
                text-align: center;
                background: rgba(255, 255, 255, 0.1);
                padding: 3rem;
                border-radius: 20px;
                backdrop-filter: blur(10px);
                max-width: 500px;
            }
            .offline-icon {
                font-size: 4rem;
                margin-bottom: 2rem;
                opacity: 0.8;
            }
            .offline-title {
                font-size: 2rem;
                margin-bottom: 1rem;
                font-weight: 600;
            }
            .offline-message {
                font-size: 1.1rem;
                margin-bottom: 2rem;
                opacity: 0.9;
                line-height: 1.6;
            }
            .retry-button {
                background: rgba(255, 255, 255, 0.2);
                border: 2px solid rgba(255, 255, 255, 0.3);
                color: white;
                padding: 12px 30px;
                border-radius: 50px;
                cursor: pointer;
                font-size: 1rem;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            .retry-button:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: translateY(-2px);
            }
        </style>
    </head>
    <body>
        <div class="offline-container">
            <div class="offline-icon">📦</div>
            <h1 class="offline-title">離線模式</h1>
            <p class="offline-message">
                目前無法連接到網路。<br>
                部分功能可能受限，請檢查您的網路連線。
            </p>
            <button class="retry-button" onclick="window.location.reload()">
                重新載入
            </button>
        </div>
    </body>
    </html>
  `;
  
  return new Response(offlineHtml, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 背景同步（如果支援）
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('[SW] 執行背景同步');
    event.waitUntil(syncData());
  }
});

// 背景同步邏輯
async function syncData() {
  try {
    // 這裡可以實現離線時儲存的資料同步
    console.log('[SW] 背景同步完成');
  } catch (error) {
    console.error('[SW] 背景同步失敗:', error);
  }
}

// 推送通知（如果需要）
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : '倉庫管理系統通知',
    icon: 'https://cdn-icons-png.flaticon.com/192/833/833314.png',
    badge: 'https://cdn-icons-png.flaticon.com/96/833/833314.png',
    vibrate: [200, 100, 200],
    tag: 'warehouse-notification',
    requireInteraction: true,
    actions: [
      {
        action: 'view',
        title: '查看詳情',
        icon: 'https://cdn-icons-png.flaticon.com/96/149/149852.png'
      },
      {
        action: 'dismiss',
        title: '關閉',
        icon: 'https://cdn-icons-png.flaticon.com/96/1828/1828778.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('倉庫管理系統', options)
  );
});

// 通知點擊處理
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('./')
    );
  }
});

// Service Worker 訊息處理
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log(`[SW] Service Worker 已載入，版本: ${CACHE_NAME}`);
