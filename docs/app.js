// Simple PRNG for deterministic shuffles
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Generate distinct colors for study programs
function getProgramColors(programs) {
  // ColorBrewer qualitative palette - colorblind safe
  const colors = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', 
    '#D55E00', '#CC79A7', '#999999', '#E69F00', '#56B4E9', 
    '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', 
    '#999999', '#E69F00', '#56B4E9', '#009E73', '#F0E442'
  ];
  
  const programColors = {};
  programs.forEach((program, index) => {
    programColors[program] = colors[index % colors.length];
  });
  return programColors;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('CSV is empty');
  const headerRaw = lines[0].split(',');
  const header = headerRaw.map(s => s.trim().toLowerCase());
  const nameAliases = new Set(['name','student','student_name','student name']);
  const programAliases = new Set(['program','programme','study_program','study programme','studyprogram','major']);
  let nameIdx = -1, progIdx = -1;
  for (let i = 0; i < header.length; i++) {
    if (nameAliases.has(header[i])) nameIdx = i;
    if (programAliases.has(header[i])) progIdx = i;
  }
  // Fallback: if exactly two columns and unknown headers, assume order: name, program
  if (nameIdx === -1 || progIdx === -1) {
    if (header.length >= 2) {
      nameIdx = 0;
      progIdx = 1;
    } else {
      throw new Error("Missing 'name' or 'program' header");
    }
  }
  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    const name = (row[nameIdx] || '').trim();
    const program = (row[progIdx] || '').trim();
    if (!name || !program) continue;
    students.push({ name, program });
  }
  if (students.length === 0) throw new Error('No students found in CSV');
  return students;
}

function groupStudents(students, groupSize, seed) {
  if (groupSize <= 0) throw new Error('group_size must be positive');
  const total = students.length;
  if (total === 0) throw new Error('No students');

  const programMap = new Map();
  for (const s of students) {
    if (!programMap.has(s.program)) programMap.set(s.program, []);
    programMap.get(s.program).push({ ...s });
  }
  const programs = Array.from(programMap.keys()).sort();
  const numPrograms = programs.length;
  if (numPrograms > groupSize) {
    throw new Error(`group_size (${groupSize}) smaller than number of programs (${numPrograms})`);
  }

  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  for (const p of programs) shuffleInPlace(programMap.get(p), rng);

  const numGroups = Math.ceil(total / groupSize);
  
  // Check which programs have enough students for all groups
  const programsWithEnough = [];
  const programsWithShortage = [];
  for (const p of programs) {
    if (programMap.get(p).length >= numGroups) {
      programsWithEnough.push(p);
    } else {
      programsWithShortage.push(p);
    }
  }

  const groups = Array.from({ length: numGroups }, () => []);
  
  // Assign students from programs that have enough for all groups
  for (const p of programsWithEnough) {
    const bucket = programMap.get(p);
    for (let g = 0; g < numGroups; g++) {
      groups[g].push({ ...bucket.pop(), locked: false });
    }
  }

  // Distribute students from programs with shortages
  for (const p of programsWithShortage) {
    const bucket = programMap.get(p);
    const available = bucket.length;
    // Distribute evenly across groups
    for (let g = 0; g < available; g++) {
      groups[g].push({ ...bucket.pop(), locked: false });
    }
  }

  // Distribute remaining students
  const rest = [];
  for (const p of programs) rest.push(...programMap.get(p));
  shuffleInPlace(rest, rng);

  for (const s of rest) {
    groups.sort((a, b) => a.length - b.length);
    for (const g of groups) {
      if (g.length < groupSize) { g.push({ ...s, locked: false }); break; }
    }
  }

  // Calculate missing programs for each group
  const groupsWithWarnings = groups.map((students, i) => {
    const presentPrograms = new Set(students.map(s => s.program));
    const missingPrograms = programs.filter(p => !presentPrograms.has(p));
    return { 
      index: i + 1, 
      students,
      missingPrograms: missingPrograms.length > 0 ? missingPrograms : null
    };
  });

  return {
    groupSize,
    numGroups,
    programs,
    groups: groupsWithWarnings
  };
}

