// ============================================================================
// CENTER CLEANING CHECKLIST - FRONTEND CONTROLLER (SERIALIZED SYNC QUEUE)
// ============================================================================

const API_URL = "https://script.google.com/macros/s/AKfycbw2MMs_2yIHPeYBp0BdEM2Y5-DCjXzcPGCsYu2ri5WVDKEmc0SGS5-iVCNk7Q-jQkPxyw/exec"; 

// --- GLOBAL APPLICATION STATE ---
let currentTabName = "Current Week";
let allArchiveRows = [];
let selectedArchiveStamp = "";
let taskData = [];

let masterOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let nextWeekOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let week2OperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
const allDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];

let weekDates = { "Current Week": "", "Next Week": "", "Week 2 Out": "" };
let weekForms = { "Current Week": "A", "Next Week": "B", "Week 2 Out": "A" };

let isEditMode = false;
let undoStack = [];
let draggedRowIndex = null;

// --- SERIALIZED REQUEST QUEUE (PREVENTS RACE CONDITIONS & OVERWRITES) ---
let writeQueue = [];
let isProcessingQueue = false;
let masterSyncTimer = null;

function updateSyncIndicator() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    if (isProcessingQueue || writeQueue.length > 0 || masterSyncTimer !== null) {
        el.className = "sync-badge saving";
        el.innerText = `⏳ Saving (${writeQueue.length + (isProcessingQueue ? 1 : 0)})...`;
    } else {
        el.className = "sync-badge synced";
        el.innerText = "✓ Synced";
    }
}

/**
 * Enqueues a write payload so requests execute strictly sequentially (FIFO).
 * If a new 'syncMasterList' arrives while an older 'syncMasterList' is still waiting
 * in the queue, the older superseded snapshot is replaced so only the newest state writes.
 */
function enqueueWrite(payloadObj) {
    if (payloadObj.action === "syncMasterList") {
        writeQueue = writeQueue.filter(item => item.action !== "syncMasterList");
    }
    writeQueue.push(payloadObj);
    updateSyncIndicator();
    processWriteQueue();
}

async function processWriteQueue() {
    if (isProcessingQueue || writeQueue.length === 0) return;
    isProcessingQueue = true;
    updateSyncIndicator();

    while (writeQueue.length > 0) {
        const nextPayload = writeQueue.shift();
        updateSyncIndicator();
        try {
            await fetch(API_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(nextPayload)
            });
        } catch (err) {
            console.error("Queued write failed:", err);
        }
    }

    isProcessingQueue = false;
    updateSyncIndicator();
}

/**
 * Waits until all queued writes have finished before running a fresh GET fetch.
 */
