// =========================================================
//  PART 1: 設定與資料庫連接 (已升級支援多 Sheet)
// =========================================================

const CONFIG = {
    // 請填入你的 Google Sheet ID
    SPREADSHEET_ID: '1tJjquBs-Wyav4VEg7XF-BnTAGoWhE-5RFwwhU16GuwQ', 
    
    // [修改] 支援多個工作表，請在陣列中填入所有名稱
    // 程式會自動將這些工作表的資料合併在一起
    SHEET_NAMES: ['Sheet1', 'Sheet2'], 

    // 定義哪些欄位是「機型」，程式會自動掃描這些欄位找驅動版本
    // 必須完全對應 Google Sheet 的第一列標題
    SERVER_MODELS: ["RX2530_M7", "RX2540_M7", "RX4770_M7"] 
};

// 全域變數
let products = []; 

async function fetchDataFromDatabase() {
    const statusMsg = document.getElementById('statusMsg');
    
    try {
        statusMsg.innerText = `正在連線至 ${CONFIG.SHEET_NAMES.length} 個工作表...`;
        
        // 1. 建立所有 Sheet 的連線請求 (Promise Array)
        const fetchPromises = CONFIG.SHEET_NAMES.map(sheetName => {
            const apiUrl = `https://opensheet.elk.sh/${CONFIG.SPREADSHEET_ID}/${sheetName}`;
            return fetch(apiUrl)
                .then(response => {
                    if (!response.ok) throw new Error(`無法讀取工作表: ${sheetName}`);
                    return response.json();
                });
        });

        // 2. 等待所有請求完成 (Promise.all)
        const results = await Promise.all(fetchPromises);
        
        // 3. 合併資料 (Flatten)
        // results 會是一個 [ [Sheet1 data], [Sheet2 data] ] 的結構，用 flat() 攤平
        const combinedRawData = results.flat();

        statusMsg.innerText = `資料載入成功，共 ${combinedRawData.length} 筆原始數據 (來自 ${CONFIG.SHEET_NAMES.length} 個工作表)`;
        
        // 4. 處理矩陣資料 (Data Transformation)
        return processMatrixData(combinedRawData);

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
 * 處理：合併儲存格填充、多 OS 合併、提取機型驅動
 */
function processMatrixData(rawData) {
    const processedMap = new Map();
    
    // 用來處理「合併儲存格」的暫存變數
    // 注意：跨 Sheet 時，這些變數會重置，這在 forEach 邏輯中是正確的行為嗎？
    // 修正：因為合併了不同 Sheet，為了避免 Sheet A 的最後一筆「殘留」影響到 Sheet B 的第一筆，
    // 我們應該在每次遇到新資料時謹慎處理。但在簡單的 flat() 陣列中，我們假設每個 Sheet 第一筆都是完整的。
    
    let lastComponent = "";
    let lastVendor = "";
    let lastFormFactor = ""; 

    rawData.forEach((row, index) => {
        // 防呆：如果遇到完全空白的行，直接跳過
        if (!row.Description && !row.Component && !row.Vendor) return;

        // 1. 向下填充 (Fill Down) 邏輯
        if (row.Component && row.Component.trim() !== "") lastComponent = row.Component.trim();
        if (row.Vendor && row.Vendor.trim() !== "") lastVendor = row.Vendor.trim();
        
        let currentFormFactor = row.FormFactor ? row.FormFactor.trim() : "";
        if (currentFormFactor !== "") lastFormFactor = currentFormFactor;
        
        // 2. 取得基本資料
        const name = row.Description ? row.Description.trim() : "未命名產品";
        // 支援 Operating_System 或 OS 兩種欄位寫法
        const os = row.Operating_System || row.OS || "Unknown"; 

        // 3. 掃描所有機型欄位
        CONFIG.SERVER_MODELS.forEach(modelKey => {
            const version = row[modelKey];

            // 有效版本號判定 (不為空且不為 n/a)
            if (version && version.toString().toLowerCase() !== "n/a" && version.toString().trim() !== "") {
                
                // 建立唯一 Key (用 Description 當 Key 來合併不同 OS 的資料)
                const productKey = name;

                if (!processedMap.has(productKey)) {
                    processedMap.set(productKey, {
                        id: index, // 注意：合併後 id 僅供參考
                        name: name,
                        brand: lastVendor,
                        category: lastComponent,
                        formFactor: lastFormFactor, 
                        osList: new Set(),
                        drivers: []
                    });
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
//  PART 3: 渲染卡片與 UI 邏輯 (互動版)
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

// [互動功能] 切換驅動版本
function switchDriver(cardId, idx) {
    const card = document.getElementById(cardId);
    if (!card) return;

    // 1. 處理內容顯示
    const rows = card.querySelectorAll('.driver-row');
    rows.forEach(r => r.classList.remove('active'));
    
    const targetRow = card.querySelector(`.driver-row[data-index="${idx}"]`);
    if (targetRow) targetRow.classList.add('active');

    // 2. 處理按鈕樣式
    const btns = card.querySelectorAll('.os-pill');
    btns.forEach(b => b.classList.remove('active'));

    const targetBtn = card.querySelector(`.os-pill[data-index="${idx}"]`);
    if (targetBtn) targetBtn.classList.add('active');
}

window.switchDriver = switchDriver;

function renderProducts(data) {
    const container = document.getElementById('productContainer');
    
    if (!data || data.length === 0) {
        container.innerHTML = '<div class="no-results">沒有找到符合條件的硬體</div>';
        return;
    }

    container.innerHTML = data.map((product, pIndex) => { 
        const brandColor = getBrandColorVar(product.brand);
        const cardId = `card-${pIndex}`;
        
        // --- 邏輯核心：準備互動資料 ---
        let driverBoxHtml = '<div style="padding:5px; color:#999; font-size:12px;">暫無驅動資訊</div>';
        let badgesHtml = '<span style="font-size:12px; color:#ccc;">無支援系統</span>';

        if (product.drivers && product.drivers.length > 0) {
            product.drivers.sort((a, b) => a.os.localeCompare(b.os));

            // 生成上方顯示區
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

            // 生成下方按鈕區
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

function getMockData() {
    return processMatrixData([
        { "Component": "Chipset", "Vendor": "Intel", "Description": "Intel QAT", "Operating_System": "Windows Server 2022", "RX2530_M7": "2.5.0", "RX2540_M7": "n/a" },
        { "Component": "Network", "Vendor": "NVIDIA", "FormFactor": "PCIE", "Description": "ConnectX-6 Dx", "Operating_System": "RHEL 9", "RX2530_M7": "4.8", "RX2540_M7": "4.8" }
    ]);
}

window.onload = async function() { 
    products = await fetchDataFromDatabase();
    renderSidebar(); 
    renderProducts(products); 

    document.getElementById("searchInput").addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault(); 
            applyFilters(); 
        }
    });
};