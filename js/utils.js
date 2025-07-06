// utils.js
// 通用工具函數

/**
 * 將日期物件格式化為 YYYY-MM-DD 字串。
 * @param {Date} date - 要格式化的日期物件。
 * @returns {string} 格式化後的日期字串。
 */
export function formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 將日期物件格式化為 M月D日 字串 (用於顯示)。
 * @param {Date} date - 要格式化的日期物件。
 * @returns {string} 格式化後的日期字串。
 */
export function formatDisplayDate(date) {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日`;
}

/**
 * 從包含日期的文字中解析日期。
 * 嘗試匹配 MM/DD 或 MM月DD日 格式。
 * @param {string} text - 包含日期的文字。
 * @param {Date} referenceDate - 用於確定年份的參考日期。
 * @returns {Date|null} 解析出的日期物件，如果未找到則為 null。
 */
export function parseDateFromText(text, referenceDate) {
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

/**
 * 標準化縣市/鄉鎮名稱，處理「臺」與「台」的差異，並移除括號內容。
 * @param {string} name - 原始名稱。
 * @returns {string} 標準化後的名稱。
 */
export function normalizeName(name) { 
    return name.replace('臺', '台').replace(/\(.*?\)/g, '').trim(); 
}

/**
 * 根據公告文字判斷停班課狀態。
 * @param {string} stmt - 公告文字。
 * @returns {string} 停班課狀態 ('suspended', 'partial_time', 'partial', 'normal')。
 */
export function determineStatus(stmt) {
    const isSuspendedKeyword = stmt.includes('停止上班') || stmt.includes('停止上課') || stmt.includes('已達停止上班及上課標準');
    const isPartialTimeSuspension = stmt.includes('下午') || stmt.includes('晚上') || stmt.includes('中午') || stmt.includes('早上');
    const isSpecificAreaKeywords = stmt.includes('部分區域') || stmt.includes('特定人員') || stmt.includes('學校') || stmt.includes('鄰里');

    if (isSuspendedKeyword) {
        if (isSpecificAreaKeywords) {
            return 'partial'; // 橘色：部分區域或特定人員
        } else if (isPartialTimeSuspension) {
            return 'partial_time'; // 黃色：非全天停止
        } else {
            return 'suspended'; // 紅色：全天停止
        }
    }
    return 'normal'; // 藍色：正常上班上課
}

/**
 * 定義停班課狀態的優先級，用於判斷多條公告的最終狀態。
 * 索引越大表示優先級越高。
 */
export const statusPriority = ['normal', 'partial', 'partial_time', 'suspended'];

/**
 * 根據狀態獲取對應的地圖顏色樣式。
 * @param {string} status - 停班課狀態。
 * @returns {object} Leaflet 樣式物件。
 */
export function getStyle(status) {
    const baseStyle = { weight: 1.5, opacity: 1, color: 'white', fillOpacity: 0.8 };
    switch (status) {
        case 'suspended': return { ...baseStyle, fillColor: '#ef4444' }; // 紅色：全天停止上班上課
        case 'partial_time': return { ...baseStyle, fillColor: '#facc15' }; // 黃色：非全天停止上班或上課 (例如上午、中午、下午、晚上停課)
        case 'partial': return { ...baseStyle, fillColor: '#f97316' };   // 橘色：部分區域或特定人員
        case 'normal': return { ...baseStyle, fillColor: '#3b82f6' }; // 藍色：正常上班上課
        case 'no_info': default: return { ...baseStyle, fillColor: '#cccccc' }; // 灰色：沒有公布資訊
    }
}

/**
 * 定義滑鼠懸停時的高亮樣式。
 */
export const highlightStyle = { weight: 4, color: '#333', fillOpacity: 0.95 };
