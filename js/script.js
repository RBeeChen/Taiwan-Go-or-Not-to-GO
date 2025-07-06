// --- 1. 初始化地圖 ---
// 注意：L.map() 的 setView 參數在 map.whenReady() 中會被 fitBounds 覆蓋，
// 但為了確保地圖物件能被正確初始化，這裡仍然需要一個初始視圖。
const map = L.map('map', {
    zoomControl: true 
}).setView([23.9, 121], 7);

// --- 2. 全域變數與 DOM 元素 ---
let countyGeojsonLayer; // 縣市層 GeoJSON 圖層
let townGeojson = null; // 鄉鎮層 GeoJSON 原始資料 (用於查找鄉鎮邊界)
// affectedTownshipLayers 是一個圖層群組，用於存放所有受影響的鄉鎮圖層
// 初始時不立即添加到地圖，等到所有圖層都準備好後再添加，以確保疊放順序
let affectedTownshipLayers = L.layerGroup(); 

const infoPanel = document.getElementById('info-panel');
const updateTimeEl = document.getElementById('update-time');
const mapLoader = document.getElementById('map-loader');
const showErrorBtn = document.getElementById('show-error-btn');
const errorDetailModal = document.getElementById('error-detail-modal');
const errorMessageEl = document.getElementById('error-message');
const errorDetailCloseBtn = document.getElementById('error-detail-close');
const outlyingIslandsInfoEl = document.getElementById('outlying-islands-info'); // 離島資訊元素
const weatherBulletinInfoEl = document.getElementById('weather-bulletin-info'); // 天氣快報資訊元素
let lastErrorMessage = ''; // 儲存最後一次錯誤訊息的變數

// 新增側邊欄相關 DOM 元素
const sidebar = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
let zoomControlEl; // 宣告 Leaflet 縮放控制按鈕的變數

const suspensionData = {}; // 儲存停班停課資訊，鍵可以是縣市名或縣市鄉鎮名
// 定義需要特別顯示的離島名稱，用於從 RSS 資料中篩選 (這些通常是鄉鎮層級)
const outlyingIslands = ['澎湖縣', '金門縣', '連江縣', '臺東縣蘭嶼鄉', '臺東縣綠島鄉'];

// 日期切換按鈕相關 DOM 元素
const viewTodayBtn = document.getElementById('view-today-btn');
const viewTomorrowBtn = document.getElementById('view-tomorrow-btn');
// 全域變數，表示目前地圖顯示的是哪一天的資料
let currentDisplayDate = new Date(); 
currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day

// --- URL 定義 ---
// 更新 GeoJSON URL 以反映新的 Repository 名稱
const countyGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/raw/refs/heads/main/twmap.json'; // 縣市層級 GeoJSON
const townGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/releases/download/NEW_JSON/TW_town.json'; // 鄉鎮層級 GeoJSON
// 停班課資訊來源更改為 JSON 格式
const jsonFeedURL = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx?AlertType=33';
const cwaWarningRSSURL = 'https://www.cwa.gov.tw/rss/Data/cwa_warning.xml'; // 中央氣象局天氣快報 RSS
// 將 CORS 代理服務更換為 corsproxy.io
const proxyURL = 'https://corsproxy.io/?'; 

// --- 3. 樣式邏輯 ---
function getStyle(status) {
    const baseStyle = { weight: 1.5, opacity: 1, color: 'white', fillOpacity: 0.8 };
    switch (status) {
        case 'suspended': return { ...baseStyle, fillColor: '#ef4444' }; // 紅色：全天停止上班上課
        case 'partial_time': return { ...baseStyle, fillColor: '#facc15' }; // 黃色：非全天停止上班或上課 (例如上午、中午、下午、晚上停課)
        case 'partial': return { ...baseStyle, fillColor: '#f97316' };   // 橘色：部分區域或特定人員
        case 'normal': return { ...baseStyle, fillColor: '#3b82f6' }; // 藍色：正常上班上課
        case 'no_info': default: return { ...baseStyle, fillColor: '#cccccc' }; // 灰色：沒有公布資訊
    }
}
const highlightStyle = { weight: 4, color: '#333', fillOpacity: 0.95 }; // 滑鼠懸停時的邊框樣式

// Helper to format date toYYYY-MM-DD
function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Helper to format date for display (e.g., "7月6日")
function formatDisplayDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
}

// Helper to parse date from text like "7/7" or "7月7日"
function parseDateFromText(text, referenceDate) {
    const year = referenceDate.getFullYear();
    // Look for MM/DD pattern
    const mdMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (mdMatch) {
        const month = parseInt(mdMatch[1], 10);
        const day = parseInt(mdMatch[2], 10);
        const parsedDate = new Date(year, month - 1, day);
        parsedDate.setHours(0, 0, 0, 0);
        // Basic validation: ensure it's a valid date and not too far in the past/future
        if (parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day) {
            return parsedDate;
        }
    }
    // Look for MM月DD日 pattern
    const chineseDateMatch = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (chineseDateMatch) {
        const month = parseInt(chineseDateMatch[1], 10);
        const day = parseInt(chineseDateMatch[2], 10);
        const parsedDate = new Date(year, month - 1, day);
        parsedDate.setHours(0, 0, 0, 0);
        if (parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day) {
            return parsedDate;
        }
    }
    return null; // No date found
}

// 標準化縣市/鄉鎮名稱，處理「臺」與「台」的差異，並移除括號內容
function normalizeName(name) { 
    return name.replace('臺', '台').replace(/\(.*?\)/g, '').trim(); 
}

