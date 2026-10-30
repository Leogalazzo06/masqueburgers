import { 
    collection, addDoc, onSnapshot, query, where, 
    doc, deleteDoc, updateDoc, getDocs, writeBatch, orderBy, setDoc, increment 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- GUARD DE DOBLE SUBMIT ---
// Previene que el mismo form se envíe múltiples veces mientras espera a Firebase
const _submitting = new Set();
function withSubmitGuard(formId, submitBtn, asyncFn) {
    return async (e) => {
        e.preventDefault();
        if (_submitting.has(formId)) return;
        _submitting.add(formId);
        if (submitBtn) {
            submitBtn.classList.add('btn-loading');
            submitBtn.disabled = true;
        }
        try {
            await asyncFn(e);
        } catch(err) {
            console.error(err);
            window.showToast && window.showToast('Error al guardar. Intentá de nuevo.', 'error');
        } finally {
            _submitting.delete(formId);
            if (submitBtn) {
                submitBtn.classList.remove('btn-loading');
                submitBtn.disabled = false;
            }
        }
    };
}

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
let sucursales = [];
let filtroSucursal = null; // null = pantalla de sucursales | 'ninguna' (sin sucursal) | id de sucursal
let pagosPersonal = []; // historial propio de pagos de personal (no va a Gastos ni al historial semanal)
let valorHoraExtra = 0; // monto de 1 hora extra, general para todos
let proveedores = [];
let ventasDiarias = [];
let currentFilter = 'todos';

// --- UTILIDADES ---
function getFechaOperativa() {
    const ahora = new Date();
    if (ahora.getHours() < 13) {
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
    onSnapshot(doc(window.db, "config", "general"), (snap) => {
        valorHoraExtra = snap.exists() ? (snap.data().valorHoraExtra || 0) : 0;
        const label = document.getElementById('label-valor-hora');
        if (label) label.innerText = '$' + valorHoraExtra.toLocaleString('es-AR');
        updateEmpleadosTable();
    });

    onSnapshot(collection(window.db, "empleados"), (snapshot) => {
        empleados = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateEmpleadosTable();
    });

    onSnapshot(query(collection(window.db, "pagos_personal"), orderBy("creadoEn", "desc")), (snapshot) => {
        pagosPersonal = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderHistorialPersonal();
    });

    onSnapshot(collection(window.db, "sucursales"), (snapshot) => {
        sucursales = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        renderSucursalSelect();
        updateEmpleadosTable();
        renderHistorialPersonal();
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
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    
    const styles = {
        success: { border: 'border-green-500', icon: 'fa-check-circle text-green-500' },
        error:   { border: 'border-red-500',   icon: 'fa-exclamation-circle text-red-400' },
        warning: { border: 'border-yellow-400', icon: 'fa-exclamation-triangle text-yellow-400' },
    };
    const s = styles[type] || styles.success;
    
    toast.className = `toast-msg bg-slate-900 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 border-l-4 ${s.border}`;
    toast.innerHTML = `<i class="fas ${s.icon}"></i> <span class="text-sm font-bold">${message}</span>`;
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

// Exponer utilidades globales para uso en otros módulos (ej: costos.js)
window.showToast = showToast;
window.customConfirm = customConfirm;

// --- NAVEGACIÓN ---
window.showSection = function(sectionId) {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById('sec-' + sectionId);
    if(target) target.classList.remove('hidden');

    const titles = { 
        'dashboard': 'Dashboard', 'boletas': 'Gastos semanales', 
        'empleados': 'Gestión de personal', 'proveedores': 'Proveedores', 
        'historial': 'Historial semanal', 'ventas': 'Ventas diarias' ,
        'costos': 'Gestión de costos', 'costos': 'Gestión de costos' 
    };
    document.getElementById('section-title').innerText = titles[sectionId] || "Sección";
    if (sectionId === 'empleados' && typeof window.irASucursales === 'function') window.irASucursales();
    
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
        renderSucursalSelect();
        const selSuc = document.getElementById('emp-sucursal');
        if (selSuc && filtroSucursal && filtroSucursal !== 'ninguna') selSuc.value = filtroSucursal;
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
document.getElementById('form-empleado').onsubmit = withSubmitGuard(
    'form-empleado',
    document.querySelector('#modal-empleado button[type="submit"]'),
    async (e) => {
    e.preventDefault();
    const id = document.getElementById('emp-index').value;
    const data = { 
        nombre: document.getElementById('emp-nombre').value, 
        puesto: document.getElementById('emp-puesto').value, 
        sueldo: parseFloat(document.getElementById('emp-sueldo').value) || 0,
        horasExtras: parseFloat(document.getElementById('emp-horas').value) || 0,
        edad: document.getElementById('emp-edad').value,
        ingreso: document.getElementById('emp-ingreso').value,
        tel: document.getElementById('emp-tel').value,
        direccion: document.getElementById('emp-direccion').value,
        vacaciones: document.getElementById('emp-vacaciones').value,
        sucursalId: document.getElementById('emp-sucursal').value || null
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
});

function montoHorasExtra(emp) {
    return (emp.horasExtras || 0) * valorHoraExtra;
}
// Días trabajados (X) todavía sin liquidar, de cualquier semana
function diasPendientes(emp) {
    return Object.values(emp.asistencia || {}).filter(r => r.x && !r.pagado).length;
}
// Horas extra cargadas en días todavía sin liquidar
function horasDeDiasPendientes(emp) {
    return Object.values(emp.asistencia || {}).filter(r => !r.pagado).reduce((s, r) => s + (r.hs || 0), 0);
}
// Horas que no pertenecen a ningún día de la grilla (cargadas antes o a mano desde Editar)
function horasAjuste(emp) {
    return Math.round(((emp.horasExtras || 0) - horasDeDiasPendientes(emp)) * 100) / 100;
}
// El sueldo cargado es el pago por día trabajado
function montoDias(emp) {
    return diasPendientes(emp) * (emp.sueldo || 0);
}
function totalEmpleado(emp) {
    return montoDias(emp) + montoHorasExtra(emp);
}

// --- ASISTENCIA SEMANAL (X por día + horas extra) ---
const DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const fmtARS = (n) => '$' + (n || 0).toLocaleString('es-AR');

function fechaKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function lunesDe(fecha) {
    const x = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}
function fechaDesdeKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}
let semanaInicio = lunesDe(fechaDesdeKey(getFechaOperativa()));

function diasDeLaSemana() {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(semanaInicio);
        d.setDate(d.getDate() + i);
        return d;
    });
}

window.cambiarSemana = function(delta) {
    semanaInicio = new Date(semanaInicio.getFullYear(), semanaInicio.getMonth(), semanaInicio.getDate() + delta * 7);
    updateEmpleadosTable();
};
window.irSemanaActual = function() {
    semanaInicio = lunesDe(fechaDesdeKey(getFechaOperativa()));
    updateEmpleadosTable();
};

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function empleadosVisibles() {
    const input = document.getElementById('buscar-empleado');
    const q = normalizar(input ? input.value : '');
    let base = empleados;
    if (sucursales.length && filtroSucursal) {
        base = base.filter(e => (sucursalDe(e) || 'ninguna') === filtroSucursal);
    }
    if (!q) return base;
    return base.filter(e => normalizar(`${e.nombre} ${e.puesto || ''}`).includes(q));
}

// Sucursal del empleado (si la sucursal fue eliminada, queda "sin sucursal")
function sucursalDe(emp) {
    return sucursales.some(s => s.id === emp.sucursalId) ? emp.sucursalId : null;
}
function nombreSucursal(id) {
    const s = sucursales.find(x => x.id === id);
    return s ? s.nombre : '';
}

function renderSucursalSelect() {
    const sel = document.getElementById('emp-sucursal');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">Sin sucursal</option>' +
        sucursales.map(s => `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');
    sel.value = sucursales.some(s => s.id === prev) ? prev : '';
}

// Pantalla inicial de Personal: elegir sucursal. Devuelve true si se muestra esa pantalla.
function renderVistaSucursal() {
    const landing = document.getElementById('personal-landing');
    const contenido = document.getElementById('personal-contenido');
    const barra = document.getElementById('barra-sucursal');
    if (!landing || !contenido || !barra) return false;

    // Sin sucursales creadas: se muestra todo el personal junto, como antes
    if (!sucursales.length) {
        filtroSucursal = null;
        landing.classList.add('hidden');
        contenido.classList.remove('hidden');
        barra.innerHTML = '';
        return false;
    }
    if (filtroSucursal && filtroSucursal !== 'ninguna' && !sucursales.some(s => s.id === filtroSucursal)) {
        filtroSucursal = null; // la sucursal ya no existe
    }

    const sinSuc = empleados.filter(e => !sucursalDe(e));

    if (!filtroSucursal) {
        const tarjeta = (id, nombre, icono, emps) => {
            const pendiente = emps.reduce((s, e) => s + totalEmpleado(e), 0);
            const conPago = emps.filter(e => totalEmpleado(e) > 0).length;
            return `
            <button onclick="setFiltroSucursal('${id}')" class="text-left bg-white rounded-xl shadow-sm border p-5 hover:border-blue-400 hover:shadow-md transition group">
                <div class="flex items-center gap-3 mb-3">
                    <div class="w-11 h-11 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition"><i class="fas ${icono}"></i></div>
                    <div class="min-w-0">
                        <p class="font-black text-slate-700 text-lg leading-tight truncate">${esc(nombre)}</p>
                        <p class="text-xs text-slate-400">${emps.length} ${emps.length === 1 ? 'empleado' : 'empleados'}</p>
                    </div>
                </div>
                <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-slate-500">A pagar: <span class="text-slate-800">${fmtARS(pendiente)}</span></span>
                    ${conPago ? `<span class="bg-green-50 text-green-700 font-bold px-2 py-1 rounded-full">${conPago} con pago pendiente</span>` : '<span class="text-slate-300">Sin pagos pendientes</span>'}
                </div>
            </button>`;
        };
        landing.innerHTML = `
            <div class="mb-4">
                <h3 class="text-lg font-black text-slate-700">¿Qué sucursal querés ver?</h3>
                <p class="text-xs text-slate-400">Elegí una para ver su personal, la asistencia y su historial de pagos.</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                ${sucursales.map(s => tarjeta(s.id, s.nombre, 'fa-store', empleados.filter(e => sucursalDe(e) === s.id))).join('')}
                ${sinSuc.length ? tarjeta('ninguna', 'Sin sucursal', 'fa-user-friends', sinSuc) : ''}
            </div>`;
        landing.classList.remove('hidden');
        contenido.classList.add('hidden');
        return true;
    }

    landing.classList.add('hidden');
    contenido.classList.remove('hidden');
    const esReal = filtroSucursal !== 'ninguna';
    const nombre = esReal ? nombreSucursal(filtroSucursal) : 'Sin sucursal';
    const cant = empleados.filter(e => (sucursalDe(e) || 'ninguna') === filtroSucursal).length;
    barra.innerHTML = `
        <div class="bg-white rounded-lg shadow-sm border p-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-3">
                <button onclick="irASucursales()" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition">
                    <i class="fas fa-arrow-left mr-1"></i> Sucursales
                </button>
                <h4 class="font-black text-slate-700 text-lg"><i class="fas ${esReal ? 'fa-store' : 'fa-user-friends'} text-blue-500 mr-2"></i>${esc(nombre)}</h4>
                <span class="text-xs text-slate-400">${cant} ${cant === 1 ? 'empleado' : 'empleados'}</span>
            </div>
            ${esReal ? `<div class="flex items-center gap-1">
                <button onclick="editarSucursal('${filtroSucursal}')" class="text-[11px] font-bold text-slate-500 hover:text-blue-600 px-2 py-1" title="Cambiar el nombre"><i class="fas fa-pen mr-1"></i>Renombrar</button>
                <button onclick="eliminarSucursal('${filtroSucursal}')" class="text-[11px] font-bold text-slate-400 hover:text-red-500 px-2 py-1" title="Eliminar sucursal"><i class="fas fa-trash mr-1"></i>Eliminar</button>
            </div>` : ''}
        </div>`;
    return false;
}

window.setFiltroSucursal = function(id) {
    filtroSucursal = id;
    seleccionados.clear(); // la selección de pago masivo no se arrastra entre sucursales
    const buscador = document.getElementById('buscar-empleado');
    if (buscador) buscador.value = '';
    setVistaPersonal('semana');
    updateEmpleadosTable();
    window.scrollTo({ top: 0 });
};

// Volver a la pantalla de elección de sucursal (también al tocar "Personal" en el menú)
window.irASucursales = function() {
    filtroSucursal = null;
    seleccionados.clear();
    const buscador = document.getElementById('buscar-empleado');
    if (buscador) buscador.value = '';
    if (document.getElementById('vista-semana')) setVistaPersonal('semana');
    updateEmpleadosTable();
};

window.abrirNuevaSucursal = function() {
    document.getElementById('modal-suc-title').innerText = 'Nueva sucursal';
    document.getElementById('suc-id').value = '';
    document.getElementById('suc-nombre').value = '';
    document.getElementById('modal-sucursal').classList.remove('hidden');
    setTimeout(() => document.getElementById('suc-nombre').focus(), 50);
};

window.editarSucursal = function(id) {
    const s = sucursales.find(x => x.id === id);
    if (!s) return;
    document.getElementById('modal-suc-title').innerText = 'Renombrar sucursal';
    document.getElementById('suc-id').value = id;
    document.getElementById('suc-nombre').value = s.nombre;
    document.getElementById('modal-sucursal').classList.remove('hidden');
    setTimeout(() => document.getElementById('suc-nombre').focus(), 50);
};

document.getElementById('form-sucursal').onsubmit = withSubmitGuard(
    'form-sucursal',
    document.querySelector('#modal-sucursal button[type="submit"]'),
    async () => {
        const id = document.getElementById('suc-id').value;
        const nombre = document.getElementById('suc-nombre').value.trim();
        if (!nombre) return;
        if (sucursales.some(s => s.id !== id && normalizar(s.nombre) === normalizar(nombre))) {
            showToast('Ya existe una sucursal con ese nombre');
            return;
        }
        if (id) {
            await updateDoc(doc(window.db, "sucursales", id), { nombre });
            showToast('Sucursal renombrada');
        } else {
            const ref = await addDoc(collection(window.db, "sucursales"), { nombre, creadoEn: new Date().toISOString() });
            filtroSucursal = null; // vuelve a la pantalla de sucursales, donde aparece la nueva
            showToast(`Sucursal "${nombre}" creada`);
        }
        closeModal('modal-sucursal');
        updateEmpleadosTable();
    }
);

window.eliminarSucursal = async function(id) {
    const s = sucursales.find(x => x.id === id);
    if (!s) return;
    const emps = empleados.filter(e => sucursalDe(e) === id);
    if (!(await customConfirm({
        title: 'Eliminar sucursal',
        text: `¿Eliminar la sucursal "${s.nombre}"?${emps.length ? ` Sus ${emps.length} ${emps.length === 1 ? 'empleado pasa' : 'empleados pasan'} a "Sin sucursal".` : ''} Los pagos ya registrados conservan el nombre de la sucursal.`,
        type: 'red'
    }))) return;
    try {
        const batch = writeBatch(window.db);
        emps.forEach(e => batch.update(doc(window.db, "empleados", e.id), { sucursalId: null }));
        batch.delete(doc(window.db, "sucursales", id));
        await batch.commit();
        filtroSucursal = null;
        showToast('Sucursal eliminada');
    } catch (err) {
        console.error(err);
        showToast('Error al eliminar la sucursal', 'error');
    }
};

window.moverEmpleado = async function(id, sucursalId) {
    try {
        await updateDoc(doc(window.db, "empleados", id), { sucursalId: sucursalId || null });
        const emp = empleados.find(e => e.id === id);
        showToast(`${emp ? emp.nombre : 'Empleado'} → ${sucursalId ? nombreSucursal(sucursalId) : 'Sin sucursal'}`);
    } catch (err) {
        console.error(err);
        showToast('Error al mover al empleado', 'error');
    }
};



window.limpiarBusquedaEmpleado = function() {
    const input = document.getElementById('buscar-empleado');
    if (input) { input.value = ''; input.focus(); }
    updateEmpleadosTable();
};

window.updateEmpleadosTable = updateEmpleadosTable;
function updateEmpleadosTable() {
    const lista = document.getElementById('lista-empleados');
    if (!lista) return;

    // Solo quedan seleccionados los que existen y tienen algo para pagar
    [...seleccionados].forEach(id => {
        const e = empleados.find(x => x.id === id);
        if (!e || totalEmpleado(e) <= 0) seleccionados.delete(id);
    });
    if (renderVistaSucursal()) return; // se muestra la pantalla de sucursales
    renderBarraPagoMasivo();

    const dias = diasDeLaSemana();
    const hoyKey = getFechaOperativa();
    const corto = { day: 'numeric', month: 'short' };
    const label = document.getElementById('label-semana');
    if (label) {
        label.innerText = `${dias[0].toLocaleDateString('es-AR', corto)} – ${dias[6].toLocaleDateString('es-AR', corto)} ${dias[6].getFullYear()}`;
    }

    const visibles = empleadosVisibles();
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (btnLimpiar) btnLimpiar.classList.toggle('hidden', !document.getElementById('buscar-empleado').value);

    const renderCard = (emp) => {
        const asist = emp.asistencia || {};
        let diasTrab = 0, hsSemana = 0;

        const celdas = dias.map((d, i) => {
            const key = fechaKey(d);
            const r = asist[key] || {};
            const trabajo = !!r.x;
            const pagado = !!r.pagado;
            if (trabajo) diasTrab++;
            hsSemana += r.hs || 0;
            const esHoy = key === hoyKey;

            const btnCls = pagado
                ? 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed'
                : trabajo
                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                    : 'bg-white border-slate-200 text-transparent hover:border-blue-300 hover:bg-blue-50';

            return `
                <div class="flex flex-col items-center gap-1.5 min-w-0">
                    <div class="text-center leading-tight ${esHoy ? 'text-blue-600' : 'text-slate-400'}">
                        <p class="text-[10px] font-black uppercase">${DIAS_CORTO[i]}</p>
                        <p class="text-[11px] ${esHoy ? 'font-black' : 'font-medium'}">${d.getDate()}</p>
                    </div>
                    <button onclick="toggleDia('${emp.id}','${key}')"
                            title="${pagado ? 'Día ya liquidado' : trabajo ? 'Trabajó (tocá para quitar)' : 'Marcar como trabajado'}"
                            class="w-full h-10 rounded-lg border-2 font-black text-base transition ${btnCls}">
                        ${pagado && trabajo ? '<i class="fas fa-lock text-[10px]"></i>' : 'X'}
                    </button>
                    <input type="number" step="0.5" min="0" max="24" placeholder="hs"
                           value="${r.hs > 0 ? r.hs : ''}"
                           ${trabajo && !pagado ? '' : 'disabled'}
                           onchange="setHorasDia('${emp.id}','${key}', this.value)"
                           onkeypress="if(event.key==='Enter') this.blur()"
                           class="w-full p-1 text-center text-xs border rounded-lg outline-none focus:border-green-500 transition
                                  ${r.hs > 0 ? 'bg-green-50 text-green-700 font-bold border-green-200' : ''}
                                  disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed">
                </div>`;
        }).join('');

        const hsPend = emp.horasExtras || 0;
        const diasPend = diasPendientes(emp);
        const ajuste = horasAjuste(emp);
        const pagable = totalEmpleado(emp) > 0;
        const sueldo = emp.sueldo || 0;

        return `
        <div class="bg-white rounded-lg shadow-sm border p-4 space-y-4">
            <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div class="min-w-0">
                    <label class="flex items-center gap-2 ${pagable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}" title="${pagable ? 'Seleccionar para pago masivo' : 'No tiene nada para pagar'}">
                        <input type="checkbox" class="w-4 h-4 accent-blue-600" ${seleccionados.has(emp.id) ? 'checked' : ''} ${pagable ? '' : 'disabled'}
                               onchange="toggleSeleccion('${emp.id}')">
                        <span class="font-bold text-slate-700 text-lg leading-tight">${emp.nombre}</span>
                    </label>
                    <p class="text-xs text-slate-500 font-medium">${emp.puesto || ''}
                        <span class="text-[10px] text-slate-400">${emp.tel ? '• ' + emp.tel : ''} ${emp.edad ? `• ${emp.edad} años` : ''}</span>
                    </p>
                    ${sucursales.length ? `<select onchange="moverEmpleado('${emp.id}', this.value)" title="Cambiar de sucursal"
                            class="mt-1 text-[11px] font-bold text-slate-600 bg-slate-50 border rounded-md px-1.5 py-0.5 outline-none focus:border-blue-500 max-w-full">
                            <option value="">Sin sucursal</option>
                            ${sucursales.map(s => `<option value="${esc(s.id)}" ${sucursalDe(emp) === s.id ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('')}
                        </select>` : ''}
                    ${emp.vacaciones ? `<p class="text-[10px] text-orange-600 font-bold mt-1"><i class="fas fa-umbrella-beach mr-1"></i> ${emp.vacaciones}</p>` : ''}
                </div>
                <div class="flex items-center gap-3 md:text-right">
                    <div class="flex flex-col md:items-end">
                        <span class="text-[10px] uppercase font-bold text-slate-400">Sueldo por día: <span class="text-blue-600">${fmtARS(sueldo)}</span></span>
                        <span class="text-[11px] text-slate-600 font-bold">${diasPend} ${diasPend === 1 ? 'día' : 'días'} × ${fmtARS(sueldo)} = ${fmtARS(montoDias(emp))}</span>
                        ${hsPend > 0 ? `<span class="text-[11px] text-green-600 font-black">+ ${hsPend} hs extra × ${fmtARS(valorHoraExtra)} = ${fmtARS(montoHorasExtra(emp))}</span>` : ''}
                        <span class="text-sm text-slate-800 font-black border-t mt-0.5 pt-0.5">Le corresponde: ${fmtARS(totalEmpleado(emp))}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <button onclick="cargarSueldoComoGasto('${emp.id}')" class="text-[10px] bg-blue-100 text-blue-700 px-2 py-1.5 rounded-lg font-bold hover:bg-blue-200 transition">PAGAR</button>
                        <button onclick="editEmpleado('${emp.id}')" class="text-slate-400 hover:text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteEmpleado('${emp.id}')" class="text-slate-300 hover:text-red-500 p-1"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-7 gap-1.5 sm:gap-2">${celdas}</div>

            <div class="flex flex-wrap items-center gap-2 text-[11px] font-bold">
                ${ajuste !== 0 ? `<span class="bg-amber-50 text-amber-700 border border-amber-200 pl-2 pr-1 py-1 rounded-full flex items-center gap-1">
                    <i class="fas fa-pen mr-0.5"></i>${ajuste > 0 ? '+' : ''}${ajuste} hs extra sin día asignado
                    <button onclick="quitarAjusteHoras('${emp.id}')" class="ml-1 bg-amber-500 text-white px-2 rounded-full hover:bg-amber-600 transition">Quitar</button>
                </span>` : ''}
                <span class="bg-blue-50 text-blue-700 px-2 py-1 rounded-full"><i class="fas fa-calendar-check mr-1"></i>${diasTrab} ${diasTrab === 1 ? 'día trabajado' : 'días trabajados'} esta semana</span>
                <span class="bg-green-50 text-green-700 px-2 py-1 rounded-full"><i class="fas fa-clock mr-1"></i>${hsSemana} hs extra esta semana (${fmtARS(hsSemana * valorHoraExtra)})</span>
            </div>
        </div>`;
    };

    let html;
    if (!visibles.length) {
        html = `<div class="bg-white rounded-lg border p-8 text-center text-slate-400 italic text-sm">${!empleados.length ? 'Sin personal registrado.' : document.getElementById('buscar-empleado').value ? 'Ningún empleado coincide con la búsqueda.' : 'No hay empleados en esta sucursal.'}</div>`;
    } else {
        html = visibles.map(renderCard).join('');
    }
    lista.innerHTML = html;
}

async function guardarDia(id, fecha, x, hs) {
    const emp = empleados.find(e => e.id === id);
    if (!emp) return;
    const prev = (emp.asistencia || {})[fecha] || {};
    if (prev.pagado) { showToast('Ese día ya fue liquidado'); return; }
    const delta = hs - (prev.hs || 0);
    const upd = { [`asistencia.${fecha}`]: { x, hs } };
    if (delta !== 0) upd.horasExtras = increment(delta);
    try {
        await updateDoc(doc(window.db, "empleados", id), upd);
    } catch (err) {
        console.error(err);
        showToast('Error al guardar. Intentá de nuevo.', 'error');
    }
}

window.toggleDia = async function(id, fecha) {
    const emp = empleados.find(e => e.id === id);
    const r = ((emp && emp.asistencia) || {})[fecha] || {};
    if (r.pagado) { showToast('Ese día ya fue liquidado'); return; }
    if (r.x) {
        if (r.hs > 0 && !(await customConfirm({
            title: 'Quitar día',
            text: `Se va a borrar la X y las ${r.hs} hs extra de ${emp.nombre} para ese día. ¿Continuar?`,
            type: 'red'
        }))) return;
        await guardarDia(id, fecha, false, 0);
    } else {
        // Al marcar una X el empleado queda seleccionado para el pago masivo
        seleccionados.add(id);
        await guardarDia(id, fecha, true, 0);
    }
};

window.quitarAjusteHoras = async function(id) {
    const emp = empleados.find(e => e.id === id);
    if (!emp) return;
    const aj = horasAjuste(emp);
    if (aj === 0) return;
    if (!(await customConfirm({
        title: 'Quitar ajuste',
        text: `Se van a quitar ${aj} hs extra sin día asignado de ${emp.nombre}. ¿Continuar?`,
        type: 'red'
    }))) return;
    try {
        await updateDoc(doc(window.db, "empleados", id), { horasExtras: increment(-aj) });
        showToast("Ajuste de horas quitado");
    } catch (err) {
        console.error(err);
        showToast('Error al guardar. Intentá de nuevo.', 'error');
    }
};

window.setHorasDia = async function(id, fecha, valor) {
    const emp = empleados.find(e => e.id === id);
    const r = ((emp && emp.asistencia) || {})[fecha] || {};
    if (!r.x) return;
    const hs = Math.min(24, Math.max(0, parseFloat(valor) || 0));
    if (hs > 0 && !valorHoraExtra) {
        showToast("Cargá el valor de la hora extra (botón verde arriba) para ver el monto");
    }
    await guardarDia(id, fecha, true, hs);
};

// Arma el registro de historial y los cambios al empleado para un pago
function armarPago(emp, loteId) {
    const sueldo = emp.sueldo || 0;
    const valor = valorHoraExtra || 0;
    const hs = emp.horasExtras || 0;
    const dias = diasPendientes(emp);

    // Detalle día por día de lo que se está liquidando
    const detalleDias = Object.entries(emp.asistencia || {})
        .filter(([f, r]) => !r.pagado && (r.x || r.hs > 0))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([f, r]) => ({
            fecha: f,
            trabajo: !!r.x,
            hs: r.hs || 0,
            montoDia: r.x ? sueldo : 0,
            montoHoras: (r.hs || 0) * valor
        }));
    const fechas = detalleDias.map(d => d.fecha);
    const ajusteHs = horasAjuste(emp);

    const pago = {
        empleadoId: emp.id,
        empleadoNombre: emp.nombre,
        puesto: emp.puesto || '',
        tel: emp.tel || '',
        sucursalId: sucursalDe(emp),
        sucursalNombre: nombreSucursal(sucursalDe(emp)),
        sueldoPorDia: sueldo,
        valorHoraExtra: valor,
        diasTrabajados: dias,
        horasExtra: hs,
        horasEnDias: Math.round((hs - ajusteHs) * 100) / 100,
        horasAjuste: ajusteHs,
        montoDias: montoDias(emp),
        montoHorasExtra: montoHorasExtra(emp),
        total: totalEmpleado(emp),
        detalleDias,
        desde: fechas[0] || null,
        hasta: fechas[fechas.length - 1] || null,
        fechaPago: getFechaOperativa(),
        creadoEn: new Date().toISOString(),
        pagoMasivo: !!loteId,
        loteId: loteId || null
    };

    // Dejar liquidados los días y reiniciar las horas
    const upd = { horasExtras: 0 };
    Object.entries(emp.asistencia || {}).forEach(([f, r]) => {
        if (!r.pagado && (r.x || r.hs > 0)) upd[`asistencia.${f}`] = { ...r, pagado: true };
    });
    return { pago, upd };
}

window.cargarSueldoComoGasto = async function(id) {
    const emp = empleados.find(e => e.id === id);
    if (!emp) return;
    const dias = diasPendientes(emp);
    const hs = emp.horasExtras || 0;
    const totalSueldo = totalEmpleado(emp);

    if (totalSueldo <= 0) {
        showToast(`${emp.nombre} no tiene días trabajados ni horas extra para pagar`);
        return;
    }

    const partes = [`${dias} ${dias === 1 ? 'día' : 'días'} trabajados (${fmtARS(montoDias(emp))})`];
    if (hs > 0) partes.push(`${hs} hs extra (${fmtARS(montoHorasExtra(emp))})`);

    if (!(await customConfirm({
        title: 'Registrar pago',
        text: `¿Registrar pago de ${fmtARS(totalSueldo)} para ${emp.nombre}? Incluye ${partes.join(' + ')}. Se guarda en el historial de pagos de Personal y los días y horas quedan liquidados.`
    }))) return;

    const { pago, upd } = armarPago(emp, null);
    try {
        const batch = writeBatch(window.db);
        batch.set(doc(collection(window.db, "pagos_personal")), pago);
        batch.update(doc(window.db, "empleados", id), upd);
        await batch.commit();
        showToast("Pago registrado en el historial de Personal");
    } catch (err) {
        console.error(err);
        showToast('Error al registrar el pago. Intentá de nuevo.', 'error');
    }
};

// --- PAGO MASIVO ---
const seleccionados = new Set();

function empleadosPagables() {
    return empleadosVisibles().filter(e => totalEmpleado(e) > 0);
}

function renderBarraPagoMasivo() {
    const bar = document.getElementById('barra-pago-masivo');
    if (!bar) return;
    const sel = empleados.filter(e => seleccionados.has(e.id));
    const total = sel.reduce((s, e) => s + totalEmpleado(e), 0);
    const pagables = empleadosPagables().length;
    const visiblesIds = new Set(empleadosVisibles().map(e => e.id));
    const selVisibles = sel.filter(e => visiblesIds.has(e.id)).length;
    const ocultos = sel.length - selVisibles;
    const todos = pagables > 0 && selVisibles === pagables;
    bar.innerHTML = `
        <div class="bg-white rounded-lg shadow-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <label class="flex items-center gap-2 text-sm font-bold text-slate-600 ${pagables ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}">
                <input type="checkbox" class="w-4 h-4 accent-blue-600" ${todos ? 'checked' : ''} ${pagables ? '' : 'disabled'} onchange="toggleSeleccionTodos()">
                Seleccionar todos
                <span class="text-[11px] font-medium text-slate-400">(${selVisibles} de ${pagables} con pago pendiente${ocultos ? ` · ${ocultos} más seleccionado${ocultos === 1 ? '' : 's'} fuera de la búsqueda` : ''})</span>
            </label>
            <div class="flex items-center gap-3 sm:justify-end">
                <div class="text-right leading-tight">
                    <p class="text-[10px] uppercase font-bold text-slate-400">Total a pagar</p>
                    <p class="text-lg font-black ${sel.length ? 'text-slate-800' : 'text-slate-300'}">${fmtARS(total)}</p>
                </div>
                <button onclick="pagarSeleccionados()" ${sel.length ? '' : 'disabled'}
                        class="px-4 py-2.5 rounded-lg font-bold text-sm text-white transition shadow-sm ${sel.length ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'}">
                    <i class="fas fa-money-check-alt mr-1"></i> Pagar seleccionados${sel.length ? ` (${sel.length})` : ''}
                </button>
            </div>
        </div>`;
}

window.toggleSeleccion = function(id) {
    seleccionados.has(id) ? seleccionados.delete(id) : seleccionados.add(id);
    updateEmpleadosTable();
};

window.toggleSeleccionTodos = function() {
    const pagables = empleadosPagables();
    const todos = pagables.length > 0 && pagables.every(e => seleccionados.has(e.id));
    pagables.forEach(e => todos ? seleccionados.delete(e.id) : seleccionados.add(e.id));
    updateEmpleadosTable();
};

window.pagarSeleccionados = async function() {
    const sel = empleados.filter(e => seleccionados.has(e.id) && totalEmpleado(e) > 0);
    if (!sel.length) { showToast('Seleccioná al menos un empleado con pago pendiente'); return; }

    const total = sel.reduce((s, e) => s + totalEmpleado(e), 0);
    const detalle = sel.map(e => `• ${e.nombre}: ${fmtARS(totalEmpleado(e))} (${diasPendientes(e)} ${diasPendientes(e) === 1 ? 'día' : 'días'}${(e.horasExtras || 0) > 0 ? ` + ${e.horasExtras} hs extra` : ''})`).join('\n');

    if (!(await customConfirm({
        title: 'Pago masivo',
        text: `Se van a pagar ${sel.length} ${sel.length === 1 ? 'empleado' : 'empleados'} por un total de ${fmtARS(total)}:\n\n${detalle}\n\nEn el historial de Personal queda un registro por cada uno.`,
        okText: `Pagar ${fmtARS(total)}`
    }))) return;

    const loteId = `lote-${Date.now()}`;
    try {
        const batch = writeBatch(window.db);
        sel.forEach(emp => {
            const { pago, upd } = armarPago(emp, loteId);
            batch.set(doc(collection(window.db, "pagos_personal")), pago);
            batch.update(doc(window.db, "empleados", emp.id), upd);
        });
        await batch.commit();
        sel.forEach(e => seleccionados.delete(e.id));
        showToast(`Pago masivo registrado: ${sel.length} ${sel.length === 1 ? 'pago' : 'pagos'} por ${fmtARS(total)}`);
    } catch (err) {
        console.error(err);
        showToast('Error en el pago masivo. No se registró ningún pago, intentá de nuevo.', 'error');
    }
};

// --- HISTORIAL DE PAGOS DE PERSONAL ---
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtFecha = (key) => {
    if (!key) return '—';
    const [y, m, d] = key.split('-');
    return `${d}/${m}/${y}`;
};
const nombreDia = (key) => {
    const n = fechaDesdeKey(key).toLocaleDateString('es-AR', { weekday: 'long' });
    return n.charAt(0).toUpperCase() + n.slice(1);
};
const hpAbiertos = new Set();
let pagosFiltrados = [];

window.setVistaPersonal = function(v) {
    document.getElementById('vista-semana').classList.toggle('hidden', v !== 'semana');
    document.getElementById('vista-historial').classList.toggle('hidden', v !== 'historial');
    const on = ['bg-blue-600', 'text-white'], off = ['bg-white', 'text-slate-600', 'border'];
    const tS = document.getElementById('tab-semana'), tH = document.getElementById('tab-historial');
    [[tS, v === 'semana'], [tH, v === 'historial']].forEach(([el, activo]) => {
        on.forEach(c => el.classList.toggle(c, activo));
        off.forEach(c => el.classList.toggle(c, !activo));
    });
    if (v === 'historial') renderHistorialPersonal();
};

window.limpiarFiltrosHistorialPersonal = function() {
    document.getElementById('hp-empleado').value = '';
    document.getElementById('hp-mes').value = '';
    renderHistorialPersonal();
};

window.toggleDetallePago = function(id) {
    hpAbiertos.has(id) ? hpAbiertos.delete(id) : hpAbiertos.add(id);
    renderHistorialPersonal();
};

window.borrarPagoPersonal = async function(id) {
    const p = pagosPersonal.find(x => x.id === id);
    if (!p) return;
    if (await customConfirm({
        title: 'Borrar registro de pago',
        text: `¿Borrar el pago de ${fmtARS(p.total)} a ${p.empleadoNombre} del ${fmtFecha(p.fechaPago)}? Solo se borra del historial: los días siguen liquidados.`,
        type: 'red'
    })) {
        await deleteDoc(doc(window.db, "pagos_personal", id));
        showToast("Registro eliminado");
    }
};

function renderHistorialPersonal() {
    const lista = document.getElementById('hp-lista');
    const sel = document.getElementById('hp-empleado');
    if (!lista || !sel) return;

    // Todo el historial se filtra por la sucursal elegida (si hay sucursales)
    const sucDePago = (p) => sucursales.some(s => s.id === p.sucursalId) ? p.sucursalId : null;
    const enSucursal = (suc) => !(sucursales.length && filtroSucursal) || (suc || 'ninguna') === filtroSucursal;
    const pagosRama = pagosPersonal.filter(p => enSucursal(sucDePago(p)));

    // Selector de empleados (incluye empleados ya eliminados que tienen pagos)
    const prevSel = sel.value;
    const mapa = new Map();
    empleados.filter(e => enSucursal(sucursalDe(e))).forEach(e => mapa.set(e.id, e.nombre));
    pagosRama.forEach(p => { if (!mapa.has(p.empleadoId)) mapa.set(p.empleadoId, `${p.empleadoNombre}${empleados.some(e => e.id === p.empleadoId) ? '' : ' (eliminado)'}`); });
    sel.innerHTML = '<option value="">Todos los empleados</option>' +
        [...mapa].map(([id, n]) => `<option value="${esc(id)}">${esc(n)}</option>`).join('');
    sel.value = mapa.has(prevSel) ? prevSel : '';

    const mes = document.getElementById('hp-mes').value;
    pagosFiltrados = pagosRama.filter(p =>
        (!sel.value || p.empleadoId === sel.value) &&
        (!mes || (p.fechaPago || '').startsWith(mes))
    );

    const sum = (k) => pagosFiltrados.reduce((s, p) => s + (p[k] || 0), 0);
    const kpi = (titulo, valor, cls) => `
        <div class="bg-white rounded-lg shadow-sm border p-3">
            <p class="text-[10px] uppercase font-bold text-slate-400">${titulo}</p>
            <p class="text-lg font-black ${cls}">${valor}</p>
        </div>`;
    document.getElementById('hp-resumen').innerHTML =
        kpi('Total pagado', fmtARS(sum('total')), 'text-slate-800') +
        kpi('Pagos registrados', pagosFiltrados.length, 'text-blue-600') +
        kpi('Días trabajados', sum('diasTrabajados'), 'text-blue-600') +
        kpi('Horas extra', sum('horasExtra') + ' hs', 'text-green-600');

    lista.innerHTML = pagosFiltrados.map(p => {
        const abierto = hpAbiertos.has(p.id);
        const hora = p.creadoEn ? new Date(p.creadoEn).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
        const periodo = p.desde ? (p.desde === p.hasta ? fmtFecha(p.desde) : `${fmtFecha(p.desde)} al ${fmtFecha(p.hasta)}`) : '—';

        const filasDias = (p.detalleDias || []).map(d => `
            <tr class="border-t">
                <td class="py-1.5 pr-3 font-medium text-slate-700">${nombreDia(d.fecha)} ${fmtFecha(d.fecha)}</td>
                <td class="py-1.5 pr-3 text-center">${d.trabajo ? '<span class="font-black text-blue-600">X</span>' : '—'}</td>
                <td class="py-1.5 pr-3 text-center">${d.hs > 0 ? d.hs : '—'}</td>
                <td class="py-1.5 pr-3 text-right">${fmtARS(d.montoDia)}</td>
                <td class="py-1.5 text-right">${fmtARS(d.montoHoras)}</td>
            </tr>`).join('');
        const filaAjuste = p.horasAjuste ? `
            <tr class="border-t bg-amber-50">
                <td class="py-1.5 pr-3 font-medium text-amber-700">Sin día asignado (ajuste)</td>
                <td class="py-1.5 pr-3 text-center">—</td>
                <td class="py-1.5 pr-3 text-center">${p.horasAjuste}</td>
                <td class="py-1.5 pr-3 text-right">${fmtARS(0)}</td>
                <td class="py-1.5 text-right">${fmtARS(p.horasAjuste * (p.valorHoraExtra || 0))}</td>
            </tr>` : '';

        return `
        <div class="bg-white rounded-lg shadow-sm border overflow-hidden">
            <div class="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-bold text-slate-700 text-lg leading-tight">${esc(p.empleadoNombre)}
                        <span class="text-xs font-medium text-slate-400">${esc(p.puesto)}</span></p>
                    <p class="text-xs text-slate-500">Pagado el <b>${fmtFecha(p.fechaPago)}</b>${hora ? ' a las ' + hora : ''} · Período trabajado: ${periodo}</p>
                    <div class="flex flex-wrap gap-2 mt-2 text-[11px] font-bold">
                        <span class="bg-blue-50 text-blue-700 px-2 py-1 rounded-full">${p.diasTrabajados || 0} ${(p.diasTrabajados || 0) === 1 ? 'día' : 'días'} × ${fmtARS(p.sueldoPorDia)}</span>
                        ${p.pagoMasivo ? '<span class="bg-purple-50 text-purple-700 px-2 py-1 rounded-full"><i class="fas fa-users mr-1"></i>Pago masivo</span>' : ''}
                        ${p.sucursalNombre ? `<span class="bg-slate-100 text-slate-600 px-2 py-1 rounded-full"><i class="fas fa-store mr-1"></i>${esc(p.sucursalNombre)}</span>` : ''}
                        <span class="bg-green-50 text-green-700 px-2 py-1 rounded-full">${p.horasExtra || 0} hs extra × ${fmtARS(p.valorHoraExtra)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-3 md:text-right">
                    <div>
                        <p class="text-[10px] uppercase font-bold text-slate-400">Total pagado</p>
                        <p class="text-xl font-black text-slate-800">${fmtARS(p.total)}</p>
                    </div>
                    <button onclick="toggleDetallePago('${p.id}')" class="text-[11px] bg-slate-100 text-slate-700 px-3 py-2 rounded-lg font-bold hover:bg-slate-200 transition">
                        <i class="fas fa-chevron-${abierto ? 'up' : 'down'} mr-1"></i>${abierto ? 'Ocultar' : 'Ver detalle'}
                    </button>
                    <button onclick="borrarPagoPersonal('${p.id}')" class="text-slate-300 hover:text-red-500 p-1" title="Borrar registro"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            ${abierto ? `
            <div class="border-t bg-slate-50 p-4 space-y-3">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div class="bg-white border rounded-lg p-3"><p class="text-[10px] uppercase font-bold text-slate-400">Días trabajados</p>
                        <p class="font-bold text-slate-700">${p.diasTrabajados || 0} × ${fmtARS(p.sueldoPorDia)} = ${fmtARS(p.montoDias)}</p></div>
                    <div class="bg-white border rounded-lg p-3"><p class="text-[10px] uppercase font-bold text-slate-400">Horas extra</p>
                        <p class="font-bold text-slate-700">${p.horasExtra || 0} hs × ${fmtARS(p.valorHoraExtra)} = ${fmtARS(p.montoHorasExtra)}</p>
                        ${p.horasAjuste ? `<p class="text-[10px] text-amber-700">${p.horasEnDias} hs en días + ${p.horasAjuste} hs sin día asignado</p>` : ''}</div>
                    <div class="bg-white border rounded-lg p-3"><p class="text-[10px] uppercase font-bold text-slate-400">Total</p>
                        <p class="font-black text-slate-800">${fmtARS(p.montoDias)} + ${fmtARS(p.montoHorasExtra)} = ${fmtARS(p.total)}</p></div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-xs text-left">
                        <thead class="text-[10px] uppercase text-slate-400 font-bold">
                            <tr><th class="pb-1 pr-3">Día</th><th class="pb-1 pr-3 text-center">Trabajó</th><th class="pb-1 pr-3 text-center">Hs extra</th><th class="pb-1 pr-3 text-right">Sueldo del día</th><th class="pb-1 text-right">Monto horas</th></tr>
                        </thead>
                        <tbody>${filasDias}${filaAjuste}</tbody>
                    </table>
                </div>
                <p class="text-[10px] text-slate-400">Registrado el ${p.creadoEn ? new Date(p.creadoEn).toLocaleString('es-AR') : '—'}${p.tel ? ' · Tel: ' + esc(p.tel) : ''}</p>
            </div>` : ''}
        </div>`;
    }).join('') || '<div class="bg-white rounded-lg border p-8 text-center text-slate-400 italic text-sm">Todavía no hay pagos registrados con estos filtros.</div>';
}

window.exportarHistorialPersonal = function() {
    if (!pagosFiltrados.length) { showToast('No hay pagos para exportar'); return; }
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cab = ['Fecha de pago', 'Empleado', 'Puesto', 'Sucursal', 'Día', 'Trabajó', 'Horas extra', 'Sueldo por día', 'Valor hora extra', 'Sueldo del día', 'Monto horas', 'Total del pago'];
    const filas = [];
    pagosFiltrados.forEach(p => {
        (p.detalleDias || []).forEach(d => filas.push([
            fmtFecha(p.fechaPago), p.empleadoNombre, p.puesto, p.sucursalNombre || 'Sin sucursal', fmtFecha(d.fecha), d.trabajo ? 'X' : '', d.hs,
            p.sueldoPorDia, p.valorHoraExtra, d.montoDia, d.montoHoras, p.total
        ]));
        if (p.horasAjuste) filas.push([
            fmtFecha(p.fechaPago), p.empleadoNombre, p.puesto, p.sucursalNombre || 'Sin sucursal', 'Sin día asignado', '', p.horasAjuste,
            p.sueldoPorDia, p.valorHoraExtra, 0, p.horasAjuste * (p.valorHoraExtra || 0), p.total
        ]);
    });
    const csv = '\ufeff' + [cab, ...filas].map(r => r.map(q).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `historial-pagos-personal-${getFechaOperativa()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
    document.getElementById('emp-horas').value = emp.horasExtras || 0;
    document.getElementById('emp-edad').value = emp.edad || "";
    document.getElementById('emp-ingreso').value = emp.ingreso || "";
    document.getElementById('emp-tel').value = emp.tel || "";
    document.getElementById('emp-direccion').value = emp.direccion || "";
    document.getElementById('emp-vacaciones').value = emp.vacaciones || "";
    renderSucursalSelect();
    document.getElementById('emp-sucursal').value = sucursalDe(emp) || '';
    
    // Abrimos el modal sin pasar por el reset de openModal
    document.getElementById('modal-empleado').classList.remove('hidden'); 
};
window.deleteEmpleado = async function(id) {
    if(await customConfirm({ title: 'Eliminar', text: '¿Borrar empleado permanentemente?', type: 'red' })) {
        await deleteDoc(doc(window.db, "empleados", id));
    }
};

// --- PROVEEDORES ---
document.getElementById('form-proveedor').onsubmit = withSubmitGuard(
    'form-proveedor',
    document.querySelector('#modal-proveedor button[type="submit"]'),
    async (e) => {
    e.preventDefault();
    await addDoc(collection(window.db, "proveedores"), {
        nombre: document.getElementById('prov-nombre').value,
        rubro: document.getElementById('prov-rubro').value,
        tel: document.getElementById('prov-tel').value
    });
    closeModal('modal-proveedor');
    e.target.reset();
    showToast("Proveedor guardado");
});

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
window.openValorHora = function() {
    document.getElementById('valor-hora-extra').value = valorHoraExtra || '';
    document.getElementById('modal-hora-extra').classList.remove('hidden');
};

document.getElementById('form-hora-extra').onsubmit = withSubmitGuard(
    'form-hora-extra',
    document.querySelector('#modal-hora-extra button[type="submit"]'),
    async () => {
        const valor = parseFloat(document.getElementById('valor-hora-extra').value) || 0;
        await setDoc(doc(window.db, "config", "general"), { valorHoraExtra: valor }, { merge: true });
        closeModal('modal-hora-extra');
        showToast("Valor de hora extra actualizado");
    }
);



// --- GASTOS / BOLETAS ---
window.setFilter = function(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active-filter'));
    document.getElementById('filter-' + filter).classList.add('active-filter');
    updateBoletasTable();
};

document.getElementById('form-boleta').onsubmit = withSubmitGuard(
    'form-boleta',
    document.querySelector('#modal-boleta button[type="submit"]'),
    async (e) => {
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
});

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
