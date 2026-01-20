import { 
    collection, addDoc, onSnapshot, query, where, 
    doc, deleteDoc, updateDoc, getDocs, writeBatch, orderBy 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- CONTROL DE ACCESO ---
onAuthStateChanged(window.auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
    }
});

// --- ESTADO LOCAL ---
let boletas = [];
let historial = [];
let empleados = [];
let proveedores = [];
let ventasDiarias = [];
let currentFilter = 'todos';

// --- UTILIDADES ---
function getFechaOperativa() {
    const ahora = new Date();
    if (ahora.getHours() < 4) {
        ahora.setDate(ahora.getDate() - 1);
    }
    const y = ahora.getFullYear();
    const m = String(ahora.getMonth() + 1).padStart(2, '0');
    const d = String(ahora.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateForDisplay(isoDate) {
    if (!isoDate) return 'N/A';
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    // Fecha actual formateada
    const today = new Date();
    document.getElementById('current-date').innerText = today.toLocaleDateString('es-AR', { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    });

    // Iniciar escuchas
    setupListeners();

    // Evento para el botón
    const btnCerrar = document.getElementById('btn-cerrar-caja');
    if (btnCerrar) btnCerrar.onclick = handleCerrarCaja;

    // --- NUEVO: HABILITAR ENTER EN CIERRE DE CAJA ---
const inputMonto = document.getElementById('venta-monto');
if (inputMonto) {
    inputMonto.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleCerrarCaja();
        }
    });
}
});
// --- ESCUCHAS FIRESTORE ---
function setupListeners() {
    onSnapshot(collection(window.db, "empleados"), (snapshot) => {
        empleados = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateEmpleadosTable();
    });

    onSnapshot(collection(window.db, "proveedores"), (snapshot) => {
        proveedores = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateProveedoresGrid();
    });

    onSnapshot(collection(window.db, "boletas"), (snapshot) => {
        boletas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateBoletasTable();
        updateDashboard();
    });

    onSnapshot(collection(window.db, "ventas"), (snapshot) => {
        ventasDiarias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateVentasUI();
    });

    onSnapshot(query(collection(window.db, "historial"), orderBy("fechaCierre", "desc")), (snapshot) => {
        historial = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateHistorialTable();
    });
}