// 修正狀態判斷邏輯 - 移至全域範圍
// isTownshipSpecific 參數用於判斷是否為鄉鎮層級的公告，以便更精確地判斷「部分區域」的意義
const determineStatus = (stmt) => {
    const isSuspendedKeyword = stmt.includes('停止上班') || stmt.includes('停止上課') || stmt.includes('已達停止上班及上課標準');
    const isPartialTimeSuspension = stmt.includes('下午') || stmt.includes('晚上') || stmt.includes('中午') || stmt.includes('早上');
    // 判斷是否為「部分區域或特定人員」的關鍵字，這些將導致橘色狀態
    const isSpecificAreaKeywords = stmt.includes('部分區域') || stmt.includes('特定人員') || stmt.includes('學校') || stmt.includes('鄰里');

    if (isSuspendedKeyword) {
        if (isSpecificAreaKeywords) {
            return 'partial'; // 橘色：部分區域或特定人員 (無論縣市或鄉鎮層級)
        } else if (isPartialTimeSuspension) {
            return 'partial_time'; // 黃色：非全天停止 (上午、中午、下午、晚上)
        } else {
            return 'suspended'; // 紅色：全天停止
        }
    }
    return 'normal'; // 藍色：正常上班上課
};

// Define status priority (higher index means higher priority) - Moved to global scope
const statusPriority = ['normal', 'partial', 'partial_time', 'suspended'];

