import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// --- MOTOR DE LOGIN CON FIREBASE ---
document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();

    const emailInput = document.getElementById('login-email').value;
    const passInput = document.getElementById('login-pass').value;

    try {
        // Intento de inicio de sesión en Firebase
        await signInWithEmailAndPassword(window.auth, emailInput, passInput);
        
        showLoginToast("Acceso concedido. Redirigiendo...", "success");

        // Firebase mantiene la sesión, solo redirigimos
        setTimeout(() => {
            window.location.href = "index.html";
        }, 1500);

    } catch (error) {
        console.error("Error de login:", error.code);
        
        let mensajeError = "Credenciales incorrectas";
        
        // Manejo de errores específicos
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

// --- SISTEMA DE TOASTS ---
function showLoginToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    const colors = type === 'success' ? 'border-green-500' : 'border-red-500';
    const icon = type === 'success' ? 'fa-check-circle text-green-500' : 'fa-exclamation-circle text-red-500';

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