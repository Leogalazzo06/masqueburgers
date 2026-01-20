import { 
    collection, addDoc, onSnapshot, query, doc, 
    deleteDoc, updateDoc, writeBatch, orderBy, setDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- SEGURIDAD ---
onAuthStateChanged(window.auth, (user) => { if (!user) window.location.href = "login.html"; });

let boletas = [], historial = [], configCasa = { sueldo: 0, sueldoBase: 0 };

// --- UTILIDADES ---
function getFechaOperativa() { return new Date().toISOString().split('T')[0]; }

function formatDateForDisplay(iso) { 
    if(!iso) return ''; 
    const [y,m,d] = iso.split('-'); 
    return `${d}/${m}/${y}`; 
}

function getRangoSemanaActual() {
    const hoy = new Date();
    const diaSemana = hoy.getDay(); 
    const diffLunes = hoy.getDate() - (diaSemana === 0 ? 6 : diaSemana - 1);
    const lunes = new Date(new Date().setDate(diffLunes));
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);

    return `Semana del ${formatDateForDisplay(lunes.toISOString().split('T')[0])} al ${formatDateForDisplay(domingo.toISOString().split('T')[0])}`;
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-msg bg-slate-900 text-white px-6 py-3 rounded-lg shadow-2xl flex items-center gap-3 border-l-4 border-blue-500';
    toast.innerHTML = `<i class="fas fa-info-circle text-blue-400"></i> <span class="text-sm font-bold">${message}</span>`;
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

        titleEl.innerText = title; textEl.innerText = text; btnOk.innerText = okText;
        
        if(type === 'red') {
            btnOk.className = "flex-1 py-3 px-4 rounded-lg font-bold text-white bg-red-500 hover:bg-red-600 transition";
            iconEl.innerHTML = '<i class="fas fa-trash-alt text-2xl text-red-600"></i>';
            iconEl.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-red-50";
        } else {
            btnOk.className = "flex-1 py-3 px-4 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700 transition";
            iconEl.innerHTML = '<i class="fas fa-question text-2xl text-blue-600"></i>';
            iconEl.className = "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-blue-50";
        }

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

// --- ESCUCHAS FIREBASE ---
function setupListeners() {
    onSnapshot(collection(window.db, "casa_boletas"), (s) => {
        boletas = s.docs.map(d => ({id: d.id, ...d.data()}));
        updateBoletasTable();
        updateDashboard();
    });

    onSnapshot(doc(window.db, "casa_config", "presupuesto"), (d) => {
        if (d.exists()) {
            configCasa = d.data();
            document.getElementById('display-sueldo').innerText = `$${configCasa.sueldo.toLocaleString('es-AR')}`;
            updateDashboard();
        }
    });

    onSnapshot(query(collection(window.db, "casa_historial"), orderBy("fechaCierre", "desc")), (s) => {
        historial = s.docs.map(d => ({id: d.id, ...d.data()}));
        updateHistorialTable();
    });

    // ACTIVAR BUSCADOR: Filtra el historial mientras escribes
    document.getElementById('search-historial')?.addEventListener('input', updateHistorialTable);
}

// --- DASHBOARD (ACTUALIZADO: SOLO DESCUENTA PAGADOS) ---
function updateDashboard() {
    const hoyF = getFechaOperativa();
    let stats = { pagado: 0, pendiente: 0, vencidas: 0, porVencer: 0 };
    let avisos = [];

    boletas.forEach(b => {
        const diff = Math.ceil((new Date(b.vencimiento) - new Date(hoyF)) / 86400000);
        if(b.pagado) {
            stats.pagado += b.monto;
        } else {
            stats.pendiente += b.monto;
            if(diff < 0) stats.vencidas++;
            else if(diff <= 7) {
                stats.porVencer++;
                avisos.push({ detalle: b.detalle, dias: diff, monto: b.monto });
            }
        }
    });

    // --- CAMBIO AQUÍ: Saldo Disponible = Presupuesto - Solo lo Pagado ---
    const disponible = configCasa.sueldo - stats.pagado;

    const kpi = document.getElementById('kpi-cards');
    if(kpi) kpi.innerHTML = `
        <div class="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500"><p class="text-slate-400 text-[10px] font-black uppercase">Vencidas</p><h3 class="text-2xl font-bold text-red-600">${stats.vencidas}</h3></div>
        <div class="bg-white p-6 rounded-xl shadow-sm border-l-4 border-yellow-500"><p class="text-slate-400 text-[10px] font-black uppercase">Por Pagar (7d)</p><h3 class="text-2xl font-bold text-yellow-600">$${stats.pendiente.toLocaleString('es-AR')}</h3></div>
        <div class="bg-white p-6 rounded-xl shadow-sm border-l-4 border-green-500"><p class="text-slate-400 text-[10px] font-black uppercase">Pagado Semana</p><h3 class="text-2xl font-bold text-green-600">$${stats.pagado.toLocaleString('es-AR')}</h3></div>
        <div class="bg-slate-900 p-6 rounded-xl shadow-lg border-l-4 border-blue-500 text-white"><p class="text-blue-400 text-[10px] font-black uppercase">Saldo disponible</p><h3 class="text-2xl font-bold">$${disponible.toLocaleString('es-AR')}</h3></div>
    `;

    const statusEl = document.getElementById('status-message');
    if(statusEl) {
        if(avisos.length > 0) {
            avisos.sort((a,b) => a.dias - b.dias);
            statusEl.innerHTML = `<div class="space-y-2">${avisos.map(a => `
                <div class="flex justify-between items-center bg-slate-50 p-2 rounded border-l-2 border-yellow-400 text-xs">
                    <div><span class="font-bold text-slate-700">${a.detalle}</span><br><span class="text-slate-400">$${a.monto.toLocaleString('es-AR')}</span></div>
                    <span class="bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-black uppercase">Faltan ${a.dias}d</span>
                </div>`).join('')}</div>`;
        } else {
            statusEl.innerHTML = `<p class="text-center text-slate-400 text-sm py-2">Sin vencimientos próximos.</p>`;
        }
    }
}

// --- ACCIONES GASTOS ---
document.getElementById('form-boleta-casa').onsubmit = async (e) => {
    e.preventDefault();
    await addDoc(collection(window.db, "casa_boletas"), {
        tipo: document.getElementById('b-tipo').value,
        detalle: document.getElementById('b-detalle').value,
        monto: parseFloat(document.getElementById('b-monto').value),
        vencimiento: document.getElementById('b-vencimiento').value,
        pagado: false,
        fechaRegistro: new Date().toISOString()
    });
    window.closeModal('modal-boleta');
    e.target.reset();
    showToast("Gasto guardado");
};

window.pagarCasa = async (id) => {
    const b = boletas.find(x => x.id === id);
    if(await customConfirm({ title: 'Confirmar pago', text: `¿Marcar como pagado el gasto de $${b.monto.toLocaleString('es-AR')}?` })) {
        await updateDoc(doc(window.db, "casa_boletas", id), { pagado: true });
        showToast("Pago registrado y descontado");
    }
};

window.eliminarGastoCasa = async (id) => {
    if(await customConfirm({ title: 'Eliminar gasto', text: '¿Borrar este registro?', type: 'red' })) {
        await deleteDoc(doc(window.db, "casa_boletas", id));
        showToast("Gasto eliminado");
    }
};

// --- PRESUPUESTO ---
document.getElementById('form-sueldo').onsubmit = async (e) => {
    e.preventDefault();
    const montoBase = parseFloat(document.getElementById('input-sueldo-valor').value);
    await setDoc(doc(window.db, "casa_config", "presupuesto"), { 
        sueldo: montoBase, 
        sueldoBase: montoBase 
    });
    window.closeModal('modal-sueldo');
    showToast("Presupuesto base actualizado");
};

// --- CIERRE DE SEMANA (ACTUALIZADO: EL SOBRANTE ES REAL) ---
window.confirmarFinalizarMesCasa = async () => {
    // Solo contamos lo que se pagó realmente
    const totalGastosPagados = boletas.filter(b => b.pagado).reduce((acc, b) => acc + b.monto, 0);
    
    // Sobrante Real = Presupuesto Actual - Lo que se pagó
    const sobrante = configCasa.sueldo - totalGastosPagados;
    
    const textoConfirmacion = `
        Se archivarán los gastos pagados. 
        Dinero que no gastaste: $${sobrante.toLocaleString('es-AR')}. 
        Esto se sumará a tu base de la próxima semana.
    `;

    if(await customConfirm({ title: 'Cerrar semana', text: textoConfirmacion })) {
        const batch = writeBatch(window.db);
        const periodo = getRangoSemanaActual();
        
        batch.set(doc(collection(window.db, "casa_historial")), { 
            periodo, 
            totalGastos: totalGastosPagados, 
            ingreso: configCasa.sueldo, 
            fechaCierre: new Date().toISOString() 
        });

        // Eliminar solo los que ya pagaste
        boletas.filter(b => b.pagado).forEach(b => {
            batch.delete(doc(window.db, "casa_boletas", b.id));
        });

        const base = configCasa.sueldoBase || configCasa.sueldo;
        const nuevoTotal = base + sobrante;

        batch.update(doc(window.db, "casa_config", "presupuesto"), { 
            sueldo: nuevoTotal 
        });

        await batch.commit();
        showToast("Semana cerrada. Tu dinero sobrante se sumo.");
    }
};

// --- TABLAS Y NAVEGACIÓN ---
function updateBoletasTable() {
    const table = document.getElementById('table-boletas-casa');
    if(!table) return;
    table.innerHTML = boletas.map(b => `
        <tr class="hover:bg-slate-50 border-b transition">
            <td class="p-4 font-bold text-xs text-slate-400 uppercase">${b.tipo}</td>
            <td class="p-4 text-slate-700 font-medium">${b.detalle}</td>
            <td class="p-4">${formatDateForDisplay(b.vencimiento)}</td>
            <td class="p-4 font-bold text-blue-600">$${b.monto.toLocaleString('es-AR')}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-black ${b.pagado ? 'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}">${b.pagado ? 'PAGADO':'PENDIENTE'}</span></td>
            <td class="p-4 text-right">
                ${!b.pagado ? `<button onclick="pagarCasa('${b.id}')" class="text-blue-600 font-bold mr-4 underline text-xs">Pagar</button>` : '<i class="fas fa-check-circle text-green-500 mr-4"></i>'}
                <button onclick="eliminarGastoCasa('${b.id}')" class="text-slate-300 hover:text-red-500"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`).join('') || '<tr><td colspan="6" class="p-12 text-center text-slate-300 italic">Sin gastos registrados.</td></tr>';
}

function updateHistorialTable() {
    const t = document.getElementById('table-historial-casa');
    if(!t) return;

    const term = document.getElementById('search-historial')?.value.toLowerCase() || "";
    const filtered = historial.filter(h => h.periodo.toLowerCase().includes(term));

    // CASO 1: El historial está totalmente vacío (no hay cierres aún)
    if (historial.length === 0) {
        t.innerHTML = '<tr><td colspan="4" class="p-12 text-center text-slate-300 italic">Aún no tienes registros guardados.</td></tr>';
        return;
    }

    // CASO 2: Hay registros, pero la búsqueda no coincide con nada
    if (filtered.length === 0) {
        t.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-slate-400 italic">No se encontraron resultados para "${term}".</td></tr>`;
        return;
    }

    // CASO 3: Mostrar los datos (normal)
    t.innerHTML = filtered.map(h => `
        <tr class="border-b text-sm hover:bg-slate-50 transition">
            <td class="p-4 font-bold text-slate-700">${h.periodo}</td>
            <td class="p-4 text-red-600 font-bold">$${h.totalGastos.toLocaleString('es-AR')}</td>
            <td class="p-4 text-green-600 font-bold">$${(h.ingreso || 0).toLocaleString('es-AR')}</td>
            <td class="p-4 text-right"><span class="text-[10px] bg-slate-100 px-3 py-1 rounded-full font-black text-slate-400 uppercase">Archivado</span></td>
        </tr>`).join('');
}

window.showSection = (id) => {
    document.querySelectorAll('main section').forEach(s => s.classList.add('hidden'));
    document.getElementById('sec-' + id).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active-link'));
    if(event) event.currentTarget.classList.add('active-link');
    const titles = { 'dashboard': 'Dashboard', 'boletas': 'Gastos y boletas', 'sueldo': 'Presupuesto', 'historial': 'Registros guardados' };
    document.getElementById('section-title').innerText = titles[id] || "Casa";
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-date').innerText = getRangoSemanaActual();
    setupListeners();
    
});

window.openModal = (id) => document.getElementById(id).classList.remove('hidden');
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');
window.borrarHistorialCompletoCasa = async () => {
    if(await customConfirm({ title: 'Limpiar historial', text: '¿Eliminar todos los registros?', type: 'red' })) {
        const batch = writeBatch(window.db);
        historial.forEach(h => batch.delete(doc(window.db, "casa_historial", h.id)));
        await batch.commit();
        showToast("Historial vaciado");
    }
};