// 從 NCDR JSON 訂閱源載入停班停課資料
async function loadSuspensionData() {
    try {
        const response = await fetch(`${proxyURL}${encodeURIComponent(jsonFeedURL)}`); // 使用新的 JSON URL
        if (!response.ok) throw new Error(`JSON Feed fetch failed: ${response.status}`);
        
        const jsonData = await response.json(); // 解析為 JSON

        // 檢查 JSON 資料結構是否有效
        if (!jsonData || !Array.isArray(jsonData.entry)) {
            throw new Error("Invalid JSON structure: missing 'entry' array.");
        }

        const entries = jsonData.entry; // 直接從 JSON 獲取 entry 陣列

        // 更新資料更新時間顯示
        const updatedTime = jsonData.updated; // 從 JSON 根層級獲取 updated 時間
        if (updatedTime) {
            updateTimeEl.textContent = `資料更新時間：${new Date(updatedTime).toLocaleString('zh-TW')}`;
        } else {
            updateTimeEl.textContent = `資料更新時間：無法取得`;
        }

        // Temporary storage to hold all entries for each location, keyed by normalized name
        // rawSuspensionData = { 'NormalizedName': { isTownship: bool, parentCounty: string, dates: { 'YYYY-MM-DD': [{entry1}, {entry2}], ... } }, ... }
        const rawSuspensionData = {}; 

        entries.forEach(entry => {
            const summaryText = entry.summary?.['#text'] || '';
            const cleanSummary = summaryText.replace(/\[.*?\]/g, '').trim();
            if (!cleanSummary.includes(':')) return;

            let [countyTownRaw, statusText] = cleanSummary.split(/:(.*)/s);
            if (!countyTownRaw || !statusText) return;

            countyTownRaw = countyTownRaw.trim();
            statusText = statusText.trim();

            if (statusText.includes('尚未列入警戒區')) return;

            let targetKey = '';
            let parentCountyName = '';
            let isTownshipSpecific = false;

            const foundOutlyingIsland = outlyingIslands.find(island => countyTownRaw.includes(island));
            if (foundOutlyingIsland) {
                targetKey = normalizeName(foundOutlyingIsland);
                isTownshipSpecific = true;
                const countyMatch = foundOutlyingIsland.match(/^(.*?)(縣|市)/);
                if (countyMatch) {
                    parentCountyName = normalizeName(countyMatch[1].trim() + countyMatch[2].trim());
                } else {
                    parentCountyName = normalizeName(countyTownRaw.split('縣')[0].split('市')[0] + (countyTownRaw.includes('縣') ? '縣' : '市'));
                }
            } else {
                const townshipPattern = /(.*?)(縣|市)(.*?)(鄉|鎮|市|區)/;
                const match = countyTownRaw.match(townshipPattern);

                if (match) {
                    targetKey = normalizeName(countyTownRaw);
                    parentCountyName = normalizeName(match[1].trim() + match[2].trim());
                    isTownshipSpecific = true;
                } else {
                    targetKey = normalizeName(countyTownRaw.replace(/部分區域|災害應變中心/g, '').trim());
                    parentCountyName = targetKey;
                    isTownshipSpecific = false;
                }
            }
            parentCountyName = normalizeName(parentCountyName);

            // Initialize rawSuspensionData[targetKey] if it doesn't exist
            if (!rawSuspensionData[targetKey]) {
                rawSuspensionData[targetKey] = {
                    dates: {},
                    isTownship: isTownshipSpecific, // Set location's isTownship here
                    parentCounty: parentCountyName 
                };
            }

            const entryUpdatedDate = new Date(entry.updated);
            entryUpdatedDate.setHours(0,0,0,0); // Normalize update date to start of day

            let targetAnnouncementDate = null; // The actual calendar date this announcement applies to

            // 1. Check for explicit "今天"
            if (statusText.includes('今天')) {
                targetAnnouncementDate = entryUpdatedDate;
            } 
            // 2. Check for explicit "明天"
            else if (statusText.includes('明天')) {
                targetAnnouncementDate = new Date(entryUpdatedDate);
                targetAnnouncementDate.setDate(targetAnnouncementDate.getDate() + 1);
                targetAnnouncementDate.setHours(0,0,0,0);
            } 
            // 3. Try to parse date from text (e.g., "7/7停止上班" or "7月7日停止上班")
            else {
                const parsedDate = parseDateFromText(statusText, entryUpdatedDate);
                if (parsedDate) {
                    targetAnnouncementDate = parsedDate;
                }
            }

            // 4. If no specific date found, assume it applies to the announcement's update date ("今天")
            if (!targetAnnouncementDate) {
                targetAnnouncementDate = entryUpdatedDate;
            }

            const targetAnnouncementDateStr = formatDateToYYYYMMDD(targetAnnouncementDate);

            // Ensure date array exists for this target date
            if (!rawSuspensionData[targetKey].dates[targetAnnouncementDateStr]) {
                rawSuspensionData[targetKey].dates[targetAnnouncementDateStr] = [];
            }

            // Store entry data with the determined target date
            rawSuspensionData[targetKey].dates[targetAnnouncementDateStr].push({
                updated: new Date(entry.updated), // Keep original updated timestamp for recency
                statusText: statusText,
                isTownship: isTownshipSpecific,
                parentCounty: parentCountyName
            });
        });

        // Now process rawSuspensionData to determine final statuses for each location and date
        for (const locationKey in rawSuspensionData) {
            // Initialize suspensionData[locationKey] using the stored properties from rawSuspensionData
            suspensionData[locationKey] = {
                dates: {}, // Stores status for specific dates
                isTownship: rawSuspensionData[locationKey].isTownship, // Get from rawSuspensionData
                parentCounty: rawSuspensionData[locationKey].parentCounty, // Get from rawSuspensionData
                hasTownshipSpecificData: false // Will be updated later for parent counties
            };

            for (const dateStr in rawSuspensionData[locationKey].dates) {
                const entriesForDate = rawSuspensionData[locationKey].dates[dateStr];
                entriesForDate.sort((a, b) => b.updated.getTime() - a.updated.getTime()); // Newest first

                let finalStatusForDate = { status: 'normal', text: `照常上班、照常上課`, updated: new Date(0) }; // Default text, will be prefixed later
                let foundRelevantAnnouncement = false;

                for (const entry of entriesForDate) {
                    const statusText = entry.statusText;
                    let stmt = statusText; // Use full statusText for now, determineStatus will parse it

                    if (stmt) { // Ensure statement is not empty
                        const currentStatus = determineStatus(stmt);
                        // If the current status is stronger, or if it's the same priority but newer
                        if (statusPriority.indexOf(currentStatus) > statusPriority.indexOf(finalStatusForDate.status)) {
                            finalStatusForDate = { status: currentStatus, text: stmt, updated: entry.updated };
                            foundRelevantAnnouncement = true;
                        } else if (statusPriority.indexOf(currentStatus) === statusPriority.indexOf(finalStatusForDate.status) && entry.updated > (finalStatusForDate.updated || 0)) {
                            // If same priority, take the most recent
                            finalStatusForDate = { status: currentStatus, text: stmt, updated: entry.updated };
                            foundRelevantAnnouncement = true;
                        }
                    }
                }
                
                // If no specific announcement was found for this date, default to normal
                if (!foundRelevantAnnouncement) {
                    finalStatusForDate = { status: 'normal', text: `照常上班、照常上課` };
                }

                suspensionData[locationKey].dates[dateStr] = finalStatusForDate;
            }
        }

        // Special handling for parent counties: set hasTownshipSpecificData if any of its townships are affected for the *current day*
        // OR if the county itself has a 'partial' status for the current day.
        const currentDayStr = formatDateToYYYYMMDD(new Date());
        for (const key in suspensionData) {
            const item = suspensionData[key];
            // If it's a township and it's affected today, mark its parent county
            if (item.isTownship && item.dates[currentDayStr] && item.dates[currentDayStr].status !== 'normal') {
                const parentCountyKey = item.parentCounty;
                if (suspensionData[parentCountyKey]) {
                    suspensionData[parentCountyKey].hasTownshipSpecificData = true;
                }
            }
            // If it's a county and its status is 'partial' for today, mark it as having specific data
            if (!item.isTownship && item.dates[currentDayStr] && item.dates[currentDayStr].status === 'partial') {
                item.hasTownshipSpecificData = true;
            }
        }
    } catch (error) {
        console.error("無法載入停班停課資料:", error);
        updateTimeEl.textContent = '停班課資料載入失敗，將顯示預設地圖狀態。';
        updateTimeEl.classList.add('text-red-600');
        throw error;
    }
}

