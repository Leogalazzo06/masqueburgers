import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- GUARD DE DOBLE SUBMIT (costos) ---
const _submittingCostos = new Set();
function withSubmitGuardC(formId, asyncFn) {
    return async (e) => {
        e.preventDefault();
        if (_submittingCostos.has(formId)) return;
        _submittingCostos.add(formId);
        const btn = document.querySelector(`#${formId} button[type="submit"]`);
        if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
        try {
            await asyncFn(e);
        } catch(err) {
            console.error(err);
            window.showToast && window.showToast('Error al guardar. Intentá de nuevo.', 'error');
        } finally {
            _submittingCostos.delete(formId);
            if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
        }
    };
}

let materiasPrimas = [];
let preparaciones = [];
let productos = [];
let ingredientesTemp = []; 

onSnapshot(collection(window.db, "materias_primas"), snapshot => {
    materiasPrimas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
});
onSnapshot(collection(window.db, "preparaciones"), snapshot => {
    preparaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
});
onSnapshot(collection(window.db, "productos"), snapshot => {
    productos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
});

function renderTodo() {
    renderMaterias();
    renderPreparaciones();
    renderProductos();
}



function convertirABase(cantidad, unidadUso, unidadBase) {
    // Mismo tipo — conversiones dentro de la misma familia
    if (unidadBase === 'kg'    && unidadUso === 'g')     return cantidad / 1000;
    if (unidadBase === 'litro' && unidadUso === 'ml')    return cantidad / 1000;
    if (unidadBase === 'g'     && unidadUso === 'kg')    return cantidad * 1000;
    if (unidadBase === 'ml'    && unidadUso === 'litro') return cantidad * 1000;

    // Cross-unit: el usuario eligió una unidad distinta a la base del insumo.
    // En estos casos usamos la cantidad tal cual — el costo unitario del insumo
    // ya fue calculado en su unidad base y el usuario es responsable de la equivalencia.
    // Ejemplo: Pan preparado en kg, usado "1 unidad" → costo = precio/kg * 1
    return cantidad;
}

function getCostoUnitarioMateria(id) {
    const m = materiasPrimas.find(x => x.id === id);
    if (!m || !m.cantidad || m.cantidad <= 0) return 0;
    return m.precio / m.cantidad; 
}

function getCostoUnitarioPreparacion(id, visited = []) {
    if (visited.includes(id)) return 0; 
    const p = preparaciones.find(x => x.id === id);
    if (!p || !p.rendimiento || p.rendimiento <= 0) return 0;

    let costoTotalReceta = 0;
    (p.ingredientes || []).forEach(ing => {
        let costoBase = ing.tipo === 'materia' ? getCostoUnitarioMateria(ing.idItem) : getCostoUnitarioPreparacion(ing.idItem, [...visited, id]);
        let factor = convertirABase(ing.cantidad, ing.unidadUso, ing.unidadBase);
        costoTotalReceta += costoBase * factor;
    });

    return costoTotalReceta / p.rendimiento;
}

function getCostoTotalProducto(id) {
    const prod = productos.find(x => x.id === id);
    if (!prod) return 0;

    let costoFinal = 0;
    (prod.ingredientes || []).forEach(ing => {
        let costoBase = ing.tipo === 'materia' ? getCostoUnitarioMateria(ing.idItem) : getCostoUnitarioPreparacion(ing.idItem, []);
        let factor = convertirABase(ing.cantidad, ing.unidadUso, ing.unidadBase);
        costoFinal += costoBase * factor;
    });
    return costoFinal;
}

