// script.js
// 整合所有地圖應用程式的 JavaScript 邏輯

// --- 0. 全域常數定義 (移至最頂端) ---
// CORS 代理服務
const proxyURL = 'https://corsproxy.io/?'; 
// 縣市層級 GeoJSON
const countyGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/raw/refs/heads/main/twmap.json'; 
// 鄉鎮層級 GeoJSON
const townGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/releases/download/NEW_JSON/TW_town.json'; 
// 停班課 JSON Feed URL (修正為 JSON 格式的資料來源)
const jsonFeedURL = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx?AlertType=33';
// 中央氣象局天氣快報 RSS URL
const cwaWarningRSSURL = 'https://www.cwa.gov.tw/rss/Data/cwa_warning.xml'; 

// --- 1. 初始化地圖 ---
const map = L.map('map', {
    zoomControl: true 
}).setView([23.9, 121], 7);

// --- 2. 全域變數與 DOM 元素 ---
let countyGeojsonLayer; // 縣市層 GeoJSON 圖層 (主要用於獲取縣市名稱和邊界，不再用於繪製主要地圖)
let townGeojson = null; // 鄉鎮層 GeoJSON 原始資料 (用於查找鄉鎮邊界)
let affectedTownshipLayers = L.layerGroup(); // 用於存放所有鄉鎮圖層

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

const sidebar = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
let zoomControlEl; // Leaflet 縮放控制按鈕的變數

const suspensionData = {}; // 儲存停班停課資訊，鍵可以是縣市名或縣市鄉鎮名
// 定義需要特別顯示的離島名稱，用於從 RSS 資料中篩選 (這些通常是鄉鎮層級)
const outlyingIslands = ['澎湖縣', '金門縣', '連江縣', '臺東縣蘭嶼鄉', '臺東縣綠島鄉'];

// 日期切換按鈕相關 DOM 元素
const viewTodayBtn = document.getElementById('view-today-btn');
const viewTomorrowBtn = document.getElementById('view-tomorrow-btn');
// 全域變數，表示目前地圖顯示的是哪一天的資料
let currentDisplayDate = new Date(); 
currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day

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

// --- 4. 通用工具函數 ---
function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
}

function parseDateFromText(text, referenceDate) {
    const year = referenceDate.getFullYear();
    const mdMatch = text.match(/(\d{1,2})\/(\d{1,2})/);
    if (mdMatch) {
        const month = parseInt(mdMatch[1], 10);
        const day = parseInt(mdMatch[2], 10);
        const parsedDate = new Date(year, month - 1, day);
        parsedDate.setHours(0, 0, 0, 0);
        if (parsedDate.getMonth() === month - 1 && parsedDate.getDate() === day) {
            return parsedDate;
        }
    }
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
    return null;
}

function normalizeName(name) { 
    return name.replace('臺', '台').replace(/\(.*?\)/g, '').trim(); 
}

const determineStatus = (stmt) => {
    const isSuspendedKeyword = stmt.includes('停止上班') || stmt.includes('停止上課') || stmt.includes('已達停止上班及上課標準');
    const isPartialTimeSuspension = stmt.includes('下午') || stmt.includes('晚上') || stmt.includes('中午') || stmt.includes('早上');
    const isSpecificAreaKeywords = stmt.includes('部分區域') || stmt.includes('特定人員') || stmt.includes('學校') || stmt.includes('鄰里');

    if (isSuspendedKeyword) {
        if (isSpecificAreaKeywords) {
            return 'partial';
        } else if (isPartialTimeSuspension) {
            return 'partial_time';
        } else {
            return 'suspended';
        }
    }
    return 'normal';
};

const statusPriority = ['normal', 'partial', 'partial_time', 'suspended'];