// New function to render townships for a specific county
function renderTownshipsForCounty(countyName, displayDate) {
    affectedTownshipLayers.clearLayers(); // Clear existing township layers
    if (!townGeojson) {
        console.warn("鄉鎮 GeoJSON 資料尚未載入，無法渲染鄉鎮圖層。");
        return;
    }

    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDayRelativeToDisplay = new Date(displayDate);
    nextDayRelativeToDisplay.setDate(nextDayRelativeToDisplay.getDate() + 1);
    nextDayRelativeToDisplay.setHours(0,0,0,0); // Normalize to start of day
    const nextDayRelativeToDisplayStr = formatDateToYYYYMMDD(nextDayRelativeToDisplay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

    // Filter ALL townships that belong to the given county
    const townshipsInCounty = townGeojson.features.filter(f => normalizeName(f.properties.county) === normalizeName(countyName));

    if (townshipsInCounty.length > 0) {
        L.geoJSON(townshipsInCounty, {
            style: feature => {
                const townKey = normalizeName(feature.properties.county + feature.properties.town);
                const info = suspensionData[townKey];
                let statusToDisplay = 'no_info'; // Default for townships without specific info

                if (info && info.dates[displayDateStr]) {
                    statusToDisplay = info.dates[displayDateStr].status;
                } else if (displayDateStr === todayActualDateStr) {
                    // If it's today, and no explicit info for township, assume normal
                    statusToDisplay = 'normal';
                }
                return getStyle(statusToDisplay);
            },
            onEachFeature: (feature, layer) => {
                const townKey = normalizeName(feature.properties.county + feature.properties.town);
                const townDisplayName = feature.properties.county + feature.properties.town;
                const info = suspensionData[townKey];

                let townDisplayDateStatus = info && info.dates[displayDateStr] ? info.dates[displayDateStr] : null;
                if (!townDisplayDateStatus && displayDateStr === todayActualDateStr) {
                    townDisplayDateStatus = { status: 'normal', text: `照常上班、照常上課` };
                } else if (!townDisplayDateStatus) {
                    townDisplayDateStatus = { status: 'no_info', text: `尚未發布資訊` };
                }

                let townNextDayStatus = info && info.dates[nextDayRelativeToDisplayStr] ? info.dates[nextDayRelativeToDisplayStr] : null;
                if (!townNextDayStatus) {
                    townNextDayStatus = { status: 'no_info', text: `尚未發布資訊` };
                }

                let popupContent = `<strong class="text-base">${townDisplayName}</strong><br>`;
                popupContent += `<span style="color:${getStyle(townDisplayDateStatus.status).fillColor};">
                    ${formatDisplayDate(displayDate)}：${townDisplayDateStatus.text}
                </span><br>`;
                popupContent += `<span style="color:${getStyle(townNextDayStatus.status).fillColor};">
                    ${formatDisplayDate(nextDayRelativeToDisplay)}：${townNextDayStatus.text}
                </span>`;
                layer.bindPopup(popupContent);
                layer.bindTooltip(townDisplayName, { permanent: false, direction: 'center' });
            }
        }).addTo(affectedTownshipLayers);
        affectedTownshipLayers.addTo(map); // Add the group to the map
    }
}


// 函式：根據 currentDisplayDate 重新整理地圖顏色和資訊面板
function refreshMapDisplay() {
    const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date()); // 實際的今天日期字串

    // 更新縣市圖層的樣式
    if (countyGeojsonLayer) {
        countyGeojsonLayer.eachLayer(layer => {
            const countyName = normalizeName(layer.feature.properties.COUNTYNAME);
            const info = suspensionData[countyName];
            let statusToDisplay = 'no_info'; // 預設為灰色 (針對非今天)

            if (info && info.dates[displayDateStr]) {
                statusToDisplay = info.dates[displayDateStr].status;
            } else if (displayDateStr === todayActualDateStr) {
                // 如果是今天的日期，且沒有明確資訊，則預設為正常
                statusToDisplay = 'normal';
            }
            layer.setStyle(getStyle(statusToDisplay));
        });
    }

    // 更新資訊面板 (如果之前有選取縣市，則更新該縣市資訊)
    const currentCountyNameInPanel = infoPanel.dataset.countyName;
    const currentDisplayNameInPanel = infoPanel.dataset.displayName;
    if (currentCountyNameInPanel && currentDisplayNameInPanel) {
        updateInfoPanel(currentCountyNameInPanel, currentDisplayNameInPanel, currentDisplayDate);
        // Re-render townships for the previously selected county with the new date
        renderTownshipsForCounty(currentCountyNameInPanel, currentDisplayDate);
    } else {
        infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
        affectedTownshipLayers.clearLayers(); // Clear townships if no county is selected
    }

    // 更新離島資訊
    renderOutlyingIslandsInfo(currentDisplayDate);

    // 強制 Leaflet 地圖重新計算尺寸，確保版面正確
    if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
        map.invalidateSize(true);
    } else {
        console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
    }
}


