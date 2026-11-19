// ============================================================================
// CENTER CLEANING CHECKLIST - FRONTEND CONTROLLER
// Supports:
// - Optimistic instant UI updates with background Google Sheets sync
// - 5-step Undo Stack for edits, initials, and drag-and-drop moves
// - 2-Week Advance Planning (Next Week & 2 Weeks Out) with Week A / Week B forms
// - Full on-page editing (Section, Description, Delete, Add, Reorder, Week Date)
// ============================================================================

// ⚠️ KEEP YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL HERE:
const API_URL = "https://script.google.com/macros/s/AKfycbymL4d3ljznC66zA-eMDaHDAleUiwivA7IDZdwD8X3stHhBBq76SwmKKnJNlG1qdzXNNw/exec"; 

// --- GLOBAL APPLICATION STATE ---
let currentTabName = "Current Week";
let allArchiveRows = [];           // Holds raw Archive Log rows so dropdown switching is instant
let selectedArchiveStamp = "";     // Currently selected archived week timestamp
let taskData = [];                 // Tasks for the currently active tab

// Operating days per schedule tier
let masterOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let nextWeekOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let week2OperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
const allDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];

// Editable Week Dates & Active Form Trackers (A or B)
let weekDates = { "Current Week": "", "Next Week": "", "Week 2 Out": "" };
let weekForms = { "Current Week": "A", "Next Week": "B", "Week 2 Out": "A" };

// UI Modes & Undo History
let isEditMode = false;
let undoStack = [];
let draggedRowIndex = null;

// ============================================================================
// 1. DATA FETCHING & ARCHIVE FILTERING
// ============================================================================

/**
 * Fetches tasks and settings from Google Apps Script for the selected tab.
 */
