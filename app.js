(function () {
  "use strict";

  const PALETTE = {
    navy: "#18364f",
    teal: "#269886",
    blue: "#4b83cf",
    amber: "#dda24a",
    red: "#d67373",
    purple: "#8d78c7",
    green: "#6da685",
    gray: "#9aa8b4",
    grid: "rgba(33, 58, 81, 0.08)"
  };
  const NUMERIC_FIELDS = ["Downtime_h", "Horas_mano_obra", "Costo_repuestos_CLP", "Costo_externo_CLP", "Costo_total_CLP", "Duración_OT_h", "Tiempo_espera_h", "Tiempo_reparacion_h", "Cantidad_repuestos", "Prioridad_SAP"];
  const FIELD_ALIASES = {
    OT: ["ot", "orden", "orden trabajo", "orden de trabajo", "numero de orden", "numero orden", "nro orden"],
    Tipo_mantenimiento: ["tipo mantenimiento", "tipo de mantenimiento", "clase de mantenimiento", "clase orden"],
    Horas_mano_obra: ["horas mano obra", "horas mano de obra", "horas de mano de obra", "hh", "horas trabajo", "horas hombre"],
    Downtime_h: ["downtime", "downtime h", "downtime horas", "horas downtime", "tiempo de parada", "horas indisponibilidad"],
    Costo_total_CLP: ["costo total clp", "costo total", "costo directo clp", "costo directo", "costo mantenimiento clp"],
    Costo_repuestos_CLP: ["costo repuestos clp", "costo repuestos"],
    Costo_externo_CLP: ["costo externo clp", "costo externo"],
    Duración_OT_h: ["duracion ot h", "duracion ot", "duracion orden h"],
    Tiempo_espera_h: ["tiempo espera h", "tiempo de espera h"],
    Tiempo_reparacion_h: ["tiempo reparacion h", "tiempo de reparacion h"],
    Fecha_inicio: ["fecha inicio", "fecha de inicio", "inicio"],
    Fecha_fin: ["fecha fin", "fecha de fin", "termino", "fecha cierre"],
    Estado: ["estado", "status usuario", "estatus"],
    Equipo: ["equipo", "activo", "tag", "equipo tecnico"],
    Tipo_equipo: ["tipo equipo", "tipo de equipo", "clase equipo"],
    Criticidad: ["criticidad", "criticidad equipo"],
    Modo_falla: ["modo falla", "modo de falla", "falla", "modo fallo"],
    Área: ["area"]
  };
  const CANONICAL_ALIASES = new Map();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of [canonical, ...aliases]) CANONICAL_ALIASES.set(normalizeKey(alias), canonical);
  }

  const state = {
    rows: [],
    fileName: "",
    sourceRows: 0,
    duplicates: 0,
    warnings: [],
    charts: new Map(),
    hasDataset: false
  };
  const elements = {};
  const chartIds = [
    "impactChart", "laborChart", "downtimeTypeChart", "costTypeChart", "mttrChart",
    "equipmentDowntimeChart", "equipmentCostChart", "paretoFrequencyChart",
    "paretoDowntimeChart", "paretoCostChart", "jackknifeEquipmentChart",
    "jackknifeFailureChart"
  ];

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    for (const id of [
      "fileInput", "dropZone", "sampleButton", "clearButton", "status", "datasetPanel",
      "fileName", "fileDetails", "warning", "dashboard", "dashboardSubheading",
      "maintenanceFilter", "equipmentFilter", "dateFrom", "dateTo", "clearDateFilter",
      "filteredCount", "filterValidation", "pdfButton",
      "failureTable", "equipmentTable", "insightTitle", "insightText"
    ]) elements[id] = document.getElementById(id);

    elements.dropZone.addEventListener("click", (event) => {
      if (event.target.closest("a, button")) return;
      elements.fileInput.click();
    });
    elements.dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });
    elements.fileInput.addEventListener("change", () => {
      if (elements.fileInput.files?.[0]) loadFile(elements.fileInput.files[0]);
      elements.fileInput.value = "";
    });
    elements.sampleButton.addEventListener("click", loadSample);
    elements.clearButton.addEventListener("click", clearDataset);
    elements.maintenanceFilter.addEventListener("change", renderDashboard);
    elements.equipmentFilter.addEventListener("change", renderDashboard);
    elements.dateFrom.addEventListener("change", () => {
      elements.dateTo.min = elements.dateFrom.value;
      renderDashboard();
    });
    elements.dateTo.addEventListener("change", () => {
      elements.dateFrom.max = elements.dateTo.value;
      renderDashboard();
    });
    elements.clearDateFilter.addEventListener("click", () => {
      elements.dateFrom.value = "";
      elements.dateTo.value = "";
      elements.dateFrom.removeAttribute("max");
      elements.dateTo.removeAttribute("min");
      renderDashboard();
    });
    elements.pdfButton.addEventListener("click", exportPdf);
    elements.dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-dragging");
    });
    elements.dropZone.addEventListener("dragleave", (event) => {
      if (!elements.dropZone.contains(event.relatedTarget)) elements.dropZone.classList.remove("is-dragging");
    });
    elements.dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-dragging");
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    });

    const missingLibraries = [
      ["Papa Parse", typeof Papa === "undefined"],
      ["SheetJS", typeof XLSX === "undefined"],
      ["Chart.js", typeof Chart === "undefined"]
    ].filter(([, missing]) => missing).map(([name]) => name);
    if (missingLibraries.length) {
      showStatus(`No se pudieron cargar ${missingLibraries.join(", ")} desde el CDN. Comprueba tu conexión a internet y vuelve a cargar la página.`, "error");
      elements.fileInput.disabled = true;
      elements.sampleButton.disabled = true;
      elements.dropZone.setAttribute("aria-disabled", "true");
      return;
    }
    Chart.defaults.font.family = '"DM Sans", "Segoe UI", sans-serif';
    Chart.defaults.font.size = 10;
    Chart.defaults.color = "#718295";
    Chart.defaults.animation.duration = 350;
    window.cmmsDashboard = { analyzeRows, formatNumber, formatCurrency };
  }

  function normalizeKey(value) {
    return String(value ?? "")
      .trim()
      .toLocaleLowerCase("es")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .replace(/\s+/g, " ");
  }

  function cleanText(value) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return formatDateForInput(value);
    return String(value ?? "").trim().replace(/^'+/, "").trim();
  }

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    let text = cleanText(value).replace(/[\s\u00a0]/g, "").replace(/[^\d,.-]/g, "");
    if (!text || /^[-.,]+$/.test(text)) return 0;
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? "," : ".";
      const thousandsSeparator = decimalSeparator === "," ? /\./g : /,/g;
      text = text.replace(thousandsSeparator, "");
      if (decimalSeparator === ",") text = text.replace(",", ".");
    } else if (lastComma >= 0 || lastDot >= 0) {
      const separator = lastComma >= 0 ? "," : ".";
      const pieces = text.split(separator);
      const trailing = pieces.at(-1).length;
      const isThousands = pieces.length > 2 || trailing === 3;
      if (isThousands) text = pieces.join("");
      else if (separator === ",") text = text.replace(",", ".");
    }
    const result = Number(text);
    return Number.isFinite(result) ? result : 0;
  }

  function formatDateForInput(value) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${pad(value.getDate())}-${pad(value.getMonth() + 1)}-${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  function parseDate(value) {
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value.valueOf();
    const text = cleanText(value);
    if (!text) return null;
    let match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const [, dayText, monthText, yearText, hourText = "0", minuteText = "0", secondText = "0"] = match;
      const day = Number(dayText);
      const month = Number(monthText);
      const year = Number(yearText);
      if (day > 12 || month <= 12) {
        const date = new Date(Date.UTC(year, month - 1, day, Number(hourText), Number(minuteText), Number(secondText)));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.valueOf();
      }
    }
    match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const [, yearText, monthText, dayText, hourText = "0", minuteText = "0", secondText = "0"] = match;
      const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText), Number(hourText), Number(minuteText), Number(secondText)));
      if (Number.isFinite(date.valueOf())) return date.valueOf();
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeMaintenance(value) {
    const clean = cleanText(value);
    const key = normalizeKey(clean);
    if (["correctivo", "correctiva", "corrective"].includes(key)) return "Correctivo";
    if (["preventivo", "preventiva", "preventive"].includes(key)) return "Preventivo";
    if (["predictivo", "predictiva", "predictive"].includes(key)) return "Predictivo";
    if (!clean) return "Sin clasificar";
    return clean.charAt(0).toLocaleUpperCase("es") + clean.slice(1);
  }

  function normalizeStatus(value) {
    return normalizeKey(value);
  }

  function parseCsvBuffer(buffer) {
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      content = new TextDecoder("windows-1252").decode(buffer);
    }
    const result = Papa.parse(content, { header: true, skipEmptyLines: "greedy", dynamicTyping: false });
    if (result.errors?.length) {
      const serious = result.errors.filter((entry) => entry.code !== "TooManyFields" && entry.code !== "TooFewFields");
      if (serious.length) throw new Error(`No se pudo leer el CSV: ${serious[0].message}`);
    }
    return { headers: result.meta.fields ?? [], rows: result.data, warnings: result.errors ?? [] };
  }

  function parseExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("El archivo Excel no contiene hojas para analizar.");
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, dateNF: "dd-mm-yyyy hh:mm" });
    if (!rows.length) throw new Error("La primera hoja de Excel está vacía.");
    return { headers: Object.keys(rows[0]), rows, warnings: [] };
  }

  function canonicalizeDataset(parsed) {
    const mappedHeaders = parsed.headers.map((header) => ({
      source: header,
      canonical: CANONICAL_ALIASES.get(normalizeKey(header)) ?? String(header).trim()
    }));
    const preferredHeaders = new Map();
    for (const header of mappedHeaders) {
      const current = preferredHeaders.get(header.canonical);
      const isExact = normalizeKey(header.source) === normalizeKey(header.canonical);
      const currentIsExact = current && normalizeKey(current.source) === normalizeKey(current.canonical);
      if (!current || (isExact && !currentIsExact)) preferredHeaders.set(header.canonical, header);
    }
    const sourceHeaders = [...preferredHeaders.values()];
    const canonicalHeaders = new Set(mappedHeaders.map((header) => header.canonical));
    if (!canonicalHeaders.has("OT")) throw new Error("Falta la columna de orden de trabajo. Se esperaba `OT`, `Orden` o `Orden de trabajo`.");
    if (!canonicalHeaders.has("Tipo_mantenimiento")) throw new Error("Falta la columna de tipo de mantenimiento. Se esperaba `Tipo_mantenimiento` o `Tipo de mantenimiento`.");

    const seen = new Set();
    const output = [];
    for (const sourceRow of parsed.rows) {
      if (!sourceRow || typeof sourceRow !== "object") continue;
      const exactKey = JSON.stringify(Object.keys(sourceRow).sort().map((key) => [key, cleanText(sourceRow[key])]));
      if (seen.has(exactKey)) continue;
      seen.add(exactKey);

      const row = {};
      for (const header of sourceHeaders) row[header.canonical] = sourceRow[header.source];
      row.OT = cleanText(row.OT);
      row.Tipo_mantenimiento = normalizeMaintenance(row.Tipo_mantenimiento);
      row.Equipo = cleanText(row.Equipo) || "Sin equipo";
      row.Tipo_equipo = cleanText(row.Tipo_equipo) || "Sin clasificar";
      row.Criticidad = cleanText(row.Criticidad) || "—";
      row.Modo_falla = cleanText(row.Modo_falla);
      row.Estado = cleanText(row.Estado);
      for (const field of NUMERIC_FIELDS) row[field] = canonicalHeaders.has(field) ? parseNumber(row[field]) : 0;
      row._fechaInicio = parseDate(row.Fecha_inicio);
      row._fechaFin = parseDate(row.Fecha_fin);
      row._repairHours = null;
      if (normalizeKey(row.Tipo_mantenimiento) === "correctivo"
          && normalizeStatus(row.Estado) === "cerrada"
          && row._fechaInicio !== null
          && row._fechaFin !== null
          && row._fechaFin > row._fechaInicio) {
        row._repairHours = (row._fechaFin - row._fechaInicio) / 3_600_000;
      }
      output.push(row);
    }
    if (!output.length) throw new Error("El archivo no contiene filas de datos para analizar.");

    const warnings = [...parsed.warnings];
    for (const optional of ["Equipo", "Tipo_equipo", "Estado", "Fecha_inicio", "Fecha_fin", "Modo_falla", "Downtime_h", "Horas_mano_obra", "Costo_total_CLP"]) {
      if (!canonicalHeaders.has(optional)) warnings.push(`No se encontró la columna ${optional}; algunos indicadores aparecerán vacíos o en cero.`);
    }
    return { rows: output, warnings, duplicates: parsed.rows.length - output.length, sourceRows: parsed.rows.length };
  }

  async function loadFile(file) {
    if (file.size > 50 * 1024 * 1024) {
      showStatus("El archivo supera el límite de 50 MB. Divide el dataset y vuelve a cargarlo.", "error");
      return;
    }
    const extension = file.name.split(".").at(-1).toLocaleLowerCase("es");
    if (!["csv", "xlsx", "xls"].includes(extension)) {
      showStatus("Formato no compatible. Selecciona un archivo CSV, XLSX o XLS.", "error");
      return;
    }
    showStatus(`Leyendo ${file.name} en este navegador…`, "loading");
    try {
      const buffer = await file.arrayBuffer();
      const parsed = extension === "csv" ? parseCsvBuffer(buffer) : parseExcelBuffer(buffer);
      applyDataset(canonicalizeDataset(parsed), file.name);
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "No se pudo analizar el archivo.", "error");
    }
  }

  async function loadSample() {
    showStatus("Cargando el CSV de ejemplo del proyecto…", "loading");
    try {
      const response = await fetch("../dataset/CMMS_grupo_B.csv");
      if (!response.ok) throw new Error("No se encontró el dataset de ejemplo en ../dataset/CMMS_grupo_B.csv.");
      const buffer = await response.arrayBuffer();
      const parsed = parseCsvBuffer(buffer);
      applyDataset(canonicalizeDataset(parsed), "CMMS_grupo_B.csv");
    } catch (error) {
      showStatus(`${error instanceof Error ? error.message : "No se pudo cargar el ejemplo."} Puedes seleccionar un archivo desde tu equipo.`, "error");
    }
  }

  function applyDataset(dataset, fileName) {
    state.rows = dataset.rows;
    state.fileName = fileName;
    state.sourceRows = dataset.sourceRows;
    state.duplicates = dataset.duplicates;
    state.warnings = dataset.warnings;
    state.hasDataset = true;
    const duplicateLabel = dataset.duplicates === 1 ? "1 duplicado exacto omitido" : `${formatNumber(dataset.duplicates)} duplicados exactos omitidos`;
    const fileSizeLabel = `${formatNumber(dataset.rows.length)} filas utilizables · ${duplicateLabel}`;
    elements.fileName.textContent = fileName;
    elements.fileDetails.textContent = fileSizeLabel;
    elements.datasetPanel.hidden = false;
    elements.warning.hidden = dataset.warnings.length === 0 && dataset.duplicates === 0;
    elements.warning.textContent = [
      ...dataset.warnings.slice(0, 6),
      dataset.warnings.length > 6 ? `y ${dataset.warnings.length - 6} avisos adicionales.` : "",
      dataset.duplicates ? `Se omitieron ${formatNumber(dataset.duplicates)} ${dataset.duplicates === 1 ? "fila exactamente duplicada" : "filas exactamente duplicadas"}, como en el notebook.` : ""
    ].filter(Boolean).join(" ");
    populateFilters();
    elements.dashboard.hidden = false;
    showStatus("Dataset cargado. Los cálculos y gráficos se ejecutan localmente en tu navegador.", "success");
    renderDashboard();
    elements.dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearDataset() {
    state.rows = [];
    state.hasDataset = false;
    for (const chart of state.charts.values()) chart.destroy();
    state.charts.clear();
    elements.dashboard.hidden = true;
    elements.datasetPanel.hidden = true;
    elements.warning.hidden = true;
    elements.dateFrom.value = "";
    elements.dateTo.value = "";
    elements.dateFrom.removeAttribute("max");
    elements.dateTo.removeAttribute("min");
    elements.filterValidation.hidden = true;
    showStatus("", "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showStatus(message, kind) {
    elements.status.textContent = message;
    elements.status.className = `status-message${kind ? ` is-${kind}` : ""}`;
  }

  function populateFilters() {
    setOptions(elements.maintenanceFilter, unique(state.rows.map((row) => row.Tipo_mantenimiento)), "Todos los tipos");
    setOptions(elements.equipmentFilter, unique(state.rows.map((row) => row.Tipo_equipo)), "Todos los equipos");
  }

  function setOptions(select, values, allLabel) {
    const current = select.value || "*";
    select.replaceChildren(new Option(allLabel, "*"));
    for (const value of values.sort((a, b) => a.localeCompare(b, "es"))) select.add(new Option(value, value));
    select.value = values.includes(current) ? current : "*";
  }

  function unique(values) {
    return [...new Set(values.filter((value) => value && value !== "Sin clasificar"))];
  }

  function getFilteredRows() {
    const maintenance = elements.maintenanceFilter.value;
    const equipment = elements.equipmentFilter.value;
    const from = dateInputStart(elements.dateFrom.value);
    const toExclusive = dateInputEndExclusive(elements.dateTo.value);
    if (from !== null && toExclusive !== null && from >= toExclusive) {
      elements.filterValidation.textContent = "El rango no es válido: la fecha «Desde» debe ser anterior o igual a «Hasta».";
      elements.filterValidation.hidden = false;
      elements.pdfButton.disabled = true;
      return [];
    }
    elements.filterValidation.textContent = "";
    elements.filterValidation.hidden = true;
    elements.pdfButton.disabled = false;
    return state.rows.filter((row) =>
      (maintenance === "*" || row.Tipo_mantenimiento === maintenance)
      && (equipment === "*" || row.Tipo_equipo === equipment)
      && (from === null && toExclusive === null
        ? true
        : row._fechaInicio !== null
          && (from === null || row._fechaInicio >= from)
          && (toExclusive === null || row._fechaInicio < toExclusive))
    );
  }

  function dateInputStart(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }

  function dateInputEndExclusive(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day + 1);
  }

  function sum(rows, field) {
    return rows.reduce((total, row) => total + (Number.isFinite(row[field]) ? row[field] : 0), 0);
  }

  function countUnique(rows, selector) {
    return new Set(rows.map(selector).filter(Boolean)).size;
  }

  function groupRows(rows, keySelector, initial) {
    const groups = new Map();
    for (const row of rows) {
      const key = keySelector(row) || "Sin clasificar";
      let group = groups.get(key);
      if (!group) {
        group = initial(key);
        groups.set(key, group);
      }
      group.rows.push(row);
    }
    return groups;
  }

  function maintenanceSummary(rows) {
    const groups = groupRows(rows, (row) => row.Tipo_mantenimiento, (type) => ({
      type, rows: [], ots: new Set(), labor: 0, downtime: 0, cost: 0
    }));
    for (const group of groups.values()) {
      group.ots = new Set(group.rows.map((row) => row.OT).filter(Boolean));
      group.orders = group.ots.size;
      group.labor = sum(group.rows, "Horas_mano_obra");
      group.downtime = sum(group.rows, "Downtime_h");
      group.cost = sum(group.rows, "Costo_total_CLP");
    }
    const totals = {
      orders: countUnique(rows, (row) => row.OT),
      labor: sum(rows, "Horas_mano_obra"),
      downtime: sum(rows, "Downtime_h"),
      cost: sum(rows, "Costo_total_CLP")
    };
    for (const group of groups.values()) {
      group.orderPct = totals.orders ? group.orders / totals.orders * 100 : 0;
      group.laborPct = totals.labor ? group.labor / totals.labor * 100 : 0;
      group.downtimePct = totals.downtime ? group.downtime / totals.downtime * 100 : 0;
      group.costPct = totals.cost ? group.cost / totals.cost * 100 : 0;
    }
    return { groups: [...groups.values()].sort((a, b) => b.orders - a.orders), totals };
  }

  function median(values) {
    const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calculateMttr(rows) {
    const repairs = rows.filter((row) => row._repairHours !== null);
    const values = repairs.map((row) => row._repairHours);
    const byType = groupRows(repairs, (row) => row.Tipo_equipo, (type) => ({ type, rows: [] }));
    const groups = [...byType.values()].map((group) => {
      const durations = group.rows.map((row) => row._repairHours);
      return {
        ...group,
        repairs: countUnique(group.rows, (row) => row.OT),
        mttr: durations.length ? durations.reduce((total, value) => total + value, 0) / durations.length : 0,
        median: median(durations)
      };
    }).sort((a, b) => b.mttr - a.mttr);
    return {
      repairs: countUnique(repairs, (row) => row.OT),
      validRecords: repairs.length,
      mttr: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
      median: median(values),
      groups
    };
  }

  function aggregateEquipment(rows, metric) {
    const groups = groupRows(rows, (row) => row.Equipo, (name) => ({ name, rows: [], criticity: "—", ots: new Set(), value: 0 }));
    const values = [...groups.values()].map((group) => {
      group.ots = new Set(group.rows.map((row) => row.OT).filter(Boolean));
      group.value = sum(group.rows, metric);
      group.criticity = group.rows.find((row) => row.Criticidad !== "—")?.Criticidad ?? "—";
      return { ...group, orderCount: group.ots.size };
    });
    return values.filter((entry) => entry.name !== "Sin equipo").sort((a, b) => b.value - a.value);
  }

  function aggregateFailures(rows, metric) {
    const correctives = rows.filter((row) => normalizeKey(row.Tipo_mantenimiento) === "correctivo" && row.Modo_falla);
    const groups = groupRows(correctives, (row) => row.Modo_falla, (name) => ({ name, rows: [], ots: new Set(), value: 0 }));
    const values = [...groups.values()].map((group) => ({
      ...group,
      orderCount: countUnique(group.rows, (row) => row.OT),
      value: metric === "N_eventos" ? countUnique(group.rows, (row) => row.OT) : sum(group.rows, metric)
    })).sort((a, b) => b.value - a.value);
    const total = values.reduce((amount, item) => amount + item.value, 0);
    let cumulative = 0;
    for (const entry of values) {
      cumulative += total ? entry.value / total * 100 : 0;
      entry.cumulative = cumulative;
    }
    return values;
  }

  function aggregateJackknife(rows, key) {
    const correctives = rows.filter((row) => normalizeKey(row.Tipo_mantenimiento) === "correctivo" && row[key]);
    const groups = groupRows(correctives, (row) => row[key], (name) => ({ name, rows: [] }));
    const values = [...groups.values()].map((group) => {
      const failures = countUnique(group.rows, (row) => row.OT);
      const downtime = sum(group.rows, "Downtime_h");
      return { ...group, failures, downtime, mttr: failures ? downtime / failures : 0 };
    }).filter((entry) => entry.failures > 0);
    const meanFrequency = values.length ? values.reduce((total, entry) => total + entry.failures, 0) / values.length : 0;
    const totalFailures = values.reduce((total, entry) => total + entry.failures, 0);
    const meanMttr = totalFailures ? values.reduce((total, entry) => total + entry.downtime, 0) / totalFailures : 0;
    for (const entry of values) {
      entry.frequencyNorm = meanFrequency ? entry.failures / meanFrequency : 0;
      entry.mttrNorm = meanMttr ? entry.mttr / meanMttr : 0;
      entry.risk = entry.frequencyNorm * entry.mttrNorm;
      entry.classification = entry.frequencyNorm < 1
        ? (entry.mttrNorm < 1 ? "Bajo control" : "Agudo")
        : (entry.mttrNorm < 1 ? "Crónico" : "Grave");
    }
    return values.sort((a, b) => b.risk - a.risk);
  }

  function analyzeRows(rows) {
    const distribution = maintenanceSummary(rows);
    const mttr = calculateMttr(rows);
    return {
      distribution,
      mttr,
      topDowntime: aggregateEquipment(rows, "Downtime_h").slice(0, 10),
      topCost: aggregateEquipment(rows, "Costo_total_CLP").slice(0, 10),
      paretoFrequency: aggregateFailures(rows, "N_eventos"),
      paretoDowntime: aggregateFailures(rows, "Downtime_h"),
      paretoCost: aggregateFailures(rows, "Costo_total_CLP"),
      jackknifeEquipment: aggregateJackknife(rows, "Equipo"),
      jackknifeFailure: aggregateJackknife(rows.filter((row) => row._repairHours !== null), "Modo_falla")
    };
  }

  function renderDashboard() {
    if (!state.hasDataset) return;
    const rows = getFilteredRows();
    const analysis = analyzeRows(rows);
    const { totals, groups } = analysis.distribution;
    const corrective = groups.find((group) => normalizeKey(group.type) === "correctivo");
    document.getElementById("kpiOrders").textContent = formatNumber(totals.orders);
    document.getElementById("kpiOrdersNote").textContent = `${formatNumber(rows.length)} registros incluidos`;
    document.getElementById("kpiLabor").textContent = formatNumber(totals.labor, 1);
    document.getElementById("kpiDowntime").textContent = formatNumber(totals.downtime, 1);
    document.getElementById("kpiCost").textContent = formatCurrencyCompact(totals.cost);
    document.getElementById("kpiMttr").textContent = analysis.mttr.mttr === null ? "—" : `${formatNumber(analysis.mttr.mttr, 1)} h`;
    document.getElementById("kpiMttrNote").textContent = analysis.mttr.mttr === null
      ? "sin reparaciones correctivas válidas"
      : `${formatNumber(analysis.mttr.repairs)} OT · mediana ${formatNumber(analysis.mttr.median, 1)} h`;
    document.getElementById("kpiCorrective").textContent = corrective ? `${formatNumber(corrective.orderPct, 1)}%` : "—";
    elements.filteredCount.textContent = `${formatNumber(rows.length)} registros · ${formatNumber(totals.orders)} OT únicas`;
    const selectedType = elements.maintenanceFilter.value === "*" ? "todos los tipos de mantenimiento" : elements.maintenanceFilter.value;
    const range = formatDateRange();
    const rangeText = range ? ` · Inicio: ${range}` : "";
    elements.dashboardSubheading.textContent = `Resultados de ${state.fileName} · ${selectedType} · ${formatNumber(rows.length)} filas tras filtros${rangeText}.`;
    updateInsight(analysis, totals);
    renderTables(analysis);
    renderCharts(analysis);
    state.lastAnalysis = analysis;
    state.lastRows = rows;
  }

  function updateInsight(analysis, totals) {
    const firstEquipment = analysis.topDowntime[0];
    const firstFailure = analysis.paretoDowntime[0];
    const corrective = analysis.distribution.groups.find((group) => normalizeKey(group.type) === "correctivo");
    if (!totals.orders) {
      elements.insightTitle.textContent = "No hay registros con estos filtros";
      elements.insightText.textContent = "Amplía la selección para volver a consultar los indicadores.";
      return;
    }
    elements.insightTitle.textContent = firstEquipment
      ? `${firstEquipment.name} concentra más downtime`
      : "No hay equipos identificados en este periodo";
    const details = [];
    if (firstEquipment) details.push(`${formatNumber(firstEquipment.value, 1)} h de downtime.`);
    if (firstFailure) details.push(`El modo de falla más asociado a downtime es “${firstFailure.name}” (${formatNumber(firstFailure.value, 1)} h).`);
    if (corrective) details.push(`El correctivo representa ${formatNumber(corrective.orderPct, 1)}% de las OT y ${formatNumber(corrective.downtimePct, 1)}% del downtime.`);
    elements.insightText.textContent = details.join(" ") || "Carga columnas de equipo y downtime para identificar oportunidades de mejora.";
  }

  function renderTables(analysis) {
    fillTable(elements.failureTable, analysis.paretoFrequency.slice(0, 8), [
      (item) => item.name,
      (item) => formatNumber(item.value),
      (item) => `${formatNumber(item.rows.reduce((total, row) => total + row.Downtime_h, 0), 1)} h`
    ]);
    fillTable(elements.equipmentTable, analysis.topDowntime.slice(0, 8), [
      (item) => item.name,
      (item) => item.criticity,
      (item) => `${formatNumber(item.value, 1)} h`
    ]);
  }

  function fillTable(body, rows, cells) {
    body.replaceChildren();
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = cells.length;
      cell.className = "empty-row";
      cell.textContent = "Sin registros para mostrar";
      row.append(cell);
      body.append(row);
      return;
    }
    for (const item of rows) {
      const row = document.createElement("tr");
      for (const renderCell of cells) {
        const cell = document.createElement("td");
        cell.textContent = String(renderCell(item));
        row.append(cell);
      }
      body.append(row);
    }
  }

  function commonOptions(formatter, extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 15, font: { size: 9 } } },
        tooltip: { backgroundColor: "#173149", padding: 10, titleFont: { weight: "600" }, bodyFont: { size: 10 }, callbacks: formatter ? { label: formatter } : {} }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 30, minRotation: 0, font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 9 } } }
      },
      ...extra
    };
  }

  function upsertChart(id, config) {
    const canvas = document.getElementById(id);
    const old = state.charts.get(id);
    if (old) old.destroy();
    const chart = new Chart(canvas, config);
    state.charts.set(id, chart);
  }

  function renderCharts(analysis) {
    const groups = analysis.distribution.groups;
    const types = groups.map((group) => group.type);
    upsertChart("impactChart", {
      type: "bar",
      data: {
        labels: types,
        datasets: [
          { label: "% OT", data: groups.map((group) => group.orderPct), backgroundColor: PALETTE.navy, borderRadius: 3 },
          { label: "% Horas-hombre", data: groups.map((group) => group.laborPct), backgroundColor: PALETTE.blue, borderRadius: 3 },
          { label: "% Downtime", data: groups.map((group) => group.downtimePct), backgroundColor: PALETTE.amber, borderRadius: 3 },
          { label: "% Costo", data: groups.map((group) => group.costPct), backgroundColor: PALETTE.teal, borderRadius: 3 }
        ]
      },
      options: commonOptions((ctx) => `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y, 1)}%`, {
        scales: { x: { grid: { display: false }, border: { display: false } }, y: { beginAtZero: true, max: 100, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { callback: (value) => `${value}%` } } }
      })
    });
    upsertChart("laborChart", {
      type: "doughnut",
      data: { labels: types, datasets: [{ data: groups.map((group) => group.labor), backgroundColor: [PALETTE.navy, PALETTE.teal, PALETTE.blue, PALETTE.amber, PALETTE.purple], borderWidth: 3, borderColor: "#fff", hoverOffset: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, padding: 12, font: { size: 9 } } }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatNumber(ctx.raw, 1)} h` } } } }
    });
    renderSimpleBar("downtimeTypeChart", groups.map((group) => group.type), groups.map((group) => group.downtime), "Horas", PALETTE.amber, "h");
    renderSimpleBar("costTypeChart", groups.map((group) => group.type), groups.map((group) => group.cost / 1_000_000), "Millones CLP", PALETTE.teal, " M");

    const mttrGroups = analysis.mttr.groups.slice(0, 10);
    renderSimpleBar("mttrChart", mttrGroups.map((group) => group.type), mttrGroups.map((group) => group.mttr), "MTTR [h]", PALETTE.purple, " h", true);
    renderSimpleBar("equipmentDowntimeChart", analysis.topDowntime.slice(0, 10).map((entry) => entry.name), analysis.topDowntime.slice(0, 10).map((entry) => entry.value), "Downtime [h]", PALETTE.amber, " h", true);
    renderSimpleBar("equipmentCostChart", analysis.topCost.slice(0, 10).map((entry) => entry.name), analysis.topCost.slice(0, 10).map((entry) => entry.value / 1_000_000), "Costo [M CLP]", PALETTE.teal, " M", true);
    renderPareto("paretoFrequencyChart", analysis.paretoFrequency, "N_eventos", "Eventos", PALETTE.blue);
    renderPareto("paretoDowntimeChart", analysis.paretoDowntime, "Downtime_h", "Downtime [h]", PALETTE.amber);
    renderPareto("paretoCostChart", analysis.paretoCost, "Costo_total_CLP", "Costo [M CLP]", PALETTE.teal);
    renderJackknife("jackknifeEquipmentChart", analysis.jackknifeEquipment, "Equipos");
    renderJackknife("jackknifeFailureChart", analysis.jackknifeFailure, "Modos de falla");
  }

  function renderSimpleBar(id, labels, values, seriesLabel, color, suffix, horizontal = false) {
    upsertChart(id, {
      type: "bar",
      data: { labels, datasets: [{ label: seriesLabel, data: values, backgroundColor: color, borderRadius: 4, maxBarThickness: 25 }] },
      options: commonOptions((ctx) => `${seriesLabel}: ${formatNumber(ctx.parsed[horizontal ? "x" : "y"], 1)}${suffix}`, {
        indexAxis: horizontal ? "y" : "x",
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#173149", padding: 10, callbacks: { label: (ctx) => `${seriesLabel}: ${formatNumber(ctx.parsed[horizontal ? "x" : "y"], 1)}${suffix}` } } },
        scales: horizontal
          ? { x: { beginAtZero: true, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 9 } } }, y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 8 } } } }
          : { x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 8 }, maxRotation: 25, minRotation: 0 } }, y: { beginAtZero: true, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 9 } } } }
      })
    });
  }

  function renderPareto(id, groups, metric, label, color) {
    const top = groups.slice(0, 10);
    const getValue = (entry) => metric === "N_eventos" ? entry.value : metric === "Downtime_h" ? entry.value : entry.value / 1_000_000;
    upsertChart(id, {
      type: "bar",
      data: {
        labels: top.map((entry) => entry.name),
        datasets: [
          { type: "bar", label, data: top.map(getValue), backgroundColor: color, borderRadius: 3, yAxisID: "y" },
          { type: "line", label: "% acumulado", data: top.map((entry) => entry.cumulative), borderColor: PALETTE.navy, backgroundColor: PALETTE.navy, pointRadius: 2, pointHoverRadius: 4, borderWidth: 2, tension: 0.2, yAxisID: "y1" }
        ]
      },
      options: {
        ...commonOptions(),
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 8 }, maxRotation: 35, minRotation: 10 } },
          y: { beginAtZero: true, position: "left", grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 8 } } },
          y1: { beginAtZero: true, max: 100, position: "right", grid: { drawOnChartArea: false }, border: { display: false }, ticks: { callback: (value) => `${value}%`, font: { size: 8 } } }
        }
      }
    });
  }

  const jackknifeThreshold = {
    id: "jackknifeThreshold",
    afterDraw(chart) {
      const { ctx, scales } = chart;
      const x = scales.x.getPixelForValue(1);
      const y = scales.y.getPixelForValue(1);
      ctx.save();
      ctx.strokeStyle = "#92a2ae";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (x >= scales.x.left && x <= scales.x.right) {
        ctx.moveTo(x, scales.y.top);
        ctx.lineTo(x, scales.y.bottom);
      }
      if (y >= scales.y.top && y <= scales.y.bottom) {
        ctx.moveTo(scales.x.left, y);
        ctx.lineTo(scales.x.right, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  function renderJackknife(id, groups, entityLabel) {
    const quadrants = [
      { name: "Bajo control", color: PALETTE.green },
      { name: "Agudo", color: PALETTE.amber },
      { name: "Crónico", color: PALETTE.blue },
      { name: "Grave", color: PALETTE.red }
    ];
    upsertChart(id, {
      type: "scatter",
      plugins: [jackknifeThreshold],
      data: {
        datasets: quadrants.map((quadrant) => ({
          label: quadrant.name,
          data: groups.filter((entry) => entry.classification === quadrant.name).map((entry) => ({
            x: entry.frequencyNorm, y: entry.mttrNorm, name: entry.name,
            failures: entry.failures, mttr: entry.mttr, downtime: entry.downtime, risk: entry.risk
          })),
          backgroundColor: quadrant.color,
          borderColor: "#fff",
          borderWidth: 1,
          pointRadius: (ctx) => Math.min(10, 4 + Math.log1p(ctx.raw?.failures ?? 0)),
          pointHoverRadius: 8
        }))
      },
      options: {
        ...commonOptions(),
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 7, padding: 10, font: { size: 8 } } },
          tooltip: { callbacks: { label: (ctx) => {
            const point = ctx.raw;
            return `${point.name}: ${formatNumber(point.failures)} fallas · ${formatNumber(point.mttr, 1)} h MTTR · ${formatNumber(point.downtime, 1)} h downtime`;
          } } }
        },
        scales: {
          x: { type: "linear", beginAtZero: true, title: { display: true, text: "Frecuencia normalizada (media = 1)", font: { size: 8 } }, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 8 } } },
          y: { type: "linear", beginAtZero: true, title: { display: true, text: "MTTR normalizado (media = 1)", font: { size: 8 } }, grid: { color: PALETTE.grid }, border: { display: false }, ticks: { font: { size: 8 } } }
        }
      }
    });
    const canvas = document.getElementById(id);
    canvas.setAttribute("aria-label", `Jack-Knife por ${entityLabel}`);
  }

  function formatNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value);
  }

  function formatCurrencyCompact(value) {
    if (!Number.isFinite(value) || value === 0) return "0 CLP";
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, 2)} mil M`;
    if (absolute >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)} M`;
    if (absolute >= 1_000) return `${formatNumber(value / 1_000, 1)} mil`;
    return `${formatCurrency(value)} CLP`;
  }

  function exportPdf() {
    if (!state.lastAnalysis || !state.lastRows) {
      showStatus("Primero carga y analiza un dataset.", "error");
      return;
    }
    if (typeof window.jspdf?.jsPDF !== "function" || typeof Chart === "undefined") {
      showStatus("No se pudieron cargar las bibliotecas del PDF. Comprueba tu conexión y vuelve a intentarlo.", "error");
      return;
    }
    try {
      elements.pdfButton.disabled = true;
      elements.pdfButton.textContent = "Preparando informe…";
      const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      if (typeof doc.autoTable !== "function") throw new Error("No se encontró el complemento de tablas para generar el PDF.");
      createPdfReport(doc, state.lastAnalysis, state.lastRows);
      const base = state.fileName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "_");
      doc.save(`Informe_CMMS_${base || "dataset"}.pdf`);
      showStatus("Informe PDF generado y descargado correctamente.", "success");
    } catch (error) {
      showStatus(`No se pudo generar el PDF: ${error instanceof Error ? error.message : "Error desconocido."}`, "error");
    } finally {
      elements.pdfButton.disabled = false;
      elements.pdfButton.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 14v2h12v-2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>Exportar informe PDF';
    }
  }

  function createPdfReport(doc, analysis, rows) {
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    const margin = 15;
    const now = new Date();
    const totals = analysis.distribution.totals;
    const corrective = analysis.distribution.groups.find((group) => normalizeKey(group.type) === "correctivo");
    const filteredType = elements.maintenanceFilter.value === "*" ? "Todos los tipos" : elements.maintenanceFilter.value;
    const filteredEquipment = elements.equipmentFilter.value === "*" ? "Todos los equipos" : elements.equipmentFilter.value;
    const dateRange = formatDateRange() || "Sin filtro de fechas";

    doc.setFillColor(16, 36, 58);
    doc.rect(0, 0, width, 52, "F");
    doc.setFillColor(38, 152, 134);
    doc.rect(margin, 13, 2, 23, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(111, 212, 191);
    doc.text("ANALÍTICA DE MANTENIMIENTO  /  CMMS", margin + 7, 17);
    doc.setFontSize(23);
    doc.setTextColor(255, 255, 255);
    doc.text("Informe ejecutivo", margin + 7, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(196, 211, 221);
    doc.text("Desempeño, mantenibilidad y priorización de fallas", margin + 7, 36);
    doc.setFontSize(8);
    doc.setTextColor(185, 202, 214);
    doc.text(`Dataset: ${state.fileName}`, margin, 45);
    doc.text(`Generado: ${now.toLocaleDateString("es-CL")} · ${now.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}`, width - margin, 45, { align: "right" });

    const cardGap = 4;
    const cardWidth = (width - margin * 2 - cardGap * 2) / 3;
    const cards = [
      ["ÓRDENES DE TRABAJO", formatNumber(totals.orders), "OT únicas"],
      ["HORAS-HOMBRE", `${formatNumber(totals.labor, 1)} h`, "Mano de obra registrada"],
      ["DOWNTIME", `${formatNumber(totals.downtime, 1)} h`, "Indisponibilidad registrada"],
      ["COSTO DIRECTO", `${formatCurrency(totals.cost)} CLP`, "Costo de mantenimiento"],
      ["MTTR CORRECTIVO", analysis.mttr.mttr === null ? "N/D" : `${formatNumber(analysis.mttr.mttr, 1)} h`, `${formatNumber(analysis.mttr.repairs)} OT válidas`],
      ["PESO CORRECTIVO", corrective ? `${formatNumber(corrective.orderPct, 1)}%` : "N/D", "Participación de las OT"]
    ];
    let cardY = 59;
    cards.forEach(([label, value, note], index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = margin + col * (cardWidth + cardGap);
      const y = cardY + row * 26;
      doc.setDrawColor(225, 233, 239);
      doc.setFillColor(250, 252, 253);
      doc.roundedRect(x, y, cardWidth, 22, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(112, 130, 145);
      doc.text(label, x + 3, y + 5);
      doc.setFontSize(value.length > 16 ? 10 : 13);
      doc.setTextColor(25, 48, 70);
      doc.text(value, x + 3, y + 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(132, 146, 158);
      doc.text(note, x + 3, y + 18);
    });

    let cursorY = 116;
    pdfSectionTitle(doc, "Distribución por tipo de mantenimiento", margin, cursorY);
    const mixRows = analysis.distribution.groups.map((group) => [
      group.type, formatNumber(group.orders), `${formatNumber(group.orderPct, 1)}%`,
      `${formatNumber(group.laborPct, 1)}%`, `${formatNumber(group.downtimePct, 1)}%`,
      `${formatNumber(group.costPct, 1)}%`
    ]);
    doc.autoTable({
      startY: cursorY + 4,
      head: [["Tipo", "OT", "% OT", "% HH", "% Downtime", "% Costo"]],
      body: mixRows.length ? mixRows : [["Sin datos", "—", "—", "—", "—", "—"]],
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2.1, textColor: [55, 75, 94], lineColor: [228, 234, 239], lineWidth: 0.15 },
      headStyles: { fillColor: [24, 54, 79], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 250, 251] }
    });
    cursorY = doc.lastAutoTable.finalY + 9;

    pdfSectionTitle(doc, "Prioridades del periodo", margin, cursorY);
    cursorY += 5;
    const insightLines = [];
    if (analysis.topDowntime[0]) insightLines.push(`Equipo con mayor downtime: ${analysis.topDowntime[0].name} (${formatNumber(analysis.topDowntime[0].value, 1)} h).`);
    if (analysis.paretoDowntime[0]) insightLines.push(`Modo de falla con mayor downtime: ${analysis.paretoDowntime[0].name} (${formatNumber(analysis.paretoDowntime[0].value, 1)} h).`);
    if (corrective) insightLines.push(`El mantenimiento correctivo representa ${formatNumber(corrective.orderPct, 1)}% de las OT, ${formatNumber(corrective.downtimePct, 1)}% del downtime y ${formatNumber(corrective.costPct, 1)}% del costo directo.`);
    if (!insightLines.length) insightLines.push("No hay datos suficientes para generar prioridades con los filtros seleccionados.");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(67, 88, 106);
    doc.text(doc.splitTextToSize(insightLines.join("\n"), width - margin * 2), margin, cursorY + 5);
    cursorY += 23;

    pdfSectionTitle(doc, "Equipos prioritarios por downtime", margin, cursorY);
    doc.autoTable({
      startY: cursorY + 4,
      head: [["Equipo", "Criticidad", "OT", "Downtime [h]", "Costo [CLP]"]],
      body: analysis.topDowntime.slice(0, 8).map((entry) => [
        entry.name, entry.criticity, formatNumber(entry.orderCount),
        formatNumber(entry.value, 1), formatCurrency(sum(entry.rows, "Costo_total_CLP"))
      ]),
      theme: "grid",
      margin: { left: margin, right: margin },
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.8, textColor: [55, 75, 94], lineColor: [228, 234, 239], lineWidth: 0.15 },
      headStyles: { fillColor: [24, 54, 79], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 250, 251] }
    });

    const paretoStartY = doc.lastAutoTable.finalY + 8;
    if (paretoStartY < height - 42) {
      pdfSectionTitle(doc, "Modos de falla prioritarios", margin, paretoStartY);
      doc.autoTable({
        startY: paretoStartY + 4,
        head: [["Modo de falla", "Eventos", "Downtime [h]", "Costo [CLP]"]],
        body: analysis.paretoFrequency.slice(0, 6).map((entry) => [
          entry.name, formatNumber(entry.value),
          formatNumber(sum(entry.rows, "Downtime_h"), 1),
          formatCurrency(sum(entry.rows, "Costo_total_CLP"))
        ]),
        theme: "grid",
        margin: { left: margin, right: margin },
        styles: { font: "helvetica", fontSize: 7, cellPadding: 1.6, textColor: [55, 75, 94], lineColor: [228, 234, 239], lineWidth: 0.15 },
        headStyles: { fillColor: [24, 54, 79], textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 250, 251] }
      });
    }

    doc.addPage();
    const chartPages = [
      ["Impacto porcentual por tipo de mantenimiento", "impactChart"],
      ["Horas-hombre por tipo de mantenimiento", "laborChart"],
      ["Downtime por tipo de mantenimiento", "downtimeTypeChart"],
      ["Costo directo por tipo de mantenimiento", "costTypeChart"],
      ["MTTR por tipo de equipo", "mttrChart"],
      ["Equipos con mayor downtime", "equipmentDowntimeChart"],
      ["Equipos con mayor costo directo", "equipmentCostChart"],
      ["Pareto de fallas por frecuencia", "paretoFrequencyChart"],
      ["Pareto de fallas por downtime", "paretoDowntimeChart"],
      ["Pareto de fallas por costo directo", "paretoCostChart"],
      ["Jack-Knife normalizado por equipo", "jackknifeEquipmentChart"],
      ["Jack-Knife normalizado por modo de falla", "jackknifeFailureChart"]
    ];
    let chartIndex = 0;
    for (let index = 0; index < chartPages.length; index += 2) {
      if (index > 0) doc.addPage();
      addPdfChart(doc, chartPages[index][0], chartPages[index][1], margin, 15, width - margin * 2, 91);
      if (chartPages[index + 1]) addPdfChart(doc, chartPages[index + 1][0], chartPages[index + 1][1], margin, 145, width - margin * 2, 91);
      chartIndex += 2;
    }
    void chartIndex;

    doc.addPage();
    pdfSectionTitle(doc, "Criterios y alcance", margin, 22);
    const scope = [
      `Archivo analizado: ${state.fileName}.`,
      `Registros seleccionados: ${formatNumber(rows.length)} de ${formatNumber(state.sourceRows)}; ${formatNumber(state.duplicates)} duplicados exactos omitidos.`,
      `Filtros aplicados: ${filteredType} · ${filteredEquipment}.`,
      `Rango de fecha de inicio: ${dateRange}.`,
      `MTTR: media del tiempo entre fecha de inicio y fecha de fin en órdenes correctivas cerradas, con fechas válidas y duración mayor que cero. Se excluyen filas con fechas inválidas o sin cierre.`,
      "Jack-Knife: frecuencia por entidad relativa al promedio y MTTR estimado como downtime acumulado / número de OT correctivas únicas. Los cuadrantes usan 1 como umbral relativo.",
      "El Pareto de modos de falla considera órdenes correctivas con un modo de falla informado. Las participaciones de mantenimiento se calculan sobre el conjunto actualmente filtrado.",
      "MTBF y disponibilidad no se calculan: requieren horas reales de operación del activo, que no se derivan de la duración de las órdenes."
    ];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(67, 88, 106);
    let y = 32;
    for (const text of scope) {
      const lines = doc.splitTextToSize(`• ${text}`, width - margin * 2);
      doc.text(lines, margin, y);
      y += lines.length * 5 + 4;
    }

    for (let page = 1; page <= doc.internal.getNumberOfPages(); page += 1) {
      doc.setPage(page);
      doc.setDrawColor(225, 232, 237);
      doc.line(margin, height - 12, width - margin, height - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(131, 145, 156);
      doc.text("CMMS Analítica · Informe generado localmente", margin, height - 7);
      doc.text(`${page} / ${doc.internal.getNumberOfPages()}`, width - margin, height - 7, { align: "right" });
    }
  }

  function pdfSectionTitle(doc, title, x, y) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(28, 57, 79);
    doc.text(title, x, y);
    doc.setDrawColor(38, 152, 134);
    doc.setLineWidth(0.7);
    doc.line(x, y + 2, x + 12, y + 2);
  }

  function formatDateRange() {
    const from = elements.dateFrom.value;
    const to = elements.dateTo.value;
    if (!from && !to) return "";
    const format = (value) => {
      if (!value) return "";
      const [year, month, day] = value.split("-");
      return `${day}-${month}-${year}`;
    };
    return `${from ? format(from) : "sin límite"} a ${to ? format(to) : "sin límite"}`;
  }

  function addPdfChart(doc, title, id, x, y, width, height) {
    const chart = state.charts.get(id);
    pdfSectionTitle(doc, title, x, y);
    if (!chart) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(125, 138, 150);
      doc.text("Sin datos para mostrar.", x, y + 10);
      return;
    }
    const image = chart.toBase64Image("image/png", 1);
    const imageY = y + 6;
    const availableHeight = height - 7;
    const sourceWidth = chart.canvas.width;
    const sourceHeight = chart.canvas.height;
    const ratio = Math.min(width / sourceWidth, availableHeight / sourceHeight);
    const imageWidth = sourceWidth * ratio;
    const imageHeight = sourceHeight * ratio;
    doc.addImage(image, "PNG", x + (width - imageWidth) / 2, imageY, imageWidth, imageHeight, undefined, "FAST");
  }
})();