// 函式：更新資訊面板內容
function updateInfoPanel(countyName, displayName, displayDate) {
    const countyInfo = suspensionData[countyName];
    let panelContent = `<h3 class="font-bold text-lg text-gray-900">${displayName}</h3>`;

    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDay = new Date(displayDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0,0,0,0); // Normalize to start of day
    const nextDayStr = formatDateToYYYYMMDD(nextDay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date()); // 實際的今天日期字串

    // Store the currently displayed county name and display name for refreshMapDisplay
    infoPanel.dataset.countyName = countyName;
    infoPanel.dataset.displayName = displayName;

    // Get status for the currentDisplayDate
    let countyDisplayDateStatus = countyInfo && countyInfo.dates[displayDateStr] ? countyInfo.dates[displayDateStr] : null;
    if (!countyDisplayDateStatus && displayDateStr === todayActualDateStr) {
        countyDisplayDateStatus = { status: 'normal', text: '照常上班、照常上課' };
    } else if (!countyDisplayDateStatus) {
        countyDisplayDateStatus = { status: 'no_info', text: '尚未發布資訊' };
    }

    const displayDateStatusColor = getStyle(countyDisplayDateStatus.status).fillColor;
    panelContent += `<p class="mt-1 font-semibold" style="color:${displayDateStatusColor};">
        ${formatDisplayDate(displayDate)}：${countyDisplayDateStatus.text}
    </p>`;

    // Get status for the next day relative to currentDisplayDate
    let countyNextDayStatus = countyInfo && countyInfo.dates[nextDayStr] ? countyInfo.dates[nextDayStr] : null;
    if (!countyNextDayStatus) {
        countyNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
    }
    const nextDayStatusColor = getStyle(countyNextDayStatus.status).fillColor;
    
    panelContent += `<p class="mt-1 font-semibold" style="color:${nextDayStatusColor};">
        ${formatDisplayDate(nextDay)}：${countyNextDayStatus.text}
    </p>`;

    // 在面板中顯示鄉鎮受影響資訊
    if (countyInfo && countyInfo.hasTownshipSpecificData && townGeojson) { // Check hasTownshipSpecificData here
        let townshipDetails = '';
        const filteredTownFeatures = townGeojson.features.filter(f => normalizeName(f.properties.county) === normalizeName(countyName));
        const affectedTownshipsInCounty = filteredTownFeatures.filter(townFeature => {
            const townKey = normalizeName(townFeature.properties.county + townFeature.properties.town);
            const townInfo = suspensionData[townKey];
            // Check status for current day or next day
            return townInfo && (
                (townInfo.dates[displayDateStr] && townInfo.dates[displayDateStr].status !== 'normal') ||
                (townInfo.dates[nextDayStr] && townInfo.dates[nextDayStr].status !== 'normal')
            );
        });

        if (affectedTownshipsInCounty.length > 0) {
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            affectedTownshipsInCounty.forEach(townFeature => { 
                const townKey = normalizeName(townFeature.properties.county + townFeature.properties.town);
                const info = suspensionData[townKey];
                
                let townDisplayDateStatus = info.dates[displayDateStr] || null;
                if (!townDisplayDateStatus && displayDateStr === todayActualDateStr) {
                    townDisplayDateStatus = { status: 'normal', text: `照常上班、照常上課` };
                } else if (!townDisplayDateStatus) {
                    townDisplayDateStatus = { status: 'no_info', text: `尚未發布資訊` };
                }

                let townNextDayStatus = info.dates[nextDayStr] || null;
                if (!townNextDayStatus) {
                    townNextDayStatus = { status: 'no_info', text: `尚未發布資訊` };
                }

                const townDisplayDateStatusColor = getStyle(townDisplayDateStatus.status).fillColor;
                const townNextDayStatusColor = getStyle(townNextDayStatus.status).fillColor;

                townshipDetails += `<div class="mt-2 pl-4 border-l-2 border-gray-200">`;
                townshipDetails += `<h4 class="font-semibold text-gray-700">${townFeature.properties.town || '未知鄉鎮'}</h4>`; 
                townshipDetails += `<p class="text-sm" style="color:${townDisplayDateStatusColor};">
                    ${formatDisplayDate(displayDate)}：${townDisplayDateStatus.text}
                </p>`;
                
                townshipDetails += `<p class="text-sm" style="color:${townNextDayStatusColor};">
                    ${formatDisplayDate(nextDay)}：${townNextDayStatus.text}
                </p>`;
                townshipDetails += `</div>`;
            });
            panelContent += townshipDetails;
        } else {
            // If county has partial status but no specific townships are listed in the feed
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            panelContent += `<p class="text-sm text-gray-600 mt-2">此縣市有部分區域停班課，但無更詳細的鄉鎮資訊已公布。</p>`;
        }
    }
    infoPanel.innerHTML = panelContent;
}

