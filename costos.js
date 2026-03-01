import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let materiasPrimas = [];
let preparaciones = [];
let productos = [];
let ingredientesTemp = []; 

onSnapshot(collection(window.db, "materias_primas"), snapshot => {
    materiasPrimas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
    actualizarPreciosProductos(); // ← recalcula precios al cambiar materias
});
onSnapshot(collection(window.db, "preparaciones"), snapshot => {
    preparaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTodo();
    actualizarPreciosProductos(); // ← recalcula precios al cambiar preparaciones
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

// Cuando cambian los costos base, recalcula precioVenta de todos los productos
// que tienen margenObjetivo guardado, manteniendo el margen constante.
let _actualizandoPrecios = false;
async function actualizarPreciosProductos() {
    if (_actualizandoPrecios || productos.length === 0 || materiasPrimas.length === 0) return;
    _actualizandoPrecios = true;

    const updates = [];
    productos.forEach(p => {
        if (!p.margenObjetivo || p.margenObjetivo <= 0) return; // sin margen guardado, no tocar
        const costoActual = getCostoTotalProducto(p.id);
        if (costoActual <= 0) return;
        const nuevoPrecio = parseFloat((costoActual / (1 - p.margenObjetivo)).toFixed(2));
        // Solo actualizar si el precio cambió más de $0.01 para evitar loops
        if (Math.abs(nuevoPrecio - (p.precioVenta || 0)) > 0.01) {
            updates.push(updateDoc(doc(window.db, "productos", p.id), { precioVenta: nuevoPrecio }));
        }
    });

    if (updates.length > 0) {
        await Promise.all(updates);
        window.showToast && window.showToast(`💰 ${updates.length} precio(s) actualizados automáticamente`, "success");
    }

    _actualizandoPrecios = false;
}

function convertirABase(cantidad, unidadUso, unidadBase) {
    if (unidadBase === 'kg' && unidadUso === 'g') return cantidad / 1000;
    if (unidadBase === 'litro' && unidadUso === 'ml') return cantidad / 1000;
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
    const t = document.getElementById("table-materias");
    if (!t) return;
    t.innerHTML = materiasPrimas.map(m => `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition">
            <td class="p-3 font-bold text-slate-700">${m.nombre}</td>
            <td class="p-3 text-slate-500">${m.cantidad} ${m.unidad} <br><span class="text-[10px] text-slate-400">$${m.precio.toLocaleString('es-AR')} total pagado</span></td>
            <td class="p-3 font-black text-blue-600">$${getCostoUnitarioMateria(m.id).toLocaleString('es-AR', {minimumFractionDigits:2})} / ${m.unidad}</td>
            <td class="p-3 text-right space-x-2">
                <button onclick="editarMateria('${m.id}')" class="text-blue-400 hover:text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                <button onclick="borrarDoc('materias_primas', '${m.id}')" class="text-slate-300 hover:text-red-500 p-1"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`).join("");
}

function renderPreparaciones() {
    const t = document.getElementById("table-preparaciones");
    if (!t) return;
    t.innerHTML = preparaciones.map(p => `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition">
            <td class="p-3 font-bold text-slate-700">${p.nombre}</td>
            <td class="p-3 text-slate-500">Rinde: ${p.rendimiento} ${p.unidad}</td>
            <td class="p-3 font-black text-purple-600">$${getCostoUnitarioPreparacion(p.id).toLocaleString('es-AR', {minimumFractionDigits:2})} / ${p.unidad}</td>
            <td class="p-3 text-right space-x-2">
                <button onclick="editarReceta('${p.id}', 'preparacion')" class="text-blue-400 hover:text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                <button onclick="borrarDoc('preparaciones', '${p.id}')" class="text-slate-300 hover:text-red-500 p-1"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`).join("");
}

function renderProductos() {
    const t = document.getElementById("table-productos");
    if (!t) return;
    t.innerHTML = productos.map(p => {
        const costoTotal = getCostoTotalProducto(p.id);
        const margenPesos = p.precioVenta - costoTotal;
        const margenPct = p.precioVenta > 0 ? (margenPesos / p.precioVenta) * 100 : 0;
        const tieneMargenFijo = p.margenObjetivo && p.margenObjetivo > 0;
        return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition">
            <td class="p-3 font-bold text-slate-700">
                ${p.nombre}
                ${tieneMargenFijo ? `<span title="Precio se actualiza automáticamente con el costo" class="ml-1 text-xs bg-blue-100 text-blue-600 px-1 rounded">⚡ auto</span>` : ''}
            </td>
            <td class="p-3 font-bold text-red-500">$${costoTotal.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
            <td class="p-3 font-bold text-blue-600">$${(p.precioVenta||0).toLocaleString('es-AR')}</td>
            <td class="p-3">
                <span class="block font-black text-green-600">$${margenPesos.toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                <span class="text-[10px] ${margenPct < 30 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'} px-1 rounded">${margenPct.toFixed(1)}%${tieneMargenFijo ? ` (objetivo: ${(p.margenObjetivo*100).toFixed(0)}%)` : ''}</span>
            </td>
            <td class="p-3 text-right space-x-2">
                <button onclick="editarReceta('${p.id}', 'producto')" class="text-blue-400 hover:text-blue-600 p-1"><i class="fas fa-edit"></i></button>
                <button onclick="borrarDoc('productos', '${p.id}')" class="text-slate-300 hover:text-red-500 p-1"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
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

document.getElementById('form-materia').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('mat-id').value;
    const payload = {
        nombre: document.getElementById('mat-nombre').value,
        unidad: document.getElementById('mat-unidad').value,
        cantidad: parseFloat(document.getElementById('mat-cantidad').value),
        precio: parseFloat(document.getElementById('mat-precio').value)
    };

    if (id) {
        await updateDoc(doc(window.db, "materias_primas", id), payload);
    } else {
        await addDoc(collection(window.db, "materias_primas"), payload);
    }
    window.closeModal('modal-materia');
};

// --- EDICIÓN Y CREACIÓN DE RECETAS (Preparaciones y Productos) ---
window.openPreparacionModal = () => initRecetaModal('preparacion', 'Preparar receta');
window.openProductoModal = () => initRecetaModal('producto', 'Armar Producto Final (Ej: Moscú doble)');

function initRecetaModal(modo, titulo) {
    document.getElementById('form-receta').reset();
    document.getElementById('receta-id').value = ''; // Limpiamos ID
    document.getElementById('receta-titulo').innerText = titulo;
    document.getElementById('receta-modo').value = modo;
    ingredientesTemp = [];
    
    document.getElementById('panel-sugerido').classList.toggle('hidden', modo !== 'producto');
    document.getElementById('div-rendimiento').classList.toggle('hidden', modo !== 'preparacion');
    document.getElementById('receta-precio').classList.toggle('hidden', modo !== 'producto');
    
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
        document.getElementById('receta-precio').classList.add('hidden');
        document.getElementById('panel-sugerido').classList.add('hidden');
    } else {
        document.getElementById('receta-precio').value = item.precioVenta;
        // Cargar margen guardado o calcular desde el precio actual
        const margenInput = document.getElementById('receta-margen');
        if (margenInput) {
            const margenGuardado = item.margenObjetivo ? (item.margenObjetivo * 100).toFixed(0) : 70;
            margenInput.value = margenGuardado;
        }
        document.getElementById('div-rendimiento').classList.add('hidden');
        document.getElementById('receta-precio').classList.remove('hidden');
        document.getElementById('panel-sugerido').classList.remove('hidden');
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
    const unidadBase = val.split('_')[2]; 

    if (unidadBase === 'kg') {
        selectUnidad.innerHTML = `<option value="g">Gramos (g)</option><option value="kg">Kilos (kg)</option>`;
    } else if (unidadBase === 'litro') {
        selectUnidad.innerHTML = `<option value="ml">Mililitros (ml)</option><option value="litro">Litros (l)</option>`;
    } else {
        selectUnidad.innerHTML = `<option value="unidad">Unidades (un)</option>`;
    }
};

window.agregarIngredienteTemporal = () => {
    const val = document.getElementById('ingrediente-select').value;
    const cant = parseFloat(document.getElementById('ingrediente-cant').value);
    const unidadUso = document.getElementById('ingrediente-unidad-uso').value;
    
    if (!val || !cant || cant <= 0) return;

    const [tipo, idItem, unidadBase] = val.split('_');
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
    lista.innerHTML = ingredientesTemp.map((ing, i) => `
        <li class="flex justify-between items-center bg-slate-50 p-2 border-b border-slate-100 text-sm">
            <div class="flex items-center gap-2">
                <span class="bg-blue-100 text-blue-700 font-black px-2 py-1 rounded text-xs">${ing.cantidad} ${ing.unidadUso}</span> 
                <span class="font-bold text-slate-700">${ing.nombreRef}</span>
            </div>
            <div class="flex items-center gap-4">
                <span class="text-slate-500 font-bold">$${ing.costoLinea.toLocaleString('es-AR', {minimumFractionDigits:2})}</span>
                <button type="button" onclick="quitarIngredienteTemporal(${i})" class="text-red-400 hover:text-red-600 bg-red-50 w-6 h-6 rounded flex items-center justify-center"><i class="fas fa-times"></i></button>
            </div>
        </li>
    `).join('') || '<li class="text-xs text-slate-400 italic text-center py-4">Agrega ingredientes arriba...</li>';
}

function actualizarCostoEnVivo() {
    let total = ingredientesTemp.reduce((acc, ing) => acc + ing.costoLinea, 0);
    document.getElementById('costo-en-vivo').innerText = '$' + total.toLocaleString('es-AR', {minimumFractionDigits:2});
    
    const modo = document.getElementById('receta-modo').value;
    if (modo === 'producto') {
        // Leer el margen del input (por defecto 70% = margen del 30% sobre precio venta)
        const margenInput = document.getElementById('receta-margen');
        const margenPct = parseFloat(margenInput ? margenInput.value : 70) / 100 || 0.70;
        let sugerido = total / (1 - margenPct);
        
        document.getElementById('precio-sugerido').innerText = '$' + sugerido.toLocaleString('es-AR', {minimumFractionDigits:2});
        document.getElementById('receta-precio').value = sugerido.toFixed(2);
    }
}

document.getElementById('form-receta').onsubmit = async (e) => {
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
        const margenInput = document.getElementById('receta-margen');
        const margenPct = parseFloat(margenInput ? margenInput.value : 70) / 100 || 0.70;
        payload.precioVenta = parseFloat(document.getElementById('receta-precio').value);
        payload.margenObjetivo = margenPct; // ← guardamos el margen para recalcular automático
        if(id) await updateDoc(doc(window.db, "productos", id), payload);
        else await addDoc(collection(window.db, "productos"), payload);
    }
    
    window.closeModal('modal-receta');
};

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
    document.querySelectorAll('.tab-costos-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-costos-btn').forEach(btn => {
        btn.classList.remove('bg-white', 'shadow-sm', 'text-blue-600', 'text-purple-600', 'text-green-600');
        btn.classList.add('text-slate-500');
    });

    document.getElementById(`tab-${pestaña}`).classList.remove('hidden');
    
    const btnActivo = document.getElementById(`btn-tab-${pestaña}`);
    btnActivo.classList.remove('text-slate-500');
    btnActivo.classList.add('bg-white', 'shadow-sm');
    
    if (pestaña === 'materias') btnActivo.classList.add('text-blue-600');
    if (pestaña === 'preparaciones') btnActivo.classList.add('text-purple-600');
    if (pestaña === 'productos') btnActivo.classList.add('text-green-600');
};