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
        // 將 updateTimeEl 傳遞給 loadSuspensionData，以便其更新時間戳記
        await loadSuspensionData(updateTimeEl); 

        // 渲染地圖 (傳遞必要的 UI 和資料相關函數/變數)
        // 將所有相關的 DOM 元素和函數傳遞給 renderMap
        await renderMap(updateInfoPanel, loadWeatherBulletins, mapLoader, showErrorBtn, showErrorMessage, updateTimeEl, weatherBulletinInfoEl, appState.currentDisplayDate);

        // 載入並渲染天氣快報
        // 將 weatherBulletinInfoEl 傳遞給 loadWeatherBulletins
        await loadWeatherBulletins(weatherBulletinInfoEl);

        // 設定 UI 事件監聽器 (傳遞 currentDisplayDate 和 refreshMapDisplay)
        // 確保 refreshMapDisplay 接收到正確的日期物件
        setupUIEventListeners(appState.currentDisplayDate, () => refreshMapDisplay(appState.currentDisplayDate));

        // 初始顯示地圖和資訊
        // 確保 refreshMapDisplay 接收到正確的日期物件
        refreshMapDisplay(appState.currentDisplayDate);

    } catch (error) {
        console.error("應用程式初始化失敗:", error);
        // 如果在任何初始化步驟中發生錯誤，顯示錯誤訊息
        showErrorMessage(`應用程式初始化失敗：${error.message}`);
        // 隱藏載入器，即使發生錯誤也要讓使用者看到頁面（但有錯誤提示）
        mapLoader.style.display = 'none';
        showErrorBtn.classList.remove('hidden'); // 顯示錯誤詳情按鈕
    }
}

// 當 DOM 完全載入後，初始化應用程式
document.addEventListener('DOMContentLoaded', initializeApp);