function reshuffleRespectingLocks(groups, programs, groupSize, seed) {
  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  const numGroups = groups.length;

  const lockedPerGroup = groups.map(g => g.students.filter(s => s.locked));
  for (let i = 0; i < numGroups; i++) {
    if (lockedPerGroup[i].length > groupSize) {
      throw new Error(`Group ${i+1} exceeds size due to locked students`);
    }
  }

  // Pool unlocked
  const unlockedPool = [];
  for (const g of groups) {
    for (const s of g.students) if (!s.locked) unlockedPool.push({ name: s.name, program: s.program, locked: false });
  }

  // Present programs per group (from locked)
  const presentPerGroup = lockedPerGroup.map(list => new Set(list.map(s => s.program)));

  // Feasibility per program
  const counts = {};
  for (const s of unlockedPool) counts[s.program] = (counts[s.program] || 0) + 1;
  for (const p of programs) {
    const withP = presentPerGroup.reduce((acc, set) => acc + (set.has(p) ? 1 : 0), 0);
    const required = Math.max(0, numGroups - withP);
    if ((counts[p] || 0) < required) {
      throw new Error(`Need at least ${required} unlocked '${p}' students to cover all groups`);
    }
  }

  // Start with locked
  const result = lockedPerGroup.map(list => list.map(s => ({ ...s, locked: true })));

  // Build program queues
  const queues = {};
  for (const s of unlockedPool) {
    (queues[s.program] ||= []).push(s);
  }
  for (const p of Object.keys(queues)) shuffleInPlace(queues[p], rng);

  // Fill missing programs
  for (let i = 0; i < numGroups; i++) {
    const present = presentPerGroup[i];
    const missing = programs.filter(p => !present.has(p));
    if (result[i].length + missing.length > groupSize) {
      throw new Error(`Group ${i+1} would exceed size when adding required programs`);
    }
    for (const p of missing) {
      const q = queues[p];
      if (!q || q.length === 0) throw new Error(`Program queue empty for ${p}`);
      result[i].push({ ...q.pop(), locked: false });
    }
  }

  // Distribute remaining
  const leftover = [];
  for (const p in queues) leftover.push(...queues[p]);
  shuffleInPlace(leftover, rng);
  for (const s of leftover) {
    // Append to the current smallest group without reordering the groups array
    let minIdx = 0;
    let minLen = result[0] ? result[0].length : 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].length < minLen) { minLen = result[i].length; minIdx = i; }
    }
    if (result[minIdx].length < groupSize) {
      result[minIdx].push({ ...s, locked: false });
    }
  }

  return result.map((students, i) => ({ index: i + 1, students }));
}

function reshuffleRespectingLocksToGroupSize(groups, programs, groupSize, seed) {
  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  const totalStudents = groups.reduce((acc, g) => acc + g.students.length, 0);
  const targetNumGroups = Math.max(1, Math.ceil(totalStudents / groupSize));

  // Collect locked and unlocked
  const lockedAll = [];
  const unlockedPool = [];
  for (const g of groups) {
    for (const s of g.students) {
      if (s.locked) lockedAll.push({ ...s }); else unlockedPool.push({ name: s.name, program: s.program, locked: false });
    }
  }

  // Build program counts for feasibility
  const counts = {};
  for (const s of lockedAll) counts[s.program] = (counts[s.program] || 0) + 1;
  for (const s of unlockedPool) counts[s.program] = (counts[s.program] || 0) + 1;

  const numPrograms = programs.length;
  if (numPrograms > groupSize) throw new Error(`group_size (${groupSize}) smaller than number of programs (${numPrograms})`);
  
  // Check which programs have enough students for all groups
  const programsWithEnough = [];
  const programsWithShortage = [];
  for (const p of programs) {
    if ((counts[p] || 0) >= targetNumGroups) {
      programsWithEnough.push(p);
    } else {
      programsWithShortage.push(p);
    }
  }

  // Initialize target groups and present programs
  const result = Array.from({ length: targetNumGroups }, () => []);
  const presentPerGroup = Array.from({ length: targetNumGroups }, () => new Set());

  // Place locked students. Keep within original group index if possible; overflow round-robin
  let rr = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const lockedHere = groups[gi].students.filter(s => s.locked).map(s => ({ ...s, locked: true }));
    for (const s of lockedHere) {
      let targetIdx = gi < targetNumGroups ? gi : (rr++ % targetNumGroups);
      if (result[targetIdx].length >= groupSize) {
        // find next with space
        let found = false;
        for (let j = 0; j < targetNumGroups; j++) {
          if (result[j].length < groupSize) { targetIdx = j; found = true; break; }
        }
        if (!found) throw new Error('Capacity full with locked students');
      }
      result[targetIdx].push({ name: s.name, program: s.program, locked: true });
      presentPerGroup[targetIdx].add(s.program);
    }
  }

  // Build queues for unlocked and shuffle
  const queues = {};
  for (const s of unlockedPool) (queues[s.program] ||= []).push(s);
  for (const p of Object.keys(queues)) shuffleInPlace(queues[p], rng);

  // Fill missing programs per group first (only those with enough students)
  for (let i = 0; i < targetNumGroups; i++) {
    const missing = programsWithEnough.filter(p => !presentPerGroup[i].has(p));
    if (result[i].length + missing.length > groupSize) throw new Error(`Group ${i+1} would exceed size when adding required programs`);
    for (const p of missing) {
      const q = queues[p];
      if (!q || q.length === 0) throw new Error(`Program queue empty for ${p}`);
      const s = q.pop();
      result[i].push({ ...s, locked: false });
      presentPerGroup[i].add(s.program);
    }
  }

  // Distribute any leftover
  const leftover = [];
  for (const p in queues) leftover.push(...queues[p]);
  shuffleInPlace(leftover, rng);
  for (const s of leftover) {
    let minIdx = 0;
    let minLen = result[0] ? result[0].length : 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].length < minLen) { minLen = result[i].length; minIdx = i; }
    }
    if (result[minIdx].length < groupSize) result[minIdx].push({ ...s, locked: false });
  }

  // Calculate missing programs for each group
  const groupsWithWarnings = result.map((students, i) => {
    const presentPrograms = new Set(students.map(s => s.program));
    const missingPrograms = programs.filter(p => !presentPrograms.has(p));
    return { 
      index: i + 1, 
      students,
      missingPrograms: missingPrograms.length > 0 ? missingPrograms : null
    };
  });

  return groupsWithWarnings;
}

