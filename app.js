// 简单 IndexedDB 封装
const DB_NAME = 'grade_manager_db';
const DB_VERSION = 1;
const STUDENT_STORE = 'students';
const CONFIG_STORE = 'config';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STUDENT_STORE)) {
        const store = db.createObjectStore(STUDENT_STORE, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('no', 'no', { unique: false });
      }
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore(storeName, mode, callback) {
  return openDb().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const result = callback(store);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
  });
}

// 配置相关
const DEFAULT_SCHEMA = {
  key: 'gradingSchema',
  components: [
    {
      key: 'experiment',
      label: '实验成绩',
      weight: 40,
      type: 'composite',
      subcomponents: [
        { key: 'exp1', label: '实验1', weight: 50 },
        { key: 'exp2', label: '实验2', weight: 50 }
      ]
    },
    {
      key: 'usual',
      label: '平时成绩',
      weight: 20,
      type: 'simple'
    },
    {
      key: 'final',
      label: '期末笔试',
      weight: 40,
      type: 'simple'
    }
  ]
};

function getSchema() {
  return withStore(CONFIG_STORE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const req = store.get('gradingSchema');
      req.onsuccess = () => {
        resolve(req.result || DEFAULT_SCHEMA);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

function saveSchema(schema) {
  const data = { ...schema, key: 'gradingSchema' };
  return withStore(CONFIG_STORE, 'readwrite', store => {
    store.put(data);
  });
}

// 学生相关
function getAllStudents() {
  return withStore(STUDENT_STORE, 'readonly', store => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function addStudent(student) {
  return withStore(STUDENT_STORE, 'readwrite', store => {
    store.add(student);
  });
}

function updateStudent(student) {
  return withStore(STUDENT_STORE, 'readwrite', store => {
    store.put(student);
  });
}

function deleteStudent(id) {
  return withStore(STUDENT_STORE, 'readwrite', store => {
    store.delete(id);
  });
}

function checkStudentNoExists(no, excludeId = null) {
  return getAllStudents().then(allStudents => {
    return allStudents.some(s => s.no === no && s.id !== excludeId);
  });
}

// 成绩计算
function computeScores(student, schema) {
  let total = 0;
  const detail = {};

  schema.components.forEach(component => {
    if (component.type === 'simple') {
      const val = Number(student.scores?.[component.key] ?? 0);
      const weighted = (val / 100) * component.weight;
      detail[component.key] = {
        raw: val,
        weighted
      };
      total += weighted;
    } else if (component.type === 'composite') {
      let compositeRaw = 0;
      const subDetail = {};
      const subs = component.subcomponents || [];
      subs.forEach(sub => {
        const val = Number(student.scores?.[component.key]?.[sub.key] ?? 0);
        const subWeighted = (val / 100) * sub.weight;
        subDetail[sub.key] = {
          raw: val,
          weighted: subWeighted
        };
        compositeRaw += subWeighted;
      });
      // compositeRaw 当前是 0-100 区间
      const weighted = (compositeRaw / 100) * component.weight;
      detail[component.key] = {
        raw: compositeRaw,
        weighted,
        subDetail
      };
      total += weighted;
    }
  });

  return {
    total: Number(total.toFixed(2)),
    detail
  };
}

// UI 渲染
let currentSchema = DEFAULT_SCHEMA;
let students = [];
let currentSortField = 'rank';
let currentSortDirection = 'asc';

function renderSchemaConfig() {
  const container = document.getElementById('componentList');
  container.innerHTML = '';

  currentSchema.components.forEach((component, index) => {
    const card = document.createElement('div');
    card.className = 'component-card';

    const header = document.createElement('div');
    header.className = 'component-header';
    header.innerHTML = `
      <h3>项目 ${index + 1}</h3>
      <label>名称
        <input type="text" value="${component.label}" data-comp-index="${index}" data-field="label">
      </label>
      <label>权重（总分占比）
        <input type="number" min="0" max="100" step="0.1" value="${component.weight}" data-comp-index="${index}" data-field="weight">
      </label>
      <label>类型
        <select data-comp-index="${index}" data-field="type">
          <option value="simple" ${component.type === 'simple' ? 'selected' : ''}>单一分数</option>
          <option value="composite" ${component.type === 'composite' ? 'selected' : ''}>可拆分（如多次实验）</option>
        </select>
      </label>
      <button class="btn btn-danger" data-action="remove-comp" data-comp-index="${index}">删除项目</button>
    `;

    card.appendChild(header);

    if (component.type === 'composite') {
      const subList = document.createElement('div');
      subList.className = 'subcomponent-list';

      (component.subcomponents || []).forEach((sub, sIndex) => {
        const row = document.createElement('div');
        row.className = 'subcomponent-row';
        row.innerHTML = `
          <span>子项 ${sIndex + 1}</span>
          <label>名称
            <input type="text" value="${sub.label}" data-comp-index="${index}" data-sub-index="${sIndex}" data-field="sub-label">
          </label>
          <label>权重（该项目内部占比）
            <input type="number" min="0" max="100" step="0.1" value="${sub.weight}" data-comp-index="${index}" data-sub-index="${sIndex}" data-field="sub-weight">
          </label>
          <button class="btn btn-danger" data-action="remove-sub" data-comp-index="${index}" data-sub-index="${sIndex}">删除子项</button>
        `;
        subList.appendChild(row);
      });

      const addSubBtn = document.createElement('button');
      addSubBtn.className = 'btn btn-secondary';
      addSubBtn.textContent = '新增子项';
      addSubBtn.dataset.action = 'add-sub';
      addSubBtn.dataset.compIndex = String(index);
      subList.appendChild(addSubBtn);

      card.appendChild(subList);
    }

    container.appendChild(card);
  });

  // 总权重与子项权重提示
  const totalWeight = currentSchema.components.reduce((sum, c) => sum + Number(c.weight || 0), 0);
  const messages = [];
  messages.push(
    `当前所有项目权重之和：${totalWeight}（推荐为 100）。` +
      (totalWeight === 100 ? ' ✅' : ' ⚠️ 请调整到 100 更合理')
  );

  currentSchema.components.forEach(component => {
    if (component.type === 'composite') {
      const subs = component.subcomponents || [];
      const subTotal = subs.reduce((sum, s) => sum + Number(s.weight || 0), 0);
      if (subTotal !== 100) {
        messages.push(
          `「${component.label}」的子项权重之和为 ${subTotal}，推荐为 100，请根据需要调整。`
        );
      }
    }
  });

  const summary = document.getElementById('configSummary');
  summary.innerHTML = messages.map(m => `<div>${m}</div>`).join('');

  renderScoreInputs();
  renderStudentTable();
}

function renderScoreInputs() {
  const container = document.getElementById('scoreInputs');
  container.innerHTML = '';

  currentSchema.components.forEach(component => {
    if (component.type === 'simple') {
      const wrapper = document.createElement('label');
      wrapper.innerHTML = `
        ${component.label}（0-100）
        <input type="number" min="0" max="100" step="0.1" data-score-key="${component.key}">
      `;
      container.appendChild(wrapper);
    } else if (component.type === 'composite') {
      const subs = component.subcomponents || [];
      subs.forEach(sub => {
        const wrapper = document.createElement('label');
        wrapper.innerHTML = `
          ${component.label} - ${sub.label}（0-100）
          <input type="number" min="0" max="100" step="0.1" data-score-key="${component.key}" data-sub-key="${sub.key}">
        `;
        container.appendChild(wrapper);
      });
    }
  });
}

function renderStudentTable() {
  const thead = document.getElementById('studentTableHead');
  const tbody = document.getElementById('studentTableBody');

  // 表头
  const fixedHeaders = `
    <tr>
      <th class="sortable" data-sort="rank">序号</th>
      <th class="sortable" data-sort="name">姓名</th>
      <th class="sortable" data-sort="no">学号</th>
      <th class="sortable" data-sort="total">总成绩</th>
  `;
  let dynamicHeaders = '';
  currentSchema.components.forEach(component => {
    if (component.type === 'simple') {
      dynamicHeaders += `<th>${component.label}</th>`;
    } else if (component.type === 'composite') {
      (component.subcomponents || []).forEach(sub => {
        dynamicHeaders += `<th>${component.label}-${sub.label}</th>`;
      });
    }
  });
  const endHeaders = `<th>操作</th></tr>`;
  thead.innerHTML = fixedHeaders + dynamicHeaders + endHeaders;

  // 排序 & 过滤
  const search = document.getElementById('searchInput').value.trim().toLowerCase();

  const enriched = students.map(s => {
    const { total } = computeScores(s, currentSchema);
    return { ...s, totalScore: total };
  }).filter(s => {
    if (!search) return true;
    return (
      String(s.name || '').toLowerCase().includes(search) ||
      String(s.no || '').toLowerCase().includes(search)
    );
  });

  enriched.sort((a, b) => {
    let va;
    let vb;
    if (currentSortField === 'name') {
      va = (a.name || '').localeCompare(b.name || '', 'zh-CN');
      return currentSortDirection === 'asc' ? va : -va;
    } else if (currentSortField === 'no') {
      va = (a.no || '').localeCompare(b.no || '', 'zh-CN');
      return currentSortDirection === 'asc' ? va : -va;
    } else if (currentSortField === 'total') {
      va = a.totalScore ?? 0;
      vb = b.totalScore ?? 0;
    } else if (currentSortField === 'rank') {
      va = a.rank ?? Number.MAX_SAFE_INTEGER;
      vb = b.rank ?? Number.MAX_SAFE_INTEGER;
    } else {
      va = a.id;
      vb = b.id;
    }

    if (va === vb) return 0;
    if (currentSortDirection === 'asc') {
      return va > vb ? 1 : -1;
    } else {
      return va < vb ? 1 : -1;
    }
  });

  // 渲染行
  tbody.innerHTML = '';
  enriched.forEach((s, index) => {
    const { detail } = computeScores(s, currentSchema);
    const tr = document.createElement('tr');

    let fixedCols = `
      <td>
        <input type="number" min="1" step="1" value="${s.rank ?? ''}" data-rank-id="${s.id}" style="width:70px;">
      </td>
      <td class="editable-cell editable-text" data-student-id="${s.id}" data-field="name">${s.name || ''}</td>
      <td class="editable-cell editable-text" data-student-id="${s.id}" data-field="no">${s.no || ''}</td>
      <td>${s.totalScore ?? ''}</td>
    `;

    let scoreCols = '';
    currentSchema.components.forEach(component => {
      if (component.type === 'simple') {
        const d = detail[component.key];
        const rawValue = d ? d.raw : '';
        scoreCols += `<td class="editable-cell" data-student-id="${s.id}" data-component-key="${component.key}" data-sub-key="">${rawValue}</td>`;
      } else if (component.type === 'composite') {
        (component.subcomponents || []).forEach(sub => {
          const d = detail[component.key]?.subDetail?.[sub.key];
          const rawValue = d ? d.raw : '';
          scoreCols += `<td class="editable-cell" data-student-id="${s.id}" data-component-key="${component.key}" data-sub-key="${sub.key}">${rawValue}</td>`;
        });
      }
    });

    const actionCol = `
      <td>
        <div class="table-actions">
          <button class="btn btn-success edit-save-btn" data-action="save" data-id="${s.id}" style="display:none;">保存</button>
          <button class="btn btn-outline edit-cancel-btn" data-action="cancel" data-id="${s.id}" style="display:none;">取消</button>
          <button class="btn btn-secondary edit-start-btn" data-action="edit" data-id="${s.id}">编辑</button>
          <button class="btn btn-danger" data-action="delete" data-id="${s.id}">删除</button>
        </div>
      </td>
    `;

    tr.innerHTML = fixedCols + scoreCols + actionCol;
    tbody.appendChild(tr);
  });
}

// 表单处理
function readScoresFromForm() {
  const scores = {};
  const inputs = document.querySelectorAll('#scoreInputs input[type="number"]');

  inputs.forEach(input => {
    const compKey = input.dataset.scoreKey;
    const subKey = input.dataset.subKey;
    const valStr = input.value.trim();
    if (valStr === '') return;
    const val = Number(valStr);
    if (Number.isNaN(val)) return;

    if (subKey) {
      if (!scores[compKey]) scores[compKey] = {};
      scores[compKey][subKey] = val;
    } else {
      scores[compKey] = val;
    }
  });

  return scores;
}

function fillFormWithStudent(student) {
  document.getElementById('studentId').value = student.id ?? '';
  document.getElementById('studentName').value = student.name ?? '';
  document.getElementById('studentNo').value = student.no ?? '';
  document.getElementById('studentRank').value = student.rank ?? '';

  const inputs = document.querySelectorAll('#scoreInputs input[type="number"]');
  inputs.forEach(input => {
    const compKey = input.dataset.scoreKey;
    const subKey = input.dataset.subKey;
    let value = '';
    if (subKey) {
      value = student.scores?.[compKey]?.[subKey] ?? '';
    } else {
      value = student.scores?.[compKey] ?? '';
    }
    input.value = value;
  });
}

function resetForm() {
  document.getElementById('studentId').value = '';
  document.getElementById('studentName').value = '';
  document.getElementById('studentNo').value = '';
  document.getElementById('studentRank').value = '';

  const inputs = document.querySelectorAll('#scoreInputs input[type="number"]');
  inputs.forEach(input => (input.value = ''));
}

// 保存配置的辅助函数
function saveConfigValue(target) {
  const compIndex = Number(target.dataset.compIndex);
  const field = target.dataset.field;
  if (Number.isNaN(compIndex) || !field) return;

  const component = currentSchema.components[compIndex];
  if (!component) return;

  if (field === 'label') {
    component.label = target.value.trim() || component.label;
  } else if (field === 'weight') {
    component.weight = Number(target.value || 0);
  } else if (field === 'type') {
    component.type = target.value;
    if (component.type === 'composite' && !component.subcomponents) {
      component.subcomponents = [
        { key: `${component.key}1`, label: `${component.label}1`, weight: 100 }
      ];
    }
  } else if (field === 'sub-label') {
    const subIndex = Number(target.dataset.subIndex);
    const sub = component.subcomponents?.[subIndex];
    if (sub) {
      sub.label = target.value.trim() || sub.label;
    }
  } else if (field === 'sub-weight') {
    const subIndex = Number(target.dataset.subIndex);
    const sub = component.subcomponents?.[subIndex];
    if (sub) {
      sub.weight = Number(target.value || 0);
    }
  }

  saveSchema(currentSchema).then(() => {
    renderSchemaConfig();
  });
}

// 新增：构建导出所用二维数组（AOA）
function buildExportAoA() {
  // 构建表头
  const headers = ['序号', '姓名', '学号', '总成绩'];
  currentSchema.components.forEach(component => {
    if (component.type === 'simple') {
      headers.push(component.label);
    } else if (component.type === 'composite') {
      (component.subcomponents || []).forEach(sub => {
        headers.push(`${component.label}-${sub.label}`);
      });
    }
  });

  // 与渲染表格相同的过滤与排序
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const enriched = students
    .map(s => {
      const { total } = computeScores(s, currentSchema);
      return { ...s, totalScore: total };
    })
    .filter(s => {
      if (!search) return true;
      return (
        String(s.name || '').toLowerCase().includes(search) ||
        String(s.no || '').toLowerCase().includes(search)
      );
    });

  enriched.sort((a, b) => {
    let va;
    let vb;
    if (currentSortField === 'name') {
      va = (a.name || '').localeCompare(b.name || '', 'zh-CN');
      return currentSortDirection === 'asc' ? va : -va;
    } else if (currentSortField === 'no') {
      va = (a.no || '').localeCompare(b.no || '', 'zh-CN');
      return currentSortDirection === 'asc' ? va : -va;
    } else if (currentSortField === 'total') {
      va = a.totalScore ?? 0;
      vb = b.totalScore ?? 0;
    } else if (currentSortField === 'rank') {
      va = a.rank ?? Number.MAX_SAFE_INTEGER;
      vb = b.rank ?? Number.MAX_SAFE_INTEGER;
    } else {
      va = a.id;
      vb = b.id;
    }
    if (va === vb) return 0;
    if (currentSortDirection === 'asc') {
      return va > vb ? 1 : -1;
    } else {
      return va < vb ? 1 : -1;
    }
  });

  // 构建数据行
  const rows = enriched.map(s => {
    const { detail } = computeScores(s, currentSchema);
    const row = [
      s.rank ?? '',
      s.name || '',
      s.no || '',
      s.totalScore ?? ''
    ];
    currentSchema.components.forEach(component => {
      if (component.type === 'simple') {
        const d = detail[component.key];
        row.push(d ? d.raw : '');
      } else if (component.type === 'composite') {
        (component.subcomponents || []).forEach(sub => {
          const d = detail[component.key]?.subDetail?.[sub.key];
          row.push(d ? d.raw : '');
        });
      }
    });
    return row;
  });

  return [headers, ...rows];
}

// 新增：动态加载 XLSX 库（若未加载则从 CDN 自动加载）
function loadXLSX() {
  return new Promise((resolve, reject) => {
    if (typeof XLSX !== 'undefined') {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('XLSX 库加载失败'));
    document.head.appendChild(script);
  });
}

// 修改：导出 Excel 方法，若未加载 XLSX 则自动加载后再导出
async function exportExcel() {
  try {
    await loadXLSX();
  } catch (err) {
    alert('导出功能依赖 XLSX 库加载失败，请检查网络或脚本引入是否成功。');
    return;
  }
  const aoa = buildExportAoA();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, '成绩表');
  XLSX.writeFile(wb, '学生成绩.xlsx');
}

// 新增：导出数据库为 JSON 文件到用户选择的目录（可选择项目目录）
async function exportDbToJsonFile() {
  try {
    const [schema, studentList] = await Promise.all([getSchema(), getAllStudents()]);
    const data = {
      schema,
      students: studentList,
      version: DB_VERSION,
      exportedAt: new Date().toISOString()
    };

    // 支持 File System Access API：用户选择目录后直接写入文件
    if (window.showDirectoryPicker) {
      const dirHandle = await window.showDirectoryPicker();
      const fileHandle = await dirHandle.getFileHandle('grade_manager_db.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      await writable.close();
      alert('已导出到选定目录：grade_manager_db.json');
    } else {
      // 回退方案：触发浏览器下载，用户将文件保存到项目目录
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'grade_manager_db.json';
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
      alert('已生成下载文件：grade_manager_db.json，请保存到项目目录。');
    }
  } catch (err) {
    console.error('导出失败', err);
    alert('导出失败，请查看控制台错误信息。');
  }
}

// 新增：从 JSON 文件导入数据库（从项目目录中选择 grade_manager_db.json）
async function importDbFromJsonFile() {
  try {
    let file;
    if (window.showOpenFilePicker) {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }]
      });
      file = await fileHandle.getFile();
    } else {
      alert('当前浏览器不支持文件选择，请使用 Chrome 86+ 或在页面中放置 <input type="file"> 手动选择。');
      return;
    }

    const text = await file.text();
    const data = JSON.parse(text);

    if (!data || !Array.isArray(data.students) || !data.schema) {
      alert('导入文件格式不正确，缺少 schema 或 students 字段。');
      return;
    }

    // 写入配置
    await saveSchema(data.schema);

    // 清空并写入学生数据（保留原 id）
    await withStore(STUDENT_STORE, 'readwrite', (store) => {
      store.clear();
      data.students.forEach(stu => store.put(stu));
    });

    // 刷新内存态并重绘
    const [schema, all] = await Promise.all([getSchema(), getAllStudents()]);
    currentSchema = schema;
    students = all;
    renderSchemaConfig();
    renderStudentTable();

    alert('导入完成。');
  } catch (err) {
    console.error('导入失败', err);
    alert('导入失败，请查看控制台错误信息。');
  }
}

// 内联编辑功能
let editingStudentId = null;
let editingCell = null;
let originalValues = {};

// 鼠标拖动滚动功能
let isDragging = false;
let startX = 0;
let scrollLeft = 0;

function startInlineEdit(studentId, cellToEdit = null) {
  if (editingStudentId && editingStudentId !== studentId) {
    cancelInlineEdit(editingStudentId);
  }
  
  if (editingStudentId !== studentId) {
    // 只有当切换到不同学生时，才重置originalValues
    originalValues = {};
  }
  
  editingStudentId = studentId;
  editingCell = cellToEdit;
  
  const row = document.querySelector(`tr:has([data-id="${studentId}"])`);
  if (!row) return;
  
  // 为所有可编辑单元格创建输入框，以便tab键导航
  const editableCells = row.querySelectorAll('.editable-cell');
  let focusInput = null;
  
  editableCells.forEach(cell => {
    const componentKey = cell.dataset.componentKey;
    const subKey = cell.dataset.subKey;
    const field = cell.dataset.field;
    const currentValue = cell.textContent.trim();
    
    // 保存原始值
    let key;
    if (field) {
      key = field;
    } else if (subKey) {
      key = `${componentKey}.${subKey}`;
    } else {
      key = componentKey;
    }
    
    // 只有当该键还没有被保存时，才保存原始值
    if (!originalValues[key]) {
      originalValues[key] = currentValue;
    }
    
    // 创建输入框
    const input = document.createElement('input');
    
    if (field === 'name' || field === 'no') {
      // 文本字段（姓名、学号）
      input.type = 'text';
      input.placeholder = field === 'name' ? '姓名' : '学号';
      input.style.width = '100px';
      input.maxLength = field === 'no' ? 20 : 50;
      input.value = currentValue;
    } else {
      // 成绩字段
      input.type = 'number';
      input.min = '0';
      input.max = '100';
      input.step = '0.1';
      input.style.width = '60px';
      input.placeholder = '0-100';
      // 如果当前值为0，则清空输入框
      input.value = currentValue === '0' ? '' : currentValue;
    }
    
    input.className = 'inline-edit-input';
    
    // 添加Enter键保存功能
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveInlineEdit(studentId);
      }
    });
    
    // 添加输入事件监听器，实现输入框自动变宽
    input.addEventListener('input', () => {
      // 创建一个临时元素来计算文本宽度
      const tempEl = document.createElement('span');
      tempEl.style.position = 'absolute';
      tempEl.style.left = '-9999px';
      tempEl.style.top = '-9999px';
      tempEl.style.whiteSpace = 'nowrap';
      tempEl.style.fontSize = window.getComputedStyle(input).fontSize;
      tempEl.style.fontFamily = window.getComputedStyle(input).fontFamily;
      tempEl.textContent = input.value;
      document.body.appendChild(tempEl);
      
      // 计算文本宽度并调整输入框宽度
      const width = tempEl.offsetWidth + 20; // 加上一些 padding
      input.style.width = Math.max(width, 60) + 'px'; // 确保最小宽度为60px
      
      // 移除临时元素
      document.body.removeChild(tempEl);
    });
    
    // 初始触发一次input事件，设置输入框的初始宽度
    const inputEvent = new Event('input');
    input.dispatchEvent(inputEvent);
    
    cell.innerHTML = '';
    cell.appendChild(input);
    
    // 只将焦点设置在被双击的单元格的输入框上
    if (cell === cellToEdit) {
      focusInput = input;
    }
  });
  
  // 设置焦点到被双击的单元格的输入框
  if (focusInput) {
    focusInput.focus();
    focusInput.select();
  }
  
  // 切换按钮显示
  const startBtn = row.querySelector('.edit-start-btn');
  const saveBtn = row.querySelector('.edit-save-btn');
  const cancelBtn = row.querySelector('.edit-cancel-btn');
  
  if (startBtn) startBtn.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'inline-block';
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  
  // 添加行编辑样式
  row.classList.add('editing-row');
  
  // 为表格包装器添加编辑模式样式，确保滚动条可见
  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper) {
    tableWrapper.classList.add('editing-mode');
  }
}

