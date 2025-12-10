// =========================================================
//  PART 1: 設定與資料庫連接
// =========================================================

const CONFIG = {
    // 請填入你的 Google Sheet ID (從網址列 d/ 和 /edit 中間取得)
    SPREADSHEET_ID: '1tJjquBs-Wyav4VEg7XF-BnTAGoWhE-5RFwwhU16GuwQ', 
    
    // 工作表名稱 (通常是 Sheet1 或 工作表1)
    SHEET_NAME: 'Sheet1',

    // 定義哪些欄位是「機型」，程式會自動掃描這些欄位找驅動版本
    // 必須完全對應 Google Sheet 的第一列標題
    SERVER_MODELS: ["RX2530_M7", "RX2540_M7", "RX4770_M7"] 
};

// 全域變數
let products = []; 

async function fetchDataFromDatabase() {
    const statusMsg = document.getElementById('statusMsg');
    
    try {
        statusMsg.innerText = "正在連線至資料庫...";
        
        // 1. 構建 API URL (使用 opensheet.elk.sh 免費 API)
        const apiUrl = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/${CONFIG.SHEET_NAME}`;

        // 2. 獲取資料
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("無法讀取 Google Sheet，請確認 ID 與權限設為公開");
        
        const rawData = await response.json();
        statusMsg.innerText = `資料載入成功，共 ${rawData.length} 筆原始數據`;
        
        // 3. 處理矩陣資料 (Data Transformation)
        return processMatrixData(rawData);

    } catch (error) {
        console.error("資料載入錯誤:", error);
        statusMsg.innerHTML = `<span style="color:red;">載入失敗: ${error.message}</span>`;
        
        // [開發用] 若連線失敗，回傳模擬資料以便測試 UI
        console.warn("切換至本機模擬資料模式");
        return getMockData();
    }
}

/**
 * 核心演算法：將 Excel 矩陣格式轉換為應用程式物件
 * 修改版：新增讀取 Firmware 與 Spec 欄位
 */
function processMatrixData(rawData) {
    const processedMap = new Map();
    
    // 用來處理「合併儲存格」的暫存變數
    let lastComponent = "";
    let lastVendor = "";
    let lastFormFactor = ""; 
    let lastFirmware = ""; // [新增] 韌體版本暫存
    let lastSpec = "";     // [新增] 規格暫存

    rawData.forEach((row, index) => {
        // 防呆：如果遇到完全空白的行，直接跳過
        if (!row.Description && !row.Component && !row.Vendor) return;

        // 1. 向下填充 (Fill Down) 邏輯
        if (row.Component && row.Component.trim() !== "") lastComponent = row.Component.trim();
        if (row.Vendor && row.Vendor.trim() !== "") lastVendor = row.Vendor.trim();
        
        // [新增] 讀取 Firmware 欄位 (請確認 Excel 標題是 Firmware 或 FW)
        let currentFW = row.Firmware || row.FW || row.FW_Version || "";
        if (currentFW.trim() !== "") lastFirmware = currentFW.trim();

        // [新增] 讀取 Spec 欄位 (請確認 Excel 標題是 Spec 或 Specifications)
        let currentSpec = row.Spec || row.Specifications || "";
        if (currentSpec.trim() !== "") lastSpec = currentSpec.trim();

        let currentFormFactor = row.FormFactor ? row.FormFactor.trim() : "";
        if (currentFormFactor !== "") lastFormFactor = currentFormFactor;
        
        // 2. 取得基本資料
        const name = row.Description ? row.Description.trim() : "未命名產品";
        const os = row.Operating_System || row.OS || "Unknown"; 

        // 3. 掃描所有機型欄位
        CONFIG.SERVER_MODELS.forEach(modelKey => {
            const version = row[modelKey];

            // 有效版本號判定
            if (version && version.toString().toLowerCase() !== "n/a" && version.toString().trim() !== "") {
                
                const productKey = name;

                if (!processedMap.has(productKey)) {
                    processedMap.set(productKey, {
                        id: index,
                        name: name,
                        brand: lastVendor,
                        category: lastComponent,
                        formFactor: lastFormFactor, 
                        fw: lastFirmware, // [新增] 寫入物件
                        spec: lastSpec,   // [新增] 寫入物件
                        osList: new Set(),
                        drivers: []
                    });
                }

                const product = processedMap.get(productKey);
                product.osList.add(os);
                product.drivers.push({
                    os: os,
                    model: modelKey.replace(/_/g, " "),
                    ver: version
                });
            }
        });
    });

    return Array.from(processedMap.values()).map(p => ({
        ...p,
        os: Array.from(p.osList)
    }));
}

                const product = processedMap.get(productKey);

                // 加入 OS
                product.osList.add(os);

                // 加入 Driver 資訊
                product.drivers.push({
                    os: os,
                    model: modelKey.replace(/_/g, " "), // 顯示時把底線換空白
                    ver: version
                });
            }
        });
    });

    // 將 Set 轉回 Array 並輸出
    return Array.from(processedMap.values()).map(p => ({
        ...p,
        os: Array.from(p.osList) // 轉回陣列方便渲染
    }));
}

// =========================================================
//  PART 2: 側欄選單邏輯 (包含 Network 特殊處理)
// =========================================================

function buildSidebarTree(data) {
    const tree = {};

    data.forEach(p => {
        let path = [];

        // --- 核心邏輯：Network 特殊分流 ---
        if (p.category && p.category.toLowerCase() === 'network') {
            // 如果沒有 FormFactor，預設歸類為 PCIE
            const root = p.formFactor ? p.formFactor.toUpperCase() : 'PCIE'; 
            // 路徑： PCIE/OCP > Network > Brand > Spec(Name)
            path = [root, 'Network', p.brand, p.name];
        } else {
            // 一般路徑： Category > Brand > Spec(Name)
            path = [p.category, p.brand, p.name];
        }

        // 建立樹狀物件
        let currentLevel = tree;
        path.forEach((key, index) => {
            if (!key) key = "其他"; // 防呆
            if (!currentLevel[key]) {
                currentLevel[key] = (index === path.length - 1) ? null : {};
            }
            currentLevel = currentLevel[key];
        });
    });
    return tree;
}

function renderTreeHTML(node, level = 0, distinctPath = []) {
    if (!node) return ''; 

    let html = '';
    // 排序 Key，讓廠商或類型按字母排序
    Object.keys(node).sort().forEach(key => {
        const children = node[key];
        const currentPath = [...distinctPath, key];
        const isLeaf = children === null;

        if (isLeaf) {
            // 葉節點：點擊觸發搜尋 (搜尋規格名稱)
            html += `<li>
                        <div class="menu-item" onclick="filterBySpec('${key}')">
                            ${key}
                        </div>
                     </li>`;
        } else {
            // 分支節點：可折疊
            html += `<li>
                        <div class="menu-item" onclick="toggleMenu(this)">
                            ${key} <span class="arrow">▶</span>
                        </div>
                        <ul class="submenu">
                            ${renderTreeHTML(children, level + 1, currentPath)}
                        </ul>
                     </li>`;
        }
    });
    return html;
}

function renderSidebar() {
    const treeData = buildSidebarTree(products);
    const menuContainer = document.getElementById('sidebarMenu');
    if (Object.keys(treeData).length === 0) {
        menuContainer.innerHTML = '<li style="padding:15px; color:red;">無資料或載入失敗</li>';
    } else {
        menuContainer.innerHTML = renderTreeHTML(treeData);
    }
}

function toggleMenu(el) {
    const submenu = el.nextElementSibling;
    const arrow = el.querySelector('.arrow');
    if(submenu) { 
        submenu.classList.toggle('open'); 
        if(arrow) arrow.classList.toggle('rotate'); 
    }
}

function filterBySpec(specName) {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = specName; 
    applyFilters();
}

// =========================================================
//  PART 3: 渲染卡片與 UI 邏輯 (大幅修改 - 互動版)
// =========================================================

function getBrandColorVar(brand) {
    if (!brand) return 'var(--brand-default)';
    const b = brand.toUpperCase();
    if (b.includes('NVIDIA')) return 'var(--brand-nvidia)';
    if (b.includes('AMD')) return 'var(--brand-amd)';
    if (b.includes('INTEL')) return 'var(--brand-intel)';
    if (b.includes('BROADCOM')) return 'var(--brand-broadcom)';
    if (b.includes('FUJITSU')) return 'var(--brand-fujitsu)';
    return 'var(--brand-default)';
}

// [新增功能] 切換驅動版本的互動邏輯
// cardId: 該張卡片的唯一編號 (例如 card-0)
// idx: 被點擊的 OS 在該卡片陣列中的索引 (例如 0, 1, 2)
function switchDriver(cardId, idx) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // 1. 處理內容顯示：先隱藏全部，再顯示目標
    const rows = card.querySelectorAll('.driver-row');
    rows.forEach(r => r.classList.remove('active'));
    
    const targetRow = card.querySelector(`.driver-row[data-index="${idx}"]`);
    if (targetRow) targetRow.classList.add('active');

    // 2. 處理按鈕樣式：先移除全部 active，再點亮目標
    const btns = card.querySelectorAll('.os-pill');
    btns.forEach(b => b.classList.remove('active'));

    const targetBtn = card.querySelector(`.os-pill[data-index="${idx}"]`);
    if (targetBtn) targetBtn.classList.add('active');
}

// 為了讓 HTML onclick 能呼叫到這個函式，將其掛載到 window
window.switchDriver = switchDriver;

function renderProducts(data) {
    const container = document.getElementById('productContainer');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="no-results">沒有找到符合條件的硬體</div>';
        return;
    }

    container.innerHTML = data.map((product, pIndex) => { // 使用 pIndex 作為唯一 ID
        const brandColor = getBrandColorVar(product.brand);
        const cardId = `card-${pIndex}`;
        
        // --- 邏輯核心：準備互動資料 ---
        // 如果沒有驅動資料，顯示預設訊息
        let driverBoxHtml = '<div style="padding:5px; color:#999; font-size:12px;">暫無驅動資訊</div>';
        let badgesHtml = '<span style="font-size:12px; color:#ccc;">無支援系統</span>';

        if (product.drivers && product.drivers.length > 0) {
            
            // 排序：確保顯示順序一致 (依 OS 名稱排序)
            product.drivers.sort((a, b) => a.os.localeCompare(b.os));

            // 1. 生成上方顯示區 (Driver Box)
            // 包含多個 driver-row，但只有第一個 (index 0) 會有 active class
            const rowsHtml = product.drivers.map((d, i) => {
                const activeClass = (i === 0) ? 'active' : '';
                return `
                <div class="driver-row ${activeClass}" data-index="${i}">
                    <span class="driver-os-label">${d.os}</span>
                    <span class="driver-ver-val">${d.ver}</span>
                </div>
                `;
            }).join('');

            driverBoxHtml = `<div class="driver-box">${rowsHtml}</div>`;

            // 2. 生成下方按鈕區 (Badges)
            // 綁定 onclick 事件，呼叫 switchDriver
            badgesHtml = product.drivers.map((d, i) => {
                const activeClass = (i === 0) ? 'active' : '';
                return `
                <span class="os-pill ${activeClass}" 
                      data-index="${i}"
                      onclick="window.switchDriver('${cardId}', ${i})">
                      ${d.os}
                </span>`;
            }).join('');
        }

        // 處理 FormFactor 標籤 (OCP / PCIE)
        const ffBadge = (product.category === 'Network' && product.formFactor) 
            ? `<span style="font-size:10px; background:#eee; color:#333; padding:1px 5px; border-radius:3px; margin-right:5px; border:1px solid #ccc;">${product.formFactor}</span>` 
            : '';

        return `
        <div class="hw-card" id="${cardId}">
            <div class="card-header">
                <div class="card-title" title="${product.name}">${ffBadge}${product.name}</div>
                <div class="brand-badge" style="background-color: ${brandColor}">${product.brand}</div>
            </div>
            
            <div class="card-body">
                <div class="spec-row">
                    <span class="spec-label">類型</span>
                    <span class="spec-value">${product.category}</span>
                </div>
                
                <div class="driver-container">
                    <div class="section-title">DRIVER 版本:</div>
                    ${driverBoxHtml}
                </div>

                <div class="support-badges">
                    <div style="display:flex; align-items:center; margin-bottom:5px;">
                        <span class="support-label">選擇系統:</span>
                    </div>
                    <div class="os-tags">
                        ${badgesHtml}
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// =========================================================
//  PART 4: 搜尋與初始化
// =========================================================

function applyFilters() {
    const kw = document.getElementById('searchInput').value.toLowerCase().trim();
    
    const res = products.filter(p => {
        // 搜尋範圍：名稱、廠家、類型、支援的 OS、Driver 版本、機型
        const driverContent = p.drivers.map(d => `${d.os} ${d.model} ${d.ver}`).join(' ');
        const content = [
            p.name, 
            p.brand, 
            p.category, 
            p.formFactor,
            p.os.join(' '),
            driverContent
        ].join(' ').toLowerCase();

        return content.includes(kw);
    });
    
    renderProducts(res);
}

function clearFilters() { 
    document.getElementById('searchInput').value=''; 
    applyFilters(); 
}

// 模擬資料 (當沒有 Google Sheet ID 時使用)
function getMockData() {
    return processMatrixData([
        { "Component": "Chipset", "Vendor": "Intel", "Description": "Intel QAT", "Operating_System": "Windows Server 2022", "RX2530_M7": "2.5.0", "RX2540_M7": "n/a" },
        { "Component": "",        "Vendor": "",      "Description": "Intel QAT", "Operating_System": "Windows Server 2019", "RX2530_M7": "2.4.0", "RX2540_M7": "2.4.0" },
        { "Component": "Network", "Vendor": "NVIDIA", "FormFactor": "PCIE", "Description": "ConnectX-6 Dx", "Operating_System": "RHEL 9", "RX2530_M7": "4.8", "RX2540_M7": "4.8" },
        { "Component": "Network", "Vendor": "Broadcom", "FormFactor": "OCP", "Description": "BCM57414", "Operating_System": "ESXi 8.0", "RX2530_M7": "224.0", "RX2540_M7": "224.0" }
    ]);
}

window.onload = async function() { 
    // 1. 載入資料
    products = await fetchDataFromDatabase();
    
    // 2. 渲染畫面
    renderSidebar(); 
    renderProducts(products); 

    // 3. 綁定 Enter 鍵
    document.getElementById("searchInput").addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault(); 
            applyFilters(); 
        }
    });
};