// --- 5. 資料抓取與處理 ---
async function loadSuspensionData() {
    try {
        // 修正：從 jsonFeedURL 獲取 JSON 資料
        const response = await fetch(`${proxyURL}${encodeURIComponent(jsonFeedURL)}`);
        if (!response.ok) throw new Error(`JSON Feed fetch failed: ${response.status}`);
        
        const jsonData = await response.json();

        if (!jsonData || !Array.isArray(jsonData.entry)) {
            throw new Error("Invalid JSON structure: missing 'entry' array.");
        }

        const entries = jsonData.entry;

        const updatedTime = jsonData.updated;
        if (updatedTime) {
            updateTimeEl.textContent = `資料更新時間：${new Date(updatedTime).toLocaleString('zh-TW')}`;
        } else {
            updateTimeEl.textContent = `資料更新時間：無法取得`;
        }

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

            if (!rawSuspensionData[targetKey]) {
                rawSuspensionData[targetKey] = {
                    dates: {},
                    isTownship: isTownshipSpecific,
                    parentCounty: parentCountyName 
                };
            }

            const entryUpdatedDate = new Date(entry.updated);
            entryUpdatedDate.setHours(0,0,0,0);

            let targetAnnouncementDate = null;

            if (statusText.includes('今天')) {
                targetAnnouncementDate = entryUpdatedDate;
            } else if (statusText.includes('明天')) {
                targetAnnouncementDate = new Date(entryUpdatedDate);
                targetAnnouncementDate.setDate(targetAnnouncementDate.getDate() + 1);
                targetAnnouncementDate.setHours(0,0,0,0);
            } else {
                const parsedDate = parseDateFromText(statusText, entryUpdatedDate);
                if (parsedDate) {
                    targetAnnouncementDate = parsedDate;
                }
            }

            if (!targetAnnouncementDate) {
                targetAnnouncementDate = entryUpdatedDate;
            }

            const targetAnnouncementDateStr = formatDateToYYYYMMDD(targetAnnouncementDate);

            if (!rawSuspensionData[targetKey].dates[targetAnnouncementDateStr]) {
                rawSuspensionData[targetKey].dates[targetAnnouncementDateStr] = [];
            }

            rawSuspensionData[targetKey].dates[targetAnnouncementDateStr].push({
                updated: new Date(entry.updated),
                statusText: statusText,
                isTownship: isTownshipSpecific,
                parentCounty: parentCountyName
            });
        });

        // Process rawSuspensionData to determine final statuses for each location and date
        for (const locationKey in rawSuspensionData) {
            suspensionData[locationKey] = {
                dates: {},
                isTownship: rawSuspensionData[locationKey].isTownship,
                parentCounty: rawSuspensionData[locationKey].parentCounty,
                hasTownshipSpecificData: false // Will be updated later for parent counties
            };

            for (const dateStr in rawSuspensionData[locationKey].dates) {
                const entriesForDate = rawSuspensionData[locationKey].dates[dateStr];
                entriesForDate.sort((a, b) => b.updated.getTime() - a.updated.getTime()); // Newest first

                let finalStatusForDate = { status: 'normal', text: `照常上班、照常上課`, updated: new Date(0) };
                let foundRelevantAnnouncement = false;

                for (const entry of entriesForDate) {
                    const stmt = entry.statusText;

                    if (stmt) {
                        const currentStatus = determineStatus(stmt);
                        if (statusPriority.indexOf(currentStatus) > statusPriority.indexOf(finalStatusForDate.status)) {
                            finalStatusForDate = { status: currentStatus, text: stmt, updated: entry.updated };
                            foundRelevantAnnouncement = true;
                        } else if (statusPriority.indexOf(currentStatus) === statusPriority.indexOf(finalStatusForDate.status) && entry.updated > (finalStatusForDate.updated || 0)) {
                            finalStatusForDate = { status: currentStatus, text: stmt, updated: entry.updated };
                            foundRelevantAnnouncement = true;
                        }
                    }
                }
                
                if (!foundRelevantAnnouncement) {
                    finalStatusForDate = { status: 'normal', text: `照常上班、照常上課` };
                }

                suspensionData[locationKey].dates[dateStr] = finalStatusForDate;
            }
        }

        // Calculate aggregated status for each county based on its townships
        const uniqueCounties = new Set();
        // First, collect all unique parent counties from the processed suspensionData
        for (const key in suspensionData) {
            if (suspensionData[key].parentCounty) {
                uniqueCounties.add(suspensionData[key].parentCounty);
            }
        }
        // Also add any counties that might not have townships in the feed but exist in GeoJSON
        // This requires countyGeojsonLayer to be loaded, which happens later in renderMap.
        // So, we'll iterate through all dates found in the data to ensure aggregated status for all relevant dates.
        const allDatesInSuspensionData = new Set();
        for (const key in suspensionData) {
            for (const dateStr in suspensionData[key].dates) {
                allDatesInSuspensionData.add(dateStr);
            }
        }

        uniqueCounties.forEach(countyName => {
            // Ensure county entry exists in suspensionData for aggregated status
            if (!suspensionData[countyName]) {
                suspensionData[countyName] = {
                    dates: {}, // This will store the aggregated status for the county
                    isTownship: false,
                    parentCounty: countyName,
                    hasTownshipSpecificData: false // Will be set if any township has non-normal status
                };
            }

            allDatesInSuspensionData.forEach(dateStr => {
                const townshipsOfThisCounty = Object.keys(suspensionData).filter(key => 
                    suspensionData[key].isTownship && normalizeName(suspensionData[key].parentCounty) === countyName
                );

                let allTownshipsNormal = true;
                let allTownshipsSuspended = true; // All townships are suspended or partial_time/partial
                let hasPartialTownship = false;
                let hasPartialTimeTownship = false;
                let hasAnyNonNormalTownship = false; // If any township is not 'normal'

                // Check townships' statuses
                if (townshipsOfThisCounty.length > 0) {
                    for (const townKey of townshipsOfThisCounty) {
                        const township = suspensionData[townKey];
                        const status = township.dates[dateStr] ? township.dates[dateStr].status : 'normal'; // Default to normal if no specific info for township

                        if (status !== 'normal') {
                            allTownshipsNormal = false;
                            hasAnyNonNormalTownship = true;
                        }
                        if (status !== 'suspended') { // If any is not 'suspended', then not all suspended
                            allTownshipsSuspended = false;
                        }
                        if (status === 'partial') {
                            hasPartialTownship = true;
                            allTownshipsSuspended = false; // Cannot be all suspended if there's a partial
                        }
                        if (status === 'partial_time') {
                            hasPartialTimeTownship = true;
                            allTownshipsSuspended = false; // Cannot be all suspended if there's a partial_time
                        }
                    }
                } else { // If a county has no townships in data (e.g., small islands not in townGeojson)
                    allTownshipsNormal = true;
                    allTownshipsSuspended = false; // Cannot be all suspended if no townships
                }

                // Determine final aggregated status for the county for this date
                let aggregatedStatus = 'normal';
                let aggregatedText = `${countyName}照常上班、照常上課`;

                const countyDirectInfo = suspensionData[countyName].dates[dateStr];
                const countyDirectStatus = countyDirectInfo ? countyDirectInfo.status : 'normal';

                // Priority: Direct county announcement > Aggregated township status
                if (countyDirectStatus === 'suspended') {
                    aggregatedStatus = 'suspended';
                    aggregatedText = countyDirectInfo.text;
                } else if (countyDirectStatus === 'partial_time') {
                    aggregatedStatus = 'partial_time';
                    aggregatedText = countyDirectInfo.text;
                } else if (countyDirectStatus === 'partial') {
                    aggregatedStatus = 'partial';
                    aggregatedText = countyDirectInfo.text;
                } else if (townshipsOfThisCounty.length > 0) { // If county has no direct announcement, rely on townships
                    if (allTownshipsSuspended) { // All townships are suspended
                        aggregatedStatus = 'suspended';
                        aggregatedText = `${countyName}全縣市停止上班上課`;
                    } else if (allTownshipsNormal) { // All townships are normal
                        aggregatedStatus = 'normal';
                        aggregatedText = `${countyName}照常上班、照常上課`;
                    } else if (hasAnyNonNormalTownship) { // Mix of statuses, or some partial/partial_time
                        aggregatedStatus = 'partial'; 
                        aggregatedText = `${countyName}部分區域停止上班上課`;
                    }
                }
                // If no direct county info and no townships, it remains 'normal' (default)

                // Store aggregated status and text in the county's entry
                if (!suspensionData[countyName].dates[dateStr]) {
                    suspensionData[countyName].dates[dateStr] = {};
                }
                suspensionData[countyName].dates[dateStr].status = aggregatedStatus;
                suspensionData[countyName].dates[dateStr].text = aggregatedText;
                suspensionData[countyName].dates[dateStr].updated = new Date(); // Use current time or max updated time from townships

                // Set hasTownshipSpecificData for the county if any township is non-normal or county itself is partial
                if (hasAnyNonNormalTownship || countyDirectStatus === 'partial') {
                    suspensionData[countyName].hasTownshipSpecificData = true;
                }
            });
        });

    } catch (error) {
        console.error("無法載入停班停課資料:", error);
        updateTimeEl.textContent = '停班課資料載入失敗，將顯示預設地圖狀態。';
        updateTimeEl.classList.add('text-red-600');
        throw error;
    }
}