// UI logic
const els = {
  csv: document.getElementById('csv'),
  csvText: document.getElementById('csv_text'),
  groupSize: document.getElementById('group_size'),
  seed: document.getElementById('seed'),
  setupForm: document.getElementById('setup-form'),
  groups: document.getElementById('groups'),
  placeholder: document.getElementById('placeholder'),
  exportCsv: document.getElementById('export-csv'),
  exportMd: document.getElementById('export-md'),
  studentView: document.getElementById('student-view'),
  theme: document.getElementById('theme'),
  incSize: document.getElementById('inc-size'),
  decSize: document.getElementById('dec-size'),
  className: document.getElementById('class-name'),
  saveClass: document.getElementById('save-class'),
  loadFileLink: document.getElementById('load-file-link'),
};

let state = {
  programs: [],
  groupSize: 0,
  groups: [],
  theme: 'numeric',
  lastCsvText: '',
};

// Initialize state.groupSize from the current input default
state.groupSize = parseInt(els.groupSize.value || '4', 10) || 0;

function enableControls(enabled) {
  els.exportCsv.disabled = !enabled;
  els.exportMd.disabled = !enabled;
  els.studentView.disabled = !enabled;
  // Keep steppers usable pre-generation so users can set size first
}

function renderGroups(groups) {
  if (els.placeholder) els.placeholder.remove();
  els.groups.innerHTML = '';
  const names = themedGroupNames(groups.length, state.theme);
  
  // Generate colors for each unique program
  const uniquePrograms = [...new Set(groups.flatMap(g => g.students.map(s => s.program)))];
  const programColors = getProgramColors(uniquePrograms);
  
  // Set minHeight to match sidebar to reduce jump; will expand if content exceeds
  const sidebar = document.querySelector('.sidebar');
  const shell = document.getElementById('groups-shell');
  if (sidebar && shell) {
    const sidebarHeight = sidebar.getBoundingClientRect().height;
    shell.style.minHeight = sidebarHeight + 'px';
  }
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    section.dataset.groupIndex = String(g.index);
    
    // Add warning for missing programs
    const warningHtml = g.missingPrograms ? `
      <div class="group-warning">
        <span class="warning-icon">⚠️</span>
        Missing: ${g.missingPrograms.join(', ')}
      </div>
    ` : '';
    
    section.innerHTML = `
      <header>
        <h2>${names[g.index - 1] || `Group ${g.index}`}</h2>
        <small><span class="count">${g.students.length}</span> / ${state.groupSize}</small>
      </header>
      ${warningHtml}
      <ul class="student-list" data-list="${g.index}"></ul>
    `;
    const list = section.querySelector('.student-list');
    for (const s of g.students) list.appendChild(createStudentLi(s, programColors));
    els.groups.appendChild(section);
  }
  bindDnD();
  bindLockButtons();
}