async function waitForQueueFlush() {
    if (masterSyncTimer) {
        clearTimeout(masterSyncTimer);
        masterSyncTimer = null;
        flushMasterListNow();
    }
    while (isProcessingQueue || writeQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

// ============================================================================
// 1. DATA FETCHING & ARCHIVE FILTERING
// ============================================================================

async function fetchTasks(sheetName) {
    const contentEl = document.getElementById('checklist-content');
    contentEl.innerHTML = "<div style='padding:20px;text-align:center;font-weight:600;color:#475569;'>Loading checklist matrix...</div>";
    
    // Ensure any rapid edits just made finish saving before reading from Google Sheets
    await waitForQueueFlush();

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

function populateArchiveDropdown() {
    const selectEl = document.getElementById('archive-week-select');
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
    if (undoStack.length > 5) undoStack.shift();
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

function undoLastAction() {
    if (undoStack.length === 0) return;
    const action = undoStack.pop();
    updateUndoButton();

    const item = taskData.find(t => t.rowNum == action.rowNum);

    if (action.type === 'cell') {
        if (item) item[action.field] = action.oldValue;
        renderChecklist();
        enqueueWrite({ action: "updateCell", rowNum: action.rowNum, colNum: action.colNum, value: action.oldValue, sheet: action.sheet });
    } else if (action.type === 'day') {
        if (item) item.Day = action.oldDay;
        renderChecklist();
        enqueueWrite({ action: "updateCell", rowNum: action.rowNum, colNum: 1, value: action.oldDay, sheet: action.sheet });
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
    
    if (!isCurrentWeekTab && isEditMode) {
        isEditMode = false;
        const btn = document.getElementById('toggle-edit-btn');
        if (btn) {
            btn.innerText = "✏️ Edit Mode";
            btn.classList.remove('active-mode');
        }
    }

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

    document.getElementById('toggle-edit-btn').style.display = isCurrentWeekTab ? 'inline-block' : 'none';
    document.getElementById('archive-selector-container').style.display = isArchiveTab ? 'flex' : 'none';
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('planning-controls-container').style.display = isPlanningTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = (isMasterTab || isPlanningTab || (isCurrentWeekTab && isEditMode)) ? 'flex' : 'none';
    
    document.getElementById('rotate-btn-wrapper').style.display = isNextWeekTab ? 'flex' : 'none';
    document.getElementById('new-frequency').style.display = isMasterTab ? 'inline-block' : 'none';

    if (isPlanningTab) {
        document.getElementById('planning-form-select').value = weekForms[currentTabName] || "A";
    }

    if (isMasterTab) {
        renderDayCheckboxes();
        renderMasterTaskTable(container);
        return;
    }

    const allowDragDrop = isPlanningTab || (isCurrentWeekTab && isEditMode);
    const allowTextEditing = isPlanningTab || (isCurrentWeekTab && isEditMode);
    const hideCompletionControls = isPlanningTab || (isCurrentWeekTab && isEditMode);

    const activeOperatingDays = isNextWeekTab ? nextWeekOperatingDays : 
                                (isWeek2Tab ? week2OperatingDays : allDays);

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

        if (allowTextEditing) {
            bodyHtml += `
                <td class="task-desc-cell">
                    <div class="inline-edit-wrap">
                        <input type="text" class="edit-section-input" value="${escapeAttr(section)}" placeholder="Section"
                               onblur="handleDailyGroupEdit('${escapeQuotes(section)}', '${escapeQuotes(desc)}', this.value, '${escapeQuotes(desc)}')">
                        <input type="text" class="edit-cell-input" value="${escapeAttr(desc)}" 
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
                        <input type="text" class="edit-section-input" value="${escapeAttr(section)}" placeholder="Section"
                               onblur="handleAsyncFieldEdit(${task.rowNum}, 'Section', 2, this.value)">
                        <input type="text" class="edit-cell-input" value="${escapeAttr(desc)}" 
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
 * Renders the Master Task List ("Default Week") using array indices rather than
 * fragile rowNums so fast edits to Section, Description, Day, Frequency, and Order never collide.
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
                    <input type="text" style="width:100%;" value="${escapeAttr(task.Section || '')}" 
                           onchange="updateMasterField(${index}, 'Section', this.value)">
                </td>
                <td>
                    <input type="text" style="width:100%;" value="${escapeAttr(task["Task Description"] || '')}" 
                           onchange="updateMasterField(${index}, 'Task Description', this.value)">
                </td>
                <td>
                    <select style="width:100%;" onchange="updateMasterField(${index}, 'Schedule Type', this.value)">
                        <option value="Daily" ${schedType === 'Daily' ? 'selected' : ''}>Daily</option>
                        ${allDays.map(d => `<option value="${d}" ${schedType === d ? 'selected' : ''}>${d}</option>`).join('')}
                    </select>
                </td>
                <td>
                    <select style="width:100%;" onchange="updateMasterField(${index}, 'Frequency', this.value)">
                        <option value="Every Week" ${freq === 'Every Week' ? 'selected' : ''}>Every Week</option>
                        <option value="Week A" ${freq === 'Week A' ? 'selected' : ''}>Week A</option>
                        <option value="Week B" ${freq === 'Week B' ? 'selected' : ''}>Week B</option>
                    </select>
                </td>
                <td style="text-align: center;">
                    <button class="action-btn danger-btn" onclick="deleteMasterRow(${index})">✕</button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    tableWrapper.innerHTML = html;
    container.appendChild(tableWrapper);
}

// ============================================================================
// 4. ATOMIC MASTER LIST UPDATES & QUEUED MATRIX MUTATIONS
// ============================================================================

/**
 * Updates any field on the Master Task List in local memory immediately and schedules
 * a debounced full-table snapshot sync so rapid multi-field edits never overwrite each other.
 */
function updateMasterField(index, fieldName, newValue) {
    if (!taskData[index]) return;
    taskData[index][fieldName] = newValue;
    if (fieldName === "Schedule Type") {
        taskData[index].ScheduleType = newValue;
    }
    scheduleMasterListSync();
}

function deleteMasterRow(index) {
    if (!confirm("Delete this task from Default Week?")) return;
    taskData.splice(index, 1);
    renderChecklist();
    scheduleMasterListSync(true); // Flush immediately on delete
}

function handleMasterRowDragStart(event, index) {
    draggedRowIndex = index;
    event.dataTransfer.effectAllowed = "move";
}

function handleMasterRowDrop(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over-row');
    if (draggedRowIndex === null || draggedRowIndex === targetIndex) return;

    const movedItem = taskData.splice(draggedRowIndex, 1)[0];
    taskData.splice(targetIndex, 0, movedItem);
    draggedRowIndex = null;
    renderChecklist();
    scheduleMasterListSync(true); // Flush immediately on drop
}

/**
 * Coalesces rapid edits (e.g., typing section -> tabbing to description -> changing day -> changing A/B)
 * into a single clean sheet write 350ms after your last edit.
 */
function scheduleMasterListSync(immediate = false) {
    if (masterSyncTimer) {
        clearTimeout(masterSyncTimer);
        masterSyncTimer = null;
    }
    updateSyncIndicator();

    if (immediate) {
        flushMasterListNow();
    } else {
        masterSyncTimer = setTimeout(() => {
            masterSyncTimer = null;
            flushMasterListNow();
        }, 350);
    }
}

function flushMasterListNow() {
    const payload = taskData.map((t, idx) => {
        t.rowNum = idx + 2; // Keep local rowNums synchronized with sheet rows
        return {
            section: t.Section || "",
            desc: t["Task Description"] || "",
            schedule: getScheduleType(t) || "Daily",
            frequency: getTaskFrequency(t) || "Every Week"
        };
    });

    enqueueWrite({ action: "syncMasterList", tasks: payload });
}

// --- ACTIVE & PLANNING SHEET MUTATIONS (QUEUED FIFO) ---

function handleAsyncInitials(rowNum, initials) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && (item.Initials || "") !== initials) {
        pushUndoAction({ type: 'cell', rowNum, field: 'Initials', oldValue: item.Initials || "", colNum: 5, sheet: currentTabName });
        item.Initials = initials;
        const isDone = (initials && initials.trim().length > 0) ? "TRUE" : "FALSE";
        item['Done?'] = isDone;

        renderChecklist();
        // Send single atomic row update instead of two separate cell calls
        enqueueWrite({ 
            action: "updateFullRow", 
            sheet: currentTabName, 
            rowNum: rowNum, 
            values: [item.Day, item.Section || "", item["Task Description"] || "", isDone === "TRUE", initials, item.Timestamp || ""] 
        });
    }
}

function handleAsyncFieldEdit(rowNum, fieldName, colNum, newValue) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && (item[fieldName] || "") !== newValue) {
        pushUndoAction({ type: 'cell', rowNum, field: fieldName, oldValue: item[fieldName] || "", colNum, sheet: currentTabName });
        item[fieldName] = newValue;
        renderChecklist();
        enqueueWrite({ action: "updateCell", rowNum, colNum, value: newValue, sheet: currentTabName });
    }
}

function handleDailyGroupEdit(oldSec, oldDesc, newSec, newDesc) {
    if (oldSec === newSec && oldDesc === newDesc) return;
    
    const matchingRows = taskData.filter(t => (t.Section || "") === oldSec && (t["Task Description"] || "") === oldDesc);
    matchingRows.forEach(r => {
        r.Section = newSec;
        r["Task Description"] = newDesc;
        enqueueWrite({ 
            action: "updateFullRow", 
            sheet: currentTabName, 
            rowNum: r.rowNum, 
            values: [r.Day, newSec, newDesc, r["Done?"] === true || r["Done?"] === "TRUE", r.Initials || "", r.Timestamp || ""] 
        });
    });
    renderChecklist();
}

function handleTaskDragStart(event, rowNum) {
    event.dataTransfer.setData("text/plain", rowNum);
    event.dataTransfer.effectAllowed = "move";
}

function handleTaskDrop(event, rowNum, newDay) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && item.Day !== newDay) {
        pushUndoAction({ type: 'day', rowNum, oldDay: item.Day, sheet: currentTabName });
        item.Day = newDay;
        renderChecklist(); 
        enqueueWrite({ action: "updateCell", rowNum, colNum: 1, value: newDay, sheet: currentTabName });
    }
}

// ============================================================================
// 5. WEEK CONTROLS, ADD/DELETE TASKS & ROTATION
// ============================================================================

function saveWeekDate(dateText) {
    if (weekDates[currentTabName] === dateText) return;
    weekDates[currentTabName] = dateText;
    enqueueWrite({ action: "saveWeekDate", sheet: currentTabName, dateText: dateText });
}

function togglePlanDay(day) {
    let targetArr = (currentTabName === "Week 2 Out") ? week2OperatingDays : nextWeekOperatingDays;
    if (targetArr.includes(day)) {
        targetArr = targetArr.filter(d => d !== day);
    } else {
        targetArr.push(day);
    }

    if (currentTabName === "Week 2 Out") week2OperatingDays = targetArr;
    else nextWeekOperatingDays = targetArr;

    renderChecklist();
    enqueueWrite({ action: "savePlanOperatingDays", sheet: currentTabName, days: targetArr });
}

function renderDayCheckboxes() {
    const boxContainer = document.getElementById('day-checkboxes');
    boxContainer.innerHTML = allDays.map(d => `
        <label><input type="checkbox" value="${d}" ${masterOperatingDays.includes(d) ? 'checked' : ''}> ${d}</label>
    `).join('');
}

function saveOperatingDays() {
    const checked = Array.from(document.querySelectorAll('#day-checkboxes input:checked')).map(cb => cb.value);
    masterOperatingDays = checked;
    enqueueWrite({ action: "saveMasterOperatingDays", days: checked });
    alert("Default Operating Days queued to save!");
}

async function addNewTask() {
    const section = document.getElementById('new-section').value.trim();
    const desc = document.getElementById('new-desc').value.trim();
    const schedule = document.getElementById('new-schedule').value;
    const frequency = document.getElementById('new-frequency').value;
    
    if (!desc) { alert("Please enter a task description."); return; }

    document.getElementById('new-section').value = "";
    document.getElementById('new-desc').value = "";

    // If on Master List, append locally and sync full list cleanly
    if (currentTabName === "Master Task List") {
        taskData.push({
            Section: section,
            "Task Description": desc,
            "Schedule Type": schedule,
            Frequency: frequency,
            rowNum: taskData.length + 2
        });
        renderChecklist();
        scheduleMasterListSync(true);
        return;
    }

    enqueueWrite({ 
        action: "addTask", 
        section: section, 
        desc: desc, 
        schedule: schedule,
        frequency: frequency,
        sheet: currentTabName
    });
    
    await fetchTasks(currentTabName);
}

async function deleteSingleTask(rowNum) {
    if (!confirm("Delete this task?")) return;
    taskData = taskData.filter(t => t.rowNum != rowNum);
    renderChecklist();
    enqueueWrite({ action: "deleteTask", rowNum: rowNum, sheet: currentTabName });
    await fetchTasks(currentTabName);
}

async function deleteDailyTaskGroup(section, desc) {
    if (!confirm(`Delete "${desc}" from all days on this sheet?`)) return;
    taskData = taskData.filter(t => !((t.Section || "") === section && (t["Task Description"] || "") === desc));
    renderChecklist();
    enqueueWrite({ action: "deleteDailyTaskGroup", section: section, desc: desc, sheet: currentTabName });
    await fetchTasks(currentTabName);
}

async function triggerSheetReset() {
    const chosenForm = document.getElementById('planning-form-select').value;
    if (!confirm(`Reset "${currentTabName}" using Default Week (Form ${chosenForm})?\n\nThis will replace current tasks on this tab.`)) return;

    document.getElementById('checklist-content').innerHTML = `<div style='padding:20px;text-align:center;'>Populating ${currentTabName} from Default Week (Form ${chosenForm})...</div>`;
    enqueueWrite({ action: "resetPlanningSheet", sheet: currentTabName, form: chosenForm });
    await fetchTasks(currentTabName);
}

async function triggerWeekRotation() {
    if (!confirm("Rotate Weeks?\n\n• Archives 'This Week'\n• Moves 'Next Week' → 'This Week'\n• Moves '2 Weeks Out' → 'Next Week'\n• Auto-generates next alternating Form for '2 Weeks Out'")) return;
    if (!confirm("FINAL CONFIRMATION: Proceed with weekly rotation?")) return;

    document.getElementById('checklist-content').innerHTML = "<div style='padding:20px;text-align:center;'>Archiving and shifting 2-week schedule...</div>";
    await waitForQueueFlush();

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
// 6. ESCAPING & TAB NAVIGATION
// ============================================================================

function escapeQuotes(str) {
    return (str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function escapeAttr(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