async function loadWeatherBulletins() {
    try {
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
                        formattedDate = new Date(pubDate).toLocaleString('zh-TW');
                    } catch (e) {
                        formattedDate = pubDate;
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

// --- 6. 地圖渲染與互動 ---
// 這個函數現在負責繪製所有鄉鎮，並根據其精確狀態或聚合縣市狀態著色
async function renderAllTownships() {
    affectedTownshipLayers.clearLayers(); // 清空之前的圖層

    if (!townGeojson) {
        console.warn("鄉鎮 GeoJSON 資料尚未載入，無法渲染鄉鎮圖層。");
        return;
    }

    // 重新繪製所有鄉鎮圖層
    L.geoJSON(townGeojson, {
        style: feature => {
            // 安全檢查：確保 feature.properties 存在
            if (!feature.properties) {
                console.warn("GeoJSON feature missing properties:", feature);
                return getStyle('no_info'); // 返回預設樣式
            }

            const townKey = normalizeName(feature.properties.county + feature.properties.town);
            const countyName = normalizeName(feature.properties.county);
            const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
            const todayActualDateStr = formatDateToYYYYMMDD(new Date());

            let statusToDisplay = 'no_info'; // 預設為灰色

            let townInfo = suspensionData[townKey];
            let countyAggregatedInfo = suspensionData[countyName];

            // 1. 優先使用鄉鎮自己的精確狀態
            if (townInfo && townInfo.dates[displayDateStr]) {
                statusToDisplay = townInfo.dates[displayDateStr].status;
            } 
            // 2. 如果鄉鎮沒有精確狀態，則檢查縣市的聚合狀態
            else if (countyAggregatedInfo && countyAggregatedInfo.dates[displayDateStr]) {
                const aggregatedCountyStatus = countyAggregatedInfo.dates[displayDateStr].status;
                
                // 如果縣市的聚合狀態是「全天停止」或「正常」，則所有沒有明確公告的鄉鎮都繼承這個狀態
                if (aggregatedCountyStatus === 'suspended' || aggregatedCountyStatus === 'normal') {
                    statusToDisplay = aggregatedCountyStatus;
                } 
                // 如果縣市的聚合狀態是「部分區域」或「非全天」，則沒有明確公告的鄉鎮預設為「正常」或「沒有公布資訊」
                // 這樣可以避免將整個縣市都標示為「部分」
                else if (aggregatedCountyStatus === 'partial' || aggregatedCountyStatus === 'partial_time') {
                    if (displayDateStr === todayActualDateStr) {
                        statusToDisplay = 'normal'; // 如果是今天且無明確資訊，則預設正常
                    } else {
                        statusToDisplay = 'no_info'; // 其他日期則顯示為沒有資訊
                    }
                }
            }
            // 3. 如果沒有任何資訊，且是今天，則預設正常
            else if (displayDateStr === todayActualDateStr) {
                statusToDisplay = 'normal';
            }
            
            return getStyle(statusToDisplay);
        },
        onEachFeature: (feature, layer) => {
            // 安全檢查：確保 feature.properties 存在
            if (!feature.properties) {
                console.warn("GeoJSON feature missing properties during onEachFeature:", feature);
                return; 
            }

            const townKey = normalizeName(feature.properties.county + feature.properties.town);
            const countyName = normalizeName(feature.properties.county);
            const townDisplayName = feature.properties.county + feature.properties.town;
            const countyDisplayName = feature.properties.county;

            layer.bindTooltip(townDisplayName, { permanent: false, direction: 'center' });

            layer.on({
                mouseover: e => {
                    const hoveredLayer = e.target;
                    hoveredLayer.setStyle(highlightStyle);
                    if (!L.Browser.ie) hoveredLayer.bringToFront();
                    updateInfoPanel(countyName, countyDisplayName, currentDisplayDate); // 更新資訊面板顯示縣市資訊
                },
                mouseout: e => {
                    // 重置特定鄉鎮圖層的樣式
                    const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
                    const todayActualDateStr = formatDateToYYYYMMDD(new Date());
                    
                    let statusToDisplay = 'no_info';
                    let townInfo = suspensionData[townKey];
                    let countyAggregatedInfo = suspensionData[countyName];

                    if (townInfo && townInfo.dates[displayDateStr]) {
                        statusToDisplay = townInfo.dates[displayDateStr].status;
                    } else if (countyAggregatedInfo && countyAggregatedInfo.dates[displayDateStr]) {
                        const aggregatedCountyStatus = countyAggregatedInfo.dates[displayDateStr].status;
                        if (aggregatedCountyStatus === 'suspended' || aggregatedCountyStatus === 'normal') {
                            statusToDisplay = aggregatedCountyStatus;
                        } else if (aggregatedCountyStatus === 'partial' || aggregatedCountyStatus === 'partial_time') {
                            if (displayDateStr === todayActualDateStr) {
                                statusToDisplay = 'normal';
                            } else {
                                statusToDisplay = 'no_info';
                            }
                        }
                    } else if (displayDateStr === todayActualDateStr) {
                        statusToDisplay = 'normal';
                    }
                    layer.setStyle(getStyle(statusToDisplay)); // 直接重設樣式
                    
                    infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
                },
                click: e => {
                    map.fitBounds(e.target.getBounds(), { padding: [20, 20] });
                    updateInfoPanel(countyName, countyDisplayName, currentDisplayDate); // 更新資訊面板顯示縣市資訊

                    // 顯示彈出視窗，優先顯示鄉鎮資訊，如果沒有則根據縣市聚合狀態或預設值顯示
                    let popupContent = `<strong class="text-base">${townDisplayName}</strong><br>`;

                    const displayDateStrForPopup = formatDateToYYYYMMDD(currentDisplayDate);
                    const nextDayForPopup = new Date(currentDisplayDate);
                    nextDayForPopup.setDate(nextDayForPopup.getDate() + 1);
                    nextDayForPopup.setHours(0,0,0,0);
                    const nextDayStrForPopup = formatDateToYYYYMMDD(nextDayForPopup);
                    const todayActualDateStrForPopup = formatDateToYYYYMMDD(new Date());

                    let townDisplayDateStatus = suspensionData[townKey] && suspensionData[townKey].dates[displayDateStrForPopup] ? suspensionData[townKey].dates[displayDateStrForPopup] : null;
                    let townNextDayStatus = suspensionData[townKey] && suspensionData[townKey].dates[nextDayStrForPopup] ? suspensionData[townKey].dates[nextDayStrForPopup] : null;
                    
                    let countyAggregatedInfo = suspensionData[countyName];

                    // Determine today's status for popup
                    if (!townDisplayDateStatus) { // If township has no specific info for today
                        if (countyAggregatedInfo && countyAggregatedInfo.dates[displayDateStrForPopup]) {
                            const aggregatedStatus = countyAggregatedInfo.dates[displayDateStrForPopup].status;
                            if (aggregatedStatus === 'suspended' || aggregatedStatus === 'normal') {
                                townDisplayDateStatus = countyAggregatedInfo.dates[displayDateStrForPopup];
                            } else { // County is partial/partial_time, township defaults to normal/no_info
                                townDisplayDateStatus = { status: 'no_info', text: '尚未發布資訊' };
                                if (displayDateStrForPopup === todayActualDateStrForPopup) {
                                    townDisplayDateStatus = { status: 'normal', text: '照常上班、照常上課' };
                                }
                            }
                        } else {
                            townDisplayDateStatus = { status: 'no_info', text: '尚未發布資訊' };
                            if (displayDateStrForPopup === todayActualDateStrForPopup) {
                                townDisplayDateStatus = { status: 'normal', text: '照常上班、照常上課' };
                            }
                        }
                    }

                    // Determine tomorrow's status for popup
                    if (!townNextDayStatus) { // If township has no specific info for tomorrow
                        if (countyAggregatedInfo && countyAggregatedInfo.dates[nextDayStrForPopup]) {
                            const aggregatedStatus = countyAggregatedInfo.dates[nextDayStrForPopup].status;
                            if (aggregatedStatus === 'suspended' || aggregatedStatus === 'normal') {
                                townNextDayStatus = countyAggregatedInfo.dates[nextDayStrForPopup];
                            } else { // County is partial/partial_time, township defaults to no_info
                                townNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
                            }
                        } else {
                            townNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
                        }
                    }

                    popupContent += `<span style="color:${getStyle(townDisplayDateStatus.status).fillColor};">
                        ${formatDisplayDate(currentDisplayDate)}：${townDisplayDateStatus.text}
                    </span><br>`;
                    
                    popupContent += `<span style="color:${getStyle(townNextDayStatus.status).fillColor};">
                        ${formatDisplayDate(nextDayForPopup)}：${townNextDayStatus.text}
                    </span>`;

                    L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
                }
            });
        }
    }).addTo(affectedTownshipLayers); // 將所有鄉鎮添加到圖層群組
    affectedTownshipLayers.addTo(map); // 將圖層群組添加到地圖

    // 調整地圖視野到所有鄉鎮圖層的邊界
    if (affectedTownshipLayers.getBounds().isValid()) {
        map.fitBounds(affectedTownshipLayers.getBounds(), { padding: [20, 20] });
    } else if (countyGeojsonLayer && countyGeojsonLayer.getBounds().isValid()) { // 如果鄉鎮圖層無效，則回退到縣市圖層邊界
        map.fitBounds(countyGeojsonLayer.getBounds(), { padding: [20, 20] });
    } else {
        map.setView([23.9, 121], 7);
        console.warn("地圖邊界無效，地圖將顯示預設視圖。");
    }
}

async function renderMap() { // 這是地圖渲染的主要入口點
    mapLoader.style.display = 'flex';
    showErrorBtn.classList.add('hidden');
    lastErrorMessage = '';

    try {
        // 先載入縣市 GeoJSON (用於獲取縣市名稱和邊界，不繪製)
        const countyResponse = await fetch(`${proxyURL}${encodeURIComponent(countyGeojsonURL)}`);
        if (!countyResponse.ok) throw new Error(`County GeoJSON fetch failed: ${countyResponse.status} - ${countyResponse.statusText}`);
        countyGeojsonLayer = L.geoJSON(await countyResponse.json());

        // 載入鄉鎮 GeoJSON (用於繪製地圖)
        const townResponse = await fetch(`${proxyURL}${encodeURIComponent(townGeojsonURL)}`);
        if (!townResponse.ok) throw new Error(`Town GeoJSON fetch failed: ${townResponse.status} - ${townResponse.statusText}`);
        townGeojson = await townResponse.json();

        // 載入並處理停班停課資料 (此時會計算縣市聚合狀態)
        await loadSuspensionData(); 
        
        map.whenReady(function() {
            renderAllTownships(); // 渲染所有鄉鎮

            mapLoader.style.display = 'none';

            requestAnimationFrame(() => {
                if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
                    map.invalidateSize(true); 
                } else {
                    console.warn("地圖容器尺寸無效，無法在載入後重新計算地圖尺寸。");
                }
            });

            renderOutlyingIslandsInfo(currentDisplayDate);
            loadWeatherBulletins();
        });
    } catch (error) {
        console.error("無法渲染地圖或載入資料:", error);
        showErrorMessage(`地圖渲染或資料載入失敗：${error.message}`);
        mapLoader.style.display = 'none';
        showErrorBtn.classList.remove('hidden');
    }
}

// --- 7. UI 更新與事件處理 ---
function refreshMapDisplay(displayDate) { // 接收 displayDate 參數
    // 重新評估所有現有鄉鎮圖層的樣式
    affectedTownshipLayers.eachLayer(layer => {
        // 安全檢查：確保 feature.properties 存在
        if (!layer.feature || !layer.feature.properties) {
            console.warn("GeoJSON layer feature missing properties during refreshMapDisplay:", layer);
            return; 
        }

        const feature = layer.feature;
        const townKey = normalizeName(feature.properties.county + feature.properties.town);
        const countyName = normalizeName(feature.properties.county);
        const displayDateStr = formatDateToYYYYMMDD(displayDate);
        const todayActualDateStr = formatDateToYYYYMMDD(new Date());

        let statusToDisplay = 'no_info';
        let townInfo = suspensionData[townKey];
        let countyAggregatedInfo = suspensionData[countyName];

        if (townInfo && townInfo.dates[displayDateStr]) {
            statusToDisplay = townInfo.dates[displayDateStr].status;
        } else if (countyAggregatedInfo && countyAggregatedInfo.dates[displayDateStr]) {
            const aggregatedCountyStatus = countyAggregatedInfo.dates[displayDateStr].status;
            if (aggregatedCountyStatus === 'suspended' || aggregatedCountyStatus === 'normal') {
                statusToDisplay = aggregatedCountyStatus;
            } else if (aggregatedCountyStatus === 'partial' || aggregatedCountyStatus === 'partial_time') {
                if (displayDateStr === todayActualDateStr) {
                    statusToDisplay = 'normal';
                } else {
                    statusToDisplay = 'no_info';
                }
            }
        } else if (displayDateStr === todayActualDateStr) {
            statusToDisplay = 'normal';
        }
        layer.setStyle(getStyle(statusToDisplay));
    });

    // 更新資訊面板 (如果之前有選取縣市，則更新該縣市資訊)
    const currentCountyNameInPanel = infoPanel.dataset.countyName;
    const currentDisplayNameInPanel = infoPanel.dataset.displayName;
    if (currentCountyNameInPanel && currentDisplayNameInPanel) {
        updateInfoPanel(currentCountyNameInPanel, currentDisplayNameInPanel, displayDate); // 傳遞 displayDate
    } else {
        infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
    }

    renderOutlyingIslandsInfo(displayDate); // 傳遞 displayDate

    if (map && map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
        map.invalidateSize(true);
    } else {
        console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
    }
}

function updateInfoPanel(countyName, displayName, displayDate) { // 接收 displayDate 參數
    const countyInfo = suspensionData[countyName];
    let panelContent = `<h3 class="font-bold text-lg text-gray-900">${displayName}</h3>`;

    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDay = new Date(displayDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0,0,0,0);
    const nextDayStr = formatDateToYYYYMMDD(nextDay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

    infoPanel.dataset.countyName = countyName;
    infoPanel.dataset.displayName = displayName;

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

    let countyNextDayStatus = countyInfo && countyInfo.dates[nextDayStr] ? countyInfo.dates[nextDayStr] : null;
    if (!countyNextDayStatus) {
        countyNextDayStatus = { status: 'no_info', text: '尚未發布資訊' };
    }
    const nextDayStatusColor = getStyle(countyNextDayStatus.status).fillColor;
    
    panelContent += `<p class="mt-1 font-semibold" style="color:${nextDayStatusColor};">
        ${formatDisplayDate(nextDay)}：${countyNextDayStatus.text}
    </p>`;

    // 只有當縣市的聚合狀態為「部分區域」停班課時，才列出受影響鄉鎮資訊
    if (countyInfo && countyInfo.dates[displayDateStr] && countyInfo.dates[displayDateStr].status === 'partial') { 
        let townshipDetails = '';
        // 找到所有屬於該縣市的鄉鎮
        const townshipsInCounty = Object.keys(suspensionData).filter(key => 
            suspensionData[key].isTownship && normalizeName(suspensionData[key].parentCounty) === normalizeName(countyName)
        );

        // 過濾出真正受影響的鄉鎮（非正常狀態）
        const affectedTownshipsInCounty = townshipsInCounty.filter(townKey => {
            const item = suspensionData[townKey];
            return item && (
                (item.dates[displayDateStr] && item.dates[displayDateStr].status !== 'normal') ||
                (item.dates[nextDayStr] && item.dates[nextDayStr].status !== 'normal')
            );
        });

        if (affectedTownshipsInCounty.length > 0) {
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            affectedTownshipsInCounty.forEach(townKey => { 
                const info = suspensionData[townKey];
                // 這裡的 townKey 已經是標準化後的鄉鎮名稱，例如「桃園市復興區」
                const townDisplayName = townKey; 

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
                townshipDetails += `<h4 class="font-semibold text-gray-700">${townDisplayName}</h4>`; 
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
            // 如果縣市是部分停班課，但沒有明確列出鄉鎮（例如籠統的公告）
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            panelContent += `<p class="text-sm text-gray-600 mt-2">此縣市有部分區域停班課，但無更詳細的鄉鎮資訊已公布。</p>`;
        }
    }
    infoPanel.innerHTML = panelContent;
}

function renderOutlyingIslandsInfo(displayDate) { // 接收 displayDate 參數
    let content = '';
    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDay = new Date(displayDate);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0,0,0,0);
    const nextDayStr = formatDateToYYYYMMDD(nextDay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

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

function showErrorMessage(message) {
    errorMessageEl.textContent = message;
    errorDetailModal.style.display = 'flex';
    lastErrorMessage = message;
}

// --- 8. 初始化事件監聽器 ---
function setupEventListeners() {
    showErrorBtn.addEventListener('click', () => showErrorMessage(lastErrorMessage));

    errorDetailCloseBtn.addEventListener('click', () => {
        errorDetailModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target == errorDetailModal) {
            errorDetailModal.style.display = 'none';
        }
    });

    sidebarToggleBtn.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', toggleSidebar);

    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('open');
            document.body.style.overflow = 'auto';
            if (zoomControlEl) {
                zoomControlEl.style.display = 'block';
            }
            if (map && map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
                map.invalidateSize(true);
            } else {
                console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
            }
        }
    });

    map.on('zoomend', () => {
        if (map && map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
            map.invalidateSize(true);
        } else {
            console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
        }
    });

    viewTodayBtn.addEventListener('click', () => {
        currentDisplayDate = new Date(); // 重設為今天的日期
        currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day
        refreshMapDisplay(currentDisplayDate);
    });

    viewTomorrowBtn.addEventListener('click', () => {
        currentDisplayDate = new Date(); // 先設為今天的日期
        currentDisplayDate.setDate(currentDisplayDate.getDate() + 1); // 再加一天，變成明天的日期
        currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day
        refreshMapDisplay(currentDisplayDate);
    });
}

function toggleSidebar() {
    const isOpen = sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('open');
    document.body.style.overflow = isOpen ? 'hidden' : 'auto';

    if (!zoomControlEl) {
        zoomControlEl = document.querySelector('.leaflet-control-zoom');
    }
    if (zoomControlEl) {
        zoomControlEl.style.display = isOpen ? 'none' : 'block';
    }

    setTimeout(() => {
        if (map && map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
            map.invalidateSize(true); 
        } else {
            console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
        }
    }, 300); 
}

// --- 9. 應用程式初始化 ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await renderMap(); // 渲染地圖並載入資料
        setupEventListeners(); // 設定所有事件監聽器
        zoomControlEl = document.querySelector('.leaflet-control-zoom'); // 確保在 DOM 準備好後獲取
        refreshMapDisplay(currentDisplayDate); // 初始顯示地圖和資訊
    } catch (error) {
        console.error("應用程式初始化失敗:", error);
        showErrorMessage(`應用程式初始化失敗：${error.message}`);
        mapLoader.style.display = 'none';
        showErrorBtn.classList.remove('hidden');
    }
});