async function fetchTasks(sheetName) {
    const contentEl = document.getElementById('checklist-content');
    contentEl.innerHTML = "<div style='padding:20px;text-align:center;font-weight:600;color:#475569;'>Loading checklist matrix...</div>";
    
    const isArchive = sheetName.startsWith("Archive");
    const targetBackendSheet = isArchive ? "Archive Log" : sheetName;

    try {
        const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(targetBackendSheet)}`);
        const json = await response.json();
        
        if (json && json.masterOperatingDays) {
            masterOperatingDays = json.masterOperatingDays;
            nextWeekOperatingDays = json.nextWeekOperatingDays || masterOperatingDays;
            week2OperatingDays = json.week2OperatingDays || masterOperatingDays;
            weekDates = json.weekDates || weekDates;
            weekForms = json.weekForms || weekForms;
            taskData = Array.isArray(json.tasks) ? json.tasks : [];
        } else if (Array.isArray(json)) {
            taskData = json;
        } else {
            taskData = [];
        }

        // If viewing Archive, populate the dropdown of archived weeks and filter
        if (isArchive) {
            allArchiveRows = [...taskData];
            populateArchiveDropdown();
        }
        
        renderChecklist();
    } catch (error) {
        console.error("Fetch Error:", error);
        contentEl.innerHTML = "<div style='padding:20px;color:#DC2626;font-weight:bold;'>Error loading data. Verify Google Apps Script deployment URL and permissions.</div>";
    }
}

/**
 * Populates the Archive period dropdown with all unique archived week timestamps (newest first).
 */
function populateArchiveDropdown() {
    const selectEl = document.getElementById('archive-week-select');
    // Extract unique non-empty timestamps and reverse so most recent archive is first
    const uniqueStamps = [...new Set(allArchiveRows.map(r => (r.Timestamp || "").toString().trim()))]
        .filter(Boolean)
        .reverse();

    if (uniqueStamps.length === 0) {
        selectEl.innerHTML = `<option value="">No archived weeks found</option>`;
        taskData = [];
        return;
    }

    selectEl.innerHTML = uniqueStamps.map((stamp, idx) => {
        const label = idx === 0 ? `Most Recent — ${stamp}` : 
                      idx === 1 ? `2 Weeks Ago — ${stamp}` : `Archive — ${stamp}`;
        return `<option value="${stamp}">${label}</option>`;
    }).join('');

    selectedArchiveStamp = uniqueStamps[0];
    taskData = allArchiveRows.filter(r => (r.Timestamp || "").toString().trim() === selectedArchiveStamp);
}

/**
 * Switches the displayed archived week instantly from cached rows.
 */
function changeArchiveWeek(stamp) {
    selectedArchiveStamp = stamp;
    taskData = allArchiveRows.filter(r => (r.Timestamp || "").toString().trim() === stamp);
    renderChecklist();
}

// ============================================================================
// 2. HELPER UTILITIES & UNDO STACK
// ============================================================================

function getScheduleType(task) {
    return (task.ScheduleType || task["Schedule Type"] || "").toString().trim();
}

function getTaskFrequency(task) {
    return (task.Frequency || "Every Week").toString().trim();
}

function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('toggle-edit-btn');
    if (isEditMode) {
        btn.innerText = "✖ Exit Edit Mode";
        btn.classList.add('active-mode');
    } else {
        btn.innerText = "✏️ Edit Mode";
        btn.classList.remove('active-mode');
    }
    renderChecklist();
}

function pushUndoAction(actionObj) {
    undoStack.push(actionObj);
    if (undoStack.length > 5) undoStack.shift(); // Keep last 5 actions
    updateUndoButton();
}

function updateUndoButton() {
    const btn = document.getElementById('undo-btn');
    if (undoStack.length > 0) {
        btn.style.display = "inline-block";
        btn.innerText = `↩ Undo (${undoStack.length})`;
    } else {
        btn.style.display = "none";
    }
}

async function undoLastAction() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    updateUndoButton();

    const item = taskData.find(t => t.rowNum == action.rowNum);

    if (action.type === 'cell') {
        if (item) item[action.field] = action.oldValue;
        renderChecklist();
        await updateCellOnSheet(action.rowNum, action.colNum, action.oldValue, action.sheet);
    } else if (action.type === 'day') {
        if (item) item.Day = action.oldDay;
        renderChecklist();
        await updateCellOnSheet(action.rowNum, 1, action.oldDay, action.sheet);
    }
}

// ============================================================================
// 3. MAIN MATRIX & MASTER LIST RENDERING
// ============================================================================

function renderChecklist() {
    const container = document.getElementById('checklist-content');
    container.innerHTML = "";

    const isMasterTab = currentTabName === 'Master Task List';
    const isNextWeekTab = currentTabName === 'Next Week';
    const isWeek2Tab = currentTabName === 'Week 2 Out';
    const isPlanningTab = isNextWeekTab || isWeek2Tab;
    const isCurrentWeekTab = currentTabName === 'Current Week';
    const isArchiveTab = currentTabName.startsWith('Archive');
    
    // Auto-exit Edit Mode when navigating away from Current Week
    if (!isCurrentWeekTab && isEditMode) {
        isEditMode = false;
        const btn = document.getElementById('toggle-edit-btn');
        if (btn) {
            btn.innerText = "✏️ Edit Mode";
            btn.classList.remove('active-mode');
        }
    }

    // Update Header Title & Editable Week Date Box
    const titleMap = {
        "Current Week": "This Week's Checklist",
        "Next Week": "Next Week Plan (Week +1)",
        "Week 2 Out": "2 Weeks Out Plan (Week +2)",
        "Archive Log": "Archived Checklists",
        "Master Task List": "Default Week Master List (Forms A & B)"
    };
    document.getElementById('view-title').innerText = titleMap[currentTabName] || currentTabName;

    const weekDateContainer = document.getElementById('week-date-container');
    const formBadge = document.getElementById('active-form-badge');
    if (isCurrentWeekTab || isPlanningTab) {
        weekDateContainer.style.display = 'flex';
        document.getElementById('week-date-input').value = weekDates[currentTabName] || "";
        formBadge.style.display = 'inline-block';
        formBadge.innerText = `Form ${weekForms[currentTabName] || "A"}`;
    } else {
        weekDateContainer.style.display = 'none';
        formBadge.style.display = 'none';
    }

    // Toggle Top Control Bars
    document.getElementById('toggle-edit-btn').style.display = isCurrentWeekTab ? 'inline-block' : 'none';
    document.getElementById('archive-selector-container').style.display = isArchiveTab ? 'flex' : 'none';
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('planning-controls-container').style.display = isPlanningTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = (isMasterTab || isPlanningTab || (isCurrentWeekTab && isEditMode)) ? 'flex' : 'none';
    
    // Only show "Rotate Week" button on Next Week tab, and show A/B Frequency dropdown only on Master tab
    document.getElementById('rotate-btn-wrapper').style.display = isNextWeekTab ? 'flex' : 'none';
    document.getElementById('new-frequency').style.display = isMasterTab ? 'inline-block' : 'none';

    if (isPlanningTab) {
        document.getElementById('planning-form-select').value = weekForms[currentTabName] || "A";
    }

    // Render Master Task List table if on Default Week tab
    if (isMasterTab) {
        renderDayCheckboxes();
        renderMasterTaskTable(container);
        return;
    }

    // --- MATRIX VIEW RENDERING (This Week, Next Week, 2 Weeks Out, Archive) ---
    const allowDragDrop = isPlanningTab || (isCurrentWeekTab && isEditMode);
    const allowTextEditing = isPlanningTab || (isCurrentWeekTab && isEditMode);
    const hideCompletionControls = isPlanningTab || (isCurrentWeekTab && isEditMode);

    // Determine which days are active for the current view
    const activeOperatingDays = isNextWeekTab ? nextWeekOperatingDays : 
                                (isWeek2Tab ? week2OperatingDays : allDays);

    // Count occurrences of each Section + Description pair to identify Daily Core Tasks
    const taskCounts = {};
    taskData.forEach(t => {
        const key = `${(t.Section || "").trim()}|${(t["Task Description"] || "").trim()}`;
        taskCounts[key] = (taskCounts[key] || 0) + 1;
    });

    const dailyMap = new Map();
    const weeklyTasks = [];

    taskData.forEach(t => {
        const desc = (t["Task Description"] || "").toString().trim();
        if (!desc) return;

        const key = `${(t.Section || "").trim()}|${desc}`;
        const schedType = getScheduleType(t);
        const isDaily = (schedType === "Daily") || (taskCounts[key] > 1);

        if (isDaily) {
            if (!dailyMap.has(key)) dailyMap.set(key, t);
        } else {
            weeklyTasks.push(t);
        }
    });

    const table = document.createElement('table');
    table.className = "matrix-table";

    // Build Table Header (Sun - Sat + Task Description)
    let headerHtml = `<thead><tr>`;
    allDays.forEach(day => {
        const isActive = isPlanningTab ? activeOperatingDays.includes(day) : true;
        headerHtml += `
            <th class="day-col-head ${!isActive ? 'grayed-out' : ''}">
                ${day}
                ${isPlanningTab ? `<br><button class="gray-btn" onclick="togglePlanDay('${day}')">${isActive ? 'Off' : 'On'}</button>` : ''}
            </th>
        `;
    });
    headerHtml += `<th>Task Description</th></tr></thead>`;

    let bodyHtml = `<tbody>`;

    // 1. DAILY CORE TASKS SECTION
    bodyHtml += `
        <tr class="section-divider-row">
            <td colspan="7">Daily Core Tasks</td>
            <td>General Center Tasks (Every Operating Day)</td>
        </tr>
    `;

    dailyMap.forEach((masterTask, key) => {
        const desc = masterTask["Task Description"];
        const section = masterTask.Section || "";
        bodyHtml += `<tr>`;
        
        allDays.forEach(day => {
            const isActive = isPlanningTab ? activeOperatingDays.includes(day) : true;
            
            // Match exact task entry for this day (case-insensitive)
            const dayEntry = taskData.find(t => 
                (t["Task Description"] || "").toString().trim().toLowerCase() === desc.trim().toLowerCase() && 
                (t.Section || "").toString().trim().toLowerCase() === section.trim().toLowerCase() &&
                (t.Day || "").toString().trim().toLowerCase() === day.trim().toLowerCase()
            );

            if (!isActive) {
                bodyHtml += `<td class="day-cell grayed-out"></td>`;
            } else if (!dayEntry) {
                bodyHtml += `<td class="day-cell blocked-cell"></td>`;
            } else if (hideCompletionControls) {
                bodyHtml += `<td class="day-cell"><span class="disabled-cell-dash">—</span></td>`;
            } else {
                const initialsVal = (dayEntry.Initials || "").toString().trim();
                const hasInitials = initialsVal.length > 0;
                bodyHtml += `
                    <td class="day-cell">
                        <div class="compact-cell-content">
                            <input type="text" class="cell-initials ${hasInitials ? 'has-initials' : ''}" 
                                   value="${initialsVal}" placeholder="—" maxlength="4" ${isArchiveTab ? 'disabled' : ''}
                                   onblur="handleAsyncInitials(${dayEntry.rowNum}, this.value)">
                        </div>
                    </td>
                `;
            }
        });

        // Task Description Cell (Inline Editable in Edit Mode / Planning Tabs)
        if (allowTextEditing) {
            bodyHtml += `
                <td class="task-desc-cell">
                    <div class="inline-edit-wrap">
                        <input type="text" class="edit-section-input" value="${section}" placeholder="Section"
                               onblur="handleDailyGroupEdit('${escapeQuotes(section)}', '${escapeQuotes(desc)}', this.value, '${escapeQuotes(desc)}')">
                        <input type="text" class="edit-cell-input" value="${desc}" 
                               onblur="handleDailyGroupEdit('${escapeQuotes(section)}', '${escapeQuotes(desc)}', '${escapeQuotes(section)}', this.value)">
                        <button class="action-btn danger-btn" title="Delete Daily Task" onclick="deleteDailyTaskGroup('${escapeQuotes(section)}', '${escapeQuotes(desc)}')">✕</button>
                    </div>
                </td>
            `;
        } else {
            bodyHtml += `<td class="task-desc-cell"><strong>${section ? section + ': ' : ''}</strong>${desc}</td>`;
        }
        
        bodyHtml += `</tr>`;
    });

    // 2. WEEKLY SCHEDULED TASKS SECTION
    bodyHtml += `
        <tr class="section-divider-row">
            <td colspan="7">Weekly Scheduled Tasks</td>
            <td>Specific Scheduled Day Tasks ${allowDragDrop ? '(Drag yellow cell to reassign day)' : ''}</td>
        </tr>
    `;

    weeklyTasks.forEach(task => {
        bodyHtml += `<tr>`;
        const taskDay = (task.Day || "").toString().trim().toLowerCase();
        const section = task.Section || "";
        const desc = task["Task Description"] || "";

        allDays.forEach(day => {
            const isActive = isPlanningTab ? activeOperatingDays.includes(day) : true;
            const isAssignedDay = taskDay === day.trim().toLowerCase();

            const dropAttributes = allowDragDrop ? `
                ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                ondragleave="this.classList.remove('drag-over');"
                ondrop="handleTaskDrop(event, ${task.rowNum}, '${day}')"
            ` : '';

            if (isAssignedDay && isActive) {
                const dragAttributes = allowDragDrop ? `
                    draggable="true" 
                    ondragstart="handleTaskDragStart(event, ${task.rowNum})"
                    class="day-cell active-weekly-cell draggable-cell"
                ` : `class="day-cell active-weekly-cell"`;

                if (hideCompletionControls) {
                    bodyHtml += `
                        <td ${dragAttributes} ${dropAttributes}>
                            <div class="compact-cell-content">
                                ${allowDragDrop ? '<span class="drag-handle" title="Drag to move day">⋮⋮</span>' : ''}
                                <span class="disabled-cell-dash">—</span>
                            </div>
                        </td>
                    `;
                } else {
                    const initialsVal = (task.Initials || "").toString().trim();
                    const hasInitials = initialsVal.length > 0;
                    bodyHtml += `
                        <td ${dragAttributes} ${dropAttributes}>
                            <div class="compact-cell-content">
                                <input type="text" class="cell-initials ${hasInitials ? 'has-initials' : ''}" 
                                       value="${initialsVal}" placeholder="—" maxlength="4" ${isArchiveTab ? 'disabled' : ''}
                                       onblur="handleAsyncInitials(${task.rowNum}, this.value)">
                            </div>
                        </td>
                    `;
                }
            } else {
                bodyHtml += `<td class="day-cell blocked-cell" ${dropAttributes}></td>`;
            }
        });

        if (allowTextEditing) {
            bodyHtml += `
                <td class="task-desc-cell">
                    <div class="inline-edit-wrap">
                        <input type="text" class="edit-section-input" value="${section}" placeholder="Section"
                               onblur="handleAsyncFieldEdit(${task.rowNum}, 'Section', 2, this.value)">
                        <input type="text" class="edit-cell-input" value="${desc}" 
                               onblur="handleAsyncFieldEdit(${task.rowNum}, 'Task Description', 3, this.value)">
                        <button class="action-btn danger-btn" title="Delete Task" onclick="deleteSingleTask(${task.rowNum})">✕</button>
                    </div>
                </td>
            `;
        } else {
            bodyHtml += `<td class="task-desc-cell"><strong>${section ? section + ': ' : ''}</strong>${desc}</td>`;
        }

        bodyHtml += `</tr>`;
    });

    bodyHtml += `</tbody>`;
    table.innerHTML = headerHtml + bodyHtml;
    container.appendChild(table);
}

/**
 * Renders the Master Task List ("Default Week") with A/B Frequency dropdowns and drag reordering.
 */
function renderMasterTaskTable(container) {
    if (taskData.length === 0) {
        container.innerHTML = "<div style='padding: 20px; text-align: center;'>No tasks found in Default Week. Use the bar above to add tasks.</div>";
        return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.style.height = "100%";
    tableWrapper.style.overflowY = "auto";

    let html = `
        <table class="matrix-table master-table">
            <thead>
                <tr>
                    <th style="width: 4%;"></th>
                    <th style="width: 18%;">Section</th>
                    <th style="width: 44%;">Task Description</th>
                    <th style="width: 12%;">Day / Daily</th>
                    <th style="width: 14%;">Week Form (A/B)</th>
                    <th style="width: 8%;">Delete</th>
                </tr>
            </thead>
            <tbody>
    `;

    taskData.forEach((task, index) => {
        const schedType = getScheduleType(task);
        const freq = getTaskFrequency(task);

        html += `
            <tr class="draggable-row" draggable="true" 
                ondragstart="handleMasterRowDragStart(event, ${index})"
                ondragover="event.preventDefault(); this.classList.add('drag-over-row');"
                ondragleave="this.classList.remove('drag-over-row');"
                ondrop="handleMasterRowDrop(event, ${index})">
                <td style="text-align: center;"><span class="row-drag-handle">⋮⋮</span></td>
                <td>
                    <input type="text" style="width:100%;" value="${task.Section || ''}" onblur="updateMasterTask(${task.rowNum}, 1, this.value)">
                </td>
                <td>
                    <input type="text" style="width:100%;" value="${task["Task Description"] || ''}" onblur="updateMasterTask(${task.rowNum}, 2, this.value)">
                </td>
                <td>
                    <select style="width:100%;" onchange="updateMasterTask(${task.rowNum}, 3, this.value)">
                        <option value="Daily" ${schedType === 'Daily' ? 'selected' : ''}>Daily</option>
                        ${allDays.map(d => `<option value="${d}" ${schedType === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select style="width:100%;" onchange="updateMasterTask(${task.rowNum}, 4, this.value)">
                        <option value="Every Week" ${freq === 'Every Week' ? 'selected' : ''}>Every Week</option>
                        <option value="Week A" ${freq === 'Week A' ? 'selected' : ''}>Week A</option>
                        <option value="Week B" ${freq === 'Week B' ? 'selected' : ''}>Week B</option>
                    </select>
                </td>
                <td style="text-align: center;">
                    <button class="action-btn danger-btn" onclick="deleteSingleTask(${task.rowNum})">✕</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    tableWrapper.innerHTML = html;
    container.appendChild(tableWrapper);
}

// ============================================================================
// 4. OPTIMISTIC ASYNC MUTATIONS & DRAG-AND-DROP HANDLERS
// ============================================================================

async function handleAsyncInitials(rowNum, initials) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && (item.Initials || "") !== initials) {
        pushUndoAction({ type: 'cell', rowNum, field: 'Initials', oldValue: item.Initials || "", colNum: 5, sheet: currentTabName });
        item.Initials = initials;
        const isDone = (initials && initials.trim().length > 0) ? "TRUE" : "FALSE";
        item['Done?'] = isDone;

        renderChecklist();
        await updateCellOnSheet(rowNum, 4, isDone, currentTabName);
        await updateCellOnSheet(rowNum, 5, initials, currentTabName);
    }
}

async function handleAsyncFieldEdit(rowNum, fieldName, colNum, newValue) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && (item[fieldName] || "") !== newValue) {
        pushUndoAction({ type: 'cell', rowNum, field: fieldName, oldValue: item[fieldName] || "", colNum, sheet: currentTabName });
        item[fieldName] = newValue;
        renderChecklist();
        await updateCellOnSheet(rowNum, colNum, newValue, currentTabName);
    }
}

/**
 * Updates Section and/or Description across all day rows of a Daily task simultaneously.
 */
async function handleDailyGroupEdit(oldSec, oldDesc, newSec, newDesc) {
    if (oldSec === newSec && oldDesc === newDesc) return;
    
    const matchingRows = taskData.filter(t => (t.Section || "") === oldSec && (t["Task Description"] || "") === oldDesc);
    matchingRows.forEach(r => {
        r.Section = newSec;
        r["Task Description"] = newDesc;
    });
    renderChecklist();

    for (const r of matchingRows) {
        if (oldSec !== newSec) await updateCellOnSheet(r.rowNum, 2, newSec, currentTabName);
        if (oldDesc !== newDesc) await updateCellOnSheet(r.rowNum, 3, newDesc, currentTabName);
    }
}

function handleTaskDragStart(event, rowNum) {
    event.dataTransfer.setData("text/plain", rowNum);
    event.dataTransfer.effectAllowed = "move";
}

async function handleTaskDrop(event, rowNum, newDay) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && item.Day !== newDay) {
        pushUndoAction({ type: 'day', rowNum, oldDay: item.Day, sheet: currentTabName });
        item.Day = newDay;
        renderChecklist(); 
        await updateCellOnSheet(rowNum, 1, newDay, currentTabName);
    }
}

// Master List Row Reordering
function handleMasterRowDragStart(event, index) {
    draggedRowIndex = index;
    event.dataTransfer.effectAllowed = "move";
}

async function handleMasterRowDrop(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over-row');
    if (draggedRowIndex === null || draggedRowIndex === targetIndex) return;

    const movedItem = taskData.splice(draggedRowIndex, 1)[0];
    taskData.splice(targetIndex, 0, movedItem);
    draggedRowIndex = null;
    renderChecklist();

    const payload = taskData.map(t => ({
        section: t.Section || "",
        desc: t["Task Description"] || "",
        schedule: getScheduleType(t),
        frequency: getTaskFrequency(t)
    }));

    await sendPost({ action: "reorderMasterTasks", tasks: payload });
}

// ============================================================================
// 5. WEEK CONTROLS, ADD/DELETE TASKS & ROTATION
// ============================================================================

async function saveWeekDate(dateText) {
    if (weekDates[currentTabName] === dateText) return;
    weekDates[currentTabName] = dateText;
    await sendPost({ action: "saveWeekDate", sheet: currentTabName, dateText: dateText });
}

async function togglePlanDay(day) {
    let targetArr = (currentTabName === "Week 2 Out") ? week2OperatingDays : nextWeekOperatingDays;
    if (targetArr.includes(day)) {
        targetArr = targetArr.filter(d => d !== day);
    } else {
        targetArr.push(day);
    }

    if (currentTabName === "Week 2 Out") week2OperatingDays = targetArr;
    else nextWeekOperatingDays = targetArr;

    renderChecklist();
    await sendPost({ action: "savePlanOperatingDays", sheet: currentTabName, days: targetArr });
}

function renderDayCheckboxes() {
    const boxContainer = document.getElementById('day-checkboxes');
    boxContainer.innerHTML = allDays.map(d => `
        <label><input type="checkbox" value="${d}" ${masterOperatingDays.includes(d) ? 'checked' : ''}> ${d}</label>
    `).join('');
}

async function saveOperatingDays() {
    const checked = Array.from(document.querySelectorAll('#day-checkboxes input:checked')).map(cb => cb.value);
    masterOperatingDays = checked;
    await sendPost({ action: "saveMasterOperatingDays", days: checked });
    alert("Default Operating Days saved!");
}

async function updateMasterTask(rowNum, colNum, value) {
    await updateCellOnSheet(rowNum, colNum, value, "Master Task List");
}

async function addNewTask() {
    const section = document.getElementById('new-section').value.trim();
    const desc = document.getElementById('new-desc').value.trim();
    const schedule = document.getElementById('new-schedule').value;
    const frequency = document.getElementById('new-frequency').value;
    
    if (!desc) { alert("Please enter a task description."); return; }

    document.getElementById('new-section').value = "";
    document.getElementById('new-desc').value = "";

    await sendPost({ 
        action: "addTask", 
        section: section, 
        desc: desc, 
        schedule: schedule,
        frequency: frequency,
        sheet: currentTabName
    });
    
    fetchTasks(currentTabName);
}

async function deleteSingleTask(rowNum) {
    if (!confirm("Delete this task?")) return;
    taskData = taskData.filter(t => t.rowNum != rowNum);
    renderChecklist();
    await sendPost({ action: "deleteTask", rowNum: rowNum, sheet: currentTabName });
    fetchTasks(currentTabName); // Refresh row numbers
}

async function deleteDailyTaskGroup(section, desc) {
    if (!confirm(`Delete "${desc}" from all days on this sheet?`)) return;
    taskData = taskData.filter(t => !((t.Section || "") === section && (t["Task Description"] || "") === desc));
    renderChecklist();
    await sendPost({ action: "deleteDailyTaskGroup", section: section, desc: desc, sheet: currentTabName });
    fetchTasks(currentTabName);
}

async function triggerSheetReset() {
    const chosenForm = document.getElementById('planning-form-select').value;
    if (!confirm(`Reset "${currentTabName}" using Default Week (Form ${chosenForm})?\n\nThis will replace current tasks on this tab.`)) return;

    document.getElementById('checklist-content').innerHTML = `<div style='padding:20px;text-align:center;'>Populating ${currentTabName} from Default Week (Form ${chosenForm})...</div>`;
    await sendPost({ action: "resetPlanningSheet", sheet: currentTabName, form: chosenForm });
    fetchTasks(currentTabName);
}

async function triggerWeekRotation() {
    if (!confirm("Rotate Weeks?\n\n• Archives 'This Week'\n• Moves 'Next Week' → 'This Week'\n• Moves '2 Weeks Out' → 'Next Week'\n• Auto-generates next alternating Form for '2 Weeks Out'")) return;
    if (!confirm("FINAL CONFIRMATION: Proceed with weekly rotation?")) return;

    document.getElementById('checklist-content').innerHTML = "<div style='padding:20px;text-align:center;'>Archiving and shifting 2-week schedule...</div>";

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "rotateWeek" })
        });
        const result = await response.json();
        
        if (result && result.status === "error") {
            alert("⚠️ ROTATION BLOCKED:\n\n" + result.message);
            fetchTasks(currentTabName);
            return;
        }

        alert("Schedule rotated successfully!");
        switchTab('Current Week', document.querySelectorAll('.nav-btn')[0]);
    } catch (error) {
        console.error("Rotation Error:", error);
        alert("Error rotating weeks. Verify Apps Script deployment.");
        fetchTasks(currentTabName);
    }
}

// ============================================================================
// 6. NETWORK HELPERS & TAB NAVIGATION
// ============================================================================

async function updateCellOnSheet(rowNum, colNum, value, sheet) {
    await sendPost({ action: "updateCell", rowNum, colNum, value, sheet });
}

async function sendPost(payloadObj) {
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadObj)
    });
}

function escapeQuotes(str) {
    return (str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function switchTab(tabName, btnElement) {
    currentTabName = tabName;
    undoStack = [];
    updateUndoButton();
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    fetchTasks(tabName);
}

// Initial load
fetchTasks("Current Week");
