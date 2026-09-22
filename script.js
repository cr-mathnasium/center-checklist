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
        
        if (json.operatingDays) {
            operatingDays = json.operatingDays;
            taskData = json.tasks || [];
        } else if (Array.isArray(json)) {
            taskData = json;
        } else {
            taskData = [];
        }
        
        renderChecklist();
    } catch (error) {
        document.getElementById('checklist-content').innerHTML = "Error loading data. Verify deployment setup.";
    }
}

function getScheduleType(task) {
    return task.ScheduleType || task["Schedule Type"] || "";
}

function renderChecklist() {
    const container = document.getElementById('checklist-content');
    container.innerHTML = "";

    const isMasterTab = currentTabName === 'Master Task List';
    document.getElementById('days-selector-container').style.display = isMasterTab ? 'flex' : 'none';
    document.getElementById('add-task-container').style.display = isMasterTab ? 'flex' : 'none';

    if (isMasterTab) {
        renderDayCheckboxes();
    }

    const taskCounts = {};
    taskData.forEach(t => {
        const desc = t["Task Description"];
        if (desc) taskCounts[desc] = (taskCounts[desc] || 0) + 1;
    });

    allDays.forEach(day => {
        let displayTasks = [];

        if (isMasterTab) {
            displayTasks = taskData.filter(t => {
                const st = getScheduleType(t);
                return st === day || st === 'Daily';
            });
        } else {
            displayTasks = taskData.filter(t => t.Day === day);
        }

        if (displayTasks.length === 0 && currentTabName !== 'Next Week' && !isMasterTab) return;

        const daySection = document.createElement('div');
        daySection.className = "day-section" + (!operatingDays.includes(day) && !isMasterTab ? " grayed-out" : "");
        daySection.id = `section-${day}`;

        const header = document.createElement('div');
        header.className = "day-header";
        header.innerHTML = `<span>${day} Tasks ${!operatingDays.includes(day) && !isMasterTab ? '(Non-Operating)' : ''}</span>`;

        if (currentTabName === "Next Week") {
            const grayBtn = document.createElement('button');
            grayBtn.className = "gray-btn";
            grayBtn.innerText = "Gray Out / Activate Day";
            grayBtn.onclick = () => document.getElementById(`section-${day}`).classList.toggle('grayed-out');
            header.appendChild(grayBtn);
        }

        const taskListContainer = document.createElement('div');
        taskListContainer.className = "dropzone";
        taskListContainer.dataset.day = day;

        displayTasks.forEach(task => {
            const schedType = getScheduleType(task);
            let isDaily = isMasterTab ? (schedType === 'Daily') : (taskCounts[task["Task Description"]] > 1);
            
            const row = document.createElement('div');
            row.className = `task-row ${isDaily ? 'is-daily' : 'is-weekly'}` + (currentTabName === "Next Week" ? " draggable" : "");

            if (isMasterTab) {
                row.innerHTML = `
                    <div>
                        <input type="text" class="edit-input" value="${task.Section || ''}" onblur="updateMasterTask(${task.rowNum}, 1, this.value)">
                        <span class="task-type-badge ${isDaily ? 'badge-daily' : 'badge-weekly'}">${isDaily ? 'Daily' : 'Weekly'}</span>
                    </div>
                    <div>
                        <input type="text" class="edit-input" style="width: 90%;" value="${task["Task Description"] || ''}" onblur="updateMasterTask(${task.rowNum}, 2, this.value)">
                    </div>
                    <div>
                        <select class="edit-select" onchange="updateMasterTask(${task.rowNum}, 3, this.value)">
                            <option value="Daily" ${schedType === 'Daily' ? 'selected' : ''}>Daily</option>
                            ${allDays.map(d => `<option value="${d}" ${schedType === d ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <button class="action-btn danger-btn" onclick="deleteMasterTask(${task.rowNum})">Delete</button>
                    </div>
                `;
            } else {
                const isChecked = task["Done?"] === true || task["Done?"] === "TRUE";
                row.innerHTML = `
                    <div>
                        <div class="task-section-label">${task.Section || schedType || ''}</div>
                        <span class="task-type-badge ${isDaily ? 'badge-daily' : 'badge-weekly'}">
                            ${isDaily ? 'Daily' : 'Weekly'}
                        </span>
                    </div>
                    <div class="task-desc">${task["Task Description"] || ''}</div>
                    <div>
                        <input type="checkbox" ${isChecked ? 'checked' : ''} 
                               ${(currentTabName === 'Archive Log') ? 'disabled' : ''}
                               onchange="toggleCheck(${task.rowNum}, this.checked)">
                    </div>
                    <div>
                        <input type="text" class="initials-input" value="${task.Initials || ''}" placeholder="Initials"
                               ${(currentTabName === 'Archive Log') ? 'disabled' : ''}
                               onblur="updateInitials(${task.rowNum}, this.value)">
                    </div>
                `;
            }

            taskListContainer.appendChild(row);
        });

        daySection.appendChild(header);
        daySection.appendChild(taskListContainer);
        container.appendChild(daySection);
    });
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