// 使用 GeoJSON 資料和停班停課資訊渲染地圖
async function renderMap() {
    mapLoader.style.display = 'flex'; // 顯示載入中旋轉圖示
    showErrorBtn.classList.add('hidden'); // 初始隱藏錯誤按鈕
    lastErrorMessage = ''; // 清除之前的錯誤訊息
    
    try {
        // 首先載入停班停課資料
        await loadSuspensionData(); 
        
        // 載入縣市層級 GeoJSON 資料
        const countyResponse = await fetch(`${proxyURL}${encodeURIComponent(countyGeojsonURL)}`);
        if (!countyResponse.ok) throw new Error(`County GeoJSON fetch failed: ${countyResponse.status} - ${countyResponse.statusText}`);
        const countyData = await countyResponse.json();

        // 載入鄉鎮層級 GeoJSON 資料 (不立即添加到地圖)
        const townResponse = await fetch(`${proxyURL}${encodeURIComponent(townGeojsonURL)}`);
        if (!townResponse.ok) throw new Error(`Town GeoJSON fetch failed: ${response.status} - ${response.statusText}`);
        const townData = await townResponse.json(); // 暫時用 townData 變數接收
        townGeojson = townData; // 儲存到全域變數

        // 確保地圖已準備就緒，然後再添加圖層和設定視圖
        map.whenReady(function() {
            console.log("Leaflet map is ready."); // Added console log
            // 建立 Leaflet 縣市層 GeoJSON 圖層
            countyGeojsonLayer = L.geoJSON(countyData, {
                style: feature => {
                    const countyName = normalizeName(feature.properties.COUNTYNAME);
                    const info = suspensionData[countyName];
                    const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
                    const todayActualDateStr = formatDateToYYYYMMDD(new Date()); // 實際的今天日期字串

                    let statusToDisplay = 'no_info'; // 預設為灰色 (針對非今天)
                    if (info && info.dates[displayDateStr]) {
                        statusToDisplay = info.dates[displayDateStr].status;
                    } else if (displayDateStr === todayActualDateStr) {
                        // 如果是今天的日期，且沒有明確資訊，則預設為正常
                        statusToDisplay = 'normal';
                    }
                    return getStyle(statusToDisplay);
                },
                onEachFeature: (feature, layer) => {
                    const countyName = normalizeName(feature.properties.COUNTYNAME); // 標準化縣市名稱
                    const displayName = feature.properties.COUNTYNAME; // 原始顯示名稱
                    layer.bindTooltip(displayName, { permanent: false, direction: 'center' }); // 滑鼠懸停時顯示提示

                    layer.on({
                        mouseover: e => {
                            const hoveredLayer = e.target;
                            hoveredLayer.setStyle(highlightStyle); // 滑鼠懸停時高亮顯示
                            if (!L.Browser.ie) hoveredLayer.bringToFront(); // 移到最上層以獲得更好的可見性
                            
                            // Mouseover also updates the info panel based on currentDisplayDate
                            updateInfoPanel(countyName, displayName, currentDisplayDate);
                        },
                        mouseout: e => {
                            countyGeojsonLayer.resetStyle(e.target); // 滑鼠移開時重置樣式
                            // Reset info panel to default if no county is actively selected
                            const currentCountyNameInPanel = infoPanel.dataset.countyName;
                            if (!currentCountyNameInPanel || currentCountyNameInPanel !== countyName) {
                                infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
                            }
                        },
                        click: e => {
                            // 修正：在 fitBounds 前檢查邊界有效性
                            const clickedBounds = e.target.getBounds();
                            const isClickedBoundsValid = clickedBounds.isValid() && 
                                                         !isNaN(clickedBounds.getNorth()) && !isNaN(clickedBounds.getEast()) &&
                                                         !isNaN(clickedBounds.getSouth()) && !isNaN(clickedBounds.getWest());
                            if (isClickedBoundsValid) {
                                map.fitBounds(clickedBounds, { padding: [20, 20] }); // 縮放至點擊的縣市
                            } else {
                                console.warn("點擊的縣市 GeoJSON 邊界無效，無法縮放。");
                            }

                            updateInfoPanel(countyName, displayName, currentDisplayDate); // 點擊時更新資訊面板
                            
                            // Render townships for the clicked county
                            renderTownshipsForCounty(countyName, currentDisplayDate);

                            const countyInfo = suspensionData[countyName];
                            let popupContent = `<strong class="text-base">${displayName}</strong><br>`;

                            const displayDateStrForPopup = formatDateToYYYYMMDD(currentDisplayDate);
                            const nextDayForPopup = new Date(currentDisplayDate);
                            nextDayForPopup.setDate(nextDayForPopup.getDate() + 1);
                            nextDayForPopup.setHours(0,0,0,0); // Normalize to start of day
                            const nextDayStrForPopup = formatDateToYYYYMMDD(nextDayForPopup);

                            let countyDisplayDateStatus = countyInfo && countyInfo.dates[displayDateStrForPopup] ? countyInfo.dates[displayDateStrForPopup] : null;
                            const todayActualDateStrForPopup = formatDateToYYYYMMDD(new Date());
                            if (!countyDisplayDateStatus && displayDateStrForPopup === todayActualDateStrForPopup) {
                                countyDisplayDateStatus = { status: 'normal', text: '照常上班、照常上課' };
                            } else if (!countyDisplayDateStatus) {
                                countyDisplayDateStatus = { status: 'no_info', text: '尚未發布資訊' };
                            }

                            let countyNextDayStatus = countyInfo && countyInfo.dates[nextDayStrForPopup] ? countyInfo.dates[nextDayStrForPopup] : null;
                            if (!countyNextDayStatus) {
                                countyNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
                            }

                            // Display for currentDisplayDate
                            popupContent += `<span style="color:${getStyle(countyDisplayDateStatus.status).fillColor};">
                                ${formatDisplayDate(currentDisplayDate)}：${countyDisplayDateStatus.text}
                            </span><br>`;
                            
                            // Display for next day relative to currentDisplayDate
                            popupContent += `<span style="color:${getStyle(countyNextDayStatus.status).fillColor};">
                                ${formatDisplayDate(nextDayForPopup)}：${countyNextDayStatus.text}
                            </span>`;

                            // 在點擊彈出視窗中也顯示受影響鄉鎮資訊
                            if (countyInfo && countyInfo.hasTownshipSpecificData && townGeojson) {
                                const filteredTownFeatures = townGeojson.features.filter(f => normalizeName(f.properties.county) === normalizeName(countyName));
                                const affectedTownshipsInCounty = filteredTownFeatures.filter(townFeature => {
                                    const townKey = normalizeName(townFeature.properties.county + townFeature.properties.town);
                                    const townInfo = suspensionData[townKey];
                                    return townInfo && (
                                        (townInfo.dates[displayDateStrForPopup] && townInfo.dates[displayDateStrForPopup].status !== 'normal') ||
                                        (townInfo.dates[nextDayStrForPopup] && townInfo.dates[nextDayStrForPopup].status !== 'normal')
                                    );
                                });

                                if (affectedTownshipsInCounty.length > 0) {
                                    popupContent += `<br><strong class="text-base">受影響鄉鎮:</strong>`;
                                    affectedTownshipsInCounty.forEach(townFeature => { 
                                        const townKey = normalizeName(townFeature.properties.county + townFeature.properties.town);
                                        const info = suspensionData[townKey];
                                        
                                        let townDisplayDateStatus = info.dates[displayDateStrForPopup] || null;
                                        if (!townDisplayDateStatus && displayDateStrForPopup === todayActualDateStrForPopup) {
                                            townDisplayDateStatus = { status: 'normal', text: `照常上班、照常上課` };
                                        } else if (!townDisplayDateStatus) {
                                            townDisplayDateStatus = { status: 'no_info', text: `尚未發布資訊` };
                                        }

                                        let townNextDayStatus = info.dates[nextDayStrForPopup] || null;
                                        if (!townNextDayStatus) {
                                            townNextDayStatus = { status: 'no_info', text: `尚未發布資訊` };
                                        }

                                        const townDisplayDateStatusColor = getStyle(townDisplayDateStatus.status).fillColor;
                                        const townNextDayStatusColor = getStyle(townNextDayStatus.status).fillColor;
                                        
                                        popupContent += `<br><span class="ml-2 font-semibold">${townFeature.properties.town || '未知鄉鎮'}:</span>`; 
                                        popupContent += `<br><span class="ml-4 text-sm" style="color:${townDisplayDateStatusColor};">
                                            ${formatDisplayDate(currentDisplayDate)}：${townDisplayDateStatus.text}
                                        </span>`;
                                        
                                        popupContent += `<br><span class="ml-4 text-sm" style="color:${townNextDayStatusColor};">
                                            ${formatDisplayDate(nextDayForPopup)}：${townNextDayStatus.text}
                                        </span>`;
                                    });
                                } else {
                                    popupContent += `<br><strong class="text-base">受影響鄉鎮:</strong>`;
                                    popupContent += `<br><span class="text-sm text-gray-600">此縣市有部分區域停班課，但無更詳細的鄉鎮資訊已公布。</span>`;
                                }
                            }

                            L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map); // 顯示彈出視窗
                        }
                    });
                }
            }).addTo(map); // 先將縣市圖層添加到地圖

            // 將地圖視野調整到縣市 GeoJSON 圖層的邊界
            // 修正：確保 countyGeojsonLayer 存在且包含有效的圖層，其邊界才有效
            const bounds = countyGeojsonLayer.getBounds();
            const isValidBounds = bounds.isValid() && 
                                  !isNaN(bounds.getNorth()) && !isNaN(bounds.getEast()) &&
                                  !isNaN(bounds.getSouth()) && !isNaN(bounds.getWest());

            if (countyGeojsonLayer && countyGeojsonLayer.getLayers().length > 0 && isValidBounds) {
                map.fitBounds(bounds, { padding: [20, 20] });
            } else {
                // 如果沒有有效的 GeoJSON 資料或邊界無效，則設置一個預設視圖
                map.setView([23.9, 121], 7); // 台灣中心點
                console.warn("未載入有效的縣市 GeoJSON 資料或地圖邊界無效，地圖將顯示預設視圖。");
            }

            // 將鄉鎮圖層群組添加到地圖，確保它在縣市圖層之上
            affectedTownshipLayers.addTo(map);

            mapLoader.style.display = 'none'; // 隱藏載入中旋轉圖示

            // 在地圖初始化後獲取 Leaflet 縮放控制按鈕的引用
            zoomControlEl = document.querySelector('.leaflet-control-zoom');

            // Explicitly invalidate size after loader is hidden
            requestAnimationFrame(() => { // Wrapped in requestAnimationFrame
                console.log(`Invalidating size after loader hide. Map container dimensions: ${map._container?.offsetWidth}x${map._container?.offsetHeight}`);
                if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
                    map.invalidateSize(true); 
                } else {
                    console.warn("地圖容器尺寸無效，無法在載入後重新計算地圖尺寸。");
                }
            });

            // 初始顯示地圖和資訊
            refreshMapDisplay();

            // 載入並渲染天氣快報
            loadWeatherBulletins(); // 不需要 await，因為不阻擋地圖渲染
        }); // 關閉 map.whenReady()
    } catch (error) {
        console.error("無法渲染地圖或載入資料:", error);
        lastErrorMessage = error.message; // 儲存錯誤訊息
        mapLoader.innerHTML = `
            <div class="text-center p-4">
                <p class="text-red-600 font-bold text-lg">地圖渲染失敗</p>
                <p class="text-gray-700 mt-2">發生未知錯誤，請重新整理頁面。</p>
                <button id="show-error-btn" class="mt-4 px-4 py-2 bg-red-500 text-white rounded-md shadow-md hover:bg-red-600 transition-colors duration-200">
                    顯示錯誤詳情
                </button>
            </div>
        `;
        // 如果按鈕被重新渲染，則重新綁定事件監聽器
        document.getElementById('show-error-btn').addEventListener('click', showErrorMessage);
    }
}

