// data.js
// 負責資料抓取與處理

import { normalizeName, determineStatus, statusPriority, parseDateFromText } from './utils.js';

// 全域變數，儲存停班停課資訊，鍵可以是縣市名或縣市鄉鎮名
export const suspensionData = {}; 

// 定義需要特別顯示的離島名稱，用於從 RSS 資料中篩選 (這些通常是鄉鎮層級)
const outlyingIslands = ['澎湖縣', '金門縣', '連江縣', '臺東縣蘭嶼鄉', '臺東縣綠島鄉'];

// URL 定義
// 更新 GeoJSON URL 以反映新的 Repository 名稱
export const countyGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/raw/refs/heads/main/twmap.json'; // 縣市層級 GeoJSON
export const townGeojsonURL = 'https://github.com/RBeeChen/taiwan-typhoon-map/releases/download/NEW_JSON/TW_town.json'; // 鄉鎮層級 GeoJSON
// 停班課資訊來源更改為 JSON 格式
export const jsonFeedURL = 'https://alerts.ncdr.nat.gov.tw/JSONAtomFeed.ashx?AlertType=33';
export const cwaWarningRSSURL = 'https://www.cwa.gov.tw/rss/Data/cwa_warning.xml'; // 中央氣象局天氣快報 RSS
// 將 CORS 代理服務更換為 corsproxy.io
const proxyURL = 'https://corsproxy.io/?'; 

/**
 * 從 NCDR JSON 訂閱源載入停班停課資料。
 * 更新 suspensionData 物件。
 * @param {HTMLElement} updateTimeEl - 用於顯示更新時間的 DOM 元素。
 * @throws {Error} 如果資料載入失敗。
 */
export async function loadSuspensionData(updateTimeEl) {
    try {
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

        for (const locationKey in rawSuspensionData) {
            suspensionData[locationKey] = {
                dates: {},
                isTownship: rawSuspensionData[locationKey].isTownship,
                parentCounty: rawSuspensionData[locationKey].parentCounty,
                hasTownshipSpecificData: false
            };

            for (const dateStr in rawSuspensionData[locationKey].dates) {
                const entriesForDate = rawSuspensionData[locationKey].dates[dateStr];
                entriesForDate.sort((a, b) => b.updated.getTime() - a.updated.getTime());

                let finalStatusForDate = { status: 'normal', text: `照常上班、照常上課`, updated: new Date(0) };
                let foundRelevantAnnouncement = false;

                for (const entry of entriesForDate) {
                    const statusText = entry.statusText;
                    let stmt = statusText;

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

        const currentDayStr = formatDateToYYYYMMDD(new Date());
        for (const key in suspensionData) {
            const item = suspensionData[key];
            if (item.isTownship && item.dates[currentDayStr] && item.dates[currentDayStr].status !== 'normal') {
                const parentCountyKey = item.parentCounty;
                if (suspensionData[parentCountyKey]) {
                    suspensionData[parentCountyKey].hasTownshipSpecificData = true;
                }
            }
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

/**
 * 載入中央氣象局天氣快報資料。
 * @param {HTMLElement} weatherBulletinInfoEl - 用於顯示天氣快報的 DOM 元素。
 */
export async function loadWeatherBulletins(weatherBulletinInfoEl) {
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
