/* 基本樣式，確保頁面佔滿整個視窗並設定字體 */
html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: 'Noto Sans TC', sans-serif;
    background-color: #f0f2f5;
    overflow: hidden; /* 防止滾動條在側邊欄打開時出現 */
}
/* 地圖容器樣式，確保地圖能響應式填充空間 */
#map {
    height: 100%;
    width: 100%;
    background-color: #a2d2ff;
}
/* Leaflet 彈出視窗和提示框的樣式，增加透明度和圓角 */
.leaflet-popup-content-wrapper, .leaflet-popup-tip {
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(5px);
    box-shadow: 0 3px 14px rgba(0,0,0,0.4);
    border-radius: 8px;
}
.leaflet-popup-content {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.6;
}
.leaflet-tooltip {
    background-color: rgba(0, 0, 0, 0.7);
    border: none;
    color: white;
    border-radius: 4px;
    box-shadow: none;
}
/* 載入中旋轉圖示的樣式 */
.spinner {
    border: 4px solid rgba(0, 0, 0, 0.1);
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border-left-color: #09f;
    animation: spin 1s ease infinite;
}
@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
/* 錯誤詳情彈出視窗的樣式 */
#error-detail-modal {
    display: none; /* 預設隱藏 */
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
    background-color: rgba(0,0,0,0.7);
    backdrop-filter: blur(5px);
    align-items: center;
    justify-content: center;
}
#error-detail-content {
    background-color: #fefefe;
    margin: auto;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    width: 80%; /* 響應式寬度 */
    max-width: 500px; /* 最大寬度限制 */
    position: relative;
}
#error-detail-close {
    color: #aaa;
    float: right;
    font-size: 28px;
    font-weight: bold;
    cursor: pointer;
}
#error-detail-close:hover,
#error-detail-close:focus {
    color: black;
    text-decoration: none;
    cursor: pointer;
}

/* 側邊欄動畫和定位 */
#sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100%;
    width: 80%; /* 手機上側邊欄寬度 */
    max-width: 350px; /* 最大寬度限制 */
    transform: translateX(-100%); /* 預設隱藏在左側 */
    transition: transform 0.3s ease-out;
    z-index: 500; /* 高於地圖，低於 modal */
    box-shadow: 2px 0 10px rgba(0,0,0,0.2);
}
#sidebar.open {
    transform: translateX(0); /* 打開時滑入 */
}
/* 遮罩層 */
#sidebar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.5);
    z-index: 400; /* 在地圖之上，側邊欄之下 */
    display: none; /* 預設隱藏 */
}
#sidebar-overlay.open {
    display: block;
}

/* 桌面版側邊欄樣式（覆蓋手機版固定定位） */
@media (min-width: 768px) { /* md breakpoint */
    #sidebar {
        position: relative;
        width: 33.333333%; /* md:w-1/3 */
        max-width: none; /* 取消最大寬度限制 */
        transform: translateX(0); /* 始終顯示 */
        box-shadow: none; /* 移除陰影 */
    }
    #sidebar-overlay {
        display: none !important; /* 桌面版不顯示遮罩 */
    }
    /* 確保主內容區塊在桌面版正確佈局 */
    main {
        flex-direction: row !important;
    }
}
@media (min-width: 1024px) { /* lg breakpoint */
    #sidebar {
        width: 25%; /* lg:w-1/4 */
    }
}

/* 漢堡選單按鈕樣式 */
.hamburger-menu {
    display: block; /* 手機版顯示 */
    background-color: #3b82f6;
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 24px; /* 調整大小 */
    line-height: 1;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    transition: background-color 0.2s;
}
.hamburger-menu:hover {
    background-color: #2563eb;
}
@media (min-width: 768px) {
    .hamburger-menu {
        display: none; /* 桌面版隱藏 */
    }
}