function createStudentLi(s, programColors) {
  const li = document.createElement('li');
  li.className = 'student';
  li.dataset.name = s.name;
  li.dataset.program = s.program;
  li.dataset.locked = s.locked ? 'true' : 'false';
  if (s.locked) li.classList.add('is-locked');
  const lockIcon = s.locked ? '🔒' : '🔓';
  const programColor = programColors[s.program] || '#666';
  li.innerHTML = `<span class="name">${s.name}</span><span class="actions"><span class="tag" style="background-color: ${programColor}">${s.program}</span><button class="lock-btn" title="Toggle lock" aria-label="Toggle lock" draggable="false">${lockIcon}</button></span>`;
  li.setAttribute('draggable', 'true');
  return li;
}

function currentPayload() {
  const groups = Array.from(document.querySelectorAll('.group')).map((g, i) => {
    const students = Array.from(g.querySelectorAll('.student')).map(li => ({
      name: li.dataset.name,
      program: li.dataset.program,
      locked: li.dataset.locked === 'true'
    }));
    return { index: i + 1, students };
  });
  return { groups };
}

function bindDnD() {
  let dragged = null;

  document.querySelectorAll('.student').forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      if (item.dataset.locked === 'true') { e.preventDefault(); return; }
      dragged = item;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require data to be set
        e.dataTransfer.setData('text/plain', 'student');
      }
    });
    item.addEventListener('dragend', () => {
      if (dragged === item) {
        item.classList.remove('dragging');
        dragged = null;
      }
    });
  });

  document.querySelectorAll('.student-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      if (dragged && dragged.dataset.locked !== 'true') {
        list.appendChild(dragged);
        updateCounts();
      }
    });
  });
}

function bindLockButtons() {
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const li = e.currentTarget.closest('.student');
      const locked = li.dataset.locked === 'true';
      li.dataset.locked = (!locked).toString();
      li.classList.toggle('is-locked', !locked);
      e.currentTarget.textContent = (!locked) ? '🔒' : '🔓';
    });
    // Prevent drag from starting on lock button
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    btn.addEventListener('dragstart', (e) => { e.preventDefault(); });
  });
}

function updateCounts() {
  document.querySelectorAll('.group').forEach(g => {
    const count = g.querySelectorAll('.student').length;
    g.querySelector('.count').textContent = count;
  });
}

function validateConstraints(groups, programs, groupSize) {
  const errors = [];
  for (const g of groups) {
    if (g.students.length > groupSize) errors.push(`Group ${g.index} exceeds group size ${groupSize}.`);
    const present = new Set(g.students.map(s => s.program));
    const missing = programs.filter(p => !present.has(p));
    if (missing.length) errors.push(`Group ${g.index} missing programs: ${missing.join(', ')}`);
  }
  return errors;
}

function exportCSV(groups) {
  const lines = ['group,name,program'];
  for (const g of groups) for (const s of g.students) lines.push(`${g.index},${s.name},${s.program}`);
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'groups.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function themedGroupNames(numGroups, theme) {
  const lists = {
    numeric: Array.from({ length: numGroups }, (_, i) => `Group ${i + 1}`),
    greek: ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi','Rho','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega'],
    colors: ['Red','Blue','Green','Yellow','Purple','Orange','Teal','Cyan','Magenta','Lime','Indigo','Violet','Amber','Rose','Emerald','Sapphire','Ruby','Topaz'],
    animals: ['Lion','Tiger','Bear','Wolf','Eagle','Falcon','Dolphin','Fox','Owl','Hawk','Panther','Cheetah','Bison','Moose','Koala','Penguin','Otter','Orca'],
    planets: ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'],
    norse: ['Odin','Thor','Freya','Loki','Baldr','Frigg','Heimdall','Tyr','Njord','Sif','Skadi','Bragi'],
    mathematicians: ['Gauss','Noether','Euler','Riemann','Hilbert','Poincaré','Cantor','Ramanujan','Hypatia','Archimedes','Cauchy','Fourier','Fermat','Galois','Lagrange'],
    physicists: ['Newton','Einstein','Curie','Feynman','Hawking','Maxwell','Faraday','Bohr','Heisenberg','Schrödinger','Dirac','Planck','Galileo','Kepler'],
    chemists: ['Lavoisier','Mendeleev','Dalton','Avogadro','Pauling','Kekulé','Haber','Curie','Bunsen','Priestley','Boyle','Berzelius'],
    biologists: ['Darwin','Mendel','Pasteur','Linnaeus','Haeckel','Goodall','Franklin','Watson','Crick','Huxley','Monod','Margulis'],
    philosophers: ['Plato','Aristotle','Kant','Hume','Nietzsche','Descartes','Spinoza','Kierkegaard','Wittgenstein','Confucius','Socrates','Heidegger'],
    computerscience: ['Turing','Shannon','von Neumann','Knuth','Dijkstra','Hopper','Berners-Lee','Lamport','Ritchie','Torvalds','Kay','Backus'],
    constellations: ['Orion','Lyra','Cygnus','Andromeda','Cassiopeia','Draco','Aquila','Pegasus','Phoenix','Ursa Major','Ursa Minor','Perseus'],
  };
  const list = lists[theme] || lists.numeric;
  const names = [];
  for (let i = 0; i < numGroups; i++) {
    names.push(list[i] ? list[i] : `Group ${i + 1}`);
  }
  return names;
}