function renderMaterias() {
    const grid = document.getElementById("grid-materias");
    if (!grid) return;
    if (!materiasPrimas.length) {
        grid.innerHTML = `<div class="cost-empty"><i class="fas fa-boxes-stacked"></i><p style="font-weight:700;margin:0 0 4px;font-size:15px;">Sin insumos aún</p><p style="font-size:13px;margin:0;">Agregá tu primer insumo para empezar.</p></div>`;
        return;
    }
    grid.innerHTML = materiasPrimas.map(m => {
        const cxu = getCostoUnitarioMateria(m.id);
        return `<div class="cost-card">
            <span style="width:44px;height:44px;border-radius:12px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-cube" style="color:#2563eb;font-size:17px;"></i>
            </span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:14px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.nombre}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${m.cantidad} ${m.unidad} · $${m.precio.toLocaleString('es-AR')} total</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:15px;font-weight:800;color:#2563eb;">$${cxu.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
                <div style="font-size:10px;color:#94a3b8;font-weight:600;">por ${m.unidad}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;margin-left:4px;">
                <button onclick="editarMateria('${m.id}')" style="background:#f1f5f9;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#64748b;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Editar"><i class="fas fa-pen"></i></button>
                <button onclick="borrarDoc('materias_primas','${m.id}')" style="background:#fff0f0;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#f87171;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join("");
}

// --- BUSCADOR DE INSUMOS ---
window.filtrarInsumos = function() {
    const q = (document.getElementById('buscar-insumo')?.value || '').toLowerCase().trim();
    const cards = document.querySelectorAll('#grid-materias .cost-card');
    let visibles = 0;
    cards.forEach(card => {
        const nombre = card.querySelector('div[style*="font-weight:700"]')?.innerText?.toLowerCase() || '';
        const mostrar = !q || nombre.includes(q);
        card.style.display = mostrar ? '' : 'none';
        if (mostrar) visibles++;
    });
    // Mostrar mensaje si no hay resultados
    let noResult = document.getElementById('buscar-insumo-empty');
    if (!noResult) {
        noResult = document.createElement('div');
        noResult.id = 'buscar-insumo-empty';
        noResult.style.cssText = 'grid-column:1/-1;text-align:center;padding:32px;color:#94a3b8;font-size:14px;display:none;';
        noResult.innerHTML = '<i class="fas fa-search" style="display:block;font-size:24px;margin-bottom:8px;opacity:.4;"></i>No se encontró ningún insumo con ese nombre.';
        document.getElementById('grid-materias')?.appendChild(noResult);
    }
    noResult.style.display = (q && visibles === 0) ? 'block' : 'none';
};


function renderPreparaciones() {
    const grid = document.getElementById("grid-preparaciones");
    if (!grid) return;
    if (!preparaciones.length) {
        grid.innerHTML = `<div class="cost-empty"><i class="fas fa-mortar-pestle"></i><p style="font-weight:700;margin:0 0 4px;font-size:15px;">Sin preparaciones</p><p style="font-size:13px;margin:0;">Creá recetas intermedias para reutilizar en el menú.</p></div>`;
        return;
    }
    grid.innerHTML = preparaciones.map(p => {
        const cxu = getCostoUnitarioPreparacion(p.id);
        return `<div class="cost-card">
            <span style="width:44px;height:44px;border-radius:12px;background:#f5f3ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-mortar-pestle" style="color:#7c3aed;font-size:16px;"></i>
            </span>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:14px;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
                <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Rinde ${p.rendimiento} ${p.unidad} · ${(p.ingredientes||[]).length} ingredientes</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
                <div style="font-size:15px;font-weight:800;color:#7c3aed;">$${cxu.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
                <div style="font-size:10px;color:#94a3b8;font-weight:600;">por ${p.unidad}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;margin-left:4px;">
                <button onclick="editarReceta('${p.id}','preparacion')" style="background:#f1f5f9;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#64748b;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Editar"><i class="fas fa-pen"></i></button>
                <button onclick="borrarDoc('preparaciones','${p.id}')" style="background:#fff0f0;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#f87171;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Eliminar"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    }).join("");
}

function renderProductos() {
    const grid = document.getElementById("grid-productos");
    if (!grid) return;
    if (!productos.length) {
        grid.innerHTML = `<div class="cost-empty"><i class="fas fa-receipt"></i><p style="font-weight:700;margin:0 0 4px;font-size:15px;">Sin productos</p><p style="font-size:13px;margin:0;">Definí los ítems del menú con su costo y precio de venta.</p></div>`;
        return;
    }
    grid.innerHTML = productos.map(p => {
        const costoTotal = getCostoTotalProducto(p.id);
        const precioHamburguesa = costoTotal * 3;
        const ganancia = precioHamburguesa - costoTotal;
        return `<div class="cost-card-product">

            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                    <span style="width:36px;height:36px;border-radius:10px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-utensils" style="color:#059669;font-size:13px;"></i>
                    </span>
                    <div style="font-weight:700;font-size:15px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button onclick="editarReceta('${p.id}','producto')" style="background:#f1f5f9;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#64748b;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Editar"><i class="fas fa-pen"></i></button>
                    <button onclick="borrarDoc('productos','${p.id}')" style="background:#fff0f0;border:none;cursor:pointer;width:28px;height:28px;border-radius:7px;color:#f87171;font-size:11px;display:flex;align-items:center;justify-content:center;" title="Eliminar"><i class="fas fa-trash"></i></button>
                </div>
            </div>

            <div style="background:linear-gradient(135deg,#78350f,#92400e);border-radius:12px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-hamburger" style="color:#fcd34d;font-size:16px;flex-shrink:0;"></i>
                    <div>
                        <div style="font-size:10px;color:#fde68a;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Precio hamburguesa</div>
                        <div style="font-size:10px;color:#d97706;margin-top:1px;">Costo + 200%</div>
                    </div>
                </div>
                <div style="font-size:20px;font-weight:900;color:#fcd34d;white-space:nowrap;">$${precioHamburguesa.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="background:#f8fafc;border-radius:10px;padding:10px 14px;">
                    <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Costo</div>
                    <div style="font-size:16px;font-weight:800;color:#ef4444;white-space:nowrap;">$${costoTotal.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
                </div>
                <div style="background:#f0fdf4;border-radius:10px;padding:10px 14px;">
                    <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Ganancia</div>
                    <div style="font-size:16px;font-weight:800;color:#059669;white-space:nowrap;">$${ganancia.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
                </div>
            </div>

        </div>`;
    }).join("");
}

// --- EDICIÓN Y CREACIÓN DE MATERIAS PRIMAS ---
window.openMateriaModal = () => {
    document.getElementById('form-materia').reset();
    document.getElementById('mat-id').value = ''; // Limpiamos ID para crear nuevo
    document.getElementById('modal-materia').classList.remove('hidden');
};

window.editarMateria = (id) => {
    const m = materiasPrimas.find(x => x.id === id);
    if(!m) return;
    document.getElementById('mat-id').value = m.id;
    document.getElementById('mat-nombre').value = m.nombre;
    document.getElementById('mat-unidad').value = m.unidad;
    document.getElementById('mat-cantidad').value = m.cantidad;
    document.getElementById('mat-precio').value = m.precio;
    document.getElementById('modal-materia').classList.remove('hidden');
};

document.getElementById('form-materia').onsubmit = withSubmitGuardC('form-materia', async (e) => {
    e.preventDefault();
    const id = document.getElementById('mat-id').value;
    const payload = {
        nombre: document.getElementById('mat-nombre').value,
        unidad: document.getElementById('mat-unidad').value,
        cantidad: parseFloat(document.getElementById('mat-cantidad').value),
        precio: parseFloat(document.getElementById('mat-precio').value)
    };

    if (id) {
        // Calcular impacto en hamburguesas ANTES de guardar
        const costosPrevios = {};
        productos.forEach(p => { costosPrevios[p.id] = getCostoTotalProducto(p.id); });

        await updateDoc(doc(window.db, "materias_primas", id), payload);
        window.closeModal('modal-materia');

        // Esperar que los listeners actualicen y mostrar impacto
        setTimeout(() => {
            mostrarImpactoEnHamburguesas(costosPrevios);
        }, 800);
    } else {
        await addDoc(collection(window.db, "materias_primas"), payload);
        window.closeModal('modal-materia');
    }
});

function mostrarImpactoEnHamburguesas(costosPrevios) {
    const afectadas = [];
    productos.forEach(p => {
        const costoAntes = costosPrevios[p.id] || 0;
        const costoDespues = getCostoTotalProducto(p.id);
        if (Math.abs(costoDespues - costoAntes) < 0.01) return;
        const precioAntes = costoAntes * 3;
        const precioDespues = costoDespues * 3;
        const diff = precioDespues - precioAntes;
        afectadas.push({ nombre: p.nombre, diff, precioDespues });
    });

    if (afectadas.length === 0) return;

    // Construir notificación visual
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.style.cssText = 'background:#1e293b;color:#fff;border-radius:14px;padding:16px 18px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,.25);animation:slideIn .3s ease;border:1px solid #334155;';

    const rows = afectadas.map(a => {
        const subio = a.diff > 0;
        const color = subio ? '#f87171' : '#34d399';
        const arrow = subio ? '↑' : '↓';
        const signo = subio ? '+' : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #334155;">
            <span style="font-size:13px;font-weight:600;color:#cbd5e1;">${a.nombre}</span>
            <div style="text-align:right;">
                <span style="font-size:13px;font-weight:800;color:${color};">${arrow} ${signo}$${Math.abs(a.diff).toLocaleString('es-AR',{minimumFractionDigits:2})}</span>
                <div style="font-size:10px;color:#64748b;">Nuevo precio: $${a.precioDespues.toLocaleString('es-AR',{minimumFractionDigits:2})}</div>
            </div>
        </div>`;
    }).join('');

    toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <i class="fas fa-hamburger" style="color:#fcd34d;font-size:16px;"></i>
            <span style="font-weight:700;font-size:14px;">Impacto en hamburguesas</span>
        </div>
        ${rows}
        <div style="font-size:11px;color:#475569;margin-top:8px;text-align:center;">Los precios se recalcularon automáticamente</div>
    `;

    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .5s'; setTimeout(() => toast.remove(), 500); }, 6000);
}

// --- EDICIÓN Y CREACIÓN DE RECETAS (Preparaciones y Productos) ---
window.openPreparacionModal = () => initRecetaModal('preparacion', 'Preparar receta');
window.openProductoModal = () => initRecetaModal('producto', 'Armar Producto Final (Ej: Moscú doble)');

function initRecetaModal(modo, titulo) {
    document.getElementById('form-receta').reset();
    document.getElementById('receta-id').value = ''; // Limpiamos ID
    document.getElementById('receta-titulo').innerText = titulo;
    document.getElementById('receta-modo').value = modo;
    ingredientesTemp = [];
    
    document.getElementById('div-rendimiento').classList.toggle('hidden', modo !== 'preparacion');
    
    cargarSelectIngredientes();
    actualizarCostoEnVivo();
    renderIngredientesTemp();
    document.getElementById('modal-receta').classList.remove('hidden');
}

window.editarReceta = (id, modo) => {
    const item = modo === 'preparacion' ? preparaciones.find(x => x.id === id) : productos.find(x => x.id === id);
    if(!item) return;

    document.getElementById('form-receta').reset();
    document.getElementById('receta-id').value = item.id;
    document.getElementById('receta-modo').value = modo;
    document.getElementById('receta-titulo').innerText = 'Editar ' + (modo === 'preparacion' ? 'Preparación' : 'Producto');
    document.getElementById('receta-nombre').value = item.nombre;

    if(modo === 'preparacion') {
        document.getElementById('receta-rendimiento').value = item.rendimiento;
        document.getElementById('receta-unidad').value = item.unidad;
        document.getElementById('div-rendimiento').classList.remove('hidden');
    } else {
        document.getElementById('div-rendimiento').classList.add('hidden');
    }

    // Cargamos los ingredientes previos reconstruyendo sus precios actuales
    ingredientesTemp = item.ingredientes.map(ing => {
        const ref = ing.tipo === 'materia' ? materiasPrimas.find(x => x.id === ing.idItem) : preparaciones.find(x => x.id === ing.idItem);
        let costoBase = ing.tipo === 'materia' ? getCostoUnitarioMateria(ing.idItem) : getCostoUnitarioPreparacion(ing.idItem);
        let factor = convertirABase(ing.cantidad, ing.unidadUso, ing.unidadBase);
        return { ...ing, nombreRef: ref ? ref.nombre : 'Eliminado', costoLinea: costoBase * factor };
    });

    cargarSelectIngredientes();
    renderIngredientesTemp();
    actualizarCostoEnVivo();
    document.getElementById('modal-receta').classList.remove('hidden');
};

function cargarSelectIngredientes() {
    const select = document.getElementById('ingrediente-select');
    let options = `<option value="">Seleccione ingrediente...</option>`;
    options += `<optgroup label="Materias Primas">`;
    materiasPrimas.forEach(m => options += `<option value="materia_${m.id}_${m.unidad}">${m.nombre}</option>`);
    options += `</optgroup><optgroup label="Preparaciones">`;
    preparaciones.forEach(p => options += `<option value="preparacion_${p.id}_${p.unidad}">${p.nombre}</option>`);
    options += `</optgroup>`;
    select.innerHTML = options;
    window.actualizarUnidadesDisponibles();
}

window.actualizarUnidadesDisponibles = () => {
    const val = document.getElementById('ingrediente-select').value;
    const selectUnidad = document.getElementById('ingrediente-unidad-uso');
    selectUnidad.innerHTML = "";
    if (!val) return;

    // Mostramos SIEMPRE todas las opciones. El usuario elige cómo
    // quiere usar el ingrediente. convertirABase() calcula el costo.
    selectUnidad.innerHTML = `
        <option value="unidad">Unidades (un)</option>
        <option value="g">Gramos (g)</option>
        <option value="kg">Kilogramos (kg)</option>
        <option value="ml">Mililitros (ml)</option>
        <option value="litro">Litros (l)</option>
    `;
};

window.agregarIngredienteTemporal = () => {
    const val = document.getElementById('ingrediente-select').value;
    const cant = parseFloat(document.getElementById('ingrediente-cant').value);
    const unidadUso = document.getElementById('ingrediente-unidad-uso').value;
    
    if (!val || !cant || cant <= 0) return;

    const _parts = val.split('_');
    const tipo = _parts[0];
    const unidadBase = _parts[_parts.length - 1];
    const idItem = _parts.slice(1, _parts.length - 1).join('_');
    let nombreItem = tipo === 'materia' ? materiasPrimas.find(x => x.id === idItem).nombre : preparaciones.find(x => x.id === idItem).nombre;

    let costoBase = tipo === 'materia' ? getCostoUnitarioMateria(idItem) : getCostoUnitarioPreparacion(idItem);
    let factor = convertirABase(cant, unidadUso, unidadBase);
    let costoLinea = costoBase * factor;

    ingredientesTemp.push({ tipo, idItem, cantidad: cant, unidadUso, unidadBase, nombreRef: nombreItem, costoLinea });
    
    document.getElementById('ingrediente-cant').value = '';
    renderIngredientesTemp();
    actualizarCostoEnVivo(); 
};

window.quitarIngredienteTemporal = (index) => {
    ingredientesTemp.splice(index, 1);
    renderIngredientesTemp();
    actualizarCostoEnVivo();
};

function renderIngredientesTemp() {
    const lista = document.getElementById('lista-ingredientes-temp');
    if (!ingredientesTemp.length) {
        lista.innerHTML = '<li style="text-align:center;padding:20px 0;color:#c8d0dc;font-size:13px;list-style:none;"><i class="fas fa-layer-group" style="display:block;font-size:24px;margin-bottom:8px;opacity:.4;"></i>Agregá ingredientes arriba...</li>';
        return;
    }
    lista.innerHTML = ingredientesTemp.map((ing, i) => `
        <li class="ing-list-item">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="background:#eff6ff;color:#2563eb;font-weight:700;padding:3px 8px;border-radius:6px;font-size:12px;">${ing.cantidad} ${ing.unidadUso}</span>
                <span style="font-weight:600;color:#1e293b;">${ing.nombreRef}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="color:#64748b;font-weight:700;font-size:13px;">$${ing.costoLinea.toLocaleString('es-AR',{minimumFractionDigits:2})}</span>
                <button type="button" onclick="quitarIngredienteTemporal(${i})" style="background:#fee2e2;color:#dc2626;border:none;cursor:pointer;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;"><i class="fas fa-times"></i></button>
            </div>
        </li>
    `).join('');
}

function actualizarCostoEnVivo() {
    let total = ingredientesTemp.reduce((acc, ing) => acc + ing.costoLinea, 0);
    document.getElementById('costo-en-vivo').innerText = '$' + total.toLocaleString('es-AR', {minimumFractionDigits:2});
}

document.getElementById('form-receta').onsubmit = withSubmitGuardC('form-receta', async (e) => {
    e.preventDefault();
    const id = document.getElementById('receta-id').value;
    const modo = document.getElementById('receta-modo').value;
    const nombre = document.getElementById('receta-nombre').value;
    
    if (ingredientesTemp.length === 0) {
        window.showToast("Debes agregar al menos 1 ingrediente.", "error");
        return;
    }

    // Mapeamos solo la data necesaria para guardar en BD
    const payload = {
        nombre,
        ingredientes: ingredientesTemp.map(i => ({ tipo: i.tipo, idItem: i.idItem, cantidad: i.cantidad, unidadUso: i.unidadUso, unidadBase: i.unidadBase }))
    };

    if (modo === 'preparacion') {
        payload.rendimiento = parseFloat(document.getElementById('receta-rendimiento').value);
        payload.unidad = document.getElementById('receta-unidad').value;
        if(id) await updateDoc(doc(window.db, "preparaciones", id), payload);
        else await addDoc(collection(window.db, "preparaciones"), payload);
    } else {
        if(id) await updateDoc(doc(window.db, "productos", id), payload);
        else await addDoc(collection(window.db, "productos"), payload);
    }
    
    window.closeModal('modal-receta');
});

window.borrarDoc = async (coleccion, id) => {
    const ok = await window.customConfirm({ 
        title: 'Eliminar registro', 
        text: '¿Estás seguro? Esta acción no se puede deshacer.', 
        okText: 'Eliminar',
        type: 'red' 
    });
    if (ok) {
        await deleteDoc(doc(window.db, coleccion, id));
        window.showToast("Registro eliminado");
    }
};

window.cambiarPestañaCostos = function(pestaña) {
    // Limpiar buscador al cambiar de tab
    const buscar = document.getElementById('buscar-insumo');
    if (buscar) { buscar.value = ''; window.filtrarInsumos && window.filtrarInsumos(); }
    document.querySelectorAll('.tab-costos-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-costos-btn').forEach(btn => {
        btn.style.borderBottomColor = 'transparent';
    });
    document.getElementById(`tab-${pestaña}`).classList.remove('hidden');
    const colors = { materias: '#2563eb', preparaciones: '#7c3aed', productos: '#059669' };
    const btnActivo = document.getElementById(`btn-tab-${pestaña}`);
    btnActivo.style.borderBottomColor = colors[pestaña];
};
