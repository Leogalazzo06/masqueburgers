import { signInWithEmailAndPassword, updatePassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = getFirestore();

// --- MOTOR DE LOGIN CON FIREBASE ---
document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('login-email').value;
    const passInput = document.getElementById('login-pass').value;
    const btnLogin = document.getElementById('btn-login');
    const loaderLogin = document.getElementById('loader-login');

    // Mostrar loader y deshabilitar botón
    btnLogin.disabled = true;
    loaderLogin.classList.remove('hidden');

    try {
        // Intento de inicio de sesión en Firebase
        const userCredential = await signInWithEmailAndPassword(window.auth, emailInput, passInput);
        const user = userCredential.user;
        
        // Verificar si el usuario necesita cambiar su contraseña
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        const needsPasswordChange = !userDoc.exists() || userDoc.data().passwordChanged !== true;

        if (needsPasswordChange) {
            // Ocultar loader
            loaderLogin.classList.add('hidden');
            btnLogin.disabled = false;
            
            // Mostrar modal de cambio de contraseña
            showLoginToast("Debes cambiar tu contraseña temporal", "warning");
            document.getElementById('modal-cambiar-pass').style.display = 'flex';
        } else {
            // Usuario ya cambió su contraseña, permitir acceso
            loaderLogin.innerHTML = `
                <i class="fas fa-check-circle text-green-500 text-lg"></i>
                <span class="font-bold text-green-700">¡Acceso concedido! Redirigiendo...</span>
            `;
            loaderLogin.classList.remove('border-blue-400', 'bg-blue-50');
            loaderLogin.classList.add('border-green-400', 'bg-green-50');
            
            setTimeout(() => {
                window.location.href = "index.html";
            }, 1500);
        }

    } catch (error) {
        console.error("Error de login:", error.code);
        
        // Ocultar loader y habilitar botón
        loaderLogin.classList.add('hidden');
        btnLogin.disabled = false;
        
        let mensajeError = "Credenciales incorrectas";
        
        if (error.code === 'auth/invalid-credential') {
            mensajeError = "Usuario o contraseña no válidos";
        } else if (error.code === 'auth/user-not-found') {
            mensajeError = "El usuario no existe";
        } else if (error.code === 'auth/wrong-password') {
            mensajeError = "Contraseña incorrecta";
        } else if (error.code === 'auth/too-many-requests') {
            mensajeError = "Demasiados intentos. Intenta más tarde";
        }

        showLoginToast(mensajeError, "error");
    }
};

// --- CAMBIO DE CONTRASEÑA ---
document.getElementById('form-cambiar-pass').onsubmit = async (e) => {
    e.preventDefault();

    const nuevaPass = document.getElementById('nueva-pass').value;
    const confirmarPass = document.getElementById('confirmar-pass').value;
    const btnCambiar = document.getElementById('btn-cambiar-pass');
    const loaderCambiar = document.getElementById('loader-cambiar-pass');

    // Validar que las contraseñas coincidan
    if (nuevaPass !== confirmarPass) {
        showLoginToast("Las contraseñas no coinciden", "error");
        return;
    }

    // Validar longitud mínima
    if (nuevaPass.length < 6) {
        showLoginToast("La contraseña debe tener al menos 6 caracteres", "error");
        return;
    }

    // Mostrar loader y deshabilitar botón
    btnCambiar.disabled = true;
    loaderCambiar.classList.remove('hidden');

    try {
        const user = window.auth.currentUser;
        
        // Actualizar contraseña en Firebase Auth
        await updatePassword(user, nuevaPass);
        
        // Marcar que el usuario ya cambió su contraseña
        await setDoc(doc(db, 'usuarios', user.uid), {
            email: user.email,
            passwordChanged: true,
            fechaCambio: new Date().toISOString()
        });

        // Cambiar loader a éxito
        loaderCambiar.innerHTML = `
            <i class="fas fa-check-circle text-green-500 text-lg"></i>
            <span class="font-bold text-green-700">¡Contraseña actualizada! Redirigiendo...</span>
        `;
        loaderCambiar.classList.remove('border-blue-400', 'bg-blue-50');
        loaderCambiar.classList.add('border-green-400', 'bg-green-50');
        
        // Cerrar modal y redirigir
        setTimeout(() => {
            document.getElementById('modal-cambiar-pass').style.display = 'none';
            window.location.href = "index.html";
        }, 1500);

    } catch (error) {
        console.error("Error al cambiar contraseña:", error);
        
        // Ocultar loader y habilitar botón
        loaderCambiar.classList.add('hidden');
        btnCambiar.disabled = false;
        
        showLoginToast("Error al cambiar la contraseña. Intenta de nuevo", "error");
    }
};

// --- SISTEMA DE TOASTS ---
function showLoginToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    let colors, icon;
    
    if (type === 'success') {
        colors = 'border-green-500';
        icon = 'fa-check-circle text-green-500';
    } else if (type === 'warning') {
        colors = 'border-amber-500';
        icon = 'fa-exclamation-triangle text-amber-500';
    } else {
        colors = 'border-red-500';
        icon = 'fa-exclamation-circle text-red-500';
    }

    toast.className = `toast-msg bg-white text-slate-800 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-4 border-l-4 ${colors} min-w-[280px]`;
    toast.innerHTML = `
        <i class="fas ${icon} text-lg"></i>
        <span class="text-sm font-bold">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = '0.4s';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}
