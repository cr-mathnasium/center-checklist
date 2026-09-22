const API_URL = "https://script.google.com/macros/s/AKfycbzH3Nv579kC_f5w-YXXYmOizZuiSeqWXLU4BEcKYOC1cXNsm0L8epJgX5_HPxsvEIML/exec"; 

let currentTabName = "Current Week";
let taskData = [];

async function fetchTasks(sheetName) {
    document.getElementById('checklist-content').innerHTML = "Loading tasks from center database...";
    try {
        const response = await fetch(`${API_URL}?sheet=${encodeURIComponent(sheetName)}`);
        taskData = await response.json();
        renderChecklist();
    } catch (error) {
        document.getElementById('checklist-content').innerHTML = "Error loading data. Verify deployment setup.";
    }
}

function renderChecklist() {
    const container = document.getElementById('checklist-content');
    container.innerHTML = "";

    const days = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"];
    
    // Build a lookup map counting task occurrences across all days
    // Daily tasks repeat across multiple days; Weekly tasks only occur on 1 day
    const taskCounts = {};
    taskData.forEach(t => {
        const desc = t["Task Description"];
        if (desc) {
            taskCounts[desc] = (taskCounts[desc] || 0) + 1;
        }
    });

    days.forEach(day => {
        const dayTasks = taskData.filter(t => t.Day === day || (currentTabName === 'Master Task List' && t.ScheduleType === day));
        
        let displayTasks = dayTasks;
        if (currentTabName === 'Master Task List') {
            displayTasks = taskData.filter(t => t.ScheduleType === day || (t.ScheduleType === 'Daily'));
        }

        if (displayTasks.length === 0 && currentTabName !== 'Next Week') return;

        const daySection = document.createElement('div');
        daySection.className = "day-section";
        daySection.id = `section-${day}`;

        const header = document.createElement('div');
        header.className = "day-header";
        header.innerHTML = `<span>${day} Tasks</span>`;

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

        if (currentTabName === "Next Week") {
            taskListContainer.ondragover = (e) => e.preventDefault();
            taskListContainer.ondrop = (e) => {
                e.preventDefault();
                const rowNum = e.dataTransfer.getData("text/plain");
                const item = taskData.find(t => t.rowNum == rowNum);
                if (item) {
                    item.Day = day;
                    updateCellOnSheet(item.rowNum, 1, day, "Next Week");
                    renderChecklist();
                }
            };
        }

        displayTasks.forEach(task => {
            // Determine if task is Daily vs Weekly accurately:
            let isDaily = false;
            if (currentTabName === 'Master Task List') {
                isDaily = task.ScheduleType === 'Daily';
            } else {
                // If the same task exists on 2 or more days, it is a Daily task
                const desc = task["Task Description"];
                isDaily = taskCounts[desc] > 1;
            }
            
            const row = document.createElement('div');
            row.className = `task-row ${isDaily ? 'is-daily' : 'is-weekly'}` + (currentTabName === "Next Week" ? " draggable" : "");
            
            if (currentTabName === "Next Week") {
                row.draggable = true;
                row.ondragstart = (e) => e.dataTransfer.setData("text/plain", task.rowNum);
            }

            const isChecked = task["Done?"] === true || task["Done?"] === "TRUE";
            
            row.innerHTML = `
                <div>
                    <div class="task-section-label">${task.Section || task.ScheduleType || ''}</div>
                    <span class="task-type-badge ${isDaily ? 'badge-daily' : 'badge-weekly'}">
                        ${isDaily ? 'Daily' : 'Weekly'}
                    </span>
                </div>
                <div class="task-desc">${task["Task Description"] || ''}</div>
                <div>
                    <input type="checkbox" ${isChecked ? 'checked' : ''} 
                           ${(currentTabName === 'Archive Log' || currentTabName === 'Master Task List') ? 'disabled' : ''}
                           onchange="toggleCheck(${task.rowNum}, this.checked)">
                </div>
                <div>
                    <input type="text" class="initials-input" value="${task.Initials || ''}" placeholder="Initials"
                           ${(currentTabName === 'Archive Log' || currentTabName === 'Master Task List') ? 'disabled' : ''}
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