// --- UI HELPERS ---
function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-msg bg-slate-900 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 border-l-4 border-green-500';
    toast.innerHTML = `<i class="fas fa-check-circle text-green-500"></i> <span class="text-sm font-bold">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function customConfirm({ title, text, okText = 'Confirmar', type = 'blue' }) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        const content = document.getElementById('confirm-content');
        const titleEl = document.getElementById('confirm-title');
        const textEl = document.getElementById('confirm-text');
        const btnOk = document.getElementById('btn-confirm-ok');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const iconEl = document.getElementById('confirm-icon');

        titleEl.innerText = title; 
        textEl.innerText = text; 
        btnOk.innerText = okText;
        
        btnOk.className = type === 'red' 
            ? "flex-1 py-3 px-4 rounded-lg font-bold text-white bg-red-500 hover:bg-red-600 transition"
            : "flex-1 py-3 px-4 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition";
            
        iconEl.innerHTML = type === 'red' 
            ? '<i class="fas fa-trash-alt text-2xl text-red-600"></i>'
            : '<i class="fas fa-question text-2xl text-blue-600"></i>';
            
        iconEl.className = `w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${type === 'red' ? 'bg-red-50' : 'bg-blue-50'}`;

        modal.classList.remove('hidden');
        setTimeout(() => content.classList.add('confirm-animate'), 10);

        function close(res) {
            content.classList.remove('confirm-animate');
            setTimeout(() => { modal.classList.add('hidden'); resolve(res); }, 200);
        }
        btnOk.onclick = () => close(true);
        btnCancel.onclick = () => close(false);
    });
}

// --- NAVEGACIÓN ---
window.showSection = function(sectionId) {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById('sec-' + sectionId);
    if(target) target.classList.remove('hidden');

    const titles = { 
        'dashboard': 'Dashboard', 'boletas': 'Gastos semanales', 
        'empleados': 'Gestión de personal', 'proveedores': 'Proveedores', 
        'historial': 'Historial semanal', 'ventas': 'Ventas diarias' 
    };
    document.getElementById('section-title').innerText = titles[sectionId] || "Sección";
    
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active-link'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if(btn.getAttribute('onclick')?.includes(`'${sectionId}'`)) btn.classList.add('active-link');
    });
};

window.logout = async function() {
    if(await customConfirm({ title: 'Cerrar sesión', text: '¿Deseas salir del sistema?', okText: 'Salir' })) {
        await signOut(window.auth);
    }
};

window.openModal = function(id) { 
    const modal = document.getElementById(id);
    if (!modal) return;
    
    modal.classList.remove('hidden'); 

    // Si abrimos el modal de empleados, reseteamos todo
    if(id === 'modal-empleado') {
        const form = document.getElementById('form-empleado');
        form.reset(); // Borra todos los inputs visibles
        document.getElementById('emp-index').value = ""; // Borra el ID oculto (CRUCIAL)
        document.getElementById('modal-emp-title').innerText = "Nuevo empleado"; // Restablece el título
    }

    // Lógica existente para cargar proveedores en el select de boletas
    if(id === 'modal-boleta') {
        const selectProv = document.getElementById('b-proveedor');
        selectProv.innerHTML = '<option value="">Seleccionar Proveedor...</option><option value="Particular">Particular</option>';
        proveedores.forEach(p => {
            const opt = document.createElement('option'); 
            opt.value = p.nombre; 
            opt.textContent = p.nombre; 
            selectProv.appendChild(opt);
        });
    }
};

window.closeModal = function(id) { 
    document.getElementById(id).classList.add('hidden'); 
};

// --- GESTIÓN DE PERSONAL ---
document.getElementById('form-empleado').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('emp-index').value;
    const data = { 
        nombre: document.getElementById('emp-nombre').value, 
        puesto: document.getElementById('emp-puesto').value, 
        sueldo: parseFloat(document.getElementById('emp-sueldo').value) || 0,
        extras: parseFloat(document.getElementById('emp-extras').value) || 0,
        edad: document.getElementById('emp-edad').value,
        ingreso: document.getElementById('emp-ingreso').value,
        tel: document.getElementById('emp-tel').value,
        direccion: document.getElementById('emp-direccion').value,
        vacaciones: document.getElementById('emp-vacaciones').value
    };

    if(id === "") {
        await addDoc(collection(window.db, "empleados"), data);
    } else {
        await updateDoc(doc(window.db, "empleados", id), data);
    }
    closeModal('modal-empleado');
    e.target.reset();
    document.getElementById('emp-index').value = "";
    showToast("Personal actualizado");
};

function updateEmpleadosTable() {
    const table = document.getElementById('table-empleados');
    if(!table) return;
    table.innerHTML = empleados.map((emp) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-4">
                <p class="font-bold text-slate-700">${emp.nombre}</p>
                <p class="text-[10px] text-slate-400">${emp.tel || 'Sin Tel'} ${emp.edad ? `• ${emp.edad} años` : ''}</p>
            </td>
            <td class="p-4">
                <p class="text-slate-500 font-medium">${emp.puesto}</p>
                <div class="mt-1">
                    ${emp.vacaciones ? `<p class="text-[10px] text-orange-600 font-bold"><i class="fas fa-umbrella-beach mr-1"></i> ${emp.vacaciones}</p>` : ''}
                </div>
            </td>
            <td class="p-4">
                <div class="flex flex-col">
                    <span class="font-bold text-blue-600">$${emp.sueldo.toLocaleString('es-AR')}</span>
                    ${emp.extras > 0 ? `<span class="text-[10px] text-green-600 font-black">+ $${emp.extras.toLocaleString('es-AR')} acumulado</span>` : ''}
                </div>
            </td>
            <td class="p-4">
                <div class="flex items-center gap-1">
                    <input type="number" id="q-extra-${emp.id}" placeholder="$" 
                           onkeypress="if(event.key==='Enter') sumarExtraRapido('${emp.id}')"
                           class="w-20 p-1.5 text-xs border rounded-lg outline-none focus:border-green-500 transition">
                    <button onclick="sumarExtraRapido('${emp.id}')" 
                            class="bg-green-500 text-white w-7 h-7 rounded-lg hover:bg-green-600 transition flex items-center justify-center shadow-sm">
                        <i class="fas fa-plus text-[10px]"></i>
                    </button>
                </div>
            </td>
            <td class="p-4 text-right space-x-1">
                <button onclick="cargarSueldoComoGasto('${emp.id}')" class="text-[10px] bg-blue-100 text-blue-700 px-2 py-1.5 rounded-lg font-bold hover:bg-blue-200 transition">PAGAR</button>
                <button onclick="editEmpleado('${emp.id}')" class="text-slate-400 hover:text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                <button onclick="deleteEmpleado('${emp.id}')" class="text-slate-300 hover:text-red-500 p-1"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="p-8 text-center text-slate-400 italic text-sm">Sin personal registrado.</td></tr>';
}

window.cargarSueldoComoGasto = async function(id) {
    const emp = empleados.find(e => e.id === id);
    const totalSueldo = emp.sueldo + (emp.extras || 0);

    if(await customConfirm({ 
        title: 'Cargar Pago', 
        text: `¿Registrar pago de $${totalSueldo.toLocaleString('es-AR')} para ${emp.nombre}? Los extras se reiniciarán a $0.` 
    })) {
        const hoy = new Date();
        // Registrar como gasto pagado
        await addDoc(collection(window.db, "boletas"), {
            tipo: 'Sueldos', 
            proveedor: 'Interno', 
            detalle: `Pago ${emp.nombre} (Base + Extras)`,
            monto: totalSueldo, 
            vencimiento: getFechaOperativa(), 
            pagado: true,
            mes: hoy.getMonth() + 1, 
            anio: hoy.getFullYear()
        });

        // Reiniciar extras del empleado
        await updateDoc(doc(window.db, "empleados", id), { extras: 0 });
        showToast("Sueldo registrado y extras reiniciados");
    }
};

window.editEmpleado = function(id) {
    const emp = empleados.find(e => e.id === id);
    if (!emp) return;

    // Cambiamos el título para que el usuario sepa que está editando
    document.getElementById('modal-emp-title').innerText = "Editar empleado"; 
    
    document.getElementById('emp-index').value = id;
    document.getElementById('emp-nombre').value = emp.nombre;
    document.getElementById('emp-puesto').value = emp.puesto;
    document.getElementById('emp-sueldo').value = emp.sueldo;
    document.getElementById('emp-extras').value = emp.extras || 0;
    document.getElementById('emp-edad').value = emp.edad || "";
    document.getElementById('emp-ingreso').value = emp.ingreso || "";
    document.getElementById('emp-tel').value = emp.tel || "";
    document.getElementById('emp-direccion').value = emp.direccion || "";
    document.getElementById('emp-vacaciones').value = emp.vacaciones || "";
    
    // Abrimos el modal sin pasar por el reset de openModal
    document.getElementById('modal-empleado').classList.remove('hidden'); 
};
window.deleteEmpleado = async function(id) {
    if(await customConfirm({ title: 'Eliminar', text: '¿Borrar empleado permanentemente?', type: 'red' })) {
        await deleteDoc(doc(window.db, "empleados", id));
    }
};

// --- PROVEEDORES ---
document.getElementById('form-proveedor').onsubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(window.db, "proveedores"), {
        nombre: document.getElementById('prov-nombre').value,
        rubro: document.getElementById('prov-rubro').value,
        tel: document.getElementById('prov-tel').value
    });
    closeModal('modal-proveedor');
    e.target.reset();
    showToast("Proveedor guardado");
};

function updateProveedoresGrid() {
    const grid = document.getElementById('grid-proveedores');
    if(!grid) return;
    grid.innerHTML = proveedores.map((p) => `
        <div class="bg-white p-6 rounded-lg border shadow-sm flex justify-between items-start">
            <div><h4 class="font-bold text-lg leading-tight">${p.nombre}</h4>
            <p class="text-blue-600 text-xs font-bold uppercase mt-1 tracking-wider">${p.rubro}</p>
            <p class="text-slate-500 text-sm mt-3"><i class="fas fa-phone mr-1"></i> ${p.tel || 'S/T'}</p></div>
            <button onclick="deleteProveedor('${p.id}')" class="text-slate-300 hover:text-red-500"><i class="fas fa-times-circle"></i></button>
        </div>
    `).join('') || '<p class="col-span-3 text-center p-8 text-slate-400 italic">Sin proveedores.</p>';
}

window.deleteProveedor = async function(id) {
    if(await customConfirm({ title: 'Eliminar', text: '¿Borrar proveedor?', type: 'red' })) {
        await deleteDoc(doc(window.db, "proveedores", id));
    }
};
window.sumarExtraRapido = async function(id) {
    const input = document.getElementById(`q-extra-${id}`);
    const montoASumar = parseFloat(input.value);
    
    if (!montoASumar || montoASumar <= 0) return;

    const emp = empleados.find(e => e.id === id);
    const nuevoTotalExtras = (emp.extras || 0) + montoASumar;

    try {
        await updateDoc(doc(window.db, "empleados", id), {
            extras: nuevoTotalExtras
        });
        
        input.value = ''; // Limpia el campito
        input.blur();    // Quita el foco
        showToast(`+$${montoASumar} extra para ${emp.nombre}`);
    } catch (error) {
        showToast("Error al cargar extra");
    }
};
// --- GASTOS / BOLETAS ---
window.setFilter = function(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active-filter'));
    document.getElementById('filter-' + filter).classList.add('active-filter');
    updateBoletasTable();
};

document.getElementById('form-boleta').onsubmit = async (e) => {
    e.preventDefault();
    const hoy = new Date();
    await addDoc(collection(window.db, "boletas"), {
        tipo: document.getElementById('b-tipo').value,
        proveedor: document.getElementById('b-proveedor').value,
        detalle: document.getElementById('b-detalle').value,
        monto: parseFloat(document.getElementById('b-monto').value),
        vencimiento: document.getElementById('b-vencimiento').value,
        pagado: false, 
        mes: hoy.getMonth() + 1, 
        anio: hoy.getFullYear()
    });
    closeModal('modal-boleta');
    e.target.reset();
    showToast("Gasto registrado");
};

function updateBoletasTable() {
    const table = document.getElementById('table-boletas');
    if(!table) return;
    const hoyFormateado = getFechaOperativa();
    
    let filtradas = boletas.filter(b => {
        const diff = Math.ceil((new Date(b.vencimiento) - new Date(hoyFormateado)) / 86400000);
        if (currentFilter === 'pagado') return b.pagado;
        if (currentFilter === 'pendiente') return !b.pagado && diff >= 0;
        if (currentFilter === 'vencido') return !b.pagado && diff < 0;
        return true; 
    });

    table.innerHTML = filtradas.map((b) => {
        const diff = Math.ceil((new Date(b.vencimiento) - new Date(hoyFormateado)) / 86400000);
        let badge = b.pagado ? 'bg-green-100 text-green-700' : (diff < 0 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-700');
        let text = b.pagado ? 'PAGADO' : (diff < 0 ? 'VENCIDO' : `Faltan ${diff}d`);
        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-4 font-bold text-xs text-slate-400 uppercase">${b.tipo}</td>
                <td class="p-4"><span class="font-bold block text-slate-700">${b.proveedor}</span><span class="text-[10px] text-slate-400 italic">${b.detalle}</span></td>
                <td class="p-4 text-slate-500">${formatDateForDisplay(b.vencimiento)}</td>
                <td class="p-4 font-bold text-slate-800">$${b.monto.toLocaleString('es-AR')}</td>
                <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-black ${badge}">${text}</span></td>
                <td class="p-4 text-right">
                    ${!b.pagado ? `<button onclick="pagar('${b.id}')" class="bg-blue-600 text-white px-3 py-1 rounded text-xs shadow hover:bg-blue-700 transition">PAGAR</button>` : '<i class="fas fa-check-circle text-green-500 text-lg"></i>'}
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="6" class="p-12 text-center text-slate-300 italic">Nada por aquí.</td></tr>';
}

window.pagar = async function(id) {
    const b = boletas.find(x => x.id === id);
    if (await customConfirm({ title: 'Confirmar Pago', text: `¿Marcas como paga esta boleta de $${b.monto.toLocaleString('es-AR')}?` })) {
        await updateDoc(doc(window.db, "boletas", id), { pagado: true });
        showToast("Pago registrado");
    }
};

// --- DASHBOARD ---
function updateDashboard() {
    const hoy = new Date(); 
    const mesA = hoy.getMonth() + 1; 
    const anioA = hoy.getFullYear();
    const hoyF = getFechaOperativa();
    
    let stats = { vencidas: 0, porVencer: 0, pagado: 0, pendiente: 0 };
    let categorias = {};
    let proximosVencimientos = [];

    const actuales = boletas; // En sistema semanal, vemos todo lo actual
    
    actuales.forEach(b => {
        const diff = Math.ceil((new Date(b.vencimiento) - new Date(hoyF)) / 86400000);
        if(b.pagado) {
            stats.pagado += b.monto;
        } else {
            stats.pendiente += b.monto;
            if(diff < 0) stats.vencidas++; 
            else if(diff <= 7) {
                stats.porVencer++;
                proximosVencimientos.push({ proveedor: b.proveedor, monto: b.monto, dias: diff });
            }
        }
        categorias[b.tipo] = (categorias[b.tipo] || 0) + b.monto;
    });

    const kpi = document.getElementById('kpi-cards');
    if(kpi) {
        kpi.innerHTML = `
            <div class="bg-white p-6 rounded-lg shadow-sm border-l-4 border-red-500"><p class="text-slate-500 text-xs font-bold uppercase">Vencidas</p><h3 class="text-3xl font-bold text-red-600 mt-1">${stats.vencidas}</h3></div>
            <div class="bg-white p-6 rounded-lg shadow-sm border-l-4 border-yellow-500"><p class="text-slate-500 text-xs font-bold uppercase">A vencer (7d)</p><h3 class="text-3xl font-bold text-yellow-600 mt-1">${stats.porVencer}</h3></div>
            <div class="bg-white p-6 rounded-lg shadow-sm border-l-4 border-green-500"><p class="text-slate-500 text-xs font-bold uppercase">Pagado Semana</p><h3 class="text-3xl font-bold text-green-600 mt-1">$${stats.pagado.toLocaleString('es-AR')}</h3></div>
            <div class="bg-white p-6 rounded-lg shadow-sm border-l-4 border-blue-500"><p class="text-slate-500 text-xs font-bold uppercase">Deuda Pendiente</p><h3 class="text-3xl font-bold text-blue-600 mt-1">$${stats.pendiente.toLocaleString('es-AR')}</h3></div>
        `;
    }

    const statusEl = document.getElementById('status-message');
    if(statusEl) {
        if(proximosVencimientos.length > 0) {
            proximosVencimientos.sort((a, b) => a.dias - b.dias);
            statusEl.innerHTML = `<div class="space-y-3">${proximosVencimientos.map(v => `
                <div class="flex justify-between items-center bg-slate-50 p-2 rounded border-l-2 border-yellow-400">
                    <div><p class="text-sm font-bold text-slate-700">${v.proveedor}</p><p class="text-[10px] text-slate-500 italic">$${v.monto.toLocaleString('es-AR')}</p></div>
                    <span class="text-[10px] font-black bg-yellow-100 text-yellow-700 px-2 py-1 rounded">FALTAN ${v.dias} DÍAS</span>
                </div>`).join('')}</div>`;
        } else {
            statusEl.innerHTML = `<p class="text-slate-400 italic text-sm text-center py-2">Sin vencimientos próximos.</p>`;
        }
    }

    const total = stats.pagado + stats.pendiente;
    const chart = document.getElementById('category-chart');
    if(chart) {
        chart.innerHTML = Object.entries(categorias).map(([cat, m]) => `
            <div><div class="flex justify-between text-xs mb-1"><span class="font-bold text-slate-500 uppercase">${cat}</span><span class="font-black">$${m.toLocaleString('es-AR')}</span></div><div class="w-full bg-slate-50 h-2 rounded-full overflow-hidden border"><div class="bg-blue-600 h-full" style="width: ${Math.min((m/total)*100, 100)}%"></div></div></div>
        `).join('') || '<p class="text-slate-300 italic text-sm">Sin movimientos.</p>';
    }
}

// --- ACTUALIZACIÓN DE VENTAS CON CÁLCULO HÍBRIDO ---
function updateVentasUI() {
    const table = document.getElementById('table-ventas');
    const totalSemanaDisplay = document.getElementById('ventas-total-mes'); // El ID sigue siendo el mismo por tu HTML
    if (!table || !totalSemanaDisplay) return;

    // 1. Ordenar y mostrar las ventas de la semana actual
    const sortedVentas = [...ventasDiarias].sort((a,b) => b.fecha.localeCompare(a.fecha));
    table.innerHTML = sortedVentas.map((v) => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-4 font-bold text-slate-700">${formatDateForDisplay(v.fecha)}</td>
            <td class="p-4 font-bold text-blue-600">$${v.monto.toLocaleString('es-AR')}</td>
            <td class="p-4 text-right space-x-3">
                <button onclick="editVenta('${v.id}')" class="text-blue-500 hover:text-blue-700"><i class="fas fa-edit"></i></button>
                <button onclick="deleteVenta('${v.id}')" class="text-red-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-8 text-center text-slate-400 italic">No hay registros esta semana.</td></tr>';

    // 2. Calcular Total de la Semana (lo que está en la tabla)
    const totalSemana = ventasDiarias.reduce((acc, v) => acc + v.monto, 0);
    
    // 3. Calcular Total del Mes (Semana actual + Historial del mes vigente)
    const mesActual = new Date().toLocaleString('es-AR', { month: 'long' });
    const totalHistorialMes = historial
        .filter(h => h.periodo.toLowerCase().includes(mesActual.toLowerCase()))
        .reduce((acc, h) => acc + (h.totalVentas || 0), 0);
    
    const totalMesEstimado = totalSemana + totalHistorialMes;

    // 4. Mostrar ambos datos en el cuadro de acumulado
    totalSemanaDisplay.innerHTML = `
        <span class="block text-3xl font-black">$${totalSemana.toLocaleString('es-AR')}</span>
        <span class="block text-[10px] text-blue-400 mt-1 uppercase tracking-wider">Total del mes: $${totalMesEstimado.toLocaleString('es-AR')}</span>
    `;
}
async function handleCerrarCaja() {
    const inputMonto = document.getElementById('venta-monto');
    const monto = parseFloat(inputMonto.value);
    if (!monto || monto <= 0) return showToast("Monto inválido");

    const hoy = getFechaOperativa(); 
    const existe = ventasDiarias.find(v => v.fecha === hoy);

    if (existe) {
        if(!(await customConfirm({ title: 'Ya registrado', text: `¿Sobrescribir el cierre de hoy?` }))) return;
        await deleteDoc(doc(window.db, "ventas", existe.id));
    }

    await addDoc(collection(window.db, "ventas"), { fecha: hoy, monto: monto });
    inputMonto.value = '';
    showToast("Cierre de caja guardado");
}

window.editVenta = function(id) {
    const v = ventasDiarias.find(x => x.id === id);
    document.getElementById('venta-monto').value = v.monto;
    document.getElementById('venta-monto').focus();
};

window.deleteVenta = async function(id) {
    if(await customConfirm({ title: 'Eliminar', text: '¿Borrar registro?', type: 'red' })) {
        await deleteDoc(doc(window.db, "ventas", id));
    }
};

// --- FINALIZAR SEMANA ---
window.confirmarFinalizarMes = async function() {
    if(await customConfirm({ 
        title: 'Finalizar Semana', 
        text: 'Se archivarán los gastos pagados y ventas. Las tablas se vaciarán para la nueva semana.' 
    })) {
        const batch = writeBatch(window.db);
        const hoy = new Date();
        const periodo = "Semana del " + hoy.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        const totalGastos = boletas.filter(b => b.pagado).reduce((acc, b) => acc + b.monto, 0);
        const totalVentas = ventasDiarias.reduce((acc, v) => acc + v.monto, 0);

        const histRef = doc(collection(window.db, "historial"));
        batch.set(histRef, {
            periodo, 
            cant: boletas.filter(b => b.pagado).length,
            totalGastos, 
            totalVentas,
            fechaCierre: new Date().toISOString()
        });

        boletas.filter(b => b.pagado).forEach(b => batch.delete(doc(window.db, "boletas", b.id)));
        ventasDiarias.forEach(v => batch.delete(doc(window.db, "ventas", v.id)));

        await batch.commit();
        showToast("Semana finalizada y archivada");
    }
};

window.updateHistorialTable = function() {
    const table = document.getElementById('table-historial');
    if(!table) return;
    const queryStr = document.getElementById('history-search').value.toLowerCase();
    const filtrado = historial.filter(h => h.periodo.toLowerCase().includes(queryStr));
    
    table.innerHTML = filtrado.map(h => `
        <tr class="hover:bg-slate-50 transition text-sm">
            <td class="p-4 font-bold text-slate-700">${h.periodo}</td>
            <td class="p-4 text-slate-500 font-medium">${h.cant} boletas</td>
            <td class="p-4 font-black text-green-600">$${(h.totalVentas || 0).toLocaleString('es-AR')}</td>
            <td class="p-4 font-black text-red-600">$${(h.totalGastos || 0).toLocaleString('es-AR')}</td>
            <td class="p-4 text-right"><span class="text-[10px] bg-slate-100 px-3 py-1 rounded-full font-black text-slate-400 uppercase">Archivado</span></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="p-12 text-center text-slate-300 italic">No hay registros históricos.</td></tr>';
};

window.borrarHistorialCompleto = async function() {
    if(await customConfirm({ title: 'Borrar historial', text: 'Se eliminará todo el historial permanentemente.', type: 'red' })) {
        const batch = writeBatch(window.db);
        historial.forEach(h => batch.delete(doc(window.db, "historial", h.id)));
        await batch.commit();
        showToast("Historial eliminado");
    }
};