// 渲染離島資訊的函式
function renderOutlyingIslandsInfo(displayDate) {
    let content = '';
    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDay = new Date(displayDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0,0,0,0); // Normalize to start of day
    const nextDayStr = formatDateToYYYYMMDD(nextDay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date()); // 實際的今天日期字串

    outlyingIslands.forEach(island => {
        const islandInfo = suspensionData[normalizeName(island)];
        
        let islandDisplayDateStatus = islandInfo && islandInfo.dates[displayDateStr] ? islandInfo.dates[displayDateStr] : null;
        if (!islandDisplayDateStatus && displayDateStr === todayActualDateStr) {
            islandDisplayDateStatus = { status: 'normal', text: '照常上班、照常上課' };
        } else if (!islandDisplayDateStatus) {
            islandDisplayDateStatus = { status: 'no_info', text: '尚未發布資訊' };
        }

        let islandNextDayStatus = islandInfo && islandInfo.dates[nextDayStr] ? islandInfo.dates[nextDayStr] : null;
        if (!islandNextDayStatus) {
            islandNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
        }

        const displayDateStatusColor = getStyle(islandDisplayDateStatus.status).fillColor;
        const nextDayStatusColor = getStyle(islandNextDayStatus.status).fillColor;

        content += `
            <div class="mb-2">
                <h4 class="font-semibold text-gray-800">${island}</h4>
                <p class="text-sm" style="color:${displayDateStatusColor};">${formatDisplayDate(displayDate)}：${islandDisplayDateStatus.text}</p>
        `;
        content += `<p class="text-sm" style="color:${nextDayStatusColor};">${formatDisplayDate(nextDay)}：${islandNextDayStatus.text}</p>`;
        content += `</div>`;
    });
    if (content === '') {
        outlyingIslandsInfoEl.innerHTML = `<p class="text-gray-600">目前無離島停班停課資訊。</p>`;
    } else {
        outlyingIslandsInfoEl.innerHTML = content;
    }
}

