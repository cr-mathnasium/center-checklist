const API_URL = "https://script.google.com/macros/s/AKfycbzvM_pS8wcU5ViZnu-mMfsO4656FCU_5-PtEb9BeV3gxS0vXB45GxFMb2tBjzIejcO8aw/exec"; 

let currentTabName = "Current Week";
let taskData = [];
let masterOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
let nextWeekOperatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
const allDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];

async function fetchTasks(sheetName) {
    document.getElementById('checklist-content').innerHTML = "<div style='padding:15px;text-align:center;'>Loading checklist matrix...</div>";
    try {
        const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheetName)}`);
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
        
        renderChecklist();
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('checklist-content').innerHTML = "<div style='padding:15px;color:red;'>Error loading data. Verify deployment setup.</div>";
    }
}

function getScheduleType(task) {
    return task.ScheduleType || task["Schedule Type"] || task["ScheduleType"] || "";
}

function renderChecklist() {
    const container = document.getElementById('checklist-content');
    container.innerHTML = "";

    const isMasterTab = currentTabName === 'Master Task List';
    const isNextWeekTab = currentTabName === 'Next Week';
    const isArchiveTab = currentTabName === 'Archive Log';
    
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = (isMasterTab || isNextWeekTab) ? 'flex' : 'none';
    document.getElementById('rotate-week-container').style.display = isNextWeekTab ? 'flex' : 'none';

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

        if (taskCounts[desc] > 1) {
            if (!dailyMap.has(desc)) dailyMap.set(desc, t);
        } else {
            weeklyTasks.push(t);
        }
    });

    const table = document.createElement('table');
    table.className = "matrix-table";

    // Build Table Header
    let headerHtml = `
        <thead>
            <tr>
    `;
    
    allDays.forEach(day => {
        const isActive = isNextWeekTab ? nextWeekOperatingDays.includes(day) : true;
        headerHtml += `
            <th class="day-col-head ${!isActive ? 'grayed-out' : ''}">
                ${day}
                ${isNextWeekTab ? `<br><button class="gray-btn" onclick="toggleNextWeekDay('${day}')">${isActive ? 'Gray' : 'On'}</button>` : ''}
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
            const dayEntry = taskData.find(t => t["Task Description"] === desc && t.Day === day);

            if (!dayEntry || !isActive) {
                bodyHtml += `<td class="day-cell grayed-out"></td>`;
            } else {
                const isChecked = dayEntry["Done?"] === true || dayEntry["Done?"] === "TRUE";
                bodyHtml += `
                    <td class="day-cell">
                        <input type="checkbox" class="cell-checkbox" ${isChecked ? 'checked' : ''} ${isArchiveTab ? 'disabled' : ''}
                               onchange="toggleCheck(${dayEntry.rowNum}, this.checked)">
                        <input type="text" class="cell-initials" value="${dayEntry.Initials || ''}" placeholder="Init" ${isArchiveTab ? 'disabled' : ''}
                               onblur="updateInitials(${dayEntry.rowNum}, this.value)">
                    </td>
                `;
            }
        });

        bodyHtml += `<td class="task-desc-cell"><strong>${masterTask.Section ? masterTask.Section + ': ' : ''}</strong>${desc}</td>`;
        bodyHtml += `</tr>`;
    });

    // 2. Weekly Scheduled Tasks Section (with Drag & Drop Matrix Cells)
    bodyHtml += `
        <tr class="section-divider-row">
            <td colspan="7">Weekly Scheduled Tasks</td>
            <td>Specific Scheduled Day Tasks ${isNextWeekTab ? '(Drag & Drop to reassign days)' : ''}</td>
        </tr>
    `;

    weeklyTasks.forEach(task => {
        bodyHtml += `<tr>`;
        const taskDay = task.Day;

        allDays.forEach(day => {
            const isActive = isNextWeekTab ? nextWeekOperatingDays.includes(day) : true;

            // Make every cell in Next Week a valid Drop Zone
            const dropAttributes = isNextWeekTab ? `
                ondragover="event.preventDefault(); this.classList.add('drag-over');" 
                ondragleave="this.classList.remove('drag-over');"
                ondrop="handleTaskDrop(event, ${task.rowNum}, '${day}')"
            ` : '';

            if (day === taskDay && isActive) {
                const isChecked = task["Done?"] === true || task["Done?"] === "TRUE";
                
                const dragAttributes = isNextWeekTab ? `
                    draggable="true" 
                    ondragstart="handleTaskDragStart(event, ${task.rowNum})"
                    class="day-cell active-weekly-cell draggable-cell"
                ` : `class="day-cell active-weekly-cell"`;

                bodyHtml += `
                    <td ${dragAttributes} ${dropAttributes}>
                        ${isNextWeekTab ? '<span class="drag-handle" title="Drag to move day">⋮⋮</span>' : ''}
                        <input type="checkbox" class="cell-checkbox" ${isChecked ? 'checked' : ''} ${isArchiveTab ? 'disabled' : ''}
                               onchange="toggleCheck(${task.rowNum}, this.checked)">
                        <input type="text" class="cell-initials" value="${task.Initials || ''}" placeholder="Init" ${isArchiveTab ? 'disabled' : ''}
                               onblur="updateInitials(${task.rowNum}, this.value)">
                    </td>
                `;
            } else {
                bodyHtml += `<td class="day-cell blocked-cell" ${dropAttributes}></td>`;
            }
        });

        bodyHtml += `<td class="task-desc-cell"><strong>${task.Section ? task.Section + ': ' : ''}</strong>${task["Task Description"]}</td>`;
        bodyHtml += `</tr>`;
    });

    bodyHtml += `</tbody>`;
    table.innerHTML = headerHtml + bodyHtml;
    container.appendChild(table);
}

