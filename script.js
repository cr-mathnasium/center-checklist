const API_URL = "https://script.google.com/macros/s/AKfycbwAZv62fLT6EQ6VNI85DK1RI2lSLkSX-cNk-W3GVcBMLoBf9M5CS8SczY6fG1HHjwTIxA/exec"; 

let currentTabName = "Current Week";
let selectedArchiveWeek = "1";
let taskData = [];
let masterOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let nextWeekOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
const allDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];

let isEditMode = false;
let undoStack = [];
let draggedRowIndex = null;

async function fetchTasks(sheetName) {
    document.getElementById('checklist-content').innerHTML = "<div style='padding:15px;text-align:center;'>Loading checklist matrix...</div>";
    
    const targetBackendSheet = (sheetName.startsWith("Archive Log")) ? "Archive Log" : sheetName;

    try {
        const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(targetBackendSheet)}`);
        const json = await response.json();
        
        if (json && json.masterOperatingDays) {
            masterOperatingDays = json.masterOperatingDays;
            nextWeekOperatingDays = json.nextWeekOperatingDays || json.masterOperatingDays;
            taskData = Array.isArray(json.tasks) ? json.tasks : [];
        } else if (Array.isArray(json)) {
            taskData = json;
        } else {
            taskData = [];
        }

        if (sheetName.startsWith("Archive Log")) {
            filterArchiveDataByWeek();
        }
        
        renderChecklist();
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('checklist-content').innerHTML = "<div style='padding:15px;color:red;'>Error loading data. Verify deployment setup.</div>";
    }
}

function filterArchiveDataByWeek() {
    if (taskData.length === 0) return;

    const timestamps = [...new Set(taskData.map(t => t.Timestamp))].filter(Boolean);
    if (timestamps.length === 0) return;

    let targetTimestamp = timestamps[0];
    if (selectedArchiveWeek === "2" && timestamps.length > 1) {
        targetTimestamp = timestamps[1];
    }

    taskData = taskData.filter(t => t.Timestamp === targetTimestamp);
}

function changeArchiveWeek(weekVal) {
    selectedArchiveWeek = weekVal;
    fetchTasks("Archive Log");
}

function getScheduleType(task) {
    return task.ScheduleType || task["Schedule Type"] || task["ScheduleType"] || "";
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

function renderChecklist() {
    const container = document.getElementById('checklist-content');
    container.innerHTML = "";

    const isMasterTab = currentTabName === 'Master Task List';
    const isNextWeekTab = currentTabName === 'Next Week';
    const isCurrentWeekTab = currentTabName === 'Current Week';
    const isArchiveTab = currentTabName.startsWith('Archive Log');
    
    if (!isCurrentWeekTab && isEditMode) {
        isEditMode = false;
        const btn = document.getElementById('toggle-edit-btn');
        if (btn) {
            btn.innerText = "✏️ Edit Mode";
            btn.classList.remove('active-mode');
        }
    }

    document.getElementById('toggle-edit-btn').style.display = isCurrentWeekTab ? 'inline-block' : 'none';
    document.getElementById('archive-selector-container').style.display = isArchiveTab ? 'flex' : 'none';
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = (isMasterTab || isNextWeekTab || (isCurrentWeekTab && isEditMode)) ? 'flex' : 'none';
    document.getElementById('rotate-week-container').style.display = isNextWeekTab ? 'flex' : 'none';

    const allowDragDrop = isNextWeekTab || (isCurrentWeekTab && isEditMode);
    const allowTextEditing = isNextWeekTab || (isCurrentWeekTab && isEditMode);
    const hideCompletionControls = isNextWeekTab || (isCurrentWeekTab && isEditMode);

    if (isMasterTab) {
        renderDayCheckboxes();
        renderMasterTaskTable(container);
        return;
    }

    const taskCounts = {};
    taskData.forEach(t => {
        const desc = t["Task Description"];
        if (desc) taskCounts[desc] = (taskCounts[desc] || 0) + 1;
    });

    const dailyMap = new Map();
    const weeklyTasks = [];

    taskData.forEach(t => {
        const desc = t["Task Description"];
        if (!desc) return;

        const schedType = getScheduleType(t);
        const isDaily = (schedType === "Daily") || (taskCounts[desc] > 1);

        if (isDaily) {
            if (!dailyMap.has(desc)) dailyMap.set(desc, t);
        } else {
            weeklyTasks.push(t);
        }
    });

    const table = document.createElement('table');
    table.className = "matrix-table";

    let headerHtml = `
        <thead>
            <tr>
    `;
    
    allDays.forEach(day => {
        // Ensure Sun through Sat are active for Archive and Current Week
        const isActive = isNextWeekTab ? nextWeekOperatingDays.includes(day) : true;
        headerHtml += `
            <th class="day-col-head ${!isActive ? 'grayed-out' : ''}">
                ${day}
                ${isNextWeekTab ? `<br><button class="gray-btn" onclick="toggleNextWeekDay('${day}')">${isActive ? 'Off' : 'On'}</button>` : ''}
            </th>
        `;
    });

    headerHtml += `
                <th>Task Description</th>
            </tr>
        </thead>
    `;

    let bodyHtml = `<tbody>`;

    // 1. Daily Core Tasks Section
    bodyHtml += `
        <tr class="section-divider-row">
            <td colspan="7">Daily Core Tasks</td>
            <td>General Center Tasks (Every Operating Day)</td>
        </tr>
    `;

    dailyMap.forEach((masterTask, desc) => {
        bodyHtml += `<tr>`;
        
        allDays.forEach(day => {
            const isActive = isNextWeekTab ? nextWeekOperatingDays.includes(day) : true;
            
            // Robust day matching: normalize string comparisons (case-insensitive)
            const dayEntry = taskData.find(t => 
                (t["Task Description"] || "").trim().toLowerCase() === desc.trim().toLowerCase() && 
                (t.Day || "").trim().toLowerCase() === day.trim().toLowerCase()
            );

            if (!isActive) {
                bodyHtml += `<td class="day-cell grayed-out"></td>`;
            } else if (!dayEntry) {
                bodyHtml += `<td class="day-cell blocked-cell"></td>`;
            } else {
                if (hideCompletionControls) {
                    bodyHtml += `<td class="day-cell"><span class="disabled-cell-dash">—</span></td>`;
                } else {
                    const initialsVal = (dayEntry.Initials || "").toString().trim();
                    const hasInitials = initialsVal.length > 0;
                    bodyHtml += `
                        <td class="day-cell">
                            <div class="compact-cell-content">
                                <input type="text" class="cell-initials ${hasInitials ? 'has-initials' : ''}" 
                                       value="${initialsVal}" placeholder="Init" maxlength="3" ${isArchiveTab ? 'disabled' : ''}
                                       onblur="handleAsyncInitials(${dayEntry.rowNum}, this.value)">
                            </div>
                        </td>
                    `;
                }
            }
        });

        const rowItem = dailyMap.get(desc);
        if (allowTextEditing && rowItem) {
            bodyHtml += `
                <td class="task-desc-cell">
                    <input type="text" class="edit-cell-input" value="${desc}" onblur="handleAsyncDescEdit(${rowItem.rowNum}, this.value)">
                </td>
            `;
        } else {
            bodyHtml += `<td class="task-desc-cell"><strong>${masterTask.Section ? masterTask.Section + ': ' : ''}</strong>${desc}</td>`;
        }
        
        bodyHtml += `</tr>`;
    });

    // 2. Weekly Scheduled Tasks Section
    bodyHtml += `
        <tr class="section-divider-row">
            <td colspan="7">Weekly Scheduled Tasks</td>
            <td>Specific Scheduled Day Tasks ${allowDragDrop ? '(Drag cell to reassign day)' : ''}</td>
        </tr>
    `;

    weeklyTasks.forEach(task => {
        bodyHtml += `<tr>`;
        const taskDay = (task.Day || "").trim().toLowerCase();

        allDays.forEach(day => {
            const isActive = isNextWeekTab ? nextWeekOperatingDays.includes(day) : true;
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
                                ${allowDragDrop ? '<span class="drag-handle" title="Drag to move day">⋮⋮</span>' : ''}
                                <input type="text" class="cell-initials ${hasInitials ? 'has-initials' : ''}" 
                                       value="${initialsVal}" placeholder="Init" maxlength="3" ${isArchiveTab ? 'disabled' : ''}
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
                    <input type="text" class="edit-cell-input" value="${task["Task Description"]}" onblur="handleAsyncDescEdit(${task.rowNum}, this.value)">
                </td>
            `;
        } else {
            bodyHtml += `<td class="task-desc-cell"><strong>${task.Section ? task.Section + ': ' : ''}</strong>${task["Task Description"]}</td>`;
        }

        bodyHtml += `</tr>`;
    });

    bodyHtml += `</tbody>`;
    table.innerHTML = headerHtml + bodyHtml;
    container.appendChild(table);
}

