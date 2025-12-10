// =========================================================
//  PART 1: 設定與 API 串接
// =========================================================

const SPREADSHEET_ID = '1tJjquBs-Wyav4VEg7XF-BnTAGoWhE-5RFwwhU16GuwQ'; 

// ★ 修改 1: 在這裡加入 'FW' Sheet
const TARGET_SHEETS = [
    'Windows', 
    'RHEL', 
    'Oracle', 
    'ESXi',
    'FW'  // 新增這一個
];

let allProducts = [];

async function fetchSheetData(sheetName) {
    const url = `https://opensheet.elk.sh/${SPREADSHEET_ID}/${sheetName}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (error) {
        console.error(`抓取 Sheet [${sheetName}] 失敗:`, error);
        return [];
    }
}

// =========================================================
//  PART 2: 資料處理邏輯 (包含 FW 與合併儲存格處理)
// =========================================================

async function initData() {
    const statusEl = document.getElementById('statusMsg');
    if(statusEl) statusEl.innerText = "正在讀取 Google Sheet 資料...";

    const sheetsPromises = TARGET_SHEETS.map(name => fetchSheetData(name));
    let sheetsData = [];
    try {
        sheetsData = await Promise.all(sheetsPromises);
    } catch (e) {
        if(statusEl) statusEl.innerText = "資料載入失敗。";
        return;
    }

    let aggregatedMap = {};

    sheetsData.forEach((sheet, index) => {
        if (!Array.isArray(sheet)) return;

        // 取得當前 Sheet 的名稱
        const currentSheetName = TARGET_SHEETS[index];
        const isFwSheet = (currentSheetName === 'FW'); // 判斷是否為 FW 表

        // 記憶變數 (處理合併儲存格用)
        let lastComponent = ''; 
        let lastVendor = '';    

        sheet.forEach(item => {
            const desc = item.description || item.Description || item['Model Name'];
            
            // 欄位抓取 (包含大小寫容錯)
            let rawComp = item.component || item.Component; 
            let rawVendor = item.vendor || item.Vendor;
            
            const swid = item.swid || item.SWID;
            const stat = item.status || item.Status;
            
            // ★ 修改 2: 抓取 FW 欄位 (支援 'FW Version', 'FW', 'Version')
            const fwVer = item['FW Version'] || item['FW'] || item.Version || item.FW;

            // Driver 相關
            const driverVer = item.driver || item.Driver || item.Version; // 注意：在非 FW 表這代表 Driver
            const osVer = item.os || item.OS;

            if (!desc) return;

            // --- 自動填滿邏輯 (Component) ---
            if (rawComp && rawComp.trim() !== '') {
                lastComponent = rawComp;
            } else {
                rawComp = lastComponent;
            }

            // --- 自動填滿邏輯 (Vendor) ---
            if (rawVendor && rawVendor.trim() !== '') {
                lastVendor = rawVendor;
            } else {
                rawVendor = lastVendor;
            }

            const modelKey = desc.trim();

            // 若該產品尚未建立，先初始化
            if (!aggregatedMap[modelKey]) {
                aggregatedMap[modelKey] = {
                    id: swid || '',            
                    model: desc, 
                    brand: rawVendor || 'Generic',
                    type: rawComp || 'N/A',    
                    status: stat || '',
                    fw: 'N/A',  // ★ 初始化 FW 欄位
                    drivers: [] 
                };
            }

            // ★ 核心分流邏輯 ★
            if (isFwSheet) {
                // 如果這張表是 FW，我們只更新 fw 欄位，不加到 drivers 列表
                if (fwVer) {
                    aggregatedMap[modelKey].fw = fwVer;
                }
                // 如果 FW 表也有更新 Status 或 SWID，也可以在這裡覆蓋
                if (swid) aggregatedMap[modelKey].id = swid;
                if (stat) aggregatedMap[modelKey].status = stat;

            } else {
                // 如果是 OS Driver 表 (Windows, RHEL...)，加到 drivers 列表
                aggregatedMap[modelKey].drivers.push({
                    os: osVer || currentSheetName, 
                    ver: driverVer || 'N/A'
                });
            }
        });
    });

    allProducts = Object.values(aggregatedMap);
    renderSidebar();
    renderProducts(allProducts); 
    
    if(statusEl) statusEl.innerText = `載入完成，共整合 ${allProducts.length} 項元件資料。`;
}

// <--- 原本這裡少了一個大括號，導致程式崩潰
// =========================================================
//  PART 3: 渲染卡片 (新增 FW 顯示欄位)
// =========================================================

function renderProducts(data) {
    const container = document.getElementById('productContainer');
    container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML = '<div class="no-results">找不到符合條件的資料</div>';
        return;
    }

    data.forEach((product, index) => {
        const cardId = `card-${index}`;
        const brandColor = getBrandColor(product.brand);
        
        // 排序 OS
        product.drivers.sort((a, b) => a.os.localeCompare(b.os));

        // 1. Driver 列表 DOM
        let driverRows = product.drivers.map((d, i) => {
            const isActive = (i === 0) ? 'active' : '';
            return `
            <div class="driver-row ${isActive}" data-index="${i}">
                <span class="driver-os-label" title="${d.os}">${d.os}</span>
                <span class="driver-ver-val">${d.ver}</span>
            </div>`;
        }).join('');

        // 2. OS 按鈕 DOM
        let badges = product.drivers.map((d, i) => {
            const isActive = (i === 0) ? 'active' : '';
            let shortOs = d.os.replace('Microsoft', '').replace('Enterprise', '').trim();
            if(shortOs.length > 20) shortOs = shortOs.split(' ').slice(0, 2).join(' ');

            return `
            <span class="os-pill ${isActive}" 
                  data-index="${i}"
                  onclick="switchDriver('${cardId}', ${i})">
                  ${shortOs}
            </span>`;
        }).join('');

        const html = `
        <div class="hw-card" id="${cardId}">
            <div class="card-header">
                <div class="card-title" title="${product.model}">${product.model}</div>
                <div class="brand-badge" style="background-color: ${brandColor}">${product.brand}</div>
            </div>
            <div class="card-body">
                
                <div class="spec-row">
                    <span class="spec-label">Component</span>
                    <span class="spec-value" style="font-weight:bold;">${product.type}</span>
                </div>

                <div class="spec-row">
                    <span class="spec-label">SWID / Status</span>
                    <span class="spec-value">${product.id} <span style="color:#ccc">|</span> ${product.status}</span>
                </div>

                <div class="spec-row">
                    <span class="spec-label">FW</span>
                    <span class="spec-value" style="color: #2c3e50; font-weight: bold;">${product.fw}</span>
                </div>
                <div class="driver-container">
                    <div class="section-title">DRIVER VERSION:</div>
                    <div class="driver-box">
                        ${driverRows}
                    </div>
                </div>

                <div class="support-row">
                    <div class="os-tags">
                        ${badges}
                    </div>
                </div>
            </div>
        </div>`;
        
        container.innerHTML += html;
    });
}
// =========================================================

//  PART 4: 側邊欄與搜尋功能

// =========================================================



function renderSidebar() {

    const menu = document.getElementById('sidebarMenu');

    menu.innerHTML = '';

    

    // 簡單依據 Brand 分類建立樹狀選單

    const brands = [...new Set(allProducts.map(p => p.brand))];

    

    brands.forEach(brand => {

        const items = allProducts.filter(p => p.brand === brand);

        let subItemsHtml = items.map(item => 

            `<li class="menu-item" onclick="filterByModel('${item.model}')" style="padding-left:30px; font-size:13px; background:#fafafa;">

                ${item.model}

             </li>`

        ).join('');



        menu.innerHTML += `

        <li>

            <div class="menu-item" onclick="toggleSubMenu(this)">

                ${brand} <span class="arrow">▶</span>

            </div>

            <ul class="submenu">${subItemsHtml}</ul>

        </li>`;

    });

}



window.toggleSubMenu = function(el) {

    const submenu = el.nextElementSibling;

    const arrow = el.querySelector('.arrow');

    if(submenu) {

        submenu.classList.toggle('open');

        if(arrow) arrow.classList.toggle('rotate');

    }

}



window.filterByModel = function(modelName) {

    document.getElementById('searchInput').value = modelName;

    applyFilters();

}



window.applyFilters = function() {

    const kw = document.getElementById('searchInput').value.toLowerCase();

    const filtered = allProducts.filter(p => 

        p.model.toLowerCase().includes(kw) || 

        p.brand.toLowerCase().includes(kw) ||

        p.type.toLowerCase().includes(kw) ||

        p.drivers.some(d => d.os.toLowerCase().includes(kw))

    );

    renderProducts(filtered);

}



window.clearFilters = function() {

    document.getElementById('searchInput').value = '';

    renderProducts(allProducts);

}



// 按下 Enter 搜尋

document.getElementById("searchInput").addEventListener("keypress", function(event) {

    if (event.key === "Enter") applyFilters();

});

// =========================================================
//  PART 5: 遺失的輔助函式 (請補上這裡)
// =========================================================

// 1. 取得品牌對應顏色的函式
function getBrandColor(brandName) {
    if (!brandName) return '#555'; // 預設灰色
    
    const bn = brandName.toLowerCase();
    if (bn.includes('nvidia')) return '#76B900';
    if (bn.includes('amd')) return '#ED1C24';
    if (bn.includes('intel')) return '#0068B5';
    if (bn.includes('broadcom')) return '#D93025';
    
    return '#555'; // 若都不符合，回傳預設色
}

// 2. 切換 Driver 版本 (OS Pill 點擊事件)
window.switchDriver = function(cardId, driverIndex) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // 1. 切換顯示的文字行 (driver-row)
    const rows = card.querySelectorAll('.driver-row');
    rows.forEach(row => row.classList.remove('active'));
    
    const targetRow = card.querySelector(`.driver-row[data-index="${driverIndex}"]`);
    if (targetRow) targetRow.classList.add('active');

    // 2. 切換按鈕樣式 (os-pill)
    const pills = card.querySelectorAll('.os-pill');
    pills.forEach(pill => pill.classList.remove('active'));
    
    const targetPill = card.querySelector(`.os-pill[data-index="${driverIndex}"]`);
    if (targetPill) targetPill.classList.add('active');
}

// 啟動程式

window.onload = initData;

