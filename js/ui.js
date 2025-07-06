// ui.js
// 負責使用者介面更新與事件處理

import { getStyle, normalizeName, formatDateToYYYYMMDD, formatDisplayDate } from './utils.js';
import { suspensionData } from './data.js';
import { map, countyGeojsonLayer, affectedTownshipLayers, renderTownshipsForCounty } from './map.js';

// DOM 元素引用
const infoPanel = document.getElementById('info-panel');
const updateTimeEl = document.getElementById('update-time');
const mapLoader = document.getElementById('map-loader');
const showErrorBtn = document.getElementById('show-error-btn');
const errorDetailModal = document.getElementById('error-detail-modal');
const errorMessageEl = document.getElementById('error-message');
const errorDetailCloseBtn = document.getElementById('error-detail-close');
const outlyingIslandsInfoEl = document.getElementById('outlying-islands-info');
const weatherBulletinInfoEl = document.getElementById('weather-bulletin-info');
const sidebar = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const viewTodayBtn = document.getElementById('view-today-btn');
const viewTomorrowBtn = document.getElementById('view-tomorrow-btn');

let lastErrorMessage = ''; // 儲存最後一次錯誤訊息的變數
let zoomControlEl; // Leaflet 縮放控制按鈕的變數

// 定義需要特別顯示的離島名稱，用於從 RSS 資料中篩選
const outlyingIslands = ['澎湖縣', '金門縣', '連江縣', '臺東縣蘭嶼鄉', '臺東縣綠島鄉'];

/**
 * 根據 currentDisplayDate 重新整理地圖顏色和資訊面板。
 * @param {Date} currentDisplayDate - 當前顯示的日期。
 */
export function refreshMapDisplay(currentDisplayDate) {
    const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

    if (countyGeojsonLayer) {
        countyGeojsonLayer.eachLayer(layer => {
            const countyName = normalizeName(layer.feature.properties.COUNTYNAME);
            const info = suspensionData[countyName];
            let statusToDisplay = 'no_info';

            if (info && info.dates[displayDateStr]) {
                statusToDisplay = info.dates[displayDateStr].status;
            } else if (displayDateStr === todayActualDateStr) {
                statusToDisplay = 'normal';
            }

            if (info && info.dates[displayDateStr]) {
                if (info.dates[displayDateStr].status === 'suspended') {
                    statusToDisplay = 'suspended';
                } else if (info.dates[displayDateStr].status === 'partial') {
                    statusToDisplay = 'partial';
                } else if (info.dates[displayDateStr].status === 'partial_time') {
                    statusToDisplay = 'partial_time';
                }
            }
            layer.setStyle(getStyle(statusToDisplay));
        });
    }

    const currentCountyNameInPanel = infoPanel.dataset.countyName;
    const currentDisplayNameInPanel = infoPanel.dataset.displayName;
    if (currentCountyNameInPanel && currentDisplayNameInPanel) {
        updateInfoPanel(currentCountyNameInPanel, currentDisplayNameInPanel, currentDisplayDate);
        const countyInfoForTowns = suspensionData[normalizeName(currentCountyNameInPanel)];
        if (!countyInfoForTowns || !countyInfoForTowns.dates[formatDateToYYYYMMDD(currentDisplayDate)] || countyInfoForTowns.dates[formatDateToYYYYMMDD(currentDisplayDate)].status !== 'suspended') {
            renderTownshipsForCounty(currentCountyNameInPanel, currentDisplayDate);
        } else {
            affectedTownshipLayers.clearLayers();
        }
    } else {
        infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
        affectedTownshipLayers.clearLayers();
    }

    renderOutlyingIslandsInfo(currentDisplayDate);

    if (map && map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
        map.invalidateSize(true);
    } else {
        console.warn("地圖容器尺寸無效，無法重新計算地圖尺寸。");
    }
}

/**
 * 更新資訊面板內容。
 * @param {string} countyName - 縣市名稱 (標準化後)。
 * @param {string} displayName - 縣市顯示名稱。
 * @param {Date} displayDate - 當前顯示的日期。
 */
export function updateInfoPanel(countyName, displayName, displayDate) {
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

    if (countyInfo && countyInfo.hasTownshipSpecificData && countyDisplayDateStatus.status !== 'suspended') { 
        let townshipDetails = '';
        const affectedTownshipsInCounty = Object.keys(suspensionData).filter(key => {
            const item = suspensionData[key];
            return item.isTownship && normalizeName(item.parentCounty) === normalizeName(countyName) && 
                   ((item.dates[displayDateStr] && item.dates[displayDateStr].status !== 'normal') ||
                    (item.dates[nextDayStr] && item.dates[nextDayStr].status !== 'normal'));
        });

        if (affectedTownshipsInCounty.length > 0) {
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            affectedTownshipsInCounty.forEach(townKey => { 
                const info = suspensionData[townKey];
                // 這裡假設 townKey 已經包含完整的鄉鎮名稱 (例如 "桃園市復興區")
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
        } else if (countyInfo.dates[displayDateStr] && countyInfo.dates[displayDateStr].status === 'partial') {
            panelContent += `<h4 class="font-bold text-gray-700 mt-4">受影響鄉鎮資訊:</h4>`;
            panelContent += `<p class="text-sm text-gray-600 mt-2">此縣市有部分區域停班課，但無更詳細的鄉鎮資訊已公布。</p>`;
        }
    }
    infoPanel.innerHTML = panelContent;
}

/**
 * 渲染離島資訊。
 * @param {Date} displayDate - 當前顯示的日期。
 */
export function renderOutlyingIslandsInfo(displayDate) {
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

/**
 * 顯示錯誤訊息彈出視窗。
 * @param {string} message - 要顯示的錯誤訊息。
 */
export function showErrorMessage(message) {
    errorMessageEl.textContent = message;
    errorDetailModal.style.display = 'flex';
    lastErrorMessage = message; // 儲存錯誤訊息，以便「顯示錯誤詳情」按鈕使用
}

/**
 * 處理側邊欄開關邏輯。
 */
export function toggleSidebar() {
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

/**
 * 初始化 UI 事件監聽器。
 * @param {Date} currentDisplayDate - 當前顯示的日期。
 * @param {Function} refreshMapDisplay - 重新整理地圖顯示的回呼函數。
 */
export function setupUIEventListeners(currentDisplayDate, refreshMapDisplay) {
    // 確保這裡的 showErrorMessage 使用的是從 ui.js 導出的版本
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
        currentDisplayDate.setTime(new Date().setHours(0,0,0,0));
        refreshMapDisplay(currentDisplayDate);
    });

    viewTomorrowBtn.addEventListener('click', () => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0,0,0,0);
        currentDisplayDate.setTime(tomorrow.getTime());
        refreshMapDisplay(currentDisplayDate);
    });
}

// 導出 DOM 元素，以便其他模組可以訪問它們
export { infoPanel, updateTimeEl, mapLoader, showErrorBtn, errorMessageEl, weatherBulletinInfoEl };