async function saveInlineEdit(studentId) {
  const row = document.querySelector(`tr:has([data-id="${studentId}"])`);
  if (!row) return;
  
  const student = students.find(s => s.id === studentId);
  if (!student) return;
  
  // 收集所有可编辑单元格的新值，而不仅仅是当前编辑的单元格
  const editableCells = row.querySelectorAll('.editable-cell');
  
  let hasChanges = false;
  let newName = student.name;
  let newNo = student.no;
  
  editableCells.forEach(cell => {
    const input = cell.querySelector('input');
    if (!input) return;
    
    const componentKey = cell.dataset.componentKey;
    const subKey = cell.dataset.subKey;
    const field = cell.dataset.field;
    const newValue = input.value.trim();
    let key;
    
    if (field) {
      key = field;
    } else if (subKey) {
      key = `${componentKey}.${subKey}`;
    } else {
      key = componentKey;
    }
    
    const oldValue = originalValues[key] || '';
    
    if (newValue !== oldValue) {
      hasChanges = true;
      
      if (field === 'name') {
        newName = newValue;
      } else if (field === 'no') {
        newNo = newValue;
      } else {
        // 成绩字段
        if (!student.scores) {
          student.scores = {};
        }
        
        if (subKey) {
          if (!student.scores[componentKey]) {
            student.scores[componentKey] = {};
          }
          student.scores[componentKey][subKey] = newValue === '' ? 0 : Number(newValue);
        } else {
          student.scores[componentKey] = newValue === '' ? 0 : Number(newValue);
        }
      }
    }
  });
  
  if (!hasChanges) {
    cancelInlineEdit(studentId);
    return;
  }
  
  // 验证必填字段
  if (!newName.trim() || !newNo.trim()) {
    alert('姓名和学号不能为空！');
    return;
  }
  
  // 检查学号重复
  const noExists = await checkStudentNoExists(newNo, studentId);
  if (noExists) {
    alert('该学号已存在，请使用不同的学号！');
    return;
  }
  
  // 更新学生信息
  student.name = newName.trim();
  student.no = newNo.trim();
  
  // 移除编辑模式样式
  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper) {
    tableWrapper.classList.remove('editing-mode');
  }
  
  updateStudent(student).then(() => {
    return getAllStudents();
  }).then(data => {
    students = data;
    editingStudentId = null;
    editingCell = null;
    originalValues = {};
    renderStudentTable();
  });
}