function renderMasterTaskTable(container) {
    if (taskData.length === 0) {
        container.innerHTML = "<div style='padding: 20px; text-align: center;'>No tasks found in Default Week. Add a task above or run database setup script.</div>";
        return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.style.height = "100%";
    tableWrapper.style.overflowY = "auto";

    let html = `
        <table class="matrix-table master-table">
            <thead>
                <tr>
                    <th style="width: 5%;"></th>
                    <th style="width: 20%;">Section</th>
                    <th style="width: 50%;">Task Description</th>
                    <th style="width: 15%;">Schedule Type</th>
                    <th style="width: 10%;">Action</th>
                </tr>
            </thead>
            <tbody id="master-task-tbody">
    `;

    taskData.forEach((task, index) => {
        const schedType = getScheduleType(task);

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
                <td style="text-align: center;">
                    <button class="action-btn danger-btn" onclick="deleteMasterTask(${task.rowNum})">Delete</button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    tableWrapper.innerHTML = html;
    container.appendChild(tableWrapper);
}

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
    await syncMasterTaskOrder();
}

async function syncMasterTaskOrder() {
    const payload = taskData.map(t => ({
        section: t.Section || "",
        desc: t["Task Description"] || "",
        schedule: getScheduleType(t)
    }));

    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reorderMasterTasks", tasks: payload })
    });
}

