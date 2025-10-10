import { getFirestore, collection, query, where, onSnapshot, updateDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

// --- DOM Elements ---
const notificationSidebar = document.getElementById('notification-sidebar');
const closeNotificationSidebarBtn = document.getElementById('close-notification-sidebar');
const notificationList = document.getElementById('notification-list');
const clearAllNotificationsBtn = document.getElementById('clear-all-notifications');

// Notification Bell Icons and Badges (using class selectors)
const notificationBells = document.querySelectorAll('.notification-bell');
const notificationBadges = document.querySelectorAll('.notification-badge');


let db;
let userId;
let notificationsUnsubscribe = null;
let allNotifications = [];

function initializeNotifications(firestore, effectiveUserId) {
    if (!firestore || !effectiveUserId) {
        console.error("Firestore or User ID is missing for notifications initialization.");
        return;
    }
    db = firestore;
    userId = effectiveUserId;

    // Detach any existing listener before attaching a new one
    if (notificationsUnsubscribe) {
        notificationsUnsubscribe();
    }

    const notificationsRef = collection(db, 'users', userId, 'notificacoes');
    const q = query(notificationsRef, where("isRead", "==", false));

    notificationsUnsubscribe = onSnapshot(q, (snapshot) => {
        const unreadCount = snapshot.size;
        updateNotificationBadge(unreadCount);
    });

    // Add event listeners for all bell icons
    notificationBells.forEach(bell => {
        bell.addEventListener('click', toggleNotificationSidebar);
    });

    // Add event listeners for sidebar controls
    if(closeNotificationSidebarBtn) closeNotificationSidebarBtn.addEventListener('click', closeNotificationSidebar);
    if(clearAllNotificationsBtn) clearAllNotificationsBtn.addEventListener('click', clearAllNotifications);
}

function updateNotificationBadge(count) {
    notificationBadges.forEach(badge => {
        if (count > 0) {
            badge.classList.remove('hidden');
            // If you want to show the count number, you'd add this:
            // badge.textContent = count;
            // And adjust styles for size, etc.
        } else {
            badge.classList.add('hidden');
        }
    });
}

async function toggleNotificationSidebar() {
    const isVisible = !notificationSidebar.classList.contains('translate-x-full');
    if (isVisible) {
        closeNotificationSidebar();
    } else {
        await fetchAndRenderNotifications();
        notificationSidebar.classList.remove('translate-x-full');
    }
}

function closeNotificationSidebar() {
    notificationSidebar.classList.add('translate-x-full');
    markAllAsRead();
}

async function fetchAndRenderNotifications() {
    if (!db || !userId) return;

    // --- MOCK DATA FOR TESTING ---
    if (userId === 'test-user-123') {
        console.log("Test user detected, rendering mock notification.");
        allNotifications = [{
            id: 'mock-notif-1',
            title: 'Despesa Próxima ao Vencimento',
            message: 'Conta de Luz (Mock para Teste) no valor de R$ 500.00 vence em 2025-10-10.',
            type: 'vencimento',
            isRead: false,
            timestamp: { toDate: () => new Date() },
            relatedDocId: 'mock-expense-for-test'
        }];
        renderNotifications();
        return;
    }
    // --- END MOCK DATA ---

    const notificationsRef = collection(db, 'users', userId, 'notificacoes');
    const q = query(notificationsRef, where("isArchived", "==", false)); // Assuming you might want an archive feature later

    try {
        const snapshot = await onSnapshot(q, (querySnapshot) => {
            allNotifications = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allNotifications.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis()); // Show newest first

            renderNotifications();
        });
    } catch (error) {
        console.error("Error fetching notifications:", error);
        notificationList.innerHTML = '<div class="text-center text-red-500 p-4">Erro ao carregar notificações.</div>';
    }
}

function renderNotifications() {
    if (allNotifications.length === 0) {
        notificationList.innerHTML = '<div class="text-center text-gray-500 pt-10">Nenhuma notificação nova.</div>';
        return;
    }

    notificationList.innerHTML = allNotifications.map(notif => {
        const iconMap = {
            'vencimento': { class: 'text-yellow-500', name: 'event_upcoming' },
            'atraso': { class: 'text-red-500', name: 'error' },
            'confirmacao': { class: 'text-green-500', name: 'check_circle' },
            'conciliacao': { class: 'text-blue-500', name: 'account_balance' },
            'default': { class: 'text-gray-500', name: 'notifications' }
        };
        const icon = iconMap[notif.type] || iconMap['default'];
        const timeAgo = formatTimeAgo(notif.timestamp);

        return `
            <div class="flex items-start gap-4 p-3 rounded-lg ${notif.isRead ? 'bg-white' : 'bg-blue-50'} hover:bg-gray-100 cursor-pointer" data-doc-id="${notif.relatedDocId}">
                <div class="flex-shrink-0">
                    <span class="material-symbols-outlined ${icon.class}">${icon.name}</span>
                </div>
                <div class="flex-grow">
                    <p class="font-semibold text-gray-800 text-sm">${notif.title}</p>
                    <p class="text-gray-600 text-sm">${notif.message}</p>
                    <p class="text-xs text-gray-400 mt-1">${timeAgo}</p>
                </div>
            </div>
        `;
    }).join('');
}