// 新增載入天氣快報資料的函式
async function loadWeatherBulletins() {
    try {
        // 注意：corsproxy.io 的使用方式是將目標 URL 放在代理 URL 後面
        const response = await fetch(`${proxyURL}${encodeURIComponent(cwaWarningRSSURL)}`);
        if (!response.ok) throw new Error(`CWA Warning RSS fetch failed: ${response.status}`);
        
        const xmlString = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");

        const items = xmlDoc.querySelectorAll('item');
        let content = '';
        if (items.length === 0) {
            content = `<p class="text-gray-600">目前無天氣快報。</p>`;
        } else {
            items.forEach(item => {
                const title = item.querySelector('title')?.textContent || '無標題';
                const link = item.querySelector('link')?.textContent || '#';
                const pubDate = item.querySelector('pubDate')?.textContent;
                let formattedDate = '';
                if (pubDate) {
                    try {
                        // 將日期時間轉換為本地格式
                        formattedDate = new Date(pubDate).toLocaleString('zh-TW');
                    } catch (e) {
                        formattedDate = pubDate; // 如果解析失敗，則使用原始日期
                    }
                }

                content += `
                    <div class="mb-2 pb-2 border-b border-gray-100 last:border-b-0">
                        <a href="${link}" target="_blank" class="text-blue-600 hover:underline font-semibold">${title}</a>
                        ${formattedDate ? `<p class="text-xs text-gray-500 mt-1">${formattedDate}</p>` : ''}
                    </div>
                `;
            });
        }
        weatherBulletinInfoEl.innerHTML = content;

    } catch (error) {
        console.error("無法載入天氣快報資料:", error);
        weatherBulletinInfoEl.innerHTML = `<p class="text-red-600">天氣快報載入失敗。</p>`;
    }
}

// 顯示錯誤訊息彈出視窗的函式
function showErrorMessage() {
    errorMessageEl.textContent = lastErrorMessage;
    errorDetailModal.style.display = 'flex'; // 顯示彈出視窗
}

// 「顯示錯誤詳情」按鈕的事件監聽器（初始綁定）
// 如果載入器內容被替換，此監聽器將在 catch 區塊中重新綁定
showErrorBtn.addEventListener('click', showErrorMessage);

// 彈出視窗關閉按鈕的事件監聽器
errorDetailCloseBtn.addEventListener('click', () => {
    errorDetailModal.style.display = 'none'; // 隱藏彈出視窗
});

// 如果使用者點擊彈出視窗外部，則隱藏彈出視窗
window.addEventListener('click', (event) => {
    if (event.target == errorDetailModal) {
        errorDetailModal.style.display = 'none';
    }
});

// --- 側邊欄開關邏輯 ---
function toggleSidebar() {
    const isOpen = sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('open');
    document.body.style.overflow = isOpen ? 'hidden' : 'auto';

    // 隱藏/顯示 Leaflet 縮放控制按鈕
    if (zoomControlEl) {
        zoomControlEl.style.display = isOpen ? 'none' : 'block';
    }

    // 強制 Leaflet 地圖重新計算尺寸，確保版面正確
    // 延遲 300ms 配合 CSS 側邊欄過渡動畫
    setTimeout(() => {
        console.log(`Invalidating size after sidebar toggle. Map container dimensions: ${map._container?.offsetWidth}x${map._container?.offsetHeight}`); // Added console log
        // Add a check for map container dimensions before invalidating size
        if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
            map.invalidateSize(true); // Force immediate recalculation
        } else {
            console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
        }
    }, 300); 
}

// 漢堡選單按鈕事件監聽器
sidebarToggleBtn.addEventListener('click', toggleSidebar);

// 遮罩層點擊事件監聽器 (點擊遮罩關閉側邊欄)
sidebarOverlay.addEventListener('click', toggleSidebar);

// 處理視窗大小改變事件，確保桌面版側邊欄始終顯示
window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) { // md breakpoint
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
        document.body.style.overflow = 'auto'; // 確保桌面版可以滾動
        // 確保桌面版縮放按鈕顯示
        if (zoomControlEl) {
            zoomControlEl.style.display = 'block';
        }
        // 桌面版尺寸變化時也重新計算地圖尺寸
        console.log(`Invalidating size after resize. Map container dimensions: ${map._container?.offsetWidth}x${map._container?.offsetHeight}`); // Added console log
        // Add a check for map container dimensions before invalidating size
        if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
            map.invalidateSize(true); // Force immediate recalculation
        } else {
            console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
        }
    }
});

// 新增地圖縮放事件監聽器，確保縮放後地圖尺寸正確
map.on('zoomend', () => {
    console.log(`Invalidating size after zoomend. Map container dimensions: ${map._container?.offsetWidth}x${map._container?.offsetHeight}`); // Added console log
    // Add a check for map container dimensions before invalidating size
    if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
        map.invalidateSize(true); // Force immediate recalculation
    } else {
        console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
    }
});

// --- 5. 初始執行 ---
renderMap();

// 日期切換按鈕事件監聽器
viewTodayBtn.addEventListener('click', () => {
    currentDisplayDate = new Date(); // 重設為今天的日期
    currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day
    refreshMapDisplay();
});

viewTomorrowBtn.addEventListener('click', () => {
    currentDisplayDate = new Date(); // 先設為今天的日期
    currentDisplayDate.setDate(currentDisplayDate.getDate() + 1); // 再加一天，變成明天的日期
    currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day
    refreshMapDisplay();
});