function exportMarkdown(groups, theme) {
  const names = themedGroupNames(groups.length, theme);
  const lines = ['# Groups'];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    lines.push(`\n## ${names[i]}`);
    for (const s of g.students) {
      lines.push(`- ${s.name} (${s.program})`);
    }
  }
  const content = lines.join('\n');
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Popup blocked: fall back to creating a new tab via anchor
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

function openStudentView(groups, theme) {
  const names = themedGroupNames(groups.length, theme);
  
  // Generate colors for each unique program
  const uniquePrograms = [...new Set(groups.flatMap(g => g.students.map(s => s.program)))];
  const programColors = getProgramColors(uniquePrograms);
  
  // Create clean HTML for student view
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Student Groups</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f8fafc;
            color: #1e293b;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header h1 {
            margin: 0;
            color: #1e293b;
            font-size: 2.5rem;
        }
        .groups-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        .group {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 2px solid #e2e8f0;
        }
        .group-header {
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e2e8f0;
        }
        .group-header h2 {
            margin: 0;
            color: #1e293b;
            font-size: 1.5rem;
            font-weight: 600;
        }
        .student-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .student {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f1f5f9;
        }
        .student:last-child {
            border-bottom: none;
        }
        .student-name {
            font-weight: 500;
            color: #1e293b;
        }
        .program-tag {
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 0.875rem;
            font-weight: 500;
            color: white;
            text-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .group-warning {
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 15px;
            font-size: 0.875rem;
            color: #92400e;
        }
        .warning-icon {
            margin-right: 6px;
        }
        @media print {
            body { background: white; }
            .group { box-shadow: none; border: 1px solid #ccc; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Student Groups</h1>
        </div>
        <div class="groups-grid">
            ${groups.map((g, i) => {
                const warningHtml = g.missingPrograms ? `
                    <div class="group-warning">
                        <span class="warning-icon">⚠️</span>
                        Missing: ${g.missingPrograms.join(', ')}
                    </div>
                ` : '';
                
                return `
                    <div class="group">
                        <div class="group-header">
                            <h2>${names[i]}</h2>
                        </div>
                        ${warningHtml}
                        <ul class="student-list">
                            ${g.students.map(s => {
                                const programColor = programColors[s.program] || '#666';
                                return `
                                    <li class="student">
                                        <span class="student-name">${s.name}</span>
                                        <span class="program-tag" style="background-color: ${programColor}">${s.program}</span>
                                    </li>
                                `;
                            }).join('')}
                        </ul>
                    </div>
                `;
            }).join('')}
        </div>
    </div>
</body>
</html>`;
  
  // Open in new tab
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Popup blocked: fall back to creating a new tab via anchor
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

els.setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    // Always use the textarea for generation. The file input only populates the textarea on change.
    const text = (els.csvText && els.csvText.value ? els.csvText.value : '').trim();
    if (!text) {
      alert('CSV data is empty. Paste CSV into the CSV data field or select a file to populate it.');
      return;
    }
    const desiredGroupSize = parseInt(els.groupSize.value, 10);
    const seed = els.seed.value ? parseInt(els.seed.value, 10) : undefined;

    // If CSV unchanged and we already have groups, do a lock-respecting reshuffle
    if (state.groups && state.groups.length > 0 && state.lastCsvText === text) {
      state.groupSize = desiredGroupSize;
      state.theme = els.theme ? els.theme.value : state.theme;
      const payload = currentPayload();
      const reshuffled = reshuffleRespectingLocksToGroupSize(payload.groups, state.programs, state.groupSize, seed);
      state.groups = reshuffled;
      renderGroups(state.groups);
      enableControls(true);
      return;
    }

    // Otherwise, parse and generate fresh groups
    const students = parseCSV(text);
    const result = groupStudents(students, desiredGroupSize, seed);
    state.programs = result.programs;
    state.groupSize = result.groupSize;
    state.groups = result.groups;
    state.theme = els.theme ? els.theme.value : 'numeric';
    state.lastCsvText = text;
    renderGroups(state.groups);
    enableControls(true);
  } catch (err) {
    alert(String(err));
  }
});

// validate and reshuffle buttons removed; generate handles reshuffle now

els.exportCsv.addEventListener('click', () => {
  const payload = currentPayload();
  exportCSV(payload.groups);
});

els.exportMd.addEventListener('click', () => {
  const payload = currentPayload();
  const theme = els.theme ? els.theme.value : 'numeric';
  exportMarkdown(payload.groups, theme);
});

els.studentView.addEventListener('click', () => {
  const payload = currentPayload();
  const theme = els.theme ? els.theme.value : 'numeric';
  openStudentView(payload.groups, theme);
});


// Group size + / - controls
function applyNewGroupSize(newSize) {
  const minSize = Math.max(1, state.programs.length || 0);
  if (newSize < minSize) {
    alert(`Group size cannot be less than number of programs (${state.programs.length || 0}).`);
    return;
  }
  const prev = state.groupSize || parseInt(els.groupSize.value || '4', 10);
  // If no groups yet, just set the value and return
  if (!state.groups || state.groups.length === 0) {
    state.groupSize = newSize;
    els.groupSize.value = String(newSize);
    return;
  }
  try {
    const payload = currentPayload();
    const groups = reshuffleRespectingLocksToGroupSize(payload.groups, state.programs, newSize, els.seed.value ? parseInt(els.seed.value, 10) : undefined);
    state.groupSize = newSize;
    els.groupSize.value = String(newSize);
    state.groups = groups;
    renderGroups(groups);
  } catch (err) {
    alert(String(err));
    state.groupSize = prev;
    els.groupSize.value = String(prev);
  }
}

if (els.incSize) {
  els.incSize.addEventListener('click', (e) => {
    e.preventDefault();
    const current = parseInt(els.groupSize.value || String(state.groupSize || 0), 10) || 0;
    applyNewGroupSize(current + 1);
  });
}
if (els.decSize) {
  els.decSize.addEventListener('click', (e) => {
    e.preventDefault();
    const current = parseInt(els.groupSize.value || String(state.groupSize || 0), 10) || 0;
    applyNewGroupSize(current - 1);
  });
}

// Keep state in sync when user types a number before generating groups
els.groupSize.addEventListener('input', () => {
  const val = parseInt(els.groupSize.value, 10);
  if (!Number.isNaN(val)) state.groupSize = val;
});

// Update theme live and re-render headers when groups exist
if (els.theme) {
  els.theme.addEventListener('change', () => {
    state.theme = els.theme.value;
    if (state.groups && state.groups.length > 0) renderGroups(state.groups);
  });
}

// Class list management
const CLASS_HISTORY_KEY = 'class_list_history';
const MAX_HISTORY_SIZE = 20;
const SHOW_IN_DROPDOWN = 5;

function saveClassList(className, content) {
  try {
    const history = getClassHistory();
    
    // Remove if class with same name already exists
    const existingIndex = history.findIndex(item => item.name === className);
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    
    // Add new class to beginning
    history.unshift({
      name: className,
      content: content,
      timestamp: new Date().toISOString(),
      size: content.length,
      lastGroups: null // Will be updated when groups are generated
    });
    
    // Keep only the most recent classes
    if (history.length > MAX_HISTORY_SIZE) {
      history.splice(MAX_HISTORY_SIZE);
    }
    
    localStorage.setItem(CLASS_HISTORY_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('Could not save class to history:', err);
  }
}

function updateClassWithGroups(className, groups) {
  try {
    const history = getClassHistory();
    const classIndex = history.findIndex(item => item.name === className);
    if (classIndex !== -1) {
      history[classIndex].lastGroups = groups;
      localStorage.setItem(CLASS_HISTORY_KEY, JSON.stringify(history));
    }
  } catch (err) {
    console.warn('Could not update class with groups:', err);
  }
}

function getClassHistory() {
  try {
    const stored = localStorage.getItem(CLASS_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.warn('Could not load class history:', err);
    return [];
  }
}

function loadClassFromHistory(className) {
  const history = getClassHistory();
  const classData = history.find(item => item.name === className);
  return classData ? classData.content : null;
}

function createClassHistoryList() {
  const history = getClassHistory();
  
  const container = document.createElement('div');
  container.className = 'saved-classes';
  
  if (history.length === 0) {
    // Show example class when no saved classes exist
    container.innerHTML = `
      <label>Saved classes:</label>
      <div class="class-list">
        <div class="class-item example-class">
          <div class="class-content" onclick="loadExampleClass()">
            <div class="class-name">Example Class</div>
            <div class="class-meta">Click to load sample data</div>
          </div>
        </div>
      </div>
    `;
  } else {
    // Show up to 4 most recent saved classes
    const recent = history.slice(0, 4);
    const visibleSorted = recent.slice().sort((a, b) => a.name.localeCompare(b.name));
    container.innerHTML = `
      <label>Saved classes:</label>
      <div class="class-list">
        ${visibleSorted.map(classData => `
          <div class="class-item">
            <div class="class-content" onclick="loadClassFromList('${classData.name}')">
              <div class="class-name">${classData.name}</div>
              <div class="class-meta">${new Date(classData.timestamp).toLocaleDateString()} • ${classData.size} chars</div>
            </div>
            <button class="delete-btn" onclick="deleteClass('${classData.name}')" title="Delete class">🗑️</button>
          </div>
        `).join('')}
        ${history.length > 4 ? `
          <button class="more-btn" onclick="showAllClassesModal(${JSON.stringify(history).replace(/"/g, '&quot;')})">
            Show ${history.length - 4} more classes...
          </button>
        ` : ''}
      </div>
    `;
  }
  
  return container;
}

// Global function for loading class from list
window.loadClassFromList = function(className) {
  const history = getClassHistory();
  const classData = history.find(item => item.name === className);
  if (classData && els.csvText) {
    els.csvText.value = classData.content;
    // Also populate the class name field for easy editing
    if (els.className) {
      els.className.value = className;
    }
    
    // Load the last groups if they exist
    if (classData.lastGroups && classData.lastGroups.length > 0) {
      state.groups = classData.lastGroups;
      state.programs = [...new Set(classData.lastGroups.flatMap(g => g.students.map(s => s.program)))];
      state.groupSize = Math.max(...classData.lastGroups.map(g => g.students.length));
      state.lastCsvText = classData.content;
      renderGroups(state.groups);
      enableControls(true);
    } else {
      // Clear any existing groups if no saved groups
      state.groups = [];
      state.programs = [];
      state.groupSize = 0;
      state.lastCsvText = '';
      renderGroups([]);
      enableControls(false);
    }
  }
};

// Global function for deleting a class
window.deleteClass = function(className) {
  if (confirm(`Are you sure you want to delete the class "${className}"?`)) {
    const history = getClassHistory();
    const updatedHistory = history.filter(item => item.name !== className);
    localStorage.setItem(CLASS_HISTORY_KEY, JSON.stringify(updatedHistory));
    updateClassHistoryUI();
  }
};

// Global function for loading example class
window.loadExampleClass = function() {
  const exampleCSV = `name,program
Alice,Computer Science
Bob,Mathematics
Charlie,Physics
Dana,Computer Science
Evan,Mathematics
Fay,Physics
Gus,Computer Science
Hana,Mathematics
Iris,Physics
Jack,Computer Science
Kira,Mathematics
Liam,Physics
Mona,Computer Science
Nils,Mathematics
Ola,Physics`;
  
  if (els.csvText) {
    els.csvText.value = exampleCSV;
  }
  if (els.className) {
    els.className.value = 'Example Class';
  }
};

function showAllClassesModal(history) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>All Saved Classes</h3>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-content">
        ${history.map(classData => `
          <div class="file-item">
            <div class="file-content" onclick="loadClassFromModal('${classData.name}'); this.closest('.modal-overlay').remove();">
              <div class="file-name">${classData.name}</div>
              <div class="file-meta">${new Date(classData.timestamp).toLocaleString()} • ${classData.size} chars</div>
            </div>
            <button class="delete-btn" onclick="deleteClass('${classData.name}'); this.closest('.modal-overlay').remove();" title="Delete class">🗑️</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// Global function for modal class loading
window.loadClassFromModal = function(className) {
  const history = getClassHistory();
  const classData = history.find(item => item.name === className);
  if (classData && els.csvText) {
    els.csvText.value = classData.content;
    // Also populate the class name field for easy editing
    if (els.className) {
      els.className.value = className;
    }
    
    // Load the last groups if they exist
    if (classData.lastGroups && classData.lastGroups.length > 0) {
      state.groups = classData.lastGroups;
      state.programs = [...new Set(classData.lastGroups.flatMap(g => g.students.map(s => s.program)))];
      state.groupSize = Math.max(...classData.lastGroups.map(g => g.students.length));
      state.lastCsvText = classData.content;
      renderGroups(state.groups);
      enableControls(true);
    } else {
      // Clear any existing groups if no saved groups
      state.groups = [];
      state.programs = [];
      state.groupSize = 0;
      state.lastCsvText = '';
      renderGroups([]);
      enableControls(false);
    }
  }
};

function updateClassHistoryUI() {
  // Remove existing history list if present
  const existing = document.querySelector('.saved-classes');
  if (existing) {
    existing.remove();
  }
  
  // Add new history list if there are classes
  const historyList = createClassHistoryList();
  if (historyList) {
    // Insert right after the class-name row in the CSV section
    const classRow = document.querySelector('.row[style*="margin-top:2px"]');
    if (classRow && classRow.parentNode) {
      classRow.parentNode.insertBefore(historyList, classRow.nextSibling);
    }
  }
}

// When the load file link is clicked, trigger file input
if (els.loadFileLink) {
  els.loadFileLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (els.csv) {
      els.csv.click();
    }
  });
}

// When a file is chosen, load its contents into the textarea
if (els.csv) {
  els.csv.addEventListener('change', async () => {
    const file = els.csv.files && els.csv.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (els.csvText) els.csvText.value = text;
    } catch (err) {
      // ignore
    }
  });
}

