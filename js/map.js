// map.js
// 負責地圖初始化、圖層管理、地圖事件

import { getStyle, highlightStyle, normalizeName, formatDateToYYYYMMDD, formatDisplayDate } from './utils.js';
import { suspensionData, countyGeojsonURL, townGeojsonURL, jsonFeedURL } from './data.js'; // 導入 jsonFeedURL

// Leaflet 地圖實例
export const map = L.map('map', {
    zoomControl: true 
}).setView([23.9, 121], 7); // 初始視圖

// 地圖相關圖層變數
export let countyGeojsonLayer; // 縣市層 GeoJSON 圖層
export let townGeojson = null; // 鄉鎮層 GeoJSON 原始資料 (用於查找鄉鎮邊界)
export const affectedTownshipLayers = L.layerGroup(); // 用於存放所有受影響的鄉鎮圖層

// CORS 代理服務
const proxyURL = 'https://corsproxy.io/?'; 

/**
 * 渲染特定縣市的鄉鎮圖層。
 * 只有當縣市不是全天停班課時才繪製鄉鎮。
 * @param {string} countyName - 要渲染鄉鎮的縣市名稱 (標準化後)。
 * @param {Date} displayDate - 當前顯示的日期。
 */
export function renderTownshipsForCounty(countyName, displayDate) {
    affectedTownshipLayers.clearLayers(); // 清空現有的鄉鎮圖層
    if (!townGeojson) {
        console.warn("鄉鎮 GeoJSON 資料尚未載入，無法渲染鄉鎮圖層。");
        return;
    }

    const displayDateStr = formatDateToYYYYMMDD(displayDate);
    const nextDayRelativeToDisplay = new Date(displayDate);
    nextDayRelativeToDisplay.setDate(nextDayRelativeToDisplay.getDate() + 1);
    nextDayRelativeToDisplay.setHours(0,0,0,0);
    const nextDayRelativeToDisplayStr = formatDateToYYYYMMDD(nextDayRelativeToDisplay);
    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

    // 過濾出屬於指定縣市的所有鄉鎮
    const townshipsInCounty = townGeojson.features.filter(f => normalizeName(f.properties.county) === normalizeName(countyName));

    if (townshipsInCounty.length > 0) {
        L.geoJSON(townshipsInCounty, {
            style: feature => {
                const townKey = normalizeName(feature.properties.county + feature.properties.town);
                const info = suspensionData[townKey];
                let statusToDisplay = 'no_info'; 

                if (info && info.dates[displayDateStr]) {
                    statusToDisplay = info.dates[displayDateStr].status;
                } else if (displayDateStr === todayActualDateStr) {
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
        affectedTownshipLayers.addTo(map); // 將圖層群組添加到地圖
    }
}

/**
 * 使用 GeoJSON 資料和停班停課資訊渲染地圖。
 * @param {Function} updateInfoPanel - 更新資訊面板的回呼函數。
 * @param {Function} loadWeatherBulletins - 載入天氣快報的回呼函數。
 * @param {HTMLElement} mapLoader - 地圖載入器 DOM 元素。
 * @param {HTMLElement} showErrorBtn - 顯示錯誤按鈕 DOM 元素。
 * @param {Function} showErrorMessage - 顯示錯誤訊息的回呼函數。
 * @param {HTMLElement} updateTimeEl - 更新時間 DOM 元素。
 * @param {HTMLElement} weatherBulletinInfoEl - 天氣快報資訊 DOM 元素。
 * @param {Date} currentDisplayDate - 當前顯示的日期。
 */
export async function renderMap(updateInfoPanel, loadWeatherBulletins, mapLoader, showErrorBtn, showErrorMessage, updateTimeEl, weatherBulletinInfoEl, currentDisplayDate) {
    mapLoader.style.display = 'flex';
    showErrorBtn.classList.add('hidden');
    let lastErrorMessage = ''; // Local variable for this function

    try {
        // 載入縣市層級 GeoJSON 資料
        const countyResponse = await fetch(`${proxyURL}${encodeURIComponent(countyGeojsonURL)}`);
        if (!countyResponse.ok) throw new Error(`County GeoJSON fetch failed: ${countyResponse.status} - ${countyResponse.statusText}`);
        const countyData = await countyResponse.json();

        // 載入鄉鎮層級 GeoJSON 資料
        const townResponse = await fetch(`${proxyURL}${encodeURIComponent(townGeojsonURL)}`);
        if (!townResponse.ok) throw new Error(`Town GeoJSON fetch failed: ${townResponse.status} - ${townResponse.statusText}`);
        townGeojson = await townResponse.json(); // 儲存到全域變數

        map.whenReady(function() {
            countyGeojsonLayer = L.geoJSON(countyData, {
                style: feature => {
                    const countyName = normalizeName(feature.properties.COUNTYNAME);
                    const info = suspensionData[countyName];
                    const displayDateStr = formatDateToYYYYMMDD(currentDisplayDate);
                    const todayActualDateStr = formatDateToYYYYMMDD(new Date());

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
                    return getStyle(statusToDisplay);
                },
                onEachFeature: (feature, layer) => {
                    const countyName = normalizeName(feature.properties.COUNTYNAME);
                    const displayName = feature.properties.COUNTYNAME;
                    layer.bindTooltip(displayName, { permanent: false, direction: 'center' });

                    layer.on({
                        mouseover: e => {
                            const hoveredLayer = e.target;
                            hoveredLayer.setStyle(highlightStyle);
                            if (!L.Browser.ie) hoveredLayer.bringToFront();
                            updateInfoPanel(countyName, displayName, currentDisplayDate);
                        },
                        mouseout: e => {
                            countyGeojsonLayer.resetStyle(e.target);
                            const currentCountyNameInPanel = infoPanel.dataset.countyName;
                            if (!currentCountyNameInPanel || currentCountyNameInPanel !== countyName) {
                                infoPanel.innerHTML = `<p class="text-gray-600">請將滑鼠移至或點擊地圖上的縣市以查看資訊。</p>`;
                            }
                            affectedTownshipLayers.clearLayers();
                        },
                        click: e => {
                            const clickedBounds = e.target.getBounds();
                            const isClickedBoundsValid = clickedBounds.isValid() && 
                                                         !isNaN(clickedBounds.getNorth()) && !isNaN(clickedBounds.getEast()) &&
                                                         !isNaN(clickedBounds.getSouth()) && !isNaN(clickedBounds.getWest());
                            if (isClickedBoundsValid) {
                                map.fitBounds(clickedBounds, { padding: [20, 20] });
                            } else {
                                console.warn("點擊的縣市 GeoJSON 邊界無效，無法縮放。");
                            }

                            updateInfoPanel(countyName, displayName, currentDisplayDate);
                            
                            const countyInfoForTowns = suspensionData[normalizeName(countyName)];
                            if (!countyInfoForTowns || !countyInfoForTowns.dates[formatDateToYYYYMMDD(currentDisplayDate)] || countyInfoForTowns.dates[formatDateToYYYYMMDD(currentDisplayDate)].status !== 'suspended') {
                                renderTownshipsForCounty(countyName, currentDisplayDate);
                            } else {
                                affectedTownshipLayers.clearLayers();
                            }

                            const countyInfo = suspensionData[countyName];
                            let popupContent = `<strong class="text-base">${displayName}</strong><br>`;

                            const displayDateStrForPopup = formatDateToYYYYMMDD(currentDisplayDate);
                            const nextDayForPopup = new Date(currentDisplayDate);
                            nextDayForPopup.setDate(nextDayForPopup.getDate() + 1);
                            nextDayForPopup.setHours(0,0,0,0);
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

                            popupContent += `<span style="color:${getStyle(countyDisplayDateStatus.status).fillColor};">
                                ${formatDisplayDate(currentDisplayDate)}：${countyDisplayDateStatus.text}
                            </span><br>`;
                            
                            popupContent += `<span style="color:${getStyle(countyNextDayStatus.status).fillColor};">
                                ${formatDisplayDate(nextDayForPopup)}：${countyNextDayStatus.text}
                            </span>`;

                            if (countyInfo && countyInfo.hasTownshipSpecificData && townGeojson && countyDisplayDateStatus.status !== 'suspended') {
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
                                } else if (countyInfo.dates[displayDateStrForPopup] && countyInfo.dates[displayDateStrForPopup].status === 'partial') {
                                    popupContent += `<br><strong class="text-base">受影響鄉鎮:</strong>`;
                                    popupContent += `<br><span class="text-sm text-gray-600">此縣市有部分區域停班課，但無更詳細的鄉鎮資訊已公布。</span>`;
                                }
                            }

                            L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
                        }
                    });
                }
            }).addTo(map);

            const bounds = countyGeojsonLayer.getBounds();
            const isValidBounds = bounds.isValid() && 
                                  !isNaN(bounds.getNorth()) && !isNaN(bounds.getEast()) &&
                                  !isNaN(bounds.getSouth()) && !isNaN(bounds.getWest());

            if (countyGeojsonLayer && countyGeojsonLayer.getLayers().length > 0 && isValidBounds) {
                map.fitBounds(bounds, { padding: [20, 20] });
            } else {
                map.setView([23.9, 121], 7);
                console.warn("未載入有效的縣市 GeoJSON 資料或地圖邊界無效，地圖將顯示預設視圖。");
            }

            affectedTownshipLayers.addTo(map);

            mapLoader.style.display = 'none'; // 隱藏載入中旋轉圖示

            // 在地圖初始化後獲取 Leaflet 縮放控制按鈕的引用
            // 這裡不再直接賦值給 zoomControlEl，而是讓 ui.js 處理
            // 因為 zoomControlEl 是 ui.js 模組的內部變數
            
            requestAnimationFrame(() => {
                if (map._container && map._container.offsetWidth > 0 && map._container.offsetHeight > 0) {
                    map.invalidateSize(true); 
                } else {
                    console.warn("地圖容器尺寸無效，無法在載入後重新計算地圖尺寸。");
                }
            });
        });
    } catch (error) {
        console.error("無法渲染地圖或載入資料:", error);
        // 將錯誤訊息傳遞給 showErrorMessage
        showErrorMessage(`地圖渲染或資料載入失敗：${error.message}`);
        mapLoader.style.display = 'none'; // 確保載入器隱藏
        showErrorBtn.classList.remove('hidden'); // 顯示錯誤詳情按鈕
    }
}