function cancelInlineEdit(studentId) {
  editingStudentId = null;
  editingCell = null;
  originalValues = {};
  
  // 移除编辑模式样式
  const tableWrapper = document.querySelector('.table-wrapper');
  if (tableWrapper) {
    tableWrapper.classList.remove('editing-mode');
  }
  
  renderStudentTable();
}

// 事件绑定
function bindEvents() {
  // 成绩结构修改 - 使用 blur 和 keydown 事件，避免输入时跳出来
  document.getElementById('componentList').addEventListener('blur', (e) => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
      if (target.dataset.compIndex !== undefined || target.dataset.subIndex !== undefined) {
        saveConfigValue(target);
      }
    }
  }, true);

  document.getElementById('componentList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        if (target.dataset.compIndex !== undefined || target.dataset.subIndex !== undefined) {
          target.blur(); // 触发 blur 事件来保存
        }
      }
    }
  });

  document.getElementById('componentList').addEventListener('click', (e) => {
    const target = e.target;
    const action = target.dataset.action;
    if (!action) return;

    if (action === 'remove-comp') {
      const compIndex = Number(target.dataset.compIndex);
      if (!Number.isNaN(compIndex)) {
        const removedComponent = currentSchema.components[compIndex];
        const removedWeight = Number(removedComponent.weight || 0);
        
        // 移除项目
        currentSchema.components.splice(compIndex, 1);
        
        // 计算剩余项目数量
        const remainingCount = currentSchema.components.length;
        
        // 调整剩余项目的权重，使总和为100
        if (remainingCount > 0) {
          const totalWeight = currentSchema.components.reduce((sum, c) => sum + Number(c.weight || 0), 0);
          const weightToDistribute = 100 - totalWeight;
          const weightPerItem = weightToDistribute / remainingCount;
          
          currentSchema.components.forEach(component => {
            component.weight = Number(component.weight || 0) + weightPerItem;
          });
        }
        
        saveSchema(currentSchema).then(() => renderSchemaConfig());
      }
    } else if (action === 'add-sub') {
      const compIndex = Number(target.dataset.compIndex);
      const component = currentSchema.components[compIndex];
      if (component && component.type === 'composite') {
        if (!Array.isArray(component.subcomponents)) {
          component.subcomponents = [];
        }
        const newIndex = component.subcomponents.length + 1;
        component.subcomponents.push({
          key: `${component.key}${newIndex}`,
          label: `${component.label}${newIndex}`,
          weight: 0
        });
        saveSchema(currentSchema).then(() => renderSchemaConfig());
      }
    } else if (action === 'remove-sub') {
      const compIndex = Number(target.dataset.compIndex);
      const subIndex = Number(target.dataset.subIndex);
      const component = currentSchema.components[compIndex];
      if (component && Array.isArray(component.subcomponents)) {
        component.subcomponents.splice(subIndex, 1);
        saveSchema(currentSchema).then(() => renderSchemaConfig());
      }
    }
  });

  document.getElementById('addComponentBtn').addEventListener('click', () => {
    const newIndex = currentSchema.components.length + 1;
    
    // 计算现有项目的总权重
    const totalWeight = currentSchema.components.reduce((sum, c) => sum + Number(c.weight || 0), 0);
    
    // 计算每个现有项目需要减少的权重
    const existingCount = currentSchema.components.length;
    const weightToReducePerItem = existingCount > 0 ? totalWeight / existingCount * 0.1 : 0;
    
    // 调整现有项目的权重
    currentSchema.components.forEach(component => {
      component.weight = Math.max(0, Number(component.weight || 0) - weightToReducePerItem);
    });
    
    // 添加新项目，分配10%的权重
    currentSchema.components.push({
      key: `comp${newIndex}`,
      label: `新项目${newIndex}`,
      weight: 10,
      type: 'simple'
    });
    
    saveSchema(currentSchema).then(() => renderSchemaConfig());
  });

  // 学生表单
  document.getElementById('studentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idStr = document.getElementById('studentId').value;
    const name = document.getElementById('studentName').value.trim();
    const no = document.getElementById('studentNo').value.trim();
    const rankStr = document.getElementById('studentRank').value.trim();

    if (!name || !no) {
      alert('请填写姓名和学号');
      return;
    }

    // 检查学号是否重复
    const excludeId = idStr ? Number(idStr) : null;
    const noExists = await checkStudentNoExists(no, excludeId);
    if (noExists) {
      alert('该学号已存在，请使用不同的学号');
      return;
    }

    const rank = rankStr === '' ? null : Number(rankStr);
    const scores = readScoresFromForm();

    const base = {
      name,
      no,
      rank,
      scores
    };

    if (idStr) {
      const id = Number(idStr);
      const existing = students.find(s => s.id === id);
      if (existing) {
        const updated = { ...existing, ...base };
        updateStudent(updated).then(() => {
          return getAllStudents();
        }).then(data => {
          students = data;
          resetForm();
          renderStudentTable();
        });
      }
    } else {
      addStudent(base).then(() => getAllStudents()).then(data => {
        students = data;
        resetForm();
        renderStudentTable();
      });
    }
  });

  document.getElementById('resetFormBtn').addEventListener('click', () => {
    resetForm();
  });

  // 排序
  document.getElementById('applySortBtn').addEventListener('click', () => {
    currentSortField = document.getElementById('sortField').value;
    currentSortDirection = document.getElementById('sortDirection').value;
    renderStudentTable();
  });

  document.getElementById('studentTableHead').addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const field = th.dataset.sort;
    if (!field) return;
    if (currentSortField === field) {
      currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      currentSortField = field;
      currentSortDirection = 'asc';
    }
    document.getElementById('sortField').value = currentSortField;
    document.getElementById('sortDirection').value = currentSortDirection;
    renderStudentTable();
  });

  // 搜索
  document.getElementById('searchInput').addEventListener('input', () => {
    renderStudentTable();
  });

  // 编辑 / 删除 / 手动排序
  document.getElementById('studentTableBody').addEventListener('click', (e) => {
    const target = e.target;
    const action = target.dataset.action;
    if (!action) return;
    const id = Number(target.dataset.id);
    if (Number.isNaN(id)) return;

    if (action === 'edit') {
      startInlineEdit(id);
    } else if (action === 'save') {
      saveInlineEdit(id);
    } else if (action === 'cancel') {
      cancelInlineEdit(id);
    } else if (action === 'delete') {
      if (confirm('确定要删除该学生吗？')) {
        deleteStudent(id).then(() => getAllStudents()).then(data => {
          students = data;
          renderStudentTable();
        });
      }
    }
  });

  // 处理可编辑单元格的双击事件
  document.getElementById('studentTableBody').addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.editable-cell');
    if (!cell) return;
    const studentId = Number(cell.dataset.studentId);
    if (!Number.isNaN(studentId)) {
      startInlineEdit(studentId, cell);
    }
  });

  // 鼠标中键拖动滚动功能
  const tableWrapper = document.querySelector('.table-wrapper');
  
  if (tableWrapper) {
    // 鼠标按下
    tableWrapper.addEventListener('mousedown', (e) => {
      // 只响应中键点击
      if (e.button !== 1) return;
      
      e.preventDefault();
      isDragging = true;
      tableWrapper.classList.add('dragging');
      
      startX = e.pageX;
      scrollLeft = tableWrapper.scrollLeft;
      
      return false;
    });

    // 鼠标移动
    tableWrapper.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      
      const x = e.pageX;
      const walk = (startX - x) * 1.5; // 滚动速度，调整为正向
      tableWrapper.scrollLeft = scrollLeft + walk;
    });

    // 鼠标释放
    const stopDragging = () => {
      isDragging = false;
      tableWrapper.classList.remove('dragging');
    };

    tableWrapper.addEventListener('mouseup', stopDragging);
    tableWrapper.addEventListener('mouseleave', stopDragging);
    
    // 防止中键默认行为和文本选择
    tableWrapper.addEventListener('selectstart', (e) => {
      if (isDragging) {
        e.preventDefault();
        return false;
      }
    });
  }

  document.getElementById('studentTableBody').addEventListener('change', (e) => {
    const target = e.target;
    const rankId = target.dataset.rankId;
    if (!rankId) return;
    const id = Number(rankId);
    if (Number.isNaN(id)) return;

    const stu = students.find(s => s.id === id);
    if (!stu) return;

    const valStr = target.value.trim();
    const rank = valStr === '' ? null : Number(valStr);
    stu.rank = rank;
    updateStudent(stu).then(() => getAllStudents()).then(data => {
      students = data;
      renderStudentTable();
    });
  });
}

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  Promise.all([getSchema(), getAllStudents()])
    .then(([schema, data]) => {
      currentSchema = schema;
      students = data;
      renderSchemaConfig();
      bindEvents();
      renderStudentTable();
      initImportDataHandlers();
    })
    .catch(err => {
      console.error('初始化失败', err);
      alert('初始化失败，请查看控制台错误信息。');
    });
});