// Add drag and drop functionality to the CSV textarea
if (els.csvText) {
  els.csvText.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.csvText.classList.add('drag-over');
  });

  els.csvText.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.csvText.classList.remove('drag-over');
  });

  els.csvText.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    els.csvText.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        try {
          const text = await file.text();
          els.csvText.value = text;
        } catch (err) {
          console.error('Error reading dropped file:', err);
        }
      } else {
        alert('Please drop a CSV file');
      }
    }
  });
}

// Function to save class (shared between button click and Enter key)
function saveClass() {
  const className = els.className ? els.className.value.trim() : '';
  const content = els.csvText ? els.csvText.value.trim() : '';
  
  if (!className) {
    alert('Please enter a class name');
    return;
  }
  
  if (!content) {
    alert('Please enter CSV data to save');
    return;
  }
  
  // Save the class with current groups if they exist
  saveClassList(className, content);
  
  // If groups exist in the DOM, save the current DOM state (includes locks and manual changes)
  const payload = currentPayload();
  if (payload.groups && payload.groups.length > 0) {
    updateClassWithGroups(className, payload.groups);
  }
  
  updateClassHistoryUI();
  
  // Keep the class name in the input field for easy re-saving
  // Don't clear the class name input
  
  // Show confirmation
  alert(`Class "${className}" saved successfully!`);
}