function renderProducts(data) {
    const container = document.getElementById('productContainer');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="no-results">沒有找到符合條件的硬體</div>';
        return;
    }

    container.innerHTML = data.map((product, pIndex) => { 
        const brandColor = getBrandColorVar(product.brand);
        const cardId = `card-${pIndex}`;
        
        // --- 互動資料準備 ---
        let driverBoxHtml = '<div style="padding:5px; color:#999; font-size:12px;">暫無驅動資訊</div>';
        let badgesHtml = '<span style="font-size:12px; color:#ccc;">無支援系統</span>';

        if (product.drivers && product.drivers.length > 0) {
            product.drivers.sort((a, b) => a.os.localeCompare(b.os));

            // 上方顯示區 (Driver Box)
            const rowsHtml = product.drivers.map((d, i) => {
                const activeClass = (i === 0) ? 'active' : '';
                return `
                <div class="driver-row ${activeClass}" data-index="${i}">
                    <span class="driver-os-label">${d.os}</span>
                    <span class="driver-ver-val">${d.ver}</span>
                </div>
                `;
            }).join('');
            driverBoxHtml = `<div class="driver-box">${rowsHtml}</div>`;

            // 下方按鈕區 (Badges)
            badgesHtml = product.drivers.map((d, i) => {
                const activeClass = (i === 0) ? 'active' : '';
                return `
                <span class="os-pill ${activeClass}" 
                      data-index="${i}"
                      onclick="window.switchDriver('${cardId}', ${i})">
                      ${d.os}
                </span>`;
            }).join('');
        }

        const ffBadge = (product.category === 'Network' && product.formFactor) 
            ? `<span style="font-size:10px; background:#eee; color:#333; padding:1px 5px; border-radius:3px; margin-right:5px; border:1px solid #ccc;">${product.formFactor}</span>` 
            : '';

        // [新增] 處理 FW 和 Spec 的顯示，若無資料顯示 '-'
        const displayFW = product.fw || '-';
        const displaySpec = product.spec || '-';

        return `
        <div class="hw-card" id="${cardId}">
            <div class="card-header">
                <div class="card-title" title="${product.name}">${ffBadge}${product.name}</div>
                <div class="brand-badge" style="background-color: ${brandColor}">${product.brand}</div>
            </div>
            
            <div class="card-body">
                <div class="info-list" style="margin-bottom:15px;">
                    <div class="spec-row">
                        <span class="spec-label">類型</span>
                        <span class="spec-value">${product.category}</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">規格</span>
                        <span class="spec-value">${displaySpec}</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">FW 版本</span>
                        <span class="spec-value" style="font-family:monospace;">${displayFW}</span>
                    </div>
                </div>
                
                <div class="driver-container">
                    <div class="section-title">DRIVER 版本:</div>
                    ${driverBoxHtml}
                </div>

                <div class="support-badges">
                    <div style="display:flex; align-items:center; margin-bottom:5px;">
                        <span class="support-label">支援系統 (點擊切換):</span>
                    </div>
                    <div class="os-tags">
                        ${badgesHtml}
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');
}