async function handleAsyncInitials(rowNum, initials) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && item.Initials !== initials) {
        pushUndoAction({ type: 'cell', rowNum, field: 'Initials', oldValue: item.Initials, colNum: 5, sheet: currentTabName });
        item.Initials = initials;
        
        const isDone = (initials && initials.trim().length > 0) ? "TRUE" : "FALSE";
        item['Done?'] = isDone;

        renderChecklist();
        
        await updateCellOnSheet(rowNum, 4, isDone, currentTabName);
        await updateCellOnSheet(rowNum, 5, initials, currentTabName);
    }
}

async function handleAsyncDescEdit(rowNum, newDesc) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && item["Task Description"] !== newDesc) {
        pushUndoAction({ type: 'cell', rowNum, field: 'Task Description', oldValue: item["Task Description"], colNum: 3, sheet: currentTabName });
        item["Task Description"] = newDesc;
        renderChecklist();
        await updateCellOnSheet(rowNum, 3, newDesc, currentTabName);
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

async function triggerWeekRotation() {
    const confirm1 = confirm("Are you sure you want to rotate the weeks?\n\nThis will:\n1. Move completed 'This Week' tasks into 'Last Week' (Archive).\n2. Promote 'Next Week' into 'This Week'.\n3. Reset 'Next Week' from Default Week.");
    if (!confirm1) return;

    const confirm2 = confirm("FINAL CONFIRMATION:\n\nAre you completely sure? This action will overwrite the current active week and cannot be undone.");
    if (!confirm2) return;

    document.getElementById('checklist-content').innerHTML = "<div style='padding:20px;text-align:center;'>Rotating week and updating database...</div>";

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "rotateWeek" })
        });
        
        const result = await response.json();
        
        if (result && result.status === "error") {
            alert("⚠️ ROTATION BLOCKED:\n\n" + result.message);
            fetchTasks("Next Week");
            return;
        }

        alert("Week successfully rotated! Loading new Current Week...");
        switchTab('Current Week', document.querySelectorAll('.nav-btn')[0]);
    } catch (error) {
        console.error("Rotation error:", error);
        alert("Error performing rotation. Verify Apps Script deployment.");
        fetchTasks("Next Week");
    }
}

async function toggleNextWeekDay(day) {
    if (nextWeekOperatingDays.includes(day)) {
        nextWeekOperatingDays = nextWeekOperatingDays.filter(d => d !== day);
    } else {
        nextWeekOperatingDays.push(day);
    }
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveNextWeekOperatingDays", days: nextWeekOperatingDays })
    });
    renderChecklist();
}

function renderDayCheckboxes() {
    const boxContainer = document.getElementById('day-checkboxes');
    boxContainer.innerHTML = allDays.map(d => `
        <label>
            <input type="checkbox" value="${d}" ${masterOperatingDays.includes(d) ? 'checked' : ''}> ${d}
        </label>
    `).join('');
}

async function saveOperatingDays() {
    const checked = Array.from(document.querySelectorAll('#day-checkboxes input:checked')).map(cb => cb.value);
    masterOperatingDays = checked;
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveMasterOperatingDays", days: checked })
    });
    alert("Master Operating Days updated!");
    renderChecklist();
}

async function updateMasterTask(rowNum, colNum, value) {
    await updateCellOnSheet(rowNum, colNum, value, "Master Task List");
}

async function addNewTask() {
    const section = document.getElementById('new-section').value;
    const desc = document.getElementById('new-desc').value;
    const schedule = document.getElementById('new-schedule').value;
    
    if (!desc) { alert("Please enter a task description."); return; }
    
    const targetSheet = (currentTabName === 'Next Week') ? "Next Week" : (currentTabName === 'Current Week' ? "Current Week" : "Master Task List");

    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            action: "addTask", 
            section: section, 
            desc: desc, 
            schedule: schedule,
            sheet: targetSheet
        })
    });
    
    document.getElementById('new-section').value = "";
    document.getElementById('new-desc').value = "";
    fetchTasks(targetSheet);
}

async function deleteMasterTask(rowNum) {
    if (confirm("Delete this task from Default Week?")) {
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deleteTask", rowNum })
        });
        fetchTasks("Master Task List");
    }
}

async function updateCellOnSheet(rowNum, colNum, value, sheet) {
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateCell", rowNum, colNum, value, sheet })
    });
}

function switchTab(tabName, btnElement) {
    currentTabName = tabName;
    undoStack = [];
    updateUndoButton();
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    fetchTasks(tabName);
}

fetchTasks("Current Week");
