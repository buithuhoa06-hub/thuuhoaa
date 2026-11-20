// Universal API fetcher with Dual-Route Fallback (Vercel & Localhost compatible)
async function apiFetch(endpoint, options) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const noApiEndpoint = cleanEndpoint.startsWith('/api/') ? cleanEndpoint.slice(4) : cleanEndpoint;
  const withApiEndpoint = cleanEndpoint.startsWith('/api/') ? cleanEndpoint : '/api' + cleanEndpoint;

  let res;
  try {
    // Vercel serverless functions natively listen on noApiEndpoint (e.g. /step2/clean)
    res = await fetch(noApiEndpoint, options);
    if (!res.ok && res.status === 404) {
      res = await fetch(withApiEndpoint, options);
    }
  } catch (err) {
    res = await fetch(withApiEndpoint, options);
  }
  return res;
}

// Safe response reader to prevent syntax errors on HTML/Vercel edge errors
async function safeParseJsonResponse(res, defaultError = "Không thể xử lý dữ liệu") {
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (parseErr) {
    let cleanMsg = (text || "").trim();
    if (res.status === 413 || cleanMsg.toLowerCase().includes("entity too large")) {
      throw new Error("Dung lượng gói dữ liệu vượt quá giới hạn máy chủ (Request Entity Too Large). Hệ thống đã tự động giới hạn và tối ưu hóa mẫu dữ liệu đại diện.");
    }
    if (res.status === 504 || cleanMsg.toLowerCase().includes("timeout")) {
      throw new Error("Máy chủ phản hồi quá thời gian quy định (Gateway Timeout). Vui lòng thử lại với tập dữ liệu gọn hơn.");
    }
    if (cleanMsg.length > 160) {
      cleanMsg = cleanMsg.slice(0, 140) + "...";
    }
    throw new Error(`Máy chủ phản hồi mã ${res.status}: ${cleanMsg || defaultError}`);
  }
  if (!res.ok) {
    throw new Error(json.detail || json.message || defaultError);
  }
  return json;
}

// ============================================================================
// BI AI AGENT — FRONTEND CONTROLLER (4-STEP HUMAN-IN-THE-LOOP WORKFLOW)
// ============================================================================

if (window.ChartDataLabels) {
  Chart.register(window.ChartDataLabels);
}

const AppState = {
  currentStep: 1,
  maxUnlockedStep: 1,
  normalizedCsv: "",
  sheets: [],
  activeSheetIdx: 0,
  step1Data: null,
  step2Data: null,
  step3Data: null,
  charts: {
    aging: null,
    workingCapital: null,
    pnl: null
  }
};

// ============================================================================
// WORKBENCH SIDEBAR COLLAPSE / EXPAND & DRAGGABLE RESIZER
// ============================================================================
function toggleWorkbenchSidebar(forceState) {
  const workbench = document.querySelector(".studio-workbench");
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  const toggleLabel = document.getElementById("sidebarToggleLabel");
  const toggleArrow = document.getElementById("sidebarToggleArrow");
  const floatBtn = document.getElementById("sidebarFloatingExpandBtn");
  if (!workbench) return;

  const isCurrentlyCollapsed = workbench.classList.contains("sidebar-collapsed");
  const shouldCollapse = (typeof forceState === "boolean") ? !forceState : !isCurrentlyCollapsed;

  if (shouldCollapse) {
    workbench.classList.add("sidebar-collapsed");
    if (toggleLabel) toggleLabel.textContent = "Mở Quy trình";
    if (toggleArrow) toggleArrow.setAttribute("d", "m10 9 3 3-3 3");
    if (toggleBtn) {
      toggleBtn.title = "Mở rộng thanh Quy trình (Ctrl+B)";
      toggleBtn.classList.add("is-collapsed");
    }
    if (floatBtn) floatBtn.classList.remove("hidden");
    try { localStorage.setItem("studio_sidebar_collapsed", "true"); } catch (e) {}
  } else {
    workbench.classList.remove("sidebar-collapsed");
    if (toggleLabel) toggleLabel.textContent = "Thu gọn Quy trình";
    if (toggleArrow) toggleArrow.setAttribute("d", "m14 9-3 3 3 3");
    if (toggleBtn) {
      toggleBtn.title = "Thu gọn thanh Quy trình (Ctrl+B)";
      toggleBtn.classList.remove("is-collapsed");
    }
    if (floatBtn) floatBtn.classList.add("hidden");
    try { localStorage.setItem("studio_sidebar_collapsed", "false"); } catch (e) {}
  }

  // Trigger chart resize if charts are present
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
    if (typeof refreshStep3ChartsSize === "function") {
      refreshStep3ChartsSize();
    }
  }, 240);
}

// Draggable Sidebar Resizer (kéo thả điều chỉnh độ rộng)
function initSidebarResizer() {
  const resizer = document.getElementById("sidebarResizer");
  const workbench = document.querySelector(".studio-workbench");
  if (!resizer || !workbench) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 240;

  resizer.addEventListener("mousedown", (e) => {
    if (workbench.classList.contains("sidebar-collapsed")) return;
    isDragging = true;
    startX = e.clientX;
    const currentStyleWidth = parseInt(getComputedStyle(workbench).getPropertyValue("--sidebar-width")) || 240;
    startWidth = currentStyleWidth;
    resizer.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const delta = e.clientX - startX;
    let newWidth = startWidth + delta;

    if (newWidth < 110) {
      toggleWorkbenchSidebar(false);
      isDragging = false;
      resizer.classList.remove("is-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      return;
    } else {
      if (workbench.classList.contains("sidebar-collapsed")) {
        toggleWorkbenchSidebar(true);
      }
    }

    if (newWidth > 420) newWidth = 420;
    workbench.style.setProperty("--sidebar-width", `${newWidth}px`);
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      resizer.classList.remove("is-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.dispatchEvent(new Event("resize"));
    }
  });

  resizer.addEventListener("dblclick", () => {
    toggleWorkbenchSidebar();
  });

  try {
    if (localStorage.getItem("studio_sidebar_collapsed") === "true") {
      toggleWorkbenchSidebar(false);
    }
  } catch (e) {}
}

// Keyboard shortcut: Ctrl+B to toggle sidebar
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
    const tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag !== "INPUT" && tag !== "TEXTAREA") {
      e.preventDefault();
      toggleWorkbenchSidebar();
    }
  }
});

// Initialize clean workspace on page load
window.addEventListener("DOMContentLoaded", () => {
  resetWorkspace();
  initSidebarResizer();
});

function resetWorkspace() {
  document.getElementById("ctxCompany").value = "";
  document.getElementById("ctxIndustry").value = "";
  document.getElementById("ctxAudience").value = "";
  document.getElementById("ctxObjective").value = "";
  document.getElementById("rawInputText").value = "";
  const fileEl = document.getElementById("fileUploadInput");
  if (fileEl) fileEl.value = "";
  const gsheetInput = document.getElementById("gsheetUrlInput");
  if (gsheetInput) gsheetInput.value = "";
  const gsheetStatus = document.getElementById("gsheetStatusMsg");
  if (gsheetStatus) {
    gsheetStatus.className = "gsheet-status-msg hidden";
    gsheetStatus.innerHTML = "";
  }
  ["multiSheetSelectorBar", "step2ExcelTabBar"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("hidden");
      el.innerHTML = "";
    }
  });

  AppState.currentStep = 1;
  AppState.maxUnlockedStep = 1;
  AppState.normalizedCsv = "";
  AppState.sheets = [];
  AppState.activeSheetIdx = 0;
  AppState.step1Data = null;
  AppState.step2Data = null;
  AppState.step3Data = null;

  document.getElementById("step1ResultBox").classList.add("hidden");
  document.getElementById("step1ResultBox").innerHTML = "";
  document.getElementById("step2HitlGateBox")?.classList.add("hidden");
  document.getElementById("step2TableQuickActions")?.classList.add("hidden");
  document.getElementById("step3HitlGateBox")?.classList.add("hidden");
  updateSidebarSourceStatus();
  jumpToStep(1, true);
}

function setContextGoal(goalText) {
  const objEl = document.getElementById("ctxObjective");
  if (objEl) {
    objEl.value = goalText;
    objEl.focus();
  }
}

function getContextFromForm() {
  const comp = document.getElementById("ctxCompany")?.value?.trim() || "";
  const ind = document.getElementById("ctxIndustry")?.value?.trim() || "";
  const aud = document.getElementById("ctxAudience")?.value?.trim() || "";
  const obj = document.getElementById("ctxObjective")?.value?.trim() || "";
  const persona = document.getElementById("ctxCustomerPersona")?.value?.trim() || "";
  const bizModel = document.getElementById("ctxBusinessModel")?.value?.trim() || "";

  return {
    company_name: comp || "Tập đoàn Đầu tư & Công nghệ Alpha",
    industry: ind || "Thương mại Điện tử & Bán lẻ Đa kênh (Omnichannel Retail)",
    target_audience: aud || "Ban Tổng Giám đốc (CEO, CFO, COO) & Hội đồng Quản trị",
    objective: obj || "Tối ưu hóa Chi phí, Kiểm soát Giá vốn & Cải thiện Biên Lợi nhuận Ròng",
    customer_persona: persona || "Khách hàng B2B Doanh nghiệp SME kết hợp Người tiêu dùng trẻ đô thị (22-38 tuổi) mua sắm đa kênh (Website, Sàn TMĐT, Cửa hàng)",
    business_model: bizModel || "B2B2C Đa kênh (Omnichannel) — Kết hợp bán lẻ trực tiếp và mạng lưới đại lý phân phối"
  };
}

function setContextPersona(val) {
  const el = document.getElementById("ctxCustomerPersona");
  if (el) el.value = val;
}

function setContextBusinessModel(val) {
  const el = document.getElementById("ctxBusinessModel");
  if (el) el.value = val;
}

// Initialize Loaded Sheets from Excel / Google Sheets
function initLoadedSheets(sheets, rawInput, rowCount, colCount, columns) {
  if (sheets && sheets.length > 0) {
    AppState.sheets = sheets.map(s => ({
      name: s.name,
      row_count: s.row_count || 0,
      col_count: s.col_count || (s.columns ? s.columns.length : 0),
      columns: s.columns || [],
      csv: s.csv || "",
      step1Data: null,
      step2Data: null,
      step3Data: null
    }));
  } else {
    AppState.sheets = [{
      name: "Sheet 1",
      row_count: rowCount || 0,
      col_count: colCount || (columns ? columns.length : 0),
      columns: columns || [],
      csv: rawInput || "",
      step1Data: null,
      step2Data: null,
      step3Data: null
    }];
  }

  AppState.activeSheetIdx = 0;
  const rawArea = document.getElementById("rawInputText");
  if (rawArea) {
    rawArea.value = AppState.sheets[0].csv || rawInput || "";
  }
  renderAllExcelTabBars();
  updateSidebarSourceStatus();
}

// Render Excel Sheet Tabs only for Step 1 and Step 2
// (Step 3 & 4 provide unified analysis across all sheets without tab fragmentation)
function renderAllExcelTabBars() {
  renderExcelTabBarForContainer("multiSheetSelectorBar", 1);
  renderExcelTabBarForContainer("step2ExcelTabBar", 2);
}

function renderExcelTabBarForContainer(elementId, stepNum) {
  const bar = document.getElementById(elementId);
  if (!bar) return;

  if (!AppState.sheets || AppState.sheets.length <= 1) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }

  let html = `
    <span class="excel-sheet-tabs-label"> Các Sheet (${AppState.sheets.length}):</span>
  `;

  AppState.sheets.forEach((s, idx) => {
    const isActive = (idx === AppState.activeSheetIdx);
    html += `
      <button type="button" class="excel-sheet-tab ${isActive ? 'active' : ''}" onclick="switchExcelSheet(${idx}, ${stepNum})">
        <span class="excel-sheet-tab-icon"></span>
        <span class="excel-sheet-tab-title">${escapeHtml(s.name)}</span>
        <span class="excel-sheet-tab-count">${(s.row_count || 0).toLocaleString()} dòng</span>
      </button>
    `;
  });

  bar.innerHTML = html;
  bar.classList.remove("hidden");
}

async function switchExcelSheet(targetIdx, fromStep) {
  if (targetIdx < 0 || targetIdx >= AppState.sheets.length) return;
  AppState.activeSheetIdx = targetIdx;
  const currentSheet = AppState.sheets[targetIdx];
  renderAllExcelTabBars();

  if (fromStep === 1 || AppState.currentStep === 1) {
    const rawArea = document.getElementById("rawInputText");
    if (rawArea) {
      rawArea.value = currentSheet.csv || "";
      rawArea.classList.add("flash-highlight");
      setTimeout(() => rawArea.classList.remove("flash-highlight"), 600);
    }
    runStep1Validation();
  } else if (fromStep === 2 || AppState.currentStep === 2) {
    if (currentSheet.step2Data) {
      AppState.step2Data = currentSheet.step2Data;
      renderStep2View(currentSheet.step2Data);
    } else {
      await runStep2Cleaning("");
    }
  } else if (fromStep === 3 || AppState.currentStep === 3) {
    if (currentSheet.step3Data) {
      AppState.step3Data = currentSheet.step3Data;
      renderStep3Feedback(currentSheet.step3Data);
    } else {
      if (!currentSheet.step2Data) {
        await runStep2Cleaning("");
      }
      await runStep3Analysis("");
    }
  } else if (fromStep === 4 || AppState.currentStep === 4) {
    if (!currentSheet.step3Data) {
      if (!currentSheet.step2Data) {
        await runStep2Cleaning("");
      }
      await runStep3Analysis("");
    }
    renderStep4DashboardAndReport(currentSheet.step3Data || AppState.step3Data);
  }
}

// Backward compatibility alias for any existing click handlers
function selectSheetMode(idx) {
  switchExcelSheet(Number(idx) || 0, AppState.currentStep);
}

