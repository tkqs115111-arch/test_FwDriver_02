// =========================================================
//  PART 1: 設定與 API 串接 (取代原本的模擬資料)
// =========================================================

// 1. 設定你的 Google Sheet ID
const SPREADSHEET_ID = '1tJjquBs-Wyav4VEg7XF-BnTAGoWhE-5RFwwhU16GuwQ'; 
// 例如: '1P-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'

// 2. 定義你要抓取的 Sheet 名稱 (必須與 Google Sheet 下方頁籤名稱一致)
// OpenSheet 會自動對應這些名稱
const TARGET_SHEETS = [
    'Windows', 
    'RHEL', 
    'Oracle', 
    'ESXi'
];

// 全域變數：儲存處理後的資料
let allProducts = [];

// 抓取單一 Sheet 的函式
async function fetchSheetData(sheetName) {
    const url = `https://opensheet.elk.sh/${SPREADSHEET_ID}/${sheetName}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        // OpenSheet 有時會回傳錯誤訊息物件，需檢查是否為陣列
        if (!Array.isArray(data)) {
            console.warn(`Sheet [${sheetName}] 回傳格式可能有誤或為空`, data);
            return [];
        }
        return data;
    } catch (error) {
        console.error(`抓取 Sheet [${sheetName}] 失敗:`, error);
        return []; // 失敗回傳空陣列，避免整個程式崩潰
    }
}

// =========================================================
//  PART 2: 資料處理邏輯 (配合 Excel 新格式)
// =========================================================

async function initData() {
    const statusEl = document.getElementById('statusMsg');
    if(statusEl) statusEl.innerText = "正在讀取 Google Sheet 資料...";

    // 使用 Promise.all 平行抓取所有 Sheet
    const sheetsPromises = TARGET_SHEETS.map(name => fetchSheetData(name));
    
    let sheetsData = [];
    try {
        sheetsData = await Promise.all(sheetsPromises);
    } catch (e) {
        if(statusEl) statusEl.innerText = "資料載入失敗，請檢查 Google Sheet 權限與名稱。";
        return;
    }

    let aggregatedMap = {};

    sheetsData.forEach((sheet, index) => {
        sheet.forEach(item => {
            // 防呆：如果 Description 是空的就跳過
            if (!item.description) return;

            // ★ 修改點：使用 Description 作為唯一的合併 Key
            const modelKey = item.description.trim();

            if (!aggregatedMap[modelKey]) {
                aggregatedMap[modelKey] = {
                    // 對應 Excel 的欄位
                    id: item.swid || '',            // 儲存 SWID
                    model: item.description,        // 標題改用 Description
                    brand: item.vendor || 'Generic',// 品牌改用 Vendor
                    type: item.component || '',     // 類型改用 Component
                    status: item.status || '',      // 新增 Release Status
                    drivers: [] 
                };
            }

            // 將 Driver 資訊推入陣列
            aggregatedMap[modelKey].drivers.push({
                os: item.os || TARGET_SHEETS[index], 
                ver: item.driver || 'N/A'
            });
        });
    });

    // 轉回陣列並排序
    allProducts = Object.values(aggregatedMap);
    
    // 更新 UI
    renderSidebar();
    renderProducts(allProducts); // 呼叫新的渲染函式
    
    if(statusEl) statusEl.innerText = `載入完成，共整合 ${allProducts.length} 項元件資料。`;
}

// =========================================================
//  PART 3: 渲染卡片 (已移除 PCI ID)
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

        // 1. Driver 列表
        let driverRows = product.drivers.map((d, i) => {
            const isActive = (i === 0) ? 'active' : '';
            return `
            <div class="driver-row ${isActive}" data-index="${i}">
                <span class="driver-os-label" title="${d.os}">${d.os}</span>
                <span class="driver-ver-val">${d.ver}</span>
            </div>`;
        }).join('');

        // 2. OS 切換按鈕
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

        // ★ 修改點：移除 PCI ID 的 spec-row
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



// 啟動程式

window.onload = initData;

