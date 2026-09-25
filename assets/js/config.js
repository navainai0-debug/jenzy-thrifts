// =====================================================================
// ✏️ JENZY THRIFTS — WEBSITE SETTINGS (edit this file)
// These keys are PUBLIC by design (safe to be in the website).
// NEVER put the Supabase "service_role" key here — that one goes
// only in Vercel → Settings → Environment Variables.
// =====================================================================
window.JENZY_CONFIG = {
    firebase: {
        apiKey: "AIzaSyBcPi4kwtQmZjPpU9v4jmK-ggC2CsoJD38",
        authDomain: "jenzythrifts-c7f90.firebaseapp.com",
        projectId: "jenzythrifts-c7f90",
        storageBucket: "jenzythrifts-c7f90.firebasestorage.app",
        messagingSenderId: "698531856654",
        appId: "1:698531856654:web:e3edf1169b3a50b5ac575f"
    },

    supabaseUrl: "https://zurvhjraxenbnvmwdurz.supabase.co",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1cnZoanJheGVuYm52bXdkdXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNTI2NzAsImV4cCI6MjEwNTkyODY3MH0.mdmGZCNYds6wPHY8hE3_Eq1BaZ-x4LvPd-AIEsoJrTM",

    // Your shop's contact details (shown in the Contact section & footer)
    site: {
        name: "JENZY THRIFTS",
        phone: "+92 300 1234567",
        whatsapp: "923001234567",      // 92 + number without the first 0 (for the "Chat with us" link)
        email: "info@jenzythrifts.com",
        instagram: "",                 // e.g. "https://instagram.com/jenzythrifts" — leave empty to hide
        city: "Pakistan",
        announcement: "Free delivery on orders above PKR 5,000  •  Use code JENZY20 for 20% off  •  100% authentic branded shoes"
    }
};