// Save class button functionality
if (els.saveClass) {
  els.saveClass.addEventListener('click', saveClass);
}

// Enter key functionality for class name input
if (els.className) {
  els.className.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveClass();
    }
  });
}

// Initialize class history UI and load last used class on page load
document.addEventListener('DOMContentLoaded', () => {
  updateClassHistoryUI();
  loadLastUsedClass();
});

// Also try to update when window loads (in case DOMContentLoaded already fired)
window.addEventListener('load', () => {
  updateClassHistoryUI();
  loadLastUsedClass();
});

function loadLastUsedClass() {
  const history = getClassHistory();
  if (history.length > 0 && els.csvText) {
    // Load the most recent class (first in the array)
    const lastClass = history[0];
    els.csvText.value = lastClass.content;
    
    // Also populate the class name field for convenience
    if (els.className) {
      els.className.value = lastClass.name;
    }
    
    // Load the last groups if they exist
    if (lastClass.lastGroups && lastClass.lastGroups.length > 0) {
      state.groups = lastClass.lastGroups;
      state.programs = [...new Set(lastClass.lastGroups.flatMap(g => g.students.map(s => s.program)))];
      state.groupSize = Math.max(...lastClass.lastGroups.map(g => g.students.length));
      state.lastCsvText = lastClass.content;
      renderGroups(state.groups);
      enableControls(true);
    } else {
      // Clear any existing groups if no saved groups
      state.groups = [];
      state.programs = [];
      state.groupSize = 0;
      state.lastCsvText = '';
      renderGroups([]);
      enableControls(false);
    }
  }
}