async function markAllAsRead() {
    const unreadNotifications = allNotifications.filter(n => !n.isRead);
    if (unreadNotifications.length === 0) return;

    const batch = writeBatch(db);
    unreadNotifications.forEach(notif => {
        const notifRef = doc(db, 'users', userId, 'notificacoes', notif.id);
        batch.update(notifRef, { isRead: true });
    });

    try {
        await batch.commit();
        console.log("All notifications marked as read.");
    } catch (error) {
        console.error("Error marking notifications as read:", error);
    }
}

async function clearAllNotifications() {
    if (!confirm("Tem certeza que deseja limpar todas as notificações?")) return;

    const batch = writeBatch(db);
    allNotifications.forEach(notif => {
        const notifRef = doc(db, 'users', userId, 'notificacoes', notif.id);
        // Instead of deleting, we can archive them
        batch.update(notifRef, { isArchived: true, isRead: true });
    });

    try {
        await batch.commit();
        console.log("All notifications cleared (archived).");
        closeNotificationSidebar();
    } catch (error) {
        console.error("Error clearing notifications:", error);
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp?.toDate) return '';
    const date = timestamp.toDate();
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " anos atrás";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " meses atrás";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " dias atrás";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " horas atrás";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " minutos atrás";
    return "agora mesmo";
}


// --- Notification Generation ---

async function generateFinancialAlerts() {
    if (!db || !userId) return;

    const today = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(today.getDate() + 3);

    const todayStr = today.toISOString().split('T')[0];
    const threeDaysStr = threeDaysFromNow.toISOString().split('T')[0];

    // Due Soon
    const despesasDueQuery = query(collection(db, 'users', userId, 'despesas'), where('vencimento', '>=', todayStr), where('vencimento', '<=', threeDaysStr), where('status', 'in', ['Pendente', 'Pago Parcialmente']));
    const receitasDueQuery = query(collection(db, 'users', userId, 'receitas'), where('dataVencimento', '>=', todayStr), where('dataVencimento', '<=', threeDaysStr), where('status', 'in', ['Pendente', 'Recebido Parcialmente']));

    // Overdue
    const despesasOverdueQuery = query(collection(db, 'users', userId, 'despesas'), where('vencimento', '<', todayStr), where('status', 'in', ['Pendente', 'Pago Parcialmente']));
    const receitasOverdueQuery = query(collection(db, 'users', userId, 'receitas'), where('dataVencimento', '<', todayStr), where('status', 'in', ['Pendente', 'Recebido Parcialmente']));

    try {
        const [despesasDueSnap, receitasDueSnap, despesasOverdueSnap, receitasOverdueSnap] = await Promise.all([
            getDocs(despesasDueQuery),
            getDocs(receitasDueQuery),
            getDocs(despesasOverdueQuery),
            getDocs(receitasOverdueQuery)
        ]);

        despesasDueSnap.forEach(doc => createNotification(doc, 'vencimento', 'Despesa Próxima ao Vencimento'));
        receitasDueSnap.forEach(doc => createNotification(doc, 'vencimento', 'Receita Próxima ao Vencimento'));
        despesasOverdueSnap.forEach(doc => createNotification(doc, 'atraso', 'Despesa Vencida'));
        receitasOverdueSnap.forEach(doc => createNotification(doc, 'atraso', 'Receita Vencida'));

    } catch (error) {
        console.error("Error generating financial alerts:", error);
    }
}

async function createNotification(doc, type, title) {
    if (!db || !userId) return;

    const data = doc.data();
    const notificationId = `${type}-${doc.id}`; // Create a predictable ID
    const notificationRef = doc(db, 'users', userId, 'notificacoes', notificationId);

    // Check if notification already exists
    const notificationSnap = await getDoc(notificationRef);
    if (notificationSnap.exists()) {
        return; // Notification already created
    }

    const message = `${data.descricao} no valor de R$ ${data.valorOriginal / 100} vence em ${data.vencimento || data.dataVencimento}.`;

    const notificationData = {
        title: title,
        message: message,
        type: type,
        isRead: false,
        isArchived: false,
        timestamp: serverTimestamp(),
        relatedDocId: doc.id,
        relatedCollection: doc.ref.parent.id, // 'despesas' or 'receitas'
    };

    await setDoc(notificationRef, notificationData);
}

// Export the main function to be called from index.html
export { initializeNotifications, generateFinancialAlerts };