// main.js
// 應用程式的主要入口點，協調各模組

import { loadSuspensionData, loadWeatherBulletins, suspensionData } from './data.js';
import { renderMap, map, countyGeojsonLayer, affectedTownshipLayers, renderTownshipsForCounty } from './map.js';
import { refreshMapDisplay, updateInfoPanel, setupUIEventListeners, infoPanel, updateTimeEl, mapLoader, showErrorBtn, errorMessageEl, weatherBulletinInfoEl, showErrorMessage } from './ui.js';

// 全域變數，表示目前地圖顯示的是哪一天的資料
// 這裡使用一個物件來包裝日期，以便在不同模組間傳遞時能保持引用一致性
const appState = {
    currentDisplayDate: new Date()
};
appState.currentDisplayDate.setHours(0,0,0,0); // Normalize to start of day

/**
 * 初始化應用程式。
 */
async function initializeApp() {
    try {
        // 載入停班停課資料
        await loadSuspensionData(updateTimeEl);

        // 渲染地圖 (傳遞必要的 UI 和資料相關函數/變數)
        await renderMap(updateInfoPanel, loadWeatherBulletins, mapLoader, showErrorBtn, showErrorMessage, updateTimeEl, weatherBulletinInfoEl, appState.currentDisplayDate);

        // 載入並渲染天氣快報
        await loadWeatherBulletins(weatherBulletinInfoEl);

        // 設定 UI 事件監聽器 (傳遞 currentDisplayDate 和 refreshMapDisplay)
        setupUIEventListeners(appState.currentDisplayDate, () => refreshMapDisplay(appState.currentDisplayDate));

        // 初始顯示地圖和資訊
        refreshMapDisplay(appState.currentDisplayDate);

    } catch (error) {
        console.error("應用程式初始化失敗:", error);
        // 這裡的錯誤處理會被 map.js 中的 renderMap 捕獲並顯示在載入器上
        // 如果是 loadSuspensionData 失敗，則會更新 updateTimeEl
    }
}

// 當 DOM 完全載入後，初始化應用程式
document.addEventListener('DOMContentLoaded', initializeApp);