// Drag & Drop Handlers for Next Week Matrix
function handleTaskDragStart(event, rowNum) {
    event.dataTransfer.setData("text/plain", rowNum);
    event.dataTransfer.effectAllowed = "move";
}

async function handleTaskDrop(event, rowNum, newDay) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item && item.Day !== newDay) {
        item.Day = newDay;
        await updateCellOnSheet(rowNum, 1, newDay, "Next Week");
        renderChecklist();
    }
}

async function triggerWeekRotation() {
    const confirm1 = confirm("Are you sure you want to rotate the weeks?\n\nThis will:\n1. Move completed 'This Week' tasks into 'Last Week' (Archive).\n2. Promote 'Next Week' into 'This Week'.\n3. Reset 'Next Week' from Default Week.");
    if (!confirm1) return;

    const confirm2 = confirm("FINAL CONFIRMATION:\n\nAre you completely sure? This action will overwrite the current active week and cannot be undone.");
    if (!confirm2) return;

    document.getElementById('checklist-content').innerHTML = "<div style='padding:20px;text-align:center;'>Rotating week and updating database...</div>";

    try {
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "rotateWeek" })
        });
        
        alert("Week successfully rotated! Loading new Current Week...");
        switchTab('Current Week', document.querySelectorAll('.nav-btn')[0]);
    } catch (error) {
        alert("Error performing rotation. Check deployment settings.");
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

function renderMasterTaskTable(container) {
    if (taskData.length === 0) {
        container.innerHTML = "<div style='padding: 20px; text-align: center;'>No tasks found in Default Week. Add a task above or run database setup script.</div>";
        return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.style.height = "100%";
    tableWrapper.style.overflowY = "auto";

    let html = `
        <table class="matrix-table">
            <thead>
                <tr>
                    <th style="width: 20%;">Section</th>
                    <th style="width: 50%;">Task Description</th>
                    <th style="width: 20%;">Schedule Type</th>
                    <th style="width: 10%;">Action</th>
                </tr>
            </thead>
            <tbody>
    `;

    taskData.forEach(task => {
        const schedType = getScheduleType(task);

        html += `
            <tr>
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
    
    const targetSheet = (currentTabName === 'Next Week') ? "Next Week" : "Master Task List";

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

async function toggleCheck(rowNum, isChecked) {
    updateCellOnSheet(rowNum, 4, isChecked ? "TRUE" : "FALSE", currentTabName);
}

async function updateInitials(rowNum, initials) {
    updateCellOnSheet(rowNum, 5, initials, currentTabName);
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
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    fetchTasks(tabName);
}

fetchTasks("Current Week");