// 新增：导出按钮事件绑定（确保点击有响应）
const exportBtn = document.getElementById('exportExcelBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    exportExcel();
  });
}

// 新增：导出数据库按钮事件绑定（如果页面存在对应按钮）
const exportDbBtn = document.getElementById('exportDbBtn');
if (exportDbBtn) {
  exportDbBtn.addEventListener('click', () => {
    exportDbToJsonFile();
  });
}

// 新增：导入数据按钮与文件选择处理
function initImportDataHandlers() {
  const importBtn = document.getElementById('importDataBtn');
  const importInput = document.getElementById('importDataInput');

  if (!importBtn || !importInput) return;

  // 点击“导入数据”按钮时，打开隐藏的文件选择框
  importBtn.addEventListener('click', () => {
    importInput.click();
  });

  // 选择文件后，按扩展名处理（JSON 或 Excel）
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'json') {
        const text = await file.text();
        const payload = JSON.parse(text);
        
        // 验证JSON文件结构
        if (!payload || (!payload.students && !payload.schema)) {
          alert('JSON文件格式不正确，缺少students或schema字段');
          return;
        }
        
        // 保存schema（如果存在）
        if (payload.schema) {
          await saveSchema(payload.schema);
        }
        
        // 保存students（如果存在）
        if (payload.students && Array.isArray(payload.students)) {
          // 清空现有学生数据
          await withStore(STUDENT_STORE, 'readwrite', (store) => {
            store.clear();
            // 保存新学生数据，自动生成ID
            payload.students.forEach(stu => {
              // 移除原有ID，让数据库自动生成新ID
              const { id, ...stuWithoutId } = stu;
              store.add(stuWithoutId);
            });
          });
        }
        
        // 刷新数据和界面
        const [schema, allStudents] = await Promise.all([getSchema(), getAllStudents()]);
        currentSchema = schema;
        students = allStudents;
        renderSchemaConfig();
        renderStudentTable();
        
        alert('JSON文件导入成功！');
      } else if (ext === 'xlsx' || ext === 'xls') {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
        
        // 验证Excel数据
        if (!rows || rows.length === 0) {
          alert('Excel文件中没有数据');
          return;
        }
        
        // 处理Excel数据，转换为学生对象
        const importedStudents = [];
        
        rows.forEach(row => {
          // 提取基本信息
          const name = row['姓名'] || row['name'] || '';
          const no = row['学号'] || row['no'] || '';
          const rank = row['序号'] || row['rank'] || null;
          
          if (!name || !no) return; // 跳过缺少姓名或学号的行
          
          const student = {
            name: name.toString().trim(),
            no: no.toString().trim(),
            rank: rank ? Number(rank) : null,
            scores: {}
          };
          
          // 处理成绩数据
          currentSchema.components.forEach(component => {
            if (component.type === 'simple') {
              // 简单类型成绩
              const scoreValue = row[component.label] || row[component.key];
              if (scoreValue) {
                student.scores[component.key] = Number(scoreValue);
              }
            } else if (component.type === 'composite') {
              // 复合类型成绩
              student.scores[component.key] = {};
              component.subcomponents.forEach(sub => {
                const scoreValue = row[`${component.label}-${sub.label}`] || row[sub.key];
                if (scoreValue) {
                  student.scores[component.key][sub.key] = Number(scoreValue);
                }
              });
            }
          });
          
          importedStudents.push(student);
        });
        
        if (importedStudents.length === 0) {
          alert('Excel文件中没有有效的学生数据');
          return;
        }
        
        // 清空现有学生数据并保存新数据
        await withStore(STUDENT_STORE, 'readwrite', (store) => {
          store.clear();
          importedStudents.forEach(stu => store.add(stu));
        });
        
        // 刷新数据和界面
        students = await getAllStudents();
        renderStudentTable();
        
        alert(`Excel文件导入成功！共导入 ${importedStudents.length} 名学生的数据`);
      } else {
        alert('不支持的文件格式：' + ext);
      }
    } catch (err) {
      console.error('导入失败', err);
      alert('导入失败：' + (err && err.message ? err.message : err));
    } finally {
      // 重置 input 以便下次选择同一个文件也能触发 change
      e.target.value = '';
    }
  });
}