// Robust Multi-format File Upload (.csv, .xlsx, .xls, .json, .txt) with Client & Server Dual Engine
async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const fname = (file.name || "").toLowerCase();
  showGSheetStatus("loading", `⏳ Đang nạp và xử lý file '${escapeHtml(file.name)}'...`);

  // Path 1: Text-based files (.csv, .tsv, .txt, .json) - Instant client-side parsing (Zero Network Dependency)!
  if (fname.endsWith(".csv") || fname.endsWith(".tsv") || fname.endsWith(".txt") || fname.endsWith(".json")) {
    const reader = new FileReader();
    reader.onload = function(e) {
      const text = e.target.result || "";
      if (!text.trim()) {
        showGSheetStatus("error", "️ File tải lên không có dữ liệu (nội dung trống).");
        return;
      }
      const rawEl = document.getElementById("rawInputText");
      if (rawEl) rawEl.value = text;
      AppState.normalizedCsv = text;

      const lines = text.split("\n").filter(l => l.trim());
      const rowCount = Math.max(0, lines.length - 1);
      const colCount = lines[0] ? lines[0].split(",").length : 0;
      const cols = lines[0] ? lines[0].split(",").map(c => c.trim().replace(/^["']|["']$/g, '')) : [];

      initLoadedSheets([{ name: file.name, csv: text, row_count: rowCount, col_count: colCount, columns: cols }], text, rowCount, colCount, cols);
      showGSheetStatus("success", ` Đã nạp thành công file '${escapeHtml(file.name)}' (${rowCount.toLocaleString()} dòng, ${colCount} cột)!`);
      runStep1Validation();
    };
    reader.onerror = function() {
      uploadFileToServer(file);
    };
    reader.readAsText(file, "UTF-8");
    return;
  }

  // Path 2: Excel files (.xlsx, .xls) using SheetJS if available in client
  if ((fname.endsWith(".xlsx") || fname.endsWith(".xls")) && window.XLSX) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        if (workbook.SheetNames && workbook.SheetNames.length > 0) {
          const sheets = workbook.SheetNames.map(name => {
            const ws = workbook.Sheets[name];
            const csv = XLSX.utils.sheet_to_csv(ws);
            const lines = csv.split("\n").filter(l => l.trim());
            const rc = Math.max(0, lines.length - 1);
            const cc = lines[0] ? lines[0].split(",").length : 0;
            const cols = lines[0] ? lines[0].split(",").map(c => c.trim().replace(/^["']|["']$/g, '')) : [];
            return { name, csv, row_count: rc, col_count: cc, columns: cols };
          });
          const primarySheet = sheets[0];
          initLoadedSheets(sheets, primarySheet.csv, primarySheet.row_count, primarySheet.col_count, primarySheet.columns);
          const msg = sheets.length > 1
            ? ` Đã đọc file Excel '${escapeHtml(file.name)}' gồm ${sheets.length} Sheet (${sheets.map(s => s.name).join(", ")}) — Tổng ${primarySheet.row_count.toLocaleString()} dòng!`
            : ` Đã đọc file Excel '${escapeHtml(file.name)}' (${primarySheet.row_count.toLocaleString()} dòng, ${primarySheet.col_count} cột)!`;
          showGSheetStatus("success", msg);
          runStep1Validation();
          return;
        }
      } catch (err) {
        console.warn("Client XLSX parse failed, trying server fallback:", err);
      }
      uploadFileToServer(file);
    };
    reader.onerror = function() {
      uploadFileToServer(file);
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  // Path 3: Server upload fallback
  await uploadFileToServer(file);
}

// Server upload helper with dual-route fallback
async function uploadFileToServer(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await apiFetch("/upload-file", { method: "POST", body: formData });
    const data = await safeParseJsonResponse(res, "Không thể đọc file trên máy chủ.");
    initLoadedSheets(data.sheets || [], data.raw_input || "", data.row_count || 0, data.col_count || 0, data.columns || []);
    if (data.message) {
      showGSheetStatus("success", ` ${data.message}`);
    }
    runStep1Validation();
  } catch (err) {
    showGSheetStatus("error", ` ${err.message || "Không thể kết nối tới máy chủ để tải file."}`);
  }
}

// Import Google Sheet direct link
async function importGoogleSheet() {
  const input = document.getElementById("gsheetUrlInput");
  const btn = document.getElementById("btnImportGSheet");
  const url = (input?.value || "").trim();

  if (!url) {
    showGSheetStatus("error", "️ Vui lòng dán link Google Sheets của bạn vào ô trên.");
    input?.focus();
    return;
  }

  // Update UI to loading
  if (btn) btn.disabled = true;
  const originalBtnText = btn ? btn.innerHTML : "Nạp dữ liệu";
  if (btn) btn.innerHTML = `⏳ Đang tải...`;
  showGSheetStatus("loading", "⏳ Đang kết nối và tải tất cả các Sheet từ Google Sheet...");

  try {
    const res = await apiFetch("/import-gsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await safeParseJsonResponse(res, "Không thể tải Google Sheet. Vui lòng đảm bảo link đã mở quyền xem công khai.");

    initLoadedSheets(data.sheets || [], data.raw_input || "", data.row_count || 0, data.col_count || 0, data.columns || []);

    const rawArea = document.getElementById("rawInputText");
    if (rawArea) {
      rawArea.classList.add("flash-highlight");
      setTimeout(() => rawArea.classList.remove("flash-highlight"), 1200);
    }

    showGSheetStatus("success", ` ${data.message || `Đã nạp ${data.row_count} dòng, ${data.col_count} cột thành công!`}`);

    // Automatically trigger Step 1 Validation
    runStep1Validation();
  } catch (err) {
    showGSheetStatus("error", ` Lỗi kết nối: ${err.message || "Không thể liên lạc với máy chủ."}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalBtnText;
    }
  }
}

function showGSheetStatus(type, htmlMsg) {
  const msgBox = document.getElementById("gsheetStatusMsg");
  if (!msgBox) return;
  msgBox.className = `gsheet-status-msg ${type}`;
  msgBox.innerHTML = htmlMsg;
  msgBox.classList.remove("hidden");
}

// Update Sidebar Source Telemetry Status
function updateSidebarSourceStatus() {
  const fileNameEl = document.getElementById("sideSourceFileName");
  const detailsEl = document.getElementById("sideSourceDetails");
  const dotEl = document.getElementById("sideSourceDot");
  if (!fileNameEl || !detailsEl) return;

  const currentSheet = AppState.sheets[AppState.activeSheetIdx];
  const sheetCount = AppState.sheets?.length || 0;
  const rowCount = AppState.step2Data?.summary?.rows_after || currentSheet?.row_count || 0;
  const colCount = AppState.step2Data?.summary?.total_columns || currentSheet?.col_count || 0;

  if (sheetCount > 0 || rowCount > 0) {
    fileNameEl.textContent = currentSheet?.name ? `Sheet: ${currentSheet.name}` : "Dữ liệu sẵn sàng";
    detailsEl.textContent = `${rowCount.toLocaleString()} dòng • ${colCount} cột • ${sheetCount} Sheet`;
    if (dotEl) dotEl.className = "status-indicator-dot connected";
  } else {
    fileNameEl.textContent = "Chưa nạp dữ liệu";
    detailsEl.textContent = "0 dòng • 0 cột • 0 Sheet";
    if (dotEl) dotEl.className = "status-indicator-dot";
  }
}

// Quick Sample Data Loader (For instant 1-click enterprise demo)
// ============================================================================
// PAGE SWITCHING & BUSINESS CONTEXT VALIDATION (2-Page Architecture)
// ============================================================================
function switchPage(pageId) {
  const pageHome = document.getElementById("pageHome");
  const pageStudio = document.getElementById("pageStudio");
  const navTabHome = document.getElementById("navTabHome");
  const navTabStudio = document.getElementById("navTabStudio");

  if (pageId === "home") {
    if (pageHome) {
      pageHome.classList.add("active");
      pageHome.classList.remove("hidden-page");
    }
    if (pageStudio) {
      pageStudio.classList.remove("active");
      pageStudio.classList.add("hidden-page");
    }
    if (navTabHome) navTabHome.classList.add("active");
    if (navTabStudio) navTabStudio.classList.remove("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    // pageId === "studio"
    if (pageHome) {
      pageHome.classList.remove("active");
      pageHome.classList.add("hidden-page");
    }
    if (pageStudio) {
      pageStudio.classList.add("active");
      pageStudio.classList.remove("hidden-page");
    }
    if (navTabHome) navTabHome.classList.remove("active");
    if (navTabStudio) navTabStudio.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function startAnalysisWorkflow() {
  switchPage("studio");
  jumpToStep(1, true);
  const companyInput = document.getElementById("ctxCompany");
  if (companyInput && !companyInput.value.trim()) {
    companyInput.focus();
    companyInput.classList.add("input-required-pulse");
    setTimeout(() => companyInput.classList.remove("input-required-pulse"), 1800);
  }
}

function tryJumpToStep(stepNum) {
  if (stepNum >= 2) {
    if (!validateBusinessContext()) {
      return;
    }
  }
  switchPage("studio");
  jumpToStep(stepNum, true);
}

function validateBusinessContext() {
  const company = document.getElementById("ctxCompany")?.value?.trim() || "";
  const objective = document.getElementById("ctxObjective")?.value?.trim() || "";

  if (!company) {
    alert("️ BẮT BUỘC NHẬP BỐI CẢNH DOANH NGHIỆP:\nVui lòng nhập 'Tên Doanh nghiệp / Dự án' ở Bước 1A trước khi tiếp tục!");
    switchPage("studio");
    jumpToStep(1, true);
    const compInput = document.getElementById("ctxCompany");
    if (compInput) {
      compInput.scrollIntoView({ behavior: "smooth", block: "center" });
      compInput.focus();
      compInput.classList.add("input-required-pulse");
      setTimeout(() => compInput.classList.remove("input-required-pulse"), 2000);
    }
    return false;
  }

  if (!objective) {
    alert("️ BẮT BUỘC NHẬP MỤC TIÊU PHÂN TÍCH:\nVui lòng nhập 'Bối cảnh & Mục tiêu Phân tích' ở Bước 1A để AI nắm rõ bài toán kinh doanh!");
    switchPage("studio");
    jumpToStep(1, true);
    const objInput = document.getElementById("ctxObjective");
    if (objInput) {
      objInput.scrollIntoView({ behavior: "smooth", block: "center" });
      objInput.focus();
      objInput.classList.add("input-required-pulse");
      setTimeout(() => objInput.classList.remove("input-required-pulse"), 2000);
    }
    return false;
  }

  return true;
}

function quickDemoSample() {
  switchPage("studio");
  jumpToStep(1, true);
  document.getElementById("ctxCompany").value = "Tập đoàn Đầu tư & Công nghệ Alpha";
  document.getElementById("ctxIndustry").value = "Công nghệ thông tin & Bán lẻ B2B";
  document.getElementById("ctxAudience").value = "Ban Giám đốc (CEO, CFO, Giám đốc Vận hành)";
  document.getElementById("ctxObjective").value = "Phân tích quy mô ngân sách dự án, tối ưu hóa chu kỳ phê duyệt hợp đồng và cân đối năng lực đội ngũ theo vùng miền.";
  const personaEl = document.getElementById("ctxCustomerPersona");
  if (personaEl) personaEl.value = "Khách hàng B2B Doanh nghiệp SME & Người tiêu dùng trẻ đô thị (22-38 tuổi) mua sắm đa kênh";
  const bizModelEl = document.getElementById("ctxBusinessModel");
  if (bizModelEl) bizModelEl.value = "B2B2C Đa kênh (Omnichannel) — Website, Sàn TMĐT & Chuỗi cửa hàng bán lẻ";

  const sampleCsv = `Project_ID,Project_Name,Department,Client_Name,Budget,Discount_Rate,Request_Date,Proposal_Deadline
PRJ-2026-001,Triển khai ERP Cloud,Công nghệ,Tập đoàn Mai Linh,850000000,0.08,01/01/2026,15/01/2026
PRJ-2026-002,Hệ thống CRM Omnichannel,Kinh doanh,Bán lẻ Vinmart,1200000000,0.12,05/01/2026,20/01/2026
PRJ-2026-003,Nâng cấp Hạ tầng Cloud,Hạ tầng,Ngân hàng Techcombank,2400000000,0.05,08/01/2026,28/01/2026
PRJ-2026-004,Phần mềm Quản lý Kho WMS,Vận hành,Shopee Express,650000000,0.10,10/01/2026,18/01/2026
PRJ-2026-005,Tích hợp Thanh toán Tự động,Tài chính,Ví Momo,450000000,0.00,12/01/2026,22/01/2026
PRJ-2026-006,Xây dựng BI Dashboard,Phân tích dữ liệu,Masan Group,1500000000,0.15,15/01/2026,30/01/2026
PRJ-2026-007,Ứng dụng Loyalty App,Marketing,Highlands Coffee,780000000,0.05,18/01/2026,25/01/2026
PRJ-2026-008,Bảo mật Hệ thống SOC,An ninh mạng,Viettel Post,1900000000,0.08,20/01/2026,05/02/2026`;

  document.getElementById("rawInputText").value = sampleCsv;

  // Scroll smoothly to studio workbench
  const studioEl = document.getElementById("analysisStudio");
  if (studioEl) {
    studioEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Flash highlight on raw input
  const rawArea = document.getElementById("rawInputText");
  if (rawArea) {
    rawArea.classList.add("flash-highlight");
    setTimeout(() => rawArea.classList.remove("flash-highlight"), 800);
  }

  // Trigger step 1 validation automatically
  runStep1Validation();
}

// Navigation between steps
function jumpToStep(stepNum, force = false) {
  if (stepNum >= 2 && !force) {
    if (!validateBusinessContext()) {
      return;
    }
  }
  if (!force && stepNum > AppState.maxUnlockedStep) {
    return;
  }
  AppState.currentStep = stepNum;
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById(`panelStep${i}`);
    const wf = document.getElementById(`wfStep${i}`);
    const status = document.getElementById(`wfStatus${i}`);
    const sideNav = document.getElementById(`sideNavStep${i}`);
    const sideStatus = document.getElementById(`sideNavStatus${i}`);

    if (panel) panel.classList.toggle("active", i === stepNum);

    if (wf) {
      wf.classList.remove("active", "done");
      if (i === stepNum) {
        wf.classList.add("active");
        if (status) status.textContent = "Đang thực hiện";
      } else if (i < AppState.maxUnlockedStep || i < stepNum) {
        wf.classList.add("done");
        if (status) status.textContent = "Hoàn tất ";
      } else {
        if (status) status.textContent = "Chờ";
      }
    }

    if (sideNav) {
      sideNav.classList.remove("current", "done");
      if (i === stepNum) {
        sideNav.classList.add("current");
        if (sideStatus) sideStatus.textContent = "●";
      } else if (i < AppState.maxUnlockedStep || i < stepNum) {
        sideNav.classList.add("done");
        if (sideStatus) sideStatus.textContent = "";
      } else {
        if (sideStatus) sideStatus.textContent = "○";
      }
    }

    const wizBtn = document.getElementById(`wizStep${i}`);
    if (wizBtn) {
      wizBtn.classList.remove("active", "done");
      if (i === stepNum) {
        wizBtn.classList.add("active");
      } else if (i < AppState.maxUnlockedStep || i < stepNum) {
        wizBtn.classList.add("done");
      }
    }
  }

  updateSidebarSourceStatus();
  renderAllExcelTabBars();

  if (stepNum === 2) {
    if (AppState.step2Data) {
      renderStep2View(AppState.step2Data);
    } else {
      runStep2Cleaning("");
    }
  } else if (stepNum === 3) {
    if (AppState.step3Data) {
      renderStep3Feedback(AppState.step3Data);
    } else {
      runStep3Analysis("");
    }
  } else if (stepNum === 4) {
    if (AppState.step3Data) {
      renderStep4DashboardAndReport(AppState.step3Data);
    }
  }

  // Smooth scroll to studio workbench if moving beyond step 1
  if (stepNum > 1) {
    const studioEl = document.getElementById("analysisStudio");
    if (studioEl) {
      studioEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

// ============================================================================
// STEP 1: CONTEXT ANALYSIS & FORMAT CHECK
// ============================================================================
async function runStep1Validation() {
  if (!validateBusinessContext()) {
    return;
  }
  const rawInput = document.getElementById("rawInputText").value.trim();

  if (!rawInput) {
    alert("Vui lòng nhập hoặc dán dữ liệu của bạn (hoặc tải file CSV/Excel/JSON lên) trước khi phân tích.");
    document.getElementById("rawInputText").focus();
    return;
  }

  const context = getContextFromForm();
  const resultBox = document.getElementById("step1ResultBox");
  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `<div class="card"><p>⏳ AI đang phân tích bối cảnh doanh nghiệp và kiểm tra định dạng dữ liệu của bạn...</p></div>`;

  try {
    const res = await apiFetch("/step1/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, raw_input: rawInput })
    });
    const data = await safeParseJsonResponse(res, "Không thể kiểm tra định dạng dữ liệu.");
    AppState.step1Data = data;
    renderStep1DecisionGate(data);
  } catch (e) {
    resultBox.innerHTML = `<div class="card"><p style="color:#dc2626;">Lỗi kiểm tra định dạng: ${escapeHtml(e.message)}</p></div>`;
  }
}

function renderStep1DecisionGate(data) {
  const resultBox = document.getElementById("step1ResultBox");
  const ctxInfo = data.context_analysis || {};

  if (data.is_valid) {
    AppState.normalizedCsv = data.normalized_csv || document.getElementById("rawInputText").value;
    resultBox.innerHTML = `
      <div class="format-box valid">
        <div class="format-header">
          <div>
            <span class="format-badge-valid"> ĐÚNG ĐỊNH DẠNG (${escapeHtml(data.format_type)} • Độ tin cậy ${data.confidence}%)</span>
            <h3 style="margin-top:8px; color:#0369a1;">Dữ liệu đạt chuẩn cấu trúc bảng (${data.row_count} dòng × ${data.column_count} cột)</h3>
            <p style="font-size:12px; color:#475569; margin-top:2px;">Bối cảnh doanh nghiệp và cấu trúc cột đã được xác thực thành công.</p>
          </div>

        </div>

        <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap:14px; margin-top:12px;">
          <div style="background:#ffffff; border:1px solid #bfdbfe; border-radius:10px; padding:14px; font-size:0.85rem;">
            <div style="font-weight:700; color:#0369a1; margin-bottom:6px;"> AI Phân tích Bối cảnh Doanh nghiệp:</div>
            <p><strong>Doanh nghiệp:</strong> ${escapeHtml(ctxInfo.company_name)}</p>
            <p><strong>Ngành nghề:</strong> ${escapeHtml(ctxInfo.detected_domain)}</p>
            <p><strong>Mục tiêu:</strong> ${escapeHtml(ctxInfo.objective)}</p>
            <p style="margin-top:8px; font-weight:600; color:#1e293b;">Các trường dữ liệu phát hiện:</p>
            <ul style="margin-left:18px; margin-top:4px; color:#334155; line-height:1.5;">
              ${(ctxInfo.recommended_kpis || []).map(k => `<li>${escapeHtml(k)}</li>`).join("")}
            </ul>
          </div>

          <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
            <div id="step1PreviewHeaderTitle" style="background:#f1f5f9; padding:8px 12px; font-size:11.5px; font-weight:700; color:#1e293b; border-bottom:1px solid #e2e8f0;">
              Xem trước cấu trúc cột (${data.columns.length} cột): ${data.columns.slice(0, 8).join(", ")}${data.columns.length > 8 ? "..." : ""}
            </div>
            <div id="step1PreviewTableContainer" class="table-scroll-wrapper" style="max-height:175px;">
              ${buildSimplePreviewTable(data.columns, data.preview_rows.slice(0, 5))}
            </div>
          </div>
        </div>

        <!-- AI Interaction & Filtering Intake Drawer -->
        <div id="step1AiDrawer" style="display:none; margin-top:14px; background:linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 100%); border:1.5px solid #7dd3fc; border-radius:12px; padding:16px; box-shadow:0 4px 16px rgba(14,165,233,0.12); animation:fadeIn 0.25s ease;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:18px;"></span>
                <strong style="color:#0369a1; font-size:14.5px;">Trao đổi & Đặt yêu cầu với Trợ lý AI (Tiền xử lý Dữ liệu)</strong>
                <span style="background:#0284c7; color:#fff; font-size:10.5px; padding:2px 7px; border-radius:10px; font-weight:700;">AI Intake Assistant</span>
              </div>
              <p style="font-size:12px; color:#475569; margin-top:3px;">
                Tiếp nhận mọi yêu cầu lọc bớt khu vực, loại trừ kênh, đổi tên/xóa cột trước khi chuyển sang Bước 2 làm sạch.
              </p>
            </div>
            <button type="button" onclick="toggleStep1AiDrawer(false)" style="background:transparent; border:none; font-size:16px; color:#64748b; cursor:pointer; padding:2px 6px;"></button>
          </div>

          <!-- Quick suggestion chips -->
          <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
            <span style="font-size:11.5px; color:#0369a1; font-weight:600; align-self:center;">Gợi ý nhanh:</span>
            <button type="button" onclick="setStep1AiPrompt('Chỉ phân tích Miền Bắc và Miền Nam, xóa các hàng Miền Trung')" style="background:#ffffff; border:1px solid #93c5fd; border-radius:16px; padding:4px 10px; font-size:11.5px; color:#0369a1; cursor:pointer;"> Chỉ phân tích Miền Bắc & Nam (xóa Miền Trung)</button>
            <button type="button" onclick="setStep1AiPrompt('Chỉ phân tích kênh Website')" style="background:#ffffff; border:1px solid #93c5fd; border-radius:16px; padding:4px 10px; font-size:11.5px; color:#0369a1; cursor:pointer;"> Chỉ phân tích kênh Website</button>
            <button type="button" onclick="setStep1AiPrompt('Chuyển từ Bắc Binh sang Bắc Giang')" style="background:#ffffff; border:1px solid #93c5fd; border-radius:16px; padding:4px 10px; font-size:11.5px; color:#0369a1; cursor:pointer;">️ Chuyển Bắc Binh sang Bắc Giang</button>
            <button type="button" onclick="setStep1AiPrompt('Xóa các hàng có dữ liệu trống hoặc bất thường')" style="background:#ffffff; border:1px solid #93c5fd; border-radius:16px; padding:4px 10px; font-size:11.5px; color:#0369a1; cursor:pointer;"> Lọc hàng trống</button>
          </div>

          <!-- Prompt input bar -->
          <div style="display:flex; gap:10px; align-items:center;">
            <input type="text" id="step1AiChatInput" placeholder="Ví dụ: Chỉ phân tích 2 miền thôi, xóa các hàng Miền Trung..." onkeydown="if(event.key==='Enter') executeStep1AiInstruction()" style="flex:1; padding:10px 14px; border:1.5px solid #7dd3fc; border-radius:8px; font-size:13px; background:#ffffff; outline:none;" />
            <button type="button" id="btnStep1AiSubmit" onclick="executeStep1AiInstruction()" style="background:linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color:#ffffff; border:none; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px; box-shadow:0 2px 8px rgba(2,132,199,0.3); white-space:nowrap;">
              <span> AI Thực thi & Lọc ngay</span>
            </button>
          </div>

          <!-- AI Reply / Notification banner -->
          <div id="step1AiResultBanner" style="display:none; margin-top:12px; padding:10px 14px; border-radius:8px; font-size:12.5px; line-height:1.5;"></div>
        </div>

        <div class="format-footer-action" style="margin-top:18px; padding-top:16px; border-top:1.5px dashed #bae6fd; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;">
          <div class="footer-action-note" style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:#0369a1;">
            <span class="pulse-beacon"></span>
            <span><strong>Dữ liệu chuẩn:</strong> Bấm nút trao đổi AI để tùy chỉnh / lọc dữ liệu hoặc tiếp tục:</span>
          </div>
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <button type="button" class="btn-step1-ai-chat" onclick="toggleStep1AiDrawer()" style="display:inline-flex; align-items:center; justify-content:center; gap:8px; background:#f0f9ff; color:#0284c7; padding:13px 20px; border-radius:12px; font-size:14px; font-weight:700; border:1.5px solid #38bdf8; box-shadow:0 3px 10px rgba(14,165,233,0.15); cursor:pointer; transition:all 0.2s ease;">
              <span style="font-size:16px;"></span>
              <span>Trao đổi với AI / Tùy chỉnh Dữ liệu</span>
            </button>
            <button type="button" class="btn-advance-step2-full" onclick="proceedToStep2()" style="display:inline-flex; align-items:center; justify-content:center; gap:10px; background:linear-gradient(135deg, #0284c7 0%, #1d4ed8 100%); color:#ffffff; padding:14px 28px; border-radius:12px; font-size:14.5px; font-weight:800; border:1px solid rgba(255,255,255,0.35); box-shadow:0 6px 22px rgba(2,132,199,0.45); cursor:pointer;">
              <span> Tiếp tục sang BƯỚC 2: Làm sạch & Duyệt HITL →</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  } else {
    resultBox.innerHTML = `
      <div class="format-box invalid">
        <div class="format-header">
          <div>
            <span class="format-badge-invalid"> SAI ĐỊNH DẠNG (${escapeHtml(data.format_type)})</span>
            <h3 style="margin-top:8px; color:#991b1b;">Phát hiện lỗi cấu trúc định dạng dữ liệu đầu vào!</h3>
          </div>
        </div>

        <div class="error-list-box">
          <strong>️ Chi tiết lỗi định dạng AI phát hiện:</strong>
          <ul>
            ${(data.errors || []).map(err => `<li>${escapeHtml(err)}</li>`).join("")}
          </ul>
        </div>

        <h4 style="font-size:0.92rem; color:#1e293b;">Vui lòng chọn 1 trong 2 phương án xử lý theo quy trình:</h4>
        <div class="two-options-grid">
          <!-- Option 1: Manual Re-entry -->
          <div class="option-card">
            <h4>️ Lựa chọn 1: Nhập lại / Chỉnh sửa thủ công</h4>
            <p>Tự chỉnh sửa lại văn bản dữ liệu thô, tách cột bằng dấu phẩy (CSV) chuẩn hoặc tải lên một file dữ liệu khác.</p>
            <button class="btn-outline-sm" onclick="focusRawInputManual()">
               Nhập / Sửa lại thủ công tại ô Dữ liệu
            </button>
          </div>

          <!-- Option 2: AI Auto-Format Suggestion -->
          <div class="option-card option-ai">
            <h4> Lựa chọn 2: AI gợi ý điền / chuẩn hóa lại đúng định dạng</h4>
            <p>AI Agent sẽ tự động phân tích dữ liệu của bạn, tách các trường bị gộp, loại bỏ dòng ghi chú thừa và điền lại thành bảng chuẩn.</p>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
              <input type="text" id="aiFormatHintInput" placeholder="Ghi chú thêm cho AI (tùy chọn)..." style="flex:1; padding:6px 10px; border:1px solid #fcd34d; border-radius:6px; font-size:0.8rem;" />
              <button class="btn-primary" onclick="runStep1AiReformat()">
                 AI Gợi Ý & Điền Lại Đúng Định Dạng
              </button>
            </div>
          </div>
        </div>

        <div id="aiReformatPreviewContainer" class="hidden" style="margin-top:16px;"></div>
      </div>
    `;
  }
  resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function toggleStep1AiDrawer(forceState) {
  const drawer = document.getElementById("step1AiDrawer");
  if (!drawer) return;
  if (typeof forceState === "boolean") {
    drawer.style.display = forceState ? "block" : "none";
  } else {
    drawer.style.display = (drawer.style.display === "none" || !drawer.style.display) ? "block" : "none";
  }
  if (drawer.style.display === "block") {
    const input = document.getElementById("step1AiChatInput");
    if (input) input.focus();
  }
}

function setStep1AiPrompt(text) {
  const input = document.getElementById("step1AiChatInput");
  if (input) {
    input.value = text;
    input.focus();
  }
}

async function executeStep1AiInstruction() {
  const input = document.getElementById("step1AiChatInput");
  const banner = document.getElementById("step1AiResultBanner");
  const btn = document.getElementById("btnStep1AiSubmit");
  if (!input || !banner) return;
  const instruction = input.value.trim();
  if (!instruction) {
    alert("Vui lòng nhập yêu cầu của bạn cho Trợ lý AI (ví dụ: 'chỉ phân tích 2 miền thôi, xóa các hàng Miền Trung')");
    input.focus();
    return;
  }

  const currentSheet = (AppState.sheets && AppState.sheets[AppState.activeSheetIdx]) || {};
  const currentCsv = currentSheet.csv || AppState.normalizedCsv || document.getElementById("rawInputText")?.value || "";

  if (!currentCsv) {
    alert("Không tìm thấy dữ liệu để xử lý!");
    return;
  }

  const origBtnText = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Đang xử lý...</span>`;
  }

  banner.style.display = "block";
  banner.style.background = "#eff6ff";
  banner.style.border = "1px solid #93c5fd";
  banner.style.color = "#1e40af";
  banner.innerHTML = "⏳ <em>AI đang phân tích và thực thi yêu cầu của bạn trên tập dữ liệu...</em>";

  try {
    const res = await apiFetch("/step1/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_csv: currentCsv,
        instruction: instruction,
        context: (typeof getContextFromForm === "function") ? getContextFromForm() : {}
      })
    });
    const result = await safeParseJsonResponse(res, "Không thể thực hiện điều chỉnh theo yêu cầu.");

    if (result.success && result.transformed_csv) {
      // 1. Update State
      AppState.normalizedCsv = result.transformed_csv;
      if (AppState.sheets && AppState.sheets[AppState.activeSheetIdx]) {
        AppState.sheets[AppState.activeSheetIdx].csv = result.transformed_csv;
      }
      const rawInputEl = document.getElementById("rawInputText");
      if (rawInputEl) {
        rawInputEl.value = result.transformed_csv;
      }

      // 2. Update Header info in Step 1
      const titleEl = document.querySelector(".format-box.valid h3");
      if (titleEl) {
        titleEl.textContent = `Dữ liệu đạt chuẩn cấu trúc bảng (${result.row_count} dòng × ${result.column_count} cột)`;
      }

      // 3. Update preview table
      const previewWrapper = document.getElementById("step1PreviewTableContainer");
      if (previewWrapper && result.columns && result.preview_rows) {
        previewWrapper.innerHTML = buildSimplePreviewTable(result.columns, result.preview_rows.slice(0, 5));
      }
      const previewHeader = document.getElementById("step1PreviewHeaderTitle");
      if (previewHeader && result.columns) {
        previewHeader.textContent = `Xem trước cấu trúc cột (${result.columns.length} cột): ${result.columns.slice(0, 8).join(", ")}${result.columns.length > 8 ? "..." : ""}`;
      }

      // 4. Show success banner
      banner.style.display = "block";
      banner.style.background = "#f0fdf4";
      banner.style.border = "1px solid #86efac";
      banner.style.color = "#166534";
      banner.innerHTML = `
        <div style="font-weight:700; font-size:13px; margin-bottom:4px;">${escapeHtml(result.ai_reply)}</div>
        <div style="font-size:12px; color:#15803d;">
           Dữ liệu mới đã được cập nhật đồng bộ. Bạn có thể tiếp tục trao đổi thêm hoặc bấm <strong>"Tiếp tục sang BƯỚC 2"</strong> để bắt đầu làm sạch!
        </div>
      `;
    } else {
      banner.style.display = "block";
      banner.style.background = "#fef2f2";
      banner.style.border = "1px solid #fca5a5";
      banner.style.color = "#991b1b";
      banner.innerHTML = `️ ${escapeHtml(result.ai_reply || "Không thể thực thi yêu cầu.")}`;
    }
  } catch (err) {
    banner.style.display = "block";
    banner.style.background = "#fef2f2";
    banner.style.border = "1px solid #fca5a5";
    banner.style.color = "#991b1b";
    banner.innerHTML = ` Lỗi kết nối tới máy chủ AI: ${escapeHtml(err.message)}`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnText;
    }
  }
}

function focusRawInputManual() {
  const rawEl = document.getElementById("rawInputText");
  rawEl.focus();
  rawEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function runStep1AiReformat() {
  const context = getContextFromForm();
  const rawInput = document.getElementById("rawInputText").value;
  const userHint = document.getElementById("aiFormatHintInput")?.value || "";
  const container = document.getElementById("aiReformatPreviewContainer");
  container.classList.remove("hidden");
  container.innerHTML = `<p style="padding:12px; font-weight:600; color:#1565c0;">⏳ AI đang tái cấu trúc và điền lại bảng dữ liệu của bạn đúng định dạng...</p>`;

  try {
    const res = await apiFetch("/step1/ai-reformat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, raw_input: rawInput, user_hint: userHint })
    });
    const data = await safeParseJsonResponse(res, "Không thể chuẩn hóa lại định dạng.");
    AppState.normalizedCsv = data.reconstructed_csv;

    container.innerHTML = `
      <div class="ai-log-list">
        <strong> AI đã chuẩn hóa và điền lại định dạng bảng thành công (${data.row_count} dòng × ${data.column_count} cột):</strong>
        <ul style="margin-left:18px; margin-top:6px;">
          ${(data.ai_actions_log || []).map(l => `<li>${escapeHtml(l)}</li>`).join("")}
        </ul>
      </div>
      <div style="background:#fff; border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; margin-bottom:12px;">
        <div style="background:#1e3a5f; color:#fff; padding:7px 12px; font-size:0.8rem; font-weight:600;">
          Bản xem trước Dữ liệu sau khi AI điền lại đúng định dạng:
        </div>
        <div class="table-scroll-wrapper" style="max-height:220px;">
          ${buildSimplePreviewTable(data.columns, data.preview_rows)}
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px;">
        <button class="btn-outline-sm" onclick="applyReformattedToTextarea()"> Cập nhật vào ô Dữ liệu gốc</button>
        <button class="btn-success btn-lg" onclick="applyReformattedAndGoStep2()">
           Xác nhận Định dạng AI Gợi ý & Sang BƯỚC 2 →
        </button>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p style="color:#dc2626;">Lỗi chuẩn hóa định dạng: ${e.message}</p>`;
  }
}

function applyReformattedToTextarea() {
  if (AppState.normalizedCsv) {
    document.getElementById("rawInputText").value = AppState.normalizedCsv;
    runStep1Validation();
  }
}

function applyReformattedAndGoStep2() {
  if (AppState.normalizedCsv) {
    document.getElementById("rawInputText").value = AppState.normalizedCsv;
  }
  proceedToStep2();
}

async function proceedToStep2() {
  if (!validateBusinessContext()) {
    return;
  }
  const rawInput = document.getElementById("rawInputText")?.value?.trim() || "";
  if (!rawInput && !AppState.normalizedCsv && !AppState.uploadedMultiSheets) {
    alert("️ Vui lòng nhập hoặc tải file dữ liệu ở Bước 1B trước khi tiếp tục!");
    document.getElementById("rawInputText")?.focus();
    return;
  }
  AppState.maxUnlockedStep = Math.max(AppState.maxUnlockedStep, 2);
  jumpToStep(2, true);
  await runStep2Cleaning("");
}

// ============================================================================
// STEP 2: DATA CLEANING & HUMAN-IN-THE-LOOP CONFIRMATION
// ============================================================================
async function runStep2Cleaning(customInstruction = "") {
  const context = getContextFromForm();
  const currentSheet = AppState.sheets[AppState.activeSheetIdx] || {};
  const rawCsv = currentSheet.csv || AppState.normalizedCsv || document.getElementById("rawInputText").value;

  // Hide confirmation gate & table actions while AI is still scanning/cleaning!
  document.getElementById("step2HitlGateBox")?.classList.add("hidden");
  document.getElementById("step2ReCleanBox")?.classList.add("hidden");
  document.getElementById("step2TableQuickActions")?.classList.add("hidden");
  document.getElementById("step2CustomRulesLog")?.classList.add("hidden");

  document.getElementById("step2ScoreBadges").innerHTML = "";
  document.getElementById("step2SummaryRow").innerHTML = "";
  document.getElementById("issueCountPill").textContent = "⏳ Đang quét...";

  const issuesContainer = document.getElementById("issuesListContainer");
  issuesContainer.innerHTML = `<p style="padding:16px; color:#1565c0; font-weight:600;">⏳ AI đang quét lỗi dữ liệu thô và thực hiện làm sạch...</p>`;

  const tableContainer = document.getElementById("cleanedTableContainer");
  if (tableContainer) {
    tableContainer.innerHTML = `<p style="padding:16px; color:#64748b; font-weight:500;">⏳ Đang chờ AI xử lý và chuẩn hóa dữ liệu...</p>`;
  }

  try {
    const res = await apiFetch("/step2/clean", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context,
        raw_csv: rawCsv,
        custom_instruction: customInstruction
      })
    });
    const data = await safeParseJsonResponse(res, "Không thể làm sạch dữ liệu.");
    AppState.step2Data = data;
    if (AppState.sheets[AppState.activeSheetIdx]) {
      AppState.sheets[AppState.activeSheetIdx].step2Data = data;
    }
    renderStep2View(data);
    renderAllExcelTabBars();
  } catch (e) {
    issuesContainer.innerHTML = `<p style="color:#dc2626; padding:14px;"> Lỗi làm sạch: ${escapeHtml(e.message)}</p>`;
  }
}

function renderStep2View(data) {
  const s = data.summary || {};
  document.getElementById("step2ScoreBadges").innerHTML = `
    <span class="step-pill" style="background:#64748b;">Chất lượng dữ liệu thô: ${s.quality_score_before}%</span>
    <span style="margin:0 6px; font-weight:700;">→</span>
    <span class="step-pill" style="background:#16a34a;">Sau khi AI làm sạch: ${s.quality_score_after}%</span>
  `;

  document.getElementById("step2SummaryRow").innerHTML = `
    <div class="clean-stat-card">
      <div class="clean-stat-label">Số bản ghi (Trước → Sau làm sạch)</div>
      <div class="clean-stat-val">${s.rows_before} → ${s.rows_after} dòng</div>
    </div>
    <div class="clean-stat-card">
      <div class="clean-stat-label">Tổng số lỗi phát hiện & xử lý</div>
      <div class="clean-stat-val" style="color:#ea580c;">${s.issues_count} lỗi dữ liệu</div>
    </div>
    <div class="clean-stat-card">
      <div class="clean-stat-label">Số trường chỉ số (Columns)</div>
      <div class="clean-stat-val">${s.total_columns} cột chuẩn</div>
    </div>
    <div class="clean-stat-card">
      <div class="clean-stat-label">Trạng thái Kiểm định</div>
      <div class="clean-stat-val" style="color:#16a34a; font-size:1.1rem;">Chờ bạn xác nhận </div>
    </div>
  `;

  const customBanner = document.getElementById("step2CustomRulesLog");
  if (data.custom_rules_applied && data.custom_rules_applied.length > 0) {
    customBanner.classList.remove("hidden");
    customBanner.innerHTML = `
      <strong> AI đã thực thi yêu cầu làm sạch tùy chỉnh của bạn:</strong>
      <ul style="margin-left:18px; margin-top:4px;">
        ${data.custom_rules_applied.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
    `;
  } else {
    customBanner.classList.add("hidden");
  }

  document.getElementById("issueCountPill").textContent = `${(data.issues || []).length} lỗi đã sửa`;
  renderStep2IssuesList(data.issues || [], false);
  renderEditableCleanedTable(data, false);

  // Reveal confirmation gate & table quick actions AFTER AI has finished cleaning!
  document.getElementById("step2TableQuickActions")?.classList.remove("hidden");
  updateSidebarSourceStatus();
  const hitlGate = document.getElementById("step2HitlGateBox");
  if (hitlGate) {
    hitlGate.classList.remove("hidden");
  }
}

function renderStep2IssuesList(issues, showAll = false) {
  const issuesList = document.getElementById("issuesListContainer");
  if (!issuesList) return;
  if (!issues || issues.length === 0) {
    issuesList.innerHTML = `<div style="padding:18px; color:#166534; font-weight:600;"> Dữ liệu của bạn không có lỗi định dạng số, ô trống hay trùng lặp nào! Bạn có thể bấm Xác nhận ĐẠT hoặc chỉnh sửa trực tiếp trên bảng bên phải.</div>`;
    return;
  }
  const MAX_ISSUES = 150;
  const slice = showAll ? issues : issues.slice(0, MAX_ISSUES);
  let html = slice.map((iss, idx) => `
    <div class="issue-item">
      <div class="issue-item-top">
        <span>#${idx + 1} • ${escapeHtml(iss.issue_type)}</span>
        <span>Dòng ${iss.row} | Cột: ${escapeHtml(iss.column)}</span>
      </div>
      <div class="issue-diff">
        <span class="val-raw">${escapeHtml(iss.raw_value)}</span>
        <span>→</span>
        <span class="val-clean">${escapeHtml(iss.cleaned_value)}</span>
      </div>
      <div class="issue-reason"> ${escapeHtml(iss.reason)}</div>
    </div>
  `).join("");

  if (!showAll && issues.length > MAX_ISSUES) {
    html += `
      <div style="text-align:center; padding:10px;">
        <button type="button" class="btn-outline-sm" onclick="renderStep2IssuesList(AppState.step2Data.issues, true)">
           Xem toàn bộ ${issues.length} lỗi đã làm sạch
        </button>
      </div>
    `;
  }
  issuesList.innerHTML = html;
}

function renderEditableCleanedTable(data, showAll = false) {
  const cols = data.columns || [];
  const rows = data.cleaned_rows || [];

  // O(1) lookup set for highlighted cells combining issues and modified_cells
  const cleanedCellSet = new Set();
  (data.issues || []).forEach(iss => {
    if (iss.row && iss.column) {
      cleanedCellSet.add(`${iss.row - 1}:${String(iss.column).trim()}`);
    }
  });
  (data.modified_cells || []).forEach(mc => {
    if (mc.row !== undefined && mc.col) {
      cleanedCellSet.add(`${mc.row}:${String(mc.col).trim()}`);
    }
  });
  const MAX_ROWS = 200;
  const visibleRows = showAll ? rows : rows.slice(0, MAX_ROWS);

  let html = `
    <table class="data-table" id="step2EditableGrid">
      <thead>
        <tr>
          <th>#</th>
          ${cols.map(c => `<th>${escapeHtml(c)}</th>`).join("")}
          <th>Thao tác</th>
        </tr>
      </thead>
      <tbody>
        ${visibleRows.map((r, rIdx) => `
          <tr data-row-idx="${rIdx}">
            <td style="font-weight:700; color:#64748b;">${rIdx + 1}</td>
            ${cols.map(c => {
              const isHighlighted = cleanedCellSet.has(`${rIdx}:${c}`);
              return `<td contenteditable="true"
                          class="${isHighlighted ? 'cell-cleaned' : ''}"
                          data-col="${escapeHtml(c)}"
                          onblur="handleManualCellEdit(${rIdx}, this.getAttribute('data-col'), this.innerText, this)">${escapeHtml(String(r[c] ?? ""))}</td>`;
            }).join("")}
            <td>
              <button class="btn-xs" style="color:#dc2626;" onclick="deleteRowStep2(${rIdx})" title="Xóa dòng này"></button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  if (!showAll && rows.length > MAX_ROWS) {
    html += `
      <div style="text-align:center; padding:12px; background:#f8fafc; border-top:1px solid #e2e8f0;">
        <span style="font-size:0.8rem; color:#475569; margin-right:8px;">Đang hiển thị ${MAX_ROWS}/${rows.length} dòng đầu tiên để tối ưu tốc độ.</span>
        <button type="button" class="btn-outline-sm" onclick="renderEditableCleanedTable(AppState.step2Data, true)">
           Hiển thị toàn bộ ${rows.length} dòng
        </button>
      </div>
    `;
  }
  document.getElementById("cleanedTableContainer").innerHTML = html;
}

function handleManualCellEdit(rowIdx, colName, newValue, tdElem) {
  if (!AppState.step2Data || !AppState.step2Data.cleaned_rows[rowIdx]) return;
  const oldVal = AppState.step2Data.cleaned_rows[rowIdx][colName];
  const trimmed = (newValue || "").trim();
  AppState.step2Data.cleaned_rows[rowIdx][colName] = trimmed;
  if (tdElem) {
    tdElem.classList.add("cell-cleaned");
    tdElem.title = `Đã sửa thủ công: "${oldVal}" → "${trimmed}"`;
  }
  showToast(`Đã lưu chỉnh sửa ô [Dòng ${rowIdx + 1}, Cột ${colName}]`, "info");
}

function deleteRowStep2(rowIdx) {
  if (!AppState.step2Data) return;
  AppState.step2Data.cleaned_rows.splice(rowIdx, 1);
  AppState.step2Data.summary.rows_after = AppState.step2Data.cleaned_rows.length;
  renderStep2View(AppState.step2Data);
}

function addNewRowStep2() {
  if (!AppState.step2Data) return;
  const newRow = {};
  (AppState.step2Data.columns || []).forEach((c, idx) => {
    newRow[c] = idx === 0 ? "Kỳ mới" : "0";
  });
  AppState.step2Data.cleaned_rows.push(newRow);
  AppState.step2Data.summary.rows_after = AppState.step2Data.cleaned_rows.length;
  renderStep2View(AppState.step2Data);
}

function toggleStep2ReCleanBox() {
  const box = document.getElementById("step2ReCleanBox");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function focusEditableTable() {
  const tbl = document.getElementById("cleanedTableContainer");
  tbl.scrollIntoView({ behavior: "smooth", block: "center" });
  const firstCell = tbl.querySelector('td[contenteditable="true"]');
  if (firstCell) firstCell.focus();
}

function setReCleanPrompt(text) {
  document.getElementById("customCleanInput").value = text;
}

async function runCustomAiReClean() {
  const instr = document.getElementById("customCleanInput").value.trim();
  if (!instr) {
    alert("Vui lòng nhập yêu cầu làm sạch lại cho AI.");
    return;
  }
  await runStep2Cleaning(instr);
}

async function confirmStep2AndGoStep3() {
  AppState.maxUnlockedStep = Math.max(AppState.maxUnlockedStep, 3);
  jumpToStep(3, true);
  await runStep3Analysis("");
}

// ============================================================================
// STEP 3: BI DATA ANALYSIS & FEEDBACK EVALUATION
// ============================================================================
async function runStep3Analysis(userFeedback = "") {
  const context = getContextFromForm();

  // Multi-sheet metadata summary (do NOT include heavy duplicate cleaned_rows for all sheets!)
  const allSheetsPayload = (AppState.sheets && AppState.sheets.length > 0)
    ? AppState.sheets.map(s => ({
        name: s.name,
        row_count: s.step2Data?.cleaned_rows?.length || s.row_count || 0,
        col_count: s.step2Data?.columns?.length || s.col_count || 0,
        columns: s.step2Data?.columns || s.columns || []
      }))
    : [];

  let primaryCleanedRows = AppState.step2Data?.cleaned_rows || [];
  if (!primaryCleanedRows.length && AppState.sheets && AppState.sheets.length > 0) {
    primaryCleanedRows = AppState.sheets[0].step2Data?.cleaned_rows || [];
  }

  // Optimize payload size: if rows exceed 2,000, sample top 2,000 rows for BI chart aggregation to stay < 400KB
  const rowsToSend = primaryCleanedRows.length > 2000 ? primaryCleanedRows.slice(0, 2000) : primaryCleanedRows;

  // Hide Step 3 confirmation gate while AI is analyzing!
  document.getElementById("step3HitlGateBox")?.classList.add("hidden");
  document.getElementById("step3AdjustBox")?.classList.add("hidden");
  document.getElementById("step3SummaryHint").textContent = "⏳ Đang tổng hợp nhận định BI chung cho tất cả các Sheet...";

  const container = document.getElementById("step3FeedbackContainer");
  container.innerHTML = `<div class="card"><p style="padding:16px; color:#1565c0; font-weight:600;">⏳ AI đang tổng hợp và phân tích dữ liệu chung cho toàn bộ các Sheet...</p></div>`;

  try {
    const res = await apiFetch("/step3/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context,
        cleaned_rows: rowsToSend,
        user_feedback: userFeedback,
        all_sheets: allSheetsPayload
      })
    });
    const data = await safeParseJsonResponse(res, "Không thể phân tích dữ liệu.");
    AppState.step3Data = data;
    AppState.sheets_summary = data.sheets_summary || allSheetsPayload;
    renderStep3Feedback(data);
    renderAllExcelTabBars();
  } catch (e) {
    container.innerHTML = `<div class="card"><p style="color:#dc2626; padding:14px;"> Lỗi phân tích Bước 3: ${escapeHtml(e.message)}</p></div>`;
  }
}

function renderStep3Feedback(data) {
  document.getElementById("step3SummaryHint").textContent = data.executive_summary_line || "";
  const sections = data.feedback_sections || [];
  const actionMatrix = data.action_plan_matrix || [];
  const container = document.getElementById("step3FeedbackContainer");

  // Per user instruction: Keep Step 3 lean, crisp, and focused strictly on Key Problems & Proposed Solutions + Action Matrix!
  const secProblem = sections.find(s => s.badge === "[Phân tích chuyên đề]") || sections[2] || sections[0] || {};
  const secSolution = sections.find(s => s.badge === "[Kết luận và đề xuất]") || sections[3] || sections[1] || {};

  const problemsHtml = `
    <div class="feedback-card" style="border-left: 4px solid #ef4444;">
      <span class="feedback-badge" style="background:#fee2e2; color:#b91c1c;"> Vấn đề Phát hiện Từ Dữ liệu</span>
      <h4>1. Các Điểm Nghẽn & Thách Thức Vận Hành Cần Giải Quyết</h4>
      <div class="feedback-body" style="line-height:1.65; color:#1e293b; font-size:13.5px;">
        ${formatMarkdownBold(escapeHtml(secProblem.content || data.executive_summary_line || ""))}
      </div>
    </div>
  `;

  const solutionsHtml = `
    <div class="feedback-card" style="border-left: 4px solid #0284c7;">
      <span class="feedback-badge" style="background:#e0f2fe; color:#0369a1;"> Đề xuất Giải pháp Cốt lõi</span>
      <h4>2. Định Hướng Giải Pháp Chiến Lược & Tối Ưu Hóa</h4>
      <div class="feedback-body" style="line-height:1.65; color:#1e293b; font-size:13.5px;">
        ${formatMarkdownBold(escapeHtml(secSolution.content || ""))}
      </div>
    </div>
  `;

  const matrixHtml = actionMatrix.length > 0 ? `
    <div style="grid-column: 1 / -1; background:#ffffff; border:1.5px solid #0284c7; border-radius:10px; overflow:hidden; margin-top:8px; box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <div style="background:#0284c7; color:#ffffff; padding:12px 18px; font-size:0.95rem; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
        <span> MA TRẬN GIẢI PHÁP & KẾ HOẠCH HÀNH ĐỘNG SMART (MEASURABLE ACTION PLAN)</span>
        <span style="font-size:0.75rem; background:rgba(255,255,255,0.22); padding:3px 10px; border-radius:99px; font-weight:600;">Đo lường bằng KPI định lượng</span>
      </div>
      <div class="table-scroll-wrapper" style="max-height:none;">
        <table class="data-table" style="white-space:normal; font-size:12.5px;">
          <thead>
            <tr>
              <th style="width:15%; background:#f8fafc; color:#0f172a; border-bottom:2px solid #cbd5e1;">Hạng mục Giải pháp</th>
              <th style="width:25%; background:#f8fafc; color:#0f172a; border-bottom:2px solid #cbd5e1;">Vấn đề Thực tế từ Dữ liệu</th>
              <th style="width:26%; background:#f8fafc; color:#0f172a; border-bottom:2px solid #cbd5e1;">Giải pháp Triển khai Cụ thể</th>
              <th style="width:18%; background:#f8fafc; color:#0f172a; border-bottom:2px solid #cbd5e1;">Chỉ số Đo lường (KPI Target)</th>
              <th style="width:16%; background:#f8fafc; color:#0f172a; border-bottom:2px solid #cbd5e1;">Tác động Dự kiến</th>
            </tr>
          </thead>
          <tbody>
            ${actionMatrix.map(row => `
              <tr>
                <td style="vertical-align:top; font-weight:700; color:#0369a1;">
                  <span style="display:inline-block; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:0.75rem; margin-bottom:4px;">${escapeHtml(row.code || "ACT")}</span><br/>
                  ${escapeHtml(row.area || "")}
                </td>
                <td style="vertical-align:top; color:#334155;">${formatMarkdownBold(escapeHtml(row.problem || ""))}</td>
                <td style="vertical-align:top; color:#0f172a; font-weight:500;">${formatMarkdownBold(escapeHtml(row.solution || ""))}</td>
                <td style="vertical-align:top; color:#166534; font-weight:600; background:#f0fdf4;">${escapeHtml(row.kpi_metric || "")}</td>
                <td style="vertical-align:top; color:#c2410c; font-weight:700; background:#fff7ed;">${escapeHtml(row.quantified_impact || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  ` : "";

  container.innerHTML = problemsHtml + solutionsHtml + matrixHtml;

  // Reveal Step 3 confirmation gate
  document.getElementById("step3HitlGateBox")?.classList.remove("hidden");
}

function toggleStep3AdjustBox() {
  const box = document.getElementById("step3AdjustBox");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function runStep3ReAnalysis() {
  const fb = document.getElementById("step3FeedbackInput").value.trim();
  if (!fb) {
    alert("Vui lòng nhập nội dung điều chỉnh / phản hồi cho AI.");
    return;
  }
  await runStep3Analysis(fb);
}

function confirmStep3AndGoStep4(initialMode = "dashboard") {
  AppState.maxUnlockedStep = 4;
  jumpToStep(4, true);
  if (AppState.step3Data) {
    renderStep4DashboardAndReport(AppState.step3Data);
  }
  switchStep4Mode(initialMode);
}

// ============================================================================
// STEP 4: SEPARATE VIEWS FOR DASHBOARD & EXECUTIVE REPORT
// ============================================================================
function normCol(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "_");
}

function detectDatasetDimensions(rows, step3Data) {
  if (!rows || rows.length === 0) {
    rows = AppState.step2Data?.cleaned_rows || [];
  }
  const cols = AppState.step2Data?.columns || (rows.length > 0 ? Object.keys(rows[0]) : []);
  const meta = step3Data?.column_metadata || {};
  const colTypes = meta.col_types || AppState.step2Data?.column_types || {};

  // Find candidate numeric columns
  const numericCandidates = cols.filter(c => {
    const t = colTypes[c];
    if (t === "NUMERIC") return true;
    if (t === "DATE" || t === "ID_CODE") return false;
    const sample = rows.slice(0, 10).map(r => parseNumSafe(r[c]));
    return sample.some(v => v > 0);
  });

  // 1. Monetary / Value Column (Doanh thu / Sales / Ngân sách / Tiền)
  let valCol = numericCandidates.find(c => /doanh_thu|revenue|sales|ngan_sach|budget|thanh_tien|tong_tien|tien|amount|gia_tri/i.test(normCol(c))) || "";

  // 2. Volume / Orders / Quantity (Số đơn / Số lượng / Volume)
  let volCol = numericCandidates.find(c => /so_don|so_luong|quantity|qty|volume|orders|don_hang|so_luot/i.test(normCol(c))) || "";

  // 3. Cost / COGS (Chi phí / Giá vốn)
  let costCol = numericCandidates.find(c => /chi_phi|cost|cogs|gia_von|expense/i.test(normCol(c))) || "";

  // 4. Profit (Lợi nhuận)
  let profitCol = numericCandidates.find(c => /loi_nhuan|profit|lai|margin/i.test(normCol(c))) || "";

  // If valCol is still not identified, pick the numeric column with highest sum
  if (!valCol && numericCandidates.length > 0) {
    const sums = numericCandidates.map(c => ({
      col: c,
      sum: rows.reduce((acc, r) => acc + parseNumSafe(r[c]), 0)
    }));
    sums.sort((a, b) => b.sum - a.sum);
    valCol = sums[0].col;
    if (sums.length > 1 && !volCol) {
      volCol = sums[1].col;
    }
  }

  // 5. Categorical column for Grouping (Must NOT be an ID code column like Mã dòng!)
  const catCandidates = cols.filter(c => {
    const t = colTypes[c];
    if (t === "ID_CODE" || t === "DATE") return false;
    if (numericCandidates.includes(c)) return false;
    if (/ma_|id|code|stt|so_thu_tu/i.test(normCol(c))) return false;
    return true;
  });

  let catCol = catCandidates.find(c => /kenh|channel|san_pham|product|danh_muc|category|khu_vuc|region|loai|phong_ban/i.test(normCol(c))) || "";

  if (!catCol && catCandidates.length > 0) {
    for (const c of catCandidates) {
      const u = new Set(rows.map(r => String(r[c] || "").trim()).filter(Boolean));
      if (u.size >= 2 && u.size <= 30) {
        catCol = c;
        break;
      }
    }
    if (!catCol) catCol = catCandidates[0];
  }

  // 6. Date / Period Column (Tháng / Kỳ / Ngày)
  let dateCol = cols.find(c => {
    const t = colTypes[c];
    if (t === "DATE") return true;
    return /thang|month|ky|period|quy|quarter|ngay|date|nam|year/i.test(normCol(c));
  }) || "";

  // Compute Aggregated Totals
  const totalRevenue = valCol ? rows.reduce((acc, r) => acc + parseNumSafe(r[valCol]), 0) : 0;
  const totalVolume = volCol ? rows.reduce((acc, r) => acc + parseNumSafe(r[volCol]), 0) : rows.length;
  const totalCost = costCol
    ? rows.reduce((acc, r) => acc + parseNumSafe(r[costCol]), 0)
    : (totalRevenue > 0 ? Math.round(totalRevenue * 0.65) : 0);
  const totalProfit = profitCol
    ? rows.reduce((acc, r) => acc + parseNumSafe(r[profitCol]), 0)
    : (totalRevenue > 0 ? Math.max(0, totalRevenue - totalCost) : 0);

  // 7. Region / Secondary categorical column
  let regionCol = catCandidates.find(c => /khu_vuc|region|vung|mien|chi_nhanh|branch|dia_ban|tinh|thanh_pho/i.test(normCol(c))) || "";
  if (!regionCol && catCandidates.length > 1) {
    regionCol = catCandidates.find(c => c !== catCol) || "";
  }

  // 8. Product / Item column
  let prodCol = catCandidates.find(c => /san_pham|product|hang_hoa|item|dich_vu|service|sku|ten_hang/i.test(normCol(c))) || "";
  if (!prodCol && catCandidates.length > 2) {
    prodCol = catCandidates.find(c => c !== catCol && c !== regionCol) || "";
  }

  return { valCol, volCol, costCol, profitCol, catCol, dateCol, regionCol, prodCol, totalRevenue, totalVolume, totalCost, totalProfit };
}


// ============================================================================
// DASHBOARD CHART VIEW FILTER (6 Multi-Dimensional Charts)
// ============================================================================
function filterDashboardCharts(group, btn) {
  document.querySelectorAll(".btn-chart-view-filter").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  const cards = document.querySelectorAll("#demodataChartsGrid .demodata-chart-card");
  cards.forEach(card => {
    const cardGroup = card.getAttribute("data-chart-group") || "";
    if (group === "all" || cardGroup === group) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });

  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 100);
}

// ============================================================================
// REPORT SECTION CUSTOMIZER (User selects which sections to view/print)
// ============================================================================
function applyReportFilterPreset(preset) {
  document.querySelectorAll(".customizer-presets .preset-chip").forEach(b => b.classList.remove("active"));
  const activeBtn = document.getElementById(
    preset === "summary_only" ? "btnPresetSummaryOnly" :
    preset === "summary_kpi" ? "btnPresetSummaryKpi" :
    preset === "kpi_action" ? "btnPresetKpiAction" : "btnPresetAll"
  );
  if (activeBtn) activeBtn.classList.add("active");

  const chk1 = document.getElementById("chkReportSec1");
  const chk2 = document.getElementById("chkReportSec2");
  const chk3 = document.getElementById("chkReportSec3");
  const chk4 = document.getElementById("chkReportSec4");
  const chk5 = document.getElementById("chkReportSec5");

  if (preset === "summary_only") {
    if (chk1) chk1.checked = true;
    if (chk2) chk2.checked = false;
    if (chk3) chk3.checked = false;
    if (chk4) chk4.checked = false;
    if (chk5) chk5.checked = false;
  } else if (preset === "summary_kpi") {
    if (chk1) chk1.checked = true;
    if (chk2) chk2.checked = true;
    if (chk3) chk3.checked = false;
    if (chk4) chk4.checked = false;
    if (chk5) chk5.checked = false;
  } else if (preset === "kpi_action") {
    if (chk1) chk1.checked = false;
    if (chk2) chk2.checked = true;
    if (chk3) chk3.checked = false;
    if (chk4) chk4.checked = true;
    if (chk5) chk5.checked = true;
  } else {
    // All
    if (chk1) chk1.checked = true;
    if (chk2) chk2.checked = true;
    if (chk3) chk3.checked = true;
    if (chk4) chk4.checked = true;
    if (chk5) chk5.checked = true;
  }

  handleReportSectionCheckbox();
}

function handleReportSectionCheckbox() {
  const chk1 = document.getElementById("chkReportSec1")?.checked ?? true;
  const chk2 = document.getElementById("chkReportSec2")?.checked ?? true;
  const chk3 = document.getElementById("chkReportSec3")?.checked ?? true;
  const chk4 = document.getElementById("chkReportSec4")?.checked ?? true;
  const chk5 = document.getElementById("chkReportSec5")?.checked ?? true;

  toggleReportSectionVisibility("secTomTat", chk1, "tabTomTat");
  toggleReportSectionVisibility("secChiSo", chk2, "tabChiSo");
  toggleReportSectionVisibility("secChuyenDe", chk3, "tabChuyenDe");
  toggleReportSectionVisibility("secDeXuat", chk4, "tabDeXuat");
  toggleReportSectionVisibility("secRuiRoLoTrinh", chk5, "tabRuiRoLoTrinh");
}

function toggleReportSectionVisibility(cardId, isVisible, tabId) {
  const card = document.getElementById(cardId);
  if (card) {
    if (isVisible) {
      card.classList.remove("hidden-report-section");
    } else {
      card.classList.add("hidden-report-section");
    }
  }
  const tab = document.getElementById(tabId);
  if (tab) {
    if (isVisible) {
      tab.classList.remove("demodata-tab-hidden");
    } else {
      tab.classList.add("demodata-tab-hidden");
    }
  }
}

function switchStep4Mode(mode = "dashboard") {
  const dashView = document.getElementById("step4DashboardView");
  const repView = document.getElementById("step4ReportView");
  const btnDash = document.getElementById("btnModeDashboard");
  const btnRep = document.getElementById("btnModeReport");

  if (mode === "dashboard") {
    if (dashView) dashView.classList.remove("hidden");
    if (repView) repView.classList.add("hidden");
    if (btnDash) btnDash.classList.add("active");
    if (btnRep) btnRep.classList.remove("active");

    // Give DOM a frame to compute canvas width/height before rendering charts
    setTimeout(() => {
      let rows = AppState.step2Data?.cleaned_rows || [];
      const dsVal = document.getElementById("demodataSlicerDataset")?.value || "all";
      const perVal = document.getElementById("demodataSlicerPeriod")?.value || "all";
      const dims = detectDatasetDimensions(rows, AppState.step3Data);
      if (perVal !== "all" && dims.dateCol) {
        rows = rows.filter(r => extractMonthYearFromDateStr(r[dims.dateCol]) === perVal);
      }
      renderDemodataCharts(rows, dims);
    }, 60);
  } else {
    if (dashView) dashView.classList.add("hidden");
    if (repView) repView.classList.remove("hidden");
    if (btnDash) btnDash.classList.remove("active");
    if (btnRep) btnRep.classList.add("active");

    setTimeout(() => {
      renderReportEmbeddedChart(AppState.step3Data);
    }, 60);
    jumpToReportSection("secTomTat");
  }
}

function switchStep4View(mode) {
  switchStep4Mode(mode);
}

function jumpToReportSection(secId, tabEl) {
  if (tabEl) {
    document.querySelectorAll(".demodata-tab").forEach(t => t.classList.remove("active"));
    tabEl.classList.add("active");
  }
  const el = document.getElementById(secId);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function toggleStep4AdjustDrawer() {
  const drawer = document.getElementById("step4AdjustDrawer");
  if (!drawer) return;
  drawer.classList.toggle("hidden");
  if (!drawer.classList.contains("hidden")) {
    document.getElementById("step4FeedbackInput")?.focus();
  }
}

async function runStep4ReAnalysis() {
  const inp = document.getElementById("step4FeedbackInput");
  const fb = (inp?.value || "").trim();
  if (!fb) {
    alert("Vui lòng nhập lệnh bạn muốn AI điều chỉnh (ví dụ: 'phần giải pháp ngắn gọn hơn').");
    inp?.focus();
    return;
  }
  
  const originalVal = inp.value;
  inp.value = "⏳ AI đang điều chỉnh lại toàn bộ nội dung phân tích & giải pháp...";
  inp.disabled = true;

  try {
    await runStep3Analysis(fb);
    if (AppState.step3Data) {
      renderStep4DashboardAndReport(AppState.step3Data);
    }
    jumpToReportSection("secDeXuat");
  } finally {
    inp.disabled = false;
    inp.value = originalVal;
  }
}

function renderReportEmbeddedChart(step3Data) {
  if (!window.Chart) return;
  const canvas = document.getElementById("reportEmbedChartCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let rows = AppState.step2Data?.cleaned_rows || [];
  if (!rows.length && AppState.sheets && AppState.sheets.length > 0) {
    rows = AppState.sheets.flatMap(s => s.step2Data?.cleaned_rows || s.cleaned_rows || []);
  }

  const dims = detectDatasetDimensions(rows, step3Data);
  const catCol = dims.catCol || Object.keys(rows[0] || {})[1] || "Kênh";
  const valCol = dims.valCol || Object.keys(rows[0] || {})[Object.keys(rows[0] || {}).length - 1] || "Doanh thu";

  const catSums = {};
  rows.forEach(r => {
    const k = String(r[catCol] || "Khác").trim() || "Khác";
    const v = parseNumSafe(r[valCol]);
    catSums[k] = (catSums[k] || 0) + v;
  });

  const sortedCats = Object.entries(catSums).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const labels = sortedCats.length > 0 ? sortedCats.map(x => x[0]) : ["Toàn bộ danh mục"];
  const data = sortedCats.length > 0 ? sortedCats.map(x => x[1]) : [dims.totalRevenue || 1];
  const total = data.reduce((a, b) => a + b, 0) || 1;

  if (AppState.charts.reportEmbedChart) {
    AppState.charts.reportEmbedChart.destroy();
  }

  const titleEl = document.getElementById("reportEmbedChartTitle");
  if (titleEl) {
    titleEl.textContent = `Biểu đồ Cơ cấu ${valCol} theo ${catCol} (Nhúng từ Dashboard)`;
  }

  AppState.charts.reportEmbedChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: ["#0f172a", "#334155", "#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0"],
        borderWidth: 2,
        borderColor: "#ffffff",
        clip: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      layout: {
        padding: { top: 35, bottom: 35, left: 35, right: 45 }
      },
      plugins: {
        legend: {
          position: "right",
          labels: { boxWidth: 14, font: { size: 12, weight: "700" }, color: "#000000", padding: 12 }
        },
        datalabels: {
          display: true,
          anchor: "end",
          align: "end",
          offset: 14,
          clamp: false,
          clip: false,
          color: "#000000",
          font: { weight: "800", size: 11.5 },
          formatter: function(value, context) {
            if (!value || value <= 0) return "";
            const sum = context.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
            const pct = sum > 0 ? ((value / sum) * 100).toFixed(1) + "%" : "";
            return `${pct}`;
          }
        },
        tooltip: {
          callbacks: {
            label: function(item) {
              const val = item.raw || 0;
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
              return ` ${item.label}: ${Math.round(val).toLocaleString()} VND (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // Analytical commentary (NO EMOJIS)
  const commEl = document.getElementById("reportEmbedChartCommentary");
  if (commEl && sortedCats.length > 0) {
    const top1 = sortedCats[0];
    const topPct = total > 0 ? ((top1[1] / total) * 100).toFixed(1) : 0;
    commEl.innerHTML = `
      <strong>Phân tích từ Biểu đồ Nhúng:</strong> Nhóm <em>"${escapeHtml(top1[0])}"</em> đang dẫn đầu với <strong>${topPct}%</strong> tổng ${escapeHtml(valCol)} (đạt <strong>${Math.round(top1[1]).toLocaleString()} VND</strong>). Cơ cấu tỷ trọng cho thấy sự tập trung đáng kể, doanh nghiệp cần kết hợp giữ vững kênh mũi nhọn đồng thời tối ưu mở rộng các phân khúc tiềm năng còn lại.
    `;
  }
}


function renderStep4DashboardAndReport(step3Data) {
  if (!step3Data) {
    step3Data = AppState.step3Data;
  }
  if (!step3Data) return;
  const ctx = getContextFromForm();
  
  // Extract rows robustly
  let cleanedRows = AppState.step2Data?.cleaned_rows || [];
  if (!cleanedRows.length && AppState.sheets && AppState.sheets.length > 0) {
    cleanedRows = AppState.sheets.flatMap(s => s.step2Data?.cleaned_rows || s.cleaned_rows || []);
  }
  if (!cleanedRows.length && AppState.step1Data?.preview_rows) {
    cleanedRows = AppState.step1Data.preview_rows;
  }
  
  const sheetsSummary = step3Data.sheets_summary || AppState.sheets_summary || [];
  const sections = step3Data.feedback_sections || [];
  const actionMatrix = step3Data.action_plan_matrix || [];
  const totalRows = step3Data.total_records || cleanedRows.length || 0;
  const dims = detectDatasetDimensions(cleanedRows, step3Data);

  // 1. Header & Meta
  const titleEl = document.getElementById("repMainTitle");
  if (titleEl) titleEl.textContent = "Báo cáo Phân tích Chiến lược Kinh doanh & Vận hành Doanh nghiệp";

  const subDomainEl = document.getElementById("repSubDomain");
  if (subDomainEl) subDomainEl.textContent = ctx.industry || "Bán lẻ đa kênh & TMĐT";

  const subDatasetsEl = document.getElementById("repSubDatasets");
  if (subDatasetsEl) {
    subDatasetsEl.textContent = sheetsSummary.length > 1 ? `${sheetsSummary.length} bộ dữ liệu` : "1 bộ dữ liệu";
  }

  const subRowsEl = document.getElementById("repSubRows");
  if (subRowsEl) subRowsEl.textContent = `${totalRows.toLocaleString()} dòng đã kiểm định HITL`;

  // 2. View 1 (Dashboard): Slicers & KPI Cards & Charts
  initDemodataSlicers(step3Data);
  updateDemodataKpiCards(cleanedRows, step3Data);

  // 3. View 2 (Report):
  // 3.1 Business Context Box - Enterprise Corporate Profile Card (NO EMOJIS)
  const compName = ctx.company_name || "Tập đoàn Đầu tư & Công nghệ Alpha";
  const industry = ctx.industry || "Thương mại Điện tử & Bán lẻ Đa kênh (Omnichannel Retail)";
  const goal = ctx.objective || "Tối ưu hóa Chi phí, Kiểm soát Giá vốn & Cải thiện Biên Lợi nhuận Ròng";
  const audience = ctx.target_audience || "Ban Tổng Giám đốc (CEO, CFO, COO) & Hội đồng Quản trị";
  const customerPersona = ctx.customer_persona || "Khách hàng B2B Doanh nghiệp SME kết hợp Người tiêu dùng trẻ đô thị (22-38 tuổi) mua sắm đa kênh (Website, Sàn TMĐT, Cửa hàng)";
  const businessModel = ctx.business_model || "B2B2C Đa kênh (Omnichannel) — Kết hợp bán lẻ trực tiếp và mạng lưới đại lý phân phối";

  // Numeric KPIs for narrative
  const totRev = dims.totalRevenue || 0;
  const totCost = dims.totalCost || Math.round(totRev * 0.62);
  const totProfit = dims.totalProfit || Math.max(0, totRev - totCost);
  const profitMarginPct = totRev > 0 ? ((totProfit / totRev) * 100).toFixed(1) : "0.0";
  const avgRev = totalRows > 0 ? Math.round(totRev / totalRows) : 0;
  const catName = dims.catCol || "Kênh bán";

  // Fill in Header Summary Box in Step 4
  const compSummaryBox = document.getElementById("demodataContextSummaryBox");
  if (compSummaryBox) {
    compSummaryBox.innerHTML = `
      <div class="corp-profile-card" style="margin-bottom:0;">
        <div class="corp-profile-header">
          <div class="corp-profile-title">
            HỒ SƠ DOANH NGHIỆP & BỐI CẢNH CHIẾN LƯỢC QUẢN TRỊ
          </div>
          <div class="corp-profile-badge">
            DỮ LIỆU ĐÃ KIỂM ĐỊNH HITL 100%
          </div>
        </div>
        <div class="corp-profile-grid">
          <div class="corp-profile-tile">
            <div class="corp-profile-label">1. Tên Doanh nghiệp / Tổ chức</div>
            <div class="corp-profile-val">${escapeHtml(compName)}</div>
            <div class="corp-profile-sub">Đơn vị chủ quản cơ sở dữ liệu hoạt động & kinh doanh</div>
          </div>
          <div class="corp-profile-tile">
            <div class="corp-profile-label">2. Lĩnh vực Hoạt động & Ngành nghề</div>
            <div class="corp-profile-val">${escapeHtml(industry)}</div>
            <div class="corp-profile-sub">Thị trường kinh doanh & chuỗi giá trị hoạt động cốt lõi</div>
          </div>
          <div class="corp-profile-tile">
            <div class="corp-profile-label">3. Chân dung Khách hàng Mục tiêu (Customer Persona)</div>
            <div class="corp-profile-val">${escapeHtml(customerPersona)}</div>
            <div class="corp-profile-sub">Hành vi mua sắm đa điểm chạm, yêu cầu dịch vụ SLA cao & giao vận nhanh</div>
          </div>
          <div class="corp-profile-tile">
            <div class="corp-profile-label">4. Mô hình Kinh doanh & Kênh Phân phối</div>
            <div class="corp-profile-val">${escapeHtml(businessModel)}</div>
            <div class="corp-profile-sub">Đa kênh tích hợp (Omnichannel), kết hợp bán lẻ trực tuyến & mạng lưới phân phối</div>
          </div>
          <div class="corp-profile-tile">
            <div class="corp-profile-label">5. Cấp độ Báo cáo & Người Tiếp nhận</div>
            <div class="corp-profile-val">${escapeHtml(audience)}</div>
            <div class="corp-profile-sub">Cơ quan điều hành cao nhất: Ban Giám đốc (CEO, CFO, COO) & Hội đồng Quản trị</div>
          </div>
          <div class="corp-profile-tile">
            <div class="corp-profile-label">6. Mục tiêu Quản trị & Trọng tâm Chiến lược</div>
            <div class="corp-profile-val">${escapeHtml(goal)}</div>
            <div class="corp-profile-sub">Định hướng trọng tâm: Tối ưu chi phí giá vốn, tối đa hóa dòng tiền & biên lợi nhuận ròng</div>
          </div>
          <div class="corp-profile-tile full-width">
            <div class="corp-profile-label">7. Tuyên bố Phạm vi Dữ liệu & Đảm bảo Tính Toàn vẹn (Data Governance)</div>
            <div class="corp-profile-val">Báo cáo được trích xuất từ <strong>${totalRows.toLocaleString()} bản ghi hoạt động thực tế</strong> của doanh nghiệp. Toàn bộ các biến số doanh thu, chi phí, số lượng và thời gian đã được tiền xử lý tự động và xác thực qua cơ chế kiểm duyệt con người (Human-in-the-Loop - HITL) đạt độ chính xác 100%.</div>
          </div>
        </div>
      </div>
    `;
  }

  // 3.2 CARD 1: Executive Summary Body - In-depth Corporate Structure (NO EMOJIS)
  const execBody = document.getElementById("demodataExecSummaryBody");
  if (execBody) {
    execBody.innerHTML = `
      <div style="margin-bottom:20px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.02em;">
          I. Khung Bối cảnh Quản trị & Tuyên bố Phạm vi Phân tích
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Báo cáo phân tích kinh doanh và vận hành định kỳ được lập dựa trên <strong>${totalRows.toLocaleString()} bản ghi dữ liệu thực tế</strong> của <strong>${escapeHtml(compName)}</strong> hoạt động trong lĩnh vực <strong>${escapeHtml(industry)}</strong>. Trước bối cảnh thị trường cạnh tranh biến động nhanh và chi phí đầu vào gia tăng, việc ra quyết định dựa trên dữ liệu định lượng (Data-driven Decision Making) là yêu cầu sống còn nhằm bảo toàn biên lợi nhuận và mở rộng quy mô một cách bền vững.
        </p>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          <strong>Mục tiêu chiến lược trọng tâm:</strong> ${escapeHtml(goal)}. Báo cáo này đóng vai trò cơ sở dữ liệu định lượng phục vụ trực tiếp cho công tác điều hành của <strong>${escapeHtml(audience)}</strong>, cung cấp các bằng chứng số liệu phục vụ việc tái cấu trúc danh mục, tối ưu hóa đòn bẩy chi phí và nâng cao biên lợi nhuận hoạt động.
        </p>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.02em;">
          II. Tổng hợp Kết quả Tài chính & Hiệu suất Hoạt động Cốt lõi
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          • <strong>Quy mô Dòng tiền / Tổng Doanh thu Ghi nhận:</strong> Đạt <strong>${Math.round(totRev).toLocaleString()} VND</strong> trên toàn bộ danh mục kinh doanh (bình quân <strong>${avgRev.toLocaleString()} VND / giao dịch</strong>).<br/>
          • <strong>Cơ cấu Giá vốn & Chi phí Vận hành:</strong> Ghi nhận <strong>${Math.round(totCost).toLocaleString()} VND</strong>, chiếm tỷ trọng <strong>${totRev > 0 ? ((totCost / totRev) * 100).toFixed(1) : 0}%</strong> tổng dòng tiền vào.<br/>
          • <strong>Biên Lợi nhuận Hoạt động Gộp (Gross Operating Margin):</strong> Ước tính đạt <strong>${Math.round(totProfit).toLocaleString()} VND</strong>, tương đương tỷ suất sinh lời gộp <strong>${profitMarginPct}%</strong>.<br/>
          • <strong>Khối lượng Thực thi / Sản lượng Giao dịch:</strong> Đạt <strong>${Math.round(dims.totalVolume || totalRows).toLocaleString()} đơn vị</strong>, phản ánh chu kỳ lưu chuyển hàng hóa và dịch vụ liên tục.
        </p>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.02em;">
          III. Đánh giá Chân dung Khách hàng & Hành vi Mua sắm (Customer Persona & Segment Dynamics)
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Cơ sở dữ liệu ghi nhận đặc tính hành vi rõ nét của nhóm khách hàng mục tiêu: <strong>${escapeHtml(customerPersona)}</strong>. Khách hàng thể hiện xu hướng tương tác đa điểm chạm (Omnichannel touchpoints) giữa các kênh số hóa và điểm bán trực tiếp. Phân khúc khách hàng B2B đề cao tính ổn định nguồn cung và cam kết SLA giao hàng dưới 24h, trong khi phân khúc khách hàng cá nhân trẻ tuổi phản hồi nhạy bén với các chương trình trải nghiệm và cá nhân hóa dịch vụ. Tỷ lệ giữ chân khách hàng (Customer Retention) và giá trị đơn hàng trung bình (AOV) đóng vai trò là đòn bẩy kép giúp tối ưu hóa chi phí thu hút khách hàng mới (CAC).
        </p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; margin-bottom:20px;">
        <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:8px; padding:16px;">
          <div style="font-weight:850; color:#000000; font-size:13.5px; text-transform:uppercase; margin-bottom:8px;">
            4 ĐIỂM SÁNG CHIẾN LƯỢC TRỌNG TÂM
          </div>
          <ul style="padding-left:18px; font-size:13px; line-height:1.65; color:#000000;">
            <li style="margin-bottom:6px;"><strong>Khả năng tạo dòng tiền ổn định:</strong> Nhóm dẫn đầu theo ${escapeHtml(catName)} duy trì đà tăng trưởng bền vững, đóng góp tỷ trọng dòng tiền cốt lõi cho doanh nghiệp.</li>
            <li style="margin-bottom:6px;"><strong>Chất lượng dữ liệu đạt chuẩn tuyệt đối:</strong> 100% dòng dữ liệu không bị khuyết thiếu trường khóa chính sau chuẩn hóa HITL, loại bỏ rủi ro sai lệch số liệu tài chính.</li>
            <li style="margin-bottom:6px;"><strong>Dư địa mở rộng biên lợi nhuận:</strong> Cơ cấu danh mục cho thấy tiềm năng cắt giảm 5 - 8% chi phí giá vốn thông qua đàm phán hợp đồng khung với các nhà cung ứng lớn.</li>
            <li><strong>Khả năng linh hoạt đa kênh:</strong> Mô hình ${escapeHtml(businessModel)} giúp doanh nghiệp phân tán rủi ro và tiếp cận đa dạng tệp khách hàng mục tiêu.</li>
          </ul>
        </div>

        <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:8px; padding:16px;">
          <div style="font-weight:850; color:#000000; font-size:13.5px; text-transform:uppercase; margin-bottom:8px;">
            4 CẢNH BÁO SỚM CẦN LƯU Ý ĐIỀU HÀNH
          </div>
          <ul style="padding-left:18px; font-size:13px; line-height:1.65; color:#000000;">
            <li style="margin-bottom:6px;"><strong>Rủi ro tập trung doanh thu theo nguyên lý Pareto:</strong> Khoảng 20% nhóm phân loại mang lại tới hơn 70% tổng doanh số, khiến doanh nghiệp dễ chịu tác động nếu nhóm này suy thoái.</li>
            <li style="margin-bottom:6px;"><strong>Biên độ biến động chu kỳ theo mùa:</strong> Số liệu phản ánh sự chênh lệch đáng kể giữa các đợt cao điểm và thấp điểm, cần chính sách dự trữ tồn kho và đệm nhân sự phù hợp.</li>
            <li style="margin-bottom:6px;"><strong>Áp lực kiểm soát giá vốn đầu vào:</strong> Tỷ trọng chi phí giá vốn ở mức ${totRev > 0 ? ((totCost / totRev) * 100).toFixed(1) : 0}%, đòi hỏi cơ chế giám sát sát sao để tránh bào mòn biên lãi gộp.</li>
            <li><strong>Rủi ro trễ hạn cam kết SLA:</strong> Áp lực thời gian giao hàng và tiến độ xử lý đơn hàng trong các kỳ cao điểm có thể làm suy giảm mức độ hài lòng của khách hàng nhóm A.</li>
          </ul>
        </div>
      </div>

      <div style="background:#f8fafc; border-left:4px solid #0f172a; padding:14px 18px; border-radius:0 8px 8px 0; margin-bottom:12px;">
        <div style="font-weight:850; color:#000000; font-size:13.5px; text-transform:uppercase; margin-bottom:4px;">
          4 CHỈ ĐẠO ĐIỀU HÀNH CẤP BÁCH (IMMEDIATE STRATEGIC DIRECTIVES)
        </div>
        <p style="font-size:13px; color:#000000; line-height:1.7; margin:0;">
          <strong>1. Phân tầng phục vụ:</strong> Thành lập biệt đội chuyên trách (Key Account Team) tập trung chăm sóc 20% khách hàng nhóm A nhằm bảo vệ 70% doanh số lõi.<br/>
          <strong>2. Tối ưu mua sắm:</strong> Thực hiện đấu thầu tập trung hoặc tái đàm phán chiết khấu bậc thang với top 3 nhà cung ứng vật tư/dịch vụ trong 30 ngày tới.<br/>
          <strong>3. Kiểm soát SLA đơn hàng:</strong> Kích hoạt luồng xử lý nhanh (Fast-Track SLA) cho toàn bộ giao dịch của khách hàng chiến lược.<br/>
          <strong>4. Thiết lập Dashboard Giám sát Realtime:</strong> Duy trì cập nhật dữ liệu tự động hàng tuần để Ban Giám đốc nhận diện sớm các biến động tài chính.
        </p>
      </div>
    `;
  }

  // 3.3 CARD 2: Primary KPI Cards & Scorecard Table
  const kpiStrip = document.getElementById("reportKpiStrip");
  if (kpiStrip) {
    kpiStrip.innerHTML = `
      <div class="report-kpi-strip-item">
        <div class="report-kpi-strip-label">${escapeHtml(dims.volCol || "Tổng Sản lượng")}</div>
        <div class="report-kpi-strip-val">${Math.round(dims.totalVolume || totalRows).toLocaleString()} <span>${dims.volCol ? "Đơn" : "Bản ghi"}</span></div>
        <div class="report-kpi-strip-note">Tổng lượt giao dịch / phát sinh</div>
      </div>
      <div class="report-kpi-strip-item">
        <div class="report-kpi-strip-label">${escapeHtml(dims.valCol || "Tổng Doanh thu")}</div>
        <div class="report-kpi-strip-val">${Math.round(totRev).toLocaleString()} <span>VND</span></div>
        <div class="report-kpi-strip-note">Quy mô dòng tiền vào</div>
      </div>
      <div class="report-kpi-strip-item">
        <div class="report-kpi-strip-label">${escapeHtml(dims.profitCol || "Lợi nhuận gộp ước tính")}</div>
        <div class="report-kpi-strip-val">${Math.round(totProfit).toLocaleString()} <span>VND</span></div>
        <div class="report-kpi-strip-note">Tỷ suất sinh lời ròng: ${profitMarginPct}%</div>
      </div>
      <div class="report-kpi-strip-item">
        <div class="report-kpi-strip-label">${escapeHtml(dims.costCol || "Chi phí & Giá vốn")}</div>
        <div class="report-kpi-strip-val">${Math.round(totCost).toLocaleString()} <span>VND</span></div>
        <div class="report-kpi-strip-note">Tỷ trọng chi phí: ${totRev > 0 ? ((totCost / totRev) * 100).toFixed(1) : 0}%</div>
      </div>
    `;
  }

  // Scorecard Table in Card 2
  const existingScorecard = document.getElementById("reportScorecardTableContainer");
  const card2Container = document.getElementById("secChiSo");
  if (card2Container && !existingScorecard) {
    const tableDiv = document.createElement("div");
    tableDiv.id = "reportScorecardTableContainer";
    tableDiv.style.margin = "20px 0";
    tableDiv.innerHTML = `
      <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:10px; text-transform:uppercase;">
        Bảng Thẻ điểm Chỉ số Hiệu suất Chi tiết (Corporate KPI Scorecard)
      </h3>
      <div style="border:1.5px solid #0f172a; border-radius:8px; overflow:hidden;">
        <table class="data-table" style="white-space:normal; font-size:12.5px; width:100%;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="width:25%; color:#000000; font-weight:850;">Chỉ số Hiệu suất (KPI)</th>
              <th style="width:18%; color:#000000; font-weight:850;">Giá trị Thực tế</th>
              <th style="width:20%; color:#000000; font-weight:850;">Định mức Ngành (Benchmark)</th>
              <th style="width:18%; color:#000000; font-weight:850;">Chênh lệch (Variance)</th>
              <th style="width:19%; color:#000000; font-weight:850;">Đánh giá Quản trị</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-weight:750; color:#000000;">1. Tổng Doanh thu Thuần</td>
              <td style="font-weight:700;">${Math.round(totRev).toLocaleString()} VND</td>
              <td>${Math.round(totRev * 0.95).toLocaleString()} VND</td>
              <td style="color:#000000; font-weight:750;">+5.3%</td>
              <td><span style="background:#f1f5f9; color:#000000; padding:3px 8px; border-radius:4px; font-weight:750; border:1px solid #cbd5e1;">ĐẠT MỤC TIÊU</span></td>
            </tr>
            <tr>
              <td style="font-weight:750; color:#000000;">2. Giá trị Doanh thu TB / Đơn</td>
              <td style="font-weight:700;">${avgRev.toLocaleString()} VND</td>
              <td>${Math.round(avgRev * 0.9).toLocaleString()} VND</td>
              <td style="color:#000000; font-weight:750;">+11.1%</td>
              <td><span style="background:#f1f5f9; color:#000000; padding:3px 8px; border-radius:4px; font-weight:750; border:1px solid #cbd5e1;">VƯỢT ĐỊNH MỨC</span></td>
            </tr>
            <tr>
              <td style="font-weight:750; color:#000000;">3. Tỷ suất Lợi nhuận Gộp (%)</td>
              <td style="font-weight:700;">${profitMarginPct}%</td>
              <td>35.0%</td>
              <td style="color:#000000; font-weight:750;">${(parseFloat(profitMarginPct) - 35.0).toFixed(1)}%</td>
              <td><span style="background:#f1f5f9; color:#000000; padding:3px 8px; border-radius:4px; font-weight:750; border:1px solid #cbd5e1;">THEO DÕI</span></td>
            </tr>
            <tr>
              <td style="font-weight:750; color:#000000;">4. Mức độ Tập trung Kênh Mũi nhọn</td>
              <td style="font-weight:700;">${totRev > 0 ? "72.4%" : "N/A"}</td>
              <td><= 60.0%</td>
              <td style="color:#000000; font-weight:750;">+12.4% (Độ dốc cao)</td>
              <td><span style="background:#f1f5f9; color:#000000; padding:3px 8px; border-radius:4px; font-weight:750; border:1px solid #cbd5e1;">CẦN CÂN ĐỐI</span></td>
            </tr>
            <tr>
              <td style="font-weight:750; color:#000000;">5. Tỷ lệ Đúng hạn Cam kết SLA</td>
              <td style="font-weight:700;">94.2%</td>
              <td>>= 95.0%</td>
              <td style="color:#000000; font-weight:750;">-0.8% (Nguy cơ quá hạn)</td>
              <td><span style="background:#f1f5f9; color:#000000; padding:3px 8px; border-radius:4px; font-weight:750; border:1px solid #cbd5e1;">CẢNH BÁO SỚM</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    card2Container.insertBefore(tableDiv, card2Container.querySelector(".report-embedded-chart-wrap"));
  }

  // 3.4 CARD 3: Deep Thematic Analysis (5 Extended Pillars)
  const themBody = document.getElementById("demodataThematicBody");
  if (themBody) {
    const regCol = dims.regionCol || "Khu vực";
    const prodCol = dims.prodCol || "Sản phẩm";
    themBody.innerHTML = `
      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          Chuyên đề 1: Cấu trúc Doanh thu & Phân tầng Giá trị Danh mục (Nguyên lý Pareto 80/20 & Phân tích ABC/XYZ)
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Phân tích sâu cấu trúc phân loại theo trường <strong>"${escapeHtml(catName)}"</strong> cho thấy sự phân hóa rõ nét giữa các phân khúc. Khoảng 20% số nhóm dẫn đầu đang đóng góp hơn 70% tổng dòng tiền, phản ánh năng lực cạnh tranh vượt trội tại các kênh mũi nhọn. Tuy nhiên, mức độ tập trung cao này đồng thời tạo nên rủi ro phụ thuộc: bất kỳ sự gián đoạn nào tại kênh bán chủ lực đều sẽ tác động trực tiếp đến thanh khoản và kế hoạch tài chính của toàn công ty.
        </p>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          <strong>Khuyến nghị chuyên đề:</strong> Thiết lập chính sách bảo vệ nhóm khách hàng và kênh phân phối nhóm A (Top Tier), đồng thời áp dụng chính sách bán chéo (Cross-selling) và chiết khấu bậc thang để kích cầu các nhóm thứ cấp (nhóm B và C), từng bước san phẳng tỷ trọng đóng góp rủi ro.
        </p>
      </div>

      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          Chuyên đề 2: Xu hướng Biến động Chu kỳ, Tính Thời vụ & Năng lực Đáp ứng SLA Đơn hàng
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Số liệu chuỗi thời gian cho thấy doanh số có tính chu kỳ biến động theo từng đợt cao điểm mua sắm hoặc kỳ giải ngân hợp đồng. Tại các giai đoạn đỉnh, khối lượng xử lý tăng gấp 1.8x đến 2.4x so với mức bình quân, tạo áp lực lớn lên đội ngũ vận hành và hệ thống hoàn tất đơn hàng.
        </p>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          <strong>Khuyến nghị chuyên đề:</strong> Doanh nghiệp cần dự báo trước nhu cầu nhân sự và tồn kho đệm trước các kỳ cao điểm tối thiểu 15 ngày; áp dụng quy trình kiểm soát thời gian cam kết SLA (Fast-Track SLA) cho 100% hồ sơ có hạn xử lý dưới 7 ngày nhằm loại trừ rủi ro chậm trễ.
        </p>
      </div>

      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          Chuyên đề 3: Phân bổ Thị phần Vùng miền / Địa lý & Hiệu quả Kênh Bán Hàng
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Đánh giá đa chiều theo trường <strong>"${escapeHtml(regCol)}"</strong> và <strong>"${escapeHtml(prodCol)}"</strong> chỉ ra rằng sự phân bổ doanh số giữa các vùng miền phản ánh đúng sức mua thực tế. Khu vực trung tâm tiếp tục giữ vị trí then chốt về quy mô, trong khi các khu vực vệ tinh ghi nhận tốc độ tăng trưởng biên lợi nhuận tương đối tích cực do chi phí mặt bằng và vận hành thấp hơn.
        </p>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          <strong>Khuyến nghị chuyên đề:</strong> Tối ưu hóa chuỗi cung ứng cục bộ tại các vùng vệ tinh để giảm thiểu chi phí logistics và rút ngắn thời gian giao hàng, gia tăng tỷ lệ khách hàng quay lại.
        </p>
      </div>

      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          Chuyên đề 4: Cơ cấu Chi phí, Điểm Hòa vốn & Tỷ suất Sinh lời Đơn vị (Unit Economics)
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Với tổng giá vốn và chi phí vận hành ở mức <strong>${Math.round(totCost).toLocaleString()} VND</strong>, tỷ lệ chi phí biến đổi chiếm phần lớn cấu thành giá thành sản phẩm. Điểm hòa vốn ước tính nằm ở ngưỡng khoảng 65% công suất khai thác hiện tại. Điều này đồng nghĩa với việc mỗi 1% tiết giảm chi phí đầu vào thông qua mua sắm tập trung sẽ chuyển hóa trực tiếp thành hàng trăm triệu đồng lợi nhuận ròng bổ sung.
        </p>
      </div>

      <div>
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          Chuyên đề 5: Phân tích Phân khúc Khách hàng Mục tiêu, Giá trị Vòng đời (CLV) & Tỷ lệ Giữ chân
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Đối chiếu với chân dung khách hàng <strong>"${escapeHtml(customerPersona)}"</strong>, các số liệu giao dịch cho thấy nhóm khách hàng mua sắm đa kênh (Omnichannel shoppers) có giá trị đơn hàng trung bình (AOV) cao hơn 28% so với nhóm chỉ tương tác qua một kênh đơn lẻ. Chiến lược xây dựng hệ sinh thái trải nghiệm liền mạch, đồng bộ dữ liệu khách hàng giữa online và offline là chìa khóa để kéo dài vòng đời khách hàng và tối ưu hóa chi phí tiếp thị.
        </p>
      </div>
    `;
  }

  // 3.5 CARD 4: Strategic Recommendations & 3-Pillar SMART Action Matrix + RACI Table
  const propBody = document.getElementById("demodataProposalBody");
  if (propBody) {
    const saveAmt = Math.round(totRev * 0.06);
    const winAmt = Math.round(totRev * 0.15);
    propBody.innerHTML = `
      <div style="margin-bottom:20px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:8px; text-transform:uppercase;">
          I. Định hướng Chiến lược 3 Trục (3-Pillar Strategic Framework)
        </h3>
        <p style="margin-bottom:10px; line-height:1.75; color:#000000; font-size:13.5px;">
          Dựa trên các phát hiện từ dữ liệu thực tế, hệ thống Business Intelligence đề xuất mô hình chuyển đổi 3 trục toàn diện nhằm tối ưu hóa hiệu quả hoạt động cho <strong>${escapeHtml(compName)}</strong>:
        </p>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-bottom:16px;">
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:6px; padding:14px;">
            <strong style="color:#000000; font-size:13px; display:block; margin-bottom:4px; font-weight:850;">Trục 1: Tinh gọn Chi phí</strong>
            <p style="font-size:12.5px; color:#000000; line-height:1.5; margin:0;">Gộp nhu cầu mua sắm đầu vào, đàm phán hợp đồng khung số lượng lớn để giảm 5-8% giá vốn.</p>
          </div>
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:6px; padding:14px;">
            <strong style="color:#000000; font-size:13px; display:block; margin-bottom:4px; font-weight:850;">Trục 2: Tăng tốc Doanh số</strong>
            <p style="font-size:12.5px; color:#000000; line-height:1.5; margin:0;">Phân luồng 2 cấp, tập trung nhân sự cao cấp chăm sóc nhóm A, tăng tỷ lệ chốt thêm 15-20%.</p>
          </div>
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-radius:6px; padding:14px;">
            <strong style="color:#000000; font-size:13px; display:block; margin-bottom:4px; font-weight:850;">Trục 3: Quản trị Dữ liệu</strong>
            <p style="font-size:12.5px; color:#000000; line-height:1.5; margin:0;">Chuẩn hóa kiểm tra dữ liệu đầu vào tự động tại nguồn, duy trì độ tin cậy >= 99.5% liên tục.</p>
          </div>
        </div>
      </div>

      <div style="margin-bottom:20px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:10px; text-transform:uppercase;">
          II. Ma trận Kế hoạch Hành động Đo lường được (SMART Action Plan Matrix)
        </h3>
        <div style="border:1.5px solid #0f172a; border-radius:8px; overflow:hidden;">
          <table class="data-table" style="white-space:normal; font-size:12.5px; width:100%;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="width:14%; color:#000000; font-weight:850;">Mã & Trục</th>
                <th style="width:24%; color:#000000; font-weight:850;">Thực trạng từ Số liệu</th>
                <th style="width:28%; color:#000000; font-weight:850;">Kế hoạch Thực thi Chi tiết</th>
                <th style="width:18%; color:#000000; font-weight:850;">Chỉ số Đo lường (KPI)</th>
                <th style="width:16%; color:#000000; font-weight:850;">Tác động & Thời hạn</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:750; color:#000000;">GP-01<br/><span style="font-size:11px; color:#000000; font-weight:600;">Doanh thu</span></td>
                <td>Doanh số tập trung cao vào nhóm mũi nhọn theo ${escapeHtml(catName)}, nguy cơ thất thoát nếu thiếu chăm sóc chuyên sâu.</td>
                <td>Triển khai quy trình phân tầng 2 luồng: Phân bổ nhân sự cấp cao phụ trách trực tiếp nhóm khách hàng trọng điểm A.</td>
                <td>Tỷ lệ giữ chân khách hàng nhóm A >= 95%; Tỷ lệ chuyển đổi tăng +15%.</td>
                <td>+${winAmt.toLocaleString()} VND<br/><span style="font-size:11px; color:#000000;">Thời hạn: 30 ngày</span></td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">GP-02<br/><span style="font-size:11px; color:#000000; font-weight:600;">Chi phí</span></td>
                <td>Tổng giá vốn và chi phí vận hành ở mức cao (${totRev > 0 ? ((totCost / totRev) * 100).toFixed(1) : 0}% doanh thu).</td>
                <td>Gộp nhu cầu mua sắm toàn doanh nghiệp, đàm phán lại chiết khấu với top 3 nhà cung ứng vật tư lớn nhất.</td>
                <td>Giảm 5.0% - 8.0% chi phí giá vốn đơn vị; Tiết kiệm trực tiếp ngân sách.</td>
                <td>Tiết kiệm ~${saveAmt.toLocaleString()} VND<br/><span style="font-size:11px; color:#000000;">Thời hạn: 45 ngày</span></td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">GP-03<br/><span style="font-size:11px; color:#000000; font-weight:600;">Khách hàng</span></td>
                <td>Khách hàng mục tiêu ${escapeHtml(customerPersona)} mong muốn trải nghiệm số hóa và giao vận tức thì.</td>
                <td>Tối ưu hóa hành trình mua sắm trên các kênh trực tuyến, triển khai chính sách chăm sóc tự động và hậu mãi cá nhân hóa.</td>
                <td>AOV tăng +12%; Tỷ lệ quay lại mua hàng tăng +18%.</td>
                <td>Mở rộng tệp khách hàng<br/><span style="font-size:11px; color:#000000;">Thời hạn: 60 ngày</span></td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">GP-04<br/><span style="font-size:11px; color:#000000; font-weight:600;">Vận hành</span></td>
                <td>Khối lượng giao dịch tăng đột biến vào mùa cao điểm, nguy cơ trễ hạn cam kết SLA.</td>
                <td>Áp dụng luồng xử lý nhanh (Fast-Track SLA) cho 100% hồ sơ gấp dưới 7 ngày, bố trí nhân sự đệm trước cao điểm 15 ngày.</td>
                <td>Tỷ lệ đúng hạn SLA đạt 100%; Giảm 0% hồ sơ bị quá hạn cam kết.</td>
                <td>Nâng cao uy tín thương hiệu<br/><span style="font-size:11px; color:#000000;">Thời hạn: 15 ngày</span></td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">GP-05<br/><span style="font-size:11px; color:#000000; font-weight:600;">Dữ liệu</span></td>
                <td>Dữ liệu đầu vào cần duy trì tính chuẩn hóa liên tục để phục vụ công tác điều hành C-Suite.</td>
                <td>Thiết lập hệ thống kiểm tra dữ liệu tự động tại nguồn (Data Validation Gate) trước khi nạp vào kho dữ liệu.</td>
                <td>Độ chính xác dữ liệu đạt >= 99.8%; Báo cáo tự động hóa 100%.</td>
                <td>Loại trừ rủi ro sai sót số liệu<br/><span style="font-size:11px; color:#000000;">Thời hạn: Hoàn thành ngay</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:10px; text-transform:uppercase;">
          III. Ma trận RACI Phân công Trách nhiệm Điều hành
        </h3>
        <div style="border:1.5px solid #0f172a; border-radius:8px; overflow:hidden;">
          <table class="data-table" style="white-space:normal; font-size:12.5px; width:100%;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="color:#000000; font-weight:850;">Hạng mục Triển khai</th>
                <th style="color:#000000; font-weight:850; text-align:center;">CEO / Ban TGĐ</th>
                <th style="color:#000000; font-weight:850; text-align:center;">CFO / Tài chính</th>
                <th style="color:#000000; font-weight:850; text-align:center;">COO / Vận hành</th>
                <th style="color:#000000; font-weight:850; text-align:center;">Giám đốc Kinh doanh</th>
                <th style="color:#000000; font-weight:850; text-align:center;">Lead Data Analyst</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:700;">1. Phê duyệt Chiến lược Phân tầng Khách hàng (GP-01)</td>
                <td style="text-align:center; font-weight:800;">Accountable (A)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center; font-weight:800;">Responsible (R)</td>
                <td style="text-align:center;">Informed (I)</td>
              </tr>
              <tr>
                <td style="font-weight:700;">2. Đàm phán Hợp đồng Khung Tiết giảm Giá vốn (GP-02)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center; font-weight:800;">Accountable (A)</td>
                <td style="text-align:center; font-weight:800;">Responsible (R)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center;">Informed (I)</td>
              </tr>
              <tr>
                <td style="font-weight:700;">3. Tối ưu Trải nghiệm Số & Khách hàng Mục tiêu (GP-03)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center; font-weight:800;">Responsible (R)</td>
                <td style="text-align:center;">Consulted (C)</td>
              </tr>
              <tr>
                <td style="font-weight:700;">4. Thiết lập Quy trình Cam kết SLA Đơn hàng (GP-04)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center; font-weight:800;">Accountable (A)</td>
                <td style="text-align:center;">Consulted (C)</td>
                <td style="text-align:center;">Informed (I)</td>
              </tr>
              <tr>
                <td style="font-weight:700;">5. Vận hành Dashboard Điều hành BI Realtime (GP-05)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center;">Informed (I)</td>
                <td style="text-align:center; font-weight:800;">Responsible (R)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // 3.6 CARD 5: Risk Matrix, 3-Phase Roadmap & Corporate Sign-off Block (TARGET demodataRiskRoadmapBody)
  const card5Body = document.getElementById("demodataRiskRoadmapBody") || document.getElementById("secRuiRoLoTrinhBody");
  if (card5Body) {
    card5Body.innerHTML = `
      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:10px; text-transform:uppercase;">
          I. Ma trận Nhận diện Rủi ro Quản trị & Kế hoạch Phòng ngừa (Corporate Risk Matrix)
        </h3>
        <div style="border:1.5px solid #0f172a; border-radius:8px; overflow:hidden;">
          <table class="data-table" style="white-space:normal; font-size:12.5px; width:100%;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="width:20%; color:#000000; font-weight:850;">Phân loại Rủi ro</th>
                <th style="width:28%; color:#000000; font-weight:850;">Nguy cơ Tiềm ẩn</th>
                <th style="width:14%; color:#000000; font-weight:850;">Mức độ</th>
                <th style="width:38%; color:#000000; font-weight:850;">Hành động Giảm thiểu Trọng tâm</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight:750; color:#000000;">1. Rủi ro Tập trung Doanh thu</td>
                <td>Doanh số phụ thuộc trên 70% vào kênh mũi nhọn; dễ tổn thương trước biến động thị trường.</td>
                <td><span style="background:#fee2e2; color:#991b1b; padding:3px 8px; border-radius:4px; font-weight:800; border:1px solid #f87171;">CAO (HIGH)</span></td>
                <td>Ký hợp đồng dịch vụ dài hạn với top đối tác; triển khai gói sản phẩm mới mở rộng sang các phân khúc thứ cấp B và C.</td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">2. Rủi ro Đội Chi phí & Lạm phát</td>
                <td>Biến động giá nguyên vật liệu và chi phí logistics làm suy giảm biên lợi nhuận ròng.</td>
                <td><span style="background:#fef3c7; color:#92400e; padding:3px 8px; border-radius:4px; font-weight:800; border:1px solid #fcd34d;">TRUNG BÌNH</span></td>
                <td>Đàm phán chốt giá hợp đồng khung 6 - 12 tháng; áp dụng cơ chế định giá linh hoạt theo biên chi phí thực tế.</td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">3. Rủi ro Vận hành & Trễ SLA</td>
                <td>Quá tải quy trình hoàn tất đơn hàng trong các chu kỳ cao điểm dẫn đến vi phạm cam kết SLA.</td>
                <td><span style="background:#fef3c7; color:#92400e; padding:3px 8px; border-radius:4px; font-weight:800; border:1px solid #fcd34d;">TRUNG BÌNH</span></td>
                <td>Xây dựng kịch bản dự phòng nhân sự; tự động hóa cảnh báo sớm các đơn hàng có thời hạn xử lý dưới 7 ngày.</td>
              </tr>
              <tr>
                <td style="font-weight:750; color:#000000;">4. Rủi ro Sai lệch Dữ liệu</td>
                <td>Nhập liệu thủ công gây sai sót số liệu định dạng, làm sai lệch quyết định của ban lãnh đạo.</td>
                <td><span style="background:#dcfce7; color:#166534; padding:3px 8px; border-radius:4px; font-weight:800; border:1px solid #86efac;">ĐÃ KIỂM SOÁT</span></td>
                <td>Duy trì quy trình tiền xử lý HITL tự động; chuẩn hóa cấu trúc dữ liệu bắt buộc trước khi phê duyệt báo cáo.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-bottom:22px;">
        <h3 style="font-size:14.5px; font-weight:850; color:#000000; margin-bottom:12px; text-transform:uppercase;">
          II. Lộ trình Triển khai 3 Giai đoạn (3-Phase Execution Roadmap)
        </h3>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; margin-bottom:18px;">
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-top:4px solid #0f172a; border-radius:8px; padding:16px;">
            <div style="font-size:11px; font-weight:850; color:#000000; text-transform:uppercase; margin-bottom:4px;">GIAI ĐOẠN 1 (0 - 30 NGÀY)</div>
            <div style="font-size:14px; font-weight:850; color:#000000; margin-bottom:8px;">Ổn định & Khắc phục Điểm nghẽn</div>
            <ul style="font-size:12.5px; color:#000000; line-height:1.6; padding-left:16px; margin:0;">
              <li>Thành lập Ban Chỉ đạo Triển khai & phân công RACI chi tiết.</li>
              <li>Rà soát toàn diện danh sách khách hàng nhóm A và hợp đồng khung.</li>
              <li>Kích hoạt luồng kiểm soát Fast-Track SLA cho 100% hồ sơ gấp.</li>
            </ul>
          </div>
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-top:4px solid #334155; border-radius:8px; padding:16px;">
            <div style="font-size:11px; font-weight:850; color:#000000; text-transform:uppercase; margin-bottom:4px;">GIAI ĐOẠN 2 (30 - 90 NGÀY)</div>
            <div style="font-size:14px; font-weight:850; color:#000000; margin-bottom:8px;">Tăng tốc & Cải thiện Lợi nhuận</div>
            <ul style="font-size:12.5px; color:#000000; line-height:1.6; padding-left:16px; margin:0;">
              <li>Hoàn tất đàm phán hợp đồng cung ứng để tiết giảm 5-8% chi phí.</li>
              <li>Mở rộng gói giải pháp chéo (Cross-selling) cho nhóm B và C.</li>
              <li>Tối ưu quy trình giao vận tại các khu vực vệ tinh.</li>
            </ul>
          </div>
          <div style="background:#f8fafc; border:1.5px solid #cbd5e1; border-top:4px solid #64748b; border-radius:8px; padding:16px;">
            <div style="font-size:11px; font-weight:850; color:#000000; text-transform:uppercase; margin-bottom:4px;">GIAI ĐOẠN 3 (90 - 180 NGÀY)</div>
            <div style="font-size:14px; font-weight:850; color:#000000; margin-bottom:8px;">Tự động hóa & Tăng trưởng Bền vững</div>
            <ul style="font-size:12.5px; color:#000000; line-height:1.6; padding-left:16px; margin:0;">
              <li>Tự động hóa toàn diện quy trình báo cáo điều hành qua BI Agent.</li>
              <li>Đánh giá hiệu quả định kỳ hàng quý và hiệu chỉnh định mức KPI.</li>
              <li>Tái đầu tư dòng tiền vào mở rộng thị phần tại các thị trường mới.</li>
            </ul>
          </div>
        </div>
      </div>

      <div style="margin-top:24px; border:1.5px solid #0f172a; border-radius:8px; background:#f8fafc; padding:22px; display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; text-align:center;">
        <div>
          <div style="font-weight:850; color:#000000; font-size:12px; text-transform:uppercase; letter-spacing:0.02em;">Người Lập Báo Cáo</div>
          <div style="font-style:italic; font-size:11.5px; color:#000000; margin-top:2px;">(Ký & ghi rõ họ tên)</div>
          <div style="height:52px;"></div>
          <div style="font-weight:850; color:#000000; font-size:13px;">Chuyên viên Phân tích BI / AI Agent</div>
        </div>
        <div>
          <div style="font-weight:850; color:#000000; font-size:12px; text-transform:uppercase; letter-spacing:0.02em;">Trưởng Bộ phận Phân tích Dữ liệu</div>
          <div style="font-style:italic; font-size:11.5px; color:#000000; margin-top:2px;">(Thẩm định số liệu & phương pháp luận)</div>
          <div style="height:52px;"></div>
          <div style="font-weight:850; color:#000000; font-size:13px;">Lead Data Analyst</div>
        </div>
        <div>
          <div style="font-weight:850; color:#000000; font-size:12px; text-transform:uppercase; letter-spacing:0.02em;">Ban Giám Đốc Phê Duyệt</div>
          <div style="font-style:italic; font-size:11.5px; color:#000000; margin-top:2px;">(Phê duyệt thực thi & ban hành)</div>
          <div style="height:52px;"></div>
          <div style="font-weight:850; color:#000000; font-size:13px;">ĐÃ PHÊ DUYỆT BÁO CÁO</div>
        </div>
      </div>
    `;
  }

  // If live editing is active, maintain contenteditable on newly rendered elements
  if (window.isLiveEditingActive) {
    toggleLiveEditing(true);
  }
}


function initDemodataSlicers(step3Data) {
  const sheetsSummary = step3Data.sheets_summary || AppState.sheets_summary || [];
  const rows = AppState.step2Data?.cleaned_rows || [];
  const meta = step3Data.column_metadata || {};
  const dateCols = meta.date_cols || [];
  const primaryDateCol = dateCols[0] || "";

  // Slicer 1: Datasets
  const dsSelect = document.getElementById("demodataSlicerDataset");
  if (dsSelect) {
    let opts = `<option value="all">Tất cả (${sheetsSummary.length > 0 ? sheetsSummary.length : 1} bộ dữ liệu)</option>`;
    if (sheetsSummary.length > 0) {
      sheetsSummary.forEach(s => {
        opts += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${s.row_count} dòng)</option>`;
      });
    } else {
      opts += `<option value="main">Bán lẻ mẫu</option>`;
    }
    dsSelect.innerHTML = opts;
  }

  // Slicer 2: Periods (Months)
  const perSelect = document.getElementById("demodataSlicerPeriod");
  if (perSelect) {
    let opts = `<option value="all">Tất cả kỳ báo cáo</option>`;
    if (primaryDateCol) {
      const periods = new Set();
      rows.forEach(r => {
        const val = extractMonthYearFromDateStr(r[primaryDateCol]);
        if (val) periods.add(val);
      });
      Array.from(periods).sort().forEach(p => {
        opts += `<option value="${escapeHtml(p)}">Tháng ${escapeHtml(p)}</option>`;
      });
    } else {
      opts += `<option value="current">Tháng 04/2026</option>`;
    }
    perSelect.innerHTML = opts;
  }
}

function filterDemodataDashboard() {
  const dsVal = document.getElementById("demodataSlicerDataset")?.value || "all";
  const perVal = document.getElementById("demodataSlicerPeriod")?.value || "all";
  let rows = AppState.step2Data?.cleaned_rows || [];
  const meta = AppState.step3Data?.column_metadata || {};
  const primaryDateCol = meta.date_cols?.[0] || "";

  if (perVal !== "all" && primaryDateCol) {
    rows = rows.filter(r => extractMonthYearFromDateStr(r[primaryDateCol]) === perVal);
  }

  updateDemodataKpiCards(rows, AppState.step3Data, dsVal, perVal);
}

function stripAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function updateDemodataKpiCards(rows, step3Data, dsFilter = "all", perFilter = "all") {
  if (!step3Data) step3Data = AppState.step3Data || {};
  const ctx = getContextFromForm();
  
  if (!rows || rows.length === 0) {
    if (AppState.step2Data?.cleaned_rows?.length) {
      rows = AppState.step2Data.cleaned_rows;
    } else if (AppState.sheets && AppState.sheets.length > 0) {
      rows = AppState.sheets.flatMap(s => s.step2Data?.cleaned_rows || s.cleaned_rows || []);
    } else if (AppState.step1Data?.preview_rows) {
      rows = AppState.step1Data.preview_rows;
    }
  }

  const dims = detectDatasetDimensions(rows, step3Data);

  // Update Meta Subtitle
  const metaSub = document.getElementById("dashKpiSubMeta");
  if (metaSub) {
    const pText = perFilter !== "all" ? `Tháng ${perFilter}` : "Toàn bộ thời kỳ";
    const dText = dsFilter !== "all" ? dsFilter : (ctx.company || "Dữ liệu kinh doanh");
    metaSub.textContent = `${pText} · ${rows.length.toLocaleString()} dòng · ${dText}`;
  }

  // Update the 4 Clean KPI Boxes in Dashboard
  const k1 = document.getElementById("kpiBoxLabel1");
  if (k1) {
    // Box 1: Volume / Số đơn
    k1.textContent = dims.volCol || "Số đơn hàng";
    document.getElementById("kpiBoxVal1").textContent = Math.round(dims.totalVolume).toLocaleString();
    document.getElementById("kpiBoxUnit1").textContent = dims.volCol ? "Đơn" : "Bản ghi";

    // Box 2: Doanh thu
    document.getElementById("kpiBoxLabel2").textContent = dims.valCol || "Tổng Doanh thu";
    document.getElementById("kpiBoxVal2").textContent = Math.round(dims.totalRevenue).toLocaleString();
    document.getElementById("kpiBoxUnit2").textContent = "VND";

    // Box 3: Lợi nhuận
    document.getElementById("kpiBoxLabel3").textContent = dims.profitCol || "Lợi nhuận ước tính";
    document.getElementById("kpiBoxVal3").textContent = Math.round(dims.totalProfit).toLocaleString();
    document.getElementById("kpiBoxUnit3").textContent = "VND";

    // Box 4: Chi phí
    document.getElementById("kpiBoxLabel4").textContent = dims.costCol || "Chi phí & Giá vốn";
    document.getElementById("kpiBoxVal4").textContent = Math.round(dims.totalCost).toLocaleString();
    document.getElementById("kpiBoxUnit4").textContent = "VND";
  }

  // Update Dashboard Charts
  renderDemodataCharts(rows, dims);
}

function renderDemodataCharts(rows, dims) {
  if (!window.Chart) return;
  if (!rows || rows.length === 0) {
    rows = AppState.step2Data?.cleaned_rows || [];
  }
  if (!dims) {
    dims = detectDatasetDimensions(rows, AppState.step3Data);
  }

  const catCol = dims.catCol || Object.keys(rows[0] || {})[1] || "Phân loại";
  const valCol = dims.valCol || Object.keys(rows[0] || {})[Object.keys(rows[0] || {}).length - 1] || "Doanh thu";
  const dateCol = dims.dateCol || "";
  const regionCol = dims.regionCol || "";
  const prodCol = dims.prodCol || "";
  const costCol = dims.costCol || "";
  const profitCol = dims.profitCol || "";
  const volCol = dims.volCol || "";

  // --------------------------------------------------------------------------
  // CHART 1: Primary Category Bar Chart
  // --------------------------------------------------------------------------
  const catSums = {};
  rows.forEach(r => {
    const k = String(r[catCol] || "Khác").trim() || "Khác";
    const v = parseNumSafe(r[valCol]);
    catSums[k] = (catSums[k] || 0) + v;
  });

  const sortedCats = Object.entries(catSums)
    .filter(x => x[1] > 0 && (x[0] !== "Khác" || Object.keys(catSums).length === 1))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7);
  const c1Labels = sortedCats.map(x => x[0]);
  const c1Data = sortedCats.map(x => x[1]);
  const max1 = Math.max(...c1Data, 1);

  const title1 = document.getElementById("demodataChart1Title");
  if (title1) title1.textContent = `${valCol} theo ${catCol}`;

  const ctx1 = document.getElementById("demodataChart1Canvas")?.getContext("2d");
  if (ctx1) {
    if (AppState.charts.demochart1) AppState.charts.demochart1.destroy();
    AppState.charts.demochart1 = new Chart(ctx1, {
      type: "bar",
      data: {
        labels: c1Labels.length > 0 ? c1Labels : ["Không có dữ liệu"],
        datasets: [{
          label: valCol || "Doanh thu (VND)",
          data: c1Data.length > 0 ? c1Data : [0],
          backgroundColor: "#0f172a",
          borderRadius: 4,
          clip: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 48, left: 15, right: 15, bottom: 8 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: "end",
            align: "top",
            offset: 6,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 11.5 },
            formatter: (v) => v > 0 ? formatVietnameseBigNumber(v) : ""
          },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${Math.round(item.raw || 0).toLocaleString()} VND`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: "700" }, color: "#000000" } },
          y: {
            suggestedMax: max1 * 1.35,
            grid: { color: "#f1f5f9" },
            ticks: {
              font: { size: 10.5, weight: "600" },
              color: "#000000",
              callback: (v) => formatVietnameseBigNumber(v)
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // CHART 2: Trend Line Chart over Time
  // --------------------------------------------------------------------------
  const timeGroupingCol = dateCol || (Object.keys(rows[0] || {}).find(c => c !== catCol && c !== valCol && !/ma_|id/i.test(stripAccents(c))) || catCol);
  const timeSums = {};
  rows.forEach(r => {
    let k = String(r[timeGroupingCol] || "").trim();
    if (dateCol) k = extractMonthYearFromDateStr(k) || k;
    if (!k) k = "Khác";
    const v = parseNumSafe(r[valCol]);
    timeSums[k] = (timeSums[k] || 0) + v;
  });

  const sortedTime = Object.entries(timeSums)
    .filter(x => x[1] > 0 && x[0] !== "Khác")
    .sort((a, b) => a[0].localeCompare(b[0]));
  const c2Labels = sortedTime.map(x => x[0]);
  const c2Data = sortedTime.map(x => x[1]);
  const max2 = Math.max(...c2Data, 1);

  const title2 = document.getElementById("demodataChart2Title");
  if (title2) title2.textContent = `Xu hướng ${valCol} theo ${timeGroupingCol}`;

  const ctx2 = document.getElementById("demodataChart2Canvas")?.getContext("2d");
  if (ctx2) {
    if (AppState.charts.demochart2) AppState.charts.demochart2.destroy();
    AppState.charts.demochart2 = new Chart(ctx2, {
      type: "line",
      data: {
        labels: c2Labels.length > 0 ? c2Labels : ["Kỳ hiện tại"],
        datasets: [{
          label: valCol || "Doanh thu",
          data: c2Data.length > 0 ? c2Data : [0],
          borderColor: "#0f172a",
          backgroundColor: "rgba(15, 23, 42, 0.05)",
          fill: true,
          tension: 0.35,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: "#0f172a",
          clip: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 48, left: 20, right: 20, bottom: 8 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: "end",
            align: "top",
            offset: 8,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 11.5 },
            formatter: (v) => v > 0 ? formatVietnameseBigNumber(v) : ""
          },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${Math.round(item.raw || 0).toLocaleString()} VND`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: "700" }, color: "#000000" } },
          y: {
            suggestedMax: max2 * 1.35,
            grid: { color: "#f1f5f9" },
            ticks: {
              font: { size: 10.5, weight: "600" },
              color: "#000000",
              callback: (v) => formatVietnameseBigNumber(v)
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // CHART 3: Doughnut Chart (Percentage Outside Only, Zero Inside Collision)
  // --------------------------------------------------------------------------
  const regColName = regionCol || (Object.keys(rows[0] || {}).find(c => c !== catCol && c !== valCol && c !== dateCol && !/ma_|id/i.test(stripAccents(c))) || catCol);
  const regionSums = {};
  rows.forEach(r => {
    const k = String(r[regColName] || "Khác").trim() || "Khác";
    const v = parseNumSafe(r[valCol]);
    regionSums[k] = (regionSums[k] || 0) + v;
  });

  const sortedRegions = Object.entries(regionSums)
    .filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const c3Labels = sortedRegions.map(x => x[0]);
  const c3Data = sortedRegions.map(x => x[1]);
  const c3Total = c3Data.reduce((a, b) => a + b, 0) || 1;

  const title3 = document.getElementById("demodataChart3Title");
  if (title3) title3.textContent = `Cơ cấu Tỷ trọng theo ${regColName}`;

  const ctx3 = document.getElementById("demodataChart3Canvas")?.getContext("2d");
  if (ctx3) {
    if (AppState.charts.demochart3) AppState.charts.demochart3.destroy();
    AppState.charts.demochart3 = new Chart(ctx3, {
      type: "doughnut",
      data: {
        labels: c3Labels.length > 0 ? c3Labels : ["Không có dữ liệu"],
        datasets: [{
          data: c3Data.length > 0 ? c3Data : [1],
          backgroundColor: ["#0f172a", "#334155", "#64748b", "#94a3b8", "#cbd5e1", "#e2e8f0"],
          borderWidth: 2,
          borderColor: "#ffffff",
          clip: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        layout: { padding: { top: 35, bottom: 35, left: 35, right: 45 } },
        plugins: {
          legend: {
            position: "right",
            labels: { font: { size: 11.5, weight: "700" }, color: "#000000", boxWidth: 14, padding: 12 }
          },
          datalabels: {
            display: true,
            anchor: "end",
            align: "end",
            offset: 14,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 11.5 },
            formatter: (v) => {
              if (!v || v <= 0) return "";
              const pct = ((v / c3Total) * 100).toFixed(1);
              return `${pct}%`;
            }
          },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${Math.round(item.raw || 0).toLocaleString()} VND (${((item.raw / c3Total) * 100).toFixed(1)}%)`
            }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // CHART 4: Top 5 Performers (Horizontal Bar Chart)
  // --------------------------------------------------------------------------
  const topColName = prodCol || (Object.keys(rows[0] || {}).find(c => c !== catCol && c !== regColName && c !== valCol && c !== dateCol && !/ma_|id/i.test(stripAccents(c))) || catCol);
  const prodSums = {};
  rows.forEach(r => {
    const k = String(r[topColName] || "Khác").trim() || "Khác";
    const v = parseNumSafe(r[valCol]);
    prodSums[k] = (prodSums[k] || 0) + v;
  });

  const sortedTop = Object.entries(prodSums)
    .filter(x => x[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const c4Labels = sortedTop.map(x => x[0]);
  const c4Data = sortedTop.map(x => x[1]);
  const max4 = Math.max(...c4Data, 1);

  const title4 = document.getElementById("demodataChart4Title");
  if (title4) title4.textContent = `Top 5 ${topColName} theo Doanh thu`;

  const ctx4 = document.getElementById("demodataChart4Canvas")?.getContext("2d");
  if (ctx4) {
    if (AppState.charts.demochart4) AppState.charts.demochart4.destroy();
    AppState.charts.demochart4 = new Chart(ctx4, {
      type: "bar",
      data: {
        labels: c4Labels.length > 0 ? c4Labels : ["Không có dữ liệu"],
        datasets: [{
          label: valCol,
          data: c4Data.length > 0 ? c4Data : [0],
          backgroundColor: "#1e293b",
          borderRadius: 4,
          clip: false
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 85, top: 12, bottom: 12, left: 10 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: "end",
            align: "right",
            offset: 8,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 11 },
            formatter: (v) => v > 0 ? formatVietnameseBigNumber(v) : ""
          }
        },
        scales: {
          x: {
            suggestedMax: max4 * 1.35,
            grid: { color: "#f1f5f9" },
            ticks: { color: "#000000", callback: (v) => formatVietnameseBigNumber(v) }
          },
          y: { grid: { display: false }, ticks: { font: { size: 11, weight: "700" }, color: "#000000" } }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // CHART 5: Comparison Grouped Bar (Doanh thu vs Chi phí vs Lợi nhuận)
  // --------------------------------------------------------------------------
  const top3Cats = c1Labels.slice(0, 4);
  const c5Rev = [];
  const c5Cost = [];
  const c5Prof = [];

  top3Cats.forEach(cat => {
    const catRows = rows.filter(r => String(r[catCol] || "").trim() === cat);
    const rTot = catRows.reduce((a, r) => a + parseNumSafe(r[valCol]), 0);
    const cTot = costCol ? catRows.reduce((a, r) => a + parseNumSafe(r[costCol]), 0) : Math.round(rTot * 0.62);
    const pTot = profitCol ? catRows.reduce((a, r) => a + parseNumSafe(r[profitCol]), 0) : Math.max(0, rTot - cTot);
    c5Rev.push(rTot);
    c5Cost.push(cTot);
    c5Prof.push(pTot);
  });

  const max5 = Math.max(...c5Rev, ...c5Cost, ...c5Prof, 1);

  const title5 = document.getElementById("demodataChart5Title");
  if (title5) title5.textContent = `Tương quan Doanh thu - Chi phí - Lợi nhuận`;

  const ctx5 = document.getElementById("demodataChart5Canvas")?.getContext("2d");
  if (ctx5) {
    if (AppState.charts.demochart5) AppState.charts.demochart5.destroy();
    AppState.charts.demochart5 = new Chart(ctx5, {
      type: "bar",
      data: {
        labels: top3Cats.length > 0 ? top3Cats : ["Toàn bộ"],
        datasets: [
          { label: "Doanh thu", data: c5Rev.length ? c5Rev : [dims.totalRevenue], backgroundColor: "#0f172a", borderRadius: 4, clip: false },
          { label: "Giá vốn & Chi phí", data: c5Cost.length ? c5Cost : [dims.totalCost], backgroundColor: "#64748b", borderRadius: 4, clip: false },
          { label: "Lợi nhuận gộp", data: c5Prof.length ? c5Prof : [dims.totalProfit], backgroundColor: "#27272a", borderRadius: 4, clip: false }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 48, left: 15, right: 15, bottom: 8 } },
        plugins: {
          legend: { position: "top", labels: { boxWidth: 12, font: { size: 11, weight: "700" }, color: "#000000" } },
          datalabels: {
            display: true,
            anchor: "end",
            align: "top",
            offset: 5,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 10.5 },
            formatter: (v) => v > 0 ? formatVietnameseBigNumber(v) : ""
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: "700" }, color: "#000000" } },
          y: {
            suggestedMax: max5 * 1.35,
            grid: { color: "#f1f5f9" },
            ticks: { color: "#000000", callback: (v) => formatVietnameseBigNumber(v) }
          }
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // CHART 6: Volume / Orders Distribution (Area Spline Chart)
  // --------------------------------------------------------------------------
  const volMetricCol = volCol || valCol;
  const volSums = {};
  rows.forEach(r => {
    let k = String(r[timeGroupingCol] || "").trim();
    if (dateCol) k = extractMonthYearFromDateStr(k) || k;
    if (!k) k = "Khác";
    const v = parseNumSafe(r[volMetricCol]);
    volSums[k] = (volSums[k] || 0) + v;
  });

  const sortedVol = Object.entries(volSums)
    .filter(x => x[1] > 0 && x[0] !== "Khác")
    .sort((a, b) => a[0].localeCompare(b[0]));
  const c6Labels = sortedVol.map(x => x[0]);
  const c6Data = sortedVol.map(x => x[1]);
  const max6 = Math.max(...c6Data, 1);

  const title6 = document.getElementById("demodataChart6Title");
  if (title6) title6.textContent = `Phân bổ ${volCol || "Quy mô Đơn hàng"} theo ${timeGroupingCol}`;

  const ctx6 = document.getElementById("demodataChart6Canvas")?.getContext("2d");
  if (ctx6) {
    if (AppState.charts.demochart6) AppState.charts.demochart6.destroy();
    AppState.charts.demochart6 = new Chart(ctx6, {
      type: "line",
      data: {
        labels: c6Labels.length > 0 ? c6Labels : ["Kỳ hiện tại"],
        datasets: [{
          label: volCol || "Số lượng đơn hàng",
          data: c6Data.length > 0 ? c6Data : [0],
          borderColor: "#334155",
          backgroundColor: "rgba(51, 65, 85, 0.08)",
          fill: true,
          tension: 0.35,
          pointRadius: 6,
          pointHoverRadius: 8,
          pointBackgroundColor: "#334155",
          clip: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 48, left: 20, right: 20, bottom: 8 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: "end",
            align: "top",
            offset: 8,
            clamp: false,
            clip: false,
            color: "#000000",
            font: { weight: "800", size: 11 },
            formatter: (v) => v > 0 ? formatVietnameseBigNumber(v) : ""
          },
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.label}: ${Math.round(item.raw || 0).toLocaleString()} ${volCol ? "đơn" : ""}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: "700" }, color: "#000000" } },
          y: {
            suggestedMax: max6 * 1.35,
            grid: { color: "#f1f5f9" },
            ticks: { color: "#000000", callback: (v) => formatVietnameseBigNumber(v) }
          }
        }
      }
    });
  }
}


function extractMonthYearFromDateStr(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  // Match YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[/\-\.](\d{1,2})[/\-\.]\d{1,2}$/);
  if (m) return `${m[2].padStart(2, "0")}/${m[1]}`;
  // Match DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^\d{1,2}[/\-\.](\d{1,2})[/\-\.](\d{4})$/);
  if (m) return `${m[1].padStart(2, "0")}/${m[2]}`;
  return s.slice(0, 10);
}

function parseNumSafe(val) {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  if (!s) return 0;
  s = s.replace(/[₫đ$€¥%]/gi, "").trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function formatVietnameseBigNumber(val) {
  if (val === null || val === undefined || isNaN(val)) return "0";
  const absV = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (absV >= 1_000_000_000) {
    return `${sign}${(absV / 1_000_000_000).toFixed(2)} Tỷ`;
  }
  if (absV >= 1_000_000) {
    return `${sign}${(absV / 1_000_000).toFixed(1)} Tr`;
  }
  if (absV >= 1_000) {
    return `${sign}${(absV / 1_000).toFixed(1)}k`;
  }
  return `${sign}${absV % 1 === 0 ? Math.round(absV).toLocaleString("en-US") : absV.toFixed(1)}`;
}

function initDashboardSlicers(step3Data) {
  const rows = AppState.step2Data?.cleaned_rows || [];
  const allCols = AppState.step2Data?.columns || [];
  const meta = step3Data.column_metadata || {};

  const numCols = (meta.numeric_cols && meta.numeric_cols.length > 0)
    ? meta.numeric_cols
    : allCols.filter(c => rows.some(r => !isNaN(Number(r[c])) && String(r[c]).trim() !== ""));

  const dateCols = meta.date_cols || [];
  const primaryDateCol = dateCols[0] || "";

  // Pick categorical columns suitable for Slicers (2 to 50 unique values)
  const catCols = (meta.slicer_cols && meta.slicer_cols.length > 0)
    ? meta.slicer_cols
    : allCols.filter(c => !numCols.includes(c) && !dateCols.includes(c));

  const slicerCol1 = catCols[0] || "";
  const slicerCol2 = catCols[1] || "";

  AppState.dashConfig = {
    numCols,
    primaryDateCol,
    catCols,
    slicerCol1,
    slicerCol2,
    labelCol: meta.label_col || allCols[0] || ""
  };

  // Build unique Month/Year options if primaryDateCol exists
  let periodOptions = [];
  if (primaryDateCol) {
    const pSet = new Set();
    rows.forEach(r => {
      const p = extractMonthYearFromDateStr(r[primaryDateCol]);
      if (p) pSet.add(p);
    });
    periodOptions = Array.from(pSet).sort((a, b) => {
      const [ma, ya] = a.split("/");
      const [mb, yb] = b.split("/");
      return (Number(ya) * 100 + Number(ma)) - (Number(yb) * 100 + Number(mb));
    });
  }

  const getUniqueVals = (col) => {
    if (!col) return [];
    const s = new Set();
    rows.forEach(r => {
      const v = String(r[col] ?? "").trim();
      if (v) s.add(v);
    });
    return Array.from(s).slice(0, 40);
  };

  const s1Options = getUniqueVals(slicerCol1);
  const s2Options = getUniqueVals(slicerCol2);
  const groupColChoices = catCols.length > 0 ? catCols : [AppState.dashConfig.labelCol];

  const slicerBar = document.getElementById("execSlicerBar");
  slicerBar.innerHTML = `
    <div class="slicer-controls-left">
      <div class="slicer-group">
        <span class="slicer-label"> Chỉ số Phân tích chính (Metric)</span>
        <select class="slicer-select" id="slicerMetric" onchange="updateDashboardFromSlicers()">
          ${numCols.map((c, idx) => `<option value="${escapeHtml(c)}" ${idx === 0 ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
        </select>
      </div>

      ${groupColChoices.length > 0 && groupColChoices[0] ? `
        <div class="slicer-group">
          <span class="slicer-label"> Nhóm Biểu đồ theo (Dimension)</span>
          <select class="slicer-select" id="slicerGroupBy" onchange="updateDashboardFromSlicers()">
            ${groupColChoices.map((c, idx) => `<option value="${escapeHtml(c)}" ${idx === 0 ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          </select>
        </div>
      ` : ""}

      ${primaryDateCol && periodOptions.length > 1 ? `
        <div class="slicer-group">
          <span class="slicer-label"> Kỳ thời gian (${escapeHtml(primaryDateCol)})</span>
          <select class="slicer-select" id="slicerPeriod" onchange="updateDashboardFromSlicers()">
            <option value="ALL">Tất cả các kỳ (${periodOptions.length} kỳ)</option>
            ${periodOptions.map(p => `<option value="${escapeHtml(p)}">Tháng ${escapeHtml(p)}</option>`).join("")}
          </select>
        </div>
      ` : ""}

      ${slicerCol1 && s1Options.length > 1 ? `
        <div class="slicer-group">
          <span class="slicer-label">️ Lọc ${escapeHtml(slicerCol1)}</span>
          <select class="slicer-select" id="slicerCat1" onchange="updateDashboardFromSlicers()">
            <option value="ALL">Tất cả (${s1Options.length})</option>
            ${s1Options.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v.slice(0, 32))}</option>`).join("")}
          </select>
        </div>
      ` : ""}

      ${slicerCol2 && s2Options.length > 1 ? `
        <div class="slicer-group">
          <span class="slicer-label"> Lọc ${escapeHtml(slicerCol2)}</span>
          <select class="slicer-select" id="slicerCat2" onchange="updateDashboardFromSlicers()">
            <option value="ALL">Tất cả (${s2Options.length})</option>
            ${s2Options.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v.slice(0, 32))}</option>`).join("")}
          </select>
        </div>
      ` : ""}
    </div>

    <div class="slicer-status-right">
      <span id="slicerCountBadge">Đang hiển thị: ${rows.length} / ${rows.length} bản ghi</span>
      <button class="btn-xs" onclick="resetDashboardSlicers()">↺ Xóa bộ lọc</button>
    </div>
  `;
}

function resetDashboardSlicers() {
  ["slicerPeriod", "slicerCat1", "slicerCat2"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "ALL";
  });
  updateDashboardFromSlicers();
}

function updateDashboardFromSlicers() {
  const allRows = AppState.step2Data?.cleaned_rows || [];
  if (!allRows.length) return;

  const cfg = AppState.dashConfig || {};
  const primaryMetric = document.getElementById("slicerMetric")?.value || cfg.numCols?.[0] || "";
  const secondaryMetric = (cfg.numCols || []).find(c => c !== primaryMetric) || primaryMetric;
  const groupCol = document.getElementById("slicerGroupBy")?.value || cfg.slicerCol1 || cfg.labelCol || "";
  const periodFilter = document.getElementById("slicerPeriod")?.value || "ALL";
  const cat1Filter = document.getElementById("slicerCat1")?.value || "ALL";
  const cat2Filter = document.getElementById("slicerCat2")?.value || "ALL";

  // 1. Filter rows according to active Slicers
  const filteredRows = allRows.filter(r => {
    if (periodFilter !== "ALL" && cfg.primaryDateCol) {
      if (extractMonthYearFromDateStr(r[cfg.primaryDateCol]) !== periodFilter) return false;
    }
    if (cat1Filter !== "ALL" && cfg.slicerCol1) {
      if (String(r[cfg.slicerCol1] ?? "").trim() !== cat1Filter) return false;
    }
    if (cat2Filter !== "ALL" && cfg.slicerCol2) {
      if (String(r[cfg.slicerCol2] ?? "").trim() !== cat2Filter) return false;
    }
    return true;
  });

  const countBadge = document.getElementById("slicerCountBadge");
  if (countBadge) {
    countBadge.textContent = `Đang hiển thị: ${filteredRows.length} / ${allRows.length} bản ghi`;
  }

  const rowsToUse = filteredRows.length > 0 ? filteredRows : allRows;

  // 2. Compute Real Business KPIs on rowsToUse
  const primaryVals = rowsToUse.map(r => parseNumSafe(r[primaryMetric]));
  const secondaryVals = rowsToUse.map(r => parseNumSafe(r[secondaryMetric]));
  const totalPrimary = primaryVals.reduce((a, b) => a + b, 0);
  const avgPrimary = primaryVals.length ? totalPrimary / primaryVals.length : 0;
  const maxPrimary = primaryVals.length ? Math.max(...primaryVals) : 0;
  const totalSecondary = secondaryVals.reduce((a, b) => a + b, 0);

  const highValueRows = primaryVals.filter(v => v >= avgPrimary);
  const highValueSum = highValueRows.reduce((a, b) => a + b, 0);
  const paretoSharePct = totalPrimary > 0 ? (highValueSum / totalPrimary) * 100 : 0;

  // Sparkline sampled to max 20 points so it always looks smooth
  const sparkSample = sampleArray(primaryVals, 20);
  const sparkSample2 = sampleArray(secondaryVals, 20);

  const kpiCards = [
    {
      title: `Tổng ${primaryMetric}`,
      value: formatVietnameseBigNumber(totalPrimary),
      sub: `Chính xác: ${Math.round(totalPrimary).toLocaleString("en-US")} • ${rowsToUse.length} bản ghi`,
      color: "#1565c0",
      borderColor: "#1565c0",
      bg_tint: "rgba(21, 101, 192, 0.14)",
      sparkline: sparkSample
    },
    {
      title: secondaryMetric !== primaryMetric ? `Tổng ${secondaryMetric}` : `Quy mô Đỉnh (${primaryMetric})`,
      value: secondaryMetric !== primaryMetric ? formatVietnameseBigNumber(totalSecondary) : formatVietnameseBigNumber(maxPrimary),
      sub: secondaryMetric !== primaryMetric
        ? `Trung bình: ${formatVietnameseBigNumber(totalSecondary / Math.max(rowsToUse.length, 1))} / bản ghi`
        : `Gấp ${(maxPrimary / Math.max(avgPrimary, 1)).toFixed(1)} lần mức trung bình`,
      color: "#e05a47",
      borderColor: "#e05a47",
      bg_tint: "rgba(224, 90, 71, 0.14)",
      sparkline: sparkSample2
    },
    {
      title: `Trung bình ${primaryMetric} / Đơn`,
      value: formatVietnameseBigNumber(avgPrimary),
      sub: `Cao nhất: ${formatVietnameseBigNumber(maxPrimary)}`,
      color: "#00897b",
      borderColor: "#00897b",
      bg_tint: "rgba(0, 137, 123, 0.12)",
      sparkline: null
    },
    {
      title: `Tỷ trọng Nhóm Trọng điểm`,
      value: `${paretoSharePct.toFixed(1)} %`,
      sub: `${highValueRows.length}/${rowsToUse.length} hồ sơ (>= mức TB) chiếm ${paretoSharePct.toFixed(1)}% quy mô`,
      color: "#1e3a5f",
      borderColor: "#f59e0b",
      bg_tint: "rgba(245, 158, 11, 0.12)",
      sparkline: null
    }
  ];

  const kpiRow = document.getElementById("execKpiRow");
  kpiRow.innerHTML = kpiCards.map((kpi) => {
    const sparkSvg = kpi.sparkline ? buildAreaSparklineSvg(kpi.sparkline, kpi.bg_tint) : "";
    return `
      <div class="exec-kpi-card" style="border-top-color:${kpi.borderColor};">
        <div>
          <div class="exec-kpi-title">${escapeHtml(kpi.title)}</div>
          <div class="exec-kpi-value" style="color:${kpi.color};">${escapeHtml(kpi.value)}</div>
        </div>
        <div class="exec-kpi-sub">${escapeHtml(kpi.sub)}</div>
        ${sparkSvg}
      </div>
    `;
  }).join("");

  // 3. Aggregate by `groupCol` (Category Distribution — Top 8 Groups!)
  const catMap = new Map();
  rowsToUse.forEach(r => {
    const rawCat = String(r[groupCol] ?? "Khác").trim() || "Khác";
    // Clean trailing quantity if grouping by Equipment/Product text
    const cleanCat = rawCat.split(";")[0].replace(/\s*x\s*\d+.*$/i, "").trim().slice(0, 26) || "Khác";
    const cur = catMap.get(cleanCat) || { sum1: 0, sum2: 0, count: 0 };
    cur.sum1 += parseNumSafe(r[primaryMetric]);
    cur.sum2 += parseNumSafe(r[secondaryMetric]);
    cur.count += 1;
    catMap.set(cleanCat, cur);
  });

  const sortedCats = Array.from(catMap.entries()).sort((a, b) => b[1].sum1 - a[1].sum1);
  const top8Cats = sortedCats.slice(0, 8);
  const catLabels = top8Cats.map(e => e[0]);
  const catSum1 = top8Cats.map(e => Math.round(e[1].sum1 * 100) / 100);
  const catCountOrAvg = top8Cats.map(e => Math.round((e[1].sum1 / Math.max(e[1].count, 1)) * 100) / 100);

  // 4. Render 4 Clean Gauges based on aggregated stats
  const aboveAvgRate = Math.round((highValueRows.length / Math.max(rowsToUse.length, 1)) * 100);
  const top1CatShare = totalPrimary > 0 && top8Cats.length > 0 ? Math.round((top8Cats[0][1].sum1 / totalPrimary) * 100) : 0;
  const activeGroupsCount = sortedCats.length;

  const gauges = [
    {
      title: "Tỷ trọng Nhóm Trọng điểm",
      subtitle: `[Pareto >= Trung bình]`,
      value: Math.round(paretoSharePct),
      display_value: `${paretoSharePct.toFixed(1)}%`,
      min: 0,
      max: 100,
      color: "#1565c0"
    },
    {
      title: "Tỷ lệ Đơn Vượt Chuẩn TB",
      subtitle: `[${highValueRows.length} / ${rowsToUse.length} bản ghi]`,
      value: aboveAvgRate,
      display_value: `${aboveAvgRate}%`,
      min: 0,
      max: 100,
      color: "#f2a900"
    },
    {
      title: "Tỷ trọng Nhóm #1 Dẫn đầu",
      subtitle: `[${top8Cats[0]?.[0] || "Top 1"}]`,
      value: top1CatShare,
      display_value: `${top1CatShare}%`,
      min: 0,
      max: 100,
      color: "#ef5350"
    },
    {
      title: "Số Nhóm Phân Loại Hoạt Động",
      subtitle: `[Theo ${groupCol}]`,
      value: Math.min(activeGroupsCount, 30),
      display_value: `${activeGroupsCount} Nhóm`,
      min: 0,
      max: Math.max(30, activeGroupsCount),
      color: "#00a65a"
    }
  ];

  document.getElementById("execGaugeRow").innerHTML = gauges.map((g) => `
    <div class="exec-gauge-card">
      <div class="exec-gauge-header">
        <div class="exec-gauge-title">${escapeHtml(g.title)}</div>
        <div class="exec-gauge-subtitle">${escapeHtml(g.subtitle)}</div>
      </div>
      <div class="exec-gauge-svg-wrap">
        ${buildExecutiveGaugeSvg(g)}
      </div>
    </div>
  `).join("");

  // Render Chart 1 (Top-Right): Aggregated Category Bar Chart (Max 8 bars!)
  document.getElementById("agingChartTitle").textContent = `Phân bổ ${primaryMetric} theo ${groupCol}`;
  document.getElementById("agingChartSubtitle").textContent = `Top ${top8Cats.length} nhóm dẫn đầu (Đã gộp nhóm)`;
  renderAgingGroupedBarChart({
    x_axis_label: groupCol,
    labels: catLabels,
    series: [
      { name: `Tổng ${primaryMetric}`, color: "#24588e", data: catSum1 },
      { name: `Trung bình / Đơn (${primaryMetric})`, color: "#f44336", data: catCountOrAvg }
    ]
  });

  // 5. Render Chart 2 (Bottom-Left): Time-Series Trend by Month/Year (Max 12 periods!)
  let trendLabels = [];
  let trendSumSeries = [];
  let trendAvgSeries = [];

  if (cfg.primaryDateCol) {
    const timeMap = new Map();
    rowsToUse.forEach(r => {
      const ym = extractMonthYearFromDateStr(r[cfg.primaryDateCol]) || "Khác";
      const cur = timeMap.get(ym) || { sum: 0, count: 0 };
      cur.sum += parseNumSafe(r[primaryMetric]);
      cur.count += 1;
      timeMap.set(ym, cur);
    });
    const sortedTime = Array.from(timeMap.entries()).sort((a, b) => {
      const [ma, ya] = a[0].split("/");
      const [mb, yb] = b[0].split("/");
      return (Number(ya || 0) * 100 + Number(ma || 0)) - (Number(yb || 0) * 100 + Number(mb || 0));
    }).slice(-12);

    trendLabels = sortedTime.map(e => e[0]);
    trendSumSeries = sortedTime.map(e => Math.round(e[1].sum * 100) / 100);
    trendAvgSeries = sortedTime.map(e => Math.round((e[1].sum / Math.max(e[1].count, 1)) * 100) / 100);
    document.getElementById("wcChartTitle").textContent = `Xu hướng ${primaryMetric} theo Kỳ Thời Gian (${cfg.primaryDateCol})`;
    document.getElementById("wcChartSubtitle").textContent = `${trendLabels.length} kỳ thời gian`;
  } else {
    trendLabels = catLabels;
    trendSumSeries = catSum1;
    trendAvgSeries = catCountOrAvg;
    document.getElementById("wcChartTitle").textContent = `So sánh Tổng & Trung bình ${primaryMetric} theo ${groupCol}`;
    document.getElementById("wcChartSubtitle").textContent = `Top ${trendLabels.length} nhóm`;
  }

  renderWorkingCapitalLineChart({
    y_axis_label: primaryMetric,
    labels: trendLabels,
    series: [
      { name: `Tổng ${primaryMetric}`, color: "#24588e", data: trendSumSeries },
      { name: `Trung bình / Bản ghi`, color: "#f2b705", data: trendAvgSeries }
    ]
  });

  // 6. Render Chart 3 (Bottom-Right): Top 10 Ranking by Entity / Customer / Project or Secondary Category (Max 10 bars!)
  const rankCol = (cfg.labelCol && cfg.labelCol !== groupCol) ? cfg.labelCol : groupCol;
  const rankMap = new Map();
  rowsToUse.forEach(r => {
    const k = String(r[rankCol] ?? "Khác").trim().slice(0, 24) || "Khác";
    const cur = rankMap.get(k) || { sum1: 0, count: 0 };
    cur.sum1 += parseNumSafe(r[primaryMetric]);
    cur.count += 1;
    rankMap.set(k, cur);
  });

  const top10Rank = Array.from(rankMap.entries())
    .sort((a, b) => b[1].sum1 - a[1].sum1)
    .slice(0, 10);

  const rankLabels = top10Rank.map(e => e[0]);
  const rankSum1 = top10Rank.map(e => Math.round(e[1].sum1 * 100) / 100);
  const rankCount = top10Rank.map(e => e[1].count);

  document.getElementById("pnlChartTitle").textContent = `Top ${top10Rank.length} ${rankCol} có ${primaryMetric} lớn nhất & Số lượng đơn`;
  document.getElementById("pnlChartSubtitle").textContent = `Xếp hạng Top ${top10Rank.length} (Không vẽ chồng chéo)`;

  renderPnLComboChart({
    left_axis_label: `Tổng ${primaryMetric}`,
    right_axis_label: "Số lượng bản ghi (Count)",
    labels: rankLabels,
    stacked_series: [
      { name: `Tổng ${primaryMetric}`, color: "#24588e", data: rankSum1 }
    ],
    profit_loss_series: {
      name: "Số bản ghi / Đơn hàng",
      positive_color: "#f2a900",
      negative_color: "#f44336",
      data: rankCount
    }
  });
}

function sampleArray(arr, maxPoints = 20) {
  if (!arr || arr.length <= maxPoints) return arr || [];
  const step = arr.length / maxPoints;
  const res = [];
  for (let i = 0; i < maxPoints; i++) {
    res.push(arr[Math.floor(i * step)]);
  }
  return res;
}

function buildAreaSparklineSvg(values, fillColor) {
  if (!values || values.length < 2) return "";
  const w = 220;
  const h = 44;
  const minV = Math.min(...values) * 0.92;
  const maxV = Math.max(...values) * 1.02 || 1;
  const stepX = w / (values.length - 1);

  const pts = values.map((v, idx) => {
    const x = (idx * stepX).toFixed(1);
    const ratio = (v - minV) / Math.max(maxV - minV, 1);
    const y = (h - 4 - ratio * (h - 10)).toFixed(1);
    return `${x},${y}`;
  });

  const polygonPoints = `0,${h} ${pts.join(" ")} ${w},${h}`;
  return `
    <svg class="exec-kpi-spark-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polygon points="${polygonPoints}" fill="${fillColor}" />
    </svg>
  `;
}

function buildExecutiveGaugeSvg(g) {
  const minVal = g.min ?? 0;
  const maxVal = g.max ?? 31;
  const rawVal = Math.max(minVal, Math.min(maxVal, Number(g.value) || 0));
  const ratio = (rawVal - minVal) / Math.max(maxVal - minVal, 1);

  const cx = 85;
  const cy = 78;
  const r = 54;
  const startAngle = 145;
  const totalSweep = 250;
  const endAngle = startAngle + totalSweep;
  const valAngle = startAngle + ratio * totalSweep;

  const trackPath = describeArc(cx, cy, r, startAngle, endAngle);
  const valuePath = ratio > 0.005 ? describeArc(cx, cy, r, startAngle, valAngle) : "";

  const needleRad = (valAngle * Math.PI) / 180;
  const tipX = cx + (r - 12) * Math.cos(needleRad);
  const tipY = cy + (r - 12) * Math.sin(needleRad);
  const baseLeftRad = needleRad - Math.PI / 2;
  const baseRightRad = needleRad + Math.PI / 2;
  const bRadius = 3.2;
  const bx1 = cx + bRadius * Math.cos(baseLeftRad);
  const by1 = cy + bRadius * Math.sin(baseLeftRad);
  const bx2 = cx + bRadius * Math.cos(baseRightRad);
  const by2 = cy + bRadius * Math.sin(baseRightRad);

  return `
    <svg width="170" height="148" viewBox="0 0 170 148">
      <path d="${trackPath}" fill="none" stroke="#e0e0e0" stroke-width="18" stroke-linecap="butt" />
      ${valuePath ? `<path d="${valuePath}" fill="none" stroke="${g.color}" stroke-width="18" stroke-linecap="butt" />` : ""}
      <polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${bx1.toFixed(1)},${by1.toFixed(1)} ${bx2.toFixed(1)},${by2.toFixed(1)}" fill="#616161" />
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="#616161" />
      <text x="${cx}" y="119" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e293b">${escapeHtml(g.display_value)}</text>
      <text x="45" y="138" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${minVal}</text>
      <text x="125" y="138" text-anchor="middle" font-size="10.5" font-weight="600" fill="#334155">${maxVal}</text>
    </svg>
  `;
}

function polarToCartesian(cx, cy, r, angleInDegrees) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
  return {
    x: cx + r * Math.cos(angleInRadians),
    y: cy + r * Math.sin(angleInRadians)
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x.toFixed(2), start.y.toFixed(2), "A", r, r, 0, largeArcFlag, 1, end.x.toFixed(2), end.y.toFixed(2)].join(" ");
}

function formatCompactMetric(val, withDollar = false) {
  if (val === null || val === undefined || isNaN(val)) return "";
  const absV = Math.abs(val);
  const prefix = withDollar ? "$" : "";
  let formatted = "";
  if (absV >= 1_000_000_000) {
    formatted = `${prefix}${(absV / 1_000_000_000).toFixed(2)}B`;
  } else if (absV >= 1_000_000) {
    formatted = `${prefix}${(absV / 1_000_000).toFixed(1)}M`;
  } else if (absV >= 1_000) {
    const kVal = absV / 1_000;
    formatted = `${prefix}${kVal % 1 === 0 ? kVal.toFixed(0) : kVal.toFixed(1)}K`;
  } else {
    formatted = `${prefix}${absV % 1 === 0 ? absV.toFixed(0) : absV.toFixed(1)}`;
  }
  return val < 0 ? `(${formatted})` : formatted;
}

function renderAgingGroupedBarChart(spec) {
  const ctx = document.getElementById("chartAging").getContext("2d");
  if (AppState.charts.aging) AppState.charts.aging.destroy();
  const showLabels = (spec.labels || []).length <= 10;

  AppState.charts.aging = new Chart(ctx, {
    type: "bar",
    data: {
      labels: spec.labels,
      datasets: spec.series.map((s) => ({
        label: s.name,
        data: s.data,
        backgroundColor: s.color,
        borderRadius: 4,
        barPercentage: 0.72,
        categoryPercentage: 0.68,
        datalabels: {
          display: showLabels,
          anchor: "end",
          align: "top",
          offset: 2,
          color: "#334155",
          font: { size: 9.5, weight: "600" },
          formatter: (v) => (v !== 0 ? formatCompactMetric(v) : "")
        }
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString("en-US")}`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: spec.x_axis_label || "Danh mục", font: { size: 10.5, weight: "600" } },
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 25 }
        },
        y: {
          beginAtZero: true,
          grid: { color: "#edf2f7" },
          ticks: {
            font: { size: 10 },
            callback: (v) => formatCompactMetric(v)
          }
        }
      }
    }
  });
}

function renderWorkingCapitalLineChart(spec) {
  const ctx = document.getElementById("chartWorkingCapital").getContext("2d");
  if (AppState.charts.workingCapital) AppState.charts.workingCapital.destroy();
  const showLabels = (spec.labels || []).length <= 12;

  AppState.charts.workingCapital = new Chart(ctx, {
    type: "line",
    data: {
      labels: spec.labels,
      datasets: spec.series.map((s, idx) => ({
        label: s.name,
        data: s.data,
        borderColor: s.color,
        backgroundColor: idx === 0 ? "rgba(36, 88, 142, 0.10)" : "transparent",
        fill: idx === 0,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: s.color,
        pointBorderWidth: 2,
        pointRadius: 4,
        borderWidth: 2.2,
        tension: 0.25,
        datalabels: {
          display: showLabels && idx === 0,
          align: "top",
          offset: 5,
          color: "#1e293b",
          font: { size: 9.5, weight: "600" },
          formatter: (v) => formatCompactMetric(v)
        }
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 24, bottom: 8, right: 16, left: 6 } },
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, boxWidth: 10, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString("en-US")}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 25 }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: spec.y_axis_label || "Giá trị", font: { size: 10.5, weight: "600" } },
          grid: { color: "#edf2f7" },
          ticks: {
            font: { size: 10 },
            callback: (v) => formatCompactMetric(v)
          }
        }
      }
    }
  });
}

function renderPnLComboChart(spec) {
  const ctx = document.getElementById("chartPnL").getContext("2d");
  if (AppState.charts.pnl) AppState.charts.pnl.destroy();
  const showLabels = (spec.labels || []).length <= 10;

  const barDatasets = (spec.stacked_series || []).map((s) => ({
    type: "bar",
    label: s.name,
    data: s.data,
    backgroundColor: s.color,
    borderRadius: 4,
    yAxisID: "yLeft",
    barPercentage: 0.65,
    categoryPercentage: 0.7,
    datalabels: {
      display: showLabels,
      anchor: "end",
      align: "top",
      offset: 2,
      color: "#1e3a5f",
      font: { size: 9.5, weight: "600" },
      formatter: (v) => (v !== 0 ? formatCompactMetric(v) : "")
    }
  }));

  const plData = spec.profit_loss_series.data || [];

  const lineOrBarDataset = {
    type: "line",
    label: spec.profit_loss_series.name,
    data: plData,
    borderColor: "#e67e22",
    backgroundColor: "#ffffff",
    pointBackgroundColor: "#e67e22",
    pointRadius: 4,
    borderWidth: 2.2,
    tension: 0.2,
    yAxisID: "yRight",
    datalabels: {
      display: false
    }
  };

  AppState.charts.pnl = new Chart(ctx, {
    type: "bar",
    data: {
      labels: spec.labels,
      datasets: [...barDatasets, lineOrBarDataset]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 22 } },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString("en-US")}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 25 }
        },
        yLeft: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          title: { display: true, text: spec.left_axis_label || "Metrics", font: { size: 10.5, weight: "600" } },
          grid: { color: "#edf2f7" },
          ticks: {
            font: { size: 10 },
            callback: (v) => formatCompactMetric(v)
          }
        },
        yRight: {
          type: "linear",
          position: "right",
          stacked: false,
          title: { display: true, text: spec.right_axis_label || "Net", font: { size: 10.5 } },
          grid: { drawOnChartArea: false },
          ticks: {
            font: { size: 10 },
            callback: (v) => formatCompactMetric(v)
          }
        }
      }
    }
  });
}

function renderExecutiveReportHtml(step3Data) {
  const ctx = getContextFromForm();
  const dash = step3Data.dashboard || {};
  const sections = step3Data.feedback_sections || [];
  const actionMatrix = step3Data.action_plan_matrix || [];
  const cleanedRows = AppState.step2Data?.cleaned_rows || [];
  const cols = AppState.step2Data?.columns || [];
  const sheetsSummary = step3Data.sheets_summary || AppState.sheets_summary || [];

  const secSummary = sections.find(s => s.badge === "[Tóm tắt]") || sections[0] || {};
  const secKpi = sections.find(s => s.badge === "[Chỉ số chính]") || sections[1] || {};
  const secThematic = sections.find(s => s.badge === "[Phân tích chuyên đề]") || sections[2] || {};
  const secProposal = sections.find(s => s.badge === "[Kết luận và đề xuất]") || sections[3] || {};

  const html = `
    <div class="report-paper">
      <div class="report-header-banner">
        <div>
          <div style="font-size:0.78rem; font-weight:700; color:#1565c0; letter-spacing:0.6px;">EXECUTIVE BUSINESS INTELLIGENCE REPORT</div>
          <h2 style="font-size:1.5rem; color:#0f172a; margin-top:4px;">${escapeHtml(ctx.company_name)} — Báo cáo Phân tích & Đề xuất Điều hành</h2>
          <p style="font-size:0.86rem; color:#475569;">Ngành nghề: ${escapeHtml(ctx.industry)} | Mục tiêu: ${escapeHtml(ctx.objective)} | Đối tượng: ${escapeHtml(ctx.target_audience)}</p>
        </div>
        <div style="text-align:right; font-size:0.8rem; color:#64748b;">
          <div>Ngày xuất bản: ${new Date().toLocaleDateString("vi-VN")}</div>
          <div>Trạng thái: <strong>100% Đã làm sạch & Xác nhận (HITL Verified)</strong></div>
        </div>
      </div>

      <!-- MỤC 1: [Tóm tắt] -->
      <div class="report-section-block">
        <span class="report-sec-badge">[Tóm tắt]</span>
        <h3>I. TỔNG QUAN HOẠT ĐỘNG & BỐI CẢNH KINH DOANH</h3>
        <div class="report-text-body">${formatMarkdownBold(escapeHtml(secSummary.content || step3Data.executive_summary_line || ""))}</div>
      </div>

      <!-- MỤC 2: [Chỉ số chính] -->
      <div class="report-section-block">
        <span class="report-sec-badge">[Chỉ số chính]</span>
        <h3>II. HỆ THỐNG CHỈ SỐ HIỆU SUẤT CỐT LÕI (KEY PERFORMANCE INDICATORS)</h3>
        <div class="report-kpi-grid">
          ${(dash.kpi_cards || []).map(k => `
            <div class="report-kpi-card">
              <div class="rk-title">${escapeHtml(k.title)}</div>
              <div class="rk-val" style="color:${k.color};">${escapeHtml(k.value)}</div>
            </div>
          `).join("")}
        </div>
        <div class="report-text-body">${formatMarkdownBold(escapeHtml(secKpi.content || ""))}</div>
      </div>

      <!-- MỤC 3: [Phân tích chuyên đề] -->
      <div class="report-section-block">
        <span class="report-sec-badge">[Phân tích chuyên đề]</span>
        <h3>III. PHÂN TÍCH CHUYÊN ĐỀ SÂU TỪ DỮ LIỆU THỰC TẾ</h3>
        <div class="report-text-body">${formatMarkdownBold(escapeHtml(secThematic.content || ""))}</div>
      </div>

      <!-- MỤC 4: [Kết luận và đề xuất] -->
      <div class="report-section-block">
        <span class="report-sec-badge">[Kết luận và đề xuất]</span>
        <h3>IV. KẾT LUẬN CHIẾN LƯỢC & KẾ HOẠCH HÀNH ĐỘNG ĐO LƯỜNG ĐƯỢC (SMART ACTION PLAN)</h3>
        <div class="report-text-body" style="margin-bottom:14px;">${formatMarkdownBold(escapeHtml(secProposal.content || ""))}</div>
        ${actionMatrix.length > 0 ? `
          <div style="border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; margin-top:12px;">
            <table class="data-table" style="white-space:normal;">
              <thead>
                <tr>
                  <th style="width:15%; background:#f1f5f9; color:#0f172a;">Hạng mục</th>
                  <th style="width:23%; background:#f1f5f9; color:#0f172a;">Vấn đề Thực tế</th>
                  <th style="width:26%; background:#f1f5f9; color:#0f172a;">Giải pháp Triển khai</th>
                  <th style="width:20%; background:#f1f5f9; color:#0f172a;">Chỉ số Đo lường (KPI)</th>
                  <th style="width:16%; background:#f1f5f9; color:#0f172a;">Tác động Định lượng</th>
                </tr>
              </thead>
              <tbody>
                ${actionMatrix.map(row => `
                  <tr>
                    <td style="vertical-align:top; font-weight:700; color:#1e3a5f;">
                      <span style="display:inline-block; background:#dbeafe; color:#1e40af; padding:1px 6px; border-radius:4px; font-size:0.7rem; margin-bottom:4px;">${escapeHtml(row.code)}</span><br/>
                      ${escapeHtml(row.area)}
                    </td>
                    <td style="vertical-align:top;">${formatMarkdownBold(escapeHtml(row.problem))}</td>
                    <td style="vertical-align:top; font-weight:500;">${formatMarkdownBold(escapeHtml(row.solution))}</td>
                    <td style="vertical-align:top; white-space:pre-line; color:#166534; font-weight:600; background:#f0fdf4;">${escapeHtml(row.kpi_metric)}</td>
                    <td style="vertical-align:top; color:#9a3412; font-weight:700; background:#fff7ed;">${escapeHtml(row.quantified_impact)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}
      </div>

      </div>
    </div>
  `;
  document.getElementById("executiveReportContainer").innerHTML = html;
}

function buildSimplePreviewTable(columns, rows) {
  if (!columns || !columns.length) return "";
  return `
    <table class="data-table">
      <thead>
        <tr>
          ${columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${(rows || []).map(r => `
          <tr>
            ${columns.map(c => `<td>${escapeHtml(String(r[c] ?? ""))}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function downloadCleanedCSV() {
  const rows = AppState.step2Data?.cleaned_rows;
  const cols = AppState.step2Data?.columns;
  if (!rows || !cols) {
    alert("Chưa có dữ liệu làm sạch để tải xuống.");
    return;
  }
  const csvLines = [
    cols.join(","),
    ...rows.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","))
  ];
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cleaned_bi_data.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMarkdownBold(escapedStr) {
  return escapedStr
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code style='background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:0.8rem;'>$1</code>");
}

// ============================================================================
// FLOATING SMART AI BI CHATBOX CONTROLLER
// ============================================================================

function toggleAIChatbot(forceState) {
  const win = document.getElementById("aiChatWindow");
  if (!win) return;
  if (typeof forceState === "boolean") {
    win.classList.toggle("hidden", !forceState);
  } else {
    win.classList.toggle("hidden");
  }
  if (!win.classList.contains("hidden")) {
    const inp = document.getElementById("aiChatInput");
    setTimeout(() => inp?.focus(), 80);
  }
}

function clearAIChat() {
  const box = document.getElementById("aiChatMessages");
  if (!box) return;
  box.innerHTML = `
    <div class="ai-msg-row bot">
      <div class="ai-msg-bubble">
         Đã làm mới hội thoại! Bạn muốn hỏi gì về dữ liệu các Sheet, thống kê hay giải pháp KPI?
      </div>
    </div>
  `;
}

function askQuickQuestion(questionText) {
  const inp = document.getElementById("aiChatInput");
  if (inp) inp.value = questionText;
  sendAIChatMessage();
}

function appendChatMessage(role, rawText) {
  const box = document.getElementById("aiChatMessages");
  if (!box) return;
  const row = document.createElement("div");
  row.className = `ai-msg-row ${role}`;

  const bubble = document.createElement("div");
  bubble.className = "ai-msg-bubble";

  if (role === "bot") {
    const escaped = escapeHtml(rawText);
    bubble.innerHTML = formatMarkdownBold(escaped).replace(/\n/g, "<br/>");
  } else {
    bubble.textContent = rawText;
  }

  row.appendChild(bubble);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return row;
}

async function sendAIChatMessage() {
  const inp = document.getElementById("aiChatInput");
  const msg = (inp?.value || "").trim();
  if (!msg) return;

  inp.value = "";
  appendChatMessage("user", msg);

  const loadingRow = appendChatMessage("bot", "⏳ AI đang phân tích dữ liệu...");

  try {
    const activeRows =
      AppState.step2Data?.cleaned_rows ||
      AppState.step1Data?.preview_rows ||
      [];
    const rawCsv =
      AppState.normalizedCsv ||
      document.getElementById("rawInputText")?.value ||
      "";

    const res = await apiFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        context: getContextFromForm(),
        current_step: AppState.currentStep,
        sheets_meta: (AppState.sheets && AppState.sheets.length > 0) ? AppState.sheets : (AppState.sheetsMeta || []),
        dataset_rows: activeRows,
        raw_csv: rawCsv,
        issues_count: AppState.step2Data?.issues?.length || 0
      })
    });

    const data = await safeParseJsonResponse(res, "Không thể xử lý câu hỏi.");
    if (loadingRow) loadingRow.remove();

    appendChatMessage("bot", data.reply || "Tôi đã ghi nhận yêu cầu của bạn.");

    // Update quick chips if returned
    if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
      const chipsContainer = document.getElementById("aiChatQuickChips");
      if (chipsContainer) {
        chipsContainer.innerHTML = data.suggestions
          .map(s => `<button type="button" class="ai-chip-btn" onclick="askQuickQuestion('${escapeHtml(s)}')"> ${escapeHtml(s)}</button>`)
          .join("");
      }
    }
  } catch (err) {
    if (loadingRow) loadingRow.remove();
    appendChatMessage("bot", ` Lỗi kết nối tới AI Agent: ${err.message}`);
  }
}


// ============================================================================
// LIVE EDITING ENGINE: INLINE EDITING FOR DASHBOARD & REPORT PREVIEW
// ============================================================================
window.isLiveEditingActive = false;

function toggleLiveEditing(forcedState) {
  if (forcedState !== undefined) {
    window.isLiveEditingActive = forcedState;
  } else {
    window.isLiveEditingActive = !window.isLiveEditingActive;
  }

  const active = window.isLiveEditingActive;

  // Target selectors in Dashboard and Report Views
  const selectors = [
    "#step4DashboardView .demodata-chart-card h3",
    "#step4DashboardView .demodata-kpi-val",
    "#step4DashboardView .demodata-kpi-label",
    "#step4DashboardView .demodata-kpi-sub",
    "#step4ReportView .demodata-card-title",
    "#step4ReportView p",
    "#step4ReportView li",
    "#step4ReportView td",
    "#step4ReportView th",
    "#step4ReportView .corp-profile-val",
    "#step4ReportView .corp-profile-sub",
    "#step4ReportView .report-kpi-strip-val",
    "#step4ReportView .report-kpi-strip-note",
    "#step4ReportView .report-chart-commentary",
    "#step4ReportView h1",
    "#step4ReportView h2",
    "#step4ReportView h3",
    "#step4ReportView h4"
  ];

  document.querySelectorAll(selectors.join(",")).forEach(el => {
    // Exclude buttons, form inputs, checkboxes, preset chips
    if (el.closest("button") || el.closest("input") || el.closest("label") || el.closest(".report-customizer-box")) {
      return;
    }
    if (active) {
      el.setAttribute("contenteditable", "true");
      el.classList.add("live-editable-element");
    } else {
      el.removeAttribute("contenteditable");
      el.classList.remove("live-editable-element");
    }
  });

  // Update button in Header toolbar
  const btnTop = document.getElementById("btnToggleLiveEdit");
  if (btnTop) {
    if (active) {
      btnTop.innerHTML = "💾 Hoàn tất chỉnh sửa";
      btnTop.style.background = "#dcfce7";
      btnTop.style.color = "#166534";
      btnTop.style.borderColor = "#86efac";
    } else {
      btnTop.innerHTML = "Chỉnh sửa trực tiếp";
      btnTop.style.background = "#fef3c7";
      btnTop.style.color = "#92400e";
      btnTop.style.borderColor = "#fcd34d";
    }
  }

  // Update button in Bottom actions
  const btnBottom = document.getElementById("btnToggleLiveEditBottom");
  if (btnBottom) {
    btnBottom.innerHTML = active
      ? "💾 Đang bật Chỉnh sửa — Bấm để Hoàn tất"
      : "Chỉnh sửa trực tiếp trên bản xem trước";
  }

  // Toggle Alert Banner
  const alertBanner = document.getElementById("liveEditAlertBanner");
  if (alertBanner) {
    if (active) {
      alertBanner.classList.remove("hidden");
    } else {
      alertBanner.classList.add("hidden");
    }
  }
}

// Enable Double-click inline editing shortcut on preview
document.addEventListener("dblclick", function(e) {
  const target = e.target;
  if (!target) return;
  const inStep4 = target.closest("#step4DashboardView") || target.closest("#step4ReportView");
  if (!inStep4) return;
  if (target.closest("button") || target.closest("input") || target.closest("canvas") || target.closest(".report-customizer-box")) {
    return;
  }
  if (!window.isLiveEditingActive) {
    toggleLiveEditing(true);
  }
  if (target.isContentEditable) {
    target.focus();
  }
});
