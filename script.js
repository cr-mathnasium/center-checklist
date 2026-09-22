const API_URL = "https://script.google.com/macros/s/AKfycbzH3Nv579kC_f5w-YXXYmOizZuiSeqWXLU4BEcKYOC1cXNsm0L8epJgX5_HPxsvEIML/exec"; 

let currentTabName = "Current Week";
let taskData = [];
let operatingDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Sat"];
const allDays = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];

async function fetchTasks(sheetName) {
    document.getElementById('checklist-content').innerHTML = "Loading tasks from center database...";
    try {
        const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheetName)}`);
        const json = await response.json();
        
        if (json && json.operatingDays) {
            operatingDays = json.operatingDays;
            taskData = Array.isArray(json.tasks) ? json.tasks : [];
        } else if (Array.isArray(json)) {
            taskData = json;
        } else if (json && Array.isArray(json.tasks)) {
            taskData = json.tasks;
        } else {
            taskData = [];
        }
        
        renderChecklist();
    } catch (error) {
        console.error("Fetch Error:", error);
        document.getElementById('checklist-content').innerHTML = "Error loading data. Verify deployment setup or run setup script.";
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
    
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = isMasterTab ? 'flex' : 'none';

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

    allDays.forEach(day => {
        const dayTasks = taskData.filter(t => t.Day === day);

        if (dayTasks.length === 0 && !isNextWeekTab) return;

        const daySection = document.createElement('div');
        daySection.className = "day-section" + (!operatingDays.includes(day) && !isNextWeekTab ? " grayed-out" : "");
        daySection.id = `section-${day}`;

        const header = document.createElement('div');
        header.className = "day-header";
        header.innerHTML = `<span>${day} Tasks ${!operatingDays.includes(day) && !isNextWeekTab ? '(Non-Operating)' : ''}</span>`;

        if (isNextWeekTab) {
            const grayBtn = document.createElement('button');
            grayBtn.className = "gray-btn";
            grayBtn.innerText = "Gray Out / Activate Day";
            grayBtn.onclick = () => {
                const sec = document.getElementById(`section-${day}`);
                sec.classList.toggle('hidden-day');
            };
            header.appendChild(grayBtn);
        }

        const taskListContainer = document.createElement('div');
        taskListContainer.className = "dropzone";
        taskListContainer.dataset.day = day;

        dayTasks.forEach(task => {
            const schedType = getScheduleType(task);
            let isDaily = taskCounts[task["Task Description"]] > 1;
            
            const row = document.createElement('div');
            row.className = `task-row ${isDaily ? 'is-daily' : 'is-weekly'}`;

            const isChecked = task["Done?"] === true || task["Done?"] === "TRUE";

            let actionControlsHtml = "";
            if (isNextWeekTab) {
                if (isDaily) {
                    // Daily tasks cannot be moved in Next Week
                    actionControlsHtml = `
                        <div>
                            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCheck(${task.rowNum}, this.checked)">
                        </div>
                    `;
                } else {
                    // Weekly tasks feature day dropdown selector
                    actionControlsHtml = `
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <select class="day-select" onchange="reassignTaskDay(${task.rowNum}, this.value)">
                                ${allDays.map(d => `<option value="${d}" ${d === day ? 'selected' : ''}>${d}</option>`).join('')}
                            </select>
                            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCheck(${task.rowNum}, this.checked)">
                        </div>
                    `;
                }
            } else {
                actionControlsHtml = `
                    <div>
                        <input type="checkbox" ${isChecked ? 'checked' : ''} 
                               ${(currentTabName === 'Archive Log') ? 'disabled' : ''}
                               onchange="toggleCheck(${task.rowNum}, this.checked)">
                    </div>
                `;
            }

            row.innerHTML = `
                <div>
                    <div class="task-section-label">${task.Section || schedType || ''}</div>
                    <span class="task-type-badge ${isDaily ? 'badge-daily' : 'badge-weekly'}">
                        ${isDaily ? 'Daily' : 'Weekly'}
                    </span>
                </div>
                <div class="task-desc">${task["Task Description"] || ''}</div>
                ${actionControlsHtml}
                <div>
                    <input type="text" class="initials-input" value="${task.Initials || ''}" placeholder="Initials"
                           ${(currentTabName === 'Archive Log') ? 'disabled' : ''}
                           onblur="updateInitials(${task.rowNum}, this.value)">
                </div>
            `;

            taskListContainer.appendChild(row);
        });

        daySection.appendChild(header);
        daySection.appendChild(taskListContainer);
        container.appendChild(daySection);
    });
}

async function reassignTaskDay(rowNum, newDay) {
    const item = taskData.find(t => t.rowNum == rowNum);
    if (item) {
        item.Day = newDay;
        await updateCellOnSheet(rowNum, 1, newDay, "Next Week");
        renderChecklist();
    }
}

function renderMasterTaskTable(container) {
    if (taskData.length === 0) {
        container.innerHTML = "<div style='padding: 20px; text-align: center;'>No tasks found in Default Week. Add a task above or run database setup script.</div>";
        return;
    }

    const tableWrapper = document.createElement('div');
    tableWrapper.className = "master-table-container";

    let html = `
        <table class="master-table">
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
        const isDaily = schedType === 'Daily';

        html += `
            <tr class="${isDaily ? 'row-daily' : 'row-weekly'}">
                <td>
                    <input type="text" class="edit-input" value="${task.Section || ''}" onblur="updateMasterTask(${task.rowNum}, 1, this.value)">
                </td>
                <td>
                    <input type="text" class="edit-input" value="${task["Task Description"] || ''}" onblur="updateMasterTask(${task.rowNum}, 2, this.value)">
                </td>
                <td>
                    <select class="edit-select" onchange="updateMasterTask(${task.rowNum}, 3, this.value)">
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
            <input type="checkbox" value="${d}" ${operatingDays.includes(d) ? 'checked' : ''}> ${d}
        </label>
    `).join('');
}

async function saveOperatingDays() {
    const checked = Array.from(document.querySelectorAll('#day-checkboxes input:checked')).map(cb => cb.value);
    operatingDays = checked;
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveOperatingDays", days: checked })
    });
    alert("Operating days updated!");
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
    
    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addTask", section, desc, schedule })
    });
    
    document.getElementById('new-section').value = "";
    document.getElementById('new-desc').value = "";
    fetchTasks("Master Task List");
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
